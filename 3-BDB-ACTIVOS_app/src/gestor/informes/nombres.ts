/**
 * Los nombres de fichero de los informes: «Informe del cliente - Familia García - 2026-01-01 a 2026-11-13.pdf».
 * Las fechas son las del periodo tal como lo lee el cliente (del día siguiente al cierre inicial).
 *
 * La convención y el saneado son los comunes de la aplicación (`core/descargaDeFicheros.ts`), que salieron de aquí.
 */
import { nombreDelFichero as nombreComun, sanearNombreDeFichero } from "../../core/descargaDeFicheros";
import type { Analisis } from "../motor/analisis";
import { primerDiaDelPeriodo } from "./formato";
import type { TipoDeInforme } from "./tipos";

export { sanearNombreDeFichero };

const PREFIJO: Record<TipoDeInforme | "excel", string> = {
  cliente: "Informe del cliente",
  asesor: "Informe del asesor",
  costes: "Informe de costes",
  excel: "Datos"
};

export function nombreDelFichero(tipo: TipoDeInforme | "excel", analisis: Analisis): string {
  return nombreComun({
    documento: PREFIJO[tipo],
    de: analisis.cartera.nombre.trim() || "Cartera",
    fecha: { desde: primerDiaDelPeriodo(analisis), hasta: analisis.periodo.hasta },
    extension: tipo === "excel" ? "xlsx" : "pdf"
  });
}
