// Market value per part: the median asking price of used single-part listings over 30 days (every listing
// the worker has read, not only matches), refreshed every 6 h into part_prices. Portuguese listings (OLX,
// Vinted PT) when there are enough, else the whole EU (maths in market.ts). The friend's own value
// (manual_value, edited in the app) always wins over it.
import type { Source } from "@dh/shared";
import { getSettings } from "../config.js";
import { db } from "../db.js";
import { errorText, flags, log } from "../util.js";
import { marketPrices, type Sample } from "./market.js";

const DAYS = 30;
const REFRESH_MS = 6 * 3600_000;
const PAGE = 1000; // PostgREST's max rows per request

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
