-- ============================================================================
-- Approval by email link, posting performance, and the approver on file
-- Run once in Supabase → SQL editor on project coaching-engine (uojsxmdnpwskxeueftgp). Idempotent.
--
-- 1. approval_requests: one row per "Send for approval" (plan, social post, blog post). The link in the
--    email carries the token; bca-approve shows the content and records the decision with no login.
-- 2. social_posts performance columns: the team types the platform numbers in weekly until the pages
--    are connected for automatic reporting.
-- 3. The approver on file (tenant_config.business_rules.approver), prefilled in the console.
-- ============================================================================

create table if not exists public.approval_requests (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  entity          text not null check (entity in ('plan','social','blog')),
  entity_id       uuid not null,
  token           text not null unique,
  recipient_name  text,
  recipient_email text not null,
  message         text,
  sent_by         uuid references public.people(id) on delete set null,
  sent_at         timestamptz not null default now(),
  expires_at      timestamptz not null default now() + interval '21 days',
  opened_at       timestamptz,
  decided_at      timestamptz,
  decision        text check (decision in ('approved','changes')),
  note            text
);
create index if not exists approval_requests_entity_idx on public.approval_requests (entity, entity_id, sent_at desc);
alter table public.approval_requests enable row level security;
drop policy if exists approval_requests_read on public.approval_requests;
create policy approval_requests_read on public.approval_requests for select
  using (tenant_id = app.current_tenant_id() or app.is_platform_admin());
-- Inserts and updates happen only through bca-approve (service role); nobody writes tokens from the console.

alter table public.social_posts
  add column if not exists impressions int,
  add column if not exists reactions   int,
  add column if not exists comments    int,
  add column if not exists shares      int,
  add column if not exists clicks      int,
  add column if not exists metrics_at  timestamptz,
  add column if not exists metrics_note text;

update public.tenant_config
set business_rules = business_rules || jsonb_build_object('approver', coalesce(business_rules->'approver',
  '{"name":"Dr. Modupe Taylor-Pearce","email":"modupetp@gmail.com"}'::jsonb))
where tenant_id = '6b3d4f12-121f-4f17-9ab9-3be82c74ca03';

notify pgrst, 'reload schema';
select business_rules->'approver' as approver from public.tenant_config where tenant_id = '6b3d4f12-121f-4f17-9ab9-3be82c74ca03';
