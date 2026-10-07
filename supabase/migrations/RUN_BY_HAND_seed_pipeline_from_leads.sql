-- HELD, NOT APPLIED. Read the note before running this.
--
-- The plan was to open BCA's pipeline by raising one opportunity per lead still
-- marked 'new'. There are 22 of those. On inspection, 21 of them were submitted by
-- BCA's own people testing their contact form:
--
--   ctete@breakfastclubafrica.com      Claudia Tete        x5  (orgs "HGJGJ", "HVJ", "confidential")
--   nlokko@breakfastclubafrica.com     Nii Lokko           x3  (as "Joe User", "Johnson Test")
--   nlokko@bcaleadership.com           Nii Lokko           x4  (as "Jonas Tester", "Tim Test",
--                                                               "Timothy Test II", "Tim Tester Jones")
--   ablankson@bcaleadership.com        Andrea Blankson     x2
--   admin@bcaleadership.com            Cee Hudson          x1
--   modupetp@gmail.com                 Modupe's own gmail  x2  (as "Samuel", "Sam Taylor")
--   johndoe@gmail.com / johnfie@gmail.com                  x2
--   akrm00744@gmail.com, org "moma"                        x1
--
-- That leaves exactly one lead that looks like a real outside enquiry:
-- Mwaba Mupinde, ashmupinde@gmail.com, 23 August. One, not twenty-two.
--
-- Seeding as planned would open the client's brand new pipeline with twenty-one
-- opportunities authored by his own staff and shown back to him as prospects. That
-- is the same failure as putting invented figures on a page, so nothing was written.
--
-- If BCA confirms which of these are real, adjust the filters and run it. It is
-- idempotent: a lead that already carries an opportunity is skipped.

insert into public.opportunities
       (tenant_id, lead_id, person_id, name, line, stage, probability,
        value_minor, currency, expected_close, next_step, next_step_on)
select l.tenant_id,
       l.id,
       l.person_id,
       coalesce(nullif(l.organization,''), l.full_name, 'Website enquiry'),
       'individual_membership',
       'prospect',
       10,
       0,
       'USD',
       (current_date + 90),
       'First contact: reply to the website enquiry',
       (current_date + 3)
  from public.leads l
 where l.status = 'new'
   and l.source = 'website'
   and coalesce(l.email,'') !~* '(breakfastclubafrica[.]com|bcaleadership[.]com|johndoe@|johnfie@|modupetp@)'
   and coalesce(l.full_name,'') !~* '(test|sample|joe user|john doe|john die)'
   and not exists (select 1 from public.opportunities o where o.lead_id = l.id);

-- Then mark those leads qualified, but only where an opportunity actually exists,
-- so no lead is left marked qualified with nothing behind it.
update public.leads l
   set status = 'qualified', last_touch_at = now()
 where l.status = 'new'
   and exists (select 1 from public.opportunities o where o.lead_id = l.id);
