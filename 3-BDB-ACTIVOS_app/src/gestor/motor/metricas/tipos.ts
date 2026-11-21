/**
 * Una métrica del gestor: una cifra con su nombre, su ayuda en lenguaje llano y su formato.
 * La pantalla y los informes no saben calcular ninguna: piden su valor a la métrica.
 */
import type { Analisis } from "../analisis";

export type FormatoDeMetrica = "importe" | "porcentaje" | "puntos" | "ratio";

export interface Metrica {
  id: string;
  /** Nombre en pantalla. */
  nombre: string;
  /** Una o dos frases que la explican a alguien que no es gestor de fondos. */
  ayuda: string;
  formato: FormatoDeMetrica;
  /** Si la cifra se pinta en verde o rojo según su signo. */
  conSigno: boolean;
  /** El valor para un análisis, o `null` si no se puede dar. */
  valor(analisis: Analisis): number | null;
  /** Por qué no hay valor, en lenguaje llano. */
  motivoSinValor?(analisis: Analisis): string | undefined;
  /**
   * Lo que hay que saber para leer la cifra aunque tenga valor: qué deja fuera («No incluye Activo B, que no tiene
   * precio.»). Quien enseña la cifra la escribe junto a ella.
   */
  salvedad?(analisis: Analisis): string | undefined;
  /**
   * Si la cifra no se da porque no corresponde a este periodo o a esta cartera (un periodo de
   * meses no se anualiza), y no porque falte un dato. La pantalla no pinta igual las dos cosas.
   */
  noAplica?(analisis: Analisis): boolean;
}
