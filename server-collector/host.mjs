import {spawn} from 'node:child_process';
import {mkdir} from 'node:fs/promises';
import {chromium} from 'playwright-core';
import {createViewer} from './viewer.mjs';
import {recoverProfileLock} from './profile-lock.mjs';
const password=process.env.VIEWER_PASSWORD,token=process.env.MICROFLIX_WORKER_TOKEN,origin=process.env.RENDER_EXTERNAL_URL;
if(!origin?.startsWith('https://')||!password||password.length<20||!/^mfs_[a-f0-9]{64}$/.test(token??''))throw Error('Set VIEWER_PASSWORD (20+ characters), MICROFLIX_WORKER_TOKEN and deploy as a Render web service.');
process.env.BROWSER_CDP_URL='http://127.0.0.1:9222';
const children=[];let context,worker,ready=false,quitting=false;
function child(command,args,options={}){const p=spawn(command,args,{stdio:['ignore','ignore','inherit'],...options});children.push(p);p.on('error',()=>shutdown(1));return p;}
async function shutdown(code=0){if(quitting)return;quitting=true;ready=false;for(const p of children)p.kill('SIGTERM');await context?.close().catch(()=>{});server.close();setTimeout(()=>process.exit(code),1000).unref();}
let controls=Promise.resolve();
const serial=fn=>{const result=controls.then(fn);controls=result.catch(()=>{});return result;};
const server=createViewer({password,origin,ready:()=>ready,collecting:()=>!!worker&&!worker.killed,
 start:()=>serial(async()=>{
  if(worker&&!worker.killed)return;
  const processWorker=child(process.execPath,['server-collector/worker.mjs'],{stdio:['ignore','inherit','inherit'],env:{...process.env,VIEWER_PASSWORD:undefined,RENDER_EXTERNAL_URL:undefined}});
  worker=processWorker;processWorker.once('exit',()=>{if(worker===processWorker)worker=undefined;});
 }),
 browserAction:action=>serial(async()=>{
  if(worker&&!worker.killed)throw Error('Collector must be stopped before browser interaction.');
  const pages=context.pages();const page=pages[pages.length-1];if(!page)throw Error('Browser page unavailable.');
  if(action==='login')await page.goto('https://www.tiktok.com/login',{waitUntil:'domcontentloaded',timeout:30000});
  else if(action==='back')await page.goBack({waitUntil:'domcontentloaded',timeout:30000});
  else if(action==='reload')await page.reload({waitUntil:'domcontentloaded',timeout:30000});
  else{const size=await page.evaluate(()=>({width:innerWidth,height:innerHeight}));await page.mouse.move(size.width/2,size.height/2);await page.mouse.wheel(0,action==='scroll-up'?-400:400);}
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
 // Render mounts this single-instance service's disk exclusively after stopping the old instance.
 if(await recoverProfileLock('/var/data/tiktok-profile',{exclusiveDisk:true}))console.log('Recovered stale Chromium coordination lock; saved browser profile preserved.');
 const xvfb=child('Xvfb',[':99','-screen','0','1280x800x24','-nolisten','tcp']);xvfb.on('exit',()=>{if(!quitting)void shutdown(1);});
 await new Promise(resolve=>setTimeout(resolve,1500));
 child('openbox',[]);
 // Raw VNC and CDP stay loopback-only. The authenticated HTTPS gateway is the only public port.
 const vnc=child('x11vnc',['-display',':99','-localhost','-rfbport','5900','-nopw','-forever','-shared','-noxdamage','-clip','540x800+0+0']);vnc.on('exit',()=>{if(!quitting)void shutdown(1);});
 context=await chromium.launchPersistentContext('/var/data/tiktok-profile',{executablePath:'/usr/bin/chromium',headless:false,viewport:null,env:{PATH:process.env.PATH,HOME:'/home/node',DISPLAY:':99',LANG:'C.UTF-8'},args:['--remote-debugging-address=127.0.0.1','--remote-debugging-port=9222','--disable-dev-shm-usage','--no-sandbox','--window-size=540,800','--window-position=0,0']});
 context.on('close',()=>{if(!quitting)void shutdown(1);});
 const page=context.pages()[0]??await context.newPage();
 const windowSession=await context.newCDPSession(page);
 const {windowId}=await windowSession.send('Browser.getWindowForTarget');
 await windowSession.send('Browser.setWindowBounds',{windowId,bounds:{windowState:'normal'}});
 await windowSession.send('Browser.setWindowBounds',{windowId,bounds:{left:0,top:0,width:540,height:800}});
 await windowSession.detach();
 await page.goto('https://www.tiktok.com/tiktokstudio',{waitUntil:'domcontentloaded',timeout:45_000}).catch(()=>{});
 ready=true;console.log('MicroFlix browser ready. Open the authenticated viewer to sign in, then start the collector.');
}catch(error){
 let detail=String(error?.message??error);
 for(const secret of [password,token])if(secret)detail=detail.split(secret).join('[redacted]');
 console.error('Browser startup failed:',detail.slice(0,12000));await shutdown(1);
}
