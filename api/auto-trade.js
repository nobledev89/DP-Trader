import { runAutoTradeCycle } from "../apps/api/domain/autoTrader.js";
import { persistAutoTradeCycle, persistEvent } from "../apps/api/db/persistence.js";
import { appendEvent } from "../apps/api/store.js";
import { configForStore, ensureBootstrap, getRuntime, refreshAlpacaReadOnlyData, refreshStoredIntegrationKeys, send } from "./_runtimeState.js";

export default async function handler(request, response) {
  if (request.method !== "POST") {
    send(response, 405, { error: "Method not allowed" });
    return;
  }

  await ensureBootstrap();
  await refreshStoredIntegrationKeys();
  const { config, store } = getRuntime();
  const requestConfig = configForStore(config, store);
  try {
    await refreshAlpacaReadOnlyData(requestConfig, store);
    const result = await runAutoTradeCycle({ config: requestConfig, store });
    persistAutoTradeCycle(result).catch(() => {});
    send(response, 200, result);
  } catch (error) {
    appendEvent(store, "warning", `AI auto trader blocked: ${error.message}`);
    persistEvent("warning", `AI auto trader blocked: ${error.message}`).catch(() => {});
    send(response, 409, { status: "blocked", error: error.message });
  }
}
