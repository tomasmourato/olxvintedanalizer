-- Worker watchdog. Every 5 min, inside the active hours: no heartbeat for 10 min → the `push` Edge
-- Function sends "Worker offline" to every device, once per outage. The function's shared secret is kept
-- in Vault as 'push_fn_secret' (created by hand, never in a migration) and in its PUSH_FN_SECRET secret.
create extension if not exists pg_net with schema extensions;

create or replace function public.worker_watchdog() returns text
language plpgsql security definer set search_path = '' as $$
declare
  s public.settings;
  local_now timestamp;
  t time;
  opened timestamptz;
  hb timestamptz;
  since timestamptz;
  secret text;
begin
  select * into s from public.settings;
  if not s.push_enabled then return 'push desligado'; end if;

  local_now := now() at time zone s.timezone;
  t := local_now::time;
  -- Same rule as the worker's isActive(): [from, to), windows past midnight allowed.
  if (s.active_from <= s.active_to and (t < s.active_from or t >= s.active_to))
     or (s.active_from > s.active_to and t < s.active_from and t >= s.active_to) then
    return 'fora do horário';
  end if;

  -- The window's start counts as a heartbeat: the PC may only just have been switched on.
  opened := ((local_now::date - (t < s.active_from)::int) + s.active_from) at time zone s.timezone;
  select heartbeat_at into hb from public.worker_status where id = 'main';
  since := greatest(hb, opened);
  if now() - since < interval '10 minutes' then return 'ok'; end if;
  if exists (select 1 from public.notifications where kind = 'worker_offline' and created_at > since) then
    return 'já avisado';
  end if;

  select decrypted_secret into secret from vault.decrypted_secrets where name = 'push_fn_secret';
  if secret is null then
    raise warning 'worker_watchdog: falta o segredo push_fn_secret no Vault';
    return 'sem segredo';
  end if;
  perform net.http_post(
    url := 'https://suldkcbhpmvhpxksrlot.supabase.co/functions/v1/push',
    body := jsonb_build_object('heartbeat_at', hb, 'timezone', s.timezone),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', secret),
    timeout_milliseconds := 10000
  );
  return 'avisado';
end $$;
revoke execute on function public.worker_watchdog() from public, anon, authenticated;

select cron.schedule('worker-watchdog', '*/5 * * * *', 'select public.worker_watchdog()');
