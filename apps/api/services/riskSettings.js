const RISK_SETTING_FIELDS = {
  maxDailyLossPct: { label: "Max daily loss %", min: 0, max: 100, step: 0.01 },
  maxRiskPerTradePct: { label: "Max risk per trade %", min: 0, max: 100, step: 0.01 },
  maxOpenPositions: { label: "Max open positions", min: 0, max: 100, step: 1, integer: true },
  maxCorrelatedPositions: { label: "Max positions per correlation group", min: 1, max: 20, step: 1, integer: true },
  maxTradesPerHour: { label: "Max trades per hour", min: 0, max: 1000, step: 1, integer: true },
  maxTradesPerDay: { label: "Max trades per day", min: 0, max: 1000, step: 1, integer: true },
  minRewardRisk: { label: "Minimum reward/risk", min: 0, max: 20, step: 0.1 },
  maxSpreadPct: { label: "Max spread %", min: 0, max: 100, step: 0.01 },
  minAvgVolume: { label: "Minimum average volume", min: 0, max: 1000000000, step: 1000, integer: true },
  minCryptoDollarVolume: { label: "Minimum crypto $ volume", min: 0, max: 1000000000, step: 100, integer: true },
  maxExecutionErrors: { label: "Max execution errors", min: 0, max: 100, step: 1, integer: true },
  maxPositionValuePct: { label: "Max position value %", min: 0, max: 100, step: 0.1 },
  minAutoConfidence: { label: "AI confidence threshold", min: 0.1, max: 0.99, step: 0.01 },
  allowExtendedHours: { label: "Allow 24/5 extended hours", type: "boolean" },
  scalpingEnabled: { label: "Scalping exits enabled", type: "boolean" },
  autoTradeIntervalSeconds: { label: "AI cycle seconds", min: 10, max: 300, step: 5, integer: true },
  minHoldMinutes: { label: "Min hold minutes", min: 0, max: 240, step: 1, integer: true },
  maxHoldMinutes: { label: "Max hold minutes", min: 1, max: 1440, step: 1, integer: true },
  quickProfitPct: { label: "Quick profit %", min: 0.01, max: 20, step: 0.01 },
  quickStopPct: { label: "Quick stop %", min: 0.01, max: 20, step: 0.01 }
};

export function riskSettingDefinitions() {
  return RISK_SETTING_FIELDS;
}

export function configWithRiskOverrides(config, store) {
  return {
    ...config,
    risk: {
      ...config.risk,
      ...(store?.riskOverrides || {})
    }
  };
}

export function publicRiskSettings(config, store) {
  const values = {
    ...config.risk,
    ...(store?.riskOverrides || {})
  };
  return {
    values,
    defaults: config.risk,
    fields: RISK_SETTING_FIELDS,
    updatedAt: store?.riskSettingsUpdatedAt || null
  };
}

export function sanitizeRiskOverrides(input = {}, defaults = {}) {
  const overrides = {};
  for (const [key, meta] of Object.entries(RISK_SETTING_FIELDS)) {
    if (!(key in input)) continue;
    if (meta.type === "boolean") {
      const normalized = input[key] === true || input[key] === "true" || input[key] === "on";
      if (normalized !== Boolean(defaults[key])) overrides[key] = normalized;
      continue;
    }
    const value = Number(input[key]);
    if (!Number.isFinite(value)) {
      throw new Error(`${meta.label} must be a number`);
    }
    if (value < meta.min || value > meta.max) {
      throw new Error(`${meta.label} must be between ${meta.min} and ${meta.max}`);
    }
    const normalized = meta.integer ? Math.floor(value) : Number(value.toFixed(4));
    if (normalized !== defaults[key]) overrides[key] = normalized;
  }
  return overrides;
}
