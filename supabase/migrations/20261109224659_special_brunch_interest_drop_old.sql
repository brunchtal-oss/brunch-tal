-- Story 2.16, second step: drop the old overloads of the customers list and
-- export. The code calls only the p_interests text[] versions of
-- 20261110135810_special_brunch_interest_multi.sql: the original ones
-- (before 2.16) and the p_interest text ones of
-- 20261109224655_special_brunch_interest.sql (phone-check fix, user
-- decision 2026-11-10: several special brunches at once) go. Drop only; run
-- by the user in the SQL Editor (a drop is not applied through the MCP),
-- then registered in supabase_migrations.schema_migrations.

drop function public.admin_list_customers(text, text);
drop function public.admin_export_customers(text, text, text[], text);
drop function public.admin_list_customers(text, text, text);
drop function public.admin_export_customers(text, text, text[], text, text);
