import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./lib/supabase";
import Login from "./pages/Login";
import Account from "./pages/Account";

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  if (session === undefined) return <div className="min-h-dvh bg-slate-950" />;
  if (!session) return <Login />;

  return (
    <main className="mx-auto min-h-dvh max-w-lg space-y-4 bg-slate-950 p-4 text-slate-100">
      <h1 className="text-2xl font-bold">Deal Hunter</h1>
      <p className="text-sm text-slate-400">Os ecrãs de deals, logs e pesquisas chegam na F5.</p>
      <Account email={session.user.email ?? ""} />
    </main>
  );
}
