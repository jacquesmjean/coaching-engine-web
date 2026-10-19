-- ============================================================================
-- The Bench roster: the 45 coaches, consultants, trainers and facilitators published on
-- bcaleadership.com/the-bench, imported into people so coach matching and The Bench module have records.
-- Idempotent: matches existing people by name (title stripped), updates their bench fields, inserts the rest.
-- Run in Supabase -> SQL editor on project coaching-engine (uojsxmdnpwskxeueftgp).
-- ============================================================================
create temp table bench_in (first_name text, last_name text, bench_type text, disciplines text[], region text, country text, languages text[], title text);
insert into bench_in values
('Jeanne-Elvire Adotevi','Billies','coach',array['executive coaching']::text[],'diaspora','France',array['English','French']::text[],''),
('Doris','Ahiati','coach',array['executive coaching']::text[],'west','Ghana',array['English']::text[],''),
('Titilayo','Akinsanya','coach',array['executive coaching']::text[],'west','Nigeria',array['English']::text[],''),
('Mbithe','Anzaya','coach',array['executive coaching']::text[],'east','Kenya',array['English']::text[],'Dr.'),
('Sarah Jessie','Appiah','coach',array['executive coaching','consulting']::text[],'west','Ghana',array['English','French']::text[],''),
('Samuel','Ayim','coach',array['executive coaching','consulting']::text[],'west','Ghana',array['English']::text[],''),
('Susan','Banda-Mudiwa','coach',array['executive coaching']::text[],'east','Kenya',array['English']::text[],''),
('Stephanie','Weinzierl','coach',array['executive coaching','consulting']::text[],'west','Burkina Faso',array['French','English','German']::text[],''),
('Norah','Bwaya','coach',array['executive coaching']::text[],'east','Uganda',array['English']::text[],''),
('Nankhonde','Kasonde van den Broek','coach',array['executive coaching']::text[],'southern','Zambia',array['English','French']::text[],''),
('Catherine','Engmann','coach',array['executive coaching']::text[],'west','Ghana',array['English']::text[],''),
('Wilben','Short','coach',array['executive coaching','consulting']::text[],'west','The Gambia',array['English']::text[],''),
('Hugh Kweku','Fraser','coach',array['executive coaching','consulting']::text[],'west','Sierra Leone',array['English']::text[],''),
('Amal','Hihi','coach',array['executive coaching']::text[],'north','Morocco',array['English','French','Arabic']::text[],''),
('Terry','Jackson','coach',array['executive coaching']::text[],'diaspora','USA',array['English']::text[],'Dr.'),
('Anne','Wangondu','coach',array['executive coaching']::text[],'east','Kenya',array['English']::text[],''),
('Simon','Kibe','coach',array['executive coaching']::text[],'east','Rwanda',array['English']::text[],''),
('Daisy','Kopolo','coach',array['executive coaching','consulting']::text[],'southern','Zambia',array['English']::text[],''),
('Sonia','Kubwimana','coach',array['executive coaching']::text[],'east','Rwanda',array['English','French','Kinyarwanda','Swahili','Lingala']::text[],''),
('Maurice','Toroitich','coach',array['executive coaching']::text[],'east','Rwanda',array['English']::text[],''),
('Barbara','Lawrence','coach',array['executive coaching']::text[],'west','Nigeria',array['English']::text[],''),
('Dumi','Magadlela','coach',array['executive coaching','consulting']::text[],'southern','South Africa',array['English']::text[],'Dr.'),
('Adeboye','Martins','coach',array['executive coaching']::text[],'west','Nigeria',array['English']::text[],''),
('Martin','Oduor-Otieno','coach',array['executive coaching']::text[],'east','Kenya',array['English']::text[],'Dr.'),
('Miriam','von Borcke Matutu','coach',array['executive coaching','consulting']::text[],'southern','Zambia',array['English','French','German']::text[],''),
('Price Alan','Mbida','coach',array['executive coaching','consulting']::text[],'west','Côte d''Ivoire',array['French','English']::text[],''),
('David','Thuku','coach',array['executive coaching']::text[],'east','Kenya',array['English']::text[],'Dr.'),
('Dudun','Peterside','coach',array['executive coaching']::text[],'west','Nigeria',array['English']::text[],''),
('Flora','Mutahi','coach',array['executive coaching']::text[],'east','Kenya',array['English']::text[],''),
('Sibongile','Muwamba','coach',array['executive coaching']::text[],'southern','Malawi',array['English']::text[],''),
('Anne','Ngethe','coach',array['executive coaching']::text[],'east','Kenya',array['English']::text[],''),
('Yaw','Perbi','coach',array['executive coaching']::text[],'west','Ghana',array['English']::text[],'Dr.'),
('Anyima','Okundi','coach',array['executive coaching','consulting']::text[],'east','Kenya',array['English']::text[],''),
('Loubna','El Ouardighi','coach',array['executive coaching']::text[],'north','Morocco',array['English']::text[],''),
('Alice','Rwigema','coach',array['executive coaching','consulting']::text[],'east','Rwanda',array['English','French']::text[],''),
('Modupe','Taylor-Pearce','coach',array['executive coaching','consulting']::text[],'west','Sierra Leone',array['English']::text[],'Dr.'),
('Mulalo','Rambau','coach',array['executive coaching']::text[],'southern','Zambia',array['English']::text[],''),
('Esther','Lehmann-Sow','coach',array['executive coaching','consulting']::text[],'west','Senegal',array['English','French']::text[],''),
('Philippe','Futa','coach',array['executive coaching','consulting']::text[],'central','DR Congo',array['English','French']::text[],''),
('Juliet','Ntabgoba','coach',array['executive coaching','consulting']::text[],'east','Uganda',array['English']::text[],''),
('Naoufel','Aissa','coach',array['executive coaching']::text[],'north','Morocco',array['English','French','Arabic']::text[],''),
('Jacqueline','Williams','coach',array['executive coaching','consulting']::text[],'west','Sierra Leone',array['English']::text[],''),
('Cecellia Shammim','Saidi','trainer',array['training','consulting']::text[],'southern','Malawi',array['English']::text[],''),
('Maya','Ng''ombe-Jere','facilitator',array['facilitation']::text[],'southern','Malawi',array['English']::text[],''),
('Akonda Supuni','Yakobe','trainer',array['training']::text[],'southern','Malawi',array['English']::text[],'');

with target as (
  select distinct on (b.first_name, b.last_name) b.*, p.id as person_id
  from bench_in b join people p
    on p.tenant_id = '6b3d4f12-121f-4f17-9ab9-3be82c74ca03'
   and lower(regexp_replace(p.first_name, '^Dr\.?\s+', '')) = lower(b.first_name)
   and lower(coalesce(p.last_name,'')) in (lower(b.last_name), lower(split_part(b.last_name,'-',1)))
  order by b.first_name, b.last_name, (p.email is null), p.created_at
)
update people p set
  bench_type  = t.bench_type,
  disciplines = t.disciplines,
  region      = t.region,
  country     = coalesce(p.country, t.country),
  languages   = t.languages,
  credentials = coalesce(p.credentials, nullif(t.title,'')),
  status      = case when p.status in ('prospect','lapsed','archived') then 'active' else p.status end
from target t where p.id = t.person_id;

insert into people (tenant_id, first_name, last_name, status, bench_type, disciplines, region, country, languages, credentials, preferred_language)
select '6b3d4f12-121f-4f17-9ab9-3be82c74ca03', b.first_name, b.last_name, 'active', b.bench_type, b.disciplines, b.region, b.country, b.languages, nullif(b.title,''),
       case when b.languages[1] = 'French' then 'fr' else 'en' end
from bench_in b
where not exists (
  select 1 from people p where p.tenant_id = '6b3d4f12-121f-4f17-9ab9-3be82c74ca03'
    and lower(regexp_replace(p.first_name, '^Dr\.?\s+', '')) = lower(b.first_name)
    and lower(coalesce(p.last_name,'')) in (lower(b.last_name), lower(split_part(b.last_name,'-',1))));

select bench_type, region, count(*) from people where bench_type is not null group by 1,2 order by 1,2;
