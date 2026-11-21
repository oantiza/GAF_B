/**
 * La rentabilidad (acumulada) del último año y de los últimos 3 y 5 años. Sobre toda la historia de la cartera hasta la
 * fecha del análisis, sin depender del periodo elegido (`motor/ultimosAnios.ts`).
 *
 * La anualizada de 3 y 5 años no es una métrica aparte del registro: va en la misma línea del análisis
 * (`Analisis.ultimosAnios[i].anualizada`) y la pantalla y el informe del asesor la leen de ahí, junto a su acumulada.
 * Así el resumen del asesor, que enseña todas las métricas del registro, no crece dos casillas más (y una fila de su
 * rejilla), que empujaban a la segunda hoja la conciliación del extracto de la demostración.
 */
import type { Analisis } from "../analisis";
import type { AniosRecientes, RentabilidadDeLosUltimosAnios } from "../ultimosAnios";
import { salvedadDeLoContadoComoCero } from "./cuentaComoCero";
import type { Metrica } from "./tipos";

export function lineaDeLosUltimosAnios(analisis: Analisis, anios: AniosRecientes): RentabilidadDeLosUltimosAnios | undefined {
  return analisis.ultimosAnios.find((candidata) => candidata.anios === anios);
}

const COMUN = "No depende del periodo elegido ni de cuándo aportó o retiró dinero el cliente: llega hasta el último día valorado.";

function acumulada(id: string, anios: AniosRecientes, nombre: string, ayuda: string): Metrica {
  const valor = (analisis: Analisis) => lineaDeLosUltimosAnios(analisis, anios)?.acumulada ?? null;
  return {
    id,
    nombre,
    ayuda: `${ayuda} ${COMUN}`,
    formato: "porcentaje",
    conSigno: true,
    valor,
    /* La ventana acaba en la fecha del análisis: una posición sin precio a esa fecha cuenta como cero dentro de ella. */
    salvedad: salvedadDeLoContadoComoCero(valor),
    motivoSinValor: (analisis) => lineaDeLosUltimosAnios(analisis, anios)?.motivo,
    noAplica: (analisis) => lineaDeLosUltimosAnios(analisis, anios)?.acumulada === null
  };
}

export const rentabilidadUltimoAnio = acumulada("rentabilidadUltimoAnio", 1, "Rentabilidad del último año", "Lo que ha rendido la cartera en los últimos doce meses.");
export const rentabilidadUltimos3Anios = acumulada(
  "rentabilidadUltimos3Anios",
  3,
  "Rentabilidad de los últimos 3 años",
  "Lo que ha rendido la cartera en total en los últimos tres años, sin anualizar."
);
export const rentabilidadUltimos5Anios = acumulada(
  "rentabilidadUltimos5Anios",
  5,
  "Rentabilidad de los últimos 5 años",
  "Lo que ha rendido la cartera en total en los últimos cinco años, sin anualizar."
);
