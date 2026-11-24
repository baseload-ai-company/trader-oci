// 5 dakikalik calisma (:01, :06, ...): tarama + cikislar; :01 kosusu tam saatlik kosudur. Ayni anda iki kopya calismasin diye kilit kullanir.
const fs = require('fs');
const path = require('path');
const db = require('./store');
const { hour } = require('./engine');
const { publish } = require('./publish');

const LOCK = path.join(db.DIR, 'hour.lock');

async function main() {
  try {
    const st = fs.statSync(LOCK);
    if (Date.now() - st.mtimeMs < 15 * 60_000) { console.log(new Date().toISOString(), 'kilit var, atlandi'); return; }
  } catch {}
  fs.writeFileSync(LOCK, String(process.pid));
  try {
    const r = await hour();
    console.log(JSON.stringify(r));
    if (r.full || r.changed) try { console.log(new Date().toISOString(), 'dashboard:', await publish()); } catch (e) { console.error('dashboard HATA', e.message); }
  } finally {
    fs.rmSync(LOCK, { force: true });
  }
}

main().catch((e) => {
  console.error(new Date().toISOString(), 'HATA', e.stack || e.message);
  process.exit(1);
});
