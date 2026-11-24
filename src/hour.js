// Saatlik calisma iskeleti: simdilik yalniz top mover taramasi yapar ve kaydeder.
// Trader mantigi sonraki commit'lerde eklenecek; sunucu 5 dk icinde otomatik ceker.
const fs = require('fs');
const path = require('path');
const os = require('os');

const DATA = path.join(os.homedir(), 'trader-data');

async function main() {
  fs.mkdirSync(DATA, { recursive: true });
  const r = await fetch('https://fapi.binance.com/fapi/v1/ticker/24hr');
  if (!r.ok) throw new Error('ticker HTTP ' + r.status);
  const all = await r.json();
  const movers = all
    .filter(t => t.symbol.endsWith('USDT') && +t.quoteVolume > 20e6)
    .map(t => ({ s: t.symbol, pct: +t.priceChangePercent, last: +t.lastPrice, qv: Math.round(+t.quoteVolume) }))
    .sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct))
    .slice(0, 10);
  const rec = { t: new Date().toISOString(), n: all.length, movers };
  fs.appendFileSync(path.join(DATA, 'scan.jsonl'), JSON.stringify(rec) + '\n');
  console.log(rec.t, 'sembol:', all.length, '| top3:', movers.slice(0, 3).map(m => m.s + ' ' + m.pct + '%').join(', '));
}

main().catch(e => {
  console.error(new Date().toISOString(), 'HATA', e.message);
  process.exit(1);
});
