import { useEffect, useRef, useState, type RefObject } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])"
].join(",");

interface AccessibleDialogOptions {
  open: boolean;
  onClose: () => void;
}

/**
 * Los diálogos abiertos, el último arriba. Puede haber uno sobre otro, y cada uno escuchaba en el documento: Escape
 * los cerraba todos, y al cerrarse a la vez el de debajo se quedaba con el `overflow` del de arriba, «hidden», y la
 * página no volvía a desplazarse hasta recargar. Ahora Escape y el tabulador son del de arriba, y el `overflow` se
 * guarda al abrir el primero y se restaura al cerrar el último.
 */
const pila: { elemento: HTMLElement }[] = [];
let overflowAntesDelPrimero = "";

/**
 * Lo de detrás del diálogo de arriba queda `inert`: ni foco, ni clic, ni lector en modo lectura. Se marcan los hijos
 * de `<body>` que no contienen ese diálogo (la aplicación y los diálogos de debajo, que van cada uno en su portal), y
 * solo se quita el `inert` que puso esta pila: uno que ya estuviera se respeta.
 */
const inertesPorLaPila = new Set<Element>();

function marcarElFondo(): void {
  for (const elemento of inertesPorLaPila) elemento.removeAttribute("inert");
  inertesPorLaPila.clear();
  const arriba = pila[pila.length - 1]?.elemento;
  if (!arriba) return;
  for (const hijo of Array.from(document.body.children)) {
    if (hijo.contains(arriba) || hijo.hasAttribute("inert")) continue;
    if (hijo.tagName === "SCRIPT" || hijo.tagName === "STYLE") continue;
    hijo.setAttribute("inert", "");
    inertesPorLaPila.add(hijo);
  }
}

function entrarEnLaPila(dialogo: { elemento: HTMLElement }): void {
  if (pila.length === 0) {
    overflowAntesDelPrimero = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  pila.push(dialogo);
  marcarElFondo();
}

function salirDeLaPila(dialogo: { elemento: HTMLElement }): void {
  const indice = pila.indexOf(dialogo);
  if (indice >= 0) pila.splice(indice, 1);
  if (pila.length === 0) document.body.style.overflow = overflowAntesDelPrimero;
  marcarElFondo();
}

export function useAccessibleDialog<T extends HTMLElement = HTMLElement>({
  open,
  onClose
}: AccessibleDialogOptions): RefObject<T | null> {
  const dialogRef = useRef<T>(null);
  const closeRef = useRef(onClose);
  /* Quién tenía el foco al abrir se lee al pintar por primera vez. En el efecto ya es tarde: React
     aplica `autoFocus` antes, y lo que se guardaba era un botón del propio diálogo, así que al
     cerrar el foco no volvía a ningún sitio. */
  const [focoAlAbrir] = useState(() =>
    typeof document !== "undefined" && typeof HTMLElement !== "undefined" && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null
  );
  /* Lo que React enfocó con `autoFocus`. Se recuerda porque el modo estricto monta dos veces, y el
     primer desmontaje devuelve el foco fuera: sin esto, el diálogo arrancaba en la «X» de cerrar. */
  const focoInicial = useRef<HTMLElement | null>(null);

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;

    const dialog = dialogRef.current;
    if (!dialog) return;

    const activo = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (activo && dialog.contains(activo) && !focoInicial.current) focoInicial.current = activo;
    const opener = activo && !dialog.contains(activo) ? activo : focoAlAbrir;
    const estaEntrada = { elemento: dialog };
    entrarEnLaPila(estaEntrada);

    const getFocusable = () =>
      Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (element) => element.getAttribute("aria-hidden") !== "true" && element.tabIndex !== -1
      );

    const focusFrame = window.requestAnimationFrame(() => {
      if (document.activeElement instanceof HTMLElement && dialog.contains(document.activeElement)) {
        return;
      }
      const [firstFocusable] = getFocusable();
      (focoInicial.current ?? firstFocusable ?? dialog).focus();
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (pila[pila.length - 1] !== estaEntrada) return;
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
        return;
      }

      if (event.key !== "Tab") return;
      const focusable = getFocusable();
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      /* El foco en el propio contenedor (un clic en un párrafo) o fuera del diálogo cuenta como «antes del primero»:
         sin esto, Mayús+Tab desde ahí saltaba al último control de la página, detrás del velo. */
      const activo = document.activeElement;
      if (activo === dialog || !(activo instanceof Node) || !dialog.contains(activo)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && activo === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && activo === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown);
      salirDeLaPila(estaEntrada);
      opener?.focus();
    };
  }, [focoAlAbrir, open]);

  return dialogRef;
}
