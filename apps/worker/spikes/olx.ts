// F0 spike: can a real (headless) Edge fetch the OLX offers API from inside the page?
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";

const OUT = new URL("./out/", import.meta.url);
mkdirSync(OUT, { recursive: true });

const ctx = await chromium.launchPersistentContext(".browser-profile/olx", {
  channel: "msedge",
  headless: true,
  locale: "pt-PT",
  timezoneId: "Europe/Lisbon",
});
const page = ctx.pages()[0] ?? (await ctx.newPage());
const nav = await page.goto("https://www.olx.pt/", { waitUntil: "domcontentloaded" });
console.log("home", nav?.status());

async function api(path: string) {
  const t = Date.now();
  const res = await page.evaluate(async (p) => {
    const r = await fetch(p, { headers: { accept: "application/json" } });
    return { status: r.status, body: await r.text() };
  }, path);
  return { ...res, ms: Date.now() - t };
}

const queries = ["rtx 3060", "ryzen 5 5600", "pc gaming", "ddr4 16gb", "portatil gaming"];
const categories = new Map<number, number>();
for (const q of queries) {
  const r = await api(`/api/v1/offers/?offset=0&limit=40&sort_by=created_at:desc&query=${encodeURIComponent(q)}`);
  let info = "";
  if (r.status === 200) {
    const j = JSON.parse(r.body);
    for (const o of j.data) categories.set(o.category.id, (categories.get(o.category.id) ?? 0) + 1);
    const o = j.data[0];
    info = `n=${j.data.length} first="${o?.title}" created=${o?.created_time} pushup=${o?.pushup_time}`;
    writeFileSync(new URL(`olx-${q.replace(/\W+/g, "_")}.json`, OUT), r.body);
  }
  console.log(q, r.status, `${r.ms}ms`, `${Math.round(r.body.length / 1024)}KB`, info);
  await page.waitForTimeout(3000);
}
console.log("category ids seen (id:count):", [...categories].sort((a, b) => b[1] - a[1]));

// try to resolve category names
for (const p of ["/api/v1/categories/", "/api/v1/offers/metadata/search/?query=rtx%203060"]) {
  const r = await api(p);
  console.log("probe", p, r.status, r.body.slice(0, 300).replace(/\s+/g, " "));
  if (r.status === 200) writeFileSync(new URL(`olx-probe-${p.replace(/\W+/g, "_")}.json`, OUT), r.body);
  await page.waitForTimeout(2000);
}
await ctx.close();
