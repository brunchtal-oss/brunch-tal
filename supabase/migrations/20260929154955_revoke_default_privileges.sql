-- AD-5: every grant is explicit. Supabase's default privileges hand new
-- tables, sequences and functions to anon, authenticated and service_role;
-- this migration removes that for objects created by postgres in public and
-- private, so later migrations must grant exactly what each object needs.

create schema if not exists private;

-- private is never exposed through the Data API (not in exposed schemas).
revoke all on schema private from public, anon, authenticated, service_role;
grant usage on schema private to authenticated;

-- public: no automatic grants on new objects for any API role.
alter default privileges for role postgres in schema public
  revoke all on tables from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke all on sequences from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated, service_role;

-- private: same.
alter default privileges for role postgres in schema private
  revoke all on tables from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema private
  revoke all on sequences from public, anon, authenticated, service_role;
alter default privileges for role postgres in schema private
  revoke execute on functions from public, anon, authenticated, service_role;

-- PostgreSQL grants EXECUTE to PUBLIC on every new function through a
-- global (not per-schema) default that a per-schema command cannot remove.
-- Remove it globally for functions created by postgres; every function
-- migration still revokes and grants explicitly (AD-5).
alter default privileges for role postgres
  revoke execute on functions from public;
