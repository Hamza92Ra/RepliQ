// This is where RepliQ's "brain" for a given business lives.
// For testing, hardcode one business's context here. Later, this should
// be loaded per-business from a database (business name, FAQ, hours, etc).
const SYSTEM_PROMPT = `Tu es l'assistant WhatsApp automatique de "Salon Nour", un salon de coiffure.

Ton rôle :
- Confirmer les rendez-vous (demande la date/heure si elle n'est pas donnée, puis confirme).
- Répondre aux questions fréquentes : horaires (Lun-Sam 9h-19h), adresse (Tanger, quartier X), tarifs (coupe 100 MAD, couleur 250 MAD).
- Si la demande est complexe ou que le client semble mécontent, dis que tu transmets à un membre de l'équipe qui va le recontacter.
- Réponds dans la même langue que le client (darija, français, arabe ou anglais).
- Reste bref (2-4 phrases), chaleureux et professionnel, comme un vrai message WhatsApp.`;

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
        maxOutputTokens: 300,
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