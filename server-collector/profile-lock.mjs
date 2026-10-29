import {readlink,unlink} from 'node:fs/promises';
import {hostname as machineHostname} from 'node:os';
import path from 'node:path';

// Only use for this service's exclusive persistent disk, never a shared profile.
export async function recoverProfileLock(profile,{hostname=machineHostname(),exclusiveDisk=false,pidAlive=pid=>{try{process.kill(pid,0);return true;}catch(error){return error.code!=='ESRCH';}}}={}){
 let target;
 try{target=await readlink(path.join(profile,'SingletonLock'));}catch(error){if(error.code==='ENOENT')return false;throw error;}
 const match=/^(.+)-(\d+)$/.exec(target);
 if(!match)throw Error('Unrecognized Chromium profile lock; refusing to remove it.');
 const [,owner,pid]=match;
 if(owner===hostname&&pidAlive(Number(pid)))throw Error('Chromium profile is already in use by a live local process.');
 if(owner!==hostname&&!exclusiveDisk)throw Error('Chromium profile belongs to another host; exclusive disk required for recovery.');
 // Chromium stores only coordination symlinks here; cookies and profile files stay intact.
 for(const name of ['SingletonSocket','SingletonCookie','SingletonLock']){
  const file=path.join(profile,name);
  try{await readlink(file);await unlink(file);}catch(error){if(error.code!=='ENOENT')throw error;}
 }
 return true;
}
