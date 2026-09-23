// Runs log (one row per request) and the worker heartbeat.
import type { Insert, Source } from "@dh/shared";
import pkg from "../package.json" with { type: "json" };
import { db } from "./db.js";
import { errorText, flags, log } from "./util.js";

export const VERSION = pkg.version; // npm_package_version is unset under pm2

export function logRun(run: Insert<"runs">): void {
  if (flags.dryRun) return;
  db.from("runs")
    .insert(run)
    .then(({ error }) => error && log("runs insert failed:", error.message));
}

/** True if this scope has been fetched successfully before (so its results are not a backfill). */
export async function scopeKnown(source: Source, kind: "category" | "search", scope: string): Promise<boolean> {
  if (flags.dryRun) return true;
  const { data, error } = await db
    .from("runs")
    .select("id")
    .match({ source, kind, scope, status: "ok" })
    .limit(1);
  if (error) throw new Error(`runs lookup: ${error.message}`);
  return data.length > 0;
}

const status: Insert<"worker_status"> = { id: "main" };

export async function writeStatus(patch: Omit<Insert<"worker_status">, "id"> = {}): Promise<void> {
  Object.assign(status, patch);
  if (flags.dryRun) return;
  const { error } = await db.from("worker_status").upsert({ ...status, heartbeat_at: new Date().toISOString() });
  if (error) log("heartbeat failed:", error.message);
}

export function reportError(source: Source, e: unknown): void {
  void writeStatus({ last_error: `${source}: ${errorText(e)}`, last_error_at: new Date().toISOString() });
}

export function startHeartbeat(): () => void {
  void writeStatus({ version: VERSION, started_at: new Date().toISOString() });
  const t = setInterval(() => void writeStatus(), 60_000);
  return () => clearInterval(t);
}
