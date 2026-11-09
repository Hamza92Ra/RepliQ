// The US /index.html and /formulaire.html and Moroccan pages are explicit choices.
// Only the unqualified homepage (/) may automatically select a market.
(() => {
  const key = "repliq-market";
  const pathname = window.location.pathname;
  const isRoot = pathname === "/";
  const isMoroccan = /\/(?:maroc|formulaire-maroc)\.html$/.test(pathname);
  const isUS = /\/(?:index|formulaire)\.html$/.test(pathname);
  const params = new URLSearchParams(window.location.search);
  const marketParam = params.get("market");
  const valid = market => market === "ma" || market === "us";
  const remember = market => { try { window.localStorage.setItem(key, market); } catch {} };
  const preference = () => { try { const value = window.localStorage.getItem(key); return valid(value) ? value : null; } catch { return null; } };

  document.querySelectorAll("[data-choose-market]").forEach(link => {
    link.addEventListener("click", () => remember(link.dataset.chooseMarket));
  });

  // A direct market URL is authoritative. Visiting either page must never
  // redirect the visitor back to the other market, regardless of IP/cookies.
  if (isMoroccan || isUS) {
    remember(isMoroccan ? "ma" : "us");
    return;
  }
  if (!isRoot) return;

  const navigate = market => {
    if (market === "ma") window.location.replace("/maroc.html" + window.location.hash);
    // Root already serves US HTML; no redirect needed for US.
  };

  // Explicit ?market=us|ma takes precedence over a previous preference or IP.
  if (valid(marketParam)) {
    remember(marketParam);
    navigate(marketParam);
    return;
  }
  const saved = preference();
  if (saved) {
    navigate(saved);
    return;
  }
  fetch("/api/market", { cache: "no-store" })
    .then(response => response.ok ? response.json() : null)
    .then(data => { if (!preference()) navigate(data?.market); })
    .catch(() => {});
})();
