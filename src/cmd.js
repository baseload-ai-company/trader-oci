// Command box: Claude pushes cmd/queue.json {id, action}; this runs every 5 min after git pull, executes a
// whitelisted action once per id and writes the result to gh-pages/cmd-result.json. No shell input from the repo.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const db = require('./store');

const HOME = os.homedir();
const LOGS = path.join(HOME, 'trader-logs');
const REPO = 'baseload-ai-company/trader-oci';
const tail = (f, n) => { try { return fs.readFileSync(path.join(LOGS, f), 'utf8').split('\n').slice(-n - 1).join('\n'); } catch { return `${f} yok`; } };
const run = (args) => execFileSync('/usr/bin/node', args, { cwd: path.join(HOME, 'trader'), timeout: 15 * 60_000, encoding: 'utf8' });

async function putResult(token, obj, msg) {
  const h = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'trader-oci', 'X-GitHub-Api-Version': '2022-11-28' };
  const url = `https://api.github.com/repos/${REPO}/contents/cmd-result.json`;
  const cur = await fetch(`${url}?ref=gh-pages`, { headers: h });
  const sha = cur.ok ? (await cur.json()).sha : undefined;
  const r = await fetch(url, { method: 'PUT', headers: h, body: JSON.stringify({ message: msg, branch: 'gh-pages', content: Buffer.from(JSON.stringify(obj, null, 1)).toString('base64'), ...(sha ? { sha } : {}) }) });
  if (!r.ok) throw new Error(`cmd-result HTTP ${r.status}`);
}

const ACTIONS = {
  status: () => {
    const s = db.read('state.json', {});
    const r = db.lines('runs.jsonl').slice(-1)[0];
    return [`uptime: ${execFileSync('uptime', { encoding: 'utf8' }).trim()}`,
      `disk: ${execFileSync('df', ['-h', '/'], { encoding: 'utf8' }).split('\n')[1]}`,
      `aktif: ${s.active} · cüzdan: ${s.wallet} USDT`, `son çalışma: ${JSON.stringify(r)}`,
      `--- hour.log ---\n${tail('hour.log', 6)}`, `--- deploy.log ---\n${tail('deploy.log', 3)}`].join('\n');
  },
  logs: () => `--- hour.log ---\n${tail('hour.log', 60)}`,
  hour: () => run(['src/hour.js']),
  publish: () => run(['src/publish.js']),
  cron: () => execFileSync('/bin/bash', ['deploy/bootstrap.sh'], { cwd: path.join(HOME, 'trader'), timeout: 5 * 60_000, encoding: 'utf8' }),
  square: () => run(['-e', "require('./src/square').hourly().then((r) => console.log(JSON.stringify(r)))"]),
  eval: () => { // run the switch rule now (same rule as the trade-count trigger); skipped while an hour run holds the lock
    if (fs.existsSync(path.join(db.DIR, 'hour.lock'))) return 'hour.js çalışıyor (kilit var), değerlendirme atlandı';
    const { _test } = require('./engine');
    const s = _test.getState();
    s.closedSinceEval = s.closedSinceEval || 0;
    const n = _test.evaluate(s, Date.now());
    db.write('state.json', s);
    const rows = Object.entries(n.stats).map(([id, x]) => `${id}: n ${x.n} · PF ${x.pf} · WR ${Math.round(x.wr * 100)} % · net ${x.net} USDT`);
    return [`aktif (önce): ${n.active} · aktif (sonra): ${s.active} · eşik n >= ${s.switchMinN}`,
      n.switch ? `GEÇİŞ: ${JSON.stringify(n.switch)}` : 'geçiş yok', ...rows].join('\n');
  },
};

async function main() {
  let q;
  try { q = JSON.parse(fs.readFileSync(path.join(HOME, 'trader', 'cmd', 'queue.json'), 'utf8')); } catch { return; }
  const last = db.read('cmd-last.json', {});
  if (!q || !q.id || q.id === last.id) return;
  db.write('cmd-last.json', { id: q.id, at: Date.now() }); // mark first: a command never runs twice
  let ok = true, output;
  const fn = ACTIONS[q.action];
  if (!fn) { ok = false; output = `izin verilmeyen komut: ${q.action}; izinli: ${Object.keys(ACTIONS).join(', ')}`; }
  else { try { output = await fn(); } catch (e) { ok = false; output = String(e.stdout || '') + String(e.stderr || '') + e.message; } }
  const res = { id: q.id, action: q.action, at: new Date().toISOString(), ok, output: String(output).slice(-8000) };
  const token = fs.readFileSync(path.join(HOME, '.trader-token'), 'utf8').trim();
  await putResult(token, res, `cmd ${q.id} ${q.action}`);
  console.log(res.at, q.id, q.action, ok ? 'tamam' : 'hata');
}

main().catch((e) => { console.error(new Date().toISOString(), 'cmd HATA', e.message); process.exit(1); });
