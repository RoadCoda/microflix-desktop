import http from 'node:http';
import net from 'node:net';
import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {WebSocketServer,WebSocket} from 'ws';
import {viewer,viewerJS} from './viewer-ui.mjs';
const digest=value=>createHash('sha256').update(value).digest();
const login='<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>MicroFlix server sign-in</title><style>body{background:#101820;color:#eee;font:18px system-ui;max-width:480px;margin:10vh auto;padding:24px}input,button{box-sizing:border-box;width:100%;padding:16px;margin:12px 0;font:inherit}button{background:#62d9c0;border:0;border-radius:12px}</style><h1>MicroFlix browser</h1><p>Enter the browser-viewer password configured in Render.</p><form method="post" action="/login"><label>Password<input name="password" type="password" autocomplete="current-password" required maxlength="256"></label><button>Open secure browser</button></form>';
export function createViewer({password,origin,ready=()=>true,collecting=()=>false,start=()=>{},stop=()=>{},browserAction=async()=>{},staticRoot='/usr/share/novnc',vncPort=5900,secure=true}){
 if(typeof password!=='string'||password.length<20||password.length>256)throw Error('VIEWER_PASSWORD must contain 20–256 characters.');
 const allowed=new URL(origin).origin,sessions=new Map(),attempts=new Map(),sockets=new Map();let totalFailures=0,resetAt=Date.now()+900_000;
 const cookieName=secure?'__Host-microflix_viewer':'microflix_viewer';
 const session=req=>{const raw=req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith(cookieName+'='))?.slice(cookieName.length+1);const s=raw&&sessions.get(raw);if(!s||s.expires<Date.now())return null;return {raw,...s};};
 const same=req=>req.headers.origin===allowed;
 const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','X-Frame-Options':'DENY','Content-Security-Policy':`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ${allowed.replace(/^http/,'ws')}; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`};
 const server=http.createServer(async(req,res)=>{try{
  Object.entries(headers).forEach(([k,v])=>res.setHeader(k,v));
  const url=new URL(req.url,'http://localhost');
  const send=(code,content,type='text/html; charset=utf-8')=>{res.writeHead(code,{'Content-Type':type});res.end(content);};
  if(url.pathname==='/healthz'&&req.method==='GET')return send(ready()?200:503,ready()?'ready':'starting','text/plain');
  if(req.method==='POST'&&url.pathname==='/login'){
   if(!same(req))return send(403,'Reload the sign-in page.');
   // Bound credential work and memory globally as well as per reported client IP.
   const ip=String(req.headers['x-forwarded-for']??req.socket.remoteAddress).split(',')[0].trim();const now=Date.now();
   for(const [key,item]of attempts)if(item.until<now)attempts.delete(key);
   if(now>=resetAt){totalFailures=0;resetAt=now+900_000;}if(totalFailures>=40)return send(429,'Too many attempts. Try again later.');
   const entry=attempts.get(ip)??{n:0,until:now+900_000};if(entry.n>=8||attempts.size>=1000&&!attempts.has(ip))return send(429,'Too many attempts. Try again in 15 minutes.');entry.n++;attempts.set(ip,entry);
   let body='';for await(const chunk of req){body+=chunk;if(body.length>1024)return send(413,'Request too large.');}
   if(!timingSafeEqual(digest(new URLSearchParams(body).get('password')??''),digest(password))){totalFailures++;return send(401,login);}
   attempts.delete(ip);for(const [key,item]of sessions)if(item.expires<now)sessions.delete(key);if(sessions.size>=16)return send(429,'Too many browser sessions.');
   const value=randomBytes(32).toString('hex');sessions.set(value,{expires:now+3_600_000});
   res.writeHead(303,{'Set-Cookie':cookieName+'='+value+'; HttpOnly; Path=/; SameSite=Strict; Max-Age=3600'+(secure?'; Secure':''),Location:'/'});return res.end();
  }
  const s=session(req);if(!s){if(req.method==='GET'&&url.pathname==='/')return send(200,login);return send(401,'Sign into the browser viewer.','text/plain');}
  if(req.method==='POST'){
   if(!same(req))return send(403,'Origin not allowed.');
   if(url.pathname==='/logout'){sessions.delete(s.raw);for(const ws of sockets.get(s.raw)??[])ws.close();res.writeHead(303,{'Set-Cookie':cookieName+'=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0'+(secure?'; Secure':''),Location:'/'});return res.end();}
   if(url.pathname.startsWith('/browser/')){
    const action=url.pathname.slice(9);
    if(!['scroll-up','scroll-down','back','reload','login'].includes(action))return send(404,'Unknown browser action.','text/plain');
    if(!ready())return send(503,'Browser is starting. Try again shortly.','text/plain');
    if(collecting())return send(409,'Pause the sync and stop the collector before using the browser.','text/plain');
    await browserAction(action);return send(200,'done','text/plain');
   }
   if(url.pathname==='/start'){await start();return send(200,'started','text/plain');}
   if(url.pathname==='/stop'){await stop();return send(200,'stopped','text/plain');}
   return send(404,'Not found.');
  }
  if(req.method!=='GET')return send(405,'Method not allowed.');
  if(url.pathname==='/')return send(200,viewer);
  if(url.pathname==='/status')return send(200,JSON.stringify({collecting:collecting()}),'application/json');
  if(url.pathname==='/viewer.js')return send(200,viewerJS,'text/javascript');
  if(url.pathname.startsWith('/novnc/')){
   const root=path.resolve(staticRoot),file=path.resolve(root,decodeURIComponent(url.pathname.slice(7)));
   if(!file.startsWith(root+path.sep)||!['.js','.css','.png','.svg'].includes(path.extname(file)))return send(404,'Not found.');
   const types={'.js':'text/javascript','.css':'text/css','.png':'image/png','.svg':'image/svg+xml'};return send(200,await readFile(file),types[path.extname(file)]);
  }
  return send(404,'Not found.');
 }catch{res.writeHead(500);res.end('Browser service unavailable.');}});
 const wss=new WebSocketServer({noServer:true,maxPayload:1_048_576,perMessageDeflate:false});
 server.on('upgrade',(req,socket,head)=>{
  const s=session(req);if(req.url!=='/websockify'||!same(req)||!s||!ready()||(sockets.get(s.raw)?.size??0)>=2){socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');return;}
  wss.handleUpgrade(req,socket,head,ws=>{
   const set=sockets.get(s.raw)??new Set();set.add(ws);sockets.set(s.raw,set);
   const upstream=net.createConnection({host:'127.0.0.1',port:vncPort});const expiry=setTimeout(()=>ws.close(),Math.max(0,s.expires-Date.now()));
   upstream.on('data',chunk=>{if(ws.readyState===WebSocket.OPEN){if(ws.bufferedAmount>4_194_304){upstream.destroy();ws.close();}else ws.send(chunk,{binary:true});}});
   ws.on('message',chunk=>{if(!upstream.write(chunk)){ws._socket?.pause();upstream.once('drain',()=>ws._socket?.resume());}});
   upstream.on('error',()=>ws.close());upstream.on('close',()=>ws.close());ws.on('error',()=>upstream.destroy());
   ws.on('close',()=>{clearTimeout(expiry);upstream.destroy();set.delete(ws);if(!set.size)sockets.delete(s.raw);});
  });
 });
 server.requestTimeout=10_000;server.headersTimeout=10_000;
 return server;
}
