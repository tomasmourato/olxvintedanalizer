// F0 spike: one request for several catalogs at once + look for a country filter.
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 Edg/128.0";

function flight(html: string) {
  let s = "";
  for (const m of html.matchAll(/self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g)) s += JSON.parse(m[1]);
  return s;
}
function objectAt(s: string, start: number) {
  let depth = 0, inStr = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) { if (c === "\\") i++; else if (c === '"') inStr = false; continue; }
    if (c === '"') inStr = true; else if (c === "{") depth++; else if (c === "}" && --depth === 0) return s.slice(start, i + 1);
  }
  throw new Error("unbalanced");
}
const items = (f: string) => {
  const out: any[] = []; const k = '"productItem":';
  for (let i = f.indexOf(k); i >= 0; i = f.indexOf(k, i + 1)) out.push(JSON.parse(objectAt(f, i + k.length)));
  return out;
};

const r = await fetch("https://www.vinted.pt/catalog?order=newest_first&catalog[]=3582&catalog[]=3581&catalog[]=3580", {
  headers: { "user-agent": UA, accept: "text/html", "accept-language": "pt-PT,pt;q=0.9" },
});
const f = flight(await r.text());
const its = items(f);
console.log("multi", r.status, "items", its.length);
its.slice(0, 6).forEach((x) => console.log(" ", x.id, x.price.amount, x.title, "|", x.itemBox?.firstLine, "|", x.itemBox?.secondLine));
// any country / location hints?
for (const k of ["country", "Country", "countryCode", "country_id", "city", "location"]) {
  const i = f.indexOf(`"${k}`);
  console.log(k, i >= 0 ? f.slice(i, i + 160) : "-");
}
