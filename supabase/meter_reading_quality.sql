-- DropWise YYC — meter reading quality (run once in Supabase SQL Editor, after schema.sql and personal_records.sql; safe to re-run).
-- Additive only: existing rows keep working and default to source = 'manual', is_reset = false.
--   source   — where the value came from. The app now saves 'manual' only; 'photo' / 'photo-edited' stay allowed
--              so rows saved by the earlier photo-reading version remain valid.
--   is_reset — first reading after the meter was replaced or rolled over. It starts a new baseline, so the
--              drop from the previous reading is never counted as (negative) usage.

alter table public.meter_readings add column if not exists source text not null default 'manual';
alter table public.meter_readings add column if not exists is_reset boolean not null default false;
do $$ begin
  alter table public.meter_readings add constraint meter_readings_source_check check (source in ('manual', 'photo', 'photo-edited'));
exception when duplicate_object then null; end $$;

-- Quadrant ranking: litres per RESIDENT per day, from consecutive readings of households that opted in.
-- Each step between two readings counts only when it stays inside one week, isn't a reset and isn't negative.
-- A household needs at least 12 hours of valid steps in a week. Returns aggregates only.
create or replace function public.quadrant_ranking(p_min_households int default 1)
returns table (quadrant text, households int, avg_lpd int, prev_avg_lpd int, change_pct int)
language sql stable security definer set search_path = public as $$
  with r as (
    select h.id, h.quadrant, h.residents, m.read_at, m.litres, m.is_reset,
           case when m.read_at >= now() - interval '7 days' then 'this' else 'last' end as period
    from public.households h
    join public.meter_readings m on m.household_id = h.id
    where h.share_in_ranking and m.read_at >= now() - interval '14 days' and m.read_at <= now() + interval '5 minutes'
  ),
  steps as (
    select id, quadrant, residents, period, is_reset,
           litres - lag(litres) over w as dl,
           extract(epoch from read_at - lag(read_at) over w) as ds,
           lag(period) over w as prev_period
    from r
    window w as (partition by id order by read_at)
  ),
  per_household as (            -- exactly one row per household per period
    select id, quadrant, period,
           sum(dl) / greatest(sum(ds) / 86400.0, 0.5) / max(residents) as lpd
    from steps
    where dl is not null and dl >= 0 and not is_reset and prev_period = period
    group by id, quadrant, period
    having sum(ds) >= 12 * 3600
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
revoke all on function public.quadrant_ranking(int) from public;
grant execute on function public.quadrant_ranking(int) to anon, authenticated;
