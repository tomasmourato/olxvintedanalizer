// A new watch for one part of Pesquisas → Preços das peças. The search terms come from the part key (made by
// the worker's title parser, apps/worker/src/pipeline/parts.ts) and follow the worker's matching rules:
// whole words, and phrases with digits also match without spaces ("3060 ti" finds "RTX3060Ti").
import type { Database } from "./database.types.js";

type Watch = Database["public"]["Tables"]["watches"]["Row"];
export type PartRef = { key: string; type: string; label: string };
export type PartWatch = Pick<
  Watch,
  "name" | "category" | "include_any" | "include_all" | "exclude" | "olx_category_ids" | "vinted_catalog_ids" | "search_remote" | "good_price" | "target_price"
>;
type Terms = Pick<PartWatch, "include_any" | "include_all" | "exclude">;

// The friend's first watches put "Bom até" at about 70 % of the market value and "Imperdível até" at about 55 %.
const [GOOD, GREAT] = [0.7, 0.55];
const round5 = (n: number) => Math.max(5, Math.round(n / 5) * 5);

const GROUP: Record<string, string> = {
  gpu: "Placas gráficas",
  cpu: "Processadores",
  ram: "Memória RAM",
  storage: "Armazenamento",
  psu: "Fontes",
  motherboard: "Motherboards",
};
const VINTED_CATALOG: Record<string, number> = { gpu: 3602, cpu: 3599, ram: 3603, storage: 3607, psu: 3608, motherboard: 3600 };
const OLX_PARTS = 5371; // Componentes e peças

const terms = (include_any: string[], exclude: string[] = [], include_all: string[] = []): Terms => ({ include_any, include_all, exclude });

/** "rtx-3060-ti", "rtx-4070-ti-super", "rx-6600", "gtx-970", "arc-a770". */
function gpu(id: string): Terms {
  const [fam, n, ...rest] = id.split("-");
  const own = rest.join(" ");
  if (fam === "arc") return terms([`arc ${n}`]);
  // "3060" alone is specific enough (and titles often drop the RTX); "6600" or "970" are not.
  const base = fam === "rx" || Number(n) < 1000 ? `${fam} ${n}` : n;
  const exclude = !own
    ? (fam === "rx" ? ["xt", "xtx", "gre"] : ["ti", "super"]).map((v) => `${n} ${v}`)
    : own === "ti"
      ? [`${n} ti super`]
      : own === "xt"
        ? [`${n} xtx`]
        : [];
  return terms([own ? `${base} ${own}` : base], exclude);
}

/** "ryzen-3600", "ryzen-5800x3d", "i5-10400f", "ultra-245k"; the label gives the Ryzen tier ("Ryzen 5 3600"). */
function cpu(id: string, label: string): Terms {
  const [fam, model] = id.split("-");
  const [, n, suf] = model.match(/^(\d+)([a-z0-9]*)$/) ?? [];
  if (!n) return terms([model]);
  if (fam === "ryzen") {
    if (suf) return terms([`${n}${suf}`], suf === "x" ? [`${n}xt`, `${n}x3d`] : suf === "g" ? [`${n}ge`] : []);
    const tier = label.split(" ")[1];
    return terms([`ryzen ${tier} ${n}`, `r${tier} ${n}`, `ryzen ${n}`], [`${n}x`, `${n}g`, `${n}f`]);
  }
  if (suf) return terms([`${n}${suf}`], suf === "k" ? [`${n}kf`, `${n}ks`] : []);
  return terms([`${fam} ${n}`], [`${n}f`, `${n}k`, `${n}t`]);
}

/** "ddr4-16", "ddr4-8-sodimm": total size, or a two-stick kit of it. */
function ram(id: string): Terms {
  const [ddr, size, so] = id.split("-");
  const gb = Number(size);
  const include = [`${gb}gb`, `${gb}go`, ...(gb >= 4 ? [`2x${gb / 2}gb`] : [])];
  const exclude = [`${gb * 2}gb`, `2x${gb}`, `g${ddr}`, ...(so ? [] : ["sodimm", "so dimm"])];
  return terms(include, exclude, so ? [ddr, "sodimm"] : [ddr]);
}

// Sizes sold under the same bucket as the parser's (a 480GB SSD is a 512GB one).
const SSD_SIZES: Record<number, number[]> = { 128: [128, 120], 256: [256, 240, 250], 512: [512, 480, 500], 1000: [1000, 960] };

/** "ssd-512", "hdd-2000". */
function storage(id: string): Terms {
  const [kind, size] = id.split("-");
  const cap = Number(size);
  const sizes = kind === "ssd" ? (SSD_SIZES[cap] ?? [cap]) : [cap];
  const include = sizes.flatMap((s) => (s >= 1000 ? [`${s / 1000}tb`, `${s / 1000}to`] : [`${s}gb`, `${s}go`]));
  const external = ["externo", "externa", "external"];
  return kind === "ssd" ? terms(include, external, ["ssd"]) : terms(include, ["ssd", "nvme", ...external]);
}

/** Watch fields for a part, or null for types without search terms (case, cooler). */
export function partWatch(p: PartRef, value: number | null): PartWatch | null {
  const [, id] = p.key.split(/:(.*)/);
  const t: Terms | null =
    p.type === "gpu" ? gpu(id)
    : p.type === "cpu" ? cpu(id, p.label)
    : p.type === "ram" ? ram(id)
    : p.type === "storage" ? storage(id)
    : p.type === "psu" ? terms([`${id}w`])
    : p.type === "motherboard" ? terms([id])
    : null;
  if (!t) return null;
  return {
    name: p.label,
    category: GROUP[p.type],
    ...t,
    olx_category_ids: [OLX_PARTS],
    vinted_catalog_ids: [VINTED_CATALOG[p.type]],
    // Site-wide searches only for models; "16gb" or "650w" would bring the whole site.
    search_remote: p.type === "gpu" || p.type === "cpu",
    good_price: value == null ? null : round5(value * GOOD),
    target_price: value == null ? null : round5(value * GREAT),
  };
}
