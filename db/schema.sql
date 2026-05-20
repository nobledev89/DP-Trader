create extension if not exists pgcrypto;

create table if not exists system_events (
  id uuid primary key default gen_random_uuid(),
  severity text not null,
  message text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists system_events_created_at_idx on system_events (created_at desc);

create table if not exists account_snapshots (
  id uuid primary key default gen_random_uuid(),
  equity numeric,
  buying_power numeric,
  day_pnl numeric,
  status text,
  source text,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists account_snapshots_created_at_idx on account_snapshots (created_at desc);

create table if not exists positions (
  symbol text primary key,
  qty numeric not null default 0,
  side text,
  market_value numeric,
  current_price numeric,
  avg_entry_price numeric,
  unrealized_pnl numeric,
  unrealized_pnl_pct numeric,
  raw jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists orders (
  id text primary key,
  client_order_id text,
  symbol text not null,
  side text,
  qty numeric,
  type text,
  limit_price numeric,
  stop_price numeric,
  target_price numeric,
  status text,
  filled_qty numeric,
  filled_avg_price numeric,
  ai_confidence numeric,
  expected_r numeric,
  created_at timestamptz,
  raw jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists orders_created_at_idx on orders (created_at desc);
create index if not exists orders_symbol_idx on orders (symbol);
create index if not exists orders_status_idx on orders (status);

create table if not exists strategy_signals (
  id uuid primary key default gen_random_uuid(),
  symbol text not null,
  strategy text,
  direction text,
  confidence numeric,
  entry_price numeric,
  stop_price numeric,
  target_price numeric,
  expected_r numeric,
  features jsonb not null default '{}'::jsonb,
  reason_codes text[] not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists strategy_signals_created_at_idx on strategy_signals (created_at desc);

create table if not exists risk_decisions (
  id uuid primary key default gen_random_uuid(),
  symbol text,
  decision text not null,
  reason_codes text[] not null default '{}',
  reward_risk numeric,
  shares integer,
  risk_amount numeric,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists risk_decisions_created_at_idx on risk_decisions (created_at desc);

create table if not exists ai_trade_cycles (
  id uuid primary key default gen_random_uuid(),
  status text not null,
  reason text,
  symbol text,
  order_id text,
  ai_probability numeric,
  expected_r numeric,
  risk jsonb not null default '{}'::jsonb,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists ai_trade_cycles_created_at_idx on ai_trade_cycles (created_at desc);

create table if not exists llm_usage (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  model text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cost_usd numeric not null default 0,
  reason text,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists llm_usage_created_at_idx on llm_usage (created_at desc);
