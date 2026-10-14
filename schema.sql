-- Run once in a NEW Supabase project. All employee data remains behind RLS.
begin;
create table public.odc_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('admin','staff'))
);
alter table public.odc_members enable row level security;
revoke all on public.odc_members from anon, authenticated;
grant select on public.odc_members to authenticated;
create policy own_membership on public.odc_members for select to authenticated
  using (user_id = (select auth.uid()));

create table public.odc_state (
  id integer primary key check (id = 1),
  revision integer not null default 0,
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id),
  check (jsonb_typeof(payload) = 'object'),
  check (payload ?& array['staff','patterns','shifts','phones']),
  check (jsonb_typeof(payload->'staff') = 'array' and jsonb_array_length(payload->'staff') = 6),
  check (jsonb_typeof(payload->'patterns') = 'object'),
  check (jsonb_typeof(payload->'shifts') = 'object'),
  check (jsonb_typeof(payload->'phones') = 'object')
);
alter table public.odc_state enable row level security;
revoke all on public.odc_state from anon, authenticated;
grant select on public.odc_state to authenticated;
create policy member_read on public.odc_state for select to authenticated
  using (exists (select 1 from public.odc_members where user_id = (select auth.uid())));

-- Only this RPC can update state. Atomic revision check prevents lost updates.
create function public.odc_save_state(expected_revision integer, new_payload jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare next_revision integer;
begin
  if not exists (select 1 from public.odc_members where user_id = auth.uid() and role = 'admin') then
    raise exception 'Not authorized' using errcode = '42501';
  end if;
  update public.odc_state
    set payload = new_payload, revision = revision + 1, updated_at = now(), updated_by = auth.uid()
    where id = 1 and revision = expected_revision
    returning revision into next_revision;
  return next_revision;
end;
$$;
revoke all on function public.odc_save_state(integer,jsonb) from public, anon, authenticated;
grant execute on function public.odc_save_state(integer,jsonb) to authenticated;
insert into public.odc_state (id,payload) values (1,
  '{"staff":["スタッフA","スタッフB","スタッフC","スタッフD","スタッフE","スタッフF"],"patterns":{"early":["09:00","18:00",60],"normal":["09:30","18:30",60],"late":["10:00","19:00",60]},"shifts":{},"phones":{}}');
commit;
