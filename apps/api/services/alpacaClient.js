export function hasAlpacaCredentials(config) {
  return Boolean(config.alpaca.key && config.alpaca.secret);
}

export async function fetchAlpacaAccount(config) {
  if (!hasAlpacaCredentials(config)) return null;
  const response = await fetch(`${config.alpaca.baseUrl}/v2/account`, {
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
  const response = await fetch(`${config.alpaca.baseUrl}/v2/positions`, {
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
    avgEntryPrice: Number(position.avg_entry_price)
  }));
}

function alpacaHeaders(config) {
  return {
    "APCA-API-KEY-ID": config.alpaca.key,
    "APCA-API-SECRET-KEY": config.alpaca.secret,
    "Accept": "application/json"
  };
}
