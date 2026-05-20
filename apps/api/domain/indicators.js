export function computeIndicators(bars) {
  if (!Array.isArray(bars) || bars.length < 15) {
    return null;
  }
  const closes = bars.map((bar) => bar.close);
  const highs = bars.map((bar) => bar.high);
  const lows = bars.map((bar) => bar.low);
  const volumes = bars.map((bar) => bar.volume);
  const last = bars[bars.length - 1];
  const first = bars[0];

  const ema20 = ema(closes, Math.min(20, closes.length));
  const ema50 = ema(closes, Math.min(50, closes.length));
  const rsi14 = rsi(closes, 14);
  const atr14 = atr(highs, lows, closes, 14);
  const vwapValue = vwap(highs, lows, closes, volumes);

  const lookback = Math.min(closes.length, 20);
  const recent = closes.slice(-lookback);
  const emaSlope = recent.length >= 2
    ? Number((((ema20 - ema(closes.slice(0, -1), Math.min(20, closes.length - 1))) / ema20) * 100).toFixed(4))
    : 0;

  const changePct = first.close > 0 ? Number((((last.close - first.close) / first.close) * 100).toFixed(3)) : 0;
  const atrPct = last.close > 0 ? Number(((atr14 / last.close) * 100).toFixed(3)) : 0;
  const avgVolume = volumes.length ? Math.round(volumes.reduce((sum, v) => sum + v, 0) / volumes.length) : 0;
  const recentVolume = volumes.slice(-5).reduce((sum, v) => sum + v, 0) / 5;
  const relativeVolume = avgVolume > 0 ? Number((recentVolume / avgVolume).toFixed(2)) : 1;

  return {
    lastClose: Number(last.close.toFixed(4)),
    ema20: Number(ema20.toFixed(4)),
    ema50: Number(ema50.toFixed(4)),
    rsi14: Number(rsi14.toFixed(2)),
    atr14: Number(atr14.toFixed(4)),
    atrPct,
    vwap: Number(vwapValue.toFixed(4)),
    emaSlope,
    changePct,
    avgVolume,
    relativeVolume,
    aboveVwap: last.close >= vwapValue,
    aboveEma20: last.close >= ema20,
    aboveEma50: last.close >= ema50,
    bars: bars.length
  };
}

function ema(values, period) {
  if (!values.length) return 0;
  if (period <= 1) return values[values.length - 1];
  const k = 2 / (period + 1);
  let value = values[0];
  for (let i = 1; i < values.length; i++) {
    value = values[i] * k + value * (1 - k);
  }
  return value;
}

function rsi(values, period) {
  if (values.length < period + 1) return 50;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const change = values[i] - values[i - 1];
    if (change >= 0) gain += change;
    else loss -= change;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  for (let i = period + 1; i < values.length; i++) {
    const change = values[i] - values[i - 1];
    const up = change > 0 ? change : 0;
    const down = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + up) / period;
    avgLoss = (avgLoss * (period - 1) + down) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function atr(highs, lows, closes, period) {
  if (highs.length < 2) return 0;
  const trueRanges = [];
  for (let i = 1; i < highs.length; i++) {
    const highLow = highs[i] - lows[i];
    const highClose = Math.abs(highs[i] - closes[i - 1]);
    const lowClose = Math.abs(lows[i] - closes[i - 1]);
    trueRanges.push(Math.max(highLow, highClose, lowClose));
  }
  if (!trueRanges.length) return 0;
  const window = Math.min(period, trueRanges.length);
  const slice = trueRanges.slice(-window);
  return slice.reduce((sum, value) => sum + value, 0) / window;
}

function vwap(highs, lows, closes, volumes) {
  let pvSum = 0;
  let volSum = 0;
  for (let i = 0; i < closes.length; i++) {
    const typical = (highs[i] + lows[i] + closes[i]) / 3;
    pvSum += typical * volumes[i];
    volSum += volumes[i];
  }
  return volSum > 0 ? pvSum / volSum : closes[closes.length - 1];
}
