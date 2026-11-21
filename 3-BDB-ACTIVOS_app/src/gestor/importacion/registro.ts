/**
 * El registro de importadores.
 *
 * AÑADIR UNA ENTIDAD: crea su carpeta con un `Importador` y añádelo a `IMPORTADORES`.
 * El orden importa solo a igualdad de confianza: va antes el más específico. La plantilla
 * genérica va siempre la última, porque es la que se usa cuando ninguna entidad reconoce
 * el documento.
 */
import { importadorDeAndbank } from "./andbank";
import { importadorDePlantilla } from "./plantilla";
import type { DocumentoLeido, Importador, Reconocimiento, ResultadoDeImportacion } from "./tipos";

export const IMPORTADORES: readonly Importador[] = [importadorDeAndbank, importadorDePlantilla];

export function importadorDe(id: string): Importador | undefined {
  return IMPORTADORES.find((importador) => importador.id === id);
}

/** Qué importador reconoce un documento y como qué. Si ninguno, dice qué se intentó. */
export function reconocer(documento: DocumentoLeido): Reconocimiento {
  let mejor: { importador: Importador; tipo: string; confianza: number } | undefined;
  for (const importador of IMPORTADORES) {
    const reconocido = importador.reconocer(documento);
    if (reconocido && (!mejor || reconocido.confianza > mejor.confianza)) mejor = { importador, ...reconocido };
  }
  if (mejor) {
    const etiqueta = mejor.importador.documentos.find((tipo) => tipo.tipo === mejor.tipo)?.etiqueta ?? mejor.tipo;
    return { documento, importador: mejor.importador, tipo: mejor.tipo, etiqueta, intentos: [] };
  }
  return {
    documento,
    intentos: IMPORTADORES.map((importador) => `${importador.entidad}: ${importador.documentos.map((tipo) => tipo.etiqueta.toLowerCase()).join(", ")}`)
  };
}

/** Importa los documentos reconocidos, agrupados por importador: un resultado por entidad. */
export function importarReconocidos(reconocidos: Reconocimiento[], opciones: { divisaBase: string }): ResultadoDeImportacion[] {
  const porImportador = new Map<Importador, Array<{ documento: DocumentoLeido; tipo: string }>>();
  for (const reconocido of reconocidos) {
    if (!reconocido.importador || !reconocido.tipo) continue;
    const lista = porImportador.get(reconocido.importador) ?? [];
    lista.push({ documento: reconocido.documento, tipo: reconocido.tipo });
    porImportador.set(reconocido.importador, lista);
  }
  return [...porImportador.entries()].map(([importador, documentos]) => importador.importar(documentos, opciones));
}
