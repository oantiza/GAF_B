/**
 * Ayudas de la auditoría cuantitativa del gestor de carteras. Solo montan datos: ninguna
 * calcula una cifra esperada. Las cifras esperadas están en cada prueba, con su cuenta a mano.
 */
import { aTexto, d, type Decimal } from "../../../src/gestor/motor/decimal";
import type { DatosDeMercado } from "../../../src/gestor/motor/valoracion";
import { serie } from "../ayudas";

/** Datos de mercado en memoria: precios por activo y cambios por divisa (unidades de divisa por 1 EUR). */
export function mercado(
  precios: Record<string, Array<[string, number]>>,
  cambios: Record<string, Array<[string, number]>> = {}
): DatosDeMercado {
  return {
    precios: new Map(Object.entries(precios).map(([id, puntos]) => [id, serie(...puntos)])),
    cambios: new Map(Object.entries(cambios).map(([divisa, puntos]) => [divisa, serie(...puntos)]))
  };
}

/** Un decimal del motor escrito en su forma canónica, para compararlo con una cifra escrita a mano. */
export function enTexto(valor: Decimal | undefined): string {
  return valor === undefined ? "sin saldo" : aTexto(valor);
}

/** La forma canónica de una cifra escrita a mano («1251.60» → «1251.6»). */
export function canonica(cifra: string): string {
  return aTexto(d(cifra));
}

/** Todo el periodo posible: desde antes del primer movimiento hasta el último día valorado. */
export const TODO = { desde: "1900-01-01", hasta: "2100-01-01" };
