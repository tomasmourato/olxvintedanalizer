import { Fragment, useMemo } from "react";
import { isActive, type Run, type Settings, type Source, type WorkerStatus } from "@dh/shared";
import { supabase } from "../lib/supabase";
import { must, useNow, useQuery, useRealtime, useStored } from "../lib/live";
import { scopeLabel } from "../lib/categories";
import { ago, ms, sourceLabel, when } from "../lib/format";
import { Badge, Card, Dot, Empty, Loading, Select } from "../components/ui";

const LIMIT = 200;
/** The worker writes a heartbeat every minute. */
const ONLINE_MS = 3 * 60_000;

type RunKind = "category" | "search" | "enrich";
type Filters = { source: "all" | Source; status: "all" | "problems"; kind: "all" | RunKind };

export function workerOnline(w: WorkerStatus | null | undefined, now: number): boolean {
  return !!w?.heartbeat_at && now - new Date(w.heartbeat_at).getTime() < ONLINE_MS;
}

export default function Logs({ worker, settings }: { worker: WorkerStatus | null | undefined; settings: Settings | undefined }) {
  const [f, setF] = useStored<Filters>("logs-filters", { source: "all", status: "all", kind: "all" });
  const set = (patch: Partial<Filters>) => setF({ ...f, ...patch });
  const runs = useQuery(async () => must(await supabase.from("runs").select("*").order("started_at", { ascending: false }).limit(LIMIT)), []);
  useRealtime("runs", (p) => p.eventType === "INSERT" && runs.setData((d) => d && [p.new, ...d].slice(0, LIMIT)));
  const now = useNow(15_000);

  const rows = useMemo(
    () =>
      (runs.data ?? []).filter(
        (r) => (f.source === "all" || r.source === f.source) && (f.status === "all" || r.status !== "ok") && (f.kind === "all" || r.kind === f.kind),
      ),
    [runs.data, f],
  );

  return (
    <div className="space-y-4">
      <WorkerCard worker={worker} settings={settings} now={now} />
      <LastHour runs={runs.data} now={now} />
      <Card title="Pedidos">
        <div className="mb-3 grid grid-cols-3 gap-2">
          <Select label="Fonte" value={f.source} onChange={(source) => set({ source })} options={[["all", "Todas"], ["olx", "OLX"], ["vinted", "Vinted"]]} />
          <Select label="Tipo" value={f.kind} onChange={(kind) => set({ kind })} options={[["all", "Todos"], ["category", "Categoria"], ["search", "Pesquisa"], ["enrich", "Detalhes"]]} />
          <Select label="Estado" value={f.status} onChange={(status) => set({ status })} options={[["all", "Todos"], ["problems", "Com erro"]]} />
        </div>
        {!runs.data ? (
          <Loading error={runs.error} />
        ) : !rows.length ? (
          <Empty>Sem pedidos.</Empty>
        ) : (
          <ul className="divide-y divide-neutral-800">
            {rows.map((r) => (
              <RunRow key={r.id} r={r} />
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function WorkerCard({ worker: w, settings: s, now }: { worker: WorkerStatus | null | undefined; settings: Settings | undefined; now: number }) {
  if (w === undefined) return <Card title="Worker"><Loading /></Card>;
  const online = workerOnline(w, now);
  const active = s ? isActive(s.active_from, s.active_to, s.timezone, new Date(now)) : true;
  const paused = (["olx", "vinted"] as const).filter((src) => {
    const until = w?.[`${src}_paused_until`];
    return until && new Date(until).getTime() > now;
  });

  return (
    <Card title="Worker" actions={<Badge tone={online ? "ok" : "danger"}><Dot on={online} />{online ? "Online" : "Offline"}</Badge>}>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-neutral-500">Último sinal</dt>
        <dd>{w?.heartbeat_at ? `${ago(w.heartbeat_at, now)} (${when(w.heartbeat_at, true)})` : "nunca"}</dd>
        {w?.started_at && (
          <>
            <dt className="text-neutral-500">Arrancou</dt>
            <dd>{when(w.started_at)}{w.version ? ` · v${w.version}` : ""}</dd>
          </>
        )}
        {s && (
          <>
            <dt className="text-neutral-500">Horário</dt>
            <dd>
              {s.active_from.slice(0, 5)}–{s.active_to.slice(0, 5)} {active ? <span className="text-neutral-200">(a procurar)</span> : <span className="text-neutral-400">(em pausa até às {s.active_from.slice(0, 5)})</span>}
            </dd>
          </>
        )}
        {paused.map((src) => (
          <Fragment key={src}>
            <dt className="text-rose-400">{sourceLabel[src]} em pausa</dt>
            <dd className="text-rose-300">até às {when(w![`${src}_paused_until`]!)} (bloqueios seguidos)</dd>
          </Fragment>
        ))}
        {w?.last_error && (
          <>
            <dt className="text-neutral-500">Último erro</dt>
            <dd className="break-words text-rose-300">
              {w.last_error}
              {w.last_error_at && <span className="text-neutral-500"> · {ago(w.last_error_at, now)}</span>}
            </dd>
          </>
        )}
      </dl>
      {!online && active && w?.heartbeat_at && (
        <p className="mt-3 text-xs text-neutral-400">Se o PC estiver ligado, verifica se o worker está a correr (pm2). Depois de 10 min sem sinal recebes um push.</p>
      )}
    </Card>
  );
}

function LastHour({ runs, now }: { runs: Run[] | undefined; now: number }) {
  if (!runs) return null;
  const recent = runs.filter((r) => now - new Date(r.started_at).getTime() < 3_600_000);
  const stats = [
    ["Pedidos", recent.length],
    ["Erros", recent.filter((r) => r.status !== "ok").length],
    ["Anúncios novos", recent.reduce((n, r) => n + r.items_new, 0)],
    ["Matches", recent.reduce((n, r) => n + r.matches, 0)],
  ] as const;
  return (
    <div>
      <p className="mb-1 text-xs text-neutral-500">Última hora{runs.length >= LIMIT && recent.length >= LIMIT ? ` (últimos ${LIMIT} pedidos)` : ""}</p>
      <div className="grid grid-cols-4 gap-2">
        {stats.map(([label, n]) => (
          <div key={label} className="rounded-2xl border border-neutral-800 bg-neutral-950 p-2 text-center">
            <p className={`text-xl font-bold tracking-tight tabular-nums ${label === "Erros" && n > 0 ? "text-rose-400" : ""}`}>{n}</p>
            <p className="text-[11px] leading-tight text-neutral-500">{label}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

const kindLabel: Record<RunKind, string> = { category: "categoria", search: "pesquisa", enrich: "detalhes" };

function RunRow({ r }: { r: Run }) {
  const src = r.source as Source;
  const tone = r.status === "ok" ? "neutral" : "danger";
  return (
    <li className="py-2 text-sm">
      <div className="flex items-center gap-2">
        <span className="shrink-0 font-mono text-xs text-neutral-500">{when(r.started_at, true)}</span>
        <Badge>{sourceLabel[src]}</Badge>
        <span className="truncate text-neutral-200">
          <span className="text-neutral-500">{kindLabel[r.kind as RunKind]}</span> {scopeLabel(src, r.kind, r.scope)}
        </span>
        <span className="ml-auto shrink-0">
          <Badge tone={tone}>{r.http_status ?? r.status}</Badge>
        </span>
      </div>
      <p className="mt-0.5 text-xs text-neutral-500">
        {[
          r.duration_ms != null && ms(r.duration_ms),
          r.kind !== "enrich" && `${r.items_read} lidos`,
          r.items_new > 0 && `${r.items_new} novos`,
          r.matches > 0 && `${r.matches} ${r.matches === 1 ? "match" : "matches"}`,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
      {r.error && <p className="mt-0.5 text-xs break-words text-rose-300">{r.error}</p>}
    </li>
  );
}
