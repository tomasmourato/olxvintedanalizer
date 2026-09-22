import type { Settings, Watch } from "@dh/shared";
import type { ScrapedListing } from "../sources/types.js";
import { hasPhrase, normalize } from "./text.js";

export type MatchSettings = Pick<Settings, "global_exclude" | "vinted_countries">;

/**
 * Which active watches does this listing satisfy? Terms are checked against the title only:
 * descriptions often say "não troco" or "não está avariado", which would trip the exclusions.
 * Unknown Vinted country or catalog passes here; the pipeline enriches the listing and matches again.
 */
export function matchWatches(listing: ScrapedListing, watches: Watch[], settings: MatchSettings): Watch[] {
  const title = normalize(listing.title);
  if (settings.global_exclude.some((t) => hasPhrase(title, t))) return [];
  if (!countryAllowed(listing, settings)) return [];

  return watches.filter((w) => {
    if (!w.active || !w.sources.includes(listing.source)) return false;
    const cats = listing.source === "olx" ? w.olx_category_ids : w.vinted_catalog_ids;
    const path = listing.category_path ?? (listing.category_id != null ? [listing.category_id] : null);
    if (cats.length && path && !cats.some((c) => path.includes(c))) return false;
    if (w.include_any.length && !w.include_any.some((t) => hasPhrase(title, t))) return false;
    if (!w.include_all.every((t) => hasPhrase(title, t))) return false;
    if (w.exclude.some((t) => hasPhrase(title, t))) return false;
    if (w.price_min != null && (listing.price == null || listing.price < w.price_min)) return false;
    if (w.price_max != null && (listing.price == null || listing.price > w.price_max)) return false;
    return true;
  });
}

export function countryAllowed(listing: Pick<ScrapedListing, "country">, settings: Pick<MatchSettings, "vinted_countries">): boolean {
  return !listing.country || !settings.vinted_countries.length || settings.vinted_countries.includes(listing.country);
}

/** Site-wide search terms to rotate through for one source. */
export function searchTerms(watches: Watch[], source: "olx" | "vinted"): { term: string; catalogIds: number[] }[] {
  const seen = new Map<string, { term: string; catalogIds: number[] }>();
  for (const w of watches) {
    if (!w.active || !w.search_remote || !w.sources.includes(source)) continue;
    const terms = w.include_any.length ? w.include_any : w.include_all.length ? [w.include_all.join(" ")] : [];
    const catalogIds = source === "vinted" ? w.vinted_catalog_ids : [];
    for (const term of terms) {
      const key = `${normalize(term)}|${catalogIds.join(",")}`;
      if (!seen.has(key)) seen.set(key, { term: term.trim(), catalogIds });
    }
  }
  return [...seen.values()];
}
