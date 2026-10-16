// Auto-compra Vinted (opt-in, só peças). FASE 1: só simula — nunca compra (AUTO_BUY_LIVE = false);
// grava em `purchases` o que compraria, para o amigo validar as decisões antes de qualquer euro sair.
//
// `autoBuyEligible` é pura e testável (test/buy.test.ts): decide se um match se qualifica para auto-compra,
// sem tocar na base de dados nem no kill switch (esse só decide comprar a sério, na Fase 2). `maybeBuy` acrescenta
// a desduplicação, o limite diário e o registo. A compra real (sources/vintedBuy.ts) e a ligação da conta Vinted
// chegam na Fase 2 — ver o plano em /root/.claude/plans.
import { fmtEuros, singlePart, type Insert, type Part, type PartType, type Settings, type Watch } from "@dh/shared";
import type { ScrapedListing } from "../sources/types.js";
import { flags, log } from "../util.js";
import type { Evaluation } from "./evaluate.js";
import type { AiResult, PcAiResult } from "./ai.js";

/** FASE 1: a false, o worker nunca compra — só simula e regista. A Fase 2 liga isto (compra real, atrás do kill switch). */
const AUTO_BUY_LIVE = false;

/** Peças que a auto-compra aceita: as revendíveis onde o parser erra menos. Caixas e coolers ficam de fora. */
export const AUTO_BUY_TYPES = new Set<PartType>(["gpu", "cpu", "ram", "storage", "motherboard", "psu"]);

export type AutoBuyInput = {
  listing: Pick<ScrapedListing, "source" | "title" | "price" | "country">;
  evaluation: {
    tier: Evaluation["tier"];
    held: Evaluation["held"];
    ai: AiResult | PcAiResult | null;
    row: Pick<Insert<"matches">, "red_flags">;
  };
  watch: Pick<Watch, "id" | "kind" | "auto_buy" | "auto_buy_max">;
  settings: Pick<Settings, "candidate_threshold" | "auto_buy_max_default" | "vinted_countries">;
  silent: boolean;
  dismissed: boolean;
  /** Outra pesquisa já tratou (ou comprou) este anúncio nesta iteração: não comprar duas vezes o mesmo item. */
  alreadyActioned: boolean;
};

export type Eligibility = { ok: true; part: Part; ceiling: number } | { ok: false; reason: string };

/** The one part a verdict is "condition positive" on: AI ran, approved (>= candidate), and flagged nothing. */
function aiApproved(ai: AiResult | PcAiResult | null, candidateThreshold: number): string | null {
  if (!ai || ai.status !== "ok") return "sem veredito da IA";
  // Part watches get an AiVerdict (has `score`); a PcVerdict (no `score`) never auto-buys (só peças).
  if (!("score" in ai.verdict)) return "veredito de PC, não de peça";
  if (ai.verdict.score < candidateThreshold) return "a IA não aprovou";
  return null;
}

/**
 * Would this (listing, watch) be auto-bought? Every gate must pass. Pure: no DB, no kill switch
 * (that only gates the real buy). The caller still checks dedup and the daily cap before acting.
 */
export function autoBuyEligible(input: AutoBuyInput): Eligibility {
  const { listing: l, evaluation: e, watch: w, settings: s, silent, dismissed, alreadyActioned } = input;
  if (l.source !== "vinted") return { ok: false, reason: "não é Vinted" };
  if (w.kind === "pc") return { ok: false, reason: "só peças (PCs completos não têm auto-compra)" };
  if (!w.auto_buy) return { ok: false, reason: "auto-compra desligada na pesquisa" };
  if (silent) return { ok: false, reason: "primeira leitura (silenciosa)" };
  if (dismissed) return { ok: false, reason: "apagado na app" };
  if (alreadyActioned) return { ok: false, reason: "já tratado por outra pesquisa" };
  if (e.held) return { ok: false, reason: e.held };
  if (e.tier !== "imperdivel") return { ok: false, reason: "abaixo de imperdível" };

  const ceiling = w.auto_buy_max ?? s.auto_buy_max_default;
  if (ceiling == null) return { ok: false, reason: "sem teto de auto-compra" };
  if (l.price == null || l.price <= 0) return { ok: false, reason: "sem preço" };
  // FASE 1: portes à parte; a Fase 2 compara o total real (com portes) do checkout.
  if (l.price > ceiling) return { ok: false, reason: `acima do teto (${fmtEuros(ceiling)})` };

  const part = singlePart(l.title);
  if (!part || !part.key) return { ok: false, reason: "não é uma peça única" };
  if (!AUTO_BUY_TYPES.has(part.type)) return { ok: false, reason: `peça não elegível (${part.type})` };

  const aiReason = aiApproved(e.ai, s.candidate_threshold);
  if (aiReason) return { ok: false, reason: aiReason };
  if ((e.row.red_flags ?? []).length) return { ok: false, reason: "tem sinais de alerta" };

  // País do vendedor: tem de ser conhecido e dos países aceites (Definições). Vazio = qualquer país.
  if (!l.country) return { ok: false, reason: "país do vendedor desconhecido" };
  if (s.vinted_countries.length && !s.vinted_countries.includes(l.country)) {
    return { ok: false, reason: `país não aceite (${l.country})` };
  }

  return { ok: true, part, ceiling };
}

/** ISO instant of the last midnight in `tz` (for the "today" window of the daily cap). */
export function startOfDayIso(tz: string, now = Date.now()): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "longOffset" }).formatToParts(new Date(now));
  const name = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT+00:00";
  const m = /GMT([+-]\d{2}):?(\d{2})/.exec(name);
  const offsetMin = m ? Number(m[1]) * 60 + Math.sign(Number(m[1])) * Number(m[2]) : 0;
  const local = new Date(now + offsetMin * 60_000);
  const midnightLocalUtc = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  return new Date(midnightLocalUtc - offsetMin * 60_000).toISOString();
}

const SPENT_STATUS = ["dry_run", "pending", "bought", "sca_required"] as const;

/** Sum of what today's auto-buys would cost (or did), to compare against the daily cap. */
async function spentToday(tz: string): Promise<number> {
  const { db } = await import("../db.js");
  const { data, error } = await db
    .from("purchases")
    .select("price, total, status")
    .gte("created_at", startOfDayIso(tz))
    .in("status", SPENT_STATUS as unknown as string[]);
  if (error) {
    log("auto-compra: falha a somar o gasto de hoje:", error.message);
    return 0;
  }
  return data.reduce((sum, r) => sum + Number(r.total ?? r.price ?? 0), 0);
}

export type MaybeBuyContext = {
  matchId: number | null;
  listingId: number;
  settings: Pick<Settings, "auto_buy_enabled" | "auto_buy_daily_cap" | "timezone">;
};

/**
 * Acts on one evaluated match. FASE 1: never buys — logs "AUTO-COMPRA (simulação)" and, unless --dry-run,
 * writes a `purchases` row (dry_run, or skipped when the daily cap is reached). Returns true when it acted on
 * this listing, so the caller stops another watch acting on the same one. The real buy arrives in Fase 2.
 */
export async function maybeBuy(input: AutoBuyInput, ctx: MaybeBuyContext): Promise<boolean> {
  if (!input.watch.auto_buy) return false; // comum: evita trabalho quando a pesquisa não pede auto-compra
  const e = autoBuyEligible(input);
  if (!e.ok) return false;

  const { listing: l } = input;
  const price = l.price!; // garantido por autoBuyEligible
  const live = AUTO_BUY_LIVE && ctx.settings.auto_buy_enabled && !flags.dryRun;
  log(`AUTO-COMPRA (${live ? "REAL" : "simulação"}): "${l.title}" ${fmtEuros(price)} (teto ${fmtEuros(e.ceiling)}, portes à parte)`);

  if (flags.dryRun) return true; // --dry-run: só escreve no log

  const { db } = await import("../db.js"); // carregado tarde: os testes importam este módulo sem .env

  // Desduplicação: uma decisão por (anúncio, pesquisa). Preços que baixam voltam a passar por aqui.
  const existing = await db.from("purchases").select("id").eq("listing_id", ctx.listingId).eq("watch_id", input.watch.id).maybeSingle();
  if (existing.error) {
    log("auto-compra: falha a verificar duplicados:", existing.error.message);
    return true; // não arriscar uma segunda tentativa
  }
  if (existing.data) return true;

  // Limite diário. 0 = não compra (nem simula uma compra): o amigo tem de o definir nas Definições.
  const cap = Number(ctx.settings.auto_buy_daily_cap);
  const overCap = cap <= 0 || (await spentToday(ctx.settings.timezone)) + price > cap;
  const status = live ? (overCap ? "skipped" : "pending") : overCap ? "skipped" : "dry_run";
  const skip_reason = overCap ? (cap <= 0 ? "limite diário a 0 € (define-o nas Definições)" : `excede o limite diário (${fmtEuros(cap)})`) : null;

  const row: Insert<"purchases"> = {
    listing_id: ctx.listingId,
    match_id: ctx.matchId,
    watch_id: input.watch.id,
    source: "vinted",
    price,
    ceiling: e.ceiling,
    status,
    skip_reason,
  };
  const { error } = await db.from("purchases").insert(row);
  if (error) log("auto-compra: falha a registar em purchases:", error.message);

  // FASE 2: aqui, se `live` e não `overCap`, chamaria sources/vintedBuy.ts (pagar pelo saldo da carteira),
  // e actualizaria o status para 'bought' / 'sca_required' / 'failed' com um push do resultado.
  return true;
}
