import { it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { DEFAULT_SYSTEM_PROMPT, PLANS } from '../lib/ai.js';
import { buildUsSalesPrompt } from '../lib/us-sales-prompt.js';
import { buildUsSalesPromptDraft } from '../lib/foundation/us-sales-prompt-draft.js';
const read = name => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const EMAIL = '7amzaraddi@gmail.com', BOT = '212712614398';
const pages = ['index.html','formulaire.html','privacy.html','privacy-en.html'];
const personal = /(?:\+?212[\s().-]*6[\s().-]*73[\s().-]*046[\s().-]*307|0[\s().-]*6[\s().-]*73[\s().-]*046[\s().-]*307)/;

it('advertises the verified official email and WhatsApp bot on every public contact page', () => {
  for (const name of pages) {
    const html = read(name);
    assert.ok(html.includes(`href="mailto:${EMAIL}"`), name);
    assert.ok(html.includes(`https://wa.me/${BOT}`), name);
    for (const [, email] of html.matchAll(/href="mailto:([^"?]+)[^"]*"/g)) assert.equal(email, EMAIL, name);
    for (const [, number] of html.matchAll(/https:\/\/wa\.me\/([^?"\s]+)/g)) assert.equal(number, BOT, name);
    assert.doesNotMatch(html, personal, name);
    assert.doesNotMatch(html, /hamzaraddi92@gmail\.com/, name);
  }
});
it('does not advertise the personal number in shipped HTML or public JavaScript', () => {
  for (const name of readdirSync(new URL('../', import.meta.url)).filter(name => /\.(html|js)$/.test(name))) assert.doesNotMatch(read(name), personal, name);
  assert.ok(read('signup.js').includes(`https://wa.me/${BOT}?text=`));
  assert.doesNotMatch(read('lib/ai.js'), personal);
});
it('corrects only the legacy default contact while preserving Moroccan pricing', () => {
  assert.ok(DEFAULT_SYSTEM_PROMPT.includes(EMAIL)); assert.ok(DEFAULT_SYSTEM_PROMPT.includes(`+${BOT}`));
  assert.doesNotMatch(DEFAULT_SYSTEM_PROMPT, personal); assert.match(DEFAULT_SYSTEM_PROMPT, /MAD/);
  assert.deepEqual(PLANS.map(plan => [plan.base, plan.setup]), [[200,400],[400,600],[800,1000]]);
  assert.doesNotMatch(DEFAULT_SYSTEM_PROMPT, /\$99\/month/);
});
it('preserves the reviewed inactive USD sales offer without importing the legacy personal contact', () => {
  const prompt = buildUsSalesPrompt();
  assert.equal(prompt, buildUsSalesPromptDraft().systemPrompt); assert.equal(buildUsSalesPromptDraft().releaseApproved, false);
  assert.match(prompt, /\$99\/month \+ \$99 one-time setup fee/);
  assert.match(prompt, /English, Spanish, French/); assert.match(prompt, /1,000 outbound replies/);
  assert.match(prompt, /12 AI replies per customer per rolling 24 hours/); assert.match(prompt, /Usage caps are not enforced yet/);
  assert.match(prompt, /not an operator's guest booking assistant/); assert.doesNotMatch(prompt, personal);
});
it('keeps both notices clearly pending, with verified contacts and no invented policy guarantees', () => {
  const en = read('privacy-en.html'), fr = read('privacy.html');
  for (const html of [en,fr]) {
    assert.match(html, /name="robots" content="noindex"/);
    for (const provider of ['Meta','Vercel','Upstash','Supabase','Groq','Gemini','Resend','Google Fonts','cdnjs']) assert.ok(html.includes(provider));
    assert.doesNotMatch(html, /GDPR compliant|CCPA compliant|SOC 2 certified|US office|stockées de façon sécurisée|Nous ne vendons pas|uniquement dans le but/i);
  }
  assert.match(en, /not been approved for publication/); assert.match(en, /owner-confirmed/);
  assert.match(en, /proposed retention period of 90 days/); assert.match(en, /does not automatically erase/);
  assert.match(fr, /en attente de validation/); assert.match(fr, /durée cible de conservation de 90 jours/); assert.match(fr, /n'efface pas automatiquement/);
  assert.match(fr, /href="privacy-en.html"/); assert.match(en, /href="privacy.html"/);
});
