import { describe, expect, it } from "vitest";
import { nextDue, recheckEvery } from "../src/pipeline/recheck.js";

const NOW = Date.parse("2026-10-08T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;

describe("recheckEvery", () => {
  it("looks at new listings more often than old ones", () => {
    expect(recheckEvery(HOUR)).toBe(30 * MIN);
    expect(recheckEvery(12 * HOUR)).toBe(2 * HOUR);
    expect(recheckEvery(3 * 24 * HOUR)).toBe(4 * HOUR);
    expect(recheckEvery(10 * 24 * HOUR)).toBe(12 * HOUR);
  });
});

describe("nextDue", () => {
  const list = [
    { id: 1, first_seen_at: ago(HOUR) },
    { id: 2, first_seen_at: ago(5 * 24 * HOUR) },
    { id: 3, first_seen_at: ago(20 * HOUR) },
  ];

  it("takes never-checked listings first, newest first", () => {
    expect(nextDue(list, new Map(), NOW)?.id).toBe(1);
    expect(nextDue(list, new Map([[1, NOW - MIN]]), NOW)?.id).toBe(2);
  });

  it("takes the one checked longest ago among the due", () => {
    const last = new Map([
      [1, NOW - 30 * MIN],
      [2, NOW - 4 * HOUR],
      [3, NOW - 2 * HOUR],
    ]);
    expect(nextDue(list, last, NOW)?.id).toBe(2);
  });

  it("skips listings checked recently, by age", () => {
    // a 1 h old listing is due again after 30 min, a 5 day old one after 4 h
    const last = new Map([
      [1, NOW - 10 * MIN],
      [2, NOW - 2 * HOUR],
      [3, NOW - 30 * MIN],
    ]);
    expect(nextDue(list, last, NOW)).toBeNull();
    expect(nextDue(list, new Map([...last, [1, NOW - 31 * MIN]]), NOW)?.id).toBe(1);
  });

  it("returns null for an empty list", () => {
    expect(nextDue([], new Map(), NOW)).toBeNull();
  });
});
