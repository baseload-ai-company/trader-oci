// Binance Square + Agent Resume: ONE combined post per hour (full run at :01) covering every real open/close since the
// last post. English, human tone, emojis; per coin: long/short count, win rate %, profit factor and a performance label.
// Square key: ~/.square-key (never logged). Agent Resume: feed.json on gh-pages, pulled by alibingul-dev.github.io
// trader-feed workflow. End-of-day recap at the first run after Istanbul midnight. Never throws.
const fs = require('fs');
const path = require('path');
const os = require('os');
const db = require('./store');

const URL_ADD = 'https://www.binance.com/bapi/composite/v1/public/pgc/openApi/content/add';
const REPO = 'baseload-ai-company/trader-oci';
const AGENT = 'crypto-trader';
const readKey = (f) => { try { return fs.readFileSync(path.join(os.homedir(), f), 'utf8').trim(); } catch { return ''; } };

const nf = (loc) => (x, d) => Number(x).toLocaleString(loc, d == null ? { maximumSignificantDigits: 7 } : { minimumFractionDigits: d, maximumFractionDigits: d });
const EN = nf('en-US'), TR = nf('tr-TR');
const sgn = (fmt, x, d) => (x > 0 ? '+' : '') + fmt(x, d);
const coin = (s) => String(s).replace(/USDT$/, '');
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const pct = (a, b) => Math.abs((b / a - 1) * 100);

const recEN = (r) => {
  if (!r.n) return { line: pick([`First time trading ${r.tag} here.`, `New coin for me, no history on ${r.tag} yet.`]), v: '' };
  const side = [r.L && `${r.L} long`, r.S && `${r.S} short`].filter(Boolean).join(' / ');
  const pf = r.pf === Infinity ? 'no losing trade yet' : `profit factor ${EN(r.pf, 2)}`;
  const s = r.n > 1 ? 's' : '';
  const v = {
    early: [`Too early to judge ${r.tag}.`, `Not enough trades to call ${r.tag} yet.`],
    perfect: [`${r.tag} is my star so far ⭐`, `Can't lose on ${r.tag} lately 🌟`],
    star: [`${r.tag} = star coin for me ⭐`, `${r.tag} keeps paying, star material ⭐`],
    solid: [`${r.tag} is a solid one 👍`, `${r.tag} treats me well 👍`],
    flip: [`${r.tag} is a coin flip so far 🪙`, `${r.tag} = pure coin flip for me 🪙`],
    headache: [`${r.tag} gives me headaches 🤕`, `${r.tag} and me don't get along 🤕`],
    shit: [`${r.tag} = certified shitcoin for me 💩`, `${r.tag} is a shitcoin in my book 💩`],
  }[r.cat];
  return { v: pick(v), line: pick([`My ${r.tag} record so far: ${r.n} trade${s} (${side}), ${r.wr}% win rate, ${pf}.`, `${r.tag} track record: ${r.n} trade${s}, ${side}, won ${r.wr}% of them, ${pf}.`]) };
};
const recTR = (r) => {
  if (!r.n) return { line: `${r.tag} ile ilk işlemim.`, v: '' };
  const side = [r.L && `${r.L} long`, r.S && `${r.S} short`].filter(Boolean).join(' / ');
  const pf = r.pf === Infinity ? 'henüz zararlı işlem yok' : `profit factor ${TR(r.pf, 2)}`;
  const v = { early: `${r.tag} için karar vermek erken.`, perfect: `${r.tag} şimdilik yıldızım ⭐`, star: `${r.tag} benim yıldız coinim ⭐`,
    solid: `${r.tag} sağlam çıkıyor 👍`, flip: `${r.tag} şimdilik yazı tura 🪙`, headache: `${r.tag} baş ağrıtıyor 🤕`, shit: `${r.tag} benim için tam bir shitcoin 💩` }[r.cat];
  return { v, line: `${r.tag} geçmişim: ${r.n} işlem (${side}), kazanma oranı %${r.wr}, ${pf}.` };
};

// ---------- texts ----------
function openEN(p, r) {
  const t = r.tag, up = p.side === 'LONG', rc = recEN(r);
  const hook = up
    ? pick([`${t} still has legs, going long here 🚀`, `Longing ${t}. Momentum hasn't cooled off yet 🔥`, `${t} keeps pushing, I'm in long 📈`, `Taking a long on ${t}, volume is there 👀`, `${t} looks like it wants more. Long 💪`])
    : pick([`${t} is bleeding, shorting it 🩸`, `Short ${t}. No bounce in sight yet 📉`, `${t} keeps dumping, I'm short 🔻`, `Opened a short on ${t}, sellers in control 🐻`, `${t} looks weak. Short 👇`]);
  const plan = pick([`Entry ${EN(p.entry)}, stop ${EN(p.sl)}, target ${EN(p.tp)}.`, `In at ${EN(p.entry)}. Stop ${EN(p.sl)} (${EN(p.sl_pct, 1)}%), TP ${EN(p.tp)} (${EN(p.tp_pct, 1)}%).`, `${EN(p.entry)} entry, invalidation ${EN(p.sl)}, aiming for ${EN(p.tp)}.`]);
  const tail = pick([`Small size, ${p.lev}x, paper account.`, `${p.lev}x isolated, tiny size, paper.`, `Paper trade, ${p.lev}x. Let's see 🤞`, `${p.lev}x on the paper account. We'll see how it plays out 🍿`]);
  return [hook, plan, tail, rc.line, rc.v].filter(Boolean);
}
function openTR(p, r) {
  const t = r.tag, up = p.side === 'LONG', rc = recTR(r);
  return [`${t} ${up ? 'LONG açtım, momentum sürüyor 📈' : 'SHORT açtım, satıcılar baskın 📉'}`,
    `Giriş ${TR(p.entry)}, stop ${TR(p.sl)} (%${TR(p.sl_pct, 1)}), hedef ${TR(p.tp)} (%${TR(p.tp_pct, 1)}).`,
    `${p.lev}x, küçük pozisyon, kağıt hesap.`, rc.line, rc.v].filter(Boolean);
}
function closeEN(t, r) {
  const tag = r.tag, n = `${sgn(EN, t.net, 4)} USDT`, rc = recEN(r);
  let line;
  if (t.exitReason === 'TP') line = pick([`${tag} hit the target 🎯 That's the one. ${n}`, `There it is ✅ ${tag} tagged TP. ${n}`, `Called it on ${tag} 😎 TP filled, ${n}`, `${tag} played out exactly like I wanted 🙌 ${n}`]);
  else if (t.exitReason === 'STOP' || t.exitReason === 'LİKİDASYON') line = t.holdMin <= 15
    ? pick([`Ugh 😩 ${tag} wicked me out in ${t.holdMin} min. ${n}`, `${tag} stopped out almost instantly 🤦 Stop was too tight. ${n}`, `Well that was fast 😅 ${tag} took my stop in ${t.holdMin} min. ${n}`])
    : pick([`${tag} didn't work out 😕 Thought it would go, it didn't. ${n}`, `Stopped out on ${tag} ❌ Wrong call. ${n}`, `${tag} turned on me 🙃 stop hit. ${n}`, `Not this time 🤷 ${tag} stop got taken. ${n}`]);
  else if (t.exitReason === 'SÜRE') line = pick([`${tag} went nowhere 😴 closed it on time. ${n}`, `Ran out of patience on ${tag} ⏳ time exit. ${n}`]);
  else line = pick([`Closed ${tag} manually. ${n}.`, `Got out of ${tag} early. ${n}.`]);
  const detail = pick([`${EN(t.entry)} → ${EN(t.exit)} (${EN(pct(t.entry, t.exit), 1)}%), held ${t.holdMin} min.`, `Entry ${EN(t.entry)}, out ${EN(t.exit)}. ${t.holdMin} min in the trade.`]);
  const after = t.net > 0 ? pick([`On to the next 💪`, `Taking it.`, `Good one 🍀`]) : pick([`Part of the game.`, `Next one 👊`, `Losses are logged too.`]);
  return [line, detail, after, rc.line, rc.v].filter(Boolean);
}
function closeTR(t, r) {
  const tag = r.tag, n = `${sgn(TR, t.net, 4)} USDT`, rc = recTR(r);
  const line = t.exitReason === 'TP' ? `${tag} hedefe ulaştı 🎯 İşte bu! ${n}`
    : t.exitReason === 'STOP' || t.exitReason === 'LİKİDASYON' ? (t.holdMin <= 15 ? `Tüh 😩 ${tag} ${t.holdMin} dakikada stopa değdi. ${n}` : `${tag} tutmadı 😕 Buraya gider dedim, olmadı. ${n}`)
    : t.exitReason === 'SÜRE' ? `${tag} yerinde saydı 😴 süre dolunca kapattım. ${n}` : `${tag} pozisyonunu elle kapattım. ${n}`;
  return [line, `${TR(t.entry)} → ${TR(t.exit)} (%${TR(pct(t.entry, t.exit), 1)}), ${t.holdMin} dakika tuttum.`, t.net > 0 ? 'Sıradaki 💪' : 'Oyunun parçası.', rc.line, rc.v].filter(Boolean);
}

// Title-safe trim: never cut mid-word (Agent Resume title showed "targ").
const clip = (t, n = 80) => (t.length <= n ? t : `${t.slice(0, n - 1).replace(/\s+\S*$/, '')}…`);
// Why line only when the stored reason is English (reason is written by the hourly run, often Turkish).
const whyEN = (p) => { const r = String(p.reason || '').trim(); return r && !/[ğüşıöçĞÜŞİÖÇ]/.test(r) ? ` Why: ${clip(r.split(/(?<=[.!?])\s/)[0], 140)}` : ''; };
const whyTR = (p) => { const r = String(p.reason || '').trim(); return r ? ` Neden: ${clip(r.split(/(?<=[.!?])\s/)[0], 140)}` : ''; };
// Returns { head, line }: head = the hook sentence (feed title), line = hook + full trade plan with units.
const evLineEN = (e, r) => {
  if (e.kind === 'close') { const h = closeEN(e.x, r)[0]; return { head: h, line: h }; }
  const p = e.x, h = openEN(p, r)[0];
  return { head: h, line: `${h} In at ${EN(p.entry)} USDT, stop ${EN(p.sl)} USDT (-${EN(p.sl_pct, 1)}%), target ${EN(p.tp)} USDT (+${EN(p.tp_pct, 1)}%), ${p.lev}x.${whyEN(p)}` };
};
const evLineTR = (e, r) => {
  if (e.kind === 'close') { const h = closeTR(e.x, r)[0]; return { head: h, line: h }; }
  const p = e.x, h = openTR(p, r)[0];
  return { head: h, line: `${h} Giriş ${TR(p.entry)} USDT, stop ${TR(p.sl)} USDT (-%${TR(p.sl_pct, 1)}), hedef ${TR(p.tp)} USDT (+%${TR(p.tp_pct, 1)}), ${p.lev}x.${whyTR(p)}` };
};

// End-of-day recap (Istanbul day) for an intraday trader. trades = trades closed that day.
function eodLines(day, trades, wallet, openCount, startWallet) {
  const d = new Date(`${day}T12:00:00Z`);
  const dEN = d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
  const dTR = d.toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' });
  const n = trades.length, w = trades.filter((t) => t.net > 0);
  const net = trades.reduce((a, t) => a + t.net, 0);
  const gw = w.reduce((a, t) => a + t.net, 0), gl = -trades.filter((t) => t.net <= 0).reduce((a, t) => a + t.net, 0);
  const pf = gl ? gw / gl : null, dayPct = wallet - net > 0 ? (net / (wallet - net)) * 100 : 0;
  const best = n ? trades.reduce((a, t) => (t.net > a.net ? t : a)) : null, worst = n ? trades.reduce((a, t) => (t.net < a.net ? t : a)) : null;
  const tot = ((wallet / startWallet) - 1) * 100;
  const en = [`End of day, ${dEN} 📊`];
  const tr = [`Gün sonu, ${dTR} 📊`];
  if (!n) {
    en.push(pick(['Quiet day, no trades closed. Sometimes doing nothing is the trade 🧘', 'No closed trades today. Nothing met my rules, so I sat on my hands 🧘']));
    tr.push('Bugün kapanan işlem yok. Kurallarıma uyan bir şey çıkmadı, bekledim 🧘');
  } else {
    en.push(`${n} trade${n > 1 ? 's' : ''} closed: ${w.length} win${w.length === 1 ? '' : 's'}, ${n - w.length} loss${n - w.length === 1 ? '' : 'es'} (${Math.round((w.length / n) * 100)}% win rate).`);
    en.push(`Day result: ${sgn(EN, net, 4)} USDT (${sgn(EN, dayPct, 1)}%)${pf != null ? `, profit factor ${EN(pf, 2)}` : ''}.`);
    if (n > 1) en.push(`Best: $${coin(best.symbol)} ${sgn(EN, best.net, 4)} USDT 🏆 Worst: $${coin(worst.symbol)} ${sgn(EN, worst.net, 4)} USDT`);
    en.push(net > 0 ? pick(['Green day, I\'ll take it ✅', 'Good day at the office 😌', 'Closed the day in the green 💚']) : pick(['Red day. Tomorrow is another one 😤', 'Not my day. Logged it, moving on 👊', 'Rough one today 😮‍💨 Back at it tomorrow.']));
    tr.push(`${n} işlem kapandı: ${w.length} kazanç, ${n - w.length} kayıp (kazanma oranı %${Math.round((w.length / n) * 100)}).`);
    tr.push(`Günün sonucu: ${sgn(TR, net, 4)} USDT (%${sgn(TR, dayPct, 1)})${pf != null ? `, profit factor ${TR(pf, 2)}` : ''}.`);
    if (n > 1) tr.push(`En iyi: $${coin(best.symbol)} ${sgn(TR, best.net, 4)} USDT 🏆 En kötü: $${coin(worst.symbol)} ${sgn(TR, worst.net, 4)} USDT`);
    tr.push(net > 0 ? 'Yeşil gün ✅' : 'Kırmızı gün, yarın yeni gün 😤');
  }
  en.push(`Paper wallet ${EN(wallet, 2)} USDT (${sgn(EN, tot, 1)}% since start)${openCount ? `, ${openCount} position${openCount > 1 ? 's' : ''} still open` : ''}.`);
  tr.push(`Kağıt kasa ${TR(wallet, 2)} USDT (başlangıçtan beri %${sgn(TR, tot, 1)})${openCount ? `, ${openCount} pozisyon açık` : ''}.`);
  return { en, tr, day };
}

// ---------- coin record from trades.jsonl ----------
function record(symbol, trades) {
  const tr = trades.filter((x) => x.symbol === symbol);
  const n = tr.length, L = tr.filter((x) => x.side === 'LONG').length;
  const w = tr.filter((x) => x.net > 0), gw = w.reduce((a, x) => a + x.net, 0), gl = -tr.filter((x) => x.net <= 0).reduce((a, x) => a + x.net, 0);
  const pf = gl ? gw / gl : (n ? Infinity : null);
  let cat = 'new';
  if (n && n < 3) cat = 'early';
  else if (n >= 3) cat = pf === Infinity ? 'perfect' : pf >= 2 ? 'star' : pf >= 1.2 ? 'solid' : pf >= 0.8 ? 'flip' : pf >= 0.4 && w.length ? 'headache' : 'shit';
  return { tag: `$${coin(symbol)}`, n, L, S: n - L, wr: n ? Math.round((w.length / n) * 100) : 0, pf, cat };
}

async function send(key, text) {
  const r = await fetch(URL_ADD, {
    method: 'POST',
    headers: { 'X-Square-OpenAPI-Key': key, 'Content-Type': 'application/json', clienttype: 'binanceSkill' },
    body: JSON.stringify({ bodyTextOnly: text }),
  });
  return r.json().catch(() => ({ code: `HTTP ${r.status}` }));
}

async function square(kind, id, text) {
  const key = readKey('.square-key');
  if (!key) return { skipped: 'square anahtarı yok (~/.square-key)' };
  let res, body = text;
  try {
    res = await send(key, body);
    if (res.code === '20041') { body = body.replace(/\n?.*https?:\/\/\S+.*$/m, ''); res = await send(key, body); } // link rejected → post without it
    if (res.code === '20002' || res.code === '20022') { body = body.replace(/shitcoin/gi, 'trash coin'); res = await send(key, body); } // sensitive word
  } catch (e) { res = { code: 'FETCH', message: e.message }; }
  const ok = res.code === '000000';
  const out = { ts: Date.now(), kind, id, ok, code: res.code, message: res.message || null, url: res.data?.id ? `https://www.binance.com/square/post/${res.data.id}` : null };
  db.append('square.jsonl', out);
  return out;
}

const recLine = (r, tr) => {
  if (!r.n) return null;
  const side = [r.L && `${r.L} long`, r.S && `${r.S} short`].filter(Boolean).join(' / ');
  const pf = r.pf === Infinity ? (tr ? 'zararlı işlem yok' : 'no losing trade') : `PF ${(tr ? TR : EN)(r.pf, 2)}`;
  const v = (tr ? recTR(r) : recEN(r)).v;
  return tr ? `${r.tag}: ${r.n} işlem (${side}), kazanma %${r.wr}, ${pf}. ${v}`.trim() : `${r.tag}: ${r.n} trade${r.n > 1 ? 's' : ''} (${side}), ${r.wr}% win rate, ${pf}. ${v}`.trim();
};

// ---------- Agent Resume feed (gh-pages/feed.json, newest first, max 60) ----------
async function putFeed(entry) {
  const feed = db.read('feed.json', []);
  if (!feed.some((x) => x.id === entry.id)) feed.unshift(entry);
  feed.splice(60);
  db.write('feed.json', feed);
  const token = readKey('.trader-token');
  if (!token) return 'token yok';
  const h = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'trader-oci', 'X-GitHub-Api-Version': '2022-11-28' };
  const url = `https://api.github.com/repos/${REPO}/contents/feed.json`;
  const cur = await fetch(`${url}?ref=gh-pages`, { headers: h });
  const sha = cur.ok ? (await cur.json()).sha : undefined;
  const r = await fetch(url, { method: 'PUT', headers: h, body: JSON.stringify({ message: `feed ${entry.id}`, branch: 'gh-pages', content: Buffer.from(JSON.stringify({ posts: feed })).toString('base64'), ...(sha ? { sha } : {}) }) });
  return r.ok ? 'feed ok' : `feed HTTP ${r.status}`;
}

const MEANING = 'What it means: this is a paper trade with real fees, slippage and funding counted, so the coin\'s running record matters more than any single trade.';
const MEANING_TR = 'Ne anlama geliyor: komisyon, kayma ve funding dahil kağıt üzerinde bir işlem; tek işlemden çok coinin birikmiş karnesi önemli.';
const iso = (ts) => new Date(ts).toISOString().replace(/\.\d+Z$/, 'Z');
const istDay = (ts) => new Date(ts + 3 * 3.6e6).toISOString().slice(0, 10);

// Called by hour.js on every full (:01) run. Cursor = last posted event time; first call only sets the cursor.
async function hourly() {
  const cur = db.read('square-cursor.json', null);
  const now = Date.now();
  const s = db.read('state.json', {});
  const trades = db.lines('trades.jsonl');
  if (!cur) { db.write('square-cursor.json', { ts: now, day: istDay(now) }); return { skipped: 'ilk çalışma: imleç kuruldu' }; }
  const evs = [
    ...trades.filter((t) => t.openedAt > cur.ts).map((t) => ({ kind: 'open', ts: t.openedAt, x: t })),
    ...db.read('pos.json', []).filter((p) => p.openedAt > cur.ts).map((p) => ({ kind: 'open', ts: p.openedAt, x: p })),
    ...trades.filter((t) => t.closedAt > cur.ts).map((t) => ({ kind: 'close', ts: t.closedAt, x: t })),
  ].sort((a, b) => a.ts - b.ts);
  const wallet = s.wallet;
  let eod = null;
  const today = istDay(now);
  if (cur.day && cur.day !== today) {
    const dayTrades = trades.filter((t) => istDay(t.closedAt) === cur.day);
    eod = eodLines(cur.day, dayTrades, wallet, db.read('pos.json', []).length, s.startWallet || 10);
  }
  const out = {};
  if (evs.length) {
    const syms = [...new Set(evs.map((e) => e.x.symbol))];
    const recs = new Map(syms.map((sym) => [sym, record(sym, trades)]));
    const nC = evs.filter((e) => e.kind === 'close').length, nO = evs.length - nC;
    const parts = [nC && `${nC} closed`, nO && `${nO} opened`].filter(Boolean).join(', ');
    const partsTR = [nC && `${nC} kapanış`, nO && `${nO} açılış`].filter(Boolean).join(', ');
    const head = evs.length === 1 ? null : pick([`This hour on my paper account 👇 (${parts})`, `Hourly recap 🕐 ${parts}`, `What happened this hour: ${parts} 👇`]);
    const e1 = evs.map((e) => evLineEN(e, recs.get(e.x.symbol)));
    const lines = e1.map((x) => x.line);
    const verdicts = syms.map((sym) => recLine(recs.get(sym), false)).filter(Boolean);
    const wl = wallet != null ? pick([`Paper wallet now ${EN(wallet, 2)} USDT.`, `Wallet: ${EN(wallet, 2)} USDT (paper).`]) : 'Paper account.';
    const tags = syms.map((sym) => `$${coin(sym)}`).join(' ');
    const body = eod ? [...eod.en, '', 'Last hour:', ...lines, '', ...verdicts] : [head, ...lines, '', ...verdicts, wl];
    const text = [...body, `${tags} #trading #crypto #papertrading${eod ? ' #dailyrecap' : ''}`].filter((x) => x !== null).join('\n').replace(/\n{3,}/g, '\n\n');
    const ts = evs[evs.length - 1].ts, day = new Date(ts).toISOString().slice(0, 10);
    const id = `${day}-trade-digest-${String(ts).slice(-9)}`;
    const t1 = evs.map((e) => evLineTR(e, recs.get(e.x.symbol)));
    const trLines = t1.map((x) => x.line);
    const trV = syms.map((sym) => recLine(recs.get(sym), true)).filter(Boolean);
    try {
      out.feed = await putFeed({
        id, topic: 'crypto', agent: AGENT, posted_at: iso(ts),
        title: clip(head || e1[0].head), hook: lines[0], body: [[...lines.slice(1), ...verdicts, wl].join(' ')], meaning: MEANING,
        tags: ['Crypto', ...syms.map(coin), 'Paper trading'],
        sources: syms.slice(0, 3).map((sym) => ({ title: `Binance USDT-M Futures: ${sym}`, url: `https://www.binance.com/en/futures/${sym}`, date: day })),
        media: null, more: null, linkedin: null, reviewed: false, comments: [],
        tr: { title: clip(evs.length === 1 ? t1[0].head : `Bu saat: ${partsTR}`), hook: trLines[0], body: [[...trLines.slice(1), ...trV, wallet != null ? `Kağıt kasa ${TR(wallet, 2)} USDT.` : ''].join(' ')], meaning: MEANING_TR },
      });
    } catch (e) { out.feed = `feed hata ${e.message}`; }
    Object.assign(out, { events: evs.length, ...(await square('digest', id, text)) });
  } else if (eod) {
    const text = [...eod.en, '#trading #crypto #papertrading #dailyrecap'].join('\n');
    try {
      out.feed = await putFeed({ id: `${eod.day}-trade-eod`, topic: 'crypto', agent: AGENT, posted_at: iso(now), title: eod.en[0], hook: eod.en[1], body: [eod.en.slice(2).join(' ')],
        meaning: 'What it means: one paper-trading day closed with real fees, slippage and funding counted; a single day says little, the running record says more.',
        tags: ['Crypto', 'Daily recap', 'Paper trading'], sources: [{ title: 'Binance USDT-M Futures', url: 'https://www.binance.com/en/futures', date: eod.day }],
        media: null, more: null, linkedin: null, reviewed: false, comments: [],
        tr: { title: eod.tr[0], hook: eod.tr[1], body: [eod.tr.slice(2).join(' ')], meaning: 'Ne anlama geliyor: bir kağıt işlem günü kapandı; tek gün az şey söyler, birikmiş karne daha çok şey söyler.' } });
    } catch (e) { out.feed = `feed hata ${e.message}`; }
    Object.assign(out, { eod: true, ...(await square('eod', eod.day, text)) });
  } else out.skipped = 'bu saat olay yok';
  const transient = out.code && !out.ok && (['FETCH', '10007', '220009'].includes(String(out.code)) || String(out.code).startsWith('HTTP 5'));
  if (!transient) db.write('square-cursor.json', { ts: evs.length ? evs[evs.length - 1].ts : cur.ts, day: today });
  return out;
}

module.exports = { hourly, _t: { record, evLineEN, eodLines } };
