import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FocusEvent as ReactFocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode
} from "react";

export interface MenuAction {
  id: string;
  label: string;
  onSelect: () => void;
  disabled?: boolean;
  /** Marca la acción como destructiva: se tiñe y se separa del resto. */
  danger?: boolean;
  description?: string;
}

interface MenuButtonProps {
  label: string;
  /**
   * El nombre accesible, cuando el rótulo solo no dice de qué es el menú: en una tabla, «Más» se repite en cada fila y
   * un lector de pantalla lo anuncia igual en todas. Tiene que empezar por el rótulo visible (WCAG 2.5.3): «Más
   * acciones de Familia García».
   */
  nombre?: string;
  actions: readonly MenuAction[];
  icon?: ReactNode;
  className?: string;
  size?: "sm" | "md";
  align?: "start" | "end";
  /**
   * Hacia dónde se abre la lista. Por defecto, hacia abajo. «arriba» es para un disparador pegado al borde inferior de
   * la ventana (el selector de diseño flotante): abierta hacia abajo, la lista caía fuera de la pantalla y el botón
   * parecía no hacer nada.
   */
  direccion?: "abajo" | "arriba";
}

const CHEVRON = (
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="m6 9 6 6 6-6" />
  </svg>
);

/**
 * Menú de acciones secundarias.
 *
 * Regla de jerarquía del sistema: una acción primaria por contexto, dos o tres
 * secundarias visibles y el resto aquí dentro. Evita cabeceras con siete
 * botones compitiendo por la misma atención.
 */
export function MenuButton({
  label,
  nombre,
  actions,
  icon,
  className = "",
  size = "sm",
  align = "end",
  direccion = "abajo"
}: MenuButtonProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  const close = useCallback((refocus = false) => {
    setOpen(false);
    if (refocus) triggerRef.current?.focus();
  }, []);

  /* Al abrir con la flecha arriba se empieza por la última acción; con todo lo demás, por la primera. */
  const abrirEnLaUltima = useRef(false);

  const itemsDelMenu = () =>
    Array.from(rootRef.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem']:not(:disabled)") ?? []);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const items = itemsDelMenu();
    (abrirEnLaUltima.current ? items[items.length - 1] : items[0])?.focus();
    abrirEnLaUltima.current = false;
  }, [open]);

  /* MAR-16: el teclado lo maneja el propio menú, no el documento. Escape escuchado en el documento cerraba también el
     diálogo en que estuviera el menú; aquí se detiene en él. */
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!open) {
      if ((event.key === "ArrowDown" || event.key === "ArrowUp") && event.target === triggerRef.current) {
        event.preventDefault();
        abrirEnLaUltima.current = event.key === "ArrowUp";
        setOpen(true);
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") return;
    const items = itemsDelMenu();
    if (items.length === 0) return;
    event.preventDefault();
    let next: number;
    if (event.key === "Home") next = 0;
    else if (event.key === "End") next = items.length - 1;
    else {
      const current = items.indexOf(document.activeElement as HTMLButtonElement);
      const step = event.key === "ArrowDown" ? 1 : -1;
      next = current < 0 ? 0 : (current + step + items.length) % items.length;
    }
    items[next]?.focus();
  };

  /* Si el foco se va fuera (Tab), el menú se cierra. Sin destino conocido no se cierra: Safari no enfoca un botón al
     pulsarlo, y cerrar ahí se comería el clic en la acción; el clic fuera lo cierra el `mousedown` del documento. */
  const handleBlur = (event: ReactFocusEvent<HTMLDivElement>) => {
    const destino = event.relatedTarget;
    if (open && destino instanceof Node && !rootRef.current?.contains(destino)) setOpen(false);
  };

  if (actions.length === 0) return null;

  return (
    <div className={`ui-menu${className ? ` ${className}` : ""}`} ref={rootRef} onKeyDown={handleKeyDown} onBlur={handleBlur}>
      <button
        type="button"
        ref={triggerRef}
        className={`ui-button ui-button--secondary ui-button--${size}`}
        aria-haspopup="menu"
        aria-label={nombre}
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        {icon}
        {label}
        {CHEVRON}
      </button>
      {open ? (
        <div className={`ui-menu__list ui-menu__list--${align}${direccion === "arriba" ? " ui-menu__list--arriba" : ""}`} id={menuId} role="menu" aria-label={nombre ?? label}>
          {actions.map((action) => (
            <button
              key={action.id}
              type="button"
              role="menuitem"
              className={`ui-menu__item${action.danger ? " is-danger" : ""}`}
              disabled={action.disabled}
              onClick={() => {
                close(true);
                action.onSelect();
              }}
            >
              <span>{action.label}</span>
              {action.description ? <small>{action.description}</small> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
