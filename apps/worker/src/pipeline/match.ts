import { hasPhrase, normalize, parseParts, titleRamSpec, type Part, type PartType, type Settings, type Watch } from "@dh/shared";
import type { ScrapedListing } from "../sources/types.js";

export type MatchSettings = Pick<Settings, "global_exclude" | "vinted_countries">;

/**
 * Which active watches does this listing satisfy? Terms are checked against the title only:
 * descriptions often say "não troco" or "não está avariado", which would trip the exclusions.
 * Unknown Vinted country or catalog passes here; the pipeline enriches the listing and matches again.
 */
export function matchWatches(listing: ScrapedListing, watches: Watch[], settings: MatchSettings): Watch[] {
  const title = normalize(listing.title);
  return fittingWatches(listing, watches, settings).filter(
    (w) => (!w.include_any.length || w.include_any.some((t) => hasTerm(title, t))) && w.include_all.every((t) => hasTerm(title, t)),
  );
}

/**
 * A watch's word in a normalized title. Titles often drop the GTX/RTX of a 4-digit NVIDIA model ("Gigabyte 1660 super"),
 * so "GTX 1660 Super" also finds that model as the parser reads it, which takes a bare number only when the title shows
 * a graphics card ("Dell OptiPlex 3050" is no RTX 3050). Like the words, "RTX 3060" also finds the 3060 Ti.
 * RX and 3-digit models keep theirs: "580" or "970" alone could be anything.
 */
export function hasTerm(title: string, term: string): boolean {
  if (hasPhrase(title, term)) return true;
  if (!/^[gr]tx ?\d{4}/.test(normalize(term))) return false;
  const key = parseParts(term).find((p) => p.type === "gpu")?.key;
  return !!key && parseParts(title).some((p) => p.key === key || p.key?.startsWith(`${key}-`));
}

/** Every filter of the watch except its words: source, category, exclusions, price range, plus the global ones. */
export function fittingWatches(listing: ScrapedListing, watches: Watch[], settings: MatchSettings): Watch[] {
  const title = normalize(listing.title);
  if (settings.global_exclude.some((t) => hasPhrase(title, t))) return [];
  if (!countryAllowed(listing, settings)) return [];

  return watches.filter((w) => {
    if (!w.active || !w.sources.includes(listing.source)) return false;
    const cats = listing.source === "olx" ? w.olx_category_ids : w.vinted_catalog_ids;
    const path = listing.category_path?.length ? listing.category_path : listing.category_id != null ? [listing.category_id] : null;
    if (cats.length && path && !cats.some((c) => path.includes(c))) return false;
    if (w.exclude.some((t) => hasTerm(title, t))) return false;
    if (w.price_min != null && (listing.price == null || listing.price < w.price_min)) return false;
    if (w.price_max != null && (listing.price == null || listing.price > w.price_max)) return false;
    return true;
  });
}

const TYPE_OF_CATEGORY: Record<string, PartType> = {
  "Placas gráficas": "gpu",
  Processadores: "cpu",
  "Memória RAM": "ram",
  Armazenamento: "storage",
  Fontes: "psu",
  Motherboards: "motherboard",
};

type WatchText = Pick<Watch, "name" | "include_any" | "include_all" | "category">;
const watchParts = (w: WatchText): Part[] => parseParts([w.name, ...w.include_any, ...w.include_all].join(" "));

/** The part type a part watch is for, read from its name and words ("RTX 3060" → gpu, "16GB DDR4" → ram), else its group. */
export function watchType(w: WatchText): PartType | null {
  const parts = watchParts(w);
  return (parts.find((p) => p.key) ?? parts[0])?.type ?? TYPE_OF_CATEGORY[w.category] ?? null;
}

/** RAM: the size or generation the title does state must be the watch's ("RAM 4GB" is not for a 16GB DDR4 watch). */
function ramFits(title: string, w: WatchText): boolean {
  const key = watchParts(w).find((p) => p.type === "ram" && p.key)?.key;
  const m = key?.match(/^ram:(ddr\d)-(\d+)/);
  if (!m) return true;
  const { ddr, gb } = titleRamSpec(title);
  return (ddr == null || ddr === m[1]) && (gb == null || gb === Number(m[2]));
}

/**
 * Part watches a listing could be for when its title names the part type but no model ("Placa gráfica 8GB"):
 * same type, every filter but the words, and priced at most at the watch's "Bom até" (else its other limits),
 * so the AI is only asked about listings that could be a deal.
 */
export function unnamedWatches(listing: ScrapedListing, types: PartType[], watches: Watch[], settings: MatchSettings): Watch[] {
  if (!types.length || listing.price == null || listing.price <= 0) return [];
  return fittingWatches(listing, watches, settings).filter((w) => {
    const cap = w.good_price ?? w.target_price ?? w.price_max;
    const type = watchType(w);
    return w.kind === "part" && cap != null && listing.price! <= cap && !!type && types.includes(type) && (type !== "ram" || ramFits(listing.title, w));
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
