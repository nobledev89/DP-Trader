import { fetchAlpacaBars, fetchAlpacaLatestMarket, fetchAlpacaLatestQuotes } from "../services/alpacaClient.js";
import { generateMarketSnapshot } from "./strategyEngine.js";
import { computeIndicators } from "./indicators.js";
import { appendEvent } from "../store.js";

export const DEFAULT_SYMBOLS = ["SPY", "QQQ", "AAPL", "MSFT", "NVDA", "TSLA", "AMD", "META", "AMZN", "GOOGL"];

export async function loadMarketSnapshot(config, store, now = new Date()) {
  const fallback = generateMarketSnapshot(now);
  try {
    const [trades, quotes, bars] = await Promise.all([
      fetchAlpacaLatestMarket(config, DEFAULT_SYMBOLS),
      fetchAlpacaLatestQuotes(config, DEFAULT_SYMBOLS).catch(() => null),
      fetchAlpacaBars(config, DEFAULT_SYMBOLS, { timeframe: "1Min", limit: 60 }).catch(() => null)
    ]);
    if (!trades?.length) return markSource(fallback, "simulated");

    const fallbackBySymbol = new Map(fallback.map((bar) => [bar.symbol, bar]));
    const quoteBySymbol = new Map((quotes || []).map((quote) => [quote.symbol, quote]));

    return DEFAULT_SYMBOLS.map((symbol) => {
      const trade = trades.find((bar) => bar.symbol === symbol);
      if (!trade) return { ...fallbackBySymbol.get(symbol), source: "simulated_fallback" };

      const quote = quoteBySymbol.get(symbol) || null;
      const symbolBars = bars?.[symbol] || [];
      const indicators = computeIndicators(symbolBars);

      const price = quote?.mid && quote.mid > 0 ? quote.mid : trade.price;
      const previous = store.lastMarketSnapshot?.find((bar) => bar.symbol === symbol);
      const previousPrice = previous?.price && previous.price > 0 ? previous.price : price;

      return {
        symbol,
        price: Number(price.toFixed(4)),
        tradePrice: trade.price,
        bid: quote?.bid || 0,
        ask: quote?.ask || 0,
        quoteSpread: quote?.spread || 0,
        spreadPct: indicators?.atrPct ? Math.min(quote?.spreadPct || trade.spreadPct, 0.5) : (quote?.spreadPct ?? trade.spreadPct),
        vwap: indicators?.vwap || trade.vwap || price,
        changePct: indicators?.changePct ?? Number((((price - previousPrice) / previousPrice) * 100).toFixed(3)),
        relativeVolume: indicators?.relativeVolume || trade.relativeVolume || 1,
        avgVolume: indicators?.avgVolume || trade.avgVolume || 0,
        rsi14: indicators?.rsi14 ?? null,
        ema20: indicators?.ema20 ?? null,
        ema50: indicators?.ema50 ?? null,
        emaSlope: indicators?.emaSlope ?? 0,
        atr14: indicators?.atr14 ?? 0,
        atrPct: indicators?.atrPct ?? 0,
        aboveVwap: indicators?.aboveVwap ?? (price >= (trade.vwap || price)),
        aboveEma20: indicators?.aboveEma20 ?? null,
        aboveEma50: indicators?.aboveEma50 ?? null,
        updatedAt: trade.updatedAt,
        source: indicators ? "alpaca_live" : "alpaca_iex"
      };
    });
  } catch (error) {
    appendEvent(store, "warning", error.message);
    return markSource(fallback, "simulated_fallback");
  }
}

export function storeMarketSnapshot(store, market) {
  store.lastMarketSnapshot = market;
}

function markSource(market, source) {
  return market.map((bar) => ({ ...bar, source }));
}
