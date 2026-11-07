import router from "../api/admin.js";

// Preserve the old tests' handler interfaces while exercising the deployed router.
export function adminRoute(name) {
  return (req, res) => router(Object.assign(req, { url: `/api/admin/${name}` }), res);
}
