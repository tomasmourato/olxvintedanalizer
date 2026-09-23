import { useState, type FormEvent } from "react";
import { supabase } from "../lib/supabase";
import { authMessage, verifyPassword } from "../lib/auth";
import { Button, Card, Field, Message } from "../components/ui";

type Status = { kind: "ok" | "error"; text: string } | null;

function ChangeEmail({ email }: { email: string }) {
  const [newEmail, setNewEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const target = newEmail.trim().toLowerCase();
    if (target === email.toLowerCase()) return setStatus({ kind: "error", text: "Esse já é o teu email." });
    setBusy(true);
    setStatus(null);
    const wrong = await verifyPassword(email, password);
    if (wrong) {
      setStatus({ kind: "error", text: wrong });
    } else {
      const { data, error } = await supabase.auth.updateUser({ email: target });
      if (error) setStatus({ kind: "error", text: authMessage(error) });
      else if (data.user.email === target) {
        setStatus({ kind: "ok", text: `Email alterado para ${target}.` });
        setNewEmail("");
        setPassword("");
      } else setStatus({ kind: "ok", text: `Enviámos um email de confirmação para ${target}.` });
    }
    setBusy(false);
  }

  return (
    <Card title="Mudar email">
      <form onSubmit={submit} className="space-y-3">
        <p className="text-sm text-neutral-400">Atual: {email}</p>
        <Field label="Novo email" type="email" autoComplete="email" required value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
        <Field label="Password atual" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        {status && <Message {...status} />}
        <Button type="submit" disabled={busy}>{busy ? "A guardar…" : "Mudar email"}</Button>
      </form>
    </Card>
  );
}

function ChangePassword({ email }: { email: string }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (next !== repeat) return setStatus({ kind: "error", text: "As passwords novas não coincidem." });
    setBusy(true);
    setStatus(null);
    const wrong = await verifyPassword(email, current);
    if (wrong) {
      setStatus({ kind: "error", text: wrong });
    } else {
      const { error } = await supabase.auth.updateUser({ password: next });
      if (error) setStatus({ kind: "error", text: authMessage(error) });
      else {
        setStatus({ kind: "ok", text: "Password alterada." });
        setCurrent("");
        setNext("");
        setRepeat("");
      }
    }
    setBusy(false);
  }

  return (
    <Card title="Mudar password">
      <form onSubmit={submit} className="space-y-3">
        <Field label="Password atual" type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
        <Field label="Nova password" type="password" autoComplete="new-password" required minLength={6} value={next} onChange={(e) => setNext(e.target.value)} />
        <Field label="Repetir nova password" type="password" autoComplete="new-password" required minLength={6} value={repeat} onChange={(e) => setRepeat(e.target.value)} />
        {status && <Message {...status} />}
        <Button type="submit" disabled={busy}>{busy ? "A guardar…" : "Mudar password"}</Button>
      </form>
    </Card>
  );
}

export default function Account({ email }: { email: string }) {
  return (
    <div className="space-y-4">
      <ChangeEmail email={email} />
      <ChangePassword email={email} />
      <Button variant="ghost" onClick={() => supabase.auth.signOut()}>Terminar sessão</Button>
    </div>
  );
}
