export function calculatePositionSize({ equity, entryPrice, stopPrice, maxRiskPerTradePct }) {
  const riskAmount = equity * (maxRiskPerTradePct / 100);
  const riskPerShare = Math.abs(entryPrice - stopPrice);
  if (!Number.isFinite(riskPerShare) || riskPerShare <= 0) {
    return { shares: 0, riskAmount, riskPerShare: 0 };
  }
  return {
    shares: Math.max(0, Math.floor(riskAmount / riskPerShare)),
    riskAmount: Number(riskAmount.toFixed(2)),
    riskPerShare: Number(riskPerShare.toFixed(2))
  };
}

export function evaluateRisk({ signal, account, state, config, now = new Date() }) {
  const reasons = [];
  const dailyLossPct = account.equity > 0 ? Math.abs(Math.min(0, account.dayPnl)) / account.equity * 100 : 0;
  const rewardRisk = Math.abs(signal.targetPrice - signal.entryPrice) / Math.abs(signal.entryPrice - signal.stopPrice);
  const afterCutoff = isAfterNoNewTradesCutoff(now);

  if (state.killSwitch) reasons.push("kill_switch_enabled");
  if (dailyLossPct >= config.maxDailyLossPct) reasons.push("daily_loss_limit_reached");
  if (state.openPositions >= config.maxOpenPositions) reasons.push("max_open_positions_reached");
  if (state.tradesLastHour >= config.maxTradesPerHour) reasons.push("max_trades_per_hour_reached");
  if (state.tradesToday >= config.maxTradesPerDay) reasons.push("max_trades_per_day_reached");
  if (signal.spreadPct > config.maxSpreadPct) reasons.push("spread_too_wide");
  if (rewardRisk < config.minRewardRisk) reasons.push("reward_risk_too_low");
  if (state.dataStale) reasons.push("market_data_stale");
  if (afterCutoff) reasons.push("after_new_trade_cutoff");

  const sizing = calculatePositionSize({
    equity: account.equity,
    entryPrice: signal.entryPrice,
    stopPrice: signal.stopPrice,
    maxRiskPerTradePct: config.maxRiskPerTradePct
  });

  if (sizing.shares < 1) reasons.push("position_size_below_one_share");

  return {
    decision: reasons.length ? "rejected" : "approved",
    reasonCodes: reasons.length ? reasons : ["risk_approved"],
    rewardRisk: Number(rewardRisk.toFixed(2)),
    ...sizing
  };
}

export function isAfterNoNewTradesCutoff(now) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  const parts = Object.fromEntries(formatter.formatToParts(now).map((part) => [part.type, part.value]));
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  return minutes >= (15 * 60 + 30);
}
