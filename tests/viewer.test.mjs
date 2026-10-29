import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import {WebSocket} from 'ws';
import {createViewer} from '../server-collector/viewer.mjs';
const origin='http://127.0.0.1:43219',password='synthetic-test-password-12345';let active=false,starts=0;const browserActions=[];
const vnc=net.createServer(socket=>socket.on('data',data=>socket.write(data)));await new Promise(r=>vnc.listen(0,'127.0.0.1',r));
const server=createViewer({password,origin,secure:false,vncPort:vnc.address().port,start:()=>{active=true;starts++;},stop:()=>{active=false;},collecting:()=>active,browserAction:async action=>browserActions.push(action)});await new Promise(r=>server.listen(0,'127.0.0.1',r));
const endpoint='http://127.0.0.1:'+server.address().port;
after(async()=>{await new Promise(r=>server.close(r));await new Promise(r=>vnc.close(r));});
const request=(route,options={})=>fetch(endpoint+route,{redirect:'manual',...options});
const logIn=async()=>{const response=await request('/login',{method:'POST',headers:{Origin:origin},body:new URLSearchParams({password})});assert.equal(response.status,303);const value=response.headers.get('set-cookie');assert.match(value,/HttpOnly/);assert.match(value,/SameSite=Strict/);return value.split(';')[0];};
test('unauthenticated visitors cannot reach browser assets or collector control',async()=>{
 assert.equal((await request('/healthz')).status,200);assert.match(await(await request('/')).text(),/server sign-in/);
 for(const path of ['/viewer.js','/status','/novnc/core/rfb.js'])assert.equal((await request(path)).status,401);
 assert.equal((await request('/start',{method:'POST',headers:{Origin:origin}})).status,401);assert.equal(starts,0);
});
test('login requires matching origin and password and bounds body size',async()=>{
 assert.equal((await request('/login',{method:'POST',body:'password='+password})).status,403);
 assert.equal((await request('/login',{method:'POST',headers:{Origin:origin},body:'password=wrong'})).status,401);
 assert.equal((await request('/login',{method:'POST',headers:{Origin:origin},body:'x'.repeat(1100)})).status,413);
});
test('authenticated control is same-origin, status reports actual state, CDP is not exposed',async()=>{
 const cookie=await logIn();
 assert.equal((await request('/start',{method:'POST',headers:{Cookie:cookie,Origin:'https://evil.test'}})).status,403);
 assert.equal((await request('/start',{method:'POST',headers:{Cookie:cookie,Origin:origin}})).status,200);
 assert.equal((await(await request('/status',{headers:{Cookie:cookie}})).json()).collecting,true);
 assert.equal((await request('/json/version',{headers:{Cookie:cookie}})).status,404);
 assert.equal((await request('/novnc/%2e%2e%2fpackage.json',{headers:{Cookie:cookie}})).status,404);
 const script=await request('/viewer.js',{headers:{Cookie:cookie}});assert.equal(script.status,200);assert.match(script.headers.get('content-type'),/javascript/);
 assert.equal((await request('/stop',{method:'POST',headers:{Cookie:cookie,Origin:origin}})).status,200);assert.equal(active,false);
 await request('/logout',{method:'POST',headers:{Cookie:cookie,Origin:origin}});assert.equal((await request('/status',{headers:{Cookie:cookie}})).status,401);
});
test('mobile browser controls require authentication and origin, reject unknown actions and pause during collection',async()=>{
 assert.equal((await request('/browser/scroll-down',{method:'POST',headers:{Origin:origin}})).status,401);
 const cookie=await logIn(),headers={Cookie:cookie,Origin:origin};
 assert.equal((await request('/browser/scroll-down',{method:'POST',headers:{...headers,Origin:'https://evil.test'}})).status,403);
 assert.equal((await request('/browser/arbitrary-url',{method:'POST',headers})).status,404);
 for(const action of ['scroll-up','scroll-down','back','reload','login'])assert.equal((await request('/browser/'+action,{method:'POST',headers})).status,200);
 assert.deepEqual(browserActions,['scroll-up','scroll-down','back','reload','login']);
 await request('/start',{method:'POST',headers});
 assert.equal((await request('/browser/scroll-down',{method:'POST',headers})).status,409);
 assert.equal(browserActions.length,5);
 await request('/stop',{method:'POST',headers});
});
test('browser websocket requires both a session and matching origin, then relays RFB bytes',async()=>{
 const address=endpoint.replace('http:','ws:')+'/websockify';
 await new Promise(resolve=>{const socket=new WebSocket(address,{origin});socket.on('unexpected-response',(_,res)=>{assert.equal(res.statusCode,401);res.resume();socket.terminate();resolve();});socket.on('error',()=>{});});
 const cookie=await logIn();
 await new Promise(resolve=>{const socket=new WebSocket(address,{origin:'https://evil.test',headers:{Cookie:cookie}});socket.on('unexpected-response',(_,res)=>{assert.equal(res.statusCode,401);res.resume();socket.terminate();resolve();});socket.on('error',()=>{});});
 const socket=new WebSocket(address,{origin,headers:{Cookie:cookie}});await new Promise(r=>socket.once('open',r));
 const message=new Promise(r=>socket.once('message',r));socket.send(Buffer.from('RFB fixture'));assert.equal((await message).toString(),'RFB fixture');
 const closed=new Promise(r=>socket.once('close',r));await request('/logout',{method:'POST',headers:{Cookie:cookie,Origin:origin}});await closed;
});
test('repeated wrong passwords are rate limited',async()=>{
 for(let i=0;i<8;i++)await request('/login',{method:'POST',headers:{Origin:origin},body:'password=wrong'});
 assert.equal((await request('/login',{method:'POST',headers:{Origin:origin},body:'password=wrong'})).status,429);
});
