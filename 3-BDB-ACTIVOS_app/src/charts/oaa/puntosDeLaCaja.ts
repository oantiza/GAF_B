import { tramoDeLaCaja, type CajaDeEstilo, type CeldaDeLaCaja, type TramoDeLaCaja } from "../../core/cajaDeEstilo";
import { SEQUENTIAL_RAMP } from "../../core/theme";
import { inkOnSequentialStep } from "./chartTheme";

export const COLUMNAS_DE_LA_CAJA = [
  { key: "value", label: "Valor" },
  { key: "blend", label: "Mixto" },
  { key: "growth", label: "Crecim." }
];

export const FILAS_DE_LA_CAJA = [
  { key: "large", label: "Grande" },
  { key: "mid", label: "Mediana" },
  { key: "small", label: "Pequeña" }
];

export interface StyleBoxPoint {
  id: string;
  x: number;
  y: number;
  rowLabel: string;
  columnLabel: string;
  value: number;
  fill: string;
  textColor: string;
  size: number;
}

/**
 * El paso de la rampa que pinta cada tramo de peso: nada, menos del 10 %, del 10 al 25 %, del 25 al 50 % y desde
 * el 50 %. Son los mismos pasos que pinta la caja de la ficha (`ficha.css`, `.ficha__caja-celda--t0` a `--t4`,
 * salvo que allí lo vacío va en el gris de la banda).
 */
export const PASO_DEL_TRAMO: Record<TramoDeLaCaja, number> = { 0: 0, 1: 1, 2: 3, 3: 5, 4: 7 };

/**
 * Las nueve casillas con su color. Una celda neta de cortos puede ser negativa: se escribe, y lleva el primer
 * tono de la rampa, porque la rampa mide cuánto hay y no hay nada que medir.
 */
export function puntosDeLaCaja(celdas: CajaDeEstilo["celdas"], cell: number): StyleBoxPoint[] {
  const rawPoints = FILAS_DE_LA_CAJA.flatMap((row, rowIndex) =>
    COLUMNAS_DE_LA_CAJA.map((column, columnIndex) => ({
      id: `${row.key}-${column.key}`,
      x: columnIndex,
      y: FILAS_DE_LA_CAJA.length - 1 - rowIndex,
      rowLabel: row.label,
      columnLabel: column.label,
      value: celdas[`${row.key}_${column.key}` as CeldaDeLaCaja]
    }))
  );
  return rawPoints.map((point) => {
    /* Magnitud = rampa secuencial, como el solapamiento y la correlación, por tramos absolutos de peso
       (`tramoDeLaCaja`): el color dice cuánta renta variable hay en la casilla, no cuánto se parece a la mayor.
       Hasta el 14-11-2026 era relativo a la mayor, y una cartera repartida por igual salía oscura entera. */
    const step = PASO_DEL_TRAMO[tramoDeLaCaja(point.value / 100)];
    return {
      ...point,
      fill: SEQUENTIAL_RAMP[step],
      textColor: inkOnSequentialStep(step),
      size: cell
    };
  });
}
