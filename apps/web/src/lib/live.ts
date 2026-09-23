// Data loading with live updates: Supabase Realtime + reload when the app comes back to the foreground.
import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import type { Row } from "@dh/shared";
import { supabase } from "./supabase";

type LiveTable = "settings" | "watches" | "matches" | "notifications" | "runs" | "worker_status" | "part_prices";

export const errorText = (e: unknown) =>
  e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String(e.message) : String(e);

/** Throws Supabase errors so callers can `await` plain data. */
export function must<R extends { data: unknown; error: { message: string } | null }>(r: R): Extract<R, { error: null }>["data"] {
  if (r.error) throw new Error(r.error.message);
  return r.data;
}

export function useQuery<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<string | null>(null);
  const loadRef = useRef(load);
  loadRef.current = load;
  const seq = useRef(0);

  const reload = useCallback(async () => {
    const n = ++seq.current;
    try {
      const d = await loadRef.current();
      if (n === seq.current) {
        setData(d);
        setError(null);
      }
    } catch (e) {
      if (n === seq.current) setError(errorText(e));
    }
  }, []);

  useEffect(() => void reload(), deps);

  // The realtime socket may have missed changes while the phone was asleep.
  useEffect(() => {
    const onVisible = () => document.visibilityState === "visible" && void reload();
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [reload]);

  return { data, error, reload, setData };
}

let channelSeq = 0;

export function useRealtime<T extends LiveTable>(table: T, onChange: (p: RealtimePostgresChangesPayload<Row<T>>) => void) {
  const ref = useRef(onChange);
  ref.current = onChange;
  useEffect(() => {
    const channel = supabase
      .channel(`live-${table}-${++channelSeq}`)
      .on<Row<T>>("postgres_changes", { event: "*", schema: "public", table }, (p) => ref.current(p))
      .subscribe();
    return () => void supabase.removeChannel(channel);
  }, [table]);
}

/** Collapses bursts (e.g. a cycle writing many matches) into one call. */
export function useDebounced(fn: () => void, ms = 800): () => void {
  const ref = useRef(fn);
  ref.current = fn;
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => ref.current(), ms);
  }, [ms]);
}

/** Re-renders every `ms` so relative times ("há 3 min") stay current. */
export function useNow(ms = 30_000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export function useHashRoute(): string[] {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const f = () => setHash(location.hash);
    addEventListener("hashchange", f);
    return () => removeEventListener("hashchange", f);
  }, []);
  return hash.replace(/^#\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
}

export const go = (path: string) => void (location.hash = `#/${path}`);

/** useState remembered in this browser (filters, open sections). Falls back to memory if storage is blocked. */
export function useStored<T extends object>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? initial : { ...initial, ...JSON.parse(raw) };
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (v: T) => {
      setValue(v);
      try {
        localStorage.setItem(key, JSON.stringify(v));
      } catch {
        // private mode: keep it in memory only
      }
    },
    [key],
  );
  return [value, set];
}
