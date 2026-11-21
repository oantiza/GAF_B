import type { ReactNode } from "react";
import { textoDeAusencia } from "../../core/textoDeAusencia";
import type { ClaseDeAusencia } from "../../types/fichaInstrumento";

/**
 * La pieza que escribe que un dato no está. Solo para pantalla.
 *
 * La dirección elegida dice que hay tres ausencias, que son tres cosas distintas y se pintan
 * distinto, y que nunca se escribe un guion que pueda leerse como cero. Antes de esta pieza se
 * decía de cuatro maneras: «N/D» para todo, una raya, «Falta el dato» y «Falta». Cuál usar:
 *
 * | Clase       | Texto                                     | Cuándo                                       |
 * |-------------|-------------------------------------------|----------------------------------------------|
 * | `no-aplica` | «No aplica», gris en cursiva              | La casilla está cerrada: una acción no tiene |
 * |             |                                           | coste corriente. No hay nada que buscar.     |
 * | `falta`     | «Falta el dato», «Falta» en columna       | Hueco real: debería estar y no nos lo han    |
 * |             | estrecha, en ocre                         | dado.                                        |
 * | `sin-pedir` | «Sin pedir», en marino y sin subrayar    | Existe y no lo hemos ido a buscar: lo único  |
 * |             |                                           | que se resuelve trabajando.                  |
 *
 * ```tsx
 * <Ausencia clase="falta" />                          // «Falta el dato»
 * <Ausencia clase="falta" estrecha />                 // «Falta», en una columna estrecha
 * <Ausencia clase="no-aplica" motivo="Sin capital fijado" />
 * <CifraOAusencia valor={fondo.volatilidad} escribir={(v) => oFalta(porcentaje(v, { decimales: 2 }))} clase="falta" estrecha />
 * ```
 *
 * Quien compone sin pintar —`CeldaDeTabla.texto`, `FilaDeFicha.valor`— tiene los mismos textos
 * en `core/textoDeAusencia.ts`.
 *
 * **Dos cosas que conviene saber antes de usarla.**
 *
 * 1. **«Sin pedir» solo lo puede decir quien lee la calidad del instrumento**, y hoy eso es la
 *    ficha. Las demás pantallas no saben distinguirlo de un dato que falta: solo pueden decir
 *    `falta` o `no-aplica`. Elegir `sin-pedir` sin haberlo leído sería inventárselo.
 * 2. **El papel no pasa por esta pieza, pero dice lo mismo.** En un informe no hay componentes de
 *    pantalla: lo que falta se escribe con `oFalta(...)` de `src/core/formato.ts`, que pone las
 *    mismas palabras («Falta el dato»). «N/D» ya no lo escribe nadie: el módulo de formato que lo
 *    hacía se retiró el 14-11-2026.
 *
 * `motivo` sustituye el texto cuando hay uno mejor que el genérico y quien lo escribe lo sabe,
 * como «Sin capital fijado» en un importe, o el de la ficha, «Pendiente de alta». La clase se
 * queda, porque lo que dicen el color y la forma no cambia.
 */
interface AusenciaProps {
  clase: ClaseDeAusencia;
  /** En una columna estrecha, «Falta» en vez de «Falta el dato». */
  estrecha?: boolean;
  /** Un texto mejor que el genérico, cuando quien lo escribe sabe el motivo. */
  motivo?: ReactNode;
}

export function Ausencia({ clase, estrecha = false, motivo }: AusenciaProps) {
  return <span className={`ausencia ausencia--${clase}`}>{motivo ?? textoDeAusencia(clase, { estrecha })}</span>;
}

/**
 * La cifra escrita, o su ausencia si no la hay. Un cero es una cifra y se escribe: un cero
 * inventado es peor que un error, pero un cero que está en el dato es un cero.
 */
export function CifraOAusencia({
  valor,
  escribir,
  ...ausencia
}: AusenciaProps & {
  valor: number | null | undefined;
  escribir: (valor: number) => string;
}) {
  return typeof valor === "number" && Number.isFinite(valor) ? <>{escribir(valor)}</> : <Ausencia {...ausencia} />;
}
