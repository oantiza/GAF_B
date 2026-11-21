/* eslint-disable react-refresh/only-export-components */
/**
 * El documento de cada informe, con la plantilla única (`src/reports/plantilla/`): el tema según para quién es, la
 * identidad del asesor en la cabecera, el cliente en «Preparado para» y las secciones repartidas en hojas. Este módulo
 * trae `@react-pdf/renderer`: `index.ts` lo importa de forma dinámica, al generar.
 */
import { periodo } from "../../core/formato";
import { View } from "@react-pdf/renderer";
import { AvisoLegal, DocumentoDeInforme, HojasDeSecciones, renderizarInforme as renderizarDocumento, type TemaDeInforme } from "../../reports/plantilla";
import { primerDiaDelPeriodo } from "./formato";
import { seccionesDe } from "./registro";
import { identidadDe } from "./secciones/comun";
import type { DatosDelInforme, SeccionDeInforme, TipoDeInforme } from "./tipos";

/** Cada informe: su nombre en la cabecera de cada hoja, de qué trata y su tema. */
const DOCUMENTOS: Record<TipoDeInforme, { nombre: string; asunto: string; tema: TemaDeInforme }> = {
  cliente: { nombre: "Informe de cartera", asunto: "Informe de la cartera para el cliente", tema: "cliente" },
  costes: { nombre: "Informe de costes", asunto: "Costes de la cartera en el periodo, para el cliente", tema: "cliente" },
  asesor: { nombre: "Informe del asesor", asunto: "Informe de trabajo del asesor", tema: "interno" }
};

/**
 * El texto legal de la plantilla va una vez, al final: detrás del contenido de la última sección que procede, sea cual
 * sea (en el del asesor puede ser una tabla apaisada; en uno sin cifras, «Sin datos»). Así no abre una hoja propia.
 */
export function conAvisoLegalAlFinal(secciones: readonly SeccionDeInforme[], datos: DatosDelInforme): SeccionDeInforme[] {
  const ultima = secciones.reduce((indice, seccion, i) => (seccion.procede(datos) ? i : indice), -1);
  return secciones.map((seccion, i) => {
    if (i !== ultima) return seccion;
    const { Contenido } = seccion;
    return {
      ...seccion,
      Contenido: (props: { datos: DatosDelInforme }) => (
        <>
          <Contenido {...props} />
          {/* Entero: partido, dejaba sus dos últimas líneas solas en una hoja. */}
          <View wrap={false}>
            <AvisoLegal />
          </View>
        </>
      )
    };
  });
}

function Informe({ tipo, datos, secciones }: { tipo: TipoDeInforme; datos: DatosDelInforme; secciones: readonly SeccionDeInforme[] }) {
  const documento = DOCUMENTOS[tipo];
  const { analisis } = datos;
  const cuando = periodo(primerDiaDelPeriodo(analisis), analisis.periodo.hasta);
  return (
    <DocumentoDeInforme
      tema={documento.tema}
      documento={documento.nombre}
      titulo={[documento.nombre, analisis.cartera.nombre, cuando].filter(Boolean).join(" - ")}
      asunto={documento.asunto}
      identidad={identidadDe(datos)}
      destinatario={analisis.cartera.cliente?.trim() || undefined}
    >
      <HojasDeSecciones secciones={conAvisoLegalAlFinal(secciones, datos)} datos={datos} />
    </DocumentoDeInforme>
  );
}

/** El PDF de un informe. `secciones` permite componerlo con otra lista (las pruebas quitan una). */
export async function renderizarInforme(tipo: TipoDeInforme, datos: DatosDelInforme, secciones: readonly SeccionDeInforme[] = seccionesDe(tipo)): Promise<Blob> {
  return renderizarDocumento(<Informe tipo={tipo} datos={datos} secciones={secciones} />);
}
