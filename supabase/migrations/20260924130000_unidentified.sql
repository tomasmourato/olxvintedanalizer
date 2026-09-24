-- "Por identificar": listings the worker could not value because they do not say the model. PCs whose
-- processor or graphics card model is unknown or has no value, and loose parts that name only the type
-- ("Placa gráfica 8GB") where neither the title nor the description (read by the AI) gives the model.
-- The friend opens them and marks them seen (done_at).
create table public.unidentified (
  id bigint generated always as identity primary key,
  listing_id bigint not null references public.listings on delete cascade,
  watch_id uuid not null references public.watches on delete cascade,  -- the watch it would be for
  kind text not null check (kind in ('pc', 'part')),
  reason text not null,
  created_at timestamptz not null default now(),
  done_at timestamptz,
  unique (listing_id, watch_id)
);
create index unidentified_open_idx on public.unidentified (created_at desc) where done_at is null;

alter table public.unidentified enable row level security;
create policy "authenticated full access" on public.unidentified for all to authenticated using (true) with check (true);
alter publication supabase_realtime add table public.unidentified;

-- Rows older than 30 days go; listings they still point to are kept, like the ones with matches.
create or replace function public.purge_old_data() returns void
language sql security definer set search_path = '' as $$
  delete from public.runs where started_at < now() - interval '14 days';
  delete from public.unidentified where created_at < now() - interval '30 days';
  delete from public.listings l
  where l.first_seen_at < now() - interval '30 days'
    and not exists (select 1 from public.matches m where m.listing_id = l.id)
    and not exists (select 1 from public.unidentified u where u.listing_id = l.id);
$$;
revoke execute on function public.purge_old_data() from public, anon, authenticated;
