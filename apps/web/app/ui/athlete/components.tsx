import type { ComponentType, ReactNode } from "react";
import {
  ArrowLeft,
  CalendarDays,
  Home,
  LoaderCircle,
  Menu,
  Trophy,
  Waves,
} from "lucide-react";
import type { AthleteScreen } from "./types";

export function AthleteMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`athlete-mark ${compact ? "compact" : ""}`} aria-label="RKF Coach">
      <span aria-hidden="true"><Waves size={compact ? 25 : 52} strokeWidth={1.8} /></span>
      <strong><b>RKF</b> COACH</strong>
    </div>
  );
}

export function AppHeader({ title, onBack, right }: { title?: string; onBack?: () => void; right?: ReactNode }) {
  return (
    <header className="athlete-app-head">
      {onBack ? <button type="button" aria-label="Voltar" onClick={onBack}><ArrowLeft size={20} /></button> : <span />}
      {title ? <strong>{title}</strong> : <AthleteMark compact />}
      <div>{right}</div>
    </header>
  );
}

export function BottomNav({ active, go }: { active: AthleteScreen; go: (screen: AthleteScreen) => void }) {
  const items: Array<{ screen: AthleteScreen; label: string; icon: ComponentType<{ size?: number }> }> = [
    { screen: "home", label: "Hoje", icon: Home },
    { screen: "week", label: "Semanal", icon: CalendarDays },
    { screen: "phase", label: "Fase", icon: Waves },
    { screen: "competitions", label: "Competições", icon: Trophy },
    { screen: "more", label: "Mais", icon: Menu },
  ];
  return (
    <nav className="athlete-bottom-nav" aria-label="Navegação principal">
      {items.map(({ screen, label, icon: Icon }) => (
        <button
          type="button"
          key={screen}
          aria-current={active === screen ? "page" : undefined}
          className={active === screen ? "active" : ""}
          onClick={() => go(screen)}
        >
          <Icon size={20} />
          <span>{label}</span>
        </button>
      ))}
    </nav>
  );
}

export function Rating({
  value,
  onChange,
  values = [2, 4, 6, 8, 10],
  label = "Escala de avaliação",
}: {
  value: number;
  onChange: (value: number) => void;
  values?: number[];
  label?: string;
}) {
  return (
    <div className="athlete-rating" role="radiogroup" aria-label={label}>
      {values.map((item) => (
        <button
          type="button"
          role="radio"
          aria-checked={value === item}
          className={value === item ? "active" : ""}
          key={item}
          onClick={() => onChange(item)}
        >
          {item}
        </button>
      ))}
    </div>
  );
}

export function AthleteButton({
  children,
  secondary = false,
  onClick,
  type = "button",
  disabled = false,
}: {
  children: ReactNode;
  secondary?: boolean;
  onClick?: () => void;
  type?: "button" | "submit";
  disabled?: boolean;
}) {
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={`athlete-primary ${secondary ? "secondary" : ""}`}
    >
      {children}
    </button>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="athlete-field">
      <span>{label}</span>
      {children}
      {hint ? <em>{hint}</em> : null}
    </label>
  );
}

export function AthleteLoading({ label = "Carregando seus dados…" }: { label?: string }) {
  return (
    <div className="athlete-auth-loading" role="status">
      <LoaderCircle className="spin" size={27} />
      <span>{label}</span>
    </div>
  );
}

export function AthleteState({
  icon: Icon = Waves,
  title,
  description,
  action,
}: {
  icon?: ComponentType<{ size?: number }>;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <section className="athlete-state" role="status">
      <span><Icon size={24} /></span>
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </section>
  );
}
