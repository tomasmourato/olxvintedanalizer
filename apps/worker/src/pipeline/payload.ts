// What a deal notification says. Pure, so the wording is tested.
import { fmtEuros, fmtNumber, type Insert, type PushPayload } from "@dh/shared";
import type { ScrapedListing } from "../sources/types.js";

export function dealPayload(
  listing: Pick<ScrapedListing, "source" | "title" | "price" | "url" | "photo_url">,
  listingId: number,
  watchName: string,
  match: Pick<Insert<"matches">, "score" | "discount_pct" | "reason">,
  previousPrice: number | null,
): PushPayload {
  const price = listing.price != null ? fmtEuros(listing.price) : "sem preço";
  const head = previousPrice != null ? `📉 ${price} (era ${fmtEuros(previousPrice)})` : `🔥 ${price}`;
  const facts = [
    watchName,
    listing.source === "olx" ? "OLX" : "Vinted",
    match.score != null && `${match.score}/100`,
    match.discount_pct != null && match.discount_pct > 0 && `${fmtNumber(match.discount_pct)} % abaixo da mediana`,
  ]
    .filter(Boolean)
    .join(" · ");
  return {
    title: `${head} · ${listing.title}`.slice(0, 120),
    body: [facts, match.reason].filter(Boolean).join("\n"),
    url: listing.url,
    image: listing.photo_url ?? undefined,
    tag: `listing-${listingId}`,
  };
}
