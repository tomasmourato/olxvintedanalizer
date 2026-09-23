// Push from the cloud, for what must work while the worker is down: the test button in the PWA
// (signed-in user) and the watchdog ("Worker offline", called by pg_cron via public.worker_watchdog()).
// Deals are pushed by the worker itself (apps/worker/src/push.ts), same payload and logging.
// Secrets (supabase secrets set): VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, PUSH_FN_SECRET (also in Vault as
// push_fn_secret). Deployed with verify_jwt = false: this checks the cron secret or the user's token itself.
import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const env = (k: string) => Deno.env.get(k) ?? "";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
webpush.setVapidDetails(env("VAPID_SUBJECT") || "https://olxvintedanalizer.pages.dev", env("VAPID_PUBLIC_KEY"), env("VAPID_PRIVATE_KEY"));

type Payload = { title: string; body: string; url: string; tag?: string };
type Kind = "test" | "worker_offline";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "use POST" }, 405);
  const input = await req.json().catch(() => ({}));
  const secret = env("PUSH_FN_SECRET");

  if (secret && req.headers.get("x-cron-secret") === secret) {
    const since = input.heartbeat_at
      ? new Date(input.heartbeat_at).toLocaleString("pt-PT", { timeZone: input.timezone || "Europe/Lisbon", dateStyle: "short", timeStyle: "short" })
      : null;
    return json(await send("worker_offline", {
      title: "Worker offline",
      body: since ? `Sem sinal desde ${since}. Vê se o PC está ligado e o worker a correr.` : "O worker ainda não deu sinal hoje.",
      url: "/",
      tag: "worker-offline",
    }));
  }

  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "");
  const { data } = token ? await db.auth.getUser(token) : { data: { user: null } };
  if (!data.user) return json({ error: "não autenticado" }, 401);
  return json(await send("test", {
    title: "Push de teste",
    body: "As notificações estão a funcionar neste dispositivo.",
    url: "/",
    tag: "test",
  }, typeof input.endpoint === "string" ? input.endpoint : undefined));
});

/** Sends to every device (or just `endpoint`), cleans up dead subscriptions, logs the result. */
async function send(kind: Kind, payload: Payload, endpoint?: string) {
  let q = db.from("push_subscriptions").select("id, endpoint, p256dh, auth, label, failures");
  if (endpoint) q = q.eq("endpoint", endpoint);
  const { data: subs, error } = await q;

  let ok = 0;
  const errors: string[] = [];
  if (error) errors.push(`subscrições: ${error.message}`);
  else if (!subs.length) errors.push(endpoint ? "este dispositivo não está subscrito" : "nenhum dispositivo subscrito");
  else {
    const body = JSON.stringify({ ...payload, ts: Date.now() });
    await Promise.all(subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, body, { TTL: 3600, urgency: "high", timeout: 5000 });
        ok++;
        await db.from("push_subscriptions").update({ failures: 0, last_success_at: new Date().toISOString() }).eq("id", s.id);
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        errors.push(`${s.label ?? `#${s.id}`}: ${e instanceof Error ? e.message : String(e)}`);
        if (code === 404 || code === 410) await db.from("push_subscriptions").delete().eq("id", s.id);
        else await db.from("push_subscriptions").update({ failures: s.failures + 1 }).eq("id", s.id);
      }
    }));
  }

  const failed = (subs?.length ?? 0) - ok;
  const result = {
    status: ok && !failed ? "sent" : ok ? "partial" : "failed",
    devices_ok: ok,
    devices_failed: failed,
    error: errors.join("; ").slice(0, 500) || null,
  };
  const log = await db.from("notifications").insert({ kind, title: payload.title, body: payload.body, url: payload.url, ...result });
  if (log.error) console.error("notifications insert failed:", log.error.message);
  return result;
}
