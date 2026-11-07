// Public acquisition offer only. Never imported by the live AI prompt or quota
// paths. This does not migrate existing customers or enforce usage limits.
export const PUBLIC_OFFER = Object.freeze({
  name: "RepliQ Pro", currency: "USD", monthly: 99, setup: 99,
  languages: Object.freeze(["English", "Spanish", "French"]),
  outboundRepliesPerBillingPeriod: 1000,
  aiRepliesPerCustomerPerRolling24Hours: 12,
  limitsEnforced: false,
});
export const PRICE_SUMMARY = "$99/month + $99 one-time setup fee (USD)";
export const PLAN_LIMITS = "Up to 1,000 outbound replies per billing period and up to 12 AI replies per customer per rolling 24 hours.";
export const LIMITS_NOTICE = "Intended plan limits. Usage caps are not enforced yet; terms will be confirmed before activation.";
export const PRO_FEATURES = Object.freeze([
  "AI WhatsApp receptionist in English, Spanish and French",
  "Answers based on your approved charter information",
  "Conversation history and human takeover from your dashboard",
  "Voice message handling and booking-intent notifications",
]);
