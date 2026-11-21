/**
 * Los movimientos del periodo de un informe: los de la cartera con fecha de operación en
 * (desde, hasta], el mismo criterio con el que el motor mide el periodo (del CIERRE de
 * `desde` al cierre de `hasta`). No calcula nada: traduce cada apunte a nombres y números.
 */
import type { Movimiento } from "../motor/modelo";
import { nombreDelTipo } from "../motor/movimientos/registro";
import { importe, oFalta, titulos } from "../../core/formato";
import type { DatosDelInforme, MovimientoDelInforme } from "./tipos";

const ORIGEN: Record<string, string> = { manual: "Manual", importado: "Importado", demo: "Demostración" };

function numero(valor: string | undefined): number | null {
  if (valor === undefined || valor.trim() === "") return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

export function movimientosDelPeriodo(datos: DatosDelInforme): MovimientoDelInforme[] {
  const { cartera, analisis } = datos;
  const { desde, hasta } = analisis.periodo;
  const porId = new Map(cartera.activos.map((activo) => [activo.id, activo]));
  const nombre = (activoId: string | undefined) => (activoId ? porId.get(activoId)?.nombre ?? activoId : "");
  const destino = (movimiento: Movimiento): string => {
    const otro = movimiento.destino;
    if (!otro) return "";
    if (otro.activoId) return [nombre(otro.activoId), otro.titulos && titulos(numero(otro.titulos)) ? `${titulos(numero(otro.titulos))} títulos` : ""].filter(Boolean).join(" · ");
    if (otro.importe) return oFalta(importe(numero(otro.importe), { divisa: otro.divisa ?? cartera.divisaBase }));
    if (otro.divisa) return otro.divisa;
    return "";
  };
  return cartera.movimientos
    .map((movimiento, orden) => ({ movimiento, orden }))
    .filter(({ movimiento }) => movimiento.fechaOperacion > desde && movimiento.fechaOperacion <= hasta)
    .sort((a, b) => (a.movimiento.fechaOperacion < b.movimiento.fechaOperacion ? -1 : a.movimiento.fechaOperacion > b.movimiento.fechaOperacion ? 1 : a.orden - b.orden))
    .map(({ movimiento }) => ({
      id: movimiento.id,
      fechaOperacion: movimiento.fechaOperacion,
      fechaValor: movimiento.fechaValor ?? movimiento.fechaOperacion,
      tipo: movimiento.tipo,
      operacion: nombreDelTipo(movimiento.tipo),
      activoId: movimiento.activoId,
      activo: nombre(movimiento.activoId),
      isin: movimiento.activoId ? porId.get(movimiento.activoId)?.isin : undefined,
      titulos: numero(movimiento.titulos),
      precio: numero(movimiento.precio),
      importe: numero(movimiento.importe),
      divisa: movimiento.divisa ?? cartera.divisaBase,
      comision: numero(movimiento.comision),
      gastos: numero(movimiento.gastos),
      retencion: numero(movimiento.retencion),
      cuponCorrido: numero(movimiento.cuponCorrido),
      cambio: numero(movimiento.cambio),
      valor: numero(movimiento.valor),
      destino: destino(movimiento),
      nota: movimiento.nota ?? "",
      origen: ORIGEN[movimiento.origen?.via ?? "manual"] ?? "Manual"
    }));
}
