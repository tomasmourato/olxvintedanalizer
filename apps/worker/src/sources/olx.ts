// OLX: CloudFront rejects non-browser clients, so requests run inside a real (headless) Edge page.
import { fileURLToPath } from "node:url";
import { chromium, type BrowserContext, type Page } from "playwright";
import { stripHtml } from "../pipeline/text.js";
import { BlockedError, type FetchResult, type ScrapedListing } from "./types.js";

const HOME = "https://www.olx.pt/";
const PROFILE_DIR = fileURLToPath(new URL("../../.browser-profile/olx", import.meta.url));
const PAGE_LIMIT = 50;
const RELOAD_EVERY_MS = 2 * 60 * 60 * 1000; // refresh cookies every 2 h

type Offer = {
  id: number;
  url: string;
  title: string;
  description?: string;
  created_time?: string;
  last_refresh_time?: string;
  promotion?: { top_ad?: boolean };
  params?: { key: string; value: { value?: number | null; label?: string } }[];
  business?: boolean;
  user?: { id: number };
  location?: { city?: { name: string }; region?: { name: string } };
  photos?: { link: string }[];
  category?: { id: number };
};

const param = (o: Offer, key: string) => o.params?.find((p) => p.key === key)?.value;

export function parseOffers(json: { data: Offer[] }): ScrapedListing[] {
  return json.data.map((o) => {
    const price = param(o, "price")?.value;
    const loc = [o.location?.city?.name, o.location?.region?.name].filter(Boolean).join(", ");
    return {
      source: "olx",
      external_id: String(o.id),
      title: o.title,
      description: o.description ? stripHtml(o.description) : null,
      price: typeof price === "number" ? price : null,
      url: o.url,
      photo_url: o.photos?.[0]?.link.replace("{width}", "400").replace("{height}", "300") ?? null,
      location: loc || null,
      country: "PT",
      seller_id: o.user ? String(o.user.id) : null,
      seller_business: o.business ?? null,
      category_id: o.category?.id ?? null,
      brand: param(o, "marca")?.label ?? null,
      condition: param(o, "state")?.label ?? null,
      posted_at: o.created_time ?? null,
      refreshed_at: o.last_refresh_time ?? null,
      promoted: o.promotion?.top_ad ?? false,
    };
  });
}

let ctx: BrowserContext | null = null;
let page: Page | null = null;
let loadedAt = 0;

async function ready(): Promise<Page> {
  if (page && Date.now() - loadedAt < RELOAD_EVERY_MS) return page;
  if (!ctx) {
    ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
      channel: "msedge",
      headless: true,
      locale: "pt-PT",
      timezoneId: "Europe/Lisbon",
    });
    page = ctx.pages()[0] ?? (await ctx.newPage());
  }
  await page!.goto(HOME, { waitUntil: "domcontentloaded", timeout: 30_000 });
  loadedAt = Date.now();
  return page!;
}

/** Forces a fresh browser on the next request (after repeated failures). */
export async function resetOlx(): Promise<void> {
  const old = ctx;
  ctx = null;
  page = null;
  loadedAt = 0;
  await old?.close().catch(() => {});
}

async function offers(query: Record<string, string | number>): Promise<FetchResult> {
  const qs = new URLSearchParams({ offset: "0", limit: String(PAGE_LIMIT), sort_by: "created_at:desc" });
  for (const [k, v] of Object.entries(query)) qs.set(k, String(v));
  const p = await ready();
  const t = Date.now();
  const r = await p.evaluate(async (path) => {
    const res = await fetch(path, { headers: { accept: "application/json" } });
    return { status: res.status, body: await res.text() };
  }, `/api/v1/offers/?${qs}`);
  const ms = Date.now() - t;
  if (r.status === 403 || r.status === 429) {
    loadedAt = 0; // reload the homepage (new cookies) before the next attempt
    throw new BlockedError(r.status);
  }
  if (r.status !== 200) return { status: r.status, ms, items: [], error: `HTTP ${r.status}` };
  return { status: 200, ms, items: parseOffers(JSON.parse(r.body)) };
}

export const fetchCategory = (categoryId: number) => offers({ category_id: categoryId });
export const searchOlx = (term: string) => offers({ query: term });

export async function closeOlx(): Promise<void> {
  await resetOlx();
}
