/**
 * Lo que comparten las secciones del informe de costes. Sin react-pdf: preguntas sobre el
 * análisis y nombres.
 */
import type { CosteDeUnMovimiento } from "../../../motor/analisis";
import { nombreDelTipo } from "../../../motor/movimientos/registro";
import type { DatosDelInforme } from "../../tipos";

/**
 * Si los gastos corrientes se conocen de todos los fondos y ETF de la cartera: lo decide el análisis
 * (`gastosCorrientesCompletos`), sin umbral. Antes bastaba una cobertura del 99,9 % que contaba las acciones como conocidas, y
 * un fondo pequeño sin TER, o uno sin precio, se daba por completo (P2-07, 22-11-2026).
 */
export function gastosCorrientesCompletos(datos: DatosDelInforme): boolean {
  return datos.analisis.ingresosYCostes.gastosCorrientesCompletos;
}

/**
 * El concepto de un cargo, en palabras: el concepto para el cliente que el asesor escribió en el movimiento y, sin él, el
 * nombre de su tipo («Comisión o gasto»). Nunca la nota del movimiento: es lo que el asesor escribe para sí, y este informe
 * es papel del cliente (P1-11 de la auditoría del 20-11-2026, aprobado por Óscar el 21-11-2026). La nota sale en el informe
 * del asesor y en el Excel, que son internos; el concepto para el cliente, que Óscar aprobó el mismo día, es el texto que el
 * asesor escribe precisamente para este papel.
 */
export function conceptoDelCargo(cargo: Pick<CosteDeUnMovimiento, "tipo" | "concepto">): string {
  return cargo.concepto?.trim() || nombreDelTipo(cargo.tipo);
}

/** El nombre de un activo de la cartera, o vacío. */
export function nombreDelActivo(datos: DatosDelInforme, activoId: string | undefined): string {
  if (!activoId) return "";
  return datos.cartera.activos.find((activo) => activo.id === activoId)?.nombre ?? activoId;
}

/** Lo que se escribe como cero al céntimo no es nada que contar. */
export const algo = (importe: number) => Math.abs(importe) >= 0.005;
