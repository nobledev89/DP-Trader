# Smart Alpaca AI Trading System - Implementation Plan

## Goal

Build a live AI-assisted day trading system using Alpaca for brokerage execution, Render for backend services, Postgres for persistent state and analytics, and Vercel for the web dashboard.

The system should trade several times per hour only when high-quality conditions exist. The design prioritizes strict downside control, observable decisions, paper-trading validation, and a controlled learning loop before live capital is increased.

This is not a guarantee of profit. The system should be treated as a risk-managed research and execution platform.

## Target Architecture

```text
Vercel Dashboard
    |
    | HTTPS / WebSocket
    v
Render API Service
    |
    | reads/writes
    v
Postgres
    ^
    |
Render Worker Services
    |
    | Alpaca Trading API + Market Data API
    v
Alpaca
```

## Hosting Split

### Vercel

Use Vercel for:

- Trading dashboard
- Strategy configuration UI
- Trade history
- Model performance review
- Risk settings review
- Manual pause/resume controls
- Paper/live mode visibility

Do not run trading workers on Vercel. Serverless functions are not a good fit for persistent market data streams, scheduled trading loops, or long-running execution processes.

### Render

Use Render for:

- API service
- Market data ingestion worker
- Signal generation worker
- Execution worker
- Scheduled retraining jobs
- Daily reconciliation jobs

Recommended Render services:

- `trading-api`: FastAPI or Node API used by the dashboard.
- `market-data-worker`: subscribes to Alpaca WebSocket streams and stores bars/quotes.
- `strategy-worker`: evaluates strategies every new candle.
- `execution-worker`: places, updates, and cancels Alpaca orders.
- `learning-worker`: retrains and evaluates models after market close.

### Postgres

Use the existing Postgres instance for:

- Raw market bars
- Feature snapshots
- Strategy signals
- Orders
- Positions
- Fills
- Risk events
- Model versions
- Backtest results
- Paper/live trade outcomes

If the system grows, upgrade to TimescaleDB or partition large market-data tables by date.

## Suggested Tech Stack

Backend:

- Python 3.11+
- FastAPI
- `alpaca-py`
- SQLAlchemy or SQLModel
- Alembic migrations
- Pandas or Polars
- scikit-learn initially
- XGBoost or LightGBM later
- APScheduler, Celery, or Render cron jobs for scheduled tasks

Frontend:

- Next.js on Vercel
- TypeScript
- Tailwind or shadcn/ui
- Recharts or Lightweight Charts

Infrastructure:

- Render web service for API
- Render background workers
- Render cron jobs
- Existing Postgres
- Environment variables for API keys and secrets

## Environment Variables

Backend:

```text
DATABASE_URL=
ALPACA_API_KEY=
ALPACA_SECRET_KEY=
ALPACA_BASE_URL=https://paper-api.alpaca.markets
ALPACA_DATA_FEED=iex
TRADING_MODE=paper
MAX_DAILY_LOSS_PCT=1.0
MAX_RISK_PER_TRADE_PCT=0.25
MAX_OPEN_POSITIONS=3
ENABLE_LIVE_TRADING=false
```

Frontend:

```text
NEXT_PUBLIC_API_BASE_URL=
```

Use Alpaca paper trading by default. Live trading should require both:

- `TRADING_MODE=live`
- `ENABLE_LIVE_TRADING=true`

## Data Provider Plan

### Phase 1: MVP

Use Alpaca Basic market data:

- Free
- Works for paper trading
- IEX-only for real-time US equities
- Limited WebSocket subscriptions

This is acceptable for validating system plumbing and strategy behavior, but not ideal for live day trading.

### Phase 2: Live Trading

Use Alpaca Algo Trader Plus if live trading US equities:

- Full US stock exchange coverage
- Better for spread, volume, and execution decisions
- Lower risk of making decisions from incomplete IEX-only data

### Optional Cheap Secondary Sources

Use secondary sources only for research, fallback checks, or non-critical features:

- Polygon/Massive: historical aggregates and reference data.
- Twelve Data: cheap real-time or historical support.
- Alpha Vantage: slow research, indicators, and fundamentals.
- Finnhub: news, sentiment, analyst events, and fundamentals.

Do not mix live execution decisions across feeds without timestamp and latency controls.

## Core Services

### 1. Market Data Worker

Responsibilities:

- Subscribe to Alpaca WebSocket streams.
- Build 1-minute bars.
- Aggregate 3-minute, 5-minute, and 15-minute bars.
- Store raw bars and feature-ready bars.
- Detect stale data and disconnects.
- Publish data health status.

Initial symbols:

- SPY
- QQQ
- AAPL
- MSFT
- NVDA
- TSLA
- AMD
- META
- AMZN
- GOOGL

Expand only after the system is stable.

### 2. Strategy Engine

Start with explainable strategies:

- VWAP pullback continuation
- Opening range breakout
- High-liquidity mean reversion
- No-trade regime filter

Every strategy should produce:

```json
{
  "symbol": "NVDA",
  "strategy": "vwap_pullback",
  "direction": "long",
  "confidence": 0.72,
  "entry_price": 123.45,
  "stop_price": 122.80,
  "target_price": 124.75,
  "expected_r_multiple": 2.0,
  "features": {},
  "reason_codes": ["above_vwap", "relative_volume_high", "pullback_held"]
}
```

### 3. AI Signal Scorer

The first AI model should be a supervised classifier, not an autonomous LLM trader.

Prediction target:

- Will this setup reach `+1R` before `-1R` within the next `N` bars?

Initial features:

- Distance from VWAP
- EMA slope
- RSI
- ATR percentage
- Relative volume
- Spread percentage
- Time of day
- Market regime from SPY/QQQ
- Previous candle range
- Breakout distance
- Recent win/loss performance by strategy

Model output:

- `probability_of_success`
- `expected_r`
- `reject_reason` when confidence is too low

The AI model filters and ranks strategy signals. It should not place trades directly.

### 4. Risk Manager

Hard requirements:

- Max risk per trade: `0.10%` to `0.25%` of equity.
- Max daily loss: `0.75%` to `1.5%` of equity.
- Max open positions: `1` initially, `3` after validation.
- Max trades per hour: configurable, default `4`.
- Max trades per day: configurable, default `12`.
- Reject trades with poor spread or low liquidity.
- Reject trades below `1.5R` reward/risk.
- Stop trading after daily loss limit.
- Stop trading after repeated execution errors.
- Stop trading if market data is stale.
- Close intraday positions before market close unless strategy explicitly allows holding.

Position size formula:

```text
risk_amount = account_equity * max_risk_per_trade_pct
risk_per_share = abs(entry_price - stop_price)
shares = floor(risk_amount / risk_per_share)
```

### 5. Execution Worker

Responsibilities:

- Convert approved signals into Alpaca orders.
- Prefer limit orders.
- Use bracket orders where practical.
- Track order lifecycle.
- Reconcile fills against Alpaca positions.
- Cancel stale unfilled orders.
- Enforce the kill switch before every order.

Order flow:

```text
signal -> risk check -> order intent -> submit order -> confirm accepted -> monitor fill -> attach/verify exits -> reconcile
```

### 6. Learning Worker

The agent should learn through controlled retraining:

- Log every signal, rejected signal, order, fill, and outcome.
- Calculate realized R multiple per trade.
- Calculate max favorable excursion and max adverse excursion.
- Retrain after market close.
- Backtest candidate models on walk-forward windows.
- Run candidate models in shadow mode before live use.
- Promote only if they outperform the active model after costs and slippage.

Model promotion stages:

```text
candidate -> paper_shadow -> paper_active -> live_small -> live_active
```

No model should be promoted automatically without meeting objective thresholds.

## Database Tables

Minimum tables:

- `symbols`
- `market_bars`
- `feature_snapshots`
- `strategy_signals`
- `risk_decisions`
- `order_intents`
- `orders`
- `fills`
- `positions`
- `trades`
- `daily_account_snapshots`
- `model_versions`
- `model_predictions`
- `backtest_runs`
- `system_events`

Important fields for auditability:

- `created_at`
- `symbol`
- `strategy`
- `model_version`
- `features_json`
- `decision`
- `reason_codes`
- `account_equity`
- `risk_amount`
- `expected_r`
- `realized_r`
- `paper_or_live`

## Dashboard Pages

### Overview

- Account equity
- Daily P&L
- Open positions
- Current risk state
- Trading mode
- Kill switch status
- Data feed health

### Live Signals

- Current strategy signals
- AI score
- Risk decision
- Rejection reason
- Suggested entry, stop, and target

### Orders & Trades

- Open orders
- Filled orders
- Trade lifecycle
- Realized R
- Slippage
- Fees

### Strategy Performance

- Win rate
- Profit factor
- Average R
- Max drawdown
- Performance by symbol
- Performance by time of day
- Performance by strategy

### Model Performance

- Active model version
- Shadow model comparison
- Prediction calibration
- Feature importance
- Promotion status

### Settings

- Paper/live mode display
- Risk limits
- Symbol universe
- Strategy enable/disable
- Emergency pause

## Build Phases

### Phase 0: Project Setup

- Create monorepo or two repos:
  - `apps/api`
  - `apps/web`
  - `workers/*`
- Add environment variable templates.
- Configure Postgres connection.
- Configure Render services.
- Configure Vercel project.

### Phase 1: Alpaca Paper Trading MVP

- Connect to Alpaca paper account.
- Fetch account, positions, and orders.
- Stream or poll market bars.
- Store bars in Postgres.
- Add dashboard read-only views.
- Add manual kill switch.

Exit criteria:

- Dashboard shows account, positions, recent bars, and system health.
- No live trading enabled.

### Phase 2: Strategy + Risk Engine

- Implement VWAP pullback strategy.
- Implement opening range breakout strategy.
- Implement risk checks.
- Log approved and rejected signals.
- Paper trade using small simulated risk.

Exit criteria:

- Every signal has a reason.
- Every rejected trade has a rejection reason.
- Daily loss limit and stale data guard are tested.

### Phase 3: Execution Automation

- Submit Alpaca paper orders.
- Use limit or bracket orders.
- Track fills and exits.
- Reconcile positions.
- Add order failure handling.

Exit criteria:

- Paper orders execute end to end.
- Positions cannot exceed configured limits.
- Kill switch prevents new orders.

### Phase 4: Backtesting + Analytics

- Build historical backtest runner.
- Include slippage assumptions.
- Compare strategy performance by symbol and time of day.
- Add model-ready feature snapshots.

Exit criteria:

- Backtests produce reproducible results.
- Strategy changes can be compared before deployment.

### Phase 5: AI Scoring

- Train first supervised model.
- Store model versions.
- Score strategy signals.
- Run model in shadow mode.
- Add model dashboard.

Exit criteria:

- AI score improves filtering in paper trading.
- No live order is placed solely because of an LLM response.

### Phase 6: Controlled Live Rollout

- Upgrade data feed if needed.
- Enable live mode only with small position sizes.
- Start with one symbol or ETF.
- Use reduced max risk per trade.
- Review every live trade manually.

Exit criteria:

- Stable execution.
- Slippage is measured.
- Drawdown remains within expected limits.
- Paper and live behavior are consistent.

## Initial Risk Defaults

```text
max_risk_per_trade_pct = 0.10
max_daily_loss_pct = 0.75
max_open_positions = 1
max_trades_per_hour = 3
max_trades_per_day = 8
min_reward_risk = 1.5
min_avg_volume = 2000000
max_spread_pct = 0.08
no_new_trades_after = 15:30 America/New_York
force_flat_time = 15:55 America/New_York
```

These can be loosened only after statistically meaningful paper trading results.

## Compliance and Operational Notes

- Confirm Alpaca account permissions before live trading.
- Understand pattern day trading rules before trading frequently in a margin account.
- Keep API keys server-side only.
- Never expose Alpaca secrets to Vercel client code.
- Maintain immutable logs for live trading decisions.
- Add alerting for daily loss, API failure, stale data, and unexpected position state.
- Start with paper trading for at least 30 market days before live deployment.

## Recommended First Milestone

Build the first milestone as a read-only system:

1. Render API connects to Postgres.
2. Render worker pulls Alpaca paper account and market bars.
3. Postgres stores bars and account snapshots.
4. Vercel dashboard displays account state, recent prices, and system health.
5. No automated orders yet.

This proves the deployment, credentials, database, and dashboard path before risking execution bugs.

