const pages = [...document.querySelectorAll(".page")];
const navItems = [...document.querySelectorAll(".nav-item")];
let state = null;
let unlockedIntegrations = {};
let vaultUnlocked = false;
const vaultKey = "dpTraderEncryptedIntegrations";

let selectedSymbol = null;
let activeFilter = "popular";
let activeInterval = "15m";
let autoTradeInFlight = false;
let lastAutoTradeAt = 0;
const autoTradeIntervalMs = 60 * 1000;
const previousPrices = new Map();
const aiLogs = [];
const activePageKey = "dpTraderActivePage";

const integrationFields = {
  alpaca: ["apiKey", "secretKey"],
  openai: ["apiKey"],
  anthropic: ["apiKey"],
  polygon: ["apiKey"],
  finnhub: ["apiKey"],
  twelveData: ["apiKey"],
  alphaVantage: ["apiKey"]
};

const integrationRequirements = {
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
document.querySelector("#refreshButton").addEventListener("click", refresh);
document.querySelector("#killSwitchButton").addEventListener("click", async () => {
  await postJson("/api/kill-switch", { enabled: !state?.risk?.killSwitch });
  await refresh();
});
document.querySelector("#settingsForm").addEventListener("submit", saveSettings);
document.querySelector("#unlockVaultButton").addEventListener("click", unlockVault);
document.querySelector("#clearVaultButton").addEventListener("click", clearVault);

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
}

async function refresh() {
  const [appState, settings] = await Promise.all([
    fetchJson("/api/state"),
    fetchJson("/api/settings/integrations")
  ]);
  state = appState;
  renderState(appState);
  renderSettings(settings.integrations);
  maybeRunAutoTrade();
}

function renderState(data) {
  setText("#equity", money(data.account.equity));
  setText("#accountChipEquity", money(data.account.equity));
  setText("#dayPnl", money(data.account.dayPnl));
  document.querySelector("#dayPnl").className = data.account.dayPnl >= 0 ? "up" : "down";
  setText("#openPositions", String(data.positions.length));
  setText("#accountSource", `${data.account.source} account`);
  setText("#lastTick", time(new Date()));
  setText("#riskState", data.risk.killSwitch ? "Paused" : "Ready");
  setText("#riskLimits", `${data.risk.maxRiskPerTradePct}% risk/trade, ${data.risk.maxDailyLossPct}% daily stop`);
  setText("#modeLabel", data.risk.tradingMode.toUpperCase());

  const liveGuard = document.querySelector("#liveGuard");
  liveGuard.textContent = data.risk.liveTradingArmed ? "Live armed" : "Live blocked";
  liveGuard.className = data.risk.liveTradingArmed ? "pill danger-pill" : "pill safe";

  const killButton = document.querySelector("#killSwitchButton");
  killButton.classList.toggle("active", data.risk.killSwitch);
  killButton.title = data.risk.killSwitch ? "Resume paper trading" : "Pause trading";
  if (tradeButton) tradeButton.textContent = data.risk.killSwitch ? "AI Auto Paused" : "AI Auto Active";
  renderAiLogs();

  renderWatchlist(data.market);
  renderSignals(data.signals);
  renderOrders(data.orders);
  renderNews(data.events);
  renderRiskRules(data.risk);
  renderModelBars(data.signals);
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
  document.querySelector("#signalsTable").innerHTML = `
    <div class="row header"><span>Symbol</span><span>Strategy</span><span>AI Score</span><span>Entry</span><span>Risk</span><span>Action</span></div>
    ${signals.map((signal) => `
      <div class="row">
        <strong>${signal.symbol}</strong>
        <span>${title(signal.strategy)}</span>
        <span>${Math.round(signal.confidence * 100)}%</span>
        <span>${money(signal.entryPrice)}</span>
        <span class="${signal.risk.decision === "approved" ? "up" : "down"}">${title(signal.risk.decision)}</span>
        <span>AI managed</span>
      </div>
    `).join("")}
  `;
}

function renderOrders(orders) {
  document.querySelector("#ordersTable").innerHTML = orders.length ? `
    <div class="row header"><span>Symbol</span><span>Side</span><span>Qty</span><span>Limit</span><span>Status</span><span>Created</span></div>
    ${orders.map((order) => `
      <div class="row">
        <strong>${order.symbol}</strong><span>${order.side}</span><span>${order.qty}</span>
        <span>${money(order.limitPrice)}</span><span>${order.status}</span><span>${time(order.createdAt)}</span>
      </div>
    `).join("")}
  ` : `<p class="body-copy">No paper orders yet. Approved signals can be simulated from Live Signals.</p>`;
}

function renderRiskRules(risk) {
  document.querySelector("#riskRules").innerHTML = [
    ["Max risk per trade", `${risk.maxRiskPerTradePct}%`],
    ["Max daily loss", `${risk.maxDailyLossPct}%`],
    ["Max open positions", risk.maxOpenPositions],
    ["Max trades per hour", risk.maxTradesPerHour],
    ["Minimum reward/risk", `${risk.minRewardRisk}R`],
    ["Max spread", `${risk.maxSpreadPct}%`]
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

/* ───── Settings (preserved) ───── */
function renderSettings(integrations) {
  const grid = document.querySelector("#settingsGrid");
  const saved = Boolean(localStorage.getItem(vaultKey));
  const vaultStatus = document.querySelector("#vaultStatus");
  vaultStatus.textContent = vaultUnlocked ? "Unlocked" : saved ? "Saved locked vault" : "No saved vault";
  vaultStatus.className = vaultUnlocked ? "pill safe" : "pill danger-pill";
  grid.innerHTML = Object.entries(integrations).map(([key, integration]) => {
    const local = localIntegrationStatus(key);
    const configured = local.configured || integration.configured;
    const source = local.configured ? "browser" : integration.source;
    const hint = local.missing.length ? `Missing ${local.missing.map(title).join(", ")}` : "Ready when vault is unlocked";
    return `
    <div class="setting-card">
      <label>${integration.label}<span class="${configured ? "up" : "down"}">${source}</span></label>
      ${(integrationFields[key] || ["apiKey"]).map((field) => `
        <input autocomplete="off" type="password" placeholder="${fieldPlaceholder(key, field)}" data-integration="${key}" data-field="${field}">
      `).join("")}
      <small class="muted">${hint}</small>
    </div>
  `;
  }).join("");
}

async function saveSettings(event) {
  event.preventDefault();
  showSettingsMessage("", "");
  const passphrase = document.querySelector("#vaultPassphrase").value;
  if (!passphrase) {
    showSettingsMessage("Enter a vault passphrase before saving keys.", "error");
    return;
  }
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
  const nextIntegrations = mergeSecrets(unlockedIntegrations, integrations);
  if (integrations.alpaca && (!nextIntegrations.alpaca?.apiKey || !nextIntegrations.alpaca?.secretKey)) {
    showSettingsMessage("Alpaca needs both API Key ID and Secret Key. Enter both fields before saving Alpaca.", "error");
    return;
  }
  try {
    unlockedIntegrations = nextIntegrations;
    const savedMode = await saveBrowserVault(passphrase, unlockedIntegrations);
    vaultUnlocked = true;
    event.target.reset();
    document.querySelector("#vaultPassphrase").value = passphrase;
    await refresh();
    showSettingsMessage(savedMode === "encrypted" ? "Saved to encrypted browser vault." : "Saved to browser vault. This browser does not support encrypted storage here.", "success");
  } catch (error) {
    showSettingsMessage(`Could not save keys: ${error.message}`, "error");
  }
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: credentialHeaders() });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...credentialHeaders() },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

async function unlockVault() {
  const passphrase = document.querySelector("#vaultPassphrase").value;
  if (!passphrase) {
    alert("Enter the passphrase you used when saving the vault.");
    return;
  }
  const stored = localStorage.getItem(vaultKey);
  if (!stored) {
    vaultUnlocked = true;
    unlockedIntegrations = {};
    await refresh();
    return;
  }
  try {
    unlockedIntegrations = await readBrowserVault(passphrase, JSON.parse(stored));
    vaultUnlocked = true;
    await refresh();
    showSettingsMessage("Browser vault unlocked.", "success");
  } catch {
    showSettingsMessage("Could not unlock the saved key vault. Check the passphrase.", "error");
  }
}

async function clearVault() {
  localStorage.removeItem(vaultKey);
  unlockedIntegrations = {};
  vaultUnlocked = false;
  document.querySelector("#vaultPassphrase").value = "";
  await refresh();
  showSettingsMessage("Saved browser keys cleared.", "success");
}

function credentialHeaders() {
  if (!vaultUnlocked) return {};
  return {
    ...(unlockedIntegrations.alpaca?.apiKey ? { "X-DPT-Alpaca-Key": unlockedIntegrations.alpaca.apiKey } : {}),
    ...(unlockedIntegrations.alpaca?.secretKey ? { "X-DPT-Alpaca-Secret": unlockedIntegrations.alpaca.secretKey } : {}),
    ...(unlockedIntegrations.openai?.apiKey ? { "X-DPT-OpenAI-Key": unlockedIntegrations.openai.apiKey } : {}),
    ...(unlockedIntegrations.anthropic?.apiKey ? { "X-DPT-Anthropic-Key": unlockedIntegrations.anthropic.apiKey } : {}),
    ...(unlockedIntegrations.polygon?.apiKey ? { "X-DPT-Polygon-Key": unlockedIntegrations.polygon.apiKey } : {}),
    ...(unlockedIntegrations.finnhub?.apiKey ? { "X-DPT-Finnhub-Key": unlockedIntegrations.finnhub.apiKey } : {}),
    ...(unlockedIntegrations.twelveData?.apiKey ? { "X-DPT-Twelve-Data-Key": unlockedIntegrations.twelveData.apiKey } : {}),
    ...(unlockedIntegrations.alphaVantage?.apiKey ? { "X-DPT-Alpha-Vantage-Key": unlockedIntegrations.alphaVantage.apiKey } : {})
  };
}

async function maybeRunAutoTrade() {
  if (!vaultUnlocked) {
    logAiActivity("waiting", "Vault locked. Unlock Alpaca keys before AI can trade.", {});
    return;
  }
  if (!localIntegrationStatus("alpaca").configured) {
    logAiActivity("waiting", "Alpaca browser keys are missing. AI cannot submit paper orders.", {});
    return;
  }
  if (state?.risk?.killSwitch) {
    logAiActivity("paused", "Pause button is active. AI cycle skipped.", {});
    return;
  }
  if (autoTradeInFlight) {
    logAiActivity("waiting", "AI cycle already running.", {});
    return;
  }
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
  setAiTraderStatus(title(status), message);
  renderAiLogs();
}

function describeAutoTradeResult(result) {
  if (result.status === "submitted") {
    return `Submitted ${result.order?.symbol || "paper"} bracket order to Alpaca. AI ${Math.round((result.ai?.probabilityOfSuccess || 0) * 100)}%, ${result.risk?.shares || 0} shares.`;
  }
  if (result.status === "no_trade") return `No trade submitted: ${title(result.reason || "no approved signal")}.`;
  if (result.status === "paused") return "AI cycle skipped because trading is paused.";
  if (result.status === "blocked") return `AI blocked: ${result.error || "unknown error"}.`;
  return `AI cycle finished with status ${result.status}.`;
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
        <small>${time(log.createdAt)}${log.details?.order?.id ? ` | Order ${escapeHtml(log.details.order.id)}` : ""}</small>
      </div>
    </article>
  `).join("") : `<p class="body-copy">No AI cycles logged yet. Unlock Alpaca keys and leave the app open.</p>`;
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

function localIntegrationStatus(key) {
  const required = integrationRequirements[key] || ["apiKey"];
  const saved = unlockedIntegrations[key] || {};
  const missing = vaultUnlocked ? required.filter((field) => !saved[field]) : required;
  return {
    configured: vaultUnlocked && missing.length === 0,
    missing
  };
}

function fieldPlaceholder(key, field) {
  if (key === "alpaca" && field === "apiKey") return "Alpaca API Key ID";
  if (key === "alpaca" && field === "secretKey") return "Alpaca Secret Key";
  return title(field);
}

function mergeSecrets(current, next) {
  const merged = structuredClone(current || {});
  for (const [integration, fields] of Object.entries(next)) {
    merged[integration] = { ...(merged[integration] || {}), ...fields };
  }
  return merged;
}

async function saveEncryptedVault(passphrase, integrations) {
  if (!globalThis.crypto?.subtle) {
    throw new Error("Web Crypto is unavailable");
  }
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveVaultKey(passphrase, salt);
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(JSON.stringify(integrations))
  );
  localStorage.setItem(vaultKey, JSON.stringify({
    version: 1,
    mode: "encrypted",
    salt: toBase64(salt),
    iv: toBase64(iv),
    data: toBase64(new Uint8Array(encrypted))
  }));
}

async function decryptVault(passphrase, vault) {
  if (!globalThis.crypto?.subtle) {
    throw new Error("Web Crypto is unavailable");
  }
  const salt = fromBase64(vault.salt);
  const iv = fromBase64(vault.iv);
  const key = await deriveVaultKey(passphrase, salt);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    fromBase64(vault.data)
  );
  return JSON.parse(new TextDecoder().decode(decrypted));
}

async function saveBrowserVault(passphrase, integrations) {
  try {
    await saveEncryptedVault(passphrase, integrations);
    return "encrypted";
  } catch {
    localStorage.setItem(vaultKey, JSON.stringify({
      version: 1,
      mode: "browser",
      passphraseHash: await weakPassphraseHash(passphrase),
      data: toBase64(new TextEncoder().encode(JSON.stringify(integrations)))
    }));
    return "browser";
  }
}

async function readBrowserVault(passphrase, vault) {
  if (vault.mode === "browser") {
    if (vault.passphraseHash !== await weakPassphraseHash(passphrase)) {
      throw new Error("Invalid passphrase");
    }
    return JSON.parse(new TextDecoder().decode(fromBase64(vault.data)));
  }
  return decryptVault(passphrase, vault);
}

async function deriveVaultKey(passphrase, salt) {
  const baseKey = await globalThis.crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(passphrase),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return globalThis.crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 250000, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

function toBase64(bytes) { return btoa(String.fromCharCode(...bytes)); }
function fromBase64(value) { return Uint8Array.from(atob(value), (char) => char.charCodeAt(0)); }

async function weakPassphraseHash(passphrase) {
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(passphrase));
    return toBase64(new Uint8Array(digest));
  }
  let hash = 0;
  for (let index = 0; index < passphrase.length; index += 1) {
    hash = ((hash << 5) - hash + passphrase.charCodeAt(index)) | 0;
  }
  return String(hash);
}

function showSettingsMessage(message, type) {
  const element = document.querySelector("#settingsMessage");
  if (!element) return;
  element.textContent = message;
  element.className = `settings-message ${type || ""}`.trim();
}

function setText(selector, value) {
  const element = document.querySelector(selector);
  if (element) element.textContent = value;
}
function money(value) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value || 0);
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

showPage(location.hash.slice(1) || localStorage.getItem(activePageKey) || "markets");
window.addEventListener("hashchange", () => showPage(location.hash.slice(1) || "markets"));
refresh();
setInterval(refresh, 5000);

function priceFlashClass(bar) {
  const previous = previousPrices.get(bar.symbol);
  if (previous === undefined || previous === bar.price) return "";
  return bar.price > previous ? "flash-up" : "flash-down";
}
