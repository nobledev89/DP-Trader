import { fetchAlpacaLatestMarket } from "../services/alpacaClient.js";
import { generateMarketSnapshot } from "./strategyEngine.js";
import { appendEvent } from "../store.js";

export const DEFAULT_SYMBOLS = ["SPY", "QQQ", "AAPL", "MSFT", "NVDA", "TSLA", "AMD", "META", "AMZN", "GOOGL"];

export async function loadMarketSnapshot(config, store, now = new Date()) {
  const fallback = generateMarketSnapshot(now);
  try {
    const alpaca = await fetchAlpacaLatestMarket(config, DEFAULT_SYMBOLS);
    if (!alpaca?.length) return markSource(fallback, "simulated");
    const fallbackBySymbol = new Map(fallback.map((bar) => [bar.symbol, bar]));
    return DEFAULT_SYMBOLS.map((symbol) => {
      const live = alpaca.find((bar) => bar.symbol === symbol);
      const previous = store.lastMarketSnapshot?.find((bar) => bar.symbol === symbol) || fallbackBySymbol.get(symbol);
      if (!live) return { ...fallbackBySymbol.get(symbol), source: "simulated_fallback" };
      const previousPrice = previous?.price || live.price;
      return {
        ...live,
        changePct: Number(((live.price - previousPrice) / previousPrice * 100).toFixed(2)),
        vwap: previous?.vwap || live.price
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
