// Rules-based deal score (0–100): the watch's € prices first, the 30-day median as a modifier
// (or on its own when there are no prices). Watches with € prices get their tier from the price
// (priceTier), and the AI can only veto it. Pure functions, so the thresholds are easy to test.
import { fmtEuros, fmtNumber, type Settings, type Tier, type Watch } from "@dh/shared";
import type { ScrapedListing } from "../sources/types.js";

export const MIN_SAMPLES = 5; // fewer matches than this and the median means nothing
const SUSPICIOUS_RATIO = 0.4; // below 40 % of the reference: accessory, empty box, broken or scam
const BUMP_AGE_MS = 24 * 3600_000; // OLX listing "new to us" but created longer ago = bumped

/** great = "Imperdível até" (watches.target_price), good = "Bom até" (watches.good_price). */
export type RuleInput = { price: number | null; great: number | null; good: number | null; median: number | null };
export type RuleResult = {
  score: number;
  discountPct: number | null;
  /** Too cheap to be true: never pushed on rules alone. */
  suspicious: boolean;
  notes: string[];
};

const clamp = (n: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, n));
const pct = (n: number) => Math.round(n * 100);

export function median(values: number[]): number | null {
  if (values.length < MIN_SAMPLES) return null;
  const v = [...values].sort((a, b) => a - b);
  const mid = v.length >> 1;
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

export function ruleScore({ price, great, good, median }: RuleInput): RuleResult {
  if (price == null || price <= 0) {
    return { score: 0, discountPct: null, suspicious: false, notes: [price == null ? "sem preço" : "preço 0 €"] };
  }
  const notes: string[] = [];
  const discountPct = median ? clamp(Math.round(((median - price) / median) * 1000) / 10, -999, 100) : null;
  let score: number;
  // At "Imperdível até" = 80 (the default push threshold), at "Bom até" = 60 (the default "bom").
  const [target, at, label]: [number | null, number, string] = great ? [great, 80, "imperdível"] : good ? [good, 60, "bom"] : [null, 0, ""];

  if (target) {
    // 30 % under = +20; 30 % over = −30.
    const r = price / target;
    score = r <= 1 ? at + (1 - r) * 67 : at - (r - 1) * 100;
    notes.push(`${pct(Math.abs(1 - r))} % ${r <= 1 ? "abaixo" : "acima"} do preço de ${label} (${fmtEuros(target)})`);
    // The median nudges by at most ±10 points.
    if (discountPct != null) score += clamp(discountPct / 3, -10, 10);
  } else if (discountPct != null) {
    score = 50 + discountPct;
  } else {
    score = 50;
    notes.push("sem preços em € nem histórico");
  }
  if (discountPct != null) {
    notes.push(discountPct >= 0 ? `${fmtNumber(discountPct)} % abaixo da mediana (${fmtEuros(median!)})` : `${fmtNumber(-discountPct)} % acima da mediana (${fmtEuros(median!)})`);
  }

  const reference = target ?? median;
  const suspicious = reference != null && price < reference * SUSPICIOUS_RATIO;
  if (suspicious) notes.push("preço demasiado baixo: pode ser acessório, caixa, avariado ou burla");
  return { score: Math.round(clamp(score)), discountPct, suspicious, notes };
}

export type Thresholds = Pick<Settings, "candidate_threshold" | "notify_threshold">;

/** Tier from the watch's € prices, or null when it has none (then the score decides). */
export function priceTier(price: number | null, w: Pick<Watch, "target_price" | "good_price">): Tier | null {
  if (w.target_price == null && w.good_price == null) return null;
  if (price == null || price <= 0) return "normal";
  if (w.target_price != null && price <= w.target_price) return "imperdivel";
  if (w.good_price != null && price <= w.good_price) return "bom";
  return "normal";
}

/**
 * Final tier of a watch with € prices: the price decides and the AI can only veto (a score below "bom" means
 * not the product, broken or a scam). Without the AI, a suspiciously low price is not pushed.
 */
export function vetoed(byPrice: Tier, aiScore: number | null, suspicious: boolean, t: Thresholds): Tier {
  if (aiScore != null) return aiScore < t.candidate_threshold ? "normal" : byPrice;
  return suspicious && byPrice === "imperdivel" ? "bom" : byPrice;
}

export function tierFor(score: number, t: Thresholds): Tier {
  return score >= t.notify_threshold ? "imperdivel" : score >= t.candidate_threshold ? "bom" : "normal";
}

/** Score to use when the AI gave no verdict: suspicious listings stay below the push threshold. */
export function rulesOnly(r: RuleResult, t: Thresholds): number {
  return r.suspicious ? Math.min(r.score, t.notify_threshold - 1) : r.score;
}

/** Why a top-tier match should not be pushed, or null if it should. */
export function holdBack(
  listing: Pick<ScrapedListing, "source" | "posted_at">,
  opts: { silent: boolean; priceDrop: boolean; tier: Tier; now?: number },
): string | null {
  if (opts.tier !== "imperdivel") return "abaixo do limiar";
  if (opts.silent) return "primeira leitura";
  if (!opts.priceDrop && listing.source === "olx" && listing.posted_at) {
    const age = (opts.now ?? Date.now()) - Date.parse(listing.posted_at);
    if (age > BUMP_AGE_MS) return "anúncio antigo subido";
  }
  return null;
}
