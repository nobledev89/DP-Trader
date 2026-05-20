import { assertLiveTradingAllowed } from "../apps/api/config.js";
import { scoreSignal } from "../apps/api/domain/aiScorer.js";
import { evaluateRisk } from "../apps/api/domain/riskManager.js";
import { buildSignals, generateMarketSnapshot } from "../apps/api/domain/strategyEngine.js";
import { configForRequest, getRuntime, refreshAlpacaReadOnlyData, send, summarizeState } from "./_runtimeState.js";

export default async function handler(request, response) {
  if (request.method !== "GET") {
    send(response, 405, { error: "Method not allowed" });
    return;
  }

  const { config, store } = getRuntime();
  const requestConfig = configForRequest(config, request);
  await refreshAlpacaReadOnlyData(requestConfig, store);
  const market = generateMarketSnapshot();
  const signals = buildSignals(market).map((signal) => {
    const ai = scoreSignal(signal, { spyTrend: "up" });
    const risk = evaluateRisk({
      signal,
      account: store.account,
      state: summarizeState(store),
      config: config.risk
    });
    return { ...signal, confidence: ai.probabilityOfSuccess, ai, risk };
  });

  send(response, 200, {
    account: store.account,
    positions: store.positions,
    orders: store.orders.slice(0, 20),
    market,
    signals: signals.sort((a, b) => b.confidence - a.confidence),
    risk: {
      ...config.risk,
      killSwitch: store.killSwitch,
      liveTradingArmed: assertLiveTradingAllowed(requestConfig),
      tradingMode: requestConfig.tradingMode
    },
    events: store.events
  });
}
