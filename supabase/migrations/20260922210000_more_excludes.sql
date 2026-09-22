-- More "broken / for parts" exclusions, seen in F2 test runs ("Para reparar/peças").
update public.settings
set global_exclude = global_exclude || array(
  select t from unnest(array['para reparar', 'a reparar', 'com defeito', 'sem funcionar', 'não liga', 'nao liga']) t
  where t <> all (global_exclude)
);
