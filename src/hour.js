// Saatlik calisma: her saatin 1. dakikasinda cron tetikler. Ayni anda iki kopya calismasin diye kilit kullanir.
const fs = require('fs');
const path = require('path');
const db = require('./store');
const { hour } = require('./engine');

const LOCK = path.join(db.DIR, 'hour.lock');

async function main() {
  try {
    const st = fs.statSync(LOCK);
    if (Date.now() - st.mtimeMs < 50 * 60_000) { console.log(new Date().toISOString(), 'kilit var, atlandi'); return; }
  } catch {}
  fs.writeFileSync(LOCK, String(process.pid));
  try {
    const r = await hour();
    console.log(JSON.stringify(r));
  } finally {
    fs.rmSync(LOCK, { force: true });
  }
}

main().catch((e) => {
  console.error(new Date().toISOString(), 'HATA', e.stack || e.message);
  process.exit(1);
});
