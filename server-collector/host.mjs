import {spawn} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
import {chromium} from 'playwright-core';
import {createViewer} from './viewer.mjs';
const password=process.env.VIEWER_PASSWORD,token=process.env.MICROFLIX_WORKER_TOKEN,origin=process.env.RENDER_EXTERNAL_URL;
if(!origin?.startsWith('https://')||!password||password.length<20||!/^mfs_[a-f0-9]{64}$/.test(token??''))throw Error('Set VIEWER_PASSWORD (20+ characters), MICROFLIX_WORKER_TOKEN and deploy as a Render web service.');
process.env.BROWSER_CDP_URL='http://127.0.0.1:9222';
const children=[];let context,worker,ready=false,quitting=false;
function child(command,args,options={}){const p=spawn(command,args,{stdio:'ignore',...options});children.push(p);p.on('error',()=>shutdown(1));return p;}
async function shutdown(code=0){if(quitting)return;quitting=true;ready=false;for(const p of children)p.kill('SIGTERM');await context?.close().catch(()=>{});server.close();setTimeout(()=>process.exit(code),1000).unref();}
let controls=Promise.resolve();
const serial=fn=>{const result=controls.then(fn);controls=result.catch(()=>{});return result;};
const server=createViewer({password,origin,ready:()=>ready,collecting:()=>!!worker&&!worker.killed,
 start:()=>serial(async()=>{
  if(worker&&!worker.killed)return;
  const processWorker=child(process.execPath,['server-collector/worker.mjs'],{stdio:['ignore','inherit','inherit'],env:{...process.env,VIEWER_PASSWORD:undefined,RENDER_EXTERNAL_URL:undefined}});
  worker=processWorker;processWorker.once('exit',()=>{if(worker===processWorker)worker=undefined;});
 }),
 stop:()=>serial(async()=>{
  if(!worker)return;const current=worker;
  await new Promise(resolve=>{let timer;current.once('exit',()=>{clearTimeout(timer);resolve();});current.kill('SIGTERM');timer=setTimeout(()=>{current.kill('SIGKILL');},5000);timer.unref();});
  if(worker===current)worker=undefined;
 })});
server.listen(Number(process.env.PORT??10000),'0.0.0.0');
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>void shutdown());
try{
 await mkdir('/var/data/tiktok-profile',{recursive:true,mode:0o700});
 const xvfb=child('Xvfb',[':99','-screen','0','1280x800x24','-nolisten','tcp']);xvfb.on('exit',()=>{if(!quitting)void shutdown(1);});
 await new Promise(resolve=>setTimeout(resolve,1500));
 child('openbox',[]);
 // Raw VNC and CDP stay loopback-only. The authenticated HTTPS gateway is the only public port.
 const vnc=child('x11vnc',['-display',':99','-localhost','-rfbport','5900','-nopw','-forever','-shared','-noxdamage']);vnc.on('exit',()=>{if(!quitting)void shutdown(1);});
 context=await chromium.launchPersistentContext('/var/data/tiktok-profile',{executablePath:'/usr/bin/chromium',headless:false,viewport:null,env:{PATH:process.env.PATH,HOME:'/home/node',DISPLAY:':99',LANG:'C.UTF-8'},args:['--remote-debugging-address=127.0.0.1','--remote-debugging-port=9222','--disable-dev-shm-usage','--no-sandbox','--window-size=1280,800']});
 context.on('close',()=>{if(!quitting)void shutdown(1);});
 const page=context.pages()[0]??await context.newPage();await page.goto('https://www.tiktok.com/tiktokstudio',{waitUntil:'domcontentloaded',timeout:45_000}).catch(()=>{});
 ready=true;console.log('MicroFlix browser ready. Open the authenticated viewer to sign in, then start the collector.');
}catch{console.error('Browser startup failed. Inspect Render resource limits and disk permissions.');await shutdown(1);}
