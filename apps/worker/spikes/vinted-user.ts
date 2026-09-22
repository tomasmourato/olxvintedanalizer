// F0 spike: does the users API still answer (seller country for cross-border filtering)?
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36 Edg/128.0";
const home = await fetch("https://www.vinted.pt/", { headers: { "user-agent": UA, accept: "text/html" } });
const jar = new Map<string, string>();
for (const c of home.headers.getSetCookie()) { const [kv] = c.split(";"); const [k, v] = kv.split("="); if (v) jar.set(k, v); }
const cookie = [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
for (const p of [`/api/v2/users/${process.argv[2] ?? "136951790"}`, `/api/v2/items/${process.argv[3] ?? "10100441987"}/details`]) {
  const r = await fetch(`https://www.vinted.pt${p}`, { headers: { "user-agent": UA, accept: "application/json", cookie } });
  const b = await r.text();
  const m = b.match(/"(country_title|country_code|country_iso_code|city)":"[^"]*"/g);
  console.log(p, r.status, m ? [...new Set(m)].join(" ") : b.slice(0, 160));
}
