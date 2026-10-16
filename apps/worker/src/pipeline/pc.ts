// A whole PC's parts: they come from the AI (title + description), corrected and completed by the parts parser.
// Valuing them (priceParts, valuePc) is shared with the app's calculator (@dh/shared pcValue.ts). Pure, so it is tested.
import { PART_NAME, parseModel, parseParts, type Named, type Part, type PartType, type PcPart } from "@dh/shared";
import type { PcVerdict } from "./ai.js";

const ORDER: PartType[] = ["gpu", "cpu", "ram", "storage", "motherboard", "psu", "cooler", "case"];
const ONE_PER_PC: PartType[] = ["gpu", "cpu", "motherboard", "psu"];

/** The AI's model names → parser keys ("Ryzen 5 3600" → cpu:ryzen-3600). Unknown models keep their name, without a key. */
export function aiParts(parts: PcVerdict["parts"]): Named[] {
  return parts.map(({ type, model, value }) => {
    const p = parseModel(type, model);
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
  return [...out.values()].map((p) => ({ type: p.type, key: p.key, label: p.label ?? `${PART_NAME[p.type]} (sem modelo)` }));
}

/** The AI's veto: not a whole PC, broken, or signs of a scam. Its other red flags are shown, not vetoed. */
export function pcVeto(v: Pick<PcVerdict, "is_pc" | "working" | "scam">): string[] | null {
  const flags = [!v.is_pc && "não é um PC completo", !v.working && "avariado ou para peças", v.scam && "sinais de burla"].filter((f): f is string => !!f);
  return flags.length ? flags : null;
}

/**
 * Why a PC goes to "Por identificar": its processor is not named, or its processor or graphics card has no
 * model or no value (a PC without a graphics card is fine: integrated graphics). Null when it is valued.
 */
export function pcUnknown(parts: PcPart[], aiAnswered: boolean): string | null {
  const why: string[] = [];
  const cpu = parts.find((p) => p.type === "cpu");
  const gpu = parts.find((p) => p.type === "gpu");
  if (!cpu) why.push("não diz o processador");
  for (const [p, name] of [[cpu, "do processador"], [gpu, "da gráfica"]] as const) {
    if (!p) continue;
    if (!p.key) why.push(`não diz o modelo ${name}`);
    else if (p.value == null) why.push(`sem valor para ${p.label}: define-o em Preços das peças`);
  }
  if (!why.length) return null;
  return `${aiAnswered ? "" : "IA indisponível; "}${why.join("; ")}`;
}
