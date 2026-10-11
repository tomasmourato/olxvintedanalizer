// Which listing the automatic sold-items sweep (checks.ts) looks at next. Pure, so it can be tested.

const HOUR = 3_600_000;

/**
 * How long to wait before looking at a listing again: new ones sell fast, old ones rarely change, and those over a
 * week old only show in Negócios with the 30-day period (~540 Vinted listings in all on 2026-10-11).
 */
export function recheckEvery(ageMs: number): number {
  if (ageMs < 6 * HOUR) return HOUR / 2;
  if (ageMs < 48 * HOUR) return 2 * HOUR;
  if (ageMs < 7 * 24 * HOUR) return 4 * HOUR;
  return 12 * HOUR;
}

export type Candidate = { id: number; first_seen_at: string };

/**
 * The listing checked longest ago among those due (never checked first; newest first among those), or null.
 * `lastChecked` maps listing id → time of its last check.
 */
export function nextDue<T extends Candidate>(list: readonly T[], lastChecked: ReadonlyMap<number, number>, now: number): T | null {
  let best: T | null = null;
  let bestAt = Infinity;
  for (const t of list) {
    const at = lastChecked.get(t.id) ?? 0;
    if (at >= bestAt || now - at < recheckEvery(now - Date.parse(t.first_seen_at))) continue;
    best = t;
    bestAt = at;
  }
  return best;
}
