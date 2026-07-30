# Coaching Engine — web

Back-office console for the TechFides Coaching Engine, rendered as BCA
Leadership (tenant #1). **Sample data. Not connected to the database.**

Modelled against the live BCA site: three individual membership tiers, three
corporate seat tiers, three coaching packages sold separately, the inbound
consulting / project-management / business-matching pipeline, MIALC passes,
BCAOnline Needs & Leads, the shop catalogue, and member outcomes.

The screen that matters is **Authorise & Invoice**. The website tells every
buyer "this notifies BCA internally to authorize and issue your invoice" — a
human approval step between a signed contract and cash. Nothing caught it
before. That queue does.

Four languages: EN / FR / ES / PT, matching the site. Currency, dates, ageing
units, budget bands and timelines all localise — not just labels.

Serves bca.coachingengine.app while Release 1 is built.

- Schema: Supabase project `coaching-engine` (eu-west-2), 33 tables, 6 migrations
- Tenant config drives lexicon, locale and branding
- Powered by TechFides
