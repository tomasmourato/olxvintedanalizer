import { useMemo, type ReactNode } from "react";
import type { Tier } from "@dh/shared";
import { supabase } from "../lib/supabase";
import { must, useDebounced, useNow, useQuery, useRealtime, useStored } from "../lib/live";
import { ago, euros, pct, sourceLabel } from "../lib/format";
import { Badge, Empty, Icon, Loading, Select, type Tone } from "../components/ui";
import type { IconName } from "../components/icons";

const SELECT = `id, price, median_price, discount_pct, score, tier, reason, red_flags, ai_status, notified, created_at, updated_at,
  listing:listings!inner(id, source, title, price, previous_price, url, photo_url, location, country),
  watch:watches!inner(id, name, category)`;

const PERIODS = { "24h": 1, "7d": 7, "30d": 30 } as const;
type Period = keyof typeof PERIODS;
type Filters = { period: Period; source: "all" | "olx" | "vinted"; watch: string; sort: "score" | "discount" | "date"; group: "tier" | "category"; closed: string[] };

const TIERS: { tier: Tier; title: string }[] = [
  { tier: "imperdivel", title: "Imperdíveis" },
  { tier: "bom", title: "Bons" },
  { tier: "normal", title: "Resto" },
];
const tierTone: Record<Tier, Tone> = { imperdivel: "invert", bom: "outline", normal: "neutral" };

async function loadDeals(period: Period) {
  const since = new Date(Date.now() - PERIODS[period] * 86_400_000).toISOString();
  return must(await supabase.from("matches").select(SELECT).gte("updated_at", since).order("updated_at", { ascending: false }).limit(500));
}
type Deal = Awaited<ReturnType<typeof loadDeals>>[number];

const bySort: Record<Filters["sort"], (a: Deal, b: Deal) => number> = {
  score: (a, b) => (b.score ?? -1) - (a.score ?? -1),
  discount: (a, b) => (b.discount_pct ?? -1e9) - (a.discount_pct ?? -1e9),
  date: () => 0, // already newest first
};

export default function Deals() {
  const [f, setF] = useStored<Filters>("deals-filters", { period: "7d", source: "all", watch: "all", sort: "score", group: "tier", closed: ["normal"] });
  const set = (patch: Partial<Filters>) => setF({ ...f, ...patch });
  const { data, error, reload } = useQuery(() => loadDeals(f.period), [f.period]);
  useRealtime("matches", useDebounced(reload));
  const now = useNow();

  const watches = useMemo(() => {
    const m = new Map((data ?? []).map((d) => [d.watch.id, d.watch.name]));
    return [...m].sort((a, b) => a[1].localeCompare(b[1]));
  }, [data]);

  const groups = useMemo(() => {
    const rows = (data ?? [])
      .filter((d) => (f.source === "all" || d.listing.source === f.source) && (f.watch === "all" || d.watch.id === f.watch))
      .sort(bySort[f.sort]);
    if (f.group === "tier") return TIERS.map((t) => ({ key: t.tier, title: t.title, rows: rows.filter((d) => d.tier === t.tier) }));
    const cats = [...new Set(rows.map((d) => d.watch.category))].sort((a, b) => a.localeCompare(b));
    return cats.map((c) => ({ key: `cat:${c}`, title: c, rows: rows.filter((d) => d.watch.category === c) }));
  }, [data, f.source, f.watch, f.sort, f.group]);

  const isOpen = (key: string) => !f.closed.includes(key);
  const flip = (key: string) => set({ closed: isOpen(key) ? [...f.closed, key] : f.closed.filter((k) => k !== key) });

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        <Select label="Período" value={f.period} onChange={(period) => set({ period })} options={[["24h", "24 horas"], ["7d", "7 dias"], ["30d", "30 dias"]]} />
        <Select label="Fonte" value={f.source} onChange={(source) => set({ source })} options={[["all", "Todas"], ["olx", "OLX"], ["vinted", "Vinted"]]} />
        <Select label="Ordenar" value={f.sort} onChange={(sort) => set({ sort })} options={[["score", "Pontuação"], ["discount", "Desconto"], ["date", "Recentes"]]} />
        <div className="col-span-2 min-w-0 sm:col-span-1">
          <Select label="Pesquisa" value={f.watch} onChange={(watch) => set({ watch })} options={[["all", "Todas"], ...watches]} />
        </div>
        <Select label="Agrupar" value={f.group} onChange={(group) => set({ group })} options={[["tier", "Nível"], ["category", "Categoria"]]} />
      </div>

      {!data ? (
        <Loading error={error} />
      ) : groups.every((g) => !g.rows.length) ? (
        <Empty icon="tag">Sem negócios neste período.</Empty>
      ) : (
        groups.map(
          (g) =>
            g.rows.length > 0 && (
              <section key={g.key}>
                <button type="button" onClick={() => flip(g.key)} className="mb-2 flex w-full items-center gap-2 py-1 text-left font-semibold tracking-tight">
                  <Icon name="chevronRight" strokeWidth={2} className={`size-4 text-neutral-500 transition-transform ${isOpen(g.key) ? "rotate-90" : ""}`} />
                  {g.title}
                  <span className="rounded-full bg-neutral-800 px-2 py-0.5 text-xs font-medium text-neutral-300 tabular-nums">{g.rows.length}</span>
                </button>
                {isOpen(g.key) && (
                  <div className="space-y-2">
                    {g.rows.map((d) => (
                      <DealCard key={d.id} d={d} now={now} />
                    ))}
                  </div>
                )}
              </section>
            ),
        )
      )}
      {error && data && <p className="text-xs text-rose-400">Falha ao atualizar: {error}</p>}
    </div>
  );
}

function DealCard({ d, now }: { d: Deal; now: number }) {
  const l = d.listing;
  const dropped = l.previous_price != null && l.price != null && Number(l.previous_price) > Number(l.price);
  const discount = Number(d.discount_pct ?? 0);
  return (
    <a
      href={l.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex gap-3 rounded-2xl border border-neutral-800 bg-neutral-950 p-3 transition-colors hover:border-neutral-600 active:bg-neutral-900"
    >
      {l.photo_url ? (
        <img src={l.photo_url} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-20 shrink-0 rounded-xl bg-neutral-900 object-cover" />
      ) : (
        <div className="size-20 shrink-0 rounded-xl bg-neutral-900" />
      )}
      <div className="min-w-0 flex-1 space-y-1.5 wrap-anywhere">
        <div className="flex items-start gap-2">
          <p className="line-clamp-2 min-w-0 flex-1 text-sm leading-snug font-medium text-neutral-100">{l.title}</p>
          <Badge tone={tierTone[d.tier as Tier]}>
            {d.score ?? "—"}
            <span className="-ml-1 opacity-60">/100</span>
          </Badge>
        </div>
        <div className="flex flex-wrap items-baseline gap-x-2 tabular-nums">
          <span className="text-xl font-bold tracking-tight text-white">{euros(l.price)}</span>
          {dropped && <span className="text-sm text-neutral-500 line-through">{euros(l.previous_price)}</span>}
          {d.median_price != null && <span className="text-xs text-neutral-500">mediana {euros(d.median_price)}</span>}
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          {discount > 0 && <Badge tone="outline">−{pct(discount)}</Badge>}
          <Badge>{sourceLabel[l.source as keyof typeof sourceLabel]}</Badge>
          {dropped && <Tag icon="trendingDown">baixou</Tag>}
          {d.notified && <Tag icon="bell">avisado</Tag>}
        </div>
        {d.reason && <p className="text-xs leading-relaxed text-neutral-400">{d.reason}</p>}
        {d.red_flags.length > 0 && (
          <ul className="space-y-0.5">
            {d.red_flags.map((r) => (
              <li key={r} className="flex items-start gap-1 text-xs text-rose-400">
                <Icon name="warning" className="mt-px size-3.5" />
                {r}
              </li>
            ))}
          </ul>
        )}
        <p className="truncate text-xs text-neutral-500">
          {[d.watch.name, ago(d.updated_at, now), l.location, l.country && l.country !== "PT" ? l.country : null].filter(Boolean).join(" · ")}
        </p>
      </div>
    </a>
  );
}

function Tag({ icon, children }: { icon: IconName; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 text-xs text-neutral-300">
      <Icon name={icon} className="size-3.5" />
      {children}
    </span>
  );
}
