import type { Watch } from "@dh/shared";
import { describe, expect, it } from "vitest";
import { matchWatches, searchTerms } from "../src/pipeline/match.js";
import { hasPhrase, normalize } from "../src/pipeline/text.js";
import type { ScrapedListing } from "../src/sources/types.js";
import { isActive } from "../src/util.js";

const watch = (over: Partial<Watch> = {}): Watch => ({
  id: "w1",
  name: "RTX 3060",
  category: "Placas gráficas",
  sources: ["olx", "vinted"],
  include_any: ["rtx 3060"],
  include_all: [],
  exclude: ["ti"],
  olx_category_ids: [],
  vinted_catalog_ids: [],
  search_remote: false,
  price_min: null,
  price_max: 250,
  target_price: 180,
  good_price: null,
  kind: "part",
  margin_good: null,
  margin_great: null,
  context: "",
  active: true,
  created_at: "",
  updated_at: "",
  priority_until: null,
  auto_buy: false,
  auto_buy_max: null,
  ...over,
});

const listing = (over: Partial<ScrapedListing> = {}): ScrapedListing => ({
  source: "olx",
  external_id: "1",
  title: "Placa gráfica RTX3060 12GB",
  url: "https://x",
  price: 200,
  category_id: 5371,
  ...over,
});

const settings = { global_exclude: ["avariado", "para peças"], vinted_countries: ["PT"] };

describe("text", () => {
  it("normalizes accents and punctuation", () => {
    expect(normalize("Placa Gráfica — RTX-3060!")).toBe("placa grafica rtx 3060");
  });

  it("matches whole words, and model numbers without spaces", () => {
    expect(hasPhrase(normalize("RTX3060 12gb"), "rtx 3060")).toBe(true);
    expect(hasPhrase(normalize("ryzen 5 5600 X"), "5600x")).toBe(true);
    expect(hasPhrase(normalize("processador i5"), "i5")).toBe(true);
    expect(hasPhrase(normalize("iphone 5"), "i5")).toBe(false);
    expect(hasPhrase(normalize("troca de pc"), "troco")).toBe(false);
  });
});

describe("matchWatches", () => {
  it("matches keyword and price", () => {
    expect(matchWatches(listing(), [watch()], settings)).toHaveLength(1);
  });

  it("applies watch and global exclusions to the title", () => {
    expect(matchWatches(listing({ title: "RTX 3060 Ti" }), [watch()], settings)).toHaveLength(0);
    expect(matchWatches(listing({ title: "RTX 3060 avariado" }), [watch()], settings)).toHaveLength(0);
    expect(matchWatches(listing({ title: "RTX 3060 para peças" }), [watch()], settings)).toHaveLength(0);
  });

  it("does not look at the description", () => {
    expect(matchWatches(listing({ description: "não está avariado" }), [watch()], settings)).toHaveLength(1);
  });

  it("respects price bounds, source, categories and active flag", () => {
    expect(matchWatches(listing({ price: 300 }), [watch()], settings)).toHaveLength(0);
    expect(matchWatches(listing({ price: null }), [watch()], settings)).toHaveLength(0);
    expect(matchWatches(listing(), [watch({ sources: ["vinted"] })], settings)).toHaveLength(0);
    expect(matchWatches(listing(), [watch({ olx_category_ids: [4731] })], settings)).toHaveLength(0);
    expect(matchWatches(listing(), [watch({ active: false })], settings)).toHaveLength(0);
  });

  it("filters Vinted by seller country once known", () => {
    const v = listing({ source: "vinted", category_id: null });
    expect(matchWatches({ ...v, country: "FR" }, [watch()], settings)).toHaveLength(0);
    expect(matchWatches({ ...v, country: "PT" }, [watch()], settings)).toHaveLength(1);
    expect(matchWatches(v, [watch({ vinted_catalog_ids: [3602] })], settings)).toHaveLength(1); // catalog unknown → pass
  });

  it("checks Vinted catalogs against the whole breadcrumb chain once enriched", () => {
    const gpu = listing({ source: "vinted", category_id: 3602, category_path: [2994, 3564, 3582, 3602] });
    expect(matchWatches(gpu, [watch({ vinted_catalog_ids: [3582] })], settings)).toHaveLength(1);
    expect(matchWatches(gpu, [watch({ vinted_catalog_ids: [3580] })], settings)).toHaveLength(0);
  });

  it("finds a 4-digit NVIDIA model without its GTX/RTX, in words and exclusions", () => {
    const super1660 = watch({ include_any: ["GTX 1660 Super"], exclude: [], price_max: 80 });
    expect(matchWatches(listing({ title: "Gigabyte 1660 super", price: 65 }), [super1660], settings)).toHaveLength(1);
    expect(matchWatches(listing({ title: "Gigabyte 1660super", price: 65 }), [super1660], settings)).toHaveLength(1);
    expect(matchWatches(listing({ title: "Gigabyte 1660 ti", price: 65 }), [super1660], settings)).toHaveLength(0);
    const rtx3060 = watch({ include_any: ["rtx 3060"], exclude: ["rtx 3060 ti"] });
    expect(matchWatches(listing({ title: "MSI 3060 Ti 8GB" }), [rtx3060], settings)).toHaveLength(0);
    expect(matchWatches(listing({ title: "MSI 3060 12GB" }), [rtx3060], settings)).toHaveLength(1);
  });

  it("keeps the RX of AMD models and the GTX of 3-digit ones", () => {
    expect(matchWatches(listing({ title: "Sapphire 580 8GB" }), [watch({ include_any: ["rx 580"], exclude: [] })], settings)).toHaveLength(0);
    expect(matchWatches(listing({ title: "Asus 970 4GB" }), [watch({ include_any: ["gtx 970"], exclude: [] })], settings)).toHaveLength(0);
  });

  it("does not take other things with the same number for the card", () => {
    const rtx3050 = watch({ include_any: ["RTX 3050"], exclude: [], price_max: 200 });
    for (const title of ["Dell optiplex 3050", "Fonte alimentação Dell 3050", "Impressora HP Deskjet 3050", "Celeron N3050 4/128"]) {
      expect(matchWatches(listing({ title, price: 50 }), [rtx3050], settings)).toHaveLength(0);
    }
    const gtx1660 = watch({ include_any: ["gtx 1660"], exclude: [], price_max: 200 });
    expect(matchWatches(listing({ title: "Module carte bandeau 7719016600", price: 25 }), [gtx1660], settings)).toHaveLength(0);
  });

  it("an empty include list matches anything in the categories", () => {
    expect(matchWatches(listing({ title: "Monitor 27" }), [watch({ include_any: [], exclude: [], price_max: null })], settings)).toHaveLength(1);
  });
});

describe("searchTerms", () => {
  it("collects unique terms from watches with search_remote", () => {
    const ws = [
      watch({ search_remote: true, include_any: ["rtx 3060", "RTX  3060"] }),
      watch({ id: "w2", search_remote: true, include_any: [], include_all: ["ryzen", "5600"] }),
      watch({ id: "w3", search_remote: false, include_any: ["gtx 1080"] }),
    ];
    expect(searchTerms(ws, "olx").map((t) => t.term)).toEqual(["rtx 3060", "ryzen 5600"]);
  });
});

describe("isActive", () => {
  const at = (iso: string) => new Date(iso);
  it("uses the Lisbon clock", () => {
    // 05:30 UTC in summer = 06:30 in Lisbon (WEST, UTC+1)
    expect(isActive("06:00:00", "22:00:00", "Europe/Lisbon", at("2026-07-01T05:30:00Z"))).toBe(true);
    expect(isActive("06:00:00", "22:00:00", "Europe/Lisbon", at("2026-07-01T04:30:00Z"))).toBe(false);
    expect(isActive("06:00:00", "22:00:00", "Europe/Lisbon", at("2026-07-01T21:00:00Z"))).toBe(false);
  });
  it("handles windows past midnight", () => {
    expect(isActive("22:00", "02:00", "UTC", at("2026-01-01T23:00:00Z"))).toBe(true);
    expect(isActive("22:00", "02:00", "UTC", at("2026-01-01T12:00:00Z"))).toBe(false);
  });
});
