-- ============================================================================
-- Intelligence for the BCA Coaching Engine
-- Run once in Supabase → SQL editor on project coaching-engine (uojsxmdnpwskxeueftgp).
-- Safe to re-run: every statement is idempotent.
--
-- Two things: (1) questions in plain language, answered from BCA's own data by a
-- read-only query that runs AS THE SIGNED-IN USER, so row-level security applies
-- exactly as it does in every other screen; (2) a Monday briefing written from a
-- fixed set of figures and emailed to admin@. The model never sees a key, a token,
-- or a row it could not read through the console.
-- ============================================================================

-- ── 1. What the model may query: table and column names only, from the live catalogue.
create or replace function app.intel_schema() returns text
language sql stable security definer set search_path = public as $$
  select string_agg(t.table_name || '(' || t.cols || ')', E'\n' order by t.table_name)
  from (
    select c.table_name, string_agg(c.column_name || ' ' || c.data_type, ', ' order by c.ordinal_position) as cols
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name in ('people','organizations','leads','opportunities','activities','requests','memberships','products',
                           'invoices','invoice_lines','payments','sessions','consultations','contracts','proposals','proposal_lines',
                           'proposal_events','documents','worklog','coach_payouts')
      and c.column_name not in ('public_token','signature_ip','signature_agent')
    group by c.table_name
  ) t;
$$;
revoke all on function app.intel_schema() from public;
grant execute on function app.intel_schema() to authenticated;

-- ── 2. Run one read-only SELECT as the caller. RLS applies (security invoker).
--      Guarded: one statement, SELECT/WITH only, no writes, no system schemas, 5 s cap, 200 rows.
create or replace function app.intel_run(p_sql text) returns jsonb
language plpgsql security invoker set search_path = public as $$
declare q text := btrim(p_sql); out jsonb;
begin
  if q ~* '^\s*(select|with)\b' is not true then raise exception 'only SELECT is allowed'; end if;
  if position(';' in rtrim(q, '; ')) > 0 then raise exception 'one statement only'; end if;
  if q ~* '\m(insert|update|delete|drop|alter|grant|revoke|create|truncate|copy|call|do|execute|vacuum|analyze|lock|listen|notify|refresh|set|reset|show)\M' then
    raise exception 'read only';
  end if;
  if q ~* '\m(pg_|information_schema|auth\.|storage\.|net\.|cron\.|vault\.|app\.)' then raise exception 'system objects are off limits'; end if;
  perform set_config('statement_timeout', '5000', true);
  execute 'select coalesce(jsonb_agg(row_to_json(t)), ''[]''::jsonb) from (' || rtrim(q, '; ') || ' limit 200) t' into out;
  return out;
end $$;
revoke all on function app.intel_run(text) from public;
grant execute on function app.intel_run(text) to authenticated;

-- ── 3. A record of every question and every briefing.
create table if not exists public.intel_questions (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  asked_by    uuid references public.people(id) on delete set null,
  question    text not null,
  sql         text,
  answer      text,
  row_count   int,
  ok          boolean not null default true,
  error       text,
  ms          int,
  created_at  timestamptz not null default now()
);
create index if not exists intel_questions_idx on public.intel_questions (tenant_id, created_at desc);
alter table public.intel_questions enable row level security;
drop policy if exists intel_questions_read on public.intel_questions;
create policy intel_questions_read on public.intel_questions for select using (tenant_id = app.current_tenant_id() or app.is_platform_admin());
drop policy if exists intel_questions_insert on public.intel_questions;
create policy intel_questions_insert on public.intel_questions for insert
  with check ((tenant_id = app.current_tenant_id() and app.has_tenant_role(array['owner','admin','coach','board'])) or app.is_platform_admin());

create table if not exists public.intel_briefings (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references public.tenants(id) on delete cascade,
  week_of     date not null,
  figures     jsonb not null,
  body        text not null,
  sent_to     text[],
  created_at  timestamptz not null default now(),
  unique (tenant_id, week_of)
);
alter table public.intel_briefings enable row level security;
drop policy if exists intel_briefings_read on public.intel_briefings;
create policy intel_briefings_read on public.intel_briefings for select using (tenant_id = app.current_tenant_id() or app.is_platform_admin());

-- ── 4. Monday 06:00 UTC briefing, same pattern as the inbound nudge (key from platform_secrets).
insert into public.platform_secrets (name, value)
  select 'intel_key', encode(gen_random_bytes(24), 'hex')
  where not exists (select 1 from public.platform_secrets where name = 'intel_key');
do $$
declare k text; jid int;
begin
  select value into k from public.platform_secrets where name = 'intel_key';
  select jobid into jid from cron.job where jobname = 'bca-intel-briefing';
  if jid is not null then perform cron.unschedule(jid); end if;
  perform cron.schedule('bca-intel-briefing', '0 6 * * 1',
    format($c$select net.http_post(url := 'https://uojsxmdnpwskxeueftgp.supabase.co/functions/v1/bca-intel',
      headers := '{"Content-Type":"application/json","x-intel-key":"%s"}'::jsonb,
      body := '{"action":"briefing","tenant_id":"6b3d4f12-121f-4f17-9ab9-3be82c74ca03"}'::jsonb)$c$, k));
end $$;

-- ── 5. Work tracker
with t as (select '6b3d4f12-121f-4f17-9ab9-3be82c74ca03'::uuid as id)
update public.worklog w set status = 'in_progress', detail = 'Unlocked 30 Sept: plain-language questions over BCA data (read-only, RLS applies) and a Monday briefing to admin@. Needs ANTHROPIC_API_KEY in Edge Function secrets to answer.'
from t where w.tenant_id = t.id and w.title = 'Intelligence module: build or drop';
