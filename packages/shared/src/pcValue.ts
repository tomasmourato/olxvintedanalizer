// A whole PC valued by its parts, for the worker's PC watches and the app's calculator: each part is worth its
// part_prices value (the friend's, else the market median, else a recent AI estimate), or the AI's estimate in
// this answer; the tier comes from the margin (parts value − asking price) and the watch's margins. Pure, so it is tested.
import type { Database } from "./database.types.js";
import type { PcPart, Tier, Watch } from "./index.js";
import type { PartType } from "./parts.js";

export type PartValue = { value: number; source: "manual" | "mercado" | "ia"; samples: number };
type PriceRow = Pick<Database["public"]["Tables"]["part_prices"]["Row"], "manual_value" | "market_value" | "samples" | "ai_value" | "ai_at">;

export const PART_NAME: Record<PartType, string> = {
  gpu: "Gráfica",
  cpu: "Processador",
  ram: "RAM",
  storage: "Disco",
  psu: "Fonte",
  motherboard: "Motherboard",
  cooler: "Cooler",
  case: "Caixa",
};
// The parser never gives these a key: only the AI's estimate values them, and they are not flagged when it has none.
const UNPRICED: PartType[] = ["cooler", "case"];
const DEFAULT_MARGINS = { good: 50, great: 100 };
const SUSPICIOUS_RATIO = 0.4; // asking under 40 % of the parts: misread parts, broken or a scam
const AI_VALUE_DAYS = 30; // then the next PC with the part asks again

/** What a part_prices row is worth for PC valuation: the friend's value, else the market median, else a recent AI estimate. */
export function partValue(r: PriceRow, now = Date.now()): PartValue | null {
  if (r.manual_value != null) return { value: Number(r.manual_value), source: "manual", samples: r.samples };
  if (r.market_value != null) return { value: Number(r.market_value), source: "mercado", samples: r.samples };
  if (r.ai_value != null && r.ai_at && Date.parse(r.ai_at) > now - AI_VALUE_DAYS * 86400_000) return { value: Number(r.ai_value), source: "ia", samples: 0 };
  return null;
}

/** estimate: the AI's value for this part in this answer (used when part_prices has none). */
export type Named = { type: PartType; key: string | null; label: string; estimate?: number | null };

export function priceParts(parts: Named[], values: ReadonlyMap<string, PartValue>): PcPart[] {
  return parts.map((p) => {
    const v = p.key ? values.get(p.key) : undefined;
    if (v) return { type: p.type, label: p.label, key: p.key, value: v.value, source: v.source, samples: v.samples };
    const e = p.estimate ?? null;
    return { type: p.type, label: p.label, key: p.key, value: e, source: e != null ? "ia" : null, samples: 0 };
  });
}

export type PcValuation = {
  partsValue: number | null;
  margin: number | null;
  /** Margin as a share of the parts' value (matches.discount_pct, used to sort). */
  marginPct: number | null;
  tier: Tier;
  /** 60 at the "bom" margin, 80 at the "imperdível" one (the default thresholds), for sorting and the badge. */
  score: number;
  suspicious: boolean;
  notes: string[];
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const clamp = (n: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, n));

export function margins(w: Pick<Watch, "margin_good" | "margin_great">): { good: number; great: number } {
  const good = w.margin_good != null ? Number(w.margin_good) : w.margin_great != null ? Number(w.margin_great) / 2 : DEFAULT_MARGINS.good;
  const great = w.margin_great != null ? Number(w.margin_great) : w.margin_good != null ? good * 2 : DEFAULT_MARGINS.great;
  return { good, great: Math.max(great, good) };
}

export function valuePc(parts: PcPart[], price: number | null, w: Pick<Watch, "margin_good" | "margin_great">): PcValuation {
  const valued = parts.filter((p) => p.value != null);
  const missing = parts.filter((p) => p.value == null && !UNPRICED.includes(p.type as PartType)).map((p) => p.label);
  const partsValue = valued.length ? round2(valued.reduce((s, p) => s + p.value!, 0)) : null;
  const notes: string[] = [];
  if (missing.length) notes.push(`sem valor: ${missing.join(", ")}`);
  if (partsValue == null || price == null || price <= 0) {
    notes.unshift(partsValue == null ? "nenhuma peça com valor" : price == null ? "sem preço" : "preço 0 €");
    return { partsValue, margin: null, marginPct: null, tier: "normal", score: 0, suspicious: false, notes };
  }

  const margin = round2(partsValue - price);
  const { good, great } = margins(w);
  const tier: Tier = margin >= great ? "imperdivel" : margin >= good ? "bom" : "normal";
  const score = Math.round(clamp(60 + ((margin - good) / Math.max(great - good, 25)) * 20));
  const suspicious = price < partsValue * SUSPICIOUS_RATIO;
  if (suspicious) notes.push("preço demasiado baixo para estas peças: confirma o anúncio");
  return { partsValue, margin, marginPct: clamp(Math.round((margin / partsValue) * 1000) / 10, -999, 100), tier, score, suspicious, notes };
}
