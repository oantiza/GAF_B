import type { ReactNode } from "react";

interface PageHeaderProps {
  eyebrow?: ReactNode;
  title: ReactNode;
  /** Una línea corta pegada al título: «Cambios sin guardar». Sin ella, el título va solo. */
  estado?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  titleId?: string;
  className?: string;
  actionsClassName?: string;
  /**
   * `section` (ola 3): la misma cabecera, un nivel por debajo, con el título de
   * sección de la dirección, para una subvista bajo las pestañas de una página
   * que ya tiene su H1 (Mercado · Agenda / Estrategia).
   *
   * U-14 (auditoría 29-09): el título de página es el único `h1` del documento
   * y la subvista es `h2`; los títulos de panel (`.panel__title`) los pone `Panel`: `h2`
   * por defecto, y `h3` si el panel va dentro de otro bloque o de un diálogo (`nivel={3}`,
   * MAR-32).
   */
  level?: "page" | "section";
}

export function PageHeader({
  eyebrow,
  title,
  estado,
  description,
  actions,
  titleId,
  className = "",
  actionsClassName = "",
  level = "page"
}: PageHeaderProps) {
  const section = level === "section";
  return (
    <header className={`ui-page-header ${section ? "ui-page-header--section" : ""} ${className}`.replace(/\s+/g, " ").trim()}>
      <div className="ui-page-header__copy">
        {eyebrow && !section ? <p className="ui-eyebrow section-label">{eyebrow}</p> : null}
        {estado ? (
          <div className="ui-page-header__titulo">
            {section ? <h2 id={titleId}>{title}</h2> : <h1 id={titleId}>{title}</h1>}
            {estado}
          </div>
        ) : section ? (
          <h2 id={titleId}>{title}</h2>
        ) : (
          <h1 id={titleId}>{title}</h1>
        )}
        {description ? <p className="ui-page-header__description">{description}</p> : null}
      </div>
      {actions ? <div className={`ui-action-toolbar ${actionsClassName}`.trim()}>{actions}</div> : null}
    </header>
  );
}
