-- Pipeline lifecycle: six stages, not seven.
--
-- Briefing and Verbal were dropped deliberately. A stage earns its place only if
-- there is an observable event that moves a deal into it AND a different action
-- required of the owner. Briefing asked for nothing that Qualified does not already
-- ask for, and Verbal asks for nothing that Negotiation does not: in both cases you
-- are still chasing the same signature. A verbal commitment is recorded in
-- next_step, where it belongs, instead of parking deals in a stage of their own.
--
-- Won and Lost become Closed Won and Closed Lost so a board report reads correctly
-- and nobody mistakes an outcome for a stage a deal passes through.
--
-- Safe to run with rows present: the mapping below folds the old seven into the new
-- six before the constraint is reapplied. At time of writing there are zero rows.

begin;

alter table public.opportunities
  drop constraint if exists opportunities_stage_check;

update public.opportunities set stage = case stage
    when 'qualifying' then 'prospect'
    when 'briefing'   then 'qualified'
    when 'verbal'     then 'negotiation'
    when 'won'        then 'closed_won'
    when 'lost'       then 'closed_lost'
    else stage
  end
 where stage in ('qualifying','briefing','verbal','won','lost');

alter table public.opportunities
  add constraint opportunities_stage_check
  check (stage = any (array[
    'prospect'::text,
    'qualified'::text,
    'proposal'::text,
    'negotiation'::text,
    'closed_won'::text,
    'closed_lost'::text
  ]));

alter table public.opportunities
  alter column stage set default 'prospect'::text;

commit;
