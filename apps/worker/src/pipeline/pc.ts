// A whole PC valued by its parts: the parts come from the AI (title + description), corrected and completed by the
// parts parser; each part is worth its part_prices value (the friend's, else the market median, else the AI's saved
// estimate), or the AI's estimate in this answer; the tier comes from the margin (parts value − asking price) and
// the watch's margins. Pure, so it is tested.
import { type PcPart, type Tier, type Watch } from "@dh/shared";
import type { PcVerdict } from "./ai.js";
import { parseParts, type Part, type PartType } from "./parts.js";

export type PartValue = { value: number; source: "manual" | "mercado" | "ia"; samples: number };

const NAME: Record<PartType, string> = {
  gpu: "Gráfica",
  cpu: "Processador",
  ram: "RAM",
  storage: "Disco",
  psu: "Fonte",
  motherboard: "Motherboard",
  cooler: "Cooler",
  case: "Caixa",
};
// The parser never gives these a key: only the AI's estimate values them, and they are not flagged when it has none.
const UNPRICED: PartType[] = ["cooler", "case"];
// Keyword the parser needs to recognise the AI's bare model name ("650W" → "fonte 650W").
const HINT: Partial<Record<PartType, string>> = { psu: "fonte", motherboard: "motherboard", ram: "ram" };
const DEFAULT_MARGINS = { good: 50, great: 100 };
const SUSPICIOUS_RATIO = 0.4; // asking under 40 % of the parts: misread parts, broken or a scam

/** estimate: the AI's value for this part in this answer (used when part_prices has none). */
export type Named = { type: PartType; key: string | null; label: string; estimate?: number | null };
const ORDER: PartType[] = ["gpu", "cpu", "ram", "storage", "motherboard", "psu", "cooler", "case"];
const ONE_PER_PC: PartType[] = ["gpu", "cpu", "motherboard", "psu"];

/** The AI's model names → parser keys ("Ryzen 5 3600" → cpu:ryzen-3600). Unknown models keep their name, without a key. */
export function aiParts(parts: PcVerdict["parts"]): Named[] {
  return parts.map(({ type, model, value }) => {
    const hint = HINT[type];
    const p = parseParts(hint && !model.toLowerCase().includes(hint) ? `${hint} ${model}` : model).find((x) => x.type === type && x.key);
    return { type, key: p?.key ?? null, label: p?.label ?? model, estimate: value };
  });
}

/**
 * The AI's parts, checked against the parser (Flash-Lite sometimes leaves the graphics card out or reads
 * "7800X3D" as "5800X3D"): a GPU, CPU, motherboard or PSU model written in the title replaces the AI's, and a
 * type the AI named without a model, or not at all, comes from the title or else the description.
 */
export function mergeParts(ai: Named[], title: string, description: string | null | undefined): Named[] {
  let out = [...ai];
  const title_ = parseParts(title).filter((p) => p.key).map((p) => ({ type: p.type, key: p.key, label: p.label! }));
  for (const p of title_) {
    // Same model, or the AI read a more specific variant in the description ("RTX 2060" → "RTX 2060 Super", "i5-10400" → "i5-10400F").
    if (out.some((x) => x.key === p.key || x.key?.startsWith(p.key!))) continue;
    if (ONE_PER_PC.includes(p.type)) out = [...out.filter((x) => x.type !== p.type), p];
    else if (!out.some((x) => x.type === p.type && x.key)) out = [...out.filter((x) => x.type !== p.type), p];
  }
  for (const p of rulesParts(title, description)) {
    if (p.key && !out.some((x) => x.type === p.type && x.key)) out = [...out.filter((x) => x.type !== p.type), p];
  }
  return out.sort((a, b) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type));
}

/** Without the AI: the title's parts, then the description's for the types the title does not name. One per type. */
export function rulesParts(title: string, description: string | null | undefined): Named[] {
  const out = new Map<PartType, Part>();
  for (const p of [...parseParts(title), ...(description ? parseParts(description) : [])]) {
    const had = out.get(p.type);
    if (!had || (!had.key && p.key)) out.set(p.type, p);
  }
  return [...out.values()].map((p) => ({ type: p.type, key: p.key, label: p.label ?? `${NAME[p.type]} (sem modelo)` }));
}

export function priceParts(parts: Named[], values: ReadonlyMap<string, PartValue>): PcPart[] {
  return parts.map((p) => {
    const v = p.key ? values.get(p.key) : undefined;
    if (v) return { type: p.type, label: p.label, key: p.key, value: v.value, source: v.source, samples: v.samples };
    const e = p.estimate ?? null;
    return { type: p.type, label: p.label, key: p.key, value: e, source: e != null ? "ia" : null, samples: 0 };
  });
}

export type PcValuation = {
  partsValue: number | null;
  margin: number | null;
  /** Margin as a share of the parts' value (matches.discount_pct, used to sort). */
  marginPct: number | null;
  tier: Tier;
  /** 60 at the "bom" margin, 80 at the "imperdível" one (the default thresholds), for sorting and the badge. */
  score: number;
  suspicious: boolean;
  notes: string[];
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const clamp = (n: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, n));

export function margins(w: Pick<Watch, "margin_good" | "margin_great">): { good: number; great: number } {
  const good = w.margin_good != null ? Number(w.margin_good) : w.margin_great != null ? Number(w.margin_great) / 2 : DEFAULT_MARGINS.good;
  const great = w.margin_great != null ? Number(w.margin_great) : w.margin_good != null ? good * 2 : DEFAULT_MARGINS.great;
  return { good, great: Math.max(great, good) };
}

export function valuePc(parts: PcPart[], price: number | null, w: Pick<Watch, "margin_good" | "margin_great">): PcValuation {
  const valued = parts.filter((p) => p.value != null);
  const missing = parts.filter((p) => p.value == null && !UNPRICED.includes(p.type as PartType)).map((p) => p.label);
  const partsValue = valued.length ? round2(valued.reduce((s, p) => s + p.value!, 0)) : null;
  const notes: string[] = [];
  if (missing.length) notes.push(`sem valor: ${missing.join(", ")}`);
  if (partsValue == null || price == null || price <= 0) {
    notes.unshift(partsValue == null ? "nenhuma peça com valor" : price == null ? "sem preço" : "preço 0 €");
    return { partsValue, margin: null, marginPct: null, tier: "normal", score: 0, suspicious: false, notes };
  }

  const margin = round2(partsValue - price);
  const { good, great } = margins(w);
  const tier: Tier = margin >= great ? "imperdivel" : margin >= good ? "bom" : "normal";
  const score = Math.round(clamp(60 + ((margin - good) / Math.max(great - good, 25)) * 20));
  const suspicious = price < partsValue * SUSPICIOUS_RATIO;
  if (suspicious) notes.push("preço demasiado baixo para estas peças: confirma o anúncio");
  return { partsValue, margin, marginPct: clamp(Math.round((margin / partsValue) * 1000) / 10, -999, 100), tier, score, suspicious, notes };
}

/** The AI's veto: not a whole PC, broken, or signs of a scam. Its other red flags are shown, not vetoed. */
export function pcVeto(v: Pick<PcVerdict, "is_pc" | "working" | "scam">): string[] | null {
  const flags = [!v.is_pc && "não é um PC completo", !v.working && "avariado ou para peças", v.scam && "sinais de burla"].filter((f): f is string => !!f);
  return flags.length ? flags : null;
}
