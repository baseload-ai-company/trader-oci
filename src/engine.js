// Paper trade engine: positions behave as if opened with real money on Binance USDT-M isolated margin.
// Units: prices USDT, amounts USDT, percentages %. Real book = active strategy (touches wallet); shadow book = every lab
// strategy (never touches the wallet) so strategies can be compared on the same hours.
const bn = require('./binance');
const db = require('./store');
const { STRATEGIES, matches, exitFor } = require('./strategies');

const CFG = {
  fee: 0.0005, // 0.05 % taker per side
  slip: 0.0005, // 0.05 % adverse fill per side
  mmr: 0.005, // maintenance margin rate (public API has no bracket data; conservative default)
  liqBuffer: 0.002, // SL sits at least 0.2 % inside the liquidation distance
  maxLev: 20,
  startWallet: 10,
  baseNotional: 6,
  maxOpen: 3,
  minQv: 50e6,
  topN: 10,
  switchMinN: 10, switchPF: 1.3, switchEdge: 0.3, // trade-count switch rule
  evalEveryTrades: 10, // evaluate after every 10 closed trades (real + lab), not on a clock
};
const MIN = 60_000;
const rd = (x, d = 4) => (x == null || !isFinite(x) ? x : Math.round(x * 10 ** d) / 10 ** d);

// ---------- state ----------
function getState() {
  return db.read('state.json', null) || {
    wallet: CFG.startWallet, startWallet: CFG.startWallet, active: 'v1', activeSince: Date.now(),
    switchMinN: CFG.switchMinN, probation: null, seq: 0, createdAt: Date.now(), history: [], closedSinceEval: 0,
  };
}

const leverageFor = (slPct) => Math.max(1, Math.min(CFG.maxLev, Math.floor(1 / (slPct / 100 + CFG.mmr + CFG.liqBuffer))));
const notionalFor = (s, equity) => Math.max(CFG.baseNotional, Math.floor((CFG.baseNotional * equity) / s.startWallet));

// ---------- indicators (1h completed bars) ----------
function emaSeries(xs, n) { const k = 2 / (n + 1); const out = [xs[0]]; for (let i = 1; i < xs.length; i++) out.push(xs[i] * k + out[i - 1] * (1 - k)); return out; }
function smmaSeries(xs, n) { const out = []; let v = xs.slice(0, n).reduce((a, b) => a + b, 0) / n; for (let i = 0; i < xs.length; i++) { if (i >= n) v = (v * (n - 1) + xs[i]) / n; out.push(i >= n - 1 ? v : null); } return out; }
function indicators(done, last) {
  const cl = done.map((x) => +x[4]);
  const n = cl.length;
  if (n < 30) return {};
  const e9 = emaSeries(cl, 9), e21 = emaSeries(cl, 21);
  const up = e9[n - 1] > e21[n - 1], upPrev = e9[n - 2] > e21[n - 2];
  const med = done.map((x) => (+x[2] + +x[3]) / 2);
  const jaw = smmaSeries(med, 13)[n - 1 - 8], teeth = smmaSeries(med, 8)[n - 1 - 5], lips = smmaSeries(med, 5)[n - 1 - 3];
  const w = cl.slice(-20), mid = w.reduce((a, b) => a + b, 0) / 20;
  const sd = Math.sqrt(w.reduce((a, b) => a + (b - mid) ** 2, 0) / 20);
  return {
    emaX: up && !upPrev ? 1 : !up && upPrev ? -1 : 0,
    emaT: up ? 1 : -1,
    allig: lips > teeth && teeth > jaw ? 1 : lips < teeth && teeth < jaw ? -1 : 0,
    bbp: sd ? rd((last - (mid - 2 * sd)) / (4 * sd), 2) : 0.5,
    bbw: rd(((4 * sd) / mid) * 100, 2),
    ...require('./extra')(done, last),
  };
}

// ---------- market snapshot: BTC + top N movers ----------
async function snapshot() {
  const [tk, pr, info] = await Promise.all([bn.ticker24h(), bn.premiumAll(), bn.exchangeInfo()]);
  const perp = new Set(info.symbols.filter((x) => x.status === 'TRADING' && x.contractType === 'PERPETUAL' && x.quoteAsset === 'USDT').map((x) => x.symbol));
  const prem = new Map(pr.map((p) => [p.symbol, p]));
  const cands = tk
    .filter((t) => perp.has(t.symbol) && prem.has(t.symbol) && +t.quoteVolume >= CFG.minQv)
    .sort((a, b) => Math.abs(+b.priceChangePercent) - Math.abs(+a.priceChangePercent))
    .slice(0, CFG.topN);
  const bySym = new Map(tk.map((t) => [t.symbol, t]));
  const syms = ['BTCUSDT', ...cands.map((c) => c.symbol).filter((x) => x !== 'BTCUSDT')];
  const out = [];
  for (const sym of syms) {
    const k = await bn.klines(sym, '1h', { limit: 61 });
    const done = k.slice(0, -1);
    const cl = done.map((x) => +x[4]);
    const n = cl.length;
    if (n < 30) continue;
    const last = +k[k.length - 1][4];
    let tr = 0;
    for (let i = n - 14; i < n; i++) {
      const h = +done[i][2], l = +done[i][3], pc = +done[i - 1][4];
      tr += Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)) / pc;
    }
    const qv = done.map((x) => +x[7]);
    const qv24 = qv.slice(-25, -1);
    const avgQv = qv24.reduce((a, b) => a + b, 0) / qv24.length;
    const t = bySym.get(sym);
    const hi = +t.highPrice, lo = +t.lowPrice;
    const p = prem.get(sym);
    out.push({
      s: sym, px: last, mark: +p.markPrice,
      ch24: rd(+t.priceChangePercent, 2),
      ch4h: rd((last / cl[n - 4] - 1) * 100, 2),
      ch1h: rd((last / cl[n - 1] - 1) * 100, 2),
      atr1h: rd((tr / 14) * 100, 2),
      vr: rd(qv[n - 1] / avgQv, 2),
      rng: rd(hi > lo ? (last - lo) / (hi - lo) : 0.5, 2),
      fund: rd(+p.lastFundingRate * 100, 4),
      qvM: rd(+t.quoteVolume / 1e6, 0),
      ...indicators(done, last),
    });
  }
  return out;
}

// ---------- 1m replay: same-candle SL+TP => SL (conservative) ----------
function replay(pos, kl, now) {
  const d = pos.dir;
  for (const k of kl) {
    const ot = k[0], o = +k[1], h = +k[2], l = +k[3], c = +k[4], ct = k[6];
    if (ct >= now) break;
    if (ot < pos.checkedTs) continue;
    if (ot - pos.openedAt >= pos.maxHoldMs) return { price: o, reason: 'SÜRE', ts: ot };
    const adverse = d === 1 ? l : h, favorable = d === 1 ? h : l;
    pos.mfe = Math.max(pos.mfe, (d * (favorable - pos.entry) / pos.entry) * 100);
    pos.mae = Math.min(pos.mae, (d * (adverse - pos.entry) / pos.entry) * 100);
    const hitSL = d === 1 ? l <= pos.sl : h >= pos.sl;
    const hitTP = d === 1 ? h >= pos.tp : l <= pos.tp;
    if (hitSL) {
      const gap = d === 1 ? o <= pos.sl : o >= pos.sl;
      const px = gap ? o : pos.sl;
      const beyondLiq = d === 1 ? px <= pos.liq : px >= pos.liq;
      return { price: px, reason: beyondLiq ? 'LİKİDASYON' : 'STOP', ts: ot };
    }
    if (hitTP) return { price: (d === 1 ? o >= pos.tp : o <= pos.tp) ? o : pos.tp, reason: 'TP', ts: ot };
    pos.checkedTs = ct + 1;
    pos.last = c;
  }
  return null;
}

async function klinesSince(symbol, start, now) {
  const out = [];
  let t = Math.ceil(start / MIN) * MIN;
  while (t < now - MIN) {
    const batch = await bn.klines(symbol, '1m', { startTime: t, limit: 1500 });
    if (!batch.length) break;
    out.push(...batch);
    t = batch[batch.length - 1][0] + MIN;
    if (batch.length < 1500) break;
  }
  return out;
}

async function applyFunding(pos, endTs) {
  if (endTs <= pos.fundingCheckedTs) return;
  const fr = await bn.fundingRate(pos.symbol, pos.fundingCheckedTs + 1, endTs);
  for (const f of fr) {
    if (f.fundingTime <= pos.fundingCheckedTs || f.fundingTime > endTs) continue;
    pos.funding -= pos.dir * pos.qty * +f.markPrice * +f.fundingRate; // longs pay positive funding
  }
  pos.fundingCheckedTs = endTs;
}

function buildPos(sid, side, snap, s, equity) {
  const st = STRATEGIES.find((x) => x.id === sid);
  const ex = exitFor(st.exit, snap.atr1h);
  const notional = notionalFor(s, equity);
  const lev = leverageFor(ex.sl_pct);
  const dir = side === 'LONG' ? 1 : -1;
  const entry = snap.mark * (1 + dir * CFG.slip);
  const now = Date.now();
  s.seq += 1;
  return {
    id: `${new Date(now).toISOString().slice(0, 13)}_${s.seq}`, strategy: sid, symbol: snap.s, side, dir, lev,
    entry, qty: notional / entry, notional, margin: notional / lev, feeIn: notional * CFG.fee, funding: 0,
    sl_pct: ex.sl_pct, tp_pct: ex.tp_pct,
    sl: entry * (1 - (dir * ex.sl_pct) / 100), tp: entry * (1 + (dir * ex.tp_pct) / 100),
    liq: entry * (1 - dir * (1 / lev - CFG.mmr)),
    openedAt: now, checkedTs: now, fundingCheckedTs: now, maxHoldMs: ex.max_hold_h * 3.6e6,
    mfe: 0, mae: 0, last: entry, snap,
    reason: `${sid}: ${st.desc} · ch24 ${snap.ch24} % · ch1h ${snap.ch1h} % · vr ${snap.vr}x · ATR1h ${snap.atr1h} %`,
    supports: [sid],
  };
}

function settle(pos, exit, s, real) {
  const liq = exit.reason === 'LİKİDASYON';
  const px = liq ? pos.liq : exit.price * (1 - pos.dir * CFG.slip);
  let gross = pos.qty * (px - pos.entry) * pos.dir;
  let feeOut = pos.qty * px * CFG.fee;
  if (liq) { gross = -pos.margin; feeOut = 0; }
  const net = gross - pos.feeIn - feeOut + pos.funding;
  if (real) s.wallet += net;
  const t = {
    id: pos.id, strategy: pos.strategy, symbol: pos.symbol, side: pos.side, lev: pos.lev,
    openedAt: pos.openedAt, closedAt: exit.ts, holdMin: Math.round((exit.ts - pos.openedAt) / MIN),
    entry: rd(pos.entry, 8), exit: rd(px, 8), sl_pct: pos.sl_pct, tp_pct: pos.tp_pct, notional: rd(pos.notional, 2),
    margin: rd(pos.margin, 4), net: rd(net, 4), roiMarginPct: rd((net / pos.margin) * 100, 1),
    sl: rd(pos.sl, 8), tp: rd(pos.tp, 8), feeIn: rd(pos.feeIn, 6), feeOut: rd(feeOut, 6), funding: rd(pos.funding, 6),
    reason: pos.reason, supports: [pos.strategy], lab: !real, version: pos.strategy,
    mfe: rd(pos.mfe, 2), mae: rd(pos.mae, 2), exitReason: exit.reason, real: !!real,
    ...(real ? { walletAfter: rd(s.wallet, 4) } : {}),
  };
  db.append(real ? 'trades.jsonl' : 'strades.jsonl', t);
  return t;
}

async function processBook(list, s, now, real, cache) {
  const keep = [], closed = [];
  for (const pos of list) {
    const exit = replay(pos, cache.get(pos.symbol) || [], now);
    await applyFunding(pos, exit ? exit.ts : now);
    if (exit) closed.push(settle(pos, exit, s, real));
    else keep.push(pos);
  }
  return { keep, closed };
}

// ---------- stats + trade-count switch rule ----------
function stats(trades) {
  const w = trades.filter((t) => t.net > 0).reduce((a, t) => a + t.net, 0);
  const l = -trades.filter((t) => t.net <= 0).reduce((a, t) => a + t.net, 0);
  return { n: trades.length, net: rd(w - l, 4), pf: l > 0 ? rd(w / l, 2) : w > 0 ? 99 : 0, wr: trades.length ? rd(trades.filter((t) => t.net > 0).length / trades.length, 2) : 0 };
}

function evaluate(s, now) {
  const since = s.activeSince;
  const sh = db.lines('strades.jsonl').filter((t) => t.openedAt >= since);
  const by = Object.fromEntries(STRATEGIES.map((x) => [x.id, stats(sh.filter((t) => t.strategy === x.id))]));
  const act = by[s.active];
  const note = { t: now, active: s.active, stats: by, trigger: `${s.closedSinceEval || 0} closed trades` };
  if (s.probation) { // first 10 real trades after a switch must keep PF >= 1, else the bar goes back to 20
    const rt = db.lines('trades.jsonl').filter((t) => t.openedAt >= s.probation.since);
    if (rt.length >= 10) {
      const p = stats(rt.slice(0, 10));
      s.switchMinN = p.pf < 1 ? 20 : CFG.switchMinN;
      note.probation = { pf: p.pf, minN: s.switchMinN };
      s.probation = null;
    }
  }
  const ranked = Object.entries(by)
    .filter(([id, x]) => id !== s.active && x.n >= s.switchMinN && x.pf >= CFG.switchPF && x.pf >= act.pf + CFG.switchEdge)
    .sort((a, b) => b[1].pf - a[1].pf || b[1].net - a[1].net);
  const best = ranked[0];
  const tied = best ? ranked.filter(([, x]) => x.pf === best[1].pf && x.net === best[1].net).map(([id]) => id) : [];
  if (tied.length > 1) { // tie on PF and net: no switch, wait until the results separate
    note.tie = { ids: tied, pf: best[1].pf, net: best[1].net, n: best[1].n };
  } else if (best) {
    note.switch = { from: s.active, to: best[0], pf: best[1].pf, n: best[1].n, activePf: act.pf };
    s.history.push({ t: now, from: s.active, to: best[0], pf: best[1].pf, n: best[1].n });
    s.active = best[0];
    s.activeSince = now;
    s.probation = { since: now };
  }
  s.closedSinceEval = 0;
  db.append('evals.jsonl', note);
  return note;
}

// ---------- run: every 5 min (scan + exits); minute < 5 = full hourly run (equity, decision log) ----------
async function hour() {
  const now = Date.now();
  const full = new Date(now).getUTCMinutes() < 5;
  const s = getState();
  const cache = new Map();
  const allPos = [...db.read('pos.json', []), ...db.read('spos.json', [])];
  for (const sym of new Set(allPos.map((p) => p.symbol))) // one 1m fetch per symbol from the oldest unchecked minute
    cache.set(sym, await klinesSince(sym, Math.min(...allPos.filter((p) => p.symbol === sym).map((p) => p.checkedTs)), now));
  const realR = await processBook(db.read('pos.json', []), s, now, true, cache);
  const shR = await processBook(db.read('spos.json', []), s, now, false, cache);
  let pos = realR.keep, spos = shR.keep;

  const market = await snapshot();
  const btc = market.find((m) => m.s === 'BTCUSDT');
  db.write('market.json', { ts: now, market: market.filter((m) => m.s !== 'BTCUSDT').map((m) => ({ s: m.s, px: m.px, ch24: m.ch24, ch1h: m.ch1h })) });
  const lastEntry = db.read('cooldown.json', {});
  const opened = [];
  const upnl = pos.reduce((a, p) => a + p.qty * (p.last - p.entry) * p.dir, 0);
  const equity = s.wallet + upnl;
  for (const st of STRATEGIES) {
    for (const m of market) {
      if (m.s === 'BTCUSDT') continue;
      const side = matches(st.long, m, btc) ? 'LONG' : matches(st.short, m, btc) ? 'SHORT' : null;
      if (!side) continue;
      const ck = `${st.id}|${m.s}`;
      const cdH = Math.max(st.cooldownH || 0, 1); // 5-min scan: same strategy+coin never re-enters within 1 h (hourly-run equivalent)
      if (lastEntry[ck] && now - lastEntry[ck] < cdH * 3.6e6) continue;
      if (spos.some((p) => p.strategy === st.id && p.symbol === m.s)) continue;
      spos.push(buildPos(st.id, side, m, s, equity));
      lastEntry[ck] = now;
      if (st.id === s.active && pos.length < CFG.maxOpen && !pos.some((p) => p.symbol === m.s)) {
        const p = buildPos(st.id, side, m, s, equity);
        pos.push(p);
        opened.push(p);
      }
    }
  }
  db.write('pos.json', pos);
  db.write('spos.json', spos);
  db.write('cooldown.json', lastEntry);

  const upnlNow = pos.reduce((a, p) => a + p.qty * (p.last - p.entry) * p.dir + p.funding - p.feeIn, 0);
  if (full) db.append('equity.jsonl', { ts: now, equity: rd(s.wallet + upnlNow, 4) });

  s.closedSinceEval = (s.closedSinceEval || 0) + realR.closed.length + shR.closed.length;
  const evalNote = s.closedSinceEval >= CFG.evalEveryTrades ? evaluate(s, now) : null;
  db.write('state.json', s);

  const summary = {
    t: new Date(now).toISOString(), active: s.active, wallet: rd(s.wallet, 4),
    closed: realR.closed.map((t) => `${t.symbol} ${t.side} ${t.exitReason} ${t.net} USDT`),
    opened: opened.map((p) => `${p.symbol} ${p.side} ${p.lev}x SL ${p.sl_pct}% TP ${p.tp_pct}%`),
    open: pos.length, shadowOpen: spos.length, shadowClosed: shR.closed.length, movers: market.length - 1,
    closedSinceEval: s.closedSinceEval,
    ...(evalNote ? { eval: evalNote.switch || (evalNote.tie ? `beraberlik (${evalNote.tie.ids.join(', ')}), bekleniyor` : 'değişiklik yok') } : {}),
  };
  summary.full = full;
  summary.changed = realR.closed.length + shR.closed.length + opened.length + (spos.length !== shR.keep.length ? 1 : 0) > 0;
  if (full || summary.changed || evalNote) db.append('runs.jsonl', summary);
  return summary;
}

module.exports = { hour, _test: { replay, matches, indicators, leverageFor, stats, evaluate, getState } };
