// Trim spike captures into small, committed test fixtures.
import { readFileSync, writeFileSync, copyFileSync } from "node:fs";

const out = (n: string) => new URL(`./out/${n}`, import.meta.url);
const fx = (n: string) => new URL(`../fixtures/${n}`, import.meta.url);

// Vinted: re-encode the first 10 catalog entries in the same flight-chunk format the parser reads.
const html = readFileSync(out("vinted-3602.html"), "utf8");
let f = "";
for (const m of html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)) f += JSON.parse(m[1]);
const start = f.indexOf('"items":{"items":[') + '"items":{"items":'.length;
let depth = 0, inStr = false, end = start;
for (let i = start; i < f.length; i++) {
  const c = f[i];
  if (inStr) { if (c === "\\") i++; else if (c === '"') inStr = false; continue; }
  if (c === '"') inStr = true;
  else if (c === "[" || c === "{") depth++;
  else if ((c === "]" || c === "}") && --depth === 0) { end = i + 1; break; }
}
const sample = JSON.stringify({ items: { items: JSON.parse(f.slice(start, end)).slice(0, 10) } });
writeFileSync(fx("vinted-catalog.html"), `<html><body><script>self.__next_f.push([1,${JSON.stringify(`1a:${sample}\n`)}])</script></body></html>`);
console.log("vinted fixture KB", Math.round(sample.length / 1024));

// OLX: API JSON as-is.
copyFileSync(out("olx-rtx_3060.json"), fx("olx-offers.json"));
console.log("olx fixture copied");
