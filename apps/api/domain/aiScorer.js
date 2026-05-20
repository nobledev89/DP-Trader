export function scoreSignal(signal, marketContext = {}) {
  const reasons = [];
  let score = 0.35;

  if (signal.relativeVolume >= 1.5) {
    score += 0.14;
    reasons.push("relative_volume_high");
  }
  if (signal.aboveVwap) {
    score += signal.direction === "long" ? 0.12 : -0.05;
    reasons.push("vwap_aligned");
  }
  if (signal.emaSlope > 0 && signal.direction === "long") {
    score += 0.1;
    reasons.push("trend_confirmed");
  }
  if (signal.rsi >= 45 && signal.rsi <= 68) {
    score += 0.09;
    reasons.push("rsi_constructive");
  }
  if (signal.expectedR >= 2) {
    score += 0.1;
    reasons.push("reward_risk_strong");
  }
  if (marketContext.spyTrend === "up" && signal.direction === "long") {
    score += 0.06;
    reasons.push("market_regime_supportive");
  }
  if (signal.spreadPct > 0.06) {
    score -= 0.18;
    reasons.push("spread_penalty");
  }
  if (signal.atrPct > 4) {
    score -= 0.1;
    reasons.push("volatility_penalty");
  }

  const probability = Math.max(0.01, Math.min(0.99, Number(score.toFixed(2))));
  return {
    modelVersion: "heuristic-shadow-v1",
    probabilityOfSuccess: probability,
    expectedR: Number((signal.expectedR * probability).toFixed(2)),
    decision: probability >= 0.62 ? "candidate" : "shadow_reject",
    reasonCodes: reasons.length ? reasons : ["insufficient_edge"]
  };
}
