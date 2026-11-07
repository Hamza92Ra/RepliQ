// Optional offline Lua-source checks. The free interpreter is installed outside
// the repository. Redis commands are an in-memory fake: no external data used.
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import { LEAD_ADMISSION_LUA, LEAD_COMPLETE_LUA } from '../lib/lead-abuse.js';
if(!process.argv[2]) throw new Error('Usage: node scripts/verify-lead-lua.mjs <external tools directory>');
const require=createRequire(join(resolve(process.argv[2]),'verify.cjs'));
const {lua,lauxlib,lualib,to_luastring}=require('fengari');
const source=`
local data,expires={},{}
local now=0
local passed=0
local function lookup(key)
 if expires[key] and expires[key]<=now then data[key]=nil;expires[key]=nil end
 return data[key]
end
redis={}
function redis.call(command,key,value,unit,seconds)
 local current=lookup(key)
 if command=='TYPE' then return {ok=current==nil and 'none' or type(current)=='string' and 'string' or 'list'} end
 if command=='GET' then return current or false end
 if command=='TTL' then if current==nil then return -2 end return expires[key] and math.ceil(expires[key]-now) or -1 end
 if command=='SET' then data[key]=tostring(value); if unit=='EX' then expires[key]=now+tonumber(seconds) end; return 'OK' end
 if command=='EXPIRE' then expires[key]=now+tonumber(value);return 1 end
 if command=='INCR' then
  local number=tonumber(current or '0');assert(number and number==math.floor(number),'invalid integer')
  data[key]=tostring(number+1);return number+1
 end
 error('unexpected mock Redis command')
end
local function admission(keys,args)
 KEYS=keys;ARGV=args
 return (function() ${LEAD_ADMISSION_LUA} end)()
end
local function complete(key,nonce,reference)
 KEYS={key};ARGV={nonce,reference}
 return (function() ${LEAD_COMPLETE_LUA} end)()
end
local function reset() data={};expires={};now=0 end
local function keys(duplicate,phone,email,ip) return {'global',ip or 'ip',phone or 'phone',email or 'email',duplicate or 'duplicate'} end
local function args(nonce) return {100,600,10,600,3,3600,5,3600,nonce or 'pending:fixture'} end
local function test(name,fn) fn();passed=passed+1 end

test('fresh admission reserves once with TTLs',function()
 reset();assert(admission(keys(),args())[1]==201)
 assert(data.global=='1' and data.ip=='1' and data.phone=='1' and data.email=='1')
 assert(data.duplicate=='pending:fixture' and expires.duplicate==900 and expires.phone==3600)
end)
test('pending retry does not consume recipient counters',function()
 local result=admission(keys(),args('other'))
 assert(result[1]==409 and result[2]==900 and data.phone=='1' and data.global=='2')
end)
test('completion requires the exact reservation nonce',function()
 assert(complete('duplicate','wrong','fixture-ref')==0)
 assert(complete('duplicate','pending:fixture','fixture-ref')==1)
end)
test('completed retry preserves reference and recipient counters',function()
 local result=admission(keys(),args())
 assert(result[1]==200 and result[3]=='fixture-ref' and data.phone=='1')
end)
test('recipient exhaustion cannot be bypassed with new IP/email/duplicate',function()
 assert(admission(keys('second','phone','other','ip2'),args())[1]==201)
 assert(admission(keys('third','phone','other2','ip3'),args())[1]==201)
 local result=admission(keys('fourth','phone','other3','ip4'),args())
 assert(result[1]==429 and result[2]==3600 and not data.fourth)
end)
test('email exhaustion survives rotated recipients/IPs',function()
 reset();for i=1,5 do assert(admission(keys('d'..i,'p'..i,'email','ip'..i),args())[1]==201) end
 assert(admission(keys('sixth','p6','email','ip6'),args())[1]==429)
end)
test('IP budget is bounded',function()
 reset();data.ip='10';expires.ip=600;assert(admission(keys(),args())[1]==429 and not data.duplicate)
end)
test('global circuit budget is bounded',function()
 reset();data.global='100';expires.global=600;assert(admission(keys(),args())[1]==429 and not data.duplicate)
end)
test('expiry resets technical windows',function()
 reset();assert(admission(keys(),args())[1]==201);now=3601;assert(admission(keys(),args('pending:new'))[1]==201);assert(data.phone=='1')
end)
test('stale completion cannot replace a newer reservation',function()
 assert(complete('duplicate','pending:fixture','old-ref')==0);assert(data.duplicate=='pending:new')
end)
test('wrong key types fail closed before any increment',function()
 reset();data.phone={};assert(admission(keys(),args())[1]==503 and not data.global and not data.duplicate)
end)
test('invalid numeric counter fails without accepting a request',function()
 reset();data.global='not-a-number';assert(admission(keys(),args())[1]==503 and not data.duplicate)
end)
assert(passed==12)
`;
const state=lauxlib.luaL_newstate();lualib.luaL_openlibs(state);
try {
 if(lauxlib.luaL_dostring(state,to_luastring(source))!==lua.LUA_OK) throw new Error(lua.lua_tojsstring(state,-1));
 console.log('12 offline Lua-source checks passed (Fengari 0.1.5 / Lua 5.3, in-memory Redis command fake).');
} finally {lua.lua_close(state);}
