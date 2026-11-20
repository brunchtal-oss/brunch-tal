-- Story 6.3: a read-only role for the external daily backup (pg_dump from
-- GitHub Actions in the business's private backup repo, ops/backup).
--
-- backup_reader reads everything and writes nothing:
--   - member of pg_read_all_data (SELECT on every table, view and sequence,
--     USAGE on every schema), and of nothing else;
--   - BYPASSRLS, because pg_dump refuses a table whose RLS would hide rows;
--   - not superuser, no CREATEROLE, CREATEDB or REPLICATION, and no grant on
--     any object (supabase/tests/grants.test.ts, scripts/prod-check.mjs).
--
-- It is created NOLOGIN. Login and its password are set by the user in the
-- SQL Editor of each project (dev for the rehearsal, then production), and
-- the password never enters a file:
--   alter role backup_reader with login password '<from the password manager>';
-- The pooler user is backup_reader.<project-ref> (ops/backup/README.md).
--
-- Idempotent: a rerun (or a restore whose roles.sql already created the
-- role) leaves it as it is, login included.

do $$
begin
  if not exists (
    select 1 from pg_catalog.pg_roles where rolname = 'backup_reader'
  ) then
    create role backup_reader with nologin bypassrls;
  end if;
end
$$;

grant pg_read_all_data to backup_reader;
