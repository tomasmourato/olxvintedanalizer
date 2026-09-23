import { useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";
import { authMessage } from "../lib/auth";
import { Button, Field, Logo, Message } from "../components/ui";

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
    <main className="flex min-h-dvh items-center justify-center bg-black p-6 text-neutral-100">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4">
        <div className="mb-8 flex flex-col items-center gap-4 text-center">
          <Logo className="size-20" />
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Deal Hunter</h1>
            <p className="mt-1 text-sm text-neutral-500">Negócios de peças de PC no OLX e no Vinted.</p>
          </div>
        </div>
        <Field label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <Field label="Password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <Message kind="error" text={error} />}
        <Button type="submit" disabled={busy} className="w-full">
          {busy ? "A entrar…" : "Entrar"}
        </Button>
        <p className="text-center text-xs text-neutral-500">Esqueceste-te da password? Pede ao administrador para a repor.</p>
      </form>
    </main>
  );
}
