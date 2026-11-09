-- Story 2.16, second step: drop the two old overloads of the customers list
-- and export, replaced in 20261109224655_special_brunch_interest.sql by the
-- versions with p_interest (the code calls only those). Drop only; run by
-- the user in the SQL Editor (a drop is not applied through the MCP), then
-- registered in supabase_migrations.schema_migrations.

drop function public.admin_list_customers(text, text);
drop function public.admin_export_customers(text, text, text[], text);
