// Calculadora: the friend types a PC's parts and its asking price and gets the same valuation as the deals of a PC
// watch (@dh/shared pcValue.ts): each part is worth its value in Pesquisas → Preços das peças (theirs, else the
// market's, else a recent AI estimate) or the value typed next to it; margin = parts − price, tier from the watch's margins.
import { useMemo, type ReactNode } from "react";
import { margins, PART_NAME, parseModel, partValue, valuePc, type Part, type PartType, type PartValue, type PcPart, type Row } from "@dh/shared";
import { supabase } from "../lib/supabase";
import { errorText, must, useDebounced, useQuery, useRealtime, useStored } from "../lib/live";
import { euros, parsePrice, pct, priceText, tierLabel } from "../lib/format";
import { Badge, Button, Card, Field, Icon, Loading, Select } from "../components/ui";
import { tierTone } from "./Deals";

type Line = { id: number; type: PartType; model: string; value: string };
type Calc = { price: string; watch: string; lines: Line[] };
type PcWatch = Pick<Row<"watches">, "id" | "name" | "active" | "margin_good" | "margin_great">;

const TYPES: PartType[] = ["gpu", "cpu", "ram", "storage", "motherboard", "psu", "cooler", "case"];
const EXAMPLE: Record<PartType, string> = {
  gpu: "RTX 3060 Ti",
  cpu: "Ryzen 5 3600",
  ram: "16GB DDR4",
  storage: "SSD 512GB",
  motherboard: "B450",
  psu: "650W",
  cooler: "Hyper 212",
  case: "NZXT H510",
};
const START: PartType[] = ["gpu", "cpu", "ram", "storage", "motherboard", "psu"];
const fresh = (): Calc => ({ price: "", watch: "", lines: START.map((type, id) => ({ id, type, model: "", value: "" })) });
const PAGE = 1000; // PostgREST's max rows per request

async function load() {
  const prices = async () => {
    const rows: Pick<Row<"part_prices">, "key" | "type" | "label" | "manual_value" | "market_value" | "samples" | "ai_value" | "ai_at">[] = [];
    for (let from = 0; ; from += PAGE) {
      const page = must(
        await supabase
          .from("part_prices")
          .select("key, type, label, manual_value, market_value, samples, ai_value, ai_at")
          .or("manual_value.not.is.null,market_value.not.is.null,ai_value.not.is.null")
          .order("key")
          .range(from, from + PAGE - 1),
      );
      rows.push(...page);
      if (page.length < PAGE) return rows;
    }
  };
  const [rows, watches] = await Promise.all([
    prices(),
    supabase.from("watches").select("id, name, active, margin_good, margin_great").eq("kind", "pc").order("name"),
  ]);
  const values = new Map<string, PartValue>();
  const labels = new Map<string, string[]>(); // per type, for the model fields' suggestions
  for (const r of rows) {
    const v = partValue(r);
    if (!v) continue;
    values.set(r.key, v);
    labels.set(r.type, [...(labels.get(r.type) ?? []), r.label]);
  }
  for (const l of labels.values()) l.sort((a, b) => a.localeCompare(b, "pt", { numeric: true }));
  return { values, labels, watches: must(watches) as PcWatch[] };
}

type Priced = { line: Line; found: Part | null; known: PartValue | undefined; part: PcPart | null; error: string | null };

/** One line as a PC part: the typed value wins over the part's value in Preços das peças. Empty lines give no part. */
function priceLine(line: Line, values: ReadonlyMap<string, PartValue>): Priced {
  const text = line.model.trim();
  const found = text ? parseModel(line.type, text) : null;
  const known = found?.key ? values.get(found.key) : undefined;
  let typed: number | null = null;
  let error: string | null = null;
  try {
    typed = parsePrice(line.value, PART_NAME[line.type]);
  } catch (e) {
    error = errorText(e);
  }
  if (!text && typed == null) return { line, found, known, part: null, error };
  const v = typed != null ? { value: typed, source: "manual" as const, samples: 0 } : known;
  const part: PcPart = {
    type: line.type,
    label: found?.label ?? (text || PART_NAME[line.type]),
    key: found?.key ?? null,
    value: v?.value ?? null,
    source: v?.source ?? null,
    samples: v?.samples ?? 0,
  };
  return { line, found, known, part, error };
}

export default function Calculator() {
  const q = useQuery(load, []);
  useRealtime("part_prices", useDebounced(q.reload));
  const [calc, setCalc] = useStored<Calc>("calculator", fresh());
  const setLine = (id: number, patch: Partial<Line>) => setCalc({ ...calc, lines: calc.lines.map((l) => (l.id === id ? { ...l, ...patch } : l)) });
  const add = (type: PartType) => setCalc({ ...calc, lines: [...calc.lines, { id: Math.max(-1, ...calc.lines.map((l) => l.id)) + 1, type, model: "", value: "" }] });
  const remove = (id: number) => setCalc({ ...calc, lines: calc.lines.filter((l) => l.id !== id) });

  const values = q.data?.values;
  const priced = useMemo(() => (values ? calc.lines.map((l) => priceLine(l, values)) : []), [calc.lines, values]);
  if (!q.data) return <Loading error={q.error} />;

  const { watches, labels } = q.data;
  const watch = watches.find((w) => w.id === calc.watch) ?? watches.find((w) => w.active) ?? watches[0];
  const m = margins(watch ?? { margin_good: null, margin_great: null });
  let price: number | null = null;
  let priceError: string | null = null;
  try {
    price = parsePrice(calc.price, "Preço do PC");
  } catch (e) {
    priceError = errorText(e);
  }
  const parts = priced.flatMap((p) => (p.part ? [p.part] : []));
  const r = valuePc(parts, price, watch ?? { margin_good: null, margin_great: null });
  const touched = calc.price.trim() !== "" || calc.lines.some((l) => l.model.trim() || l.value.trim());

  return (
    <div className="space-y-4">
      <Card
        title="Peças do PC"
        actions={
          touched && (
            <button type="button" onClick={() => setCalc(fresh())} className="text-sm text-neutral-400 hover:text-white">
              Limpar
            </button>
          )
        }
      >
        <p className="mb-3 text-sm text-neutral-400">
          Escreve o modelo de cada peça: o valor vem de Preços das peças (o teu, o de mercado ou a estimativa da IA). Para usar outro, escreve-o à
          direita.
        </p>
        <ul className="divide-y divide-neutral-900">
          {priced.map((p) => (
            <LineRow key={p.line.id} p={p} onChange={(patch) => setLine(p.line.id, patch)} onRemove={() => remove(p.line.id)} />
          ))}
        </ul>
        <label className="mt-3 inline-flex items-center gap-1.5 rounded-xl border border-neutral-700 px-3 py-2 text-sm font-semibold text-neutral-200 transition-colors focus-within:border-white hover:bg-neutral-900">
          <Icon name="plus" className="size-4" strokeWidth={2} />
          <select value="" onChange={(e) => e.target.value && add(e.target.value as PartType)} className="bg-transparent outline-none" aria-label="Adicionar peça">
            <option value="" disabled>
              Adicionar peça
            </option>
            {TYPES.map((t) => (
              <option key={t} value={t} className="bg-neutral-900">
                {PART_NAME[t]}
              </option>
            ))}
          </select>
        </label>
        {TYPES.map((t) => (
          <datalist key={t} id={`calc-${t}`}>
            {(labels.get(t) ?? []).map((l) => (
              <option key={l} value={l} />
            ))}
          </datalist>
        ))}
      </Card>

      <Card title="Margem" actions={r.margin != null && <Badge tone={tierTone[r.tier]}>{tierLabel[r.tier]}</Badge>}>
        <div className="space-y-3">
          <Field label="Preço do PC €" inputMode="decimal" placeholder="ex.: 450" value={calc.price} onChange={(e) => setCalc({ ...calc, price: e.target.value })} />
          {priceError && <p className="text-xs text-rose-400">{priceError}</p>}
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Valor das peças">{euros(r.partsValue)}</Stat>
            <Stat label="Preço">{euros(price)}</Stat>
            <Stat label="Margem" strong={r.tier !== "normal"}>
              {r.margin == null ? "—" : `${r.margin >= 0 ? "+" : "−"}${euros(Math.abs(r.margin))}`}
            </Stat>
          </div>
          {r.margin != null && r.marginPct != null && (
            <p className="text-sm text-neutral-300">
              {r.margin >= 0
                ? `Ganhas ${euros(r.margin)} (${pct(r.marginPct)} do valor das peças) se venderes as peças a estes preços.`
                : `Perdes ${euros(-r.margin)}: as peças valem menos do que o preço.`}
            </p>
          )}
          {r.partsValue == null ? (
            <p className="text-sm text-neutral-500">Escreve as peças para ver quanto valem.</p>
          ) : price == null && !priceError ? (
            <p className="text-sm text-neutral-500">Escreve o preço do PC para ver a margem.</p>
          ) : null}
          {r.notes
            .filter((n) => !["nenhuma peça com valor", "sem preço"].includes(n))
            .map((n) => (
              <p key={n} className={`flex items-start gap-1 text-xs ${r.suspicious && n.startsWith("preço") ? "text-rose-400" : "text-amber-300/90"}`}>
                <Icon name="warning" className="mt-px size-3.5" />
                {n}
              </p>
            ))}
          {watches.length > 1 && (
            <Select label="Margens da pesquisa" value={watch?.id ?? ""} onChange={(id) => setCalc({ ...calc, watch: id })} options={watches.map((w) => [w.id, w.name])} />
          )}
          <p className="text-xs text-neutral-500">
            Bom a partir de {euros(m.good)} de margem, Imperdível a partir de {euros(m.great)}
            {watch ? ` (as margens da pesquisa «${watch.name}»)` : ""}, como nos PCs completos.
          </p>
        </div>
      </Card>
    </div>
  );
}

const SOURCE: Record<PartValue["source"], (v: PartValue) => string> = {
  manual: () => "o teu valor em Preços das peças",
  mercado: (v) => `mercado (${v.samples} anúncio${v.samples === 1 ? "" : "s"})`,
  ia: () => "estimativa da IA",
};

function LineRow({ p, onChange, onRemove }: { p: Priced; onChange: (patch: Partial<Line>) => void; onRemove: () => void }) {
  const { line, found, known, part, error } = p;
  const name = PART_NAME[line.type];
  const typed = part?.source === "manual" && line.value.trim() !== "";
  const unpriced = line.type === "cooler" || line.type === "case"; // the parser has no models for these
  let status: { text: string; warn?: boolean } | null = null;
  if (line.model.trim()) {
    if (found && known) status = { text: `${found.label} · ${typed ? `valor escrito aqui (${SOURCE[known.source](known)}: ${euros(known.value)})` : SOURCE[known.source](known)}` };
    else if (found) status = typed ? { text: `${found.label} · valor escrito aqui` } : { text: `${found.label} · sem valor: escreve-o à direita`, warn: true };
    else if (typed) status = { text: "valor escrito aqui" };
    else status = unpriced ? { text: "escreve o valor à direita", warn: true } : { text: `não reconheço o modelo (ex.: ${EXAMPLE[line.type]}); ou escreve o valor à direita`, warn: true };
  }
  const input = "rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-white outline-none transition-colors placeholder:text-neutral-600 focus:border-white";

  return (
    <li className="py-2.5 first:pt-0">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="text-xs text-neutral-500">{name}</span>
        <button type="button" onClick={onRemove} aria-label={`Tirar ${name}`} className="-my-1 grid size-7 place-items-center rounded-full text-neutral-500 hover:bg-neutral-800 hover:text-white">
          <Icon name="xMark" className="size-4" />
        </button>
      </div>
      <div className="flex gap-2">
        <input
          list={unpriced ? undefined : `calc-${line.type}`}
          value={line.model}
          onChange={(e) => onChange({ model: e.target.value })}
          placeholder={`ex.: ${EXAMPLE[line.type]}`}
          aria-label={`Modelo: ${name}`}
          autoComplete="off"
          className={`${input} min-w-0 flex-1`}
        />
        <input
          inputMode="decimal"
          value={line.value}
          onChange={(e) => onChange({ value: e.target.value })}
          placeholder={known ? priceText(known.value) : "€"}
          aria-label={`Valor em euros: ${name}`}
          className={`${input} w-24 shrink-0 text-right ${typed ? "border-neutral-500" : ""}`}
        />
      </div>
      {error ? (
        <p className="mt-1 text-xs text-rose-400">{error}</p>
      ) : (
        status && <p className={`mt-1 text-xs wrap-anywhere ${status.warn ? "text-amber-300/90" : "text-neutral-500"}`}>{status.text}</p>
      )}
    </li>
  );
}

function Stat({ label, strong, children }: { label: string; strong?: boolean; children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-950 p-2 text-center">
      <p className={`text-lg font-bold tracking-tight tabular-nums ${strong ? "text-white" : "text-neutral-200"}`}>{children}</p>
      <p className="text-[11px] leading-tight text-neutral-500">{label}</p>
    </div>
  );
}
