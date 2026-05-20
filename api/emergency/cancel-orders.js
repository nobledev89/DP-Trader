import { cancelAllAlpacaOrders } from "../../apps/api/services/alpacaClient.js";
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
    send(response, 200, { status: "cancel_requested", result });
  } catch (error) {
    appendEvent(store, "warning", `Emergency cancel blocked: ${error.message}`);
    send(response, 409, { status: "blocked", error: error.message });
  }
}
