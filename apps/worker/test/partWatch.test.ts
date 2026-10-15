import { partWatch, type Watch } from "@dh/shared";
import { describe, expect, it } from "vitest";
import { matchWatches } from "../src/pipeline/match.js";
import { singlePart } from "../src/pipeline/parts.js";
import type { ScrapedListing } from "../src/sources/types.js";

// Real titles (listings table, 2026-09-23) plus the neighbours each model must not catch.
const TITLES = [
  "Scheda video Nvidia GeForce RTX 3060 Ti Aorus Elite 8GB usata",
  "Gigabyte Vision 3060Ti 8GB",
  "Soyo NVIDIA rtx 3060 12gb, come nuova",
  "Placa grafica MSI RTX 3060 12GB",
  "Grafica KFA2 2060Super",
  "Gráfica Nvidia GeForce RTX 2060 Super 8GB",
  "Gigabyte RTX 2060 6GB",
  "Carte Graphique MSI GeForce GTX 1660 SUPER Ventus XS 6Go",
  "GRAFICAS Em Estoque 1660super -PRONTA ENTREGA!",
  "Nvidia GTX 1660 Gigabyte OC 6gb",
  "Carte graphique GTX 1660 Ti",
  "Rx6600 8gb",
  "Sapphire Pulse RX 6600 XT",
  "rx 6900 xt asrock",
  "Gigabyte RX 560 Gaming OC 2Gb Gddr5",
  "RTX 4070 Ti Super Gigabyte",
  "RTX 4070 Ti Zotac",
  "Ryzen 5 3600X",
  "AMD Ryzen 5 3600 6 núcleos",
  "R5 3600",
  "Ryzen 5 5600X",
  "Ryzen 5 5600XT",
  "AMD R7 7800x3d",
  "Processeur Intel Core i9-12900K",
  "Intel Core i5-10400F",
  "Intel Core i5-10400 2.9GHz",
  "16GB RAM 4 x 4GB Crucial Ballistix DDR4",
  "RAM Ballistix 8 Go DDR4",
  "Corsair Vengeance 32GB (2x16GB) DDR4 3200",
  "Ram Sodimm 8GB DDR4 (2x4gb) Micron",
  "16 go Ram ddr5",
  "SSD 512 Go",
  'ssd kingston a400 480gb 2.5" sata iii - sa400s37/480g',
  "Ssd pny 1 to nvm express",
  "SSD Samsung 1TB",
  "HDD WD 1Tb 3.5 Sata 100%",
  "Fonte Corsair 650W 80+ Bronze",
  "Carte mere mag Z390 tomahawk",
];

const parts = TITLES.map((title) => ({ title, part: singlePart(title)! }));
const watchFor = (key: string): Watch => {
  const { part } = parts.find((p) => p.part.key === key)!;
  const w = partWatch({ key, type: part.type, label: part.label! }, 100)!;
  return {
    ...w,
    olx_category_ids: [], // the test titles carry no category
    vinted_catalog_ids: [],
    id: key,
    sources: ["olx", "vinted"],
    price_min: null,
    price_max: null,
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
  };
};
const listing = (title: string): ScrapedListing => ({ source: "olx", external_id: "1", title, url: "https://x", price: 50, category_id: null });
const settings = { global_exclude: [], vinted_countries: [] };

describe("partWatch", () => {
  it("parses every test title", () => {
    expect(parts.filter((p) => !p.part?.key).map((p) => p.title)).toEqual([]);
  });

  it("each part's watch finds exactly the titles with that part key", () => {
    const keys = [...new Set(parts.map((p) => p.part.key!))];
    const wrong: string[] = [];
    for (const key of keys) {
      const w = watchFor(key);
      for (const { title, part } of parts) {
        const matched = matchWatches(listing(title), [w], settings).length > 0;
        if (matched !== (part.key === key)) wrong.push(`${key} ${matched ? "catches" : "misses"} "${title}"`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("fills the group, categories and prices", () => {
    expect(partWatch({ key: "gpu:gtx-1660-super", type: "gpu", label: "GTX 1660 Super" }, 100)).toEqual({
      name: "GTX 1660 Super",
      category: "Placas gráficas",
      include_any: ["1660 super"],
      include_all: [],
      exclude: [],
      olx_category_ids: [5371],
      vinted_catalog_ids: [3602],
      search_remote: true,
      good_price: 70,
      target_price: 55,
    });
    expect(partWatch({ key: "psu:650", type: "psu", label: "Fonte 650W" }, null)).toMatchObject({ include_any: ["650w"], search_remote: false, good_price: null });
    expect(partWatch({ key: "case", type: "case", label: "Caixa" }, 20)).toBeNull();
  });
});
