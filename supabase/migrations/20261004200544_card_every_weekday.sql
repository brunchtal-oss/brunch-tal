-- A card is valid on every weekday: only the session kind (regular/couple)
-- limits it (user decision 2026-10-04 after the 3.2 phone check; overrides
-- source section 2 "שני וחמישי", logged in the SPEC memlog). The
-- redemption-weekdays field stays on products (hidden behind a link in the
-- admin form) for a product Tal chooses to restrict.
-- Data only: the seeded card product and the card entitlements already
-- granted (their eligibility_snapshot keeps the purchase-time history).

update public.products
set allowed_weekdays = null
where type = 'card'
  and allowed_weekdays is not null;

update public.entitlements
set allowed_weekdays = null
where kind = 'card'
  and allowed_weekdays is not null;
