import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseOffers } from "../src/sources/olx.js";
import { parseCatalog, parseItemPage } from "../src/sources/vinted.js";

const fixture = (name: string) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8");

describe("vinted parseCatalog", () => {
  const items = parseCatalog(fixture("vinted-catalog.html"));

  it("reads every productItem from the flight data", () => {
    expect(items).toHaveLength(10);
  });

  it("maps the fields we store", () => {
    const first = items[0];
    expect(first).toMatchObject({
      source: "vinted",
      external_id: "10100281300",
      title: "kit de brackets low-profile da XFX",
      price: 19.6,
      url: "https://www.vinted.pt/items/10100281300-kit-de-brackets-low-profile-da-xfx",
      seller_id: "3142028121",
      seller_business: false,
      brand: "AMD",
      condition: "Novo com etiquetas",
      category_id: null,
    });
    expect(first.photo_url).toMatch(/^https:\/\/images\d?\.vinted\.net\//);
  });

  it("knows the catalog only when one was requested", () => {
    expect(parseCatalog(fixture("vinted-catalog.html"), 3602)[0].category_id).toBe(3602);
  });
});

describe("vinted parseItemPage", () => {
  it("reads the catalog chain and the description", () => {
    const d = parseItemPage(fixture("vinted-item.html"));
    expect(d.catalogPath).toEqual([2994, 3564, 3580]);
    expect(d.catalogId).toBe(3580);
    expect(d.description).toMatch(/^Dell Latitude 5440\nProcessor/);
  });
});

describe("olx parseOffers", () => {
  const json = JSON.parse(fixture("olx-offers.json"));
  const items = parseOffers(json);

  it("maps every offer", () => {
    expect(items).toHaveLength(json.data.length);
    expect(new Set(items.map((i) => i.external_id)).size).toBe(items.length);
  });

  it("maps the fields we store", () => {
    const first = items[0];
    expect(first).toMatchObject({
      source: "olx",
      external_id: "665196190",
      title: "Pc Gaming / 3060ti oc 8gb",
      price: 650,
      country: "PT",
      category_id: 4731,
      promoted: true,
      posted_at: "2025-09-09T19:36:04+01:00",
    });
    expect(first.location).toContain("Porto");
    expect(first.description).not.toContain("<br");
    expect(first.photo_url).not.toContain("{width}");
  });

  it("flags promoted top ads", () => {
    expect(items.filter((i) => i.promoted).length).toBe(json.data.filter((o: any) => o.promotion?.top_ad).length);
  });
});
