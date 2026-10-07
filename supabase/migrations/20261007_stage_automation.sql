-- Stage movement: by hand, and by itself.
--
-- BCA's team can always set a stage directly in the console. These rules sit
-- underneath that and move a deal when something real happens, so the board is
-- never stale just because nobody remembered to drag a card.
--
-- Three rules govern all of it:
--   1. Automation only ever moves a deal FORWARD. It never walks one back.
--   2. Automation never touches a deal already closed. A human closes, and a
--      human reopens.
--   3. Every automatic move writes a note saying what caused it, so BCA can see
--      why a deal jumped rather than wondering.
--
-- Each trigger fires on a deliberate recorded event, never on an inference. There
-- is no "no contact for 30 days, mark it lost" rule here, because silence is not
-- an event and guessing at a loss is how a pipeline starts lying.

create or replace function public.stage_rank(s text) returns int
language sql immutable as $$
  select case s
    when 'prospect' then 1 when 'qualified' then 2 when 'proposal' then 3
    when 'negotiation' then 4 when 'closed_won' then 5 when 'closed_lost' then 5
    else 0 end;
$$;

create or replace function public.advance_opportunity(p_opp uuid, p_to text, p_why text)
returns void language plpgsql security definer set search_path = public as $$
declare cur text; ten uuid;
begin
  select stage, tenant_id into cur, ten from public.opportunities where id = p_opp;
  if cur is null then return; end if;

  -- a closed deal is a human's business
  if cur in ('closed_won','closed_lost') then return; end if;

  -- forward only; closed_lost is the one move allowed from anywhere still open
  if p_to <> 'closed_lost' and public.stage_rank(p_to) <= public.stage_rank(cur) then return; end if;

  update public.opportunities
     set stage = p_to,
         probability = case p_to when 'prospect' then 10 when 'qualified' then 25
                                 when 'proposal' then 50 when 'negotiation' then 75
                                 when 'closed_won' then 100 else 0 end,
         closed_at = case when p_to in ('closed_won','closed_lost') then now() else closed_at end,
         updated_at = now()
   where id = p_opp;

  insert into public.activities (tenant_id, opportunity_id, kind, direction, subject, body, occurred_at)
  values (ten, p_opp, 'note', 'internal',
          'Stage moved to ' || initcap(replace(p_to,'_',' ')) || ' automatically',
          p_why, now());
end; $$;

/* An activity logged against a deal moves it on, and a conversation logged
   against a lead that has no deal yet starts one.

   This is the path for someone who phones BCA or uses the concierge. They land as
   a lead; the moment a person records a real two-way conversation against that
   lead, a deal opens at Prospect with a follow-up date, and it appears on the
   Pipeline. The deal is NOT also advanced by the activity that created it: a
   first conversation opens a deal, it does not qualify one. The next one does.

   The note advance_opportunity writes is kind 'note', direction 'internal', so it
   falls out at the first guard below and cannot set itself off again. */
create or replace function public.tg_activity_advances_stage() returns trigger
language plpgsql security definer set search_path = public as $$
declare opp uuid; target text; why text; made boolean := false;
begin
  if new.kind = 'payment_received' then
    target := 'closed_won'; why := 'A payment was logged against this deal.';
  elsif new.kind = 'contract_sent' then
    target := 'negotiation'; why := 'A contract went out.';
  elsif new.kind = 'proposal_sent' then
    target := 'proposal';    why := 'A proposal went out.';
  elsif new.kind in ('call','meeting','whatsapp','linkedin','email_replied')
        or new.direction = 'in' then
    target := 'qualified';
    why := 'They came back to us: ' || coalesce(replace(new.kind,'_',' '),'contact') || ' logged.';
  else
    return new;
  end if;

  opp := new.opportunity_id;
  if opp is null and new.lead_id is not null then
    select id into opp from public.opportunities
     where lead_id = new.lead_id and stage not in ('closed_won','closed_lost')
     order by created_at desc limit 1;

    if opp is null then
      insert into public.opportunities
             (tenant_id, lead_id, person_id, name, line, stage, probability,
              value_minor, currency, next_step, next_step_on)
      select l.tenant_id, l.id, l.person_id,
             coalesce(nullif(l.organization,''), l.full_name, 'New enquiry'),
             'individual_membership', 'prospect', 10, 0, 'USD',
             'Follow up on the conversation just logged', current_date + 3
        from public.leads l where l.id = new.lead_id
      returning id into opp;
      made := true;
      update public.leads set status = 'working', last_touch_at = now()
       where id = new.lead_id and status = 'new';
    end if;
  end if;

  if opp is null or made then return new; end if;
  perform public.advance_opportunity(opp, target, why);
  return new;
end; $$;

drop trigger if exists activity_advances_stage on public.activities;
create trigger activity_advances_stage
  after insert on public.activities
  for each row execute function public.tg_activity_advances_stage();

/* A proposal changing state moves its deal. */
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
  elsif new.status = 'declined' then
    perform public.advance_opportunity(new.opportunity_id, 'closed_lost', ref || ' was declined.');
  end if;
  return new;
end; $$;

drop trigger if exists proposal_advances_stage on public.proposals;
create trigger proposal_advances_stage
  after insert or update of status on public.proposals
  for each row execute function public.tg_proposal_advances_stage();

-- Deliberately absent: nothing closes a deal as Won off a paid invoice. Invoices
-- carry no opportunity_id, so the only available join is person or organisation,
-- and an unrelated membership renewal would close an open consulting deal as won.
-- Won revenue in front of a board has to be right, so it stays on the
-- payment_received activity, which a person logs on purpose, or on a human.

-- Someone telephoning BCA is a lead like any other, and the register should say
-- so rather than filing them under "other".
alter table public.leads drop constraint if exists leads_source_check;
alter table public.leads add constraint leads_source_check
  check (source = any (array['website'::text,'referral'::text,'event'::text,
    'campaign'::text,'outbound'::text,'podcast'::text,'linkedin'::text,
    'member_intro'::text,'request_form'::text,'phone'::text,'other'::text]));
