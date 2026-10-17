/**
 * Componentes base de la interfaz (mismo formato que InfraTrack). Todas las pantallas se
 * arman con estas piezas: encabezado con una línea de ayuda, pocos indicadores, tablas
 * cortas y estados vacíos que indican el próximo paso.
 */
import React, { useEffect } from "react";
import { X } from "lucide-react";

export const cx = (...classes: (string | false | null | undefined)[]) => classes.filter(Boolean).join(" ");

/* ─── Estructura de página ─────────────────────────────────────────────── */

export function Page({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cx("mx-auto w-full max-w-7xl space-y-6 pb-12", className)}>{children}</div>;
}

export function PageHeader({
  title,
  help,
  actions,
}: {
  title: React.ReactNode;
  help?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        <h1 className="truncate text-xl font-semibold text-slate-900 sm:text-2xl">{title}</h1>
        {help && <p className="mt-1 text-sm text-slate-500">{help}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({
  children,
  className,
  title,
  action,
  padded = true,
}: {
  children: React.ReactNode;
  className?: string;
  title?: React.ReactNode;
  action?: React.ReactNode;
  padded?: boolean;
}) {
  return (
    <section className={cx("rounded-2xl border border-slate-200 bg-white shadow-xs", className)}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 border-b border-slate-100 px-5 py-3.5">
          <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
          {action}
        </header>
      )}
      <div className={padded ? "p-5" : undefined}>{children}</div>
    </section>
  );
}

/* ─── Indicadores ──────────────────────────────────────────────────────── */

export type Tone = "neutral" | "good" | "warn" | "bad" | "brand";

const TONE_TEXT: Record<Tone, string> = {
  neutral: "text-slate-900",
  good: "text-emerald-700",
  warn: "text-amber-700",
  bad: "text-rose-700",
  brand: "text-brand-700",
};
const TONE_DOT: Record<Tone, string> = {
  neutral: "bg-slate-300",
  good: "bg-emerald-500",
  warn: "bg-amber-500",
  bad: "bg-rose-500",
  brand: "bg-brand-500",
};

export function Stat({
  label,
  value,
  hint,
  tone = "neutral",
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  hint?: React.ReactNode;
  tone?: Tone;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
      <p className="flex items-center gap-2 text-xs font-medium text-slate-500">
        {tone !== "neutral" && <span className={cx("h-2 w-2 rounded-full", TONE_DOT[tone])} />}
        {label}
      </p>
      <p className={cx("mt-2 text-2xl font-semibold tabular-nums tracking-tight", TONE_TEXT[tone])}>{value}</p>
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export function StatGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">{children}</div>;
}

/* ─── Controles ────────────────────────────────────────────────────────── */

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
const BUTTON: Record<ButtonVariant, string> = {
  primary: "bg-brand-600 text-white hover:bg-brand-700 shadow-xs",
  secondary: "border border-slate-200 bg-white text-slate-700 hover:bg-slate-50",
  ghost: "text-slate-600 hover:bg-slate-100",
  danger: "bg-rose-600 text-white hover:bg-rose-700",
};

export function Button({
  variant = "secondary",
  size = "md",
  icon,
  className,
  children,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: "sm" | "md";
  icon?: React.ReactNode;
}) {
  return (
    <button
      {...props}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-xl font-medium transition disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "px-2.5 py-1.5 text-xs" : "px-3.5 py-2 text-sm",
        BUTTON[variant],
        className
      )}
    >
      {icon}
      {children}
    </button>
  );
}

const BADGE: Record<Tone, string> = {
  neutral: "bg-slate-100 text-slate-700",
  good: "bg-emerald-50 text-emerald-700",
  warn: "bg-amber-50 text-amber-800",
  bad: "bg-rose-50 text-rose-700",
  brand: "bg-brand-50 text-brand-700",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: React.ReactNode }) {
  return <span className={cx("inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium", BADGE[tone])}>{children}</span>;
}

/** Estados (pedidos, órdenes, solicitudes): pastilla redondeada con punto de color. */
export type PillTone = Tone | "info" | "violet";
const PILL: Record<PillTone, { box: string; dot: string }> = {
  neutral: { box: "bg-slate-100 text-slate-700 ring-slate-200", dot: "bg-slate-400" },
  info: { box: "bg-sky-50 text-sky-800 ring-sky-200", dot: "bg-sky-500" },
  violet: { box: "bg-violet-50 text-violet-800 ring-violet-200", dot: "bg-violet-500" },
  warn: { box: "bg-amber-50 text-amber-800 ring-amber-200", dot: "bg-amber-500" },
  good: { box: "bg-emerald-50 text-emerald-800 ring-emerald-200", dot: "bg-emerald-500" },
  bad: { box: "bg-rose-50 text-rose-700 ring-rose-200", dot: "bg-rose-500" },
  brand: { box: "bg-brand-50 text-brand-700 ring-brand-200", dot: "bg-brand-500" },
};

export function StatusPill({ tone = "neutral", children }: { tone?: PillTone; children: React.ReactNode }) {
  return (
    <span className={cx("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset", PILL[tone].box)}>
      <span className={cx("h-1.5 w-1.5 rounded-full", PILL[tone].dot)} />
      {children}
    </span>
  );
}

export function EmptyState({
  icon,
  title,
  help,
  action,
}: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  help?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
      {icon && <div className="mb-3 text-slate-300">{icon}</div>}
      <p className="text-sm font-semibold text-slate-800">{title}</p>
      {help && <p className="mt-1 max-w-md text-sm text-slate-500">{help}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/* ─── Formularios ──────────────────────────────────────────────────────── */

export const inputClass =
  "w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100";

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: React.ReactNode;
  hint?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={cx("block", className)}>
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
    </label>
  );
}

/* ─── Capas ────────────────────────────────────────────────────────────── */

function useEscape(onClose: () => void) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  size = "md",
}: {
  title: React.ReactNode;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  useEscape(onClose);
  const width = size === "sm" ? "max-w-md" : size === "xl" ? "max-w-6xl" : size === "lg" ? "max-w-3xl" : "max-w-xl";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div
        className={cx("flex max-h-[90vh] w-full flex-col rounded-2xl bg-white shadow-xl", width)}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100" aria-label="Cerrar">
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="space-y-4 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">{footer}</footer>}
      </div>
    </div>
  );
}
