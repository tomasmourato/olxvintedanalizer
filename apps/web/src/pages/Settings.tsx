import { useState, type FormEvent } from "react";
import type { Settings as SettingsRow, Source, Update } from "@dh/shared";
import { supabase } from "../lib/supabase";
import { errorText, go, must, useQuery } from "../lib/live";
import { CATEGORIES, categoryName } from "../lib/categories";
import { ago, parsePrice, priceText, when } from "../lib/format";
import { currentEndpoint } from "../lib/push";
import { Badge, Button, Card, Dot, Field, Icon, Loading, Message, PickList, TagInput, TextArea, Toggle } from "../components/ui";
import PushCard from "../components/PushCard";
import Account from "./Account";

/** online: the worker's state, null while it loads. */
export default function Settings({ settings, email, online, onSaved }: { settings: SettingsRow | undefined; email: string; online: boolean | null; onSaved: () => void }) {
  const devices = useQuery(loadDevices, []);
  return (
    <div className="space-y-4">
      <PushCard onChange={devices.reload} />
      <LogsLink online={online} />
      {settings ? <SettingsForm key={settings.updated_at} settings={settings} onSaved={onSaved} /> : <Loading />}
      <Devices q={devices} />
      <Account email={email} />
    </div>
  );
}

function LogsLink({ online }: { online: boolean | null }) {
  return (
    <a
      href="#/definicoes/logs"
      className="flex items-center gap-3 rounded-2xl border border-neutral-800 bg-neutral-950 p-4 transition-colors hover:border-neutral-600 active:bg-neutral-900"
    >
      <Icon name="list" className="size-6 text-neutral-400" />
      <div className="min-w-0 flex-1">
        <p className="font-semibold tracking-tight">Logs</p>
        <p className="text-sm text-neutral-500">Estado do worker, pedidos ao OLX e Vinted e erros.</p>
      </div>
      {online != null && (
        <Badge tone={online ? "ok" : "danger"}>
          <Dot on={online} />
          {online ? "Online" : "Offline"}
        </Badge>
      )}
      <Icon name="chevronRight" className="size-4 text-neutral-500" />
    </a>
  );
}

type Draft = {
  global_context: string;
  candidate_threshold: string;
  notify_threshold: string;
  ai_enabled: boolean;
  push_enabled: boolean;
  auto_buy_enabled: boolean;
  auto_buy_daily_cap: string;
  auto_buy_max_default: string;
  active_from: string;
  active_to: string;
  global_exclude: string[];
  vinted_countries: string[];
  olx_categories: number[];
  vinted_catalogs: number[];
  olx_interval_s: string;
  olx_search_interval_s: string;
  vinted_interval_s: string;
  vinted_search_interval_s: string;
};

const INTERVALS = [
  ["olx_interval_s", "OLX: categorias", 30],
  ["olx_search_interval_s", "OLX: pesquisas", 10],
  ["vinted_interval_s", "Vinted: categorias", 10],
  ["vinted_search_interval_s", "Vinted: pesquisas", 10],
] as const;
type IntervalKey = (typeof INTERVALS)[number][0];

function toDraft(s: SettingsRow): Draft {
  return {
    global_context: s.global_context,
    candidate_threshold: String(s.candidate_threshold),
    notify_threshold: String(s.notify_threshold),
    ai_enabled: s.ai_enabled,
    push_enabled: s.push_enabled,
    auto_buy_enabled: s.auto_buy_enabled,
    auto_buy_daily_cap: priceText(s.auto_buy_daily_cap),
    auto_buy_max_default: priceText(s.auto_buy_max_default),
    active_from: s.active_from.slice(0, 5),
    active_to: s.active_to.slice(0, 5),
    global_exclude: s.global_exclude,
    vinted_countries: s.vinted_countries,
    olx_categories: s.olx_categories,
    vinted_catalogs: s.vinted_catalogs,
    olx_interval_s: String(s.olx_interval_s),
    olx_search_interval_s: String(s.olx_search_interval_s),
    vinted_interval_s: String(s.vinted_interval_s),
    vinted_search_interval_s: String(s.vinted_search_interval_s),
  };
}

function int(s: string, label: string, min: number, max = Infinity): number {
  const n = Number(s.trim());
  if (!Number.isInteger(n) || n < min || n > max) throw new Error(`${label}: tem de ser um número inteiro${max < Infinity ? ` entre ${min} e ${max}` : ` ≥ ${min}`}.`);
  return n;
}

function toRow(d: Draft): Update<"settings"> {
  const candidate = int(d.candidate_threshold, "Limiar de \"Bom\"", 0, 100);
  const notify = int(d.notify_threshold, "Limiar de \"Imperdível\"", 0, 100);
  if (candidate > notify) throw new Error("O limiar de \"Bom\" tem de ser menor ou igual ao de \"Imperdível\".");
  if (!d.active_from || !d.active_to) throw new Error("Preenche o horário.");
  return {
    ...d,
    candidate_threshold: candidate,
    notify_threshold: notify,
    auto_buy_daily_cap: parsePrice(d.auto_buy_daily_cap, "Limite diário de auto-compra") ?? 0,
    auto_buy_max_default: parsePrice(d.auto_buy_max_default, "Teto de auto-compra por omissão"),
    ...(Object.fromEntries(INTERVALS.map(([key, label, min]) => [key, int(d[key], label, min)])) as Record<IntervalKey, number>),
  };
}

/** Category options: the known ones plus any other id already saved. */
function categoryOptions(source: Source, saved: number[]) {
  const known = CATEGORIES[source];
  return [...known, ...saved.filter((id) => !known.some((c) => c.id === id)).map((id) => ({ id, name: categoryName(source, id) }))];
}

function SettingsForm({ settings, onSaved }: { settings: SettingsRow; onSaved: () => void }) {
  const [initial] = useState(() => toDraft(settings));
  const [d, setD] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const set = (patch: Partial<Draft>) => {
    setD((prev) => ({ ...prev, ...patch }));
    setStatus(null);
  };
  const dirty = JSON.stringify(d) !== JSON.stringify(initial);

  async function save(e: FormEvent) {
    e.preventDefault();
    setStatus(null);
    try {
      const row = toRow(d);
      setBusy(true);
      must(await supabase.from("settings").update(row).eq("id", true).select("id"));
      onSaved(); // remounts this form with the saved values
    } catch (err) {
      setStatus({ kind: "error", text: errorText(err) });
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="space-y-4">
      <Card title="Avaliação">
        <div className="space-y-3">
          <TextArea
            label="Contexto global para a IA"
            rows={6}
            value={d.global_context}
            onChange={(e) => set({ global_context: e.target.value })}
            placeholder="Ex.: Compro peças para montar e revender PCs gaming. Um bom negócio é poder revender com 30 % de margem. Prefiro vendedores perto de Lisboa. Desconfio de preços muito abaixo do mercado."
            hint="A IA lê isto em todas as avaliações, junto com o contexto de cada pesquisa."
          />
          <Toggle label="Usar IA (Gemini)" hint="Desligada, a pontuação vem só das regras de preço." checked={d.ai_enabled} onChange={(ai_enabled) => set({ ai_enabled })} />
          <Toggle label="Enviar notificações" hint="Desligada, não sai nenhum push (nem o aviso de worker offline). Os negócios continuam a aparecer na app." checked={d.push_enabled} onChange={(push_enabled) => set({ push_enabled })} />
          <details className="group rounded-xl border border-neutral-800 px-3 py-2.5">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-sm text-neutral-300 [&::-webkit-details-marker]:hidden">
              Avançado: pontuação 0–100
              <Icon name="chevronRight" className="size-4 text-neutral-500 transition-transform group-open:rotate-90" />
            </summary>
            <p className="mt-2 text-xs text-neutral-500">
              Só conta nas pesquisas sem preços em € (Imperdível até / Bom até): nessas, o nível vem da pontuação das regras e da IA. Nas outras, a IA trava os anúncios com pontuação abaixo de Bom.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Field label="Bom a partir de" type="number" inputMode="numeric" min={0} max={100} value={d.candidate_threshold} onChange={(e) => set({ candidate_threshold: e.target.value })} hint="Estes vão à IA." />
              <Field label="Imperdível a partir de" type="number" inputMode="numeric" min={0} max={100} value={d.notify_threshold} onChange={(e) => set({ notify_threshold: e.target.value })} hint="Estes mandam push." />
            </div>
          </details>
        </div>
      </Card>

      <Card title="Auto-compra (Vinted)">
        <div className="space-y-3">
          <p className="rounded-xl border border-amber-900/60 bg-amber-950/30 p-2.5 text-xs text-amber-200/90">
            Compra peças no Vinted automaticamente quando são imperdíveis e ficam dentro do teto. <strong>Fase 1: só simula</strong> — nada é
            comprado a sério; vê em Negócios → Compras o que teria comprado. Automatizar compras vai contra os Termos do Vinted e arrisca a conta
            (ban, saldo perdido). Paga sempre pelo saldo da carteira Vinted, nunca por cartão.
          </p>
          <Toggle
            label="Ativar auto-compra (interruptor geral)"
            hint="Desligado, o worker nunca compra. A simulação da Fase 1 funciona na mesma; isto é o que, na Fase 2, autoriza a compra a sério."
            checked={d.auto_buy_enabled}
            onChange={(auto_buy_enabled) => set({ auto_buy_enabled })}
          />
          <div className="grid grid-cols-2 gap-2">
            <Field label="Limite diário €" inputMode="decimal" value={d.auto_buy_daily_cap} onChange={(e) => set({ auto_buy_daily_cap: e.target.value })} hint="0 = não compra (nem simula). Gasto máximo por dia." />
            <Field label="Teto por omissão €" inputMode="decimal" value={d.auto_buy_max_default} onChange={(e) => set({ auto_buy_max_default: e.target.value })} hint="Usado quando a pesquisa não define o seu teto." />
          </div>
          <button type="button" onClick={() => go("negocios/compras")} className="inline-flex items-center gap-1 text-sm text-neutral-300 hover:text-white">
            Ver simulação de compras
            <Icon name="chevronRight" className="size-4" />
          </button>
        </div>
      </Card>

      <Card title="Horário">
        <div className="grid grid-cols-2 gap-2">
          <Field label="Das" type="time" required value={d.active_from} onChange={(e) => set({ active_from: e.target.value })} />
          <Field label="Até às" type="time" required value={d.active_to} onChange={(e) => set({ active_to: e.target.value })} />
        </div>
        <p className="mt-2 text-xs text-neutral-500">Hora de Portugal ({settings.timezone}). Fora deste horário o worker não pesquisa.</p>
      </Card>

      <Card title="Filtros globais">
        <div className="space-y-3">
          <TagInput label="Excluir sempre" value={d.global_exclude} onChange={(global_exclude) => set({ global_exclude })} hint="Títulos com estas palavras são ignorados em todas as pesquisas." />
          <TagInput
            label="Países dos vendedores Vinted"
            value={d.vinted_countries}
            onChange={(vinted_countries) => set({ vinted_countries })}
            clean={(s) => s.trim().toUpperCase()}
            placeholder="Todos"
            hint="Códigos de 2 letras (PT, ES, FR…). Vazio = todos os países."
          />
        </div>
      </Card>

      <Card title="Fontes">
        <div className="space-y-3">
          <PickList label="Categorias OLX lidas" options={categoryOptions("olx", d.olx_categories)} value={d.olx_categories} onChange={(olx_categories) => set({ olx_categories })} />
          <PickList
            label="Categorias Vinted lidas"
            options={categoryOptions("vinted", d.vinted_catalogs)}
            value={d.vinted_catalogs}
            onChange={(vinted_catalogs) => set({ vinted_catalogs })}
            hint="O worker lê os anúncios mais recentes destas categorias e aplica todas as pesquisas. Mais categorias = mais anúncios por pedido."
          />
          <div className="grid grid-cols-2 gap-2">
            {INTERVALS.map(([key, label, min]) => (
              <Field key={key} label={`${label} (s)`} type="number" inputMode="numeric" min={min} value={d[key]} onChange={(e) => set({ [key]: e.target.value })} />
            ))}
          </div>
          <p className="text-xs text-neutral-500">
            Segundos entre pedidos (com variação aleatória). Mais rápido = alertas mais cedo, mas mais risco de bloqueio. Se houver bloqueios seguidos, a fonte pausa sozinha.
          </p>
        </div>
      </Card>

      {dirty && (
        <div className="sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-10 flex flex-wrap items-center gap-3 rounded-2xl border border-neutral-700 bg-neutral-900/95 p-3 shadow-lg shadow-black backdrop-blur-md">
          <Button type="submit" disabled={busy}>{busy ? "A guardar…" : "Guardar definições"}</Button>
          {!busy && <Button variant="ghost" onClick={() => setD(initial)}>Anular</Button>}
          {status && <Message {...status} />}
        </div>
      )}
    </form>
  );
}

async function loadDevices() {
  const [rows, endpoint] = await Promise.all([
    supabase.from("push_subscriptions").select("id, endpoint, label, created_at, last_success_at, failures").order("created_at"),
    currentEndpoint().catch(() => null),
  ]);
  return { rows: must(rows), endpoint };
}

function Devices({ q }: { q: ReturnType<typeof useQuery<Awaited<ReturnType<typeof loadDevices>>>> }) {
  const [error, setError] = useState<string | null>(null);
  async function remove(id: number, label: string | null) {
    if (!confirm(`Deixar de enviar notificações para "${label ?? "este dispositivo"}"?`)) return;
    const { error } = await supabase.from("push_subscriptions").delete().eq("id", id);
    setError(error?.message ?? null);
    q.reload();
  }
  return (
    <Card title="Dispositivos com notificações">
      {!q.data ? (
        <Loading error={q.error} />
      ) : !q.data.rows.length ? (
        <p className="text-sm text-neutral-500">Nenhum. Ativa as notificações em cada telemóvel onde as queres receber.</p>
      ) : (
        <ul className="divide-y divide-neutral-800">
          {q.data.rows.map((s) => (
            <li key={s.id} className="flex items-center gap-3 py-2 text-sm">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-neutral-200">
                  {s.label ?? "Dispositivo"}
                  {s.endpoint === q.data!.endpoint && <Badge tone="outline">este</Badge>}
                </p>
                <p className="text-xs text-neutral-500">
                  {[`desde ${when(s.created_at)}`, s.last_success_at && `último push ${ago(s.last_success_at)}`, s.failures > 0 && `${s.failures} falhas seguidas`]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
              <button type="button" onClick={() => remove(s.id, s.label)} className="text-xs text-rose-400 hover:underline">
                Remover
              </button>
            </li>
          ))}
        </ul>
      )}
      {error && <Message kind="error" text={error} />}
    </Card>
  );
}
