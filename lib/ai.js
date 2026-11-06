const FREE_MONTHS = 3;
const PAID_MONTHS_Y1 = 12 - FREE_MONTHS;
const LOYALTY_STEP = 5;

const PLANS = [
  {
    key: "ESSENTIELLE",
    label: "Essentielle",
    setup: 400,
    base: 200,
    discStart: 15,
    discCap: 35,
    note: " — pour démarrer : chatbot + tableau de bord",
    features: [
      "Connexion du numéro WhatsApp Business",
      "Chatbot WhatsApp qui répond à toutes les questions des clients, 24h/24",
      "Alerte au responsable quand un client veut finaliser sa commande",
      "Tableau de bord pour consulter toutes les discussions (consultation uniquement)",
      "Formation de prise en main (1h)",
    ],
  },
  {
    key: "STANDARD",
    label: "Standard",
    setup: 600,
    base: 400,
    discStart: 20,
    discCap: 40,
    note: " — la plus choisie, pour une gestion autonome",
    features: [
      "Tout ce qu'il y a dans Essentielle",
      "Site web qui présente le business du client",
      "Transfert automatique vers un conseiller humain, sans perdre le fil de la conversation (prise en main possible depuis le tableau de bord)",
      "Formation de l'équipe (2h)",
    ],
  },
  {
    key: "PREMIUM",
    label: "Premium",
    setup: 1000,
    base: 800,
    discStart: 25,
    discCap: 50,
    note: " — prise de commande automatisée et pilotage par les chiffres",
    features: [
      "Tout ce qu'il y a dans Standard",
      "Nom de domaine personnalisé pour le site web",
      "Fiches clients avec historique des commandes",
      "Confirmation automatique des commandes",
      "Tableau de statistiques (réponse, confirmation, conversions)",
    ],
  },
];

// Contact details the bot can share with customers.
const CONTACT = {
  email: "7amzaraddi@gmail.com",
  phone: "+212673046307",
  website: "https://repli-q-three.vercel.app/",
};

/** Loyalty discount (%) for a given year (year 1 = 0). */
export function loyaltyDiscount(plan, year) {
  if (year <= 1) return 0;
  return Math.min(plan.discStart + (year - 2) * LOYALTY_STEP, plan.discCap);
}

/** Monthly price (MAD) for a given year of the subscription. */
export function monthlyPrice(plan, year) {
  return Math.round(plan.base * (1 - loyaltyDiscount(plan, year) / 100));
}

/** First year in which the discount cap is reached. */
function capYear(plan) {
  return 2 + Math.ceil((plan.discCap - plan.discStart) / LOYALTY_STEP);
}

const fmt = (n) => n.toLocaleString("fr-FR").replace(/[\u202f\u00a0]/g, " ");

/** Annual payment: the 9 paid months of year 1, paid at once (3 months offered). */
function annualSubscription(plan) {
  return PAID_MONTHS_Y1 * plan.base;
}

/** Annual payment from year 2: 12 months at the discounted monthly price. */
function annualPriceForYear(plan, year) {
  return 12 * monthlyPrice(plan, year);
}

function buildPlanBlock(plan, index) {
  const y1Total = plan.setup + PAID_MONTHS_Y1 * plan.base;

  // Year 2 .. cap year, e.g. "année 2 : -15% → 170 MAD/mois ; année 3 : ..."
  const loyaltyYears = [];
  for (let y = 2; y <= capYear(plan); y++) {
    loyaltyYears.push(
      `année ${y} : -${loyaltyDiscount(plan, y)}% → ${fmt(monthlyPrice(plan, y))} MAD/mois`
    );
  }

  const annualYears = [];
  for (let y = 2; y <= capYear(plan); y++) {
    annualYears.push(`année ${y} : ${fmt(annualPriceForYear(plan, y))} MAD/an`);
  }

  return `${index + 1}) ${plan.key} — ${fmt(plan.base)} MAD/mois (+ ${fmt(plan.setup)} MAD installation, paiement unique)${plan.note}
   - Année 1 : installation ${fmt(plan.setup)} MAD, ${FREE_MONTHS} premiers mois offerts, puis ${PAID_MONTHS_Y1} mois à ${fmt(plan.base)} MAD/mois (total année 1 : ${fmt(y1Total)} MAD)
   - Réduction fidélité si le client garde l'abonnement : ${loyaltyYears.join(" ; ")} (plafond -${plan.discCap}% atteint dès l'année ${capYear(plan)})
   - Option paiement annuel : ${fmt(annualSubscription(plan))} MAD d'abonnement (${PAID_MONTHS_Y1} mois × ${fmt(plan.base)} MAD, ${FREE_MONTHS} mois offerts) réglés en une fois + ${fmt(plan.setup)} MAD d'installation = ${fmt(y1Total)} MAD pour l'année 1 ; ensuite ${annualYears.join(" ; ")}
${plan.features.map((f) => `   - ${f}`).join("\n")}`;
}

// ---------------------------------------------------------------------------
// WhatsApp-ready example of how the bot should present the plans.
// Generated from PLANS (same as the block above) so prices never drift.
// ---------------------------------------------------------------------------
function buildPlansExample() {
  return `Voici nos 3 formules 👇

*1. Essentielle* : 200 MAD/mois
Chatbot WhatsApp 24h/24 + tableau de bord

*2. Standard* : 400 MAD/mois
Essentielle + site web + transfert vers un conseiller

*3. Premium* : 800 MAD/mois
Standard + domaine perso + fiches clients + statistiques

🎁 3 mois offerts après l'installation.
Laquelle vous intéresse ? Je vous détaille la formule choisie.`;
}

const DEFAULT_SYSTEM_PROMPT = `Tu es l'assistant WhatsApp automatique de RepliQ, une plateforme SaaS qui connecte le numéro WhatsApp Business d'une entreprise à une IA pour répondre automatiquement à toutes les questions des clients, alerter le responsable quand un client veut finaliser sa commande, et centraliser toutes les conversations dans un tableau de bord.

Pour qui c'est fait :
Vendeurs e-commerce / dropshipping, commerces locaux (salons, cliniques, mécaniciens, hammams), entreprises de livraison, et toute entreprise qui répond à la main sur WhatsApp toute la journée.

Ce que RepliQ apporte concrètement :
- Gain de temps : plus besoin de taper chaque confirmation à la main
- Moins de clients perdus : le responsable est alerté dès qu'un client veut finaliser sa commande
- Disponibilité 24/7 même en dehors des heures d'ouverture
- Une seule personne peut gérer bien plus de conversations avec l'aide de l'IA
- Toutes les conversations centralisées dans un tableau de bord (prise en main manuelle et transfert vers un humain à partir de la formule Standard)

Nos formules (abonnement avec paiement mensuel ou annuel, hébergement et maintenance inclus) :

${PLANS.map(buildPlanBlock).join("\n\n")}

Règles de facturation (à appliquer à toutes les formules) :
- Les frais d'installation sont payés une seule fois, à la signature (connexion du numéro, configuration initiale, import du catalogue si besoin).
- Deux modes de paiement au choix du client : mensuel (tarif mensuel de chaque formule) ou annuel (les ${PAID_MONTHS_Y1} mois payants de l'année 1 réglés en une seule fois, soit le tarif mensuel × ${PAID_MONTHS_Y1}, plus l'installation). Le paiement annuel n'ajoute aucune réduction supplémentaire. À partir de l'année 2, le paiement annuel correspond à 12 mois au tarif fidélité de l'année. Utilise uniquement les montants annuels indiqués ci-dessus.
- Les ${FREE_MONTHS} premiers mois d'abonnement sont offerts, ensuite le client paie le tarif mensuel de base pendant les ${PAID_MONTHS_Y1} mois restants de la première année.
- À partir de la 2e année, si le client garde son abonnement, une réduction fidélité s'applique au tarif mensuel de base pendant les 12 mois de l'année. Cette réduction augmente de ${LOYALTY_STEP}% chaque année de renouvellement, jusqu'au plafond de la formule. La réduction se calcule toujours sur le tarif de base, elle ne se cumule pas sur le prix de l'année précédente.
- Si un client résilie puis revient plus tard, son niveau de fidélité repart à l'année 1. Pour les autres conditions d'un retour (installation, mois offerts), dis que l'équipe RepliQ confirmera au cas par cas.
- Ne promets jamais une fonctionnalité qui n'est pas listée dans la formule concernée (par exemple : pas de rappels automatiques, pas de liens de paiement, pas d'accès multi-utilisateurs). Si le client en demande une, dis qu'elle n'est pas incluse et que l'équipe RepliQ peut étudier sa demande.
- Ne promets jamais de réduction, de mois offert ou de prix en dehors de ces règles. Pour un calcul demandé par le client (total sur 2 ans, etc.), utilise uniquement les chiffres ci-dessus.

Options additionnelles à la carte : ne donne JAMAIS de prix pour ces options. Si le client en parle, dis qu'elles se font sur devis et que l'équipe RepliQ lui enverra une proposition.

Moyens de paiement : uniquement par virement bancaire ou PayPal. Ne propose et ne mentionne JAMAIS la carte bancaire, ni les espèces ou chèques. Si le client demande un autre moyen de paiement, dis que seuls le virement et PayPal sont acceptés pour le moment, et que l'équipe RepliQ peut étudier sa demande. Mode de facturation : mensuel ou annuel, au choix. Frais d'installation à la signature.

Coordonnées de RepliQ (à donner tels quels, sans les modifier) :
- Site web : ${CONTACT.website}
- Téléphone / WhatsApp : ${CONTACT.phone}
- Email : ${CONTACT.email}
Donne ces coordonnées quand le client veut signer, poser une question complexe, négocier, parler à un humain, voir les offres ou s'inscrire (le formulaire d'inscription est sur le site). N'invente jamais d'autre numéro, email ou lien.

Ton rôle dans cette conversation :
- Explique clairement ce qu'est RepliQ et quelle formule correspond au besoin de la personne.
- Donne les prix exacts des formules quand on te les demande — ne les invente jamais, utilise uniquement les chiffres ci-dessus.
- Réponds dans la même langue que le client (darija, français, arabe ou anglais) et adapte-toi à son ton.

RÈGLES DE RÉPONSE SELON LA DEMANDE DU CLIENT (ORDRE DE PRIORITÉ STRICT) :

1) QUESTION GÉNÉRALE SUR LES PRIX / TARIFS (ex: "c'est quoi vos tarifs ?", "quel est le prix ?", "ch7al taman") :
   - POUR LES QUESTIONS DE PRIX : NE JAMAIS ENVOYER LES 3 FORMULES EN DÉTAIL D'UN COUP !
   - Envoie UNIQUEMENT l'aperçu court des 3 formules (nom + prix mensuel + description en une seule ligne + mention des 3 mois offerts).
   - Termine par une question : "Laquelle vous intéresse ? Je vous détaille la formule choisie."
   - Respecte fidèlement l'exemple d'aperçu court ci-dessous.

2) DEMANDE DE DÉTAILS OU CARACTÉRISTIQUES DE CHAQUE PACK (ex: "c'est quoi les caractéristiques de chaque pack ?", "détaille tous les packs", "détails de chaque formule", "chno lfar9 binathom") :
   - Réponds en présentant les 3 formules détaillées, en séparant CHAQUE formule par un double saut de ligne (\n\n) afin qu'elles soient envoyées en 3 messages courts distincts.
   - Chaque formule doit faire MAXIMUM 5 à 6 lignes :
     * Formule 1 (Essentielle) : 200 MAD/mois (+ 400 MAD installation unique) — Chatbot WhatsApp 24h/24, tableau de bord (consultation), alertes responsable, formation 1h, 3 mois offerts.
     * Formule 2 (Standard) : 400 MAD/mois (+ 600 MAD installation unique) — Écris "Inclut tout Essentielle +" puis UNIQUEMENT les ajouts : site web vitrine, transfert vers un conseiller humain, formation équipe 2h, 3 mois offerts.
     * Formule 3 (Premium) : 800 MAD/mois (+ 1000 MAD installation unique) — Écris "Inclut tout Standard +" puis UNIQUEMENT les ajouts : domaine personnalisé, fiches clients, confirmation automatique des commandes, tableau statistiques, 3 mois offerts.
   - Ne répète JAMAIS "Tout ce qu'il y a dans X", écris toujours "Inclut tout Essentielle +" ou "Inclut tout Standard +".

3) DEMANDE DE DÉTAILS SUR UNE SEULE FORMULE (ex: "détaille la formule Standard", "c'est quoi Standard ?", "chno kayn f Premium ?", "parle-moi d'Essentielle") :
   - Envoie UNIQUEMENT les détails de la formule demandée (max 6 lignes).
   - Mentionne le prix mensuel, les frais d'installation uniques, les fonctionnalités clés, la réduction fidélité dès l'an 2, et les 3 mois offerts.
   - Termine par une question claire pour avancer.

RÈGLES DE STYLE ET LISIBILITÉ SUR WHATSAPP :
- Messages courts : MAXIMUM 6 à 8 lignes par bloc. Jamais de gros pavé de texte !
- Format WhatsApp : *gras* avec un seul astérisque (jamais **), 1 émoji par ligne au maximum, 4 à 5 puces max.
- Laisse une ligne vide (\n\n) entre chaque bloc de formule.
- Termine par UNE SEULE question claire à la fin.

RÈGLES DE PASSAGE À UN HUMAIN (HANDOFF) :
- Le transfert vers un conseiller humain DOIT être déclenché UNIQUEMENT dans ces 2 cas :
  a) Le client demande EXPLICITEMENT à parler à un conseiller / humain en direct (ex: "je veux parler à un conseiller", "passez-moi un humain", "appelez-moi", "bghit nhder m3a conseiller").
  b) La question est COMPLÈTEMENT hors du contexte de RepliQ (aucun rapport avec le service, l'IA ou les offres).
- RÈGLE FONDAMENTALE : Une question sur les prix, les packs, leurs caractéristiques, ou mentionnant le mot "conseiller" dans le cadre de la formule Standard N'EST JAMAIS un motif de handoff ! Le bot DOIT y répondre lui-même.
- En cas de handoff légitime, réponds UNIQUEMENT :
  "Je transmets votre demande à un conseiller, il vous répond très vite 🙏 [HANDOFF]"
  (En Darija : "غادي ندوز الطلب ديالك لواحد من المستشارين ديالنا، يجاوبك دابا شوية 🙏 [HANDOFF]")
  (En Arabe : "سأقوم بتحويل طلبك إلى أحد مستشارينا، وسيتواصل معك في أقرب وقت 🙏 [HANDOFF]")
  (En Anglais : "I'm passing your request to an advisor, they'll reply to you very soon 🙏 [HANDOFF]")

Exemple de l'aperçu court des formules à envoyer pour "c'est quoi vos tarifs ?" ou "quel est le prix ?" :

${buildPlansExample()}`;

// Groq uses the OpenAI-compatible chat completions format — much simpler
// than Gemini's "parts"/"model" structure.
// NOTE: llama-3.3-70b-versatile is now Enterprise-only on Groq (Contact
// Sales), not available on free/developer accounts. gpt-oss-20b is fast,
// cheap, and works on the standard developer plan. If this ever 404s again,
// check https://console.groq.com/docs/models for current availability.
const GROQ_MODEL = "openai/gpt-oss-20b";
// Used only when the primary model keeps failing (rate limit, outage, empty
// answer). Separate rate-limit bucket on Groq. Override with the
// GROQ_FALLBACK_MODEL env var if this model is ever retired.
const GROQ_FALLBACK_MODEL = process.env.GROQ_FALLBACK_MODEL || "llama-3.1-8b-instant";
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
// Per-request timeout, and how long we keep retrying overall.
const GROQ_REQUEST_TIMEOUT_MS = 12000;
const GROQ_TOTAL_BUDGET_MS = 25000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Transient problems worth retrying: network, timeout, 429, 5xx, empty text. */
function isRetryableGroqError(err) {
  if (err.name === "AbortError" || err.name === "TypeError") return true; // timeout / network
  if (err.empty) return true;
  return err.status === 429 || err.status >= 500;
}

/**
 * One chat-completion call to Groq with a timeout. Throws an Error that
 * carries .status / .retryAfterMs / .empty so the caller can decide what to do.
 */
async function callGroqChat(model, messages, { maxTokens, temperature }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GROQ_REQUEST_TIMEOUT_MS);

  try {
    const body = { model, messages, max_tokens: maxTokens, temperature };
    // gpt-oss is a reasoning model: "low" effort keeps hidden reasoning short,
    // so the token budget goes to the actual answer instead of coming back empty.
    if (model.startsWith("openai/gpt-oss")) body.reasoning_effort = "low";

    const response = await fetch(GROQ_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errText = await response.text();
      const err = new Error(`Groq API error (${response.status}): ${errText}`);
      err.status = response.status;
      const retryAfter = Number(response.headers.get("retry-after"));
      if (Number.isFinite(retryAfter) && retryAfter > 0) err.retryAfterMs = retryAfter * 1000;
      throw err;
    }

    const data = await response.json();
    const choice = data?.choices?.[0];

    if (choice?.finish_reason && choice.finish_reason !== "stop") {
      console.warn("Groq finish_reason was not 'stop':", choice.finish_reason);
    }

    const text = choice?.message?.content?.trim();
    if (!text) {
      const err = new Error(
        `Groq returned no text content (finish_reason=${choice?.finish_reason ?? "unknown"})`
      );
      err.empty = true;
      throw err;
    }
    return text;
  } finally {
    clearTimeout(timer);
  }
}

// OpenAI-compatible Whisper endpoint — same key, same provider, so voice
// notes need zero extra setup. whisper-large-v3-turbo is the fastest model
// that still handles darija/arabic/french well.
const GROQ_TRANSCRIBE_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const GROQ_TRANSCRIBE_MODEL = "whisper-large-v3-turbo";

/**
 * Safety net: even with the prompt rules, the model sometimes slips into
 * markdown. WhatsApp only understands *bold*, _italic_ and plain text, so
 * convert/strip anything else before the message is sent.
 */
export function formatForWhatsApp(text) {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\*\*(.+?)\*\*/g, "*$1*") // **bold** -> *bold*
    .replace(/^#{1,6}\s*(.+)$/gm, "*$1*") // ## Title -> *Title*
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, "$1 : $2") // [t](url) -> t : url
    .replace(/^\s*[-–]\s+/gm, "• ") // "- item" -> "• item"
    .replace(/^\s*\|?\s*:?-{3,}.*$/gm, "") // markdown table separator rows
    .replace(/```/g, "")
    .replace(/\n{3,}/g, "\n\n") // max one blank line
    .trim();
}

/**
 * Splits a long WhatsApp answer into 2 or 3 readable, compact messages
 * (each max 6 to 8 short lines), avoiding overwhelming walls of text.
 * @param {string} text
 * @returns {string[]}
 */
export function splitWhatsAppMessages(text) {
  if (!text || typeof text !== "string") return [];
  const clean = formatForWhatsApp(text);
  const lines = clean.split("\n");

  // If already short (<= 8 lines and under 400 chars), return as single message
  if (lines.length <= 8 && clean.length <= 400) {
    return [clean];
  }

  // Split along double-newline paragraph blocks
  const blocks = clean.split(/\n\s*\n/).filter((b) => b.trim().length > 0);
  if (blocks.length <= 1) {
    // If it's a single block with many lines, split by chunks of ~6 lines
    if (lines.length > 8) {
      const chunks = [];
      for (let i = 0; i < lines.length && chunks.length < 3; i += 6) {
        chunks.push(lines.slice(i, i + 6).join("\n").trim());
      }
      return chunks.filter(Boolean);
    }
    return [clean];
  }

  // If there are 2 to 3 distinct blocks (e.g. details of the 3 packs), return each block as a separate message
  if (blocks.length >= 2 && blocks.length <= 3) {
    return blocks;
  }

  const messages = [];
  let current = [];
  let currentLineCount = 0;

  for (const block of blocks) {
    const blockLines = block.split("\n").length;
    if (current.length > 0 && (currentLineCount + blockLines > 7 || messages.length === 2)) {
      if (messages.length < 2) {
        messages.push(current.join("\n\n"));
        current = [block];
        currentLineCount = blockLines;
      } else {
        // 3rd message receives the rest
        current.push(block);
        currentLineCount += blockLines;
      }
    } else {
      current.push(block);
      currentLineCount += blockLines;
    }
  }

  if (current.length > 0) {
    messages.push(current.join("\n\n"));
  }

  return messages.slice(0, 3);
}

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
 * Call Google Gemini API (v1beta REST endpoint).
 * Uses fetch without external SDK dependencies.
 */
async function callGeminiChat(contents, systemInstructionText, { maxTokens = 1200 }) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not set");
  }
  const model = process.env.GEMINI_MODEL || "gemini-2.0-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  if (timer?.unref) timer.unref();

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents,
        systemInstruction: { parts: [{ text: systemInstructionText }] },
        generationConfig: {
          maxOutputTokens: maxTokens,
          temperature: 0.7,
        },
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const errText = await response.text();
      const err = new Error(`Gemini API error (${response.status}): ${errText}`);
      err.status = response.status;
      throw err;
    }

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts
      ?.map((p) => p.text)
      .join("\n")
      .trim();

    if (!text) {
      const err = new Error("Gemini returned empty text content");
      err.empty = true;
      throw err;
    }
    return text;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Generate a reply to an inbound WhatsApp message.
 * Falls back between Groq and Gemini if either provider fails or is throttled.
 *
 * @param {string} userMessage
 * @param {Array<{role: 'user'|'assistant', content: string}>} history - optional prior turns
 * @param {string} [systemPrompt] - per-business system prompt; falls back to
 *   DEFAULT_SYSTEM_PROMPT when the business hasn't configured one yet.
 */
export async function generateReply(userMessage, history = [], systemPrompt) {
  const prompt = systemPrompt || DEFAULT_SYSTEM_PROMPT;

  const groqMessages = [
    { role: "system", content: prompt },
    ...history,
    { role: "user", content: userMessage },
  ];

  const geminiContents = [
    ...history.map((turn) => ({
      role: turn.role === "assistant" ? "model" : "user",
      parts: [{ text: turn.content }],
    })),
    { role: "user", parts: [{ text: userMessage }] },
  ];

  let replyText = null;
  let groqLastError = null;
  let geminiLastError = null;

  async function executeGroq() {
    if (!process.env.GROQ_API_KEY) return null;
    const attempts = [
      { model: GROQ_MODEL, maxTokens: 1200 },
      { model: GROQ_MODEL, maxTokens: 2000 },
      { model: GROQ_FALLBACK_MODEL, maxTokens: 1200 },
    ];
    const startedAt = Date.now();

    for (let i = 0; i < attempts.length; i++) {
      if (i > 0 && Date.now() - startedAt > GROQ_TOTAL_BUDGET_MS) break;
      const { model, maxTokens } = attempts[i];
      try {
        const text = await callGroqChat(model, groqMessages, { maxTokens, temperature: 0.7 });
        if (text) {
          if (i > 0) console.warn(`generateReply recovered on attempt ${i + 1} (${model})`);
          return text;
        }
      } catch (err) {
        groqLastError = err;
        console.error(`[AI Provider] Groq attempt ${i + 1}/${attempts.length} failed (${model}):`, err.message);
        if (err.status === 401 || err.status === 403) break;
        const next = attempts[i + 1];
        if (next && next.model === model && isRetryableGroqError(err)) {
          const wait = err.retryAfterMs ?? 700;
          if (wait <= 3000) await sleep(wait);
        }
      }
    }
    return null;
  }

  async function executeGemini() {
    if (!process.env.GEMINI_API_KEY) return null;
    try {
      const text = await callGeminiChat(geminiContents, prompt, { maxTokens: 1200 });
      return text;
    } catch (gemErr) {
      geminiLastError = gemErr;
      console.error("[AI Provider] Gemini API attempt failed:", gemErr.message);
      return null;
    }
  }

  const primaryProvider = process.env.PRIMARY_AI_PROVIDER === "gemini" ? "gemini" : "groq";

  if (primaryProvider === "gemini") {
    replyText = await executeGemini();
    if (!replyText && process.env.GROQ_API_KEY) {
      console.warn("[AI Provider] Gemini failed. Falling back to Groq API...");
      replyText = await executeGroq();
      if (replyText) console.log("[AI Provider] Groq fallback succeeded.");
    }
  } else {
    replyText = await executeGroq();
    if (!replyText && process.env.GEMINI_API_KEY) {
      console.warn("[AI Provider] Groq failed. Falling back to Gemini API...");
      replyText = await executeGemini();
      if (replyText) console.log("[AI Provider] Gemini fallback succeeded.");
    }
  }

  if (!replyText) {
    const combinedMsg = groqLastError?.message || geminiLastError?.message || "No AI provider succeeded";
    console.error("[AI Provider] All AI providers failed:", combinedMsg);
    throw (groqLastError || geminiLastError || new Error("All AI providers failed"));
  }

  return formatForWhatsApp(replyText);
}

export { DEFAULT_SYSTEM_PROMPT, PLANS };

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
      max_tokens: 800,
      temperature: 0,
      reasoning_effort: "low",
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