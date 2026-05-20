import { randomUUID } from "node:crypto";
import { persistEvent, persistOrder } from "../../apps/api/db/persistence.js";
import { evaluateRisk } from "../../apps/api/domain/riskManager.js";
import { buildSignals, generateMarketSnapshot } from "../../apps/api/domain/strategyEngine.js";
import { appendEvent } from "../../apps/api/store.js";
import { configForStore, getRuntime, readBody, refreshStoredRiskSettings, send, summarizeState } from "../_runtimeState.js";

export default async function handler(request, response) {
  if (request.method !== "POST") {
    send(response, 405, { error: "Method not allowed" });
    return;
  }

  await refreshStoredRiskSettings();
  const { config, store } = getRuntime();
  const requestConfig = configForStore(config, store);
  const body = await readBody(request);
  if (store.killSwitch) {
    send(response, 409, { error: "Kill switch is enabled" });
    return;
  }

  const signal = buildSignals(generateMarketSnapshot()).find((candidate) => candidate.symbol === body.symbol);
  if (!signal) {
    send(response, 404, { error: "Signal not found" });
    return;
  }

  const risk = evaluateRisk({ signal, account: store.account, state: summarizeState(store), config: requestConfig.risk });
  if (risk.decision !== "approved") {
    send(response, 409, { error: "Risk rejected order", risk });
    return;
  }

  const order = {
    id: randomUUID(),
    symbol: signal.symbol,
    side: signal.direction === "long" ? "buy" : "sell",
    qty: risk.shares,
    type: "limit_bracket_sim",
    limitPrice: signal.entryPrice,
    stopPrice: signal.stopPrice,
    targetPrice: signal.targetPrice,
    status: "accepted_paper_sim",
    createdAt: new Date().toISOString()
  };
  store.orders.unshift(order);
  appendEvent(store, "info", `Simulated paper order accepted for ${order.symbol}`);
  persistOrder(order).catch(() => {});
  persistEvent("info", `Simulated paper order accepted for ${order.symbol}`, { orderId: order.id }).catch(() => {});
  send(response, 201, { order, risk });
}
