// Web push (VAPID) straight from the worker to every subscribed device, logged in `notifications`.
// The `push` Edge Function does the same for the test button and the watchdog (supabase/functions/push).
import webpush, { WebPushError } from "web-push";
import type { PushKind, PushPayload } from "@dh/shared";
import { db } from "./db.js";
import { errorText, flags, log } from "./util.js";

const TTL_S = 3600; // a deal older than an hour is probably gone
const SEND_TIMEOUT_MS = 5_000;

let vapid: boolean | null = null;
function configured(): boolean {
  if (vapid == null) {
    const { VAPID_PUBLIC_KEY: pub, VAPID_PRIVATE_KEY: priv } = process.env;
    vapid = !!pub && !!priv;
    if (vapid) webpush.setVapidDetails(process.env.VAPID_SUBJECT || "https://olxvintedanalizer.pages.dev", pub!, priv!);
  }
  return vapid;
}

export type PushResult = { ok: number; failed: number; error: string | null };

/** Sends to all devices, then logs it. `startedAt` = when the listing was detected (for latency_ms). */
export async function sendPush(
  kind: PushKind,
  payload: PushPayload,
  opts: { matchId?: number | null; startedAt?: number } = {},
): Promise<PushResult> {
  if (flags.dryRun) {
    log(`push ${kind} (dry-run): ${payload.title} | ${payload.body.replace(/\n/g, " | ")}`);
    return { ok: 0, failed: 0, error: null };
  }

  const { data: subs, error } = await db.from("push_subscriptions").select("id, endpoint, p256dh, auth, label, failures");
  let result: PushResult;
  if (error) result = { ok: 0, failed: 0, error: `subscrições: ${error.message}` };
  else if (!configured()) result = { ok: 0, failed: 0, error: "faltam as chaves VAPID no .env do worker" };
  else if (!subs.length) result = { ok: 0, failed: 0, error: "nenhum dispositivo subscrito" };
  else {
    const body = JSON.stringify({ ...payload, ts: Date.now() });
    const errors = await Promise.all(
      subs.map((s) =>
        webpush
          .sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, {
            TTL: TTL_S,
            urgency: "high",
            timeout: SEND_TIMEOUT_MS,
          })
          .then(() => null)
          .catch((e: unknown) => ({ sub: s, e })),
      ),
    );
    const failed = errors.filter((x) => x != null);
    result = {
      ok: subs.length - failed.length,
      failed: failed.length,
      error: failed.map(({ sub, e }) => `${sub.label ?? `#${sub.id}`}: ${errorText(e)}`).join("; ").slice(0, 500) || null,
    };
    void bookkeeping(
      subs.filter((s) => !failed.some((f) => f.sub.id === s.id)).map((s) => s.id),
      failed.map(({ sub, e }) => ({ id: sub.id, failures: sub.failures, gone: e instanceof WebPushError && [404, 410].includes(e.statusCode) })),
    );
  }

  const status = result.ok && !result.failed ? "sent" : result.ok ? "partial" : "failed";
  const { error: logError } = await db.from("notifications").insert({
    kind,
    match_id: opts.matchId ?? null,
    title: payload.title,
    body: payload.body,
    url: payload.url,
    status,
    devices_ok: result.ok,
    devices_failed: result.failed,
    error: result.error,
    latency_ms: opts.startedAt ? Date.now() - opts.startedAt : null,
  });
  if (logError) log("notifications insert failed:", logError.message);
  return result;
}

/** Expired subscriptions (404/410) are removed; other failures are counted. */
async function bookkeeping(okIds: number[], failed: { id: number; failures: number; gone: boolean }[]): Promise<void> {
  const ops = [];
  if (okIds.length) ops.push(db.from("push_subscriptions").update({ failures: 0, last_success_at: new Date().toISOString() }).in("id", okIds));
  const gone = failed.filter((f) => f.gone).map((f) => f.id);
  if (gone.length) ops.push(db.from("push_subscriptions").delete().in("id", gone));
  for (const f of failed.filter((f) => !f.gone)) ops.push(db.from("push_subscriptions").update({ failures: f.failures + 1 }).eq("id", f.id));
  for (const { error } of await Promise.all(ops)) if (error) log("push_subscriptions update failed:", error.message);
}
