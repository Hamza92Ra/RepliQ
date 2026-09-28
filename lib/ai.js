// This is RepliQ's "brain". DEFAULT_SYSTEM_PROMPT is the fallback used when
// a business hasn't configured its own prompt yet (see lib/db.js
// getBusinessConfig/saveBusinessConfig, and api/business-config.js).
// Text replies AND voice-note transcription both go through Groq, so a single
// GROQ_API_KEY powers the whole pipeline.

const DEFAULT_SYSTEM_PROMPT = `Tu es l'assistant WhatsApp automatique de RepliQ, une plateforme SaaS qui connecte le numéro WhatsApp Business d'une entreprise à une IA pour automatiser la confirmation de commandes/rendez-vous, les rappels, les réponses aux questions fréquentes, et centraliser toutes les conversations et commandes clients dans un tableau de bord.

Pour qui c'est fait :
Vendeurs e-commerce / dropshipping, commerces locaux (salons, cliniques, mécaniciens, hammams), entreprises de livraison, et toute entreprise qui répond à la main sur WhatsApp toute la journée.

Ce que RepliQ apporte concrètement :
- Gain de temps : plus besoin de taper chaque confirmation à la main
- Moins d'absences/commandes abandonnées grâce aux rappels automatiques
- Disponibilité 24/7 même en dehors des heures d'ouverture
- Une seule personne peut gérer bien plus de conversations avec l'aide de l'IA
- Toutes les conversations et commandes centralisées dans un tableau de bord, avec prise en main manuelle possible à tout moment

Nos formules (abonnement mensuel, sans engagement long terme, hébergement et maintenance inclus) :

1) ESSENTIELLE — 399 MAD/mois (+ 500 MAD installation, paiement unique)
   - Connexion du numéro WhatsApp Business
   - Confirmation automatique des commandes/rendez-vous (réponse oui/non du client)
   - Rappels automatiques programmés (rendez-vous, livraison, relance)
   - Suivi des statuts (en attente, confirmé, annulé, livré)
   - Formation de prise en main (1h)

2) STANDARD — 599 MAD/mois (+ 900 MAD installation, paiement unique) — la plus choisie, pour une gestion autonome
   - Tout ce qu'il y a dans Essentielle
   - Réponses automatiques par IA aux questions fréquentes
   - Transfert vers un conseiller humain à tout moment, sans perdre le fil de la conversation
   - Tableau de bord unifié : conversations ET commandes, avec mise à jour des statuts
   - Formation de l'équipe (2h)

3) PREMIUM — 899 MAD/mois (+ 1 500 MAD installation, paiement unique) — gestion avancée
   - Tout ce qu'il y a dans Standard
   - Volume de commandes plus élevé, support prioritaire
   - Accompagnement dédié pour la configuration du catalogue et des flux de commande

Paiement : mensuel, par carte ou virement. Frais d'installation unique à la signature (connexion du numéro, configuration initiale, import du catalogue si besoin).

Ton rôle dans cette conversation :
- Explique clairement ce qu'est RepliQ et quelle formule correspond au besoin de la personne (pose une question sur son activité et son volume de commandes/rendez-vous si nécessaire pour orienter).
- Donne les prix exacts des formules quand on te les demande — ne les invente jamais, utilise uniquement les chiffres ci-dessus.
- Si la demande est complexe, si la personne veut signer, personnaliser une offre, ou négocier, dis que tu transmets sa demande à l'équipe RepliQ qui va la recontacter rapidement.
- Réponds dans la même langue que le client (darija, français, arabe ou anglais).
- Reste bref (2-5 phrases), clair et professionnel, comme un vrai message WhatsApp — évite le jargon technique.`;

// Groq uses the OpenAI-compatible chat completions format — much simpler
// than Gemini's "parts"/"model" structure.
// NOTE: llama-3.3-70b-versatile is now Enterprise-only on Groq (Contact
// Sales), not available on free/developer accounts. gpt-oss-20b is fast,
// cheap, and works on the standard developer plan. If this ever 404s again,
// check https://console.groq.com/docs/models for current availability.
const GROQ_MODEL = "openai/gpt-oss-20b";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

// OpenAI-compatible Whisper endpoint — same key, same provider, so voice
// notes need zero extra setup. whisper-large-v3-turbo is the fastest model
// that still handles darija/arabic/french well.
const GROQ_TRANSCRIBE_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const GROQ_TRANSCRIBE_MODEL = "whisper-large-v3-turbo";

/**
 * Transcribe a WhatsApp voice note to text.
 * @param {ArrayBuffer} audioBuffer - raw media bytes downloaded from Meta's CDN
 * @param {string} [filename] - extension hints at the container for Groq (ogg/m4a)
 * @returns {Promise<string>} the transcript in whatever language the customer spoke
 */
export async function transcribeAudio(audioBuffer, filename = "voice.ogg") {
  const form = new FormData();
  form.append("file", new Blob([audioBuffer], { type: "audio/ogg" }), filename);
  form.append("model", GROQ_TRANSCRIBE_MODEL);

  const response = await fetch(GROQ_TRANSCRIBE_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      // Do NOT set Content-Type here — fetch sets the multipart boundary.
    },
    body: form,
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Groq transcription error (${response.status}): ${errText}`);
  }

  const data = await response.json();
  const text = data?.text?.trim();
  if (!text) {
    throw new Error("Groq transcription returned empty text");
  }
  return text;
}

/**
 * Generate a reply to an inbound WhatsApp message.
 * @param {string} userMessage
 * @param {Array<{role: 'user'|'assistant', content: string}>} history - optional prior turns
 * @param {string} [systemPrompt] - per-business system prompt; falls back to
 *   DEFAULT_SYSTEM_PROMPT when the business hasn't configured one yet.
 */
export async function generateReply(userMessage, history = [], systemPrompt) {
  const messages = [
    { role: "system", content: systemPrompt || DEFAULT_SYSTEM_PROMPT },
    ...history,
    { role: "user", content: userMessage },
  ];

  const response = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages,
      max_tokens: 500,
      temperature: 0.7,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Groq API error (${response.status}): ${errText}`);
  }

  const data = await response.json();

  const finishReason = data?.choices?.[0]?.finish_reason;
  if (finishReason && finishReason !== "stop") {
    console.warn("Groq finish_reason was not 'stop':", finishReason);
  }

  const text = data?.choices?.[0]?.message?.content?.trim();

  if (!text) {
    throw new Error("Groq returned no text content: " + JSON.stringify(data));
  }

  return text;
}

export { DEFAULT_SYSTEM_PROMPT };

/**
 * Checks if the customer just confirmed an order, and if so extracts what
 * they're buying. Returns null if they haven't clearly confirmed yet —
 * callers should skip creating an order rather than guess.
 */
export async function extractOrder(userMessage, history = [], systemPrompt) {
  const extractionPrompt = `${systemPrompt || DEFAULT_SYSTEM_PROMPT}

You are now extracting order data from the conversation, not chatting.
Respond with ONLY a JSON object, no other text:
{"confirmed": boolean, "items": [{"name": string, "quantity": number, "price": number|null}], "amount": number|null}
Set "confirmed" to false if the customer hasn't clearly confirmed an order yet.`;

  const response = await fetch(GROQ_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [{ role: "system", content: extractionPrompt }, ...history, { role: "user", content: userMessage }],
      max_tokens: 400,
      temperature: 0,
      response_format: { type: "json_object" },
    }),
  });
  if (!response.ok) { console.error("Order extraction error:", response.status); return null; }

  const raw = (await response.json())?.choices?.[0]?.message?.content;
  try {
    const parsed = JSON.parse(raw);
    return parsed.confirmed ? { items: parsed.items || [], amount: parsed.amount ?? null } : null;
  } catch (err) {
    console.error("Order extraction parse failed:", err, raw);
    return null;
  }
}