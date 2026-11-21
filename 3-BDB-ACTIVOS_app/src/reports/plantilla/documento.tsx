/* eslint-disable react-refresh/only-export-components */
/**
 * El documento: el `Document` de @react-pdf con su idioma, su título, su asunto y su autor, y el reparto del tema y de la
 * identidad a las piezas. Refresca las fuentes antes de componerse.
 */
import { Document, pdf } from "@react-pdf/renderer";
import type { ReactElement, ReactNode } from "react";
import { ADVERTENCIA_DEL_PIE } from "./avisoLegal";
import { ContextoDeInforme, identidadLimpia, type IdentidadDelAsesor } from "./contexto";
import { refrescarFuentes } from "./fuentes";
import type { TemaDeInforme } from "./tema";
import { sanearTexto } from "./texto";

export interface PropiedadesDelDocumento {
  tema: TemaDeInforme;
  /** Qué documento es, como se imprime en la cabecera de cada hoja: «Informe de cartera». */
  documento: string;
  /** El título de los metadatos del PDF. Por defecto, `documento`. */
  titulo?: string;
  /** De qué trata, para los metadatos. */
  asunto?: string;
  identidad?: IdentidadDelAsesor;
  /** Para quién es, en el de cliente («Familia García»): sale como «Preparado para Familia García». */
  destinatario?: string;
  /** La advertencia del pie. Por defecto, la de las rentabilidades pasadas. */
  advertencia?: string;
  children: ReactNode;
}

export function DocumentoDeInforme({ tema, documento, titulo, asunto, identidad, destinatario, advertencia, children }: PropiedadesDelDocumento) {
  /* Fuentes nuevas en cada documento: con las del anterior, el segundo PDF de una sesión pierde letras. Se compone antes de
     maquetar, así que las fuentes que carga la maquetación ya son las nuevas. */
  refrescarFuentes();
  const quien = identidadLimpia(identidad);
  return (
    <Document
      title={sanearTexto(titulo ?? documento)}
      subject={asunto ? sanearTexto(asunto) : undefined}
      author={quien.nombre ? sanearTexto(quien.nombre) : undefined}
      creator="Gestor de activos financieros"
      producer="Gestor de activos financieros"
      language="es"
    >
      <ContextoDeInforme.Provider value={{ tema, identidad: quien, documento, destinatario, advertencia: advertencia ?? ADVERTENCIA_DEL_PIE }}>
        {children}
      </ContextoDeInforme.Provider>
    </Document>
  );
}

/** El PDF de un documento, como `Blob`. Refresca las fuentes también aquí, por si el elemento no es un `DocumentoDeInforme`. */
export async function renderizarInforme(documento: ReactElement): Promise<Blob> {
  refrescarFuentes();
  return pdf(documento as Parameters<typeof pdf>[0]).toBlob();
}
