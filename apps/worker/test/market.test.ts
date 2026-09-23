import { describe, expect, it } from "vitest";
import { askingPrice, marketPrices, type Sample } from "../src/pipeline/market.js";

const olx = (title: string, price: number, extra: Partial<Sample> = {}): Sample => ({
  source: "olx",
  title,
  price,
  category_id: 5371,
  country: "PT",
  condition: "Usado",
  ...extra,
});
const vinted = (title: string, price: number, country = "FR"): Sample => ({ source: "vinted", title, price, category_id: null, country, condition: "Muito bom" });

describe("askingPrice", () => {
  it("takes the Vinted buyer fee (0,70 € + 5 %) off", () => {
    expect(askingPrice({ source: "vinted", price: 578.2 })).toBe(550);
    expect(askingPrice({ source: "vinted", price: 19.6 })).toBe(18);
    expect(askingPrice({ source: "olx", price: 200 })).toBe(200);
  });
});

describe("marketPrices", () => {
  it("takes the trimmed median of Portuguese listings when there are 5", () => {
    const rows = [
      ...[200, 210, 220, 230, 240].map((p) => olx("RTX 3060 12GB", p)),
      olx("RTX 3060 só caixa", 5), // outlier: trimmed (also not a real sale)
      olx("RTX 3060 selada", 900), // outlier: trimmed
      vinted("RTX 3060 12Go", 400), // EU: ignored while Portugal has enough
    ];
    expect(marketPrices(rows, [])).toEqual([
      { key: "gpu:rtx-3060", type: "gpu", label: "RTX 3060", market_value: 220, samples: 5, market_scope: "pt" },
    ]);
  });

  it("falls back to the EU, and skips PCs, new parts and excluded words", () => {
    const rows = [
      ...[105.7, 126.7, 147.7, 168.7, 189.7].map((p) => vinted("GTX 1660 Super", p)),
      olx("GTX 1660 Super", 90),
      olx("GTX 1660 Super", 80, { condition: "Novo" }),
      olx("GTX 1660 Super", 70, { category_id: 4731 }),
      olx("GTX 1660 Super mineração", 60),
    ];
    const [p] = marketPrices(rows, ["mineracao"]);
    expect(p).toMatchObject({ key: "gpu:gtx-1660-super", market_value: 130, market_scope: "eu" });
    expect(p.samples).toBe(6);
  });

  it("gives no value below 5 listings", () => {
    expect(marketPrices([olx("Ryzen 5 3600", 60), olx("R5 3600", 65)], [])).toEqual([
      { key: "cpu:ryzen-3600", type: "cpu", label: "Ryzen 5 3600", market_value: null, samples: 2, market_scope: null },
    ]);
  });
});
