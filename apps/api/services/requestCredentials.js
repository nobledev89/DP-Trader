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
    result[key] = hasMeaningfulSecret(secrets[key]);
  }
  return result;
}

function hasMeaningfulSecret(payload) {
  if (!payload || typeof payload !== "object") return false;
  return Object.values(payload).some((value) => typeof value === "string" && value.trim().length > 0);
}
