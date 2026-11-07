// Synthetic Redis EVAL model only. No Redis server or external service is used.
// It models the atomic admission boundary for app/concurrency tests; it is not
// evidence that Redis executed the Lua source (reported as a validation limit).
import assert from 'node:assert/strict';
import { LEAD_ADMISSION_LUA, LEAD_COMPLETE_LUA } from '../lib/lead-abuse.js';
export function leadEval(command, store, expires = new Map(), now = Date.now()) {
 const [kind,script,count,...rest]=command;assert.equal(kind,'EVAL');
 const keys=rest.slice(0,count),args=rest.slice(count);
 for(const key of keys) if(expires.has(key) && expires.get(key)<=now){store.delete(key);expires.delete(key);}
 if(script===LEAD_COMPLETE_LUA){assert.equal(count,1);if(store.get(keys[0])!==args[0])return 0;store.set(keys[0],'done:'+args[1]);expires.set(keys[0],now+900000);return 1;}
 assert.equal(script,LEAD_ADMISSION_LUA);assert.equal(count,5);assert.equal(args.length,9);
 for(const key of keys)if(store.has(key) && typeof store.get(key)!=='string')return [503,0];
 const full=i=>Number(store.get(keys[i]) || 0)>=Number(args[i*2]);
 const ttl=i=>Math.max(1,Math.ceil(((expires.get(keys[i]) || now+1000)-now)/1000));
 const increment=i=>{const first=!store.has(keys[i]);store.set(keys[i],String(Number(store.get(keys[i]) || 0)+1));if(first)expires.set(keys[i],now+Number(args[i*2+1])*1000);};
 for(const i of [0,1])if(full(i))return [429,ttl(i)];
 for(const i of [0,1])increment(i);
 const state=store.get(keys[4]);if(state?.startsWith('done:'))return [200,0,state.slice(5)];if(state)return [409,ttl(4)];
 for(const i of [2,3])if(full(i))return [429,ttl(i)];
 for(const i of [2,3])increment(i);
 store.set(keys[4],args[8]);expires.set(keys[4],now+900000);return [201,0];
}
