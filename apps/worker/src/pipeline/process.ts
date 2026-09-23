// New/changed listings → match against watches → (Vinted) enrich → evaluate → matches table → push.
import type { Insert, PushPayload, Source, Update, Watch } from "@dh/shared";
import { getSettings, getWatches } from "../config.js";
import { db } from "../db.js";
import { BlockedError, type ScrapedListing } from "../sources/types.js";
import { itemDetails, sellerCountry, type Enrichment } from "../sources/vinted.js";
import { sendPush } from "../push.js";
import { logRun } from "../status.js";
import { errorText, flags, log } from "../util.js";
import { evaluate } from "./evaluate.js";
import { matchWatches } from "./match.js";
import { dealPayload } from "./payload.js";
import { storeBatch, updateListing, type PriceDrop, type Stored } from "./store.js";

export type BatchResult = { fresh: number; matches: number };

export async function processBatch(source: Source, items: ScrapedListing[], silent: boolean): Promise<BatchResult> {
  const detectedAt = Date.now();
  const { fresh, drops } = await storeBatch(items);
  let matches = 0;

  for (const entry of [...fresh, ...drops] as (Stored | PriceDrop)[]) {
    let matched = matchWatches(entry.listing, getWatches(), getSettings());
    if (matched.length && source === "vinted") matched = await enrichVinted(entry, matched);
    const previousPrice = "from" in entry ? entry.from : null;
    const l = entry.listing;
    let pushed = false; // one push per listing, even when several watches rate it top

    for (const watch of matched) {
      const e = await evaluate({
        listing: l,
        listingId: entry.id,
        watch,
        settings: getSettings(),
        silent,
        previousPrice,
        describe: source === "vinted" ? () => describeVinted(entry) : undefined,
      });
      const { id: matchId, dismissed } = await saveMatch(e.row);
      matches++;
      const drop = previousPrice != null ? ` (baixou de ${previousPrice} €)` : "";
      const ai = e.ai ? ` [IA ${e.ai.status}${e.ai.status === "ok" ? "" : `: ${e.ai.error}`}, ${e.ai.ms} ms]` : "";
      log(
        `${silent ? "[silencioso] " : ""}match ${source} "${l.title}" ${l.price ?? "?"} €${drop} → ${watch.name}: ` +
          `${e.row.score} ${e.tier}${ai} — ${e.row.reason}`,
      );
      if (e.held || dismissed) {
        if (e.tier === "imperdivel") log(`sem push (${e.held ?? "apagado na app"}): ${l.title}`);
      } else if (!pushed) {
        pushed = true;
        await notify(matchId, dealPayload(l, entry.id, watch.name, e.row, previousPrice), previousPrice != null, detectedAt);
      }
    }
  }
  return { fresh: fresh.length, matches };
}

/**
 * Vinted's list payload has neither the seller's country nor the item's catalog. Fetch them for
 * matched listings only, then match again: cross-border sellers and wrong catalogs drop out here.
 */
async function enrichVinted(entry: Stored, matched: Watch[]): Promise<Watch[]> {
  const l = entry.listing;
  const patch: Update<"listings"> = {};
  if (!l.country && l.seller_id) {
    const country = await enrich(`user ${l.seller_id}`, () => sellerCountry(l.seller_id!));
    if (country) l.country = patch.country = country;
  }
  const needsCatalog = matched.some((w) => w.vinted_catalog_ids.length) && !l.category_path;
  if (Object.keys(patch).length) await updateListing(entry.id, patch);
  if (needsCatalog && matchWatches(l, matched, getSettings()).length) await describeVinted(entry);
  return matchWatches(l, matched, getSettings());
}

/** Item page: catalog chain + description. Fetched at most once per listing. */
async function describeVinted(entry: Stored): Promise<void> {
  const l = entry.listing;
  if (l.category_path) return;
  l.category_path = []; // marks the attempt, even if it fails
  const d = await enrich(`item ${l.external_id}`, () => itemDetails(l.url));
  if (!d) return;
  l.category_path = d.catalogPath;
  l.category_id = d.catalogId;
  l.description = d.description;
  await updateListing(entry.id, { category_id: d.catalogId, description: d.description });
}

/** Runs one enrichment request and logs it; failures return null (the listing keeps its match). */
async function enrich<T>(scope: string, fn: () => Promise<Enrichment<T>>): Promise<T | null> {
  const started_at = new Date().toISOString();
  const base = { source: "vinted" as const, kind: "enrich" as const, scope, started_at };
  try {
    const r = await fn();
    if (!r.cached) {
      logRun({ ...base, status: r.status === 200 ? "ok" : "error", http_status: r.status, duration_ms: r.ms, items_read: r.value ? 1 : 0 });
    }
    return r.value;
  } catch (e) {
    const blocked = e instanceof BlockedError;
    logRun({ ...base, status: blocked ? "blocked" : "error", http_status: blocked ? e.status : null, error: errorText(e) });
    return null;
  }
}

/** Upserts the evaluation; dismissed_at is not in the row, so a deal deleted in the app stays deleted. */
async function saveMatch(row: Insert<"matches">): Promise<{ id: number | null; dismissed: boolean }> {
  if (flags.dryRun) return { id: null, dismissed: false };
  const { data, error } = await db.from("matches").upsert(row, { onConflict: "listing_id,watch_id" }).select("id, dismissed_at").single();
  if (error) throw new Error(`matches upsert: ${error.message}`);
  return { id: data.id, dismissed: data.dismissed_at != null };
}

async function notify(matchId: number | null, payload: PushPayload, drop: boolean, detectedAt: number): Promise<void> {
  if (!getSettings().push_enabled) return log(`push desligado nas Definições: ${payload.title}`);
  const r = await sendPush(drop ? "price_drop" : "deal", payload, { matchId, startedAt: detectedAt });
  log(`PUSH ${r.ok} ok, ${r.failed} falharam${r.error ? ` (${r.error})` : ""}, ${Date.now() - detectedAt} ms: ${payload.title}`);
  if (r.ok && matchId != null) {
    const { error } = await db.from("matches").update({ notified: true }).eq("id", matchId);
    if (error) log("matches notified update failed:", error.message);
  }
}
