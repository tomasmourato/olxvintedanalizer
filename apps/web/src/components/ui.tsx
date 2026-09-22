import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

export function Field({ label, ...props }: { label: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm text-slate-400">{label}</span>
      <input
        className="w-full rounded-lg border border-slate-700 bg-slate-800 px-3 py-2 text-slate-100 outline-none focus:border-sky-500"
        {...props}
      />
    </label>
  );
}

export function Button({ variant = "primary", className = "", ...props }: { variant?: "primary" | "ghost" } & ButtonHTMLAttributes<HTMLButtonElement>) {
  const style =
    variant === "primary"
      ? "bg-sky-600 text-white hover:bg-sky-500"
      : "border border-slate-700 text-slate-300 hover:bg-slate-800";
  return <button className={`rounded-lg px-4 py-2 font-medium disabled:opacity-50 ${style} ${className}`} {...props} />;
}

export function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
      <h2 className="mb-3 font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export function Message({ kind, text }: { kind: "ok" | "error"; text: string }) {
  return <p className={`text-sm ${kind === "ok" ? "text-emerald-400" : "text-rose-400"}`}>{text}</p>;
}
