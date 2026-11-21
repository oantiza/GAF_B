/**
 * El eje vertical de un gráfico de líneas: marcas redondas, a pasos iguales, y el recorrido que abarcan.
 *
 * Con el eje en automático, Recharts reparte cinco marcas entre el mínimo y el máximo «redondeados» a su manera, y
 * el paso no siempre se puede escribir con los decimales del eje: la curva de tipos marcaba 2,5 · 2,85 · 3,2 · 3,55 ·
 * 3,9 y, con un decimal, se leía «2,5 · 2,8 · 3,2 · 3,5 · 3,9», cuatro saltos iguales escritos como si no lo fueran. El
 * cono iba de 65 en 65. Aquí las marcas las pone `marcasDelEje`, que solo usa pasos de 1, 2, 2,5 y 5, y cada marca se
 * escribe con los decimales que necesita.
 */
import { marcasDelEje } from "../../core/escalaDelPlano";

/** Un gráfico de líneas admite hasta siete marcas: con cinco, el eje se abría mucho más de lo que ocupa la serie. */
const MARCAS_COMO_MUCHO = 7;

export interface EjeVertical {
  marcas: number[];
  dominio: [number, number];
  /** Los decimales que hacen falta para escribir todas las marcas sin redondear ninguna: de 0 a 4. */
  decimales: number;
}

function decimalesDe(marcas: readonly number[]): number {
  for (const decimales of [0, 1, 2, 3]) {
    if (marcas.every((marca) => Math.abs(marca - Number(marca.toFixed(decimales))) < 1e-9)) return decimales;
  }
  return 4;
}

/** Las marcas que abarcan todos los valores conocidos; `null` si no hay ninguno. Lo que no es una cifra no cuenta. */
export function ejeVertical(valores: ReadonlyArray<number | null | undefined>): EjeVertical | null {
  const conocidos = valores.filter((valor): valor is number => typeof valor === "number" && Number.isFinite(valor));
  const marcas = marcasDelEje(conocidos, { maximo: MARCAS_COMO_MUCHO });
  if (marcas.length < 2) return null;
  return { marcas, dominio: [marcas[0], marcas[marcas.length - 1]], decimales: decimalesDe(marcas) };
}

/** Lo que se le pasa a `YAxis`: las marcas y su recorrido; sin eje calculado, el automático de siempre. */
export function propiedadesDelEje(eje: EjeVertical | null): { ticks?: number[]; domain: [number, number] | ["auto", "auto"]; interval?: 0 } {
  return eje ? { ticks: eje.marcas, domain: eje.dominio, interval: 0 } : { domain: ["auto", "auto"] };
}
