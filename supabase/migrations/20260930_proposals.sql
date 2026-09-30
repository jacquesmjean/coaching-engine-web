-- ============================================================================
-- Proposals for the BCA Coaching Engine
-- Run once in Supabase → SQL editor on project coaching-engine (uojsxmdnpwskxeueftgp),
-- AFTER 20260930_vault_and_worklog.sql. Safe to re-run: every statement is idempotent.
--
-- public.proposals ALREADY EXISTS from the first build (0 rows on 30 Sept 2026) with
-- number, opportunity_id, organization_id, person_id, title, value_minor, currency,
-- language, status, version, document_url, sent_at, first_viewed_at, decided_at,
-- valid_until, contract_id, owner_id. This script extends it rather than replacing it:
-- lines, a private link token, open counting, decision note, kind, intro and terms.
-- Statuses: the existing set (draft, internal_review, sent, viewed, accepted, declined,
-- expired, superseded) plus withdrawn. The console shows "viewed" as Opened.
-- ============================================================================

-- ── 1. Extend proposals
alter table public.proposals
  add column if not exists kind           text not null default 'corporate_membership',
  add column if not exists intro          text,
  add column if not exists terms          text,
  add column if not exists notes          text,
  add column if not exists public_token   text,
  add column if not exists last_opened_at timestamptz,
  add column if not exists open_count     int not null default 0,
  add column if not exists decision_note  text,
  add column if not exists document_id    uuid references public.documents(id) on delete set null,
  add column if not exists created_by     uuid references public.people(id) on delete set null;

alter table public.proposals alter column public_token set default encode(gen_random_bytes(24), 'hex');
update public.proposals set public_token = encode(gen_random_bytes(24), 'hex') where public_token is null;
alter table public.proposals alter column public_token set not null;
create unique index if not exists proposals_public_token_key on public.proposals (public_token);

alter table public.proposals drop constraint if exists proposals_kind_check;
alter table public.proposals add constraint proposals_kind_check
  check (kind in ('corporate_membership','sponsorship','coaching_package','consulting','project_management','business_matching','conference','other'));
alter table public.proposals drop constraint if exists proposals_status_check;
alter table public.proposals add constraint proposals_status_check
  check (status in ('draft','internal_review','sent','viewed','accepted','declined','expired','superseded','withdrawn'));

create index if not exists proposals_tenant_idx on public.proposals (tenant_id, created_at desc);
create index if not exists proposals_status_idx on public.proposals (tenant_id, status);

-- Coaches may draft and send proposals too (existing write policy was owner/admin only).
drop policy if exists proposals_tenant_write on public.proposals;
create policy proposals_tenant_write on public.proposals for all
  using ((tenant_id = app.current_tenant_id() and app.has_tenant_role(array['owner','admin','coach'])) or app.is_platform_admin())
  with check ((tenant_id = app.current_tenant_id() and app.has_tenant_role(array['owner','admin','coach'])) or app.is_platform_admin());

-- Numbering: P-<year>-<4 digits>, per tenant, assigned on insert when not supplied.
create or replace function app.next_proposal_number(p_tenant uuid) returns text
language plpgsql as $$
declare y text := to_char(now(), 'YYYY'); n int;
begin
  select coalesce(max(nullif(regexp_replace(number, '^P-\d{4}-', ''), '')::int), 0) + 1 into n
  from public.proposals where tenant_id = p_tenant and number ~ ('^P-' || y || '-\d+$');
  return 'P-' || y || '-' || lpad(n::text, 4, '0');
end $$;

create or replace function app.proposals_number_default() returns trigger
language plpgsql as $$
begin
  if new.number is null or new.number = '' then new.number := app.next_proposal_number(new.tenant_id); end if;
  return new;
end $$;
drop trigger if exists proposals_number on public.proposals;
create trigger proposals_number before insert on public.proposals for each row execute function app.proposals_number_default();

-- ── 2. Lines (new)
create table if not exists public.proposal_lines (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  proposal_id  uuid not null references public.proposals(id) on delete cascade,
  description  text not null,
  detail       text,
  qty          numeric(10,2) not null default 1,
  unit_minor   bigint not null default 0,
  sort         int not null default 100
);
create index if not exists proposal_lines_idx on public.proposal_lines (proposal_id, sort);
alter table public.proposal_lines enable row level security;
drop policy if exists proposal_lines_read on public.proposal_lines;
create policy proposal_lines_read on public.proposal_lines for select
  using (tenant_id = app.current_tenant_id() or app.is_platform_admin());
drop policy if exists proposal_lines_write on public.proposal_lines;
create policy proposal_lines_write on public.proposal_lines for all
  using ((tenant_id = app.current_tenant_id() and app.has_tenant_role(array['owner','admin','coach'])) or app.is_platform_admin())
  with check ((tenant_id = app.current_tenant_id() and app.has_tenant_role(array['owner','admin','coach'])) or app.is_platform_admin());

-- Keep proposals.value_minor equal to the sum of its lines.
create or replace function app.proposal_total_refresh() returns trigger
language plpgsql security definer set search_path = public as $$
declare pid uuid := coalesce(new.proposal_id, old.proposal_id);
begin
  update public.proposals p set value_minor = coalesce((select sum(round(l.qty * l.unit_minor)) from public.proposal_lines l where l.proposal_id = pid), 0)
  where p.id = pid;
  return null;
end $$;
drop trigger if exists proposal_lines_total on public.proposal_lines;
create trigger proposal_lines_total after insert or update or delete on public.proposal_lines
  for each row execute function app.proposal_total_refresh();

-- ── 3. Events (new): what happened to the proposal, in order
create table if not exists public.proposal_events (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  proposal_id  uuid not null references public.proposals(id) on delete cascade,
  kind         text not null check (kind in ('created','sent','resent','viewed','accepted','declined','withdrawn','expired','note')),
  person_id    uuid references public.people(id) on delete set null,   -- staff member, when one acted
  detail       text,
  at           timestamptz not null default now()
);
create index if not exists proposal_events_idx on public.proposal_events (proposal_id, at desc);
alter table public.proposal_events enable row level security;
drop policy if exists proposal_events_read on public.proposal_events;
create policy proposal_events_read on public.proposal_events for select
  using (tenant_id = app.current_tenant_id() or app.is_platform_admin());
drop policy if exists proposal_events_insert on public.proposal_events;
create policy proposal_events_insert on public.proposal_events for insert
  with check ((tenant_id = app.current_tenant_id() and app.has_tenant_role(array['owner','admin','coach'])) or app.is_platform_admin());

-- ── 4. Work tracker: record the unlock
with t as (select '6b3d4f12-121f-4f17-9ab9-3be82c74ca03'::uuid as id)
update public.worklog w set status = 'in_progress', detail = 'Module unlocked 30 Sept: build, send, track opens and decisions. Waiting on BCA''s corporate proposal template and sponsorship rate card to load the standard lines.'
from t where w.tenant_id = t.id and w.title = 'Contract builder and Proposals';
