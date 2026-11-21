import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

/** Pinta en el documento (happy-dom) y devuelve con qué volver a pintar o quitarlo. Lo usan las pruebas de las piezas. */
export function pintar(nodo: ReactNode) {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const host = document.createElement("div");
  document.body.append(host);
  const raiz = createRoot(host);
  act(() => raiz.render(nodo));
  return {
    host,
    repintar(siguiente: ReactNode) {
      act(() => raiz.render(siguiente));
    },
    quitar() {
      act(() => raiz.unmount());
      host.remove();
    }
  };
}

/** Una tecla sobre un elemento, como la daría el teclado. */
export function teclear(elemento: Element, key: string) {
  act(() => {
    elemento.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

export function pulsar(elemento: Element) {
  act(() => {
    (elemento as HTMLElement).click();
  });
}
