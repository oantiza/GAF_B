/* eslint-disable react-refresh/only-export-components */
/**
 * Todos los movimientos del periodo, en hoja apaisada, con sus campos: fechas de operación y
 * valor, tipo, activo, títulos, precio, importe y divisa, comisión, retención, nota y origen.
 */
import { fecha, importe, precio, titulos } from "../../../../core/formato";
import type { ColumnaDeTabla } from "../../../../reports/plantilla";
import { movimientosDelPeriodo } from "../../movimientos";
import type { DatosDelInforme, SeccionDeInforme } from "../../tipos";
import { Pequena, TablaCompacta } from "../piezas";

/* Doce columnas en apaisado, con la tabla compacta: cada movimiento, en una línea y, como mucho, su apunte debajo. */
const COLUMNAS: ColumnaDeTabla[] = [
  { titulo: "F. operación", ancho: 50 },
  { titulo: "F. valor", ancho: 50 },
  { titulo: "Tipo", ancho: 78 },
  { titulo: "Activo", ancho: 160 },
  { titulo: "Títulos", ancho: 54, cifra: true },
  { titulo: "Precio", ancho: 54, cifra: true },
  { titulo: "Importe", ancho: 62, cifra: true },
  { titulo: "Divisa", ancho: 30 },
  { titulo: "Comisión", ancho: 46, cifra: true },
  { titulo: "Retención", ancho: 46, cifra: true },
  { titulo: "Nota", ancho: 108 },
  { titulo: "Origen", ancho: 52 }
];

/** Una cifra sin su divisa, que va en su columna. Un movimiento que no la lleva deja la casilla vacía a propósito. */
const cifra = (valor: number | null) => importe(valor, { divisa: null }) ?? "";

function Contenido({ datos }: { datos: DatosDelInforme }) {
  const lista = movimientosDelPeriodo(datos);
  return (
    <>
      <Pequena>{`${lista.length} movimientos con fecha de operación en el periodo. Importe con signo: positivo abona la cuenta de efectivo, negativo la carga; en la divisa de la columna «Divisa».`}</Pequena>
      <TablaCompacta
        columnas={COLUMNAS}
        filas={lista.map((m) => [
          fecha(m.fechaOperacion) ?? m.fechaOperacion,
          fecha(m.fechaValor) ?? m.fechaValor,
          m.operacion,
          { texto: m.activo, apunte: m.destino ? `a ${m.destino}` : m.isin },
          titulos(m.titulos) ?? "",
          /* El precio y el cambio, sin divisa: la del movimiento va en su columna. */
          { texto: precio(m.precio, { divisa: null }) ?? "", apunte: m.cambio !== null ? `cambio ${precio(m.cambio, { divisa: null }) ?? ""}` : undefined },
          { texto: cifra(m.importe), apunte: m.valor !== null ? `valor ${cifra(m.valor)}` : undefined },
          m.importe !== null || m.comision !== null || m.retencion !== null || m.valor !== null ? m.divisa : "",
          { texto: cifra(m.comision), apunte: m.gastos !== null ? `gastos ${cifra(m.gastos)}` : undefined },
          cifra(m.retencion),
          m.nota,
          m.origen
        ])}
      />
    </>
  );
}

export const movimientos: SeccionDeInforme = {
  id: "movimientos",
  titulo: "Movimientos del periodo",
  apaisada: true,
  procede: (datos) => movimientosDelPeriodo(datos).length > 0,
  Contenido
};
