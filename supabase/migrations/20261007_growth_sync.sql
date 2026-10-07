-- Growth: one number, flowing from the lines a client reads to the board figure.
--
-- Two holes this closes.
--
-- 1. public.proposals.value_minor was never written by anything. The console
--    adds up the lines on screen, but nothing saved the total, so the column sat
--    at 0 on every row. The public proposal page and the send email both print
--    the Total from that column. A proposal with correct line items went out
--    showing "Total $0.00". The lines are the proposal's value, so the database
--    now computes it from them and no screen has to remember.
--
-- 2. Nothing carried a priced proposal onto its opportunity, so Open Pipeline
--    and Weighted Forecast on the Pipeline screen read whatever a person typed
--    when the deal was raised, usually zero. Once a proposal has gone out, the
--    number the client is holding is the number the board should see.
--
-- Precedence, stated plainly: BEFORE a proposal is sent, the figure a person
-- typed on the opportunity stands. ONCE it is sent, the proposal governs. That
-- is the only number the client has actually seen, and a forecast that disagrees
-- with the paper in the client's hand is a forecast nobody can defend. A human
-- can still overwrite the deal value afterwards; it holds until the proposal is
-- repriced or another one goes out.
--
-- Guards, in the same spirit as the stage rules: a closed deal is never touched,
-- a superseded proposal never overrides a later one, and currencies are never
-- converted.

-- ── 1. A proposal is worth its lines
create or replace function public.tg_proposal_lines_total() returns trigger
language plpgsql security definer set search_path = public as $$
declare pid uuid;
begin
  -- OLD is unassigned on INSERT and NEW on DELETE, so pick by operation
  if tg_op = 'DELETE' then pid := old.proposal_id; else pid := new.proposal_id; end if;
  if pid is null then return null; end if;
  update public.proposals p
     set value_minor = coalesce((
           select sum(round(l.qty * l.unit_minor))::bigint
             from public.proposal_lines l
            where l.proposal_id = pid), 0)
   where p.id = pid
     and p.value_minor is distinct from coalesce((
           select sum(round(l.qty * l.unit_minor))::bigint
             from public.proposal_lines l
            where l.proposal_id = pid), 0);
  return null;
end $$;

drop trigger if exists proposal_lines_total on public.proposal_lines;
create trigger proposal_lines_total
  after insert or update or delete on public.proposal_lines
  for each row execute function public.tg_proposal_lines_total();

-- Backfill every proposal already on record.
update public.proposals p
   set value_minor = coalesce(t.total, 0)
  from (select proposal_id, sum(round(qty * unit_minor))::bigint as total
          from public.proposal_lines group by proposal_id) t
 where t.proposal_id = p.id
   and p.value_minor is distinct from coalesce(t.total, 0);

-- ── 2. A sent proposal governs its deal's value
create or replace function public.tg_proposal_value_to_opportunity() returns trigger
language plpgsql security definer set search_path = public as $$
declare o record; newer int; ref text; moved boolean;
begin
  if new.opportunity_id is null then return new; end if;

  -- only a proposal the recipient is actually holding
  if new.status not in ('sent','viewed','accepted') then return new; end if;
  if coalesce(new.value_minor, 0) = 0 then return new; end if;

  select id, stage, value_minor, currency, tenant_id into o
    from public.opportunities where id = new.opportunity_id;
  if o.id is null then return new; end if;

  -- a closed deal is a human's business
  if o.stage in ('closed_won','closed_lost') then return new; end if;

  -- a later live proposal on the same deal owns the number, not this one
  select count(*) into newer from public.proposals
   where opportunity_id = new.opportunity_id
     and id <> new.id
     and status in ('sent','viewed','accepted')
     and coalesce(sent_at, created_at) > coalesce(new.sent_at, new.created_at);
  if newer > 0 then return new; end if;

  ref := coalesce(nullif(new.number,''), 'the proposal');

  -- did this change move the figure at all, or is it a re-save of the same one
  if tg_op = 'INSERT' then
    moved := true;
  else
    moved := new.value_minor is distinct from old.value_minor
          or new.status     is distinct from old.status
          or new.currency   is distinct from old.currency;
  end if;

  -- never convert currency; say so once rather than writing a wrong number
  if coalesce(o.currency,'USD') <> coalesce(new.currency,'USD') then
    if moved then
      insert into public.activities (tenant_id, opportunity_id, kind, direction, subject, body, occurred_at)
      values (o.tenant_id, o.id, 'note', 'internal',
              'Proposal ' || ref || ' is priced in a different currency',
              ref || ' is in ' || coalesce(new.currency,'USD') || ' and this deal is in '
                  || coalesce(o.currency,'USD') || '. The deal value was left alone rather than '
                  || 'converted at a rate nobody chose. Set the deal value by hand if the '
                  || 'proposal is the number you want on the forecast.', now());
    end if;
    return new;
  end if;

  if o.value_minor is not distinct from new.value_minor then return new; end if;

  update public.opportunities
     set value_minor = new.value_minor, updated_at = now()
   where id = o.id;

  insert into public.activities (tenant_id, opportunity_id, kind, direction, subject, body, occurred_at)
  values (o.tenant_id, o.id, 'note', 'internal',
          'Deal value now follows proposal ' || ref,
          'Was ' || coalesce(o.currency,'USD') || ' '
             || to_char(coalesce(o.value_minor,0)/100.0, 'FM999,999,990.00')
             || ', now ' || coalesce(new.currency,'USD') || ' '
             || to_char(new.value_minor/100.0, 'FM999,999,990.00')
             || '. ' || ref || ' has gone to the client, so the deal carries the number they are holding.',
          now());
  return new;
end $$;

drop trigger if exists proposal_value_to_opportunity on public.proposals;
create trigger proposal_value_to_opportunity
  after insert or update of value_minor, opportunity_id, status, currency, sent_at
  on public.proposals
  for each row execute function public.tg_proposal_value_to_opportunity();

-- Bring any already-sent proposal's value onto its open deal, once.
do $$
declare r record;
begin
  for r in
    select p.id from public.proposals p
      join public.opportunities o on o.id = p.opportunity_id
     where p.status in ('sent','viewed','accepted')
       and coalesce(p.value_minor,0) > 0
       and o.stage not in ('closed_won','closed_lost')
       and coalesce(o.currency,'USD') = coalesce(p.currency,'USD')
       and o.value_minor is distinct from p.value_minor
  loop
    update public.proposals set value_minor = value_minor where id = r.id;
  end loop;
end $$;

-- Deliberately absent: nothing here writes a stage. Stage movement has one owner,
-- public.advance_opportunity, called from the triggers in
-- 20261007_stage_automation.sql. Two writers of one field is how a pipeline
-- starts contradicting itself.

-- ── 3. One owner for stage movement, extras included
--
-- bca-proposal used to write opportunities.stage itself on send and on a
-- decision, straight past advance_opportunity's guards. Two writers of one
-- field: if a human had already marked a deal Closed Won and a stale proposal
-- were then declined, the trigger would correctly refuse to touch a closed deal
-- while the function forced it to Closed Lost anyway. The function's stage write
-- is gone; this trigger now carries the two things it was also setting, the
-- next step on acceptance and the lost reason on a decline, behind the same
-- guard. The `and stage = ...` clauses are that guard: if advance_opportunity
-- refused the move, the stage is not the target and nothing is written.
create or replace function public.tg_proposal_advances_stage() returns trigger
language plpgsql security definer set search_path = public as $$
declare ref text;
begin
  if new.opportunity_id is null then return new; end if;
  if tg_op = 'UPDATE' and new.status is not distinct from old.status then return new; end if;
  ref := coalesce(nullif(new.number,''), 'The proposal');

  if new.status = 'sent' then
    perform public.advance_opportunity(new.opportunity_id, 'proposal', ref || ' was sent.');

  elsif new.status = 'accepted' then
    perform public.advance_opportunity(new.opportunity_id, 'negotiation',
            ref || ' was accepted. The signature is what is left.');
    -- an acceptance is a commitment, not a signature
    update public.opportunities
       set next_step    = coalesce(nullif(next_step,''), 'Proposal accepted. Get the agreement signed.'),
           next_step_on = coalesce(next_step_on, current_date + 7)
     where id = new.opportunity_id and stage = 'negotiation';

  elsif new.status = 'declined' then
    perform public.advance_opportunity(new.opportunity_id, 'closed_lost', ref || ' was declined.');
    update public.opportunities
       set lost_reason = coalesce(nullif(lost_reason,''), nullif(new.decision_note,''), ref || ' was declined')
     where id = new.opportunity_id and stage = 'closed_lost';
  end if;
  return new;
end $$;
