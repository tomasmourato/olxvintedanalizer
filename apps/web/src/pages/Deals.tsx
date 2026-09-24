import { useMemo, useRef, useState, type ReactNode } from "react";
import type { PcPart, Tier, WatchKind } from "@dh/shared";
import { supabase } from "../lib/supabase";
import { errorText, must, useDebounced, useNow, useQuery, useRealtime, useStored } from "../lib/live";
import { ago, euros, pct, sourceLabel } from "../lib/format";
import { Badge, Empty, Icon, Loading, Segmented, Select, type Tone } from "../components/ui";
import type { IconName } from "../components/icons";

const SELECT = `id, price, median_price, discount_pct, score, tier, reason, red_flags, ai_status, notified, created_at, updated_at, parts, parts_value,
  listing:listings!inner(id, source, title, price, previous_price, url, photo_url, location, country),
  watch:watches!inner(id, name, category, kind)`;

const PERIODS = { "24h": 1, "7d": 7, "30d": 30 } as const;
type Period = keyof typeof PERIODS;
type Filters = {
  kind: WatchKind;
  period: Period;
  source: "all" | "olx" | "vinted";
  watch: string;
  sort: "score" | "discount" | "date";
  group: "tier" | "category";
  closed: string[];
};

const TIERS: { tier: Tier; title: string }[] = [
  { tier: "imperdivel", title: "Imperdíveis" },
  { tier: "bom", title: "Bons" },
  { tier: "normal", title: "Resto" },
];
const tierTone: Record<Tier, Tone> = { imperdivel: "invert", bom: "outline", normal: "neutral" };

async function loadDeals(period: Period) {
  const since = new Date(Date.now() - PERIODS[period] * 86_400_000).toISOString();
  return must(
    await supabase.from("matches").select(SELECT).gte("updated_at", since).is("dismissed_at", null).order("updated_at", { ascending: false }).limit(500),
  );
}
type Deal = Awaited<ReturnType<typeof loadDeals>>[number];

/** Deleting hides the deal for good: the worker leaves dismissed_at alone, skips its pushes and its price in the median. */
const dismiss = async (id: number, on: boolean) =>
  must(await supabase.from("matches").update({ dismissed_at: on ? new Date().toISOString() : null }).eq("id", id));

/** A PC's margin: what its parts are worth minus the asking price. */
const marginOf = (d: Deal) => (d.parts_value != null && d.listing.price != null ? Number(d.parts_value) - Number(d.listing.price) : null);

const bySort: Record<Filters["sort"], (a: Deal, b: Deal) => number> = {
  score: (a, b) => (b.score ?? -1) - (a.score ?? -1),
  discount: (a, b) => (b.discount_pct ?? -1e9) - (a.discount_pct ?? -1e9),
  date: () => 0, // already newest first
};
const byMargin = (a: Deal, b: Deal) => (marginOf(b) ?? -1e9) - (marginOf(a) ?? -1e9);

export default function Deals() {
  const [stored, setF] = useStored<Filters>("deals-filters", { kind: "part", period: "7d", source: "all", watch: "all", sort: "score", group: "tier", closed: ["normal"] });
  const f = { ...stored, kind: stored.kind ?? "part" }; // filters saved before the PC tab existed
  const set = (patch: Partial<Filters>) => setF({ ...f, ...patch });
  const { data, error, reload } = useQuery(() => loadDeals(f.period), [f.period]);
  useRealtime("matches", useDebounced(reload));
  const now = useNow();
  // Deleted here but maybe not yet reloaded; the last one can be undone for a few seconds.
  const [gone, setGone] = useState<ReadonlySet<number>>(new Set());
  const [undo, setUndo] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pc = f.kind === "pc";

  const hide = (id: number, on: boolean) =>
    setGone((g) => {
      const next = new Set(g);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });

  async function remove(id: number) {
    hide(id, true);
    setActionError(null);
    setUndo(id);
    clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setUndo(null), 6000);
    try {
      await dismiss(id, true);
    } catch (e) {
      hide(id, false);
      setUndo(null);
      setActionError(`Não consegui apagar: ${errorText(e)}`);
    }
  }

  async function restore(id: number) {
    clearTimeout(undoTimer.current);
    setUndo(null);
    try {
      await dismiss(id, false);
      hide(id, false);
      reload();
    } catch (e) {
      setActionError(`Não consegui anular: ${errorText(e)}`);
    }
  }

  const ofKind = useMemo(() => (data ?? []).filter((d) => (d.watch.kind === "pc") === pc && !gone.has(d.id)), [data, pc, gone]);

  const watches = useMemo(() => {
    const m = new Map(ofKind.map((d) => [d.watch.id, d.watch.name]));
    return [...m].sort((a, b) => a[1].localeCompare(b[1]));
  }, [ofKind]);

  const groups = useMemo(() => {
    const rows = ofKind
      .filter((d) => (f.source === "all" || d.listing.source === f.source) && (f.watch === "all" || d.watch.id === f.watch))
      .sort(pc && f.sort === "discount" ? byMargin : bySort[f.sort]);
    if (f.group === "tier") return TIERS.map((t) => ({ key: t.tier, title: t.title, rows: rows.filter((d) => d.tier === t.tier) }));
    const cats = [...new Set(rows.map((d) => d.watch.category))].sort((a, b) => a.localeCompare(b));
    return cats.map((c) => ({ key: `cat:${c}`, title: c, rows: rows.filter((d) => d.watch.category === c) }));
  }, [ofKind, pc, f.source, f.watch, f.sort, f.group]);

  const isOpen = (key: string) => !f.closed.includes(key);
  const flip = (key: string) => set({ closed: isOpen(key) ? [...f.closed, key] : f.closed.filter((k) => k !== key) });

  return (
    <div className="space-y-4">
      <Segmented value={f.kind} onChange={(kind) => set({ kind, watch: "all" })} options={[["part", "Peças"], ["pc", "PCs completos"]]} />
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        <Select label="Período" value={f.period} onChange={(period) => set({ period })} options={[["24h", "24 horas"], ["7d", "7 dias"], ["30d", "30 dias"]]} />
        <Select label="Fonte" value={f.source} onChange={(source) => set({ source })} options={[["all", "Todas"], ["olx", "OLX"], ["vinted", "Vinted"]]} />
        <Select
          label="Ordenar"
          value={f.sort}
          onChange={(sort) => set({ sort })}
          options={[["score", "Pontuação"], ["discount", pc ? "Margem" : "Desconto"], ["date", "Recentes"]]}
        />
        <div className="col-span-2 min-w-0 sm:col-span-1">
          <Select label="Pesquisa" value={f.watch} onChange={(watch) => set({ watch })} options={[["all", "Todas"], ...watches]} />
        </div>
        <Select label="Agrupar" value={f.group} onChange={(group) => set({ group })} options={[["tier", "Nível"], ["category", "Categoria"]]} />
      </div>

      {!data ? (
        <Loading error={error} />
      ) : groups.every((g) => !g.rows.length) ? (
        <Empty icon="tag">
          {pc ? "Sem PCs neste período. Para os procurar, cria em Pesquisas uma pesquisa do tipo «PCs completos»." : "Sem negócios neste período."}
        </Empty>
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
                      <DealCard key={d.id} d={d} now={now} onDelete={() => void remove(d.id)} />
                    ))}
                  </div>
                )}
              </section>
            ),
        )
      )}
      {error && data && <p className="text-xs text-rose-400">Falha ao atualizar: {error}</p>}
      {actionError && <p className="text-xs wrap-anywhere text-rose-400">{actionError}</p>}
      {undo != null && (
        <div className="fixed inset-x-0 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-30 mx-auto max-w-2xl px-4">
          <div role="status" className="flex items-center justify-between gap-3 rounded-xl bg-white py-2 pr-2 pl-4 text-sm text-black shadow-lg">
            Negócio apagado.
            <button type="button" onClick={() => void restore(undo)} className="rounded-lg px-3 py-1.5 font-semibold active:bg-neutral-200">
              Anular
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function DealCard({ d, now, onDelete }: { d: Deal; now: number; onDelete: () => void }) {
  const l = d.listing;
  const dropped = l.previous_price != null && l.price != null && Number(l.previous_price) > Number(l.price);
  const discount = Number(d.discount_pct ?? 0);
  const pc = d.watch.kind === "pc";
  const margin = marginOf(d);
  const parts = pc && Array.isArray(d.parts) ? (d.parts as PcPart[]) : [];
  const details = (
    <>
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
      <p className="truncate pr-8 text-xs text-neutral-500">
        {[d.watch.name, ago(d.updated_at, now), l.location, l.country && l.country !== "PT" ? l.country : null].filter(Boolean).join(" · ")}
      </p>
    </>
  );
  // The delete button sits on top of the card link (a button inside <a> is invalid).
  // A PC's parts list and text take the card's full width, below the photo.
  return (
    <div className="relative">
      <a
        href={l.url}
        target="_blank"
        rel="noopener noreferrer"
        className="block space-y-2 rounded-2xl border border-neutral-800 bg-neutral-950 p-3 wrap-anywhere transition-colors hover:border-neutral-600 active:bg-neutral-900"
      >
        <div className="flex gap-3">
          {l.photo_url ? (
            <img src={l.photo_url} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-20 shrink-0 rounded-xl bg-neutral-900 object-cover" />
          ) : (
            <div className="size-20 shrink-0 rounded-xl bg-neutral-900" />
          )}
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex items-start gap-2">
              <p className="line-clamp-2 min-w-0 flex-1 text-sm leading-snug font-medium text-neutral-100">{l.title}</p>
              {pc ? (
                <Badge tone={tierTone[d.tier as Tier]}>{margin == null ? "—" : `${margin >= 0 ? "+" : "−"}${euros(Math.abs(margin))}`}</Badge>
              ) : (
                <Badge tone={tierTone[d.tier as Tier]}>
                  {d.score ?? "—"}
                  <span className="-ml-1 opacity-60">/100</span>
                </Badge>
              )}
            </div>
            <div className="flex flex-wrap items-baseline gap-x-2 tabular-nums">
              <span className="text-xl font-bold tracking-tight text-white">{euros(l.price)}</span>
              {dropped && <span className="text-sm text-neutral-500 line-through">{euros(l.previous_price)}</span>}
              {pc
                ? d.parts_value != null && <span className="text-xs text-neutral-500">peças {euros(d.parts_value)}</span>
                : d.median_price != null && <span className="text-xs text-neutral-500">mediana {euros(d.median_price)}</span>}
            </div>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {pc
                ? margin != null && <Badge tone="outline">margem {margin >= 0 ? "" : "−"}{euros(Math.abs(margin))}</Badge>
                : discount > 0 && <Badge tone="outline">−{pct(discount)}</Badge>}
              <Badge>{sourceLabel[l.source as keyof typeof sourceLabel]}</Badge>
              {dropped && <Tag icon="trendingDown">baixou</Tag>}
              {d.notified && <Tag icon="bell">avisado</Tag>}
            </div>
            {!pc && details}
          </div>
        </div>
        {pc && (
          <div className="space-y-1.5">
            {parts.length > 0 && <PartList parts={parts} />}
            {details}
          </div>
        )}
      </a>
      <button
        type="button"
        onClick={onDelete}
        aria-label={`Apagar negócio: ${l.title}`}
        className="absolute right-1.5 bottom-1.5 grid size-9 place-items-center rounded-full text-neutral-500 transition-colors hover:bg-neutral-800 hover:text-white active:bg-neutral-800"
      >
        <Icon name="trash" className="size-4.5" />
      </button>
    </div>
  );
}

const SOURCE_TEXT: Record<NonNullable<PcPart["source"]>, (p: PcPart) => string> = {
  manual: () => "teu valor",
  mercado: (p) => `mercado (${p.samples})`,
  ia: () => "estimativa IA",
};

/** A PC's parts with what each is worth and where the value comes from (Pesquisas → Preços das peças). */
function PartList({ parts }: { parts: PcPart[] }) {
  return (
    <ul className="divide-y divide-neutral-900 rounded-xl border border-neutral-900 text-xs">
      {parts.map((p, i) => (
        <li key={`${p.key ?? p.label}-${i}`} className="flex items-baseline gap-2 px-2 py-1">
          <span className="min-w-0 flex-1 truncate text-neutral-200">{p.label}</span>
          <span className="shrink-0 text-neutral-500">{p.source ? SOURCE_TEXT[p.source](p) : "sem valor"}</span>
          <span className="w-14 shrink-0 text-right font-medium text-neutral-200 tabular-nums">{p.value != null ? euros(p.value) : "—"}</span>
        </li>
      ))}
    </ul>
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
