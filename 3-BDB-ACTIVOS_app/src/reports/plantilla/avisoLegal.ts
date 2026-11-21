/**
 * El único texto legal de los informes, uno por destinatario, y la advertencia corta del pie.
 *
 * Hasta la plantilla había seis redacciones (el papel de cliente, el Gestor de carteras, la comparativa, la ficha, la
 * propuesta de cambio y el seguimiento). Esta las resume sin añadir compromisos: dice qué es el documento, de dónde
 * salen las cifras y qué no es. Un documento que necesite algo más (una simulación, una cifra del proveedor) lo añade
 * en su propia nota, no aquí.
 */
import type { TemaDeInforme } from "./tema";

/** La advertencia corta que va en el centro del pie de todas las hojas. */
export const ADVERTENCIA_DEL_PIE = "Rentabilidades pasadas no garantizan rentabilidades futuras";

export const AVISO_LEGAL: Readonly<Record<TemaDeInforme, string>> = {
  cliente:
    "Documento informativo preparado por su asesor con los datos disponibles en la fecha indicada. Las cifras salen " +
    "de los precios y movimientos de la cartera; cada sección dice de dónde procede y de cuándo es. Las rentabilidades " +
    "pasadas no garantizan rentabilidades futuras, y el valor de las inversiones puede subir o bajar. Este documento no " +
    "es una recomendación personalizada de inversión ni asesoramiento fiscal, y sus resultados no son los que se " +
    "declaran a Hacienda.",
  interno:
    "Documento de trabajo del asesor, de uso interno: no se entrega al cliente ni sustituye a los informes que sí se " +
    "le entregan. Las cifras salen de los mismos cálculos que la pantalla, con los datos disponibles en la fecha " +
    "indicada; lo que falta se dice donde falta. Las rentabilidades pasadas no garantizan rentabilidades futuras."
};
