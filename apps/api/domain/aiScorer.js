import { callTradingDecision, hasLlmCredentials, llmProvider } from "../services/llmClient.js";

export function scoreSignal(signal, marketContext = {}) {
  const reasons = [];
  let score = 0.35;

  if (signal.relativeVolume >= 1.5) {
    score += 0.14;
    reasons.push("relative_volume_high");
  }
  if (signal.aboveVwap != null) {
    const vwapAligned = signal.aboveVwap === (signal.direction === "long");
    score += vwapAligned ? 0.12 : -0.12;
    reasons.push(vwapAligned ? "vwap_aligned" : "vwap_misaligned");
  }
  if (signal.emaSlope > 0 && signal.direction === "long") {
    score += 0.1;
    reasons.push("trend_confirmed");
  }
  if (signal.emaSlope < 0 && signal.direction === "short") {
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
  if (marketContext.spyTrend === "down" && signal.direction === "short") {
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

export async function scoreSignalWithLlm({ config, signal, marketContext, risk }) {
  const heuristic = scoreSignal(signal, marketContext);
  if (!hasLlmCredentials(config)) {
    return { ...heuristic, modelVersion: `${heuristic.modelVersion}+no_llm` };
  }
  try {
    const payload = buildLlmPayload(signal, marketContext, risk, heuristic);
    const result = await callTradingDecision(config, payload);
    if (!result?.decision) {
      return { ...heuristic, modelVersion: `${heuristic.modelVersion}+llm_parse_fail`, llmProvider: result?.provider || llmProvider(config) };
    }
    const decision = result.decision;
    const blended = blendConfidence(heuristic.probabilityOfSuccess, decision.confidence);
    return {
      modelVersion: `${result.provider}:${result.model}`,
      probabilityOfSuccess: blended,
      expectedR: Number((signal.expectedR * blended).toFixed(2)),
      decision: decision.approve ? "candidate" : "shadow_reject",
      reasonCodes: decision.reasonCodes.length ? decision.reasonCodes : heuristic.reasonCodes,
      rationale: decision.rationale,
      heuristic,
      llm: {
        provider: result.provider,
        model: result.model,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        approve: decision.approve,
        confidence: decision.confidence
      }
    };
  } catch (error) {
    return {
      ...heuristic,
      modelVersion: `${heuristic.modelVersion}+llm_error`,
      reasonCodes: [...heuristic.reasonCodes, "llm_error"],
      llmError: error.message
    };
  }
}

function blendConfidence(heuristic, llm) {
  const value = heuristic * 0.35 + llm * 0.65;
  return Math.max(0.01, Math.min(0.99, Number(value.toFixed(3))));
}

function buildLlmPayload(signal, marketContext, risk, heuristic) {
  return {
    symbol: signal.symbol,
    direction: signal.direction,
    strategy: signal.strategy,
    entryPrice: signal.entryPrice,
    stopPrice: signal.stopPrice,
    targetPrice: signal.targetPrice,
    expectedR: signal.expectedR,
    quote: signal.quote,
    indicators: {
      rsi14: signal.rsi,
      emaSlope: signal.emaSlope,
      atrPct: signal.atrPct,
      aboveVwap: signal.aboveVwap,
      aboveEma20: signal.aboveEma20,
      aboveEma50: signal.aboveEma50,
      spreadPct: signal.spreadPct,
      relativeVolume: signal.relativeVolume,
      avgVolume: signal.avgVolume
    },
    risk: {
      shares: risk?.shares,
      riskAmount: risk?.riskAmount,
      rewardRisk: risk?.rewardRisk,
      decision: risk?.decision,
      reasonCodes: risk?.reasonCodes
    },
    marketContext,
    heuristic: {
      probability: heuristic.probabilityOfSuccess,
      reasonCodes: heuristic.reasonCodes
    }
  };
}
