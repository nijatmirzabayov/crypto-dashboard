(() => {
  const $ = id => document.getElementById(id);
  const REFRESH_MS = 60000;
  let holdings = [];            // [{symbol, coingecko_id, amount, invested}]
  const prices = new Map();     // symbol -> {price, chg, ts, src}
  let sortKey = "value", sortDir = -1, lastError = null, loading = false;

  const usd = (v, sign) => {
    if (v == null || !isFinite(v)) return "—";
    const s = Math.abs(v).toLocaleString("en-US", {minimumFractionDigits: 2, maximumFractionDigits: 2});
    return (v < 0 ? "−$" : (sign && v > 0 ? "+$" : "$")) + s;
  };
  const pct = (v, sign = true) => v == null || !isFinite(v) ? "—" : (v < 0 ? "−" : (sign && v > 0 ? "+" : "")) + Math.abs(v).toFixed(1) + "%";
  const px = v => {
    if (v == null || !isFinite(v)) return "—";
    const d = v >= 100 ? 2 : v >= 1 ? 3 : v >= 0.1 ? 4 : v >= 0.01 ? 5 : 6;
    return "$" + v.toLocaleString("en-US", {minimumFractionDigits: d, maximumFractionDigits: d});
  };
  const amt = v => v.toLocaleString("en-US", {maximumFractionDigits: v >= 100 ? 2 : v >= 1 ? 4 : 6});
  const cls = v => v > 0 ? "pos" : v < 0 ? "neg" : "";
  const el = (tag, props = {}, text) => { const e = document.createElement(tag); Object.assign(e, props); if (text != null) e.textContent = text; return e; };

  function rowsData() {
    const list = holdings.map(h => {
      const p = prices.get(h.symbol);
      const price = p ? p.price : null;
      const value = price != null ? h.amount * price : null;
      const avg = h.amount > 0 ? h.invested / h.amount : null;
      const chg = p && p.chg != null ? p.chg : null;
      return {sym: h.symbol, amount: h.amount, invested: h.invested, avg, price, chg, value,
        pl: value != null ? value - h.invested : null,
        plp: value != null && h.invested > 0 ? (value / h.invested - 1) * 100 : null,
        be: price != null && avg != null ? (avg / price - 1) * 100 : null,
        prev: value != null ? (chg != null ? value / (1 + chg / 100) : value) : null};
    });
    const total = list.reduce((s, r) => s + (r.value || 0), 0);
    list.forEach(r => r.weight = r.value != null && total > 0 ? r.value / total * 100 : null);
    return list;
  }

  function render() {
    const list = rowsData();
    const k = sortKey;
    list.sort((a, b) => {
      if (k === "sym") return a.sym.localeCompare(b.sym) * sortDir;
      const x = a[k], y = b[k];
      if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1;
      return (x - y) * sortDir;
    });
    document.querySelectorAll("#tbl th[data-k]").forEach(th => th.setAttribute("aria-sort", th.dataset.k === k ? (sortDir > 0 ? "ascending" : "descending") : "none"));

    const tb = $("rows"); tb.replaceChildren();
    for (const r of list) {
      const tr = el("tr");
      const c0 = el("td", {className: "coin"}, r.sym);
      if (r.price == null && prices.size) c0.append(el("small", {}, "no live price"));
      tr.append(c0,
        el("td", {className: "n"}, amt(r.amount)),
        el("td", {className: "n"}, px(r.avg)),
        el("td", {className: "n" + (r.price == null ? " na" : "")}, px(r.price)),
        el("td", {className: "n " + cls(r.chg)}, pct(r.chg)),
        el("td", {className: "n"}, usd(r.value)),
        el("td", {className: "n"}, usd(r.invested)),
        el("td", {className: "n " + cls(r.pl)}, usd(r.pl, true)),
        el("td", {className: "n " + cls(r.plp)}, pct(r.plp)),
        el("td", {className: "n"}, r.be == null ? "—" : r.be <= 0 ? "in profit" : "+" + r.be.toFixed(0) + "%"));
      const wtd = el("td", {className: "n"});
      if (r.weight != null) {
        const w = el("div", {className: "w", title: r.sym + " is " + r.weight.toFixed(1) + "% of current value"});
        const bar = el("span", {className: "wbar"}); const fill = el("i"); fill.style.width = Math.min(100, r.weight) + "%"; bar.append(fill);
        w.append(el("span", {}, r.weight.toFixed(1) + "%"), bar); wtd.append(w);
      } else wtd.textContent = "—";
      tr.append(wtd);
      tb.append(tr);
    }

    const inv = list.reduce((s, r) => s + r.invested, 0);
    const priced = list.filter(r => r.value != null);
    const val = priced.reduce((s, r) => s + r.value, 0);
    const invPriced = priced.reduce((s, r) => s + r.invested, 0);
    const prev = priced.reduce((s, r) => s + r.prev, 0);
    const pl = val - invPriced, d24 = val - prev;
    const has = priced.length > 0;

    const foot = $("foot"); foot.replaceChildren();
    if (list.length) {
      const tr = el("tr");
      tr.append(el("td", {}, "Total"), el("td"), el("td"), el("td"),
        el("td", {className: "n " + cls(d24)}, has && prev ? pct((val / prev - 1) * 100) : "—"),
        el("td", {className: "n"}, has ? usd(val) : "—"),
        el("td", {className: "n"}, usd(inv)),
        el("td", {className: "n " + cls(pl)}, has ? usd(pl, true) : "—"),
        el("td", {className: "n " + cls(pl)}, has && invPriced ? pct((val / invPriced - 1) * 100) : "—"),
        el("td"), el("td"));
      foot.append(tr);
    }

    $("k-value").textContent = has ? usd(val) : "—";
    $("k-value-s").textContent = !list.length ? " " : priced.length === list.length ? priced.length + " coins priced" : priced.length + " of " + list.length + " coins priced";
    $("k-inv").textContent = list.length ? usd(inv) : "—";
    $("k-inv-s").textContent = list.length ? list.length + " coins" : " ";
    const kpl = $("k-pl"); kpl.textContent = has ? usd(pl, true) : "—"; kpl.className = "v " + cls(pl);
    const kpls = $("k-pl-s"); kpls.textContent = has && invPriced ? pct((val / invPriced - 1) * 100) : " "; kpls.className = "s " + cls(pl);
    const k24 = $("k-24"); k24.textContent = has ? usd(d24, true) : "—"; k24.className = "v " + cls(d24);
    const k24s = $("k-24-s"); k24s.textContent = has && prev ? pct((val / prev - 1) * 100) : " "; k24s.className = "s " + cls(d24);
    $("count").textContent = list.length ? list.length + " coins" : "";
    renderLive();
  }

  function renderLive() {
    const dot = $("dot"), t = $("liveText"), banner = $("banner");
    const ts = [...prices.values()].map(p => p.ts).filter(Boolean);
    const last = ts.length ? Math.max(...ts) : null;
    if (lastError && !prices.size) {
      dot.className = "dot bad"; t.textContent = "Live prices unavailable";
      banner.textContent = lastError; banner.hidden = false; return;
    }
    banner.hidden = !lastError; if (lastError) banner.textContent = lastError;
    if (!last) { dot.className = "dot"; t.textContent = loading ? "Loading prices…" : "Waiting for prices"; return; }
    const age = (Date.now() - last) / 1000;
    const missing = holdings.filter(h => !prices.has(h.symbol)).length;
    dot.className = "dot " + (missing || age > 600 || lastError ? "stale" : "ok");
    t.textContent = "Prices as of " + new Date(last).toLocaleTimeString([], {hour: "2-digit", minute: "2-digit"}) +
      (missing ? " · " + missing + " coin" + (missing > 1 ? "s" : "") + " without a price" : "");
  }

  async function fetchJSON(url, ms = 15000) {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
    try {
      const r = await fetch(url, {signal: ctl.signal, cache: "no-store"});
      if (!r.ok) { const e = new Error("HTTP " + r.status); e.status = r.status; throw e; }
      return await r.json();
    } finally { clearTimeout(t); }
  }

  async function loadPrices() {
    if (!holdings.length || loading) return;
    loading = true; renderLive();
    const b = $("refresh"); b.disabled = true; b.textContent = "Refreshing…";
    let cgError = null;
    const ids = [...new Set(holdings.map(h => h.coingecko_id).filter(Boolean))];
    if (ids.length) {
      try {
        const d = await fetchJSON("https://api.coingecko.com/api/v3/simple/price?vs_currencies=usd&include_24hr_change=true&include_last_updated_at=true&ids=" + encodeURIComponent(ids.join(",")));
        for (const h of holdings) {
          const q = d[h.coingecko_id];
          if (q && typeof q.usd === "number" && q.usd > 0)
            prices.set(h.symbol, {price: q.usd, chg: typeof q.usd_24h_change === "number" ? q.usd_24h_change : null, ts: q.last_updated_at ? q.last_updated_at * 1000 : Date.now(), src: "CoinGecko"});
        }
      } catch (e) { cgError = e; }
    }
    // Backup source for anything CoinGecko didn't price this round.
    const fresh = Date.now() - 5 * 60000;
    const need = holdings.filter(h => { const p = prices.get(h.symbol); return !p || (cgError && p.ts < fresh); });
    await Promise.all(need.map(async h => {
      try {
        const d = await fetchJSON("https://api.coinbase.com/v2/prices/" + encodeURIComponent(h.symbol) + "-USD/spot", 10000);
        const v = parseFloat(d && d.data && d.data.amount);
        if (isFinite(v) && v > 0) {
          const old = prices.get(h.symbol);
          prices.set(h.symbol, {price: v, chg: old ? old.chg : null, ts: Date.now(), src: "Coinbase"});
        }
      } catch (e) {}
    }));
    if (cgError) {
      lastError = cgError.status === 429
        ? "CoinGecko's free price feed is busy right now. Prices will update on the next refresh" + (prices.size ? "; some come from Coinbase meanwhile." : ".")
        : "Couldn't reach CoinGecko. " + (prices.size ? "Showing prices from Coinbase where available." : "Check your connection and press Refresh prices.");
    } else lastError = null;
    loading = false; b.disabled = false; b.textContent = "Refresh prices";
    render();
  }

  async function loadHoldings() {
    try {
      const d = await fetchJSON("holdings.json");
      if (d.title) { document.title = d.title; $("h1").textContent = d.title; }
      holdings = (d.holdings || []).map(h => ({symbol: String(h.symbol).toUpperCase(), coingecko_id: h.coingecko_id || "", amount: Number(h.amount), invested: Number(h.invested)}))
        .filter(h => h.symbol && isFinite(h.amount) && isFinite(h.invested));
      $("empty").hidden = holdings.length > 0; $("tbl").hidden = holdings.length === 0;
      if (!holdings.length) $("empty").textContent = "No holdings listed yet. Add coins to holdings.json in the repository.";
      render();
      return true;
    } catch (e) {
      $("tbl").hidden = true; const em = $("empty"); em.hidden = false;
      em.textContent = "The holdings list (holdings.json) couldn't be loaded. Reload the page to try again.";
      $("dot").className = "dot bad"; $("liveText").textContent = "Holdings unavailable";
      return false;
    }
  }

  document.querySelectorAll("#tbl th[data-k]").forEach(th => {
    th.tabIndex = 0;
    const go = () => { const k = th.dataset.k; if (sortKey === k) sortDir = -sortDir; else { sortKey = k; sortDir = k === "sym" ? 1 : -1; } render(); };
    th.onclick = go; th.onkeydown = e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } };
  });
  $("refresh").onclick = loadPrices;

  let timer = null;
  const schedule = () => { clearInterval(timer); timer = setInterval(() => { if (!document.hidden) loadPrices(); }, REFRESH_MS); };
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { const ts = [...prices.values()].map(p => p.ts); if (!ts.length || Date.now() - Math.max(...ts) > REFRESH_MS) loadPrices(); } });
  setInterval(renderLive, 30000);

  loadHoldings().then(ok => { if (ok) { loadPrices(); schedule(); } });
})();
