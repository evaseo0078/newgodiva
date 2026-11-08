-- DropWise YYC — personal records (run once in Supabase SQL Editor, after schema.sql; safe to re-run).
-- Lets a logged-in person who isn't in a household keep their records in the database, so they show
-- up on every device they log in from. Personal rows have household_id = NULL and belong only to
-- recorded_by. They never count in the quadrant ranking (that still uses households only).

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
