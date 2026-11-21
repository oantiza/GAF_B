/**
 * El importador de la plantilla genérica: movimientos de cualquier entidad que no tenga
 * importador propio, en un CSV o un Excel con las columnas de `columnas.ts`.
 *
 * Reconoce con confianza 0,5, a propósito menor que la de un importador de entidad: un
 * documento que una entidad reconoce no cae aquí aunque se parezca a la plantilla.
 */
import type { DocumentoImportado, DocumentoLeido, Importador, ResultadoDeImportacion } from "../tipos";
import { buscarTablas, explicarCabeceraQueFalta, LecturaDePlantilla } from "./leer";

export { COLUMNAS_DE_MOVIMIENTOS, COLUMNAS_DE_POSICIONES, SINONIMOS_DE_TIPOS, reconocerTipo } from "./columnas";
export { hojasDeLaPlantilla, plantillaCsv } from "./plantillaDescargable";

const ID = "plantilla";
const ENTIDAD = "Plantilla genérica";
const TIPO_DE_DOCUMENTO = "movimientos";
const ETIQUETA = "Plantilla de movimientos";

/** La confianza con la que la plantilla reconoce un documento: menor que la de cualquier entidad. */
export const CONFIANZA_DE_LA_PLANTILLA = 0.5;

function resultadoVacio(): ResultadoDeImportacion {
  return { importadorId: ID, entidad: ENTIDAD, documentos: [], movimientos: [], extractos: [], avisos: [], errores: [] };
}

export const importadorDePlantilla: Importador = {
  id: ID,
  entidad: ENTIDAD,
  documentos: [
    {
      tipo: TIPO_DE_DOCUMENTO,
      etiqueta: ETIQUETA,
      descripcion:
        "La plantilla propia del gestor, en CSV o Excel, para cualquier entidad sin importador: una fila por movimiento y, si se quiere, una hoja de posiciones para conciliar. Se descarga desde la importación."
    }
  ],

  reconocer(documento: DocumentoLeido) {
    return buscarTablas(documento).movimientos.length > 0 ? { tipo: TIPO_DE_DOCUMENTO, confianza: CONFIANZA_DE_LA_PLANTILLA } : undefined;
  },

  importar(documentos, opciones) {
    const resultado = resultadoVacio();
    try {
      const lectura = new LecturaDePlantilla(opciones.divisaBase);
      const importados: DocumentoImportado[] = [];
      for (const { documento } of documentos) {
        const tablas = buscarTablas(documento);
        if (tablas.movimientos.length === 0) {
          resultado.errores.push(explicarCabeceraQueFalta(documento, tablas));
          continue;
        }
        let filas = 0;
        for (const tabla of tablas.movimientos) filas += lectura.leerMovimientos(documento, tabla);
        for (const tabla of tablas.posiciones) filas += lectura.leerPosiciones(documento, tabla);
        importados.push({ nombre: documento.nombre, tipo: TIPO_DE_DOCUMENTO, etiqueta: ETIQUETA, filas });
      }
      if (documentos.length === 0) resultado.errores.push("No hay ningún documento que importar.");
      resultado.documentos = importados;
      resultado.avisos = lectura.avisos;
      if (resultado.errores.length > 0) return resultado;
      const { movimientos, extractos } = lectura.terminar();
      resultado.movimientos = movimientos;
      resultado.extractos = extractos;
      if (movimientos.length === 0) resultado.avisos.push("La plantilla no tiene ningún movimiento: solo la cabecera.");
      return resultado;
    } catch (error) {
      /* El contrato dice que un importador no lanza: un fallo inesperado se cuenta como error. */
      const fallo = resultadoVacio();
      fallo.errores.push(`No se ha podido leer la plantilla por un fallo inesperado: ${error instanceof Error ? error.message : String(error)}. Comprueba que el fichero es la plantilla y vuelve a intentarlo.`);
      return fallo;
    }
  }
};
