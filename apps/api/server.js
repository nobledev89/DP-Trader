import http from "node:http";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, extname, join, normalize } from "node:path";
import { readConfig, assertLiveTradingAllowed } from "./config.js";
import { createStore, appendEvent } from "./store.js";
import { fetchAlpacaAccount, fetchAlpacaPositions } from "./services/alpacaClient.js";
import { configWithRequestCredentials, requestIntegrationStatus } from "./services/requestCredentials.js";
import { generateMarketSnapshot, buildSignals } from "./domain/strategyEngine.js";
import { scoreSignal } from "./domain/aiScorer.js";
import { evaluateRisk } from "./domain/riskManager.js";

const config = readConfig();
const store = createStore();
const webRoot = join(process.cwd(), "apps", "web");

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
    const requestConfig = configWithRequestCredentials(cfg, req.headers);
    await refreshAlpacaReadOnlyData(requestConfig, state);
    const market = generateMarketSnapshot();
    const scoredSignals = buildSignals(market).map((signal) => {
      const ai = scoreSignal(signal, { spyTrend: "up" });
      const risk = evaluateRisk({
        signal,
        account: state.account,
        state: summarizeState(state),
        config: cfg.risk
      });
      return { ...signal, confidence: ai.probabilityOfSuccess, ai, risk };
    });
    sendJson(res, 200, {
      account: state.account,
      positions: state.positions,
      orders: state.orders.slice(0, 20),
      market,
      signals: scoredSignals.sort((a, b) => b.confidence - a.confidence),
      risk: {
        ...cfg.risk,
        killSwitch: state.killSwitch,
        liveTradingArmed: assertLiveTradingAllowed(requestConfig),
        tradingMode: requestConfig.tradingMode
      },
      events: state.events
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/kill-switch") {
    const body = await readBody(req);
    state.killSwitch = Boolean(body.enabled);
    appendEvent(state, state.killSwitch ? "warning" : "info", state.killSwitch ? "Emergency pause enabled" : "Emergency pause cleared");
    sendJson(res, 200, { killSwitch: state.killSwitch });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/settings/integrations") {
    sendJson(res, 200, { integrations: publicIntegrations(cfg, state, requestIntegrationStatus(cfg, req.headers)) });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/settings/integrations") {
    const body = await readBody(req);
    const result = updateIntegrations(body, state);
    appendEvent(state, "info", "Integration settings updated");
    sendJson(res, 200, { integrations: publicIntegrations(cfg, state), updated: result });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/orders/simulate") {
    const body = await readBody(req);
    if (state.killSwitch) {
      sendJson(res, 409, { error: "Kill switch is enabled" });
      return;
    }
    const market = generateMarketSnapshot();
    const signal = buildSignals(market).find((candidate) => candidate.symbol === body.symbol);
    if (!signal) {
      sendJson(res, 404, { error: "Signal not found" });
      return;
    }
    const risk = evaluateRisk({ signal, account: state.account, state: summarizeState(state), config: cfg.risk });
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
    sendJson(res, 201, { order, risk });
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

async function refreshAlpacaReadOnlyData(cfg, state) {
  try {
    const [account, positions] = await Promise.all([
      fetchAlpacaAccount(cfg),
      fetchAlpacaPositions(cfg)
    ]);
    if (account) state.account = account;
    if (positions) state.positions = positions;
  } catch (error) {
    appendEvent(state, "warning", error.message);
  }
}

function summarizeState(state) {
  const hourAgo = Date.now() - 60 * 60 * 1000;
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  return {
    killSwitch: state.killSwitch,
    openPositions: state.positions.length,
    tradesLastHour: state.orders.filter((order) => Date.parse(order.createdAt) >= hourAgo).length,
    tradesToday: state.orders.filter((order) => Date.parse(order.createdAt) >= startOfDay.getTime()).length,
    dataStale: false
  };
}

function publicIntegrations(cfg, state, requestConfigured = {}) {
  const configuredFromEnv = {
    alpaca: Boolean(cfg.alpaca.key && cfg.alpaca.secret),
    openai: Boolean(process.env.OPENAI_API_KEY),
    anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
    polygon: Boolean(process.env.POLYGON_API_KEY),
    finnhub: Boolean(process.env.FINNHUB_API_KEY),
    twelveData: Boolean(process.env.TWELVE_DATA_API_KEY),
    alphaVantage: Boolean(process.env.ALPHA_VANTAGE_API_KEY)
  };

  return Object.fromEntries(Object.entries(state.integrations).map(([key, integration]) => [
    key,
    {
      ...integration,
      configured: Boolean(integration.configured || configuredFromEnv[key] || requestConfigured[key]),
      source: configuredFromEnv[key] ? "environment" : requestConfigured[key] ? "browser" : integration.configured ? "session" : "missing"
    }
  ]));
}

function updateIntegrations(body, state) {
  const allowed = new Set(Object.keys(state.integrations));
  const updated = [];
  for (const [key, value] of Object.entries(body.integrations || {})) {
    if (!allowed.has(key)) continue;
    const secrets = Object.fromEntries(Object.entries(value).filter(([, secret]) => typeof secret === "string" && secret.trim()));
    if (!Object.keys(secrets).length) continue;
    state.integrationSecrets[key] = secrets;
    state.integrations[key] = {
      ...state.integrations[key],
      configured: true,
      updatedAt: new Date().toISOString()
    };
    updated.push(key);
  }
  return updated;
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
  for await (const chunk of req) chunks.push(chunk);
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
