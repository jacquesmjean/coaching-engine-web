-- ============================================================================
-- Proposals for the BCA Coaching Engine
-- Run once in Supabase → SQL editor on project coaching-engine (uojsxmdnpwskxeueftgp),
-- AFTER 20260930_vault_and_worklog.sql. Safe to re-run: every statement is idempotent.
--
-- A proposal is built in the console from lines (description, quantity, unit price),
-- sent to one recipient as a branded email with a private link, and the recipient's
-- opens and decision are recorded as events. The public link is served by the edge
-- function bca-proposal using the row's public_token; nothing here is readable
-- without a session except through that function.
-- ============================================================================

-- ── 1. Proposals
create table if not exists public.proposals (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  number          text not null,                         -- P-2026-0001, per tenant
  title           text not null,
  kind            text not null default 'corporate_membership'
                  check (kind in ('corporate_membership','sponsorship','coaching_package','consulting','project_management','business_matching','conference','other')),
  status          text not null default 'draft'
                  check (status in ('draft','sent','opened','accepted','declined','expired','withdrawn')),
  organization_id uuid references public.organizations(id) on delete set null,
  person_id       uuid references public.people(id) on delete set null,      -- the recipient
  opportunity_id  uuid references public.opportunities(id) on delete set null,
  owner_id        uuid references public.people(id) on delete set null,      -- BCA staff who owns it
  currency        text not null default 'USD',
  total_minor     bigint not null default 0,             -- maintained by trigger from proposal_lines
  valid_until     date,
  intro           text,                                  -- opening paragraph on the proposal page
  terms           text,                                  -- payment terms and conditions shown on the page
  notes           text,                                  -- internal, never shown to the recipient
  public_token    text not null unique default encode(gen_random_bytes(24), 'hex'),
  sent_at         timestamptz,
  opened_at       timestamptz,                           -- first open
  last_opened_at  timestamptz,
  open_count      int not null default 0,
  decided_at      timestamptz,
  decision_note   text,                                  -- what the recipient typed when accepting or declining
  document_id     uuid references public.documents(id) on delete set null,  -- optional PDF in the vault
  created_by      uuid references public.people(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (tenant_id, number)
);
create index if not exists proposals_tenant_idx on public.proposals (tenant_id, created_at desc);
create index if not exists proposals_status_idx on public.proposals (tenant_id, status);

alter table public.proposals enable row level security;
drop policy if exists proposals_tenant_read on public.proposals;
create policy proposals_tenant_read on public.proposals for select
  using (tenant_id = app.current_tenant_id() or app.is_platform_admin());
drop policy if exists proposals_tenant_write on public.proposals;
create policy proposals_tenant_write on public.proposals for all
  using ((tenant_id = app.current_tenant_id() and app.has_tenant_role(array['owner','admin','coach'])) or app.is_platform_admin())
  with check ((tenant_id = app.current_tenant_id() and app.has_tenant_role(array['owner','admin','coach'])) or app.is_platform_admin());
drop trigger if exists proposals_touch on public.proposals;
create trigger proposals_touch before update on public.proposals for each row execute function app.touch_updated_at();

-- Numbering: P-<year>-<4 digits>, per tenant, assigned on insert when not supplied.
create or replace function app.next_proposal_number(p_tenant uuid) returns text
language plpgsql as $$
declare y text := to_char(now(), 'YYYY'); n int;
begin
  select coalesce(max(substring(number from 8)::int), 0) + 1 into n
  from public.proposals where tenant_id = p_tenant and number like 'P-' || y || '-%';
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

-- ── 2. Lines
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

-- Keep proposals.total_minor equal to the sum of its lines.
create or replace function app.proposal_total_refresh() returns trigger
language plpgsql security definer set search_path = public as $$
declare pid uuid := coalesce(new.proposal_id, old.proposal_id);
begin
  update public.proposals p set total_minor = coalesce((select sum(round(l.qty * l.unit_minor)) from public.proposal_lines l where l.proposal_id = pid), 0)
  where p.id = pid;
  return null;
end $$;
drop trigger if exists proposal_lines_total on public.proposal_lines;
create trigger proposal_lines_total after insert or update or delete on public.proposal_lines
  for each row execute function app.proposal_total_refresh();

-- ── 3. Events: what happened to the proposal, in order
create table if not exists public.proposal_events (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id) on delete cascade,
  proposal_id  uuid not null references public.proposals(id) on delete cascade,
  kind         text not null check (kind in ('created','sent','resent','opened','accepted','declined','withdrawn','expired','note')),
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
