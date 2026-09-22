import { describe, expect, it } from "vitest";
import { dealPayload } from "../src/pipeline/payload.js";

const listing = {
  source: "olx" as const,
  title: "RTX 3060 12GB Gigabyte",
  price: 189.5,
  url: "https://www.olx.pt/d/anuncio/rtx-3060-IDabc.html",
  photo_url: "https://img.olx/1.jpg",
};
const match = { score: 92, discount_pct: 24.3, reason: "Bem abaixo do mercado, revendível." };

describe("dealPayload", () => {
  it("leads with the price and says why", () => {
    const p = dealPayload(listing, 7, "RTX 3060", match, null);
    expect(p.title).toBe("🔥 189,5 € · RTX 3060 12GB Gigabyte");
    expect(p.body).toBe("RTX 3060 · OLX · 92/100 · 24,3 % abaixo da mediana\nBem abaixo do mercado, revendível.");
    expect(p).toMatchObject({ url: listing.url, image: listing.photo_url, tag: "listing-7" });
  });

  it("shows price drops and skips a missing or negative discount", () => {
    const p = dealPayload({ ...listing, source: "vinted", photo_url: null }, 7, "RTX 3060", { ...match, discount_pct: -5 }, 230);
    expect(p.title).toBe("📉 189,5 € (era 230 €) · RTX 3060 12GB Gigabyte");
    expect(p.body.split("\n")[0]).toBe("RTX 3060 · Vinted · 92/100");
    expect(p.image).toBeUndefined();
  });
});
