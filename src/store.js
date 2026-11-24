// File store in ~/trader-data. JSON for state, JSON lines for trade history.
const fs = require('fs');
const path = require('path');
const os = require('os');

const DIR = process.env.TRADER_DATA || path.join(os.homedir(), 'trader-data');
fs.mkdirSync(DIR, { recursive: true });
const f = (name) => path.join(DIR, name);

function read(name, fallback) {
  try { return JSON.parse(fs.readFileSync(f(name), 'utf8')); } catch { return fallback; }
}
function write(name, obj) { // atomic: write temp then rename
  const tmp = f(name + '.tmp');
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 1));
  fs.renameSync(tmp, f(name));
}
function append(name, obj) { fs.appendFileSync(f(name), JSON.stringify(obj) + '\n'); }
function lines(name) {
  try {
    return fs.readFileSync(f(name), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch { return []; }
}

module.exports = { DIR, read, write, append, lines };
