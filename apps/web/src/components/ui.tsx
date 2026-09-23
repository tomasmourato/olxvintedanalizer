import { useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";
import { EURO, ICONS, type IconName } from "./icons";

const inputClass =
  "w-full rounded-xl border border-neutral-800 bg-neutral-900 px-3 py-2 text-white outline-none transition-colors placeholder:text-neutral-600 focus:border-white disabled:opacity-50";

export function Icon({ name, className = "size-5", strokeWidth = 1.5 }: { name: IconName; className?: string; strokeWidth?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 ${className}`} aria-hidden>
      <path d={ICONS[name]} />
    </svg>
  );
}

/** White € on a black rounded square; size via className (e.g. size-8). */
export function Logo({ className = "size-8" }: { className?: string }) {
  return (
    <span className={`grid shrink-0 place-items-center rounded-[22%] bg-black ring-1 ring-neutral-800 ${className}`} aria-hidden>
      <svg viewBox="0 0 609.4 747.1" fill="#fff" className="h-1/2">
        <path d={EURO} />
      </svg>
    </span>
  );
}

function Label({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm text-neutral-400">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-neutral-500">{hint}</span>}
    </label>
  );
}

export function Field({ label, hint, ...props }: { label: string; hint?: ReactNode } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <Label label={label} hint={hint}>
      <input className={inputClass} {...props} />
    </Label>
  );
}

export function TextArea({ label, hint, ...props }: { label: string; hint?: ReactNode } & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <Label label={label} hint={hint}>
      <textarea className={`${inputClass} min-h-24`} {...props} />
    </Label>
  );
}

export function Button({ variant = "primary", className = "", ...props }: { variant?: "primary" | "ghost" | "danger" } & ButtonHTMLAttributes<HTMLButtonElement>) {
  const style = {
    primary: "bg-white text-black hover:bg-neutral-200",
    ghost: "border border-neutral-700 text-neutral-200 hover:bg-neutral-900",
    danger: "border border-rose-900 text-rose-400 hover:bg-rose-950/60",
  }[variant];
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center gap-1.5 rounded-xl px-4 py-2 font-semibold transition active:scale-[.98] disabled:pointer-events-none disabled:opacity-50 ${style} ${className}`}
      {...props}
    />
  );
}

export function Card({ title, actions, children }: { title?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-2xl border border-neutral-800 bg-neutral-950 p-4">
      {(title || actions) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="font-semibold tracking-tight">{title}</h2>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function Message({ kind, text }: { kind: "ok" | "error"; text: string }) {
  return <p className={`text-sm ${kind === "ok" ? "text-emerald-400" : "text-rose-400"}`}>{text}</p>;
}

export function Empty({ icon, children }: { icon?: IconName; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-neutral-500">
      {icon && <Icon name={icon} className="size-8 text-neutral-700" />}
      <p>{children}</p>
    </div>
  );
}

export function Loading({ error }: { error?: string | null }) {
  return error ? <Message kind="error" text={`Erro: ${error}`} /> : <Empty>A carregar…</Empty>;
}

const tones = {
  neutral: "bg-neutral-800 text-neutral-300",
  outline: "text-neutral-200 ring-1 ring-neutral-600 ring-inset",
  invert: "bg-white text-black",
  ok: "bg-emerald-950 text-emerald-300",
  danger: "bg-rose-950 text-rose-300",
};
export type Tone = keyof typeof tones;

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium whitespace-nowrap ${tones[tone]}`}>{children}</span>;
}

/** Green (online) or red (offline) status dot. */
export function Dot({ on }: { on: boolean }) {
  return <span className={`size-1.5 shrink-0 rounded-full ${on ? "bg-emerald-400" : "bg-rose-500"}`} />;
}

export function Toggle({ label, hint, checked, onChange, disabled }: { label: ReactNode; hint?: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="text-sm text-neutral-200">{label}</p>
        {hint && <p className="text-xs text-neutral-500">{hint}</p>}
      </div>
      <Switch checked={checked} onChange={onChange} disabled={disabled} label={typeof label === "string" ? label : undefined} />
    </div>
  );
}

export function Switch({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${checked ? "bg-white" : "bg-neutral-800"}`}
    >
      <span className={`absolute top-0.5 left-0.5 size-5 rounded-full transition ${checked ? "translate-x-5 bg-black" : "bg-neutral-400"}`} />
    </button>
  );
}

/** Pill buttons for one choice out of a few. */
export function Segmented<T extends string>({ options, value, onChange }: { options: [T, string][]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-full border border-neutral-800 bg-neutral-950 p-1">
      {options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${v === value ? "bg-white text-black" : "text-neutral-400 hover:text-white"}`}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

/** Multi-select pills (e.g. categories). */
export function PickList<T extends string | number>({ label, hint, options, value, onChange }: { label: string; hint?: ReactNode; options: { id: T; name: string }[]; value: T[]; onChange: (v: T[]) => void }) {
  const toggle = (id: T) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  return (
    <div>
      <p className="mb-1 text-sm text-neutral-400">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            aria-pressed={value.includes(o.id)}
            onClick={() => toggle(o.id)}
            className={`rounded-full border px-3 py-1 text-sm transition-colors ${value.includes(o.id) ? "border-white bg-white font-medium text-black" : "border-neutral-800 text-neutral-400 hover:border-neutral-600"}`}
          >
            {o.name}
          </button>
        ))}
      </div>
      {hint && <p className="mt-1 text-xs text-neutral-500">{hint}</p>}
    </div>
  );
}

/** Words as removable chips; Enter or comma adds, pending text is kept on blur. */
export function TagInput({ label, hint, value, onChange, placeholder, clean = (s) => s.trim().replace(/\s+/g, " ") }: {
  label: string;
  hint?: ReactNode;
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  clean?: (s: string) => string;
}) {
  const [text, setText] = useState("");
  const add = (raw: string) => {
    const items = raw.split(",").map(clean).filter((t, i, all) => t && !value.includes(t) && all.indexOf(t) === i);
    if (items.length) onChange([...value, ...items]);
    setText("");
  };
  return (
    <div>
      <label className="mb-1 block text-sm text-neutral-400" htmlFor={`tags-${label}`}>{label}</label>
      <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-neutral-800 bg-neutral-900 px-2 py-1.5 transition-colors focus-within:border-white">
        {value.map((t) => (
          <span key={t} className="inline-flex items-center gap-0.5 rounded-lg bg-neutral-800 py-0.5 pr-1 pl-2 text-sm text-neutral-100">
            {t}
            <button type="button" aria-label={`Remover ${t}`} onClick={() => onChange(value.filter((x) => x !== t))} className="p-0.5 text-neutral-500 hover:text-white">
              <Icon name="xMark" className="size-3.5" strokeWidth={2} />
            </button>
          </span>
        ))}
        <input
          id={`tags-${label}`}
          value={text}
          enterKeyHint="done"
          placeholder={value.length ? "" : placeholder}
          onChange={(e) => (e.target.value.includes(",") ? add(e.target.value) : setText(e.target.value))}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add(text);
            } else if (e.key === "Backspace" && !text && value.length) onChange(value.slice(0, -1));
          }}
          onBlur={() => text.trim() && add(text)}
          className="min-w-28 flex-1 bg-transparent px-1 py-1 text-white outline-none placeholder:text-neutral-600"
        />
      </div>
      {hint && <p className="mt-1 text-xs text-neutral-500">{hint}</p>}
    </div>
  );
}

export function Select<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <label className="block min-w-0">
      <span className="mb-0.5 block text-xs text-neutral-500">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="w-full truncate rounded-xl border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-sm text-white outline-none transition-colors focus:border-white"
      >
        {options.map(([v, text]) => (
          <option key={v} value={v}>{text}</option>
        ))}
      </select>
    </label>
  );
}
