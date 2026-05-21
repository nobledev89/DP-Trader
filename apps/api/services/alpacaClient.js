import { isExtendedHoursEligibleTime, isRegularMarketHours } from "../domain/riskManager.js";

export function hasAlpacaCredentials(config) {
  return Boolean(config.alpaca?.key && config.alpaca?.secret);
}

export function describeMissingAlpacaCredentials(config) {
  const missing = [];
  if (!config.alpaca?.key) missing.push("apiKey");
  if (!config.alpaca?.secret) missing.push("secretKey");
  return missing;
}

export async function fetchAlpacaAccount(config) {
  if (!hasAlpacaCredentials(config)) return null;
  assertPaperTradingEndpoint(config);
  const response = await fetch(`${alpacaApiRoot(config)}/account`, {
    headers: alpacaHeaders(config)
  });
  if (!response.ok) {
    throw new Error(`Alpaca account request failed: ${response.status}`);
  }
  const account = await response.json();
  return {
    id: account.id,
    equity: Number(account.equity),
    buyingPower: Number(account.buying_power),
    dayPnl: Number(account.equity) - Number(account.last_equity || account.equity),
    status: account.status,
    source: "alpaca"
  };
}

export async function fetchAlpacaPositions(config) {
  if (!hasAlpacaCredentials(config)) return null;
  assertPaperTradingEndpoint(config);
  const response = await fetch(`${alpacaApiRoot(config)}/positions`, {
    headers: alpacaHeaders(config)
  });
  if (!response.ok) {
    throw new Error(`Alpaca positions request failed: ${response.status}`);
  }
  return (await response.json()).map((position) => ({
    symbol: position.symbol,
    qty: Number(position.qty),
    marketValue: Number(position.market_value),
    unrealizedPnl: Number(position.unrealized_pl),
    unrealizedPnlPct: Number(position.unrealized_plpc),
    currentPrice: Number(position.current_price),
    avgEntryPrice: Number(position.avg_entry_price),
    side: Number(position.qty) >= 0 ? "long" : "short"
  }));
}

export async function fetchAlpacaOrders(config) {
  if (!hasAlpacaCredentials(config)) return null;
  assertPaperTradingEndpoint(config);
  const response = await fetch(`${alpacaApiRoot(config)}/orders?status=all&limit=50&direction=desc`, {
    headers: alpacaHeaders(config)
  });
  if (!response.ok) {
    throw new Error(`Alpaca orders request failed: ${response.status}`);
  }
  return (await response.json()).map((order) => ({
    id: order.id,
    clientOrderId: order.client_order_id,
    symbol: order.symbol,
    side: order.side,
    qty: Number(order.qty),
    type: order.order_class === "bracket" ? "alpaca_paper_bracket" : order.type,
    limitPrice: Number(order.limit_price || order.filled_avg_price || 0),
    stopPrice: Number(order.stop_price || 0),
    targetPrice: Number(order.take_profit?.limit_price || 0),
    status: order.status,
    createdAt: order.created_at,
    submittedAt: order.submitted_at,
    filledAt: order.filled_at,
    filledQty: Number(order.filled_qty || 0),
    filledAvgPrice: Number(order.filled_avg_price || 0)
  }));
}

export async function fetchAlpacaLatestMarket(config, symbols) {
  if (!symbols.length) return [];
  if (!hasAlpacaCredentials(config)) return null;
  const url = new URL(`${alpacaDataRoot(config)}/stocks/trades/latest`);
  url.searchParams.set("symbols", symbols.join(","));
  url.searchParams.set("feed", alpacaMarketDataFeed(config));
  const response = await fetch(url, {
    headers: alpacaHeaders(config)
  });
  if (!response.ok) {
    throw new Error(`Alpaca latest market data request failed: ${response.status}`);
  }
  const body = await response.json();
  return Object.entries(body.trades || {}).map(([symbol, trade]) => ({
    symbol,
    price: Number(trade.p),
    vwap: Number(trade.p),
    changePct: 0,
    relativeVolume: 1,
    spreadPct: 0.03,
    avgVolume: 3000000,
    updatedAt: trade.t || new Date().toISOString(),
    source: "alpaca_iex"
  }));
}

export async function fetchAlpacaLatestQuotes(config, symbols) {
  if (!symbols.length) return [];
  if (!hasAlpacaCredentials(config)) return null;
  const url = new URL(`${alpacaDataRoot(config)}/stocks/quotes/latest`);
  url.searchParams.set("symbols", symbols.join(","));
  url.searchParams.set("feed", alpacaMarketDataFeed(config));
  const response = await fetch(url, {
    headers: alpacaHeaders(config)
  });
  if (!response.ok) {
    throw new Error(`Alpaca latest quote request failed: ${response.status}`);
  }
  const body = await response.json();
  return Object.entries(body.quotes || {}).map(([symbol, quote]) => {
    const bid = Number(quote.bp) || 0;
    const ask = Number(quote.ap) || 0;
    const mid = bid && ask ? Number(((bid + ask) / 2).toFixed(4)) : ask || bid;
    return {
      symbol,
      bid,
      ask,
      mid,
      bidSize: Number(quote.bs) || 0,
      askSize: Number(quote.as) || 0,
      spread: Number((ask - bid).toFixed(4)),
      spreadPct: mid ? Number((((ask - bid) / mid) * 100).toFixed(4)) : 0,
      updatedAt: quote.t || new Date().toISOString()
    };
  });
}

export async function fetchAlpacaBars(config, symbols, { timeframe = "1Min", limit = 60 } = {}) {
  if (!symbols.length) return {};
  if (!hasAlpacaCredentials(config)) return null;
  const result = await fetchBarsPage(config, symbols, { timeframe, limit, feed: alpacaBarsDataFeed(config) });
  if (Object.values(result).some((bars) => bars.length)) return result;
  return fetchRecentHistoricalBars(config, symbols, { timeframe, limit });
}

export async function fetchAlpacaLatestCryptoQuotes(config, symbols, { loc = "us" } = {}) {
  if (!symbols.length) return [];
  if (!hasAlpacaCredentials(config)) return null;
  const url = new URL(`${alpacaDataBaseRoot()}/v1beta3/crypto/${loc}/latest/quotes`);
  url.searchParams.set("symbols", symbols.join(","));
  const response = await fetch(url, {
    headers: alpacaHeaders(config)
  });
  if (!response.ok) {
    throw new Error(`Alpaca crypto latest quote request failed: ${response.status}`);
  }
  const body = await response.json();
  return Object.entries(body.quotes || {}).map(([symbol, quote]) => {
    const bid = Number(quote.bp) || 0;
    const ask = Number(quote.ap) || 0;
    const mid = bid && ask ? Number(((bid + ask) / 2).toFixed(6)) : ask || bid;
    return {
      symbol,
      price: mid,
      tradePrice: mid,
      bid,
      ask,
      bidSize: Number(quote.bs) || 0,
      askSize: Number(quote.as) || 0,
      quoteSpread: Number((ask - bid).toFixed(6)),
      spreadPct: mid ? Number((((ask - bid) / mid) * 100).toFixed(4)) : 0,
      vwap: mid,
      changePct: 0,
      relativeVolume: 1,
      avgVolume: mid ? Math.round(mid * ((Number(quote.bs) || 0) + (Number(quote.as) || 0)) / 2) : 0,
      updatedAt: quote.t || new Date().toISOString(),
      assetClass: "crypto",
      source: "alpaca_crypto"
    };
  });
}

export async function fetchAlpacaCryptoBars(config, symbols, { timeframe = "1Min", limit = 60, loc = "us" } = {}) {
  if (!symbols.length) return {};
  if (!hasAlpacaCredentials(config)) return null;
  const end = new Date();
  const start = new Date(end.getTime() - 24 * 60 * 60 * 1000);
  const entries = await Promise.all(symbols.map(async (symbol) => {
    const url = new URL(`${alpacaDataBaseRoot()}/v1beta3/crypto/${loc}/bars`);
    url.searchParams.set("symbols", symbol);
    url.searchParams.set("timeframe", timeframe);
    url.searchParams.set("start", start.toISOString());
    url.searchParams.set("end", end.toISOString());
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("sort", "desc");
    const response = await fetch(url, {
      headers: alpacaHeaders(config)
    });
    if (!response.ok) return [symbol, []];
    const body = await response.json();
    const bars = normalizeBarsBySymbol(body.bars || {})[symbol] || [];
    return [symbol, bars.slice().reverse()];
  }));
  return Object.fromEntries(entries);
}

export async function submitAlpacaBracketOrder(config, signal, risk) {
  assertPaperTradingEndpoint(config);
  if (!hasAlpacaCredentials(config)) {
    const missing = describeMissingAlpacaCredentials(config);
    throw new Error(`Alpaca paper credentials are missing (${missing.join(", ")})`);
  }

  const limitPrice = marketableLimitPrice(signal, signal.quote);
  const payload = {
    symbol: signal.symbol,
    qty: String(risk.shares),
    side: signal.direction === "long" ? "buy" : "sell",
    type: "limit",
    time_in_force: "day",
    limit_price: String(limitPrice),
    order_class: "bracket",
    take_profit: {
      limit_price: String(signal.targetPrice)
    },
    stop_loss: {
      stop_price: String(signal.stopPrice)
    }
  };

  const response = await fetch(`${alpacaApiRoot(config)}/orders`, {
    method: "POST",
    headers: {
      ...alpacaHeaders(config),
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body.message || body.error || `Alpaca order request failed: ${response.status}`;
    throw new Error(message);
  }
  return body;
}

export async function submitAlpacaAutoOrder(config, signal, risk, now = new Date()) {
  if (signal.assetClass === "crypto") {
    return submitAlpacaCryptoLimitOrder(config, signal, risk);
  }
  if (config.risk?.allowExtendedHours && !isRegularMarketHours(now) && isExtendedHoursEligibleTime(now)) {
    return submitAlpacaExtendedLimitOrder(config, signal, risk);
  }
  return submitAlpacaBracketOrder(config, signal, risk);
}

export async function submitAlpacaCryptoLimitOrder(config, signal, risk) {
  assertPaperTradingEndpoint(config);
  if (!hasAlpacaCredentials(config)) {
    const missing = describeMissingAlpacaCredentials(config);
    throw new Error(`Alpaca paper credentials are missing (${missing.join(", ")})`);
  }
  if (signal.direction !== "long") {
    throw new Error(`Crypto auto trading only supports long spot entries (${signal.symbol})`);
  }

  const payload = {
    symbol: signal.symbol,
    qty: String(risk.shares),
    side: "buy",
    type: "limit",
    time_in_force: config.alpaca.cryptoTimeInForce || "day",
    limit_price: String(marketableLimitPrice(signal, signal.quote))
  };

  const response = await fetch(`${alpacaApiRoot(config)}/orders`, {
    method: "POST",
    headers: {
      ...alpacaHeaders(config),
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body.message || body.error || `Alpaca crypto order request failed: ${response.status}`;
    throw new Error(message);
  }
  return body;
}

export async function submitAlpacaExtendedLimitOrder(config, signal, risk) {
  assertPaperTradingEndpoint(config);
  if (!hasAlpacaCredentials(config)) {
    const missing = describeMissingAlpacaCredentials(config);
    throw new Error(`Alpaca paper credentials are missing (${missing.join(", ")})`);
  }

  const payload = {
    symbol: signal.symbol,
    qty: String(risk.shares),
    side: signal.direction === "long" ? "buy" : "sell",
    type: "limit",
    time_in_force: "day",
    limit_price: String(marketableLimitPrice(signal, signal.quote)),
    extended_hours: true
  };

  const response = await fetch(`${alpacaApiRoot(config)}/orders`, {
    method: "POST",
    headers: {
      ...alpacaHeaders(config),
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body.message || body.error || `Alpaca extended-hours order request failed: ${response.status}`;
    throw new Error(message);
  }
  return body;
}

export function marketableLimitPrice(signal, quote) {
  const bufferBps = 0.0025;
  if (quote && Number(quote.ask) > 0 && Number(quote.bid) > 0) {
    if (signal.direction === "long") {
      return Number((Number(quote.ask) * (1 + bufferBps)).toFixed(2));
    }
    return Number((Number(quote.bid) * (1 - bufferBps)).toFixed(2));
  }
  const multiplier = signal.direction === "long" ? 1 + bufferBps : 1 - bufferBps;
  return Number((signal.entryPrice * multiplier).toFixed(2));
}

export async function cancelAllAlpacaOrders(config) {
  assertPaperTradingEndpoint(config);
  if (!hasAlpacaCredentials(config)) throw new Error("Alpaca paper credentials are missing");
  const response = await fetch(`${alpacaApiRoot(config)}/orders`, {
    method: "DELETE",
    headers: alpacaHeaders(config)
  });
  const body = await response.json().catch(() => []);
  if (!response.ok) {
    throw new Error(`Alpaca cancel orders request failed: ${response.status}`);
  }
  return body;
}

export async function cancelAlpacaOrdersForSymbol(config, symbol, orders = []) {
  assertPaperTradingEndpoint(config);
  if (!hasAlpacaCredentials(config)) throw new Error("Alpaca paper credentials are missing");
  const activeStatuses = new Set(["new", "accepted", "pending_new", "partially_filled", "held", "calculated"]);
  const activeOrders = (orders || []).filter((order) => (
    order.symbol === symbol &&
    order.id &&
    activeStatuses.has(order.status)
  ));
  const results = [];
  for (const order of activeOrders) {
    const response = await fetch(`${alpacaApiRoot(config)}/orders/${order.id}`, {
      method: "DELETE",
      headers: alpacaHeaders(config)
    });
    if (!response.ok && response.status !== 404) {
      throw new Error(`Alpaca cancel ${symbol} order request failed: ${response.status}`);
    }
    results.push({ id: order.id, status: response.status });
  }
  return results;
}

export async function closeAlpacaPosition(config, position, now = new Date()) {
  assertPaperTradingEndpoint(config);
  if (!hasAlpacaCredentials(config)) throw new Error("Alpaca paper credentials are missing");
  if (config.risk?.allowExtendedHours && !isRegularMarketHours(now) && isExtendedHoursEligibleTime(now)) {
    return submitAlpacaExtendedPositionClose(config, position);
  }
  const response = await fetch(`${alpacaApiRoot(config)}/positions/${encodeURIComponent(position.symbol)}`, {
    method: "DELETE",
    headers: alpacaHeaders(config)
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok && response.status !== 404) {
    const message = body.message || body.error || `Alpaca close ${position.symbol} position request failed: ${response.status}`;
    throw new Error(message);
  }
  return body;
}

export async function closeAllAlpacaPositions(config) {
  assertPaperTradingEndpoint(config);
  if (!hasAlpacaCredentials(config)) throw new Error("Alpaca paper credentials are missing");
  const response = await fetch(`${alpacaApiRoot(config)}/positions`, {
    method: "DELETE",
    headers: alpacaHeaders(config)
  });
  const body = await response.json().catch(() => []);
  if (!response.ok) {
    throw new Error(`Alpaca close positions request failed: ${response.status}`);
  }
  return body;
}

async function submitAlpacaExtendedPositionClose(config, position) {
  const qty = Math.abs(Number(position.qty || 0));
  if (!qty) throw new Error(`Cannot close ${position.symbol}: position quantity is zero`);
  const side = position.side === "short" || Number(position.qty) < 0 ? "buy" : "sell";
  const currentPrice = Number(position.currentPrice || position.avgEntryPrice || 0);
  if (!currentPrice) throw new Error(`Cannot close ${position.symbol}: current price is missing`);
  const limitPrice = side === "sell"
    ? Number((currentPrice * 0.9975).toFixed(2))
    : Number((currentPrice * 1.0025).toFixed(2));
  const response = await fetch(`${alpacaApiRoot(config)}/orders`, {
    method: "POST",
    headers: {
      ...alpacaHeaders(config),
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      symbol: position.symbol,
      qty: String(qty),
      side,
      type: "limit",
      time_in_force: "day",
      limit_price: String(limitPrice),
      extended_hours: true
    })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body.message || body.error || `Alpaca extended close ${position.symbol} order failed: ${response.status}`;
    throw new Error(message);
  }
  return body;
}

export function alpacaApiRoot(config) {
  const base = (config.alpaca.baseUrl || "https://paper-api.alpaca.markets").replace(/\/+$/, "");
  return base.endsWith("/v2") ? base : `${base}/v2`;
}

export function alpacaDataRoot(config) {
  return "https://data.alpaca.markets/v2";
}

function alpacaDataBaseRoot() {
  return "https://data.alpaca.markets";
}

function alpacaMarketDataFeed(config, now = new Date()) {
  if (config.risk?.allowExtendedHours && !isRegularMarketHours(now) && isExtendedHoursEligibleTime(now)) {
    return config.alpaca.extendedDataFeed || "overnight";
  }
  return config.alpaca.dataFeed || "iex";
}

function alpacaBarsDataFeed(config) {
  const feed = config.alpaca.dataFeed || "iex";
  return ["iex", "sip"].includes(feed) ? feed : "iex";
}

async function fetchBarsPage(config, symbols, { timeframe, limit, feed, start, end, sort }) {
  const url = new URL(`${alpacaDataRoot(config)}/stocks/bars`);
  url.searchParams.set("symbols", symbols.join(","));
  url.searchParams.set("timeframe", timeframe);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("feed", feed);
  url.searchParams.set("adjustment", "raw");
  if (start) url.searchParams.set("start", start.toISOString());
  if (end) url.searchParams.set("end", end.toISOString());
  if (sort) url.searchParams.set("sort", sort);
  const response = await fetch(url, {
    headers: alpacaHeaders(config)
  });
  if (!response.ok) {
    throw new Error(`Alpaca bars request failed: ${response.status}`);
  }
  const body = await response.json();
  return normalizeBarsBySymbol(body.bars || {});
}

async function fetchRecentHistoricalBars(config, symbols, { timeframe, limit }) {
  const end = new Date();
  const start = new Date(end.getTime() - 7 * 24 * 60 * 60 * 1000);
  const feed = alpacaBarsDataFeed(config);
  const entries = await Promise.all(symbols.map(async (symbol) => {
    const barsBySymbol = await fetchBarsPage(config, [symbol], {
      timeframe,
      limit,
      feed,
      start,
      end,
      sort: "desc"
    }).catch(() => ({}));
    const bars = barsBySymbol[symbol] || [];
    return [symbol, bars.slice().reverse()];
  }));
  return Object.fromEntries(entries);
}

function normalizeBarsBySymbol(rawBars) {
  const result = {};
  for (const [symbol, bars] of Object.entries(rawBars || {})) {
    result[symbol] = (bars || []).map((bar) => ({
      t: bar.t,
      open: Number(bar.o),
      high: Number(bar.h),
      low: Number(bar.l),
      close: Number(bar.c),
      volume: Number(bar.v) || 0,
      vwap: Number(bar.vw) || Number(bar.c)
    }));
  }
  return result;
}

export function assertPaperTradingEndpoint(config) {
  const root = new URL(alpacaApiRoot(config));
  if (root.hostname !== "paper-api.alpaca.markets") {
    throw new Error("Auto trading is locked to Alpaca paper endpoint only");
  }
}

function alpacaHeaders(config) {
  return {
    "APCA-API-KEY-ID": config.alpaca.key,
    "APCA-API-SECRET-KEY": config.alpaca.secret,
    "Accept": "application/json"
  };
}
