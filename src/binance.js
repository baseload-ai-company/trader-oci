// Binance USDT-M public endpoints only (no API key). Units: prices USDT, percentages %.
const BASE = 'https://fapi.binance.com';

async function get(path, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const url = `${BASE}${path}${qs ? '?' + qs : ''}`;
  for (let i = 0; i < 3; i++) {
    const r = await fetch(url);
    if (r.ok) return r.json();
    if (r.status === 418 || r.status === 451 || r.status === 403) throw new Error(`Binance ${r.status} ${path}`);
    await new Promise((res) => setTimeout(res, 1500 * (i + 1)));
  }
  throw new Error(`Binance tekrar denemeleri başarısız: ${path}`);
}

module.exports = {
  ticker24h: () => get('/fapi/v1/ticker/24hr'),
  premiumAll: () => get('/fapi/v1/premiumIndex'),
  klines: (symbol, interval, extra = {}) => get('/fapi/v1/klines', { symbol, interval, ...extra }),
  fundingRate: (symbol, startTime, endTime) => get('/fapi/v1/fundingRate', { symbol, startTime, endTime, limit: 100 }),
  exchangeInfo: () => get('/fapi/v1/exchangeInfo'),
};
