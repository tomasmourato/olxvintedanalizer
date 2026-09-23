-- Deals the friend deleted in Negócios: hidden in the app, left out of the watch's 30-day median, and never
-- pushed again (a price drop re-evaluates the row but keeps dismissed_at).
alter table public.matches add column dismissed_at timestamptz;
