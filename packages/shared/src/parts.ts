// Title → PC parts with a canonical key ("gpu:rtx-3060-ti", "ram:ddr4-16"), for market prices, PC valuation and the
// app's calculator.
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

// A bare 4-digit number is an NVIDIA card only with a GPU word, a card maker, gaming, Ti/Super or the VRAM right after it
// ("Gigabyte 1660 super", "3060 12g"). Else it is usually a Dell (OptiPlex 3050, Wyse 5070), a printer (Deskjet 3050) or "1080p".
const GPU_HINTS = [...WORDS.gpu, "nvidia", "gtx", "rtx", "rt", "gt", "vram", "oc", "founders", "gaming", "gamer", "asus", "rog", "strix",
  "tuf", "astral", "msi", "ventus", "gigabyte", "aorus", "eagle", "windforce", "zotac", "evga", "palit", "gainward", "pny", "inno3d", "kfa2",
  "galax"];
const showsGpu = (t: string, suffix: string | undefined, after: string) =>
  !!suffix || /^ ?\d{1,2} ?g[bo]?(?![a-z0-9])/.test(after) || GPU_HINTS.some((w) => hasPhrase(t, w));

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
      // Without a prefix, a 4-digit NVIDIA number counts when the title shows a graphics card, unless it belongs to a CPU
      // ("i5 1060" does not exist, but be safe).
      if (!prefix && !showsGpu(t, suffix, t.slice(m.index + m[0].length))) continue;
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

/** The RAM generation and total size a text states, each null when missing ("2x8GB DDR4" → ddr4, 16). */
function ramSpec(t: string, raw: string): { ddr: string | null; gb: number | null } {
  const gen = t.match(/\b(?:ddr ?([2-5])|pc([2-5]))\b/);
  const kit = raw.match(/(\d+)\s*[x×]\s*(\d+)\s*(?:gb|go|g)\b/);
  // In a PC title the first "GB" is often the graphics card's ("RTX 3060 12GB 16GB DDR4"): prefer the size next to RAM/DDR.
  const one =
    raw.match(/(\d+)\s*(?:gb|go)\s*(?:de\s+)?(?:ram|ddr[2-5])/) ?? raw.match(/(?:ram|ddr[2-5])\s*(?:de\s+)?(\d+)\s*(?:gb|go)\b/) ?? raw.match(/(\d+)\s*(?:gb|go)\b/);
  return { ddr: gen ? `ddr${gen[1] ?? gen[2]}` : null, gb: kit ? Number(kit[1]) * Number(kit[2]) : one ? Number(one[1]) : null };
}

export const titleRamSpec = (title: string) => ramSpec(normalize(title), lower(title));

function ram(t: string, raw: string): Part | null {
  const { ddr, gb } = ramSpec(t, raw);
  if (!ddr && !WORDS.ram.some((w) => hasPhrase(t, w))) return null;
  if (!ddr || !gb || ![2, 4, 8, 16, 32, 64, 128].includes(gb)) return { type: "ram", key: null, label: null };
  const so = /\bso ?dimm\b/.test(t);
  return { type: "ram", key: `ram:${ddr}-${gb}${so ? "-sodimm" : ""}`, label: `${gb}GB ${ddr.toUpperCase()}${so ? " SO-DIMM" : ""}` };
}

function storage(t: string, raw: string): Part | null {
  // "M.2" as a word of its own: hasPhrase would also find it inside "ram 2x4".
  const ssd = ["ssd", "nvme", "nvm express"].some((w) => hasPhrase(t, w)) || /(?<![a-z0-9])m 2(?![0-9])/.test(t);
  if (!ssd && !WORDS.storage.some((w) => hasPhrase(t, w))) return null;
  const external = ["externo", "externa", "externe", "external", "esterno", "portable"].some((w) => hasPhrase(t, w));
  // The first size that is a disk size: next to SSD/HDD first ("16GB RAM 512GB SSD", "32gb ssd 1tb" skips the RAM's 32),
  // then the first TB, then the first GB.
  const sizes = [
    /(\d+(?:[.,]\d+)?)\s*(tb|to|gb|go)\s*(?:de\s+)?(?:ssd|nvme|hdd|m\.?2)/g,
    /(?:ssd|nvme|hdd|m\.?2)\s*(?:de\s+)?(\d+(?:[.,]\d+)?)\s*(tb|to|gb|go)\b/g,
    /(\d+(?:[.,]\d+)?)\s*(tb|to)\b/g,
    /(\d+)\s*(gb|go|g)\b/g,
  ].flatMap((re) => [...raw.matchAll(re)].map((m) => Number(m[1].replace(",", ".")) * (m[2].startsWith("t") ? 1000 : 1)));
  const kind = ssd ? "ssd" : "hdd";
  const disk = ssd ? [128, 256, 512, 1000, 2000, 4000] : [250, 320, 500, 750, 1000, 1500, 2000, 3000, 4000, 6000, 8000];
  const b = sizes.map((gb) => bucket(gb, disk)).find((x) => x != null) ?? null;
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

// Keyword the parser needs to recognise a bare model name of a known type ("650W" → "fonte 650W", "3060" → "grafica 3060").
const HINT: Partial<Record<PartType, string>> = { gpu: "grafica", psu: "fonte", motherboard: "motherboard", ram: "ram" };

/** A model named for a known part type (the AI's answer, a calculator field) → that part with its key, or null. */
export function parseModel(type: PartType, model: string): Part | null {
  const find = (text: string) => parseParts(text).find((p) => p.type === type && p.key) ?? null;
  const hint = HINT[type];
  const part = find(hint && !normalize(model).includes(hint) ? `${hint} ${model}` : model);
  // A bare Ryzen number ("3600"): Intel models are written with their i3/i5/i7/i9.
  if (!part && type === "cpu" && /^\d{4}[a-z0-9]*$/.test(normalize(model).replaceAll(" ", ""))) return find(`ryzen ${model}`);
  return part;
}

// Titles that are not one part on its own: whole computers, lots, wanted/trade ads, broken or box-only.
const NOT_SINGLE = [
  "pc", "pcs", "computador", "computadores", "computer", "ordenador", "ordinateur", "desktop", "torre", "setup", "portatil",
  "portateis", "portatile", "portable", "laptop", "notebook", "macbook", "imac", "ultrabook", "all in one", "workstation",
  "servidor", "server", "lote", "lotes", "lot", "lotto", "stock", "pack", "conjunto", "bundle", "combo", "procuro", "compro",
  "troco", "troca", "para pecas", "para reparar", "spares", "for parts", "nao funciona", "no funciona", "non funziona", "ne fonctionne",
  "sem funcionar", "caixa vazia", "so caixa", "box only", "solo caja", "partido", "partida",
];

/** Not a whole PC, a combo ("+"), a lot, a wanted ad, broken or box-only. */
function sellsOnePart(title: string): boolean {
  if (lower(title).replace(/80\s*(?:\+|plus)/g, "").includes("+")) return false;
  const t = normalize(title);
  return !NOT_SINGLE.some((w) => hasPhrase(t, w)) && !/\b(?:avariad|defeit|danificad|broken|defect|guast)/.test(t);
}

/** The one part a listing sells, or null (several parts, a whole PC, a lot, broken, or no model). */
export function singlePart(title: string): Part | null {
  if (!sellsOnePart(title)) return null;
  const parts = parseParts(title);
  return parts.length === 1 && parts[0].key ? parts[0] : null;
}

// Accessories sold for a part, and several parts at once: never worth asking the AI about.
const NOT_THE_PART = [
  "suporte", "support", "soporte", "supporto", "halterung", "cabo", "cabos", "cable", "cavo", "riser", "adaptador", "adapter",
  "adattatore", "backplate", "bracket", "waterblock", "water block", "dissipador", "heatsink", "rig", "estrutura", "frame",
  "varias", "varios", "diversas", "diversos", "plusieurs", "vari", "varie", "componentes", "etc",
];
// RAM from before DDR2: sizes in MB, SDRAM, PC100/PC133, DDR1.
const OLD_RAM = /\b(?:sd ?ram|pc1\d\d|ddr ?1)\b|\d+\s*(?:mb|mo)\b/;

/**
 * A model-like number left once sizes, speeds, powers and memory generations are removed: "GTX 650 1GB" → yes
 * (a model the parser does not follow), "Placa gráfica 4GB" → no.
 */
export function hasModelNumber(text: string): boolean {
  const t = lower(text)
    .replace(/\d+(?:[.,]\d+)?\s*(?:gb|go|mb|mo|tb|to|mhz|ghz|hz|w|bits?|p|pinos?|pins?|cm|mm|v)\b/g, " ")
    .replace(/\b(?:g?ddr|lpddr|pcie?)\s?\d(?:[.,]\d)?\b/g, " ")
    .replace(/\b\d+\s*[x×]\s*\d+/g, " ");
  return /\d{2,}/.test(t);
}

/**
 * The part types a one-part listing names without the model, for "Por identificar" ("Placa gráfica 8GB" → gpu).
 * Titles with any model, even one the parser does not follow ("GT 710"), and RAM with both size and generation, are out.
 */
export function unnamedTypes(title: string): PartType[] {
  if (!sellsOnePart(title) || NOT_THE_PART.some((w) => hasPhrase(normalize(title), w))) return [];
  const parts = parseParts(title);
  if (parts.length !== 1 || parts[0].key) return []; // several part types = a combo ("motherboard, ram e processador")
  const { type } = parts[0];
  const spec = titleRamSpec(title);
  if (type === "ram") return (!spec.ddr || !spec.gb) && !OLD_RAM.test(lower(title)) ? [type] : [];
  return (type === "gpu" || type === "cpu") && hasModelNumber(title) ? [] : [type];
}
