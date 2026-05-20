export function createStore() {
  return {
    account: {
      id: "paper-sim",
      equity: 100000,
      buyingPower: 200000,
      dayPnl: 842.35,
      status: "ACTIVE",
      source: "simulated"
    },
    positions: [],
    orders: [],
    fills: [],
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
  store.events.unshift({ severity, message, createdAt: new Date().toISOString() });
  store.events = store.events.slice(0, 30);
}
