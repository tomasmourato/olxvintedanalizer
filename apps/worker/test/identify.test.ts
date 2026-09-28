import type { PcPart, Watch } from "@dh/shared";
import { describe, expect, it } from "vitest";
import { modelPrompt } from "../src/pipeline/ai.js";
import { unnamedWatches, watchType } from "../src/pipeline/match.js";
import { unnamedTypes } from "../src/pipeline/parts.js";
import { pcUnknown } from "../src/pipeline/pc.js";
import type { ScrapedListing } from "../src/sources/types.js";

const watch = (over: Partial<Watch> = {}): Watch => ({
  id: "w1",
  name: "RTX 3060",
  category: "Placas gráficas",
  sources: ["olx", "vinted"],
  include_any: ["3060"],
  include_all: [],
  exclude: ["ti"],
  olx_category_ids: [5371],
  vinted_catalog_ids: [3602],
  search_remote: false,
  price_min: null,
  price_max: 200,
  target_price: 135,
  good_price: 175,
  kind: "part",
  margin_good: null,
  margin_great: null,
  context: "",
  active: true,
  created_at: "",
  updated_at: "",
  priority_until: null,
  ...over,
});
const listing = (title: string, price = 150, over: Partial<ScrapedListing> = {}): ScrapedListing => ({
  source: "olx",
  external_id: "1",
  title,
  url: "https://x",
  price,
  category_id: 5371,
  ...over,
});
const settings = { global_exclude: ["avariada"], vinted_countries: [] };

describe("unnamedTypes", () => {
  it("finds one-part listings that name the type but no model", () => {
    expect(unnamedTypes("Placa gráfica 8GB")).toEqual(["gpu"]);
    expect(unnamedTypes("Ram Corsair 32 gb")).toEqual(["ram"]);
    expect(unnamedTypes("Carte graphique NVIDIA")).toEqual(["gpu"]);
  });

  it("skips listings with a model, whole PCs, lots and broken parts", () => {
    expect(unnamedTypes("RTX 3070 8GB")).toEqual([]);
    expect(unnamedTypes("PC gaming com gráfica")).toEqual([]);
    expect(unnamedTypes("Lote placas gráficas")).toEqual([]);
    expect(unnamedTypes("Gráfica avariada")).toEqual([]);
    expect(unnamedTypes("Monitor Samsung 24")).toEqual([]);
  });

  it("skips models the parser does not follow, combos, accessories and old RAM", () => {
    expect(unnamedTypes("Placa gráfica ATI Radeon R9 280x 3gb gddr5")).toEqual([]);
    expect(unnamedTypes("Gigabyte GeForce GT 710 / hdmi dvi vga")).toEqual([]);
    expect(unnamedTypes("Kit, motherboard, memória ram e processador")).toEqual([]);
    expect(unnamedTypes("Vendo várias placas graficas")).toEqual([]);
    expect(unnamedTypes("Suporte de placa grafica argb")).toEqual([]);
    expect(unnamedTypes("Memoria dimm pc133 / 256mb")).toEqual([]);
    expect(unnamedTypes("RAM Kingston HyperX 1 Go DDR2 800 MHz")).toEqual([]);
    expect(unnamedTypes("Placa gráfica Sapphire de 3 GB")).toEqual(["gpu"]);
    expect(unnamedTypes("Ram 2x4")).toEqual(["ram"]);
  });
});

describe("watchType", () => {
  it("reads the part type from the name and words, else the group", () => {
    expect(watchType(watch())).toBe("gpu");
    expect(watchType(watch({ name: "16GB DDR4", include_any: ["16gb", "2x8gb"], category: "Memória RAM" }))).toBe("ram");
    expect(watchType(watch({ name: "Fontes boas", include_any: ["corsair"], category: "Fontes" }))).toBe("psu");
    expect(watchType(watch({ name: "Coisas", include_any: ["xpto"], category: "Outros" }))).toBeNull();
  });
});

describe("unnamedWatches", () => {
  const watches = [watch(), watch({ id: "ram", name: "16GB DDR4", include_any: ["16gb"], category: "Memória RAM", good_price: 40 }), watch({ id: "pc", kind: "pc" })];

  it("keeps the watches of the same type that could want it at this price", () => {
    expect(unnamedWatches(listing("Placa gráfica 8GB"), ["gpu"], watches, settings).map((w) => w.id)).toEqual(["w1"]);
  });

  it("needs the price at or under Bom até and every other filter", () => {
    expect(unnamedWatches(listing("Placa gráfica 8GB", 180), ["gpu"], watches, settings)).toEqual([]);
    expect(unnamedWatches(listing("Placa gráfica 8GB", 150, { category_id: 4731 }), ["gpu"], watches, settings)).toEqual([]);
    expect(unnamedWatches(listing("Placa gráfica 8GB avariada"), ["gpu"], watches, settings)).toEqual([]);
    expect(unnamedWatches(listing("Placa gráfica 8GB", 150), [], watches, settings)).toEqual([]);
  });

  it("needs the RAM size and generation the title states to be the watch's", () => {
    expect(unnamedWatches(listing("Ram 16gb", 30), ["ram"], watches, settings).map((w) => w.id)).toEqual(["ram"]);
    expect(unnamedWatches(listing("Barrette mémoire 4GB", 10), ["ram"], watches, settings)).toEqual([]);
    expect(unnamedWatches(listing("Ram ddr3 barrette", 10), ["ram"], watches, settings)).toEqual([]);
  });
});

describe("pcUnknown", () => {
  const part = (type: string, key: string | null, value: number | null, label = key ?? type): PcPart => ({
    type,
    key,
    label,
    value,
    source: value == null ? null : "mercado",
    samples: 5,
  });

  it("is null when the processor and the graphics card are valued, or there is no graphics card", () => {
    expect(pcUnknown([part("gpu", "gpu:rtx-3060", 180), part("cpu", "cpu:ryzen-3600", 60)], true)).toBeNull();
    expect(pcUnknown([part("cpu", "cpu:i5-8500", 50)], true)).toBeNull();
  });

  it("says what is missing", () => {
    expect(pcUnknown([part("gpu", "gpu:rtx-3060", 180)], true)).toBe("não diz o processador");
    expect(pcUnknown([part("gpu", null, 150, "RTX"), part("cpu", "cpu:i9-9900k", null, "i9-9900K")], false)).toBe(
      "IA indisponível; sem valor para i9-9900K: define-o em Preços das peças; não diz o modelo da gráfica",
    );
  });
});

describe("modelPrompt", () => {
  it("asks for the model of the watched types, from the title and description", () => {
    const p = modelPrompt({ listing: listing("Placa gráfica 8GB", 150, { description: "Gigabyte RTX 3060 Eagle, pouco uso." }), types: ["gpu"] });
    expect(p).toContain("modelo exato da placa gráfica (ex.: «RTX 3060»");
    expect(p).toContain("Título: Placa gráfica 8GB\nPreço: 150 €\nDescrição:\nGigabyte RTX 3060 Eagle, pouco uso.");
  });
});
