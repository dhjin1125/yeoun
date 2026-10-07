alter table public.dream_orders
  add column if not exists product text not null default 'full_reading';

alter table public.dream_orders
  drop constraint if exists dream_orders_product_check;

alter table public.dream_orders
  add constraint dream_orders_product_check
  check (product in ('full_reading', 'followup_pack_2'));

create index if not exists dream_orders_product_idx
  on public.dream_orders(reading_id, product, status);

create table if not exists public.dream_messages (
  id text primary key,
  reading_id text not null references public.dream_readings(id) on delete cascade,
  role text not null check (role in ('user', 'kkumgyeol')),
  kind text not null check (kind in ('dream', 'clarification', 'free', 'detailed', 'followup', 'safety')),
  status text not null check (status in ('pending', 'complete', 'failed')),
  client_message_id text,
  encrypted_content jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists dream_messages_reading_idx
  on public.dream_messages(reading_id, created_at);

create unique index if not exists dream_messages_client_message_unique
  on public.dream_messages(reading_id, client_message_id)
  where client_message_id is not null;

create table if not exists public.dream_entitlements (
  reading_id text primary key references public.dream_readings(id) on delete cascade,
  full_reading_purchased boolean not null default false,
  base_question_allowance smallint not null default 0 check (base_question_allowance in (0, 2)),
  extra_question_allowance smallint not null default 0 check (extra_question_allowance in (0, 2)),
  used_questions smallint not null default 0 check (used_questions between 0 and 4),
  extra_pack_purchased boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.dream_message_reservations (
  reading_id text not null references public.dream_readings(id) on delete cascade,
  client_message_id text not null,
  status text not null check (status in ('reserved', 'complete', 'released')),
  reserved_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (reading_id, client_message_id)
);

alter table public.dream_analytics_events
  drop constraint if exists dream_analytics_events_event_name_check;

alter table public.dream_analytics_events
  add constraint dream_analytics_events_event_name_check check (event_name in (
    'input_started', 'analysis_submitted', 'clarification_answered', 'clarification_skipped',
    'free_result_viewed', 'paywall_clicked', 'checkout_started', 'payment_succeeded',
    'paid_result_viewed', 'followup_used', 'share_created', 'deep_reading_viewed',
    'conversation_message_sent', 'conversation_reply_viewed', 'credits_exhausted',
    'followup_pack_purchased', 'safety_route_shown', 'answer_rated'
  ));

create or replace function public.reserve_dream_followup(
  p_reading_id text,
  p_client_message_id text
)
returns table (reservation_status text, remaining_questions integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  entitlement public.dream_entitlements%rowtype;
  reservation public.dream_message_reservations%rowtype;
  allowed_count integer;
begin
  select * into entitlement
  from public.dream_entitlements
  where reading_id = p_reading_id
  for update;

  if not found or not entitlement.full_reading_purchased then
    return query select 'not_entitled'::text, 0;
    return;
  end if;

  select * into reservation
  from public.dream_message_reservations
  where reading_id = p_reading_id and client_message_id = p_client_message_id
  for update;

  allowed_count := entitlement.base_question_allowance + entitlement.extra_question_allowance;

  if found and reservation.status = 'complete' then
    return query select 'duplicate_complete'::text, greatest(0, allowed_count - entitlement.used_questions);
    return;
  end if;

  if found and reservation.status = 'reserved' and reservation.reserved_at > now() - interval '5 minutes' then
    return query select 'duplicate_pending'::text, greatest(0, allowed_count - entitlement.used_questions);
    return;
  end if;

  if found and reservation.status = 'reserved' then
    update public.dream_entitlements
    set used_questions = greatest(0, used_questions - 1), updated_at = now()
    where reading_id = p_reading_id
    returning * into entitlement;
  end if;

  allowed_count := entitlement.base_question_allowance + entitlement.extra_question_allowance;
  if entitlement.used_questions >= allowed_count then
    return query select 'credits_exhausted'::text, 0;
    return;
  end if;

  update public.dream_entitlements
  set used_questions = used_questions + 1, updated_at = now()
  where reading_id = p_reading_id
  returning * into entitlement;

  insert into public.dream_message_reservations (
    reading_id, client_message_id, status, reserved_at, updated_at
  ) values (
    p_reading_id, p_client_message_id, 'reserved', now(), now()
  )
  on conflict (reading_id, client_message_id) do update
    set status = 'reserved', reserved_at = excluded.reserved_at, updated_at = excluded.updated_at;

  return query select
    'reserved'::text,
    greatest(
      0,
      entitlement.base_question_allowance + entitlement.extra_question_allowance - entitlement.used_questions
    );
end;
$$;

create or replace function public.release_dream_followup(
  p_reading_id text,
  p_client_message_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  released_count integer;
begin
  perform 1
  from public.dream_entitlements
  where reading_id = p_reading_id
  for update;

  update public.dream_message_reservations
  set status = 'released', updated_at = now()
  where reading_id = p_reading_id
    and client_message_id = p_client_message_id
    and status = 'reserved';
  get diagnostics released_count = row_count;

  if released_count = 1 then
    update public.dream_entitlements
    set used_questions = greatest(0, used_questions - 1), updated_at = now()
    where reading_id = p_reading_id;
  end if;
end;
$$;

comment on column public.dream_messages.encrypted_content is
  'AES-256-GCM envelope only. Never store dream, question, or answer plaintext.';

comment on table public.dream_entitlements is
  'Server-owned entitlement counters. Total follow-up allowance is capped at four.';

alter table public.dream_messages enable row level security;
alter table public.dream_entitlements enable row level security;
alter table public.dream_message_reservations enable row level security;

revoke all on public.dream_messages from anon, authenticated;
revoke all on public.dream_entitlements from anon, authenticated;
revoke all on public.dream_message_reservations from anon, authenticated;
revoke all on function public.reserve_dream_followup(text, text) from public, anon, authenticated;
revoke all on function public.release_dream_followup(text, text) from public, anon, authenticated;
grant execute on function public.reserve_dream_followup(text, text) to service_role;
grant execute on function public.release_dream_followup(text, text) to service_role;
