-- All website enquiries route to info@bcaleadership.com (Jacques, 5 Oct 2026).
-- Run once in Supabase → SQL editor, project coaching-engine. Takes effect immediately; no redeploy needed
-- because bca-intake reads tenant_config.business_rules.inbound_routing on every request.
update public.tenant_config
set business_rules = jsonb_set(
  business_rules, '{inbound_routing}',
  (select jsonb_object_agg(k, 'info@bcaleadership.com') from jsonb_object_keys(business_rules->'inbound_routing') k))
where tenant_id = '6b3d4f12-121f-4f17-9ab9-3be82c74ca03';

-- Open, unanswered requests move to info@ so the console and the reply sender agree.
update public.requests
set owner_mailbox = 'info@bcaleadership.com'
where tenant_id = '6b3d4f12-121f-4f17-9ab9-3be82c74ca03'
  and owner_mailbox = 'admin@bcaleadership.com' and first_response_at is null;

select business_rules->'inbound_routing' as routing from public.tenant_config where tenant_id = '6b3d4f12-121f-4f17-9ab9-3be82c74ca03';

-- Work tracker: the admin@ → info@ item is done once this file has run and the site commit e0c652d is live.
update public.worklog set status = 'done', detail = 'Done 5 Oct: every website enquiry routes to info@ (tenant_config.inbound_routing); site shows info@ everywhere; open requests moved to info@.'
where tenant_id = '6b3d4f12-121f-4f17-9ab9-3be82c74ca03' and title ilike '%admin@%info@%';
