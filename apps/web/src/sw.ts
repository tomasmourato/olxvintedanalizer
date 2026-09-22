/// <reference lib="webworker" />
// Service worker: app shell precache + push notifications (payload: PushPayload from @dh/shared).
import type { PushPayload } from "@dh/shared";
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";

declare let self: ServiceWorkerGlobalScope;

self.skipWaiting();
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
registerRoute(new NavigationRoute(createHandlerBoundToURL("index.html")));

self.addEventListener("push", (event) => {
  let p: PushPayload;
  try {
    p = event.data!.json() as PushPayload;
  } catch {
    p = { title: "Deal Hunter", body: event.data?.text() ?? "", url: "/" };
  }
  // iOS drops the subscription if a push does not show a notification, so always show one.
  event.waitUntil(
    self.registration.showNotification(p.title, {
      body: p.body,
      icon: "/pwa-192.png",
      badge: "/badge-96.png",
      tag: p.tag,
      data: { url: p.url },
      // Not in TS's lib yet; Android uses them.
      ...{ image: p.image, renotify: !!p.tag, timestamp: p.ts },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data as { url?: string } | null)?.url ?? "/", self.location.origin);
  event.waitUntil(
    (async () => {
      if (url.origin === self.location.origin) {
        const [win] = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
        if (win) {
          const w = (await win.navigate(url.href).catch(() => null)) ?? win;
          return void (await w.focus());
        }
      }
      await self.clients.openWindow(url.href);
    })(),
  );
});
