/* eslint-disable react-refresh/only-export-components */
/**
 * Posiciones cerradas en el periodo: los tramos vendidos por activo, con su coste (FIFO), lo
 * cobrado y el resultado. El total es el resultado realizado del análisis.
 */
import { fecha, importe, rentabilidad, signoDe, titulos } from "../../../../core/formato";
import { type CeldaDeTabla } from "../../../../reports/plantilla";
import type { DatosDelInforme, SeccionDeInforme } from "../../tipos";
import { Pequena, TablaCompacta } from "../piezas";

function Contenido({ datos }: { datos: DatosDelInforme }) {
  const { analisis } = datos;
  const divisa = analisis.cartera.divisaBase;
  const resultado = (valor: number | null, incompleto = false): CeldaDeTabla =>
    incompleto || valor === null ? { texto: null, motivo: "Falta el coste de algún tramo" } : { texto: importe(valor, { divisa, conSigno: true }), signo: signoDe(valor, 2) };
  return (
    <>
      <TablaCompacta
        columnas={[{ titulo: "Activo", ancho: 120 }, { titulo: "Títulos", ancho: 42, cifra: true }, { titulo: "Coste", ancho: 64, cifra: true }, { titulo: "Cobrado", ancho: 64, cifra: true }, { titulo: "Resultado", ancho: 64, cifra: true }, { titulo: "%", ancho: 48, cifra: true }, { titulo: "1.ª compra", ancho: 62, cifra: true }, { titulo: "Últ. venta", ancho: 56, cifra: true }]}
        filas={analisis.cerradas.map((c) => [
            { texto: c.activo?.nombre ?? c.activoId, apunte: `${c.activo?.isin ?? c.activoId} · ${c.cerradaDelTodo ? "cerrada del todo" : "venta parcial: sigue en cartera"}${c.incompleto ? " · falta el coste de algún tramo" : ""}` },
            titulos(c.titulos),
            c.incompleto ? null : importe(c.coste, { divisa }),
            importe(c.cobrado, { divisa }),
            resultado(c.resultado, c.incompleto),
            { texto: rentabilidad(c.resultadoPct), signo: signoDe(c.resultadoPct, 4) },
            fecha(c.primeraCompra),
            fecha(c.ultimaVenta)
          ])}
        total={["Resultado realizado del periodo", "", "", "", resultado(analisis.realizado), "", "", ""]}
      />
      <Pequena>Coste por FIFO (los títulos más antiguos primero), en la divisa base, con las comisiones dentro. No es un cálculo fiscal.</Pequena>
    </>
  );
}

export const cerradas: SeccionDeInforme = {
  id: "cerradas",
  titulo: "Posiciones cerradas en el periodo",
  /* La tabla es corta y su total va pegado a las filas: si no cabe entera, el título se va con ella. */
  juntoAlTitulo: 190,
  procede: (datos) => datos.analisis.cerradas.length > 0,
  Contenido
};
