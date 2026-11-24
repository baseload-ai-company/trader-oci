// One-off: converts a data.json written by the first (simple) publisher into the old dashboard format.
const fs = require('fs');
const f = process.argv[2];
const d = JSON.parse(fs.readFileSync(f, 'utf8'));
if (d.state) { console.log('zaten eski biçim'); process.exit(0); }
const now = Date.parse(d.updated) || Date.now();
const startTs = d.active_since ? Date.parse(d.active_since) : now;
const out = {
  generated_utc: d.updated,
  config: { fee: 0.0005, slip: 0.0005, mmr: 0.005, maxLev: 20, startWallet: d.start_wallet_usdt, baseNotional: 6, maxOpen: 3, minQv_musdt: 50, topN: 10 },
  state: { wallet: d.wallet_usdt, startWallet: d.start_wallet_usdt, version: d.active, createdAt: startTs, activeSince: startTs, switchMinN: d.switch_min_n },
  open: (d.open || []).map((p, i) => {
    const op = Date.parse(p.opened);
    return { id: `open_${i}`, sym: p.sym, side: p.side, lev: p.lev, entry: p.entry, last: p.last, sl: p.sl, tp: p.tp,
      liq: p.entry * (1 - (p.side === 'LONG' ? 1 : -1) * (1 / p.lev - 0.005)), notional_usdt: p.notional_usdt,
      margin_usdt: p.notional_usdt / p.lev, upnl_usdt: p.upnl_usdt, mfe_pct: 0, mae_pct: 0,
      age_h: Math.round((now - op) / 3.6e5) / 10, openedAt: op, version: p.strategy, supports: [p.strategy], lab: false, reason: `${p.strategy} kuralı` };
  }),
  trades: (d.trades || []).slice().reverse().map((t) => ({ ...t, version: t.version || t.strategy, supports: [t.strategy], reason: `${t.strategy} kuralı`, feeIn: 0, feeOut: 0, funding: 0 })),
  equity: [{ ts: startTs, equity: d.start_wallet_usdt }, ...(d.equity || []).map((e) => ({ ts: Date.parse(e.t), equity: e.wallet_usdt }))],
  decisions: (d.runs || []).map((r) => ({ ts: Date.parse(r.t), version: r.active,
    summary: `Gördüm: ${r.movers} hareketli coin tarandı; ${r.open} açık gerçek, ${r.shadowOpen} açık gölge pozisyon.\nKarar: ${r.opened.length ? 'Açılan: ' + r.opened.join('; ') : 'Yeni gerçek pozisyon yok.'}${r.closed.length ? ' Kapanan: ' + r.closed.join('; ') : ''}\nBeklenti: Kural motoru, aktif strateji ${r.active}.`,
    actions: [...r.opened.map((x) => `AÇ ${x}`), ...r.closed.map((x) => `KAPAT ${x}`)] })),
  strategies: [{ version: d.active, at: startTs, rules: (d.lab.find((x) => x.id === d.active) || {}).desc || d.active, reason: 'Oracle Frankfurt üzerinde yeni sistemin başlangıç stratejisi.' }],
  market: null, skipped_open: [], skipped: [],
  lab: (d.lab || []).map((L) => ({ id: L.id, rule: L.desc, status: L.active ? 'aktif' : 'aday' })),
  charts: [],
};
fs.writeFileSync(f, JSON.stringify(out));
console.log('çevrildi');
