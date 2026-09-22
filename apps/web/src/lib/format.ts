// Display helpers (pt-PT).
import { fmtEuros, fmtNumber, type Source, type Tier } from "@dh/shared";

const time = new Intl.DateTimeFormat("pt-PT", { hour: "2-digit", minute: "2-digit" });
const timeSec = new Intl.DateTimeFormat("pt-PT", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const day = new Intl.DateTimeFormat("pt-PT", { day: "numeric", month: "short" });

export const euros = (n: number | string | null | undefined) => (n == null ? "—" : fmtEuros(Number(n)));
export const pct = (n: number | string) => `${fmtNumber(Number(n))} %`;

/** "14:03" today, "ontem 14:03", "3 set 14:03" otherwise (seconds for logs). */
export function when(iso: string, seconds = false): string {
  const d = new Date(iso);
  const t = (seconds ? timeSec : time).format(d);
  const days = Math.round((startOfDay(new Date()) - startOfDay(d)) / 86_400_000);
  return days === 0 ? t : days === 1 ? `ontem ${t}` : `${day.format(d)} ${t}`;
}

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

export function ago(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return "agora";
  const m = Math.round(s / 60);
  if (m < 60) return `há ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `há ${h} h`;
  const d = Math.round(h / 24);
  return `há ${d} ${d === 1 ? "dia" : "dias"}`;
}

export const ms = (n: number) => (n < 1000 ? `${n} ms` : `${fmtNumber(Math.round(n / 100) / 10)} s`);

export const sourceLabel: Record<Source, string> = { olx: "OLX", vinted: "Vinted" };
export const tierLabel: Record<Tier, string> = { imperdivel: "Imperdível", bom: "Bom", normal: "Normal" };
