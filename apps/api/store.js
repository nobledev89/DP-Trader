export function createStore() {
  return {
    account: {
      id: "paper-sim",
      equity: 100000,
      buyingPower: 200000,
      dayPnl: 0,
      status: "ACTIVE",
      source: "simulated"
    },
    positions: [],
    orders: [],
    fills: [],
    lastMarketSnapshot: [],
    executionErrors: 0,
    lastAutoTradeAt: null,
    killSwitch: false,
    integrations: {
      alpaca: { label: "Alpaca Paper Trading", configured: false, updatedAt: null },
      openai: { label: "OpenAI", configured: false, updatedAt: null },
      anthropic: { label: "Claude / Anthropic", configured: false, updatedAt: null },
      polygon: { label: "Polygon / Massive", configured: false, updatedAt: null },
      finnhub: { label: "Finnhub", configured: false, updatedAt: null },
      twelveData: { label: "Twelve Data", configured: false, updatedAt: null },
      alphaVantage: { label: "Alpha Vantage", configured: false, updatedAt: null }
    },
    integrationSecrets: {},
    riskOverrides: {},
    riskSettingsUpdatedAt: null,
    events: [
      {
        severity: "info",
        message: "Paper trading environment initialized",
        createdAt: new Date().toISOString()
      }
    ]
  };
}

export function appendEvent(store, severity, message) {
  store.events.unshift({ severity, message: sanitizeMessage(message), createdAt: new Date().toISOString() });
  store.events = store.events.slice(0, 100);
}

function sanitizeMessage(message) {
  return String(message)
    .replace(/APCA-API-KEY-ID:\s*[^,\s]+/gi, "APCA-API-KEY-ID: [redacted]")
    .replace(/APCA-API-SECRET-KEY:\s*[^,\s]+/gi, "APCA-API-SECRET-KEY: [redacted]")
    .replace(/sk-[A-Za-z0-9_-]+/g, "[redacted-key]");
}
