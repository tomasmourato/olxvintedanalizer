// Rules-based deal score (0–100): the watch's target price first, the 30-day median as a modifier
// (or on its own when there is no target). Pure functions, so the thresholds are easy to test.
import type { Settings, Tier } from "@dh/shared";
import type { ScrapedListing } from "../sources/types.js";

export const MIN_SAMPLES = 5; // fewer matches than this and the median means nothing
const SUSPICIOUS_RATIO = 0.4; // below 40 % of the reference: accessory, empty box, broken or scam
const BUMP_AGE_MS = 24 * 3600_000; // OLX listing "new to us" but created longer ago = bumped

export type RuleInput = { price: number | null; target: number | null; median: number | null };
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

export function ruleScore({ price, target, median }: RuleInput): RuleResult {
  if (price == null || price <= 0) {
    return { score: 0, discountPct: null, suspicious: false, notes: [price == null ? "sem preço" : "preço 0 €"] };
  }
  const notes: string[] = [];
  const discountPct = median ? clamp(Math.round(((median - price) / median) * 1000) / 10, -999, 100) : null;
  let score: number;

  if (target) {
    // At the target = 80 (the default push threshold); 30 % under = 100; 30 % over = 50.
    const r = price / target;
    score = r <= 1 ? 80 + (1 - r) * 67 : 80 - (r - 1) * 100;
    notes.push(r <= 1 ? `${pct(1 - r)} % abaixo do alvo (${target} €)` : `${pct(r - 1)} % acima do alvo (${target} €)`);
    // The median nudges by at most ±10 points.
    if (discountPct != null) score += clamp(discountPct / 3, -10, 10);
  } else if (discountPct != null) {
    score = 50 + discountPct;
  } else {
    score = 50;
    notes.push("sem preço-alvo nem histórico");
  }
  if (discountPct != null) {
    notes.push(discountPct >= 0 ? `${discountPct} % abaixo da mediana (${median} €)` : `${-discountPct} % acima da mediana (${median} €)`);
  }

  const reference = target ?? median;
  const suspicious = reference != null && price < reference * SUSPICIOUS_RATIO;
  if (suspicious) notes.push("preço demasiado baixo: pode ser acessório, caixa, avariado ou burla");
  return { score: Math.round(clamp(score)), discountPct, suspicious, notes };
}

export type Thresholds = Pick<Settings, "candidate_threshold" | "notify_threshold">;

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
