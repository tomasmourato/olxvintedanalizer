// Active hours, shared by the worker (scheduler) and the app (status screen).

/** "HH:MM" in the given time zone. */
export function clockIn(timeZone: string, now = new Date()): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
}

/** Inside [from, to) in local time; `from`/`to` are "HH:MM" or "HH:MM:SS". Handles windows past midnight. */
export function isActive(from: string, to: string, timeZone: string, now = new Date()): boolean {
  const t = clockIn(timeZone, now);
  const f = from.slice(0, 5);
  const e = to.slice(0, 5);
  return f <= e ? t >= f && t < e : t >= f || t < e;
}
