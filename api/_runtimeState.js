import { readConfig } from "../apps/api/config.js";
import { createStore, appendEvent } from "../apps/api/store.js";
import { fetchAlpacaAccount, fetchAlpacaOrders, fetchAlpacaPositions } from "../apps/api/services/alpacaClient.js";
import { configWithStoredCredentials, storedIntegrationDetail } from "../apps/api/services/requestCredentials.js";
import {
  loadRecentEvents,
  persistAccountSnapshot,
  persistEvent,
  persistOrders,
  persistPositions,
  ensureIntegrationKeyTable,
  loadIntegrationKeys,
  saveIntegrationKey,
  deleteIntegrationKey
} from "../apps/api/db/persistence.js";

const globalState = globalThis.__DP_TRADER_STATE__ || {
  store: createStore(),
  config: readConfig(),
  bootstrap: null
};

globalThis.__DP_TRADER_STATE__ = globalState;

if (!globalState.bootstrap) {
  globalState.bootstrap = bootstrapPersistedIntegrationKeys(globalState.store).catch((error) => {
    console.warn(`Integration key bootstrap skipped: ${error.message}`);
  });
}

export function getRuntime() {
  return globalState;
}

export async function ensureBootstrap() {
  if (globalState.bootstrap) await globalState.bootstrap;
}

export function configForStore(config, store) {
  return configWithStoredCredentials(config, store);
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
    const [account, positions, orders] = await Promise.all([
      fetchAlpacaAccount(config),
      fetchAlpacaPositions(config),
      fetchAlpacaOrders(config)
    ]);
    if (account) store.account = account;
    if (positions) store.positions = positions;
    if (orders) store.orders = orders;
    await Promise.all([
      persistAccountSnapshot(account),
      persistPositions(positions),
      persistOrders(orders)
    ]);
  } catch (error) {
    appendEvent(store, "warning", error.message);
    persistEvent("warning", error.message).catch(() => {});
  }
}

export async function refreshPersistedEvents(store) {
  const persisted = await loadRecentEvents(100);
  if (!persisted.length) return;
  const seen = new Set(store.events.map((event) => `${event.createdAt}|${event.message}`));
  store.events = [
    ...store.events,
    ...persisted.filter((event) => !seen.has(`${event.createdAt}|${event.message}`))
  ].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 100);
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
    openai: Boolean(config.openai?.key || process.env.OPENAI_API_KEY),
    anthropic: Boolean(config.anthropic?.key || process.env.ANTHROPIC_API_KEY),
    polygon: Boolean(process.env.POLYGON_API_KEY),
    finnhub: Boolean(process.env.FINNHUB_API_KEY),
    twelveData: Boolean(process.env.TWELVE_DATA_API_KEY),
    alphaVantage: Boolean(process.env.ALPHA_VANTAGE_API_KEY)
  };
  const detail = storedIntegrationDetail(store);

  return Object.fromEntries(Object.entries(store.integrations).map(([key, integration]) => {
    const dbDetail = detail[key] || { configured: false, missing: [], required: ["apiKey"], suffixes: {} };
    const configured = Boolean(configuredFromEnv[key] || dbDetail.configured);
    return [key, {
      label: integration.label,
      configured,
      source: configuredFromEnv[key] ? "environment" : dbDetail.configured ? "database" : "missing",
      missing: dbDetail.missing,
      required: dbDetail.required,
      suffixes: dbDetail.suffixes,
      updatedAt: integration.updatedAt || null
    }];
  }));
}

export async function updateIntegrations(body, store) {
  const allowed = new Set(Object.keys(store.integrations));
  const updated = [];
  for (const [key, value] of Object.entries(body.integrations || {})) {
    if (!allowed.has(key)) continue;
    const secrets = Object.fromEntries(Object.entries(value).filter(([, secret]) => typeof secret === "string" && secret.trim()));
    if (!Object.keys(secrets).length) continue;
    const nextSecrets = { ...(store.integrationSecrets[key] || {}), ...secrets };
    await saveIntegrationKey(key, nextSecrets);
    store.integrationSecrets[key] = nextSecrets;
    store.integrations[key] = {
      ...store.integrations[key],
      configured: true,
      updatedAt: new Date().toISOString()
    };
    updated.push(key);
  }
  return updated;
}

export async function clearIntegrations(body, store) {
  const targets = Array.isArray(body.integrations) && body.integrations.length
    ? body.integrations.filter((key) => store.integrations[key])
    : Object.keys(store.integrations);
  const removed = [];
  for (const key of targets) {
    await deleteIntegrationKey(key);
    store.integrationSecrets[key] = {};
    store.integrations[key] = {
      ...store.integrations[key],
      configured: false,
      updatedAt: new Date().toISOString()
    };
    removed.push(key);
  }
  return removed;
}

async function bootstrapPersistedIntegrationKeys(store) {
  await ensureIntegrationKeyTable();
  const stored = await loadIntegrationKeys();
  for (const [key, value] of Object.entries(stored)) {
    store.integrationSecrets[key] = value.payload || {};
    store.integrations[key] = {
      ...(store.integrations[key] || { label: key }),
      configured: hasMeaningfulSecret(value.payload),
      updatedAt: value.updatedAt || new Date().toISOString()
    };
  }
}

function hasMeaningfulSecret(payload) {
  if (!payload || typeof payload !== "object") return false;
  return Object.values(payload).some((value) => typeof value === "string" && value.trim().length > 0);
}
