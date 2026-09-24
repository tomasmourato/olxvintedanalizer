-- The AI's estimate of a part's used value, saved the first time a PC listing names the part. It counts only
-- when there is neither the friend's value nor a market median (few single-part listings, e.g. most CPUs),
-- so every PC with the same part gets the same value. Re-estimated after 30 days.
alter table public.part_prices
  add column ai_value numeric(10, 2),
  add column ai_at timestamptz;
