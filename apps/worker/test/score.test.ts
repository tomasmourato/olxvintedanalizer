import { describe, expect, it } from "vitest";
import { systemPrompt } from "../src/pipeline/ai.js";
import { holdBack, median, ruleScore, rulesOnly, tierFor } from "../src/pipeline/score.js";

const t = { candidate_threshold: 60, notify_threshold: 80 };

describe("median", () => {
  it("needs at least 5 samples", () => {
    expect(median([1, 2, 3, 4])).toBeNull();
    expect(median([5, 1, 4, 2, 3])).toBe(3);
    expect(median([6, 1, 5, 2, 4, 3])).toBe(3.5);
  });
});

describe("ruleScore", () => {
  it("scores against the target price", () => {
    expect(ruleScore({ price: 250, target: 250, median: null }).score).toBe(80);
    expect(ruleScore({ price: 175, target: 250, median: null }).score).toBe(100);
    expect(ruleScore({ price: 325, target: 250, median: null }).score).toBe(50);
    expect(ruleScore({ price: 500, target: 250, median: null }).score).toBe(0);
  });

  it("uses the median as a ±10 modifier, or alone without a target", () => {
    const r = ruleScore({ price: 250, target: 250, median: 350 });
    expect(r.discountPct).toBe(28.6);
    expect(r.score).toBe(90);
    expect(ruleScore({ price: 250, target: 250, median: 150 }).score).toBe(70);
    expect(ruleScore({ price: 70, target: null, median: 100 }).score).toBe(80);
    expect(ruleScore({ price: 100, target: null, median: null }).score).toBe(50);
  });

  it("flags prices that are too good to be true", () => {
    const box = ruleScore({ price: 5.95, target: 250, median: null });
    expect(box.suspicious).toBe(true);
    expect(box.score).toBe(100);
    expect(rulesOnly(box, t)).toBe(79);
    expect(ruleScore({ price: 150, target: 250, median: null }).suspicious).toBe(false);
  });

  it("gives zero without a price", () => {
    expect(ruleScore({ price: null, target: 250, median: 300 }).score).toBe(0);
    expect(ruleScore({ price: 0, target: 250, median: 300 }).score).toBe(0);
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
