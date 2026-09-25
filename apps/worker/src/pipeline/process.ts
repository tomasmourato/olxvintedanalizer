// New/changed listings → match against watches → (Vinted) enrich → evaluate → matches table → push.
// A listing no watch matched but whose title names a part type without the model goes through identify():
// the AI looks for the model in the description; without it, the listing goes to "Por identificar".
import type { Insert, PcPart, PushPayload, Source, Update, Watch } from "@dh/shared";
import { getSettings, getWatches } from "../config.js";
import { db } from "../db.js";
import { BlockedError, type ScrapedListing } from "../sources/types.js";
import { itemDetails, sellerCountry, type Enrichment } from "../sources/vinted.js";
import { sendPush } from "../push.js";
import { logRun } from "../status.js";
import { errorText, flags, log } from "../util.js";
import { askModel } from "./ai.js";
import { evaluate } from "./evaluate.js";
import { matchWatches, unnamedWatches, watchType } from "./match.js";
import { hasModelNumber, unnamedTypes } from "./parts.js";
import { aiParts } from "./pc.js";
import { dealPayload } from "./payload.js";
import { storeBatch, updateListing, type PriceDrop, type Stored } from "./store.js";

export type BatchResult = { fresh: number; matches: number };

export async function processBatch(source: Source, items: ScrapedListing[], silent: boolean): Promise<BatchResult> {
  const detectedAt = Date.now();
  const { fresh, drops } = await storeBatch(items);
  let matches = 0;

  for (const entry of [...fresh, ...drops] as (Stored | PriceDrop)[]) {
    let matched = matchWatches(entry.listing, getWatches(), getSettings());
    let model: string | null = null;
    if (!matched.length && !silent) ({ matched, model } = await identify(source, entry));
    else if (matched.length && source === "vinted") matched = await enrichVinted(entry, matched);
    const previousPrice = "from" in entry ? entry.from : null;
    // The model read from the description goes in the title the evaluation, the app and the push see.
    const l = model ? { ...entry.listing, title: `${entry.listing.title} (${model})` } : entry.listing;
    let pushed = false; // one push per listing, even when several watches rate it top

    for (const watch of matched) {
      const e = await evaluate({
        listing: l,
        listingId: entry.id,
        watch,
        settings: getSettings(),
        silent,
        previousPrice,
        describe: source === "vinted" ? () => describeVinted(entry) : undefined,
      });
      if (e.discard) {
        log(`${silent ? "[silencioso] " : ""}PC não guardado (${e.discard}): ${source} "${l.title}" ${l.price ?? "?"} € → ${watch.name}`);
        continue;
      }
      if (model) e.row.reason = `modelo lido na descrição; ${e.row.reason ?? ""}`;
      const { id: matchId, dismissed } = await saveMatch(e.row);
      matches++;
      if (e.unidentified) await saveUnidentified(entry.id, watch.id, "pc", e.unidentified);
      const drop = previousPrice != null ? ` (baixou de ${previousPrice} €)` : "";
      const ai = e.ai ? ` [IA ${e.ai.status}${e.ai.status === "ok" ? "" : `: ${e.ai.error}`}, ${e.ai.ms} ms]` : "";
      const pc = e.row.parts ? ` [peças ${e.row.parts_value ?? "?"} €: ${(e.row.parts as PcPart[]).map((p) => `${p.label} ${p.value ?? "?"}`).join(", ")}]` : "";
      log(
        `${silent ? "[silencioso] " : ""}match ${source} "${l.title}" ${l.price ?? "?"} €${drop} → ${watch.name}: ` +
          `${e.row.score} ${e.tier}${ai}${pc} — ${e.row.reason}`,
      );
      if (e.held || dismissed) {
        if (e.tier === "imperdivel") log(`sem push (${e.held ?? "apagado na app"}): ${l.title}`);
      } else if (!pushed) {
        pushed = true;
        await notify(matchId, dealPayload(l, entry.id, watch.name, e.row, previousPrice), previousPrice != null, detectedAt);
      }
    }
  }
  return { fresh: fresh.length, matches };
}

const OF_TYPE: Record<string, string> = {
  gpu: "da gráfica",
  cpu: "do processador",
  ram: "da memória",
  storage: "do disco",
  psu: "da fonte",
  motherboard: "da motherboard",
};

/**
 * No watch matched, but the title names a part type without a model ("Placa gráfica 8GB") and a watch of that
 * type could want it at this price: the AI reads the description for the model. Found → matched again with the
 * model (a model nobody watches is dropped); not found, or no AI → "Por identificar".
 */
async function identify(source: Source, entry: Stored): Promise<{ matched: Watch[]; model: string | null }> {
  const none = { matched: [], model: null };
  const l = entry.listing;
  const types = unnamedTypes(l.title);
  const fit = (x: ScrapedListing, ws: Watch[]) => unnamedWatches(x, types, ws, getSettings());
  let watches = fit(l, getWatches());
  if (watches.length && source === "vinted") watches = await enrichVinted(entry, watches, fit, true);
  if (!watches.length) return none;

  const wanted = [...new Set(watches.map((w) => watchType(w)!))];
  const ai = await askModel({ listing: l, types: wanted, settings: getSettings() });
  const said = ai.status === "ok" ? ai.verdict : "";
  // A model the parser knows ("RTX 3060", "16GB DDR4") is matched again; another model ("GT 710") is not wanted.
  const model = said && wanted.some((type) => aiParts([{ type, model: said, value: null }])[0].key) ? said : null;
  if (!model && hasModelNumber(said)) {
    log(`identificado pela descrição: "${l.title}" → ${said} (nenhuma pesquisa quer este modelo)`);
    return none;
  }
  if (model) {
    const matched = matchWatches({ ...l, title: `${l.title} ${model}` }, getWatches(), getSettings());
    log(`identificado pela descrição: "${l.title}" → ${model} → ${matched.map((w) => w.name).join(", ") || "nenhuma pesquisa quer este modelo"}`);
    return { matched, model };
  }
  const of = OF_TYPE[wanted[0]] ?? "";
  const reason = ai.status === "ok" ? `nem o título nem a descrição dizem o modelo ${of}` : `IA indisponível (${ai.error}); o título não diz o modelo ${of}`;
  log(`por identificar: "${l.title}" ${l.price ?? "?"} € → ${watches[0].name} (${reason})`);
  await saveUnidentified(entry.id, watches[0].id, "part", reason);
  return none;
}

/**
 * Vinted's list payload has neither the seller's country nor the item's catalog. Fetch them for
 * matched listings only, then match again: cross-border sellers and wrong catalogs drop out here.
 * `match` is how to match again; `describe` fetches the item page even without catalogs (for its description).
 */
async function enrichVinted(
  entry: Stored,
  matched: Watch[],
  match = (l: ScrapedListing, ws: Watch[]) => matchWatches(l, ws, getSettings()),
  describe = false,
): Promise<Watch[]> {
  const l = entry.listing;
  const patch: Update<"listings"> = {};
  if (!l.country && l.seller_id) {
    const country = await enrich(`user ${l.seller_id}`, () => sellerCountry(l.seller_id!));
    if (country) l.country = patch.country = country;
  }
  const needsCatalog = (describe || matched.some((w) => w.vinted_catalog_ids.length)) && !l.category_path;
  if (Object.keys(patch).length) await updateListing(entry.id, patch);
  if (needsCatalog && match(l, matched).length) await describeVinted(entry);
  return match(l, matched);
}

/** Item page: catalog chain + description. Fetched at most once per listing. */
async function describeVinted(entry: Stored): Promise<void> {
  const l = entry.listing;
  if (l.category_path) return;
  l.category_path = []; // marks the attempt, even if it fails
  const d = await enrich(`item ${l.external_id}`, () => itemDetails(l.url));
  if (!d) return;
  l.category_path = d.catalogPath;
  l.category_id = d.catalogId;
  l.description = d.description;
  await updateListing(entry.id, { category_id: d.catalogId, description: d.description });
}

/** Runs one enrichment request and logs it; failures return null (the listing keeps its match). */
async function enrich<T>(scope: string, fn: () => Promise<Enrichment<T>>): Promise<T | null> {
  const started_at = new Date().toISOString();
  const base = { source: "vinted" as const, kind: "enrich" as const, scope, started_at };
  try {
    const r = await fn();
    if (!r.cached) {
      logRun({ ...base, status: r.status === 200 ? "ok" : "error", http_status: r.status, duration_ms: r.ms, items_read: r.value ? 1 : 0 });
    }
    return r.value;
  } catch (e) {
    const blocked = e instanceof BlockedError;
    logRun({ ...base, status: blocked ? "blocked" : "error", http_status: blocked ? e.status : null, error: errorText(e) });
    return null;
  }
}

/** Upserts the evaluation; dismissed_at is not in the row, so a deal deleted in the app stays deleted. */
async function saveMatch(row: Insert<"matches">): Promise<{ id: number | null; dismissed: boolean }> {
  if (flags.dryRun) return { id: null, dismissed: false };
  const { data, error } = await db.from("matches").upsert(row, { onConflict: "listing_id,watch_id" }).select("id, dismissed_at").single();
  if (error) throw new Error(`matches upsert: ${error.message}`);
  return { id: data.id, dismissed: data.dismissed_at != null };
}

/** Adds the listing to "Por identificar" (a listing already marked seen stays seen). */
async function saveUnidentified(listingId: number, watchId: string, kind: "pc" | "part", reason: string): Promise<void> {
  if (flags.dryRun) return;
  const { error } = await db.from("unidentified").upsert({ listing_id: listingId, watch_id: watchId, kind, reason }, { onConflict: "listing_id,watch_id" });
  if (error) log("unidentified upsert failed:", error.message);
}

async function notify(matchId: number | null, payload: PushPayload, drop: boolean, detectedAt: number): Promise<void> {
  if (!getSettings().push_enabled) return log(`push desligado nas Definições: ${payload.title}`);
  const r = await sendPush(drop ? "price_drop" : "deal", payload, { matchId, startedAt: detectedAt });
  log(`PUSH ${r.ok} ok, ${r.failed} falharam${r.error ? ` (${r.error})` : ""}, ${Date.now() - detectedAt} ms: ${payload.title}`);
  if (r.ok && matchId != null) {
    const { error } = await db.from("matches").update({ notified: true }).eq("id", matchId);
    if (error) log("matches notified update failed:", error.message);
  }
}
