import { useEffect, useState } from "react";
import { disablePush, enablePush, pushState, sendTestPush, type PushState } from "../lib/push";
import { Button, Card, Dot, Message } from "./ui";

type Status = { kind: "ok" | "error"; text: string } | null;

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function PushCard({ onChange }: { onChange?: () => void }) {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  useEffect(() => {
    pushState().then(setState, () => setState("unsupported"));
  }, []);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setStatus(null);
    try {
      await action();
    } catch (e) {
      setStatus({ kind: "error", text: errorText(e) });
    }
    setBusy(false);
  }

  const enable = () =>
    run(async () => {
      const s = await enablePush();
      setState(s);
      onChange?.();
      if (s === "on") setStatus({ kind: "ok", text: "Notificações ativas neste dispositivo." });
    });
  const disable = () =>
    run(async () => {
      setState(await disablePush());
      onChange?.();
    });
  const test = () =>
    run(async () => {
      const r = await sendTestPush();
      setStatus(
        r.status === "sent"
          ? { kind: "ok", text: "Enviado. Deve aparecer dentro de segundos." }
          : { kind: "error", text: `Não foi enviado: ${r.error ?? r.status}` },
      );
    });

  return (
    <Card title="Notificações">
      <div className="space-y-3 text-sm">
        {state === null && <p className="text-neutral-400">A verificar…</p>}
        {state === "unsupported" && <p className="text-neutral-400">Este navegador não suporta notificações push.</p>}
        {state === "ios-install" && (
          <div className="space-y-2 text-neutral-300">
            <p>No iPhone, as notificações só funcionam com a app instalada no ecrã principal (iOS 16.4 ou mais recente):</p>
            <ol className="list-decimal space-y-1 pl-5 text-neutral-400">
              <li>No Safari, toca em <b className="text-neutral-200">Partilhar</b> (o quadrado com a seta).</li>
              <li>Escolhe <b className="text-neutral-200">Adicionar ao ecrã principal</b>.</li>
              <li>Abre a app a partir do ícone novo, entra e ativa as notificações aqui.</li>
            </ol>
          </div>
        )}
        {state === "denied" && (
          <p className="text-neutral-300">
            As notificações estão bloqueadas para esta app. Ativa-as nas definições do telemóvel (ou do navegador) e volta a abrir a app.
          </p>
        )}
        {state === "off" && (
          <>
            <p className="text-neutral-400">Recebe um alerta assim que aparecer um negócio imperdível.</p>
            <Button onClick={enable} disabled={busy}>{busy ? "A ativar…" : "Ativar notificações"}</Button>
          </>
        )}
        {state === "on" && (
          <>
            <p className="flex items-center gap-2 text-neutral-200"><Dot on />Ativas neste dispositivo.</p>
            <div className="flex flex-wrap gap-2">
              <Button onClick={test} disabled={busy}>{busy ? "A enviar…" : "Enviar push de teste"}</Button>
              <Button variant="ghost" onClick={disable} disabled={busy}>Desativar</Button>
            </div>
          </>
        )}
        {status && <Message {...status} />}
      </div>
    </Card>
  );
}
