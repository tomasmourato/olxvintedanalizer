-- PC watches: a whole computer is valued by its parts (part_prices) and its tier comes from the margin
-- (parts value − asking price) instead of the watch's € prices.
alter table public.watches
  add column kind text not null default 'part' check (kind in ('part', 'pc')),
  add column margin_good numeric(10, 2),   -- "Bom com margem de" (€)
  add column margin_great numeric(10, 2),  -- "Imperdível com margem de" (€)
  add constraint watches_margins_check check (margin_great is null or margin_good is null or margin_great >= margin_good);

-- The parts found in a PC listing: [{type, label, key, value, source: 'manual'|'mercado'|null, samples}].
alter table public.matches
  add column parts jsonb,
  add column parts_value numeric(10, 2);
