import { appendEvent } from "../../apps/api/store.js";
import { getRuntime, publicIntegrations, readBody, send, updateIntegrations } from "../_runtimeState.js";

export default async function handler(request, response) {
  const { config, store } = getRuntime();

  if (request.method === "GET") {
    send(response, 200, { integrations: publicIntegrations(config, store, request) });
    return;
  }

  if (request.method === "POST") {
    const body = await readBody(request);
    const updated = updateIntegrations(body, store);
    appendEvent(store, "info", "Integration settings updated");
    send(response, 200, { integrations: publicIntegrations(config, store, request), updated });
    return;
  }

  send(response, 405, { error: "Method not allowed" });
}
