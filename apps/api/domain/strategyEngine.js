const SYMBOLS = ["SPY", "QQQ", "AAPL", "MSFT", "NVDA", "TSLA", "AMD", "META", "AMZN", "GOOGL", "IBIT", "ETHE", "GLD", "SLV", "USO", "TLT", "UUP"];

export function generateMarketSnapshot(now = new Date(), symbols = SYMBOLS) {
  const tick = now.getTime() / 1000;
  return symbols.map((symbol, index) => {
    const base = 92 + index * 23;
    const wave = Math.sin(tick / 17 + index) * 1.8;
    const pulse = Math.cos(tick / 5 + index * 0.71) * 0.28;
    const microMove = Math.sin(tick / 2.7 + index * 1.9) * 0.09;
    const price = Number((base + wave + pulse + microMove + index * 0.37).toFixed(2));
    const spreadPct = Number((0.018 + (index % 4) * 0.011).toFixed(3));
    const emaSlope = Number((Math.cos(tick / 23 + index) * 0.08).toFixed(4));
    const atr14 = Number(Math.max(0.35, price * 0.0035).toFixed(4));
    return {
      symbol,
      price,
      tradePrice: price,
      bid: 0,
      ask: 0,
      vwap: Number((price - 0.34 + index * 0.03).toFixed(2)),
      changePct: Number((Math.sin(tick / 29 + index) * 1.2 + Math.cos(tick / 11 + index) * 0.16).toFixed(2)),
      relativeVolume: Number((1.05 + ((Math.floor(tick / 3) + index) % 8) / 10).toFixed(2)),
      spreadPct,
      avgVolume: 2500000 + index * 700000,
      rsi14: Number((54 + Math.sin(tick / 31 + index) * 12).toFixed(2)),
      ema20: Number((price - emaSlope).toFixed(4)),
      ema50: Number((price - emaSlope * 2).toFixed(4)),
      emaSlope,
      atr14,
      atrPct: Number(((atr14 / price) * 100).toFixed(3)),
      aboveVwap: price >= Number((price - 0.34 + index * 0.03).toFixed(2)),
      aboveEma20: emaSlope >= 0,
      aboveEma50: emaSlope >= 0,
      updatedAt: now.toISOString(),
      source: "simulated"
    };
  });
}

export function buildSignals(marketSnapshot, marketContext = { spyTrend: "up" }) {
  return marketSnapshot.flatMap((bar, index) => {
    const direction = pickDirection(bar);
    if (!direction) return [];

    const referencePrice = (direction === "long" ? bar.ask : bar.bid) || bar.price;
    const entryPrice = Number(referencePrice.toFixed(2));

    const atrStop = bar.atr14 > 0 ? bar.atr14 * 0.9 : Math.max(0.24, entryPrice * 0.0045);
    const stopDistance = Number(Math.max(entryPrice * 0.0025, atrStop).toFixed(2));
    const targetDistance = Number((stopDistance * 2.1).toFixed(2));

    const stopPrice = Number((direction === "long" ? entryPrice - stopDistance : entryPrice + stopDistance).toFixed(2));
    const targetPrice = Number((direction === "long" ? entryPrice + targetDistance : entryPrice - targetDistance).toFixed(2));

    return [{
      id: `${bar.symbol}-${bar.updatedAt}`,
      symbol: bar.symbol,
      strategy: pickStrategy(bar, index),
      direction,
      confidence: 0,
      entryPrice,
      stopPrice,
      targetPrice,
      expectedR: Number((targetDistance / stopDistance).toFixed(2)),
      spreadPct: bar.spreadPct ?? 0.03,
      relativeVolume: bar.relativeVolume ?? 1,
      avgVolume: bar.avgVolume ?? 0,
      aboveVwap: bar.aboveVwap ?? true,
      aboveEma20: bar.aboveEma20 ?? null,
      aboveEma50: bar.aboveEma50 ?? null,
      emaSlope: bar.emaSlope ?? 0,
      rsi: bar.rsi14 ?? 50,
      atrPct: bar.atrPct ?? 0,
      quote: { bid: bar.bid || 0, ask: bar.ask || 0 },
      features: {
        distanceFromVwapPct: bar.vwap ? Number((((bar.price - bar.vwap) / bar.vwap) * 100).toFixed(2)) : 0,
        relativeVolume: bar.relativeVolume ?? 1,
        indicatorAvgVolume: bar.indicatorAvgVolume ?? null,
        spyTrend: marketContext.spyTrend,
        atrPct: bar.atrPct ?? 0,
        rsi14: bar.rsi14 ?? null,
        emaSlope: bar.emaSlope ?? 0,
        aboveVwap: bar.aboveVwap ?? true,
        aboveEma20: bar.aboveEma20 ?? null,
        source: bar.source
      }
    }];
  });
}

function pickDirection(bar) {
  if (bar.rsi14 == null || bar.aboveVwap == null) return null;

  if (bar.rsi14 != null && bar.aboveVwap != null) {
    if (bar.aboveVwap && bar.rsi14 < 70 && (bar.emaSlope ?? 0) >= 0) return "long";
    if (!bar.aboveVwap && bar.rsi14 > 30 && (bar.emaSlope ?? 0) <= 0) return "short";
    return bar.changePct >= 0 ? "long" : "short";
  }
  return null;
}

function pickStrategy(bar, index) {
  if (bar.rsi14 != null) {
    if (bar.aboveVwap && (bar.emaSlope ?? 0) > 0) return "vwap_trend_follow";
    if (bar.rsi14 < 35) return "oversold_reversion";
    if (bar.rsi14 > 65) return "momentum_breakout";
    return "range_mean_revert";
  }
  return index % 2 === 0 ? "vwap_pullback" : "opening_range_breakout";
}
