// Vinted: the catalog page is server-rendered (Next.js flight data); the old JSON API is gone.
import { sleep } from "../util.js";
import { BlockedError, type FetchResult, type ScrapedListing } from "./types.js";

const BASE = "https://www.vinted.pt";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 Edg/128.0";
const HEADERS = { "user-agent": UA, "accept-language": "pt-PT,pt;q=0.9" };
const TIMEOUT_MS = 20_000;

/** Concatenate the `self.__next_f.push([1,"…"])` chunks into the flight payload. */
export function flight(html: string): string {
  let s = "";
  for (const m of html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)) s += JSON.parse(m[1]);
  return s;
}

/** The balanced `{…}` or `[…]` starting at `start`, skipping brackets inside strings. */
function balancedAt(s: string, start: number): string {
  let depth = 0;
  let inStr = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (c === "\\") i++;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{" || c === "[") depth++;
    else if ((c === "}" || c === "]") && --depth === 0) return s.slice(start, i + 1);
  }
  throw new Error("unbalanced JSON in flight data");
}

type ProductItem = {
  id: number;
  title: string;
  url: string;
  price?: { amount: string };
  totalItemPrice?: { amount: string };
  thumbnailUrl?: string;
  user?: { id: number; isBusiness?: boolean };
  itemBox?: { firstLine?: string; secondLine?: string };
};

const text = (s: string | undefined) => (s && s !== "$undefined" ? s : null);

export function parseCatalog(html: string, catalogId: number | null = null): ScrapedListing[] {
  const f = flight(html);
  const key = '"productItem":';
  const out = new Map<string, ScrapedListing>();
  for (let i = f.indexOf(key); i >= 0; i = f.indexOf(key, i + key.length)) {
    const p = JSON.parse(balancedAt(f, i + key.length)) as ProductItem;
    const amount = p.totalItemPrice?.amount ?? p.price?.amount;
    out.set(String(p.id), {
      source: "vinted",
      external_id: String(p.id),
      title: p.title,
      // Price the buyer pays (item + buyer protection), shipping excluded.
      price: amount ? Number(amount) : null,
      url: p.url.startsWith("http") ? p.url : BASE + p.url,
      photo_url: p.thumbnailUrl ?? null,
      seller_id: p.user ? String(p.user.id) : null,
      seller_business: p.user?.isBusiness ?? null,
      brand: text(p.itemBox?.firstLine),
      condition: text(p.itemBox?.secondLine),
      category_id: catalogId,
    });
  }
  return [...out.values()];
}

async function getHtml(url: string): Promise<{ status: number; html: string; ms: number }> {
  const t = Date.now();
  const r = await fetch(url, { headers: { ...HEADERS, accept: "text/html" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const html = await r.text();
  return { status: r.status, html, ms: Date.now() - t };
}

async function catalogRequest(params: URLSearchParams, catalogIds: number[]): Promise<FetchResult> {
  params.set("order", "newest_first");
  for (const id of catalogIds) params.append("catalog[]", String(id));
  const { status, html, ms } = await getHtml(`${BASE}/catalog?${params}`);
  if (status === 403 || status === 429) throw new BlockedError(status);
  if (status !== 200) return { status, ms, items: [], error: `HTTP ${status}` };
  // The item's own catalog is not in the list payload; only known when a single catalog was asked for.
  return { status, ms, items: parseCatalog(html, catalogIds.length === 1 ? catalogIds[0] : null) };
}

export function fetchCatalogs(catalogIds: number[]): Promise<FetchResult> {
  return catalogRequest(new URLSearchParams(), catalogIds);
}

export function searchVinted(term: string, catalogIds: number[] = []): Promise<FetchResult> {
  return catalogRequest(new URLSearchParams({ search_text: term }), catalogIds);
}


// Enrichment for matched listings only: seller country (users API) and item page (catalog + description).
// The users API answers 429 after a handful of quick calls, so these requests are spaced and retried.
const ENRICH_GAP_MS = 1_500;
let lastEnrich = 0;
let cookie: string | null = null;
const countryBySeller = new Map<string, string | null>();

async function spaced(url: string, headers: Record<string, string>): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    await sleep(lastEnrich + ENRICH_GAP_MS - Date.now());
    lastEnrich = Date.now();
    const r = await fetch(url, { headers: { ...HEADERS, ...headers }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (r.status !== 429 || attempt === 2) return r;
    await r.arrayBuffer();
    await sleep(10_000 * (attempt + 1));
  }
}

async function sessionCookie(): Promise<string> {
  if (cookie) return cookie;
  const r = await spaced(BASE + "/", { accept: "text/html" });
  await r.arrayBuffer();
  cookie = r.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .filter((kv) => kv.includes("=") && !kv.endsWith("="))
    .join("; ");
  return cookie;
}

export type Enrichment<T> = { value: T; status: number; ms: number; cached: boolean };

export async function sellerCountry(sellerId: string): Promise<Enrichment<string | null>> {
  if (countryBySeller.has(sellerId)) return { value: countryBySeller.get(sellerId)!, status: 200, ms: 0, cached: true };
  const t = Date.now();
  let r = await spaced(`${BASE}/api/v2/users/${sellerId}`, { accept: "application/json", cookie: await sessionCookie() });
  if (r.status === 401) {
    cookie = null; // expired anonymous session
    r = await spaced(`${BASE}/api/v2/users/${sellerId}`, { accept: "application/json", cookie: await sessionCookie() });
  }
  if (r.status === 403 || r.status === 429) throw new BlockedError(r.status);
  if (r.status !== 200) return { value: null, status: r.status, ms: Date.now() - t, cached: false };
  const j = (await r.json()) as { user?: { country_iso_code?: string; country_code?: string } };
  const country = (j.user?.country_iso_code ?? j.user?.country_code ?? null)?.toUpperCase() ?? null;
  countryBySeller.set(sellerId, country);
  return { value: country, status: 200, ms: Date.now() - t, cached: false };
}

export type ItemDetails = { catalogId: number | null; catalogPath: number[]; description: string | null };

export function parseItemPage(html: string): ItemDetails {
  const f = flight(html);
  const desc = f.match(/"description":("(?:[^"\\]|\\.)*")/);
  const b = f.indexOf('"breadcrumbs":[');
  const crumbs = b >= 0 ? (JSON.parse(balancedAt(f, b + '"breadcrumbs":'.length)) as { url?: string }[]) : [];
  const catalogPath = [...new Set(crumbs.flatMap((c) => c.url?.match(/\/catalog\/(\d+)/)?.[1] ?? []).map(Number))];
  const leaf = f.match(/"catalog_id":"(\d+)"/)?.[1];
  return {
    catalogId: leaf ? Number(leaf) : (catalogPath.at(-1) ?? null),
    catalogPath,
    description: desc ? (JSON.parse(desc[1]) as string) : null,
  };
}

export async function itemDetails(url: string): Promise<Enrichment<ItemDetails | null>> {
  const t = Date.now();
  const r = await spaced(url, { accept: "text/html" });
  if (r.status === 403 || r.status === 429) throw new BlockedError(r.status);
  if (r.status !== 200) return { value: null, status: r.status, ms: Date.now() - t, cached: false };
  return { value: parseItemPage(await r.text()), status: 200, ms: Date.now() - t, cached: false };
}

/**
 * Sold or hidden: the item page shows a status ("Vendido", "Oculto") in place of the buy buttons.
 * A reserved item also shows one ("Reservado") but can come back, so it still counts as online.
 */
export function itemClosed(html: string): boolean {
  const f = flight(html);
  return f.includes('"name":"buyer_item_status"') && !f.includes('"is_reserved":true');
}

/** For "Verificar anúncios": true once the item is deleted (404/410), sold or hidden; null when the page could not be read. */
export async function itemGone(url: string): Promise<boolean | null> {
  const r = await spaced(url, { accept: "text/html" });
  if (r.status === 403 || r.status === 429) throw new BlockedError(r.status);
  if (r.status !== 200) {
    await r.arrayBuffer();
    return r.status === 404 || r.status === 410 ? true : null;
  }
  return itemClosed(await r.text());
}
