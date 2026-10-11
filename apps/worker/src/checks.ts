// "Verificar anúncios" (Negócios): the app inserts a listing_checks row; this checks every listing Negócios shows
// (deals not deleted from the last 30 days, and Por identificar not yet seen) on OLX/Vinted and marks the ones
// sold or removed (listings.gone_at). They leave the lists but still count in the median.
// Vinted also gets this on its own (watchSold): one listing at a time in the background, new ones more often.
import type { Source } from "@dh/shared";
import { getSettings } from "./config.js";
import { db } from "./db.js";
import { nextDue } from "./pipeline/recheck.js";
import { offerGone } from "./sources/olx.js";
import { BlockedError } from "./sources/types.js";
import { itemGone } from "./sources/vinted.js";
import { errorText, isActive, jitter, log, sleep } from "./util.js";

const OLX_GAP_MS = 1_000; // Vinted requests are already spaced (vinted.ts spaced())
const PROGRESS_EVERY = 10;
const CHUNK = 200; // ids per `in (...)` query

const PAGE = 1000; // PostgREST's max rows per request

type Target = { id: number; source: Source; external_id: string; url: string; first_seen_at: string };
type IdPage = PromiseLike<{ data: { listing_id: number }[] | null; error: { message: string } | null }>;

/** All the rows, a page at a time: a single request stops at PAGE rows (Negócios had 3089 matches on 2026-10-11). */
async function listingIds(what: string, page: (from: number, to: number) => IdPage): Promise<number[]> {
  const out: number[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(`${what}: ${error.message}`);
    out.push(...(data ?? []).map((r) => r.listing_id));
    if ((data ?? []).length < PAGE) return out;
  }
}

export async function targets(only?: Source): Promise<Target[]> {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const [m, u] = await Promise.all([
    listingIds("matches", (from, to) =>
      db.from("matches").select("listing_id").is("dismissed_at", null).gte("updated_at", since).order("id").range(from, to),
    ),
    listingIds("unidentified", (from, to) => db.from("unidentified").select("listing_id").is("done_at", null).order("id").range(from, to)),
  ]);
  const ids = [...new Set([...m, ...u])];
  const out: Target[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    let q = db.from("listings").select("id, source, external_id, url, first_seen_at").in("id", ids.slice(i, i + CHUNK)).is("gone_at", null);
    if (only) q = q.eq("source", only);
    const l = await q;
    if (l.error) throw new Error(`listings: ${l.error.message}`);
    out.push(...(l.data as Target[]));
  }
  return out.sort((a, b) => Date.parse(b.first_seen_at) - Date.parse(a.first_seen_at)); // newest first
}

async function update(id: number, patch: { started_at?: string; finished_at?: string; total?: number; checked?: number; gone?: number; error?: string | null }) {
  const { error } = await db.from("listing_checks").update(patch).eq("id", id);
  if (error) log("listing_checks update failed:", error.message);
}

async function run(checkId: number): Promise<void> {
  await update(checkId, { started_at: new Date().toISOString() });
  let checked = 0;
  let gone = 0;
  const errors: string[] = [];
  try {
    const list = await targets();
    await update(checkId, { total: list.length });
    log(`verificar anúncios: ${list.length} a verificar`);

    // One source's block stops that source only; a listing that could not be read counts as still online.
    const bySource = async (source: Source) => {
      for (const t of list.filter((x) => x.source === source)) {
        try {
          const isGone = source === "olx" ? await offerGone(t.external_id) : await itemGone(t.url);
          if (isGone) {
            const { error } = await db.from("listings").update({ gone_at: new Date().toISOString() }).eq("id", t.id);
            if (error) throw new Error(`listings update: ${error.message}`);
            gone++;
          }
        } catch (e) {
          if (e instanceof BlockedError) {
            errors.push(`o ${source === "olx" ? "OLX" : "Vinted"} bloqueou os pedidos (HTTP ${e.status}); tenta mais tarde`);
            return;
          }
          log(`verificar anúncios: ${source} ${t.external_id} — ${errorText(e)}`);
        }
        if (++checked % PROGRESS_EVERY === 0) await update(checkId, { checked, gone });
        if (source === "olx") await sleep(jitter(OLX_GAP_MS));
      }
    };
    await Promise.all([bySource("olx"), bySource("vinted")]);
  } catch (e) {
    errors.push(errorText(e));
  }
  await update(checkId, { checked, gone, finished_at: new Date().toISOString(), error: errors.join("; ") || null });
  log(`verificar anúncios: ${checked} verificados, ${gone} já não existem${errors.length ? ` (${errors.join("; ")})` : ""}`);
}

let running = false;

/** Runs the newest pending request; older pending ones are closed with it (the app only shows the newest). */
async function next(): Promise<void> {
  if (running) return;
  running = true;
  try {
    for (;;) {
      const { data, error } = await db.from("listing_checks").select("id").is("started_at", null).order("requested_at", { ascending: false });
      if (error) return log("listing_checks select failed:", error.message);
      if (!data.length) return;
      const [newest, ...older] = data.map((r) => r.id);
      if (older.length) {
        const now = new Date().toISOString();
        await db.from("listing_checks").update({ started_at: now, finished_at: now, error: "substituído por um pedido mais recente" }).in("id", older);
      }
      await run(newest);
    }
  } finally {
    running = false;
  }
}

const SWEEP_GAP_MS = 8_000; // between listings; vinted.ts spaced() already keeps 1.5 s from the enrichment requests
const SWEEP_LIST_MS = 5 * 60_000; // how often the list of listings to watch is reloaded
const SWEEP_BLOCK_PAUSE_MS = 30 * 60_000;
const SWEEP_ROW_MS = 15 * 60_000; // finds this close together share one listing_checks row

/**
 * Takes the Vinted listings Negócios shows out of the lists once they are sold or removed, without the button:
 * one item page at a time, in the active hours, new listings every 30 min and old ones every few hours.
 * The app reloads on listing_checks changes, so each batch of finds is written as a (finished) listing_checks row.
 */
function watchSold(): () => void {
  let stopped = false;
  let list: Target[] = [];
  let listAt = 0;
  let pausedUntil = 0;
  let row: { id: number; at: number; checked: number; gone: number } | null = null;
  let unreported = 0; // checked since the last row was written
  const lastChecked = new Map<number, number>();

  async function report(): Promise<void> {
    // A newer row would hide the manual check's progress in the app (it shows the newest row); that check reloads it anyway.
    if (running) return;
    const now = Date.now();
    const at = new Date(now).toISOString();
    if (row && now - row.at < SWEEP_ROW_MS) {
      row.checked += unreported;
      row.gone++;
      await update(row.id, { checked: row.checked, gone: row.gone, finished_at: at });
    } else {
      const { data, error } = await db.from("listing_checks").insert({ started_at: at, finished_at: at, checked: unreported, gone: 1 }).select("id").single();
      if (error) return log("verificar anúncios (automático): listing_checks insert failed:", error.message);
      row = { id: data.id, at: now, checked: unreported, gone: 1 };
    }
    unreported = 0;
  }

  async function step(): Promise<number> {
    const s = getSettings();
    if (!isActive(s.active_from, s.active_to, s.timezone) || running || Date.now() < pausedUntil) return 30_000;
    if (Date.now() - listAt > SWEEP_LIST_MS) {
      list = await targets("vinted");
      listAt = Date.now();
      const ids = new Set(list.map((t) => t.id));
      for (const id of lastChecked.keys()) if (!ids.has(id)) lastChecked.delete(id);
    }
    const t = nextDue(list, lastChecked, Date.now());
    if (!t) return 30_000;
    lastChecked.set(t.id, Date.now());
    unreported++;
    if (await itemGone(t.url)) {
      const { error } = await db.from("listings").update({ gone_at: new Date().toISOString() }).eq("id", t.id);
      if (error) throw new Error(`listings update: ${error.message}`);
      list = list.filter((x) => x.id !== t.id);
      log(`verificar anúncios (automático): vinted ${t.external_id} já não existe`);
      await report();
    }
    return jitter(SWEEP_GAP_MS);
  }

  void (async () => {
    await sleep(60_000); // let the first catalog reads and the enrichment go first
    while (!stopped) {
      try {
        await sleep(await step());
      } catch (e) {
        if (e instanceof BlockedError) {
          pausedUntil = Date.now() + jitter(SWEEP_BLOCK_PAUSE_MS, 0.25);
          log(`verificar anúncios (automático): a Vinted bloqueou (HTTP ${e.status}); em pausa até ${new Date(pausedUntil).toISOString()}`);
        } else {
          log(`verificar anúncios (automático): ${errorText(e)}`);
        }
        await sleep(30_000);
      }
    }
  })();
  return () => {
    stopped = true;
  };
}

/** Listens for new requests (Realtime), plus every 2 min in case an event is missed. Also starts the automatic sweep. */
export function watchChecks(): () => void {
  const stopSold = watchSold();
  // A check cut short by a restart would show "A verificar…" forever.
  void db
    .from("listing_checks")
    .update({ finished_at: new Date().toISOString(), error: "o worker reiniciou a meio; verifica outra vez" })
    .not("started_at", "is", null)
    .is("finished_at", null)
    .then(({ error }) => error && log("listing_checks cleanup failed:", error.message))
    .then(() => next());
  const channel = db
    .channel("checks")
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "listing_checks" }, () => void next())
    .subscribe();
  const poll = setInterval(() => void next(), 2 * 60_000);
  return () => {
    stopSold();
    clearInterval(poll);
    void db.removeChannel(channel);
  };
}
