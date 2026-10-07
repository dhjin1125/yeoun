-- Private abuse counters: no messages, access tokens or raw account identifiers.
create table if not exists public.dream_conversation_guards (
  key text primary key,
  state jsonb not null,
  version bigint not null default 1,
  expires_at bigint not null
);
create index if not exists dream_conversation_guards_expiry_idx
  on public.dream_conversation_guards(expires_at);
alter table public.dream_conversation_guards enable row level security;
revoke all on public.dream_conversation_guards from public, anon, authenticated;
grant all on public.dream_conversation_guards to service_role;

create or replace function public.compare_and_swap_conversation_guard(
  p_key text, p_version bigint, p_state jsonb, p_expires_at bigint
) returns boolean
language plpgsql security definer set search_path = public as $$
declare affected integer;
begin
  if length(p_key) > 160 or octet_length(p_state::text) > 4096 then
    raise exception 'INVALID_CONVERSATION_GUARD';
  end if;
  if p_version = 0 then
    insert into public.dream_conversation_guards(key,state,version,expires_at)
      values(p_key,p_state,1,p_expires_at) on conflict do nothing;
  else
    update public.dream_conversation_guards
      set state=p_state,version=version+1,expires_at=p_expires_at
      where key=p_key and version=p_version;
  end if;
  get diagnostics affected = row_count;
  -- Bounded cleanup, excluding the row participating in this CAS.
  delete from public.dream_conversation_guards where key in (
    select key from public.dream_conversation_guards
      where expires_at <= (extract(epoch from clock_timestamp()) * 1000)::bigint
      and key <> p_key order by expires_at limit 100
  );
  return affected = 1;
end;
$$;
revoke all on function public.compare_and_swap_conversation_guard(text,bigint,jsonb,bigint) from public, anon, authenticated;
grant execute on function public.compare_and_swap_conversation_guard(text,bigint,jsonb,bigint) to service_role;
