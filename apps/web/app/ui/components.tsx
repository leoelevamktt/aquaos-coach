"use client";

import { useEffect, useRef } from "react";
import type { LucideIcon } from "lucide-react";
import { ArrowRight, X } from "lucide-react";

export function Avatar({ initials, color, small = false }: { initials: string; color: string; small?: boolean }) {
  return <span className={`avatar ${small ? "avatar-small" : ""}`} style={{ background: color }}>{initials}</span>;
}

export function StatusDot({ tone = "good" }: { tone?: "good" | "warn" | "bad" | "muted" }) {
  return <span className={`status-dot ${tone}`} />;
}

/**
 * Splits "148,9 km" into the figure and its unit so the numeral can carry the
 * weight and the unit can sit quietly beside it. A value with no space and no
 * trailing percent ("7h05", "+12") is left whole.
 */
function splitValue(value: string): [string, string] {
  const spaced = value.indexOf(" ");
  if (spaced > 0) return [value.slice(0, spaced), value.slice(spaced + 1)];
  if (value.endsWith("%")) return [value.slice(0, -1), "%"];
  return [value, ""];
}

export function Metric({ label, value, detail, icon: Icon, tone = "teal" }: { label: string; value: string; detail: string; icon: LucideIcon; tone?: string }) {
  const [figure, unit] = splitValue(value);
  return <article className="metric-card">
    <div className={`metric-icon ${tone}`}><Icon size={19} /></div>
    <div>
      <span className="eyebrow">{label}</span>
      <strong>{figure}{unit && <i className="metric-unit">{unit}</i>}</strong>
      <small>{detail}</small>
    </div>
  </article>;
}

export function ProgressRing({ value, label, size = "normal" }: { value: number; label?: string; size?: "small" | "normal" | "large" }) {
  const tone = value >= 75 ? "good" : value >= 60 ? "warn" : "bad";
  return <div className={`progress-ring ${size} ${tone}`} style={{ "--ring-value": `${value * 3.6}deg` } as React.CSSProperties}>
    <div><b>{value}</b>{label && <span>{label}</span>}</div>
  </div>;
}

export function SectionHead({ title, subtitle, action, onAction }: { title: string; subtitle?: string; action?: string; onAction?: () => void }) {
  return <div className="section-head"><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div>{action && onAction && <button type="button" className="text-button" onClick={onAction}>{action}<ArrowRight size={15} /></button>}</div>;
}

export function PageTitle({ kicker, title, subtitle, children }: { kicker?: string; title: string; subtitle: string; children?: React.ReactNode }) {
  return <div className="page-title"><div>{kicker && <span className="eyebrow accent">{kicker}</span>}<h1>{title}</h1><p>{subtitle}</p></div>{children && <div className="page-actions">{children}</div>}</div>;
}

export function ModalShell({ title, subtitle, onClose, children, wide = false, className = "" }: { title: string; subtitle: string; onClose: () => void; children: React.ReactNode; wide?: boolean; className?: string }) {
  const dialog = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") closeRef.current(); };
    document.addEventListener("keydown", closeOnEscape);
    dialog.current?.querySelector<HTMLElement>("button, input, select, textarea")?.focus();
    return () => { document.removeEventListener("keydown", closeOnEscape); previous?.focus(); };
  }, []);
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section ref={dialog} className={`modal ${wide ? "modal-wide" : ""} ${className}`.trim()} role="dialog" aria-modal="true" aria-label={title}><header><div><h2>{title}</h2><p>{subtitle}</p></div><button type="button" className="icon-button" onClick={onClose} aria-label="Fechar"><X size={19} /></button></header>{children}</section></div>;
}

/** Placeholder neutro de carregamento; o visual vem das classes CSS "skeleton"/"skeleton-line". */
export function Skeleton({ className = "", height }: { className?: string; height?: number }) {
  return <div className={["skeleton", "skeleton-line", className].filter(Boolean).join(" ")} style={height ? { height } : undefined} aria-hidden="true" />;
}

export function formatNumber(value: number) {
  const [integer, decimal] = String(value).split(".");
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return decimal ? `${grouped},${decimal}` : grouped;
}
