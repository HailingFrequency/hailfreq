import type { ButtonHTMLAttributes, ReactNode } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "ghost";
  children: ReactNode;
}

export function Button({ variant = "primary", className = "", children, ...rest }: ButtonProps) {
  const base =
    "inline-flex items-center justify-center rounded px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";
  const variants = {
    primary: "bg-brand-500 text-slate-900 hover:bg-brand-400",
    ghost: "border border-slate-700 text-slate-200 hover:bg-slate-800",
  };
  return (
    <button className={`${base} ${variants[variant]} ${className}`} {...rest}>
      {children}
    </button>
  );
}
