import { useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";
import { authMessage } from "../lib/auth";
import { Button, Field, Message } from "../components/ui";

export default function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) setError(authMessage(error));
    setBusy(false);
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-slate-950 p-6 text-slate-100">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4">
        <h1 className="text-center text-2xl font-bold">Deal Hunter</h1>
        <Field label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <Field label="Password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <Message kind="error" text={error} />}
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? "A entrar…" : "Entrar"}
        </Button>
        <p className="text-center text-xs text-slate-500">Esqueceste-te da password? Pede ao administrador para a repor.</p>
      </form>
    </main>
  );
}
