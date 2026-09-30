-- ============================================================================
-- Document vault + Work tracker (weekly agenda) for the BCA Coaching Engine
-- Run once in Supabase → SQL editor on project coaching-engine (uojsxmdnpwskxeueftgp).
-- Safe to re-run: every statement is idempotent.
-- ============================================================================

-- ── 1. Documents: one row per file in the vault, file bytes live in storage bucket "vault"
create table if not exists public.documents (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  title         text not null,
  category      text not null default 'working' check (category in ('working','board','agreement','brand','finance','report','other')),
  storage_path  text not null,                      -- <tenant_id>/<uuid>-<filename>
  file_name     text not null,
  mime_type     text,
  size_bytes    bigint,
  version       int  not null default 1,
  notes         text,
  uploaded_by   uuid references public.people(id) on delete set null,
  board_only    boolean not null default false,     -- only owner/admin/board roles may open
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists documents_tenant_idx on public.documents (tenant_id, created_at desc);
alter table public.documents enable row level security;
drop policy if exists documents_tenant_read on public.documents;
create policy documents_tenant_read on public.documents for select
  using (tenant_id = app.current_tenant_id() and (not board_only or app.has_tenant_role(array['owner','admin','board'])));
drop policy if exists documents_tenant_write on public.documents;
create policy documents_tenant_write on public.documents for all
  using (tenant_id = app.current_tenant_id() and app.has_tenant_role(array['owner','admin']))
  with check (tenant_id = app.current_tenant_id() and app.has_tenant_role(array['owner','admin']));
drop trigger if exists documents_touch on public.documents;
create trigger documents_touch before update on public.documents for each row execute function app.touch_updated_at();

-- "A record of who opened what and when" — the promise on the module tile.
create table if not exists public.document_access (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  person_id   uuid references public.people(id) on delete set null,
  action      text not null default 'opened' check (action in ('opened','uploaded','replaced','deleted')),
  at          timestamptz not null default now()
);
create index if not exists document_access_doc_idx on public.document_access (document_id, at desc);
alter table public.document_access enable row level security;
drop policy if exists document_access_read on public.document_access;
create policy document_access_read on public.document_access for select using (tenant_id = app.current_tenant_id());
drop policy if exists document_access_insert on public.document_access;
create policy document_access_insert on public.document_access for insert with check (tenant_id = app.current_tenant_id());

-- Storage bucket, private. Paths are <tenant_id>/... so the policies can scope by folder.
insert into storage.buckets (id, name, public, file_size_limit)
  values ('vault', 'vault', false, 52428800)
  on conflict (id) do nothing;
drop policy if exists vault_read on storage.objects;
create policy vault_read on storage.objects for select
  using (bucket_id = 'vault' and (storage.foldername(name))[1] = app.current_tenant_id()::text);
drop policy if exists vault_write on storage.objects;
create policy vault_write on storage.objects for insert
  with check (bucket_id = 'vault' and (storage.foldername(name))[1] = app.current_tenant_id()::text and app.has_tenant_role(array['owner','admin']));
drop policy if exists vault_update on storage.objects;
create policy vault_update on storage.objects for update
  using (bucket_id = 'vault' and (storage.foldername(name))[1] = app.current_tenant_id()::text and app.has_tenant_role(array['owner','admin']));
drop policy if exists vault_delete on storage.objects;
create policy vault_delete on storage.objects for delete
  using (bucket_id = 'vault' and (storage.foldername(name))[1] = app.current_tenant_id()::text and app.has_tenant_role(array['owner','admin']));

-- ── 2. Work tracker: one table, two views. Items with week_of appear on that week's agenda;
--      everything appears on the full tracker. Both sides add and update rows.
create table if not exists public.worklog (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  area        text not null check (area in ('website','engine','email','data','commercial','other')),
  title       text not null,
  detail      text,
  side        text not null default 'techfides' check (side in ('techfides','bca')),   -- who has the next action
  status      text not null default 'planned' check (status in ('done','in_progress','planned','waiting','blocked','dropped')),
  week_of     date,                                  -- Monday of the week it is scheduled for; null = backlog
  done_on     date,
  added_by    uuid references public.people(id) on delete set null,
  owner_id    uuid references public.people(id) on delete set null,
  sort        int not null default 100,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists worklog_tenant_week_idx on public.worklog (tenant_id, week_of, sort);
alter table public.worklog enable row level security;
drop policy if exists worklog_tenant_read on public.worklog;
create policy worklog_tenant_read on public.worklog for select using (tenant_id = app.current_tenant_id() or app.is_platform_admin());
drop policy if exists worklog_tenant_write on public.worklog;
create policy worklog_tenant_write on public.worklog for all
  using ((tenant_id = app.current_tenant_id() and app.has_tenant_role(array['owner','admin','coach'])) or app.is_platform_admin())
  with check ((tenant_id = app.current_tenant_id() and app.has_tenant_role(array['owner','admin','coach'])) or app.is_platform_admin());
drop trigger if exists worklog_touch on public.worklog;
create trigger worklog_touch before update on public.worklog for each row execute function app.touch_updated_at();

-- ── 3. Seed the tracker with the 30 Sept 2026 assessment, so it is not empty on day one.
--      (Re-running does nothing: rows are matched on title.)
with t as (select '6b3d4f12-121f-4f17-9ab9-3be82c74ca03'::uuid as id),
seed(area, title, detail, side, status, done_on, sort) as (values
  -- WEBSITE — done
  ('website','New site live on bcaleadership.com','23 pages, EN/FR/ES/PT, Vercel. Replaced the EasyWP WordPress site.','techfides','done','2026-08-18',10),
  ('website','Forms and Concierge wired to the engine','Every form and Concierge hand-off lands in Inbound requests.','techfides','done','2026-08-16',11),
  ('website','Web analytics on every page','Cookieless Vercel analytics. Measurement began 14 Sept; no history before that.','techfides','done','2026-09-14',12),
  ('website','Six reasons on Why BCA, one-line header','All four languages.','techfides','done','2026-09-17',13),
  ('website','Email authentication fixed','SPF corrected, DKIM and DMARC added. Mail from bcaleadership.com now authenticates.','techfides','done','2026-09-18',14),
  ('website','GEO patch','One set of figures sitewide (45 coaches, 5,000+ leaders), definition block, pricing table, FAQ, Person schema, IndexNow. Score 36 → ~70.','techfides','done','2026-09-24',15),
  ('website','Launch gate','Build fails if placeholder text is present, so unfinished copy cannot ship.','techfides','done','2026-09-24',16),
  -- WEBSITE — TechFides to do
  ('website','Per-coach profile pages on The Bench','Bios are in the Drive doc BCA shared. 45 pages, one per coach.','techfides','planned',null,30),
  ('website','Structured data on The Bench, Services, Coaching, Podcast','JSON-LD so AI search can quote these pages.','techfides','planned',null,31),
  ('website','Switch site contact addresses from admin@ to info@','Every page shows admin@; Nii''s rules say enquiries go to info@. Waiting on the routing decision below.','techfides','waiting',null,32),
  ('website','UTM capture on the site','So LinkedIn, Instagram and Facebook traffic can be told apart for the board dashboard.','techfides','planned',null,33),
  ('website','Leadership Diagnostic','The board funnel Modupe asked for needs a Diagnostic step. It does not exist on the site yet.','techfides','planned',null,34),
  ('website','Old WordPress site at old.bcaleadership.com','Kept for reference. Needs EasyWP domain add and a certificate.','techfides','planned',null,35),
  ('website','SEO and AEO launched','Search and AI-answer optimisation shipped and addressed sitewide.','techfides','done','2026-09-24',17),
  ('website','GEO re-review','Promised to BCA for late October.','techfides','planned',null,36),
  -- WEBSITE — waiting on BCA
  ('website','Membership and coaching agreement text','Live pages still show placeholder legal text above a working signature. Every signature is stamped with the placeholder version so it can be re-papered.','bca','waiting',null,50),
  ('website','Terms and Privacy pages','Pending BCA counsel.','bca','waiting',null,51),
  ('website','63% revenue-growth survey','Sample size and date, so the claim can go back on the homepage.','bca','waiting',null,52),
  ('website','Next MLC date and city','For the conference block and events schema.','bca','waiting',null,53),
  ('website','Named author with bio and photo','For Insights essays and Person schema.','bca','waiting',null,54),
  ('website','Shop prices for "Coming soon" products','Or a decision to hide them.','bca','waiting',null,55),
  ('website','Google Search Console DNS record','So search performance can be reported.','bca','waiting',null,56),
  ('website','Board photos: Victor Williams, Adrian Carr','Real photos to replace the placeholders on Governance.','bca','waiting',null,57),
  ('website','Roster check: Susan Banda-Mudiwa','Kenya or Malawi.','bca','waiting',null,58),
  ('email','Routing decision: everything to info@, or split','Nii''s rules split enquiries (info@) from applications and bookings (admin@). Claudia asked for all to info@. One setting on our side once decided.','bca','waiting',null,59),
  -- ENGINE — done
  ('engine','Console rebuilt in the layout BCA knows','Overview, Members (187), The Bench, Sessions, Billing (190 invoices), Leads (1,735), Pipeline, Website, Board Room, Team access.','techfides','done','2026-09-14',110),
  ('engine','Inbound requests, full journey','Acknowledgment to the visitor in 4 languages, alert to the owner mailbox, reply from the console as info@/admin@, assign, convert to consultation or opportunity, weekday reminder of anything past 24h.','techfides','done','2026-09-18',111),
  ('engine','Branded email shell','BCA palette, stripe and logo on every email the engine sends.','techfides','done','2026-09-18',112),
  ('engine','Search on Inbound requests and Leads','','techfides','done','2026-09-18',113),
  ('engine','Visitors by country on Website','Africa vs rest of world, per-country table, device split.','techfides','done','2026-09-18',114),
  ('engine','Document vault and Work tracker','This screen.','techfides','done','2026-09-30',115),
  -- ENGINE — TechFides to do
  ('engine','Payments through Stripe','Card payments, invoices, renewals. Blocked until BCA supplies the Stripe account and keys.','techfides','blocked',null,130),
  ('engine','Itemised invoices and branded invoice template','invoice_lines is empty, so there is nothing to itemise yet. Template needs the inputs listed under BCA.','techfides','waiting',null,131),
  ('engine','Bring in the 2000-series WooCommerce invoices','Missing from the migration.','techfides','waiting',null,132),
  ('engine','Fix the four Stripe-ID invoices','Secka, Ghanem, Mbida, Chisompola carry Stripe IDs instead of BCA numbers.','techfides','waiting',null,133),
  ('engine','Coach fee allocations','Rules engine for the 50% / 75% / contract splits. Table needs redesign first.','techfides','planned',null,134),
  ('engine','QuickBooks Online sync','Stripe charges to QBO as sales receipts or paid invoices. New scope, to be priced.','techfides','planned',null,135),
  ('engine','Subscriptions and renewals','Table is empty; terms were kept by hand in Jetpack.','techfides','planned',null,136),
  ('engine','Board dashboard','Traffic source filters, landing pages, funnel Visitor → Diagnostic → Booked call, GEO/SEO rankings. Needs UTM capture and the Diagnostic.','techfides','planned',null,137),
  ('engine','Contract builder and Proposals','Need BCA''s approved agreement text and proposal template.','techfides','waiting',null,138),
  ('engine','Move email sending to a BCA-owned account','bcaleadership.com is verified under a TechFides account for now.','techfides','planned',null,139),
  -- ENGINE / COMMERCIAL — waiting on BCA
  ('commercial','Stripe account in BCA''s legal name, restricted API key, webhook secret','Confirm Stripe serves a Mauritius entity.','bca','waiting',null,150),
  ('commercial','Payment terms decision','Which products are annual subscriptions, which are one-off, whether payment plans stay.','bca','waiting',null,151),
  ('commercial','QuickBooks mapping','Which account Stripe charges post to; sales receipts or paid invoices.','bca','waiting',null,152),
  ('commercial','Invoice template inputs','Legal name, registered address, registration and tax numbers, bank details, footer terms, who approves, languages. Logos and brand guide received 18 Sept.','bca','waiting',null,153),
  ('data','5000-series numbers for the four Stripe invoices; what the 3000 and 1000 series are','And confirm the $30,000 Secka payment.','bca','waiting',null,154),
  ('data','WooCommerce export of 2000-series invoices','','bca','waiting',null,155),
  ('engine','Clear the test entries in Inbound requests','Claudia ×4, Nii, Andrea ×2, John Doe/Die, one from Yemen. Mark Declined so board numbers are clean.','bca','waiting',null,156),
  ('engine','Answer the one real lead','Mwaba Mupinde, Basic membership application, 23 Aug. Still unanswered.','bca','waiting',null,157)
)
insert into public.worklog (tenant_id, area, title, detail, side, status, done_on, sort)
select t.id, s.area, s.title, nullif(s.detail,''), s.side, s.status, s.done_on::date, s.sort
from seed s, t
where not exists (select 1 from public.worklog w where w.tenant_id = t.id and w.title = s.title);

-- The first week's agenda (week of Mon 5 Oct 2026): what BCA can expect and what they owe.
with t as (select '6b3d4f12-121f-4f17-9ab9-3be82c74ca03'::uuid as id)
update public.worklog w set week_of = date '2026-10-05'
from t where w.tenant_id = t.id and w.week_of is null and w.title in (
  'Per-coach profile pages on The Bench',
  'Structured data on The Bench, Services, Coaching, Podcast',
  'UTM capture on the site',
  'Routing decision: everything to info@, or split',
  'Clear the test entries in Inbound requests',
  'Answer the one real lead',
  'Stripe account in BCA''s legal name, restricted API key, webhook secret',
  'Membership and coaching agreement text'
);
