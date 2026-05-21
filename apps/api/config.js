export function readConfig(env = process.env) {
  const number = (key, fallback) => {
    const raw = env[key];
    if (raw === undefined || raw === "") return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  const tradingMode = env.TRADING_MODE === "live" ? "live" : "paper";
  const liveTradingEnabled = env.ENABLE_LIVE_TRADING === "true";
  const symbols = parseSymbols(env.SYMBOLS);

  return {
    port: number("PORT", 8787),
    tradingMode,
    liveTradingEnabled,
    symbols,
    alpaca: {
      key: env.ALPACA_API_KEY || "",
      secret: env.ALPACA_SECRET_KEY || "",
      baseUrl: env.ALPACA_BASE_URL || "https://paper-api.alpaca.markets",
      dataFeed: env.ALPACA_DATA_FEED || "iex"
    },
    anthropic: {
      key: env.ANTHROPIC_API_KEY || "",
      model: env.ANTHROPIC_MODEL || "claude-sonnet-4-6"
    },
    openai: {
      key: env.OPENAI_API_KEY || "",
      model: env.OPENAI_MODEL || "gpt-4o-mini"
    },
    risk: {
      maxDailyLossPct: number("MAX_DAILY_LOSS_PCT", 0.75),
      maxRiskPerTradePct: number("MAX_RISK_PER_TRADE_PCT", 0.2),
      maxOpenPositions: number("MAX_OPEN_POSITIONS", 5),
      maxCorrelatedPositions: number("MAX_CORRELATED_POSITIONS", 1),
      maxTradesPerHour: number("MAX_TRADES_PER_HOUR", 10),
      maxTradesPerDay: number("MAX_TRADES_PER_DAY", 80),
      minRewardRisk: number("MIN_REWARD_RISK", 1.1),
      maxSpreadPct: number("MAX_SPREAD_PCT", 0.1),
      minAvgVolume: number("MIN_AVG_VOLUME", 2000000),
      minCryptoDollarVolume: number("MIN_CRYPTO_DOLLAR_VOLUME", 5000),
      maxExecutionErrors: number("MAX_EXECUTION_ERRORS", 3),
      maxPositionValuePct: number("MAX_POSITION_VALUE_PCT", 20),
      minAutoConfidence: number("MIN_AUTO_CONFIDENCE", 0.6),
      allowExtendedHours: env.ALLOW_EXTENDED_HOURS !== "false",
      scalpingEnabled: env.SCALPING_ENABLED !== "false",
      autoTradeIntervalSeconds: number("AUTO_TRADE_INTERVAL_SECONDS", 30),
      minHoldMinutes: number("MIN_HOLD_MINUTES", 5),
      maxHoldMinutes: number("MAX_HOLD_MINUTES", 120),
      quickProfitPct: number("QUICK_PROFIT_PCT", 0.6),
      quickStopPct: number("QUICK_STOP_PCT", 0.3)
    }
  };
}

export function assertLiveTradingAllowed(config) {
  return config.tradingMode === "live" && config.liveTradingEnabled;
}

function parseSymbols(raw) {
  const defaults = [
    "SPY", "QQQ", "AAPL", "MSFT", "NVDA", "TSLA", "AMD", "META", "AMZN", "GOOGL",
    "IBIT", "ETHE", "BTC/USD", "ETH/USD", "SOL/USD", "GLD", "SLV", "USO", "TLT", "UUP"
  ];
  if (!raw || !raw.trim()) return defaults;
  const symbols = raw
    .split(",")
    .map((symbol) => symbol.trim().toUpperCase())
    .filter((symbol) => /^[A-Z][A-Z0-9.]{0,9}(\/[A-Z][A-Z0-9]{1,9})?$/.test(symbol));
  return [...new Set(symbols)].slice(0, 50);
}
