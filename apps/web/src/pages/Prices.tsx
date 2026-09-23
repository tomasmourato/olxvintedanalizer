// Pesquisas → Preços das peças: the market value the worker computes per part (pipeline/prices.ts),
// and the friend's own value, which wins when set.
import { useEffect, useMemo, useState } from "react";
import type { Row } from "@dh/shared";
import { supabase } from "../lib/supabase";
import { errorText, go, must, useDebounced, useNow, useQuery, useRealtime } from "../lib/live";
import { ago, euros, parsePrice, priceText } from "../lib/format";
import { Card, Empty, Icon, Loading, Select } from "../components/ui";

type Price = Row<"part_prices">;

const TYPES: [string, string][] = [
  ["gpu", "Gráficas"],
  ["cpu", "Processadores"],
  ["ram", "Memória RAM"],
  ["storage", "Discos"],
  ["psu", "Fontes"],
  ["motherboard", "Motherboards"],
  ["cooler", "Refrigeração"],
  ["case", "Caixas"],
];

/** "RTX 3060 Ti" and "rtx3060ti" compare equal. */
const squash = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

async function loadPrices() {
  return must(await supabase.from("part_prices").select("*").limit(5000));
}

export default function Prices() {
  const q = useQuery(loadPrices, []);
  useRealtime("part_prices", useDebounced(q.reload));
  const now = useNow();
  const [type, setType] = useState("all");
  const [search, setSearch] = useState("");

  const groups = useMemo(() => {
    const s = squash(search);
    // Without a search, only parts with a value; searching also finds the rare ones (to give them a value).
    const rows = (q.data ?? [])
      .filter((p) => (type === "all" || p.type === type) && (s ? squash(p.label).includes(s) : p.market_value != null || p.manual_value != null))
      .sort((a, b) => a.label.localeCompare(b.label, "pt", { numeric: true }));
    return TYPES.map(([t, title]) => ({ type: t, title, rows: rows.filter((p) => p.type === t) })).filter((g) => g.rows.length);
  }, [q.data, type, search]);

  if (!q.data) return <Loading error={q.error} />;
  const last = q.data.reduce<string | null>((m, p) => (p.market_at && (!m || p.market_at > m) ? p.market_at : m), null);

  return (
    <div className="space-y-4">
      <button type="button" onClick={() => go("pesquisas")} className="-ml-1 inline-flex items-center gap-0.5 text-sm text-neutral-400 hover:text-white">
        <Icon name="chevronLeft" className="size-4" />
        Pesquisas
      </button>
      <Card title="Preços das peças">
        <div className="space-y-2 text-sm text-neutral-400">
          <p>
            O valor de mercado é a mediana dos anúncios de peças usadas, uma peça por anúncio, dos últimos 30 dias. Usa o mercado português (OLX e
            Vinted PT) quando há pelo menos 5 anúncios; senão, o Vinted de toda a UE. O Vinted conta sem a taxa do comprador.
          </p>
          <p>Se escreveres o teu valor, é esse que conta. Apaga-o para voltar ao de mercado.</p>
          <p className="text-xs text-neutral-500">Atualiza de 6 em 6 horas{last ? ` (última: ${ago(last, now)})` : ""}.</p>
        </div>
      </Card>

      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,9rem)] items-end gap-2">
        <label className="block min-w-0">
          <span className="mb-0.5 block text-xs text-neutral-500">Procurar</span>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="ex.: 3060, 16GB DDR4"
            className="w-full rounded-xl border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-sm text-white outline-none transition-colors placeholder:text-neutral-600 focus:border-white"
          />
        </label>
        <Select label="Tipo" value={type} onChange={setType} options={[["all", "Todas"], ...TYPES]} />
      </div>

      {!groups.length && (
        <Empty icon="chartBar">{search ? "Nenhuma peça com esse nome." : "Ainda não há preços. O worker calcula-os de 6 em 6 horas."}</Empty>
      )}
      {groups.map((g) => (
        <section key={g.type}>
          <h2 className="mb-2 font-semibold tracking-tight">{g.title}</h2>
          <ul className="space-y-2">
            {g.rows.map((p) => (
              <PriceRow key={p.key} p={p} onSaved={q.reload} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function PriceRow({ p, onSaved }: { p: Price; onSaved: () => void }) {
  const [text, setText] = useState(priceText(p.manual_value));
  const [status, setStatus] = useState<{ saving?: boolean; error?: string }>({});
  useEffect(() => setText(priceText(p.manual_value)), [p.manual_value]);

  async function save() {
    let value: number | null;
    try {
      value = parsePrice(text, p.label);
    } catch (e) {
      return setStatus({ error: errorText(e) });
    }
    if (value === p.manual_value) return setStatus({});
    setStatus({ saving: true });
    const { error } = await supabase.from("part_prices").update({ manual_value: value }).eq("key", p.key);
    setStatus(error ? { error: error.message } : {});
    onSaved();
  }

  const market =
    p.market_value != null
      ? `mercado ${euros(p.market_value)} · ${p.samples} anúncio${p.samples === 1 ? "" : "s"}${p.market_scope === "eu" ? " (UE)" : ""}`
      : `poucos anúncios para mediana (${p.samples})`;
  return (
    <li className="flex items-center gap-3 rounded-2xl border border-neutral-800 bg-neutral-950 p-3">
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-neutral-100">{p.label}</p>
        <p className="text-xs text-neutral-500">{market}</p>
        {status.error && <p className="text-xs wrap-anywhere text-rose-400">{status.error}</p>}
      </div>
      <label className="w-24 shrink-0 text-right">
        <span className="sr-only">O meu valor para {p.label} em euros</span>
        <input
          inputMode="decimal"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => void save()}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          placeholder={p.market_value != null ? priceText(p.market_value) : "—"}
          disabled={status.saving}
          className={`w-full rounded-xl border bg-neutral-900 px-2 py-1.5 text-right text-white outline-none transition-colors placeholder:text-neutral-600 focus:border-white disabled:opacity-50 ${p.manual_value != null ? "border-neutral-500" : "border-neutral-800"}`}
        />
        <span className="mt-0.5 block text-[11px] text-neutral-500">{p.manual_value != null ? "o teu valor" : "o meu valor €"}</span>
      </label>
    </li>
  );
}
