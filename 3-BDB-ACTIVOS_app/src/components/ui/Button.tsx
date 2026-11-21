import { useEffect, type ButtonHTMLAttributes, type ReactNode } from "react";
import { anunciar } from "./anunciar";

export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  iconOnly?: boolean;
  /**
   * Trabajando: el botón se desactiva, enseña el giro, marca `aria-busy` y **lo anuncia** al lector de pantalla
   * («Trabajando…», o `textoAlTrabajar`). Sin el anuncio, quien no ve la pantalla pulsaba y no oía nada: el botón
   * desactivado pierde el foco y el giro no se lee.
   */
  busy?: boolean;
  /** Lo que se anuncia al empezar a trabajar. «Trabajando…» por defecto; mejor si dice qué: «Calculando la frontera…». */
  textoAlTrabajar?: string;
}

export function Button({
  variant = "secondary",
  size = "md",
  icon,
  iconOnly = false,
  busy = false,
  textoAlTrabajar = "Trabajando…",
  className = "",
  disabled,
  children,
  ...props
}: ButtonProps) {
  /* Se anuncia al pasar a trabajar, no en cada pintado. El anuncio va a una región aparte y no al texto del botón,
     que así conserva su nombre: «Guardar» sigue siendo «Guardar» mientras trabaja. */
  useEffect(() => {
    if (busy) anunciar(textoAlTrabajar);
  }, [busy, textoAlTrabajar]);

  const classes = [
    "ui-button",
    `ui-button--${variant}`,
    `ui-button--${size}`,
    iconOnly ? "ui-button--icon" : "",
    className
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      {...props}
      type={props.type ?? "button"}
      className={classes}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
    >
      {busy ? <span className="ui-button__spinner" aria-hidden="true" /> : icon}
      {children}
    </button>
  );
}
