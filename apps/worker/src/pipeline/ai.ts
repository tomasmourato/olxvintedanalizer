// Gemini verdict for rule candidates (askAi) and the parts of a PC listing (askPcParts): structured JSON,
// hard timeout, one per-minute cap for the free tier. Any failure falls back to the rules (the caller marks it "(sem IA)").
import { GoogleGenAI } from "@google/genai";
import type { Settings, Watch } from "@dh/shared";
import type { ScrapedListing } from "../sources/types.js";
import { priceTier, type RuleResult } from "./score.js";

// Flash-Lite answers in ~1 s; gemini-3.8-flash took 4 s+ even with thinking "low" (measured 2026-09-22).
const MODEL = "gemini-3.5-flash-lite";
const TIMEOUT_MS = 4_000;
const PC_TIMEOUT_MS = 10_000; // a PC's description is longer and the answer lists every part
const MAX_PER_MIN = 10;
const MAX_DESCRIPTION = 1_500;
const MAX_PC_DESCRIPTION = 3_000;

export type AiVerdict = { score: number; reason: string; red_flags: string[] };
type Outcome<T> = { status: "ok"; verdict: T; ms: number } | { status: "timeout" | "error" | "disabled" | "skipped"; error: string; ms: number };
export type AiResult = Outcome<AiVerdict>;

let client: GoogleGenAI | null = null;
const recent: number[] = [];

/** Key present and switched on in Definições. */
export function aiAvailable(settings: Pick<Settings, "ai_enabled">): boolean {
  return settings.ai_enabled && !!process.env.GEMINI_API_KEY;
}

const SCHEMA = {
  type: "object",
  properties: {
    score: { type: "integer", minimum: 0, maximum: 100 },
    reason: { type: "string", description: "Uma frase curta em português de Portugal (máx. 140 caracteres)." },
    red_flags: { type: "array", items: { type: "string" }, description: "Problemas concretos, curtos. Vazio se nenhum." },
  },
  required: ["score", "reason", "red_flags"],
};

export type AiInput = {
  listing: ScrapedListing;
  watch: Watch;
  settings: Settings;
  rules: RuleResult;
  median: number | null;
  previousPrice: number | null;
};

export function systemPrompt(s: Pick<Settings, "candidate_threshold" | "notify_threshold" | "global_context">): string {
  return [
    "Avalias anúncios de peças e computadores em segunda mão (OLX e Vinted, Portugal) para um revendedor de PCs que compra para revender com lucro.",
    "Dá uma pontuação de 0 a 100 ao negócio:",
    `- ${s.notify_threshold}–100 imperdível: bem abaixo do valor de mercado, produto certo, revendível com lucro claro. Gera notificação imediata, por isso só quando tens confiança.`,
    `- ${s.candidate_threshold}–${s.notify_threshold - 1} bom: preço justo ou um pouco abaixo.`,
    `- 0–${s.candidate_threshold - 1} normal: preço de mercado ou acima, ou não serve.`,
    "Baixa muito a pontuação se: for só um acessório, caixa vazia, cabo, suporte ou peça que apenas menciona o modelo; estiver avariado, para peças ou bloqueado; for um pedido de compra (procuro/compro) ou troca; não corresponder ao que a pesquisa procura; tiver sinais de burla (preço irrealista, pagamento fora da plataforma, fotos de catálogo).",
    "Usa o teu conhecimento dos preços atuais de mercado em Portugal. Os preços «imperdível até» e «bom até» são os limites que o revendedor definiu para a pesquisa; a mediana é a dos anúncios desta pesquisa nos últimos 30 dias.",
    "Vendedores de outros países são aceitáveis (o Vinted envia para Portugal): não penalizes só por isso, apenas se exigirem entrega em mão ou pagamento fora da plataforma.",
    "Responde em português de Portugal, com acentos.",
    s.global_context.trim() && `Contexto do revendedor:\n${s.global_context.trim()}`,
  ]
    .filter(Boolean)
    .join("\n");
}

const TIER_LABEL = { imperdivel: "imperdível", bom: "bom", normal: "normal" } as const;

export function userPrompt({ listing: l, watch: w, settings, rules, median, previousPrice }: AiInput): string {
  const desc = l.description?.trim().slice(0, MAX_DESCRIPTION);
  const byPrice = priceTier(l.price, w);
  return [
    `Pesquisa: ${w.name}${w.category ? ` (${w.category})` : ""}`,
    w.context.trim() && `Contexto da pesquisa: ${w.context.trim()}`,
    w.target_price != null && `Imperdível até: ${w.target_price} €`,
    w.good_price != null && `Bom até: ${w.good_price} €`,
    median != null && `Mediana 30 dias: ${median} €`,
    "",
    `Anúncio (${l.source === "olx" ? "OLX" : "Vinted"}): ${l.title}`,
    `Preço: ${l.price ?? "sem preço"} €${previousPrice != null ? ` (baixou de ${previousPrice} €)` : ""}`,
    l.condition && `Estado: ${l.condition}`,
    l.brand && `Marca: ${l.brand}`,
    l.location && `Local: ${l.location}`,
    l.country && `País do vendedor: ${l.country}`,
    l.seller_business != null && `Vendedor profissional: ${l.seller_business ? "sim" : "não"}`,
    desc ? `Descrição:\n${desc}` : "Sem descrição.",
    "",
    `Regras: ${rules.score}/100 (${rules.notes.join("; ")})`,
    byPrice &&
      `Pelo preço, este anúncio é ${TIER_LABEL[byPrice]}: o nível vem do preço. Verifica só se é mesmo o produto da pesquisa, a funcionar e sem sinais de burla. Se não for, dá menos de ${settings.candidate_threshold}; se for, dá ${settings.candidate_threshold} ou mais.`,
  ]
    .filter((x) => x !== false && x !== null && x !== undefined && x !== "")
    .join("\n");
}

const flagsOf = (v: unknown): string[] =>
  (Array.isArray(v) ? v : []).filter((f): f is string => typeof f === "string" && !!f.trim()).map((f) => f.trim().slice(0, 80)).slice(0, 5);

function parseVerdict(text: string | undefined): AiVerdict {
  const j = JSON.parse(text ?? "") as Partial<AiVerdict>;
  if (typeof j.score !== "number" || typeof j.reason !== "string" || !Array.isArray(j.red_flags)) {
    throw new Error(`unexpected AI output: ${text?.slice(0, 200)}`);
  }
  return {
    score: Math.round(Math.min(100, Math.max(0, j.score))),
    reason: j.reason.trim().slice(0, 200),
    red_flags: flagsOf(j.red_flags),
  };
}

export function askAi(input: AiInput): Promise<AiResult> {
  return generate(input.settings, userPrompt(input), systemPrompt(input.settings), SCHEMA, parseVerdict, TIMEOUT_MS);
}

async function generate<T>(
  settings: Pick<Settings, "ai_enabled">,
  contents: string,
  systemInstruction: string,
  schema: object,
  parse: (text: string | undefined) => T,
  timeoutMs: number,
): Promise<Outcome<T>> {
  const t = Date.now();
  if (!aiAvailable(settings)) return { status: "disabled", error: "IA desligada ou sem chave", ms: 0 };
  while (recent.length && t - recent[0] > 60_000) recent.shift();
  if (recent.length >= MAX_PER_MIN) return { status: "skipped", error: `limite de ${MAX_PER_MIN} pedidos/min`, ms: 0 };
  recent.push(t);

  client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    const res = await client.models.generateContent({
      model: process.env.GEMINI_MODEL || MODEL,
      contents,
      config: { systemInstruction, responseMimeType: "application/json", responseJsonSchema: schema, abortSignal: signal },
    });
    return { status: "ok", verdict: parse(res.text), ms: Date.now() - t };
  } catch (e) {
    const ms = Date.now() - t;
    if (signal.aborted) return { status: "timeout", error: `sem resposta em ${timeoutMs / 1000} s`, ms };
    return { status: "error", error: e instanceof Error ? e.message.slice(0, 300) : String(e), ms };
  }
}

// PCs: which parts does the listing name? The worker values them (part_prices); the AI only reads and vetoes.

export const PC_PART_TYPES = ["gpu", "cpu", "ram", "storage", "psu", "motherboard", "cooler", "case"] as const;
export type PcVerdict = {
  /** A whole desktop (not a laptop, an empty case, some loose parts, a monitor or a wanted ad). */
  is_pc: boolean;
  /** False when broken, for parts, or it does not boot. */
  working: boolean;
  scam: boolean;
  /** value: the AI's estimate of the part's used value in €, null when it does not know. */
  parts: { type: (typeof PC_PART_TYPES)[number]; model: string; value: number | null }[];
  red_flags: string[];
  reason: string;
};
export type PcAiResult = Outcome<PcVerdict>;

const PC_SCHEMA = {
  type: "object",
  properties: {
    is_pc: { type: "boolean", description: "true se é um computador de secretária completo (torre com as peças dentro)." },
    working: { type: "boolean", description: "false se está avariado, para peças, não liga ou tem defeito." },
    scam: { type: "boolean", description: "true se há sinais de burla." },
    parts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string", enum: PC_PART_TYPES },
          model: { type: "string" },
          value: { type: "integer", minimum: 0, description: "Valor de revenda em segunda mão em Portugal, em euros, só desta peça. 0 se não souberes." },
        },
        required: ["type", "model", "value"],
      },
    },
    red_flags: { type: "array", items: { type: "string" }, description: "Problemas concretos, curtos. Vazio se nenhum." },
    reason: { type: "string", description: "Uma frase curta em português de Portugal (máx. 140 caracteres)." },
  },
  required: ["is_pc", "working", "scam", "parts", "red_flags", "reason"],
};

export function pcSystemPrompt(s: Pick<Settings, "global_context">): string {
  return [
    "Lês anúncios de computadores de secretária em segunda mão (OLX e Vinted) para um revendedor que os compra para vender inteiros ou às peças.",
    "Diz que peças o computador tem, só as que o anúncio diz (título ou descrição): todas, incluindo a gráfica. Não adivinhes modelos e copia-os exatamente como estão no anúncio, sem os trocar por um parecido.",
    "Uma entrada por peça, com o nome no formato destes exemplos (são só o formato: qualquer modelo conta):",
    "- gpu: «RTX 3060», «RTX 3060 Ti», «GTX 1660 Super», «RX 6600 XT», «Arc A750». A gráfica integrada não conta.",
    "- cpu: «Ryzen 5 3600», «i5-10400F», «i7-8700K», «Core Ultra 5 245K».",
    "- ram: o total com a geração, «16GB DDR4» (2x8GB = 16GB). Sem a geração escrita, deduz-a do processador quando ele a define: Intel da 6.ª à 11.ª geração e Ryzen até à série 5000 = DDR4; Ryzen 7000 e 9000 = DDR5. Intel da 12.ª à 14.ª geração aceita as duas: aí, só com a geração escrita.",
    "- storage: um disco por entrada, «SSD 512GB», «SSD 1TB», «HDD 2TB».",
    "- psu: a potência, «650W». motherboard: o chipset, «B450», «B550», «Z390». cooler e case: marca e modelo, se o anúncio os disser.",
    "value: quanto vale cada peça sozinha, usada, em Portugal (estimativa em euros; 0 se não souberes).",
    "is_pc = false se for um portátil, só a caixa, só algumas peças, um monitor, um pedido de compra (procuro/compro) ou uma troca.",
    "working = false se estiver avariado, para peças, não ligar ou tiver um defeito que o impeça de funcionar.",
    "scam = true se houver sinais de burla: preço irrealista, pagamento fora da plataforma, fotos de catálogo. Ser de outro país não é sinal de burla.",
    "red_flags: problemas concretos e curtos (ex.: riscos, falta a gráfica, sem Windows). Vazio se nenhum. Não comentes o preço pedido: é o revendedor que calcula a margem.",
    "reason: numa frase, o que se destaca, incluindo os extras que vêm com o PC (monitor, periféricos), que não entram no valor.",
    "Responde em português de Portugal, com acentos.",
    s.global_context.trim() && `Contexto do revendedor:\n${s.global_context.trim()}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export type PcAiInput = { listing: ScrapedListing; watch: Watch; settings: Settings };

export function pcUserPrompt({ listing: l, watch: w }: Pick<PcAiInput, "listing" | "watch">): string {
  const desc = l.description?.trim().slice(0, MAX_PC_DESCRIPTION);
  return [
    w.context.trim() && `Contexto da pesquisa: ${w.context.trim()}`,
    `Anúncio (${l.source === "olx" ? "OLX" : "Vinted"}): ${l.title}`,
    `Preço: ${l.price ?? "sem preço"} €`,
    l.condition && `Estado: ${l.condition}`,
    l.location && `Local: ${l.location}`,
    l.country && `País do vendedor: ${l.country}`,
    desc ? `Descrição:\n${desc}` : "Sem descrição.",
  ]
    .filter(Boolean)
    .join("\n");
}

function parsePcVerdict(text: string | undefined): PcVerdict {
  const j = JSON.parse(text ?? "") as Partial<PcVerdict>;
  if (typeof j.is_pc !== "boolean" || typeof j.working !== "boolean" || !Array.isArray(j.parts) || typeof j.reason !== "string") {
    throw new Error(`unexpected AI output: ${text?.slice(0, 200)}`);
  }
  const types: readonly string[] = PC_PART_TYPES;
  return {
    is_pc: j.is_pc,
    working: j.working,
    scam: j.scam === true,
    parts: j.parts
      .filter((p) => p && types.includes(p.type) && typeof p.model === "string" && p.model.trim())
      .map((p) => ({ type: p.type, model: p.model.trim().slice(0, 60), value: typeof p.value === "number" && p.value > 0 && p.value < 5000 ? Math.round(p.value) : null }))
      .slice(0, 12),
    red_flags: flagsOf(j.red_flags),
    reason: j.reason.trim().slice(0, 200),
  };
}

/** One retry after a timeout: PC answers usually take 1–2 s, but 12 of 39 hit 8 s in one burst (2026-09-24) and the parser alone undervalues. */
export async function askPcParts(input: PcAiInput): Promise<PcAiResult> {
  const ask = () => generate(input.settings, pcUserPrompt(input), pcSystemPrompt(input.settings), PC_SCHEMA, parsePcVerdict, PC_TIMEOUT_MS);
  const first = await ask();
  return first.status === "timeout" ? ask() : first;
}
