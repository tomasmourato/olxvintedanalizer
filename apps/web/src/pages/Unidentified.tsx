// Negócios → Por identificar: listings the worker could not value because they do not say the model
// (worker: pipeline/process.ts identify() for loose parts, pipeline/pc.ts pcUnknown() for PCs).
// The friend opens them on OLX/Vinted and marks them seen (done_at), which hides them.
import { useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { errorText, must, useDebounced, useNow, useQuery, useRealtime } from "../lib/live";
import { ago, euros, sourceLabel } from "../lib/format";
import { Badge, Empty, Icon, Loading } from "../components/ui";

const SELECT = `id, kind, reason, created_at,
  listing:listings!inner(id, source, title, price, url, photo_url, location, country),
  watch:watches!inner(id, name)`;

async function loadOpen() {
  return must(await supabase.from("unidentified").select(SELECT).is("done_at", null).order("created_at", { ascending: false }).limit(300));
}
type Item = Awaited<ReturnType<typeof loadOpen>>[number];

const markSeen = async (ids: number[], on: boolean) =>
  must(await supabase.from("unidentified").update({ done_at: on ? new Date().toISOString() : null }).in("id", ids));

/** How many are still to look at, for the switch at the top of Negócios. */
export function useUnidentifiedCount(): number | null {
  const q = useQuery(async () => (await supabase.from("unidentified").select("id", { count: "exact", head: true }).is("done_at", null)).count ?? 0, []);
  useRealtime("unidentified", useDebounced(q.reload));
  return q.data ?? null;
}

export default function Unidentified() {
  const q = useQuery(loadOpen, []);
  useRealtime("unidentified", useDebounced(q.reload));
  const now = useNow();
  // Marked here but maybe not yet reloaded; the last marking can be undone for a few seconds.
  const [seen, setSeen] = useState<ReadonlySet<number>>(new Set());
  const [undo, setUndo] = useState<number[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const show = (ids: number[], hidden: boolean) =>
    setSeen((s) => {
      const next = new Set(s);
      for (const id of ids) {
        if (hidden) next.add(id);
        else next.delete(id);
      }
      return next;
    });

  async function mark(ids: number[]) {
    show(ids, true);
    setError(null);
    setUndo(ids);
    clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setUndo(null), 6000);
    try {
      await markSeen(ids, true);
    } catch (e) {
      show(ids, false);
      setUndo(null);
      setError(`Não consegui marcar: ${errorText(e)}`);
    }
  }

  async function restore(ids: number[]) {
    clearTimeout(undoTimer.current);
    setUndo(null);
    try {
      await markSeen(ids, false);
      show(ids, false);
      q.reload();
    } catch (e) {
      setError(`Não consegui anular: ${errorText(e)}`);
    }
  }

  if (!q.data) return <Loading error={q.error} />;
  const items = q.data.filter((u) => !seen.has(u.id));

  return (
    <div className="space-y-3">
      <p className="text-sm text-neutral-400">
        Anúncios que não dizem o modelo: PCs sem o processador ou a gráfica, e peças soltas em que nem a descrição o diz. Abre-os para ver; marca os
        vistos para os tirar daqui.
      </p>
      {items.length > 1 && (
        <button
          type="button"
          onClick={() => confirm(`Marcar os ${items.length} anúncios como vistos?`) && void mark(items.map((u) => u.id))}
          className="inline-flex items-center gap-1 rounded-full border border-neutral-700 px-3 py-1 text-sm font-medium text-neutral-200 transition-colors hover:border-neutral-500 active:bg-neutral-900"
        >
          <Icon name="check" className="size-4" strokeWidth={2} />
          Marcar todos como vistos
        </button>
      )}
      {!items.length ? (
        <Empty icon="question">Nada por identificar.</Empty>
      ) : (
        <div className="space-y-2">
          {items.map((u) => (
            <UnidentifiedCard key={u.id} u={u} now={now} onSeen={() => void mark([u.id])} />
          ))}
        </div>
      )}
      {(error || q.error) && <p className="text-xs wrap-anywhere text-rose-400">{error ?? `Falha ao atualizar: ${q.error}`}</p>}
      {undo && (
        <div className="fixed inset-x-0 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-30 mx-auto max-w-2xl px-4">
          <div role="status" className="flex items-center justify-between gap-3 rounded-xl bg-white py-2 pr-2 pl-4 text-sm text-black shadow-lg">
            {undo.length === 1 ? "Marcado como visto." : `${undo.length} marcados como vistos.`}
            <button type="button" onClick={() => void restore(undo)} className="rounded-lg px-3 py-1.5 font-semibold active:bg-neutral-200">
              Anular
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function UnidentifiedCard({ u, now, onSeen }: { u: Item; now: number; onSeen: () => void }) {
  const l = u.listing;
  // The "Visto" button sits on top of the card link (a button inside <a> is invalid).
  return (
    <div className="relative">
      <a
        href={l.url}
        target="_blank"
        rel="noopener noreferrer"
        className="flex gap-3 rounded-2xl border border-neutral-800 bg-neutral-950 p-3 wrap-anywhere transition-colors hover:border-neutral-600 active:bg-neutral-900"
      >
        {l.photo_url ? (
          <img src={l.photo_url} alt="" loading="lazy" referrerPolicy="no-referrer" className="size-20 shrink-0 rounded-xl bg-neutral-900 object-cover" />
        ) : (
          <div className="size-20 shrink-0 rounded-xl bg-neutral-900" />
        )}
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="line-clamp-2 text-sm leading-snug font-medium text-neutral-100">{l.title}</p>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-xl font-bold tracking-tight text-white tabular-nums">{euros(l.price)}</span>
            <Badge tone="outline">{u.kind === "pc" ? "PC" : "Peça"}</Badge>
            <Badge>{sourceLabel[l.source as keyof typeof sourceLabel]}</Badge>
          </div>
          <p className="flex items-start gap-1 text-xs text-neutral-300">
            <Icon name="question" className="mt-px size-3.5 shrink-0" />
            {u.reason}
          </p>
          <p className="truncate pr-20 text-xs text-neutral-500">
            {[u.watch.name, ago(u.created_at, now), l.location, l.country && l.country !== "PT" ? l.country : null].filter(Boolean).join(" · ")}
          </p>
        </div>
      </a>
      <button
        type="button"
        onClick={onSeen}
        aria-label={`Marcar como visto: ${l.title}`}
        className="absolute right-1.5 bottom-1.5 inline-flex items-center gap-1 rounded-full px-2.5 py-1.5 text-xs font-medium text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-white active:bg-neutral-800"
      >
        <Icon name="check" className="size-4" strokeWidth={2} />
        Visto
      </button>
    </div>
  );
}
