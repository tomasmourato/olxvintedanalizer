import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase";
import { syncSubscription } from "./lib/push";
import { must, useDebounced, useHashRoute, useNow, useQuery, useRealtime } from "./lib/live";
import Login from "./pages/Login";
import Deals from "./pages/Deals";
import Watches from "./pages/Watches";
import Notifications from "./pages/Notifications";
import Logs, { workerOnline } from "./pages/Logs";
import Settings from "./pages/Settings";

// Heroicons (MIT), outline 24px.
const TABS = [
  { path: "negocios", label: "Negócios", icon: "M9.568 3H5.25A2.25 2.25 0 0 0 3 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 0 0 5.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 0 0 9.568 3ZM6 6h.008v.008H6V6Z" },
  { path: "pesquisas", label: "Pesquisas", icon: "m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" },
  { path: "alertas", label: "Alertas", icon: "M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" },
  { path: "logs", label: "Logs", icon: "M8.25 6.75h12M8.25 12h12m-12 5.25h12M3.75 6.75h.007v.008H3.75V6.75Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0ZM3.75 12h.007v.008H3.75V12Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm-.375 5.25h.007v.008H3.75v-.008Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" },
  { path: "definicoes", label: "Definições", icon: "M10.5 6h9.75M10.5 6a1.5 1.5 0 1 1-3 0m3 0a1.5 1.5 0 1 0-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-9.75 0h9.75" },
];

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session) syncSubscription().catch((e) => console.warn("push sync:", e));
  }, [session?.user.id]);

  if (session === undefined) return <div className="min-h-dvh bg-slate-950" />;
  if (!session) return <Login />;
  return <Shell email={session.user.email ?? ""} />;
}

function Shell({ email }: { email: string }) {
  const [page = "negocios", id] = useHashRoute();
  const tab = TABS.find((t) => t.path === page) ?? TABS[0];

  // App-wide: the header shows the worker state; Logs and Settings use both.
  const settings = useQuery(async () => must(await supabase.from("settings").select("*").single()), []);
  useRealtime("settings", useDebounced(settings.reload, 300));
  const worker = useQuery(async () => must(await supabase.from("worker_status").select("*").eq("id", "main").maybeSingle()), []);
  useRealtime("worker_status", (p) => p.eventType !== "DELETE" && worker.setData(p.new));
  const now = useNow();
  const online = workerOnline(worker.data, now);

  useEffect(() => {
    window.scrollTo(0, 0); // returns a Promise in recent Chromium, so not the effect's return value
  }, [tab.path, id]);

  return (
    <div className="min-h-dvh bg-slate-950 text-slate-100">
      <header className="sticky top-0 z-20 border-b border-slate-800 bg-slate-950/90 pt-[env(safe-area-inset-top)] backdrop-blur">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-4 py-3">
          <h1 className="text-lg font-bold">{tab.label}</h1>
          {worker.data !== undefined && (
            <a href="#/logs" className="flex items-center gap-1.5 text-xs text-slate-400">
              <span className={`size-2 rounded-full ${online ? "bg-emerald-400" : "bg-rose-500"}`} />
              Worker {online ? "online" : "offline"}
            </a>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-2xl p-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))]">
        {tab.path === "negocios" && <Deals />}
        {tab.path === "pesquisas" && <Watches id={id} />}
        {tab.path === "alertas" && <Notifications />}
        {tab.path === "logs" && <Logs worker={worker.data} settings={settings.data} />}
        {tab.path === "definicoes" && <Settings settings={settings.data} email={email} onSaved={settings.reload} />}
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-800 bg-slate-950/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
        <div className="mx-auto grid h-16 max-w-2xl grid-cols-5">
          {TABS.map((t) => (
            <a
              key={t.path}
              href={`#/${t.path}`}
              aria-current={t === tab ? "page" : undefined}
              className={`flex flex-col items-center justify-center gap-0.5 ${t === tab ? "text-sky-400" : "text-slate-500 hover:text-slate-300"}`}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" className="size-6" aria-hidden>
                <path d={t.icon} />
              </svg>
              <span className="text-[11px]">{t.label}</span>
            </a>
          ))}
        </div>
      </nav>
    </div>
  );
}
