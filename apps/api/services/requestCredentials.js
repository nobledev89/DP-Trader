const HEADER_MAP = {
  alpacaKey: "x-dpt-alpaca-key",
  alpacaSecret: "x-dpt-alpaca-secret",
  openaiKey: "x-dpt-openai-key",
  anthropicKey: "x-dpt-anthropic-key",
  polygonKey: "x-dpt-polygon-key",
  finnhubKey: "x-dpt-finnhub-key",
  twelveDataKey: "x-dpt-twelve-data-key",
  alphaVantageKey: "x-dpt-alpha-vantage-key"
};

export function configWithRequestCredentials(config, headers = {}) {
  const get = (name) => {
    if (typeof headers.get === "function") return headers.get(name);
    return headers[name] || headers[name.toLowerCase()];
  };

  const alpacaKey = get(HEADER_MAP.alpacaKey);
  const alpacaSecret = get(HEADER_MAP.alpacaSecret);
  if (!alpacaKey || !alpacaSecret) return config;

  return {
    ...config,
    alpaca: {
      ...config.alpaca,
      key: alpacaKey,
      secret: alpacaSecret
    }
  };
}

export function requestIntegrationStatus(config, headers = {}) {
  const get = (name) => {
    if (typeof headers.get === "function") return headers.get(name);
    return headers[name] || headers[name.toLowerCase()];
  };

  return {
    alpaca: Boolean(get(HEADER_MAP.alpacaKey) && get(HEADER_MAP.alpacaSecret)),
    openai: Boolean(get(HEADER_MAP.openaiKey)),
    anthropic: Boolean(get(HEADER_MAP.anthropicKey)),
    polygon: Boolean(get(HEADER_MAP.polygonKey)),
    finnhub: Boolean(get(HEADER_MAP.finnhubKey)),
    twelveData: Boolean(get(HEADER_MAP.twelveDataKey)),
    alphaVantage: Boolean(get(HEADER_MAP.alphaVantageKey))
  };
}
