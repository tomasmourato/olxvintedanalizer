import { useMemo } from "react";
import type { Tier } from "@dh/shared";
import { supabase } from "../lib/supabase";
import { must, useDebounced, useNow, useQuery, useRealtime, useStored } from "../lib/live";
import { ago, euros, pct, sourceLabel } from "../lib/format";
import { Badge, Empty, Loading, Select, type Tone } from "../components/ui";

const SELECT = `id, price, median_price, discount_pct, score, tier, reason, red_flags, ai_status, notified, created_at, updated_at,
  listing:listings!inner(id, source, title, price, previous_price, url, photo_url, location, country),
  watch:watches!inner(id, name, category)`;

const PERIODS = { "24h": 1, "7d": 7, "30d": 30 } as const;
type Period = keyof typeof PERIODS;
type Filters = { period: Period; source: "all" | "olx" | "vinted"; watch: string; sort: "score" | "discount" | "date"; group: "tier" | "category"; closed: string[] };

const TIERS: { tier: Tier; title: string }[] = [
  { tier: "imperdivel", title: "🔥 Imperdíveis" },
  { tier: "bom", title: "👍 Bons" },
  { tier: "normal", title: "Resto" },
];
const tierTone: Record<Tier, Tone> = { imperdivel: "orange", bom: "emerald", normal: "slate" };

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
        <div className="col-span-2 sm:col-span-1">
          <Select label="Pesquisa" value={f.watch} onChange={(watch) => set({ watch })} options={[["all", "Todas"], ...watches]} />
        </div>
        <Select label="Agrupar" value={f.group} onChange={(group) => set({ group })} options={[["tier", "Nível"], ["category", "Categoria"]]} />
      </div>

      {!data ? (
        <Loading error={error} />
      ) : groups.every((g) => !g.rows.length) ? (
        <Empty>Sem negócios neste período.</Empty>
      ) : (
        groups.map(
          (g) =>
            g.rows.length > 0 && (
              <section key={g.key}>
                <button type="button" onClick={() => flip(g.key)} className="mb-2 flex w-full items-center gap-2 text-left font-semibold">
                  <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden className={`size-4 text-slate-500 transition-transform ${isOpen(g.key) ? "rotate-90" : ""}`}>
                    <path d="M7.2 4.2a.75.75 0 0 1 1.06 0l5.25 5.25a.75.75 0 0 1 0 1.06l-5.25 5.25a.75.75 0 1 1-1.06-1.06L11.92 10 7.2 5.28a.75.75 0 0 1 0-1.06Z" />
                  </svg>
                  {g.title}
                  <span className="text-sm font-normal text-slate-500">{g.rows.length}</span>
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
      className="flex gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-3 transition-colors hover:border-slate-600"
    >
      {l.photo_url ? (
        <img src={l.photo_url} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-20 shrink-0 rounded-lg bg-slate-800 object-cover" />
      ) : (
        <div className="size-20 shrink-0 rounded-lg bg-slate-800" />
      )}
      <div className="min-w-0 flex-1 space-y-1">
        <p className="line-clamp-2 text-sm font-medium text-slate-100">{l.title}</p>
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-lg font-bold text-white">{euros(l.price)}</span>
          {dropped && <span className="text-sm text-slate-500 line-through">{euros(l.previous_price)}</span>}
          {d.median_price != null && <span className="text-xs text-slate-400">mediana {euros(d.median_price)}</span>}
        </div>
        <div className="flex flex-wrap gap-1">
          <Badge tone={tierTone[d.tier as Tier]}>{d.score ?? "—"}/100</Badge>
          {discount > 0 && <Badge tone="emerald">−{pct(discount)}</Badge>}
          {dropped && <Badge tone="sky">📉 baixou</Badge>}
          <Badge>{sourceLabel[l.source as keyof typeof sourceLabel]}</Badge>
          {d.notified && <Badge tone="sky">🔔 avisado</Badge>}
        </div>
        {d.reason && <p className="text-xs text-slate-300">{d.reason}</p>}
        {d.red_flags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {d.red_flags.map((r) => (
              <Badge key={r} tone="rose">⚠ {r}</Badge>
            ))}
          </div>
        )}
        <p className="truncate text-xs text-slate-500">
          {[d.watch.name, ago(d.updated_at, now), l.location, l.country && l.country !== "PT" ? l.country : null].filter(Boolean).join(" · ")}
        </p>
      </div>
    </a>
  );
}
