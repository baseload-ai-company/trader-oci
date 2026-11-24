# trader-oci

Binance USDT-M paper trader running on an Oracle Always Free VM (Frankfurt). Public endpoints only, no API keys, no secrets.

- `deploy/bootstrap.sh`: clones the repo, installs cron (git pull every 5 min, hourly run at minute 1).
- `src/hour.js`: hourly entry point (lock-protected).
- `src/engine.js`: paper engine: 1m replay for SL/TP/timeout, funding, isolated-margin liquidation, real book (active strategy, wallet) + shadow book (every lab strategy).
- `src/strategies.js`: strategy lab as data.
- Data lives on the VM in `~/trader-data` (state.json, pos.json, spos.json, trades.jsonl, strades.jsonl, evals.jsonl, runs.jsonl).

Switch rule (trade-count based, not on a clock): evaluated after every 10 closed trades (real + lab). A lab strategy replaces the active one when, since the active strategy started, it has n >= 10 shadow trades, PF >= 1.3 and PF >= active PF + 0.3. If the first 10 real trades after a switch have PF < 1, the bar goes to n >= 20.
