// tests/chatbot-pricing.test.js
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { PLANS, loyaltyDiscount, monthlyPrice, DEFAULT_SYSTEM_PROMPT, generateReply } from "../lib/ai.js";

describe("RepliQ Chatbot - Pricing Restoration & Plan Knowledge", () => {
  it("restores the exact RepliQ pricing plans structure", () => {
    assert.equal(PLANS.length, 3);

    // Essentielle: 400 MAD setup, 200 MAD/month
    const essentielle = PLANS.find((p) => p.key === "ESSENTIELLE");
    assert.ok(essentielle);
    assert.equal(essentielle.setup, 400);
    assert.equal(essentielle.base, 200);
    assert.equal(essentielle.discStart, 15);
    assert.equal(essentielle.discCap, 35);

    // Standard: 600 MAD setup, 400 MAD/month
    const standard = PLANS.find((p) => p.key === "STANDARD");
    assert.ok(standard);
    assert.equal(standard.setup, 600);
    assert.equal(standard.base, 400);
    assert.equal(standard.discStart, 20);
    assert.equal(standard.discCap, 40);

    // Premium: 1000 MAD setup, 800 MAD/month
    const premium = PLANS.find((p) => p.key === "PREMIUM");
    assert.ok(premium);
    assert.equal(premium.setup, 1000);
    assert.equal(premium.base, 800);
    assert.equal(premium.discStart, 25);
    assert.equal(premium.discCap, 50);
  });

  it("calculates loyalty discounts and monthly prices accurately", () => {
    const standard = PLANS.find((p) => p.key === "STANDARD");

    // Year 1: base price
    assert.equal(loyaltyDiscount(standard, 1), 0);
    assert.equal(monthlyPrice(standard, 1), 400);

    // Year 2: 20% discount (320 MAD)
    assert.equal(loyaltyDiscount(standard, 2), 20);
    assert.equal(monthlyPrice(standard, 2), 320);

    // Year 3: 25% discount (300 MAD)
    assert.equal(loyaltyDiscount(standard, 3), 25);
    assert.equal(monthlyPrice(standard, 3), 300);

    // Year 6+: capped at 40% (240 MAD)
    assert.equal(loyaltyDiscount(standard, 6), 40);
    assert.equal(monthlyPrice(standard, 6), 240);
  });

  it("includes pricing and formulas in DEFAULT_SYSTEM_PROMPT", () => {
    assert.ok(DEFAULT_SYSTEM_PROMPT.includes("200 MAD/mois"));
    assert.ok(DEFAULT_SYSTEM_PROMPT.includes("400 MAD"));
    assert.ok(DEFAULT_SYSTEM_PROMPT.includes("600 MAD"));
    assert.ok(DEFAULT_SYSTEM_PROMPT.includes("800 MAD/mois"));
    assert.ok(DEFAULT_SYSTEM_PROMPT.includes("Donne les prix exacts des formules"));
  });

  describe("Chatbot answers price inquiries (FR / Darija / EN)", () => {
    const originalEnv = { ...process.env };
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
      process.env.GROQ_API_KEY = "mock_groq_key";
    });

    afterEach(() => {
      process.env = { ...originalEnv };
      globalThis.fetch = originalFetch;
    });

    it("handles French price question: 'quel est le prix'", async () => {
      globalThis.fetch = async (url, opts) => {
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content:
                    "Voici nos tarifs :\n*Essentielle* : 200 MAD/mois (+ 400 MAD installation)\n*Standard* : 400 MAD/mois (+ 600 MAD installation)\n*Premium* : 800 MAD/mois (+ 1000 MAD installation)",
                },
                finish_reason: "stop",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      };

      const reply = await generateReply("quel est le prix ?");
      assert.ok(reply.includes("200 MAD"));
      assert.ok(reply.includes("400 MAD"));
      assert.ok(reply.includes("800 MAD"));
    });

    it("handles Darija price question: 'ch7al taman'", async () => {
      globalThis.fetch = async (url, opts) => {
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content:
                    "Kaynin 3 dial les formules :\n*Essentielle* : 200 MAD/chher\n*Standard* : 400 MAD/chher\n*Premium* : 800 MAD/chher",
                },
                finish_reason: "stop",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      };

      const reply = await generateReply("ch7al taman lformule standard ?");
      assert.ok(reply.includes("400 MAD"));
    });

    it("handles English price question: 'how much does it cost'", async () => {
      globalThis.fetch = async (url, opts) => {
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content:
                    "Our pricing plans are:\n*Essentielle* : 200 MAD/month\n*Standard* : 400 MAD/month\n*Premium* : 800 MAD/month",
                },
                finish_reason: "stop",
              },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      };

      const reply = await generateReply("how much does it cost ?");
      assert.ok(reply.includes("200 MAD"));
      assert.ok(reply.includes("400 MAD"));
      assert.ok(reply.includes("800 MAD"));
    });
  });
});
