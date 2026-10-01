-- ============================================================================
-- Campaigns for the BCA Coaching Engine
-- Run once in Supabase → SQL editor on project coaching-engine (uojsxmdnpwskxeueftgp).
-- Safe to re-run: every statement is idempotent.
--
-- Email campaigns to audiences drawn from the engine's own records (members, leads,
-- recent enquirers), sent through Resend as info@bcaleadership.com in the brand shell,
-- with a one-click unsubscribe on every message and opens/clicks recorded per person.
-- ============================================================================

-- ── 1. Consent lives on the person, not the campaign.
alter table public.people
  add column if not exists marketing_opt_out    boolean not null default false,
  add column if not exists marketing_opt_out_at timestamptz,
  add column if not exists unsubscribe_token    text;
update public.people set unsubscribe_token = encode(gen_random_bytes(16), 'hex') where unsubscribe_token is null;
alter table public.people alter column unsubscribe_token set default encode(gen_random_bytes(16), 'hex');
create unique index if not exists people_unsubscribe_token_key on public.people (unsubscribe_token);

-- ── 2. Campaigns: the table ALREADY EXISTED from the first build as a planning table
--      (objective, channels, languages, regions, starts_on, ends_on, budget_minor, spend_minor; 3 rows on 30 Sept).
--      It is extended for email sending; nothing is dropped. Statuses keep the planning set and add the email life cycle.
-- campaigns already existed (planning table: objective, channels, languages, regions, dates, budget, spend). Extend it for email sending.
alter table public.campaigns
  add column if not exists audience        text not null default 'members_active',
  add column if not exists audience_filter jsonb not null default '{}'::jsonb,
  add column if not exists from_mailbox    text not null default 'info@bcaleadership.com',
  add column if not exists subject         text,
  add column if not exists preheader       text,
  add column if not exists body            text,
  add column if not exists cta_text        text,
  add column if not exists cta_url         text,
  add column if not exists utm_campaign    text,
  add column if not exists signer_name     text,
  add column if not exists signer_title    text,
  add column if not exists show_about      boolean not null default true,
  add column if not exists scheduled_for   timestamptz,
  add column if not exists approved_by     uuid references public.people(id) on delete set null,
  add column if not exists approved_at     timestamptz,
  add column if not exists last_test_at    timestamptz,
  add column if not exists sent_at         timestamptz,
  add column if not exists n_recipients    int not null default 0,
  add column if not exists n_sent          int not null default 0,
  add column if not exists n_delivered     int not null default 0,
  add column if not exists n_opened        int not null default 0,
  add column if not exists n_clicked       int not null default 0,
  add column if not exists n_bounced       int not null default 0,
  add column if not exists n_unsubscribed  int not null default 0,
  add column if not exists created_by      uuid references public.people(id) on delete set null;
alter table public.campaigns drop constraint if exists campaigns_audience_check;
alter table public.campaigns add constraint campaigns_audience_check
  check (audience in ('members_active','members_lapsed','leads_new','leads_all','enquirers_90d','everyone'));
alter table public.campaigns drop constraint if exists campaigns_status_check;
alter table public.campaigns add constraint campaigns_status_check
  check (status in ('planned','running','paused','completed','cancelled','draft','review','approved','scheduled','sending','sent'));
-- keep the original policies; drop the duplicates added on 30 Sept
drop policy if exists campaigns_read on public.campaigns;
drop policy if exists campaigns_write on public.campaigns;

create index if not exists campaigns_tenant_idx on public.campaigns (tenant_id, created_at desc);
notify pgrst, 'reload schema';

-- ── 3. One row per person per campaign: what was sent and what they did with it.
create table if not exists public.campaign_recipients (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  campaign_id  uuid not null references public.campaigns(id) on delete cascade,
  person_id    uuid references public.people(id) on delete set null,
  email        text not null,
  status       text not null default 'queued' check (status in ('queued','sent','delivered','opened','clicked','bounced','complained','failed','unsubscribed')),
  resend_id    text,
  error        text,
  sent_at      timestamptz,
  opened_at    timestamptz,
  clicked_at   timestamptz,
  unique (campaign_id, email)
);
create index if not exists campaign_recipients_idx on public.campaign_recipients (campaign_id, status);
create index if not exists campaign_recipients_resend_idx on public.campaign_recipients (resend_id);
alter table public.campaign_recipients enable row level security;
drop policy if exists campaign_recipients_read on public.campaign_recipients;
create policy campaign_recipients_read on public.campaign_recipients for select using (tenant_id = app.current_tenant_id() or app.is_platform_admin());

-- ── 4. Who a campaign goes to. Runs as the caller (RLS applies), so the console can preview it.
--      Opt-outs, people with no email, and anyone who bounced on an earlier campaign are excluded.
create or replace function public.campaign_audience(p_audience text, p_filter jsonb default '{}'::jsonb)
returns table (person_id uuid, email text, first_name text, last_name text, preferred_language text, country text)
language sql stable security invoker set search_path = public as $$
  with base as (
    select p.id, p.email, p.first_name, p.last_name, p.preferred_language, p.country
    from public.people p
    where p.email is not null and p.email <> '' and p.marketing_opt_out = false
      and (p_filter->>'country' is null or p.country = p_filter->>'country')
      and (p_filter->>'language' is null or p.preferred_language = p_filter->>'language')
      and not exists (select 1 from public.campaign_recipients r where r.person_id = p.id and r.status in ('bounced','complained'))
  )
  select distinct on (lower(b.email)) b.id, lower(b.email), b.first_name, b.last_name, b.preferred_language, b.country
  from base b
  where case p_audience
    when 'members_active' then exists (select 1 from public.memberships m where m.person_id = b.id and m.status = 'active')
    when 'members_lapsed' then exists (select 1 from public.memberships m where m.person_id = b.id and m.status in ('lapsed','cancelled'))
                              and not exists (select 1 from public.memberships m where m.person_id = b.id and m.status = 'active')
    when 'leads_new'      then exists (select 1 from public.leads l where l.person_id = b.id and l.status in ('new','working','nurturing'))
    when 'leads_all'      then exists (select 1 from public.leads l where l.person_id = b.id and l.status <> 'disqualified')
    when 'enquirers_90d'  then exists (select 1 from public.requests q where q.person_id = b.id and q.received_at > now() - interval '90 days')
    when 'everyone'       then true
    else false end
  order by lower(b.email), b.id;
$$;
revoke all on function public.campaign_audience(text, jsonb) from public;
grant execute on function public.campaign_audience(text, jsonb) to authenticated;

-- ── 5. Scheduled sends: every 10 minutes, ask the function to dispatch anything due.
--      Reuses the nudge key already in platform_secrets, so no new secret is created.
do $$
declare k text; jid int;
begin
  select value into k from public.platform_secrets where name = 'nudge_key';
  if k is null then raise notice 'nudge_key missing: scheduled sends will not run until it exists'; return; end if;
  select jobid into jid from cron.job where jobname = 'bca-campaign-dispatch';
  if jid is not null then perform cron.unschedule(jid); end if;
  perform cron.schedule('bca-campaign-dispatch', '*/10 * * * *',
    format($c$select net.http_post(url := 'https://uojsxmdnpwskxeueftgp.supabase.co/functions/v1/bca-campaign',
      headers := '{"Content-Type":"application/json","x-nudge-key":"%s"}'::jsonb,
      body := '{"action":"dispatch"}'::jsonb)$c$, k));
end $$;

-- ── 6. Work tracker
with t as (select '6b3d4f12-121f-4f17-9ab9-3be82c74ca03'::uuid as id)
update public.worklog w set status = 'in_progress', detail = 'Unlocked 30 Sept: campaigns run in the engine through Resend as info@. Audiences from members, leads and recent enquirers; brand shell; test send; one-click unsubscribe; opens and clicks per recipient via Resend webhook; UTM on every link.'
from t where w.tenant_id = t.id and w.title = 'Campaigns module: build or drop';
