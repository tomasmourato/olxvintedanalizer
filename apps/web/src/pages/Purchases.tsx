// Negócios → Compras: o registo da auto-compra. FASE 1 só tem linhas "Simulação" (dry_run) — o que o
// worker teria comprado. A compra real (bought / a confirmar / falhou) chega na Fase 2. Ver pipeline/buy.ts.
import { supabase } from "../lib/supabase";
import { go, must, useDebounced, useNow, useQuery, useRealtime } from "../lib/live";
import { ago, euros } from "../lib/format";
import { Badge, Empty, Icon, Loading, type Tone } from "../components/ui";

const SELECT = `id, source, price, shipping, total, ceiling, status, skip_reason, error, created_at,
  listing:listings(title, url, photo_url),
  watch:watches(name)`;

async function loadPurchases() {
  return must(await supabase.from("purchases").select(SELECT).order("created_at", { ascending: false }).limit(300));
}
type Purchase = Awaited<ReturnType<typeof loadPurchases>>[number];

const STATUS: Record<string, { label: string; tone: Tone }> = {
  dry_run: { label: "Simulação", tone: "outline" },
  pending: { label: "A comprar…", tone: "outline" },
  bought: { label: "Comprado", tone: "ok" },
  sca_required: { label: "Falta confirmar (3DS)", tone: "outline" },
  failed: { label: "Falhou", tone: "danger" },
  skipped: { label: "Ignorado", tone: "neutral" },
};

export default function Purchases() {
  const { data, error, reload } = useQuery(loadPurchases, []);
  useRealtime("purchases", useDebounced(reload));
  const now = useNow();

  return (
    <div className="space-y-4">
      <button type="button" onClick={() => go("negocios")} className="-ml-1 inline-flex items-center gap-0.5 text-sm text-neutral-400 hover:text-white">
        <Icon name="chevronLeft" className="size-4" />
        Negócios
      </button>
      <p className="rounded-xl border border-amber-900/60 bg-amber-950/30 p-2.5 text-xs text-amber-200/90">
        Fase 1: <strong>simulação</strong>. Estas são as peças que a auto-compra teria comprado — nada foi comprado a sério. Confirma que fazem
        sentido antes de ligar a compra real. Os preços não incluem portes.
      </p>

      {!data ? (
        <Loading error={error} />
      ) : !data.length ? (
        <Empty icon="tag">
          Ainda não há compras. Liga a auto-compra numa pesquisa de peças (Vinted) e define o limite diário nas Definições.
        </Empty>
      ) : (
        <ul className="space-y-2">
          {data.map((p) => (
            <PurchaseCard key={p.id} p={p} now={now} />
          ))}
        </ul>
      )}
      {error && data && <p className="text-xs text-rose-400">Falha ao atualizar: {error}</p>}
    </div>
  );
}

function PurchaseCard({ p, now }: { p: Purchase; now: number }) {
  const s = STATUS[p.status] ?? { label: p.status, tone: "neutral" as Tone };
  const note = p.error ?? p.skip_reason;
  const inner = (
    <div className="flex gap-3">
      {p.listing?.photo_url ? (
        <img src={p.listing.photo_url} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-16 shrink-0 rounded-xl bg-neutral-900 object-cover" />
      ) : (
        <div className="size-16 shrink-0 rounded-xl bg-neutral-900" />
      )}
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex items-start gap-2">
          <p className="line-clamp-2 min-w-0 flex-1 text-sm leading-snug font-medium text-neutral-100">{p.listing?.title ?? "Anúncio removido"}</p>
          <Badge tone={s.tone}>{s.label}</Badge>
        </div>
        <div className="flex flex-wrap items-baseline gap-x-2 tabular-nums">
          <span className="text-lg font-bold tracking-tight text-white">{euros(p.price)}</span>
          {p.ceiling != null && <span className="text-xs text-neutral-500">teto {euros(p.ceiling)}</span>}
          {p.total != null && <span className="text-xs text-neutral-500">total {euros(p.total)}</span>}
        </div>
        <p className="truncate text-xs text-neutral-500">{[p.watch?.name, ago(p.created_at, now)].filter(Boolean).join(" · ")}</p>
        {note && <p className="text-xs wrap-anywhere text-neutral-400">{note}</p>}
      </div>
    </div>
  );
  const className = "block rounded-2xl border border-neutral-800 bg-neutral-950 p-3 wrap-anywhere";
  return (
    <li>
      {p.listing?.url ? (
        <a href={p.listing.url} target="_blank" rel="noopener noreferrer" className={`${className} transition-colors hover:border-neutral-600 active:bg-neutral-900`}>
          {inner}
        </a>
      ) : (
        <div className={className}>{inner}</div>
      )}
    </li>
  );
}
