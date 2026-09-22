import { useEffect, useState } from "react";
import { supabase } from "./lib/supabase";

export default function App() {
  const [session, setSession] = useState<"a verificar…" | "com sessão" | "sem sessão">("a verificar…");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session ? "com sessão" : "sem sessão"));
  }, []);

  return (
    <main className="min-h-dvh bg-slate-900 p-6 text-slate-100">
      <h1 className="text-2xl font-bold">Deal Hunter</h1>
      <p className="mt-2 text-slate-400">Em construção. Supabase: {session}.</p>
    </main>
  );
}
