import http from "node:http";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, extname, join, normalize } from "node:path";
import { readConfig, assertLiveTradingAllowed } from "./config.js";
import { createStore, appendEvent } from "./store.js";
import { cancelAllAlpacaOrders, closeAllAlpacaPositions, fetchAlpacaAccount, fetchAlpacaOrders, fetchAlpacaPositions } from "./services/alpacaClient.js";
import { configWithStoredCredentials, storedIntegrationDetail } from "./services/requestCredentials.js";
import { configWithRiskOverrides, publicRiskSettings, sanitizeRiskOverrides } from "./services/riskSettings.js";
import { buildSignals } from "./domain/strategyEngine.js";
import { loadMarketSnapshot, storeMarketSnapshot } from "./domain/marketData.js";
import { scoreSignal } from "./domain/aiScorer.js";
import { evaluateRisk } from "./domain/riskManager.js";
import { deriveMarketContext, runAutoTradeCycle } from "./domain/autoTrader.js";
import {
  persistAccountSnapshot,
  persistAutoTradeCycle,
  persistEvent,
  loadRecentEvents,
  loadFilledOrders,
  loadEquitySnapshots,
  persistOrder,
  persistOrders,
  persistPositions,
  persistStrategySignals,
  loadRecentLlmUsage,
  ensureAppSettingsTable,
  ensureIntegrationKeyTable,
  loadAppSetting,
  loadAppSettingStrict,
  loadIntegrationKeys,
  saveAppSetting,
  saveIntegrationKey,
  deleteIntegrationKey
} from "./db/persistence.js";
import { buildTradeHistory } from "./domain/tradeHistory.js";

const config = readConfig();
const store = createStore();
const webRoot = join(process.cwd(), "apps", "web");

bootstrapPersistedState(store).catch((error) => {
  console.warn(`State bootstrap skipped: ${error.message}`);
});

async function bootstrapPersistedState(state) {
  await Promise.all([
    bootstrapPersistedIntegrationKeys(state),
    bootstrapPersistedRiskSettings(state)
  ]);
}

async function bootstrapPersistedIntegrationKeys(state) {
  await ensureIntegrationKeyTable();
  const stored = await loadIntegrationKeys();
  for (const [key, value] of Object.entries(stored)) {
    state.integrationSecrets[key] = value.payload || {};
    state.integrations[key] = {
      ...(state.integrations[key] || { label: key }),
      configured: hasMeaningfulSecret(value.payload),
      updatedAt: value.updatedAt || new Date().toISOString()
    };
  }
}

async function refreshStoredIntegrationKeys(state) {
  await bootstrapPersistedIntegrationKeys(state);
}

async function bootstrapPersistedRiskSettings(state) {
  await ensureAppSettingsTable();
  const setting = await loadAppSetting("risk");
  applyStoredRiskSettings(state, setting);
}

async function refreshStoredRiskSettings(state) {
  await bootstrapPersistedRiskSettings(state);
}

async function refreshStoredRiskSettingsStrict(state) {
  await ensureAppSettingsTable();
  const setting = await loadAppSettingStrict("risk");
  applyStoredRiskSettings(state, setting);
}

function applyStoredRiskSettings(state, setting) {
  state.riskOverrides = setting?.payload || {};
  state.riskSettingsUpdatedAt = setting?.updatedAt || null;
}

function configForState(cfg, state) {
  return configWithStoredCredentials(configWithRiskOverrides(cfg, state), state);
}

function hasMeaningfulSecret(payload) {
  if (!payload || typeof payload !== "object") return false;
  return Object.values(payload).some((value) => typeof value === "string" && value.trim().length > 0);
}

export function createApp({ cfg = config, state = store } = {}) {
  return async function handler(req, res) {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (url.pathname.startsWith("/api/")) {
        await handleApi(req, res, url, cfg, state);
        return;
      }
      await serveStatic(req, res, url);
    } catch (error) {
      sendJson(res, 500, { error: error.message || "Internal server error" });
    }
  };
}

async function handleApi(req, res, url, cfg, state) {
  if (req.method === "GET" && url.pathname === "/api/state") {
    await refreshStoredIntegrationKeys(state);
    await refreshStoredRiskSettings(state);
    const requestConfig = configForState(cfg, state);
    await refreshAlpacaReadOnlyData(requestConfig, state);
    await refreshPersistedEvents(state);
    const market = await loadMarketSnapshot(requestConfig, state);
    storeMarketSnapshot(state, market);
    const marketContext = deriveMarketContext(market);
    const scoredSignals = buildSignals(market, marketContext).map((signal) => {
      const ai = scoreSignal(signal, marketContext);
      const risk = evaluateRisk({
        signal,
        account: state.account,
        state: summarizeState(state),
        config: requestConfig.risk
      });
      return { ...signal, confidence: ai.probabilityOfSuccess, ai, risk };
    });
    persistStrategySignals(scoredSignals).catch(() => {});
    const llmUsage = await loadRecentLlmUsage(100);
    sendJson(res, 200, {
      account: state.account,
      positions: state.positions,
      orders: state.orders.slice(0, 20),
      market,
      signals: scoredSignals.sort((a, b) => b.confidence - a.confidence),
      risk: {
        ...requestConfig.risk,
        killSwitch: state.killSwitch,
        liveTradingArmed: assertLiveTradingAllowed(requestConfig),
        tradingMode: requestConfig.tradingMode,
        alpacaConfigured: Boolean(requestConfig.alpaca?.key && requestConfig.alpaca?.secret)
      },
      llmUsage,
      events: state.events
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/history") {
    const rangeDays = Math.max(7, Math.min(180, Number(url.searchParams.get("rangeDays")) || 30));
    const limit = Math.max(50, Math.min(2000, Number(url.searchParams.get("limit")) || 500));
    const persistedOrders = await loadFilledOrders(limit);
    const localOrders = Array.isArray(state.orders) ? state.orders : [];
    const orders = mergeOrdersById(persistedOrders, localOrders);
    const equitySnapshots = await loadEquitySnapshots(720);
    const history = buildTradeHistory({ orders, equitySnapshots, rangeDays });
    sendJson(res, 200, {
      ...history,
      account: {
        equity: state.account?.equity ?? null,
        dayPnl: state.account?.dayPnl ?? null,
        source: state.account?.source || null
      },
      rangeDays,
      generatedAt: new Date().toISOString()
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/kill-switch") {
    const body = await readBody(req);
    state.killSwitch = Boolean(body.enabled);
    appendEvent(state, state.killSwitch ? "warning" : "info", state.killSwitch ? "Emergency pause enabled" : "Emergency pause cleared");
    persistEvent(state.killSwitch ? "warning" : "info", state.killSwitch ? "Emergency pause enabled" : "Emergency pause cleared").catch(() => {});
    sendJson(res, 200, { killSwitch: state.killSwitch });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/settings/integrations") {
    await refreshStoredIntegrationKeys(state);
    sendJson(res, 200, { integrations: publicIntegrations(cfg, state) });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/settings/risk") {
    await refreshStoredRiskSettingsStrict(state);
    sendJson(res, 200, { risk: publicRiskSettings(cfg, state) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/settings/risk") {
    const body = await readBody(req);
    const updated = await updateRiskSettings(body, cfg, state);
    await refreshStoredRiskSettingsStrict(state);
    appendEvent(state, "info", "AI risk settings updated");
    persistEvent("info", "AI risk settings updated", { updated }).catch(() => {});
    sendJson(res, 200, { risk: publicRiskSettings(cfg, state), updated });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/settings/integrations") {
    const body = await readBody(req);
    const result = await updateIntegrations(body, state);
    await refreshStoredIntegrationKeys(state);
    appendEvent(state, "info", "Integration settings updated");
    persistEvent("info", "Integration settings updated", { updated: result }).catch(() => {});
    sendJson(res, 200, { integrations: publicIntegrations(cfg, state), updated: result });
    return;
  }

  if (req.method === "DELETE" && url.pathname === "/api/settings/integrations") {
    const body = await readBody(req);
    const removed = await clearIntegrations(body, state);
    await refreshStoredIntegrationKeys(state);
    appendEvent(state, "info", `Integration keys cleared: ${removed.join(", ") || "none"}`);
    persistEvent("info", `Integration keys cleared`, { removed }).catch(() => {});
    sendJson(res, 200, { integrations: publicIntegrations(cfg, state), removed });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/orders/simulate") {
    await refreshStoredIntegrationKeys(state);
    await refreshStoredRiskSettings(state);
    const requestConfig = configForState(cfg, state);
    const body = await readBody(req);
    if (state.killSwitch) {
      sendJson(res, 409, { error: "Kill switch is enabled" });
      return;
    }
    const market = await loadMarketSnapshot(requestConfig, state);
    const signal = buildSignals(market).find((candidate) => candidate.symbol === body.symbol);
    if (!signal) {
      sendJson(res, 404, { error: "Signal not found" });
      return;
    }
    const risk = evaluateRisk({ signal, account: state.account, state: summarizeState(state), config: requestConfig.risk });
    if (risk.decision !== "approved") {
      sendJson(res, 409, { error: "Risk rejected order", risk });
      return;
    }
    const order = {
      id: randomUUID(),
      symbol: signal.symbol,
      side: signal.direction === "long" ? "buy" : "sell",
      qty: risk.shares,
      type: "limit_bracket_sim",
      limitPrice: signal.entryPrice,
      stopPrice: signal.stopPrice,
      targetPrice: signal.targetPrice,
      status: "accepted_paper_sim",
      createdAt: new Date().toISOString()
    };
    state.orders.unshift(order);
    appendEvent(state, "info", `Simulated paper order accepted for ${order.symbol}`);
    persistOrder(order).catch(() => {});
    persistEvent("info", `Simulated paper order accepted for ${order.symbol}`, { orderId: order.id }).catch(() => {});
    sendJson(res, 201, { order, risk });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/auto-trade") {
    await refreshStoredIntegrationKeys(state);
    await refreshStoredRiskSettings(state);
    const requestConfig = configForState(cfg, state);
    try {
      await refreshAlpacaReadOnlyData(requestConfig, state);
      const result = await runAutoTradeCycle({ config: requestConfig, store: state });
      persistAutoTradeCycle(result).catch(() => {});
      sendJson(res, 200, result);
    } catch (error) {
      appendEvent(state, "warning", `AI auto trader blocked: ${error.message}`);
      persistEvent("warning", `AI auto trader blocked: ${error.message}`).catch(() => {});
      sendJson(res, 409, { status: "blocked", error: error.message });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/emergency/cancel-orders") {
    await refreshStoredIntegrationKeys(state);
    const requestConfig = configForState(cfg, state);
    const result = await cancelAllAlpacaOrders(requestConfig);
    state.killSwitch = true;
    appendEvent(state, "warning", "Emergency cancel all Alpaca paper orders requested");
    persistEvent("warning", "Emergency cancel all Alpaca paper orders requested").catch(() => {});
    sendJson(res, 200, { status: "cancel_requested", result });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/emergency/close-positions") {
    await refreshStoredIntegrationKeys(state);
    const requestConfig = configForState(cfg, state);
    const result = await closeAllAlpacaPositions(requestConfig);
    state.killSwitch = true;
    appendEvent(state, "warning", "Emergency close all Alpaca paper positions requested");
    persistEvent("warning", "Emergency close all Alpaca paper positions requested").catch(() => {});
    sendJson(res, 200, { status: "close_requested", result });
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

async function refreshPersistedEvents(state) {
  const persisted = await loadRecentEvents(100);
  if (!persisted.length) return;
  const seen = new Set(state.events.map((event) => `${event.createdAt}|${event.message}`));
  state.events = [
    ...state.events,
    ...persisted.filter((event) => !seen.has(`${event.createdAt}|${event.message}`))
  ].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 100);
}

async function refreshAlpacaReadOnlyData(cfg, state) {
  try {
    const [account, positions, orders] = await Promise.all([
      fetchAlpacaAccount(cfg),
      fetchAlpacaPositions(cfg),
      fetchAlpacaOrders(cfg)
    ]);
    if (account) state.account = account;
    if (positions) state.positions = positions;
    if (orders) state.orders = orders;
    await Promise.all([
      persistAccountSnapshot(account),
      persistPositions(positions),
      persistOrders(orders)
    ]);
  } catch (error) {
    appendEvent(state, "warning", error.message);
    persistEvent("warning", error.message).catch(() => {});
  }
}

function mergeOrdersById(primary, secondary) {
  const byKey = new Map();
  for (const order of [...primary, ...secondary]) {
    if (!order) continue;
    const key = order.id || order.clientOrderId || `${order.symbol}-${order.createdAt}-${order.side}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, order);
      continue;
    }
    byKey.set(key, { ...existing, ...order });
  }
  return [...byKey.values()];
}

function summarizeState(state) {
  const hourAgo = Date.now() - 60 * 60 * 1000;
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  return {
    killSwitch: state.killSwitch,
    positions: state.positions,
    openPositions: state.positions.length,
    tradesLastHour: state.orders.filter((order) => Date.parse(order.createdAt) >= hourAgo).length,
    tradesToday: state.orders.filter((order) => Date.parse(order.createdAt) >= startOfDay.getTime()).length,
    dataStale: false
  };
}

function publicIntegrations(cfg, state) {
  const configuredFromEnv = {
    alpaca: Boolean(cfg.alpaca.key && cfg.alpaca.secret),
    openai: Boolean(cfg.openai?.key || process.env.OPENAI_API_KEY),
    anthropic: Boolean(cfg.anthropic?.key || process.env.ANTHROPIC_API_KEY),
    polygon: Boolean(process.env.POLYGON_API_KEY),
    finnhub: Boolean(process.env.FINNHUB_API_KEY),
    twelveData: Boolean(process.env.TWELVE_DATA_API_KEY),
    alphaVantage: Boolean(process.env.ALPHA_VANTAGE_API_KEY)
  };
  const detail = storedIntegrationDetail(state);

  return Object.fromEntries(Object.entries(state.integrations).map(([key, integration]) => {
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

async function updateIntegrations(body, state) {
  const allowed = new Set(Object.keys(state.integrations));
  const updated = [];
  for (const [key, value] of Object.entries(body.integrations || {})) {
    if (!allowed.has(key)) continue;
    const secrets = Object.fromEntries(Object.entries(value).filter(([, secret]) => typeof secret === "string" && secret.trim()));
    if (!Object.keys(secrets).length) continue;
    const nextSecrets = { ...(state.integrationSecrets[key] || {}), ...secrets };
    await saveIntegrationKey(key, nextSecrets);
    state.integrationSecrets[key] = nextSecrets;
    state.integrations[key] = {
      ...state.integrations[key],
      configured: true,
      updatedAt: new Date().toISOString()
    };
    updated.push(key);
  }
  return updated;
}

async function clearIntegrations(body, state) {
  const targets = Array.isArray(body.integrations) && body.integrations.length
    ? body.integrations.filter((key) => state.integrations[key])
    : Object.keys(state.integrations);
  const removed = [];
  for (const key of targets) {
    await deleteIntegrationKey(key);
    state.integrationSecrets[key] = {};
    state.integrations[key] = {
      ...state.integrations[key],
      configured: false,
      updatedAt: new Date().toISOString()
    };
    removed.push(key);
  }
  return removed;
}

async function updateRiskSettings(body, cfg, state) {
  const overrides = sanitizeRiskOverrides(body.risk || {}, cfg.risk);
  await saveAppSetting("risk", overrides);
  state.riskOverrides = overrides;
  state.riskSettingsUpdatedAt = new Date().toISOString();
  return overrides;
}

async function serveStatic(req, res, url) {
  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = normalize(join(webRoot, requested));
  if (!filePath.startsWith(webRoot)) {
    sendText(res, 403, "Forbidden");
    return;
  }
  try {
    const file = await readFile(filePath);
    res.writeHead(200, { "Content-Type": contentType(filePath) });
    res.end(file);
  } catch {
    sendText(res, 404, "Not found");
  }
}

function contentType(path) {
  return {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml"
  }[extname(path)] || "application/octet-stream";
}

async function readBody(req) {
  const chunks = [];
  let totalBytes = 0;
  for await (const chunk of req) chunks.push(chunk);
  for (const chunk of chunks) {
    totalBytes += chunk.length;
    if (totalBytes > 64 * 1024) throw new Error("Request body too large");
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function sendJson(res, status, payload) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendText(res, status, payload) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(payload);
}

if (basename(process.argv[1] || "") === "server.js") {
  const server = http.createServer(createApp());
  server.listen(config.port, () => {
    console.log(`DP-Trader running at http://localhost:${config.port}`);
  });
}
