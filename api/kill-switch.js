import { appendEvent } from "../apps/api/store.js";
import { getRuntime, readBody, send } from "./_runtimeState.js";

export default async function handler(request, response) {
  if (request.method !== "POST") {
    send(response, 405, { error: "Method not allowed" });
    return;
  }

  const { store } = getRuntime();
  const body = await readBody(request);
  store.killSwitch = Boolean(body.enabled);
  appendEvent(store, store.killSwitch ? "warning" : "info", store.killSwitch ? "Emergency pause enabled" : "Emergency pause cleared");
  send(response, 200, { killSwitch: store.killSwitch });
}
