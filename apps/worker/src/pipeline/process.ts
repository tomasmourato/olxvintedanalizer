// New/changed listings → match against watches → (Vinted) enrich → matches table.
// F3 plugs scoring, the AI call and push notifications in after `saveMatches`.
import type { Source, Update, Watch } from "@dh/shared";
import { getSettings, getWatches } from "../config.js";
import { db } from "../db.js";
import { BlockedError, type ScrapedListing } from "../sources/types.js";
import { itemDetails, sellerCountry, type Enrichment } from "../sources/vinted.js";
import { logRun } from "../status.js";
import { errorText, flags, log } from "../util.js";
import { matchWatches } from "./match.js";
import { storeBatch, updateListing, type Stored } from "./store.js";

export type BatchResult = { fresh: number; matches: number };

export async function processBatch(source: Source, items: ScrapedListing[], silent: boolean): Promise<BatchResult> {
  const { fresh, drops } = await storeBatch(items);
  let matches = 0;

  for (const entry of [...fresh, ...drops]) {
    let matched = matchWatches(entry.listing, getWatches(), getSettings());
    if (matched.length && source === "vinted") matched = await enrichVinted(entry, matched);
    if (!matched.length) continue;
    matches += await saveMatches(entry, matched);
    const drop = "from" in entry ? ` (baixou de ${entry.from} €)` : "";
    for (const w of matched) {
      log(`${silent ? "[silencioso] " : ""}match ${source} "${entry.listing.title}" ${entry.listing.price ?? "?"} €${drop} → ${w.name}`);
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
  if (needsCatalog && matchWatches(l, matched, getSettings()).length) {
    const d = await enrich(`item ${l.external_id}`, () => itemDetails(l.url));
    if (d) {
      l.category_path = d.catalogPath;
      l.category_id = patch.category_id = d.catalogId;
      l.description = patch.description = d.description;
    }
  }
  if (Object.keys(patch).length) await updateListing(entry.id, patch);
  return matchWatches(l, matched, getSettings());
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

async function saveMatches(entry: Stored, watches: Watch[]): Promise<number> {
  if (flags.dryRun) return watches.length;
  const rows = watches.map((w) => ({ listing_id: entry.id, watch_id: w.id, price: entry.listing.price }));
  const { error } = await db.from("matches").upsert(rows, { onConflict: "listing_id,watch_id" });
  if (error) throw new Error(`matches upsert: ${error.message}`);
  return rows.length;
}
