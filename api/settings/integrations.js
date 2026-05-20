import { appendEvent } from "../../apps/api/store.js";
import { persistEvent } from "../../apps/api/db/persistence.js";
import { clearIntegrations, ensureBootstrap, getRuntime, publicIntegrations, readBody, refreshStoredIntegrationKeysStrict, send, updateIntegrations } from "../_runtimeState.js";

export default async function handler(request, response) {
  try {
    await ensureBootstrap();
    const { config, store } = getRuntime();

    if (request.method === "GET") {
      await refreshStoredIntegrationKeysStrict();
      send(response, 200, { integrations: publicIntegrations(config, store) });
      return;
    }

    if (request.method === "POST") {
      const body = await readBody(request);
      const updated = await updateIntegrations(body, store);
      await refreshStoredIntegrationKeysStrict();
      appendEvent(store, "info", "Integration settings updated");
      persistEvent("info", "Integration settings updated", { updated }).catch(() => {});
      send(response, 200, { integrations: publicIntegrations(config, store), updated });
      return;
    }

    if (request.method === "DELETE") {
      const body = await readBody(request);
      const removed = await clearIntegrations(body, store);
      await refreshStoredIntegrationKeysStrict();
      appendEvent(store, "info", `Integration keys cleared: ${removed.join(", ") || "none"}`);
      persistEvent("info", "Integration keys cleared", { removed }).catch(() => {});
      send(response, 200, { integrations: publicIntegrations(config, store), removed });
      return;
    }

    send(response, 405, { error: "Method not allowed" });
  } catch (error) {
    console.error(`Integration settings request failed: ${error.message}`);
    send(response, 500, { error: error.message || "Integration settings request failed" });
  }
}
