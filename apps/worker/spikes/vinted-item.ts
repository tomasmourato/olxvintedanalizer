// F0 spike: what does a single item page expose (description, country, upload time)?
import { writeFileSync } from "node:fs";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 Edg/128.0";
const id = process.argv[2] ?? "10100441987";
const r = await fetch(`https://www.vinted.pt/items/${id}`, { headers: { "user-agent": UA, accept: "text/html", "accept-language": "pt-PT,pt;q=0.9" } });
const html = await r.text();
let f = "";
for (const m of html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)) f += JSON.parse(m[1]);
writeFileSync(new URL("./out/vinted-item.html", import.meta.url), html);
console.log("status", r.status, "htmlKB", Math.round(html.length / 1024), "flightKB", Math.round(f.length / 1024));
for (const k of ["description", "country_title", "countryTitle", "country_code", "countryCode", "city", "created_at_ts", "createdAt", "updated_at_ts", "upload_date", "brand_title", "size_title", "status"]) {
  const i = f.indexOf(`"${k}":`);
  console.log(k.padEnd(14), i >= 0 ? f.slice(i, i + 140).replace(/\s+/g, " ") : "-");
}
