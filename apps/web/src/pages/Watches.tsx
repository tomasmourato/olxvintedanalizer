import { useMemo, useState, type FormEvent } from "react";
import type { Insert, Source, Watch } from "@dh/shared";
import { supabase } from "../lib/supabase";
import { errorText, go, must, useDebounced, useQuery, useRealtime } from "../lib/live";
import { CATEGORIES } from "../lib/categories";
import { euros, sourceLabel } from "../lib/format";
import { Button, Card, Empty, Field, Loading, Message, PickList, Switch, TagInput, TextArea, Toggle } from "../components/ui";

const DEFAULT_CATEGORIES = ["Placas gráficas", "Processadores", "Motherboards", "Memória RAM", "Armazenamento", "Fontes", "Caixas", "Computadores", "Portáteis", "Outros"];

async function loadWatches() {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const [watches, matches] = await Promise.all([
    supabase.from("watches").select("*").order("name"),
    supabase.from("matches").select("watch_id, tier").gte("created_at", since).limit(10_000),
  ]);
  const counts = new Map<string, { all: number; top: number }>();
  for (const m of must(matches)) {
    const c = counts.get(m.watch_id) ?? { all: 0, top: 0 };
    c.all++;
    if (m.tier === "imperdivel") c.top++;
    counts.set(m.watch_id, c);
  }
  return { watches: must(watches), counts };
}

export default function Watches({ id }: { id?: string }) {
  const q = useQuery(loadWatches, []);
  useRealtime("watches", useDebounced(q.reload));
  if (!q.data) return <Loading error={q.error} />;

  const categories = [...new Set([...q.data.watches.map((w) => w.category), ...DEFAULT_CATEGORIES])];
  if (id === "nova") return <WatchForm categories={categories} onDone={q.reload} />;
  if (id) {
    const watch = q.data.watches.find((w) => w.id === id);
    return watch ? <WatchForm key={watch.id} watch={watch} categories={categories} onDone={q.reload} /> : <Empty>Pesquisa não encontrada.</Empty>;
  }
  return <WatchList watches={q.data.watches} counts={q.data.counts} onChange={q.reload} />;
}

function WatchList({ watches, counts, onChange }: { watches: Watch[]; counts: Map<string, { all: number; top: number }>; onChange: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const groups = useMemo(() => {
    const cats = [...new Set(watches.map((w) => w.category))].sort((a, b) => a.localeCompare(b));
    return cats.map((c) => ({ category: c, watches: watches.filter((w) => w.category === c) }));
  }, [watches]);

  async function setActive(w: Watch, active: boolean) {
    setPending((p) => ({ ...p, [w.id]: active }));
    setError(null);
    const { error } = await supabase.from("watches").update({ active }).eq("id", w.id);
    if (error) setError(error.message);
    onChange();
    setPending(({ [w.id]: _, ...rest }) => rest);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-slate-400">{watches.filter((w) => w.active).length} de {watches.length} ativas</p>
        <Button onClick={() => go("pesquisas/nova")}>+ Nova pesquisa</Button>
      </div>
      {error && <Message kind="error" text={error} />}
      {!watches.length && <Empty>Ainda não há pesquisas. Cria a primeira.</Empty>}
      {groups.map((g) => (
        <section key={g.category}>
          <h2 className="mb-2 font-semibold">{g.category}</h2>
          <ul className="space-y-2">
            {g.watches.map((w) => {
              const c = counts.get(w.id);
              const active = pending[w.id] ?? w.active;
              return (
                <li key={w.id} className={`flex items-start gap-3 rounded-xl border border-slate-800 bg-slate-900/60 p-3 ${active ? "" : "opacity-60"}`}>
                  <div className="pt-0.5">
                    <Switch checked={active} onChange={(v) => setActive(w, v)} label={`Ativar ${w.name}`} disabled={w.id in pending} />
                  </div>
                  <button type="button" onClick={() => go(`pesquisas/${w.id}`)} className="min-w-0 flex-1 text-left">
                    <p className="font-medium text-slate-100">{w.name}</p>
                    <p className="truncate text-sm text-slate-400">{summary(w)}</p>
                    <p className="text-xs text-slate-500">
                      {[
                        w.sources.map((s) => sourceLabel[s as Source]).join(" + "),
                        w.search_remote && "site todo",
                        c ? `${c.all} matches em 30 dias${c.top ? `, ${c.top} imperdíveis` : ""}` : "sem matches em 30 dias",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </button>
                  <span className="self-center text-slate-600" aria-hidden>›</span>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}

function summary(w: Watch): string {
  const terms = w.include_any.length ? w.include_any.join(", ") : w.include_all.length ? w.include_all.join(" + ") : "qualquer título";
  const prices = [
    w.target_price != null && `alvo ${euros(w.target_price)}`,
    w.price_min != null && `mín. ${euros(w.price_min)}`,
    w.price_max != null && `máx. ${euros(w.price_max)}`,
  ].filter(Boolean);
  return [terms, ...prices].join(" · ");
}

type Draft = Required<Omit<Insert<"watches">, "price_min" | "price_max" | "target_price" | "id" | "created_at" | "updated_at">> & {
  sources: Source[];
  price_min: string;
  price_max: string;
  target_price: string;
};

const priceText = (n: number | null) => (n == null ? "" : String(n).replace(".", ","));

function toDraft(w?: Watch): Draft {
  return {
    name: w?.name ?? "",
    category: w?.category ?? "",
    sources: (w?.sources as Source[]) ?? ["olx", "vinted"],
    include_any: w?.include_any ?? [],
    include_all: w?.include_all ?? [],
    exclude: w?.exclude ?? [],
    olx_category_ids: w?.olx_category_ids ?? [],
    vinted_catalog_ids: w?.vinted_catalog_ids ?? [],
    search_remote: w?.search_remote ?? false,
    price_min: priceText(w?.price_min ?? null),
    price_max: priceText(w?.price_max ?? null),
    target_price: priceText(w?.target_price ?? null),
    context: w?.context ?? "",
    active: w?.active ?? true,
  };
}

/** "" → null; accepts "249,90". Throws on anything else. */
function parsePrice(s: string, label: string): number | null {
  const t = s.trim().replace(/\s|€/g, "").replace(",", ".");
  if (!t) return null;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${label}: valor inválido.`);
  return Math.round(n * 100) / 100;
}

function WatchForm({ watch, categories, onDone }: { watch?: Watch; categories: string[]; onDone: () => void }) {
  const [d, setD] = useState<Draft>(() => toDraft(watch));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<Draft>) => setD((prev) => ({ ...prev, ...patch }));

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const row = {
        ...d,
        name: d.name.trim(),
        category: d.category.trim() || "Outros",
        price_min: parsePrice(d.price_min, "Preço mínimo"),
        price_max: parsePrice(d.price_max, "Preço máximo"),
        target_price: parsePrice(d.target_price, "Preço-alvo"),
      };
      if (!row.name) throw new Error("Dá um nome à pesquisa.");
      if (!row.sources.length) throw new Error("Escolhe pelo menos uma fonte.");
      if (!row.include_any.length && !row.include_all.length) throw new Error("Põe pelo menos uma palavra (senão apanha todos os anúncios).");
      if (row.price_min != null && row.price_max != null && row.price_min > row.price_max) throw new Error("O preço mínimo é maior do que o máximo.");
      setBusy(true);
      const { error } = watch ? await supabase.from("watches").update(row).eq("id", watch.id) : await supabase.from("watches").insert(row);
      if (error) throw new Error(error.message);
      onDone();
      go("pesquisas");
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  async function remove() {
    if (!watch || !confirm(`Apagar a pesquisa "${watch.name}"? Os negócios encontrados por ela também são apagados. Para só a parar, desativa-a.`)) return;
    setBusy(true);
    const { error } = await supabase.from("watches").delete().eq("id", watch.id);
    if (error) {
      setError(error.message);
      setBusy(false);
    } else {
      onDone();
      go("pesquisas");
    }
  }

  return (
    <form onSubmit={save} className="space-y-4">
      <button type="button" onClick={() => go("pesquisas")} className="text-sm text-sky-400">‹ Pesquisas</button>
      <Card title={watch ? "Editar pesquisa" : "Nova pesquisa"}>
        <div className="space-y-3">
          <Field label="Nome" required value={d.name} onChange={(e) => set({ name: e.target.value })} placeholder="Ex.: RTX 3070" />
          <Field label="Grupo" list="watch-categories" value={d.category} onChange={(e) => set({ category: e.target.value })} placeholder="Ex.: Placas gráficas" hint="Só serve para arrumar as pesquisas e os negócios na app." />
          <datalist id="watch-categories">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          <Toggle label="Ativa" checked={d.active} onChange={(active) => set({ active })} />
        </div>
      </Card>

      <Card title="Palavras no título">
        <div className="space-y-3">
          <TagInput label="Pelo menos uma destas" value={d.include_any} onChange={(include_any) => set({ include_any })} placeholder="rtx 3070, 3070 ti…" hint="Escreve e carrega Enter ou vírgula. Maiúsculas e acentos não contam." />
          <TagInput label="Todas estas (opcional)" value={d.include_all} onChange={(include_all) => set({ include_all })} placeholder="ex.: 16gb" />
          <TagInput label="Excluir" value={d.exclude} onChange={(exclude) => set({ exclude })} placeholder="ex.: mobile, portátil" hint="Além destas, as exclusões globais das Definições (avariado, para peças, …) aplicam-se sempre." />
          <Toggle
            label="Pesquisar também no site todo"
            hint="Além das categorias, procura estas palavras em todo o OLX/Vinted, à vez. Útil para o que aparece fora das categorias."
            checked={d.search_remote}
            onChange={(search_remote) => set({ search_remote })}
          />
        </div>
      </Card>

      <Card title="Preço">
        <div className="grid grid-cols-3 gap-2">
          <Field label="Mínimo €" inputMode="decimal" value={d.price_min} onChange={(e) => set({ price_min: e.target.value })} />
          <Field label="Máximo €" inputMode="decimal" value={d.price_max} onChange={(e) => set({ price_max: e.target.value })} />
          <Field label="Alvo €" inputMode="decimal" value={d.target_price} onChange={(e) => set({ target_price: e.target.value })} />
        </div>
        <p className="mt-2 text-xs text-slate-500">Fora do mínimo/máximo é ignorado. O preço-alvo é o que consideras um negócio muito bom: pesa muito na pontuação (junto com a mediana dos últimos 30 dias).</p>
      </Card>

      <Card title="Onde procurar">
        <div className="space-y-3">
          <PickList label="Fontes" options={(["olx", "vinted"] as const).map((s) => ({ id: s, name: sourceLabel[s] }))} value={d.sources} onChange={(sources) => set({ sources })} />
          {d.sources.includes("olx") && (
            <PickList label="Categorias OLX" options={CATEGORIES.olx} value={d.olx_category_ids ?? []} onChange={(olx_category_ids) => set({ olx_category_ids })} hint="Nenhuma = qualquer categoria." />
          )}
          {d.sources.includes("vinted") && (
            <PickList label="Categorias Vinted" options={CATEGORIES.vinted} value={d.vinted_catalog_ids ?? []} onChange={(vinted_catalog_ids) => set({ vinted_catalog_ids })} hint="Nenhuma = qualquer categoria." />
          )}
        </div>
      </Card>

      <Card title="Contexto para a IA">
        <TextArea
          label="O que importa nesta pesquisa (opcional)"
          value={d.context ?? ""}
          onChange={(e) => set({ context: e.target.value })}
          placeholder="Ex.: As versões Ti valem mais 60 €. Evitar modelos blower."
          hint="A IA lê isto junto com o contexto global das Definições."
        />
      </Card>

      {error && <Message kind="error" text={error} />}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={busy}>{busy ? "A guardar…" : "Guardar"}</Button>
        <Button variant="ghost" onClick={() => go("pesquisas")} disabled={busy}>Cancelar</Button>
        {watch && <Button variant="danger" className="ml-auto" onClick={remove} disabled={busy}>Apagar</Button>}
      </div>
    </form>
  );
}
