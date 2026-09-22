// Known category ids (docs/F0-validacao.md). Watches match on the listing's category path,
// so a subcategory (e.g. Vinted 3602) works inside a fetched parent (3582).
import type { Source } from "@dh/shared";

export const CATEGORIES: Record<Source, { id: number; name: string; sub?: boolean }[]> = {
  olx: [
    { id: 5371, name: "Componentes e peças" },
    { id: 4731, name: "Computadores" },
    { id: 4753, name: "Portáteis" },
    { id: 4745, name: "Monitores" },
    { id: 4751, name: "Periféricos" },
    { id: 5370, name: "Acessórios" },
  ],
  vinted: [
    { id: 3582, name: "Peças e componentes" },
    { id: 3602, name: "Placas gráficas", sub: true },
    { id: 3599, name: "Processadores", sub: true },
    { id: 3600, name: "Motherboards", sub: true },
    { id: 3603, name: "Memória RAM", sub: true },
    { id: 3607, name: "Armazenamento", sub: true },
    { id: 3608, name: "Fontes", sub: true },
    { id: 3598, name: "Caixas", sub: true },
    { id: 3604, name: "Refrigeração", sub: true },
    { id: 3601, name: "Combos", sub: true },
    { id: 3581, name: "Computadores de secretária" },
    { id: 3580, name: "Portáteis" },
  ],
};

export function categoryName(source: Source, id: number): string {
  return CATEGORIES[source].find((c) => c.id === id)?.name ?? `categoria ${id}`;
}

/** A run's scope as text: category ids → names, search terms in quotes. */
export function scopeLabel(source: Source, kind: string, scope: string): string {
  if (kind === "category") return scope.split(",").map((id) => categoryName(source, Number(id))).join(", ");
  if (kind === "search") return `“${scope}”`;
  return scope.replace(/^user /, "vendedor ").replace(/^item /, "anúncio ");
}
