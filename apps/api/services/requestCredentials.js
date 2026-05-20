const REQUIRED_FIELDS = {
  alpaca: ["apiKey", "secretKey"],
  openai: ["apiKey"],
  anthropic: ["apiKey"],
  polygon: ["apiKey"],
  finnhub: ["apiKey"],
  twelveData: ["apiKey"],
  alphaVantage: ["apiKey"]
};

export function configWithStoredCredentials(config, store) {
  const secrets = store?.integrationSecrets || {};
  const next = { ...config };

  if (secrets.alpaca?.apiKey && secrets.alpaca?.secretKey) {
    next.alpaca = {
      ...(config.alpaca || {}),
      key: secrets.alpaca.apiKey,
      secret: secrets.alpaca.secretKey
    };
  }

  if (secrets.anthropic?.apiKey) {
    next.anthropic = { ...(config.anthropic || {}), key: secrets.anthropic.apiKey };
  }

  if (secrets.openai?.apiKey) {
    next.openai = { ...(config.openai || {}), key: secrets.openai.apiKey };
  }

  return next;
}

export function storedIntegrationStatus(store) {
  const result = {};
  const secrets = store?.integrationSecrets || {};
  const integrations = store?.integrations || {};
  for (const key of Object.keys(integrations)) {
    result[key] = hasCompleteSecret(key, secrets[key]);
  }
  return result;
}

export function storedIntegrationDetail(store) {
  const result = {};
  const secrets = store?.integrationSecrets || {};
  const integrations = store?.integrations || {};
  for (const key of Object.keys(integrations)) {
    const required = REQUIRED_FIELDS[key] || ["apiKey"];
    const payload = secrets[key] || {};
    const missing = required.filter((field) => !isNonEmptyString(payload[field]));
    result[key] = {
      configured: missing.length === 0,
      missing,
      required,
      suffixes: secretSuffixes(payload, required)
    };
  }
  return result;
}

function hasCompleteSecret(integration, payload) {
  if (!payload || typeof payload !== "object") return false;
  const required = REQUIRED_FIELDS[integration] || ["apiKey"];
  return required.every((field) => isNonEmptyString(payload[field]));
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function secretSuffixes(payload, fields) {
  const suffixes = {};
  for (const field of fields) {
    if (!isNonEmptyString(payload[field])) continue;
    suffixes[field] = payload[field].trim().slice(-4);
  }
  return suffixes;
}
