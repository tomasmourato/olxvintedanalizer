// Dedup + persistence. Memory is only a cache: the unique (source, external_id) index is the truth,
// so restarts never re-announce old listings.
import type { Update } from "@dh/shared";
import { db } from "../db.js";
import type { ScrapedListing } from "../sources/types.js";
import { flags } from "../util.js";

type Known = { id: number; price: number | null };
const MAX_KNOWN = 50_000;
const known = new Map<string, Known>();
let fakeId = 0;

const keyOf = (l: Pick<ScrapedListing, "source" | "external_id">) => `${l.source}:${l.external_id}`;

function remember(key: string, k: Known) {
  known.delete(key);
  known.set(key, k);
  if (known.size > MAX_KNOWN) known.delete(known.keys().next().value!);
}

export type Stored = { listing: ScrapedListing; id: number };
export type PriceDrop = Stored & { from: number };

function toRow({ promoted: _promoted, category_path: _path, ...row }: ScrapedListing) {
  return row;
}

export async function storeBatch(batch: ScrapedListing[]): Promise<{ fresh: Stored[]; drops: PriceDrop[] }> {
  const fresh: Stored[] = [];
  const drops: PriceDrop[] = [];
  const items = [...new Map(batch.map((l) => [keyOf(l), l])).values()];
  if (!items.length) return { fresh, drops };
  const source = items[0].source;
  const unknown = items.filter((l) => !known.has(keyOf(l)));

  if (unknown.length) {
    if (flags.dryRun) {
      for (const l of unknown) {
        remember(keyOf(l), { id: --fakeId, price: l.price });
        fresh.push({ listing: l, id: fakeId });
      }
    } else {
      const ins = await db
        .from("listings")
        .upsert(unknown.map(toRow), { onConflict: "source,external_id", ignoreDuplicates: true })
        .select("id, external_id");
      if (ins.error) throw new Error(`listings insert: ${ins.error.message}`);
      const inserted = new Map(ins.data.map((r) => [r.external_id, r.id]));
      for (const l of unknown) {
        const id = inserted.get(l.external_id);
        if (id != null) {
          remember(keyOf(l), { id, price: l.price });
          fresh.push({ listing: l, id });
        }
      }
      // Already in the DB but not in memory (older than the cache): load them for the price check below.
      const old = unknown.filter((l) => !inserted.has(l.external_id)).map((l) => l.external_id);
      if (old.length) {
        const sel = await db.from("listings").select("id, external_id, price").eq("source", source).in("external_id", old);
        if (sel.error) throw new Error(`listings select: ${sel.error.message}`);
        for (const r of sel.data) remember(`${source}:${r.external_id}`, { id: r.id, price: r.price });
      }
    }
  }

  const freshIds = new Set(fresh.map((f) => f.listing.external_id));
  for (const l of items) {
    if (freshIds.has(l.external_id)) continue;
    const k = known.get(keyOf(l));
    if (!k || l.price == null || l.price === k.price) continue;
    const drop = k.price != null && l.price < k.price;
    if (!flags.dryRun) {
      // A new price means the listing is online again, even if "Verificar anúncios" found it gone.
      const patch = drop
        ? { price: l.price, previous_price: k.price, price_changed_at: new Date().toISOString(), gone_at: null }
        : { price: l.price, gone_at: null };
      const up = await db.from("listings").update(patch).eq("id", k.id);
      if (up.error) throw new Error(`listings update: ${up.error.message}`);
    }
    if (drop) drops.push({ listing: l, id: k.id, from: k.price! });
    remember(keyOf(l), { id: k.id, price: l.price });
  }
  return { fresh, drops };
}

export async function updateListing(listingId: number, patch: Update<"listings">): Promise<void> {
  if (flags.dryRun || listingId < 0) return;
  const { error } = await db.from("listings").update(patch).eq("id", listingId);
  if (error) throw new Error(`listings update: ${error.message}`);
}
