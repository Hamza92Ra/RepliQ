import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import router from '../api/admin.js';
import dashboard from '../api/dashboard.js';
import config from '../api/business-config.js';
import orders from '../api/orders.js';
import conversation from '../api/conversation.js';
import { signAdminToken } from '../lib/admin-auth.js';
import { fixtureEnvironment, installAdminFixtures } from './admin-service-fixtures.js';
const methods = { login: ['GET','POST'], conversations: ['GET'], messages: ['GET'], read: ['POST'], send: ['POST'], takeover: ['POST'], legacy: ['POST'] };
const authKeys = ['DASHBOARD_SECRET','ADMIN_PASSWORD','ADMIN_JWT_SECRET'];
function response() { return { statusCode: 200, body: null, headers: {}, status(value) { this.statusCode=value;return this; }, json(value) { this.body=value;return this; }, send(value) { this.body=value;return this; }, setHeader(key,value) { this.headers[key]=value; } }; }
function request(endpoint, method, extra={}) { return { url:`/api/admin/${endpoint}`, method, query:{conversationId:'fixture-conversation'}, body:{ password:'dashboard-fixture', conversationId:'fixture-conversation', text:'Synthetic reply', enabled:true, phone:'15555550123', action:'human' }, headers:{}, ...extra }; }
const noInternalDetails = body => assert.doesNotMatch(JSON.stringify(body), /DASHBOARD_SECRET|ADMIN_PASSWORD|ADMIN_JWT_SECRET|SUPABASE_|WHATSAPP_|UPSTASH_|synthetic-private|fixture\.supabase|stack|\.js:\d+/i);

describe('Admin missing-secret and public-error regression', () => {
 let originalEnv, originalFetch, state;
 beforeEach(() => { originalEnv={...process.env};originalFetch=globalThis.fetch;process.env={...fixtureEnvironment};state=installAdminFixtures(); });
 afterEach(() => { process.env=originalEnv;globalThis.fetch=originalFetch; });
 for (const configured of [true,false]) for (const [endpoint,verbs] of Object.entries(methods)) for (const verb of verbs) {
  it(`${endpoint} ${verb}: unauthenticated requests get safe 401 with secrets ${configured?'configured':'absent'}`, async () => {
   if(!configured) for(const key of authKeys) delete process.env[key];
   const res=response();await router(request(endpoint,verb,endpoint==='login'&&verb==='POST'?{body:{password:'wrong-fixture'}}:{}),res);
   assert.equal(res.statusCode,401);noInternalDetails(res.body);assert.equal(state.calls.length,0);assert.equal(res.headers['Set-Cookie'],undefined);
  });
 }
 it('does not accept old bearer/cookie/query tokens or guessed dashboard keys after secrets disappear', async () => {
  const token=signAdminToken();for(const key of authKeys) delete process.env[key];
  for(const [endpoint,verbs] of Object.entries(methods)) for(const verb of verbs) for(const supplied of [
   {headers:{authorization:`Bearer ${token}`}}, {headers:{cookie:`admin_token=${token}`}}, {query:{token,key:'dashboard-fixture'}},
  ]) { const res=response();await router(request(endpoint,verb,supplied),res);assert.equal(res.statusCode,401);noInternalDetails(res.body); }
  assert.equal(state.calls.length,0);
 });
 for(const endpoint of ['conversations','messages','read','takeover','send']) for(const key of ['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY']) {
  it(`${endpoint}: authenticated missing ${key} is generic 503 before service access`, async () => {
   const token=signAdminToken();delete process.env[key];const res=response();
   await router(request(endpoint,methods[endpoint][0],{headers:{authorization:`Bearer ${token}`}}),res);
   assert.equal(res.statusCode,503);assert.deepEqual(res.body,{error:'Service unavailable'});assert.equal(state.calls.length,0);
  });
 }
 for(const missing of [['WHATSAPP_TOKEN'],['WHATSAPP_PHONE_NUMBER_ID','DEFAULT_PHONE_NUMBER_ID']]) it(`send: missing ${missing.join('/')} does not expose configuration`, async () => {
  const token=signAdminToken();for(const key of missing) delete process.env[key];const res=response();
  await router(request('send','POST',{headers:{authorization:`Bearer ${token}`}}),res);
  assert.equal(res.statusCode,503);assert.deepEqual(res.body,{error:'Service unavailable'});assert.equal(state.calls.length,0);
 });
 for(const source of authKeys) it(`preserves configured authentication using ${source}`, async () => {
  for(const key of authKeys) delete process.env[key];process.env[source]='synthetic-auth-value';
  const token=signAdminToken();
  for(const extra of [{headers:{authorization:`Bearer ${token}`}},{headers:{cookie:`admin_token=${token}`}},{query:{token}}]) {
   const res=response();await router(request('conversations','GET',extra),res);assert.equal(res.statusCode,200);
  }
  const res=response();await router(request('login','POST',{body:{password:'synthetic-auth-value'}}),res);
  assert.equal(res.statusCode,source==='ADMIN_JWT_SECRET'?401:200);
  if(source==='ADMIN_PASSWORD') { const direct=response();await router(request('conversations','GET',{headers:{authorization:'Bearer synthetic-auth-value'}}),direct);assert.equal(direct.statusCode,200); }
 });
 it('retains signing/password precedence and legacy dashboard-only authorization', async () => {
  process.env.ADMIN_PASSWORD='synthetic-password';
  const login=response();await router(request('login','POST',{body:{password:'synthetic-password'}}),login);assert.equal(login.statusCode,401);
  const good=response();await router(request('login','POST'),good);assert.equal(good.statusCode,200);
  const legacy=response();await router(request('legacy','POST',{query:{key:'dashboard-fixture'}}),legacy);assert.equal(legacy.statusCode,200);
  delete process.env.DASHBOARD_SECRET;
  const denied=response();await router(request('legacy','POST',{query:{key:'synthetic-password'}}),denied);assert.equal(denied.statusCode,401);
 });
 it('rejects malformed cookies without throwing or returning a platform error', async () => {
  for(const endpoint of ['login','conversations','messages','read','send','takeover']) {
   const res=response();await router(request(endpoint,methods[endpoint][0],{headers:{cookie:'admin_token=%E0%A4%A'}}),res);assert.equal(res.statusCode,401);noInternalDetails(res.body);
  }
  assert.equal(state.calls.length,0);
 });
 it('preserves method and unknown-route rejection with no configured secrets', async () => {
  for(const key of authKeys) delete process.env[key];
  for(const endpoint of Object.keys(methods)) {const res=response();await router(request(endpoint,'DELETE'),res);assert.equal(res.statusCode,endpoint==='login'?401:405);noInternalDetails(res.body);}
  const res=response();await router(request('unknown','GET'),res);assert.equal(res.statusCode,404);assert.equal(state.calls.length,0);
 });
 it('legacy dashboard/config/orders/conversation actions already fail closed without their shared key', async () => {
  delete process.env.DASHBOARD_SECRET;
  for(const [handler,method] of [[dashboard,'GET'],[config,'GET'],[config,'POST'],[orders,'GET'],[orders,'POST'],[conversation,'POST']]) {
   const res=response();await handler(request('unused',method),res);assert.equal(res.statusCode,401);noInternalDetails(res.body);
  }
  assert.equal(state.calls.length,0);
 });
 for(const endpoint of ['conversations','messages','read','takeover','send','legacy']) it(`${endpoint}: service exceptions cannot echo configuration or private provider text`, async () => {
  const token=signAdminToken();globalThis.fetch=async()=>{throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY synthetic-private upstream text');};
  const res=response();await router(request(endpoint,methods[endpoint][0],{headers:{authorization:`Bearer ${token}`},query:{key:'dashboard-fixture',conversationId:'fixture-conversation'},...(endpoint==='legacy'?{body:{phone:'15555550123',action:'reply',message:'Synthetic'}}:{})}),res);
  assert.ok(res.statusCode>=400);noInternalDetails(res.body);
 });
 it('legacy orders and conversation action errors do not echo exception messages', async () => {
  globalThis.fetch=async()=>{throw new Error('Missing UPSTASH_REDIS_REST_TOKEN synthetic-private');};
  for(const handler of [orders,conversation]) { const res=response();await handler(request('unused',handler===orders?'GET':'POST',{query:{key:'dashboard-fixture'},body:{phone:'15555550123',action:'reply',message:'Synthetic'}}),res);assert.ok(res.statusCode>=400);noInternalDetails(res.body); }
 });
});
