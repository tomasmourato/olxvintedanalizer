-- Priority watches (their categories are read every 10–15 s until priority_until) and the "Verificar anúncios"
-- button: the app inserts a listing_checks row, the worker checks every listing shown in Negócios and marks the
-- ones sold or removed (listings.gone_at), which then leave the lists but still count in the median.

alter table public.watches add column priority_until timestamptz;

alter table public.listings add column gone_at timestamptz;

create table public.listing_checks (
  id bigint generated always as identity primary key,
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  total int,
  checked int not null default 0,
  gone int not null default 0,
  error text
);
create index listing_checks_requested_idx on public.listing_checks (requested_at desc);

alter table public.listing_checks enable row level security;
create policy "authenticated full access" on public.listing_checks for all to authenticated using (true) with check (true);
alter publication supabase_realtime add table public.listing_checks;

create or replace function public.purge_old_data() returns void
language sql security definer set search_path = '' as $$
  delete from public.runs where started_at < now() - interval '14 days';
  delete from public.unidentified where created_at < now() - interval '30 days';
  delete from public.listing_checks where requested_at < now() - interval '30 days';
  delete from public.listings l
  where l.first_seen_at < now() - interval '30 days'
    and not exists (select 1 from public.matches m where m.listing_id = l.id)
    and not exists (select 1 from public.unidentified u where u.listing_id = l.id);
$$;
revoke execute on function public.purge_old_data() from public, anon, authenticated;
