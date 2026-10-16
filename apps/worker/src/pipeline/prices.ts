// Market value per part: the median asking price of used single-part listings over 30 days (every listing
// the worker has read, not only matches), refreshed every 6 h into part_prices. Portuguese listings (OLX,
// Vinted PT) when there are enough, else the whole EU (maths in market.ts). The friend's own value
// (manual_value, edited in the app) always wins over it. For PC valuation, a part with neither falls back to the
// AI's estimate (ai_value), saved the first time a PC listing names the part.
import { partValue, type PartValue, type PcPart, type Source } from "@dh/shared";
import { getSettings } from "../config.js";
import { db } from "../db.js";
import { errorText, flags, log } from "../util.js";
import { marketPrices, type Sample } from "./market.js";

const DAYS = 30;
const REFRESH_MS = 6 * 3600_000;
const PAGE = 1000; // PostgREST's max rows per request
const VALUES_TTL_MS = 5 * 60_000; // a value edited in the app counts within 5 min

export async function refreshMarketPrices(): Promise<void> {
  const since = new Date(Date.now() - DAYS * 86400_000).toISOString();
  const rows: Sample[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("listings")
      .select("source, title, price, category_id, country, condition")
      .gte("first_seen_at", since)
      .order("id")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`listings: ${error.message}`);
    rows.push(...data.map((r) => ({ ...r, source: r.source as Source, price: r.price == null ? null : Number(r.price) })));
    if (data.length < PAGE) break;
  }
  const prices = marketPrices(rows, getSettings().global_exclude);
  const valued = prices.filter((p) => p.market_value != null).length;
  log(`preços de mercado: ${prices.length} peças, ${valued} com mediana (${rows.length} anúncios em ${DAYS} dias)`);
  if (flags.dryRun) {
    const top = prices.sort((a, b) => b.samples - a.samples).slice(0, 25);
    for (const p of top) log(`  ${p.label}: ${p.market_value ?? "—"} € (${p.samples}, ${p.market_scope ?? "—"})`);
    return;
  }

  const market_at = new Date().toISOString();
  for (let i = 0; i < prices.length; i += 500) {
    const chunk = prices.slice(i, i + 500).map((p) => ({ ...p, market_at }));
    const { error } = await db.from("part_prices").upsert(chunk, { onConflict: "key" });
    if (error) throw new Error(`part_prices: ${error.message}`);
  }
  // Parts no longer on sale lose their market value; a manual value stays.
  const { error } = await db.from("part_prices").update({ market_value: null, samples: 0, market_scope: null }).lt("market_at", market_at);
  if (error) throw new Error(`part_prices: ${error.message}`);
}

/** Now and every 6 h; a failure is logged and retried at the next round. */
export function startMarketPrices(): () => void {
  const run = () => refreshMarketPrices().catch((e) => log("preços de mercado falharam:", errorText(e)));
  void run();
  const timer = setInterval(run, REFRESH_MS);
  return () => clearInterval(timer);
}

let values: { at: number; map: Map<string, PartValue> } | null = null;

/** What each part is worth for PC valuation: the friend's value, else the market median, else a recent AI estimate. Cached for 5 min. */
export async function partValues(): Promise<ReadonlyMap<string, PartValue>> {
  if (values && Date.now() - values.at < VALUES_TTL_MS) return values.map;
  const map = new Map<string, PartValue>();
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await db
      .from("part_prices")
      .select("key, market_value, manual_value, samples, ai_value, ai_at")
      .or("manual_value.not.is.null,market_value.not.is.null,ai_value.not.is.null")
      .order("key")
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`part_prices: ${error.message}`);
    for (const r of data) {
      const v = partValue(r);
      if (v) map.set(r.key, v);
    }
    if (data.length < PAGE) break;
  }
  values = { at: Date.now(), map };
  return map;
}

/** Saves the AI's estimates for parts that had no value, so the next PC with the same part gets the same one. */
export async function saveEstimates(parts: PcPart[]): Promise<void> {
  const known = await partValues();
  const ai_at = new Date().toISOString();
  const rows = parts
    .filter((p) => p.key && p.source === "ia" && p.value != null && !known.has(p.key))
    .map((p) => ({ key: p.key!, type: p.type, label: p.label, ai_value: p.value, ai_at }));
  if (!rows.length || flags.dryRun) return;
  const { error } = await db.from("part_prices").upsert(rows, { onConflict: "key" });
  if (error) return log("part_prices (estimativa IA):", error.message);
  for (const r of rows) (known as Map<string, PartValue>).set(r.key, { value: r.ai_value!, source: "ia", samples: 0 });
}
