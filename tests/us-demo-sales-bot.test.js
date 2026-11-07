import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import webhook from '../api/webhook.js';
import conversation from '../api/conversation.js';
import { DEFAULT_SYSTEM_PROMPT } from '../lib/ai.js';
import { buildUsSalesPrompt } from '../lib/us-sales-prompt.js';
import { buildUsSalesPromptDraft } from '../lib/foundation/us-sales-prompt-draft.js';
import { resolveBusinessPrompt, assertDemoInboundScope } from '../lib/business-prompt.js';
const NUMBER = '1001', CUSTOMER = '15555550123', SECRET = 'synthetic-meta-secret';
const binding = () => ({ purpose: 'repliq-us-demo-sales', phoneNumberId: NUMBER, promptVersion: 'repliq-pro-us-sales-v1', ownershipReview: 'synthetic-ownership-review', isolationReview: 'synthetic-isolation-review', storageMode: 'isolated-redis-only' });
const approvedReply = 'RepliQ Pro: $99/month + $99 one-time setup. English, Spanish, French. Intended 1,000 outbound replies/billing period and 12 AI replies/customer/rolling 24 hours; not enforced. Request a demo; no booking or payment confirmed.';
const symbol = Symbol.for('@vercel/request-context');
let originalEnv, originalFetch, originalContext, calls, store, pending, configUnavailable, aiFails, sequence = 0;
function enable(value = binding()) { process.env.REPLIQ_US_DEMO_SALES_ENABLED = 'true'; process.env.REPLIQ_US_DEMO_SALES_BINDING = JSON.stringify(value); }
function event({ number = NUMBER, audio = false, ...extra } = {}) {
  return { object: 'whatsapp_business_account', ...extra, entry: [{ changes: [{ value: {
    metadata: number === null ? {} : { phone_number_id: number, display_phone_number: '+13055550123', offer: 'RepliQ Pro' },
    messages: [{ id: `synthetic-us-demo-${++sequence}`, from: CUSTOMER, timestamp: String(Math.floor(Date.now()/1000)), type: audio ? 'audio' : 'text', ...(audio ? { audio: { id: 'synthetic-audio' } } : { text: { body: 'What does your service cost?' } }) }],
  } }] }] };
}
async function invoke(handler, payload = event(), { signed = true, query = {} } = {}) {
  const rawBody = Buffer.from(JSON.stringify(payload));
  const headers = signed ? { 'x-hub-signature-256': 'sha256=' + createHmac('sha256', SECRET).update(rawBody).digest('hex') } : {};
  const res = { code: 200, headersSent: false, status(code) { this.code = code; return this; }, send(body) { this.body = body; this.headersSent = true; return this; }, json(body) { return this.send(body); } };
  await handler({ method: 'POST', query, rawBody, headers }, res);
  await Promise.all(pending); await new Promise(resolve => setImmediate(resolve));
  return res;
}
const chats = () => calls.filter(call => call.url.includes('/chat/completions') || call.url.includes('generativelanguage'));
const pipelines = () => calls.filter(call => call.url.endsWith('/pipeline')).flatMap(call => JSON.parse(call.options.body));
const outbound = () => calls.filter(call => call.url.includes('graph.facebook.com') && call.options.body && JSON.parse(call.options.body).type === 'text');

beforeEach(() => {
  originalEnv = { ...process.env }; originalFetch = globalThis.fetch; originalContext = globalThis[symbol];
  process.env = { META_APP_SECRET: SECRET, WHATSAPP_TOKEN: 'synthetic-token', WHATSAPP_PHONE_NUMBER_ID: NUMBER, DEFAULT_PHONE_NUMBER_ID: NUMBER, GROQ_API_KEY: 'synthetic-ai-key', PRIMARY_AI_PROVIDER: 'groq', UPSTASH_REDIS_REST_URL: 'https://redis.fixture.invalid', UPSTASH_REDIS_REST_TOKEN: 'synthetic-redis' };
  calls = []; store = new Map(); pending = []; configUnavailable = false; aiFails = false;
  globalThis[symbol] = { get: () => ({ waitUntil: promise => pending.push(promise) }) };
  globalThis.fetch = async (url, options = {}) => {
    url = String(url); calls.push({ url, options });
    if (url === 'https://redis.fixture.invalid/pipeline') {
      return Response.json(JSON.parse(options.body).map(([command, key, ...args]) => {
        if (command === 'GET') {
          if (configUnavailable && key.startsWith('business:')) return { error: 'synthetic unavailable' };
          return { result: store.get(key) ?? null };
        }
        if (command === 'EXISTS') return { result: [key, ...args].filter(key => store.has(key)).length };
        if (command === 'SET') { if (args.includes('NX') && store.has(key)) return { result: null }; store.set(key, args[0]); return { result: 'OK' }; }
        if (command === 'RPUSH') { store.set(key, [...(store.get(key) || []), ...args]); return { result: args.length }; }
        if (command === 'LRANGE') return { result: store.get(key) || [] };
        if (command === 'DEL') { for (const k of [key, ...args]) store.delete(k); return { result: 1 }; }
        return { result: 1 };
      }));
    }
    if (url.includes('api.groq.com')) {
      if (url.includes('/transcriptions')) return Response.json({ text: 'What does RepliQ cost?' });
      if (aiFails) return Response.json({ error: { message: 'synthetic denied' } }, { status: 401 });
      return Response.json({ choices: [{ message: { content: approvedReply }, finish_reason: 'stop' }] });
    }
    if (url.includes('generativelanguage.googleapis.com')) return Response.json({ candidates: [{ content: { parts: [{ text: approvedReply }] } }] });
    if (url.includes('graph.facebook.com')) return options.body ? Response.json({ messages: [{ id: 'synthetic-outbound' }] }) : Response.json({ url: 'https://media.fixture.invalid/audio' });
    if (url === 'https://media.fixture.invalid/audio') return new Response(new Uint8Array([1,2,3]));
    throw new Error('Unexpected external request');
  };
});
afterEach(async () => { await Promise.all(pending); process.env = originalEnv; globalThis.fetch = originalFetch; if (originalContext === undefined) delete globalThis[symbol]; else globalThis[symbol] = originalContext; });

it('uses exactly the reviewed draft text with explicit intended/unforced USD terms', () => {
  assert.equal(buildUsSalesPrompt(), buildUsSalesPromptDraft().systemPrompt);
  assert.match(buildUsSalesPrompt(), /\$99\/month \+ \$99 one-time setup fee \(USD\)/);
  assert.match(buildUsSalesPrompt(), /English, Spanish, French/);
  assert.match(buildUsSalesPrompt(), /1,000 outbound replies per billing period/);
  assert.match(buildUsSalesPrompt(), /12 AI replies per customer per rolling 24 hours/);
  assert.match(buildUsSalesPrompt(), /Usage caps are not enforced yet/);
  assert.match(buildUsSalesPrompt(), /not an operator's guest booking assistant/);
  assert.doesNotMatch(buildUsSalesPrompt(), /\bMAD\b|200\/month|800\/month/);
});

for (const [name, handler] of [['webhook', webhook], ['conversation', conversation]]) describe(`${name}: US demo boundary`, () => {
  it('uses only the approved US system offer for a bound authenticated fresh conversation', async () => {
    enable(); const res = await invoke(handler); assert.equal(res.code, 200);
    assert.equal(chats().length, 1); const messages = JSON.parse(chats()[0].options.body).messages;
    assert.equal(messages[0].content, buildUsSalesPrompt()); assert.equal(messages.length, 2);
    assert.equal(JSON.parse(outbound()[0].options.body).text.body, approvedReply);
    assert.equal(store.get(`conv:owner:${CUSTOMER}`), NUMBER);
    assert.equal(pipelines().some(([command, key]) => command === 'SET' && key.startsWith('business:')), false);
    assert.equal([...store.keys()].some(key => key.startsWith('rq:v2:')), false);
  });
  it('preserves business prompt and notes precedence without overwriting history or settings', async () => {
    enable(); const config = { systemPrompt: 'Fixture charter prices 800 MAD. Existing contract.', notes: 'Keep this legacy offer.', businessName: 'Fixture business' };
    store.set(`business:${NUMBER}`, JSON.stringify(config)); store.set(`conv:owner:${CUSTOMER}`, NUMBER);
    const previous = JSON.stringify({ role: 'user', content: 'Existing synthetic history', ts: Date.now()-1000 }); store.set(`conv:${CUSTOMER}`, [previous]);
    await invoke(handler);
    assert.equal(JSON.parse(chats()[0].options.body).messages[0].content, `${config.systemPrompt}\n\nNotes / idées spécifiques du projet :\n${config.notes}`);
    assert.equal(store.get(`business:${NUMBER}`), JSON.stringify(config)); assert.ok(store.get(`conv:${CUSTOMER}`).includes(previous));
  });
  it('retains the Moroccan default while inactive, regardless of browser/locale/offer hints', async () => {
    process.env.REPLIQ_US_DEMO_SALES_BINDING = JSON.stringify(binding());
    await invoke(handler, event({ offer: 'RepliQ Pro', language: 'en-US', phoneNumberId: NUMBER }), { query: { REPLIQ_US_DEMO_SALES_ENABLED: 'true', phoneNumberId: NUMBER } });
    assert.equal(JSON.parse(chats()[0].options.body).messages[0].content, DEFAULT_SYSTEM_PROMPT);
    assert.match(DEFAULT_SYSTEM_PROMPT, /MAD/);
    assert.equal(pipelines().some(([command]) => command === 'EXISTS'), false);
  });
  it('preserves inactive config-error fallback but never guesses on enabled config failure', async () => {
    configUnavailable = true; await invoke(handler);
    assert.equal(JSON.parse(chats()[0].options.body).messages[0].content, DEFAULT_SYSTEM_PROMPT);
    calls = []; enable(); await invoke(handler);
    assert.equal(chats().length, 0); assert.equal(outbound().length, 0);
  });
  it('rejects foreign numbers before configuration/history/credential fallback', async () => {
    enable(); await invoke(handler, event({ number: '2002' }));
    assert.equal(calls.length, 0);
  });
  it('does not use the configured default when authenticated number metadata is missing', async () => {
    enable(); await invoke(handler, event({ number: null })); assert.equal(calls.length, 0);
  });
  it('blocks unsigned requests before any ownership, storage or provider effect', async () => {
    enable(); const res = await invoke(handler, event(), { signed: false }); assert.equal(res.code, 401); assert.equal(calls.length, 0);
  });
  it('preserves silent human takeover including voice events', async () => {
    enable(); store.set(`conv:owner:${CUSTOMER}`, NUMBER); store.set(`conv:mode:${CUSTOMER}`, 'human');
    await invoke(handler, event({ audio: true })); assert.equal(chats().length, 0); assert.equal(outbound().length, 0);
    assert.equal(calls.some(call => call.url.includes('transcriptions')), false);
    assert.ok(store.get(`conv:${CUSTOMER}`).map(JSON.parse).some(entry => entry.role === 'user'));
  });
  it('uses the same US selection after voice transcription', async () => {
    enable(); await invoke(handler, event({ audio: true }));
    assert.ok(calls.some(call => call.url.includes('transcriptions')));
    assert.equal(JSON.parse(chats()[0].options.body).messages[0].content, buildUsSalesPrompt());
  });
  it('keeps the US system instruction on the existing Gemini fallback', async () => {
    enable(); aiFails = true; process.env.GEMINI_API_KEY = 'synthetic-gemini'; await invoke(handler);
    const fallback = chats().find(call => call.url.includes('generativelanguage'));
    assert.ok(fallback); assert.match(JSON.stringify(JSON.parse(fallback.options.body)), /RepliQ Pro/);
    assert.ok(JSON.stringify(JSON.parse(fallback.options.body)).includes('$99/month'));
    assert.equal(outbound().length, 1);
  });
  it('retains fail-safe human takeover if every AI provider is unavailable', async () => {
    enable(); aiFails = true; await invoke(handler);
    assert.equal(store.get(`conv:mode:${CUSTOMER}`), 'human');
    assert.equal(outbound().length, 1);
    assert.ok(store.get(`conv:${CUSTOMER}`).map(JSON.parse).some(entry => entry.role === 'assistant'));
  });
  for (const [label, owner, history] of [['foreign', '2002', true], ['ambiguous', null, true]]) it(`blocks ${label} legacy history before reading or rewriting it`, async () => {
    enable(); if (owner) store.set(`conv:owner:${CUSTOMER}`, owner);
    const privateHistory = JSON.stringify({ role: 'user', content: 'Foreign synthetic history' }); if (history) store.set(`conv:${CUSTOMER}`, [privateHistory]);
    await invoke(handler);
    assert.equal(chats().length, 0); assert.equal(outbound().length, 0);
    assert.equal(pipelines().some(([command]) => ['LRANGE','SET','RPUSH'].includes(command)), false);
    assert.deepEqual(store.get(`conv:${CUSTOMER}`), [privateHistory]);
  });
});

it('requires an exact enable flag, ownership/isolation review and versioned server binding', async () => {
  const context = { phoneNumberId: NUMBER, authenticatedPhoneNumberId: NUMBER };
  for (const invalid of [null, {}, { ...binding(), phoneNumberId: '2002' }, { ...binding(), ownershipReview: '' }, { ...binding(), isolationReview: '' }, { ...binding(), purpose: 'charter-guest' }, { ...binding(), promptVersion: 'unreviewed' }, { ...binding(), storageMode: 'shared' }]) {
    enable(invalid); await assert.rejects(resolveBusinessPrompt(context), /verification unavailable/);
  }
  enable(); process.env.REPLIQ_US_DEMO_SALES_BINDING = '{broken'; await assert.rejects(resolveBusinessPrompt(context));
  enable(); process.env.REPLIQ_US_DEMO_SALES_ENABLED = '1'; await assert.rejects(resolveBusinessPrompt(context));
  enable(); await assert.rejects(resolveBusinessPrompt({ ...context, authenticatedPhoneNumberId: undefined }));
  enable(); process.env.SUPABASE_URL = 'https://supabase.fixture.invalid'; await assert.rejects(resolveBusinessPrompt(context));
  delete process.env.SUPABASE_URL; enable(); process.env.WHATSAPP_PHONE_NUMBER_ID = '2002'; await assert.rejects(resolveBusinessPrompt(context));
  assert.equal(calls.length, 0);
});
it('stops on notes-only configuration rather than substituting a sales prompt', async () => {
  enable(); store.set(`business:${NUMBER}`, JSON.stringify({ notes: 'Existing business context' }));
  await assert.rejects(resolveBusinessPrompt({ phoneNumberId: NUMBER, authenticatedPhoneNumberId: NUMBER })); assert.equal(chats().length, 0);
});
it('refuses unverified BSUID alias fallback and fails closed on unavailable Redis', async () => {
  enable(); store.set('conv:owner:MA.123', NUMBER); store.set('conv:user_map:MA.123', '15555550999');
  await assert.rejects(assertDemoInboundScope({ phoneNumberId: NUMBER, authenticatedPhoneNumberId: NUMBER, identity: { primaryId: 'MA.123', userId: 'MA.123' } }));
  assert.equal(pipelines().some(([command]) => command === 'LRANGE'), false);
  globalThis.fetch = async () => { throw new Error('synthetic unavailable'); };
  await assert.rejects(assertDemoInboundScope({ phoneNumberId: NUMBER, authenticatedPhoneNumberId: NUMBER, identity: { primaryId: CUSTOMER } }));
});

it('checks canonical BSUID and phone ownership without foreign identity fallback', async () => {
  enable(); store.set('conv:owner:US.abc123', NUMBER); store.set('conv:US.abc123', ['synthetic']);
  await assertDemoInboundScope({ phoneNumberId: NUMBER, authenticatedPhoneNumberId: NUMBER, identity: { primaryId: 'US.abc123', userId: 'US.abc123' } });
  assert.equal(pipelines().some(([command]) => ['LRANGE','SET'].includes(command)), false);
  calls = []; store.set(`conv:owner:${CUSTOMER}`, '2002');
  await assert.rejects(assertDemoInboundScope({ phoneNumberId: NUMBER, authenticatedPhoneNumberId: NUMBER, identity: { primaryId: 'US.abc123', userId: 'US.abc123', phone: CUSTOMER } }));
  assert.equal(pipelines().some(([command]) => ['LRANGE','SET'].includes(command)), false);
});
