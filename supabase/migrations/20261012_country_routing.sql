-- ============================================================================
-- Enquiry ownership by country (Claudia's table, 7 Oct 2026)
-- Run once in Supabase → SQL editor on project coaching-engine (uojsxmdnpwskxeueftgp). Idempotent.
--
-- Every enquiry still lands in info@bcaleadership.com. On top of that, each new request is now
-- assigned to the admin who owns the visitor's country, and that admin is copied on the alert:
--   Andrea Blankson  Ghana, Nigeria, South Africa, Kenya, Rwanda
--   Maya Ng'ombe     Malawi, Uganda, Tanzania, Sierra Leone, Gambia, Zambia
--   Claudia Tete     Francophone Africa, North Africa, everything else (the default)
-- The table lives in tenant_config.business_rules.country_routing and can be edited in the
-- console (Inbound requests → "Who owns which country").
-- ============================================================================

-- 1. Andrea and Maya as people (owners of requests). Login accounts are invited separately in
--    Supabase Auth; when they exist, link them by email (step 4).
insert into public.people (id, tenant_id, first_name, last_name, email, title, preferred_language, timezone, status)
select gen_random_uuid(), '6b3d4f12-121f-4f17-9ab9-3be82c74ca03', 'Andrea', 'Blankson', 'ablankson@bcaleadership.com', 'Admin', 'en', 'UTC', 'active'
where not exists (select 1 from public.people where tenant_id = '6b3d4f12-121f-4f17-9ab9-3be82c74ca03' and email = 'ablankson@bcaleadership.com');
insert into public.people (id, tenant_id, first_name, last_name, email, title, preferred_language, timezone, status)
select gen_random_uuid(), '6b3d4f12-121f-4f17-9ab9-3be82c74ca03', 'Maya', 'Ng''ombe', 'mngombe@bcaleadership.com', 'Admin', 'en', 'UTC', 'active'
where not exists (select 1 from public.people where tenant_id = '6b3d4f12-121f-4f17-9ab9-3be82c74ca03' and email = 'mngombe@bcaleadership.com');

-- 2. The routing table: country → person id. "default" catches every other country and blank ones.
update public.tenant_config
set business_rules = business_rules || jsonb_build_object('country_routing', jsonb_build_object(
  'default', (select id from public.people where tenant_id = '6b3d4f12-121f-4f17-9ab9-3be82c74ca03' and email = 'ctete@bcaleadership.com' limit 1),
  'owners', (
    select jsonb_object_agg(p.id, jsonb_build_object('name', p.first_name || ' ' || p.last_name, 'email', p.email, 'countries', c.list))
    from (values
      ('ablankson@bcaleadership.com', '["Ghana","Nigeria","South Africa","Kenya","Rwanda"]'::jsonb),
      ('mngombe@bcaleadership.com',   '["Malawi","Uganda","Tanzania","Sierra Leone","Gambia","Zambia"]'::jsonb),
      ('ctete@bcaleadership.com',     '["Francophone Africa","North Africa","Everything else"]'::jsonb)
    ) as c(email, list)
    join public.people p on p.email = c.email and p.tenant_id = '6b3d4f12-121f-4f17-9ab9-3be82c74ca03'
  )))
where tenant_id = '6b3d4f12-121f-4f17-9ab9-3be82c74ca03';

-- 3. Backfill: open requests that have nobody yet get their owner by country.
with owners as (
  select key::uuid as person_id, value->'countries' as countries
  from public.tenant_config, jsonb_each(business_rules->'country_routing'->'owners')
  where tenant_id = '6b3d4f12-121f-4f17-9ab9-3be82c74ca03'
)
update public.requests r
set owner_id = coalesce(
  (select o.person_id from owners o where r.country is not null and o.countries ? r.country limit 1),
  (select (business_rules->'country_routing'->>'default')::uuid from public.tenant_config where tenant_id = r.tenant_id))
where r.tenant_id = '6b3d4f12-121f-4f17-9ab9-3be82c74ca03' and r.owner_id is null and r.first_response_at is null
  and r.status not in ('declined','dormant','won');

-- 4. Link login accounts by email, now and whenever they are invited later (safe to re-run).
update public.people p set user_id = u.id
from auth.users u
where p.tenant_id = '6b3d4f12-121f-4f17-9ab9-3be82c74ca03' and p.user_id is null and lower(u.email) = lower(p.email)
  and p.email in ('ablankson@bcaleadership.com','mngombe@bcaleadership.com');

-- 5. BCA's Instagram page (Claudia, 7 Oct 2026), read by the console's "Open the page" button.
update public.tenant_config
set business_rules = jsonb_set(business_rules, '{social_pages,instagram}', '"https://www.instagram.com/bcaafrica"'::jsonb, true)
where tenant_id = '6b3d4f12-121f-4f17-9ab9-3be82c74ca03';

notify pgrst, 'reload schema';
select business_rules->'country_routing' as country_routing from public.tenant_config where tenant_id = '6b3d4f12-121f-4f17-9ab9-3be82c74ca03';
