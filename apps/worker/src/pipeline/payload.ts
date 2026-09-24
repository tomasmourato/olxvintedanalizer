// What a deal notification says. Pure, so the wording is tested.
import { fmtEuros, fmtNumber, type Insert, type PcPart, type PushPayload } from "@dh/shared";
import type { ScrapedListing } from "../sources/types.js";

const MAIN_PARTS = ["gpu", "cpu", "ram", "storage"];

export function dealPayload(
  listing: Pick<ScrapedListing, "source" | "title" | "price" | "url" | "photo_url">,
  listingId: number,
  watchName: string,
  match: Pick<Insert<"matches">, "score" | "discount_pct" | "reason" | "parts" | "parts_value">,
  previousPrice: number | null,
): PushPayload {
  const price = listing.price != null ? fmtEuros(listing.price) : "sem preço";
  const head = previousPrice != null ? `Baixou: ${price} (era ${fmtEuros(previousPrice)})` : price;
  const pc = match.parts_value != null && listing.price != null;
  const facts = [
    watchName,
    listing.source === "olx" ? "OLX" : "Vinted",
    ...(pc
      ? [`peças ${fmtEuros(match.parts_value!)}`, `margem ${fmtEuros(Math.round((match.parts_value! - listing.price!) * 100) / 100)}`]
      : [
          match.score != null && `${match.score}/100`,
          match.discount_pct != null && match.discount_pct > 0 && `${fmtNumber(match.discount_pct)} % abaixo da mediana`,
        ]),
  ]
    .filter(Boolean)
    .join(" · ");
  // A PC: its main parts on their own line ("RTX 3060 · Ryzen 5 3600 · 16GB DDR4 · SSD 512GB").
  const parts = pc && Array.isArray(match.parts) ? (match.parts as PcPart[]).filter((p) => MAIN_PARTS.includes(p.type)).map((p) => p.label).join(" · ") : "";
  return {
    title: `${head} · ${listing.title}`.slice(0, 120),
    body: [facts, parts, match.reason].filter(Boolean).join("\n"),
    url: listing.url,
    image: listing.photo_url ?? undefined,
    tag: `listing-${listingId}`,
  };
}
