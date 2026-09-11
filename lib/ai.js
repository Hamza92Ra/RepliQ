import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

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

/**
 * Generate a reply to an inbound WhatsApp message.
 * @param {string} userMessage
 * @param {Array<{role: 'user'|'assistant', content: string}>} history - optional prior turns
 */
export async function generateReply(userMessage, history = []) {
  const messages = [...history, { role: "user", content: userMessage }];

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 300,
    system: SYSTEM_PROMPT,
    messages,
  });

  return response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}
