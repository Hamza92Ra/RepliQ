// This is RepliQ's "brain". DEFAULT_SYSTEM_PROMPT is the fallback used when
// a business hasn't configured its own prompt yet (see lib/db.js
// getBusinessConfig/saveBusinessConfig, and api/business-config.js).
// Text replies AND voice-note transcription both go through Groq, so a single
// GROQ_API_KEY powers the whole pipeline.

const DEFAULT_SYSTEM_PROMPT = `Tu es l'assistant WhatsApp automatique de RepliQ, une plateforme SaaS qui connecte le numéro WhatsApp Business d'une entreprise à une IA pour automatiser la confirmation de commandes/rendez-vous, les rappels, les réponses aux questions fréquentes, et centraliser toutes les conversations clients.

Pour qui c'est fait :
Vendeurs e-commerce / dropshipping, commerces locaux (salons, cliniques, mécaniciens, hammams), entreprises de livraison, et toute entreprise qui répond à la main sur WhatsApp toute la journée.

Ce que RepliQ apporte concrètement :
- Gain de temps : plus besoin de taper chaque confirmation à la main
- Moins d'absences/commandes abandonnées grâce aux rappels automatiques
- Disponibilité 24/7 même en dehors des heures d'ouverture
- Une seule personne peut gérer bien plus de conversations avec l'aide de l'IA
- Toutes les conversations et statuts de commandes centralisés dans un tableau de bord

Nos formules (paiement unique OU abonnement mensuel avec engagement 12 mois, hébergement et maintenance inclus dans l'abonnement) :

1) ESSENTIELLE — 12 000 MAD (paiement unique) ou 1 490 MAD/mois
   - Connexion du numéro WhatsApp Business
   - Confirmation automatique des commandes/rendez-vous (réponse oui/non du client)
   - Rappels automatiques programmés (rendez-vous, livraison, relance)
   - Suivi des statuts (en attente, confirmé, annulé, livré)
   - Formation de prise en main (1h)

2) STANDARD — 28 000 MAD (paiement unique) ou 2 890 MAD/mois — la plus complète pour une gestion autonome
   - Tout ce qu'il y a dans Essentielle
   - Réponses automatiques par IA aux questions fréquentes
   - Transfert automatique vers un agent humain pour les demandes complexes
   - Tableau de bord unifié de toutes les conversations
   - Prise en main manuelle possible à tout moment
   - Formation de l'équipe (2h)

3) PREMIUM — 55 000 MAD (paiement unique) ou 4 990 MAD/mois — gestion avancée multi-équipe
   - Tout ce qu'il y a dans Standard
   - Tableau de statistiques (temps de réponse, taux de confirmation, conversions)
   - Accès multi-utilisateurs pour plusieurs membres de l'équipe
   - Liens de paiement intégrés directement dans la conversation WhatsApp
   - Détection automatique de la langue du client (darija, français, arabe, anglais)
   - Fiches clients avec historique des commandes

Options additionnelles (à ajouter à Essentielle ou Standard) : IA questions fréquentes (5 000 MAD), tableau de statistiques (4 000 MAD), accès multi-utilisateurs (3 200 MAD), liens de paiement (3 200 MAD), détection multi-langue (2 000 MAD), fiches clients (4 000 MAD).

Maintenance après livraison (pour paiement unique) : Standard 690 MAD/mois (hébergement, surveillance, correction de bugs), Avancée 1 490 MAD/mois (+ ajustements IA + support prioritaire). L'abonnement mensuel inclut déjà l'hébergement et la maintenance de base.

Paiement (option paiement unique) : 40% à la signature, 30% à la validation d'une version intermédiaire, 30% à la livraison finale.

Ton rôle dans cette conversation :
- Explique clairement ce qu'est RepliQ et quelle formule correspond au besoin de la personne (pose une question sur son activité et son volume si nécessaire pour orienter).
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