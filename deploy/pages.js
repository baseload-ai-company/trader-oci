// Builds the dashboard page into ./_site from the old Claude Trader docs, rewired to data.json (same patch as publish.js).
const fs = require('fs');
const path = require('path');
const OLD = 'https://raw.githubusercontent.com/alibingul-dev/claude-trader/main/docs/';
const src = fs.readFileSync(path.join(__dirname, '../src/publish.js'), 'utf8');
const CHART_OLD = JSON.parse(src.match(/const CHART_OLD = (".*?");\n/s)[1]);
const CHART_NEW = JSON.parse(src.match(/const CHART_NEW = (".*?");\n/s)[1]);
const files = ['icons/apple-touch-icon.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/icon.svg', 'icons/maskable.svg', 'manifest.webmanifest', 'sw.js', 'index.html'];
(async () => {
  const out = process.argv[2] || '_site';
  fs.mkdirSync(path.join(out, 'icons'), { recursive: true });
  for (const p of files) {
    const r = await fetch(OLD + p);
    if (!r.ok) throw new Error(`${p} HTTP ${r.status}`);
    let buf = Buffer.from(await r.arrayBuffer());
    if (p === 'index.html') {
      let html = buf.toString('utf8');
      if (!html.includes(CHART_OLD)) throw new Error('grafik bloğu bulunamadı');
      html = html.replace(CHART_OLD, CHART_NEW).replace("${T('kayıt tutulmaz, Binance’ten anlık çekilir')}", "${T('sunucu her saat günceller')}");
      buf = Buffer.from(html, 'utf8');
    }
    fs.writeFileSync(path.join(out, p), buf);
  }
  fs.writeFileSync(path.join(out, 'config.js'), "// Oracle Frankfurt sunucusu her saat :01'de data.json'u günceller.\nwindow.DATA_URL = 'data.json';\n");
  console.log('sayfa hazır:', out);
})().catch((e) => { console.error(e.message); process.exit(1); });
