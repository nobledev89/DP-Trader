import { buildTradeHistory } from "../apps/api/domain/tradeHistory.js";
import { loadEquitySnapshots, loadFilledOrders } from "../apps/api/db/persistence.js";
import { ensureBootstrap, getRuntime, send } from "./_runtimeState.js";

export default async function handler(request, response) {
  try {
    if (request.method !== "GET") {
      send(response, 405, { error: "Method not allowed" });
      return;
    }

    await ensureBootstrap();
    const { store } = getRuntime();
    const url = new URL(request.url, `https://${request.headers.host || "localhost"}`);
    const rangeDays = Math.max(7, Math.min(180, Number(url.searchParams.get("rangeDays")) || 30));
    const limit = Math.max(50, Math.min(2000, Number(url.searchParams.get("limit")) || 500));
    const persistedOrders = await loadFilledOrders(limit);
    const localOrders = Array.isArray(store.orders) ? store.orders : [];
    const orders = mergeOrdersById(persistedOrders, localOrders);
    const equitySnapshots = await loadEquitySnapshots(720);
    const history = buildTradeHistory({ orders, equitySnapshots, rangeDays });

    send(response, 200, {
      ...history,
      account: {
        equity: store.account?.equity ?? null,
        dayPnl: store.account?.dayPnl ?? null,
        source: store.account?.source || null
      },
      rangeDays,
      generatedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error(`History request failed: ${error.message}`);
    send(response, 500, { error: error.message || "History request failed" });
  }
}

function mergeOrdersById(primary, secondary) {
  const byKey = new Map();
  for (const order of [...primary, ...secondary]) {
    if (!order) continue;
    const key = order.id || order.clientOrderId || `${order.symbol}-${order.createdAt}-${order.side}`;
    const existing = byKey.get(key);
    byKey.set(key, existing ? { ...existing, ...order } : order);
  }
  return [...byKey.values()];
}
