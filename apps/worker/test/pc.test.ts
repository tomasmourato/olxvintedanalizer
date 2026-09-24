import { describe, expect, it } from "vitest";
import { pcSystemPrompt, pcUserPrompt } from "../src/pipeline/ai.js";
import { parseParts } from "../src/pipeline/parts.js";
import { aiParts, margins, mergeParts, pcVeto, priceParts, rulesParts, valuePc, type PartValue } from "../src/pipeline/pc.js";
import { dealPayload } from "../src/pipeline/payload.js";

const values = new Map<string, PartValue>([
  ["gpu:rtx-3060", { value: 180, source: "mercado", samples: 23 }],
  ["cpu:ryzen-3600", { value: 60, source: "manual", samples: 9 }],
  ["ram:ddr4-16", { value: 30, source: "mercado", samples: 40 }],
  ["storage:ssd-512", { value: 25, source: "mercado", samples: 31 }],
  ["psu:650", { value: 35, source: "mercado", samples: 12 }],
]);
const watch = { margin_good: 50, margin_great: 100 };

describe("aiParts", () => {
  it("turns the AI's canonical names into part keys", () => {
    const parts = aiParts([
      { type: "gpu", model: "RTX 3060", value: null },
      { type: "cpu", model: "Ryzen 5 3600", value: null },
      { type: "cpu", model: "i5-10400F", value: null },
      { type: "ram", model: "16GB DDR4", value: null },
      { type: "storage", model: "SSD 512GB", value: null },
      { type: "psu", model: "650W", value: null },
      { type: "motherboard", model: "B450", value: null },
      { type: "case", model: "NZXT H510", value: null },
    ]);
    expect(parts.map((p) => p.key)).toEqual([
      "gpu:rtx-3060",
      "cpu:ryzen-3600",
      "cpu:i5-10400f",
      "ram:ddr4-16",
      "storage:ssd-512",
      "psu:650",
      "mb:b450",
      null,
    ]);
    expect(parts.at(-1)).toEqual({ type: "case", key: null, label: "NZXT H510", estimate: null });
  });

  it("keeps a model it cannot read, without a key", () => {
    expect(aiParts([{ type: "ram", model: "16GB", value: null }])).toEqual([{ type: "ram", key: null, label: "16GB", estimate: null }]);
  });
});

describe("mergeParts", () => {
  const ai = (parts: [string, string, number?][]) => aiParts(parts.map(([type, model, value]) => ({ type: type as "gpu", model, value: value ?? null })));

  it("puts back the GPU the AI left out, and the title's models win", () => {
    const parts = mergeParts(ai([["cpu", "Ryzen 7 5800X3D", 250], ["ram", "32GB DDR5", 120]]), "Desktop ryzen 7 7800x3d / RTX 3060 Ti", null);
    expect(parts.map((p) => p.key)).toEqual(["gpu:rtx-3060-ti", "cpu:ryzen-7800x3d", "ram:ddr5-32"]);
  });

  it("keeps the AI's more specific variant of the title's model", () => {
    const parts = mergeParts(ai([["gpu", "RTX 2060 Super", 160], ["cpu", "Ryzen 5 3600", 70]]), "PC Gaming RTX 2060 & Ryzen 5 3600X", null);
    expect(parts.map((p) => p.key)).toEqual(["gpu:rtx-2060-super", "cpu:ryzen-3600x"]);
  });

  it("fills a part named without a model from the description", () => {
    const parts = mergeParts(ai([["gpu", "RTX 2060 Super", 150], ["ram", "16GB", 35]]), "Computador gamer", "Memória 16GB DDR4 3200, SSD 512GB");
    expect(parts.map((p) => [p.key, p.estimate ?? null])).toEqual([["gpu:rtx-2060-super", 150], ["ram:ddr4-16", null], ["storage:ssd-512", null]]);
  });
});

describe("rulesParts", () => {
  it("reads the title first and fills the other types from the description", () => {
    const parts = rulesParts("PC Gaming RTX 3060 Ryzen 5 3600", "Memória 16GB DDR4 3200. Disco SSD 512GB NVMe. Fonte 650W bronze.");
    expect(parts.map((p) => p.key)).toEqual(["gpu:rtx-3060", "cpu:ryzen-3600", "ram:ddr4-16", "storage:ssd-512", "psu:650"]);
  });

  it("names a part type it has no model for", () => {
    expect(rulesParts("PC gamer com gráfica", null)).toEqual([{ type: "gpu", key: null, label: "Gráfica (sem modelo)" }]);
  });
});

describe("parseParts in PC titles", () => {
  it("takes the sizes next to RAM and SSD, not the graphics card's", () => {
    expect(parseParts("PC Gaming RTX 3060 12GB 16GB DDR4 512GB SSD").map((p) => p.key)).toEqual([
      "gpu:rtx-3060",
      "ram:ddr4-16",
      "storage:ssd-512",
    ]);
    expect(parseParts("Desktop i5 10400f ram ddr4 32gb ssd 1tb").map((p) => p.key)).toEqual(["cpu:i5-10400f", "ram:ddr4-32", "storage:ssd-1000"]);
  });
});

const parts = priceParts(
  aiParts([
    { type: "gpu", model: "RTX 3060", value: null },
    { type: "cpu", model: "Ryzen 5 3600", value: null },
    { type: "ram", model: "16GB DDR4", value: null },
    { type: "storage", model: "SSD 512GB", value: null },
    { type: "motherboard", model: "B450", value: null },
    { type: "case", model: "NZXT H510", value: null },
  ]),
  values,
);

describe("valuePc", () => {
  it("adds up the known parts and says which have no value", () => {
    expect(parts.find((p) => p.key === "cpu:ryzen-3600")).toMatchObject({ value: 60, source: "manual", samples: 9 });
    const v = valuePc(parts, 200, watch);
    expect(v.partsValue).toBe(295);
    expect(v.margin).toBe(95);
    expect(v.notes).toEqual(["sem valor: Motherboard B450"]); // the case has no price by design: not flagged
  });

  it("takes the tier from the margin", () => {
    expect(valuePc(parts, 250, watch)).toMatchObject({ tier: "normal", margin: 45 });
    expect(valuePc(parts, 245, watch)).toMatchObject({ tier: "bom", score: 60 });
    expect(valuePc(parts, 195, watch)).toMatchObject({ tier: "imperdivel", score: 80 });
    expect(valuePc(parts, 400, watch).score).toBe(0);
    expect(valuePc(parts, 245, watch).marginPct).toBe(16.9);
  });

  it("stays normal without a price or any valued part", () => {
    expect(valuePc(parts, null, watch)).toMatchObject({ tier: "normal", margin: null, notes: ["sem preço", "sem valor: Motherboard B450"] });
    expect(valuePc(priceParts([{ type: "gpu", key: null, label: "Gráfica (sem modelo)" }], values), 100, watch)).toMatchObject({
      tier: "normal",
      partsValue: null,
    });
  });

  it("flags a price far below the parts", () => {
    expect(valuePc(parts, 100, watch).suspicious).toBe(true);
    expect(valuePc(parts, 150, watch).suspicious).toBe(false);
  });
});

describe("priceParts", () => {
  it("uses the AI's estimate only when part_prices has no value", () => {
    const named = aiParts([{ type: "gpu", model: "RTX 3060", value: 250 }, { type: "cpu", model: "i5-12400F", value: 90 }, { type: "case", model: "NZXT H510", value: null }]);
    expect(priceParts(named, values).map((p) => [p.value, p.source])).toEqual([[180, "mercado"], [90, "ia"], [null, null]]);
  });
});

describe("margins", () => {
  it("fills a missing margin from the other one, or the defaults", () => {
    expect(margins({ margin_good: 80, margin_great: null })).toEqual({ good: 80, great: 160 });
    expect(margins({ margin_good: null, margin_great: 120 })).toEqual({ good: 60, great: 120 });
    expect(margins({ margin_good: null, margin_great: null })).toEqual({ good: 50, great: 100 });
  });
});

describe("pcVeto", () => {
  it("vetoes laptops and loose parts, broken PCs and scams only", () => {
    expect(pcVeto({ is_pc: true, working: true, scam: false })).toBeNull();
    expect(pcVeto({ is_pc: false, working: true, scam: false })).toEqual(["não é um PC completo"]);
    expect(pcVeto({ is_pc: true, working: false, scam: true })).toEqual(["avariado ou para peças", "sinais de burla"]);
  });
});

describe("PC prompt and push", () => {
  const listing = { source: "olx" as const, title: "PC Gamer RTX 3060", price: 200, url: "https://www.olx.pt/d/anuncio/pc-IDx.html", photo_url: null };

  it("sends the listing and the watch's context to the AI", () => {
    const w = { context: "Só torres ATX." };
    const p = pcUserPrompt({ listing: { ...listing, external_id: "1", description: "Ryzen 5 3600, 16GB DDR4" }, watch: w as never });
    expect(p).toBe("Contexto da pesquisa: Só torres ATX.\nAnúncio (OLX): PC Gamer RTX 3060\nPreço: 200 €\nDescrição:\nRyzen 5 3600, 16GB DDR4");
    expect(pcSystemPrompt({ global_context: "" })).toContain("«RTX 3060 Ti»");
  });

  it("leads with the parts value and the margin, then the main parts", () => {
    const p = dealPayload(listing, 9, "PCs completos", { score: 80, discount_pct: 33.9, reason: "Bom estado, inclui monitor.", parts, parts_value: 295 }, null);
    expect(p.title).toBe("200 € · PC Gamer RTX 3060");
    expect(p.body).toBe("PCs completos · OLX · peças 295 € · margem 95 €\nRTX 3060 · Ryzen 5 3600 · 16GB DDR4 · SSD 512GB\nBom estado, inclui monitor.");
  });
});
