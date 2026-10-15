import type { Notification, PushKind } from "@dh/shared";
import { supabase } from "../lib/supabase";
import { must, useQuery, useRealtime, useStored } from "../lib/live";
import { ms, when } from "../lib/format";
import { Badge, Empty, Icon, Loading, Segmented } from "../components/ui";
import type { IconName } from "../components/icons";

const LIMIT = 200;
const icon: Record<PushKind, IconName> = { deal: "fire", price_drop: "trendingDown", worker_offline: "warning", test: "beaker", bought: "check", buy_failed: "warning", buy_sca: "question" };
type Filter = "all" | "deals" | "failed";

export default function Notifications() {
  const [f, setF] = useStored<{ show: Filter }>("notifications-filter", { show: "all" });
  const list = useQuery(async () => must(await supabase.from("notifications").select("*").order("created_at", { ascending: false }).limit(LIMIT)), []);
  useRealtime("notifications", (p) => p.eventType === "INSERT" && list.setData((d) => d && [p.new, ...d].slice(0, LIMIT)));

  const rows = (list.data ?? []).filter((n) =>
    f.show === "deals" ? n.kind === "deal" || n.kind === "price_drop" : f.show === "failed" ? n.status !== "sent" : true,
  );

  return (
    <div className="space-y-4">
      <Segmented value={f.show} onChange={(show) => setF({ show })} options={[["all", "Todas"], ["deals", "Negócios"], ["failed", "Falhadas"]]} />
      {!list.data ? (
        <Loading error={list.error} />
      ) : !rows.length ? (
        <Empty icon="bell">Ainda não foi enviada nenhuma notificação.</Empty>
      ) : (
        <ul className="space-y-2">
          {rows.map((n) => (
            <NotificationRow key={n.id} n={n} />
          ))}
        </ul>
      )}
    </div>
  );
}

function NotificationRow({ n }: { n: Notification }) {
  const devices =
    n.status === "sent"
      ? `${n.devices_ok} ${n.devices_ok === 1 ? "dispositivo" : "dispositivos"}`
      : n.devices_ok + n.devices_failed > 0
        ? `${n.devices_ok} ok, ${n.devices_failed} falharam`
        : null;
  const body = (
    <>
      <div className="flex items-start gap-3">
        <span className={`grid size-8 shrink-0 place-items-center rounded-full ${n.kind === "worker_offline" ? "bg-rose-950 text-rose-300" : "bg-neutral-900 text-neutral-300"}`}>
          <Icon name={icon[n.kind as PushKind] ?? "bell"} className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <p className="min-w-0 flex-1 text-sm font-medium wrap-anywhere text-neutral-100">{n.title}</p>
            {n.status === "sent" ? <Badge>Enviada</Badge> : n.status === "partial" ? <Badge tone="outline">Parcial</Badge> : <Badge tone="danger">Falhou</Badge>}
          </div>
          {n.body && <p className="mt-1 text-xs whitespace-pre-line wrap-anywhere text-neutral-400">{n.body}</p>}
          <p className="mt-1 text-xs text-neutral-500">
            {[when(n.created_at, true), devices, n.latency_ms != null && n.match_id != null && `${ms(n.latency_ms)} após a deteção`].filter(Boolean).join(" · ")}
          </p>
          {n.error && <p className="mt-1 text-xs wrap-anywhere text-rose-300">{n.error}</p>}
        </div>
      </div>
    </>
  );
  const box = "block rounded-2xl border border-neutral-800 bg-neutral-950 p-3";
  return (
    <li>
      {n.url && /^https?:/.test(n.url) ? (
        <a href={n.url} target="_blank" rel="noopener noreferrer" className={`${box} transition-colors hover:border-neutral-600`}>
          {body}
        </a>
      ) : (
        <div className={box}>{body}</div>
      )}
    </li>
  );
}
