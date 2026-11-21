/**
 * El importador de Andbank: reconoce sus tres exports y los convierte juntos en movimientos
 * propuestos. Traslado al navegador del lector del servidor
 * (`functions_python/portfolio_real/parser.py`, en la etiqueta de Git `referencia-portfolio-real-2026-11-17`),
 * porque las carteras no salen del equipo.
 */
import type { DocumentoImportado, DocumentoLeido, Importador, ResultadoDeImportacion, TipoDeDocumento } from "../tipos";
import { ErrorDeFormato, fechaEnTexto } from "./comun";
import { leerMovimientos, type ExtractoDeMovimientos } from "./movimientos";
import { leerOperaciones, type OperacionLeida } from "./operaciones";
import { leerPosiciones, type ExtractoDePosiciones } from "./posiciones";
import { proponer } from "./propuesta";

const DOCUMENTOS: TipoDeDocumento[] = [
  {
    tipo: "movimientos",
    etiqueta: "Movimientos de la cuenta de efectivo",
    descripcion: "Los cargos y abonos de la cuenta de efectivo, con su saldo. Se descarga en la banca online de Andbank, en la cuenta de efectivo."
  },
  {
    tipo: "posiciones",
    etiqueta: "Posiciones de la cuenta de valores",
    descripcion: "Lo que hay en la cuenta de valores a una fecha, con su valor de mercado. Se descarga en la banca online de Andbank, en la cuenta de valores."
  },
  {
    tipo: "operaciones",
    etiqueta: "Operaciones de valores",
    descripcion: "Cada operación de la cuenta de valores con su ISIN, sus títulos y su importe, también los traspasos entre fondos. Se descarga en la banca online de Andbank."
  }
];

/** Como `foldText` de la pantalla de cartera real: sin tildes, minúsculas y solo letras y cifras. */
function plegarCabecera(texto: string): string {
  return texto
    .replace(/\ufffd/g, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** El tipo de documento por las cabeceras de sus tablas: los criterios de `detectExportKind` de la pantalla de cartera real. */
function tipoDelDocumento(documento: DocumentoLeido): string | undefined {
  /* Las cabeceras están en las primeras filas de cada tabla: no hace falta leer las demás. */
  const texto = documento.tablas.map((tabla) => plegarCabecera(tabla.slice(0, 6).map((fila) => fila.join(" ")).join(" "))).join(" ");
  const tiene = (frase: string) => texto.includes(frase);
  const pareceMovimientos = (tiene("fecha operacion") || tiene("fecha operacin")) && (tiene("tipo de operacion") || tiene("tipo de operacin")) && tiene("saldo");
  const parecePosiciones = tiene("producto") && tiene("isin") && tiene("valor de mercado");
  const pareceOperaciones = tiene("isin") && tiene("importe neto") && (tiene("titulos nominal") || tiene("ttulos nominal"));
  if (pareceOperaciones && !parecePosiciones) return "operaciones";
  if (pareceMovimientos && !parecePosiciones) return "movimientos";
  if (parecePosiciones && !pareceMovimientos) return "posiciones";
  return undefined;
}

function resultadoVacio(): ResultadoDeImportacion {
  return { importadorId: "andbank", entidad: "Andbank", documentos: [], movimientos: [], extractos: [], avisos: [], errores: [] };
}

export const importadorDeAndbank: Importador = {
  id: "andbank",
  entidad: "Andbank",
  documentos: DOCUMENTOS,

  reconocer(documento) {
    const tipo = tipoDelDocumento(documento);
    return tipo ? { tipo, confianza: 0.9 } : undefined;
  },

  importar(documentos, opciones) {
    const resultado = resultadoVacio();
    const etiqueta = (tipo: string) => DOCUMENTOS.find((documento) => documento.tipo === tipo)?.etiqueta ?? tipo;
    try {
      const deTipo = (tipo: string) => documentos.filter((documento) => documento.tipo === tipo).map((documento) => documento.documento);
      const desconocidos = documentos.filter((documento) => !DOCUMENTOS.some((tipo) => tipo.tipo === documento.tipo));
      for (const desconocido of desconocidos) resultado.avisos.push(`«${desconocido.documento.nombre}» no es un documento de Andbank que se sepa leer: no se ha importado.`);

      const documentosDeMovimientos = deTipo("movimientos");
      const movimientos: ExtractoDeMovimientos | undefined = documentosDeMovimientos.length > 0 ? leerMovimientos(documentosDeMovimientos) : undefined;

      const extractosDePosiciones = deTipo("posiciones").map(leerPosiciones);
      let posiciones: ExtractoDePosiciones | undefined;
      for (const extracto of extractosDePosiciones) {
        if (!posiciones || (extracto.fecha ?? "") > (posiciones.fecha ?? "")) posiciones = extracto;
      }
      if (posiciones && extractosDePosiciones.length > 1) {
        resultado.avisos.push(
          `Has cargado ${extractosDePosiciones.length} extractos de posiciones: se usa el más reciente, «${posiciones.documento}»` +
            `${posiciones.fecha ? `, del ${fechaEnTexto(posiciones.fecha)}` : ""}.`
        );
      }

      const operaciones: OperacionLeida[] = leerOperaciones(deTipo("operaciones"));
      const propuesta = proponer({ divisaBase: opciones.divisaBase, movimientos, posiciones, operaciones });

      const filasDe = (documento: DocumentoLeido, tipo: string): number => {
        if (tipo === "movimientos") return movimientos?.filas.filter((fila) => fila.documento === documento.nombre).length ?? 0;
        if (tipo === "posiciones") return extractosDePosiciones.find((extracto) => extracto.documento === documento.nombre)?.posiciones.length ?? 0;
        if (tipo === "operaciones") return operaciones.filter((operacion) => operacion.documento === documento.nombre).length;
        return 0;
      };
      resultado.documentos = documentos.map(({ documento, tipo }): DocumentoImportado => ({ nombre: documento.nombre, tipo, etiqueta: etiqueta(tipo), filas: filasDe(documento, tipo) }));
      resultado.movimientos = propuesta.movimientos;
      resultado.extractos = propuesta.extractos;
      resultado.avisos.push(...propuesta.avisos);
    } catch (error) {
      resultado.movimientos = [];
      resultado.extractos = [];
      resultado.documentos = documentos.map(({ documento, tipo }) => ({ nombre: documento.nombre, tipo, etiqueta: etiqueta(tipo), filas: 0 }));
      resultado.errores.push(
        error instanceof ErrorDeFormato
          ? error.message
          : `No se han podido leer los documentos de Andbank: ${error instanceof Error ? error.message : String(error)}. Carga los exports originales del banco.`
      );
    }
    return resultado;
  }
};
