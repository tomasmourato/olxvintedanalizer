// Title → PC parts with a canonical key ("gpu:rtx-3060-ti", "ram:ddr4-16"), for market prices and PC valuation.
// Deterministic regexes over normalized text. A part type mentioned without a model ("placa gráfica 8GB")
// comes back with key null. Titles are multilingual (Vinted is EU-wide), so the words cover pt/es/fr/it/nl/de.
import { hasPhrase, normalize } from "./text.js";

export type PartType = "gpu" | "cpu" | "ram" | "storage" | "psu" | "motherboard" | "cooler" | "case";
export type Part = { type: PartType; key: string | null; label: string | null };

const NVIDIA = new Set([
  750, 950, 960, 970, 980, 1030, 1050, 1060, 1070, 1080, 1630, 1650, 1660, 2060, 2070, 2080,
  3050, 3060, 3070, 3080, 3090, 4060, 4070, 4080, 4090, 5050, 5060, 5070, 5080, 5090,
]);
const AMD = new Set([
  460, 470, 480, 550, 560, 570, 580, 590, 5500, 5600, 5700, 6400, 6500, 6600, 6650, 6700, 6750,
  6800, 6900, 6950, 7600, 7700, 7800, 7900, 9060, 9070,
]);
const GPU_SUFFIX: Record<string, string> = { ti: "Ti", super: "Super", "ti-super": "Ti Super", xt: "XT", xtx: "XTX", gre: "GRE" };
// Chipset = the motherboard's price class; the optional letter is the form factor or revision (B450M, X570S).
const CHIPSETS =
  "a320|a520|a620|b350|b450|b550|b650|b840|b850|x370|x470|x570|x670|x870|h310|b360|b365|h370|z370|z390|" +
  "h410|b460|h470|z490|h510|b560|h570|z590|h610|b660|h670|z690|b760|z790|b860|z890|x99|x299|h81|b85|h97|z97|" +
  "h110|b150|h170|z170|b250|h270|z270";

const WORDS: Record<PartType, string[]> = {
  gpu: ["placa grafica", "placas graficas", "grafica", "graficas", "placa de video", "gpu", "carte graphique", "scheda video",
    "scheda grafica", "tarjeta grafica", "grafikkarte", "videokaart", "graphics card", "geforce", "radeon"],
  cpu: ["processador", "processadores", "processeur", "processore", "procesador", "prozessor", "cpu", "ryzen", "xeon",
    "pentium", "celeron", "athlon", "intel core"],
  ram: ["ram", "memoria ram", "memorias", "memoire vive", "memory", "barrette", "barrettes", "dimm", "sodimm", "werkgeheugen",
    "arbeitsspeicher"],
  storage: ["ssd", "nvme", "nvm express", "hdd", "disco rigido", "disco duro", "disco interno", "disque dur", "hard disk",
    "harddisk", "hard drive", "festplatte"],
  psu: ["fonte", "fonte de alimentacao", "psu", "alimentation", "alimentatore", "fuente", "power supply", "netzteil", "voeding"],
  motherboard: ["motherboard", "placa mae", "placa base", "carte mere", "scheda madre", "moederbord", "mainboard"],
  cooler: ["cooler", "ventoinha", "ventoinhas", "ventilateur", "ventirad", "dissipador", "water cooler", "watercooler", "water cooling"],
  case: [], // "caixa" also means the box a part comes in ("com caixa e fatura"): only the AI names cases
};

/** Accents stripped and lowercased, punctuation kept (for "1.5TB", "2x8GB"). */
const lower = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const size = (gb: number) => (gb >= 1000 ? `${Math.round(gb / 100) / 10}TB` : `${gb}GB`);

/** Nearest standard size, or null if nothing is within 30 %. */
function bucket(value: number, sizes: number[]): number | null {
  let best: number | null = null;
  let dist = Math.log(1.3);
  for (const s of sizes) {
    const d = Math.abs(Math.log(value / s));
    if (d <= dist) [best, dist] = [s, d];
  }
  return best;
}

function gpus(t: string): Part[] {
  const out: Part[] = [];
  for (const m of t.matchAll(/(?<![a-z0-9])(gtx|rtx|rx)? ?(\d{3,4}) ?(ti ?super|ti|super|xtx|xt|gre)?(?![a-z0-9])/g)) {
    const [, prefix, num, raw] = m;
    const suffix = raw?.replace(/^ti ?super$/, "ti-super");
    const n = Number(num);
    let fam: string;
    if (prefix === "rx" || (!prefix && AMD.has(n) && /\bradeon\b/.test(t))) {
      if (!AMD.has(n)) continue;
      fam = "rx";
    } else if (NVIDIA.has(n) && (prefix || n >= 1000)) {
      // Without a prefix, a 4-digit NVIDIA number still counts unless it belongs to a CPU ("i5 1060" does not exist, but be safe).
      if (!prefix && /(?:\bi[3579]|\bryzen(?: [3579])?|\br[3579]) ?$/.test(t.slice(0, m.index))) continue;
      fam = n >= 2000 ? "rtx" : "gtx";
    } else continue;
    const suf = suffix ? `-${suffix}` : "";
    out.push({ type: "gpu", key: `gpu:${fam}-${n}${suf}`, label: `${fam.toUpperCase()} ${n}${suffix ? ` ${GPU_SUFFIX[suffix]}` : ""}` });
  }
  for (const m of t.matchAll(/(?<![a-z0-9])arc ?([ab]\d{3})(?![a-z0-9])/g)) {
    out.push({ type: "gpu", key: `gpu:arc-${m[1]}`, label: `Arc ${m[1].toUpperCase()}` });
  }
  return out;
}

const ryzenTier = (n: number) => [3, 3, 3, 3, 5, 5, 5, 7, 7, 9][Math.floor(n / 100) % 10];

function cpus(t: string): Part[] {
  const out: Part[] = [];
  for (const m of t.matchAll(/(?<![a-z0-9])(i[3579]) ?(\d{4,5})([a-z]{0,3})(?![a-z0-9])/g)) {
    const [, fam, num, suf] = m;
    out.push({ type: "cpu", key: `cpu:${fam}-${num}${suf}`, label: `${fam}-${num}${suf.toUpperCase()}` });
  }
  for (const m of t.matchAll(/(?<![a-z0-9])ultra ?([579]) ?(\d{3})([a-z]{0,2})(?![a-z0-9])/g)) {
    const [, tier, num, suf] = m;
    out.push({ type: "cpu", key: `cpu:ultra-${num}${suf}`, label: `Core Ultra ${tier} ${num}${suf.toUpperCase()}` });
  }
  // "Ryzen 5 3600X", "R5 5600", "ryzen 5600x"; bare "5600x" / "7800x3d" too (the RX 5600 XT is "xt").
  const ryzen = /(?<![a-z0-9])(?:(?:ryzen ?(?:[3579] )?|r[3579] ?)(\d{4})(x3d|xt|x|ge|g|f)?|(\d{4})(x3d|x))(?![a-z0-9])/g;
  for (const m of t.matchAll(ryzen)) {
    const num = m[1] ?? m[3];
    const suf = m[2] ?? m[4] ?? "";
    if (m[3] && /\brx ?$/.test(t.slice(0, m.index))) continue;
    const n = Number(num);
    out.push({ type: "cpu", key: `cpu:ryzen-${n}${suf}`, label: `Ryzen ${ryzenTier(n)} ${n}${suf.toUpperCase()}` });
  }
  return out;
}

function ram(t: string, raw: string): Part | null {
  const gen = t.match(/\b(?:ddr([2-5])|pc([2-5]))\b/);
  if (!gen && !WORDS.ram.some((w) => hasPhrase(t, w))) return null;
  const kit = raw.match(/(\d+)\s*[x×]\s*(\d+)\s*(?:gb|go|g)\b/);
  const one = raw.match(/(\d+)\s*(?:gb|go)\b/);
  const gb = kit ? Number(kit[1]) * Number(kit[2]) : one ? Number(one[1]) : null;
  if (!gen || !gb || ![2, 4, 8, 16, 32, 64, 128].includes(gb)) return { type: "ram", key: null, label: null };
  const ddr = `ddr${gen[1] ?? gen[2]}`;
  const so = /\bso ?dimm\b/.test(t);
  return { type: "ram", key: `ram:${ddr}-${gb}${so ? "-sodimm" : ""}`, label: `${gb}GB ${ddr.toUpperCase()}${so ? " SO-DIMM" : ""}` };
}

function storage(t: string, raw: string): Part | null {
  const ssd = ["ssd", "nvme", "nvm express", "m 2"].some((w) => hasPhrase(t, w));
  if (!ssd && !WORDS.storage.some((w) => hasPhrase(t, w))) return null;
  const external = ["externo", "externa", "externe", "external", "esterno", "portable"].some((w) => hasPhrase(t, w));
  const tb = raw.match(/(\d+(?:[.,]\d+)?)\s*(?:tb|to)\b/);
  const gb = raw.match(/(\d+)\s*(?:gb|go|g)\b/);
  const cap = tb ? Number(tb[1].replace(",", ".")) * 1000 : gb ? Number(gb[1]) : null;
  const kind = ssd ? "ssd" : "hdd";
  const b = cap && bucket(cap, ssd ? [128, 256, 512, 1000, 2000, 4000] : [250, 320, 500, 750, 1000, 1500, 2000, 3000, 4000, 6000, 8000]);
  if (external || !b) return { type: "storage", key: null, label: null };
  return { type: "storage", key: `storage:${kind}-${b}`, label: `${kind.toUpperCase()} ${size(b)}` };
}

function psu(t: string, raw: string): Part | null {
  if (!WORDS.psu.some((w) => hasPhrase(t, w))) return null;
  const w = raw.match(/(\d{3,4})\s*w\b/);
  const watts = w ? Math.round(Number(w[1]) / 50) * 50 : null;
  if (!watts || watts < 300 || watts > 2000) return { type: "psu", key: null, label: null };
  return { type: "psu", key: `psu:${watts}`, label: `Fonte ${watts}W` };
}

function motherboard(t: string): Part | null {
  const m = t.match(new RegExp(`(?<![a-z0-9])(${CHIPSETS})[meisap]?(?![a-z0-9])`));
  if (m) return { type: "motherboard", key: `mb:${m[1]}`, label: `Motherboard ${m[1].toUpperCase()}` };
  return WORDS.motherboard.some((w) => hasPhrase(t, w)) ? { type: "motherboard", key: null, label: null } : null;
}

/** Every part the title mentions: one entry per key, or one keyless entry per type named without a model. */
export function parseParts(title: string): Part[] {
  const t = normalize(title);
  const raw = lower(title);
  const found = [...gpus(t), ...cpus(t), ram(t, raw), storage(t, raw), psu(t, raw), motherboard(t)].filter((p): p is Part => !!p);
  const out = [...new Map(found.filter((p) => p.key).map((p) => [p.key, p])).values()];
  const cpuWord = WORDS.cpu.some((w) => hasPhrase(t, w)) || /\bi[3579]\b/.test(t);
  const words: [PartType, boolean][] = [
    ["gpu", WORDS.gpu.some((w) => hasPhrase(t, w))],
    ["cpu", cpuWord],
    ["cooler", WORDS.cooler.some((w) => hasPhrase(t, w))],
  ];
  for (const p of found) if (!p.key) words.push([p.type, true]);
  for (const [type, named] of words) {
    if (named && !out.some((p) => p.type === type)) out.push({ type, key: null, label: null });
  }
  return out;
}

// Titles that are not one part on its own: whole computers, lots, wanted/trade ads, broken or box-only.
const NOT_SINGLE = [
  "pc", "pcs", "computador", "computadores", "computer", "ordenador", "ordinateur", "desktop", "torre", "setup", "portatil",
  "portateis", "portatile", "portable", "laptop", "notebook", "macbook", "imac", "ultrabook", "all in one", "workstation",
  "servidor", "server", "lote", "lotes", "lot", "lotto", "stock", "pack", "conjunto", "bundle", "combo", "procuro", "compro",
  "troco", "troca", "para pecas", "para reparar", "spares", "for parts", "nao funciona", "no funciona", "non funziona", "ne fonctionne",
  "sem funcionar", "caixa vazia", "so caixa", "box only", "solo caja", "partido", "partida",
];

/** The one part a listing sells, or null (several parts, a whole PC, a lot, broken, or no model). */
export function singlePart(title: string): Part | null {
  if (lower(title).replace(/80\s*(?:\+|plus)/g, "").includes("+")) return null;
  const t = normalize(title);
  if (NOT_SINGLE.some((w) => hasPhrase(t, w)) || /\b(?:avariad|defeit|danificad|broken|defect|guast)/.test(t)) return null;
  const parts = parseParts(title);
  return parts.length === 1 && parts[0].key ? parts[0] : null;
}
