-- Online payments, PR A: the table's bucket check must accept the new
-- 'checkout' bucket that public.rate_limit_hit counts (20261120100720).
-- Without it every guest checkout failed on rate_limits_bucket_check.
-- One statement: the constraint is replaced, never absent.

alter table private.rate_limits
  drop constraint rate_limits_bucket_check,
  add constraint rate_limits_bucket_check
    check (bucket in ('login', 'token', 'email', 'checkout'));
