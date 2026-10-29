import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,symlink,writeFile,readFile,readlink,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {recoverProfileLock} from '../server-collector/profile-lock.mjs';
async function fixture(fn){const dir=await mkdtemp(path.join(os.tmpdir(),'mf-lock-'));try{await fn(dir);}finally{await rm(dir,{recursive:true,force:true});}}
test('exclusive Render disk recovers previous container lock without changing session data',()=>fixture(async dir=>{
 await writeFile(path.join(dir,'Cookies'),'saved-session');
 for(const [name,target]of [['SingletonLock','old-render-container-33'],['SingletonSocket','/tmp/old-socket'],['SingletonCookie','random-cookie']])await symlink(target,path.join(dir,name));
 assert.equal(await recoverProfileLock(dir,{hostname:'new-render-container',exclusiveDisk:true}),true);
 assert.equal(await readFile(path.join(dir,'Cookies'),'utf8'),'saved-session');
 await assert.rejects(readlink(path.join(dir,'SingletonLock')),{code:'ENOENT'});
 assert.equal(await recoverProfileLock(dir,{hostname:'new-render-container',exclusiveDisk:true}),false);
}));
test('live local browser and nonexclusive remote locks cannot be removed',()=>fixture(async dir=>{
 await symlink('local-33',path.join(dir,'SingletonLock'));
 await assert.rejects(recoverProfileLock(dir,{hostname:'local',exclusiveDisk:true,pidAlive:()=>true}),/live local/);
 assert.equal(await readlink(path.join(dir,'SingletonLock')),'local-33');
 await assert.rejects(recoverProfileLock(dir,{hostname:'other'}),/exclusive disk/);
 assert.equal(await recoverProfileLock(dir,{hostname:'local',pidAlive:()=>false}),true);
}));
