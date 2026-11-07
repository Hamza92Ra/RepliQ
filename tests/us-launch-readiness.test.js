import { it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildUsSalesPromptDraft } from '../lib/foundation/us-sales-prompt-draft.js';
import { DEFAULT_SYSTEM_PROMPT, generateReply, PLANS } from '../lib/ai.js';
import { getBusinessConfig } from '../lib/db.js';
import { PRICE_SUMMARY, PLAN_LIMITS, LIMITS_NOTICE } from '../public-offer.js';
const read = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');

it('keeps the canonical US sales draft frozen, explicitly unapproved and inactive', () => {
  const draft = buildUsSalesPromptDraft();
  assert.ok(Object.isFrozen(draft));
  assert.equal(draft.releaseApproved, false);
  assert.equal(draft.status, 'draft-not-routed');
  assert.equal(draft.requiresVerifiedRepliqSalesOwnership, true);
  for (const text of [PRICE_SUMMARY, PLAN_LIMITS, LIMITS_NOTICE, 'English, Spanish, French', 'not an operator\'s guest booking assistant', 'Existing customer contracts are unchanged']) assert.ok(draft.systemPrompt.includes(text), text);
  assert.match(draft.systemPrompt, /not currently enforced counters/);
  assert.match(draft.systemPrompt, /does not reset at midnight/);
  assert.match(draft.systemPrompt, /Do not invent a calendar reservation/);
  assert.equal(buildUsSalesPromptDraft({ offer: 'Premium', releaseApproved: true }).releaseApproved, false);
});

it('keeps legacy defaults and stored customer configuration intact; US context is explicit only', async () => {
  const previousFetch = globalThis.fetch;
  const keys = ['GROQ_API_KEY', 'GEMINI_API_KEY', 'PRIMARY_AI_PROVIDER', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN'];
  const previousEnv = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const requests = [];
  const legacy = { businessName: 'Fixture legacy', systemPrompt: 'Fixture charter: 800 MAD. Never quote RepliQ subscriptions.', notes: 'Existing customer settings' };
  try {
    process.env.GROQ_API_KEY = 'synthetic-not-a-secret'; delete process.env.GEMINI_API_KEY;
    process.env.PRIMARY_AI_PROVIDER = 'groq'; process.env.UPSTASH_REDIS_REST_URL = 'https://redis.fixture.invalid'; process.env.UPSTASH_REDIS_REST_TOKEN = 'synthetic';
    globalThis.fetch = async (url, options) => {
      const payload = JSON.parse(options.body); requests.push({ url, payload });
      if (url === 'https://redis.fixture.invalid/pipeline') return { ok: true, json: async () => [{ result: JSON.stringify(legacy) }] };
      assert.equal(url, 'https://api.groq.com/openai/v1/chat/completions');
      return { ok: true, json: async () => ({ choices: [{ message: { content: 'Fixture response' }, finish_reason: 'stop' }] }) };
    };
    const config = await getBusinessConfig('fixture-legacy-number');
    assert.deepEqual(config, legacy);
    assert.deepEqual(requests[0].payload, [['GET', 'business:fixture-legacy-number']]);
    await generateReply('Fixture question');
    await generateReply('Fixture question', [], config.systemPrompt);
    await generateReply('Fixture question', [], buildUsSalesPromptDraft().systemPrompt);
    const prompts = requests.slice(1).map(request => request.payload.messages[0].content);
    assert.equal(prompts[0], DEFAULT_SYSTEM_PROMPT); assert.match(prompts[0], /MAD/);
    assert.equal(prompts[1], legacy.systemPrompt);
    assert.equal(prompts[2], buildUsSalesPromptDraft().systemPrompt);
    assert.deepEqual(PLANS.map(plan => plan.base), [200, 400, 800]);
    for (const name of ['api/webhook.js', 'api/conversation.js', 'api/business-config.js', 'lib/ai.js']) assert.doesNotMatch(read(name), /us-sales-prompt-draft|buildUsSalesPromptDraft|public-offer/);
  } finally {
    globalThis.fetch = previousFetch;
    for (const key of keys) if (previousEnv[key] === undefined) delete process.env[key]; else process.env[key] = previousEnv[key];
  }
});

it('provides a review-labelled English privacy draft while retaining the French policy', () => {
  const policy = read('privacy-en.html');
  assert.match(policy, /<html lang="en">/); assert.match(policy, /name="robots" content="noindex"/);
  assert.match(policy, /pending business-owner review/); assert.match(policy, /not been approved for publication/);
  for (const provider of ['Meta', 'Vercel', 'Upstash', 'Supabase', 'Groq', 'Gemini', 'Resend', 'Google Fonts', 'cdnjs']) assert.ok(policy.includes(provider));
  assert.match(policy, /No fixed retention duration/); assert.match(policy, /does not automatically erase/);
  assert.match(policy, /must be confirmed with the business owner/);
  assert.match(policy, /href="privacy.html"/); assert.match(read('privacy.html'), /<html lang="fr">/);
  assert.doesNotMatch(policy, /GDPR compliant|CCPA compliant|SOC 2 certified|US office|deleted after \d+ days/i);
  for (const name of ['index.html', 'formulaire.html']) assert.match(read(name), /href="privacy-en.html"/);
  assert.match(read('formulaire.html'), /not a payment or booking confirmation/);
  assert.match(read('formulaire.html'), /name="description" content="Request a demo.*\$99\/month \+ \$99 one-time setup/);
});
