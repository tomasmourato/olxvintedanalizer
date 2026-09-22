import { useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";

const inputClass =
  "w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-slate-100 outline-none focus:border-sky-500 disabled:opacity-50";

function Label({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm text-slate-400">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
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
    primary: "bg-sky-600 text-white hover:bg-sky-500",
    ghost: "border border-slate-700 text-slate-300 hover:bg-slate-800",
    danger: "border border-rose-800 text-rose-300 hover:bg-rose-950",
  }[variant];
  return <button type="button" className={`rounded-lg px-4 py-2 font-medium disabled:opacity-50 ${style} ${className}`} {...props} />;
}

export function Card({ title, actions, children }: { title?: ReactNode; actions?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      {(title || actions) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="font-semibold">{title}</h2>
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

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-8 text-center text-sm text-slate-500">{children}</p>;
}

export function Loading({ error }: { error?: string | null }) {
  return error ? <Message kind="error" text={`Erro: ${error}`} /> : <Empty>A carregar…</Empty>;
}

const tones = {
  slate: "bg-slate-800 text-slate-300",
  sky: "bg-sky-950 text-sky-300",
  emerald: "bg-emerald-950 text-emerald-300",
  amber: "bg-amber-950 text-amber-300",
  orange: "bg-orange-600 text-white",
  rose: "bg-rose-950 text-rose-300",
};
export type Tone = keyof typeof tones;

export function Badge({ tone = "slate", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap ${tones[tone]}`}>{children}</span>;
}

export function Toggle({ label, hint, checked, onChange, disabled }: { label: ReactNode; hint?: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <p className="text-sm text-slate-200">{label}</p>
        {hint && <p className="text-xs text-slate-500">{hint}</p>}
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
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-50 ${checked ? "bg-sky-600" : "bg-slate-700"}`}
    >
      <span className={`absolute top-0.5 left-0.5 size-5 rounded-full bg-white transition-transform ${checked ? "translate-x-5" : ""}`} />
    </button>
  );
}

/** Pill buttons for one choice out of a few. */
export function Segmented<T extends string>({ options, value, onChange }: { options: [T, string][]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={`rounded-full px-3 py-1 text-sm ${v === value ? "bg-sky-600 text-white" : "bg-slate-800 text-slate-300 hover:bg-slate-700"}`}
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
      <p className="mb-1 text-sm text-slate-400">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            aria-pressed={value.includes(o.id)}
            onClick={() => toggle(o.id)}
            className={`rounded-full border px-3 py-1 text-sm ${value.includes(o.id) ? "border-sky-500 bg-sky-950 text-sky-200" : "border-slate-700 text-slate-400 hover:bg-slate-800"}`}
          >
            {o.name}
          </button>
        ))}
      </div>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
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
      <label className="mb-1 block text-sm text-slate-400" htmlFor={`tags-${label}`}>{label}</label>
      <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 focus-within:border-sky-500">
        {value.map((t) => (
          <span key={t} className="inline-flex items-center gap-1 rounded bg-slate-700 py-0.5 pr-1 pl-2 text-sm text-slate-100">
            {t}
            <button type="button" aria-label={`Remover ${t}`} onClick={() => onChange(value.filter((x) => x !== t))} className="px-1 text-slate-400 hover:text-white">
              ×
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
          className="min-w-28 flex-1 bg-transparent px-1 py-1 text-slate-100 outline-none"
        />
      </div>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export function Select<T extends string>({ label, value, onChange, options }: { label: string; value: T; onChange: (v: T) => void; options: [T, string][] }) {
  return (
    <label className="block min-w-0">
      <span className="mb-0.5 block text-xs text-slate-500">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as T)}
        className="w-full truncate rounded-lg border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm text-slate-100 outline-none focus:border-sky-500"
      >
        {options.map(([v, text]) => (
          <option key={v} value={v}>{text}</option>
        ))}
      </select>
    </label>
  );
}
