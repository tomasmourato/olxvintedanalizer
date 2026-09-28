// "Verificar anúncios" (Negócios): the app inserts a listing_checks row; this checks every listing Negócios shows
// (deals not deleted from the last 30 days, and Por identificar not yet seen) on OLX/Vinted and marks the ones
// sold or removed (listings.gone_at). They leave the lists but still count in the median.
import type { Source } from "@dh/shared";
import { db } from "./db.js";
import { offerGone } from "./sources/olx.js";
import { BlockedError } from "./sources/types.js";
import { itemGone } from "./sources/vinted.js";
import { errorText, jitter, log, sleep } from "./util.js";

const OLX_GAP_MS = 1_000; // Vinted requests are already spaced (vinted.ts spaced())
const PROGRESS_EVERY = 10;
const CHUNK = 200; // ids per `in (...)` query

type Target = { id: number; source: Source; external_id: string; url: string };

async function targets(): Promise<Target[]> {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const [m, u] = await Promise.all([
    db.from("matches").select("listing_id").is("dismissed_at", null).gte("updated_at", since),
    db.from("unidentified").select("listing_id").is("done_at", null),
  ]);
  if (m.error) throw new Error(`matches: ${m.error.message}`);
  if (u.error) throw new Error(`unidentified: ${u.error.message}`);
  const ids = [...new Set([...m.data, ...u.data].map((r) => r.listing_id))];
  const out: Target[] = [];
  for (let i = 0; i < ids.length; i += CHUNK) {
    const l = await db.from("listings").select("id, source, external_id, url").in("id", ids.slice(i, i + CHUNK)).is("gone_at", null);
    if (l.error) throw new Error(`listings: ${l.error.message}`);
    out.push(...(l.data as Target[]));
  }
  return out;
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

/** Listens for new requests (Realtime), plus every 2 min in case an event is missed. */
export function watchChecks(): () => void {
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
    clearInterval(poll);
    void db.removeChannel(channel);
  };
}
