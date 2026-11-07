import { resolveWhatsAppCredentials } from "./whatsapp-credentials.js";
// lib/templates.js
// WhatsApp Cloud API Template management and variable helpers.
// Outside Meta's 24-hour customer service window, only pre-approved templates
// can be sent to customers.

import { redisPipeline } from "./db.js";

const GRAPH_VERSION = "v21.0";

/**
 * Standard pre-approved Meta WhatsApp templates available out of the box.
 * 'hello_world' is available in all Meta WhatsApp test apps.
 * The French templates reflect standard Utility / Service re-engagement templates.
 */
export const DEFAULT_APPROVED_TEMPLATES = [
  {
    name: "hello_world",
    language: "en_US",
    category: "UTILITY",
    title: "Hello World (Meta Test)",
    body: "Welcome and congratulations! This message demonstrates your ability to send a WhatsApp message using the Cloud API.",
    variables: [],
  },
  {
    name: "reengagement_fr",
    language: "fr",
    category: "UTILITY",
    title: "Relance suite à demande",
    body: "Bonjour {{1}}, nous n'avons pas eu de vos nouvelles concernant votre demande {{2}}. Souhaitez-vous continuer notre échange ?",
    variables: [
      { id: "1", label: "Nom du client", placeholder: "Ex: Mohamed" },
      { id: "2", label: "Objet / Détails", placeholder: "Ex: de devis" },
    ],
  },
  {
    name: "relance_client",
    language: "fr",
    category: "MARKETING",
    title: "Offre & Accompagnement",
    body: "Bonjour {{1}}, l'équipe RepliQ reste à votre entière disposition pour {{2}}. Avez-vous besoin d'assistance supplémentaire ?",
    variables: [
      { id: "1", label: "Nom du client", placeholder: "Ex: Sarah" },
      { id: "2", label: "Sujet", placeholder: "Ex: finaliser votre souscription" },
    ],
  },
  {
    name: "suivi_commande",
    language: "fr",
    category: "UTILITY",
    title: "Suivi de commande / dossier",
    body: "Bonjour {{1}}, nous faisons suite à votre commande {{2}}. Notre équipe est à votre écoute directement ici pour toute question.",
    variables: [
      { id: "1", label: "Nom du client", placeholder: "Ex: Youssef" },
      { id: "2", label: "Référence commande", placeholder: "Ex: CMD-9842" },
    ],
  },
];

/**
 * Replace placeholders like {{1}}, {{2}} with provided variable values.
 *
 * @param {string} body - Template body text
 * @param {Array<string>|object} variables - Values in order [val1, val2] or keyed { "1": val1 }
 * @returns {string} Formatted text
 */
export function renderTemplatePreview(body, variables = []) {
  if (!body) return "";
  const values = Array.isArray(variables) ? variables : [];

  return body.replace(/\{\{(\d+)\}\}/g, (match, index) => {
    const num = parseInt(index, 10);
    const val = values[num - 1];
    if (val !== undefined && String(val).trim() !== "") {
      return String(val).trim();
    }
    return `[Variable ${num}]`;
  });
}

/**
 * Format variable inputs into Meta Graph API components payload.
 *
 * @param {Array<string>|Array<object>} variables
 * @returns {Array<object>|null}
 */
export function buildTemplateComponents(variables) {
  if (!variables) return null;
  const list = Array.isArray(variables) ? variables : [];
  if (list.length === 0) return null;

  const parameters = list.map((v) => {
    const val = typeof v === "object" && v !== null ? v.value ?? v.text ?? "" : v;
    return {
      type: "text",
      text: String(val ?? "").trim(),
    };
  });

  return [
    {
      type: "body",
      parameters,
    },
  ];
}

/**
 * Fetch approved templates:
 * 1. From Meta Cloud API (if WHATSAPP_WABA_ID is configured)
 * 2. From Redis custom templates key ('templates:approved')
 * 3. Falls back to DEFAULT_APPROVED_TEMPLATES
 *
 * @param {string} [phoneNumberId]
 * @returns {Promise<Array<object>>}
 */
export async function getApprovedTemplates(phoneNumberId) {
  const credentials = resolveWhatsAppCredentials(phoneNumberId, { requireToken: false });
  const templatesMap = new Map();

  // 1. Seed with default approved templates
  for (const t of DEFAULT_APPROVED_TEMPLATES) {
    const key = `${t.name}_${t.language}`;
    templatesMap.set(key, t);
  }

  // 2. Fetch custom templates saved in Redis
  try {
    const custom = await redisPipeline([["GET", "templates:approved"]]);
    const raw = custom?.[0]?.result;
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const t of parsed) {
          if (t && t.name) {
            templatesMap.set(`${t.name}_${t.language || "fr"}`, t);
          }
        }
      }
    }
  } catch (err) {
    console.warn("templates.js: Could not load templates from Redis:");
  }

  // 3. If Meta WhatsApp Business Account ID (WABA_ID) is configured, query Meta Graph API
  const wabaId = credentials.wabaId;
  const token = credentials.token;

  if (wabaId && token) {
    try {
      const url = `https://graph.facebook.com/${GRAPH_VERSION}/${wabaId}/message_templates?status=APPROVED&limit=100`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const json = await res.json();
        const data = json?.data || [];
        for (const t of data) {
          if (t.status === "APPROVED") {
            const bodyComponent = t.components?.find((c) => c.type === "BODY");
            const bodyText = bodyComponent?.text || "";

            // Count {{1}}, {{2}} in body
            const matches = [...bodyText.matchAll(/\{\{(\d+)\}\}/g)];
            const varIndices = Array.from(new Set(matches.map((m) => m[1])));
            const variables = varIndices.map((idx) => ({
              id: idx,
              label: `Variable ${idx}`,
              placeholder: `Valeur {{${idx}}}`,
            }));

            const templateObj = {
              name: t.name,
              language: t.language,
              category: t.category,
              title: t.name.replace(/_/g, " "),
              body: bodyText,
              variables,
            };

            templatesMap.set(`${t.name}_${t.language}`, templateObj);
          }
        }
      } else {
        console.warn("templates.js: Meta template fetch responded ");
      }
    } catch (apiErr) {
      console.warn("templates.js: Meta template fetch failed:");
    }
  }

  return Array.from(templatesMap.values());
}
