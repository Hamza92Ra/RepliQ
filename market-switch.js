// Visitors can always override the geolocation hint; avoid external geolocation APIs.
// Morocco keeps its original plans, signup calculations and MAD totals.
(() => {
  const key = "repliq-market";
  const known = ["ma", "us"];
  const pathname = location.pathname;
  const isMoroccan = /\/(?:maroc|formulaire-maroc)\.html$/.test(pathname);
  const isUSLanding = pathname === "/" || /\/(?:index|formulaire)\.html$/.test(pathname);
  function remember(market) { try { localStorage.setItem(key, market); } catch {} }
  function preferred() { try { const choice = localStorage.getItem(key); return known.includes(choice) ? choice : null; } catch { return null; } }
  for (const link of document.querySelectorAll("[data-choose-market]")) {
    link.addEventListener("click", () => remember(link.dataset.chooseMarket));
  }
  if (!isUSLanding || isMoroccan) return; // Respect explicit Morocco URLs.
  const go = market => {
    if (market !== "ma") return;
    const form = /\/formulaire\.html$/.test(pathname);
    const destination = form ? "/formulaire-maroc.html" : "/maroc.html";
    location.replace(destination + location.search + location.hash);
  };
  const choice = preferred();
  if (choice) { go(choice); return; }
  fetch("/api/market", { cache: "no-store" }).then(r => r.ok ? r.json() : null)
    .then(data => { if (!preferred()) go(data?.market); }).catch(() => {});
})();
