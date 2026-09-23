// Web push on this device: permission, subscription (saved in push_subscriptions) and the test push.
import { registerSW } from "virtual:pwa-register";
import { supabase } from "./supabase";

// Public by design. The private key lives in the worker's .env and the push Edge Function secrets.
export const VAPID_PUBLIC_KEY = "BNYW1O6rYq4CjGfnYEnmzlsyJDQ4jiQ6tbp0o2Qca9C2Xu4V59OZoA5ZgK8eTIQRx9kBwED8TLrHVgGQWoqE5m0";

export type PushState = "unsupported" | "ios-install" | "denied" | "off" | "on";

const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const isStandalone = () => matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;

export function registerServiceWorker(): void {
  if ("serviceWorker" in navigator) registerSW({ immediate: true });
}

/** Pull-to-refresh: fetch a newer app version first (if any), then reload the page. */
export async function reloadApp(): Promise<void> {
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    await reg?.update();
    const next = reg?.installing ?? reg?.waiting;
    if (next) {
      await new Promise((resolve) => {
        next.addEventListener("statechange", () => next.state === "activated" && resolve(null));
        setTimeout(resolve, 4000);
      });
    }
  } catch {
    // offline or no service worker: a plain reload still refreshes the data
  }
  location.reload();
}

export async function pushState(): Promise<PushState> {
  // iOS only offers push to the app installed on the home screen (16.4+).
  if (isIos() && !isStandalone()) return "ios-install";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  const sub = await currentSubscription();
  return sub && Notification.permission === "granted" ? "on" : "off";
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

/** This device's push endpoint, to mark it in the device list. */
export async function currentEndpoint(): Promise<string | null> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return null;
  return (await currentSubscription())?.endpoint ?? null;
}

export async function enablePush(): Promise<PushState> {
  if ((await Notification.requestPermission()) !== "granted") return pushState();
  const reg = await navigator.serviceWorker.ready;
  const key = base64UrlToBytes(VAPID_PUBLIC_KEY);
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub, key)) {
    await sub.unsubscribe();
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  await saveSubscription(sub);
  return "on";
}

export async function disablePush(): Promise<PushState> {
  const sub = await currentSubscription();
  if (sub) {
    const { error } = await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
    if (error) throw new Error(error.message);
    await sub.unsubscribe();
  }
  return pushState();
}

/** On every app start: the row may have been removed (expired) or the endpoint rotated. */
export async function syncSubscription(): Promise<void> {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || Notification.permission !== "granted") return;
  const sub = await currentSubscription();
  if (sub) await saveSubscription(sub);
}

async function saveSubscription(sub: PushSubscription): Promise<void> {
  const { keys } = sub.toJSON();
  if (!keys?.p256dh || !keys.auth) throw new Error("subscrição sem chaves");
  const { error } = await supabase
    .from("push_subscriptions")
    .upsert(
      { endpoint: sub.endpoint, p256dh: keys.p256dh, auth: keys.auth, label: deviceLabel(), user_agent: navigator.userAgent, failures: 0 },
      { onConflict: "endpoint" },
    );
  if (error) throw new Error(error.message);
}

/** Sends a test push to this device through the `push` Edge Function. */
export async function sendTestPush(): Promise<{ status: string; error: string | null }> {
  const sub = await currentSubscription();
  const { data, error } = await supabase.functions.invoke("push", { body: { endpoint: sub?.endpoint } });
  if (error) throw new Error(error.message);
  return data;
}

function deviceLabel(): string {
  const ua = navigator.userAgent;
  const device = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) || isIos() ? "iPad" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac/.test(ua) ? "Mac" : "Outro";
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "";
  return [device, browser].filter(Boolean).join(" · ") + (isStandalone() ? " (app)" : "");
}

function base64UrlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const raw = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

function sameKey(sub: PushSubscription, key: Uint8Array): boolean {
  const current = sub.options.applicationServerKey;
  if (!current) return false;
  const a = new Uint8Array(current);
  return a.length === key.length && a.every((b, i) => b === key[i]);
}
