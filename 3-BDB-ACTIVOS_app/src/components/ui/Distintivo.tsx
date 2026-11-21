import type { ReactNode } from "react";

export type TonoDeDistintivo = "neutro" | "marca" | "interno" | "aviso" | "favorable" | "desfavorable";

/**
 * Una etiqueta corta de estado, dentro de una línea de texto o junto a un título. Sustituye a las 19 clases de
 * distintivo de hoy (`.badge` y sus alias), que desaparecerán cuando cada pantalla adopte la pieza.
 *
 * | `tono`    | Aspecto                         | Cuándo                                                        |
 * |-----------|---------------------------------|---------------------------------------------------------------|
 * | `neutro`  | gris, con contorno              | Un estado sin opinión: «Acumulación», «Clase en EUR»          |
 * | `marca`   | azul, con contorno              | Lo afirmativo: «Se puede proponer», «Añadido»                  |
 * | `interno` | tinta, en versalitas, contorno  | Lo que solo ve el asesor y se oculta en Modo cliente: «Interno» |
 * | `aviso`   | ocre, con contorno              | Un estado que pide atención: «Datos parciales»                 |
 * | `favorable` | verde, con fondo suave        | Lo que sale bien o a favor: «Positiva», «Se cumple», «Mejora»   |
 * | `desfavorable` | rojo, con fondo suave      | Lo que sale mal o en contra: «Negativa», «No se cumple»         |
 *
 * El texto es la señal; el color, el refuerzo. Por eso un distintivo lleva siempre una palabra.
 *
 * `favorable` y `desfavorable` (14-11-2026, Óscar: «le faltan colores en general») llevan el verde y el rojo del signo:
 * dicen el sentido de una opinión o de una comprobación, no adornan. Lo que solo pide atención sigue siendo `aviso`.
 *
 * ```tsx
 * <Distintivo tono="interno">Interno</Distintivo>
 * ```
 */
export interface DistintivoProps {
  /** `neutro` por defecto. */
  tono?: TonoDeDistintivo;
  className?: string;
  children: ReactNode;
}

/* Escritas enteras para que el censo de CSS vea su uso. */
const CLASE_DEL_TONO: Record<TonoDeDistintivo, string> = {
  neutro: "distintivo--neutro",
  marca: "distintivo--marca",
  interno: "distintivo--interno",
  aviso: "distintivo--aviso",
  favorable: "distintivo--favorable",
  desfavorable: "distintivo--desfavorable"
};

export function Distintivo({ tono = "neutro", className = "", children }: DistintivoProps) {
  return <span className={`distintivo ${CLASE_DEL_TONO[tono]} ${className}`.trim()}>{children}</span>;
}
