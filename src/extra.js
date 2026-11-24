// Extra indicators for the strategy lab (completed 1h bars only): MACD(12,26,9), RSI(14), EMA50 side, Supertrend(10,3),
// price action (engulfing, pin bar, 24h breakout, inside bar) and multi-timeframe 4h trend built from the same 1h bars.
const ema = (xs, n) => { const k = 2 / (n + 1); const o = [xs[0]]; for (let i = 1; i < xs.length; i++) o.push(xs[i] * k + o[i - 1] * (1 - k)); return o; };
const r2 = (x) => Math.round(x * 100) / 100;

function rsi(cl, n = 14) {
  let g = 0, l = 0;
  for (let i = 1; i <= n; i++) { const d = cl[i] - cl[i - 1]; if (d > 0) g += d; else l -= d; }
  g /= n; l /= n;
  for (let i = n + 1; i < cl.length; i++) { const d = cl[i] - cl[i - 1]; g = (g * (n - 1) + Math.max(d, 0)) / n; l = (l * (n - 1) + Math.max(-d, 0)) / n; }
  return l === 0 ? 100 : 100 - 100 / (1 + g / l);
}

function supertrend(done, n = 10, m = 3) {
  const h = done.map((x) => +x[2]), l = done.map((x) => +x[3]), c = done.map((x) => +x[4]);
  let atr = 0, up = 0, dn = 0, dir = 1, prevDir = 1;
  for (let i = 1; i < c.length; i++) {
    const tr = Math.max(h[i] - l[i], Math.abs(h[i] - c[i - 1]), Math.abs(l[i] - c[i - 1]));
    atr = i <= n ? (atr * (i - 1) + tr) / i : (atr * (n - 1) + tr) / n;
    const mid = (h[i] + l[i]) / 2, bu = mid + m * atr, bd = mid - m * atr;
    const nu = i === 1 || bu < up || c[i - 1] > up ? bu : up;
    const nd = i === 1 || bd > dn || c[i - 1] < dn ? bd : dn;
    prevDir = dir;
    dir = dir === 1 ? (c[i] < nd ? -1 : 1) : (c[i] > nu ? 1 : -1);
    up = nu; dn = nd;
  }
  return { stDir: dir, stFlip: dir !== prevDir ? dir : 0 };
}

// Price action on the last completed 1h bar.
function priceAction(done) {
  const b = (i) => ({ o: +done[i][1], h: +done[i][2], l: +done[i][3], c: +done[i][4] });
  const n = done.length, x = b(n - 1), p = b(n - 2);
  const body = Math.abs(x.c - x.o), rng = x.h - x.l || 1e-12;
  const upW = x.h - Math.max(x.o, x.c), loW = Math.min(x.o, x.c) - x.l;
  const engulf = x.c > x.o && p.c < p.o && x.c >= p.o && x.o <= p.c ? 1 : x.c < x.o && p.c > p.o && x.c <= p.o && x.o >= p.c ? -1 : 0;
  const pin = loW >= 2 * body && loW >= 0.6 * rng ? 1 : upW >= 2 * body && upW >= 0.6 * rng ? -1 : 0;
  const prev = done.slice(n - 25, n - 1);
  const hi = Math.max(...prev.map((k) => +k[2])), lo = Math.min(...prev.map((k) => +k[3]));
  const brk = x.c > hi ? 1 : x.c < lo ? -1 : 0;
  const inside = x.h <= p.h && x.l >= p.l ? 1 : 0;
  return { engulf, pin, brk, inside };
}

// 4h bars aggregated from the 1h bars (aligned to the latest bar); trend = 4h close vs EMA9 of 4h closes, plus 4h change.
function mtf(done) {
  const n = done.length, k4 = [];
  for (let e = n; e - 4 >= 0; e -= 4) k4.unshift(+done[e - 1][4]);
  if (k4.length < 10) return {};
  const e9 = ema(k4, 9);
  const m = k4.length;
  return { tf4h: k4[m - 1] > e9[m - 1] ? 1 : -1, ch4hb: r2((k4[m - 1] / k4[m - 2] - 1) * 100), tf4hUp: k4[m - 1] > k4[m - 2] && k4[m - 2] > k4[m - 3] ? 1 : k4[m - 1] < k4[m - 2] && k4[m - 2] < k4[m - 3] ? -1 : 0 };
}

module.exports = function extra(done, last) {
  const cl = done.map((x) => +x[4]);
  const n = cl.length;
  if (n < 52) return {};
  const e12 = ema(cl, 12), e26 = ema(cl, 26);
  const macd = cl.map((_, i) => e12[i] - e26[i]);
  const sig = ema(macd, 9);
  const hist = macd[n - 1] - sig[n - 1], histPrev = macd[n - 2] - sig[n - 2];
  const e50 = ema(cl, 50)[n - 1];
  return {
    macdH: r2((hist / last) * 1e4), // histogram in bp of price
    macdX: hist > 0 && histPrev <= 0 ? 1 : hist < 0 && histPrev >= 0 ? -1 : 0,
    rsi: r2(rsi(cl)),
    ema50: last > e50 ? 1 : -1,
    ...supertrend(done),
    ...priceAction(done),
    ...mtf(done),
  };
};
