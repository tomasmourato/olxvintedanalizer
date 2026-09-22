-- Deal Hunter — initial schema.
-- The worker writes with the secret key (bypasses RLS); the PWA reads/writes as the signed-in user.

create extension if not exists pg_cron with schema pg_catalog;

create or replace function public.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Global settings (single row).
create table public.settings (
  id boolean primary key default true check (id),
  global_context text not null default '',
  global_exclude text[] not null default array[
    'avariado', 'avariada', 'para peças', 'para pecas', 'não funciona', 'nao funciona',
    'procuro', 'compro', 'troco', 'caixa vazia', 'só caixa', 'so caixa', 'partido', 'partida'
  ],
  active_from time not null default '06:00',
  active_to time not null default '22:00',
  timezone text not null default 'Europe/Lisbon',
  olx_categories int[] not null default array[5371, 4731, 4753],
  vinted_catalogs int[] not null default array[3582, 3581, 3580],
  vinted_countries text[] not null default array['PT'],
  olx_interval_s int not null default 120 check (olx_interval_s >= 30),
  olx_search_interval_s int not null default 30 check (olx_search_interval_s >= 10),
  vinted_interval_s int not null default 30 check (vinted_interval_s >= 10),
  vinted_search_interval_s int not null default 60 check (vinted_search_interval_s >= 10),
  candidate_threshold int not null default 60 check (candidate_threshold between 0 and 100),
  notify_threshold int not null default 80 check (notify_threshold between 0 and 100),
  ai_enabled boolean not null default true,
  push_enabled boolean not null default true,
  updated_at timestamptz not null default now()
);
insert into public.settings default values;

-- A saved search: keywords/categories + price rules + free-text context for the AI.
create table public.watches (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  category text not null default 'Outros',            -- grouping label in the app
  sources text[] not null default array['olx', 'vinted']
    check (sources <@ array['olx', 'vinted'] and cardinality(sources) > 0),
  include_any text[] not null default '{}',            -- at least one must appear (empty = any)
  include_all text[] not null default '{}',            -- all must appear
  exclude text[] not null default '{}',                -- none may appear (plus settings.global_exclude)
  olx_category_ids int[] not null default '{}',        -- restrict to these categories (empty = any)
  vinted_catalog_ids int[] not null default '{}',
  search_remote boolean not null default false,        -- also run site-wide searches for include_any, in rotation
  price_min numeric(10, 2),
  price_max numeric(10, 2),
  target_price numeric(10, 2),
  context text not null default '',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Every listing the worker has seen (deduplicated per source).
create table public.listings (
  id bigint generated always as identity primary key,
  source text not null check (source in ('olx', 'vinted')),
  external_id text not null,
  title text not null,
  description text,
  price numeric(10, 2),
  previous_price numeric(10, 2),
  price_changed_at timestamptz,
  currency text not null default 'EUR',
  url text not null,
  photo_url text,
  location text,
  country text,
  seller_id text,
  seller_business boolean,
  category_id int,
  brand text,
  condition text,
  posted_at timestamptz,                               -- OLX created_time (Vinted has none)
  refreshed_at timestamptz,                            -- OLX last_refresh_time
  first_seen_at timestamptz not null default now(),
  unique (source, external_id)
);
create index listings_first_seen_idx on public.listings (first_seen_at);

-- Listing × watch, with its evaluation.
create table public.matches (
  id bigint generated always as identity primary key,
  listing_id bigint not null references public.listings on delete cascade,
  watch_id uuid not null references public.watches on delete cascade,
  price numeric(10, 2),
  median_price numeric(10, 2),
  discount_pct numeric(5, 1),
  rule_score int,
  ai_score int,
  score int,
  tier text not null default 'normal' check (tier in ('imperdivel', 'bom', 'normal')),
  reason text,
  red_flags text[] not null default '{}',
  ai_status text not null default 'skipped' check (ai_status in ('ok', 'timeout', 'error', 'skipped', 'disabled')),
  notified boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (listing_id, watch_id)
);
create index matches_watch_created_idx on public.matches (watch_id, created_at desc);
create index matches_created_idx on public.matches (created_at desc);

-- Devices subscribed to web push.
create table public.push_subscriptions (
  id bigint generated always as identity primary key,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  label text,
  user_agent text,
  failures int not null default 0,
  last_success_at timestamptz,
  created_at timestamptz not null default now()
);

-- Log of every push sent.
create table public.notifications (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('deal', 'price_drop', 'worker_offline', 'test')),
  match_id bigint references public.matches on delete set null,
  title text not null,
  body text,
  url text,
  status text not null check (status in ('sent', 'partial', 'failed')),
  devices_ok int not null default 0,
  devices_failed int not null default 0,
  error text,
  latency_ms int,                                      -- listing first_seen_at → push sent
  created_at timestamptz not null default now()
);
create index notifications_created_idx on public.notifications (created_at desc);

-- Log of every request the worker makes.
create table public.runs (
  id bigint generated always as identity primary key,
  source text not null check (source in ('olx', 'vinted')),
  kind text not null check (kind in ('category', 'search', 'enrich')),
  scope text not null,
  status text not null check (status in ('ok', 'blocked', 'error')),
  http_status int,
  duration_ms int,
  items_read int not null default 0,
  items_new int not null default 0,
  matches int not null default 0,
  error text,
  started_at timestamptz not null default now()
);
create index runs_started_idx on public.runs (started_at desc);

-- Worker heartbeat and per-source pause state (single worker: id = 'main').
create table public.worker_status (
  id text primary key default 'main',
  version text,
  started_at timestamptz,
  heartbeat_at timestamptz,
  olx_paused_until timestamptz,
  vinted_paused_until timestamptz,
  last_error text,
  last_error_at timestamptz
);

create trigger settings_updated_at before update on public.settings
  for each row execute function public.set_updated_at();
create trigger watches_updated_at before update on public.watches
  for each row execute function public.set_updated_at();
create trigger matches_updated_at before update on public.matches
  for each row execute function public.set_updated_at();

-- RLS: public sign-ups are disabled, so "authenticated" is only the friend (and the owner).
do $$
declare t text;
begin
  foreach t in array array['settings', 'watches', 'listings', 'matches', 'push_subscriptions',
                           'notifications', 'runs', 'worker_status'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "authenticated full access" on public.%I for all to authenticated using (true) with check (true)', t);
  end loop;
end $$;

-- Realtime: the PWA follows new deals/logs; the worker follows config changes.
alter publication supabase_realtime add table
  public.settings, public.watches, public.matches, public.notifications, public.runs, public.worker_status;

-- Retention, to stay within the free 500 MB.
create or replace function public.purge_old_data() returns void
language sql security definer set search_path = '' as $$
  delete from public.runs where started_at < now() - interval '14 days';
  delete from public.listings l
  where l.first_seen_at < now() - interval '30 days'
    and not exists (select 1 from public.matches m where m.listing_id = l.id);
$$;
revoke execute on function public.purge_old_data() from public, anon, authenticated;

select cron.schedule('purge-old-data', '15 4 * * *', 'select public.purge_old_data()');
