// Writes data.json to the gh-pages branch (GitHub Pages dashboard) via the Contents API.
// Token: ~/.trader-token (fine-grained, this repo only, Contents read/write). Never logged.
const fs = require('fs');
const path = require('path');
const os = require('os');
const db = require('./store');
const { STRATEGIES } = require('./strategies');

const REPO = 'baseload-ai-company/trader-oci';
const BRANCH = 'gh-pages';
const FILE = 'data.json';
const rd = (x, d = 4) => (x == null || !isFinite(x) ? x : Math.round(x * 10 ** d) / 10 ** d);

function stats(trades) {
  const w = trades.filter((t) => t.net > 0).reduce((a, t) => a + t.net, 0);
  const l = -trades.filter((t) => t.net <= 0).reduce((a, t) => a + t.net, 0);
  return { n: trades.length, net_usdt: rd(w - l, 4), pf: l > 0 ? rd(w / l, 2) : w > 0 ? 99 : 0, wr_pct: trades.length ? rd((100 * trades.filter((t) => t.net > 0).length) / trades.length, 1) : 0 };
}

function build() {
  const s = db.read('state.json', {});
  const pos = db.read('pos.json', []);
  const spos = db.read('spos.json', []);
  const trades = db.lines('trades.jsonl');
  const strades = db.lines('strades.jsonl');
  const runs = db.lines('runs.jsonl').slice(-48);
  const evals = db.lines('evals.jsonl').slice(-12);
  const upnl = pos.reduce((a, p) => a + p.qty * (p.last - p.entry) * p.dir + p.funding - p.feeIn, 0);
  const lab = STRATEGIES.map((x) => ({
    id: x.id, desc: x.desc, active: x.id === s.active,
    all: stats(strades.filter((t) => t.strategy === x.id)),
    since_active: stats(strades.filter((t) => t.strategy === x.id && t.openedAt >= s.activeSince)),
    open: spos.filter((p) => p.strategy === x.id).length,
  }));
  const exits = {};
  for (const t of trades) exits[t.exitReason] = (exits[t.exitReason] || 0) + 1;
  return {
    updated: new Date().toISOString(),
    wallet_usdt: rd(s.wallet, 4), start_wallet_usdt: s.startWallet, upnl_usdt: rd(upnl, 4),
    equity_usdt: rd((s.wallet || 0) + upnl, 4),
    active: s.active, active_since: s.activeSince ? new Date(s.activeSince).toISOString() : null,
    switch_min_n: s.switchMinN, history: s.history || [],
    real: stats(trades), exits,
    open: pos.map((p) => ({
      sym: p.symbol, side: p.side, strategy: p.strategy, lev: p.lev, entry: rd(p.entry, 8), last: rd(p.last, 8),
      sl: rd(p.sl, 8), tp: rd(p.tp, 8), sl_pct: p.sl_pct, tp_pct: p.tp_pct, notional_usdt: rd(p.notional, 2),
      upnl_usdt: rd(p.qty * (p.last - p.entry) * p.dir + p.funding - p.feeIn, 4),
      opened: new Date(p.openedAt).toISOString(),
    })),
    trades: trades.slice(-100).reverse(),
    equity: trades.map((t) => ({ t: new Date(t.closedAt).toISOString(), wallet_usdt: t.walletAfter })),
    lab, evals, runs,
  };
}

async function gh(method, url, token, body) {
  const r = await fetch(`https://api.github.com/repos/${REPO}${url}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'trader-oci', 'X-GitHub-Api-Version': '2022-11-28' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return r;
}

async function publish() {
  const tokenFile = path.join(os.homedir(), '.trader-token');
  if (!fs.existsSync(tokenFile)) return 'token yok, yayın atlandı';
  const token = fs.readFileSync(tokenFile, 'utf8').trim();
  const data = build();
  const content = Buffer.from(JSON.stringify(data)).toString('base64');
  for (let i = 0; i < 2; i++) {
    const cur = await gh('GET', `/contents/${FILE}?ref=${BRANCH}`, token);
    const sha = cur.ok ? (await cur.json()).sha : undefined;
    const r = await gh('PUT', `/contents/${FILE}`, token, { message: `data ${data.updated}`, content, branch: BRANCH, ...(sha ? { sha } : {}) });
    if (r.ok) return 'yayınlandı';
    if (r.status !== 409) return `yayın hatası HTTP ${r.status}`;
  }
  return 'yayın hatası: sha çakışması';
}

module.exports = { publish, build };

if (require.main === module) publish().then((m) => console.log(new Date().toISOString(), m)).catch((e) => { console.error('HATA', e.message); process.exit(1); });
