// F0 spike: parse Vinted catalog SSR (Next.js flight data) and measure new-item rate per category.
import { mkdirSync, writeFileSync } from "node:fs";

const OUT = new URL("./out/", import.meta.url);
mkdirSync(OUT, { recursive: true });
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 Edg/128.0";

function flight(html: string): string {
  let s = "";
  for (const m of html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)) s += JSON.parse(m[1]);
  return s;
}

function objectAt(s: string, start: number): string {
  let depth = 0, inStr = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (c === "\\") i++; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return s.slice(start, i + 1);
  }
  throw new Error("unbalanced");
}

function items(f: string) {
  const out: any[] = [];
  const key = '"productItem":';
  for (let i = f.indexOf(key); i >= 0; i = f.indexOf(key, i + 1)) out.push(JSON.parse(objectAt(f, i + key.length)));
  return out;
}

async function catalog(qs: string) {
  const t = Date.now();
  const r = await fetch(`https://www.vinted.pt/catalog?order=newest_first&${qs}`, {
    headers: { "user-agent": UA, accept: "text/html", "accept-language": "pt-PT,pt;q=0.9" },
  });
  const html = await r.text();
  const f = flight(html);
  return { status: r.status, ms: Date.now() - t, html, f, items: r.status === 200 ? items(f) : [] };
}

const sleep = (ms: number) => new Promise((s) => setTimeout(s, ms));

// 1) one fetch: dump fixture + category tree around "Computadores e acessórios" (3564)
const first = await catalog("catalog[]=3602");
console.log("3602", first.status, `${first.ms}ms`, "items", first.items.length, "flightKB", Math.round(first.f.length / 1024));
writeFileSync(new URL("vinted-3602.html", OUT), first.html);
const it = first.items[0];
console.log("item keys:", Object.keys(it).join(","));
console.log("sample:", it.id, it.title, it.price, it.totalItemPrice, it.itemBox?.firstLine, it.itemBox?.secondLine, it.user);
const cats = new Map<number, string>();
for (const m of first.f.matchAll(/\{"id":(\d{4}),"title":"([^"]{2,50})"/g)) {
  const id = Number(m[1]);
  if (id >= 3560 && id <= 3700) cats.set(id, m[2]);
}
console.log("catalogs 3560-3700:", [...cats].map(([k, v]) => `${k}:${v}`).join(" | "));

// 2) rate: re-fetch each category after ~60s and count unseen ids
const CATS = ["3602", "3581", "3580", "3564"];
const seen = new Map<string, Set<number>>();
for (const c of CATS) {
  const r = c === "3602" ? first : await catalog(`catalog[]=${c}`);
  seen.set(c, new Set(r.items.map((x) => x.id)));
  if (c !== "3602") { console.log(c, r.status, `${r.ms}ms`, "items", r.items.length); await sleep(5000); }
}
for (let round = 1; round <= 3; round++) {
  await sleep(60_000);
  for (const c of CATS) {
    const r = await catalog(`catalog[]=${c}`);
    const s = seen.get(c)!;
    const fresh = r.items.filter((x) => !s.has(x.id));
    r.items.forEach((x) => s.add(x.id));
    console.log(`round ${round} cat ${c}: status ${r.status} ${r.ms}ms items ${r.items.length} new ${fresh.length} overlap ${r.items.length - fresh.length}`, fresh.slice(0, 2).map((x) => `${x.title} ${x.price?.amount}€`));
    await sleep(4000);
  }
}
