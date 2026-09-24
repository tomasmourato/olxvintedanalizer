// Can this machine read OLX and Vinted the way the worker does? One request of each kind, no database, no secrets.
// `npm run probe -w @dh/worker`. The GitHub workflow "Probe" runs it on a datacenter IP (Microsoft's), to see
// whether a cloud server could host the worker instead of a PC at home. Exits 1 when a step fails.
import { closeOlx, fetchCategory } from "./sources/olx.js";
import type { FetchResult } from "./sources/types.js";
import { fetchCatalogs, itemDetails, sellerCountry } from "./sources/vinted.js";
import { errorText } from "./util.js";

let failed = 0;

async function step<T>(name: string, fn: () => Promise<T>, show: (r: T) => string, ok: (r: T) => boolean = () => true): Promise<T | null> {
  try {
    const r = await fn();
    const good = ok(r);
    if (!good) failed++;
    console.log(`${good ? "OK  " : "FAIL"} ${name}: ${show(r)}`);
    return r;
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}: ${errorText(e)}`);
    return null;
  }
}

const listings = (r: FetchResult) => `HTTP ${r.status}, ${r.items.length} anúncios, ${r.ms} ms${r.error ? ` (${r.error})` : ""}`;
const read = (r: FetchResult) => r.status === 200 && r.items.length > 0;

await step(
  "IP",
  async () => (await (await fetch("https://ipinfo.io/json")).json()) as { ip?: string; city?: string; country?: string; org?: string },
  (r) => [r.ip, r.city, r.country, r.org].filter(Boolean).join(", "),
);
await step("OLX Componentes (5371)", () => fetchCategory(5371), listings, read);
await step("OLX Computadores (4731)", () => fetchCategory(4731), listings, read);
await closeOlx();

const vinted = await step("Vinted Placas gráficas (3602)", () => fetchCatalogs([3602]), listings, read);
const item = vinted?.items.find((i) => i.seller_id);
if (item) {
  await step("Vinted vendedor (país)", () => sellerCountry(item.seller_id!), (r) => `HTTP ${r.status}, país ${r.value ?? "?"}, ${r.ms} ms`, (r) => r.status === 200);
  await step(
    "Vinted anúncio (descrição)",
    () => itemDetails(item.url),
    (r) => `HTTP ${r.status}, ${r.value?.description ? "com descrição" : "sem descrição"}, ${r.ms} ms`,
    (r) => r.status === 200,
  );
}

console.log(failed ? `${failed} passo(s) falharam` : "Tudo OK: esta máquina lê o OLX e o Vinted.");
process.exit(failed ? 1 : 0);
