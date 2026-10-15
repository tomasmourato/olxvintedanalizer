-- Auto-compra Vinted (opt-in). FASE 1: só simulação — o worker nunca compra enquanto
-- AUTO_BUY_LIVE (apps/worker/src/pipeline/buy.ts) estiver a false; grava em public.purchases
-- o que compraria. Só peças da Vinted; na Fase 2 a compra real paga pelo saldo da carteira.
-- Aviso: automatizar compras viola os Termos da Vinted (risco de conta banida e saldo perdido).

-- Pesquisa: ligar a auto-compra e o teto. O teto é do preço do artigo (portes à parte na Fase 1;
-- o total real com portes é verificado no checkout da Fase 2). target_price continua a decidir o tier.
alter table public.watches
  add column auto_buy boolean not null default false,
  add column auto_buy_max numeric(10, 2) check (auto_buy_max is null or auto_buy_max > 0);
comment on column public.watches.auto_buy is 'Auto-compra (Vinted, só peças): comprar automaticamente quando o anúncio é imperdível e o preço <= auto_buy_max.';
comment on column public.watches.auto_buy_max is 'Teto da auto-compra (€): preço do artigo no máximo este valor (portes à parte na Fase 1).';

-- Definições globais: kill switch, teto por omissão e limite de gasto diário.
alter table public.settings
  add column auto_buy_enabled boolean not null default false,
  add column auto_buy_max_default numeric(10, 2) check (auto_buy_max_default is null or auto_buy_max_default > 0),
  add column auto_buy_daily_cap numeric(10, 2) not null default 0 check (auto_buy_daily_cap >= 0);
comment on column public.settings.auto_buy_enabled is 'Kill switch global da auto-compra. Desligado, o worker nunca compra (nem na Fase 2).';
comment on column public.settings.auto_buy_max_default is 'Teto por omissão (€) quando a pesquisa não define auto_buy_max.';
comment on column public.settings.auto_buy_daily_cap is 'Gasto máximo por dia (€) em auto-compras. 0 = não compra (nem simula uma compra).';

-- Registo de cada decisão de auto-compra (inclui as simulações da Fase 1).
create table public.purchases (
  id bigint generated always as identity primary key,
  listing_id bigint references public.listings on delete set null,
  match_id bigint references public.matches on delete set null,
  watch_id uuid references public.watches on delete set null,
  source text not null check (source in ('olx', 'vinted')),
  price numeric(10, 2),             -- preço do artigo (item + taxa de protecção do comprador), portes à parte
  shipping numeric(10, 2),          -- portes: só conhecidos no checkout (Fase 2)
  total numeric(10, 2),             -- price + shipping, quando conhecido
  ceiling numeric(10, 2),           -- teto aplicado (auto_buy_max da pesquisa ou o global)
  status text not null check (status in ('dry_run', 'pending', 'bought', 'sca_required', 'failed', 'skipped')),
  skip_reason text,                 -- porque é que foi 'skipped'
  vinted_transaction_id text,       -- id da transação Vinted (Fase 2)
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (listing_id, watch_id)     -- uma decisão por (anúncio, pesquisa): não compra/simula duas vezes
);
create index purchases_created_idx on public.purchases (created_at desc);

create trigger purchases_updated_at before update on public.purchases
  for each row execute function public.set_updated_at();

alter table public.purchases enable row level security;
create policy "authenticated full access" on public.purchases for all to authenticated using (true) with check (true);
alter publication supabase_realtime add table public.purchases;

-- Resultados de compra, para o registo de notificações.
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('deal', 'price_drop', 'worker_offline', 'test', 'bought', 'buy_failed', 'buy_sca'));

-- Retenção: purchases 90 dias (o resto como em 20260928120000_priority_and_checks.sql).
create or replace function public.purge_old_data() returns void
language sql security definer set search_path = '' as $$
  delete from public.runs where started_at < now() - interval '14 days';
  delete from public.unidentified where created_at < now() - interval '30 days';
  delete from public.listing_checks where requested_at < now() - interval '30 days';
  delete from public.purchases where created_at < now() - interval '90 days';
  delete from public.listings l
  where l.first_seen_at < now() - interval '30 days'
    and not exists (select 1 from public.matches m where m.listing_id = l.id)
    and not exists (select 1 from public.unidentified u where u.listing_id = l.id);
$$;
revoke execute on function public.purge_old_data() from public, anon, authenticated;
