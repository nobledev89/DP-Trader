import { hasDatabase, query } from "./postgres.js";

export async function persistEvent(severity, message, metadata = {}) {
  await safeQuery(
    `insert into system_events (severity, message, metadata) values ($1, $2, $3)`,
    [severity, sanitizeMessage(message), metadata]
  );
}

export async function persistAccountSnapshot(account) {
  if (!account) return;
  await safeQuery(
    `insert into account_snapshots (equity, buying_power, day_pnl, status, source, raw)
     values ($1, $2, $3, $4, $5, $6)`,
    [
      numberOrNull(account.equity),
      numberOrNull(account.buyingPower),
      numberOrNull(account.dayPnl),
      account.status || null,
      account.source || null,
      account
    ]
  );
}

export async function persistPositions(positions = []) {
  if (!Array.isArray(positions)) return;
  if (!positions.length) {
    await safeQuery(`delete from positions`, []);
    return;
  }
  await safeQuery(`delete from positions where symbol <> all($1::text[])`, [positions.map((position) => position.symbol)]);
  for (const position of positions) {
    await safeQuery(
      `insert into positions (
        symbol, qty, side, market_value, current_price, avg_entry_price,
        unrealized_pnl, unrealized_pnl_pct, raw, updated_at
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
      on conflict (symbol) do update set
        qty = excluded.qty,
        side = excluded.side,
        market_value = excluded.market_value,
        current_price = excluded.current_price,
        avg_entry_price = excluded.avg_entry_price,
        unrealized_pnl = excluded.unrealized_pnl,
        unrealized_pnl_pct = excluded.unrealized_pnl_pct,
        raw = excluded.raw,
        updated_at = now()`,
      [
        position.symbol,
        numberOrNull(position.qty),
        position.side || null,
        numberOrNull(position.marketValue),
        numberOrNull(position.currentPrice),
        numberOrNull(position.avgEntryPrice),
        numberOrNull(position.unrealizedPnl),
        numberOrNull(position.unrealizedPnlPct),
        position
      ]
    );
  }
}

export async function persistOrders(orders = []) {
  if (!Array.isArray(orders)) return;
  for (const order of orders) {
    if (!order.id) continue;
    await persistOrder(order);
  }
}

export async function persistOrder(order) {
  if (!order?.id) return;
  await safeQuery(
    `insert into orders (
      id, client_order_id, symbol, side, qty, type, limit_price, stop_price,
      target_price, status, filled_qty, filled_avg_price, ai_confidence,
      expected_r, created_at, raw, updated_at
    )
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, now())
    on conflict (id) do update set
      client_order_id = excluded.client_order_id,
      symbol = excluded.symbol,
      side = excluded.side,
      qty = excluded.qty,
      type = excluded.type,
      limit_price = excluded.limit_price,
      stop_price = excluded.stop_price,
      target_price = excluded.target_price,
      status = excluded.status,
      filled_qty = excluded.filled_qty,
      filled_avg_price = excluded.filled_avg_price,
      ai_confidence = excluded.ai_confidence,
      expected_r = excluded.expected_r,
      raw = excluded.raw,
      updated_at = now()`,
    [
      order.id,
      order.clientOrderId || null,
      order.symbol,
      order.side || null,
      numberOrNull(order.qty),
      order.type || null,
      numberOrNull(order.limitPrice),
      numberOrNull(order.stopPrice),
      numberOrNull(order.targetPrice),
      order.status || null,
      numberOrNull(order.filledQty),
      numberOrNull(order.filledAvgPrice),
      numberOrNull(order.aiConfidence),
      numberOrNull(order.expectedR),
      timestampOrNull(order.createdAt),
      order
    ]
  );
}

export async function persistStrategySignals(signals = []) {
  if (!Array.isArray(signals)) return;
  for (const signal of signals) {
    await safeQuery(
      `insert into strategy_signals (
        symbol, strategy, direction, confidence, entry_price, stop_price,
        target_price, expected_r, features, reason_codes
      )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        signal.symbol,
        signal.strategy || null,
        signal.direction || null,
        numberOrNull(signal.confidence),
        numberOrNull(signal.entryPrice),
        numberOrNull(signal.stopPrice),
        numberOrNull(signal.targetPrice),
        numberOrNull(signal.ai?.expectedR),
        signal.features || {},
        signal.ai?.reasonCodes || signal.reasonCodes || []
      ]
    );
  }
}

export async function persistRiskDecision(symbol, risk) {
  if (!risk) return;
  await safeQuery(
    `insert into risk_decisions (symbol, decision, reason_codes, reward_risk, shares, risk_amount, raw)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [
      symbol || null,
      risk.decision || "unknown",
      risk.reasons || risk.reasonCodes || [],
      numberOrNull(risk.rewardRisk),
      Number.isFinite(Number(risk.shares)) ? Number(risk.shares) : null,
      numberOrNull(risk.riskAmount),
      risk
    ]
  );
}

export async function persistAutoTradeCycle(result) {
  if (!result) return;
  await safeQuery(
    `insert into ai_trade_cycles (
      status, reason, symbol, order_id, ai_probability, expected_r, risk, raw
    )
    values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      result.status || "unknown",
      result.reason || null,
      result.order?.symbol || null,
      result.order?.id || null,
      numberOrNull(result.ai?.probabilityOfSuccess),
      numberOrNull(result.ai?.expectedR),
      result.risk || {},
      result
    ]
  );
  if (result.order) await persistOrder(result.order);
  if (result.risk) await persistRiskDecision(result.order?.symbol, result.risk);
}

export async function ensureIntegrationKeyTable() {
  if (!hasDatabase()) return;
  await query(
    `create table if not exists integration_keys (
       integration text primary key,
       payload jsonb not null default '{}'::jsonb,
       updated_at timestamptz not null default now()
     )`,
    []
  );
}

export async function loadIntegrationKeys() {
  try {
    return await loadIntegrationKeysStrict();
  } catch (error) {
    console.warn(`Postgres integration_keys read skipped: ${error.message}`);
    return {};
  }
}

export async function loadIntegrationKeysStrict() {
  const result = await query(`select integration, payload, updated_at from integration_keys`, []);
  const map = {};
  for (const row of result?.rows || []) {
    map[row.integration] = {
      payload: row.payload || {},
      updatedAt: row.updated_at?.toISOString?.() || null
    };
  }
  return map;
}

export async function saveIntegrationKey(integration, payload) {
  if (!hasDatabase()) {
    throw new Error("DATABASE_URL is required to save integration keys");
  }
  const result = await query(
    `insert into integration_keys (integration, payload, updated_at)
     values ($1, $2, now())
     on conflict (integration) do update set
       payload = excluded.payload,
       updated_at = now()
     returning integration`,
    [integration, payload]
  );
  if (!result?.rowCount) {
    throw new Error(`Integration key save failed for ${integration}`);
  }
}

export async function deleteIntegrationKey(integration) {
  if (!hasDatabase()) {
    throw new Error("DATABASE_URL is required to clear integration keys");
  }
  await query(`delete from integration_keys where integration = $1`, [integration]);
}

export async function ensureAppSettingsTable() {
  if (!hasDatabase()) return;
  await query(
    `create table if not exists app_settings (
       key text primary key,
       payload jsonb not null default '{}'::jsonb,
       updated_at timestamptz not null default now()
     )`,
    []
  );
}

export async function loadAppSetting(key) {
  try {
    return await loadAppSettingStrict(key);
  } catch (error) {
    console.warn(`Postgres app_settings read skipped: ${error.message}`);
    return null;
  }
}

export async function loadAppSettingStrict(key) {
  const result = await query(`select payload, updated_at from app_settings where key = $1`, [key]);
  const row = result?.rows?.[0];
  if (!row) return null;
  return {
    payload: row.payload || {},
    updatedAt: row.updated_at?.toISOString?.() || null
  };
}

export async function saveAppSetting(key, payload) {
  if (!hasDatabase()) {
    throw new Error("DATABASE_URL is required to save settings");
  }
  const result = await query(
    `insert into app_settings (key, payload, updated_at)
     values ($1, $2, now())
     on conflict (key) do update set
       payload = excluded.payload,
       updated_at = now()
     returning key`,
    [key, payload]
  );
  if (!result?.rowCount) {
    throw new Error(`Setting save failed for ${key}`);
  }
}

export async function loadRecentEvents(limit = 100) {
  try {
    const result = await query(
      `select severity, message, created_at
       from system_events
       order by created_at desc
       limit $1`,
      [limit]
    );
    return (result?.rows || []).map((row) => ({
      severity: row.severity,
      message: row.message,
      createdAt: row.created_at.toISOString()
    }));
  } catch (error) {
    console.warn(`Postgres event read skipped: ${error.message}`);
    return [];
  }
}

async function safeQuery(text, params) {
  try {
    await query(text, params);
  } catch (error) {
    console.warn(`Postgres persistence skipped: ${error.message}`);
  }
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function timestampOrNull(value) {
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time) : null;
}

function sanitizeMessage(message) {
  return String(message)
    .replace(/APCA-API-KEY-ID:\s*[^,\s]+/gi, "APCA-API-KEY-ID: [redacted]")
    .replace(/APCA-API-SECRET-KEY:\s*[^,\s]+/gi, "APCA-API-SECRET-KEY: [redacted]")
    .replace(/sk-[A-Za-z0-9_-]+/g, "[redacted-key]");
}
