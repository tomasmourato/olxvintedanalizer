// One (listing, watch) match → median, rules score, Gemini for candidates → the matches row + push decision.
import type { Insert, Settings, Tier, Watch } from "@dh/shared";
import { db } from "../db.js";
import type { ScrapedListing } from "../sources/types.js";
import { aiAvailable, askAi, type AiResult } from "./ai.js";
import { holdBack, median, priceTier, ruleScore, rulesOnly, tierFor, vetoed } from "./score.js";

const MEDIAN_DAYS = 30;
const MEDIAN_TTL_MS = 5 * 60_000;
const medianCache = new Map<string, { at: number; rows: { listing_id: number; price: number }[] }>();

/** Median price of the watch's matches over the last 30 days, excluding this listing. */
async function watchMedian(watchId: string, listingId: number): Promise<number | null> {
  let c = medianCache.get(watchId);
  if (!c || Date.now() - c.at > MEDIAN_TTL_MS) {
    const since = new Date(Date.now() - MEDIAN_DAYS * 86400_000).toISOString();
    const { data, error } = await db
      .from("matches")
      .select("listing_id, price")
      .eq("watch_id", watchId)
      .gte("created_at", since)
      .not("price", "is", null)
      .limit(5000);
    if (error) throw new Error(`median lookup: ${error.message}`);
    c = { at: Date.now(), rows: data.map((r) => ({ listing_id: r.listing_id, price: Number(r.price) })) };
    medianCache.set(watchId, c);
  }
  const m = median(c.rows.filter((r) => r.listing_id !== listingId).map((r) => r.price));
  return m == null ? null : Math.round(m * 100) / 100;
}

export type Evaluation = {
  row: Insert<"matches">;
  tier: Tier;
  /** Null = push it; otherwise why not. */
  held: string | null;
  ai: AiResult | null;
};

export type EvaluateInput = {
  listing: ScrapedListing;
  listingId: number;
  watch: Watch;
  settings: Settings;
  silent: boolean;
  previousPrice: number | null;
  /** Fills in a missing description before the AI call (Vinted's list has none). */
  describe?: () => Promise<void>;
};

export async function evaluate(input: EvaluateInput): Promise<Evaluation> {
  const { listing, listingId, watch, settings, silent, previousPrice } = input;
  const med = await watchMedian(watch.id, listingId);
  const rules = ruleScore({ price: listing.price, great: watch.target_price, good: watch.good_price, median: med });
  const byPrice = priceTier(listing.price, watch);
  remember(watch.id, listingId, listing.price);

  // Backfill (silent) never goes to the AI: it is not announced and would burn the free quota.
  const candidate = (byPrice ? byPrice !== "normal" : rules.score >= settings.candidate_threshold) && !silent;
  let ai: AiResult | null = null;
  if (candidate) {
    if (aiAvailable(settings) && !listing.description && input.describe) await input.describe();
    ai = await askAi({ listing, watch, settings, rules, median: med, previousPrice });
  }

  const ok = ai?.status === "ok" ? ai.verdict : null;
  const score = ok ? ok.score : rulesOnly(rules, settings);
  const tier = byPrice ? vetoed(byPrice, ok?.score ?? null, rules.suspicious, settings) : tierFor(score, settings);
  const rulesReason = rules.notes.join("; ");
  const reason = ok ? ok.reason : ai ? `(sem IA) ${rulesReason}` : rulesReason;
  const red_flags = ok ? ok.red_flags : rules.suspicious ? ["preço demasiado baixo"] : [];

  return {
    row: {
      listing_id: listingId,
      watch_id: watch.id,
      price: listing.price,
      median_price: med,
      discount_pct: rules.discountPct,
      rule_score: rules.score,
      ai_score: ok?.score ?? null,
      score,
      tier,
      reason,
      red_flags,
      ai_status: ai?.status ?? "skipped",
    },
    tier,
    held: holdBack(listing, { silent, priceDrop: previousPrice != null, tier }),
    ai,
  };
}

/** Keeps the cached sample current without another query: this match is about to be saved. */
function remember(watchId: string, listingId: number, price: number | null): void {
  const c = medianCache.get(watchId);
  if (!c || price == null) return;
  const row = c.rows.find((r) => r.listing_id === listingId);
  if (row) row.price = price;
  else c.rows.push({ listing_id: listingId, price });
}
