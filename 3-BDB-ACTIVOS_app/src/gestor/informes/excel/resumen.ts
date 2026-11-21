/** Hoja «Resumen»: todas las métricas del registro (nombre, valor y ayuda), la cartera y el periodo. */
import type { Analisis } from "../../motor/analisis";
import { METRICAS, type Metrica } from "../../motor/metricas/registro";
import { NO_DISPONIBLE, primerDiaDelPeriodo } from "../formato";
import { hayCifras } from "../secciones/comun";
import type { DatosDelInforme } from "../tipos";
import { decimal, fecha, importe, porcentaje, puntos, type Celda, type HojaDelExcel } from "./celdas";

function valor(m: Metrica, datos: DatosDelInforme): Celda {
  const analisis: Analisis = datos.analisis;
  /* Sin cifras en el periodo, ninguna métrica se da (ni el cero de un resultado realizado sin ventas). */
  if (!hayCifras(datos)) return m.motivoSinValor?.(analisis) ?? "Sin datos en el periodo.";
  const v = m.valor(analisis);
  if (v === null || !Number.isFinite(v)) return m.motivoSinValor?.(analisis) ?? NO_DISPONIBLE;
  switch (m.formato) {
    case "importe":
      return importe(v);
    case "porcentaje":
      return porcentaje(v);
    case "puntos":
      return puntos(v);
    case "ratio":
      return decimal(v);
  }
}

export const hojaResumen: HojaDelExcel = {
  nombre: "Resumen",
  anchos: [30, 22, 110],
  /* El filtro, solo sobre la tabla de métricas: filtrarlas no esconde la ficha de la cartera que va debajo (INF-29). */
  filasDelFiltro: () => METRICAS.length + 1,
  filas: (datos) => {
    const { analisis } = datos;
    return [
      ["Métrica", "Valor", "Qué es"],
      /* Tras la ayuda, la salvedad de la cifra si la tiene: qué deja fuera («No incluye Activo B, que no tiene precio.»). */
      ...METRICAS.map((m): Celda[] => [m.nombre, valor(m, datos), [m.formato === "puntos" ? `${m.ayuda} (Diferencia en puntos porcentuales.)` : m.ayuda, hayCifras(datos) ? m.salvedad?.(analisis) : undefined].filter(Boolean).join(" ")]),
      [],
      ["Cartera", analisis.cartera.nombre],
      ["Cliente", analisis.cartera.cliente ?? ""],
      ["Divisa base", analisis.cartera.divisaBase],
      ["Desde", fecha(primerDiaDelPeriodo(analisis))],
      ["Hasta", fecha(analisis.periodo.hasta)],
      ["Datos a", fecha(analisis.fecha)],
      ["Generado", fecha(datos.generado)]
    ];
  }
};
