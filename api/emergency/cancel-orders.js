import { cancelAllAlpacaOrders } from "../../apps/api/services/alpacaClient.js";
import { persistEvent } from "../../apps/api/db/persistence.js";
import { appendEvent } from "../../apps/api/store.js";
import { configForRequest, getRuntime, send } from "../_runtimeState.js";

export default async function handler(request, response) {
  if (request.method !== "POST") {
    send(response, 405, { error: "Method not allowed" });
    return;
  }

  const { config, store } = getRuntime();
  const requestConfig = configForRequest(config, request);
  try {
    const result = await cancelAllAlpacaOrders(requestConfig);
    store.killSwitch = true;
    appendEvent(store, "warning", "Emergency cancel all Alpaca paper orders requested");
    persistEvent("warning", "Emergency cancel all Alpaca paper orders requested").catch(() => {});
    send(response, 200, { status: "cancel_requested", result });
  } catch (error) {
    appendEvent(store, "warning", `Emergency cancel blocked: ${error.message}`);
    persistEvent("warning", `Emergency cancel blocked: ${error.message}`).catch(() => {});
    send(response, 409, { status: "blocked", error: error.message });
  }
}
