// Settings and watches live in the DB and are edited from the PWA; Realtime pushes changes here.
import type { Settings, Watch } from "@dh/shared";
import { db } from "./db.js";
import { errorText, log } from "./util.js";

let settings: Settings | null = null;
let watches: Watch[] = [];

export const getSettings = (): Settings => {
  if (!settings) throw new Error("config not loaded");
  return settings;
};
export const getWatches = (): Watch[] => watches;

export async function loadConfig(): Promise<void> {
  const [s, w] = await Promise.all([
    db.from("settings").select("*").single(),
    db.from("watches").select("*").eq("active", true),
  ]);
  if (s.error) throw new Error(`settings: ${s.error.message}`);
  if (w.error) throw new Error(`watches: ${w.error.message}`);
  settings = s.data;
  watches = w.data;
}

/** Reload on every change to settings/watches, plus every 5 min in case a Realtime event is missed. */
export function watchConfig(): () => void {
  let timer: NodeJS.Timeout | undefined;
  const reload = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      loadConfig()
        .then(() => log(`config reloaded: ${watches.length} active watches`))
        .catch((e) => log("config reload failed:", errorText(e)));
    }, 500);
  };
  const channel = db
    .channel("config")
    .on("postgres_changes", { event: "*", schema: "public", table: "settings" }, reload)
    .on("postgres_changes", { event: "*", schema: "public", table: "watches" }, reload)
    .subscribe((status) => log("realtime config:", status));
  const poll = setInterval(reload, 5 * 60 * 1000);
  return () => {
    clearInterval(poll);
    clearTimeout(timer);
    void db.removeChannel(channel);
  };
}
