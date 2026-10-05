-- ============================================================================
-- Content plans, review trail and the blog for the BCA Coaching Engine
-- Run once in Supabase → SQL editor on project coaching-engine (uojsxmdnpwskxeueftgp). Idempotent.
-- Requires 20261005_social_posts.sql to have run first.
--
-- 1. content_plans: the six-month strategic campaign (title, headline, period, objectives, pillars,
--    key dates). Social posts and blog posts hang off a plan.
-- 2. content_reviews: one trail for every piece of content (plan, social post, blog post):
--    who reviewed, what they said, what they decided.
-- 3. blog_posts: the monthly blog in four languages, published to bcaleadership.com by the
--    bca-blog function (writes the page into the site repo through GitHub; Vercel deploys).
-- ============================================================================

-- ── 1. Six-month plans
create table if not exists public.content_plans (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  title         text not null,                 -- internal name, e.g. "H1 2027: The Room"
  headline      text,                          -- the public header/theme that fronts the campaign
  period_start  date not null,
  period_end    date not null,
  objectives    text,                          -- what the half-year must achieve, in plain words
  pillars       jsonb not null default '[]'::jsonb,   -- ["Peer coaching", "MLC 2027", ...]
  key_dates     jsonb not null default '[]'::jsonb,   -- [{"on":"2027-03-12","what":"MLC Lagos"}]
  audience      text,
  channels      text[] not null default array['linkedin','facebook','instagram','youtube','x','blog','email'],
  monthly_blog_day int not null default 1 check (monthly_blog_day between 1 and 28),
  status        text not null default 'draft' check (status in ('draft','review','approved','active','closed')),
  notes         text,
  created_by    uuid references public.people(id) on delete set null,
  approved_by   uuid references public.people(id) on delete set null,
  approved_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (period_end > period_start)
);
create index if not exists content_plans_tenant_idx on public.content_plans (tenant_id, period_start desc);
alter table public.content_plans enable row level security;
drop policy if exists content_plans_read on public.content_plans;
create policy content_plans_read on public.content_plans for select using (tenant_id = app.current_tenant_id() or app.is_platform_admin());
drop policy if exists content_plans_write on public.content_plans;
create policy content_plans_write on public.content_plans for all
  using ((tenant_id = app.current_tenant_id() and app.has_tenant_role(array['owner','admin'])) or app.is_platform_admin())
  with check ((tenant_id = app.current_tenant_id() and app.has_tenant_role(array['owner','admin'])) or app.is_platform_admin());
drop trigger if exists content_plans_touch on public.content_plans;
create trigger content_plans_touch before update on public.content_plans for each row execute function app.touch_updated_at();

-- ── 2. Review trail (plans, social posts, blog posts)
create table if not exists public.content_reviews (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  entity      text not null check (entity in ('plan','social','blog')),
  entity_id   uuid not null,
  reviewer    uuid references public.people(id) on delete set null,
  decision    text not null default 'comment' check (decision in ('comment','changes','approved')),
  note        text,
  created_at  timestamptz not null default now()
);
create index if not exists content_reviews_idx on public.content_reviews (entity, entity_id, created_at desc);
alter table public.content_reviews enable row level security;
drop policy if exists content_reviews_read on public.content_reviews;
create policy content_reviews_read on public.content_reviews for select using (tenant_id = app.current_tenant_id() or app.is_platform_admin());
drop policy if exists content_reviews_insert on public.content_reviews;
create policy content_reviews_insert on public.content_reviews for insert
  with check ((tenant_id = app.current_tenant_id() and app.has_tenant_role(array['owner','admin','board'])) or app.is_platform_admin());

-- social posts hang off a plan
alter table public.social_posts add column if not exists plan_id uuid references public.content_plans(id) on delete set null;
create index if not exists social_posts_plan_idx on public.social_posts (plan_id);

-- ── 3. Blog, four languages, published to the website
create table if not exists public.blog_posts (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  plan_id       uuid references public.content_plans(id) on delete set null,
  slug          text not null,                 -- becomes insight-<slug>.html on the site
  title_en text, title_fr text, title_es text, title_pt text,
  excerpt_en text, excerpt_fr text, excerpt_es text, excerpt_pt text,   -- card text and meta description, ≤ 200 chars
  body_en text, body_fr text, body_es text, body_pt text,               -- plain paragraphs separated by blank lines; a line starting "## " is a heading
  author_name   text not null default 'Modupe Taylor-Pearce, Ph.D.',
  cover_document_id uuid references public.documents(id) on delete set null,  -- image kept in the vault
  cover_url     text,                          -- or a public image URL
  publish_on    date,                          -- the month's slot
  status        text not null default 'draft' check (status in ('draft','review','approved','published','archived')),
  published_at  timestamptz,
  published_url text,
  last_commit   text,
  created_by    uuid references public.people(id) on delete set null,
  approved_by   uuid references public.people(id) on delete set null,
  approved_at   timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (tenant_id, slug),
  check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
create index if not exists blog_posts_tenant_idx on public.blog_posts (tenant_id, publish_on desc nulls last);
alter table public.blog_posts enable row level security;
drop policy if exists blog_posts_read on public.blog_posts;
create policy blog_posts_read on public.blog_posts for select using (tenant_id = app.current_tenant_id() or app.is_platform_admin());
drop policy if exists blog_posts_write on public.blog_posts;
create policy blog_posts_write on public.blog_posts for all
  using ((tenant_id = app.current_tenant_id() and app.has_tenant_role(array['owner','admin'])) or app.is_platform_admin())
  with check ((tenant_id = app.current_tenant_id() and app.has_tenant_role(array['owner','admin'])) or app.is_platform_admin());
drop trigger if exists blog_posts_touch on public.blog_posts;
create trigger blog_posts_touch before update on public.blog_posts for each row execute function app.touch_updated_at();

-- Site repo the publisher writes to (the token itself lives in Edge Function secrets as GITHUB_TOKEN, never here).
update public.tenant_config
set business_rules = business_rules || jsonb_build_object('site_repo', coalesce(business_rules->'site_repo', '{}'::jsonb) || jsonb_build_object(
  'owner', coalesce(business_rules->'site_repo'->>'owner', 'jacquesmjean'),
  'repo',  coalesce(business_rules->'site_repo'->>'repo',  'bca-leadership-website'),
  'branch',coalesce(business_rules->'site_repo'->>'branch','main'),
  'base_url', coalesce(business_rules->'site_repo'->>'base_url','https://bcaleadership.com')))
where tenant_id = '6b3d4f12-121f-4f17-9ab9-3be82c74ca03';

notify pgrst, 'reload schema';
select business_rules->'site_repo' as site_repo from public.tenant_config where tenant_id = '6b3d4f12-121f-4f17-9ab9-3be82c74ca03';
