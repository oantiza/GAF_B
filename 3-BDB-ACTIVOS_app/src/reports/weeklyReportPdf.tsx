/* eslint-disable react-refresh/only-export-components */
// Informe de estrategia (semanal o diario) con la plantilla única de informes (`./plantilla`): un texto editorial con sus
// indicadores, eventos y asignación, en prosa (`Parrafo`) y tablas (`Tabla`). El tema lo decide para quién sale: interno
// (acero, «USO INTERNO») en la pantalla normal, y de cliente (granate, «CONFIDENCIAL») cuando se genera en Modo cliente, que
// es también cuando no se nombra al proveedor (decisión 67).

import { Link, StyleSheet, View } from "@react-pdf/renderer";
import type { WeeklyReport } from "../types/weeklyReport";
import { AUTOR_DE_ESTRATEGIA, NOTA_DE_ESTRATEGIA, SIN_FUENTES_DE_ESTRATEGIA, avisoDeAtraso } from "../core/compartirEstrategia";
import { descargar, diaDelDocumento, nombreDelFichero } from "../core/descargaDeFicheros";
import { fechaLarga } from "../core/formato";
import { leerIdentidad } from "../core/identidadDelAsesor";
import { conTildesEnLosTitulos } from "../core/textoDeEstrategia";
import {
  Aviso,
  AvisoLegal,
  DocumentoDeInforme,
  FUENTE,
  Hoja,
  MEDIDAS,
  PAPEL,
  Parrafo,
  Presentacion,
  SERIES,
  Tabla,
  Texto,
  TituloDeSeccion,
  renderizarInforme,
  sanearTexto,
  type IdentidadDelAsesor
} from "./plantilla";

const s = StyleSheet.create({
  fuentes: { flexDirection: "row", flexWrap: "wrap", marginTop: 6 },
  /* Tres columnas: lo guardado son dominios, y una por línea sacaba a otra hoja una lista de doce. */
  fuente: { width: "33.33%", paddingRight: 8, marginBottom: 2, fontSize: MEDIDAS.tabla.celda, color: SERIES.cartera, textDecoration: "underline", lineHeight: 1.4 },
  sinFuentes: { fontSize: MEDIDAS.tabla.celda, color: PAPEL.tinta2, lineHeight: 1.4, marginTop: 6 },
  /* Un apartado del texto («Cierre y lectura de la sesión»): antes salía en la letra del párrafo y no se distinguía. */
  apartado: { fontFamily: FUENTE.serifa, fontWeight: 400, fontSize: 11.5, lineHeight: 1.25, color: PAPEL.tinta, marginTop: 10 }
});

/** Lo que el documento dice de sí mismo en la cabecera y en el nombre del fichero. */
const DOCUMENTO = "Informe de estrategia";

const TREND_LABEL: Record<string, string> = { up: "Al alza", down: "A la baja", neutral: "Estable" };
/* El papel decía «Termómetro: Bullish»: la misma lectura que la pantalla (StrategyPage). */
const TEMPERATURE_LABEL: Record<string, string> = { Bullish: "Constructivo", Neutral: "Neutral", Bearish: "Defensivo" };

/** Un trozo del informe completo: un apartado (lo que en el texto es un `## título`) o un párrafo. */
export interface TrozoDelTexto {
  apartado: boolean;
  texto: string;
}

/**
 * El informe completo, por trozos. Los títulos del texto (`## Cierre…`) se separan antes de quitar el formato: quitándolo
 * primero, el título quedaba pegado a su párrafo como una línea más con la misma letra (14-11-2026).
 */
export function trozosDelTexto(markdown: string): TrozoDelTexto[] {
  const trozos: TrozoDelTexto[] = [];
  let parrafo: string[] = [];
  const cerrar = () => {
    const texto = plainMarkdown(parrafo.join("\n"));
    if (texto) trozos.push({ apartado: false, texto });
    parrafo = [];
  };
  for (const linea of markdown.replace(/```[\s\S]*?```/g, "").split(/\r?\n/)) {
    if (/^#{1,6}[ \t]+\S/.test(linea)) {
      cerrar();
      const texto = plainMarkdown(linea);
      if (texto) trozos.push({ apartado: true, texto });
    } else if (linea.trim() === "") {
      cerrar();
    } else {
      parrafo.push(linea);
    }
  }
  cerrar();
  return trozos;
}

function plainMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/[#>*_`~[\]]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Si el informe va pasado de fecha: lo dice el servidor al leerlo, y la pantalla lo pinta de ahí. */
export interface AtrasoDelInforme {
  atrasado: boolean;
  diasDeAtraso: number | null;
}

const AL_DIA: AtrasoDelInforme = { atrasado: false, diasDeAtraso: null };

/** Los números de sección, seguidos, solo para las que salen. */
function numerador() {
  let n = 0;
  return () => {
    n += 1;
    return String(n).padStart(2, "0");
  };
}

function WeeklyReportDoc({ report, reportType, atraso, conProveedor, identidad }: { report: WeeklyReport; reportType: string; atraso: AtrasoDelInforme; conProveedor: boolean; identidad?: IdentidadDelAsesor }) {
  const reportDate = fechaLarga(report.date) ?? report.date;
  const generated = fechaLarga(new Date()) ?? "";
  /* El informe completo entero: @react-pdf pagina solo. Antes se cortaba a 2.800
     caracteres sin aviso y a mitad de frase, cuando el semanal admite hasta
     12.000 (functions_python/weekly_report.py) (auditoría 16-10). Va por párrafos. */
  const parrafos = report.fullReport?.narrative ? trozosDelTexto(conTildesEnLosTitulos(report.fullReport.narrative)) : [];
  const reportLabel = reportType === "DAILY_REPORT" ? "Informe diario" : "Informe semanal";
  const headline = report.summary.headline;
  const aviso = avisoDeAtraso(atraso.atrasado, atraso.diasDeAtraso);
  /* El autor no es `report.author`: lo guardado dice «Mesa de Analisis» o «Comite de Inversiones». */
  /* En Modo cliente no se nombra al proveedor, como en la pantalla y el correo (decisión 67). El autor y la nota se quedan siempre. */
  const firma = [AUTOR_DE_ESTRATEGIA, conProveedor && report.provider ? report.provider : null, `${NOTA_DE_ESTRATEGIA}.`].filter(Boolean).join("  ·  ");
  const fuentes = report.sources ?? [];
  const siguiente = numerador();

  return (
    <DocumentoDeInforme
      tema={conProveedor ? "interno" : "cliente"}
      documento={DOCUMENTO}
      titulo={`${reportLabel} - ${headline}`}
      asunto={`${AUTOR_DE_ESTRATEGIA}. ${NOTA_DE_ESTRATEGIA}.`}
      identidad={identidad ?? leerIdentidad()}
    >
      <Hoja>
        <Presentacion contexto={[reportLabel, reportDate]} titulo={headline} entradilla={firma} />
        {aviso ? <Aviso>{aviso}</Aviso> : null}

        <TituloDeSeccion numero={siguiente()} titulo="Resumen y visión" juntoAlTitulo={60} />
        {report.summary.marketTemperature ? (
          <Parrafo>{`Termómetro: ${TEMPERATURE_LABEL[report.summary.marketTemperature] ?? report.summary.marketTemperature}.`}</Parrafo>
        ) : null}
        <Parrafo>{report.summary.narrative}</Parrafo>

        {report.summary.kpis && report.summary.kpis.length > 0 ? (
          <>
            <TituloDeSeccion numero={siguiente()} titulo="Indicadores" juntoAlTitulo={60} />
            <Tabla
              columnas={[{ titulo: "Indicador", ancho: 1.6 }, { titulo: "Valor", ancho: 1.2 }, { titulo: "Tendencia", ancho: 0.8 }]}
              filas={report.summary.kpis.map((kpi) => ({ celdas: [kpi.label, kpi.value, TREND_LABEL[kpi.trend] ?? kpi.trend] }))}
            />
          </>
        ) : null}

        {report.summary.keyEvents.length > 0 ? (
          <>
            <TituloDeSeccion numero={siguiente()} titulo="Eventos clave" juntoAlTitulo={50} />
            {report.summary.keyEvents.map((event, index) => (
              <Parrafo key={index}>{`• ${event}`}</Parrafo>
            ))}
          </>
        ) : null}

        {/* Los pesos de la asignación (clases, regiones, sectores) no entran en el papel (Óscar, 15-11-2026): los escribe el
            modelo, no salen de un cálculo ni de una decisión de la casa, y el papel puede acabar delante de un cliente. En
            pantalla siguen, rotulados. Tampoco va la «visión» en prosa de esa asignación. */}

        {parrafos.length > 0 ? (
          <>
            <TituloDeSeccion numero={siguiente()} titulo="Informe completo" juntoAlTitulo={60} />
            {parrafos.map((trozo, index) =>
              trozo.apartado ? (
                /* Con lo que le sigue: un apartado no se queda solo al pie de una hoja. */
                <View key={index} minPresenceAhead={40}>
                  <Texto style={s.apartado}>{trozo.texto}</Texto>
                </View>
              ) : (
                <Parrafo key={index}>{trozo.texto}</Parrafo>
              )
            )}
          </>
        ) : null}

        {/* Juntas, para que el cierre nunca se quede solo en una hoja. Enteras y con su enlace, como en pantalla. */}
        <View wrap={false}>
          <TituloDeSeccion numero={siguiente()} titulo="Fuentes consultadas" />
          {fuentes.length > 0 ? (
            <View style={s.fuentes}>
              {fuentes.map((fuente) => (
                <Link key={fuente.url} src={fuente.url} style={s.fuente}>
                  {sanearTexto(fuente.title)}
                </Link>
              ))}
            </View>
          ) : (
            <Texto style={s.sinFuentes}>{SIN_FUENTES_DE_ESTRATEGIA}</Texto>
          )}
          <Parrafo>{`Informe informativo de estrategia. No constituye recomendación personalizada ni evaluación de idoneidad. Generado el ${generated}.`}</Parrafo>
          <AvisoLegal />
        </View>
      </Hoja>
    </DocumentoDeInforme>
  );
}

export async function createWeeklyReportPdfBlob(
  report: WeeklyReport,
  reportType: string,
  atraso: AtrasoDelInforme = AL_DIA,
  conProveedor = true,
  identidad?: IdentidadDelAsesor
): Promise<Blob> {
  return renderizarInforme(<WeeklyReportDoc report={report} reportType={reportType} atraso={atraso} conProveedor={conProveedor} identidad={identidad} />);
}

/* Aquí ni el atraso ni el proveedor son opcionales: lo que se descarga desde la pantalla no puede olvidarse de avisar ni del modo en que está. */
export async function downloadWeeklyReportPdf(report: WeeklyReport, reportType: string, atraso: AtrasoDelInforme, conProveedor: boolean): Promise<void> {
  descargar(await createWeeklyReportPdfBlob(report, reportType, atraso, conProveedor), nombreDelFicheroDeLaEstrategia(report, reportType));
}

/** «Informe de estrategia - Semanal - 2026-11-13.pdf»: el documento, si es el diario o el semanal, y el día del informe que imprime. */
export function nombreDelFicheroDeLaEstrategia(report: Pick<WeeklyReport, "date">, reportType: string): string {
  return nombreDelFichero({ documento: DOCUMENTO, de: reportType === "DAILY_REPORT" ? "Diario" : "Semanal", fecha: diaDelDocumento(report.date) });
}
