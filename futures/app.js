(() => {
  const $ = id => document.getElementById(id);
  const REFRESH_MS = 30000;
  let book = null;              // parsed positions.json
  let trades = [];              // normalised trades
  const prices = new Map();     // symbol -> {price, ts, src}
  let period = "day", lastError = null, loading = false;

  try { const p = localStorage.getItem("futures.period"); if (["day", "week", "month"].includes(p)) period = p; } catch (e) {}

  const money = (v, sign) => {
    if (v == null || !isFinite(v)) return "—";
    const s = Math.abs(v).toLocaleString("en-US", {minimumFractionDigits: 2, maximumFractionDigits: 2});
    return (v < 0 ? "−$" : (sign && v > 0 ? "+$" : "$")) + s;
  };
  const pct = (v, sign = true) => v == null || !isFinite(v) ? "—" : (v < 0 ? "−" : (sign && v > 0 ? "+" : "")) + Math.abs(v).toFixed(2) + "%";
  const px = v => {
    if (v == null || !isFinite(v)) return "—";
    const d = v >= 1000 ? 2 : v >= 10 ? 3 : v >= 1 ? 4 : v >= 0.01 ? 5 : 7;
    return "$" + v.toLocaleString("en-US", {minimumFractionDigits: d, maximumFractionDigits: d});
  };
  const qty = v => v.toLocaleString("en-US", {maximumFractionDigits: v >= 100 ? 0 : 6});
  const sizeCell = t => { const c = td(money(notional(t))); c.append(el("small", {}, qty(t.size) + " " + t.symbol.replace(/USDT$/, ""))); return c; };
  const cls = v => v > 0 ? "pos" : v < 0 ? "neg" : "";
  const el = (tag, props = {}, text) => { const e = document.createElement(tag); Object.assign(e, props); if (text != null) e.textContent = text; return e; };
  const td = (text, c = "n") => el("td", {className: c}, text);

  // "2026-10-20" is a date with no time: local midnight, shown as a date only.
  function parseTime(s) {
    if (s == null || s === "") return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (m) return {t: new Date(+m[1], m[2] - 1, +m[3]).getTime(), dateOnly: true};
    const t = Date.parse(s);
    return isFinite(t) ? {t, dateOnly: false} : null;
  }
  const fmtTime = p => !p ? "—" : new Date(p.t).toLocaleString([], p.dateOnly
    ? {year: "numeric", month: "short", day: "numeric"}
    : {year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"});
  const held = (a, b) => {
    if (!a || !b) return "—";
    const mins = Math.max(0, Math.round((b - a) / 60000));
    const d = Math.floor(mins / 1440), h = Math.floor(mins % 1440 / 60), m = mins % 60;
    return d ? d + "d " + h + "h" : h ? h + "h " + m + "m" : m + "m";
  };

  const dir = t => t.side === "short" ? -1 : 1;
  const notional = t => t.entry * t.size;
  const pnlAt = (t, price) => price == null ? null : (price - t.entry) * t.size * dir(t) - t.fees + t.funding;
  const retPct = (t, pnl) => pnl == null || !notional(t) ? null : pnl / (notional(t) / (t.leverage || 1)) * 100;

  // Period keys in local time; weeks start on Monday.
  function periodStart(ms, p) {
    const d = new Date(ms);
    if (p === "day") return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    if (p === "month") return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
    const back = (d.getDay() + 6) % 7;
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() - back).getTime();
  }
  function periodEnd(start, p) {
    const d = new Date(start);
    if (p === "day") return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
    if (p === "month") return new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7).getTime();
  }
  function periodLabel(start, p) {
    const d = new Date(start);
    if (p === "day") return d.toLocaleDateString([], {weekday: "short", year: "numeric", month: "short", day: "numeric"});
    if (p === "month") return d.toLocaleDateString([], {year: "numeric", month: "long"});
    const e = new Date(periodEnd(start, p) - 1);
    return d.toLocaleDateString([], {month: "short", day: "numeric"}) + " – " + e.toLocaleDateString([], {month: "short", day: "numeric", year: "numeric"});
  }

  function state() {
    const start = book.starting_balance;
    const deposits = (book.deposits || []).map(x => ({p: parseTime(x.time), amount: Number(x.amount) || 0}));
    const depTotal = deposits.reduce((s, x) => s + x.amount, 0);
    const closed = trades.filter(t => t.closedP).sort((a, b) => a.closedP.t - b.closedP.t);
    const open = trades.filter(t => !t.closedP);
    let cum = 0;
    for (const t of closed) {
      t.pnl = pnlAt(t, t.exit);
      cum += t.pnl;
      t.balAfter = start + cum + deposits.filter(x => x.p && x.p.t <= t.closedP.t).reduce((s, x) => s + x.amount, 0);
    }
    for (const t of open) { const p = prices.get(t.symbol); t.mark = p ? p.price : null; t.pnl = pnlAt(t, t.mark); }
    const realised = closed.reduce((s, t) => s + t.pnl, 0);
    const pricedOpen = open.filter(t => t.pnl != null);
    const unreal = pricedOpen.reduce((s, t) => s + t.pnl, 0);
    const base = start + depTotal;
    return {start, deposits, depTotal, closed, open, realised, unreal, base,
      allPriced: pricedOpen.length === open.length, wallet: base + realised, equity: base + realised + unreal};
  }

  function render() {
    if (!book) return;
    const s = state();
    const now = Date.now();
    const has = s.allPriced;

    const set = (id, text, c) => { const e = $(id); e.textContent = text; if (c != null) e.className = c; };
    set("k-bal", has ? money(s.equity) : money(s.wallet) + "*");
    set("k-bal-s", has ? "Wallet " + money(s.wallet) + " · start " + money(s.start) : "* waiting for live prices");
    const tot = s.realised + (has ? s.unreal : 0);
    const chg = s.base ? tot / s.base * 100 : null;
    set("k-chg", pct(chg), "v " + cls(tot));
    set("k-chg-s", "from " + money(s.base) + (s.depTotal ? " incl. deposits" : " starting"));
    set("k-real", money(s.realised, true), "v " + cls(s.realised));
    set("k-real-s", s.closed.length + " closed trade" + (s.closed.length === 1 ? "" : "s"));
    set("k-open", s.open.length ? (has ? money(s.unreal, true) : "—") : money(0), "v " + cls(has ? s.unreal : 0));
    set("k-open-s", s.open.length + " open position" + (s.open.length === 1 ? "" : "s"));
    set("k-tot", has ? money(tot, true) : "—", "v " + cls(tot));
    set("k-tot-s", has ? pct(chg) + " of start" : " ");

    for (const [id, p] of [["k-d", "day"], ["k-w", "week"], ["k-m", "month"]]) {
      const a = periodStart(now, p);
      const r = s.closed.filter(t => t.closedP.t >= a).reduce((x, t) => x + t.pnl, 0);
      const g = r + (has ? s.unreal : 0);
      set(id, has ? money(g, true) : "—", "v " + cls(g));
      set(id + "-s", (has ? pct(s.base ? g / s.base * 100 : null) : "") + " · realised " + money(r, true));
    }

    renderOpen(s, now);
    renderPeriods(s, now);
    renderHistory(s);
    renderLive();
  }

  function sideTag(t) { return el("span", {className: "tag " + t.side}, t.side); }

  function renderOpen(s, now) {
    const tb = $("openRows"); tb.replaceChildren(); $("openFoot").replaceChildren();
    $("openEmpty").hidden = s.open.length > 0; $("openTbl").hidden = !s.open.length;
    $("openCount").textContent = s.open.length ? s.open.length + " open" : "";
    for (const t of s.open) {
      const tr = el("tr");
      const c0 = el("td", {className: "sym"}, t.symbol);
      if (t.notes) c0.append(el("small", {}, t.notes));
      const sd = el("td"); sd.append(sideTag(t));
      const ret = retPct(t, t.pnl);
      tr.append(c0, sd, sizeCell(t), td(t.leverage ? t.leverage + "×" : "—"), td(px(t.entry)),
        td(px(t.mark), "n" + (t.mark == null ? " muted" : "")), td(money(t.mark == null ? null : t.mark * t.size)),
        td(fmtTime(t.openedP)), td(held(t.openedP && t.openedP.t, now)), td(money(t.fees - t.funding)),
        td(money(t.pnl, true), "n " + cls(t.pnl)), td(pct(ret), "n " + cls(ret)));
      tb.append(tr);
    }
    if (s.open.length > 1) {
      const tr = el("tr");
      tr.append(td("Total", ""), el("td"), el("td"), el("td"), el("td"), el("td"),
        td(s.allPriced ? money(s.open.reduce((x, t) => x + t.mark * t.size, 0)) : "—"), el("td"), el("td"), el("td"),
        td(s.allPriced ? money(s.unreal, true) : "—", "n " + cls(s.unreal)), el("td"));
      $("openFoot").append(tr);
    }
  }

  function renderPeriods(s, now) {
    document.querySelectorAll(".seg button").forEach(b => b.setAttribute("aria-pressed", b.dataset.p === period));
    const tb = $("perRows"); tb.replaceChildren();
    const cur = periodStart(now, period);
    const keys = new Set([cur, ...s.closed.map(t => periodStart(t.closedP.t, period))]);
    const list = [...keys].sort((a, b) => b - a);
    for (const k of list) {
      const end = periodEnd(k, period);
      const ts = s.closed.filter(t => t.closedP.t >= k && t.closedP.t < end);
      const r = ts.reduce((x, t) => x + t.pnl, 0);
      const wins = ts.filter(t => t.pnl > 0).length, losses = ts.filter(t => t.pnl < 0).length;
      const isCur = k === cur;
      const incl = isCur ? (s.allPriced ? r + s.unreal : null) : r;
      const dep = s.deposits.filter(x => x.p && x.p.t < end).reduce((x, d) => x + d.amount, 0);
      const realThrough = s.closed.filter(t => t.closedP.t < end).reduce((x, t) => x + t.pnl, 0);
      const balEnd = s.start + dep + realThrough + (isCur ? (s.allPriced ? s.unreal : 0) : 0);
      const tr = el("tr", {className: isCur ? "current" : ""});
      const c0 = el("td", {}, periodLabel(k, period));
      if (isCur) c0.append(el("small", {}, "current, so far"));
      tr.append(c0, td(String(ts.length)), td(wins + " / " + losses), td(money(r, true), "n " + cls(r)),
        td(money(incl, true), "n " + cls(incl)), td(pct(incl == null || !s.base ? null : incl / s.base * 100), "n " + cls(incl)),
        td(isCur && !s.allPriced ? "—" : money(balEnd)));
      tb.append(tr);
    }
  }

  function renderHistory(s) {
    const tb = $("histRows"); tb.replaceChildren();
    $("histEmpty").hidden = s.closed.length > 0;
    tb.parentElement.hidden = !s.closed.length;
    const wins = s.closed.filter(t => t.pnl > 0).length;
    $("histCount").textContent = s.closed.length ? s.closed.length + " trades · " + Math.round(wins / s.closed.length * 100) + "% winners" : "";
    for (const t of [...s.closed].reverse()) {
      const tr = el("tr");
      const sd = el("td"); sd.append(sideTag(t));
      const ret = retPct(t, t.pnl);
      tr.append(td(String(t.id ?? "")), td(t.symbol, "sym"), sd, sizeCell(t), td(t.leverage ? t.leverage + "×" : "—"),
        td(px(t.entry)), td(px(t.exit)), td(fmtTime(t.openedP)), td(fmtTime(t.closedP)),
        td(held(t.openedP && t.openedP.t, t.closedP.t)), td(money(t.fees - t.funding)),
        td(money(t.pnl, true), "n " + cls(t.pnl)), td(pct(ret), "n " + cls(ret)), td(money(t.balAfter)),
        el("td", {className: "notes"}, t.notes || ""));
      tb.append(tr);
    }
  }

  function renderLive() {
    const dot = $("dot"), t = $("liveText"), banner = $("banner");
    const open = trades.filter(x => !x.closedP);
    banner.hidden = !lastError; if (lastError) banner.textContent = lastError;
    if (!open.length) { dot.className = "dot ok"; t.textContent = "No open positions, nothing to price"; return; }
    const ts = open.map(x => prices.get(x.symbol)).filter(Boolean).map(p => p.ts);
    if (!ts.length) { dot.className = "dot " + (lastError ? "bad" : ""); t.textContent = loading ? "Loading prices…" : "Live prices unavailable"; return; }
    const last = Math.max(...ts), missing = open.filter(x => !prices.has(x.symbol)).length;
    const srcs = [...new Set(open.map(x => prices.get(x.symbol)).filter(Boolean).map(p => p.src))].join(", ");
    dot.className = "dot " + (missing || Date.now() - last > 300000 ? "stale" : "ok");
    t.textContent = "Mark prices as of " + new Date(last).toLocaleTimeString([], {hour: "2-digit", minute: "2-digit", second: "2-digit"}) + " · " + srcs +
      (missing ? " · " + missing + " without a price" : "");
  }

  async function fetchJSON(url, ms = 10000) {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
    try {
      const r = await fetch(url, {signal: ctl.signal, cache: "no-store"});
      if (!r.ok) throw new Error("HTTP " + r.status);
      return await r.json();
    } finally { clearTimeout(t); }
  }

  // Futures mark price first; each source is tried in order until one answers.
  const SOURCES = [
    ["Binance", async sym => parseFloat((await fetchJSON("https://fapi.binance.com/fapi/v1/premiumIndex?symbol=" + sym)).markPrice)],
    ["Bybit", async sym => parseFloat((await fetchJSON("https://api.bybit.com/v5/market/tickers?category=linear&symbol=" + sym)).result.list[0].markPrice)],
    ["OKX", async sym => parseFloat((await fetchJSON("https://www.okx.com/api/v5/public/mark-price?instType=SWAP&instId=" + sym.replace(/USDT$/, "") + "-USDT-SWAP")).data[0].markPx)],
  ];

  async function priceOf(t) {
    for (const [src, f] of SOURCES) {
      try { const v = await f(encodeURIComponent(t.symbol)); if (isFinite(v) && v > 0) return {price: v, ts: Date.now(), src}; } catch (e) {}
    }
    if (t.coingecko_id) {
      try {
        const d = await fetchJSON("https://api.coingecko.com/api/v3/simple/price?vs_currencies=usd&ids=" + encodeURIComponent(t.coingecko_id));
        const v = d[t.coingecko_id] && d[t.coingecko_id].usd;
        if (v > 0) return {price: v, ts: Date.now(), src: "CoinGecko spot"};
      } catch (e) {}
    }
    return null;
  }

  async function loadPrices() {
    const open = trades.filter(t => !t.closedP);
    if (!open.length || loading) { render(); return; }
    loading = true; renderLive();
    const b = $("refresh"); b.disabled = true; b.textContent = "Refreshing…";
    const syms = [...new Map(open.map(t => [t.symbol, t])).values()];
    const got = await Promise.all(syms.map(async t => [t.symbol, await priceOf(t)]));
    let failed = 0;
    for (const [sym, p] of got) { if (p) prices.set(sym, p); else failed++; }
    lastError = failed ? "Couldn't get a live price for " + failed + " position" + (failed > 1 ? "s" : "") + (prices.size ? "; showing the last price received." : ". Balance shows realised results only until prices load.") : null;
    loading = false; b.disabled = false; b.textContent = "Refresh prices";
    render();
  }

  async function loadBook() {
    try {
      const d = await fetchJSON("positions.json");
      book = {...d, starting_balance: Number(d.starting_balance) || 0};
      if (d.title) { document.title = d.title; $("h1").textContent = d.title; }
      trades = (d.trades || []).map(t => ({
        id: t.id, symbol: String(t.symbol).toUpperCase(), coingecko_id: t.coingecko_id || "",
        side: String(t.side).toLowerCase() === "short" ? "short" : "long",
        // Size is in USDT at entry (size_usdt); a plain size is a coin quantity.
        size: t.size_usdt != null ? Number(t.size_usdt) / Number(t.entry) : Number(t.size), entry: Number(t.entry), exit: t.exit == null ? null : Number(t.exit),
        leverage: Number(t.leverage) || null, fees: Number(t.fees) || 0, funding: Number(t.funding) || 0,
        openedP: parseTime(t.opened), closedP: t.exit == null ? null : parseTime(t.closed), notes: t.notes || ""
      })).filter(t => t.symbol && isFinite(t.size) && isFinite(t.entry));
      const up = parseTime(d.updated);
      $("updated").textContent = up ? "Last updated " + fmtTime(up) + "." : "";
      render();
      return true;
    } catch (e) {
      $("dot").className = "dot bad"; $("liveText").textContent = "Positions unavailable";
      const b = $("banner"); b.hidden = false; b.textContent = "The positions file (positions.json) couldn't be loaded. Reload the page to try again.";
      return false;
    }
  }

  document.querySelectorAll(".seg button").forEach(b => b.onclick = () => {
    period = b.dataset.p; try { localStorage.setItem("futures.period", period); } catch (e) {}
    render();
  });
  $("refresh").onclick = loadPrices;
  document.addEventListener("visibilitychange", () => { if (!document.hidden) loadPrices(); });

  loadBook().then(ok => {
    if (!ok) return;
    loadPrices();
    setInterval(() => { if (!document.hidden) loadPrices(); }, REFRESH_MS);
  });
})();
