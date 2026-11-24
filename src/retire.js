// Lab housekeeping: a strategy whose shadow book reaches RULE.maxLosers losing trades while its PF is below RULE.pf is
// retired for good (retired.json, never revived). The live strategy is exempt (the switch rule replaces it). The lab is
// capped at RULE.cap strategies: a new strategy is only added when retirements open a slot.
const db = require('./store');

const RULE = { maxLosers: 7, pf: 1.0, cap: 15 };

const retiredIds = () => Object.keys(db.read('retired.json', {}));

function retire(active) {
  const ret = db.read('retired.json', {});
  const by = {};
  for (const t of db.lines('strades.jsonl')) {
    const s = (by[t.strategy] ||= { n: 0, losers: 0, w: 0, l: 0 });
    s.n += 1;
    if (t.net > 0) s.w += t.net; else { s.losers += 1; s.l -= t.net; }
  }
  const now = [];
  for (const [id, s] of Object.entries(by)) {
    if (id === active || ret[id]) continue;
    const pf = s.l > 0 ? s.w / s.l : 99;
    if (s.losers >= RULE.maxLosers && pf < RULE.pf) {
      ret[id] = { at: new Date().toISOString(), n: s.n, losers: s.losers, pf: Math.round(pf * 100) / 100, net: Math.round((s.w - s.l) * 1e4) / 1e4 };
      now.push(id);
    }
  }
  if (now.length) db.write('retired.json', ret);
  return now;
}

module.exports = { RULE, retire, retiredIds };
