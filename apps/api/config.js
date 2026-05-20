export function readConfig(env = process.env) {
  const number = (key, fallback) => {
    const raw = env[key];
    if (raw === undefined || raw === "") return fallback;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : fallback;
  };

  const tradingMode = env.TRADING_MODE === "live" ? "live" : "paper";
  const liveTradingEnabled = env.ENABLE_LIVE_TRADING === "true";

  return {
    port: number("PORT", 8787),
    tradingMode,
    liveTradingEnabled,
    alpaca: {
      key: env.ALPACA_API_KEY || "",
      secret: env.ALPACA_SECRET_KEY || "",
      baseUrl: env.ALPACA_BASE_URL || "https://paper-api.alpaca.markets",
      dataFeed: env.ALPACA_DATA_FEED || "iex"
    },
    risk: {
      maxDailyLossPct: number("MAX_DAILY_LOSS_PCT", 0.75),
      maxRiskPerTradePct: number("MAX_RISK_PER_TRADE_PCT", 0.1),
      maxOpenPositions: number("MAX_OPEN_POSITIONS", 1),
      maxTradesPerHour: number("MAX_TRADES_PER_HOUR", 3),
      maxTradesPerDay: number("MAX_TRADES_PER_DAY", 8),
      minRewardRisk: number("MIN_REWARD_RISK", 1.5),
      maxSpreadPct: number("MAX_SPREAD_PCT", 0.08),
      minAvgVolume: number("MIN_AVG_VOLUME", 2000000),
      maxExecutionErrors: number("MAX_EXECUTION_ERRORS", 3),
      maxPositionValuePct: number("MAX_POSITION_VALUE_PCT", 20)
    }
  };
}

export function assertLiveTradingAllowed(config) {
  return config.tradingMode === "live" && config.liveTradingEnabled;
}
