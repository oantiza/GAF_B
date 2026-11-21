/* eslint-disable react-refresh/only-export-components */
/**
 * «Sin datos»: lo que dice el informe del asesor cuando la cartera no tiene cifras en el
 * periodo. Sustituye a todas las secciones de cifras, que no proceden.
 */
import { Parrafo } from "../../../../reports/plantilla";
import type { DatosDelInforme, SeccionDeInforme } from "../../tipos";
import { fraseSinCifras, hayCifras } from "../comun";

function Contenido({ datos }: { datos: DatosDelInforme }) {
  return <Parrafo>{fraseSinCifras(datos)}</Parrafo>;
}

export const sinDatos: SeccionDeInforme = {
  id: "sinDatos",
  titulo: "Sin datos en el periodo",
  procede: (datos) => !hayCifras(datos),
  Contenido
};
