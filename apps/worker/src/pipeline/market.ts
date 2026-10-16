// Pure market-price maths (no DB, so it is testable): used single-part listings → trimmed median per part.
import { hasPhrase, normalize, singlePart, type Part, type Source } from "@dh/shared";
import { median } from "./score.js";

const PC_CATEGORIES = new Set([4731, 3581, 4753, 3580]); // computers and laptops (OLX, Vinted)
const [LOW, HIGH] = [0.4, 2.5]; // outside this × the rough median: box only, broken, typo or new-in-shop

export type Sample = { source: Source; title: string; price: number | null; category_id: number | null; country: string | null; condition: string | null };
export type MarketPrice = Pick<Part, "type"> & {
  key: string;
  label: string;
  market_value: number | null;
  samples: number;
  market_scope: "pt" | "eu" | null;
};

/** What the seller asks: Vinted prices include the buyer-protection fee (0,70 € + 5 %). */
export function askingPrice(s: Pick<Sample, "source" | "price">): number | null {
  if (s.price == null) return null;
  return s.source === "vinted" ? Math.round(((s.price - 0.7) / 1.05) * 100) / 100 : s.price;
}

function trimmedMedian(prices: number[]): { value: number | null; samples: number } {
  const rough = median(prices);
  const kept = rough == null ? prices : prices.filter((p) => p >= rough * LOW && p <= rough * HIGH);
  const m = median(kept);
  return { value: m == null ? null : Math.round(m * 100) / 100, samples: kept.length };
}

/** Groups listings by part and takes the trimmed median; keys with fewer than 5 prices get no value. */
export function marketPrices(rows: Sample[], exclude: string[]): MarketPrice[] {
  const groups = new Map<string, { part: Part; pt: number[]; all: number[] }>();
  for (const r of rows) {
    const price = askingPrice(r);
    if (price == null || price <= 0 || (r.category_id != null && PC_CATEGORIES.has(r.category_id))) continue;
    if (r.condition && normalize(r.condition).startsWith("novo")) continue; // new parts sell above the used market
    const t = normalize(r.title);
    if (exclude.some((w) => hasPhrase(t, w))) continue;
    const part = singlePart(r.title);
    if (!part?.key) continue;
    const g = groups.get(part.key) ?? { part, pt: [], all: [] };
    g.all.push(price);
    if (r.source === "olx" || r.country === "PT") g.pt.push(price);
    groups.set(part.key, g);
  }
  return [...groups.values()].map(({ part, pt, all }) => {
    const local = trimmedMedian(pt);
    const m = local.value != null ? local : trimmedMedian(all);
    const market_scope = m.value == null ? null : m === local ? "pt" : "eu";
    return { key: part.key!, type: part.type, label: part.label!, market_value: m.value, samples: m.samples, market_scope };
  });
}
