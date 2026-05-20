# DP-Trader Paper Trading Audit

## Current State

DP-Trader can connect to Alpaca paper trading from browser-saved credentials, read paper account/positions/orders, poll Alpaca IEX latest trades, score candidate signals, apply risk checks, and submit paper bracket orders. It is still not a production trading system.

## What Is Working

- Alpaca paper account, positions, and orders are visible in Portfolio.
- Open Alpaca paper positions and unrealized P&L are shown on Main.
- AI auto trading is paper-endpoint locked.
- Pause state persists across refreshes.
- Emergency controls can cancel all open paper orders and close all paper positions.
- AI will not submit a new order while an order or position is active.
- Position sizing is capped by risk and buying power.
- Logs distinguish submitted orders from actual fills.
- Supabase/Postgres persistence is available when `DATABASE_URL` is set and `npm run db:migrate` has been run.

## Key Remaining Gaps

- Persistence now exists for account snapshots, orders, positions, system events, signals, risk decisions, and auto-trade cycles. It is only active where `DATABASE_URL` is configured.
- No fill lifecycle worker. The app sees fills only when `/api/state` refreshes Alpaca order/position data.
- No trained ML model. The current scorer is deterministic heuristic logic.
- No always-on worker. Auto trading runs only while the dashboard is open and unlocked.
- No real VWAP/opening-range strategy implementation yet. Strategy labels are placeholders over the latest market snapshot.
- No realized P&L ledger yet. Use Alpaca dashboard as source of truth for confirmed filled trades.

## Immediate Paper-Trading Rules

- Keep AI paused before changing settings.
- Use Portfolio to confirm order status.
- Treat `submitted`, `new`, `accepted`, or `held` as waiting states, not completed trades.
- Treat only `filled_qty > 0` or an open position as an actual trade.
- Use emergency controls if anything looks wrong:
  - Cancel Open Orders
  - Close Positions

## Next Free Implementation Steps

1. Add GitHub Actions cron for periodic reconciliation if no paid worker is available.
2. Replace placeholder strategies with real VWAP and opening-range calculations.
3. Add fill lifecycle reconciliation and realized P&L tables.
4. Train a local classifier only after enough paper-trading outcomes exist.
5. Add explicit OpenAI/Claude review calls only if the cost/risk tradeoff is acceptable.
