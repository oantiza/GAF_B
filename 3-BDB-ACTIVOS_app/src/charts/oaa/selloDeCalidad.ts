/**
 * El rótulo del sello de calidad del dato de un gráfico: uno solo para todas las piezas.
 *
 * ANA-25: va siempre con mayúscula inicial, lo escriba quien lo escriba («subyacente» es «Subyacente»). Y sin rótulo
 * propio, el de su calidad en palabras: la matriz de correlación escribía el código tal cual, «real».
 */
import type { ReactNode } from "react";

export type CalidadDelDato = "real" | "mixed" | "estimated" | "none";

const ROTULO_DE_LA_CALIDAD: Record<CalidadDelDato, string> = {
  real: "Real",
  mixed: "Mixto",
  estimated: "Estimado",
  none: "Sin dato"
};

export function rotuloDelSello(calidad: CalidadDelDato, rotulo?: ReactNode): ReactNode {
  const elegido = rotulo ?? ROTULO_DE_LA_CALIDAD[calidad];
  return typeof elegido === "string" && elegido ? elegido.charAt(0).toLocaleUpperCase("es") + elegido.slice(1) : elegido;
}
