-- The global exclusions had lost their defaults (only the empty-box and laptop words were left), so empty boxes
-- in other languages and broken cards showed up as deals. Restore the defaults (init + more_excludes) and add
-- "empty box" / "has a problem" in the languages Vinted brings. Matching strips accents, so one spelling is enough.
update public.settings
set global_exclude = global_exclude || array(
  select t from unnest(array[
    'avariado', 'avariada', 'para peças', 'não funciona', 'procuro', 'compro', 'troco', 'partido', 'partida',
    'para reparar', 'a reparar', 'com defeito', 'sem funcionar', 'não liga',
    'com problema', 'com problemas', 'caja vacía', 'solo caja', 'scatola vuota', 'solo scatola',
    'boîte vide', 'boîte seule', 'boîte seul', 'empty box', 'box only', 'only box'
  ]) t
  where t <> all (global_exclude)
);
