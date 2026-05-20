import { appendEvent } from "../../apps/api/store.js";
import { persistEvent } from "../../apps/api/db/persistence.js";
import {
  ensureBootstrap,
  getRuntime,
  readBody,
  refreshStoredRiskSettingsStrict,
  riskSettingsForStore,
  send,
  updateRiskSettings
} from "../_runtimeState.js";

export default async function handler(request, response) {
  try {
    await ensureBootstrap();
    const { config, store } = getRuntime();

    if (request.method === "GET") {
      await refreshStoredRiskSettingsStrict();
      send(response, 200, { risk: riskSettingsForStore(config, store) });
      return;
    }

    if (request.method === "POST") {
      const body = await readBody(request);
      const updated = await updateRiskSettings(body, config, store);
      await refreshStoredRiskSettingsStrict();
      appendEvent(store, "info", "AI risk settings updated");
      persistEvent("info", "AI risk settings updated", { updated }).catch(() => {});
      send(response, 200, { risk: riskSettingsForStore(config, store), updated });
      return;
    }

    send(response, 405, { error: "Method not allowed" });
  } catch (error) {
    console.error(`Risk settings request failed: ${error.message}`);
    send(response, 500, { error: error.message || "Risk settings request failed" });
  }
}
