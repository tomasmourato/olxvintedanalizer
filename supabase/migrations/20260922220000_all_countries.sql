-- Sellers from any country are fine: empty vinted_countries = no country filter.
alter table public.settings alter column vinted_countries set default '{}';
update public.settings set vinted_countries = '{}';
