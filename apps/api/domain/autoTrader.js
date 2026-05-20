import { scoreSignal, scoreSignalWithLlm } from "./aiScorer.js";
import { evaluateRisk } from "./riskManager.js";
import { loadMarketSnapshot } from "./marketData.js";
import { buildSignals } from "./strategyEngine.js";
import { marketableLimitPrice, submitAlpacaBracketOrder } from "../services/alpacaClient.js";
import { appendEvent } from "../store.js";

const MIN_AUTO_CONFIDENCE = 0.62;
const DUPLICATE_WINDOW_MS = 10 * 60 * 1000;
const MAX_LLM_CANDIDATES = 3;

export async function runAutoTradeCycle({ config, store, now = new Date() }) {
  if (store.killSwitch) {
    return { status: "paused", reason: "kill_switch_enabled" };
  }
  if (hasActiveOrderOrPosition(store)) {
    appendEvent(store, "info", "AI auto trader skipped because an order or position is already active");
    return { status: "no_trade", reason: "active_order_or_position" };
  }

  const market = await loadMarketSnapshot(config, store, now);
  const marketContext = deriveMarketContext(market);
  const signals = buildSignals(market, marketContext);

  const scoredSignals = signals
    .map((signal) => {
      const heuristic = scoreSignal(signal, marketContext);
      const risk = evaluateRisk({
        signal,
        account: store.account,
        state: summarizeStoreForAuto(store, now),
        config: config.risk,
        now
      });
      return { signal, heuristic, risk };
    })
    .sort((a, b) => b.heuristic.probabilityOfSuccess - a.heuristic.probabilityOfSuccess);

  const rejectedSummary = summarizeRejectedSignals(scoredSignals);
  const preScored = scoredSignals
    .filter(({ heuristic, risk, signal }) => (
      risk.decision === "approved" &&
      heuristic.probabilityOfSuccess >= 0.5 &&
      !hasRecentOrder(store, signal.symbol, now)
    ))
    .sort((a, b) => b.heuristic.probabilityOfSuccess - a.heuristic.probabilityOfSuccess)
    .slice(0, MAX_LLM_CANDIDATES);

  if (!preScored.length) {
    const message = rejectedSummary.length
      ? `AI auto trader found no risk-approved signal: ${rejectedSummary.join("; ")}`
      : "AI auto trader found no risk-approved signal";
    appendEvent(store, "info", message);
    return { status: "no_trade", reason: "no_approved_signal", rejected: rejectedSummary };
  }

  let chosen = null;
  for (const candidate of preScored) {
    const ai = await scoreSignalWithLlm({
      config,
      signal: candidate.signal,
      marketContext,
      risk: candidate.risk
    });
    if (ai.decision === "candidate" && ai.probabilityOfSuccess >= MIN_AUTO_CONFIDENCE) {
      chosen = { ...candidate, ai };
      break;
    }
    appendEvent(store, "info", `AI rejected ${candidate.signal.symbol}: ${ai.rationale || ai.reasonCodes?.join(", ") || "low_confidence"}`);
  }

  if (!chosen) {
    return { status: "no_trade", reason: "ai_rejected_all_candidates" };
  }

  const alpacaOrder = await submitAlpacaBracketOrder(config, chosen.signal, chosen.risk);
  const order = normalizeAutoOrder(alpacaOrder, chosen);
  store.orders.unshift(order);
  appendEvent(
    store,
    "info",
    `AI submitted Alpaca paper order for ${order.symbol} (${order.side} ${order.qty}@${order.limitPrice}); reason: ${chosen.ai.rationale || chosen.ai.reasonCodes?.join(", ")}`
  );
  return {
    status: "submitted",
    order,
    ai: chosen.ai,
    risk: chosen.risk
  };
}

function summarizeRejectedSignals(scoredSignals) {
  return scoredSignals.slice(0, 5).map(({ signal, heuristic, risk }) => {
    const reasons = risk.reasonCodes || risk.reasons || [];
    const reason = reasons.length ? reasons.join(", ") : heuristic.reasonCodes?.join(", ") || "below_threshold";
    return `${signal.symbol} ${Math.round(heuristic.probabilityOfSuccess * 100)}% ${reason}`;
  });
}

function deriveMarketContext(market) {
  const spy = market.find((bar) => bar.symbol === "SPY");
  if (!spy) return { spyTrend: "unknown" };
  const trend = (spy.changePct ?? 0) >= 0.1 ? "up" : (spy.changePct ?? 0) <= -0.1 ? "down" : "flat";
  return {
    spyTrend: trend,
    spyChangePct: spy.changePct ?? 0,
    spyRsi: spy.rsi14,
    spyAboveVwap: spy.aboveVwap
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
    limitPrice: Number(alpacaOrder.limit_price || marketableLimitPrice(candidate.signal, candidate.signal.quote)),
    stopPrice: candidate.signal.stopPrice,
    targetPrice: candidate.signal.targetPrice,
    status: alpacaOrder.status || "submitted",
    createdAt: alpacaOrder.created_at || new Date().toISOString(),
    filledQty: Number(alpacaOrder.filled_qty || 0),
    filledAvgPrice: Number(alpacaOrder.filled_avg_price || 0),
    aiConfidence: candidate.ai.probabilityOfSuccess,
    aiModel: candidate.ai.modelVersion,
    aiRationale: candidate.ai.rationale || null,
    expectedR: candidate.ai.expectedR
  };
}
