/* eslint-disable react-refresh/only-export-components */
/**
 * Conciliación con cada extracto importado: si el libro, a la fecha del extracto, cuadra con
 * lo que declara el banco; y si no, cada diferencia de títulos o de efectivo.
 */
import type { ReactNode } from "react";
import { fecha, titulos } from "../../../../core/formato";
import { Parrafo, Tabla } from "../../../../reports/plantilla";
import { aNumero } from "../../../motor/decimal";
import type { DatosDelInforme, SeccionDeInforme } from "../../tipos";
import { Subtitulo } from "../piezas";

function Contenido({ datos }: { datos: DatosDelInforme }) {
  const conciliaciones = datos.analisis.integridad.conciliaciones;
  return (
    <>
      {conciliaciones.map((c) => {
        const cabecera = [`Extracto del ${fecha(c.extracto.fecha) ?? c.extracto.fecha}`, c.extracto.entidad, c.extracto.documento].filter(Boolean).join(" · ");
        return c.cuadra ? (
          <Extracto key={c.extracto.id} cabecera={cabecera}>
            <Parrafo>{`Cuadra: ${c.comprobadas} ${c.comprobadas === 1 ? "línea comprobada" : "líneas comprobadas"} (posiciones y saldos de efectivo), sin diferencias.`}</Parrafo>
          </Extracto>
        ) : (
          <Extracto key={c.extracto.id} cabecera={cabecera}>
            <Parrafo>{`No cuadra: ${c.diferencias.length} ${c.diferencias.length === 1 ? "diferencia" : "diferencias"} sobre ${c.comprobadas} líneas comprobadas.`}</Parrafo>
            <Tabla
              columnas={[{ titulo: "Concepto", ancho: 200 }, { titulo: "Clase", ancho: 60 }, { titulo: "En el libro", ancho: 85, cifra: true }, { titulo: "En el extracto", ancho: 85, cifra: true }, { titulo: "Diferencia", ancho: 85, cifra: true }]}
              filas={c.diferencias.map((dif) => ({
                celdas: [dif.concepto, dif.clase === "titulos" ? "Títulos" : "Efectivo", titulos(aNumero(dif.enElLibro)), titulos(aNumero(dif.enElExtracto)), titulos(aNumero(dif.diferencia))]
              }))}
            />
          </Extracto>
        );
      })}
    </>
  );
}

/** Un extracto: su nombre como subtítulo y lo que se ha comprobado. */
function Extracto({ cabecera, children }: { cabecera: string; children: ReactNode }) {
  return (
    <>
      <Subtitulo>{cabecera}</Subtitulo>
      {children}
    </>
  );
}

export const conciliacion: SeccionDeInforme = {
  id: "conciliacion",
  titulo: "Conciliación con el extracto",
  procede: (datos) => datos.analisis.integridad.conciliaciones.length > 0,
  Contenido
};
