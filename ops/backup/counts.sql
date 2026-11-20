-- Story 6.3: the row count of every table in public, plus auth.users,
-- storage.objects, as one JSON object {"schema.table": n}. Read-only; run
-- with `psql -X -At -v ON_ERROR_STOP=1 -f counts.sql`. backup.sh runs it
-- on production right after the dump (as backup_reader, bypassrls), and
-- drill.sh on the restored database, to compare with the backup's counts.
select coalesce(json_object_agg(t.name, t.n order by t.name), '{}'::json)
from (
  select
    format('%s.%s', n.nspname, c.relname) as name,
    (xpath(
      '/row/n/text()',
      query_to_xml(
        format('select count(*) as n from %I.%I', n.nspname, c.relname),
        false, true, ''
      )
    ))[1]::text::bigint as n
  from pg_catalog.pg_class c
  join pg_catalog.pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r', 'p')
    and not c.relispartition
    and (
      n.nspname = 'public'
      or (n.nspname = 'auth' and c.relname = 'users')
      or (n.nspname = 'storage' and c.relname = 'objects')
    )
) t;
