import { describe, expect, it } from "vitest";
import { autoBuyEligible, startOfDayIso, type AutoBuyInput } from "../src/pipeline/buy.js";
import type { AiResult } from "../src/pipeline/ai.js";

const aiOk = (score = 90): AiResult => ({ status: "ok", verdict: { score, reason: "ok", red_flags: [] }, ms: 10 });

/** A listing/evaluation that passes every gate; each test overrides one field to fail a single gate. */
function base(over: Partial<AutoBuyInput> = {}): AutoBuyInput {
  return {
    listing: { source: "vinted", title: "RTX 3060 12GB", price: 200, country: "PT" },
    evaluation: { tier: "imperdivel", held: null, ai: aiOk(), row: { red_flags: [] } },
    watch: { id: "w1", kind: "part", auto_buy: true, auto_buy_max: 250 },
    settings: { candidate_threshold: 60, auto_buy_max_default: null, vinted_countries: ["PT"] },
    silent: false,
    dismissed: false,
    alreadyActioned: false,
    ...over,
  };
}

const ev = (over: Partial<AutoBuyInput["evaluation"]>): Partial<AutoBuyInput> => ({ evaluation: { ...base().evaluation, ...over } });

describe("autoBuyEligible", () => {
  it("accepts a Vinted single part, imperdível, under the ceiling, AI-approved", () => {
    const e = autoBuyEligible(base());
    expect(e.ok).toBe(true);
    if (e.ok) {
      expect(e.part.key).toBe("gpu:rtx-3060");
      expect(e.ceiling).toBe(250);
    }
  });

  it("falls back to the global default ceiling", () => {
    const e = autoBuyEligible(base({ watch: { id: "w1", kind: "part", auto_buy: true, auto_buy_max: null }, settings: { candidate_threshold: 60, auto_buy_max_default: 300, vinted_countries: ["PT"] } }));
    expect(e.ok && e.ceiling).toBe(300);
  });

  const reject: [string, Partial<AutoBuyInput>][] = [
    ["OLX, not Vinted", { listing: { source: "olx", title: "RTX 3060 12GB", price: 200, country: "PT" } }],
    ["a PC watch", { watch: { id: "w1", kind: "pc", auto_buy: true, auto_buy_max: 250 } }],
    ["auto-buy off", { watch: { id: "w1", kind: "part", auto_buy: false, auto_buy_max: 250 } }],
    ["a silent (first) read", { silent: true }],
    ["a dismissed deal", { dismissed: true }],
    ["another watch already acted", { alreadyActioned: true }],
    ["a held match", ev({ held: "anúncio antigo subido" })],
    ["below imperdível", ev({ tier: "bom" })],
    ["no ceiling set", { watch: { id: "w1", kind: "part", auto_buy: true, auto_buy_max: null } }],
    ["no price", { listing: { source: "vinted", title: "RTX 3060 12GB", price: null, country: "PT" } }],
    ["above the ceiling", { listing: { source: "vinted", title: "RTX 3060 12GB", price: 260, country: "PT" } }],
    ["not a single part (a PC)", { listing: { source: "vinted", title: "PC Gamer RTX 3060 Ryzen 5 3600", price: 200, country: "PT" } }],
    ["a part type not on the allow-list", { listing: { source: "vinted", title: "Cooler Noctua NH-D15", price: 50, country: "PT" } }],
    ["a type named without a model", { listing: { source: "vinted", title: "Placa gráfica 8GB", price: 200, country: "PT" } }],
    ["no AI verdict", ev({ ai: null })],
    ["an AI timeout", ev({ ai: { status: "timeout", error: "sem resposta", ms: 4000 } })],
    ["an AI score below the threshold", ev({ ai: aiOk(40) })],
    ["red flags", ev({ row: { red_flags: ["parece ser só a caixa"] } })],
    ["unknown seller country", { listing: { source: "vinted", title: "RTX 3060 12GB", price: 200, country: null } }],
    ["a country not accepted", { listing: { source: "vinted", title: "RTX 3060 12GB", price: 200, country: "DE" } }],
  ];
  it.each(reject)("rejects %s", (_label, over) => {
    expect(autoBuyEligible(base(over)).ok).toBe(false);
  });

  it("accepts any accepted Vinted country when several are allowed", () => {
    const input = base({
      listing: { source: "vinted", title: "RTX 3060 12GB", price: 200, country: "ES" },
      settings: { candidate_threshold: 60, auto_buy_max_default: null, vinted_countries: ["PT", "ES"] },
    });
    expect(autoBuyEligible(input).ok).toBe(true);
  });
});

describe("startOfDayIso", () => {
  it("returns the last Lisbon midnight as a UTC instant", () => {
    // 2026-06-15 is summer (WEST, UTC+1): local midnight = 2026-06-14T23:00:00Z.
    expect(startOfDayIso("Europe/Lisbon", Date.parse("2026-06-15T10:30:00Z"))).toBe("2026-06-14T23:00:00.000Z");
    // 2026-01-15 is winter (WET, UTC+0): local midnight = 2026-01-15T00:00:00Z.
    expect(startOfDayIso("Europe/Lisbon", Date.parse("2026-01-15T10:30:00Z"))).toBe("2026-01-15T00:00:00.000Z");
  });
});
