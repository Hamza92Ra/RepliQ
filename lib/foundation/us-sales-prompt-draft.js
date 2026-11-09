// Offline review wrapper only. Production routing never imports foundation code.
import { buildUsSalesPrompt, US_SALES_PROMPT_VERSION } from "../us-sales-prompt.js";

export function buildUsSalesPromptDraft() {
  return Object.freeze({
    id: US_SALES_PROMPT_VERSION,
    status: "draft-not-routed",
    releaseApproved: false,
    requiresVerifiedRepliqSalesOwnership: true,
    purpose: "RepliQ's own US prospect sales assistant; never a charter tenant's guest receptionist",
    systemPrompt: buildUsSalesPrompt(),
  });
}
