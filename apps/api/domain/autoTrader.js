import { scoreSignal } from "./aiScorer.js";
import { evaluateRisk } from "./riskManager.js";
import { loadMarketSnapshot } from "./marketData.js";
import { buildSignals } from "./strategyEngine.js";
import { submitAlpacaBracketOrder } from "../services/alpacaClient.js";
import { appendEvent } from "../store.js";

const MIN_AUTO_CONFIDENCE = 0.62;
const DUPLICATE_WINDOW_MS = 10 * 60 * 1000;

export async function runAutoTradeCycle({ config, store, now = new Date() }) {
  if (store.killSwitch) {
    return { status: "paused", reason: "kill_switch_enabled" };
  }
  if (hasActiveOrderOrPosition(store)) {
    appendEvent(store, "info", "AI auto trader skipped because an order or position is already active");
    return { status: "no_trade", reason: "active_order_or_position" };
  }

  const market = await loadMarketSnapshot(config, store, now);
  const candidates = buildSignals(market).map((signal) => {
    const ai = scoreSignal(signal, { spyTrend: "up" });
    const risk = evaluateRisk({
      signal,
      account: store.account,
      state: summarizeStoreForAuto(store, now),
      config: config.risk,
      now
    });
    return { signal, ai, risk };
  }).filter(({ ai, risk }) => (
    ai.decision === "candidate" &&
    ai.probabilityOfSuccess >= MIN_AUTO_CONFIDENCE &&
    risk.decision === "approved"
  )).sort((a, b) => b.ai.probabilityOfSuccess - a.ai.probabilityOfSuccess);

  const candidate = candidates.find(({ signal }) => !hasRecentOrder(store, signal.symbol, now));
  if (!candidate) {
    appendEvent(store, "info", "AI auto trader found no approved paper trade");
    return { status: "no_trade", reason: "no_approved_signal" };
  }

  const alpacaOrder = await submitAlpacaBracketOrder(config, candidate.signal, candidate.risk);
  const order = normalizeAutoOrder(alpacaOrder, candidate);
  store.orders.unshift(order);
  appendEvent(store, "info", `AI auto trader submitted Alpaca paper order for ${order.symbol}`);
  return {
    status: "submitted",
    order,
    ai: candidate.ai,
    risk: candidate.risk
  };
}

function summarizeStoreForAuto(store, now) {
  const hourAgo = now.getTime() - 60 * 60 * 1000;
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  return {
    killSwitch: store.killSwitch,
    openPositions: store.positions.length,
    tradesLastHour: store.orders.filter((order) => Date.parse(order.createdAt) >= hourAgo).length,
    tradesToday: store.orders.filter((order) => Date.parse(order.createdAt) >= startOfDay.getTime()).length,
    executionErrors: store.executionErrors || 0,
    dataStale: false
  };
}

function hasRecentOrder(store, symbol, now) {
  const cutoff = now.getTime() - DUPLICATE_WINDOW_MS;
  return store.orders.some((order) => order.symbol === symbol && Date.parse(order.createdAt) >= cutoff);
}

function hasActiveOrderOrPosition(store) {
  if (store.positions.length > 0) return true;
  const activeStatuses = new Set(["new", "accepted", "pending_new", "partially_filled", "held", "calculated"]);
  return store.orders.some((order) => activeStatuses.has(order.status));
}

function normalizeAutoOrder(alpacaOrder, candidate) {
  return {
    id: alpacaOrder.id,
    clientOrderId: alpacaOrder.client_order_id,
    symbol: candidate.signal.symbol,
    side: candidate.signal.direction === "long" ? "buy" : "sell",
    qty: candidate.risk.shares,
    type: "alpaca_paper_bracket",
    limitPrice: candidate.signal.entryPrice,
    stopPrice: candidate.signal.stopPrice,
    targetPrice: candidate.signal.targetPrice,
    status: alpacaOrder.status || "submitted",
    createdAt: alpacaOrder.created_at || new Date().toISOString(),
    aiConfidence: candidate.ai.probabilityOfSuccess,
    expectedR: candidate.ai.expectedR
  };
}
