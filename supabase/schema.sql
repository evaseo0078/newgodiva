-- =====================================================================
-- DropWise YYC — Household database (Supabase / PostgreSQL)
-- Run this whole file once in Supabase → SQL Editor → New query → Run.
--
-- Security model: Row Level Security (RLS) is ON for every table.
--   * You can only read rows that belong to YOUR household.
--   * You can only add records as yourself, into your own household.
--   * Creating / joining / leaving a household and managing members only
--     happens through the functions at the bottom, which check permissions.
--   * The quadrant ranking returns averages only — never another
--     household's records — and counts each household once.
-- =====================================================================

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------

-- One profile per account (display name shown as "recorded by").
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Neighbour' check (char_length(display_name) between 1 and 60),
  created_at   timestamptz not null default now()
);

-- A household. `residents` = people who actually live there (used for per-person maths);
-- app members are counted separately from household_members.
create table if not exists public.households (
  id                     uuid primary key default gen_random_uuid(),
  name                   text not null check (char_length(btrim(name)) between 1 and 60),
  quadrant               text not null check (quadrant in ('NW','NE','SW','SE')),
  residents              int  not null check (residents between 1 and 20),
  daily_goal_litres      int  check (daily_goal_litres between 20 and 10000),
  share_in_ranking       boolean not null default true,
  owner_id               uuid not null references auth.users(id),
  invite_code            text not null unique,
  invite_code_updated_at timestamptz not null default now(),
  created_at             timestamptz not null default now()
);

-- Which account belongs to which household. One household per account.
create table if not exists public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  role         text not null default 'member' check (role in ('owner','member')),
  joined_at    timestamptz not null default now(),
  primary key (household_id, user_id),
  unique (user_id)
);

-- MEASURED: water-meter readings (value + unit + time). Litres are computed by the database.
create table if not exists public.meter_readings (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  recorded_by  uuid not null references auth.users(id) default auth.uid(),
  read_at      timestamptz not null,
  value        numeric(14,4) not null check (value >= 0),
  unit         text not null check (unit in ('m3','ft3')),
  litres       numeric generated always as (value * case unit when 'm3' then 1000 else 28.316846592 end) stored,
  created_at   timestamptz not null default now()
);
create index if not exists meter_readings_household_time on public.meter_readings (household_id, read_at);

-- ESTIMATED: activity log (quick-add buttons and the shower timer). Never added to the meter total.
create table if not exists public.activity_logs (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  recorded_by  uuid not null references auth.users(id) default auth.uid(),
  activity     text not null check (activity in ('shower','laundry','dishwasher','toilet','bath','other')),
  litres       numeric(10,2) not null check (litres between 0 and 5000),
  minutes      numeric(6,2) check (minutes is null or minutes between 0 and 600),
  source       text not null default 'button' check (source in ('button','timer')),
  logged_at    timestamptz not null default now(),
  created_at   timestamptz not null default now()
);
create index if not exists activity_logs_household_time on public.activity_logs (household_id, logged_at);

-- ---------------------------------------------------------------------
-- Helper functions (SECURITY DEFINER so policies don't recurse)
-- ---------------------------------------------------------------------
create or replace function public.my_household_id() returns uuid
language sql stable security definer set search_path = public as $$
  select household_id from public.household_members where user_id = auth.uid()
$$;

create or replace function public.is_household_owner(hid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.household_members
                 where household_id = hid and user_id = auth.uid() and role = 'owner')
$$;

create or replace function public.is_household_member(hid uuid, uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.household_members where household_id = hid and user_id = uid)
$$;

-- New account → profile row (name from Google, the sign-up form, or the email).
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, left(coalesce(nullif(btrim(new.raw_user_meta_data->>'full_name'), ''),
                                nullif(btrim(new.raw_user_meta_data->>'name'), ''),
                                nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
                                'Neighbour'), 60))
  on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
alter table public.profiles          enable row level security;
alter table public.households        enable row level security;
alter table public.household_members enable row level security;
alter table public.meter_readings    enable row level security;
alter table public.activity_logs     enable row level security;

-- Guests (anon) get nothing from the tables.
revoke all on public.profiles, public.households, public.household_members,
              public.meter_readings, public.activity_logs from anon;

-- profiles: see yourself and the members of your household; edit only your own name.
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_household_member(public.my_household_id(), id));
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- households: members can read their own household; only the owner can edit (limited columns).
drop policy if exists households_select on public.households;
create policy households_select on public.households for select to authenticated
  using (id = public.my_household_id());
drop policy if exists households_update on public.households;
create policy households_update on public.households for update to authenticated
  using (public.is_household_owner(id)) with check (public.is_household_owner(id));
revoke insert, update, delete on public.households from authenticated;
grant update (name, quadrant, residents, daily_goal_litres, share_in_ranking) on public.households to authenticated;

-- household_members: read your own household's member list. Changes only via functions below.
drop policy if exists members_select on public.household_members;
create policy members_select on public.household_members for select to authenticated
  using (household_id = public.my_household_id());
revoke insert, update, delete on public.household_members from authenticated;

-- meter_readings + activity_logs: read your household; add as yourself; delete your own (owner: any in the household).
drop policy if exists readings_select on public.meter_readings;
create policy readings_select on public.meter_readings for select to authenticated
  using (household_id = public.my_household_id());
drop policy if exists readings_insert on public.meter_readings;
create policy readings_insert on public.meter_readings for insert to authenticated
  with check (household_id = public.my_household_id()
              and (recorded_by = auth.uid()
                   or (public.is_household_owner(household_id) and public.is_household_member(household_id, recorded_by))));
drop policy if exists readings_delete on public.meter_readings;
create policy readings_delete on public.meter_readings for delete to authenticated
  using (household_id = public.my_household_id() and (recorded_by = auth.uid() or public.is_household_owner(household_id)));
revoke update on public.meter_readings from authenticated;

drop policy if exists logs_select on public.activity_logs;
create policy logs_select on public.activity_logs for select to authenticated
  using (household_id = public.my_household_id());
drop policy if exists logs_insert on public.activity_logs;
create policy logs_insert on public.activity_logs for insert to authenticated
  with check (household_id = public.my_household_id()
              and (recorded_by = auth.uid()
                   or (public.is_household_owner(household_id) and public.is_household_member(household_id, recorded_by))));
drop policy if exists logs_delete on public.activity_logs;
create policy logs_delete on public.activity_logs for delete to authenticated
  using (household_id = public.my_household_id() and (recorded_by = auth.uid() or public.is_household_owner(household_id)));
revoke update on public.activity_logs from authenticated;

-- ---------------------------------------------------------------------
-- Household functions (the only way to create/join/leave/manage)
-- Errors use readable codes the app translates: invalid_code, already_in_household, not_owner, ...
-- ---------------------------------------------------------------------
create or replace function public.gen_invite_code() returns text
language plpgsql volatile security definer set search_path = public, extensions as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- no 0/O/1/I to avoid typos
  b bytea; code text;
begin
  loop
    b := extensions.gen_random_bytes(8);
    code := '';
    for i in 0..7 loop code := code || substr(alphabet, (get_byte(b, i) % 32) + 1, 1); end loop;
    exit when not exists (select 1 from public.households where invite_code = code);
  end loop;
  return code;
end $$;

create or replace function public.create_household(p_name text, p_quadrant text, p_residents int)
returns public.households
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); h public.households;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  if exists (select 1 from public.household_members where user_id = uid) then raise exception 'already_in_household'; end if;
  insert into public.households (name, quadrant, residents, owner_id, invite_code)
  values (btrim(p_name), upper(btrim(p_quadrant)), p_residents, uid, public.gen_invite_code())
  returning * into h;
  insert into public.household_members (household_id, user_id, role) values (h.id, uid, 'owner');
  return h;
end $$;

create or replace function public.join_household(p_code text)
returns public.households
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); h public.households; clean text;
begin
  if uid is null then raise exception 'not_authenticated'; end if;
  clean := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  select * into h from public.households where invite_code = clean;
  if not found then raise exception 'invalid_code'; end if;
  if exists (select 1 from public.household_members where user_id = uid) then raise exception 'already_in_household'; end if;
  if (select count(*) from public.household_members where household_id = h.id) >= 20 then raise exception 'household_full'; end if;
  insert into public.household_members (household_id, user_id, role) values (h.id, uid, 'member');
  return h;
end $$;

create or replace function public.regenerate_invite_code(p_household uuid) returns text
language plpgsql security definer set search_path = public as $$
declare code text;
begin
  if not public.is_household_owner(p_household) then raise exception 'not_owner'; end if;
  code := public.gen_invite_code();
  update public.households set invite_code = code, invite_code_updated_at = now() where id = p_household;
  return code;
end $$;

create or replace function public.remove_member(p_household uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_household_owner(p_household) then raise exception 'not_owner'; end if;
  if p_user = auth.uid() then raise exception 'owner_cannot_remove_self'; end if;
  delete from public.household_members where household_id = p_household and user_id = p_user;
  if not found then raise exception 'not_a_member'; end if;
end $$;

create or replace function public.transfer_ownership(p_household uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_household_owner(p_household) then raise exception 'not_owner'; end if;
  if not public.is_household_member(p_household, p_user) then raise exception 'not_a_member'; end if;
  update public.household_members set role = 'member' where household_id = p_household and user_id = auth.uid();
  update public.household_members set role = 'owner'  where household_id = p_household and user_id = p_user;
  update public.households set owner_id = p_user where id = p_household;
end $$;

-- Members can leave. The owner must hand over first; an owner who is the last member deletes the household.
create or replace function public.leave_household() returns text
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); m public.household_members; others int;
begin
  select * into m from public.household_members where user_id = uid;
  if not found then raise exception 'not_in_household'; end if;
  select count(*) into others from public.household_members where household_id = m.household_id and user_id <> uid;
  if m.role = 'owner' and others > 0 then raise exception 'owner_must_transfer'; end if;
  if m.role = 'owner' then
    delete from public.households where id = m.household_id;   -- last person out: household and its records are deleted
    return 'household_deleted';
  end if;
  delete from public.household_members where household_id = m.household_id and user_id = uid;
  return 'left';
end $$;

-- Quadrant ranking: one value per household (litres per RESIDENT per day from the meter),
-- averaged per quadrant. Returns aggregates only. p_min_households hides quadrants with too few homes.
create or replace function public.quadrant_ranking(p_min_households int default 1)
returns table (quadrant text, households int, avg_lpd int, prev_avg_lpd int, change_pct int)
language sql stable security definer set search_path = public as $$
  with r as (
    select h.id, h.quadrant, h.residents, m.read_at, m.litres,
           case when m.read_at >= now() - interval '7 days' then 'this' else 'last' end as period
    from public.households h
    join public.meter_readings m on m.household_id = h.id
    where h.share_in_ranking and m.read_at >= now() - interval '14 days' and m.read_at <= now() + interval '5 minutes'
  ),
  per_household as (            -- exactly one row per household per period
    select id, quadrant, period,
           (max(litres) - min(litres)) / greatest(extract(epoch from max(read_at) - min(read_at)) / 86400.0, 0.5) / max(residents) as lpd
    from r group by id, quadrant, period
    having count(*) >= 2 and max(read_at) - min(read_at) >= interval '12 hours'
  ),
  q as (
    select quadrant,
           count(*) filter (where period = 'this')::int as households,
           avg(lpd) filter (where period = 'this') as this_lpd,
           avg(lpd) filter (where period = 'last') as last_lpd
    from per_household group by quadrant
  )
  select quadrant, households, round(this_lpd)::int, round(last_lpd)::int,
         case when last_lpd > 0 then round((this_lpd - last_lpd) / last_lpd * 100)::int end
  from q
  where households >= greatest(p_min_households, 1)
  order by this_lpd asc
$$;

-- Function permissions: signed-in users only (ranking is also open to guests — it's aggregate data).
revoke all on function public.gen_invite_code() from public;
revoke all on function public.create_household(text, text, int), public.join_household(text),
                public.regenerate_invite_code(uuid), public.remove_member(uuid, uuid),
                public.transfer_ownership(uuid, uuid), public.leave_household() from public, anon;
grant execute on function public.create_household(text, text, int), public.join_household(text),
                 public.regenerate_invite_code(uuid), public.remove_member(uuid, uuid),
                 public.transfer_ownership(uuid, uuid), public.leave_household() to authenticated;
revoke all on function public.quadrant_ranking(int) from public;
grant execute on function public.quadrant_ranking(int) to anon, authenticated;

-- Live updates for household members (Supabase Realtime respects RLS).
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    begin alter publication supabase_realtime add table public.meter_readings; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.activity_logs; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.household_members; exception when duplicate_object then null; end;
    begin alter publication supabase_realtime add table public.households; exception when duplicate_object then null; end;
  end if;
end $$;

-- ===== Personal records (also in supabase/personal_records.sql) =====

alter table public.meter_readings alter column household_id drop not null;
alter table public.activity_logs  alter column household_id drop not null;
create index if not exists meter_readings_personal on public.meter_readings (recorded_by, read_at) where household_id is null;
create index if not exists activity_logs_personal  on public.activity_logs  (recorded_by, logged_at) where household_id is null;

-- Readings: your household's rows, or your own personal rows.
drop policy if exists readings_select on public.meter_readings;
create policy readings_select on public.meter_readings for select to authenticated
  using (household_id = public.my_household_id()
         or (household_id is null and recorded_by = auth.uid()));

drop policy if exists readings_insert on public.meter_readings;
create policy readings_insert on public.meter_readings for insert to authenticated
  with check ((household_id = public.my_household_id()
               and (recorded_by = auth.uid()
                    or (public.is_household_owner(household_id) and public.is_household_member(household_id, recorded_by))))
              or (household_id is null and recorded_by = auth.uid()));

drop policy if exists readings_delete on public.meter_readings;
create policy readings_delete on public.meter_readings for delete to authenticated
  using ((household_id = public.my_household_id() and (recorded_by = auth.uid() or public.is_household_owner(household_id)))
         or (household_id is null and recorded_by = auth.uid()));

-- Activity logs: same rules.
drop policy if exists logs_select on public.activity_logs;
create policy logs_select on public.activity_logs for select to authenticated
  using (household_id = public.my_household_id()
         or (household_id is null and recorded_by = auth.uid()));

drop policy if exists logs_insert on public.activity_logs;
create policy logs_insert on public.activity_logs for insert to authenticated
  with check ((household_id = public.my_household_id()
               and (recorded_by = auth.uid()
                    or (public.is_household_owner(household_id) and public.is_household_member(household_id, recorded_by))))
              or (household_id is null and recorded_by = auth.uid()));

drop policy if exists logs_delete on public.activity_logs;
create policy logs_delete on public.activity_logs for delete to authenticated
  using ((household_id = public.my_household_id() and (recorded_by = auth.uid() or public.is_household_owner(household_id)))
         or (household_id is null and recorded_by = auth.uid()));
