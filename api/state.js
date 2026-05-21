import { assertLiveTradingAllowed } from "../apps/api/config.js";
import { scoreSignal } from "../apps/api/domain/aiScorer.js";
import { evaluateRisk } from "../apps/api/domain/riskManager.js";
import { buildSignals } from "../apps/api/domain/strategyEngine.js";
import { loadMarketSnapshot, storeMarketSnapshot } from "../apps/api/domain/marketData.js";
import { persistStrategySignals } from "../apps/api/db/persistence.js";
import { hasAlpacaCredentials } from "../apps/api/services/alpacaClient.js";
import { configForStore, ensureBootstrap, getRuntime, refreshAlpacaReadOnlyData, refreshPersistedEvents, refreshStoredIntegrationKeys, refreshStoredRiskSettings, send, summarizeState } from "./_runtimeState.js";

export default async function handler(request, response) {
  try {
    if (request.method !== "GET") {
      send(response, 405, { error: "Method not allowed" });
      return;
    }

    await ensureBootstrap();
    await refreshStoredIntegrationKeys();
    await refreshStoredRiskSettings();
    const { config, store } = getRuntime();
    const requestConfig = configForStore(config, store);
    await refreshAlpacaReadOnlyData(requestConfig, store);
    await refreshPersistedEvents(store);
    const market = await loadMarketSnapshot(requestConfig, store);
    storeMarketSnapshot(store, market);
    const signals = buildSignals(market).map((signal) => {
      const ai = scoreSignal(signal, { spyTrend: "up" });
      const risk = evaluateRisk({
        signal,
        account: store.account,
        state: summarizeState(store),
        config: requestConfig.risk
      });
      return { ...signal, confidence: ai.probabilityOfSuccess, ai, risk };
    });
    persistStrategySignals(signals).catch(() => {});

    send(response, 200, {
      account: store.account,
      positions: store.positions,
      orders: store.orders.slice(0, 20),
      market,
      signals: signals.sort((a, b) => b.confidence - a.confidence),
      risk: {
        ...requestConfig.risk,
        killSwitch: store.killSwitch,
        liveTradingArmed: assertLiveTradingAllowed(requestConfig),
        tradingMode: requestConfig.tradingMode,
        alpacaConfigured: hasAlpacaCredentials(requestConfig)
      },
      events: store.events
    });
  } catch (error) {
    console.error(`State request failed: ${error.message}`);
    send(response, 500, { error: error.message || "State request failed" });
  }
}
