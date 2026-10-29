import {parseViewerText,parseOverviewText} from '../collector-extension/parser.js';
export class ReadError extends Error{constructor(reason){super(reason);this.reason=reason;}}
const blocked=/verify it.?s really you|verify your identity|verify identity|verify you are human|unusual traffic|automated traffic|security check|captcha|access denied|request blocked/i;
const unavailable=/data is being processed|not enough data|no data|check back later/i;
const wait=ms=>new Promise(r=>setTimeout(r,ms));
export function validatePage(url,text,expected){const u=new URL(url);if(u.hostname!=='www.tiktok.com')throw new ReadError('read_failed');if(u.pathname.includes('/login')||/log in to tiktok|sign in to tiktok/i.test(text))throw new ReadError('sign_in');if(blocked.test(text))throw new ReadError('verification');if(u.pathname.replace(/\/$/,'')!==expected)throw new ReadError('layout_changed');}
async function visible(page,path){const text=await page.locator('body').innerText({timeout:15_000});validatePage(page.url(),text,path);return text;}
export async function verifyAccount(page,handle,pause=wait){
 await page.goto('https://www.tiktok.com/tiktokstudio',{waitUntil:'domcontentloaded',timeout:45_000});await pause(3000);
 const text=await page.locator('body').innerText();const path=new URL(page.url()).pathname.replace(/\/$/,'');validatePage(page.url(),text,path);
 if(!path.startsWith('/tiktokstudio'))throw new ReadError('sign_in');
 // Only the Studio navigation's own profile link is accepted. Never infer ownership from arbitrary page mentions.
 const own=await page.locator('header a[href*="/@"], nav a[href*="/@"], [role="navigation"] a[href*="/@"]').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('href')));
 if(!own.some(h=>{try{return new URL(h,'https://www.tiktok.com').pathname.toLowerCase()==='/@'+handle.toLowerCase();}catch{return false;}}))throw new ReadError('account_mismatch');
}
export async function inventory(page,handle,pause=wait){
 await verifyAccount(page,handle,pause);const path='/@'+handle;
 await page.goto('https://www.tiktok.com'+path,{waitUntil:'domcontentloaded',timeout:45_000});let previous='',stable=0;const ids=new Set();
 for(let i=0;i<60;i++){
  await pause(2000);await visible(page,path);
  const links=await page.locator('a[href*="/video/"]').evaluateAll(nodes=>nodes.map(n=>n.getAttribute('href')));
  for(const href of links){const u=new URL(href,'https://www.tiktok.com'),match=u.pathname.match(/^\/@([^/]+)\/video\/(\d{15,25})$/);if(u.hostname==='www.tiktok.com'&&match?.[1].toLowerCase()===handle.toLowerCase())ids.add(match[2]);}
  const signature=[...ids].join(',');stable=signature===previous?stable+1:0;previous=signature;
  if(stable>=4&&ids.size)return [...ids];
  if(ids.size>5000)throw new ReadError('layout_changed');
  await page.evaluate(()=>window.scrollTo(0,document.body.scrollHeight));
 }
 throw new ReadError('layout_changed');
}
export async function collect(page,id,handle,pause=wait){
 await verifyAccount(page,handle,pause);const path='/tiktokstudio/analytics/'+id;
 await page.goto('https://www.tiktok.com'+path,{waitUntil:'domcontentloaded',timeout:45_000});let title,publishedAt,overview,signature='',stable=0;
 for(let i=0;i<30;i++){
  await pause(1000);const text=await visible(page,path),at=text.indexOf('Posted on');if(at<0)continue;
  const before=text.slice(0,at).split('\n').map(s=>s.trim()).filter(Boolean).filter(s=>!['Overview','Viewers','Engagement','Updated in real time.'].includes(s));
  title=before.at(-1)?.slice(0,1000);publishedAt=text.slice(at).match(/^Posted on\s*([^\n]+)/)?.[1]??null;
  overview=parseOverviewText(text);const current=JSON.stringify({...overview,capturedAt:''});stable=current===signature?stable+1:0;signature=current;
  const complete=['videoViews','totalPlayTime','averageWatchTime','watchedFullVideo','newFollowers'].every(k=>overview[k]!==null);
  if(stable>=2&&(complete||i>=10&&unavailable.test(text)))break;
  overview=null;
 }
 if(!title||!overview)throw new ReadError('layout_changed');
 await page.goto('https://www.tiktok.com'+path+'/viewers',{waitUntil:'domcontentloaded',timeout:45_000});signature='';stable=0;let parsed;
 for(let i=0;i<35;i++){
  await pause(1000);const text=await visible(page,path+'/viewers'),value=parseViewerText(text),current=JSON.stringify(value);stable=current===signature?stable+1:0;signature=current;
  const complete=Object.keys(value.age).length===5&&Object.keys(value.gender).length>=2&&Object.keys(value.countries).length>0;
  if(stable>=3&&(complete||i>=15&&unavailable.test(text))){parsed=value;break;}
 }
 if(!parsed)throw new ReadError('layout_changed');
 return {videoId:id,title,publishedAt,observedAt:new Date().toISOString(),...parsed,overview,notes:'Read from visible English TikTok Studio pages by your authorized server browser. Missing metrics remain unavailable.'};
}
