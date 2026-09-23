// Gemini verdict for rule candidates: structured JSON, hard 4 s timeout, per-minute cap for the free tier.
// Any failure falls back to the rules score (the caller marks it "(sem IA)").
import { GoogleGenAI } from "@google/genai";
import type { Settings, Watch } from "@dh/shared";
import type { ScrapedListing } from "../sources/types.js";
import { priceTier, type RuleResult } from "./score.js";

// Flash-Lite answers in ~1 s; gemini-3.8-flash took 4 s+ even with thinking "low" (measured 2026-09-22).
const MODEL = "gemini-3.5-flash-lite";
const TIMEOUT_MS = 4_000;
const MAX_PER_MIN = 10;
const MAX_DESCRIPTION = 1_500;

export type AiVerdict = { score: number; reason: string; red_flags: string[] };
export type AiResult =
  | { status: "ok"; verdict: AiVerdict; ms: number }
  | { status: "timeout" | "error" | "disabled" | "skipped"; error: string; ms: number };

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

function parseVerdict(text: string | undefined): AiVerdict {
  const j = JSON.parse(text ?? "") as Partial<AiVerdict>;
  if (typeof j.score !== "number" || typeof j.reason !== "string" || !Array.isArray(j.red_flags)) {
    throw new Error(`unexpected AI output: ${text?.slice(0, 200)}`);
  }
  return {
    score: Math.round(Math.min(100, Math.max(0, j.score))),
    reason: j.reason.trim().slice(0, 200),
    red_flags: j.red_flags.filter((f): f is string => typeof f === "string" && !!f.trim()).map((f) => f.trim().slice(0, 80)).slice(0, 5),
  };
}

export async function askAi(input: AiInput): Promise<AiResult> {
  const t = Date.now();
  if (!aiAvailable(input.settings)) return { status: "disabled", error: "IA desligada ou sem chave", ms: 0 };
  while (recent.length && t - recent[0] > 60_000) recent.shift();
  if (recent.length >= MAX_PER_MIN) return { status: "skipped", error: `limite de ${MAX_PER_MIN} pedidos/min`, ms: 0 };
  recent.push(t);

  client ??= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  try {
    const res = await client.models.generateContent({
      model: process.env.GEMINI_MODEL || MODEL,
      contents: userPrompt(input),
      config: {
        systemInstruction: systemPrompt(input.settings),
        responseMimeType: "application/json",
        responseJsonSchema: SCHEMA,
        abortSignal: signal,
      },
    });
    return { status: "ok", verdict: parseVerdict(res.text), ms: Date.now() - t };
  } catch (e) {
    const ms = Date.now() - t;
    if (signal.aborted) return { status: "timeout", error: `sem resposta em ${TIMEOUT_MS / 1000} s`, ms };
    return { status: "error", error: e instanceof Error ? e.message.slice(0, 300) : String(e), ms };
  }
}
