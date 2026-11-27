// Writes data.json to the gh-pages branch in the format the dashboard (index.html, the old Claude Trader page) reads.
// Token: ~/.trader-token (fine-grained, this repo only, Contents read/write). Never logged.
// Once a day (UTC 00) the gh-pages history is squashed to a single commit so hourly data commits don't grow the repo.
const fs = require('fs');
const path = require('path');
const os = require('os');
const bn = require('./binance');
const db = require('./store');
const { ALL_STRATEGIES: STRATEGIES, RETIRED } = require('./strategies');
const GOALS = require('./goals');

// Tried-strategies table: PnL, BSR (win count share) and WSR (|PnL| share of winners), purpose and a data-driven reason.
function triedSummary(strades, s) {
  const pct = (x) => Math.round(x * 1000) / 10;
  return STRATEGIES.map((L) => {
    const t = strades.filter((x) => x.strategy === L.id);
    const n = t.length, win = t.filter((x) => x.net > 0), los = t.filter((x) => x.net <= 0);
    const gw = win.reduce((a, x) => a + x.net, 0), gl = -los.reduce((a, x) => a + x.net, 0);
    const pnl = gw - gl, pf = gl > 0 ? gw / gl : (gw > 0 ? 99 : 0);
    const bsr = n ? win.length / n : 0, wsr = gw + gl > 0 ? gw / (gw + gl) : 0;
    const status = L.id === s.active ? 'aktif' : RETIRED.has(L.id) ? 'emekli' : 'aday';
    let why;
    if (!n) why = 'Henüz sinyal oluşmadı; koşullar en hareketli coinlerde nadiren aynı anda tutuyor.';
    else if (n < 5) why = `Karar için erken (${n} işlem).`;
    else if (pf >= 1.3 && wsr > bsr) why = `Başarısız değil: PF ${pf.toFixed(2)}, WSR > BSR (kazançlar kayıplardan büyük).`;
    else {
      const avg = (a, f) => (a.length ? a.reduce((x, y) => x + f(y), 0) / a.length : 0);
      const fast = los.filter((x) => x.holdMin <= 15).length / (los.length || 1);
      const near = los.filter((x) => x.tp_pct && x.mfe >= 0.5 * x.tp_pct).length / (los.length || 1);
      const never = los.filter((x) => (x.mfe || 0) < 0.3).length / (los.length || 1);
      if (fast >= 0.5) why = `Stop gürültüye takılıyor: kayıpların %${pct(fast)}'i 15 dakika içinde stop oldu (ort. stop %${avg(los, (x) => x.sl_pct).toFixed(2)}).`;
      else if (near >= 0.4) why = `Fiyat hedefe yaklaşıp döndü: kayıpların %${pct(near)}'i hedefin yarısını gördü; TP uzak ya da kâr koruma yok.`;
      else if (never >= 0.5) why = `Yön hatalı: kayıpların %${pct(never)}'i hiç kâra geçmedi; giriş sinyali tersine çalışıyor.`;
      else if (wsr <= bsr) why = `Kazançlar küçük, kayıplar büyük: WSR %${pct(wsr)} ≤ BSR %${pct(bsr)}.`;
      else why = `PF ${pf.toFixed(2)}: kazançlar kayıpları karşılamıyor.`;
      if (status === 'emekli') why = `Emekli (${los.length} kayıp, PF ${pf.toFixed(2)}). ${why}`;
    }
    return { id: L.id, name: L.desc, status, n, pnl_usdt: Math.round(pnl * 1e4) / 1e4, pf: Math.round(pf * 100) / 100,
      bsr_pct: pct(bsr), wsr_pct: pct(wsr), wsr_gt_bsr: n > 0 && wsr > bsr, goal: GOALS[L.id] || '', why };
  }).sort((a, b) => b.pnl_usdt - a.pnl_usdt);
}

const REPO = 'baseload-ai-company/trader-oci';
const BRANCH = 'gh-pages';
const CFG = { fee: 0.0005, slip: 0.0005, mmr: 0.005, maxLev: 20, startWallet: 10, baseNotional: 6, maxOpen: 10, minQv_musdt: 50, topN: 10 };
const rd = (x, d = 4) => (x == null || !isFinite(x) ? x : Math.round(x * 10 ** d) / 10 ** d);
const H = 3.6e6;

function compactPos(p, now) {
  const last = p.last ?? p.entry;
  return {
    id: p.id, sym: p.symbol, side: p.side, lev: p.lev,
    entry: rd(p.entry, 8), last: rd(last, 8), sl: rd(p.sl, 8), tp: rd(p.tp, 8), liq: rd(p.liq, 8),
    notional_usdt: rd(p.notional, 2), margin_usdt: rd(p.margin, 4),
    upnl_usdt: rd(p.qty * (last - p.entry) * p.dir + p.funding - p.feeIn, 4),
    mfe_pct: rd(p.mfe, 2), mae_pct: rd(p.mae, 2), age_h: rd((now - p.openedAt) / H, 1), openedAt: p.openedAt,
    version: p.strategy, supports: p.supports || [p.strategy], lab: false,
    reason: p.reason || `${p.strategy} kuralı eşleşti`,
  };
}

function runSummary(r) {
  const saw = `${r.movers} hareketli coin tarandı; ${r.open} açık gerçek, ${r.shadowOpen} açık gölge pozisyon.`;
  const did = [
    r.opened.length ? `Açılan: ${r.opened.join('; ')}` : r.open >= CFG.maxOpen ? `Yeni pozisyon yok: ${CFG.maxOpen} pozisyon sınırı dolu.` : 'Pozisyon bulunmadı.',
    r.closed.length ? `Kapanan: ${r.closed.join('; ')}` : '',
    r.eval ? `İşlem sayısı bazlı değerlendirme: ${typeof r.eval === 'string' ? r.eval : `${r.eval.from} → ${r.eval.to} (EV ${r.eval.ev} USDT/işlem, ${r.eval.n} işlem)`}` : '',
  ].filter(Boolean).join(' ');
  const exp = `Kural motoru: aktif strateji ${r.active}; SL/TP 1 dakikalık mumlarla izleniyor.`;
  return `Gördüm: ${saw}\nKarar: ${did}\nBeklenti: ${exp}`;
}

// 15m closes around each position, cached for closed trades (they never change).
async function charts(items, now) {
  const cache = db.read('charts-cache.json', {});
  const out = [];
  for (const it of items) {
    const key = `${it.sym}|${it.openedAt}`;
    if (it.closedAt && cache[key]) { out.push(cache[key]); continue; }
    try {
      const start = it.openedAt - H, end = Math.min(now, (it.closedAt || now) + H);
      const k = await bn.klines(it.sym, '15m', { startTime: start, endTime: end, limit: 200 });
      const c = { sym: it.sym, openedAt: it.openedAt, interval: '15m', candles: k.map((x) => [x[0], null, null, +x[4]]) };
      if (it.closedAt) cache[key] = c;
      out.push(c);
    } catch { /* chart is optional */ }
  }
  const keep = new Set(out.map((c) => `${c.sym}|${c.openedAt}`));
  for (const k of Object.keys(cache)) if (!keep.has(k)) delete cache[k];
  db.write('charts-cache.json', cache);
  return out;
}

async function build() {
  const now = Date.now();
  const s = db.read('state.json', {});
  const trades = db.lines('trades.jsonl').map((t) => ({ ...t, version: t.version || t.strategy, supports: t.supports || [t.strategy], reason: t.reason || `${t.strategy} kuralı` }));
  const strades = db.lines('strades.jsonl').map((t) => ({ ...t, version: t.version || t.strategy, supports: t.supports || [t.strategy], lab: true, reason: t.reason || `${t.strategy} kuralı` }));
  const open = db.read('pos.json', []).map((p) => compactPos(p, now));
  const sopen = db.read('spos.json', []).map((p) => ({ ...compactPos(p, now), lab: true }));
  const runs = db.lines('runs.jsonl').slice(-288);
  // hourly points + one live point (wallet + open uPnL) so the dashboard never shows a stale equity
  const liveEq = (s.wallet || 0) + open.reduce((a, p) => a + (p.upnl_usdt || 0), 0);
  const equity = [...db.lines('equity.jsonl').slice(-1999), { ts: now, equity: Math.round(liveEq * 1e4) / 1e4, live: true }];
  const strategies = [{ version: 'v1', at: s.createdAt, rules: STRATEGIES.find((x) => x.id === 'v1').desc, reason: 'Oracle Frankfurt üzerinde yeni sistemin başlangıç stratejisi (kural motoru, saatlik).' },
    ...(s.history || []).map((h) => ({ version: h.to, at: h.t, rules: (STRATEGIES.find((x) => x.id === h.to) || {}).desc || h.to,
      reason: `EV kuralı: ${h.from} yerine geçti (${h.ev != null ? `EV ${h.ev} USDT/işlem, ` : ''}PF ${h.pf}, ${h.n} gölge işlem).` }))];
  const skipped = strades.slice(-1000);
  const chartItems = [...open, ...sopen.slice(-30)].map((p) => ({ sym: p.sym, openedAt: p.openedAt }))
    .concat([...trades.slice(-20), ...skipped.slice(-30)].map((t) => ({ sym: t.symbol, openedAt: t.openedAt, closedAt: t.closedAt })));
  return {
    generated_utc: new Date(now).toISOString(),
    config: CFG,
    state: { wallet: s.wallet, startWallet: s.startWallet, version: s.active, createdAt: s.createdAt, activeSince: s.activeSince, switchMinN: s.switchMinN },
    open, trades: trades.slice(-300), equity,
    decisions: runs.map((r) => ({ ts: Date.parse(r.t), version: r.active, summary: runSummary(r), actions: [...r.opened.map((x) => `AÇ ${x}`), ...r.closed.map((x) => `KAPAT ${x}`)] })),
    strategies, market: db.read('market.json', null),
    skipped_open: sopen, skipped,
    lab: STRATEGIES.map((L) => ({ id: L.id, rule: L.desc, status: L.id === s.active ? 'aktif' : RETIRED.has(L.id) ? 'emekli' : 'aday' })),
    lab_summary: triedSummary(strades, s),
    charts: await charts(chartItems, now),
  };
}

async function gh(method, url, token, body) {
  return fetch(`https://api.github.com/repos/${REPO}${url}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'trader-oci', 'X-GitHub-Api-Version': '2022-11-28' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

// Replace gh-pages history with one parentless commit holding the current tree.
async function squash(token) {
  const ref = await gh('GET', `/git/ref/heads/${BRANCH}`, token);
  if (!ref.ok) return `squash ref HTTP ${ref.status}`;
  const head = (await ref.json()).object.sha;
  const cm = await gh('GET', `/git/commits/${head}`, token);
  if (!cm.ok) return `squash commit HTTP ${cm.status}`;
  const tree = (await cm.json()).tree.sha;
  const nc = await gh('POST', '/git/commits', token, { message: `dashboard snapshot ${new Date().toISOString()}`, tree, parents: [] });
  if (!nc.ok) return `squash yeni commit HTTP ${nc.status}`;
  const up = await gh('PATCH', `/git/refs/heads/${BRANCH}`, token, { sha: (await nc.json()).sha, force: true });
  return up.ok ? 'geçmiş sıkıştırıldı' : `squash ref güncelleme HTTP ${up.status}`;
}

// One-time page deploy: copies the old Claude Trader dashboard (index.html, PWA files, icons) from
// alibingul-dev/claude-trader into gh-pages, rewires it to data.json and to chart data shipped inside data.json.
const PAGES_VER = 'pages-v5';
const OLD = 'https://raw.githubusercontent.com/alibingul-dev/claude-trader/main/docs/';
const CHART_OLD = "    const r = await fetch(`${CHART_URL}?symbol=${o.sym}&from=${Math.floor(o.openedAt)}&to=${Math.floor(o.closedAt || Date.now())}`);\n    const j = await r.json(); if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);";
const CHART_NEW = "    // Oracle sürümü: grafik verisi data.json içinde gelir (15 dk kapanışlar); tarayıcı Binance'e bağlanmaz.\n    const cs = ((lastData && lastData.charts) || []).filter((c) => c.sym === o.sym);\n    const j = cs.sort((a, b) => Math.abs(a.openedAt - o.openedAt) - Math.abs(b.openedAt - o.openedAt))[0];\n    if (!j || Math.abs(j.openedAt - o.openedAt) > 30 * 60000) throw new Error(T('bu işlem için grafik verisi yok (son 20 gerçek ve 30 gölge işlem tutulur)'));";

// Claude's commentary above the "Strateji sürümleri" table (static, dated; TR/EN follows the page language toggle).
const OPINION = `<style>#opn{margin:0 0 14px;padding:12px 14px;border:1px solid var(--line);border-radius:10px;background:var(--panel2);font-size:13px;line-height:1.6}#opn ul{margin:6px 0 0;padding-left:18px}#opn li{margin:2px 0}#opn .op-h{font-weight:600}html[lang=en] #opn .op-tr,html:not([lang=en]) #opn .op-en{display:none}</style><div id="opn"><div class="op-tr"><div class="op-h">Genel görüş</div><div class="sub">Claude · 26 Kasım 2026 · en fazla 22 gölge işlem</div><ul>
<li>Kenar yalnız momentum devamında. v2 türevleri (L-atr, v2, L-btc) PF 1,9 civarında; girişler aynı, fark stop ve hedefte.</li>
<li>Aktif L-wide (PF 1,46), aynı girişli L-atr'nin (PF 1,92) gerisinde. Dar ATR stopu şu an daha verimli.</li>
<li>Ters test sinyali doğruluyor. Ayna stratejisi (v2'nin tersi) PF 0,13 ile en kötü sonuç.</li>
<li>BTC filtresi bilgi katmıyor. L-btc, v2 ile işlem işlem aynı; eleyeceği sinyal çıkmadı.</li>
<li>Klasik indikatör aileleri çalışmadı. RSI geri çekilme, Alligator, çoklu zaman dilimi, 24s kırılım, pin bar ve Bollinger PF 0,5–0,8 ile emekli.</li>
<li>Supertrend zayıf. Dönüş sürümü 6 işlemde PF 1,18, fade sürümü ilk işlemde zarar. Maliyeti taşıyacak kenar yok; emeklilik adayı.</li>
<li>Yeni fikirlerden yalnız yutan mum umut veriyor: PF 2,62, ama 5 işlemle karar erken.</li>
<li>Örneklem küçük. Hiçbir strateji 30 işleme ulaşmadı; bu tablo hipotezdir, kanıt değil.</li></ul></div><div class="op-en"><div class="op-h">Overall view</div><div class="sub">Claude · 26 Nov 2026 · up to 22 shadow trades</div><ul>
<li>The only edge is momentum continuation. v2 variants (L-atr, v2, L-btc) sit near PF 1.9; same entries, different stop and target.</li>
<li>Active L-wide (PF 1.46) trails L-atr (PF 1.92), which uses the same entries. The tighter ATR stop is more efficient for now.</li>
<li>The inverse test confirms the signal. The mirror strategy (v2 reversed) is the worst result at PF 0.13.</li>
<li>The BTC filter adds nothing. L-btc matches v2 trade for trade; it has not filtered a single signal.</li>
<li>Classic indicator families failed. RSI pullback, Alligator, multi-timeframe, 24h breakout, pin bar and Bollinger retired at PF 0.5–0.8.</li>
<li>Supertrend is weak. The flip version shows PF 1.18 over 6 trades; the fade version lost its first trade. No edge large enough to cover costs; a retirement candidate.</li>
<li>Among new ideas only the engulfing candle looks promising: PF 2.62, but 5 trades is too early to judge.</li>
<li>The sample is small. No strategy has reached 30 trades; treat this table as hypotheses, not proof.</li></ul></div></div>`;

// Tried-strategies table at the bottom of the "Strateji" view; fills itself from data.json.lab_summary.
const TRIED_SECTION = '<section class="card" id="sec-denenen" data-view="strateji"><h2>Denenen stratejiler</h2><div class="sub" style="margin:-4px 0 10px">Laboratuvarda denenen her strateji: gölge işlemlerin PnL (USDT), BSR (kazanan işlem oranı) ve WSR (kazançların toplam mutlak PnL içindeki payı). Ölçüt: WSR &gt; BSR.</div><div class="scroll"><table id="tTried"></table></div></section>';
const TRIED_SCRIPT = `<script>(function(){
  const esc=(x)=>String(x==null?'':x).replace(/[&<>"]/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  async function draw(){
    try{
      const r=await fetch(window.DATA_URL,{cache:'no-store'}); const d=await r.json(); const L=d.lab_summary||[];
      const col=(v)=>v>0?'var(--g)':v<0?'var(--r)':'var(--mut)';
      const st=(s)=>s==='aktif'?'<b style="color:var(--g)">aktif</b>':s==='emekli'?'<span style="color:var(--r)">emekli</span>':'<span style="color:var(--mut)">aday</span>';
      document.getElementById('tTried').innerHTML='<tr><th>Kod</th><th>Ad</th><th>Durum</th><th>İşlem</th><th>PnL (USDT)</th><th>BSR (%)</th><th>WSR (%)</th><th>WSR &gt; BSR</th><th>Amaç</th><th>Neden başarısız / not</th></tr>'+
        L.map((x)=>'<tr><td><b>'+esc(x.id)+'</b></td><td style="min-width:220px">'+esc(x.name)+'</td><td>'+st(x.status)+'</td><td>'+x.n+'</td><td style="color:'+col(x.pnl_usdt)+'">'+(x.pnl_usdt>0?'+':'')+x.pnl_usdt.toFixed(4)+'</td><td>'+x.bsr_pct.toFixed(1)+'</td><td>'+x.wsr_pct.toFixed(1)+'</td><td>'+(x.n?(x.wsr_gt_bsr?'<span style="color:var(--g)">✓</span>':'<span style="color:var(--r)">✗</span>'):'–')+'</td><td style="min-width:220px">'+esc(x.goal)+'</td><td style="min-width:260px">'+esc(x.why)+'</td></tr>').join('');
    }catch(e){ const t=document.getElementById('tTried'); if(t) t.innerHTML='<tr><td>Tablo yüklenemedi: '+esc(e.message)+'</td></tr>'; }
  }
  draw(); setInterval(draw,60000);
})();</script>`;

async function putFile(token, p, buf, msg) {
  const cur = await gh('GET', `/contents/${p}?ref=${BRANCH}`, token);
  const sha = cur.ok ? (await cur.json()).sha : undefined;
  const r = await gh('PUT', `/contents/${p}`, token, { message: msg, content: buf.toString('base64'), branch: BRANCH, ...(sha ? { sha } : {}) });
  if (!r.ok) throw new Error(`${p} HTTP ${r.status}`);
}

async function ensureAssets(token) {
  if (db.read('assets-ok.json', null) === PAGES_VER) return '';
  const bin = ['icons/apple-touch-icon.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/icon.svg', 'icons/maskable.svg', 'manifest.webmanifest', 'sw.js', 'index.html'];
  for (const p of bin) {
    const raw = await fetch(OLD + p);
    if (!raw.ok) return ` · sayfa dosyası alınamadı ${p} HTTP ${raw.status}`;
    let buf = Buffer.from(await raw.arrayBuffer());
    if (p === 'index.html') {
      let html = buf.toString('utf8');
      if (!html.includes(CHART_OLD)) return ' · index.html grafik bloğu bulunamadı, sayfa güncellenmedi';
      html = html.replace(CHART_OLD, CHART_NEW).replace("${T('kayıt tutulmaz, Binance’ten anlık çekilir')}", "${T('sunucu 5 dakikada bir günceller')}")
        .replace('<h2>Strateji sürümleri</h2>', `<h2>Strateji sürümleri</h2>${OPINION}`).replace('</main>', `${TRIED_SECTION}\n</main>`).replace('</body>', `${TRIED_SCRIPT}\n</body>`);
      buf = Buffer.from(html, 'utf8');
    }
    await putFile(token, p, buf, `page ${p}`);
  }
  await putFile(token, 'config.js', Buffer.from("// Oracle Frankfurt sunucusu 5 dakikada bir data.json'u günceller; Pages derlemesini beklememek için doğrudan daldan okunur.\nwindow.DATA_URL = 'https://raw.githubusercontent.com/baseload-ai-company/trader-oci/gh-pages/data.json';\n"), 'page config.js');
  db.write('assets-ok.json', PAGES_VER);
  return ' · eski dashboard sayfası kuruldu';
}

async function publish() {
  const tokenFile = path.join(os.homedir(), '.trader-token');
  if (!fs.existsSync(tokenFile)) return 'token yok, yayın atlandı';
  const token = fs.readFileSync(tokenFile, 'utf8').trim();
  let assets;
  try { assets = await ensureAssets(token); } catch (e) { assets = ` · sayfa kurulum hatası: ${e.message}`; }
  const data = await build();
  const content = Buffer.from(JSON.stringify(data)).toString('base64');
  let msg = 'yayın hatası: sha çakışması';
  for (let i = 0; i < 2; i++) {
    const cur = await gh('GET', `/contents/data.json?ref=${BRANCH}`, token);
    const sha = cur.ok ? (await cur.json()).sha : undefined;
    const r = await gh('PUT', '/contents/data.json', token, { message: `data ${data.generated_utc}`, content, branch: BRANCH, ...(sha ? { sha } : {}) });
    if (r.ok) { msg = `yayınlandı (${Math.round(content.length * 0.75 / 1024)} KB)`; break; }
    if (r.status !== 409) { msg = `yayın hatası HTTP ${r.status}`; break; }
  }
  msg += assets;
  if ((new Date().getUTCHours() === 0 && new Date().getUTCMinutes() < 5) || process.argv.includes('--squash')) msg += ' · ' + (await squash(token));
  return msg;
}

module.exports = { publish, build };

if (require.main === module) publish().then((m) => console.log(new Date().toISOString(), m)).catch((e) => { console.error('HATA', e.message); process.exit(1); });
