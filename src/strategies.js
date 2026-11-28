// Strategy lab: every strategy is data. long/short = condition lists [field, op, value] over the hourly snapshot.
// Fields: px ch24 ch4h ch1h (%) atr1h (%) vr (x) rng (0–1) fund (%) qvM (M USDT) emaX emaT allig bbp bbw (%); btc.<field> for BTC.
// exit: SL = clamp(ATR1h × sl_atr_k, sl_min, sl_max) %, TP = SL × tp_mult, max_hold_h hours.
const MOM_L = [['ch24', '>', 0], ['ch4h', '>', 0], ['ch1h', '>', 0], ['rng', '>=', 0.7], ['vr', '>=', 1.3], ['fund', '<=', 0.05], ['btc.ch1h', '>', -0.5]];
const MOM_S = [['ch24', '<', 0], ['ch4h', '<', 0], ['ch1h', '<', 0], ['rng', '<=', 0.3], ['vr', '>=', 1.3], ['fund', '>=', -0.05], ['btc.ch1h', '<', 0.5]];
const EX_STD = { sl_atr_k: 1, sl_min: 0.8, sl_max: 2.5, tp_mult: 3, max_hold_h: 12 };
const EX_WIDE = { sl_atr_k: 1.5, sl_min: 1.2, sl_max: 4, tp_mult: 2, max_hold_h: 12 };

const STRATEGIES = [
  { id: 'v1', long: MOM_L, short: MOM_S, exit: EX_STD, cooldownH: 0,
    desc: 'Momentum devamı + BTC rejimi; SL = ATR1h ×1 (0,8–2,5 %), TP = 3×SL, 12 saat' },
  { id: 'v2', long: MOM_L, short: MOM_S, exit: EX_STD, cooldownH: 12,
    desc: 'v1 + aynı coine 12 saat tekrar giriş yok' },
  { id: 'L-wide', long: MOM_L, short: MOM_S, exit: EX_WIDE, cooldownH: 12,
    desc: 'v2 girişleri, geniş stop: SL = ATR1h ×1,5 (1,2–4 %), TP = 2×SL' },
  { id: 'L-btc', long: [...MOM_L, ['btc.ch1h', '>', 0]], short: [...MOM_S, ['btc.ch1h', '<', 0]], exit: EX_STD, cooldownH: 12,
    desc: 'v2 girişleri + BTC aynı yönde' },
  { id: 'L-mirror', long: MOM_S, short: MOM_L, exit: EX_STD, cooldownH: 12,
    desc: 'Ayna: v2 sinyalinin tersine gir (aşırı uzamış hareketi sönümle)' },
  { id: 'L-emax', long: [['emaX', '==', 1], ['vr', '>=', 1.3], ['ch1h', '>', 0]], short: [['emaX', '==', -1], ['vr', '>=', 1.3], ['ch1h', '<', 0]], exit: EX_STD, cooldownH: 12,
    desc: 'EMA9/21 kesişimi (1s) + hacim teyidi' },
  { id: 'L-allig', long: [['allig', '==', 1], ['ch4h', '>', 0], ['vr', '>=', 1.2]], short: [['allig', '==', -1], ['ch4h', '<', 0], ['vr', '>=', 1.2]], exit: EX_WIDE, cooldownH: 12,
    desc: 'Alligator dizilimi (dudak>diş>çene) + 4s yön + hacim' },
  { id: 'L-bbbrk', long: [['bbp', '>=', 1], ['bbw', '>=', 2], ['vr', '>=', 1.5]], short: [['bbp', '<=', 0], ['bbw', '>=', 2], ['vr', '>=', 1.5]], exit: EX_STD, cooldownH: 12,
    desc: 'Bollinger(20,2) bant kırılımı + genişlik ≥2 % + hacim ≥1,5×' },
];

const OPS = { '>': (a, b) => a > b, '>=': (a, b) => a >= b, '<': (a, b) => a < b, '<=': (a, b) => a <= b, '==': (a, b) => a === b };

function matches(conds, snap, btc) {
  return conds.every(([field, op, v]) => {
    const src = field.startsWith('btc.') ? btc : snap;
    const val = src && src[field.replace(/^btc\./, '')];
    return val != null && isFinite(val) && OPS[op](val, v);
  });
}

function exitFor(e, atr1h) {
  const sl = Math.min(e.sl_max, Math.max(e.sl_min, (atr1h || e.sl_min) * e.sl_atr_k));
  return { sl_pct: Math.round(sl * 100) / 100, tp_pct: Math.round(sl * e.tp_mult * 100) / 100, max_hold_h: e.max_hold_h };
}

module.exports = { STRATEGIES, matches, exitFor };
