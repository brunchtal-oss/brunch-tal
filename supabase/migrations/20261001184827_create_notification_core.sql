-- Story 2.12: notification core (AD-12).
-- Tables: notification_templates (one wording per type, seeded),
-- notifications (one row per recipient, wording frozen at creation) and
-- notification_jobs (the push queue; the worker arrives in story 5.8).
-- Functions: private.enqueue_notification, the only writer of notifications
-- and notification_jobs, and private.enqueue_admin_notification, which calls
-- it for every admin. No exposed RPC: mark_notifications_read and the screens
-- arrive in 5.7, template editing in 4.7.
-- AD-5 grants, AD-6 (enqueue runs last in the RPC's transaction), AD-23 (a
-- null recipient creates nothing).
--
-- The Hebrew seed rows are data (Tal edits title and body in the admin),
-- not code text. {name} = a value the calling RPC formats and passes in
-- p_vars.

-- ---------------------------------------------------------------------------
-- notification_templates
-- ---------------------------------------------------------------------------

-- One template per type. Recipient kind, channel (push) and body_mode are
-- fixed per type; only title and body are edited (4.7), which bumps version.
-- body_mode: template = rendered from body; template_or_override = the
-- caller may replace the body (Tal edits the rendered text); override = the
-- caller always supplies the body, so the template has none.
create table public.notification_templates (
  type text primary key
    check (type in (
      'purchase_new_card', 'purchase_repeat', 'booking_confirmed', 'reminder',
      'waitlist_spot', 'booking_cancelled', 'event_changed', 'event_cancelled',
      'entitlement_changed', 'card_expiring', 'broadcast',
      'admin_card_expiring', 'marketing_reminder'
    )),
  recipient_kind text not null check (recipient_kind in ('customer', 'admin')),
  push boolean not null,
  body_mode text not null check (body_mode in ('template', 'template_or_override', 'override')),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  body text check (body is null or char_length(btrim(body)) between 1 and 1000),
  version integer not null default 1 check (version > 0),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  constraint notification_templates_type_recipient_kind_key unique (type, recipient_kind),
  constraint notification_templates_admin_types_check
    check ((recipient_kind = 'admin') = (type in ('admin_card_expiring', 'marketing_reminder'))),
  constraint notification_templates_override_body_check
    check ((body_mode = 'override') = (body is null))
);

alter table public.notification_templates enable row level security;

insert into public.notification_templates (type, recipient_kind, push, body_mode, title, body)
values
  ('purchase_new_card', 'customer', true, 'template',
   'הכרטיסייה שלך מוכנה.',
   'מומלץ להירשם מראש לארבעת המפגשים כדי לבחור את התאריכים שנוחים לך'),
  ('purchase_repeat', 'customer', true, 'template',
   'הרכישה נוספה לחשבון שלך',
   '{product}, בתוקף עד {expires_on}'),
  ('booking_confirmed', 'customer', false, 'template',
   'ההרשמה אושרה',
   '{date} · {time} · {kind}'),
  ('reminder', 'customer', true, 'template',
   'מחכים לך בבראנץ׳',
   '{date} בשעה {time}. נתראה!'),
  ('waitlist_spot', 'customer', true, 'template',
   'התפנה מקום ב{date}',
   'כדי להירשם צריך כניסה מתאימה, והמקום מובטח רק אחרי שההרשמה מאושרת'),
  ('booking_cancelled', 'customer', false, 'template',
   'ההרשמה ל{date} בוטלה',
   '{outcome}'),
  ('event_changed', 'customer', true, 'template_or_override',
   'שינוי בבראנץ׳ של {date}',
   'הבראנץ׳ עבר ל{new_date} בשעה {new_time}. כל הפרטים ומה אפשר לעשות מחכים לך באזור האישי'),
  ('event_cancelled', 'customer', true, 'template_or_override',
   'הבראנץ׳ של {date} בוטל',
   'מצטערות על השינוי. כל הפרטים ומה אפשר לעשות מחכים לך באזור האישי'),
  ('entitlement_changed', 'customer', true, 'template',
   'עדכון בכרטיסייה שלך',
   'בתוקף עד {expires_on}, עם {units} כניסות פנויות. הפרטים באזור האישי'),
  ('card_expiring', 'customer', true, 'template',
   'הכרטיסייה שלך עומדת לפוג',
   'נשארו לך {units} כניסות פנויות עד {expires_on}. זה הזמן לבחור מפגשים'),
  ('broadcast', 'customer', true, 'override',
   'הודעה מטל',
   null),
  ('admin_card_expiring', 'admin', true, 'template',
   'הכרטיסייה של {customer} עומדת לפוג',
   '{units} כניסות פנויות, בתוקף עד {expires_on}'),
  ('marketing_reminder', 'admin', true, 'override',
   'תזכורת שיווק',
   null);

-- ---------------------------------------------------------------------------
-- notifications
-- ---------------------------------------------------------------------------

-- recipient_id = the Auth user id (profiles.id for a customer,
-- admin_roles.user_id for an admin), without FK (AD-3, AD-12). payload holds
-- the rendered wording, so editing a template never changes a notification
-- that already exists. dedupe_key = type:recipient_id:discriminator.
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null,
  recipient_kind text not null check (recipient_kind in ('customer', 'admin')),
  type text not null,
  payload jsonb not null
    check (
      jsonb_typeof(payload) = 'object'
      and jsonb_typeof(payload -> 'title') = 'string'
      and jsonb_typeof(payload -> 'body') = 'string'
      and jsonb_typeof(payload -> 'template_version') = 'number'
    ),
  target_path text not null,
  dedupe_key text not null unique,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  constraint notifications_type_recipient_kind_fkey
    foreign key (type, recipient_kind)
    references public.notification_templates (type, recipient_kind)
    on update restrict on delete restrict,
  constraint notifications_target_path_check
    check (
      (
        (recipient_kind = 'customer' and target_path ~ '^/me(/|\?|$)')
        or (recipient_kind = 'admin' and target_path ~ '^/admin(/|\?|$)')
      )
      and char_length(target_path) <= 500
      and strpos(target_path, '//') = 0
      and target_path !~ '[[:space:]\\]'
    )
);

alter table public.notifications enable row level security;

create index notifications_recipient_created_idx
  on public.notifications (recipient_id, created_at desc);
create index notifications_type_recipient_kind_idx
  on public.notifications (type, recipient_kind);

-- ---------------------------------------------------------------------------
-- notification_jobs (push queue; claimed and finished by the 5.8 worker)
-- ---------------------------------------------------------------------------

-- One job per notification. Internal table: RLS without policy, no grants.
create table public.notification_jobs (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null unique
    references public.notifications (id) on delete cascade,
  status text not null default 'queued'
    check (status in ('queued', 'sending', 'sent', 'failed')),
  scheduled_at timestamptz not null default now(),
  next_attempt_at timestamptz not null default now(),
  lease_until timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error text check (last_error is null or char_length(last_error) <= 2000),
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  constraint notification_jobs_lease_check
    check ((status = 'sending') = (lease_until is not null)),
  constraint notification_jobs_finished_check
    check ((status in ('sent', 'failed')) = (finished_at is not null))
);

alter table public.notification_jobs enable row level security;

-- ---------------------------------------------------------------------------
-- private helpers
-- ---------------------------------------------------------------------------

-- Replaces every {key} in p_text with p_vars ->> key, in one pass (a value
-- that contains braces is never rendered again). A placeholder without a
-- string or number value, or an unclosed brace, raises INVALID_INPUT, so no
-- notification keeps a literal {name}.
create function private.render_notification_text(p_text text, p_vars jsonb)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_out text := '';
  v_rest text := p_text;
  v_open integer;
  v_close integer;
  v_value jsonb;
begin
  if p_text is null then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  loop
    v_open := strpos(v_rest, '{');
    if v_open = 0 then
      if strpos(v_rest, '}') > 0 then
        raise exception 'INVALID_INPUT' using errcode = 'P0001';
      end if;
      return v_out || v_rest;
    end if;

    v_close := strpos(substr(v_rest, v_open + 1), '}');
    if v_close = 0 or strpos(substr(v_rest, 1, v_open - 1), '}') > 0 then
      raise exception 'INVALID_INPUT' using errcode = 'P0001';
    end if;

    v_value := p_vars -> substr(v_rest, v_open + 1, v_close - 1);
    if v_value is null or jsonb_typeof(v_value) not in ('string', 'number') then
      raise exception 'INVALID_INPUT' using errcode = 'P0001';
    end if;

    v_out := v_out || substr(v_rest, 1, v_open - 1) || (v_value #>> '{}');
    v_rest := substr(v_rest, v_open + v_close + 1);
  end loop;
end;
$$;

-- The only writer of notifications and notification_jobs (AD-12). Called
-- last in the RPC, inside its transaction (AD-6), as the definer that owns
-- the tables. A null recipient (a purchase not bound yet, AD-23) creates
-- nothing and returns null. The title is always rendered from the template;
-- the body is rendered from it too, or taken verbatim from p_body_override
-- when the type allows it (Tal edited the rendered text). The same
-- type:recipient:discriminator twice creates nothing the second time and
-- returns null.
create function private.enqueue_notification(
  p_recipient_id uuid,
  p_type text,
  p_discriminator text,
  p_vars jsonb,
  p_target_path text,
  p_body_override text default null
)
returns uuid
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_template public.notification_templates;
  v_title text;
  v_body text;
  v_id uuid;
begin
  select * into v_template
  from public.notification_templates t
  where t.type = p_type;

  if v_template.type is null
     or p_discriminator is null
     or btrim(p_discriminator) = ''
     or (p_vars is not null and jsonb_typeof(p_vars) <> 'object') then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  if p_body_override is not null then
    if v_template.body_mode = 'template'
       or char_length(btrim(p_body_override)) not between 1 and 2000 then
      raise exception 'INVALID_INPUT' using errcode = 'P0001';
    end if;
  elsif v_template.body_mode = 'override' then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  v_title := private.render_notification_text(v_template.title, p_vars);
  if p_body_override is not null then
    v_body := p_body_override;
  else
    v_body := private.render_notification_text(v_template.body, p_vars);
  end if;

  if p_recipient_id is null then
    return null;
  end if;

  if v_template.recipient_kind = 'customer' then
    if not exists (select 1 from public.profiles p where p.id = p_recipient_id) then
      raise exception 'INVALID_INPUT' using errcode = 'P0001';
    end if;
  elsif not exists (select 1 from public.admin_roles r where r.user_id = p_recipient_id) then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  insert into public.notifications (
    recipient_id, recipient_kind, type, payload, target_path, dedupe_key
  )
  values (
    p_recipient_id,
    v_template.recipient_kind,
    v_template.type,
    jsonb_build_object(
      'title', v_title,
      'body', v_body,
      'template_version', v_template.version
    ),
    p_target_path,
    v_template.type || ':' || p_recipient_id::text || ':' || p_discriminator
  )
  on conflict (dedupe_key) do nothing
  returning id into v_id;

  if v_id is not null and v_template.push then
    insert into public.notification_jobs (notification_id) values (v_id);
  end if;

  return v_id;
end;
$$;

-- One notification per admin (AD-12), in user_id order. Returns how many
-- were created (0 when every admin already has this discriminator).
create function private.enqueue_admin_notification(
  p_type text,
  p_discriminator text,
  p_vars jsonb,
  p_target_path text,
  p_body_override text default null
)
returns integer
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_admin uuid;
  v_created integer := 0;
begin
  if not exists (
    select 1
    from public.notification_templates t
    where t.type = p_type and t.recipient_kind = 'admin'
  ) then
    raise exception 'INVALID_INPUT' using errcode = 'P0001';
  end if;

  for v_admin in
    select r.user_id from public.admin_roles r order by r.user_id
  loop
    if private.enqueue_notification(
      v_admin, p_type, p_discriminator, p_vars, p_target_path, p_body_override
    ) is not null then
      v_created := v_created + 1;
    end if;
  end loop;

  return v_created;
end;
$$;

-- ---------------------------------------------------------------------------
-- Policies and table grants (AD-5)
-- ---------------------------------------------------------------------------

-- Every recipient (customer or admin) reads only her own notifications.
create policy notifications_authenticated_select on public.notifications
  for select to authenticated
  using (recipient_id = (select auth.uid()));

revoke all on table public.notification_templates from public, anon, authenticated, service_role;

revoke all on table public.notifications from public, anon, authenticated, service_role;
grant select on table public.notifications to authenticated;

revoke all on table public.notification_jobs from public, anon, authenticated, service_role;

-- Function grants (AD-5): internal helpers, no grant to any API role.
revoke execute on function private.render_notification_text(text, jsonb) from public, anon, authenticated, service_role;
revoke execute on function private.enqueue_notification(uuid, text, text, jsonb, text, text) from public, anon, authenticated, service_role;
revoke execute on function private.enqueue_admin_notification(text, text, jsonb, text, text) from public, anon, authenticated, service_role;
