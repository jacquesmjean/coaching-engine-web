-- Run these two blocks yourself in the Supabase SQL editor (coaching-engine). They create the briefing key and the two cron jobs.

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


-- ── 5. Scheduled sends: every 10 minutes, ask the function to dispatch anything due.
--      Reuses the nudge key already in platform_secrets, so no new secret is created.
do $$
declare k text; jid int;
begin
  select value into k from public.platform_secrets where name = 'nudge_key';
  if k is null then raise notice 'nudge_key missing: scheduled sends will not run until it exists'; return; end if;
  select jobid into jid from cron.job where jobname = 'bca-campaign-dispatch';
  if jid is not null then perform cron.unschedule(jid); end if;
  perform cron.schedule('bca-campaign-dispatch', '*/10 * * * *',
    format($c$select net.http_post(url := 'https://uojsxmdnpwskxeueftgp.supabase.co/functions/v1/bca-campaign',
      headers := '{"Content-Type":"application/json","x-nudge-key":"%s"}'::jsonb,
      body := '{"action":"dispatch"}'::jsonb)$c$, k));
end $$;

