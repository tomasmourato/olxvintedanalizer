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
export type WorkerStatus = Row<"worker_status">;
export type PushSubscriptionRow = Row<"push_subscriptions">;

export type Source = "olx" | "vinted";
export type Tier = "imperdivel" | "bom" | "normal";
export type { PushKind, PushPayload } from "./push.js";
