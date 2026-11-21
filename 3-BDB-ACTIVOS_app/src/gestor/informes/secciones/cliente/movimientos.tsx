/* eslint-disable react-refresh/only-export-components */
/**
 * «Movimientos del periodo»: tabla compacta. Con muchos, los últimos y cuántos hay en total;
 * el detalle completo está en el informe del asesor y en el Excel.
 */
import { fecha, importe, titulos } from "../../../../core/formato";
import { Parrafo, Tabla } from "../../../../reports/plantilla";
import { movimientosDelPeriodo } from "../../movimientos";
import type { DatosDelInforme, SeccionDeInforme } from "../../tipos";
import { hayCifras } from "../comun";

/** Cuántos movimientos se enumeran como mucho en el informe del cliente. */
export const MOVIMIENTOS_EN_EL_INFORME_DEL_CLIENTE = 40;

function Contenido({ datos }: { datos: DatosDelInforme }) {
  const todos = movimientosDelPeriodo(datos);
  const lista = todos.slice(-MOVIMIENTOS_EN_EL_INFORME_DEL_CLIENTE);
  const frase = todos.length > lista.length
    ? `En el periodo hubo ${todos.length} movimientos; aquí van los ${lista.length} últimos. El detalle completo está disponible: pídaselo a su asesor.`
    : todos.length === 1 ? "El único movimiento del periodo." : `Los ${todos.length} movimientos del periodo, por fecha.`;
  return (
    <>
      <Parrafo>{frase}</Parrafo>
      <Tabla
        /* La operación, en una línea: con un 17 %, «Suscripción de fondo» e «Intereses de la cuenta» partían la fila en dos (16-11-2026). */
        columnas={[{ titulo: "Fecha", ancho: 12 }, { titulo: "Operación", ancho: 22 }, { titulo: "Activo", ancho: 35 }, { titulo: "Títulos", ancho: 12, cifra: true }, { titulo: "Importe", ancho: 19, cifra: true }]}
        filas={lista.map((m) => ({
          celdas: [
            fecha(m.fechaOperacion),
            m.operacion,
            m.destino && m.activo ? `${m.activo}, a ${m.destino}` : m.activo || m.nota || "Efectivo",
            /* Un movimiento de efectivo no lleva títulos: la casilla va vacía a propósito. */
            m.titulos === null ? "" : titulos(m.titulos),
            m.importe === null ? { texto: null, motivo: "no-aplica" as const } : importe(m.importe, { divisa: m.divisa })
          ]
        }))}
      />
    </>
  );
}

export const movimientos: SeccionDeInforme = {
  id: "movimientos",
  titulo: "Movimientos del periodo",
  procede: (datos) => hayCifras(datos) && movimientosDelPeriodo(datos).length > 0,
  Contenido
};
