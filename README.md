# DP-Trader

DP-Trader is a local-first AI-assisted paper trading dashboard. It starts in safe paper mode, shows account health, ranks strategy signals, applies hard risk checks, and can optionally read Alpaca paper account data when API credentials are configured.

## Run

```bash
npm install
npm run dev
```

Open `http://localhost:8787`.

## Database

Set `DATABASE_URL` to a Supabase/Postgres connection string, then run:

```bash
npm run db:migrate
```

The database stores system events, account snapshots, positions, orders, strategy signals, risk decisions, auto-trade cycles, LLM usage records, and server-side integration API keys.

For Vercel deployments, add the same `DATABASE_URL` as a Vercel environment variable for the deployed environment, then redeploy. Local `.env` values are not available to Vercel functions unless they are configured in the Vercel project. Settings API key saves require `DATABASE_URL`; without it the Settings page will reject saves instead of showing a false saved state.

## Safety Defaults

- Paper mode is the default.
- Live trading is blocked unless both `TRADING_MODE=live` and `ENABLE_LIVE_TRADING=true` are set.
- The UI and API expose a kill switch.
- AI auto trading is locked to Alpaca paper trading. The dashboard must be open and the browser vault must be unlocked for browser-saved keys to be sent with auto-trade cycles.
- The pause button is the operating control. When not paused, the AI auto trader evaluates signals, applies risk checks, and submits approved bracket orders to Alpaca paper trading.
- Current signal scoring is deterministic heuristic logic. LLM usage remains $0 until explicit OpenAI/Claude trade-review calls are added.
- Portfolio reads Alpaca paper account, positions, and orders when credentials are available.
- `DATABASE_URL` enables durable storage. Without it, Vercel serverless state is still not durable.

## Checks

```bash
npm run check
```

This runs lint, unit tests, and a static build validation.
