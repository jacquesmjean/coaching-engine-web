-- ============================================================================
-- Board Room for the BCA Coaching Engine: directors, meetings, agendas, attendance, minutes,
-- resolutions and votes, actions, declarations of interest.
-- Run once in Supabase → SQL editor on project coaching-engine (uojsxmdnpwskxeueftgp). Idempotent.
--
-- Who may do what (row level security, below):
--   read   owner, admin, board members of the tenant
--   write  owner, admin, and the board's officers (chair, vice-chair, secretary) through their own login
--   votes and RSVPs  each director writes their own row; officers and admins may record on their behalf
-- Jacques, 12 Oct 2026: the Chair (Wilben Short) keeps the room; admins help.
-- ============================================================================

-- ── Directors
create table if not exists public.board_members (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  person_id       uuid references public.people(id) on delete set null,   -- links the login, when they have one
  full_name       text not null,
  email           text,
  role            text not null default 'director' check (role in ('chair','vice_chair','director','ceo','secretary','observer')),
  title_line      text,                      -- as shown on the site, e.g. "Board Member · CEO"
  country         text,
  bio             text,
  linkedin_url    text,
  photo_url       text,
  committees      text[] not null default '{}',
  responsibilities text,
  term_start      date,
  term_end        date,
  status          text not null default 'active' check (status in ('active','past')),
  sort            int not null default 100,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists board_members_tenant_idx on public.board_members (tenant_id, status, sort);

-- ── Meetings
create table if not exists public.board_meetings (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  title           text not null,
  kind            text not null default 'board' check (kind in ('board','agm','committee','special')),
  starts_at       timestamptz not null,
  ends_at         timestamptz,
  location        text,
  video_url       text,
  chair_id        uuid references public.board_members(id) on delete set null,
  secretary_id    uuid references public.board_members(id) on delete set null,
  quorum          int,                       -- number of directors needed; blank = majority of active directors
  status          text not null default 'planned' check (status in ('planned','notice_sent','held','cancelled')),
  notice_sent_at  timestamptz,
  reminder_sent_at timestamptz,
  pack_document_ids uuid[] not null default '{}',   -- board pack from the vault
  minutes         text,
  minutes_status  text not null default 'none' check (minutes_status in ('none','draft','circulated','approved')),
  minutes_circulated_at timestamptz,
  minutes_approved_at   timestamptz,
  minutes_approved_by   uuid references public.board_members(id) on delete set null,
  notes           text,
  created_by      uuid references public.people(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists board_meetings_tenant_idx on public.board_meetings (tenant_id, starts_at desc);

create table if not exists public.board_agenda_items (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  meeting_id      uuid not null references public.board_meetings(id) on delete cascade,
  sort            int not null default 10,
  title           text not null,
  kind            text not null default 'discussion' check (kind in ('information','discussion','decision','approval')),
  presenter_id    uuid references public.board_members(id) on delete set null,
  minutes_planned int,
  notes           text,
  document_ids    uuid[] not null default '{}',
  created_at      timestamptz not null default now()
);
create index if not exists board_agenda_meeting_idx on public.board_agenda_items (meeting_id, sort);

create table if not exists public.board_attendance (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  meeting_id      uuid not null references public.board_meetings(id) on delete cascade,
  member_id       uuid not null references public.board_members(id) on delete cascade,
  rsvp            text not null default 'pending' check (rsvp in ('pending','yes','no','maybe')),
  attended        boolean,                   -- recorded by the secretary after the meeting
  apologies       text,
  updated_at      timestamptz not null default now(),
  unique (meeting_id, member_id)
);

-- ── Resolutions and votes
create table if not exists public.board_resolutions (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  meeting_id      uuid references public.board_meetings(id) on delete set null,
  agenda_item_id  uuid references public.board_agenda_items(id) on delete set null,
  number          text,                      -- e.g. 2026-07
  title           text not null,
  text            text,                      -- the motion as it will be minuted
  moved_by        uuid references public.board_members(id) on delete set null,
  seconded_by     uuid references public.board_members(id) on delete set null,
  mode            text not null default 'meeting' check (mode in ('meeting','electronic')),
  opens_at        timestamptz,
  closes_at       timestamptz,
  status          text not null default 'draft' check (status in ('draft','open','passed','failed','withdrawn')),
  threshold       text not null default 'majority' check (threshold in ('majority','two_thirds','unanimous')),
  result_note     text,
  decided_at      timestamptz,
  created_by      uuid references public.people(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists board_resolutions_tenant_idx on public.board_resolutions (tenant_id, created_at desc);

create table if not exists public.board_votes (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  resolution_id   uuid not null references public.board_resolutions(id) on delete cascade,
  member_id       uuid not null references public.board_members(id) on delete cascade,
  vote            text not null check (vote in ('for','against','abstain')),
  recorded_by     uuid references public.people(id) on delete set null,   -- blank = the director cast it themselves
  note            text,
  cast_at         timestamptz not null default now(),
  unique (resolution_id, member_id)
);

-- ── Actions and declarations
create table if not exists public.board_actions (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  meeting_id      uuid references public.board_meetings(id) on delete set null,
  title           text not null,
  owner_id        uuid references public.board_members(id) on delete set null,
  due_on          date,
  status          text not null default 'open' check (status in ('open','done','dropped')),
  done_on         date,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists board_actions_tenant_idx on public.board_actions (tenant_id, status, due_on);

create table if not exists public.board_declarations (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  member_id       uuid not null references public.board_members(id) on delete cascade,
  meeting_id      uuid references public.board_meetings(id) on delete set null,
  description     text not null,
  declared_on     date not null default current_date,
  created_at      timestamptz not null default now()
);

-- ── Helpers (after the tables they read)
-- Who is the signed-in person on the board, if anyone
create or replace function app.my_board_member_id()
returns uuid language sql stable security definer set search_path = public as $$
  select bm.id from public.board_members bm
  join public.people p on p.id = bm.person_id
  where bm.tenant_id = app.current_tenant_id() and p.user_id = auth.uid() and bm.status = 'active'
  limit 1
$$;
create or replace function app.is_board_officer()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.board_members bm join public.people p on p.id = bm.person_id
    where bm.tenant_id = app.current_tenant_id() and p.user_id = auth.uid() and bm.status = 'active'
      and bm.role in ('chair','vice_chair','secretary'))
$$;
create or replace function app.board_can_read()
returns boolean language sql stable security definer set search_path = public as $$
  select app.is_platform_admin() or app.has_tenant_role(array['owner','admin','board']) or app.my_board_member_id() is not null
$$;
create or replace function app.board_can_write()
returns boolean language sql stable security definer set search_path = public as $$
  select app.is_platform_admin() or app.has_tenant_role(array['owner','admin']) or app.is_board_officer()
$$;

-- ── Security
do $$ declare t text; begin
  foreach t in array array['board_members','board_meetings','board_agenda_items','board_attendance','board_resolutions','board_votes','board_actions','board_declarations'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I_read on public.%I', t, t);
    execute format('create policy %I_read on public.%I for select using (tenant_id = app.current_tenant_id() and app.board_can_read())', t, t);
    execute format('drop policy if exists %I_write on public.%I', t, t);
    execute format('create policy %I_write on public.%I for all using (tenant_id = app.current_tenant_id() and app.board_can_write()) with check (tenant_id = app.current_tenant_id() and app.board_can_write())', t, t);
  end loop;
end $$;
-- a director may cast and change their own vote while the resolution is open, and answer their own RSVP
drop policy if exists board_votes_own on public.board_votes;
create policy board_votes_own on public.board_votes for all
  using (tenant_id = app.current_tenant_id() and member_id = app.my_board_member_id()
         and exists (select 1 from public.board_resolutions r where r.id = resolution_id and r.status = 'open'))
  with check (tenant_id = app.current_tenant_id() and member_id = app.my_board_member_id()
         and exists (select 1 from public.board_resolutions r where r.id = resolution_id and r.status = 'open'));
drop policy if exists board_attendance_own on public.board_attendance;
create policy board_attendance_own on public.board_attendance for update
  using (tenant_id = app.current_tenant_id() and member_id = app.my_board_member_id())
  with check (tenant_id = app.current_tenant_id() and member_id = app.my_board_member_id());
drop policy if exists board_declarations_own on public.board_declarations;
create policy board_declarations_own on public.board_declarations for insert
  with check (tenant_id = app.current_tenant_id() and member_id = app.my_board_member_id());

do $$ declare t text; begin
  foreach t in array array['board_members','board_meetings','board_resolutions','board_actions','board_attendance'] loop
    execute format('drop trigger if exists %I_touch on public.%I', t, t);
    execute format('create trigger %I_touch before update on public.%I for each row execute function app.touch_updated_at()', t, t);
  end loop;
end $$;

-- ── The board as published on bcaleadership.com/governance (12 Oct 2026). Terms and committees for BCA to fill.
insert into public.board_members (tenant_id, full_name, email, role, title_line, country, bio, linkedin_url, sort, person_id)
select v.*, (select p.id from public.people p where p.tenant_id = '6b3d4f12-121f-4f17-9ab9-3be82c74ca03' and lower(p.email) = lower(v.email) limit 1)
from (values
  ('6b3d4f12-121f-4f17-9ab9-3be82c74ca03'::uuid, 'Wilben Short', null, 'chair', 'Board Chair', 'Sierra Leone',
   'Partner at CTI Consulting with over thirty years of board-level experience across consulting, hospitality, transport, and events in Sierra Leone and the United Kingdom. He holds a combined honours degree in Physics and Electronic Engineering from Leeds University and an MBA from Cranfield, and is a certified John Maxwell leadership trainer.', null, 10),
  ('6b3d4f12-121f-4f17-9ab9-3be82c74ca03', 'Catherine Musakali', null, 'vice_chair', 'Board Vice-Chair', 'Kenya',
   'Advocate of the High Court of Kenya and founder of Dorion Associates LLP, specializing in governance and commercial law. She spent fifteen years as Company Secretary and Head of Legal for Shell across East and North Africa, and is a past Chair of the Institute of Certified Public Secretaries of Kenya. She also consults for the IFC.', null, 20),
  ('6b3d4f12-121f-4f17-9ab9-3be82c74ca03', 'Dr. Modupe S. Taylor-Pearce', 'mtaylorpearce@bcaleadership.com', 'ceo', 'Board Member · CEO', 'Sierra Leone',
   'Founder and Chief Executive of BCA Leadership, and a scholar and practitioner of leadership and organizational management. A veteran of the Sierra Leone Civil War, he was founding Dean of the African Leadership University School of Business. He holds a PhD from Capella, an MEng from Cornell, and a BSc from West Point.', null, 30),
  ('6b3d4f12-121f-4f17-9ab9-3be82c74ca03', 'Jacques M. Jean', 'jacques.jean@techfides.com', 'director', 'Board Member', 'United States · Haiti',
   'Founder and CEO of TechFides, with 25 years building enterprise technology for companies like Honeywell and Schneider Electric across 15 countries. Today he helps businesses own their AI. A Carnegie Mellon graduate and Forbes Technology Council member, he has built three public libraries in northern Haiti.', null, 40),
  ('6b3d4f12-121f-4f17-9ab9-3be82c74ca03', 'Victor Ernest Williams', null, 'director', 'Board Member', 'United States',
   'Managing Partner at Lions Range Group and former CEO of NBA Africa. He led Corporate and Investment Banking across Africa at Standard Bank for nine years, with earlier M&A roles at Wells Fargo Securities and Goldman Sachs. He serves on the advisory boards of the Smithsonian National Museum of African Art and Harvard Business School, and is a board member at Imagine Worldwide.', null, 50),
  ('6b3d4f12-121f-4f17-9ab9-3be82c74ca03', 'Adrian Carr', null, 'director', 'Board Member', 'United Kingdom',
   'Impact investor and non-executive chair. He leads an impact portfolio at ADCA Investments and chairs the governing bodies of Dulwich College and Life-by-Design, an African enterprise development agency. His background spans banking at JP Morgan, Paribas, and Credit Suisse, and founding education initiatives in Sierra Leone, including Grow Salone and Educaid.', null, 60)
) as v(tenant_id, full_name, email, role, title_line, country, bio, linkedin_url, sort)
where not exists (select 1 from public.board_members b where b.tenant_id = v.tenant_id and b.full_name = v.full_name);

notify pgrst, 'reload schema';
select full_name, role, country, person_id is not null as has_login from public.board_members order by sort;
