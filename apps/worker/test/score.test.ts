import { describe, expect, it } from "vitest";
import { systemPrompt } from "../src/pipeline/ai.js";
import { holdBack, median, priceTier, ruleScore, rulesOnly, tierFor, vetoed } from "../src/pipeline/score.js";

const t = { candidate_threshold: 60, notify_threshold: 80 };

describe("median", () => {
  it("needs at least 5 samples", () => {
    expect(median([1, 2, 3, 4])).toBeNull();
    expect(median([5, 1, 4, 2, 3])).toBe(3);
    expect(median([6, 1, 5, 2, 4, 3])).toBe(3.5);
  });
});

describe("ruleScore", () => {
  it("writes the notes with Portuguese number formatting", () => {
    expect(ruleScore({ price: 252.7, good: null, great: 249.5, median: 299.95 }).notes).toEqual([
      "1 % acima do preço de imperdível (249,5 €)",
      "15,8 % abaixo da mediana (299,95 €)",
    ]);
  });

  it("scores against the target price", () => {
    expect(ruleScore({ price: 250, good: null, great: 250, median: null }).score).toBe(80);
    expect(ruleScore({ price: 175, good: null, great: 250, median: null }).score).toBe(100);
    expect(ruleScore({ price: 325, good: null, great: 250, median: null }).score).toBe(50);
    expect(ruleScore({ price: 500, good: null, great: 250, median: null }).score).toBe(0);
  });

  it("uses the median as a ±10 modifier, or alone without a target", () => {
    const r = ruleScore({ price: 250, good: null, great: 250, median: 350 });
    expect(r.discountPct).toBe(28.6);
    expect(r.score).toBe(90);
    expect(ruleScore({ price: 250, good: null, great: 250, median: 150 }).score).toBe(70);
    expect(ruleScore({ price: 70, good: null, great: null, median: 100 }).score).toBe(80);
    expect(ruleScore({ price: 100, good: null, great: null, median: null }).score).toBe(50);
  });

  it("flags prices that are too good to be true", () => {
    const box = ruleScore({ price: 5.95, good: null, great: 250, median: null });
    expect(box.suspicious).toBe(true);
    expect(box.score).toBe(100);
    expect(rulesOnly(box, t)).toBe(79);
    expect(ruleScore({ price: 150, good: null, great: 250, median: null }).suspicious).toBe(false);
  });

  it("gives zero without a price", () => {
    expect(ruleScore({ price: null, good: null, great: 250, median: 300 }).score).toBe(0);
    expect(ruleScore({ price: 0, good: null, great: 250, median: 300 }).score).toBe(0);
  });
});

describe("€ prices", () => {
  const w = { target_price: 60, good_price: 100 }; // "1660 Super: imperdível até 60 €, bom até 100 €"

  it("scores 60 at \"Bom até\" when there is no \"Imperdível até\"", () => {
    const r = ruleScore({ price: 100, great: null, good: 100, median: null });
    expect(r.score).toBe(60);
    expect(r.notes).toEqual(["0 % abaixo do preço de bom (100 €)"]);
  });

  it("gives the tier from the price", () => {
    expect(priceTier(60, w)).toBe("imperdivel");
    expect(priceTier(60.01, w)).toBe("bom");
    expect(priceTier(100, w)).toBe("bom");
    expect(priceTier(101, w)).toBe("normal");
    expect(priceTier(null, w)).toBe("normal");
    expect(priceTier(90, { target_price: null, good_price: 100 })).toBe("bom");
    expect(priceTier(50, { target_price: null, good_price: null })).toBeNull();
  });

  it("lets the AI only veto, and holds back suspicious prices without it", () => {
    expect(vetoed("imperdivel", 65, false, t)).toBe("imperdivel");
    expect(vetoed("bom", 95, false, t)).toBe("bom");
    expect(vetoed("imperdivel", 20, false, t)).toBe("normal");
    expect(vetoed("imperdivel", null, false, t)).toBe("imperdivel");
    expect(vetoed("imperdivel", null, true, t)).toBe("bom");
  });
});

describe("tierFor", () => {
  it("follows the thresholds in Definições", () => {
    expect(tierFor(80, t)).toBe("imperdivel");
    expect(tierFor(79, t)).toBe("bom");
    expect(tierFor(60, t)).toBe("bom");
    expect(tierFor(59, t)).toBe("normal");
  });
});

describe("holdBack", () => {
  const now = Date.parse("2026-09-22T12:00:00Z");
  const olx = (posted_at: string) => ({ source: "olx" as const, posted_at });

  it("pushes only fresh top-tier matches", () => {
    expect(holdBack(olx("2026-09-22T11:50:00Z"), { silent: false, priceDrop: false, tier: "imperdivel", now })).toBeNull();
    expect(holdBack(olx("2026-09-22T11:50:00Z"), { silent: false, priceDrop: false, tier: "bom", now })).not.toBeNull();
    expect(holdBack(olx("2026-09-22T11:50:00Z"), { silent: true, priceDrop: false, tier: "imperdivel", now })).not.toBeNull();
  });

  it("skips bumped OLX listings, but not their price drops", () => {
    expect(holdBack(olx("2026-09-10T10:00:00Z"), { silent: false, priceDrop: false, tier: "imperdivel", now })).toBe("anúncio antigo subido");
    expect(holdBack(olx("2026-09-10T10:00:00Z"), { silent: false, priceDrop: true, tier: "imperdivel", now })).toBeNull();
    expect(holdBack({ source: "vinted", posted_at: null }, { silent: false, priceDrop: false, tier: "imperdivel", now })).toBeNull();
  });
});

describe("systemPrompt", () => {
  it("states the live thresholds and the reseller context", () => {
    const p = systemPrompt({ ...t, global_context: "Revendo em Lisboa." });
    expect(p).toContain("80–100 imperdível");
    expect(p).toContain("60–79 bom");
    expect(p).toContain("Revendo em Lisboa.");
  });
});
