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
import { Dot, Icon, Logo } from "./components/ui";
import PullToRefresh from "./components/PullToRefresh";
import type { IconName } from "./components/icons";

const TABS: { path: string; label: string; icon: IconName }[] = [
  { path: "negocios", label: "Negócios", icon: "tag" },
  { path: "pesquisas", label: "Pesquisas", icon: "search" },
  { path: "alertas", label: "Alertas", icon: "bell" },
  { path: "logs", label: "Logs", icon: "list" },
  { path: "definicoes", label: "Definições", icon: "sliders" },
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

  if (session === undefined) return <div className="min-h-dvh bg-black" />;
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
    <div className="min-h-dvh overflow-x-clip bg-black text-neutral-100">
      <PullToRefresh />
      <header className="sticky top-0 z-20 border-b border-neutral-900 bg-black/80 pt-[env(safe-area-inset-top)] backdrop-blur-md">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-2.5">
            <Logo className="size-8" />
            <h1 className="text-lg font-semibold tracking-tight">{tab.label}</h1>
          </div>
          {worker.data !== undefined && (
            <a href="#/logs" className="flex items-center gap-1.5 rounded-full border border-neutral-800 px-2.5 py-1 text-xs text-neutral-400">
              <Dot on={online} />
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

      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-neutral-900 bg-black/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-md">
        <div className="mx-auto grid h-16 max-w-2xl grid-cols-5">
          {TABS.map((t) => (
            <a
              key={t.path}
              href={`#/${t.path}`}
              aria-current={t === tab ? "page" : undefined}
              className={`relative flex flex-col items-center justify-center gap-1 transition-colors ${t === tab ? "text-white" : "text-neutral-500 hover:text-neutral-300"}`}
            >
              {t === tab && <span className="absolute top-0 h-0.5 w-8 rounded-full bg-white" />}
              <Icon name={t.icon} className="size-6" strokeWidth={t === tab ? 2 : 1.5} />
              <span className={`text-[11px] ${t === tab ? "font-semibold" : ""}`}>{t.label}</span>
            </a>
          ))}
        </div>
      </nav>
    </div>
  );
}
