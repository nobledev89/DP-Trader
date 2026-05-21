const pages = [...document.querySelectorAll(".page")];
const navItems = [...document.querySelectorAll(".nav-item")];
let state = null;
let integrationsState = {};
let riskSettingsState = null;
let historyState = null;
let historyRangeDays = 30;
let historySearchTerm = "";
let historyOutcomeFilter = "all";
let historyInFlight = null;

let selectedSymbol = null;
let activeFilter = "popular";
let activeInterval = "15m";
let autoTradeInFlight = false;
let lastAutoTradeAt = 0;
let refreshInFlight = null;
let loadingTimer = null;
let loadingPercent = 0;
const previousPrices = new Map();
let aiLogs = readAiLogs();
const activePageKey = "dpTraderActivePage";
const localOrdersKey = "dpTraderLocalOrders";
const llmUsageKey = "dpTraderLlmUsage";
const localPauseKey = "dpTraderAutoPaused";

const integrationFields = {
  alpaca: ["apiKey", "secretKey"],
  openai: ["apiKey"],
  anthropic: ["apiKey"],
  polygon: ["apiKey"],
  finnhub: ["apiKey"],
  twelveData: ["apiKey"],
  alphaVantage: ["apiKey"]
};

navItems.forEach((item) => {
  item.addEventListener("click", () => showPage(item.dataset.page));
});
document.querySelector("#refreshButton").addEventListener("click", () => refresh({ showLoading: true }));
document.querySelector("#loadingRetryButton").addEventListener("click", () => safeRefresh({ showLoading: true }));
document.querySelector("#killSwitchButton").addEventListener("click", async () => {
  await togglePause();
});
document.querySelector("#pauseTextButton").addEventListener("click", async () => {
  await togglePause();
});

async function togglePause() {
  const nextPaused = !isAutoPaused();
  localStorage.setItem(localPauseKey, String(nextPaused));
  await postJson("/api/kill-switch", { enabled: nextPaused });
  logAiActivity(nextPaused ? "paused" : "running", nextPaused ? "Auto trading paused by user." : "Auto trading resumed by user.", {});
  await refresh();
}

async function emergencyAction(action) {
  localStorage.setItem(localPauseKey, "true");
  try {
    setText("#emergencyMessage", "Sending emergency request...");
    const result = await postJson(`/api/emergency/${action}`, {});
    logAiActivity("paused", `${title(action)} requested. AI paused.`, result);
    setText("#emergencyMessage", `${title(action)} requested. Refreshing Alpaca state...`);
    await refresh();
  } catch (error) {
    logAiActivity("blocked", `Emergency ${action} blocked: ${error.message}`, {});
    setText("#emergencyMessage", `Emergency request failed: ${error.message}`);
  }
}
document.querySelector("#settingsForm").addEventListener("submit", saveSettings);
document.querySelector("#settingsGrid").addEventListener("click", handleSettingsGridClick);
document.querySelector("#riskSettingsForm").addEventListener("submit", saveRiskSettings);
document.querySelector("#clearKeysButton").addEventListener("click", clearSavedKeys);
document.querySelector("#resetRiskSettingsButton").addEventListener("click", resetRiskSettings);
document.querySelector("#cancelOrdersButton").addEventListener("click", () => emergencyAction("cancel-orders"));
document.querySelector("#closePositionsButton").addEventListener("click", () => emergencyAction("close-positions"));

document.querySelectorAll("#historyRangeGroup .interval").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#historyRangeGroup .interval").forEach((b) => b.classList.toggle("active", b === btn));
    historyRangeDays = Number(btn.dataset.historyRange) || 30;
    refreshHistory({ force: true });
  });
});
document.querySelector("#historyRefreshButton")?.addEventListener("click", () => refreshHistory({ force: true }));
document.querySelector("#historyExportButton")?.addEventListener("click", exportHistoryCsv);
document.querySelector("#historySearch")?.addEventListener("input", (event) => {
  historySearchTerm = event.target.value.trim().toLowerCase();
  renderHistoryTable();
});
document.querySelector("#historyOutcomeFilter")?.addEventListener("change", (event) => {
  historyOutcomeFilter = event.target.value;
  renderHistoryTable();
});

document.querySelectorAll("#instrumentTabs .tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll("#instrumentTabs .tab").forEach((t) => t.classList.toggle("active", t === tab));
    activeFilter = tab.dataset.filter;
    if (state) renderWatchlist(state.market);
  });
});

document.querySelectorAll("#intervalGroup .interval").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("#intervalGroup .interval").forEach((b) => b.classList.toggle("active", b === btn));
    activeInterval = btn.dataset.interval;
    if (state && selectedSymbol) {
      const bar = state.market.find((b) => b.symbol === selectedSymbol);
      if (bar) renderChart(bar);
    }
  });
});

const tradeButton = document.querySelector(".btn-trade");
if (tradeButton) {
  tradeButton.textContent = "AI Auto Active";
  tradeButton.disabled = true;
}

function showPage(pageId) {
  if (!pages.some((page) => page.id === pageId)) pageId = "markets";
  pages.forEach((page) => page.classList.toggle("active", page.id === pageId));
  navItems.forEach((item) => item.classList.toggle("active", item.dataset.page === pageId));
  localStorage.setItem(activePageKey, pageId);
  if (location.hash !== `#${pageId}`) {
    history.replaceState(null, "", `#${pageId}`);
  }
  if (pageId === "settings") {
    refreshSettingsPanels().catch((error) => showSettingsMessage(`Could not load settings: ${error.message}`, "error"));
  }
  if (pageId === "history") {
    refreshHistory({ force: !historyState }).catch((error) => {
      setText("#historyGeneratedAt", `Could not load: ${error.message}`);
    });
  }
}

async function refresh(options = {}) {
  if (refreshInFlight) return refreshInFlight;
  const showLoading = Boolean(options.showLoading || !state);
  refreshInFlight = doRefresh(showLoading).finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

async function doRefresh(showLoading) {
  if (showLoading) startLoading("Loading dashboard", "Connecting to trader state");
  try {
    if (showLoading) setLoadingProgress(18, "Fetching account, market data, and AI signals");
    const appState = await fetchJson("/api/state");
    if (showLoading) setLoadingProgress(72, "Rendering dashboard");
    state = appState;
    renderState(appState);
    if (isSettingsPageActive()) {
      if (showLoading) setLoadingProgress(86, "Loading saved settings");
      await refreshSettingsPanels();
    }
    if (showLoading) finishLoading();
    maybeRunAutoTrade();
  } catch (error) {
    if (showLoading) failLoading(error.message);
    throw error;
  }
}

async function refreshSettingsPanels() {
  const [settings, riskSettings] = await Promise.all([
    fetchJson("/api/settings/integrations"),
    fetchJson("/api/settings/risk")
  ]);
  integrationsState = settings.integrations || {};
  riskSettingsState = riskSettings.risk || null;
  renderSettings(integrationsState);
  renderRiskSettings(riskSettingsState);
}

function isSettingsPageActive() {
  return document.querySelector("#settings")?.classList.contains("active");
}

function renderState(data) {
  setText("#equity", money(data.account.equity));
  setText("#accountChipEquity", money(data.account.equity));
  setText("#dayPnl", money(data.account.dayPnl));
  document.querySelector("#dayPnl").className = data.account.dayPnl >= 0 ? "up" : "down";
  setText("#openPositions", String(data.positions.length));
  setText("#openPositionLimit", `Max ${data.risk.maxOpenPositions} configured`);
  setText("#accountSource", `${data.account.source} account`);
  setText("#lastTick", time(new Date()));
  const autoPaused = isAutoPaused() || data.risk.killSwitch;
  setText("#riskState", autoPaused ? "Paused" : "Ready");
  setText("#riskLimits", `${data.risk.maxRiskPerTradePct}% risk/trade, ${data.risk.maxDailyLossPct}% daily stop`);
  setText("#modeLabel", data.risk.tradingMode.toUpperCase());

  const liveGuard = document.querySelector("#liveGuard");
  liveGuard.textContent = data.risk.liveTradingArmed ? "Live armed" : "Live blocked";
  liveGuard.className = data.risk.liveTradingArmed ? "pill danger-pill" : "pill safe";

  const killButton = document.querySelector("#killSwitchButton");
  killButton.classList.toggle("active", autoPaused);
  killButton.title = autoPaused ? "Resume paper trading" : "Pause trading";
  const pauseTextButton = document.querySelector("#pauseTextButton");
  if (pauseTextButton) pauseTextButton.textContent = autoPaused ? "Resume AI" : "Pause AI";
  if (tradeButton) tradeButton.textContent = autoPaused ? "AI Auto Paused" : "AI Auto Active";
  renderAiLogs();

  renderWatchlist(data.market);
  renderSignals(data.signals);
  renderPositions(data.positions);
  renderOpenTrades(data.positions);
  renderOrders(data.orders);
  renderNews(data.events);
  renderRiskRules(data.risk);
  renderModelBars(data.signals);
  renderLlmUsage();
}

/* ───── Watchlist ───── */
function filterMarket(market) {
  const arr = [...market];
  switch (activeFilter) {
    case "rising": return arr.filter((b) => b.changePct >= 0).sort((a, b) => b.changePct - a.changePct);
    case "falling": return arr.filter((b) => b.changePct < 0).sort((a, b) => a.changePct - b.changePct);
    case "crypto": return arr.filter((b) => /BTC|ETH|SOL|DOGE|XRP|ADA|AVAX/i.test(b.symbol));
    case "quantity": return arr.sort((a, b) => (b.relativeVolume || 0) - (a.relativeVolume || 0));
    case "trending": return arr.sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));
    case "conservative": return arr.filter((b) => Math.abs(b.changePct) < 1).sort((a, b) => (a.spreadPct || 0) - (b.spreadPct || 0));
    default: return arr;
  }
}

const iconPalette = ["#f7931a", "#627eea", "#26a17b", "#2962ff", "#f4c343", "#1ec479", "#9b59b6", "#ff6b6b", "#5a8dee", "#e84393"];
function symbolIconColor(symbol) {
  let h = 0;
  for (const c of symbol) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return iconPalette[h % iconPalette.length];
}

function renderWatchlist(market) {
  const list = filterMarket(market);
  if (!list.length) {
    document.querySelector("#watchlist").innerHTML = `<div style="padding:18px;color:var(--muted);font-size:12px;">No instruments match this filter.</div>`;
    if (selectedSymbol) renderChartEmpty();
    return;
  }
  if (!selectedSymbol || !list.find((b) => b.symbol === selectedSymbol)) {
    selectedSymbol = list[0].symbol;
  }
  document.querySelector("#watchlist").innerHTML = list.map((bar) => {
    const up = bar.changePct >= 0;
    const initials = bar.symbol.slice(0, Math.min(3, bar.symbol.length));
    return `
      <div class="wl-row${bar.symbol === selectedSymbol ? " active" : ""}" data-symbol="${bar.symbol}">
        <div class="wl-symbol">
          <span class="wl-icon" style="background:${symbolIconColor(bar.symbol)}">${initials.slice(0,1)}</span>
          <span class="wl-name">${bar.symbol}</span>
        </div>
        <span class="wl-price ${priceFlashClass(bar)}">${money(bar.price)}</span>
        <span class="wl-change ${up ? "up" : "down"}">${up ? "+" : ""}${bar.changePct.toFixed(2)}%</span>
      </div>
    `;
  }).join("");
  document.querySelectorAll("#watchlist .wl-row").forEach((row) => {
    row.addEventListener("click", () => {
      selectedSymbol = row.dataset.symbol;
      document.querySelectorAll("#watchlist .wl-row").forEach((r) => r.classList.toggle("active", r === row));
      const bar = market.find((b) => b.symbol === selectedSymbol);
      if (bar) renderChart(bar);
    });
  });
  const bar = market.find((b) => b.symbol === selectedSymbol);
  if (bar) renderChart(bar);
  list.forEach((bar) => previousPrices.set(bar.symbol, bar.price));
}

/* ───── Candlestick chart (synthetic, deterministic per symbol+interval) ───── */
function seededRand(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
function hashString(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}

function generateCandles(symbol, endPrice, changePct, interval, count = 64) {
  const startPrice = endPrice / (1 + changePct / 100);
  const seed = hashString(symbol + ":" + interval);
  const rand = seededRand(seed);
  const vol = Math.max(0.004, Math.abs(changePct) / 100 * 0.6 + 0.006);
  const candles = [];
  let prevClose = startPrice;
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const trend = startPrice + (endPrice - startPrice) * t;
    const noise = (rand() - 0.5) * startPrice * vol * 2;
    let close = trend + noise;
    if (i === count - 1) close = endPrice;
    const open = prevClose;
    const wickHigh = Math.max(open, close) + rand() * startPrice * vol;
    const wickLow = Math.min(open, close) - rand() * startPrice * vol;
    candles.push({ open, close, high: wickHigh, low: wickLow });
    prevClose = close;
  }
  return candles;
}

function renderChartEmpty() {
  const svg = document.querySelector("#candleChart");
  svg.innerHTML = "";
  setText("#chartSymbol", "—");
  setText("#chartPrice", "$0.00");
  const chg = document.querySelector("#chartChange");
  chg.textContent = "+0.00%"; chg.className = "chart-change up";
}

function renderChart(bar) {
  setText("#chartSymbol", bar.symbol);
  setText("#chartPrice", money(bar.price));
  const chg = document.querySelector("#chartChange");
  const up = bar.changePct >= 0;
  chg.textContent = `${up ? "+" : ""}${bar.changePct.toFixed(2)}%`;
  chg.className = `chart-change ${up ? "up" : "down"}`;

  const candles = generateCandles(bar.symbol, bar.price, bar.changePct, activeInterval);
  drawCandles(candles, bar);

  const lo = Math.min(...candles.map((c) => c.low));
  const hi = Math.max(...candles.map((c) => c.high));
  setText("#priceLow", money(lo));
  setText("#priceHigh", money(hi));
  const span = hi - lo || 1;
  const pos = ((bar.price - lo) / span) * 100;
  document.querySelector("#priceMarker").style.left = `${Math.max(2, Math.min(98, pos))}%`;
  setText("#priceChangeLabel", activeInterval === "1d" ? "Day" : activeInterval === "4h" ? "Day" : activeInterval === "1h" ? "Week" : "Week");

  // Sentiment derived from signal confidence and direction if available
  const signal = state?.signals?.find((s) => s.symbol === bar.symbol);
  let buyPct = 50;
  if (signal) {
    const c = signal.confidence ?? 0.5;
    buyPct = signal.direction === "long" ? Math.round(50 + c * 40) : Math.round(50 - c * 40);
  } else {
    buyPct = Math.round(50 + bar.changePct * 4);
  }
  buyPct = Math.max(8, Math.min(92, buyPct));
  const sellPct = 100 - buyPct;
  document.querySelector("#sentimentBuy").style.width = `${buyPct}%`;
  document.querySelector("#sentimentSell").style.width = `${sellPct}%`;
  setText("#buyPct", `${buyPct}%`);
  setText("#sellPct", `${sellPct}%`);
  setText("#sentimentLabel", buyPct > 60 ? "Bullish" : buyPct < 40 ? "Bearish" : "Mixed");
}

function drawCandles(candles, bar) {
  const svg = document.querySelector("#candleChart");
  const W = 1000, H = 420;
  const padL = 8, padR = 64, padT = 18, padB = 22;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const lows = candles.map((c) => c.low);
  const highs = candles.map((c) => c.high);
  const lo = Math.min(...lows);
  const hi = Math.max(...highs);
  const range = (hi - lo) || 1;
  const padPrice = range * 0.08;
  const yMin = lo - padPrice;
  const yMax = hi + padPrice;
  const yScale = (p) => padT + (1 - (p - yMin) / (yMax - yMin)) * innerH;
  const stepX = innerW / candles.length;
  const candleW = Math.max(2, stepX * 0.62);

  const gridLines = 5;
  let grid = "";
  for (let i = 0; i <= gridLines; i++) {
    const y = padT + (innerH * i) / gridLines;
    const price = yMax - ((yMax - yMin) * i) / gridLines;
    grid += `<line class="grid-line" x1="${padL}" y1="${y.toFixed(1)}" x2="${padL + innerW}" y2="${y.toFixed(1)}"/>`;
    grid += `<text class="axis-label" x="${padL + innerW + 6}" y="${(y + 3).toFixed(1)}">${price.toFixed(price > 100 ? 0 : 2)}</text>`;
  }

  let candleEls = "";
  candles.forEach((c, i) => {
    const x = padL + i * stepX + (stepX - candleW) / 2;
    const cx = x + candleW / 2;
    const up = c.close >= c.open;
    const cls = up ? "candle-up" : "candle-down";
    const yOpen = yScale(c.open);
    const yClose = yScale(c.close);
    const yHigh = yScale(c.high);
    const yLow = yScale(c.low);
    const top = Math.min(yOpen, yClose);
    const bodyH = Math.max(1, Math.abs(yClose - yOpen));
    candleEls += `<line class="wick ${cls}" x1="${cx.toFixed(1)}" y1="${yHigh.toFixed(1)}" x2="${cx.toFixed(1)}" y2="${yLow.toFixed(1)}"/>`;
    candleEls += `<rect class="${cls}" x="${x.toFixed(1)}" y="${top.toFixed(1)}" width="${candleW.toFixed(1)}" height="${bodyH.toFixed(1)}"/>`;
  });

  // current price marker
  const yNow = yScale(bar.price);
  const priceText = money(bar.price);
  const labelW = Math.max(40, priceText.length * 6 + 10);
  const priceLine = `
    <line class="price-line" x1="${padL}" y1="${yNow.toFixed(1)}" x2="${padL + innerW}" y2="${yNow.toFixed(1)}"/>
    <rect class="price-label-bg" x="${(padL + innerW + 2).toFixed(1)}" y="${(yNow - 8).toFixed(1)}" width="${labelW}" height="16" rx="3"/>
    <text class="price-label-text" x="${(padL + innerW + 6).toFixed(1)}" y="${(yNow + 4).toFixed(1)}">${priceText}</text>
  `;

  svg.innerHTML = grid + candleEls + priceLine;
}

/* ───── News / events ───── */
function renderNews(events) {
  const items = (events || []).slice(0, 4);
  document.querySelector("#newsList").innerHTML = items.length
    ? items.map((e) => `<div class="news-item"><span>${escapeHtml(e.message)}</span><small>${time(e.createdAt)}</small></div>`).join("")
    : `<div class="news-item"><span class="muted">No system events yet.</span></div>`;
}

/* ───── Signals / orders / strategy / model (preserved) ───── */
function renderSignals(signals) {
  const rows = signals.length ? signals.map((signal) => {
    const reasonCodes = signal.risk?.reasonCodes || [];
    const riskReason = reasonCodes.filter((reason) => reason !== "risk_approved").map(title).join(", ");
    return `
      <div class="row">
        <strong>${signal.symbol}</strong>
        <span>${title(signal.strategy)}</span>
        <span>${Math.round(signal.confidence * 100)}%</span>
        <span>${money(signal.entryPrice)}</span>
        <span class="risk-cell">
          <span class="${signal.risk.decision === "approved" ? "up" : "down"}">${title(signal.risk.decision)}</span>
          ${riskReason ? `<small>${escapeHtml(riskReason)}</small>` : ""}
        </span>
        <span>AI managed</span>
      </div>
    `;
  }).join("") : `
    <div class="row">
      <strong>No signals</strong>
      <span>Waiting for indicators</span>
      <span>-</span>
      <span>-</span>
      <span class="risk-cell"><span class="down">Unavailable</span><small>RSI / ATR bars are not ready</small></span>
      <span>Skipped</span>
    </div>
  `;
  document.querySelector("#signalsTable").innerHTML = `
    <div class="row header"><span>Symbol</span><span>Strategy</span><span>AI Score</span><span>Entry</span><span>Risk</span><span>Action</span></div>
    ${rows}
  `;
}

function renderPositions(positions) {
  const table = document.querySelector("#positionsTable");
  if (!table) return;
  table.innerHTML = positions.length ? `
    <div class="row portfolio-row header"><span>Symbol</span><span>Qty</span><span>Avg Entry</span><span>Current</span><span>Unrealized $</span><span>Unrealized %</span></div>
    ${positions.map((position) => `
      <div class="row portfolio-row">
        <strong>${position.symbol}</strong>
        <span>${position.qty}</span>
        <span>${money(position.avgEntryPrice)}</span>
        <span>${money(position.currentPrice)}</span>
        <span class="${position.unrealizedPnl >= 0 ? "up" : "down"}">${money(position.unrealizedPnl)}</span>
        <span class="${position.unrealizedPnlPct >= 0 ? "up" : "down"}">${percent(position.unrealizedPnlPct)}</span>
      </div>
    `).join("")}
  ` : `<p class="body-copy">No open Alpaca paper positions.</p>`;
}

function renderOpenTrades(positions) {
  const table = document.querySelector("#openTradesTable");
  if (!table) return;
  table.innerHTML = positions.length ? `
    <div class="row open-trade-row header"><span>Symbol</span><span>Side</span><span>Qty</span><span>Entry</span><span>Now</span><span>P&L</span></div>
    ${positions.map((position) => `
      <div class="row open-trade-row">
        <strong>${position.symbol}</strong>
        <span>${title(position.side)}</span>
        <span>${position.qty}</span>
        <span>${money(position.avgEntryPrice)}</span>
        <span>${money(position.currentPrice)}</span>
        <span class="${position.unrealizedPnl >= 0 ? "up" : "down"}">${money(position.unrealizedPnl)} (${percent(position.unrealizedPnlPct)})</span>
      </div>
    `).join("")}
  ` : `<p class="body-copy">No open Alpaca paper positions right now.</p>`;
}

function renderOrders(orders) {
  const mergedOrders = mergeOrders(readLocalOrders(), orders);
  document.querySelector("#ordersTable").innerHTML = mergedOrders.length ? `
    <div class="row order-row header"><span>Symbol</span><span>Side</span><span>Qty</span><span>Filled</span><span>Limit</span><span>Status</span><span>Created</span></div>
    ${mergedOrders.map((order) => `
      <div class="row order-row">
        <strong>${order.symbol}</strong><span>${order.side}</span><span>${order.qty}</span>
        <span>${order.filledQty || 0}</span><span>${money(order.limitPrice)}</span><span>${statusLabel(order)}</span><span>${time(order.createdAt)}</span>
      </div>
    `).join("")}
  ` : `<p class="body-copy">No paper orders yet. AI will add Alpaca paper orders here after submission.</p>`;
}

function renderLlmUsage() {
  const usage = state?.llmUsage || readLlmUsage();
  const totalCost = usage.reduce((sum, event) => sum + Number(event.costUsd || 0), 0);
  const totalTokens = usage.reduce((sum, event) => sum + Number(event.inputTokens || 0) + Number(event.outputTokens || 0), 0);
  const last = usage[0];
  setText("#llmTotalCost", moneyPrecise(totalCost));
  setText("#llmRequests", String(usage.length));
  setText("#llmTokens", new Intl.NumberFormat("en-US").format(totalTokens));
  setText("#llmLastCall", last ? time(last.createdAt) : "None");
  setText("#llmLastProvider", last ? `${last.provider} ${last.model}` : "No LLM calls yet");
  setText("#llmUsageCount", `${usage.length} events`);
  const list = document.querySelector("#llmUsageList");
  if (!list) return;
  list.innerHTML = usage.length ? usage.map((event) => `
    <article class="log-row">
      <span class="log-status">${escapeHtml(event.provider)}</span>
      <div>
        <strong>${escapeHtml(event.model)} ${moneyPrecise(event.costUsd)}</strong>
        <small>${time(event.createdAt)} | input ${event.inputTokens} | output ${event.outputTokens} | ${escapeHtml(event.reason)}</small>
      </div>
    </article>
  `).join("") : `<p class="body-copy">No LLM usage recorded. The current scorer is heuristic and does not call OpenAI or Claude yet.</p>`;
}

function renderRiskRules(risk) {
  document.querySelector("#riskRules").innerHTML = [
    ["Max risk per trade", `${risk.maxRiskPerTradePct}%`],
    ["Max daily loss", `${risk.maxDailyLossPct}%`],
    ["Max open positions", risk.maxOpenPositions],
    ["Max trades per hour", risk.maxTradesPerHour],
    ["Minimum reward/risk", `${risk.minRewardRisk}R`],
    ["Max spread", `${risk.maxSpreadPct}%`],
    ["AI cycle", `${risk.autoTradeIntervalSeconds || 30}s`],
    ["Scalping exits", risk.scalpingEnabled ? "Enabled" : "Disabled"],
    ["Hold window", `${risk.minHoldMinutes || 0}-${risk.maxHoldMinutes || 120}m`],
    ["Quick profit / stop", `${risk.quickProfitPct || 0.6}% / ${risk.quickStopPct || 0.3}%`]
  ].map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`).join("");
}

function renderModelBars(signals) {
  document.querySelector("#modelBars").innerHTML = signals.slice(0, 5).map((signal) => `
    <div class="bar">
      <div><strong>${signal.symbol}</strong> <span class="muted">${Math.round(signal.confidence * 100)}%</span></div>
      <div class="bar-track"><div class="bar-fill" style="width:${signal.confidence * 100}%"></div></div>
    </div>
  `).join("");
}

/* ───── Settings ───── */
let lastIntegrationsFingerprint = null;
let lastRiskSettingsFingerprint = null;

function renderSettings(integrations) {
  const grid = document.querySelector("#settingsGrid");
  if (grid.contains(document.activeElement)) return;
  const fingerprint = JSON.stringify(
    Object.entries(integrations).map(([key, integration]) => [
      key,
      integration.configured,
      integration.source,
      integration.updatedAt || null,
      integration.missing || [],
      integration.suffixes || {}
    ])
  );
  if (fingerprint === lastIntegrationsFingerprint) return;
  lastIntegrationsFingerprint = fingerprint;
  grid.innerHTML = Object.entries(integrations).map(([key, integration]) => {
    const configured = Boolean(integration.configured);
    const missing = integration.missing || [];
    const incomplete = !configured && missing.length > 0 && missing.length < (integration.required?.length || 1);
    const sourceLabel = configured
      ? (integration.source === "environment" ? "env" : "saved")
      : incomplete ? "incomplete" : "missing";
    const hint = configured
      ? `Saved server-side${integration.updatedAt ? ` · updated ${time(integration.updatedAt)}` : ""}`
      : incomplete
        ? `Missing field${missing.length === 1 ? "" : "s"}: ${missing.map(title).join(", ")}`
        : "Not configured yet";
    const fields = integration.required || integrationFields[key] || ["apiKey"];
    const suffixes = integration.suffixes || {};
    const canClear = integration.source !== "environment" && (configured || incomplete);
    return `
    <div class="setting-card">
      <label>${integration.label || title(key)}<span class="${configured ? "up" : "down"}">${sourceLabel}</span></label>
      ${fields.map((field) => `
        <input autocomplete="off" type="password" placeholder="${fieldPlaceholder(key, field, suffixes[field])}" data-integration="${key}" data-field="${field}">
      `).join("")}
      <small class="muted">${hint}</small>
      ${canClear ? `<button class="button secondary setting-clear" type="button" data-clear-integration="${key}">Clear ${escapeHtml(integration.label || title(key))}</button>` : ""}
    </div>
  `;
  }).join("");
}

function renderRiskSettings(settings) {
  const grid = document.querySelector("#riskSettingsGrid");
  if (!grid || grid.contains(document.activeElement) || !settings) return;
  const fingerprint = JSON.stringify(settings);
  if (fingerprint === lastRiskSettingsFingerprint) return;
  lastRiskSettingsFingerprint = fingerprint;

  const values = settings.values || {};
  const defaults = settings.defaults || {};
  const fields = settings.fields || {};
  grid.innerHTML = Object.entries(fields).map(([key, meta]) => {
    const value = values[key] ?? defaults[key] ?? "";
    const changed = Number(value) !== Number(defaults[key]);
    if (meta.type === "boolean") {
      const checked = Boolean(value);
      const defaultChecked = Boolean(defaults[key]);
      return `
        <div class="setting-card">
          <label>${escapeHtml(meta.label || title(key))}<span class="${checked !== defaultChecked ? "up" : "muted"}">${checked !== defaultChecked ? "custom" : "default"}</span></label>
          <label class="toggle-row"><input type="checkbox" ${checked ? "checked" : ""} data-risk-field="${key}"><span>${checked ? "Enabled" : "Disabled"}</span></label>
          <small class="muted">Default ${defaultChecked ? "enabled" : "disabled"}</small>
        </div>
      `;
    }
    return `
      <div class="setting-card">
        <label>${escapeHtml(meta.label || title(key))}<span class="${changed ? "up" : "muted"}">${changed ? "custom" : "default"}</span></label>
        <input type="number" inputmode="decimal" min="${meta.min}" max="${meta.max}" step="${meta.step}" value="${escapeHtml(value)}" data-risk-field="${key}">
        <small class="muted">Default ${escapeHtml(defaults[key] ?? "")}</small>
      </div>
    `;
  }).join("");
}

async function saveRiskSettings(event) {
  event.preventDefault();
  showRiskSettingsMessage("", "");
  const risk = {};
  document.querySelectorAll("[data-risk-field]").forEach((input) => {
    risk[input.dataset.riskField] = input.type === "checkbox" ? input.checked : input.value;
  });
  try {
    const result = await postJson("/api/settings/risk", { risk });
    riskSettingsState = result.risk;
    lastRiskSettingsFingerprint = null;
    renderRiskSettings(riskSettingsState);
    showRiskSettingsMessage("Risk controls saved. Future AI cycles use these limits.", "success");
  } catch (error) {
    showRiskSettingsMessage(`Could not save risk controls: ${error.message}`, "error");
  }
}

async function resetRiskSettings() {
  if (!riskSettingsState?.defaults) return;
  try {
    const result = await postJson("/api/settings/risk", { risk: riskSettingsState.defaults });
    riskSettingsState = result.risk;
    lastRiskSettingsFingerprint = null;
    renderRiskSettings(riskSettingsState);
    showRiskSettingsMessage("Risk controls reset to defaults.", "success");
  } catch (error) {
    showRiskSettingsMessage(`Could not reset risk controls: ${error.message}`, "error");
  }
}

async function saveSettings(event) {
  event.preventDefault();
  showSettingsMessage("", "");
  const integrations = {};
  document.querySelectorAll("[data-integration]").forEach((input) => {
    if (!input.value.trim()) return;
    integrations[input.dataset.integration] ||= {};
    integrations[input.dataset.integration][input.dataset.field] = input.value.trim();
  });
  if (!Object.keys(integrations).length) {
    showSettingsMessage("Enter at least one key before saving.", "error");
    return;
  }
  if (integrations.alpaca) {
    const current = integrationsState.alpaca || {};
    const provided = integrations.alpaca;
    const apiOk = Boolean(provided.apiKey) || (current.configured && !(current.missing || []).includes("apiKey"));
    const secretOk = Boolean(provided.secretKey) || (current.configured && !(current.missing || []).includes("secretKey"));
    if (!apiOk || !secretOk) {
      showSettingsMessage("Alpaca needs both API Key ID and Secret Key.", "error");
      return;
    }
  }
  try {
    await postJson("/api/settings/integrations", { integrations });
    event.target.reset();
    await refreshSettingsPanels();
    showSettingsMessage("Keys saved to Postgres.", "success");
  } catch (error) {
    showSettingsMessage(`Could not save keys: ${error.message}`, "error");
  }
}

async function clearSavedKeys() {
  if (!confirm("Remove all integration keys from the server?")) return;
  try {
    await deleteJson("/api/settings/integrations", { integrations: [] });
    await refreshSettingsPanels();
    showSettingsMessage("Saved keys cleared from server.", "success");
  } catch (error) {
    showSettingsMessage(`Could not clear keys: ${error.message}`, "error");
  }
}

async function handleSettingsGridClick(event) {
  const button = event.target.closest("[data-clear-integration]");
  if (!button) return;
  const integration = button.dataset.clearIntegration;
  const label = integrationsState[integration]?.label || title(integration);
  if (!confirm(`Remove saved ${label} key${integration === "alpaca" ? "s" : ""} from the server?`)) return;
  try {
    await deleteJson("/api/settings/integrations", { integrations: [integration] });
    await refreshSettingsPanels();
    showSettingsMessage(`${label} keys cleared from server.`, "success");
  } catch (error) {
    showSettingsMessage(`Could not clear ${label}: ${error.message}`, "error");
  }
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(await responseErrorMessage(response));
  return readJsonResponse(response);
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(await responseErrorMessage(response));
  return readJsonResponse(response);
}

async function deleteJson(url, body) {
  const response = await fetch(url, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {})
  });
  if (!response.ok) throw new Error(await responseErrorMessage(response));
  return readJsonResponse(response);
}

async function readJsonResponse(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Expected JSON response but received ${text.slice(0, 80)}`);
  }
}

async function responseErrorMessage(response) {
  const text = await response.text();
  try {
    const body = JSON.parse(text);
    return body.error || text || response.statusText;
  } catch {
    return text || response.statusText;
  }
}

async function maybeRunAutoTrade() {
  if (!state?.risk?.alpacaConfigured) {
    logAiActivity("waiting", "Alpaca keys are not configured. Save them in Settings before AI can trade.", {});
    return;
  }
  if (isAutoPaused() || state?.risk?.killSwitch) {
    logAiActivity("paused", "Pause button is active. AI cycle skipped.", {});
    return;
  }
  if (autoTradeInFlight) {
    logAiActivity("waiting", "AI cycle already running.", {});
    return;
  }
  const intervalSeconds = Number(state?.risk?.autoTradeIntervalSeconds || 30);
  const autoTradeIntervalMs = Math.max(10, intervalSeconds) * 1000;
  const waitMs = autoTradeIntervalMs - (Date.now() - lastAutoTradeAt);
  if (waitMs > 0) {
    setAiTraderStatus("Cooldown", `Next AI cycle in ${Math.ceil(waitMs / 1000)}s`);
    return;
  }
  autoTradeInFlight = true;
  lastAutoTradeAt = Date.now();
  logAiActivity("running", "AI cycle started. Scoring signals and checking risk.", {});
  try {
    const result = await postJson("/api/auto-trade", {});
    if (result.status === "submitted" && result.order) saveLocalOrder(result.order);
    logAiActivity(result.status, describeAutoTradeResult(result), result);
    if (result.status === "submitted") {
      await refresh();
    }
  } catch (error) {
    logAiActivity("blocked", `AI auto trader blocked: ${error.message}`, {});
    showSettingsMessage(`AI auto trader blocked: ${error.message}`, "error");
  } finally {
    autoTradeInFlight = false;
  }
}

function logAiActivity(status, message, details) {
  const last = aiLogs[0];
  if (status === "paused" && message === "Pause button is active. AI cycle skipped." && aiLogs.some((log) => log.status === status && log.message === message)) {
    setAiTraderStatus(title(status), message);
    return;
  }
  if (last?.status === status && last?.message === message && Date.now() - Date.parse(last.createdAt) < 15000) {
    setAiTraderStatus(title(status), message);
    return;
  }
  aiLogs.unshift({
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    createdAt: new Date().toISOString(),
    status,
    message,
    details
  });
  aiLogs.splice(80);
  saveAiLogs();
  setAiTraderStatus(title(status), message);
  renderAiLogs();
}

function readAiLogs() {
  try {
    return JSON.parse(localStorage.getItem(aiLogsKey()) || "[]");
  } catch {
    return [];
  }
}

function saveAiLogs() {
  localStorage.setItem(aiLogsKey(), JSON.stringify(aiLogs));
}

function aiLogsKey() {
  return "dpTraderAiLogs";
}

function describeAutoTradeResult(result) {
  if (result.status === "submitted") {
    const order = result.order || {};
    return `Submitted ${order.symbol || "paper"} order to Alpaca; waiting for fill. AI ${Math.round((result.ai?.probabilityOfSuccess || 0) * 100)}%, ${order.qty || result.risk?.shares || 0} shares at limit ${money(order.limitPrice)}.`;
  }
  if (result.status === "exit_submitted") {
    return `Scalping exit submitted for ${result.symbol}: ${title(result.reason)}. Held ${result.ageMinutes || 0}m, P/L ${((result.pnlPct || 0) * 100).toFixed(2)}%.`;
  }
  if (result.status === "no_trade") {
    const rejected = Array.isArray(result.rejected) && result.rejected.length ? ` ${result.rejected.join("; ")}.` : "";
    const threshold = result.reason === "ai_rejected_all_candidates" && result.minAutoConfidence
      ? ` AI threshold ${Math.round(result.minAutoConfidence * 100)}%.`
      : "";
    const label = result.reason === "ai_rejected_all_candidates" ? "LLM rejected all approved candidates" : title(result.reason || "no approved signal");
    return `No trade submitted: ${label}.${threshold}${rejected}`;
  }
  if (result.status === "paused") return "AI cycle skipped because trading is paused.";
  if (result.status === "blocked") return `AI blocked: ${result.error || "unknown error"}.`;
  return `AI cycle finished with status ${result.status}.`;
}

function statusLabel(order) {
  if ((order.filledQty || 0) > 0) return `${order.status} (${order.filledQty} filled)`;
  if (["new", "accepted", "pending_new", "held"].includes(order.status)) return `${order.status} (waiting)`;
  if (order.status === "canceled") return "canceled (no fill)";
  return order.status || "unknown";
}

function saveLocalOrder(order) {
  const orders = mergeOrders([order], readLocalOrders()).slice(0, 50);
  localStorage.setItem(localOrdersKey, JSON.stringify(orders));
}

function readLocalOrders() {
  try {
    return JSON.parse(localStorage.getItem(localOrdersKey) || "[]");
  } catch {
    return [];
  }
}

function mergeOrders(primary, secondary) {
  const byId = new Map();
  [...primary, ...secondary].forEach((order) => {
    if (!order) return;
    byId.set(order.id || order.clientOrderId || `${order.symbol}-${order.createdAt}`, order);
  });
  return [...byId.values()].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}

function readLlmUsage() {
  try {
    return JSON.parse(localStorage.getItem(llmUsageKey) || "[]");
  } catch {
    return [];
  }
}

function renderAiLogs() {
  const list = document.querySelector("#aiLogList");
  if (!list) return;
  setText("#logCount", `${aiLogs.length} events`);
  list.innerHTML = aiLogs.length ? aiLogs.map((log) => `
    <article class="log-row">
      <span class="log-status ${statusClass(log.status)}">${title(log.status)}</span>
      <div>
        <strong>${escapeHtml(log.message)}</strong>
        <small>${time(log.createdAt)}${orderLogMeta(log)}</small>
      </div>
    </article>
  `).join("") : `<p class="body-copy">No AI cycles logged yet. Unlock Alpaca keys and leave the app open.</p>`;
}

function orderLogMeta(log) {
  const order = log.details?.order;
  if (!order) return "";
  return ` | ${escapeHtml(order.symbol)} ${escapeHtml(order.side)} ${order.qty} @ ${money(order.limitPrice)} | ${escapeHtml(statusLabel(order))} | Order ${escapeHtml(order.id)}`;
}

function setAiTraderStatus(status, detail) {
  setText("#aiTraderState", status);
  setText("#aiTraderDetail", detail);
}

function statusClass(status) {
  if (status === "submitted") return "success";
  if (status === "blocked") return "error";
  if (status === "paused" || status === "waiting" || status === "no_trade") return "warn";
  return "";
}

function isAutoPaused() {
  return localStorage.getItem(localPauseKey) === "true";
}

function fieldPlaceholder(key, field, suffix) {
  if (suffix) return `${fieldLabel(key, field)} - saved ending ${suffix}`;
  return fieldLabel(key, field);
}

function fieldLabel(key, field) {
  if (key === "alpaca" && field === "apiKey") return "Alpaca API Key ID";
  if (key === "alpaca" && field === "secretKey") return "Alpaca Secret Key";
  return title(field);
}

function showSettingsMessage(message, type) {
  const element = document.querySelector("#settingsMessage");
  if (!element) return;
  element.textContent = message;
  element.className = `settings-message ${type || ""}`.trim();
}

function showRiskSettingsMessage(message, type) {
  const element = document.querySelector("#riskSettingsMessage");
  if (!element) return;
  element.textContent = message;
  element.className = `settings-message ${type || ""}`.trim();
}

function setText(selector, value) {
  const element = document.querySelector(selector);
  if (element) element.textContent = value;
}

function startLoading(label, detail) {
  loadingPercent = 4;
  document.body.classList.remove("loading-error");
  document.body.classList.add("loading-active");
  setLoadingText(label, detail);
  paintLoading();
  clearInterval(loadingTimer);
  loadingTimer = setInterval(() => {
    if (loadingPercent >= 92) return;
    const increment = loadingPercent < 55 ? 7 : loadingPercent < 78 ? 4 : 2;
    loadingPercent = Math.min(92, loadingPercent + increment);
    paintLoading();
  }, 350);
}

function setLoadingProgress(percentValue, detail) {
  loadingPercent = Math.max(loadingPercent, Math.min(99, Math.round(percentValue)));
  setLoadingText(null, detail);
  paintLoading();
}

function finishLoading() {
  clearInterval(loadingTimer);
  loadingTimer = null;
  loadingPercent = 100;
  setLoadingText("Dashboard ready", "Latest data loaded");
  paintLoading();
  setTimeout(() => {
    document.body.classList.remove("loading-active", "loading-error");
  }, 250);
}

function failLoading(message) {
  clearInterval(loadingTimer);
  loadingTimer = null;
  document.body.classList.add("loading-error");
  setLoadingText("Could not load dashboard", message || "Refresh failed");
  paintLoading();
}

function setLoadingText(label, detail) {
  if (label) setText("#loadingLabel", label);
  if (detail) setText("#loadingDetail", detail);
}

function paintLoading() {
  setText("#loadingPercent", `${loadingPercent}%`);
  const fill = document.querySelector("#loadingFill");
  if (fill) fill.style.width = `${loadingPercent}%`;
}

function money(value) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value || 0);
}
function moneyPrecise(value) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 4, maximumFractionDigits: 4 }).format(value || 0);
}
function percent(value) {
  return `${((value || 0) * 100).toFixed(2)}%`;
}
function time(value) {
  return new Intl.DateTimeFormat([], { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}
function title(value) {
  return String(value).replace(/_/g, " ").replace(/([A-Z])/g, " $1").replace(/\b\w/g, (char) => char.toUpperCase()).trim();
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function safeRefresh(options = {}) {
  refresh(options).catch((error) => {
    setAiTraderStatus("Connection", error.message);
  });
}

showPage(location.hash.slice(1) || localStorage.getItem(activePageKey) || "markets");
window.addEventListener("hashchange", () => showPage(location.hash.slice(1) || "markets"));
safeRefresh();
setInterval(safeRefresh, 5000);

/* ───── Trade History / Reporting ───── */
async function refreshHistory({ force = false } = {}) {
  if (historyInFlight) return historyInFlight;
  if (!force && historyState && historyState.rangeDays === historyRangeDays) {
    renderHistory(historyState);
    return historyState;
  }
  setText("#historyGeneratedAt", "Loading report...");
  historyInFlight = fetchJson(`/api/history?rangeDays=${historyRangeDays}`)
    .then((data) => {
      historyState = data;
      renderHistory(data);
      return data;
    })
    .catch((error) => {
      setText("#historyGeneratedAt", `Could not load report: ${error.message}`);
      throw error;
    })
    .finally(() => {
      historyInFlight = null;
    });
  return historyInFlight;
}

function renderHistory(data) {
  const summary = data.summary || {};
  const netPnl = Number(summary.netPnl || 0);
  const netEl = document.querySelector("#hsNetPnl");
  if (netEl) {
    netEl.textContent = money(netPnl);
    netEl.classList.toggle("up", netPnl > 0);
    netEl.classList.toggle("down", netPnl < 0);
  }
  const winRate = Number(summary.winRate || 0);
  setText("#hsWinRate", `${Math.round(winRate * 100)}%`);
  setText("#hsWinRateMeta", `${summary.wins || 0}W / ${summary.losses || 0}L`);
  setText("#hsProfitFactor", summary.profitFactor == null
    ? "∞"
    : Number(summary.profitFactor).toFixed(2));
  setText("#hsProfitFactorMeta", summary.grossProfit != null
    ? `${money(summary.grossProfit)} profit vs ${money(summary.grossLoss)} loss`
    : "Gross profit vs gross loss");
  setText("#hsAvgWinLoss", `${money(summary.avgWin || 0)} / ${money(-(summary.avgLoss || 0))}`);
  setText("#hsAvgWinLossMeta", `${summary.totalFills || 0} fills tracked`);
  setText("#hsTotalTrades", String(summary.totalTrades || 0));
  setText("#hsAvgHold", summary.totalTrades
    ? `Avg hold ${formatMinutes(summary.avgHoldMinutes || 0)}`
    : "No closed trades yet");
  setText("#hsNetPnlMeta", summary.firstTradeAt
    ? `${dateShort(summary.firstTradeAt)} → ${dateShort(summary.lastTradeAt)}`
    : "No closed trades yet");

  setText("#historyGeneratedAt", data.generatedAt
    ? `Updated ${time(data.generatedAt)} · ${data.rangeDays}d window`
    : `${data.rangeDays}d window`);
  setText("#hsEquityMeta", data.equityCurve?.length
    ? `${data.equityCurve.length} points · ${dateShort(data.equityCurve[0].at)} → ${dateShort(data.equityCurve.at(-1).at)}`
    : "No equity history yet");
  setText("#hsDailyMeta", `Last ${data.rangeDays} sessions`);

  renderEquityChart(data.equityCurve || []);
  renderDailyPnlChart(data.dailyPnl || []);
  renderHistoryDonut(summary);
  renderSymbolBars(data.symbolStats || []);
  renderHistoryTable();
}

function renderEquityChart(points) {
  const svg = document.querySelector("#historyEquityChart");
  if (!svg) return;
  const W = 1000, H = 320;
  const padL = 50, padR = 18, padT = 18, padB = 26;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  if (!points.length) {
    svg.innerHTML = emptyChartMarkup(W, H, "Equity data starts appearing as snapshots accumulate");
    return;
  }
  const values = points.map((point) => Number(point.equity));
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (lo === hi) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * 0.08;
  const yMin = lo - pad;
  const yMax = hi + pad;
  const xs = points.map((point, i) => padL + (i * innerW) / Math.max(1, points.length - 1));
  const ys = points.map((point) => padT + (1 - (Number(point.equity) - yMin) / (yMax - yMin)) * innerH);
  let pathD = "";
  for (let i = 0; i < points.length; i++) {
    pathD += `${i === 0 ? "M" : "L"}${xs[i].toFixed(1)},${ys[i].toFixed(1)} `;
  }
  const areaD = `${pathD}L${xs.at(-1).toFixed(1)},${(padT + innerH).toFixed(1)} L${xs[0].toFixed(1)},${(padT + innerH).toFixed(1)} Z`;
  const gridLines = 4;
  let grid = "";
  for (let i = 0; i <= gridLines; i++) {
    const y = padT + (innerH * i) / gridLines;
    const value = yMax - ((yMax - yMin) * i) / gridLines;
    grid += `<line class="grid-line" x1="${padL}" y1="${y.toFixed(1)}" x2="${(padL + innerW).toFixed(1)}" y2="${y.toFixed(1)}"/>`;
    grid += `<text class="axis-label" x="${(padL - 6).toFixed(1)}" y="${(y + 3).toFixed(1)}" text-anchor="end">${money(value)}</text>`;
  }
  const xLabelCount = Math.min(6, points.length);
  let xAxis = "";
  for (let i = 0; i < xLabelCount; i++) {
    const idx = Math.round((i * (points.length - 1)) / Math.max(1, xLabelCount - 1));
    const x = xs[idx];
    xAxis += `<text class="axis-label" x="${x.toFixed(1)}" y="${(padT + innerH + 14).toFixed(1)}" text-anchor="middle">${dateShort(points[idx].at)}</text>`;
  }
  const defs = `
    <defs>
      <linearGradient id="equityStroke" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#1ec479"/>
        <stop offset="100%" stop-color="#2962ff"/>
      </linearGradient>
      <linearGradient id="equityFill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#1ec479" stop-opacity=".45"/>
        <stop offset="100%" stop-color="#1ec479" stop-opacity="0"/>
      </linearGradient>
    </defs>`;
  const startEquity = Number(points[0].equity);
  const yBase = padT + (1 - (startEquity - yMin) / (yMax - yMin)) * innerH;
  const baseline = `<line class="equity-baseline" x1="${padL}" y1="${yBase.toFixed(1)}" x2="${(padL + innerW).toFixed(1)}" y2="${yBase.toFixed(1)}"/>`;
  svg.innerHTML = `${defs}${grid}<path class="equity-fill" d="${areaD}"/><path class="equity-line" d="${pathD}"/>${baseline}${xAxis}`;
}

function renderDailyPnlChart(days) {
  const svg = document.querySelector("#historyDailyChart");
  if (!svg) return;
  const W = 1000, H = 280;
  const padL = 50, padR = 18, padT = 18, padB = 28;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  if (!days.length) {
    svg.innerHTML = emptyChartMarkup(W, H, "Daily P&L populates after the first closed trade");
    return;
  }
  const values = days.map((day) => Number(day.pnl));
  const maxAbs = Math.max(1, ...values.map(Math.abs));
  const yMin = -maxAbs * 1.1;
  const yMax = maxAbs * 1.1;
  const yScale = (value) => padT + (1 - (value - yMin) / (yMax - yMin)) * innerH;
  const zeroY = yScale(0);
  const stepX = innerW / days.length;
  const barW = Math.max(3, stepX * 0.62);
  const gridLines = 4;
  let grid = "";
  for (let i = 0; i <= gridLines; i++) {
    const y = padT + (innerH * i) / gridLines;
    const value = yMax - ((yMax - yMin) * i) / gridLines;
    grid += `<line class="grid-line" x1="${padL}" y1="${y.toFixed(1)}" x2="${(padL + innerW).toFixed(1)}" y2="${y.toFixed(1)}"/>`;
    grid += `<text class="axis-label" x="${(padL - 6).toFixed(1)}" y="${(y + 3).toFixed(1)}" text-anchor="end">${moneyCompact(value)}</text>`;
  }
  let bars = "";
  days.forEach((day, i) => {
    const x = padL + i * stepX + (stepX - barW) / 2;
    const value = Number(day.pnl);
    const yTop = yScale(Math.max(0, value));
    const yBottom = yScale(Math.min(0, value));
    const height = Math.max(1, Math.abs(yBottom - yTop));
    const cls = value > 0 ? "bar-positive" : value < 0 ? "bar-negative" : "bar-empty";
    bars += `<rect class="${cls}" x="${x.toFixed(1)}" y="${yTop.toFixed(1)}" width="${barW.toFixed(1)}" height="${height.toFixed(1)}" rx="2"><title>${dateShort(day.date)}: ${money(value)} · ${day.trades} trades</title></rect>`;
  });
  const xLabelCount = Math.min(7, days.length);
  let xAxis = "";
  for (let i = 0; i < xLabelCount; i++) {
    const idx = Math.round((i * (days.length - 1)) / Math.max(1, xLabelCount - 1));
    const x = padL + idx * stepX + stepX / 2;
    xAxis += `<text class="axis-label" x="${x.toFixed(1)}" y="${(padT + innerH + 16).toFixed(1)}" text-anchor="middle">${dateShort(days[idx].date)}</text>`;
  }
  const baseline = `<line class="axis-baseline" x1="${padL}" y1="${zeroY.toFixed(1)}" x2="${(padL + innerW).toFixed(1)}" y2="${zeroY.toFixed(1)}"/>`;
  svg.innerHTML = `${grid}${bars}${baseline}${xAxis}`;
}

function renderHistoryDonut(summary) {
  const svg = document.querySelector("#historyDonut");
  if (!svg) return;
  const wins = Number(summary.wins || 0);
  const losses = Number(summary.losses || 0);
  const total = wins + losses;
  const winRate = total > 0 ? wins / total : 0;
  const cx = 80, cy = 80, r = 64;
  const circumference = 2 * Math.PI * r;
  const winLen = total ? (wins / total) * circumference : 0;
  const lossLen = total ? (losses / total) * circumference : 0;
  svg.innerHTML = `
    <circle class="donut-bg" cx="${cx}" cy="${cy}" r="${r}"/>
    ${total ? `
      <circle class="donut-seg win"
        cx="${cx}" cy="${cy}" r="${r}"
        stroke-dasharray="${winLen.toFixed(2)} ${(circumference - winLen).toFixed(2)}"
        transform="rotate(-90 ${cx} ${cy})"/>
      <circle class="donut-seg loss"
        cx="${cx}" cy="${cy}" r="${r}"
        stroke-dasharray="${lossLen.toFixed(2)} ${(circumference - lossLen).toFixed(2)}"
        stroke-dashoffset="${(-winLen).toFixed(2)}"
        transform="rotate(-90 ${cx} ${cy})"/>
    ` : ""}
    <text class="donut-center-rate" x="${cx}" y="${cy + 4}">${total ? Math.round(winRate * 100) + "%" : "—"}</text>
    <text class="donut-center-label" x="${cx}" y="${cy + 22}">Win rate</text>
  `;
  const legend = document.querySelector("#historyDonutLegend");
  if (legend) {
    legend.innerHTML = `
      <div class="legend-row"><span><span class="dot win"></span>Wins</span><strong>${wins} · ${money(summary.grossProfit || 0)}</strong></div>
      <div class="legend-row"><span><span class="dot loss"></span>Losses</span><strong>${losses} · ${money(-(summary.grossLoss || 0))}</strong></div>
      <div class="legend-row"><span class="muted">Best trade</span><strong>${summary.bestTrade ? money(summary.bestTrade.pnl) + " · " + summary.bestTrade.symbol : "—"}</strong></div>
      <div class="legend-row"><span class="muted">Worst trade</span><strong>${summary.worstTrade ? money(summary.worstTrade.pnl) + " · " + summary.worstTrade.symbol : "—"}</strong></div>
    `;
  }
  const donutMeta = document.querySelector("#hsDonutMeta");
  if (donutMeta) {
    donutMeta.textContent = total ? `${total} closed trades` : "No closed trades yet";
  }
}

function renderSymbolBars(symbolStats) {
  const container = document.querySelector("#historySymbolBars");
  if (!container) return;
  if (!symbolStats.length) {
    container.innerHTML = `<div class="symbol-empty">No symbol performance yet. Trades will roll up here after they close.</div>`;
    setText("#hsSymbolMeta", "Top symbols by net P&L");
    return;
  }
  const top = symbolStats.slice(0, 8);
  const maxAbs = Math.max(1, ...top.map((entry) => Math.abs(entry.netPnl)));
  container.innerHTML = top.map((entry) => {
    const negative = entry.netPnl < 0;
    const widthPct = Math.max(4, Math.min(100, (Math.abs(entry.netPnl) / maxAbs) * 100));
    return `
      <div class="symbol-bar ${negative ? "is-negative" : ""}">
        <div class="symbol-head">
          <strong>${escapeHtml(entry.symbol)}</strong>
          <small>${entry.trades} trades · ${Math.round((entry.winRate || 0) * 100)}% win</small>
        </div>
        <div class="symbol-track"><div class="symbol-fill" style="width:${widthPct.toFixed(1)}%"></div></div>
        <div class="symbol-head">
          <span class="muted">${money(entry.volume)} traded</span>
          <strong class="${negative ? "down" : "up"}">${money(entry.netPnl)}</strong>
        </div>
      </div>
    `;
  }).join("");
  setText("#hsSymbolMeta", `${symbolStats.length} symbols · top ${top.length}`);
}

function renderHistoryTable() {
  const list = document.querySelector("#historyTradesTable");
  if (!list) return;
  const trades = historyState?.closedTrades || [];
  const filtered = trades.filter((trade) => {
    if (historyOutcomeFilter !== "all" && trade.outcome !== historyOutcomeFilter) return false;
    if (!historySearchTerm) return true;
    const haystack = `${trade.symbol} ${trade.direction}`.toLowerCase();
    return haystack.includes(historySearchTerm);
  });
  setText("#historyTradeCount", `${filtered.length} of ${trades.length} trades`);
  if (!trades.length) {
    list.innerHTML = `
      <div class="history-row header"><span>Symbol</span><span>Direction</span><span>Qty</span><span>Entry</span><span>Exit</span><span>P&L</span><span>Hold</span><span>Closed</span></div>
      <div class="history-empty">No closed trades yet. Filled orders are paired FIFO to form closed trades.</div>
    `;
    return;
  }
  list.innerHTML = `
    <div class="history-row header"><span>Symbol</span><span>Direction</span><span>Qty</span><span>Entry</span><span>Exit</span><span>P&amp;L</span><span>Hold</span><span>Closed</span></div>
    ${filtered.length ? filtered.slice(0, 250).map((trade) => `
      <div class="history-row">
        <strong>${escapeHtml(trade.symbol)}</strong>
        <span><span class="direction-pill ${trade.direction}">${trade.direction}</span></span>
        <span>${formatQty(trade.qty)}</span>
        <span>${money(trade.entryPrice)}</span>
        <span>${money(trade.exitPrice)}</span>
        <span><span class="outcome-pill ${trade.outcome}">${money(trade.pnl)} · ${percent(trade.returnPct)}</span></span>
        <span>${formatMinutes(trade.holdMinutes)}</span>
        <span>${dateTimeShort(trade.exitAt)}</span>
      </div>
    `).join("") : `<div class="history-empty">No trades match your filter.</div>`}
  `;
}

function exportHistoryCsv() {
  const trades = historyState?.closedTrades || [];
  if (!trades.length) {
    setText("#historyGeneratedAt", "Nothing to export yet.");
    return;
  }
  const header = ["symbol", "direction", "qty", "entry_price", "exit_price", "pnl", "return_pct", "hold_minutes", "entry_at", "exit_at", "outcome"];
  const rows = trades.map((trade) => [
    trade.symbol,
    trade.direction,
    trade.qty,
    trade.entryPrice,
    trade.exitPrice,
    trade.pnl,
    trade.returnPct,
    trade.holdMinutes,
    trade.entryAt,
    trade.exitAt,
    trade.outcome
  ]);
  const csv = [header, ...rows]
    .map((row) => row.map((cell) => csvCell(cell)).join(","))
    .join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `dp-trader-history-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function csvCell(value) {
  if (value == null) return "";
  const str = String(value);
  if (/[",\r\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function emptyChartMarkup(width, height, message) {
  return `<text class="axis-label" x="${width / 2}" y="${height / 2}" text-anchor="middle">${escapeHtml(message)}</text>`;
}

function formatMinutes(minutes) {
  const value = Number(minutes) || 0;
  if (value < 60) return `${value}m`;
  const hours = Math.floor(value / 60);
  const rest = value % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

function formatQty(value) {
  if (!Number.isFinite(Number(value))) return "—";
  const num = Number(value);
  return Number.isInteger(num) ? String(num) : num.toFixed(2);
}

function dateShort(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat([], { month: "short", day: "numeric" }).format(date);
}

function dateTimeShort(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(date);
}

function moneyCompact(value) {
  const num = Number(value) || 0;
  if (Math.abs(num) >= 1000) {
    return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1, style: "currency", currency: "USD" }).format(num);
  }
  return money(num);
}

function priceFlashClass(bar) {
  const previous = previousPrices.get(bar.symbol);
  if (previous === undefined || previous === bar.price) return "";
  return bar.price > previous ? "flash-up" : "flash-down";
}
