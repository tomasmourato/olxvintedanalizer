-- Per-watch price tiers in euros. target_price is "Imperdível até", good_price is "Bom até".
-- With either set, the price decides the tier and the AI can only veto (worker: pipeline/score.ts).
alter table public.watches add column good_price numeric(10, 2);

alter table public.watches
  add constraint watches_price_tiers_check check (good_price is null or target_price is null or target_price <= good_price);

comment on column public.watches.target_price is 'Imperdível até (€): at or below this price the match is imperdível.';
comment on column public.watches.good_price is 'Bom até (€): at or below this price the match is bom.';
