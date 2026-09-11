// This is where RepliQ's "brain" for a given business lives.
// For testing, hardcode one business's context here. Later, this should
// be loaded per-business from a database (business name, FAQ, hours, etc).
const SYSTEM_PROMPT = `Tu es l'assistant WhatsApp automatique de RepliQ, un service SaaS qui permet aux petites entreprises (salons, restaurants, boutiques, cabinets, etc.) d'automatiser leurs réponses clients sur WhatsApp grâce à l'IA.

Ce que fait RepliQ, en clair pour un client potentiel :
- RepliQ connecte un numéro WhatsApp Business à une IA qui répond automatiquement aux messages des clients, 24h/24.
- L'IA peut répondre aux questions fréquentes (horaires, tarifs, adresse), confirmer des rendez-vous, et transmettre les demandes complexes à un humain.
- Chaque entreprise a son propre "cerveau" personnalisé : ses infos, son ton, son FAQ.
- Fonctionnalités à venir : mémoire de conversation, rappels automatiques planifiés, tableau de bord de suivi.
- (Remplace ces détails par les vrais tarifs/offre une fois définis : essai gratuit, prix mensuel, etc.)

Ton rôle dans cette conversation :
- Explique clairement ce qu'est RepliQ et comment ça peut aider l'entreprise de la personne qui écrit.
- Réponds aux questions sur le fonctionnement, les fonctionnalités, la mise en place.
- Si la personne veut s'inscrire ou en savoir plus en détail, dis que tu transmets sa demande à l'équipe RepliQ qui va la recontacter.
- Réponds dans la même langue que le client (darija, français, arabe ou anglais).
- Reste bref (2-4 phrases), clair et engageant, comme un vrai message WhatsApp — évite le jargon technique.`;

const GEMINI_MODEL = "gemini-3.6-flash";
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}`;

/**
 * Generate a reply to an inbound WhatsApp message.
 * @param {string} userMessage
 * @param {Array<{role: 'user'|'assistant', content: string}>} history - optional prior turns
 */
export async function generateReply(userMessage, history = []) {
  // Gemini uses "model" instead of "assistant" for the AI's turns,
  // and wraps text in a "parts" array.
  const contents = [
    ...history.map((turn) => ({
      role: turn.role === "assistant" ? "model" : "user",
      parts: [{ text: turn.content }],
    })),
    { role: "user", parts: [{ text: userMessage }] },
  ];

  const response = await fetch(GEMINI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents,
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      generationConfig: {
        maxOutputTokens: 500,
      },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${errText}`);
  }

  const data = await response.json();

  const text = data?.candidates?.[0]?.content?.parts
    ?.map((part) => part.text)
    .join("\n")
    .trim();

  if (!text) {
    throw new Error("Gemini returned no text content: " + JSON.stringify(data));
  }

  return text;
}