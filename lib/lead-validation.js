import { PUBLIC_OFFER } from "../public-offer.js";
export const MAX_LEAD_BYTES = 16 * 1024;
export function leadError(status) { return Object.assign(new Error("Lead request rejected"), { status }); }
const allowed = new Set(["fullname","business","activity","phone","email","offer","mode","price","message","ref","volume","acceptedTerms","intent","setup","monthly","annual","website"]);
function text(value, max, required = false, multiline = false) {
  if (value === undefined || value === null) { if (required) throw leadError(400); return ""; }
  if (typeof value !== "string" || value.length > max) throw leadError(400);
  const result = value.normalize("NFC").trim();
  if ((required && !result) || (multiline ? /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/ : /[\x00-\x1f\x7f]/).test(result) || /<\/?[a-z!][^>]*>/i.test(result)) throw leadError(400);
  return result.replace(/\r\n?/g,"\n");
}
export function validateLead(body) {
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => !allowed.has(key))) throw leadError(400);
  const offer = text(body.offer,40);
  const pro = offer === PUBLIC_OFFER.name;
  if (!pro && !["", "Essai gratuit","Essentielle","Standard","Premium"].includes(offer)) throw leadError(400);
  const fullname=text(body.fullname,120,true), business=text(body.business,160,true);
  const activity=text(body.activity,160,pro);
  if (pro && !["Yacht charter","Boat charter","Boat tour / private cruise","Other charter or marine service","Other business"].includes(activity)) throw leadError(400);
  let phone=text(body.phone,40,true);
  if (!/^(?:\+|00)?[\d\s().-]+$/.test(phone)) throw leadError(400);
  if (pro && !/^(?:\+|00)/.test(phone)) throw leadError(400);
  phone=phone.replace(/\D/g,"");
  if (phone.startsWith("00")) phone=phone.slice(2);
  else if (!pro && phone.startsWith("0") && phone.length===10) phone="212"+phone.slice(1);
  if (!/^[1-9]\d{6,14}$/.test(phone)) throw leadError(400);
  const email=text(body.email,254,pro);
  if (email && (!/^[A-Za-z0-9.!#$%&'*+\/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,63}$/.test(email) || email.split('@')[0].length>64 || email.includes('..'))) throw leadError(400);
  if(email) {
    const [local,domain]=email.split('@');
    if(local.startsWith('.') || local.endsWith('.') || domain.split('.').some(label=>!/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(label))) throw leadError(400);
  }
  const message=text(body.message,3000,false,true), ref=text(body.ref,100);
  if (ref && !/^[A-Za-z0-9_-]+$/.test(ref)) throw leadError(400);
  let volume=body.volume;
  if (volume===undefined || volume===null || volume==='') volume='';
  else {
    if (!['number','string'].includes(typeof volume) || !/^\d{1,7}$/.test(String(volume)) || !Number.isSafeInteger(Number(volume)) || Number(volume)>1000000) throw leadError(400);
    volume=String(Number(volume));
  }
  if (body.acceptedTerms!==undefined && typeof body.acceptedTerms!=="boolean") throw leadError(400);
  if (pro && body.acceptedTerms!==true) throw leadError(400);
  const intent=text(body.intent,10) || 'setup'; if(!['demo','setup'].includes(intent)) throw leadError(400);
  const mode=text(body.mode,10) || 'monthly'; if(!['monthly','annual','unique'].includes(mode)) throw leadError(400);
  const price=text(body.price,160);
  for(const field of ['setup','monthly','annual']) if(body[field]!==undefined && body[field]!==null && (typeof body[field]!=="number" || !Number.isFinite(body[field]) || body[field]<0 || body[field]>1e9)) throw leadError(400);
  if(text(body.website,256)) throw leadError(400);
  return { fullname,business,activity,phone:pro?`+${phone}`:phone,email,offer,mode,price,message,ref,volume,acceptedTerms:body.acceptedTerms===true,intent };
}
export async function readLeadBody(req) {
  const headers=req.headers || {};
  const type=headers['content-type'];
  if (type && (typeof type!=="string" || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(type))) throw leadError(415);
  if (headers['content-encoding'] && headers['content-encoding']!=='identity') throw leadError(415);
  const length=headers['content-length'];
  if(length!==undefined && (typeof length!=="string" || !/^\d+$/.test(length))) throw leadError(400);
  if(length && Number(length)>MAX_LEAD_BYTES) throw leadError(413);
  let raw;
  if(Buffer.isBuffer(req.rawBody)) raw=req.rawBody;
  else if(typeof req.on==='function') {
    if(!type) throw leadError(415);
    raw=await new Promise((resolve,reject)=>{
      let size=0;const chunks=[];
      const cleanup=()=>{req.removeListener('data',data);req.removeListener('end',end);req.removeListener('error',fail);req.removeListener('aborted',fail);};
      const fail=()=>{cleanup();reject(leadError(400));};
      const data=chunk=>{const bytes=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);size+=bytes.length;if(size>MAX_LEAD_BYTES){cleanup();req.resume();reject(leadError(413));}else chunks.push(bytes);};
      const end=()=>{cleanup();resolve(Buffer.concat(chunks));};
      req.on('data',data);req.on('end',end);req.on('error',fail);req.on('aborted',fail);
    });
  } else {
    try { raw=Buffer.from(JSON.stringify(req.body)); } catch { throw leadError(400); }
  }
  if(raw.length>MAX_LEAD_BYTES) throw leadError(413);
  try {return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}catch {throw leadError(400);}
}
