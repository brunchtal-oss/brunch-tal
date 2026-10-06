-- Story 3.6 review fixes: private.returned_validity was replaced by
-- private.returned_expiry in 20261006001058, and nothing calls it any more.
-- A drop, so it runs in the SQL Editor, not through the MCP.
drop function private.returned_validity(text, smallint[], integer, date, integer);
