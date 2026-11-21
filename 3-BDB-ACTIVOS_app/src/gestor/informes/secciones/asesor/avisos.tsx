/* eslint-disable react-refresh/only-export-components */
/**
 * Avisos de integridad, los errores primero (el análisis ya los entrega en ese orden). Si no
 * hay ninguno, la sección no se imprime: el resumen dice en una línea que no los hay. La gravedad
 * va escrita en su columna: en papel, el color no basta.
 */
import { fecha } from "../../../../core/formato";
import { Tabla } from "../../../../reports/plantilla";
import type { GravedadDelAviso } from "../../../motor/integridad";
import type { DatosDelInforme, SeccionDeInforme } from "../../tipos";

const GRAVEDAD: Record<GravedadDelAviso, string> = { error: "Error", aviso: "Aviso", nota: "Nota" };

function Contenido({ datos }: { datos: DatosDelInforme }) {
  return (
    <Tabla
      columnas={[{ titulo: "Gravedad", ancho: 0.9 }, { titulo: "Qué pasa", ancho: 6 }, { titulo: "Fecha", ancho: 1.1, cifra: true }]}
      /* Un aviso que no es de un día (una posición concentrada) no lleva fecha: la casilla va vacía a propósito. */
      filas={datos.analisis.integridad.avisos.map((aviso) => ({ celdas: [GRAVEDAD[aviso.gravedad], aviso.mensaje, aviso.fecha ? fecha(aviso.fecha) : ""] }))}
    />
  );
}

export const avisos: SeccionDeInforme = {
  id: "avisos",
  titulo: "Avisos",
  procede: (datos) => datos.analisis.integridad.avisos.length > 0,
  Contenido
};
