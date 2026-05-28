import type { InputHTMLAttributes } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: string;
  error?: string;
}

export function Input({ label, hint, error, className = "", ...rest }: InputProps) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-slate-300">{label}</span>
      <input
        className={`rounded border border-slate-700 bg-slate-800 px-3 py-2 text-slate-100 placeholder:text-slate-500 focus:border-brand-500 focus:outline-none ${className}`}
        {...rest}
      />
      {hint && !error && <span className="text-xs text-slate-500">{hint}</span>}
      {error && <span className="text-xs text-rose-400">{error}</span>}
    </label>
  );
}
