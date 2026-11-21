import type { ReactNode } from "react";

/*
 * El icono que acompaña a «Añadir» y «Añadido» (17-11-2026): el mismo en el Buscador, la ficha y el Comparador, para que
 * la acción se reconozca igual en las tres. «No disponible» y «Benchmark» no llevan: no son una acción.
 */
const ANADIR = (
  <svg aria-hidden="true" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" viewBox="0 0 16 16">
    <path d="M8 3.25v9.5M3.25 8h9.5" />
  </svg>
);

const HECHO = (
  <svg aria-hidden="true" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" viewBox="0 0 16 16">
    <path d="M3.5 8.5l3 3 6-7" />
  </svg>
);

export function iconoDeAccionDeCartera(etiqueta: string): ReactNode {
  return etiqueta === "Añadir" ? ANADIR : etiqueta === "Añadido" ? HECHO : undefined;
}
