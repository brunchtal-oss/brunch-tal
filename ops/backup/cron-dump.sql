-- Story 6.3: the scheduled jobs as SQL. `supabase db dump` skips the cron
-- schema (first dev run, 2026-11-20), so the backup carries cron.sql: one
-- `select cron.schedule(<jobname>, <schedule>, <command>);` per row of
-- cron.job, ordered by jobname. Read-only (backup_reader reads cron.job
-- through pg_read_all_data and bypassrls); run with
-- `psql -X -At -v ON_ERROR_STOP=1 -f cron-dump.sql`. Running the output on a
-- restored project schedules the same jobs again (cron.schedule replaces a
-- job with the same name).
select format(
  'select cron.schedule(%L, %L, %L);',
  j.jobname, j.schedule, j.command
)
from cron.job j
order by j.jobname;
