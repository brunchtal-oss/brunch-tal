-- Story 3.8: a credit option whose session is rescheduled to before the
-- credit's origin session is replaced with reason 'moved'.
-- Drops a constraint, so the user runs it in the SQL Editor (AGENTS.md).

alter table public.credit_options
  drop constraint credit_options_replaced_reason_check;

alter table public.credit_options
  add constraint credit_options_replaced_reason_check
  check (replaced_reason in ('full', 'event_cancelled', 'booked', 'moved'));
