/**
 * Lo que comparten las secciones del informe de costes. Sin react-pdf: preguntas sobre el
 * análisis y nombres.
 */
import type { CosteDeUnMovimiento } from "../../../motor/analisis";
import { nombreDelTipo } from "../../../motor/movimientos/registro";
import type { DatosDelInforme } from "../../tipos";

/** Cobertura a partir de la cual se da por completa la de los gastos corrientes. */
export const COBERTURA_COMPLETA = 0.999;

/** Si los gastos corrientes se conocen de toda la parte invertida en fondos y ETF. */
export function gastosCorrientesCompletos(datos: DatosDelInforme): boolean {
  const ic = datos.analisis.ingresosYCostes;
  return ic.gastosCorrientes !== null && ic.coberturaDeGastosCorrientes >= COBERTURA_COMPLETA;
}

/** El concepto de un cargo, en palabras: la nota del movimiento o, si no la tiene, el nombre de su tipo. */
export function conceptoDelCargo(cargo: CosteDeUnMovimiento): string {
  return cargo.nota ?? nombreDelTipo(cargo.tipo);
}

/** El nombre de un activo de la cartera, o vacío. */
export function nombreDelActivo(datos: DatosDelInforme, activoId: string | undefined): string {
  if (!activoId) return "";
  return datos.cartera.activos.find((activo) => activo.id === activoId)?.nombre ?? activoId;
}

/** Lo que se escribe como cero al céntimo no es nada que contar. */
export const algo = (importe: number) => Math.abs(importe) >= 0.005;
