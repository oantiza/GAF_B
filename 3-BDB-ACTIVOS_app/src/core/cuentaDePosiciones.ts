import type { AlcanceDeLasPosiciones } from "../types/bdbAssets";
import { numero, oFalta, peso } from "./formato";

/**
 * La cuenta de posiciones que declara el proveedor, solo si no la desmiente lo que se ha recibido de su cartera (pantalla-1 de las
 * puertas finales, 06-11-2026). Es la única regla, y la siguen Posiciones y el informe interno, que la comprueban con la cartera completa.
 * La ficha, que solo recibe 25 líneas, no escribe la cuenta desde la decisión 121 hasta que el dato guarde el total (ver `componerFicha`).
 *
 * **Una cuenta menor que los títulos que han llegado es falsa por construcción, y no se escribe**, como el peso de las diez mayores
 * que no cuadra con sus filas (`diezMayoresQueCuadran`). FON FINECO PATRIMONIO PERMANENTE declara 1 posición y su ficha recibe 25
 * líneas, 16 de ellas títulos: once ETF, cuatro fondos y un bono.
 *
 * **Se cuentan títulos y no líneas** (`CarteraPublicada.titulos`): sin el efectivo, los derivados ni su contrapartida, con la lista del
 * solapamiento (decisión 87). Contando líneas se callarían cuentas ciertas: CARTERA RENTA FIJA HORIZONTE 2026 declara 6 y trae seis
 * bonos y una cuenta corriente, y Amundi Global Equity Responsible declara 49 y trae 49 acciones entre 182 líneas: las otras 133 son
 * efectivo, cuentas y contratos de divisa.
 *
 * **De dónde viene la cuenta falsa:** en la base nueva, `positions_count` es el número de bonos del fondo o, si no tiene ninguno, el
 * de acciones (`holdings_count_bond ?? holdings_count_equity`, en el mapeador de la plataforma), no el total que dice su contrato.
 * Medido el 06-11-2026 en 8092: de 761 carteras, 317 declaran menos posiciones que los títulos de su cartera completa, y la ficha, que
 * solo recibe las 25 primeras líneas, puede verlo en 74. En la base vieja no pasa en ninguna de 775.
 *
 * Sin nada recibido, nada la desmiente, y se escribe la del proveedor. Lo que no es un entero de al menos 1 no es una cuenta.
 */
export function cuentaQueCuadra(declarada: unknown, titulosRecibidos: number | null | undefined): number | undefined {
  if (typeof declarada !== "number" || !Number.isInteger(declarada) || declarada < 1) return undefined;
  return declarada >= (titulosRecibidos ?? 0) ? declarada : undefined;
}

/** «1 posición», «2.376 posiciones». */
export function rotuloDePosiciones(cuenta: number): string {
  return `${oFalta(numero(cuenta))} ${cuenta === 1 ? "posición" : "posiciones"}`;
}

/** «Se excluye 1 posición», «Se excluyen 3 posiciones»: el verbo concuerda, que la pantalla escribía «Se excluyen 1 posiciones». */
export function seExcluyen(cuenta: number): string {
  return `Se ${cuenta === 1 ? "excluye" : "excluyen"} ${rotuloDePosiciones(cuenta)}`;
}

/**
 * Lo que una lista de posiciones deja fuera, en una frase (hallazgo 20, 15-11-2026): «Solo las 25 principales de 243 posiciones · la
 * cartera publicada cubre el 30,1 % del patrimonio». Sin ella, una lista parcial parece la cartera entera.
 *
 * - El total es `securities_count`, los títulos según el proveedor, y no `positions_count`, que en la base nueva es el número de bonos
 *   o, si no hay, el de acciones (DE0005318406: 155 de 243). Se escribe solo si no lo desmiente lo recibido (`cuentaQueCuadra`).
 * - La cobertura es la de la cartera que publica la fuente, no la de las líneas servidas, y por eso se dice de «la cartera publicada».
 * - «Solo las N principales» cuenta las líneas recibidas; el total se contrasta con sus títulos, como en `cuentaQueCuadra`.
 * - Sin nada de esto (un servidor anterior, o la base vieja), `null`: no se supone nada.
 */
export function alcanceDeLaCartera(
  alcance: AlcanceDeLasPosiciones | undefined,
  recibido: { lineas?: number; titulos?: number | null } = {}
): string | null {
  if (!alcance) return null;
  const total = cuentaQueCuadra(alcance.securities_count, recibido.titulos);
  const { lineas } = recibido;
  const partes: string[] = [];
  if (alcance.list_scope === "TOP" && lineas !== undefined && lineas > 0 && (total === undefined || total > lineas)) {
    partes.push(`Solo las ${oFalta(numero(lineas))} principales${total !== undefined ? ` de ${rotuloDePosiciones(total)}` : ""}`);
  } else if (total !== undefined) {
    partes.push(rotuloDePosiciones(total));
  }
  const cubre = peso(alcance.coverage);
  if (cubre !== null) partes.push(`${partes.length > 0 ? "la cartera publicada cubre" : "La cartera publicada cubre"} el ${cubre} del patrimonio`);
  return partes.length > 0 ? partes.join(" · ") : null;
}
