export function hasAlpacaCredentials(config) {
  return Boolean(config.alpaca.key && config.alpaca.secret);
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

export async function submitAlpacaBracketOrder(config, signal, risk) {
  assertPaperTradingEndpoint(config);
  if (!hasAlpacaCredentials(config)) {
    throw new Error("Alpaca paper credentials are missing");
  }

  const payload = {
    symbol: signal.symbol,
    qty: String(risk.shares),
    side: signal.direction === "long" ? "buy" : "sell",
    type: "limit",
    time_in_force: "day",
    limit_price: String(signal.entryPrice),
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

export function alpacaApiRoot(config) {
  const base = (config.alpaca.baseUrl || "https://paper-api.alpaca.markets").replace(/\/+$/, "");
  return base.endsWith("/v2") ? base : `${base}/v2`;
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
