import {chromium} from 'playwright-core';
import {inventory,collect,ReadError} from './browser-reader.mjs';
const origin='https://app.microflixstudios.com';
const token=process.env.MICROFLIX_WORKER_TOKEN,endpoint=process.env.BROWSER_CDP_URL;
if(!/^mfs_[a-f0-9]{64}$/.test(token??'')||!endpoint)throw Error('Configure MICROFLIX_WORKER_TOKEN and BROWSER_CDP_URL through your server secret manager.');
const cdp=new URL(endpoint);if(!['wss:','https:'].includes(cdp.protocol)&&!(['ws:','http:'].includes(cdp.protocol)&&['localhost','127.0.0.1'].includes(cdp.hostname)))throw Error('Use encrypted CDP transport, or a loopback-only browser.');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let stopping=false;
process.on('SIGTERM',()=>{stopping=true;});process.on('SIGINT',()=>{stopping=true;});
async function api(payload){const response=await fetch(origin+'/api/demographics/server-worker',{method:'POST',redirect:'error',headers:{authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(20_000)});if(response.status===401){stopping=true;throw Error('Worker authorization revoked. Reconnect from MicroFlix.');}if(!response.ok)throw Error('Worker request failed ('+response.status+').');return response.json();}
let browser,page;
while(!stopping){
 let task;
 try{
  ({task}=await api({action:'poll'}));
  if(!task){await sleep(10_000);continue;}
  if(!browser?.isConnected()){
   browser=await chromium.connectOverCDP(endpoint,{timeout:30_000});
   const context=browser.contexts()[0];if(!context)throw new ReadError('sign_in');
   page=await context.newPage();
  }
  if(page.isClosed())page=await browser.contexts()[0].newPage();
  // A dedicated persistent browser belongs to exactly one connected MicroFlix account.
  const base={jobId:task.jobId,lease:task.lease};
  const heartbeat=setInterval(()=>void api({action:'heartbeat'}).catch(()=>{}),15_000);
  try{
   if(task.kind==='inventory')await api({action:'inventory',...base,videoIds:await inventory(page,task.handle)});
   else await api({action:'capture',...base,record:await collect(page,task.videoId,task.handle)});
  }finally{clearInterval(heartbeat);}
 }catch(error){
  // Never log page contents, browser endpoints, tokens, cookies, or raw provider errors.
  if(task)await api({action:'pause',jobId:task.jobId,lease:task.lease,reason:error instanceof ReadError?error.reason:'read_failed'}).catch(()=>{});
  console.error(stopping?'Worker authorization is no longer valid.':'Sync paused or unavailable. Check status in MicroFlix and the server browser.');
  await sleep(15_000);
 }
}
// Do not close the provider browser: its login must persist. Process exit drops the CDP connection.
process.exit(0);
