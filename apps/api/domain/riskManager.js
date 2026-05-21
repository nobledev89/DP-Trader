export function calculatePositionSize({ equity, entryPrice, stopPrice, maxRiskPerTradePct, confidence }) {
  const riskMultiplier = confidenceRiskMultiplier(confidence);
  const riskAmount = equity * ((maxRiskPerTradePct * riskMultiplier) / 100);
  const riskPerShare = Math.abs(entryPrice - stopPrice);
  if (!Number.isFinite(riskPerShare) || riskPerShare <= 0) {
    return { shares: 0, riskAmount, riskPerShare: 0, riskMultiplier };
  }
  return {
    shares: Math.max(0, Math.floor(riskAmount / riskPerShare)),
    riskAmount: Number(riskAmount.toFixed(2)),
    riskPerShare: Number(riskPerShare.toFixed(2)),
    riskMultiplier
  };
}

export function capPositionByBuyingPower({ shares, entryPrice, buyingPower, maxPositionValuePct }) {
  const maxPositionValue = Math.max(0, buyingPower * (maxPositionValuePct / 100));
  const cappedShares = Math.floor(maxPositionValue / entryPrice);
  return {
    shares: Math.max(0, Math.min(shares, cappedShares)),
    maxPositionValue: Number(maxPositionValue.toFixed(2))
  };
}

export function evaluateRisk({ signal, account, state, config, now = new Date() }) {
  const reasons = [];
  const dailyLossPct = account.equity > 0 ? Math.abs(Math.min(0, account.dayPnl)) / account.equity * 100 : 0;
  const rewardRisk = Math.abs(signal.targetPrice - signal.entryPrice) / Math.abs(signal.entryPrice - signal.stopPrice);
  const afterCutoff = isAfterNoNewTradesCutoff(now);
  const afterForceFlat = isAfterForceFlatTime(now);
  const allowExtendedHoursNow = Boolean(config.allowExtendedHours) && isExtendedHoursEligibleTime(now);

  if (state.killSwitch) reasons.push("kill_switch_enabled");
  if (dailyLossPct >= config.maxDailyLossPct) reasons.push("daily_loss_limit_reached");
  if (state.openPositions >= config.maxOpenPositions) reasons.push("max_open_positions_reached");
  if (state.tradesLastHour >= config.maxTradesPerHour) reasons.push("max_trades_per_hour_reached");
  if (state.tradesToday >= config.maxTradesPerDay) reasons.push("max_trades_per_day_reached");
  if (state.executionErrors >= config.maxExecutionErrors) reasons.push("execution_error_circuit_breaker");
  if (signal.spreadPct > config.maxSpreadPct) reasons.push("spread_too_wide");
  if ((signal.avgVolume || 0) < config.minAvgVolume) reasons.push("average_volume_too_low");
  if (rewardRisk < config.minRewardRisk) reasons.push("reward_risk_too_low");
  if (state.dataStale) reasons.push("market_data_stale");
  if (!allowExtendedHoursNow && afterCutoff) reasons.push("after_new_trade_cutoff");
  if (!allowExtendedHoursNow && afterForceFlat) reasons.push("after_force_flat_time");

  const riskSizing = calculatePositionSize({
    equity: account.equity,
    entryPrice: signal.entryPrice,
    stopPrice: signal.stopPrice,
    maxRiskPerTradePct: config.maxRiskPerTradePct,
    confidence: signal.confidence
  });
  const sizing = capPositionByBuyingPower({
    shares: riskSizing.shares,
    entryPrice: signal.entryPrice,
    buyingPower: account.buyingPower || account.equity,
    maxPositionValuePct: config.maxPositionValuePct
  });

  if (sizing.shares < 1) reasons.push("position_size_below_one_share");

  return {
    decision: reasons.length ? "rejected" : "approved",
    reasonCodes: reasons.length ? reasons : ["risk_approved"],
    rewardRisk: Number(rewardRisk.toFixed(2)),
    riskMultiplier: riskSizing.riskMultiplier,
    ...riskSizing,
    shares: sizing.shares,
    maxPositionValue: sizing.maxPositionValue
  };
}

export function confidenceRiskMultiplier(confidence) {
  if (!Number.isFinite(confidence)) return 1;
  if (confidence >= 0.8) return 1;
  if (confidence >= 0.7) return 0.75;
  if (confidence >= 0.62) return 0.5;
  return 0.25;
}

export function isAfterNoNewTradesCutoff(now) {
  return isAfterEasternTime(now, 15, 30);
}

export function isAfterForceFlatTime(now) {
  return isAfterEasternTime(now, 15, 55);
}

export function isRegularMarketHours(now = new Date()) {
  const { day, minutes } = easternParts(now);
  return day >= 1 && day <= 5 && minutes >= (9 * 60 + 30) && minutes < (16 * 60);
}

export function isExtendedHoursEligibleTime(now = new Date()) {
  const { day, minutes } = easternParts(now);
  if (day === 0) return minutes >= 20 * 60;
  if (day >= 1 && day <= 4) return true;
  if (day === 5) return minutes < 20 * 60;
  return false;
}

function isAfterEasternTime(now, cutoffHour, cutoffMinute) {
  return easternParts(now).minutes >= (cutoffHour * 60 + cutoffMinute);
}

function easternParts(now) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  const parts = Object.fromEntries(formatter.formatToParts(now).map((part) => [part.type, part.value]));
  const days = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    day: days[parts.weekday] ?? 0,
    minutes: Number(parts.hour) * 60 + Number(parts.minute)
  };
}
