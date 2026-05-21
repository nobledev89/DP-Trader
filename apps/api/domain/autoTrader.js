import { scoreSignal, scoreSignalWithLlm } from "./aiScorer.js";
import { evaluateRisk } from "./riskManager.js";
import { loadMarketSnapshot } from "./marketData.js";
import { buildSignals } from "./strategyEngine.js";
import { cancelAlpacaOrdersForSymbol, closeAlpacaPosition, marketableLimitPrice, submitAlpacaAutoOrder } from "../services/alpacaClient.js";
import { appendEvent } from "../store.js";

const DEFAULT_MIN_AUTO_CONFIDENCE = 0.62;
const DUPLICATE_WINDOW_MS = 10 * 60 * 1000;
const MAX_LLM_CANDIDATES = 3;

export async function runAutoTradeCycle({ config, store, now = new Date() }) {
  const minAutoConfidence = Number(config.risk?.minAutoConfidence ?? DEFAULT_MIN_AUTO_CONFIDENCE);
  if (store.killSwitch) {
    return { status: "paused", reason: "kill_switch_enabled" };
  }
  const exit = await manageScalpingExits({ config, store, now });
  if (exit) return exit;
  if (hasActiveEntryOrder(store)) {
    appendEvent(store, "info", "AI auto trader skipped because an order is already active");
    return { status: "no_trade", reason: "active_order" };
  }

  const market = await loadMarketSnapshot(config, store, now);
  const marketContext = deriveMarketContext(market);
  const signals = buildSignals(market, marketContext);

  const scoredSignals = signals
    .map((signal) => {
      const heuristic = scoreSignal(signal, marketContext);
      const risk = evaluateRisk({
        signal: { ...signal, confidence: heuristic.probabilityOfSuccess },
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
      heuristic.probabilityOfSuccess >= minAutoConfidence &&
      !hasOpenPosition(store, signal.symbol) &&
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
  const aiRejected = [];
  for (const candidate of preScored) {
    const ai = await scoreSignalWithLlm({
      config,
      signal: candidate.signal,
      marketContext,
      risk: candidate.risk
    });
    if (ai.decision === "candidate" && ai.probabilityOfSuccess >= minAutoConfidence) {
      chosen = { ...candidate, ai };
      break;
    }
    aiRejected.push(summarizeAiRejection(candidate.signal, ai, minAutoConfidence));
    appendEvent(store, "info", `AI rejected ${candidate.signal.symbol}: ${ai.rationale || ai.reasonCodes?.join(", ") || "low_confidence"} (${Math.round(ai.probabilityOfSuccess * 100)}% < ${Math.round(minAutoConfidence * 100)}%)`);
  }

  if (!chosen) {
    return { status: "no_trade", reason: "ai_rejected_all_candidates", minAutoConfidence, rejected: aiRejected, riskRejected: rejectedSummary };
  }

  const alpacaOrder = await submitAlpacaAutoOrder(config, chosen.signal, chosen.risk, now);
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

async function manageScalpingExits({ config, store, now }) {
  if (!config.risk?.scalpingEnabled || !store.positions.length) return null;
  const minHoldMs = Math.max(0, Number(config.risk.minHoldMinutes || 0)) * 60 * 1000;
  const maxHoldMs = Math.max(1, Number(config.risk.maxHoldMinutes || 120)) * 60 * 1000;
  const quickProfit = Number(config.risk.quickProfitPct || 0.35) / 100;
  const quickStop = Number(config.risk.quickStopPct || 0.25) / 100;

  for (const position of store.positions) {
    const openedAt = inferPositionOpenedAt(position, store.orders);
    const ageMs = openedAt ? now.getTime() - Date.parse(openedAt) : 0;
    const pnlPct = Number(position.unrealizedPnlPct || 0);
    const exitReason = scalpingExitReason({ ageMs, minHoldMs, maxHoldMs, pnlPct, quickProfit, quickStop });
    if (!exitReason) continue;

    await cancelAlpacaOrdersForSymbol(config, position.symbol, store.orders);
    const closeResult = await closeAlpacaPosition(config, position, now);
    appendEvent(store, "info", `Scalping exit requested for ${position.symbol}: ${exitReason} (${formatPnlPct(pnlPct)}, ${Math.max(0, Math.round(ageMs / 60000))}m held)`);
    return {
      status: "exit_submitted",
      reason: exitReason,
      symbol: position.symbol,
      position,
      closeResult,
      ageMinutes: Math.max(0, Math.round(ageMs / 60000)),
      pnlPct
    };
  }
  return null;
}

function scalpingExitReason({ ageMs, minHoldMs, maxHoldMs, pnlPct, quickProfit, quickStop }) {
  if (pnlPct <= -quickStop) return "quick_stop_hit";
  if (ageMs >= maxHoldMs) return "max_hold_reached";
  if (ageMs >= minHoldMs && pnlPct >= quickProfit) return "quick_profit_hit";
  return null;
}

function inferPositionOpenedAt(position, orders = []) {
  const entrySide = position.side === "short" || Number(position.qty) < 0 ? "sell" : "buy";
  const entries = orders
    .filter((order) => (
      order.symbol === position.symbol &&
      order.side === entrySide &&
      Number(order.filledQty || 0) > 0 &&
      ["filled", "partially_filled"].includes(order.status)
    ))
    .sort((a, b) => Date.parse(b.filledAt || b.createdAt) - Date.parse(a.filledAt || a.createdAt));
  return entries[0]?.filledAt || entries[0]?.createdAt || null;
}

function formatPnlPct(value) {
  return `${(Number(value || 0) * 100).toFixed(2)}%`;
}

function summarizeRejectedSignals(scoredSignals) {
  return scoredSignals.slice(0, 5).map(({ signal, heuristic, risk }) => {
    const reasons = risk.reasonCodes || risk.reasons || [];
    const reason = reasons.length ? reasons.join(", ") : heuristic.reasonCodes?.join(", ") || "below_threshold";
    return `${signal.symbol} ${Math.round(heuristic.probabilityOfSuccess * 100)}% ${reason}`;
  });
}

function summarizeAiRejection(signal, ai, minAutoConfidence) {
  const reason = ai.rationale || ai.reasonCodes?.join(", ") || "low_confidence";
  const score = Math.round((ai.probabilityOfSuccess || 0) * 100);
  const threshold = Math.round(minAutoConfidence * 100);
  return `${signal.symbol} LLM ${score}% ${reason} (< ${threshold}%)`;
}

export function deriveMarketContext(market) {
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

function hasOpenPosition(store, symbol) {
  return store.positions.some((position) => position.symbol === symbol && Math.abs(Number(position.qty || 0)) > 0);
}

function hasActiveEntryOrder(store) {
  const activeStatuses = new Set(["new", "accepted", "pending_new", "partially_filled", "held", "calculated"]);
  const positionedSymbols = new Set(store.positions.map((position) => position.symbol));
  return store.orders.some((order) => activeStatuses.has(order.status) && !positionedSymbols.has(order.symbol));
}

function normalizeAutoOrder(alpacaOrder, candidate) {
  return {
    id: alpacaOrder.id,
    clientOrderId: alpacaOrder.client_order_id,
    symbol: candidate.signal.symbol,
    side: candidate.signal.direction === "long" ? "buy" : "sell",
    qty: candidate.risk.shares,
    type: alpacaOrder.order_class === "" || alpacaOrder.extended_hours === true ? "alpaca_paper_extended_limit" : "alpaca_paper_bracket",
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
