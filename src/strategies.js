// Strategy lab: every strategy is data. long/short = condition lists [field, op, value] over the hourly snapshot.
// Fields: px ch24 ch4h ch1h (%) atr1h (%) vr (x) rng (0–1) fund (%) qvM (M USDT) emaX emaT allig bbp bbw (%)
// macdH (bp) macdX (±1 cross) rsi (0–100) ema50 (±1 side) stDir stFlip (Supertrend 10,3)
// price action: engulf pin brk (±1) inside (1); multi-timeframe: tf4h (±1 vs 4h EMA9) tf4hUp (±1, 2 rising/falling 4h bars); btc.<field> for BTC.
// exit: SL = clamp(ATR1h × sl_atr_k, sl_min, sl_max) %, TP = SL × tp_mult, max_hold_h hours.
const MOM_L = [['ch24', '>', 0], ['ch4h', '>', 0], ['ch1h', '>', 0], ['rng', '>=', 0.7], ['vr', '>=', 1.3], ['fund', '<=', 0.05], ['btc.ch1h', '>', -0.5]];
const MOM_S = [['ch24', '<', 0], ['ch4h', '<', 0], ['ch1h', '<', 0], ['rng', '<=', 0.3], ['vr', '>=', 1.3], ['fund', '>=', -0.05], ['btc.ch1h', '<', 0.5]];
const EX_STD = { sl_atr_k: 1, sl_min: 0.8, sl_max: 2.5, tp_mult: 3, max_hold_h: 12 };
const EX_WIDE = { sl_atr_k: 1.5, sl_min: 1.2, sl_max: 4, tp_mult: 2, max_hold_h: 12 };
const EX_ATR15 = { sl_atr_k: 1.5, sl_min: 1.5, sl_max: 15, tp_mult: 1.5, max_hold_h: 8 }; // stop outside 1h noise, nearer target; lev follows the stop
const EX_NEAR = { sl_atr_k: 1, sl_min: 0.8, sl_max: 2.5, tp_mult: 1.5, max_hold_h: 8 }; // nearer target: losses that saw half the TP then reversed
const EX_ATR = { sl_atr_k: 1, sl_min: 0.8, sl_max: 12, tp_mult: 2, max_hold_h: 12 }; // stop follows real ATR; leverageFor() lowers lev to keep SL inside liq

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
  { id: 'L-atr', long: MOM_L, short: MOM_S, exit: EX_ATR, cooldownH: 12,
    desc: 'v2 girişleri, gerçek ATR stopu: SL = ATR1h ×1 (0,8–12 %), TP = 2×SL; kaldıraç stopa göre düşer' },
  { id: 'L-atrfit', long: [...MOM_L, ['atr1h', '<=', 2.5]], short: [...MOM_S, ['atr1h', '<=', 2.5]], exit: EX_STD, cooldownH: 12,
    desc: 'v2 girişleri, yalnız ATR1h ≤ 2,5 % coinler (stop gürültünün içinde kalmasın)' },
  { id: 'L-macd', long: [['macdX', '==', 1], ['ema50', '==', 1], ['vr', '>=', 1.2]], short: [['macdX', '==', -1], ['ema50', '==', -1], ['vr', '>=', 1.2]], exit: EX_WIDE, cooldownH: 12,
    desc: 'MACD(12,26,9) histogram kesişimi + EMA50 yönü + hacim ≥1,2×' },
  { id: 'L-rsi', long: [['ema50', '==', 1], ['rsi', '>=', 40], ['rsi', '<=', 55], ['ch1h', '>', 0]], short: [['ema50', '==', -1], ['rsi', '>=', 45], ['rsi', '<=', 60], ['ch1h', '<', 0]], exit: EX_STD, cooldownH: 12,
    desc: 'Trend içi geri çekilme: EMA50 yönünde, RSI(14) 40–55 (short 45–60), son saat dönüş' },
  { id: 'L-st', long: [['stFlip', '==', 1], ['vr', '>=', 1.2]], short: [['stFlip', '==', -1], ['vr', '>=', 1.2]], exit: EX_ATR, cooldownH: 12,
    desc: 'Supertrend(10,3) dönüşü + hacim; ATR stop, kaldıraç stopa göre' },
  { id: 'L-stfade', long: [['stFlip', '==', 1], ['ch24', '<=', -5]], short: [['stFlip', '==', -1], ['ch24', '>=', 5]], exit: EX_WIDE, cooldownH: 12,
    desc: 'Supertrend dönüşü 24s hareketin tersine (Saga6 fikri: yorulan trendi sönümle)' },
  { id: 'L-engulf', long: [['engulf', '==', 1], ['ema50', '==', 1], ['vr', '>=', 1.2]], short: [['engulf', '==', -1], ['ema50', '==', -1], ['vr', '>=', 1.2]], exit: EX_STD, cooldownH: 12,
    desc: 'Price action: yutan mum (1s) EMA50 yönünde + hacim' },
  { id: 'L-pin', long: [['pin', '==', 1], ['rsi', '<=', 45]], short: [['pin', '==', -1], ['rsi', '>=', 55]], exit: EX_STD, cooldownH: 12,
    desc: 'Price action: pin bar reddi (uzun fitil) + RSI aşırı bölgeye yakın' },
  { id: 'L-brk', long: [['brk', '==', 1], ['vr', '>=', 1.5]], short: [['brk', '==', -1], ['vr', '>=', 1.5]], exit: EX_WIDE, cooldownH: 12,
    desc: 'Price action: 1s kapanış önceki 24 saatin zirve/dibini kırdı + hacim ≥1,5×' },
  { id: 'L-mtf', long: [['tf4h', '==', 1], ['tf4hUp', '==', 1], ['ema50', '==', 1], ['rsi', '>=', 45], ['rsi', '<=', 65], ['ch1h', '>', 0]], short: [['tf4h', '==', -1], ['tf4hUp', '==', -1], ['ema50', '==', -1], ['rsi', '>=', 35], ['rsi', '<=', 55], ['ch1h', '<', 0]], exit: EX_STD, cooldownH: 12,
    desc: 'Çoklu zaman dilimi: 4s trend + 4s ardışık yön + 1s EMA50 aynı yönde, RSI aşırı değil' },
  { id: 'L-mtfpa', long: [['tf4h', '==', 1], ['engulf', '==', 1]], short: [['tf4h', '==', -1], ['engulf', '==', -1]], exit: EX_STD, cooldownH: 12,
    desc: 'Çoklu zaman dilimi + price action: 4s trend yönünde 1s yutan mum' },
  // [2026-11-27] Lab refill: 7 slots open after 11 retirements. Built from what survived (trend-side entries with
  // confirmation: engulf+EMA50, EMA cross, BTC filter, wide stop) — breakout, fade and strict-MTF ideas are not repeated.
  { id: 'L-engwide', long: [['engulf', '==', 1], ['ema50', '==', 1], ['vr', '>=', 1.2]], short: [['engulf', '==', -1], ['ema50', '==', -1], ['vr', '>=', 1.2]], exit: EX_WIDE, cooldownH: 12,
    desc: 'L-engulf girişleri, geniş stop: SL = ATR1h ×1,5 (1,2–4 %), TP = 2×SL' },
  { id: 'L-engbtc', long: [['engulf', '==', 1], ['ema50', '==', 1], ['vr', '>=', 1.2], ['btc.ch1h', '>', 0]], short: [['engulf', '==', -1], ['ema50', '==', -1], ['vr', '>=', 1.2], ['btc.ch1h', '<', 0]], exit: EX_STD, cooldownH: 12,
    desc: 'L-engulf girişleri + BTC son saat aynı yönde' },
  { id: 'L-btcwide', long: [...MOM_L, ['btc.ch1h', '>', 0]], short: [...MOM_S, ['btc.ch1h', '<', 0]], exit: EX_WIDE, cooldownH: 12,
    desc: 'L-btc girişleri, geniş stop: SL = ATR1h ×1,5 (1,2–4 %), TP = 2×SL' },
  { id: 'L-emat', long: [['emaX', '==', 1], ['ema50', '==', 1], ['vr', '>=', 1.3]], short: [['emaX', '==', -1], ['ema50', '==', -1], ['vr', '>=', 1.3]], exit: EX_STD, cooldownH: 12,
    desc: 'EMA9/21 kesişimi yalnız EMA50 trendi yönünde + hacim ≥1,3×' },
  { id: 'L-macdema', long: [['macdH', '>', 0], ['emaX', '==', 1], ['vr', '>=', 1.2]], short: [['macdH', '<', 0], ['emaX', '==', -1], ['vr', '>=', 1.2]], exit: EX_WIDE, cooldownH: 12,
    desc: 'EMA9/21 kesişimi + MACD histogram aynı tarafta + hacim ≥1,2×; geniş stop' },
  { id: 'L-tfema', long: [['tf4h', '==', 1], ['emaX', '==', 1], ['ema50', '==', 1]], short: [['tf4h', '==', -1], ['emaX', '==', -1], ['ema50', '==', -1]], exit: EX_STD, cooldownH: 12,
    desc: 'Çoklu zaman dilimi (hafif): 4s EMA9 yönünde 1s EMA9/21 kesişimi + EMA50' },
  { id: 'L-impulse', long: [['ch1h', '>=', 1], ['vr', '>=', 2], ['ema50', '==', 1], ['rsi', '<=', 70]], short: [['ch1h', '<=', -1], ['vr', '>=', 2], ['ema50', '==', -1], ['rsi', '>=', 30]], exit: EX_STD, cooldownH: 12,
    desc: 'Hacimli itki: son saat ≥1 % + hacim ≥2× trend yönünde, RSI aşırı değil' },
  // [2026-11-27] Stop-noise test: 8 of 22 real v2 losses were stopped within 5 min with a fixed 2.5 % stop on coins whose
  // ATR1h is 4–11 %. Stop = ATR1h ×1.5 (1.5–15 %), TP = 1.5×SL, 8 h. Replaces retired-by-hand L-stfade and L-atrfit.
  { id: 'L-atr15', long: MOM_L, short: MOM_S, exit: EX_ATR15, cooldownH: 12,
    desc: 'v2 girişleri, ATR stopu: SL = ATR1h ×1,5 (1,5–15 %), TP = 1,5×SL, 8 saat; kaldıraç stopa göre düşer' },
  { id: 'L-engatr', long: [['engulf', '==', 1], ['ema50', '==', 1], ['vr', '>=', 1.2]], short: [['engulf', '==', -1], ['ema50', '==', -1], ['vr', '>=', 1.2]], exit: EX_ATR15, cooldownH: 12,
    desc: 'L-engulf girişleri, ATR stopu: SL = ATR1h ×1,5 (1,5–15 %), TP = 1,5×SL, 8 saat' },
  // [2026-11-27 21:00] Lab refill (3 slots): L-engulf losses saw half the TP then reversed (45.5 %) → nearer TP;
  // L-btc losses stopped within 15 min (53.3 %) → ATR stop outside noise; engulf late entries → RSI not stretched.
  { id: 'L-engnear', long: [['engulf', '==', 1], ['ema50', '==', 1], ['vr', '>=', 1.2]], short: [['engulf', '==', -1], ['ema50', '==', -1], ['vr', '>=', 1.2]], exit: EX_NEAR, cooldownH: 12,
    desc: 'L-engulf girişleri, yakın hedef: SL = ATR1h ×1 (0,8–2,5 %), TP = 1,5×SL, 8 saat' },
  { id: 'L-btcatr', long: [...MOM_L, ['btc.ch1h', '>', 0]], short: [...MOM_S, ['btc.ch1h', '<', 0]], exit: EX_ATR15, cooldownH: 12,
    desc: 'L-btc girişleri, ATR stopu: SL = ATR1h ×1,5 (1,5–15 %), TP = 1,5×SL, 8 saat; kaldıraç stopa göre düşer' },
  { id: 'L-engrsi', long: [['engulf', '==', 1], ['ema50', '==', 1], ['vr', '>=', 1.2], ['rsi', '>=', 40], ['rsi', '<=', 65]], short: [['engulf', '==', -1], ['ema50', '==', -1], ['vr', '>=', 1.2], ['rsi', '>=', 35], ['rsi', '<=', 60]], exit: EX_STD, cooldownH: 12,
    desc: 'L-engulf girişleri, RSI(14) 40–65 (short 35–60): uzamış harekette geç girişi ele' },
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

// Retired strategies (retire.js) are left out of the scan and the switch rule; their closed trades stay in the history.
const RETIRED = new Set(require('./retire').retiredIds());

module.exports = { STRATEGIES: STRATEGIES.filter((x) => !RETIRED.has(x.id)), ALL_STRATEGIES: STRATEGIES, RETIRED, matches, exitFor };
