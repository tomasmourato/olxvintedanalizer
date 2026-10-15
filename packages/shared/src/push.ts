/** The JSON the service worker receives. Sent by the worker (deals) and the `push` Edge Function (test, watchdog). */
export type PushPayload = {
  title: string;
  body: string;
  /** Opened on tap: the listing, or a page of the app. */
  url: string;
  /** Listing photo: Android shows it large, iOS ignores it. */
  image?: string;
  /** Same tag replaces the previous notification (e.g. a later price drop of the same listing). */
  tag?: string;
  ts?: number;
};

export type PushKind = "deal" | "price_drop" | "worker_offline" | "test" | "bought" | "buy_failed" | "buy_sca";
