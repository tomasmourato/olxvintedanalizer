import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { Insert, PartWatch, Source, Watch, WatchKind } from "@dh/shared";
import { supabase } from "../lib/supabase";
import { errorText, go, must, useDebounced, useQuery, useRealtime } from "../lib/live";
import { CATEGORIES } from "../lib/categories";
import { euros, parsePrice, priceText, sourceLabel, when } from "../lib/format";
import { Button, Card, Empty, Field, Icon, Loading, Message, PickList, Segmented, Switch, TagInput, TextArea, Toggle } from "../components/ui";

/** "Prioridade": the worker reads this watch's categories every 10–15 s until then (scheduler.ts). */
const PRIORITY_DAYS = 7;
const priorityOn = (until: string | null): until is string => until != null && Date.parse(until) > Date.now();

const DEFAULT_CATEGORIES = ["Placas gráficas", "Processadores", "Motherboards", "Memória RAM", "Armazenamento", "Fontes", "Caixas", "Computadores", "Outros"];

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
        <p className="text-sm text-neutral-400">{watches.filter((w) => w.active).length} de {watches.length} ativas</p>
        <Button onClick={() => go("pesquisas/nova")}>
          <Icon name="plus" className="size-4" strokeWidth={2.5} />
          Nova pesquisa
        </Button>
      </div>
      <button type="button" onClick={() => go("pesquisas/precos")} className="flex w-full items-center gap-3 rounded-2xl border border-neutral-800 bg-neutral-950 p-3 text-left">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-neutral-900 text-neutral-300">
          <Icon name="chartBar" className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-medium text-neutral-100">Preços das peças</span>
          <span className="block truncate text-sm text-neutral-400">Valor de mercado de cada gráfica, processador, RAM…</span>
        </span>
        <Icon name="chevronRight" className="size-4 text-neutral-600" />
      </button>
      {error && <Message kind="error" text={error} />}
      {!watches.length && <Empty icon="search">Ainda não há pesquisas. Cria a primeira.</Empty>}
      {groups.map((g) => (
        <section key={g.category}>
          <h2 className="mb-2 font-semibold tracking-tight">{g.category}</h2>
          <ul className="space-y-2">
            {g.watches.map((w) => {
              const c = counts.get(w.id);
              const active = pending[w.id] ?? w.active;
              return (
                <li key={w.id} className={`flex items-start gap-3 rounded-2xl border border-neutral-800 bg-neutral-950 p-3 transition-opacity ${active ? "" : "opacity-50"}`}>
                  <div className="pt-0.5">
                    <Switch checked={active} onChange={(v) => setActive(w, v)} label={`Ativar ${w.name}`} disabled={w.id in pending} />
                  </div>
                  <button type="button" onClick={() => go(`pesquisas/${w.id}`)} className="min-w-0 flex-1 text-left">
                    <p className="font-medium text-neutral-100">{w.name}</p>
                    <p className="truncate text-sm text-neutral-400">{summary(w)}</p>
                    <p className="text-xs text-neutral-500">
                      {[
                        w.sources.map((s) => sourceLabel[s as Source]).join(" + "),
                        w.search_remote && "site todo",
                        priorityOn(w.priority_until) && `prioridade até ${when(w.priority_until)}`,
                        c ? `${c.all} matches em 30 dias${c.top ? `, ${c.top} imperdíveis` : ""}` : "sem matches em 30 dias",
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </button>
                  <Icon name="chevronRight" className="size-4 self-center text-neutral-600" />
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
  const pc = w.kind === "pc";
  const terms = w.include_any.length ? w.include_any.join(", ") : w.include_all.length ? w.include_all.join(" + ") : pc ? "PC completo" : "qualquer título";
  const prices = [
    ...(pc
      ? [w.margin_great != null && `imperdível com margem de ${euros(w.margin_great)}`, w.margin_good != null && `bom com ${euros(w.margin_good)}`]
      : [w.target_price != null && `imperdível até ${euros(w.target_price)}`, w.good_price != null && `bom até ${euros(w.good_price)}`]),
    w.price_min != null && `mín. ${euros(w.price_min)}`,
    w.price_max != null && `máx. ${euros(w.price_max)}`,
    w.auto_buy && `auto-compra até ${euros(w.auto_buy_max)}`,
  ].filter(Boolean);
  return [terms, ...prices].join(" · ");
}

// target_price is "Imperdível até", good_price is "Bom até"; a PC watch uses the margins instead.
type Money = "price_min" | "price_max" | "target_price" | "good_price" | "margin_good" | "margin_great" | "auto_buy_max";
type Draft = Required<Omit<Insert<"watches">, Money | "kind" | "id" | "created_at" | "updated_at">> & {
  kind: WatchKind;
  margin_good: string;
  margin_great: string;
  sources: Source[];
  price_min: string;
  price_max: string;
  target_price: string;
  good_price: string;
  auto_buy_max: string;
};


// Pesquisas → Preços das peças hands a part's watch to the "Nova pesquisa" form (cleared when the form closes).
let preset: PartWatch | null = null;
export function newWatchFor(p: PartWatch) {
  preset = p;
  go("pesquisas/nova");
}

function toDraft(w?: Partial<Watch>): Draft {
  return {
    kind: (w?.kind as WatchKind) ?? "part",
    margin_good: priceText(w?.margin_good ?? null),
    margin_great: priceText(w?.margin_great ?? null),
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
    good_price: priceText(w?.good_price ?? null),
    context: w?.context ?? "",
    active: w?.active ?? true,
    priority_until: w?.priority_until ?? null,
    auto_buy: w?.auto_buy ?? false,
    auto_buy_max: priceText(w?.auto_buy_max ?? null),
  };
}

function WatchForm({ watch, categories, onDone }: { watch?: Watch; categories: string[]; onDone: () => void }) {
  const [fromPart] = useState(() => (watch ? null : preset));
  const [d, setD] = useState<Draft>(() => toDraft(watch ?? fromPart ?? undefined));
  useEffect(() => () => void (preset = null), []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<Draft>) => setD((prev) => ({ ...prev, ...patch }));
  const pc = d.kind === "pc";

  // A new PC watch starts on the computer categories with the default margins; fields already filled stay.
  function setKind(kind: WatchKind) {
    if (kind === "part" || watch) return set({ kind });
    setD((p) => ({
      ...p,
      kind,
      name: p.name || "PCs completos",
      category: p.category || "Computadores",
      olx_category_ids: p.olx_category_ids.length ? p.olx_category_ids : [4731],
      vinted_catalog_ids: p.vinted_catalog_ids.length ? p.vinted_catalog_ids : [3581],
      margin_good: p.margin_good || "50",
      margin_great: p.margin_great || "100",
    }));
  }

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
        target_price: parsePrice(d.target_price, "Imperdível até"),
        good_price: pc ? null : parsePrice(d.good_price, "Bom até"),
        margin_good: pc ? parsePrice(d.margin_good, "Bom com margem de") : null,
        margin_great: pc ? parsePrice(d.margin_great, "Imperdível com margem de") : null,
        auto_buy: pc ? false : d.auto_buy,
        auto_buy_max: pc ? null : parsePrice(d.auto_buy_max, "Auto-compra até"),
      };
      if (pc) row.target_price = null;
      if (!row.name) throw new Error("Dá um nome à pesquisa.");
      if (!row.sources.length) throw new Error("Escolhe pelo menos uma fonte.");
      if (row.auto_buy) {
        if (!row.sources.includes("vinted")) throw new Error("A auto-compra só funciona no Vinted: inclui o Vinted nas fontes.");
        if (row.auto_buy_max == null) throw new Error("A auto-compra precisa de um teto (Auto-compra até).");
      }
      if (pc) {
        if ((row.sources.includes("olx") && !row.olx_category_ids.length) || (row.sources.includes("vinted") && !row.vinted_catalog_ids.length)) {
          throw new Error("Escolhe as categorias de computadores em cada fonte (OLX: Computadores; Vinted: Computadores de secretária).");
        }
        if (row.margin_good == null && row.margin_great == null) throw new Error("Põe pelo menos uma das margens.");
        if (row.margin_good != null && row.margin_great != null && row.margin_great < row.margin_good) throw new Error('A margem de "Imperdível" tem de ser maior ou igual à de "Bom".');
      } else if (!row.include_any.length && !row.include_all.length) throw new Error("Põe pelo menos uma palavra (senão apanha todos os anúncios).");
      if (row.price_min != null && row.price_max != null && row.price_min > row.price_max) throw new Error("O preço mínimo é maior do que o máximo.");
      if (row.target_price != null && row.good_price != null && row.target_price > row.good_price) throw new Error("O preço de \"Imperdível até\" tem de ser menor ou igual ao de \"Bom até\".");
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
      <button type="button" onClick={() => go("pesquisas")} className="-ml-1 inline-flex items-center gap-0.5 text-sm text-neutral-400 hover:text-white">
        <Icon name="chevronLeft" className="size-4" />
        Pesquisas
      </button>
      <Card title={watch ? "Editar pesquisa" : "Nova pesquisa"}>
        {fromPart && (
          <p className="mb-3 text-sm text-neutral-400">
            Preenchida a partir de Preços das peças: as palavras apanham este modelo e deixam de fora os parecidos (ex.: a 3060 sem a 3060 Ti), e os
            preços são cerca de 70 % (Bom) e 55 % (Imperdível) do valor da peça. Confirma e guarda.
          </p>
        )}
        <div className="space-y-3">
          <div>
            <p className="mb-1 text-sm text-neutral-400">Procura</p>
            <Segmented value={d.kind} onChange={setKind} options={[["part", "Uma peça"], ["pc", "PCs completos"]]} />
            {pc && (
              <p className="mt-1.5 text-xs text-neutral-500">
                Cada PC é avaliado pelas peças: a IA lê o anúncio e diz as peças, e cada uma vale o que está em Preços das peças (o teu valor, o de
                mercado ou, sem nenhum, uma estimativa da IA). Aparecem em Negócios → PCs completos.
              </p>
            )}
          </div>
          <Field label="Nome" required value={d.name} onChange={(e) => set({ name: e.target.value })} placeholder="Ex.: RTX 3070" />
          <Field label="Grupo" list="watch-categories" value={d.category} onChange={(e) => set({ category: e.target.value })} placeholder="Ex.: Placas gráficas" hint="Só serve para arrumar as pesquisas e os negócios na app." />
          <datalist id="watch-categories">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          <Toggle label="Ativa" checked={d.active} onChange={(active) => set({ active })} />
          <Toggle
            label={`Prioridade durante ${PRIORITY_DAYS} dias`}
            hint={
              <>
                {priorityOn(d.priority_until) && <span className="text-neutral-300">Ligada até {when(d.priority_until)}. </span>}
                Lê as categorias desta pesquisa a cada 10–15 s em vez de 30 s (Vinted) / 2 min (OLX), para o aviso chegar mais cedo. Acaba sozinha. Usa em
                poucas pesquisas: pedidos a mais podem fazer o OLX/Vinted bloquear.
              </>
            }
            checked={priorityOn(d.priority_until)}
            onChange={(on) => set({ priority_until: on ? new Date(Date.now() + PRIORITY_DAYS * 86_400_000).toISOString() : null })}
          />
          {!pc && (
            <Toggle
              label="Auto-comprar no Vinted"
              hint="Compra automaticamente quando o anúncio é imperdível e o preço fica dentro do teto (abaixo). Só peças, só Vinted, e só se a IA aprovar. Fase 1: só simula — vê o resultado em Negócios → Compras. Precisa do interruptor geral ligado nas Definições."
              checked={d.auto_buy}
              onChange={(auto_buy) => set({ auto_buy })}
            />
          )}
        </div>
      </Card>

      <Card title="Palavras no título">
        <div className="space-y-3">
          <TagInput
            label={pc ? "Pelo menos uma destas (opcional)" : "Pelo menos uma destas"}
            value={d.include_any}
            onChange={(include_any) => set({ include_any })}
            placeholder={pc ? "ex.: gaming, rtx" : "rtx 3070, 3070 ti…"}
            hint={pc ? "Sem palavras, apanha todos os computadores das categorias escolhidas." : "Escreve e carrega Enter ou vírgula. Maiúsculas e acentos não contam."}
          />
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
        <div className="space-y-3">
          {pc ? (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Imperdível com margem de €" inputMode="decimal" value={d.margin_great} onChange={(e) => set({ margin_great: e.target.value })} placeholder="ex.: 100" />
                <Field label="Bom com margem de €" inputMode="decimal" value={d.margin_good} onChange={(e) => set({ margin_good: e.target.value })} placeholder="ex.: 50" />
              </div>
              <p className="text-xs text-neutral-500">
                Margem = valor das peças − preço pedido. Com a margem de Imperdível manda push; com a de Bom aparece em Bons. A IA trava portáteis, peças
                soltas, PCs avariados e burlas.
              </p>
            </>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Imperdível até €" inputMode="decimal" value={d.target_price} onChange={(e) => set({ target_price: e.target.value })} placeholder="ex.: 60" />
                <Field label="Bom até €" inputMode="decimal" value={d.good_price} onChange={(e) => set({ good_price: e.target.value })} placeholder="ex.: 100" />
              </div>
              <p className="text-xs text-neutral-500">
                Até ao preço de Imperdível manda push; até ao de Bom aparece em Bons. A IA só trava anúncios com problemas (não é o produto, avariado, só a caixa, burla). Sem estes preços, o nível vem da pontuação 0–100 (mediana dos últimos 30 dias e IA).
              </p>
              {d.auto_buy && (
                <Field
                  label="Auto-compra até €"
                  inputMode="decimal"
                  value={d.auto_buy_max}
                  onChange={(e) => set({ auto_buy_max: e.target.value })}
                  placeholder="ex.: 180"
                  hint="Preço do artigo no máximo este valor para a auto-compra disparar (portes à parte na simulação)."
                />
              )}
            </>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Field label="Mínimo €" inputMode="decimal" value={d.price_min} onChange={(e) => set({ price_min: e.target.value })} />
            <Field label="Máximo €" inputMode="decimal" value={d.price_max} onChange={(e) => set({ price_max: e.target.value })} />
          </div>
          <p className="text-xs text-neutral-500">Anúncios fora do mínimo/máximo são ignorados.</p>
        </div>
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
