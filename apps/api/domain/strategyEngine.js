const SYMBOLS = ["SPY", "QQQ", "AAPL", "MSFT", "NVDA", "TSLA", "AMD", "META", "AMZN", "GOOGL"];

export function generateMarketSnapshot(now = new Date()) {
  const tick = now.getTime() / 1000;
  return SYMBOLS.map((symbol, index) => {
    const base = 92 + index * 23;
    const wave = Math.sin(tick / 17 + index) * 1.8;
    const pulse = Math.cos(tick / 5 + index * 0.71) * 0.28;
    const microMove = Math.sin(tick / 2.7 + index * 1.9) * 0.09;
    const price = Number((base + wave + pulse + microMove + index * 0.37).toFixed(2));
    const spreadPct = Number((0.018 + (index % 4) * 0.011).toFixed(3));
    return {
      symbol,
      price,
      vwap: Number((price - 0.34 + index * 0.03).toFixed(2)),
      changePct: Number((Math.sin(tick / 29 + index) * 1.2 + Math.cos(tick / 11 + index) * 0.16).toFixed(2)),
      relativeVolume: Number((1.05 + ((Math.floor(tick / 3) + index) % 8) / 10).toFixed(2)),
      spreadPct,
      updatedAt: now.toISOString()
    };
  });
}

export function buildSignals(marketSnapshot, marketContext = { spyTrend: "up" }) {
  return marketSnapshot.map((bar, index) => {
    const entryPrice = Number((bar.price + 0.03).toFixed(2));
    const stopDistance = Number(Math.max(0.24, bar.price * 0.0045).toFixed(2));
    const targetDistance = Number((stopDistance * (1.6 + (index % 3) * 0.25)).toFixed(2));
    const signal = {
      id: `${bar.symbol}-${bar.updatedAt}`,
      symbol: bar.symbol,
      strategy: index % 2 === 0 ? "vwap_pullback" : "opening_range_breakout",
      direction: "long",
      confidence: 0,
      entryPrice,
      stopPrice: Number((entryPrice - stopDistance).toFixed(2)),
      targetPrice: Number((entryPrice + targetDistance).toFixed(2)),
      expectedR: Number((targetDistance / stopDistance).toFixed(2)),
      spreadPct: bar.spreadPct,
      relativeVolume: bar.relativeVolume,
      avgVolume: 2500000 + index * 700000,
      aboveVwap: bar.price >= bar.vwap,
      emaSlope: Number((0.08 + Math.sin(index + bar.price) * 0.05).toFixed(3)),
      rsi: Math.round(49 + ((bar.price + index) % 19)),
      atrPct: Number((1.1 + (index % 5) * 0.44).toFixed(2)),
      features: {
        distanceFromVwapPct: Number(((bar.price - bar.vwap) / bar.vwap * 100).toFixed(2)),
        relativeVolume: bar.relativeVolume,
        spyTrend: marketContext.spyTrend
      }
    };
    return signal;
  });
}
