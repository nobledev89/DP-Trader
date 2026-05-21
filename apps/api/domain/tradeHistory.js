const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function buildTradeHistory({ orders = [], equitySnapshots = [], rangeDays = 30 } = {}) {
  const filledOrders = normalizeOrders(orders);
  const closedTrades = pairTrades(filledOrders);
  const summary = summarizeTrades(closedTrades, filledOrders);
  const dailyPnl = aggregateDailyPnl(closedTrades, rangeDays);
  const symbolStats = aggregateSymbolStats(closedTrades);
  const equityCurve = buildEquityCurve(equitySnapshots, closedTrades);
  return { summary, closedTrades, openLots: openLotsForOrders(filledOrders), dailyPnl, symbolStats, equityCurve };
}

function normalizeOrders(orders) {
  return orders
    .map((order) => {
      const filledQty = Number(order.filledQty ?? order.qty ?? 0);
      const price = Number(order.filledAvgPrice ?? order.limitPrice ?? 0);
      const ts = Date.parse(order.createdAt || order.updatedAt || "") || Date.now();
      const side = String(order.side || "").toLowerCase();
      if (!order.symbol || !filledQty || !price || (side !== "buy" && side !== "sell")) return null;
      return {
        id: order.id,
        symbol: order.symbol,
        side,
        qty: Math.abs(filledQty),
        price,
        ts,
        createdAt: new Date(ts).toISOString(),
        status: order.status || "filled",
        aiConfidence: Number.isFinite(Number(order.aiConfidence)) ? Number(order.aiConfidence) : null,
        expectedR: Number.isFinite(Number(order.expectedR)) ? Number(order.expectedR) : null
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.ts - b.ts);
}

function pairTrades(orders) {
  const lotsBySymbol = new Map();
  const closed = [];
  for (const order of orders) {
    const lots = lotsBySymbol.get(order.symbol) || [];
    if (!lots.length) {
      lots.push({ ...order, remaining: order.qty });
      lotsBySymbol.set(order.symbol, lots);
      continue;
    }
    const head = lots[0];
    if (head.side === order.side) {
      lots.push({ ...order, remaining: order.qty });
      lotsBySymbol.set(order.symbol, lots);
      continue;
    }
    let remaining = order.qty;
    while (remaining > 0 && lots.length && lots[0].side !== order.side) {
      const lot = lots[0];
      const matchedQty = Math.min(lot.remaining, remaining);
      const entry = lot;
      const exit = order;
      const direction = entry.side === "buy" ? "long" : "short";
      const grossPnl = direction === "long"
        ? (exit.price - entry.price) * matchedQty
        : (entry.price - exit.price) * matchedQty;
      const entryNotional = entry.price * matchedQty;
      const returnPct = entryNotional > 0 ? grossPnl / entryNotional : 0;
      const holdMs = Math.max(0, exit.ts - entry.ts);
      closed.push({
        symbol: entry.symbol,
        direction,
        qty: matchedQty,
        entryPrice: entry.price,
        exitPrice: exit.price,
        entryAt: entry.createdAt,
        exitAt: exit.createdAt,
        holdMinutes: Math.round(holdMs / 60000),
        pnl: roundCents(grossPnl),
        returnPct: roundFloat(returnPct, 6),
        entryOrderId: entry.id,
        exitOrderId: exit.id,
        aiConfidence: exit.aiConfidence ?? entry.aiConfidence,
        outcome: grossPnl >= 0 ? "win" : "loss"
      });
      lot.remaining -= matchedQty;
      remaining -= matchedQty;
      if (lot.remaining <= 0) lots.shift();
    }
    if (remaining > 0) {
      lots.push({ ...order, remaining });
      lotsBySymbol.set(order.symbol, lots);
    } else {
      lotsBySymbol.set(order.symbol, lots);
    }
  }
  return closed.sort((a, b) => Date.parse(b.exitAt) - Date.parse(a.exitAt));
}

function openLotsForOrders(orders) {
  const lotsBySymbol = new Map();
  for (const order of orders) {
    const lots = lotsBySymbol.get(order.symbol) || [];
    if (!lots.length || lots[0].side === order.side) {
      lots.push({ ...order, remaining: order.qty });
      lotsBySymbol.set(order.symbol, lots);
      continue;
    }
    let remaining = order.qty;
    while (remaining > 0 && lots.length && lots[0].side !== order.side) {
      const lot = lots[0];
      const matched = Math.min(lot.remaining, remaining);
      lot.remaining -= matched;
      remaining -= matched;
      if (lot.remaining <= 0) lots.shift();
    }
    if (remaining > 0) lots.push({ ...order, remaining });
    lotsBySymbol.set(order.symbol, lots);
  }
  const result = [];
  for (const [symbol, lots] of lotsBySymbol.entries()) {
    for (const lot of lots) {
      if (lot.remaining > 0) {
        result.push({
          symbol,
          side: lot.side,
          remainingQty: lot.remaining,
          entryPrice: lot.price,
          entryAt: lot.createdAt
        });
      }
    }
  }
  return result;
}

function summarizeTrades(trades, allOrders) {
  if (!trades.length) {
    return {
      totalTrades: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      grossProfit: 0,
      grossLoss: 0,
      netPnl: 0,
      profitFactor: 0,
      avgWin: 0,
      avgLoss: 0,
      avgReturnPct: 0,
      bestTrade: null,
      worstTrade: null,
      avgHoldMinutes: 0,
      firstTradeAt: null,
      lastTradeAt: null,
      totalFills: allOrders.length
    };
  }
  let grossProfit = 0;
  let grossLoss = 0;
  let wins = 0;
  let losses = 0;
  let best = trades[0];
  let worst = trades[0];
  let holdSum = 0;
  let returnSum = 0;
  for (const trade of trades) {
    if (trade.pnl >= 0) { wins += 1; grossProfit += trade.pnl; }
    else { losses += 1; grossLoss += Math.abs(trade.pnl); }
    if (trade.pnl > best.pnl) best = trade;
    if (trade.pnl < worst.pnl) worst = trade;
    holdSum += trade.holdMinutes;
    returnSum += trade.returnPct;
  }
  const totalTrades = trades.length;
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;
  const exits = trades.map((trade) => Date.parse(trade.exitAt));
  return {
    totalTrades,
    wins,
    losses,
    winRate: wins / totalTrades,
    grossProfit: roundCents(grossProfit),
    grossLoss: roundCents(grossLoss),
    netPnl: roundCents(grossProfit - grossLoss),
    profitFactor: Number.isFinite(profitFactor) ? roundFloat(profitFactor, 2) : null,
    avgWin: wins ? roundCents(grossProfit / wins) : 0,
    avgLoss: losses ? roundCents(grossLoss / losses) : 0,
    avgReturnPct: roundFloat(returnSum / totalTrades, 6),
    bestTrade: best,
    worstTrade: worst,
    avgHoldMinutes: Math.round(holdSum / totalTrades),
    firstTradeAt: new Date(Math.min(...exits)).toISOString(),
    lastTradeAt: new Date(Math.max(...exits)).toISOString(),
    totalFills: allOrders.length
  };
}

function aggregateDailyPnl(trades, rangeDays = 30) {
  const byDay = new Map();
  for (const trade of trades) {
    const day = trade.exitAt.slice(0, 10);
    const entry = byDay.get(day) || { date: day, pnl: 0, trades: 0, wins: 0, losses: 0 };
    entry.pnl += trade.pnl;
    entry.trades += 1;
    if (trade.pnl >= 0) entry.wins += 1; else entry.losses += 1;
    byDay.set(day, entry);
  }
  const days = [];
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  for (let i = rangeDays - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * MS_PER_DAY);
    const key = d.toISOString().slice(0, 10);
    const entry = byDay.get(key) || { date: key, pnl: 0, trades: 0, wins: 0, losses: 0 };
    days.push({ ...entry, pnl: roundCents(entry.pnl) });
  }
  return days;
}

function aggregateSymbolStats(trades) {
  const map = new Map();
  for (const trade of trades) {
    const entry = map.get(trade.symbol) || { symbol: trade.symbol, trades: 0, wins: 0, losses: 0, netPnl: 0, volume: 0 };
    entry.trades += 1;
    entry.netPnl += trade.pnl;
    entry.volume += trade.qty * trade.entryPrice;
    if (trade.pnl >= 0) entry.wins += 1; else entry.losses += 1;
    map.set(trade.symbol, entry);
  }
  return [...map.values()]
    .map((entry) => ({
      ...entry,
      netPnl: roundCents(entry.netPnl),
      volume: roundCents(entry.volume),
      winRate: entry.trades ? entry.wins / entry.trades : 0
    }))
    .sort((a, b) => b.netPnl - a.netPnl);
}

function buildEquityCurve(snapshots, trades) {
  if (snapshots && snapshots.length) {
    const points = snapshots
      .filter((snap) => snap.equity != null && snap.createdAt)
      .map((snap) => ({ at: snap.createdAt, equity: Number(snap.equity), source: "account" }))
      .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    if (points.length) return points;
  }
  if (!trades.length) return [];
  const sorted = [...trades].sort((a, b) => Date.parse(a.exitAt) - Date.parse(b.exitAt));
  const first = sorted[0];
  const base = 100000;
  let running = base;
  const initial = [{ at: first.entryAt || first.exitAt, equity: base, source: "derived" }];
  for (const trade of sorted) {
    running += trade.pnl;
    initial.push({ at: trade.exitAt, equity: roundCents(running), source: "derived" });
  }
  return initial;
}

function roundCents(value) {
  return Math.round(Number(value) * 100) / 100;
}

function roundFloat(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(Number(value) * factor) / factor;
}
