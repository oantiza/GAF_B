/**
 * Lo que comparten las secciones de los tres informes. Sin react-pdf: preguntas sobre el análisis, quién firma, y cómo
 * se escribe una métrica del registro con el módulo común de formato (`src/core/formato.ts`).
 */
import { leerIdentidad, type IdentidadDelAsesor } from "../../../core/identidadDelAsesor";
import { importe, porcentaje, puntos, ratio, rentabilidad, signoDe, type Signo } from "../../../core/formato";
import { textoDeAusencia } from "../../../core/textoDeAusencia";
import type { Analisis } from "../../motor/analisis";
import type { Desglose } from "../../motor/desglose";
import type { Metrica } from "../../motor/metricas/registro";
import type { DatosDelInforme } from "../tipos";

/** Si el periodo tiene cifras: la cartera existe en él y tiene rentabilidad medida. */
export function hayCifras(datos: DatosDelInforme): boolean {
  return !datos.analisis.vacia && datos.analisis.rentabilidad !== undefined;
}

/**
 * La variación de precio con los costes de la cuenta dentro, para el informe del cliente, que no
 * los da como cifra propia. Las cifras de `cuadrado` van al céntimo y suman el resultado; restar
 * dos céntimos exactos y volver a redondear al céntimo deja la suma igual de exacta.
 */
export function precioNetoDeCostes(cuadrado: Desglose["cuadrado"]): number {
  return Math.round((cuadrado.precio - cuadrado.costes) * 100) / 100 + 0;
}

/**
 * Quién firma el informe: la identidad que llega del diálogo de informes, tal cual; si no llega ninguna, la que el asesor
 * guardó para todos los informes (`leerIdentidad`). Lo que falte no se inventa: sin nada, la cabecera va sin membrete.
 */
export function identidadDe(datos: DatosDelInforme): IdentidadDelAsesor {
  return datos.asesor ?? leerIdentidad();
}

/** Nombre y entidad del asesor, para «Elaborado por»; vacío si no hay ninguno de los dos. */
export function firmaDe(datos: DatosDelInforme): string {
  const { nombre, entidad } = identidadDe(datos);
  return [nombre?.trim(), entidad?.trim()].filter(Boolean).join(" · ");
}

/** La frase que se imprime cuando no hay cifras. */
export function fraseSinCifras(datos: DatosDelInforme): string {
  if (datos.cartera.movimientos.length === 0) return "Esta cartera todavía no tiene movimientos: no hay cifras que enseñar.";
  if (datos.analisis.vacia) return "Esta cartera no tiene movimientos hasta la fecha del informe: no hay cifras que enseñar.";
  return "En el periodo elegido la cartera todavía no existía o no tiene un día completo de historia: no hay cifras que enseñar.";
}

/* ---------------------------------------------------------------- las métricas del registro, en papel */

/**
 * El nombre de una métrica en los informes. El registro del motor la nombra como la pantalla del gestor; el papel usa el
 * vocabulario del apartado 6 de `docs/frontend/SISTEMA_DISENO.md` («caída máxima», «rentabilidad anualizada»).
 */
const NOMBRE_EN_EL_PAPEL: Readonly<Record<string, string>> = {
  maximaCaida: "Caída máxima",
  rentabilidadAnualizada: "Rentabilidad anualizada"
};

export function nombreDeMetrica(metrica: Metrica): string {
  return NOMBRE_EN_EL_PAPEL[metrica.id] ?? metrica.nombre;
}

function valorFinito(metrica: Metrica, analisis: Analisis): number | null {
  const valor = metrica.valor(analisis);
  return valor !== null && Number.isFinite(valor) ? valor : null;
}

/** Si la métrica tiene valor. */
export function tieneValor(metrica: Metrica, analisis: Analisis): boolean {
  return valorFinito(metrica, analisis) !== null;
}

/**
 * El valor de una métrica ya escrito con el módulo común: rentabilidades y diferencias con dos decimales y signo,
 * importes con dos decimales, volatilidad y caída máxima con dos decimales, ratios con dos. `null` si no lo tiene.
 */
export function cifraDeMetrica(metrica: Metrica, analisis: Analisis): string | null {
  const valor = valorFinito(metrica, analisis);
  if (valor === null) return null;
  const divisa = analisis.cartera.divisaBase;
  switch (metrica.formato) {
    case "importe":
      return importe(valor, { divisa, conSigno: metrica.conSigno });
    case "porcentaje":
      return metrica.conSigno ? rentabilidad(valor) : porcentaje(valor);
    case "puntos":
      return puntos(valor);
    case "ratio":
      return ratio(valor);
  }
}

/** Por qué una métrica no tiene valor: su motivo o «Falta el dato». */
export function motivoDeMetrica(metrica: Metrica, analisis: Analisis): string {
  return metrica.motivoSinValor?.(analisis) ?? textoDeAusencia("falta");
}

/**
 * El color de una métrica: verde o rojo para un resultado, una rentabilidad o una diferencia, mirando la cifra ya
 * redondeada. La caída máxima y la volatilidad no llevan color: miden riesgo, no un resultado.
 */
export function signoDeMetrica(metrica: Metrica, analisis: Analisis): Signo | null {
  const valor = valorFinito(metrica, analisis);
  if (valor === null || !metrica.conSigno || metrica.id === "maximaCaida") return null;
  return signoDe(valor, metrica.formato === "importe" ? 2 : 4);
}
