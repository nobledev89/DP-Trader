import { readConfig } from "../apps/api/config.js";
import { createStore, appendEvent } from "../apps/api/store.js";
import { fetchAlpacaAccount, fetchAlpacaPositions } from "../apps/api/services/alpacaClient.js";

const globalState = globalThis.__DP_TRADER_STATE__ || {
  store: createStore(),
  config: readConfig()
};

globalThis.__DP_TRADER_STATE__ = globalState;

export function getRuntime() {
  return globalState;
}

export async function readBody(request) {
  if (request.body && typeof request.body === "object") return request.body;
  if (typeof request.body === "string") return JSON.parse(request.body || "{}");
  return {};
}

export function send(response, status, payload) {
  response.status(status).json(payload);
}

export async function refreshAlpacaReadOnlyData(config, store) {
  try {
    const [account, positions] = await Promise.all([
      fetchAlpacaAccount(config),
      fetchAlpacaPositions(config)
    ]);
    if (account) store.account = account;
    if (positions) store.positions = positions;
  } catch (error) {
    appendEvent(store, "warning", error.message);
  }
}

export function summarizeState(store) {
  const hourAgo = Date.now() - 60 * 60 * 1000;
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  return {
    killSwitch: store.killSwitch,
    openPositions: store.positions.length,
    tradesLastHour: store.orders.filter((order) => Date.parse(order.createdAt) >= hourAgo).length,
    tradesToday: store.orders.filter((order) => Date.parse(order.createdAt) >= startOfDay.getTime()).length,
    dataStale: false
  };
}

export function publicIntegrations(config, store) {
  const configuredFromEnv = {
    alpaca: Boolean(config.alpaca.key && config.alpaca.secret),
    openai: Boolean(process.env.OPENAI_API_KEY),
    anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
    polygon: Boolean(process.env.POLYGON_API_KEY),
    finnhub: Boolean(process.env.FINNHUB_API_KEY),
    twelveData: Boolean(process.env.TWELVE_DATA_API_KEY),
    alphaVantage: Boolean(process.env.ALPHA_VANTAGE_API_KEY)
  };

  return Object.fromEntries(Object.entries(store.integrations).map(([key, integration]) => [
    key,
    {
      ...integration,
      configured: Boolean(integration.configured || configuredFromEnv[key]),
      source: configuredFromEnv[key] ? "environment" : integration.configured ? "session" : "missing"
    }
  ]));
}

export function updateIntegrations(body, store) {
  const allowed = new Set(Object.keys(store.integrations));
  const updated = [];
  for (const [key, value] of Object.entries(body.integrations || {})) {
    if (!allowed.has(key)) continue;
    const secrets = Object.fromEntries(Object.entries(value).filter(([, secret]) => typeof secret === "string" && secret.trim()));
    if (!Object.keys(secrets).length) continue;
    store.integrationSecrets[key] = secrets;
    store.integrations[key] = {
      ...store.integrations[key],
      configured: true,
      updatedAt: new Date().toISOString()
    };
    updated.push(key);
  }
  return updated;
}
