// Preloaded only by scripts/verify-vercel-runtime.mjs. Replaces every external
// fetch before the real Vercel runtime imports application modules.
import { installAdminFixtures } from "./admin-service-fixtures.js";
installAdminFixtures();
