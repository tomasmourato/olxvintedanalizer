export { clockIn, isActive } from "@dh/shared";

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, ms)));

/** `base` ± `spread` (fraction), so requests never fall into a fixed rhythm. */
export const jitter = (base: number, spread = 0.2) => base * (1 - spread + Math.random() * 2 * spread);

export function log(...args: unknown[]): void {
  console.log(new Date().toISOString().slice(11, 19), ...args);
}

export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Process-wide switches set from the command line. */
export const flags = { dryRun: false };
