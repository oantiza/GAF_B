import type { ReactNode } from "react";

interface LoadingStateProps {
  children?: ReactNode;
  className?: string;
}

export function LoadingState({ children = "Cargando módulo…", className = "" }: LoadingStateProps) {
  return (
    <div className={`ui-async-state loading-note ${className}`.trim()} role="status" aria-live="polite">
      <span className="loading-dot" aria-hidden="true" />
      {children}
    </div>
  );
}

interface EmptyStateProps {
  title: ReactNode;
  description: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
  children?: ReactNode;
  className?: string;
  /**
   * El nivel del título, para no saltar niveles, con la regla de `Panel` (MAR-32): `h1` la pantalla, `h2` cada
   * bloque, `h3` lo que va dentro de un bloque. `2` (por defecto) si el estado vacío ocupa el sitio de un bloque o la
   * pantalla bajo su `h1`; `3` dentro de un panel o de un diálogo.
   */
  nivel?: 2 | 3;
}

export function EmptyState({ title, description, action, icon, children, className = "", nivel = 2 }: EmptyStateProps) {
  const Titulo = nivel === 3 ? "h3" : "h2";
  return (
    <section className={`ui-empty-state ${className}`.trim()}>
      {icon ? <span className="ui-empty-state__icon" aria-hidden="true">{icon}</span> : null}
      <Titulo>{title}</Titulo>
      <p>{description}</p>
      {children}
      {action ? <div className="ui-empty-state__action">{action}</div> : null}
    </section>
  );
}
