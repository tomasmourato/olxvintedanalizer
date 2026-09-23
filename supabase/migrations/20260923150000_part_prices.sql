-- Value per PC part, keyed by the worker's title parser (pipeline/parts.ts), e.g. gpu:rtx-3060-ti, ram:ddr4-16.
-- market_* is refreshed every 6 h by the worker (pipeline/prices.ts): the trimmed median of used single-part
-- listings over 30 days, Portuguese ones when there are at least 5 (scope pt), else the EU (scope eu).
-- manual_value is the friend's own value (Pesquisas → Preços das peças) and always wins.
create table public.part_prices (
  key text primary key,
  type text not null check (type in ('gpu', 'cpu', 'ram', 'storage', 'psu', 'motherboard', 'cooler', 'case')),
  label text not null,
  market_value numeric(10, 2),
  market_scope text check (market_scope in ('pt', 'eu')),
  samples int not null default 0,
  market_at timestamptz,
  manual_value numeric(10, 2) check (manual_value >= 0),
  updated_at timestamptz not null default now()
);

create trigger part_prices_updated_at before update on public.part_prices
  for each row execute function public.set_updated_at();

alter table public.part_prices enable row level security;
create policy "authenticated full access" on public.part_prices for all to authenticated using (true) with check (true);

alter publication supabase_realtime add table public.part_prices;
