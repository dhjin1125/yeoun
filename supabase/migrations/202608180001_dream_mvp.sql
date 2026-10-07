create extension if not exists pgcrypto;

create table if not exists public.dream_readings (
  id text primary key,
  session_hash text not null,
  owner_user_id uuid references auth.users(id) on delete cascade,
  status text not null check (status in (
    'intake', 'clarifying', 'free_ready', 'payment_pending', 'paid_generating', 'paid_ready'
  )),
  record jsonb not null,
  expires_at timestamptz not null,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists dream_readings_session_hash_idx on public.dream_readings(session_hash);
create index if not exists dream_readings_owner_user_id_idx on public.dream_readings(owner_user_id);
create index if not exists dream_readings_expires_at_idx on public.dream_readings(expires_at);

create table if not exists public.dream_orders (
  id text primary key,
  reading_id text not null references public.dream_readings(id) on delete cascade,
  session_hash text not null,
  amount integer not null check (amount = 990),
  status text not null check (status in ('pending', 'paid', 'failed', 'refunded')),
  payment_key text,
  record jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists dream_orders_reading_idx on public.dream_orders(reading_id, status);
create unique index if not exists dream_orders_payment_key_unique
  on public.dream_orders(payment_key)
  where payment_key is not null;

create table if not exists public.dream_analytics_events (
  id bigint generated always as identity primary key,
  event_name text not null check (event_name in (
    'input_started', 'analysis_submitted', 'clarification_answered', 'clarification_skipped',
    'free_result_viewed', 'paywall_clicked', 'checkout_started', 'payment_succeeded',
    'paid_result_viewed', 'followup_used', 'share_created'
  )),
  reading_id text references public.dream_readings(id) on delete set null,
  context jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

comment on table public.dream_analytics_events is
  'Allowlisted product events only. Never store dream text, clarification text, report text, email, or OAuth identity here.';

alter table public.dream_readings enable row level security;
alter table public.dream_orders enable row level security;
alter table public.dream_analytics_events enable row level security;

-- The browser never talks to these tables directly. The isolated service-role
-- backend owns access checks, so no anon/authenticated RLS policy is created.
revoke all on public.dream_readings from anon, authenticated;
revoke all on public.dream_orders from anon, authenticated;
revoke all on public.dream_analytics_events from anon, authenticated;

create or replace function public.purge_expired_dream_data()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer;
begin
  delete from public.dream_readings where expires_at <= now();
  get diagnostics deleted_count = row_count;
  delete from public.dream_analytics_events where occurred_at < now() - interval '13 months';
  return deleted_count;
end;
$$;

revoke all on function public.purge_expired_dream_data() from public, anon, authenticated;
grant execute on function public.purge_expired_dream_data() to service_role;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    if not exists (select 1 from cron.job where jobname = 'purge-expired-dream-data') then
      perform cron.schedule(
        'purge-expired-dream-data',
        '17 * * * *',
        'select public.purge_expired_dream_data()'
      );
    end if;
  end if;
exception
  when undefined_table then
    null;
end;
$$;
