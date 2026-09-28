// Negócios → "Verificar anúncios": asks the worker (apps/worker/src/checks.ts) to check that every listing shown in
// Negócios is still online on OLX/Vinted; the sold or removed ones (listings.gone_at) leave the lists.
import { useState } from "react";
import { supabase } from "../lib/supabase";
import { errorText, must, useDebounced, useNow, useQuery, useRealtime } from "../lib/live";
import { ago } from "../lib/format";
import { Icon } from "./ui";

const WAIT_MS = 2 * 60_000; // the worker picks a request up within seconds; after this it is probably off

async function loadLast() {
  return must(await supabase.from("listing_checks").select("*").order("requested_at", { ascending: false }).limit(1)).at(0) ?? null;
}

export default function CheckListings() {
  const q = useQuery(loadLast, []);
  useRealtime("listing_checks", useDebounced(q.reload, 300));
  const now = useNow(10_000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const c = q.data;
  const waiting = c != null && !c.started_at && now - Date.parse(c.requested_at) < WAIT_MS;
  const running = c != null && c.started_at != null && !c.finished_at;

  async function start() {
    setBusy(true);
    setError(null);
    try {
      must(await supabase.from("listing_checks").insert({}));
      q.reload();
    } catch (e) {
      setError(`Não consegui pedir a verificação: ${errorText(e)}`);
    } finally {
      setBusy(false);
    }
  }

  const goneText = (n: number) => (n === 1 ? "1 já não existe" : `${n} já não existem`);
  let status: string | null = null;
  if (c && !c.started_at) status = waiting ? "À espera do worker…" : "O worker não pegou no pedido: está desligado?";
  else if (running) status = `A verificar… ${c.checked}/${c.total ?? "?"}${c.gone ? `, ${goneText(c.gone)}` : ""}`;
  else if (c?.finished_at) {
    const gone = c.gone ? `${c.gone === 1 ? "1 vendido ou apagado saiu" : `${c.gone} vendidos ou apagados saíram`} das abas` : "todos continuam online";
    status = `Verificados ${ago(c.finished_at, now)}: ${gone}${c.error ? `. Parou antes do fim: ${c.error}` : "."}`;
  }

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <button
          type="button"
          onClick={() => void start()}
          disabled={busy || waiting || running}
          className="inline-flex items-center gap-1 rounded-full border border-neutral-700 px-3 py-1 text-sm font-medium text-neutral-200 transition-colors hover:border-neutral-500 active:bg-neutral-900 disabled:opacity-50"
        >
          <Icon name="arrowPath" className={`size-4 ${waiting || running ? "animate-spin" : ""}`} strokeWidth={2} />
          Verificar anúncios
        </button>
        {status && <p className="min-w-0 text-xs wrap-anywhere text-neutral-400">{status}</p>}
      </div>
      {!c && !error && <p className="text-xs text-neutral-500">Vê se os anúncios destas abas ainda estão online e tira os vendidos ou apagados.</p>}
      {error && <p className="text-xs wrap-anywhere text-rose-400">{error}</p>}
    </div>
  );
}
