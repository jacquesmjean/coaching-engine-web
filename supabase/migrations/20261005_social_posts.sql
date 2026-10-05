-- ============================================================================
-- Social posts for the BCA Coaching Engine (plan, compose, approve, schedule, record what was published)
-- Run once in Supabase → SQL editor on project coaching-engine (uojsxmdnpwskxeueftgp). Idempotent.
--
-- Stage one: the console is the editorial desk. The team writes each post per platform with the
-- platform's limits in view, approves it, schedules it, copies it out, posts it on the BCA page,
-- and records the live URL back here. Direct publishing through the platforms' APIs is a later stage
-- that needs Meta, LinkedIn, Google and X app approvals first.
-- ============================================================================

create table if not exists public.social_posts (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  campaign_id   uuid references public.campaigns(id) on delete set null,
  platform      text not null check (platform in ('linkedin','facebook','instagram','youtube','x')),
  title         text,                                  -- YouTube title; optional elsewhere
  body          text not null default '',
  link_url      text,
  media_note    text,                                  -- which image or video goes with it
  document_id   uuid references public.documents(id) on delete set null,   -- creative kept in the vault
  scheduled_for timestamptz,
  status        text not null default 'draft' check (status in ('draft','approved','scheduled','published','cancelled')),
  published_url text,
  published_at  timestamptz,
  posted_by     uuid references public.people(id) on delete set null,
  approved_by   uuid references public.people(id) on delete set null,
  approved_at   timestamptz,
  created_by    uuid references public.people(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists social_posts_tenant_idx on public.social_posts (tenant_id, scheduled_for desc nulls last, created_at desc);
create index if not exists social_posts_campaign_idx on public.social_posts (campaign_id);
alter table public.social_posts enable row level security;
drop policy if exists social_posts_read on public.social_posts;
create policy social_posts_read on public.social_posts for select
  using (tenant_id = app.current_tenant_id() or app.is_platform_admin());
drop policy if exists social_posts_write on public.social_posts;
create policy social_posts_write on public.social_posts for all
  using ((tenant_id = app.current_tenant_id() and app.has_tenant_role(array['owner','admin'])) or app.is_platform_admin())
  with check ((tenant_id = app.current_tenant_id() and app.has_tenant_role(array['owner','admin'])) or app.is_platform_admin());
drop trigger if exists social_posts_touch on public.social_posts;
create trigger social_posts_touch before update on public.social_posts for each row execute function app.touch_updated_at();

-- BCA's pages, read by the console's "Open the page" button. Instagram is blank until BCA opens one.
update public.tenant_config
set business_rules = business_rules || jsonb_build_object('social_pages', coalesce(business_rules->'social_pages', '{}'::jsonb) || jsonb_build_object(
  'linkedin',  coalesce(business_rules->'social_pages'->>'linkedin',  'https://www.linkedin.com/company/bcaafrica/'),
  'facebook',  coalesce(business_rules->'social_pages'->>'facebook',  'https://www.facebook.com/bcaAfrica'),
  'instagram', coalesce(business_rules->'social_pages'->>'instagram', ''),
  'youtube',   coalesce(business_rules->'social_pages'->>'youtube',   'https://www.youtube.com/@bcaleadership1873'),
  'x',         coalesce(business_rules->'social_pages'->>'x',         'https://x.com/bcaAfrica')))
where tenant_id = '6b3d4f12-121f-4f17-9ab9-3be82c74ca03';

notify pgrst, 'reload schema';
select business_rules->'social_pages' as social_pages from public.tenant_config where tenant_id = '6b3d4f12-121f-4f17-9ab9-3be82c74ca03';
