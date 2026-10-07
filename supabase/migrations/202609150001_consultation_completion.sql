-- Preserve existing reservations as charged; completion/repair requests cost zero.
alter table public.dream_message_reservations add column if not exists charged boolean not null default true;

create or replace function public.reserve_dream_message_v2(p_reading_id text, p_client_message_id text, p_charge boolean)
returns table (reservation_status text, remaining_questions integer)
language plpgsql security definer set search_path = public as $$
declare
  e public.dream_entitlements%rowtype;
  r public.dream_message_reservations%rowtype;
  remaining integer;
  stale_charged integer;
begin
  select * into e from public.dream_entitlements where reading_id=p_reading_id for update;
  if not found or not e.full_reading_purchased then return query select 'not_entitled'::text,0; return; end if;
  -- Longer than the complete planner + two generation/review timeout budget.
  select count(*)::integer into stale_charged from public.dream_message_reservations
    where reading_id=p_reading_id and status='reserved' and charged and reserved_at < now()-interval '30 minutes';
  update public.dream_message_reservations set status='released',updated_at=now()
    where reading_id=p_reading_id and status='reserved' and reserved_at < now()-interval '30 minutes';
  if stale_charged>0 then
    e.used_questions:=greatest(0,e.used_questions-stale_charged);
    update public.dream_entitlements set used_questions=e.used_questions,updated_at=now() where reading_id=p_reading_id;
  end if;
  remaining := greatest(0,e.base_question_allowance+e.extra_question_allowance-e.used_questions);
  select * into r from public.dream_message_reservations where reading_id=p_reading_id and client_message_id=p_client_message_id for update;
  if found and r.status='complete' then return query select 'duplicate_complete'::text,remaining; return; end if;
  if found and r.status='reserved' then return query select 'duplicate_pending'::text,remaining; return; end if;
  if exists(select 1 from public.dream_message_reservations where reading_id=p_reading_id and status='reserved' and (not p_charge or not charged)) then
    return query select 'duplicate_pending'::text,remaining; return;
  end if;
  if p_charge and remaining=0 then return query select 'credits_exhausted'::text,0; return; end if;
  if p_charge then
    update public.dream_entitlements set used_questions=used_questions+1,updated_at=now() where reading_id=p_reading_id;
    remaining:=remaining-1;
  end if;
  insert into public.dream_message_reservations(reading_id,client_message_id,status,reserved_at,updated_at,charged)
  values(p_reading_id,p_client_message_id,'reserved',now(),now(),p_charge)
  on conflict(reading_id,client_message_id) do update set status='reserved',reserved_at=now(),updated_at=now(),charged=excluded.charged;
  return query select 'reserved'::text,remaining;
end;
$$;

create or replace function public.release_dream_followup(p_reading_id text,p_client_message_id text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.dream_message_reservations%rowtype;
begin
  perform 1 from public.dream_entitlements where reading_id=p_reading_id for update;
  select * into r from public.dream_message_reservations where reading_id=p_reading_id and client_message_id=p_client_message_id for update;
  if found and r.status='reserved' then
    update public.dream_message_reservations set status='released',updated_at=now() where reading_id=p_reading_id and client_message_id=p_client_message_id;
    if r.charged then update public.dream_entitlements set used_questions=greatest(0,used_questions-1),updated_at=now() where reading_id=p_reading_id; end if;
  end if;
end;
$$;

revoke all on function public.reserve_dream_message_v2(text,text,boolean) from public,anon,authenticated;
grant execute on function public.reserve_dream_message_v2(text,text,boolean) to service_role;
revoke all on function public.release_dream_followup(text,text) from public,anon,authenticated;
grant execute on function public.release_dream_followup(text,text) to service_role;
