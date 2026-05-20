const pages = [...document.querySelectorAll(".page")];
const navItems = [...document.querySelectorAll(".nav-item")];
const pageTitle = document.querySelector("#pageTitle");
let state = null;

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
document.querySelector("#refreshButton").addEventListener("click", refresh);
document.querySelector("#killSwitchButton").addEventListener("click", async () => {
  await postJson("/api/kill-switch", { enabled: !state?.risk?.killSwitch });
  await refresh();
});
document.querySelector("#settingsForm").addEventListener("submit", saveSettings);

function showPage(pageId) {
  pages.forEach((page) => page.classList.toggle("active", page.id === pageId));
  navItems.forEach((item) => item.classList.toggle("active", item.dataset.page === pageId));
  pageTitle.textContent = navItems.find((item) => item.dataset.page === pageId)?.textContent || "Overview";
}

async function refresh() {
  const [appState, settings] = await Promise.all([
    fetchJson("/api/state"),
    fetchJson("/api/settings/integrations")
  ]);
  state = appState;
  renderState(appState);
  renderSettings(settings.integrations);
}

function renderState(data) {
  setText("#equity", money(data.account.equity));
  setText("#dayPnl", money(data.account.dayPnl));
  document.querySelector("#dayPnl").className = data.account.dayPnl >= 0 ? "up" : "down";
  setText("#openPositions", String(data.positions.length));
  setText("#accountSource", `${data.account.source} account`);
  setText("#riskState", data.risk.killSwitch ? "Paused" : "Ready");
  setText("#riskLimits", `${data.risk.maxRiskPerTradePct}% risk/trade, ${data.risk.maxDailyLossPct}% daily stop`);
  setText("#modeLabel", data.risk.tradingMode.toUpperCase());
  const liveGuard = document.querySelector("#liveGuard");
  liveGuard.textContent = data.risk.liveTradingArmed ? "Live armed" : "Live blocked";
  liveGuard.className = data.risk.liveTradingArmed ? "pill danger-pill" : "pill safe";
  const killButton = document.querySelector("#killSwitchButton");
  killButton.textContent = data.risk.killSwitch ? "Resume Paper Trading" : "Pause Trading";

  renderMarket(data.market);
  renderSignals(data.signals);
  renderOrders(data.orders);
  renderEvents(data.events);
  renderRiskRules(data.risk);
  renderModelBars(data.signals);
}

function renderMarket(market) {
  document.querySelector("#marketGrid").innerHTML = market.map((bar) => `
    <article class="market-card">
      <span class="muted">${bar.symbol}</span>
      <strong>${money(bar.price)}</strong>
      <span class="${bar.changePct >= 0 ? "up" : "down"}">${bar.changePct}%</span>
      <small class="muted">RVOL ${bar.relativeVolume} | spread ${bar.spreadPct}%</small>
    </article>
  `).join("");
}

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
        <button class="button secondary" data-order-symbol="${signal.symbol}" ${signal.risk.decision === "approved" ? "" : "disabled"}>Paper Order</button>
      </div>
    `).join("")}
  `;
  document.querySelectorAll("[data-order-symbol]").forEach((button) => {
    button.addEventListener("click", async () => {
      await postJson("/api/orders/simulate", { symbol: button.dataset.orderSymbol });
      await refresh();
      showPage("orders");
    });
  });
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

function renderEvents(events) {
  document.querySelector("#eventsList").innerHTML = events.map((event) => `
    <div class="event"><span>${event.message}</span><small class="muted">${time(event.createdAt)}</small></div>
  `).join("");
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

function renderSettings(integrations) {
  const grid = document.querySelector("#settingsGrid");
  grid.innerHTML = Object.entries(integrations).map(([key, integration]) => `
    <div class="setting-card">
      <label>${integration.label}<span class="${integration.configured ? "up" : "down"}">${integration.source}</span></label>
      ${(integrationFields[key] || ["apiKey"]).map((field) => `
        <input autocomplete="off" type="password" placeholder="${title(field)}" data-integration="${key}" data-field="${field}">
      `).join("")}
    </div>
  `).join("");
}

async function saveSettings(event) {
  event.preventDefault();
  const integrations = {};
  document.querySelectorAll("[data-integration]").forEach((input) => {
    if (!input.value.trim()) return;
    integrations[input.dataset.integration] ||= {};
    integrations[input.dataset.integration][input.dataset.field] = input.value.trim();
  });
  await postJson("/api/settings/integrations", { integrations });
  event.target.reset();
  await refresh();
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

function setText(selector, value) {
  document.querySelector(selector).textContent = value;
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

refresh();
setInterval(refresh, 30000);
