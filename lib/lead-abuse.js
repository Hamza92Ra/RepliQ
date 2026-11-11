import { supabasePrimaryEnabled } from './storage-backend.js';
import { getSupabaseAdmin } from './supabase.js';
import { createHmac, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
import { resolveWhatsAppCredentials } from './whatsapp-credentials.js';
import { leadError } from './lead-validation.js';
// Backpressure reserves space for the inquiry and its optional acknowledgement.
export const MAX_PUBLIC_CONVERSATION_ROWS = 98;
export const LEAD_LIMITS=Object.freeze([[100,600],[10,600],[3,3600],[5,3600]].map(Object.freeze));
export const LEAD_ADMISSION_LUA=`-- repliq-lead-admission-v1
for i=1,5 do
 local t=redis.call('TYPE',KEYS[i]).ok
 if t~='none' and t~='string' then return {503,0} end
end
for i=1,2 do
 local n=tonumber(redis.call('GET',KEYS[i]) or '0')
 if not n then return {503,0} end
 if n>=tonumber(ARGV[i*2-1]) then return {429,math.max(1,redis.call('TTL',KEYS[i]))} end
end
for i=1,2 do
 if redis.call('INCR',KEYS[i])==1 then redis.call('EXPIRE',KEYS[i],ARGV[i*2]) end
end
local state=redis.call('GET',KEYS[5])
if state and string.sub(state,1,5)=='done:' then return {200,0,string.sub(state,6)} end
if state then return {409,math.max(1,redis.call('TTL',KEYS[5]))} end
for i=3,4 do
 local n=tonumber(redis.call('GET',KEYS[i]) or '0')
 if not n then return {503,0} end
 if n>=tonumber(ARGV[i*2-1]) then return {429,math.max(1,redis.call('TTL',KEYS[i]))} end
end
for i=3,4 do
 if redis.call('INCR',KEYS[i])==1 then redis.call('EXPIRE',KEYS[i],ARGV[i*2]) end
end
redis.call('SET',KEYS[5],ARGV[9],'EX',900)
return {201,0}`;
export const LEAD_COMPLETE_LUA=`-- repliq-lead-complete-v1
if redis.call('GET',KEYS[1])~=ARGV[1] then return 0 end
redis.call('SET',KEYS[1],'done:'..ARGV[2],'EX',900)
return 1`;
export async function leadRedis(commands) {
 const base=process.env.UPSTASH_REDIS_REST_URL, token=process.env.UPSTASH_REDIS_REST_TOKEN;
 if(!base || !token) throw leadError(503);
 try {
  const result=await fetch(`${base.replace(/\/$/,'')}/pipeline`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(commands),signal:AbortSignal.timeout(3000)});
  if(!result.ok) throw leadError(503);
  const data=await result.json();
  if(!Array.isArray(data) || data.length!==commands.length || data.some(item=>!item || item.error || !Object.hasOwn(item,'result'))) throw leadError(503);
  return data.map(item=>item.result);
 }catch {throw leadError(503);}
}
function clientAddress(req) {
 // Vercel overwrites x-forwarded-for. Outside that platform, trust only the
 // socket; missing/invalid addresses share a restrictive bucket, never bypass.
 const forwarded=process.env.VERCEL==='1' ? req.headers?.['x-forwarded-for'] : null;
 const address=typeof forwarded==='string'?forwarded.split(',')[0].trim():req.socket?.remoteAddress;
 if(!isIP(address || '')) return 'unknown';
 return address.includes(':')?new URL(`http://[${address}]/`).hostname.toLowerCase():address;
}
/**
 * Atomic Supabase public lead admission, including durable deduplication and
 * rate limits. Service role only. No Redis, no cross-tenant ownership guesses.
 * Public lead submissions are stored separately from WhatsApp conversations.
 */
export async function admitSupabaseLead(req,body) {
 let number;
 try { number = resolveWhatsAppCredentials(undefined,{requireToken:false}).phoneNumberId; }
 catch { throw leadError(503); }
 // Never use an attacker-supplied string or a publicly known key for hashes.
 const secret = process.env.REPLIQ_LEAD_HASH_SECRET || process.env.DASHBOARD_SECRET;
 if (!secret || secret.length < 16) throw leadError(503);
 const hash = value => createHmac('sha256',secret).update(value).digest('hex');
 const phone = body.phone.replace(/^\+/,'');
 const fingerprint = hash(JSON.stringify([body.fullname,body.business,body.activity,phone,
   body.email.toLowerCase(),body.offer,body.offer==="RepliQ Pro"?"monthly":body.mode,
   body.offer==="RepliQ Pro"?"":body.price,body.intent,body.message,body.volume,body.acceptedTerms]));
 let result;
 try {
   const { data, error } = await getSupabaseAdmin().rpc('admit_repliq_lead', {
     p_business_phone_number_id: number,
     p_ip_hash: hash(clientAddress(req)),
     p_phone_hash: hash(phone),
     p_email_hash: hash(body.email.toLowerCase() || phone),
     p_fingerprint: fingerprint,
     p_reference: body.ref,
     p_payload: body,
   });
   if (error) throw error;
   result = data;
 } catch {
   console.error('lead-abuse.js: Supabase lead admission unavailable');
   throw leadError(503);
 }
 if (!result || ![200,201,429].includes(result.status)) throw leadError(503);
 if (result.status === 429)
   throw Object.assign(leadError(429),{retryAfter:Math.min(3600,Math.max(1,Number(result.retryAfter)||3600))});
 if (typeof result.reference !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(result.reference)) throw leadError(503);
 return {
   duplicate: result.status === 200,
   reference: result.reference,
   // Automatic WA acknowledgement remains off until a validated ownership
   // mapping exists for this contact; never rely on a default business owner.
   acknowledge: false,
   // Admission transaction already stored the request durably.
   complete: async () => {},
 };
}
export async function admitLead(req,body) {
 if (supabasePrimaryEnabled()) return admitSupabaseLead(req,body);
 let number;
 try{number=resolveWhatsAppCredentials(undefined,{requireToken:false}).phoneNumberId;}catch{throw leadError(503);}
 const secret=process.env.UPSTASH_REDIS_REST_TOKEN;if(!secret) throw leadError(503);
 const hash=value=>createHmac('sha256',secret).update(value).digest('hex');
 const scope=`repliq:lead:v1:{${encodeURIComponent(number)}}:`;
 const phone=body.phone.replace(/^\+/,'');
 // Reference IDs and posted prices cannot defeat content deduplication.
 const fingerprint=hash(JSON.stringify([body.fullname,body.business,body.activity,phone,body.email.toLowerCase(),body.offer,body.offer==="RepliQ Pro"?"monthly":body.mode,body.offer==="RepliQ Pro"?"":body.price,body.intent,body.message,body.volume,body.acceptedTerms]));
 const keys=[scope+'global',scope+'ip:'+hash(clientAddress(req)),scope+'phone:'+hash(phone),scope+'email:'+hash(body.email.toLowerCase() || phone),scope+'duplicate:'+fingerprint];
 const nonce="pending:"+randomUUID();
 const [result]=await leadRedis([['EVAL',LEAD_ADMISSION_LUA,5,...keys,...LEAD_LIMITS.flat(),nonce]]);
 if(!Array.isArray(result) || ![2,3].includes(result.length) || ![200,201,409,429,503].includes(result[0]) || !Number.isInteger(result[1])) throw leadError(503);
 if(result[0]===200) {
  if(typeof result[2]!=="string" || !/^[A-Za-z0-9_-]{1,100}$/.test(result[2])) throw leadError(503);
  return {duplicate:true,reference:result[2]};
 }
 if(result[0]!==201) throw Object.assign(leadError(result[0]),{retryAfter:Math.min(3600,Math.max(1,result[1]))});
 // Never use legacy default-owner or BSUID-history fallback for public claims.
 const [owner,existing,count,mode,takeover]=await leadRedis([['GET',`conv:owner:${phone}`],['EXISTS',`conv:${phone}`,`conv:mode:${phone}`,`conv:takeover:${phone}`,`conv:meta:${phone}`],["LLEN",`conv:${phone}`],["GET",`conv:mode:${phone}`],["GET",`conv:takeover:${phone}`]]);
 if((owner!==null && owner!==number) || !Number.isInteger(existing) || !Number.isInteger(count) || count>=MAX_PUBLIC_CONVERSATION_ROWS || (existing>0 && owner!==number)) throw leadError(503);
 let acknowledge = mode === null || mode === 'bot';
 if(takeover!==null) {
  try { if(JSON.parse(takeover)?.human_takeover!==false) acknowledge=false; }
  catch { acknowledge=false; }
 }
 return {duplicate:false,acknowledge,complete:async()=>{
  const [ok]=await leadRedis([['EVAL',LEAD_COMPLETE_LUA,1,keys[4],nonce,body.ref]]);if(ok!==1) throw leadError(503);
 }};
}
