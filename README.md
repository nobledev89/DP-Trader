# DP-Trader

DP-Trader is a local-first AI-assisted paper trading dashboard. It starts in safe paper mode, shows account health, ranks strategy signals, applies hard risk checks, and can optionally read Alpaca paper account data when API credentials are configured.

## Run

```bash
npm install
npm run dev
```

Open `http://localhost:8787`.

No package dependencies are required today, so `npm install` is optional unless you add packages later.

## Safety Defaults

- Paper mode is the default.
- Live trading is blocked unless both `TRADING_MODE=live` and `ENABLE_LIVE_TRADING=true` are set.
- The UI and API expose a kill switch.
- Orders in this first implementation are simulated paper orders. Alpaca keys are only used server-side for read-only account, position, and order views.

## Checks

```bash
npm run check
```

This runs lint, unit tests, and a static build validation.
