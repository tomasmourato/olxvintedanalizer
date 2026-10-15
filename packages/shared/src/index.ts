export type { Database, Json } from "./database.types.js";
import type { Database } from "./database.types.js";

type Tables = Database["public"]["Tables"];
export type Row<T extends keyof Tables> = Tables[T]["Row"];
export type Insert<T extends keyof Tables> = Tables[T]["Insert"];
export type Update<T extends keyof Tables> = Tables[T]["Update"];

export type Settings = Row<"settings">;
export type Watch = Row<"watches">;
export type Listing = Row<"listings">;
export type Match = Row<"matches">;
export type Run = Row<"runs">;
export type Notification = Row<"notifications">;
export type Purchase = Row<"purchases">;
export type WorkerStatus = Row<"worker_status">;
export type PushSubscriptionRow = Row<"push_subscriptions">;

export type Source = "olx" | "vinted";
export type Tier = "imperdivel" | "bom" | "normal";
export type WatchKind = "part" | "pc";
/** One part of a PC deal (matches.parts): its value is the friend's ("manual"), the market median ("mercado") or the AI's estimate ("ia"). */
export type PcPart = { type: string; label: string; key: string | null; value: number | null; source: "manual" | "mercado" | "ia" | null; samples: number };
export type { PushKind, PushPayload } from "./push.js";
export { clockIn, isActive } from "./time.js";
export { fmtEuros, fmtNumber } from "./format.js";
export { partWatch, type PartRef, type PartWatch } from "./partWatch.js";
