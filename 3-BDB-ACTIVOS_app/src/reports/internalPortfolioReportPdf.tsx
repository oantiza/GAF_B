/* eslint-disable react-refresh/only-export-components */
// Informe completo de cartera para el ASESOR (uso interno; nunca se entrega al cliente).
//
// 13-10-2026. Se carga de forma perezosa (import dinámico al pulsar) para no meter @react-pdf en el bundle principal.
//
// 14-10-2026: numeración única de secciones (1…11 + anexo A), «Lectura rápida» al inicio de cada bloque con frases
// construidas SOLO a partir de las cifras del modelo, y glosario al final. Sin campos de cliente: es un documento de
// trabajo del asesor.
//
// 05-11-2026, decisión 33: 3 y 5 años van fundidos. Dos gráficos en una hoja, una tabla con una columna por ventana, y
// lo que no depende de la ventana una sola vez. Cada posición lleva el mismo número en todas las tablas (`numeroDe`),
// un término se define una vez, en el glosario, y sin capital no hay columnas en euros. El índice lleva la página de
// cada sección, con enlaces y marcadores del PDF.
//
// 14-11-2026: pasa a la plantilla única de informes (`./plantilla`), tema interno («Informe interno de la propuesta»,
// sello «USO INTERNO»). Sin hoja de portada: lo que decía pasa a la presentación de la primera hoja, que abre con las
// cifras a 3 años y sigue con el índice. Las cifras se escriben con el módulo común (`core/formato`), la letra y los
// colores son los de la plantilla, y ninguna pieza lleva relleno de color salvo el dato (barras, matrices, mapa, cono).
// Cada hoja lleva arriba, fija, la sección a la que pertenece («Sección 2 · Posiciones»): es lo que decía la franja de
// antes, y lo que permite al índice decir dónde empieza cada una.
//
// Todas las cifras salen del modelo `buildInternalReportModel`: este archivo solo dibuja. Sin dato, «Falta el dato» con
// su causa; nunca un cero.

import { IMPROVEMENT_STATUS_LABELS, improvementSummary } from "../core/portfolioImprovement";
import { VERDICT_LABELS } from "../core/fundEquivalence";
import { Circle, G, Line, Link, Path, Rect, StyleSheet, Svg, Text as TextoSvg, View } from "@react-pdf/renderer";
import { createContext, useContext, type ReactElement, type ReactNode } from "react";
import { GEO_AREAS, GEO_VIEWBOX_BOX } from "../charts/worldMapGeo";
import { buildMonteCarloProjection, centrarEnElTipoSinRiesgo } from "../core/monteCarloProjection";
import { measurementSeries } from "../core/seriesFrequency";
import { buildRegionTable, NOTA_CANADA_Y_AFRICA, ZONE_LABEL, type Macro } from "../core/regionTaxonomy";
import { benchmarkById, composicionConFondos, pesoDeLaReferenciaPorVentanas, tampocoSeReequilibra } from "../core/benchmarkProfiles";
import { esAccion } from "../core/esAccion";
import { rotuloDePosiciones } from "../core/cuentaDePosiciones";
import { rotuloDeSerieParada } from "../core/serieParada";
import { diaLocal } from "../core/fechaLocal";
import { descargar, diaDelDocumento, nombreDelFichero } from "../core/descargaDeFicheros";
import { CORRELACION_ALTA, CORRELACION_MEDIA, palabraDeLaCorrelacion, parejasMasAltas } from "../core/palabraDeLaCorrelacion";
import { fecha, fechaDeEje, fechaLarga, importe, importeTitular, numero, peso, periodo, porcentaje, puntos, rentabilidad, signoDe, type Signo } from "../core/formato";
import { cifrasEnPantalla, textoEnPantalla } from "../core/glosarioDePantalla";
import { motivoDeQueNoAplique, seEnsenaLaMetrica, type MetricaDeInstrumento } from "../core/metricasPorInstrumento";
import { origenDeLaLinea, resumenDeLoMirado } from "../core/holdingsLookthrough";
import { NO_DECLARADO, regionLegible, SIN_SITUAR } from "../core/etiquetasDeReparto";
import { LO_QUE_NO_INCLUYE_EL_COSTE, NOTA_DE_LAS_ACCIONES } from "../core/portfolioCosts";
import { aportacionAlRiesgo, fraseDelMaximoSinLoQueNoSePuedeComprar, notaDeLoQueNoEntraEnLaFrontera, pesoLegible, TOPE_DE_LA_FRONTERA } from "../core/medidaDeLaCartera";
import { pesoEnElPapel } from "../core/parteMedida";
import { cotaDelSolapamiento, noLlegaAUnaDecima, NOTA_MAS_DE_100, NOTA_SIN_COMUNES, pasaDeCien, sinComunes, solapamientoEnUnaFrase, textoDelSolapamiento } from "../core/overlap";
import { FUERA_DEL_CATALOGO, fraseDeLoQueNoEntra, fraseDelSinRepartoEnElPapel } from "../core/repartoDelPapel";
import { tipoDeRespaldo } from "../core/tipoDeRespaldo";
import { fraseDeLasCarterasDelEmisor } from "../core/carteraDelEmisor";
import { corteDeLaMatriz, FUERA_DE_LA_MATRIZ, notasDeLasFechasDelModelo, paresDeSolapamiento, recortarLaMatriz, type ReportOverlapStatus } from "../core/reportOverlap";
import { cuantasAlertas, type FilaDeControl } from "../core/saludYControl";
import { fraseDelEncogimiento } from "../core/notaDeLaPropuesta";
import { motivoDeUnaCrisisSinCifra } from "../core/crisisPasadas";
import { textoDeAusencia } from "../core/textoDeAusencia";
import {
  CLASS_LABELS,
  COVERAGE_LABELS,
  EQUITY_BREAKDOWN_LABELS,
  QUALITY_FLAG_LABELS,
  TYPE_LABELS,
  metricsMethodLabel,
  readableBackendLabel
} from "../core/labels";
import { CLAVE_SIN_DATO_DEL_REPARTO } from "../core/portfolio";
import {
  anioQueMasDifiere,
  aportaMasRiesgoDelQuePesa,
  buildInternalReportModel,
  CLAVE_DE_LO_QUE_NO_ENTRA,
  cualesSonLasAlertas,
  filasDeAniosNaturales,
  loQueMide,
  notaDelMaximoSharpe,
  origenDeLasMetricas,
  origenDelRiesgo,
  topeDelModelo,
  versionDeLaReferencia,
  type InternalHorizonModel,
  type InternalPositionRow,
  type InternalReportInput,
  type InternalReportModel,
  type ReviewSeverity,
  type WeightedBucket
} from "../core/internalPortfolioReport";
import { firmaDelInforme } from "./firmaDelInforme";
import {
  AvisoLegal,
  CifrasDestacadas,
  DocumentoDeInforme,
  FUENTE,
  GraficoDeLineas,
  Hoja,
  ListaDePartes,
  MEDIDAS,
  Nota,
  PAPEL,
  Presentacion,
  SERIES_DEL_TEMA,
  SIN_CLASIFICAR,
  TEMAS,
  Tabla,
  Texto,
  TituloDeSeccion,
  anchoUtil,
  colorDelSigno,
  renderizarInforme,
  sanearTexto,
  useInforme,
  type CeldaDeTabla,
  type CifraDestacada,
  type FilaDeTabla,
  type IdentidadDelAsesor,
  type ParteDelTodo,
  type SerieDeLineas
} from "./plantilla";

/* Este documento es siempre interno: sus gráficos propios toman la paleta del tema interno (la cartera en acero, 14-11-2026), y lo que no
   tiene clase o es solo contexto, el gris neutro del papel. */
const SERIES = { ...SERIES_DEL_TEMA.interno, referencia: SIN_CLASIFICAR };

const M = MEDIDAS;
/** El ancho útil de una hoja vertical, de margen a margen. */
const ANCHO = anchoUtil(false);
const GUTTER = 20;
const MEDIO = (ANCHO - GUTTER) / 2;
/** El nombre del documento en la cabecera de cada hoja. */
/* «Informe interno del asesor», como lo llama la pantalla de Informes (FMT-12): antes, «Informe interno de la propuesta». */
const DOCUMENTO = "Informe interno del asesor";

const s = StyleSheet.create({
  rotuloDeHoja: { fontSize: M.seccion.procedencia, color: PAPEL.tinta3, textAlign: "right", marginBottom: 6, lineHeight: 1.3 },
  h2: { marginTop: 15, marginBottom: 6, paddingBottom: 3, borderBottomWidth: M.seccion.filete, borderBottomColor: PAPEL.filete },
  h2Texto: { fontFamily: FUENTE.serifa, fontWeight: 600, fontSize: 10.5, lineHeight: 1.3, color: PAPEL.tinta },
  h3: { fontSize: M.nota.letra, fontWeight: 600, marginTop: 9, marginBottom: 3, lineHeight: 1.35, color: PAPEL.tinta },
  cuerpo: { fontSize: M.nota.letra, lineHeight: 1.5, color: PAPEL.tinta },
  pequeno: { fontSize: M.seccion.procedencia, lineHeight: 1.45, color: PAPEL.tinta2 },
  pie: { fontSize: M.seccion.procedencia, lineHeight: 1.45, color: PAPEL.tinta2, marginTop: 5 },
  lectura: { marginTop: 6, marginBottom: 9, borderLeftWidth: M.nota.filete, paddingLeft: M.nota.sangria, paddingVertical: 1.5 },
  lecturaTitulo: { fontSize: M.nota.letra, fontWeight: 600, marginBottom: 3, lineHeight: 1.35 },
  lecturaLinea: { flexDirection: "row", marginBottom: 2 },
  lecturaPunto: { width: 9, fontSize: M.nota.letra, color: PAPEL.tinta3, lineHeight: M.nota.interlineado },
  lecturaTexto: { flex: 1, fontSize: M.nota.letra, color: PAPEL.tinta2, lineHeight: M.nota.interlineado },
  kpis: { flexDirection: "row", flexWrap: "wrap", marginTop: 4 },
  kpi: { borderTopWidth: 0.75, borderTopColor: PAPEL.filete, paddingTop: 4.5, paddingRight: 10, paddingBottom: 7.5 },
  kpiRotulo: { fontSize: M.cifras.apunte, color: PAPEL.tinta2, lineHeight: 1.3, minHeight: 20 },
  kpiValor: { fontSize: 11.5, fontWeight: 600, lineHeight: 1.25, marginTop: 1.5 },
  kpiNota: { fontSize: M.tabla.apunte, color: PAPEL.tinta3, lineHeight: 1.35, marginTop: 2 },
  dosColumnas: { flexDirection: "row", columnGap: GUTTER },
  columna: { flex: 1 },
  indiceFila: { flexDirection: "row", minHeight: 40, paddingVertical: 4.5, borderBottomWidth: 0.75, borderBottomColor: PAPEL.filete, textDecoration: "none", color: PAPEL.tinta },
  indiceNumero: { width: 22, fontSize: M.nota.letra, fontWeight: 600, lineHeight: 1.35 },
  indiceTitulo: { fontSize: M.nota.letra, fontWeight: 600, lineHeight: 1.35, color: PAPEL.tinta },
  indicePagina: { fontSize: M.seccion.procedencia, color: PAPEL.tinta3, lineHeight: 1.45, textAlign: "right" },
  indiceTexto: { fontSize: M.seccion.procedencia, color: PAPEL.tinta2, lineHeight: 1.4 },
  revisarFila: { flexDirection: "row", alignItems: "flex-start", paddingVertical: 3, borderBottomWidth: 0.75, borderBottomColor: PAPEL.filete },
  revisarGrado: { width: 36, fontSize: M.tabla.celda, fontWeight: 600, lineHeight: 1.3 },
  revisarArea: { width: 82, fontSize: M.tabla.celda, color: PAPEL.tinta2, paddingLeft: 6, lineHeight: 1.3 },
  revisarTexto: { flex: 1, fontSize: M.tabla.celda, lineHeight: 1.3 },
  glosarioFila: { flexDirection: "row", paddingVertical: 4.5, borderBottomWidth: 0.75, borderBottomColor: PAPEL.filete },
  glosarioTermino: { width: 118, fontSize: M.tabla.celda, fontWeight: 600, paddingRight: 10, lineHeight: 1.45 },
  glosarioTexto: { flex: 1, fontSize: M.tabla.celda, lineHeight: 1.45, color: PAPEL.tinta2 },
  /* La tabla con cola: las mismas medidas que la `Tabla` de la plantilla. */
  tCabecera: { flexDirection: "row", borderBottomWidth: M.tabla.filete, borderBottomColor: PAPEL.fileteFuerte },
  tTitulo: { fontWeight: 600, color: PAPEL.tinta3, lineHeight: 1.3 },
  tFila: { flexDirection: "row", borderBottomWidth: M.tabla.filete, borderBottomColor: PAPEL.filete },
  tAusente: { color: PAPEL.tinta3, lineHeight: 1.3, paddingTop: 1 },
  tApunte: { color: PAPEL.tinta3, lineHeight: 1.3, marginTop: 1 }
});

// ------------------------------------------------------------------ formato
/** Lo que se dice de una cifra de la cartera que no se da (decisión 59), y de cualquier dato que falte. */
const FALTA = textoDeAusencia("falta");
const NO_APLICA = textoDeAusencia("no-aplica");
/** Lo escrito por `core/formato`, o su frase si falta: para las frases, donde solo cabe texto. */
const t = (texto: string | null | undefined): string => texto ?? FALTA;
/** Un porcentaje desde una fracción, con los decimales que se pidan (dos por defecto: volatilidad, caída, coste). */
export const pct = (v: number | null | undefined, d = 2) => t(porcentaje(v, { decimales: d }));
/** Lo mismo con signo: una rentabilidad (`+10,39 %`). */
export const pctSigned = (v: number | null | undefined, d = 2) => t(porcentaje(v, { decimales: d, conSigno: true }));
/** Un ratio (Sharpe, beta…) con dos decimales; con uno, el número efectivo de posiciones. */
export const ratio = (v: number | null | undefined, d = 2) => t(numero(v, { decimales: d }));
const pesoT = (v: number | null | undefined) => t(peso(v));
const ppT = (v: number | null | undefined) => t(puntos(v));
/** Un importe en una frase o en una cifra titular, sin decimales. En las tablas, `importe`, con dos. */
const eur = (v: number | null | undefined) => t(importeTitular(v));
const fechaT = (dia: string | null | undefined) => t(fecha(dia));
const num = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);
/** Una celda de rentabilidad: dos decimales, con signo y su color. */
const celdaRent = (v: number | null | undefined): CeldaDeTabla => ({ texto: rentabilidad(v), signo: signoDe(v, 4) });
/** Una diferencia en puntos, con signo y su color; lo que se escribe «0,00 pp» no es ni verde ni rojo. */
const celdaPp = (v: number | null | undefined): CeldaDeTabla => ({ texto: puntos(v), signo: signoDe(v, 4) });
/** Las ventanas con cifras de la cartera: el resto dice que le faltan y por qué. */
const conCifra = (m: InternalReportModel) => m.horizons.filter((h) => !h.motivoSinCifra);
/** Un ratio para una celda o una cifra destacada: `null` si falta, y la pieza escribe su frase. */
const ratioC = (v: number | null | undefined) => numero(v, { decimales: 2 });
/** El Sharpe de una acción no se enseña: se escribe que no aplica, que no es lo mismo que un dato que falta (decisión 41). */
const sharpeDePosicion = (tipo: string, valor: number | null | undefined) => (esAccion(tipo) ? NO_APLICA : ratioC(valor));
/** El Sharpe y el Sortino de la cartera, salvo que lo medido sea una sola acción: la misma regla que Análisis. */
const sharpeDeCartera = (h: InternalHorizonModel | undefined) => (h?.sharpeNoAplica ? NO_APLICA : ratioC(metricOf(h, "sharpe")));
const sortinoDeCartera = (h: InternalHorizonModel | undefined) => (h?.sharpeNoAplica ? NO_APLICA : ratioC(h?.sortino));
/**
 * Lo que el contrato reserva a fondos y ETF, y el Calmar, si lo medido es una sola acción (decisión 83): se escribe que no aplica. Dos acciones siguen siendo
 * una cartera, y la beta, el VaR, la volatilidad y la caída se quedan: no están en la lista.
 */
const noAplicaAUnaAccion = (h: InternalHorizonModel | undefined, metrica: MetricaDeInstrumento) => Boolean(h?.sharpeNoAplica) && !seEnsenaLaMetrica(metrica, "STOCK");
const cifraDeCartera = (h: InternalHorizonModel | undefined, metrica: MetricaDeInstrumento, cifra: string | null) => (noAplicaAUnaAccion(h, metrica) ? NO_APLICA : cifra);
/** Una acción no tiene coste corriente: se escribe que no aplica, que no es lo mismo que un dato que falta. */
const terDe = (r: InternalPositionRow) => (esAccion(r.instrumentType) ? NO_APLICA : porcentaje(r.ter));
/** Una acción no tiene retrocesión: se escribe que no aplica. Si de verdad trae un registro, manda el dato. */
const retroDe = (r: InternalPositionRow) => (r.retroPct !== null ? porcentaje(r.retroPct / 100) : esAccion(r.instrumentType) ? NO_APLICA : null);
const vigenciaDe = (r: InternalPositionRow): CeldaDeTabla => (r.retroAsOf ? fecha(r.retroAsOf) : esAccion(r.instrumentType) ? NO_APLICA : null);
const ingresoDe = (r: InternalPositionRow): CeldaDeTabla => (r.retroPct === null && esAccion(r.instrumentType) ? NO_APLICA : importe(r.retroIncomeEur));
/** «5 mayores» de una cartera de cinco o menos dice siempre 100 %: la misma regla que «10 mayores». */
const masDeCinco = (m: InternalReportModel) => (m.concentration?.positions ?? 0) > 5;
const soloAcciones = (m: InternalReportModel) => m.positions.length > 0 && m.costs.stocks === m.positions.length;
const retroMediaDe = (m: InternalReportModel) => (m.retro.weightedRetroPct !== null ? pct(m.retro.weightedRetroPct / 100) : soloAcciones(m) ? NO_APLICA : FALTA);
/** Sobre qué parte del peso va la media: con acciones, la de fondos y ETF, porque a ellas no les aplica. */
const pesoConRetro = (m: InternalReportModel) => `${pct(m.retro.coverage, 0)} del peso ${m.costs.stocks > 0 ? "de fondos y ETF" : "con dato"}`;
/** Lo que dice una retrocesión parcial: de qué parte es la media y qué supone sobre toda la cartera. No se resta de lo que paga el cliente: es de quien distribuye. */
function retroParcial(m: InternalReportModel): string {
  const ingreso = m.totalCapital !== null && num(m.retro.annualIncomeEur) ? `${eur(m.retro.annualIncomeEur)}, ` : "";
  return `${retroMediaDe(m)} medio sobre el ${pesoConRetro(m)}; ${ingreso}un ${pct(m.retro.sobreLaCartera)} de toda la cartera`;
}
/** Lo que acompaña a toda media de coste que lleva acciones a cero. */
const accionesACero = (m: InternalReportModel) => (m.costs.stocks > 0 ? " Las acciones no tienen coste corriente y cuentan como cero." : "");
const notaDeAcciones = (m: InternalReportModel) => (m.costs.stocks > 0 ? `${accionesACero(m)} ${NOTA_DE_LAS_ACCIONES}` : "");
/** La media de coste de una cartera solo de acciones vale cero porque no hay nada que medir, y un 0,00 % se leería como gratis (decisiones A-65 y A-83). */
const costeMedioDe = (m: InternalReportModel) => (soloAcciones(m) ? NO_APLICA : pct(m.costs.weightedTer));
/**
 * A algún fondo o ETF le falta el coste corriente: la media y el coste anual son de la parte con dato, no de toda la cartera
 * (auditoría 16-11-2026, INF-2 e INF-3). La frase de lectura ya lo decía; el indicador y la fila de total, no, y junto a
 * «100 %» de peso se leían como el total. Se marcan como la retrocesión parcial.
 */
const costeParcial = (m: InternalReportModel) => m.costs.missing > 0 && !soloAcciones(m);
/** El indicador de riesgo en la columna: un SRRI lo dice, porque es otra escala (decisión 79). El nivel estimado solo lo trae la base vieja. */
function riesgoEnLaTabla(r: InternalPositionRow): CeldaDeTabla {
  if (!seEnsenaLaMetrica("indicadorDeRiesgo", r.instrumentType)) return NO_APLICA;
  if (r.sri === null) return null;
  const nivel = Math.round(r.sri);
  return r.sriSource === "SRRI" ? `${nivel} SRRI` : r.sriSource === "VOL_BUCKET" ? `${nivel} est.` : String(nivel);
}
const SITUACION_DEL_FONDO: Record<ReportOverlapStatus, string> = {
  available: "Se mide",
  insufficient: "No se mide: falta más de la mitad",
  missing: "No se mide: no publica su cartera",
  failed: "No se mide: error de carga",
  not_applicable: "No aplica: es una acción",
  synthetic: "No se mide: replica con una permuta (swap)"
};
const classLabel = (k: string) => CLASS_LABELS[k] ?? readableBackendLabel(k);
const typeLabel = (k: string) => TYPE_LABELS[k] ?? readableBackendLabel(k);
const windowLabel = (w: string) => `${w[0]} años`;
const SEVERITY_LABEL: Record<ReviewSeverity, string> = { alta: "Alta", media: "Media", info: "Info" };
/* Lo que pide la atención del asesor va en ocre, con su palabra escrita; lo que es contexto, en gris. */
const SEVERITY_COLOR: Record<ReviewSeverity, string> = { alta: PAPEL.aviso, media: PAPEL.aviso, info: PAPEL.tinta3 };

/** El número de cada posición, el mismo en todas las tablas: su orden en la tabla de posiciones, de mayor a menor peso. */
const numeroDe = (m: InternalReportModel, assetId: string) => m.positions.findIndex((p) => p.assetId === assetId) + 1;

/** Una matriz en el orden y con el número de las posiciones. `indices` dice de qué fila venía cada una. */
export function enOrdenDePosicion<V>(m: InternalReportModel, ids: string[], values: V[][]) {
  const orden = ids.map((id, i) => ({ id, i, n: numeroDe(m, id) || Number.MAX_SAFE_INTEGER })).sort((a, b) => a.n - b.n);
  return {
    ids: orden.map((o) => o.id),
    numeros: orden.map((o) => o.n),
    indices: orden.map((o) => o.i),
    values: orden.map((fila) => orden.map((columna) => values[fila.i][columna.i]))
  };
}

/** «3 años y 5 años», o la que haya. */
const ventanasEnTitulo = (ventanas: InternalHorizonModel[]) => (ventanas.length > 1 ? `${ventanas.map((h) => h.window[0]).join(" y ")} años` : ventanas.map((h) => windowLabel(h.window)).join(""));

/** Metodología de las métricas de una posición, en corto para tablas. En la base nueva, las propias son los dos métodos del extractor. */
function methodShort(method: string | null): string | null {
  if (method === "GEOMETRIC_CAGR" || method?.startsWith("EXTRACTOR_")) return "Serie propia";
  return method === "TRAILING_PROVIDER" ? "Proveedor" : method ? readableBackendLabel(method) : null;
}

/** Un mes del dato («2026-04») como lo lee una persona: «abr 2026». */
export function mesLegible(mes: string | null | undefined): string {
  const [, anio, numeroDelMes] = /^(\d{4})-(\d{2})$/.exec(mes ?? "") ?? [];
  if (!anio) return FALTA;
  return t(fechaDeEje(`${anio}-${numeroDelMes}-01`));
}

/**
 * La escala de una gráfica de caídas. Una caída no pasa de 0, así que el eje se cierra ahí: con el margen de las demás llegaba a +0,9 % y +1,2 %.
 * Por abajo, el mismo margen de siempre. Sin ninguna caída, un punto, para que haya eje. La gráfica de la plantilla ya cierra su eje en
 * el mayor valor de la serie, que en una de caídas es 0: esta función queda como la regla escrita, y su prueba la guarda.
 */
export function escalaDeCaidas(caidas: readonly number[]): [number, number] {
  const peor = Math.min(0, ...caidas.filter((v) => Number.isFinite(v)));
  return [peor < 0 ? peor * 1.08 : -0.01, 0];
}

function scale(values: number[], fallback: [number, number], padding = 0.08): [number, number] {
  const finite = values.filter((v) => Number.isFinite(v));
  if (!finite.length) return fallback;
  let min = Math.min(...finite);
  let max = Math.max(...finite);
  if (min === max) { min -= 1; max += 1; }
  const pad = (max - min) * padding;
  return [min - pad, max + pad];
}

/** Junta en una sola cadena los trozos de texto: @react-pdf recorta los espacios de los bordes de cada trozo y "Capital {x}" salía "Capital200.000 €". */
function unTexto(node: ReactNode): string {
  const parts = Array.isArray(node) ? (node as unknown[]).flat(Infinity) : [node];
  return parts.filter((x) => x !== null && x !== undefined && x !== false).map(String).join("");
}
type EstiloDeTexto = Parameters<typeof Texto>[0]["style"];
function T({ style, children, fixed }: { style?: EstiloDeTexto; children?: ReactNode; fixed?: boolean }) {
  return <Texto style={style} fixed={fixed}>{unTexto(children)}</Texto>;
}
/* Títulos que nunca quedan solos al pie: piden sitio para su contenido en la misma página. */
function H2({ children }: { children?: ReactNode }) {
  return (
    <View style={s.h2} minPresenceAhead={48} wrap={false}>
      <T style={s.h2Texto}>{children}</T>
    </View>
  );
}
function H3({ children }: { children?: ReactNode }) {
  return (
    <View minPresenceAhead={32} wrap={false}>
      <T style={s.h3}>{children}</T>
    </View>
  );
}

// --------------------------------------------------------------- estructura
/**
 * La página donde empieza cada sección, para el índice (hallazgo 116). No se calcula ni se supone: la apunta la propia paginación. Cada
 * hoja lleva una marca de altura cero, y @react-pdf llama a su `render` al repartir las páginas. El índice escribe su número después, en
 * la misma llamada final que «Página x de y», cuando ya están todas repartidas: no hay una segunda pasada que pueda no coincidir con esta.
 * Una sección sin marca no lleva número en el índice.
 */
const PaginasDeLasSecciones = createContext(new Map<string, number>());

/** La entrada del índice que corresponde a una hoja, por su rótulo: la 4.1 abre la sección 4 y la 4.2 no tiene entrada propia. */
const anclaDeLaSeccion = (section: string) => section.split(" · ")[0].replace(/\.1$/, "");

/**
 * La marca de una hoja: el destino de su enlace del índice, su marcador del PDF y el apunte de su página. Los marcadores de @react-pdf
 * valen en cualquier nodo, aunque sus tipos solo los declaren en `Page`. `fit`: sin él, el visor abre mirando al margen derecho.
 */
function MarcaDeLaHoja({ ancla, titulo }: { ancla: string; titulo: string }) {
  const paginas = useContext(PaginasDeLasSecciones);
  const marcador = { bookmark: { title: titulo, fit: true } } as object;
  return <View id={`seccion-${ancla}`} {...marcador} render={({ pageNumber }) => { paginas.set(ancla, pageNumber); return null; }} />;
}

/**
 * Una hoja del documento, de la plantilla: su cabecera, su filete, su sello y «Página x de y». Arriba, fija en cada hoja por la que siga,
 * la sección a la que pertenece.
 */
function Sheet({ section, orientation = "portrait", children }: { m?: InternalReportModel; section: string; orientation?: "portrait" | "landscape"; children: ReactNode }) {
  return (
    <Hoja apaisada={orientation === "landscape"}>
      <T fixed style={s.rotuloDeHoja}>{`Sección ${section}`}</T>
      <MarcaDeLaHoja ancla={anclaDeLaSeccion(section)} titulo={section} />
      {children}
    </Hoja>
  );
}

function SectionHead({ number, title, lead }: { number: string; title: string; lead?: string }) {
  return <TituloDeSeccion numero={number} titulo={title} procedencia={lead} juntoAlTitulo={140} arribaDelTodo />;
}

/**
 * Lo que mide cada cifra de la hoja: una línea fija bajo el título, que se repite si la sección sigue en otra hoja (hallazgo 114).
 * La referencia la dice su propia nota, donde se compara.
 */
function LoQueMide({ m, ventanas = m.horizons }: { m: InternalReportModel; ventanas?: InternalHorizonModel[] }) {
  const posiciones = m.positions.map((p) => ({ asset_id: p.assetId, weight_percent: p.weight * 100 }));
  const linea = loQueMide(ventanas.map((h) => h.horizon), posiciones, [...m.assetsById.values()]);
  return linea ? <T fixed style={[s.pequeno, { marginTop: 6, marginBottom: 4 }]}>{linea}</T> : null;
}

/** Lo que se dice de cada ventana que no da cifras de la cartera, con su motivo. Si dicen lo mismo, una vez. */
function lineasSinCifra(
  m: InternalReportModel,
  ventanas: InternalHorizonModel[] = m.horizons,
  frase: (anos: string, motivo: string) => string = (anos, motivo) => `${FALTA} de la cartera a ${anos} años. ${motivo}`
): string[] {
  const sinCifra = ventanas.filter((h) => h.motivoSinCifra);
  if (!sinCifra.length) return [];
  if (sinCifra.every((h) => h.motivoSinCifra === sinCifra[0].motivoSinCifra)) {
    return [frase(sinCifra.map((h) => h.horizon.years).join(" y "), sinCifra[0].motivoSinCifra ?? "")];
  }
  return sinCifra.map((h) => frase(String(h.horizon.years), h.motivoSinCifra ?? ""));
}

function SinCifraDeLaCartera({ m }: { m: InternalReportModel }) {
  return <Reading title="Por qué no hay cifras" lines={lineasSinCifra(m)} />;
}

function Note({ children }: { children: ReactNode }) {
  return <Nota>{unTexto(children)}</Nota>;
}

/** «Lectura rápida»: dos o tres frases construidas con las cifras del modelo. Las líneas vacías (sin dato) se omiten; si no queda ninguna, el bloque no se dibuja. */
function Reading({ title = "Lectura rápida", lines }: { title?: string; lines: Array<string | null | false | undefined> }) {
  const { tema } = useInforme();
  const items = lines.filter((x): x is string => typeof x === "string" && x.length > 0);
  if (!items.length) return null;
  return (
    <View style={[s.lectura, { borderLeftColor: TEMAS[tema].color }]} wrap={false}>
      <Texto style={s.lecturaTitulo}>{title}</Texto>
      {items.map((line, i) => (
        <View key={i} style={s.lecturaLinea}>
          <Texto style={s.lecturaPunto}>·</Texto>
          <Texto style={s.lecturaTexto}>{line}</Texto>
        </View>
      ))}
    </View>
  );
}

interface KpiItem { label: string; value: string | null; note?: string; signo?: Signo | null; aviso?: boolean }
/** Pares de rótulo y cifra, con su nota, como la `Rejilla` de la plantilla: sin relleno, con un filete gris encima. */
function KpiGrid({ items, columns = 4 }: { items: KpiItem[]; columns?: number }) {
  const ancho = `${100 / Math.max(1, columns)}%`;
  return (
    <View style={s.kpis}>
      {items.map((item) => (
        <View key={item.label} style={[s.kpi, { width: ancho }]} wrap={false}>
          <Texto style={s.kpiRotulo}>{item.label}</Texto>
          <Texto style={[s.kpiValor, { color: item.aviso ? PAPEL.aviso : colorDelSigno(item.signo) }]}>{t(item.value)}</Texto>
          {item.note ? <Texto style={s.kpiNota}>{item.note}</Texto> : null}
        </View>
      ))}
    </View>
  );
}

// ------------------------------------------------------------------ tablas
interface Columna<F> {
  titulo: string; ancho: number; cifra?: boolean; celda: (fila: F) => CeldaDeTabla;
  /** Una columna estrecha de cifras: lo que falta se dice con la forma corta («Falta»), la de las celdas estrechas de la pantalla. */
  estrecha?: boolean;
}

const FALTA_CORTO = textoDeAusencia("falta", { estrecha: true });
const conLaFormaCorta = (celda: CeldaDeTabla): CeldaDeTabla =>
  celda === null ? { texto: null, motivo: FALTA_CORTO } : typeof celda === "object" && celda.texto === null && !celda.motivo ? { ...celda, motivo: FALTA_CORTO } : celda;

/** Una tabla de la plantilla, escrita por columnas. */
function TablaDe<F>({ columnas, filas, total }: { columnas: Columna<F>[]; filas: readonly F[]; total?: CeldaDeTabla[] }) {
  return (
    <Tabla
      columnas={columnas.map(({ titulo, ancho, cifra }) => ({ titulo, ancho, cifra }))}
      filas={filas.map((fila): FilaDeTabla => ({ celdas: columnas.map((c) => (c.estrecha ? conLaFormaCorta(c.celda(fila)) : c.celda(fila))) }))}
      total={total}
    />
  );
}

/**
 * Las tablas largas de posiciones (posiciones, costes, calidad y pesos de la frontera). Tienen el aspecto de la `Tabla` de la plantilla
 * —cabecera sin relleno que se repite, filas que no se parten, total con el filete del tema—, y dos cosas que a esa le faltan: más filas
 * pegadas al total (`cola`), para que la última hoja no se quede con una fila, y lo que cierra la tabla pegado a ellas (`alPie`). Con
 * `densa`, la letra de los apuntes: una tabla de catorce columnas no cabe con la de siempre. Anchos en puntos.
 */
function TablaConCola<F>({ columnas, filas, clave, total, cola = 0, alPie, densa = false }: {
  columnas: Columna<F>[]; filas: readonly F[]; clave: (fila: F, i: number) => string; total?: CeldaDeTabla[];
  /** Las últimas filas van juntas, con el total: si saltan de hoja, saltan todas. No calcula alturas: las reparte quien pagina. */
  cola?: number;
  /** Lo que cierra la tabla y no debe quedarse solo en una hoja: una nota, unas líneas. Va pegado a la cola. */
  alPie?: ReactNode;
  densa?: boolean;
}) {
  const { tema } = useInforme();
  const letra = densa ? M.tabla.apunte : M.tabla.celda;
  const letraDelApunte = densa ? 6.6 : M.tabla.apunte;
  const interlineado = densa ? 1.2 : 1.3;
  const rellenoV = densa ? 2.5 : M.tabla.rellenoVertical;
  const rellenoH = densa ? 3.5 : M.tabla.rellenoHorizontal;
  const caja = (i: number) => ({ width: columnas[i].ancho, paddingVertical: rellenoV, paddingLeft: i === 0 ? 0 : rellenoH, paddingRight: i === columnas.length - 1 ? 0 : rellenoH });
  const alinear = (i: number) => (columnas[i].cifra ? "right" : "left") as "right" | "left";
  /* En una columna estrecha, la forma corta de lo que falta («Falta»), la que la pantalla usa en las celdas estrechas: no parte la fila en dos. */
  const ausencia = (i: number) => (columnas[i].ancho < 50 ? FALTA_CORTO : FALTA);
  const celda = (contenido: CeldaDeTabla, i: number, negrita: boolean) => {
    const dato = typeof contenido === "object" && contenido !== null ? contenido : { texto: contenido };
    const textAlign = alinear(i);
    return (
      <View key={i} style={caja(i)}>
        {dato.texto === null ? (
          <Texto style={[s.tAusente, { fontSize: letraDelApunte, lineHeight: interlineado, textAlign }]}>{ausencia(i)}</Texto>
        ) : (
          <Texto style={{ fontSize: letra, lineHeight: interlineado, textAlign, fontWeight: negrita ? 600 : 400, color: colorDelSigno("signo" in dato ? dato.signo : null) }}>{dato.texto}</Texto>
        )}
        {"apunte" in dato && dato.apunte ? <Texto style={[s.tApunte, { fontSize: letraDelApunte, lineHeight: interlineado, textAlign }]}>{dato.apunte}</Texto> : null}
      </View>
    );
  };
  const fila = (f: F, i: number) => (
    <View key={clave(f, i)} style={s.tFila} wrap={false}>
      {columnas.map((c, j) => celda(c.celda(f), j, false))}
    </View>
  );
  /* El total nunca abre hoja solo: lleva al menos dos filas con él, y las de la cola si se pide más. */
  const pegadas = Math.min(filas.length, Math.max(cola, total || alPie ? 2 : 0));
  const corte = filas.length - pegadas;
  const filaDelTotal = total ? (
    <View style={[s.tFila, { borderBottomWidth: 0, borderTopWidth: M.tabla.filete, borderTopColor: TEMAS[tema].color }]}>
      {columnas.map((_, i) => celda(total[i] === undefined ? "" : total[i], i, true))}
    </View>
  ) : null;
  return (
    <View style={{ marginTop: 3 }}>
      <View style={s.tCabecera} fixed wrap={false}>
        {columnas.map((c, i) => (
          <View key={`${c.titulo}-${i}`} style={caja(i)}>
            <Texto style={[s.tTitulo, { fontSize: densa ? letra : M.tabla.cabecera, textAlign: alinear(i) }]}>{c.titulo}</Texto>
          </View>
        ))}
      </View>
      {filas.slice(0, corte).map((f, i) => fila(f, i))}
      {pegadas || filaDelTotal || alPie ? (
        <View wrap={false}>
          {filas.slice(corte).map((f, i) => fila(f, corte + i))}
          {filaDelTotal}
          {alPie}
        </View>
      ) : null}
    </View>
  );
}

/** Cuántas filas cierran juntas una tabla de posiciones: un tercio, hasta ocho. La hoja que reciba la cola nunca lleva una fila suelta. */
const colaDeLaTabla = (filas: number) => Math.min(8, Math.ceil(filas / 3));

/** Lo mismo para cada ventana, en dos columnas; con una sola, a todo el ancho. */
function PorVentana({ ventanas, children }: { ventanas: InternalHorizonModel[]; children: (h: InternalHorizonModel, ancho: number) => ReactNode }) {
  const ancho = ventanas.length > 1 ? MEDIO : ANCHO;
  return (
    <View style={s.dosColumnas}>
      {ventanas.map((h) => <View key={h.window} style={{ width: ancho }}>{children(h, ancho)}</View>)}
    </View>
  );
}

/**
 * Los gráficos de líneas de cada ventana, uno debajo de otro y a todo el ancho: a media hoja, las marcas del eje de fechas de la plantilla
 * (hasta seis, sin mirar el ancho) se pisan.
 */
function GraficosPorVentana({ ventanas, children }: { ventanas: InternalHorizonModel[]; children: (h: InternalHorizonModel, ancho: number) => ReactNode }) {
  return <View>{ventanas.map((h) => <View key={h.window} wrap={false}>{children(h, ANCHO)}</View>)}</View>;
}

function RotuloDeVentana({ h }: { h: InternalHorizonModel }) {
  return <Texto style={[s.h3, { marginTop: 4, marginBottom: 0 }]}>{windowLabel(h.window)}</Texto>;
}

// ------------------------------------------------------------------ gráficos
/** Lo que se dice donde iría un gráfico cuya serie no da para dibujarlo. */
const SIN_SERIE = `${FALTA}: la serie no da para dibujarla.`;

/** Un reparto como lista de partes de la plantilla: nombre, barra y cifra. «Otros» y lo que no entra, en gris y al final. */
function BarList({ rows, width, empty = "Sin datos de distribución.", limit = 10, enUnaLinea = false }: {
  rows: WeightedBucket[]; width: number; empty?: string; limit?: number;
  /** La hoja no da para nombres en dos líneas: van en una, cortados por una palabra. */
  enUnaLinea?: boolean;
}) {
  if (!rows.length) return <Texto style={s.pequeno}>{empty}</Texto>;
  /* Lo que no entra en el reparto no se pierde dentro de «Otros» (decisión 85). */
  const fueraDelReparto = rows.filter((r) => r.key === CLAVE_DE_LO_QUE_NO_ENTRA);
  const delReparto = rows.filter((r) => r.key !== CLAVE_DE_LO_QUE_NO_ENTRA);
  const shown = delReparto.slice(0, limit);
  const rest = delReparto.slice(limit).reduce((sum, r) => sum + r.weight, 0);
  const all = [...(rest > 0.0005 ? [...shown, { key: "_otros", label: "Otros", weight: rest }] : shown), ...fueraDelReparto];
  /* Un reparto neto puede traer una clase en negativo: se lee en la cifra, y la barra se queda a cero (decisión A-63). */
  const partes: ParteDelTodo[] = all.map((r) => ({
    nombre: enUnaLinea ? shorten(r.label, 25) : r.label,
    fraccion: r.weight,
    cifra: peso(r.weight),
    ...(r.key === "_otros" || r.key === "unclassified" || r.key === CLAVE_DE_LO_QUE_NO_ENTRA ? { color: SERIES.referencia } : {})
  }));
  return <ListaDePartes partes={partes} ancho={width} anchoDeBarra={Math.min(110, width * 0.36)} />;
}

const AREA_MACRO: Record<string, Macro> = {
  north_america: "america", latin_america: "america", europe: "emea", africa: "emea", middle_east: "emea",
  asia: "asia", japan: "asia", oceania: "asia"
};
const MACROS: Macro[] = ["america", "emea", "asia"];
/** El tono de una zona en una sola tinta, la de la cartera: más peso, más oscuro. La cifra va siempre escrita al lado. */
const tonoDeZona = (pesoPct: number, mayor: number) => 0.12 + 0.78 * Math.min(1, Math.max(0, pesoPct) / (mayor || 1));

function Muestra({ opacidad, color = SERIES.cartera }: { opacidad: number; color?: string }) {
  return (
    <Svg width={7} height={7} style={{ marginRight: 5 }}>
      <Rect x={0} y={0} width={7} height={7} fill={color} fillOpacity={opacidad} />
    </Svg>
  );
}

/** `unclassified`: % de la RV sin región, del núcleo (`unclassified_weight_percent`), como la pantalla. La misma tabla que la pantalla. */
function GeoMap({ rows, unclassified, canadaYAfricaSinSeparar, width }: { rows: Array<{ key: string; weight_percent: number }>; unclassified: number; canadaYAfricaSinSeparar: boolean; width: number }) {
  const { table, macroTotals: totals, other: sinSituar } = buildRegionTable(rows);
  /* Como la pantalla: lo que no consta y lo que el dato nombra y la tabla no sabe situar son dos cosas (decisión 66). */
  const sinZona = [{ rotulo: NO_DECLARADO, peso: unclassified }, { rotulo: SIN_SITUAR, peso: sinSituar }].filter((fila) => fila.peso > 0.05);
  if (!rows.length || MACROS.every((m) => !(totals[m] > 0))) {
    return <Texto style={s.pequeno}>Sin reparto geográfico de la renta variable: ninguna posición publica regiones ni declara una región reconocible.</Texto>;
  }
  const mayor = Math.max(...MACROS.map((m) => totals[m] ?? 0));
  const vb = GEO_VIEWBOX_BOX;
  const mapW = Math.min(290, width * 0.56);
  const mapH = Math.round((mapW * vb.h) / vb.w);
  const tableRows = table.filter((r) => r.group || r.value > 0.05);
  const fila = { flexDirection: "row" as const, alignItems: "center" as const, marginTop: 2.5 };
  const celda = { fontSize: M.tabla.celda, lineHeight: 1.3 };
  return (
    <View style={{ flexDirection: "row" }} wrap={false}>
      <View style={{ width: mapW }}>
        <Svg viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`} width={mapW} height={mapH}>
          {GEO_AREAS.map((a) => {
            const total = totals[AREA_MACRO[a.id]] ?? 0;
            return <Path key={a.id} d={a.d} fill={total > 0 ? SERIES.cartera : PAPEL.filete} fillOpacity={total > 0 ? tonoDeZona(total, mayor) : 1} stroke={PAPEL.blanco} strokeWidth={0.5} />;
          })}
        </Svg>
        <View style={{ marginTop: 4, borderTopWidth: 0.75, borderTopColor: PAPEL.filete, paddingTop: 3 }}>
          {MACROS.map((m) => (
            <View key={m} style={fila}>
              <Muestra opacidad={tonoDeZona(totals[m] ?? 0, mayor)} />
              <Texto style={[celda, { flex: 1 }]}>{ZONE_LABEL[m]}</Texto>
              <Texto style={[celda, { fontWeight: 600, width: 44, textAlign: "right" }]}>{pesoT((totals[m] ?? 0) / 100)}</Texto>
            </View>
          ))}
          {sinZona.map((z) => (
            <View key={z.rotulo} style={fila}>
              <Muestra opacidad={1} color={SERIES.referencia} />
              <Texto style={[celda, { flex: 1 }]}>{z.rotulo}</Texto>
              <Texto style={[celda, { fontWeight: 600, width: 44, textAlign: "right" }]}>{pesoT(z.peso / 100)}</Texto>
            </View>
          ))}
        </View>
        <T style={s.pie}>Porcentajes sobre toda la renta variable de la cartera. El tono de cada zona crece con su peso.{canadaYAfricaSinSeparar ? ` ${NOTA_CANADA_Y_AFRICA}.` : ""}</T>
      </View>
      <View style={{ flex: 1, paddingLeft: 16 }}>
        <View style={[s.tCabecera, { paddingVertical: M.tabla.rellenoVertical }]}>
          <Texto style={[s.tTitulo, { fontSize: M.tabla.cabecera, flex: 1 }]}>Región</Texto>
          <Texto style={[s.tTitulo, { fontSize: M.tabla.cabecera, width: 44, textAlign: "right" }]}>% RV</Texto>
        </View>
        {tableRows.map((r, i) => (
          <View key={i} style={{ flexDirection: "row", paddingVertical: 1.8, borderBottomWidth: r.group ? 0.75 : 0, borderBottomColor: PAPEL.filete, marginTop: r.group && i ? 3 : 0 }}>
            <Texto style={[celda, { flex: 1, fontWeight: r.group ? 600 : 400, paddingLeft: r.group ? 0 : 10, color: r.group ? PAPEL.tinta : PAPEL.tinta2 }]}>{r.label}</Texto>
            <Texto style={[celda, { width: 44, textAlign: "right", fontWeight: r.group ? 600 : 400, color: r.group ? PAPEL.tinta : PAPEL.tinta2 }]}>{pesoT(r.value / 100)}</Texto>
          </View>
        ))}
      </View>
    </View>
  );
}

function underwater(values: number[]): number[] {
  let peak = -Infinity;
  return values.map((v) => { peak = Math.max(peak, v); return v / peak - 1; });
}

const letraDelEje = { fontFamily: FUENTE.sans, fontSize: 6.6, fill: PAPEL.tinta3 };

/* Las tres marcas de la frontera: la cartera en el acero del tema interno; las dos carteras del modelo, con los colores siguientes de la paleta. */
const COLOR_DE_LA_CURVA = SERIES.referencia;
const COLOR_DEL_MAXIMO = SERIES.demas[0];
const COLOR_DEL_MINIMO = SERIES.demas[1];

function FrontierChart({ h, width, height }: { h: InternalHorizonModel; width: number; height: number }) {
  const f = h.horizon.frontier;
  if (!f || f.frontier.length < 2) {
    return <T style={s.pequeno}>Frontera no disponible: {h.horizon.frontierUnavailableReason ?? "sin histórico común suficiente."}</T>;
  }
  const left = 38; const right = width - 10; const top = 10; const bottom = height - 16;
  /* Por debajo del 80 % del peso, la cartera no se sitúa en la frontera (decisión 59). */
  const actual = h.motivoSinCifra ? null : f.current;
  const pts = [...f.frontier, f.minVolatility, f.maxSharpe, ...(actual ? [actual] : [])];
  const [vMin, vMax] = scale(pts.map((p) => p.volatility), [0, 0.2]);
  const [rMin, rMax] = scale(pts.map((p) => p.expectedReturn), [0, 0.1]);
  const x = (v: number) => left + ((v - vMin) / (vMax - vMin)) * (right - left);
  const y = (r: number) => bottom - ((r - rMin) / (rMax - rMin)) * (bottom - top);
  const curve = [...f.frontier].sort((a, b) => a.volatility - b.volatility).map((p, i) => `${i ? "L" : "M"}${x(p.volatility).toFixed(1)} ${y(p.expectedReturn).toFixed(1)}`).join(" ");
  const marks = [
    ...(h.motivoSinCifra ? [] : [{ label: "Cartera actual", p: f.current, color: SERIES.cartera, r: 4.2 }]),
    { label: "Máximo Sharpe", p: f.maxSharpe, color: COLOR_DEL_MAXIMO, r: 3.4 },
    { label: "Mínima volatilidad", p: f.minVolatility, color: COLOR_DEL_MINIMO, r: 3.4 }
  ];
  const ticksV = [vMin, (vMin + vMax) / 2, vMax];
  const ticksR = [rMin, (rMin + rMax) / 2, rMax];
  return (
    <View wrap={false}>
      <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        {ticksR.map((tick) => <Line key={tick} x1={left} y1={y(tick)} x2={right} y2={y(tick)} stroke={PAPEL.filete} strokeWidth={0.5} />)}
        <Path d={curve} fill="none" stroke={COLOR_DE_LA_CURVA} strokeWidth={1.4} />
        {marks.map((mk) => mk.p ? <Circle key={mk.label} cx={x(mk.p.volatility)} cy={y(mk.p.expectedReturn)} r={mk.r} fill={mk.color} stroke={PAPEL.blanco} strokeWidth={0.6} /> : null)}
        {ticksR.map((tick) => <TextoSvg key={`r${tick}`} x={left - 4} y={y(tick) + 2} textAnchor="end" style={letraDelEje}>{pct(tick, 1)}</TextoSvg>)}
        {ticksV.map((tick) => <TextoSvg key={`v${tick}`} x={x(tick)} y={height - 5} textAnchor="middle" style={letraDelEje}>{pct(tick, 1)}</TextoSvg>)}
      </Svg>
      <View style={{ flexDirection: "row", columnGap: 12, flexWrap: "wrap" }}>
        {marks.map((mk) => (
          <View key={mk.label} style={{ flexDirection: "row", alignItems: "center" }}>
            <Svg width={7} height={7} style={{ marginRight: 4 }}><Circle cx={3.5} cy={3.5} r={3} fill={mk.color} /></Svg>
            {/* Decisión 6.3 (17-10-2026): la frontera da el Sharpe del modelo, no el ex post del informe. */}
            <T style={s.pequeno}>{mk.label}{mk.p ? ` · rentabilidad ${pctSigned(mk.p.expectedReturn)} · volatilidad ${pct(mk.p.volatility)} · Sharpe del modelo ${ratio(mk.p.sharpeRatio) ?? FALTA}` : ` · ${FALTA}`}</T>
          </View>
        ))}
      </View>
    </View>
  );
}

/**
 * Cono estadístico (decisión 3). La fórmula es una lognormal cerrada, sin sorteos (`buildMonteCarloProjection`, que conserva su nombre
 * porque también la llama la gráfica de la pantalla): por eso no se llama simulación, y su percentil 5 no se llama «adverso». Centrado en el
 * tipo sin riesgo de la misma ventana (Óscar, 11-11-2026): solo enseña la dispersión. Sin ese tipo no se pinta: nunca vuelve a la deriva histórica.
 */
function conoDe(h: InternalHorizonModel) {
  const input = measurementSeries(h.horizon.backtest.portfolio_series, h.horizon.backtest.frequency);
  const historica = buildMonteCarloProjection(input.series, input.frequency, h.horizon.years);
  return historica ? { historica, centrada: centrarEnElTipoSinRiesgo(historica, h.horizon.backtest.metrics.rf_rate) } : null;
}

/**
 * El capital sobre el que se dibuja el cono en euros (INF-19, segunda parte; la misma regla que `varEnEurosDelInterno`). La serie mide la parte
 * medida de la cartera, con sus pesos llevados al 100 %: su dispersión se aplica al capital medido, capital × cobertura, y se dice. Con todo
 * medido (el mismo corte de 99,95 %), es el capital declarado. Sin capital, o sin cobertura conocida, no hay cono en euros: va en base 100.
 *
 * Cuenta a mano: 250.000 € con el 85 % medido son 250.000 × 0,85 = 212.500 €; centrado en un 2,75 % a 3 años, su percentil 50 es
 * 212.500 × 1,0275³ = 212.500 × 1,084789546875 = 230.517,78 €, que se escribe «230.518 €». Antes salía 250.000 × 1,084789546875 = 271.197 €.
 */
export function capitalDelCono(capital: number | null | undefined, coberturaPct: number | null | undefined): { base: number; sobreTodo: boolean } | null {
  if (!num(capital) || capital <= 0) return null;
  if (!num(coberturaPct) || coberturaPct <= 0) return null;
  const cobertura = Math.min(coberturaPct, 100);
  return { base: capital * (cobertura / 100), sobreTodo: cobertura >= 99.95 };
}

/** Bajo los conos, en qué tipo se centra cada uno: el que dibuja. El estático lo dice, como en la tabla de 6.2. */
function centroDeLosConos(ventanas: InternalHorizonModel[]): string {
  const tipos = ventanas.filter((h) => conoDe(h)?.centrada).map((h) => `${pct(h.horizon.backtest.metrics.rf_rate)}${tipoDeRespaldo(h.horizon.backtest) !== null ? ", estático," : ""} a ${h.horizon.years} años`);
  if (!tipos.length) return "";
  return `Centrado en el tipo sin riesgo de ${tipos.length > 1 ? "cada ventana" : "la ventana"} (${tipos.join(" y ")}): el percentil 50 es el capital creciendo a ese tipo. Solo enseña la dispersión medida en el periodo; no es una simulación ni una previsión.`;
}

/** Sobre qué capital va cada cono, al pie: base 100, el capital medido o, sin cobertura conocida, ninguna cifra en euros. */
function capitalDeLosConos(ventanas: InternalHorizonModel[], capital: number | null): string {
  if (!capital) return " Variación sobre base 100.";
  const conCono = ventanas.filter((h) => conoDe(h)?.centrada);
  if (conCono.some((h) => !capitalDelCono(capital, h.horizon.coverageWeightPercent))) {
    return " Sin cifra en euros donde no consta qué parte del capital mide la serie: variación sobre base 100.";
  }
  const parciales = conCono.filter((h) => !capitalDelCono(capital, h.horizon.coverageWeightPercent)?.sobreTodo);
  if (!parciales.length) return "";
  const pesos = parciales.map((h) => pesoLegible(h.horizon.coverageWeightPercent)).filter((p, i, todos) => todos.indexOf(p) === i).join(" y el ");
  return ` En euros, sobre el capital medido: el ${pesos} del capital declarado, la parte que mide la serie.`;
}

function ConoEstadistico({ h, capital, width }: { h: InternalHorizonModel; capital: number | null; width: number }) {
  const cono = conoDe(h);
  if (!cono) return <T style={s.pequeno}>Cono estadístico a {h.horizon.years} años no disponible con el histórico del periodo.</T>;
  const projection = cono.centrada;
  if (!projection) return <T style={s.pequeno}>Cono estadístico a {h.horizon.years} años no disponible: falta el tipo sin riesgo de esa ventana.</T>;
  const enEuros = capitalDelCono(capital, h.horizon.coverageWeightPercent);
  const base = enEuros?.base ?? 100;
  const toV = (v: number) => (base * v) / projection.lastValue;
  const pts = projection.points;
  const height = 172;
  const left = 50; const right = width - 92; const top = 8; const bottom = height - 20;
  const [min, max] = scale(pts.flatMap((p) => [toV(p.p5), toV(p.p95)]), [base * 0.6, base * 1.4], 0.05);
  const x = (i: number) => left + (i / Math.max(1, pts.length - 1)) * (right - left);
  const y = (v: number) => bottom - ((v - min) / (max - min)) * (bottom - top);
  const band = `${pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(toV(p.p95)).toFixed(1)}`).join(" ")} ${[...pts].reverse().map((p, k) => `L${x(pts.length - 1 - k).toFixed(1)} ${y(toV(p.p5)).toFixed(1)}`).join(" ")} Z`;
  const line = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(toV(p.p50)).toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  const fmtV = (v: number) => (enEuros ? eur(v) : pctSigned(v / base - 1));
  const percentiles = [["p95", "Percentil 95"], ["p50", "Percentil 50"], ["p5", "Percentil 5"]] as const;
  const deQue = enEuros ? (enEuros.sobreTodo ? "del capital declarado " : "del capital medido ") : "";
  return (
    <View wrap={false} style={{ marginBottom: 6 }}>
      <T style={[s.cuerpo, { textAlign: "center", marginTop: 4, marginBottom: 2 }]}>Cono estadístico {deQue}a {h.horizon.years} años</T>
      <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ alignSelf: "center" }}>
        {[max, (max + min) / 2, min].map((g) => <Line key={g} x1={left} y1={y(g)} x2={right} y2={y(g)} stroke={PAPEL.filete} strokeWidth={0.5} />)}
        <Path d={band} fill={SERIES.cartera} fillOpacity={0.14} stroke="none" />
        <Path d={line} fill="none" stroke={SERIES.cartera} strokeWidth={1.5} />
        {percentiles.map(([k]) => (
          <TextoSvg key={k} x={right + 6} y={y(toV(last[k])) + 2} style={{ ...letraDelEje, fill: PAPEL.tinta }}>{`${k.toUpperCase()} ${fmtV(toV(last[k]))}`}</TextoSvg>
        ))}
        {[max, min].map((g) => <TextoSvg key={`l${g}`} x={left - 4} y={y(g) + 2} textAnchor="end" style={letraDelEje}>{enEuros ? eur(g) : t(numero(g))}</TextoSvg>)}
        {Array.from({ length: projection.horizonYears + 1 }, (_, i) => (
          <TextoSvg key={`y${i}`} x={x(Math.round(((pts.length - 1) * i) / projection.horizonYears))} y={height - 6} textAnchor="middle" style={letraDelEje}>{i ? `+${i} a` : "Hoy"}</TextoSvg>
        ))}
      </Svg>
      <View style={{ flexDirection: "row", columnGap: 14, marginTop: 2, justifyContent: "center" }}>
        {percentiles.map(([k, rotulo]) => <T key={k} style={s.pequeno}>{rotulo}: {fmtV(toV(last[k]))}</T>)}
      </View>
    </View>
  );
}

// ---------------------------------------------------------- frases de lectura
function hz(m: InternalReportModel, w: "3Y" | "5Y") { return m.horizons.find((h) => h.window === w); }
function metricOf(h: InternalHorizonModel | undefined, key: "cagr" | "volatility" | "sharpe" | "max_drawdown") { return h ? h.horizon.backtest.metrics[key] : null; }

/**
 * Qué es la referencia y hasta dónde se compara: va donde se comparan las dos cosas. Una línea, y sin rodeos si no está. `alFinal` es cómo
 * acaba sin reequilibrar (decisión 86), y va detrás de su composición.
 */
function benchmarkNote(h: InternalHorizonModel | undefined, m: InternalReportModel, alFinal: string | null = null): string {
  const perfil = benchmarkById(m.benchmarkId);
  if (!m.benchmarkAvailable || !perfil) return "Cartera de referencia no disponible: no se compara con ella.";
  if (!h?.comparison) return "La cartera y la referencia no tienen fechas suficientes en común: no se comparan.";
  return `Cartera de referencia ${perfil.name}: ${composicionConFondos(perfil)}.${alFinal ? ` ${alFinal}.` : ""} Cartera y referencia en las mismas fechas, ${t(periodo(h.comparison.first, h.comparison.last))}, última fecha común. La cartera parte de los pesos de hoy y ${tampocoSeReequilibra(perfil)}.`;
}

/** La nota de la referencia, con las fechas de las dos ventanas y lo que pesa la renta variable al final de cada una. */
function notaDelBenchmark(m: InternalReportModel): string {
  const ventanas = conCifra(m);
  if (!ventanas.length) return "Sin cifras de la cartera no se compara con la referencia.";
  const h3 = ventanas.find((h) => h.window === "3Y");
  const h5 = ventanas.find((h) => h.window === "5Y");
  const perfil = benchmarkById(m.benchmarkId);
  const alFinal = perfil
    ? pesoDeLaReferenciaPorVentanas(perfil, [h3, h5].filter((h): h is InternalHorizonModel => Boolean(h?.comparison))
      .map((h) => ({ anos: h.horizon.years, rentaVariable: h.comparison?.rentaVariableAlFinal })))
    : null;
  return `${benchmarkNote(h3 ?? h5, m, alFinal)}${h3?.comparison && h5?.comparison ? ` A 5 años, ${t(periodo(h5.comparison.first, h5.comparison.last))}.` : ""}`;
}

/** Una frase con lo de cada ventana: «… a 3 años …; a 5 años …». */
function porVentanas(ventanas: InternalHorizonModel[], inicio: string, trozo: (h: InternalHorizonModel) => string | null, fin = "."): string | null {
  const trozos = ventanas.map((h) => {
    const texto = trozo(h);
    return texto ? `a ${h.horizon.years} años ${texto}` : null;
  }).filter(Boolean);
  return trozos.length ? `${inicio} ${trozos.join("; ")}${fin}` : null;
}

function performanceReading(ventanas: InternalHorizonModel[], benchmarkLabel: string): Array<string | null> {
  const vsBench = porVentanas(ventanas, `Frente a la referencia (${benchmarkLabel}) la cartera rinde:`, (h) => {
    const r = h.relative;
    return r && num(r.portfolioReturn) && num(r.benchmarkReturn)
      ? `${pctSigned(r.portfolioReturn)} anual contra ${pctSigned(r.benchmarkReturn)}, ${noAplicaAUnaAccion(h, "rentabilidadActiva") ? "" : `${ppT(r.activeReturn)} al año ${r.activeReturn >= 0 ? "a favor" : "en contra"}, `}con una beta de ${ratio(r.beta)}`
      : null;
  });
  const vsEqual = porVentanas(ventanas, ventanas.some((h) => h.horizon.frontierNotSelectable?.length) ? "Frente a repartir a partes iguales los activos que se pueden comprar, los pesos elegidos:" : "Frente a repartir los mismos activos a partes iguales, los pesos elegidos:", (h) => {
    const mt = h.horizon.backtest.metrics;
    const eq = h.horizon.equalWeight?.metrics;
    return eq && num(mt.cagr) && num(eq.cagr) ? `${mt.cagr >= eq.cagr ? "aportan" : "restan"} ${ppT(mt.cagr - eq.cagr)} anuales (${pctSigned(eq.cagr)})` : null;
  });
  const yearsLine = porVentanas(ventanas, "Mejor y peor año natural completo:", (h) => {
    const years = h.calendarYears.filter((y) => !y.partial);
    const best = years.length ? years.reduce((a, b) => (b.portfolio > a.portfolio ? b : a)) : null;
    const worst = years.length ? years.reduce((a, b) => (b.portfolio < a.portfolio ? b : a)) : null;
    return best && worst && best !== worst ? `${best.year} (${pctSigned(best.portfolio)}) y ${worst.year} (${pctSigned(worst.portfolio)}), con un ${pct(h.extremes.positiveWeeksShare, 0)} de semanas positivas` : null;
  });
  const ddLine = porVentanas(ventanas, "La caída más profunda:", (h) => {
    const ep = h.episodes[0];
    return ep ? `del ${pct(ep.depth)} (${t(periodo(ep.peakDate, ep.troughDate))}), ${ep.recoveryDate ? `recuperada en ${ep.recoveryDays} días` : "todavía sin recuperar"}` : null;
  });
  return [vsBench, vsEqual, yearsLine, ddLine];
}

/**
 * El VaR en euros, entre paréntesis, o nada sin capital. INF-19: la serie mide la parte medida de la cartera (sus pesos llevados al
 * 100 %), así que la pérdida se aplica al capital medido, capital × cobertura, y se dice sobre qué parte; con todo medido (el mismo corte
 * que la nota del cono), sobre el capital actual. Sin cobertura conocida no se da la cifra en euros.
 */
export function varEnEurosDelInterno(valueAtRisk: number, capital: number | null | undefined, coberturaPct: number | null | undefined): string {
  if (!capital) return "";
  if (typeof coberturaPct !== "number" || !Number.isFinite(coberturaPct) || coberturaPct <= 0) {
    return " (sin cifra en euros: no consta qué parte del capital mide la serie)";
  }
  const cobertura = Math.min(coberturaPct, 100);
  const enEuros = eur(Math.abs(valueAtRisk) * capital * (cobertura / 100));
  return cobertura >= 99.95 ? ` (unos ${enEuros} sobre el capital actual)` : ` (unos ${enEuros} sobre el ${pesoLegible(cobertura)} medido del capital)`;
}

function riskReading(ventanas: InternalHorizonModel[], m: InternalReportModel): Array<string | null> {
  const volLine = porVentanas(ventanas, "Volatilidad anualizada y caída máxima:", (h) => {
    const bt = h.horizon.backtest.metrics;
    return num(bt.volatility) ? `${pct(bt.volatility)} y ${pct(bt.max_drawdown)}` : null;
  });
  const varLine = porVentanas(ventanas, "En el 5 % de las peores semanas del periodo la cartera perdió:", (h) => {
    const var95 = h.tailRisk.find((x) => x.level === 0.95);
    return var95 && num(var95.valueAtRisk)
      ? `al menos un ${pct(Math.abs(var95.valueAtRisk))}${varEnEurosDelInterno(var95.valueAtRisk, m.totalCapital, h.horizon.coverageWeightPercent)}, con una pérdida media del ${pct(num(var95.conditionalValueAtRisk) ? Math.abs(var95.conditionalValueAtRisk) : null)} en esas semanas`
      : null;
  });
  const benchLine = porVentanas(ventanas, "Frente a la referencia:", (h) => {
    const r = h.relative;
    return r ? `correlación de ${ratio(r.correlation)}, ${noAplicaAUnaAccion(h, "trackingError") ? "" : `tracking error del ${pct(r.trackingError)} y `}capturas alcista y bajista del ${pct(r.upCapture, 0)} y el ${pct(r.downCapture, 0)}` : null;
  });
  /* El estrés no depende de la ventana: una sola frase. Ordena solo lo que se mide igual, las crisis desde su primer día: la historia
     común mide desde máximos (decisión 115), que es otro estimador, y dos cifras de estimador distinto no se ordenan. */
  const stress = ventanas[0]?.horizon.backtest.stress_scenarios.filter((x) => x.representative && num(x.drawdown_pct) && !x.peak_date) ?? [];
  const worst = stress.length ? stress.reduce((a, b) => ((b.drawdown_pct ?? 0) < (a.drawdown_pct ?? 0) ? b : a)) : null;
  const stressLine = worst ? `El escenario histórico más duro para esta composición es ${worst.label}: ${pct((worst.drawdown_pct ?? 0) / 100)}.` : null;
  return [volLine, varLine, benchLine, stressLine];
}

// ------------------------------------------------------------------ páginas
const tocDe = (m: InternalReportModel): Array<{ n: string; title: string; text: string }> => [
  { n: "1", title: "Resumen ejecutivo", text: "Cifras a 3 y 5 años y prioridades de revisión." },
  { n: "2", title: "Posiciones", text: m.totalCapital ? "Pesos, importes y métricas de cada activo." : "Pesos y métricas de cada activo." },
  { n: "3", title: "Composición", text: "Clases, divisas y exposición geográfica." },
  { n: "4", title: "Subyacentes y solapamiento", text: "Empresas y emisores compartidos entre fondos." },
  { n: "5", title: "Rentabilidad", text: "Evolución histórica, comparación y caídas." },
  /* El cono sale de la serie de la cartera: sin cifras no está, y el índice no lo promete (decisión 80). */
  { n: "6", title: "Riesgo", text: conCifra(m).some((h) => conoDe(h)?.centrada) ? "Medidas con su umbral, estrés y cono estadístico." : m.horizons.length ? "Medidas con su umbral y estrés." : "Medidas con su umbral." },
  { n: "7", title: "Correlaciones", text: "Relaciones entre posiciones y diversificación." },
  { n: "8", title: "Optimización y mejora", text: "Frontera eficiente y alternativas de fondos." },
  { n: "9", title: "Costes y comercial", text: m.totalCapital ? "Coste corriente, retrocesiones e ingreso estimado por posición." : "Coste corriente y retrocesiones por posición." },
  { n: "10", title: "Calidad y trazabilidad", text: "Fuentes, cobertura y datos que revisar." },
  { n: "11", title: "Metodología y glosario", text: "Cómo se calcula cada cifra y qué significa cada término." }
];

/** Lo que no llega al 80 % no se redondea hacia arriba: un 79,96 % no sale «80 %» al lado de «Falta el dato». */
const pesoDeLaVentana = (h: InternalHorizonModel) => (h.motivoSinCifra ? pesoLegible(h.horizon.coverageWeightPercent) : pct(h.horizon.coverageWeightPercent / 100, 0));

/** Las cifras que abren el documento: las de 3 años. Sin ellas, por lo que mide o porque no hay simulación, las cuatro faltan, y la lectura dice por qué. */
function cifrasQueResponden(m: InternalReportModel): CifraDestacada[] {
  const h3 = hz(m, "3Y");
  const falta3 = !h3 || Boolean(h3.motivoSinCifra);
  if (falta3) return ["Rentabilidad anualizada · 3 años", "Volatilidad · 3 años", "Sharpe · 3 años", "Caída máxima · 3 años"].map((rotulo) => ({ rotulo, cifra: null }));
  const cagr = metricOf(h3, "cagr");
  return [
    { rotulo: "Rentabilidad anualizada · 3 años", cifra: rentabilidad(cagr), signo: signoDe(cagr, 4), principal: true,
      apunte: h3.relative ? (h3.comparison?.cut ? `Hasta el ${fechaT(h3.comparison.last)}: ${pctSigned(h3.relative.portfolioReturn)}; referencia ${pctSigned(h3.relative.benchmarkReturn)}` : `Referencia ${pctSigned(h3.relative.benchmarkReturn)}`) : undefined },
    { rotulo: "Volatilidad · 3 años", cifra: porcentaje(metricOf(h3, "volatility")), apunte: "Anualizada, medida en semanal" },
    { rotulo: "Sharpe · 3 años", cifra: sharpeDeCartera(h3), apunte: h3.sharpeNoAplica ? motivoDeQueNoAplique("sharpe", "STOCK") : `Tipo sin riesgo ${pct(h3.horizon.backtest.metrics.rf_rate)}` },
    { rotulo: "Caída máxima · 3 años", cifra: porcentaje(metricOf(h3, "max_drawdown")), apunte: "Desde el último máximo, serie diaria" }
  ];
}

/** La primera hoja: lo que decía la portada (qué cartera, de cuándo, con cuánto capital y frente a qué), las cifras que responden y el índice. */
function CoverSheet({ m }: { m: InternalReportModel }) {
  const paginas = useContext(PaginasDeLasSecciones);
  const toc = m.includeAssetSheets ? [...tocDe(m), { n: "A", title: "Anexo · fichas", text: "Ficha completa de cada posición tal y como está en la base de activos." }] : tocDe(m);
  const half = Math.ceil(toc.length / 2);
  const column = (items: typeof toc) => (
    <View style={s.columna}>
      {items.map((item) => (
        <Link key={item.n} src={`#seccion-${item.n}`} style={s.indiceFila}>
          <Texto style={s.indiceNumero}>{item.n}</Texto>
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              <Texto style={s.indiceTitulo}>{item.title}</Texto>
              {/*
                * Un `View` que devuelve su `Text`, y no un `Text` con `render`: medido con @react-pdf 4.5, un `Text` con `render` que va en el flujo de
                * la hoja y lleva interlínea no llega a escribirse, porque cada vez que recoloca la hoja la vuelve a calcular sobre la ya calculada. Este
                * nace nuevo en la última vuelta.
                */}
              <View style={{ width: 48 }} render={() => (paginas.has(item.n) ? <Texto style={s.indicePagina}>{`Página ${paginas.get(item.n)}`}</Texto> : null)} />
            </View>
            <Texto style={s.indiceTexto}>{item.text}</Texto>
          </View>
        </Link>
      ))}
    </View>
  );
  const windows = m.horizons.map((h) => windowLabel(h.window)).join(" y ");
  return (
    <Hoja>
      <MarcaDeLaHoja ancla="presentacion" titulo="Presentación y contenido" />
      <Presentacion
        contexto={["Documento de trabajo · uso interno del asesor", m.portfolioName]}
        titulo={m.title}
        datos={[
          { rotulo: "Fecha de generación", valor: fechaLarga(diaLocal(m.generatedAt) ?? m.generatedAt) },
          { rotulo: "Capital declarado", valor: m.totalCapital ? importeTitular(m.totalCapital) : "No declarado" },
          { rotulo: "Posiciones", valor: String(m.positions.length) },
          { rotulo: "Cartera de referencia", valor: m.benchmarkLabel }
        ]}
      />
      <CifrasDestacadas cifras={cifrasQueResponden(m)} />
      <H2>Contenido</H2>
      <View style={s.dosColumnas}>
        {column(toc.slice(0, half))}
        {column(toc.slice(half))}
      </View>
      <Reading title="Cómo leer este documento" lines={[
        `Análisis${windows ? ` a ${windows}` : ""} con los pesos actuales. Cada «Lectura rápida» resume las cifras de su sección; la metodología se detalla al final.`,
        `«${FALTA}» indica un dato ausente, nunca cero. Cobertura y causas en la sección 10.`,
        /* Dicho una vez: sin capital no hay columnas en euros. */
        m.totalCapital ? null : "Sin capital declarado, ninguna cifra va en euros.",
        "Uso exclusivo del asesor. Incluye información comercial y no se entrega al cliente."
      ]} />
    </Hoja>
  );
}

const COLA_DE_LOS_PUNTOS = 4;

function puntoARevisar(p: InternalReportModel["reviewPoints"][number], i: number) {
  return (
    <View key={i} style={s.revisarFila} wrap={false}>
      <Texto style={[s.revisarGrado, { color: SEVERITY_COLOR[p.severity] }]}>{SEVERITY_LABEL[p.severity]}</Texto>
      <Texto style={s.revisarArea}>{p.area}</Texto>
      <Texto style={s.revisarTexto}>{p.text}</Texto>
    </View>
  );
}

function SummarySheet({ m }: { m: InternalReportModel }) {
  const h3 = hz(m, "3Y");
  const h5 = hz(m, "5Y");
  type Row = { label: string; get: (h: InternalHorizonModel) => CeldaDeTabla };
  const celdaDe = (h: InternalHorizonModel | undefined, get: Row["get"]): CeldaDeTabla => (h && !h.motivoSinCifra ? get(h) : null);
  /* Qué es cada medida lo dice el glosario, una sola vez. */
  const rows: Row[] = [
    { label: "Rentabilidad anualizada", get: (h) => celdaRent(metricOf(h, "cagr")) },
    { label: "Rentabilidad activa", get: (h) => (noAplicaAUnaAccion(h, "rentabilidadActiva") ? NO_APLICA : celdaPp(h.relative?.activeReturn)) },
    { label: "Volatilidad", get: (h) => porcentaje(metricOf(h, "volatility")) },
    { label: "Caída máxima", get: (h) => porcentaje(metricOf(h, "max_drawdown")) },
    { label: "Sharpe", get: sharpeDeCartera },
    { label: "Sortino", get: sortinoDeCartera },
    { label: "Calmar", get: (h) => cifraDeCartera(h, "calmar", ratioC(h.calmar)) },
    { label: "Beta frente a la referencia", get: (h) => ratioC(h.relative?.beta) },
    { label: "Tracking error", get: (h) => cifraDeCartera(h, "trackingError", porcentaje(h.relative?.trackingError)) }
  ];
  const business: KpiItem[] = [
    { label: "Coste corriente medio", value: costeMedioDe(m), note: soloAcciones(m) ? "Una acción no tiene coste corriente" : costeParcial(m) ? `Parcial: sobre el ${pct(m.costs.terCoverage, 0)} del peso con dato` : `Cobertura ${pct(m.costs.terCoverage, 0)} del peso` },
    ...(m.totalCapital ? [{ label: "Coste anual estimado", value: soloAcciones(m) ? NO_APLICA : eur(m.costs.annualCostEur), note: costeParcial(m) ? `Parcial: solo el ${pct(m.costs.terCoverage, 0)} del peso con dato` : "Coste corriente × importe" }] : []),
    { label: "Retrocesión media", value: retroMediaDe(m),
      note: soloAcciones(m) ? "Una acción no tiene retrocesión" : m.retro.parcial ? `Parcial: sobre el ${pesoConRetro(m)}; un ${pct(m.retro.sobreLaCartera)} de toda la cartera` : m.retro.status === "ok" ? `Cobertura ${pct(m.retro.coverage, 0)} del peso${m.costs.stocks > 0 ? " de fondos y ETF" : ""}` : m.retro.status === "denied" ? "Sin acceso a la base" : "No disponible" },
    ...(m.totalCapital ? [{ label: "Ingreso anual estimado", value: soloAcciones(m) ? NO_APLICA : eur(m.retro.annualIncomeEur), note: m.retro.parcial ? `Parcial: sobre el ${pesoConRetro(m)}; un ${pct(m.retro.sobreLaCartera)} de toda la cartera` : "Retrocesión × importe" }] : []),
    { label: "Posiciones", value: String(m.positions.length), note: m.concentration ? `Nº efectivo ${ratio(m.concentration.effectivePositions, 1)}` : undefined },
    { label: "Mayor posición", value: pesoT(m.concentration?.top1), note: masDeCinco(m) ? `5 mayores: ${pesoT(m.concentration?.top5)}` : undefined },
    /* Hechos sin adjetivo (decisión 18): cuántas alertas, y sobre qué parte de la cartera. Lo que pide atención, en ocre. */
    { label: "Alertas", value: m.salud.estado === "a-revisar" ? "A revisar" : String(cuantasAlertas(m.salud)), note: cualesSonLasAlertas(m.salud) ? `${cualesSonLasAlertas(m.salud)}. ${m.salud.titular}` : m.salud.titular,
      aviso: m.salud.alertas.some((a) => a.palabra === "Crítico") || m.salud.estado === "a-revisar" || cuantasAlertas(m.salud) > 0 },
    { label: "Cobertura del análisis", value: h3 ? pesoDeLaVentana(h3) : null, note: h5 ? `A 5 años: ${pesoDeLaVentana(h5)}` : `A 5 años: ${FALTA}` }
  ];
  const reading = [
    ...lineasSinCifra(m),
    h3?.motivoSinCifra ? null : h3?.relative ? `A 3 años la cartera rinde ${pctSigned(metricOf(h3, "cagr"))} anual${h3.comparison?.cut ? `; hasta el ${fechaT(h3.comparison.last)}, la última fecha común con la referencia, ${pctSigned(h3.relative.portfolioReturn)} frente a ${pctSigned(h3.relative.benchmarkReturn)}` : ` frente a ${pctSigned(h3.relative.benchmarkReturn)} de la referencia`}, con una volatilidad del ${pct(metricOf(h3, "volatility"))} y una caída máxima del ${pct(metricOf(h3, "max_drawdown"))}.` : h3 ? `A 3 años la cartera rinde ${pctSigned(metricOf(h3, "cagr"))} anual con una volatilidad del ${pct(metricOf(h3, "volatility"))}.` : "El análisis a 3 años no está disponible; la causa se detalla en la sección 10.",
    m.concentration ? `${m.positions.length} ${m.positions.length === 1 ? "posición que equivale" : "posiciones que equivalen"} a ${ratio(m.concentration.effectivePositions, 1)} efectivas: la mayor pesa el ${pesoT(m.concentration.top1)}${masDeCinco(m) ? ` y las cinco mayores, el ${pesoT(m.concentration.top5)}` : ""}.` : null,
    num(m.costs.annualCostEur) && !soloAcciones(m) ? `${m.costs.missing > 0 ? `Coste corriente conocido del ${pct(m.costs.weightedTer)} sobre el ${pct(m.costs.terCoverage, 0)} del peso con dato (${eur(m.costs.annualCostEur)} al año identificados; el resto falta)` : `El cliente soporta un coste corriente del ${pct(m.costs.weightedTer)} (${eur(m.costs.annualCostEur)} al año)`}${num(m.retro.annualIncomeEur) ? ` y la cartera genera ${eur(m.retro.annualIncomeEur)} de retrocesión anual estimada${m.retro.parcial ? ` (parcial: ${retroMediaDe(m)} medio sobre el ${pesoConRetro(m)}; un ${pct(m.retro.sobreLaCartera)} de toda la cartera)` : ""}` : ""}.${notaDeAcciones(m)}` : null,
    m.reviewPoints.length ? `${m.reviewPoints.length} ${m.reviewPoints.length === 1 ? "punto" : "puntos"} a revisar, ${m.reviewPoints.filter((p) => p.severity === "alta").length} de severidad alta. ${m.reviewPoints.length === 1 ? "Conviene resolverlo" : "Los primeros de la lista son los que conviene resolver"} antes de enseñar nada al cliente.` : "Sin puntos a revisar: la cartera y sus datos pasan todas las comprobaciones."
  ];
  return (
    <Sheet m={m} section="1 · Resumen ejecutivo">
      <SectionHead number="1" title="Resumen ejecutivo" lead="Cifras a 3 y 5 años, estructura económica y puntos que conviene revisar antes de la reunión con el cliente. Las cifras a 3 años abren el documento." />
      <LoQueMide m={m} />
      <Reading lines={reading} />
      <T style={s.pie}>{notaDelBenchmark(m)}{m.avisoDeRiesgoDistinto ? ` ${m.avisoDeRiesgoDistinto}` : ""}</T>
      <H2>Cifras clave a 3 y 5 años</H2>
      <TablaDe
        columnas={[
          { titulo: "Medida", ancho: 271, celda: (r: Row) => r.label },
          { titulo: "3 años", ancho: 120, cifra: true, celda: (r: Row) => celdaDe(h3, r.get) },
          { titulo: "5 años", ancho: 120, cifra: true, celda: (r: Row) => celdaDe(h5, r.get) }
        ]}
        filas={rows} />
      {/* Sin salto forzado: con él, las últimas filas de la tabla se quedaban solas en una hoja cuando la línea de arriba crecía. */}
      <View>
        <H2>Negocio y estructura</H2>
        <KpiGrid items={business} columns={4} />
      </View>
      <H2>Puntos a revisar</H2>
      {m.reviewPoints.length ? (
        <View>
          {m.reviewPoints.slice(0, -COLA_DE_LOS_PUNTOS).map(puntoARevisar)}
          {/* Los últimos, con la leyenda: si no caben saltan juntos, y la leyenda no se queda sola en una hoja. */}
          <View wrap={false}>
            {m.reviewPoints.slice(-COLA_DE_LOS_PUNTOS).map(puntoARevisar)}
            <Texto style={s.pie}>Alta: resolver antes de usar el informe con el cliente. Media: comprobar. Info: contexto que conviene conocer.</Texto>
          </View>
        </View>
      ) : <Texto style={s.cuerpo}>Sin avisos: la cartera y sus datos pasan todas las comprobaciones.</Texto>}
    </Sheet>
  );
}

function PositionsSheet({ m }: { m: InternalReportModel }) {
  /* Sin capital no hay columnas en euros; lo dice una vez la primera hoja. */
  const conCapital = m.totalCapital !== null;
  const cols: Columna<InternalPositionRow>[] = [
    { titulo: "#", ancho: 14, celda: (r) => String(numeroDe(m, r.assetId)) },
    { titulo: "Activo", ancho: conCapital ? 234 : 292, celda: (r) => ({ texto: r.name, apunte: `${r.assetId}${r.category ? ` · ${r.category}` : ""}${r.serieParadaDesde ? ` · ${rotuloDeSerieParada(r.serieParadaDesde, r.assetId)}` : ""}` }) },
    { titulo: "Clase · tipo", ancho: 58, celda: (r) => (r.fueraDelCatalogo ? FUERA_DEL_CATALOGO : { texto: classLabel(r.assetClass), apunte: typeLabel(r.instrumentType) }) },
    { titulo: "Divisa", ancho: 28, celda: (r) => r.currency || null },
    { titulo: "Peso", ancho: 36, cifra: true, celda: (r) => peso(r.weight) },
    ...(conCapital ? [{ titulo: "Importe", ancho: 58, cifra: true, celda: (r: InternalPositionRow) => importe(r.amount) }] : []),
    { titulo: "Riesgo", ancho: 44, cifra: true, celda: riesgoEnLaTabla },
    { titulo: "Coste corriente", ancho: 44, cifra: true, celda: terDe },
    { titulo: "Rent. 1 año", ancho: 40, cifra: true, celda: (r) => celdaRent(r.return1y) },
    { titulo: "Rent. 3 años", ancho: 40, cifra: true, celda: (r) => celdaRent(r.return3y) },
    { titulo: "Rent. 5 años", ancho: 40, cifra: true, celda: (r) => celdaRent(r.return5y) },
    { titulo: "Vol. 3 años", ancho: 40, cifra: true, celda: (r) => porcentaje(r.volatility3y) },
    { titulo: "Sharpe 3 años", ancho: 40, cifra: true, celda: (r) => sharpeDePosicion(r.instrumentType, r.sharpe3y) },
    { titulo: "Caída 5 años", ancho: 42, cifra: true, celda: (r) => porcentaje(r.maxDrawdown5y) }
  ];
  const conTer = m.positions.length - m.costs.missing - m.costs.stocks;
  return (
    <Sheet m={m} section="2 · Posiciones" orientation="landscape">
      <SectionHead number="2" title="Posiciones" lead={`Métricas propias de cada posición (de su ficha) y coste corriente. Peso normalizado sobre las posiciones con peso;${conCapital ? " importe sobre el capital declarado;" : ""} rentabilidades a 3 y 5 años anualizadas. Retrocesiones y método de cálculo, en las secciones 9 y 10.`} />
      <T style={[s.pequeno, { marginTop: 6, marginBottom: 4 }]}>{soloAcciones(m) ? "Una acción no tiene coste corriente." : `${conTer} de ${m.positions.length - m.costs.stocks} ${m.costs.stocks > 0 ? "fondos y ETF" : "posiciones"} con coste corriente en la ficha. Coste corriente total: media ponderada sobre el peso con dato (cobertura ${pct(m.costs.terCoverage, 0)}).${notaDeAcciones(m)}`}{m.cifrasEnOtraDivisa ? ` ${m.cifrasEnOtraDivisa}` : ""}{m.sharpeDeMetodosDistintos ? " Sharpe 3 años. Métodos distintos: no ordenar entre sí." : ""}</T>
      <TablaConCola columnas={cols} filas={m.positions} clave={(r) => r.assetId} densa cola={colaDeLaTabla(m.positions.length)}
        total={["", "Total", "", "", peso(1), ...(conCapital ? [importe(m.totalCapital)] : []), "", costeMedioDe(m), "", "", "", "", "", ""]} />
    </Sheet>
  );
}

function CompositionSheet({ m }: { m: InternalReportModel }) {
  const a = m.allocation;
  const qualityText: Record<string, string> = { lookthrough: "lo que publica cada activo", none: "sin datos" };
  /* Lo que no entra no es la clase que más pesa, por mucho que pese. */
  const clases = a.byClass.filter((b) => b.key !== CLAVE_DE_LO_QUE_NO_ENTRA);
  const topClass = clases[0];
  /* La divisa mayor que se conoce: «denominado en Falta el dato» no es una frase. */
  const topCur = a.byCurrency.find((b) => b.key !== CLAVE_DE_LO_QUE_NO_ENTRA && b.key !== CLAVE_SIN_DATO_DEL_REPARTO);
  const mix = Object.fromEntries(a.underlyingMix.map((b) => [b.key, b.weight]));
  /* Un entero, salvo un negativo: «−0,1 %» no se escribe «0 %» junto a la barra que lo dice. */
  const enLaLectura = (v: number | undefined) => pct(v ?? 0, (v ?? 0) < 0 ? 1 : 0);
  const fueraPct = a.fueraDelReparto.pesoPct;
  const cubreLoQueEntra = a.underlyingMixCoverage !== null && a.underlyingMixCoverage + fueraPct / 100 > 0.9995;
  const { macroTotals: geo } = buildRegionTable(a.equityRegions);
  /* A-211: en % de la cartera; `equityLookthroughSinReparto` es una fracción. */
  const sinRepartoEnLaLectura = fraseDelSinRepartoEnElPapel((a.equityLookthroughSinReparto ?? 0) * 100);
  const topMacro = MACROS.reduce((best, mz) => (geo[mz] > geo[best] ? mz : best), "america" as Macro);
  /* Región, categoría y SRI van en la misma columna, y con más de 18 filas no caben los nombres en dos líneas: con 15 posiciones dejaba una hoja casi vacía. */
  const columnaLarga = a.byRegion.length + Math.min(a.byCategory.length, 9) + Math.min(a.bySri.length, 9) > 18;
  const geoLine = geo[topMacro] > 0 ? `De la renta variable, la mayor parte está en ${ZONE_LABEL[topMacro]} (${pesoT(geo[topMacro] / 100)})${a.equityRegionsUnclassified > 0.05 ? `; el ${pesoT(a.equityRegionsUnclassified / 100)} no se ha podido situar` : ""}.` : null;
  return (
    <Sheet m={m} section="3 · Composición">
      <SectionHead number="3" title="Composición" lead="Primero, el reparto directo de la cartera según lo declarado en cada ficha. Después, la composición subyacente agregada: lo que hay de verdad dentro de los fondos, incluido el mapa geográfico de la renta variable." />
      <Reading lines={[
        fraseDeLoQueNoEntra(a.fueraDelReparto, "detalladas en la sección 10"),
        topClass ? `Clase dominante: ${topClass.label} con el ${pesoT(topClass.weight)} del peso${clases[1] ? `, seguida de ${clases[1].label} (${pesoT(clases[1].weight)})` : ""}.` : null,
        topCur ? `El ${pesoT(topCur.weight)} de la cartera está denominado en ${topCur.label}${topCur.key !== "EUR" ? ": hay riesgo de divisa que conviene explicar" : ""}.` : null,
        num(mix.equity) ? `Mirando dentro de los fondos, la exposición real es ${enLaLectura(mix.equity)} renta variable, ${enLaLectura(mix.fixed_income)} renta fija y ${enLaLectura(mix.cash)} liquidez (cobertura ${a.underlyingMixCoverage !== null ? pct(a.underlyingMixCoverage, 0) : FALTA}${a.underlyingMixSinReparto >= 0.0005 ? `; el ${pesoT(a.underlyingMixSinReparto)} no declara su reparto` : ""}).` : null,
        geoLine
      ]} />
      <H2>Reparto declarado</H2>
      <View style={s.dosColumnas}>
        <View style={s.columna}>
          <H3>Clase económica</H3><BarList rows={a.byClass} width={MEDIO} />
          <H3>Por producto</H3><BarList rows={a.byType} width={MEDIO} />
          <H3>Divisa de denominación</H3><BarList rows={a.byCurrency} width={MEDIO} />
        </View>
        <View style={s.columna}>
          <H3>Región declarada</H3><BarList rows={a.byRegion} width={MEDIO} />
          <H3>Categoría</H3><BarList rows={a.byCategory} width={MEDIO} limit={8} enUnaLinea={columnaLarga} />
          {/* Todas las filas: dentro de «Otros» se sumarían dos escalas distintas (decisión 79). */}
          <H3>Indicador de riesgo</H3><BarList rows={a.bySri} width={MEDIO} limit={a.bySri.length} />
        </View>
      </View>
      {/* Sin salto forzado (INF-22): el título pide sitio para su contenido y, si no lo hay, pasa con él a la hoja siguiente. */}
      <H2>Composición subyacente agregada</H2>
      <View style={s.dosColumnas}>
        <View style={s.columna}>
          <H3>Mezcla de activos</H3>
          <BarList rows={a.underlyingMix} width={MEDIO} empty="Sin exposición publicada." />
          <T style={s.pie}>Cobertura: {a.underlyingMixCoverage !== null ? pct(a.underlyingMixCoverage, 0) : FALTA} del peso con vector de exposición; {pieDeLaMezcla(a.underlyingMixCoverage, a.underlyingMixSinReparto, fueraPct, cubreLoQueEntra)}</T>
        </View>
        <View style={s.columna}>
          <H3>Sectores de la renta variable</H3>
          {/* Todas las filas: con el límite de siempre, «No declarado» se perdía dentro de «Otros» (decisión 11). */}
          <BarList rows={a.equitySectors} width={MEDIO} empty="Sin sectores." limit={a.equitySectors.length} />
          <T style={s.pie}>Fuente: {qualityText[a.equitySectorsQuality] ?? a.equitySectorsQuality}.</T>
          {/* A-211: lo que no declara su reparto de activos no entra en los sectores ni en las regiones, y se dice en los dos. */}
          {sinRepartoEnLaLectura ? <T style={s.pie}>{sinRepartoEnLaLectura}</T> : null}
        </View>
      </View>
      {/* El título va con su mapa, que no se parte: si no cabe, pasan juntos a la hoja siguiente. */}
      <View wrap={false}>
        <H2>Distribución geográfica de la renta variable</H2>
        <GeoMap rows={a.equityRegions} unclassified={a.equityRegionsUnclassified} canadaYAfricaSinSeparar={a.canadaYAfricaSinSeparar} width={ANCHO} />
        {sinRepartoEnLaLectura ? <T style={s.pie}>{sinRepartoEnLaLectura}</T> : null}
      </View>
      <H3>Metodología de las métricas por posición</H3>
      <BarList rows={a.byMetricsMethod} width={MEDIO} />
      <Texto style={s.pie}>Peso de la cartera cuyas métricas calcula el sistema sobre la serie propia frente al que llega del proveedor.</Texto>
    </Sheet>
  );
}

function UnderlyingSheet({ m }: { m: InternalReportModel }) {
  const lt = m.lookThrough;
  const rows = (lt?.rows ?? []).slice(0, 25);
  const ov = m.overlap;
  const topUnderlying = rows[0];
  /* Decisión B-79: de qué ETF se ha mirado la cartera completa de su emisor, y de qué fecha. Solo este papel la recibe. */
  const delEmisorEn41 = fraseDeLasCarterasDelEmisor((lt?.fund_portfolios ?? []).map((f) => ({ nombre: f.display_name, origen: f.issuer_portfolio })));
  type Subyacente = (typeof rows)[number];
  const underlying = (
    <>
      <SectionHead number="4.1" title="Posiciones subyacentes" lead="Lo que publican los fondos, agregado: acciones, bonos y patas de derivados y divisa, con su peso sobre el total." />
      {lt && rows.length ? (
        <>
          <Reading lines={[
            topUnderlying ? `La mayor línea es ${topUnderlying.name} con el ${pct(topUnderlying.weight_percent / 100)} de la cartera, ${!topUnderlying.direct_weight_percent ? `presente en ${origenDeLaLinea(topUnderlying)}` : topUnderlying.fund_count > 0 ? `en directo y en ${origenDeLaLinea({ fund_count: topUnderlying.fund_count })}` : "en directo"}.` : null,
            /* Sin suma de las filas: mezclaría acciones con nominales de derivados (decisión 9). */
            `Cobertura: ${resumenDeLoMirado(lt)}`,
            rows.filter((r) => r.fund_count > 1).length ? `${rows.filter((r) => r.fund_count > 1).length} de estas líneas se repiten en más de un fondo; las que son títulos dan el solapamiento de la sección 4.2.` : null
          ]} />
          <T style={[s.pequeno, { marginBottom: 2 }]}>Pesos brutos, incluye derivados · {rows.length === 1 ? "La única posición subyacente" : `Las ${rows.length} mayores posiciones subyacentes, agregadas`}</T>
          {/* Hasta 25 líneas: la tabla con cola, para que la última hoja no se quede con dos filas y su nota. */}
          <TablaConCola densa clave={(r) => r.key} cola={colaDeLaTabla(rows.length)}
            columnas={[
              { titulo: "#", ancho: 18, celda: (r: Subyacente) => String(rows.indexOf(r) + 1) },
              { titulo: "Posición subyacente", ancho: Math.floor(ANCHO) - 272, celda: (r: Subyacente) => r.name },
              { titulo: "Identificador", ancho: 92, celda: (r: Subyacente) => r.identifier ?? null },
              { titulo: "Peso en cartera", ancho: 80, cifra: true, celda: (r: Subyacente) => porcentaje(r.weight_percent / 100) },
              { titulo: "Origen", ancho: 82, cifra: true, celda: (r: Subyacente) => origenDeLaLinea(r) }
            ]}
            filas={rows}
            alPie={<T style={s.pie}>Peso sobre la cartera total, sumando cada línea en todos los fondos que la publican; a veces publican solo sus mayores posiciones.{lt.direct_positions ? " Una acción en directo suma su peso como línea propia." : ""} Además, derivados y divisa de los fondos: no se suman porque son importes nominales, no inversión directa.{delEmisorEn41 ? ` ${delEmisorEn41}` : ""}</T>} />
        </>
      ) : <T style={s.cuerpo}>Composición subyacente no disponible{lt?.warnings.length ? `: ${lt.warnings.join(" ")}` : ": ninguna posición publica su cartera o no se ha podido cargar."}</T>}
    </>
  );
  const highest = m.highOverlapPairs[0];
  /* En el orden y con el número de las posiciones, los mismos que en todas las tablas. */
  const orden = ov ? enOrdenDePosicion(m, ov.positions.map((p) => p.asset_id), ov.values) : null;
  const enOrden = ov && orden ? orden.indices.map((i) => ov.positions[i]) : [];
  type Mirado = (typeof enOrden)[number];
  const numeroDelFondo = (nombre: string) => {
    const id = ov?.positions.find((p) => p.display_name === nombre)?.asset_id;
    return id ? numeroDe(m, id) : null;
  };
  const fondoConNumero = (nombre: string) => (numeroDelFondo(nombre) ? `${numeroDelFondo(nombre)}  ${nombre}` : nombre);
  /* Decisión B-79: las carteras del emisor que se han mirado, con el número de la matriz y la fecha de cada una. */
  const delEmisorEn42 = fraseDeLasCarterasDelEmisor(enOrden.map((p) => ({ nombre: fondoConNumero(p.display_name), origen: p.issuerPortfolio })));
  /* Con el número de la matriz: los nombres enteros ocupaban tres líneas, y con una posición más la hoja no cabía. */
  const elPar = ({ a, b }: { a: string; b: string }) => {
    const [x, y] = [numeroDelFondo(a), numeroDelFondo(b)];
    return x && y ? `las posiciones ${Math.min(x, y)} y ${Math.max(x, y)}` : `${a} y ${b}`;
  };
  /* Solo entran en la matriz los fondos que se pueden medir (Óscar, 11-11-2026); los demás van debajo con su motivo, con las palabras de
     pantalla (`corteDeLaMatriz`). Ninguna cifra cambia: la lectura y los puntos a revisar siguen contando los pares sin medir. */
  const corte = ov && ov.positions.length ? corteDeLaMatriz(enOrden) : null;
  const ningunoSeMide = Boolean(ov && ov.positions.length && ov.values.every((row) => row.every((v) => v === null)));
  const dentro = corte && corte.sinMatriz === null ? corte.dentro : [];
  const valoresDentro = recortarLaMatriz(orden?.values ?? ov?.values ?? [], dentro);
  const conCifrasElSolapamiento = matrizConCifras(dentro.length, valoresDentro, (v, i, j) => lineasDelSolapamiento(v, i, j)?.lineas ?? [cifraDelSolapamiento(v)], CASILLA_DEL_SOLAPAMIENTO);
  const fueraDeLaMatriz = corte?.fuera.length ? (
    <View style={{ marginTop: 4 }}>
      <T style={s.pequeno}>{FUERA_DE_LA_MATRIZ}</T>
      {corte.fuera.map((linea, i) => <T key={i} style={s.pequeno}>{linea}</T>)}
    </View>
  ) : null;
  const overlapBlock = (
    <>
      <SectionHead number="4.2" title="Solapamiento entre fondos" lead="Títulos comunes de cada par de fondos, con el peso real de cada línea; no cuentan derivados, sus contrapartidas ni efectivo, cuando el dato los distingue. Un fondo al que le falta más de la mitad de su cartera no entra en la matriz." />
      {ningunoSeMide && corte ? (
        <T style={s.cuerpo}>{corte.sinMatriz}</T>
      ) : ov && ov.positions.length ? (
        <Reading lines={[
          highest
            ? `El par más solapado es ${highest.a} y ${highest.b}: comparten ${solapamientoEnUnaFrase(highest.value)} de su cartera.`
            : m.overlapPairs.mayor
              ? `En lo medido ningún par llega al 40 %: lo más alto ${noLlegaAUnaDecima(m.overlapPairs.mayor.value) ? "no llega al 0,1 %" : `es ${textoDelSolapamiento(m.overlapPairs.mayor.value)}`}, entre ${elPar(m.overlapPairs.mayor)}. El real puede ser mayor.`
              : m.overlapPairs.measured > 0
                ? "En lo medido no se ha visto ninguna línea común entre dos fondos. Solo se mira lo recibido: no prueba que no las haya."
                : null,
          m.highOverlapPairs.length ? `${m.highOverlapPairs.length} ${m.highOverlapPairs.length === 1 ? "par supera" : "pares superan"} el 40 %: comparten buena parte de lo que publican. Eso no decide por sí solo: no mide coste, divisa ni cobertura.` : null,
          m.overlapPairs.unmeasured > 0 ? `${m.overlapPairs.unmeasured} de ${m.overlapPairs.measured + m.overlapPairs.unmeasured} pares quedan sin medir, y eso no significa que no se solapen: de alguno de los dos no se ha recibido ni la mitad de la cartera.` : null,
          /* IMP-7: carteras de fechas separadas por más de un mes, o sin fecha. */
          ...notasDeLasFechasDelModelo({ positions: enOrden })
        ]} />
      ) : <T style={s.cuerpo}>{m.overlapError ? `No disponible: ${m.overlapError}` : "Sin datos de solapamiento."}</T>}
      {ov && ov.positions.length ? (
        <View wrap={false}>
          <H3>Qué se ha mirado de cada fondo</H3>
          <TablaDe
            columnas={[
              { titulo: "#", ancho: 14, celda: (p: Mirado) => String(numeroDe(m, p.asset_id)) },
              { titulo: "Posición", ancho: 264, celda: (p: Mirado) => p.display_name },
              { titulo: "Líneas", ancho: 40, cifra: true, estrecha: true, celda: (p: Mirado) => (p.published ? numero(p.published.lineas) : p.status === "not_applicable" ? NO_APLICA : null) },
              { titulo: "Peso", ancho: 46, cifra: true, estrecha: true, celda: (p: Mirado) => (p.published ? peso(p.published.pesoPct / 100) : p.status === "not_applicable" ? NO_APLICA : null) },
              { titulo: "Situación", ancho: 146, celda: (p: Mirado) => SITUACION_DEL_FONDO[p.status] }
            ]}
            filas={enOrden} />
          <T style={s.pie}>Peso: la suma de las líneas recibidas, con su signo. Por encima del 100 % lo hace el nominal de los derivados.{delEmisorEn42 ? ` ${delEmisorEn42}` : ""}</T>
        </View>
      ) : null}
      {/* La matriz, después de lo mirado: si no cabe todo salta ella, que llena su hoja, y no se queda la tabla sola en otra (39 % con 10 posiciones). */}
      {ov && corte && corte.sinMatriz === null ? (
        <View wrap={false}>
          <H2>Matriz de solapamiento · {dentro.length === ov.positions.length ? `${ov.positions.length} mayores posiciones` : `${dentro.length} fondos de las ${ov.positions.length} mayores posiciones`}</H2>
          <NamedMatrix labels={dentro.map((i) => enOrden[i].display_name)} numeros={orden ? dentro.map((i) => orden.numeros[i]) : undefined} values={valoresDentro} width={ANCHO} format={cifraDelSolapamiento}
            dosLineas={lineasDelSolapamiento} casillaMaxima={CASILLA_DEL_SOLAPAMIENTO} />
          {conCifrasElSolapamiento ? null : (
            <EscalaDeTonos pasos={[0, 20, 40, 60, 80, 100]} diverging={false} escribir={(v) => `${v}`} sinCifras nota="En %. Más oscuro, más cartera común." />
          )}
          <T style={s.pie}>En %, y cada cifra es un mínimo: solo se suma lo recibido. Más oscuro, más cartera común. Solo entran los fondos de los que se ha recibido al menos la mitad de su cartera.{valoresDentro.some((fila, i) => fila.some((v, j) => i !== j && sinComunes(v))) ? ` ${NOTA_SIN_COMUNES}` : ""}{valoresDentro.some((fila, i) => fila.some((v, j) => i !== j && pasaDeCien(v))) ? ` ${NOTA_MAS_DE_100}` : ""}</T>
          {fueraDeLaMatriz}
        </View>
      ) : corte && (fueraDeLaMatriz || !ningunoSeMide) ? (
        <View wrap={false}>
          {ningunoSeMide ? null : <T style={s.cuerpo}>{corte.sinMatriz}</T>}
          {fueraDeLaMatriz}
        </View>
      ) : null}
      {/* Sin la cifra en cada casilla (INF-28), las diez parejas con más solapamiento, con su cifra y sus nombres. */}
      {ov && corte && corte.sinMatriz === null && !conCifrasElSolapamiento ? (
        <View wrap={false}>
          <H3>Las diez parejas con más solapamiento</H3>
          <TablaDe
            columnas={[
              { titulo: "Par de fondos", ancho: 430, celda: (p: { a: number; b: number; valor: number }) => ({ texto: fondoConNumero(enOrden[dentro[p.a]].display_name), apunte: fondoConNumero(enOrden[dentro[p.b]].display_name) }) },
              { titulo: "Solapamiento", ancho: 80, cifra: true, celda: (p: { a: number; b: number; valor: number }) => textoDelSolapamiento(p.valor) }
            ]}
            filas={paresDeSolapamiento(valoresDentro, valoresDentro.map((_, i) => i)).slice(0, 10)} />
        </View>
      ) : null}
      {m.highOverlapPairs.length ? (
        <View wrap={false}>
          <H2>Pares con solapamiento alto (40 % o más)</H2>
          <TablaDe
            columnas={[
              { titulo: "Par de fondos", ancho: 430, celda: (p: (typeof m.highOverlapPairs)[number]) => ({ texto: fondoConNumero(p.a), apunte: fondoConNumero(p.b) }) },
              { titulo: "Solapamiento", ancho: 80, cifra: true, celda: (p: (typeof m.highOverlapPairs)[number]) => textoDelSolapamiento(p.value) }
            ]}
            filas={m.highOverlapPairs.slice(0, 10)} />
        </View>
      ) : null}
    </>
  );
  // Con una tabla de subyacentes larga, cada bloque en su página; si no, comparten página.
  if (rows.length > 12) {
    return (
      <>
        <Sheet m={m} section="4.1 · Posiciones subyacentes">{underlying}</Sheet>
        <Sheet m={m} section="4.2 · Solapamiento">{overlapBlock}</Sheet>
      </>
    );
  }
  return (
    <Sheet m={m} section="4 · Subyacentes y solapamiento">
      {underlying}
      <View style={{ height: 16 }} />
      {overlapBlock}
    </Sheet>
  );
}

/**
 * Decisión 95: lo que hace el encogimiento del modelo, detrás de la nota del Máximo Sharpe, solo donde es cierto, con la misma regla que Optimizar y
 * Simular (`fraseDelEncogimiento`: renta fija y bolsa a la vez, y más de tres activos). Va aquí y no dentro de `notaDelMaximoSharpe`, que también lee
 * Simular, que ya la añade: dentro, la diría dos veces. Si es cierta en una ventana y no en la otra, dice en cuál.
 */
export function encogimientoDelMaximoSharpe(ventanas: readonly Pick<InternalHorizonModel, "horizon">[], m: Pick<InternalReportModel, "assetsById">): string {
  const activos = [...m.assetsById.values()];
  const frases = ventanas.filter((h) => h.horizon.maxSharpe).map((h) => ({ anos: h.horizon.years, frase: fraseDelEncogimiento(h.horizon.frontier, activos) }));
  const ciertas = frases.flatMap(({ anos, frase }) => (frase ? [{ anos, frase }] : []));
  if (!ciertas.length) return "";
  if (ciertas.length === frases.length) return ` ${ciertas[0].frase}`;
  return ciertas.map(({ anos, frase }) => ` A ${anos} años, ${frase.charAt(0).toLocaleLowerCase("es-ES")}${frase.slice(1)}`).join("");
}

/** Un gráfico de líneas de la plantilla, o la frase de lo que falta si la serie no da para él. */
function Lineas({ fechas, series, ancho, alto, formato, formatoDelEje }: { fechas: string[]; series: SerieDeLineas[]; ancho: number; alto: number; formato: (v: number) => string | null; formatoDelEje?: (v: number) => string | null }) {
  const valores = series.flatMap((x) => x.valores).filter((v) => num(v));
  if (fechas.length < 2 || !valores.length) return <Texto style={s.pequeno}>{SIN_SERIE}</Texto>;
  return <GraficoDeLineas fechas={fechas} series={series} ancho={ancho} alto={alto} formato={formato} formatoDelEje={formatoDelEje} />;
}

const base100 = (v: number) => numero(v, { decimales: 1 });
const base100DelEje = (v: number) => numero(v);
const porcentajeDelEje = (v: number) => porcentaje(v, { decimales: 1 });

function PerformanceSheets({ m }: { m: InternalReportModel }) {
  if (!m.horizons.length) {
    return (
      <Sheet m={m} section="5 · Rentabilidad">
        <SectionHead number="5" title="Rentabilidad" />
        <T style={s.cuerpo}>{FALTA}. {m.salud.porQue ?? "No se ha podido simular la cartera."} La causa de cada periodo está en la sección 10.</T>
      </Sheet>
    );
  }
  const ventanas = conCifra(m);
  /* La frase del encogimiento (decisión 95) alarga la nota del Máximo Sharpe, al pie de una hoja que ya va llena: las dos gráficas ceden lo justo
     para que la nota no se vaya sola a otra hoja. Solo cuando sale. */
  const encogimiento = encogimientoDelMaximoSharpe(ventanas, m);
  if (!ventanas.length) {
    return (
      <Sheet m={m} section="5 · Rentabilidad">
        <SectionHead number="5" title="Rentabilidad" />
        <LoQueMide m={m} />
        <SinCifraDeLaCartera m={m} />
        <Texto style={s.pequeno}>Sin cifras de la cartera, ni su evolución, ni la comparación con la referencia, ni sus años, ni sus caídas. Lo que se mide de cada posición está en la sección 2.</Texto>
      </Sheet>
    );
  }
  const periodoDe = (h: InternalHorizonModel) => {
    const dates = h.horizon.backtest.portfolio_series.map((p) => p.date);
    return t(periodo(h.horizon.backtest.coverage?.first_date ?? dates[0], h.horizon.backtest.coverage?.last_date ?? dates[dates.length - 1]));
  };
  const lineasDe = (h: InternalHorizonModel): SerieDeLineas[] => {
    const series = h.horizon.backtest.portfolio_series;
    const dates = series.map((p) => p.date);
    const eq = new Map((h.horizon.equalWeight?.portfolio_series ?? []).map((p) => [p.date, p.value]));
    const ms = new Map((h.horizon.maxSharpe?.portfolio_series ?? []).map((p) => [p.date, p.value]));
    const bench = h.benchmarkValues;
    /* Los dos parten del mismo punto en su primera fecha común, sea o no la primera de la cartera. */
    const benchStart = bench ? bench.findIndex((v) => v !== null && Number.isFinite(v)) : -1;
    const benchScale = benchStart >= 0 ? series[benchStart].value / 100 : null;
    return [
      { nombre: "Cartera actual", valores: series.map((p) => p.value) },
      ...(bench && benchScale !== null ? [{ nombre: "Referencia", valores: bench.map((v) => (v === null ? null : v * benchScale)), referencia: true }] : []),
      ...(h.horizon.equalWeight ? [{ nombre: "Equiponderada", valores: dates.map((d) => eq.get(d) ?? null) }] : []),
      ...(h.horizon.maxSharpe ? [{ nombre: "Máximo Sharpe", valores: dates.map((d) => ms.get(d) ?? null) }] : [])
    ];
  };
  type Metricas = InternalHorizonModel["horizon"]["backtest"]["metrics"];
  type FilaDeCartera = { label: string; de: (h: InternalHorizonModel) => Metricas | undefined };
  const filasDeCartera: FilaDeCartera[] = [
    { label: "Cartera actual", de: (h) => h.horizon.backtest.metrics },
    { label: "Equiponderada", de: (h) => h.horizon.equalWeight?.metrics },
    { label: "Máximo Sharpe", de: (h) => h.horizon.maxSharpe?.metrics }
  ];
  /* Con una sola acción no hay nada que optimizar: la fila del Máximo Sharpe no aplica, no es que le falte el dato. */
  const noAplicaSinCartera = (h: InternalHorizonModel, r: FilaDeCartera) => (h.sharpeNoAplica && !r.de(h) ? NO_APLICA : null);
  const anios = filasDeAniosNaturales(ventanas);
  type Anio = (typeof anios)[number];
  const distinto = anioQueMasDifiere(anios);
  const cortada = ventanas.find((h) => h.comparison?.cut)?.comparison;
  const celdaDeAnio = (w: InternalHorizonModel["window"], valor: (y: NonNullable<Anio["porVentana"]["3Y"]>) => CeldaDeTabla) => (fila: Anio): CeldaDeTabla => {
    const anio = fila.porVentana[w];
    return anio ? valor(anio) : NO_APLICA;
  };
  const conAsterisco = (celda: CeldaDeTabla, asterisco: boolean): CeldaDeTabla => (asterisco && typeof celda === "object" && celda !== null && celda.texto ? { ...celda, texto: `${celda.texto}*` } : celda);
  return (
    <Sheet m={m} section={`5 · Rentabilidad · ${ventanasEnTitulo(ventanas)}`}>
      <SectionHead number="5" title={`Rentabilidad · ${ventanasEnTitulo(ventanas)}`}
        lead={`Simulación histórica de la cartera actual con los pesos de hoy (${ventanas.map(periodoDe).join(" y ")}), en base 100, frente a la referencia y a dos carteras con los mismos activos: la equiponderada y la de máximo Sharpe.`} />
      <LoQueMide m={m} />
      <Reading lines={[...lineasSinCifra(m), ...performanceReading(ventanas, m.benchmarkLabel)]} />
      <T style={s.pie}>{notaDelBenchmark(m)}</T>
      <H2>Evolución del valor · base 100</H2>
      <GraficosPorVentana ventanas={ventanas}>{(h, ancho) => (
        <View>
          <RotuloDeVentana h={h} />
          <Lineas fechas={h.horizon.backtest.portfolio_series.map((p) => p.date)} series={lineasDe(h)} ancho={ancho} alto={encogimiento ? 118 : 128} formato={base100} formatoDelEje={base100DelEje} />
        </View>
      )}</GraficosPorVentana>
      {/* Tres filas: la tabla no se parte, y si no cabe pasa entera, con su nota. */}
      <View wrap={false} style={{ marginTop: 6 }}>
      <TablaDe
        columnas={[
          { titulo: "Cartera", ancho: 3, celda: (r: FilaDeCartera) => r.label },
          ...ventanas.flatMap((h) => {
            const a = ventanasEnTitulo([h]);
            return [
              { titulo: `Rent. ${a}`, ancho: 1.3, cifra: true, estrecha: true, celda: (r: FilaDeCartera) => noAplicaSinCartera(h, r) ?? celdaRent(r.de(h)?.cagr) },
              { titulo: `Vol. ${a}`, ancho: 1.2, cifra: true, estrecha: true, celda: (r: FilaDeCartera) => noAplicaSinCartera(h, r) ?? porcentaje(r.de(h)?.volatility) },
              { titulo: `Sharpe ${a}`, ancho: 1.2, cifra: true, estrecha: true, celda: (r: FilaDeCartera) => (h.sharpeNoAplica ? NO_APLICA : ratioC(r.de(h)?.sharpe)) },
              { titulo: `Caída ${a}`, ancho: 1.3, cifra: true, estrecha: true, celda: (r: FilaDeCartera) => noAplicaSinCartera(h, r) ?? porcentaje(r.de(h)?.max_drawdown) }
            ];
          })
        ]}
        filas={filasDeCartera} />
      {ventanas.some((h) => h.horizon.maxSharpe) ? <T style={s.pie}>{notaDelMaximoSharpe(ventanas)}{encogimiento}{sinLoApartado(m, ventanas)} Conoce el resultado del periodo: sesgo retrospectivo.</T> : null}
      </View>
      {/* Sin salto forzado: con él, una nota que no cabía se quedaba sola en su hoja (17 % con 40 posiciones). */}
      <View wrap={false}>
        <H2>Caída desde el último máximo</H2>
        <GraficosPorVentana ventanas={ventanas}>{(h, ancho) => (
          <View>
            <RotuloDeVentana h={h} />
            <Lineas fechas={h.horizon.backtest.portfolio_series.map((p) => p.date)} series={[{ nombre: "Caída desde máximo", valores: underwater(h.horizon.backtest.portfolio_series.map((p) => p.value)) }]} ancho={ancho} alto={90} formato={(v) => porcentaje(v)} formatoDelEje={porcentajeDelEje} />
          </View>
        )}</GraficosPorVentana>
      </View>
      <View wrap={false}>
        <H2>Rentabilidad por años naturales</H2>
        <TablaDe
          columnas={[
            { titulo: "Año", ancho: 1.2, celda: (r: Anio) => String(r.year) },
            ...ventanas.flatMap((h) => {
              const a = ventanasEnTitulo([h]);
              const w = h.window;
              return [
                { titulo: `Cartera ${a}`, ancho: 1.3, cifra: true, estrecha: true, celda: celdaDeAnio(w, (y) => conAsterisco(celdaRent(y.portfolio), y.partial)) },
                { titulo: `Referencia ${a}`, ancho: 1.3, cifra: true, estrecha: true, celda: celdaDeAnio(w, (y) => (y.benchmark !== null ? conAsterisco(celdaRent(y.benchmark), y.partial) : null)) },
                { titulo: `Diferencia ${a}`, ancho: 1.3, cifra: true, estrecha: true, celda: celdaDeAnio(w, (y) => (y.benchmark !== null ? celdaPp(y.portfolio - y.benchmark) : null)) }
              ];
            })
          ]}
          filas={anios} />
        <T style={s.pie}>* Año incompleto dentro de esa ventana (sin anualizar).{ventanas.length > 1 ? ` ${ventanas.some((h) => h.comparison) ? "Cartera y referencia fijan" : "La cartera fija"} sus pesos en el primer día de cada ventana, y por eso el mismo año difiere${distinto ? `: ${distinto.year}, ${pctSigned(distinto.a3)} a 3 años y ${pctSigned(distinto.a5)} a 5${distinto.benchmark ? ` en la cartera, y ${pctSigned(distinto.benchmark.a3)} y ${pctSigned(distinto.benchmark.a5)} en la referencia` : ""}` : ""}.` : ""}{cortada ? ` Cartera y referencia, hasta el ${fechaT(cortada.last)}.` : ""}</T>
      </View>
      <View style={{ marginTop: 10 }} wrap={false}>
        <PorVentana ventanas={ventanas}>{(h) => (
          <View>
            <H3>Episodios de caída más profundos · {windowLabel(h.window)}</H3>
            <TablaDe
              columnas={[
                { titulo: "Caída", ancho: 46, cifra: true, celda: (r: InternalHorizonModel["episodes"][number]) => porcentaje(r.depth) },
                { titulo: "Máximo", ancho: 54, celda: (r: InternalHorizonModel["episodes"][number]) => fecha(r.peakDate) },
                { titulo: "Mínimo", ancho: 54, celda: (r: InternalHorizonModel["episodes"][number]) => fecha(r.troughDate) },
                { titulo: "Recuperación", ancho: 92, celda: (r: InternalHorizonModel["episodes"][number]) => (r.recoveryDate ? `${fechaT(r.recoveryDate)} (${r.recoveryDays} d)` : "Pendiente") }
              ]}
              filas={h.episodes} />
            <H3>Mejores y peores periodos · {windowLabel(h.window)}</H3>
            <T style={s.cuerpo}>Mejor semana {pctSigned(h.extremes.bestWeek?.value)} ({h.extremes.bestWeek ? fechaT(h.extremes.bestWeek.date) : FALTA}) · peor {pctSigned(h.extremes.worstWeek?.value)} ({h.extremes.worstWeek ? fechaT(h.extremes.worstWeek.date) : FALTA})</T>
            <T style={s.cuerpo}>Mejor mes {pctSigned(h.extremes.bestMonth?.value)} ({mesLegible(h.extremes.bestMonth?.month)}) · peor {pctSigned(h.extremes.worstMonth?.value)} ({mesLegible(h.extremes.worstMonth?.month)})</T>
            <T style={s.cuerpo}>Semanas positivas {pct(h.extremes.positiveWeeksShare, 0)} · meses positivos {pct(h.extremes.positiveMonthsShare, 0)}</T>
          </View>
        )}</PorVentana>
      </View>
      {/* Sin salto forzado (INF-22): el bloque no se parte y, si no cabe, pasa entero a la hoja siguiente. */}
      <View wrap={false}>
        <H2>Rentabilidad y volatilidad móviles a 12 meses</H2>
        <GraficosPorVentana ventanas={ventanas}>{(h, ancho) => {
          const rollDates = h.rolling.map((p) => p.date);
          return h.rolling.length >= 2 ? (
            <View>
              <RotuloDeVentana h={h} />
              <Lineas fechas={rollDates} series={[{ nombre: "Rentabilidad 12 meses", valores: h.rolling.map((p) => p.return) }]} ancho={ancho} alto={92} formato={(v) => rentabilidad(v)} formatoDelEje={porcentajeDelEje} />
              <View style={{ height: 2 }} />
              <Lineas fechas={rollDates} series={[{ nombre: "Volatilidad 12 meses", valores: h.rolling.map((p) => p.volatility) }]} ancho={ancho} alto={92} formato={(v) => porcentaje(v)} formatoDelEje={porcentajeDelEje} />
            </View>
          ) : <T style={s.pequeno}>El periodo a {h.horizon.years} años no da para una ventana móvil de un año.</T>;
        }}</GraficosPorVentana>
        <Texto style={s.pie}>Cada punto es el resultado de las 52 semanas anteriores: muestra si la rentabilidad y el riesgo han sido estables o dependen de un tramo concreto del periodo.</Texto>
      </View>
    </Sheet>
  );
}

/** Cada medida con su cifra y su umbral, sin nota ni adjetivo (decisión 18): la misma lectura que «Salud y control» en Análisis. */
function MedidasConUmbral({ filas }: { filas: FilaDeControl[] }) {
  return (
    <View wrap={false}>
      <H2>Medidas y umbrales</H2>
      <TablaDe
        columnas={[
          { titulo: "Medida", ancho: 118, celda: (f: FilaDeControl) => f.rotulo },
          { titulo: "Cifra", ancho: 100, cifra: true, celda: (f: FilaDeControl) => f.cifra ?? (f.ausencia ? textoDeAusencia(f.ausencia) : null) },
          { titulo: "Umbral o detalle", ancho: 255, celda: (f: FilaDeControl) => ({ texto: f.nota ?? "", apunte: f.detalle?.join(" · ") ?? null }) },
          { titulo: "", ancho: 40, cifra: true, celda: (f: FilaDeControl) => (f.revisar ? "Revisar" : "") }
        ]}
        filas={filas} />
    </View>
  );
}

function RiskContributions({ m, name }: { m: InternalReportModel; name: (id: string) => string }) {
  /* La misma lectura que Análisis (decisión A-132): con frontera va dentro de ella; por encima del tope de la frontera no la hay y va aparte. */
  const h = m.horizons.find((x) => aportacionAlRiesgo(x.horizon)?.length);
  const contributions = (h ? aportacionAlRiesgo(h.horizon) : null) ?? null;
  const rows = contributions ? [...contributions].sort((a, b) => numeroDe(m, a.asset_id) - numeroDe(m, b.asset_id)) : [];
  const top = Math.max(1, ...rows.map((c) => Math.max(c.weight_pct, c.risk_pct)));
  const nombreW = 262;
  const barW = ANCHO - 16 - nombreW - 96;
  /* Hasta el tope de la frontera el bloque cabe en una hoja y no se parte. Por encima no cabe: sigue en la siguiente, con su cabecera. */
  const larga = rows.length > TOPE_DE_LA_FRONTERA;
  const medidos = m.horizons[0]?.horizon.backtest.asset_ids?.length ?? null;
  const sinReparto = medidos === null ? "Sin medición de la cartera no hay reparto del riesgo."
    : medidos < 2 ? "Con un solo activo medido no hay reparto del riesgo."
      : "La medición no ha traído el reparto del riesgo.";
  const titulo = (texto: string, ancho: number, derecha = false) => <Texto style={[s.tTitulo, { fontSize: M.tabla.cabecera, width: ancho, textAlign: derecha ? "right" : "left" }]}>{texto}</Texto>;
  const celda = { fontSize: M.tabla.celda, lineHeight: 1.3 };
  return (
    <View wrap={larga}>
      <H2>Contribución al riesgo frente al peso{h ? ` · ${windowLabel(h.window)}` : ""}</H2>
      {rows.length ? (
        <View>
          <View style={[s.tCabecera, { paddingVertical: 3, marginBottom: 2 }]} wrap={false} fixed={larga}>
            {titulo("#", 16)}
            {titulo("Posición", nombreW)}
            {titulo("Peso (gris) · riesgo (color)", barW)}
            {titulo("Peso / riesgo", 96, true)}
          </View>
          {rows.map((c) => {
            /* Con las cifras que se imprimen: «1,4 % / 1,4 %» no va en ocre (Óscar, 20-11-2026). */
            const pesaMenos = aportaMasRiesgoDelQuePesa(c.weight_pct, c.risk_pct);
            return (
              <View key={c.asset_id} style={{ flexDirection: "row", alignItems: "center", marginBottom: 1.4 }} wrap={false}>
                <Texto style={[celda, { width: 16, color: PAPEL.tinta3 }]}>{String(numeroDe(m, c.asset_id))}</Texto>
                <Texto style={[celda, { width: nombreW, paddingRight: 8 }]}>{shorten(name(c.asset_id), 60)}</Texto>
                <Svg width={barW} height={10}>
                  <Rect x={0} y={0.5} width={(barW * Math.max(0, c.weight_pct)) / top} height={3.8} fill={SERIES.referencia} />
                  <Rect x={0} y={5.2} width={(barW * Math.max(0, c.risk_pct)) / top} height={3.8} fill={pesaMenos ? PAPEL.aviso : SERIES.cartera} />
                </Svg>
                <T style={[celda, { width: 96, textAlign: "right", color: pesaMenos ? PAPEL.aviso : PAPEL.tinta }]}>{pesoT(c.weight_pct / 100)} / {pesoT(c.risk_pct / 100)}</T>
              </View>
            );
          })}
          <Texto style={s.pie}>El peso es sobre la parte medida. En ocre, la posición aporta más riesgo del que pesa.</Texto>
        </View>
      ) : <Texto style={s.pequeno}>{sinReparto}</Texto>}
    </View>
  );
}

function RiskOverviewSheet({ m }: { m: InternalReportModel }) {
  const name = (id: string) => m.positions.find((p) => p.assetId === id)?.name ?? id;
  const c = m.concentration;
  /* «10 mayores» de una cartera de diez o menos dice siempre 100 %. */
  const masDeDiez = Boolean(c && c.positions > 10);
  return (
    <Sheet m={m} section="6.1 · Riesgo · medidas y umbrales">
      <SectionHead number="6.1" title="Riesgo · medidas y umbrales" lead="Cada medida con su cifra y su umbral, los mismos que la pantalla de Análisis: de dónde viene el riesgo y cuánto concentra." />
      <LoQueMide m={m} ventanas={m.horizons.slice(0, 1)} />
      <Reading lines={[m.salud.porQue ? `${m.salud.titular}. ${m.salud.porQue}` : `${m.salud.titular}.`]} />
      <KpiGrid columns={masDeDiez ? 5 : masDeCinco(m) ? 4 : 3} items={[
        { label: "Posiciones", value: c ? String(c.positions) : null },
        { label: "Nº efectivo de posiciones", value: ratio(c?.effectivePositions, 1) },
        { label: "Mayor posición", value: pesoT(c?.top1) },
        ...(masDeCinco(m) ? [{ label: "5 mayores", value: pesoT(c?.top5) }] : []),
        ...(masDeDiez ? [{ label: "10 mayores", value: pesoT(c?.top10) }] : [])
      ]} />
      <MedidasConUmbral filas={m.medidas} />
      <RiskContributions m={m} name={name} />
    </Sheet>
  );
}

function RiskSheets({ m }: { m: InternalReportModel }) {
  if (!m.horizons.length) return null;
  const ventanas = conCifra(m);
  const titulo = ventanas.length ? `Riesgo · ${ventanasEnTitulo(ventanas)}` : "Riesgo";
  const cola = (h: InternalHorizonModel, nivel: number) => h.tailRisk.find((x) => x.level === nivel);
  type FilaDeRiesgo = { group: string; label: string; value: (h: InternalHorizonModel) => CeldaDeTabla };
  const filas: FilaDeRiesgo[] = [
    { group: "Riesgo total", label: "Volatilidad anualizada", value: (h) => porcentaje(h.horizon.backtest.metrics.volatility) },
    { group: "Riesgo total", label: "Caída máxima", value: (h) => porcentaje(h.horizon.backtest.metrics.max_drawdown) },
    { group: "Riesgo total", label: "Sharpe", value: sharpeDeCartera },
    /* A 5 años el tipo puede ser el estático si el BCE no responde: la cifra dice cuál es. */
    { group: "Riesgo total", label: "Tipo sin riesgo", /* INF-6: las dos señales del servidor (la política y el aviso), como `tipoDeRespaldo`. Con solo la política, un tipo de respaldo marcado por el aviso salía rotulado «€STR». */
      value: (h) => `${pct(h.horizon.backtest.metrics.rf_rate)}, ${tipoDeRespaldo(h.horizon.backtest) !== null ? "estático" : "€STR"}` },
    { group: "Riesgo total", label: "Sortino", value: sortinoDeCartera },
    { group: "Riesgo total", label: "Calmar", value: (h) => cifraDeCartera(h, "calmar", ratioC(h.calmar)) },
    { group: "Riesgo de cola", label: "VaR 95 % semanal", value: (h) => porcentaje(cola(h, 0.95)?.valueAtRisk) },
    { group: "Riesgo de cola", label: "CVaR 95 % semanal", value: (h) => porcentaje(cola(h, 0.95)?.conditionalValueAtRisk) },
    /* INF-8: no es un VaR al 99 %. Con las ventanas de este informe, ese percentil es una o dos semanas. */
    { group: "Riesgo de cola", label: "Peor semana del periodo", value: (h) => porcentaje(h.worstWeek) },
    { group: "Frente a la referencia", label: "Beta", value: (h) => ratioC(h.relative?.beta) },
    { group: "Frente a la referencia", label: "Correlación", value: (h) => ratioC(h.relative?.correlation) },
    { group: "Frente a la referencia", label: "Tracking error", value: (h) => cifraDeCartera(h, "trackingError", porcentaje(h.relative?.trackingError)) },
    { group: "Frente a la referencia", label: "Rentabilidad activa", value: (h) => (noAplicaAUnaAccion(h, "rentabilidadActiva") ? NO_APLICA : celdaPp(h.relative?.activeReturn)) },
    { group: "Frente a la referencia", label: "Ratio de información", value: (h) => cifraDeCartera(h, "ratioDeInformacion", ratioC(h.relative?.informationRatio)) },
    { group: "Frente a la referencia", label: "Alfa de Jensen", value: (h) => (noAplicaAUnaAccion(h, "alfa") ? NO_APLICA : celdaRent(h.relative?.jensenAlpha)) },
    { group: "Frente a la referencia", label: "Captura alcista / bajista", value: (h) => (h.relative ? `${pct(h.relative.upCapture, 0)} / ${pct(h.relative.downCapture, 0)}` : null) }
  ];
  /* Cada grupo abre con su fila de grupo, como la tabla de la plantilla los dibuja. */
  const filasDeLaTabla: FilaDeTabla[] = filas.flatMap((fila, i) => [
    ...(i === 0 || filas[i - 1].group !== fila.group ? [{ grupo: fila.group }] : []),
    { celdas: [fila.label, ...ventanas.map((h) => fila.value(h))] }
  ]);
  /* El estrés no depende de la ventana: una sola vez, salvo que el dato diga otra cosa. Y lleva su propia cobertura: no pasa por el corte del 80 %. */
  const escenarios = m.horizons.map((h) => h.horizon.backtest.stress_scenarios);
  const iguales = escenarios.every((lista) => JSON.stringify(lista) === JSON.stringify(escenarios[0]));
  const bloques = iguales ? [{ clave: "todas", rotulo: "", lista: escenarios[0] }] : m.horizons.map((h, i) => ({ clave: h.window, rotulo: ` · ${windowLabel(h.window)}`, lista: escenarios[i] }));
  /* Para nombrar con su peso lo que queda fuera de una crisis sin cifra (decisión 103). */
  const posicionDeLaCartera = (id: string) => {
    const posicion = m.positions.find((p) => p.assetId === id);
    return posicion ? { nombre: posicion.name, pesoPct: posicion.weight * 100 } : null;
  };
  const celda = { fontSize: M.tabla.celda, lineHeight: 1.3 };
  return (
    <Sheet m={m} section={`6.2 · ${titulo}`}>
      <SectionHead number="6.2" title={titulo} lead={ventanas.length ? "Medidas de cada periodo, episodios de estrés del pasado y cono estadístico de la cartera actual." : "Episodios de estrés del pasado, cada uno con la parte de la cartera que mide."} />
      <LoQueMide m={m} />
      {ventanas.length ? <>
      <Reading lines={[...lineasSinCifra(m), ...riskReading(ventanas, m)]} />
      <Tabla
        columnas={[{ titulo: "Medida", ancho: 2.4 }, ...ventanas.map((h) => ({ titulo: windowLabel(h.window), ancho: ventanas.length > 1 ? 1 : 2, cifra: true }))]}
        filas={filasDeLaTabla} />
      {m.avisoDeRiesgoDistinto ? <Nota titulo="Aviso.">{m.avisoDeRiesgoDistinto}</Nota> : null}
      <T style={s.pie}>{notaDelBenchmark(m)}</T>
      </> : <SinCifraDeLaCartera m={m} />}
      {/* Sin salto forzado: el bloque salta solo si no cabe, y la nota de la referencia no se queda sola en una hoja. */}
      <View style={[s.dosColumnas, { marginTop: 4 }]} wrap={false}>
        <View style={s.columna}>
          {bloques.map((b) => (
            <View key={b.clave}>
              <H2>Escenarios de estrés históricos{b.rotulo}</H2>
              {b.lista.length ? b.lista.map((x) => {
                /* Por debajo del 60 % no hay cifra, ni nada de lo que sale de ella: dice cuánto mide y quién queda fuera, y la salvedad pasa a ser ese motivo (decisión 103). */
                const sinCifra = motivoDeUnaCrisisSinCifra(x, posicionDeLaCartera);
                /* Una crisis mide desde su primer día; la historia común, de máximo a mínimo (decisión 115): lo dice, y sus fechas son las de ese máximo y ese mínimo. */
                const desde = x.peak_date ?? x.start_date;
                return (
                  <View key={x.id} style={{ paddingVertical: 3.5, borderBottomWidth: 0.75, borderBottomColor: PAPEL.filete }}>
                    <View style={{ flexDirection: "row" }}>
                      <T style={[celda, { flex: 1, fontWeight: 600 }]}>{x.peak_date && !sinCifra ? `${x.label}, desde máximos` : x.label}</T>
                      <Texto style={[celda, { fontWeight: 600, color: sinCifra ? PAPEL.tinta3 : PAPEL.tinta }]}>{sinCifra ? FALTA : pct(x.drawdown_pct !== null ? x.drawdown_pct / 100 : null)}</Texto>
                    </View>
                    <T style={[s.pequeno, { color: PAPEL.tinta3 }]}>{sinCifra ?? `${desde && x.trough_date ? t(periodo(desde, x.trough_date)) : FALTA} · ${x.recovery_status === "RECOVERED" ? `recuperada en ${x.recovery_days ?? "?"} días` : x.recovery_status === "NOT_RECOVERED" ? `pendiente de recuperar ${pct(x.remaining_to_recover_pct !== null ? x.remaining_to_recover_pct / 100 : null)}` : x.recovery_status === "NO_DRAWDOWN" ? "sin caída" : "sin datos de recuperación"} · cobertura ${pct(x.coverage.weight_pct / 100, 0)}`}</T>
                  </View>
                );
              }) : <Texto style={s.pequeno}>Sin escenarios de estrés para estas posiciones en el análisis del periodo.</Texto>}
            </View>
          ))}
          {iguales && m.horizons.length > 1 && escenarios[0].length ? <Texto style={s.pie}>No dependen de la ventana: son los mismos a 3 y a 5 años.</Texto> : null}
        </View>
        <View style={s.columna}>
          <H2>{ventanas.length ? "Cómo leer el riesgo de cola" : "Cómo leer los escenarios"}</H2>
          <T style={s.pequeno}>{ventanas.length ? "VaR y CVaR se definen en el glosario. Ninguno supone que los rendimientos sigan una distribución normal. " : ""}Los escenarios de estrés miden la caída que habría sufrido la cartera actual en episodios concretos del pasado; solo son representativos si cubren la mayor parte del peso.</T>
        </View>
      </View>
      {ventanas.length ? <>
      <H2>Cono estadístico</H2>
      {ventanas.slice(0, -1).map((h) => <ConoEstadistico key={h.window} h={h} capital={m.totalCapital} width={ANCHO} />)}
      {/* El último cono lleva la nota: junto a él, y no sola en una hoja. */}
      <View wrap={false}>
        <ConoEstadistico h={ventanas[ventanas.length - 1]} capital={m.totalCapital} width={ANCHO} />
        <T style={[s.pie, { textAlign: "center" }]}>{centroDeLosConos(ventanas)}{capitalDeLosConos(ventanas, m.totalCapital)}</T>
      </View>
      </> : null}
    </Sheet>
  );
}

/** Lo que no cabe se corta por una palabra, nunca a media palabra, y sin dejar colgando un «-» ni un «(». */
export function shorten(text: string, max: number): string {
  if (text.length <= max) return text;
  const trozo = text.slice(0, max - 1);
  const espacio = text[max - 1] === " " ? max - 1 : trozo.lastIndexOf(" ");
  return `${(espacio > 0 ? trozo.slice(0, espacio) : trozo).replace(/[\s\-–·(,]+$/, "")}…`;
}

/** Un nombre en dos líneas, partido por una palabra. Lo que no quepa en la segunda se corta también por una palabra. */
export function enDosLineas(nombre: string, ancho: number): string[] {
  if (nombre.length <= ancho) return [nombre];
  const espacio = nombre.slice(0, ancho + 1).lastIndexOf(" ");
  if (espacio <= 0) return [shorten(nombre, ancho)];
  return [nombre.slice(0, espacio), shorten(nombre.slice(espacio + 1), ancho)];
}

/** Ninguna letra del papel baja de este cuerpo (INF-28): ni las cifras de una casilla, ni los nombres, ni los números de columna. */
export const LETRA_MINIMA_DEL_PAPEL = 6;
/** Con más posiciones que estas, la matriz no escribe la cifra en cada casilla: queda el tono, con su escala, y debajo las diez parejas. */
export const POSICIONES_CON_CIFRA_EN_LA_CASILLA = 16;
/* El ancho medio de una letra de IBM Plex Sans, en fracción del cuerpo, por lo alto (el de la plantilla): para saber si una cifra cabe. */
const ANCHO_DE_LETRA_EN_LA_CASILLA = 0.56;

/**
 * Cómo se dispone una matriz de `n` posiciones en `ancho` puntos: el ancho de la columna de nombres, el lado de la casilla, el cuerpo de
 * los nombres y si las casillas llevan su cifra. Las llevan con 16 posiciones o menos y si lo que escriben cabe a 6 pt en la casilla
 * (`textos`: las líneas de cada casilla); si no, solo el tono. Es presentación: no cambia ninguna cifra.
 */
export function disposicionDeLaMatriz(n: number, ancho: number, textos: ReadonlyArray<readonly string[]>, casillaMaxima = 22) {
  const muchas = n > POSICIONES_CON_CIFRA_EN_LA_CASILLA;
  const labelW = muchas ? 132 : 168;
  const cell = Math.max(9, Math.min(casillaMaxima, (ancho - labelW - 4) / Math.max(1, n)));
  const cabe = (linea: string) => linea.length * LETRA_MINIMA_DEL_PAPEL * ANCHO_DE_LETRA_EN_LA_CASILLA <= cell - 2;
  const lineas = Math.max(1, ...textos.map((texto) => texto.length));
  const caben = textos.every((texto) => texto.every(cabe)) && lineas * (LETRA_MINIMA_DEL_PAPEL + 1) <= cell - 2;
  return { labelW, cell, letraDelNombre: muchas ? LETRA_MINIMA_DEL_PAPEL : 6.2, conCifras: !muchas && caben };
}

/**
 * Matriz con el nombre de cada posición en su fila y el número en la columna, en una sola tinta, la de la cartera: más oscuro, más alto.
 * `diverging`: −1…1 (correlación), de claro a oscuro de −1 a 1; si no, 0…100 (solapamiento). Con 16 posiciones o menos, y si cabe a 6 pt,
 * la cifra va escrita en la casilla; si no, la casilla lleva solo su tono, que ya dice la magnitud, y quien la usa pone su escala y las diez
 * parejas más altas con su cifra (INF-28). Ninguna letra baja de 6 pt.
 */
function NamedMatrix({ labels, numeros, values, width, diverging = false, format, dosLineas, casillaMaxima }: {
  labels: string[]; values: Array<Array<number | null>>; width: number; diverging?: boolean; format: (v: number) => string;
  /**
   * Lo que una casilla dice en dos líneas («al menos» y su cifra); si no, una, con `format`. Con `palabra`, la de abajo es una palabra
   * («sin comunes»): las dos van al mismo cuerpo, el mínimo (decisión 88).
   */
  dosLineas?: (v: number, i: number, j: number) => { lineas: [string, string]; palabra?: boolean } | null;
  /** El número de cada fila y columna: el de la posición, el mismo en todas las tablas. */
  numeros?: number[];
  /** El lado mayor de la casilla. Por defecto, 22; la de solapamiento pide más, porque escribe dos líneas. */
  casillaMaxima?: number;
}) {
  const n = labels.length;
  const ausente = textoDeAusencia("falta", { estrecha: true });
  const textoDe = (v: number | null, i: number, j: number): string[] => {
    if (v === null || !Number.isFinite(v)) return [ausente];
    return dosLineas?.(v, i, j)?.lineas ?? [format(v)];
  };
  const { labelW, cell, letraDelNombre, conCifras } = disposicionDeLaMatriz(n, width, values.flatMap((row, i) => row.map((v, j) => textoDe(v, i, j))), casillaMaxima);
  const top = 14;
  const height = top + n * cell + 2;
  const tono = (v: number) => {
    const fraccion = diverging ? (v + 1) / 2 : v / 100;
    return 0.06 + 0.84 * Math.min(1, Math.max(0, fraccion));
  };
  const oscura = (v: number) => tono(v) >= 0.58;
  const maxChars = Math.floor(labelW / 3.6);
  const cifraDeCasilla = LETRA_MINIMA_DEL_PAPEL;
  const letra = (tamano: number, tinta: string) => ({ fontFamily: FUENTE.sans, fontSize: Math.max(LETRA_MINIMA_DEL_PAPEL, tamano), fill: tinta });
  return (
    <Svg width={labelW + n * cell + 2} height={height} viewBox={`0 0 ${labelW + n * cell + 2} ${height}`}>
      {labels.map((_label, j) => (
        <TextoSvg key={`c${j}`} x={labelW + (j + 0.5) * cell} y={9} textAnchor="middle" style={letra(LETRA_MINIMA_DEL_PAPEL, PAPEL.tinta3)}>{String(numeros?.[j] ?? j + 1)}</TextoSvg>
      ))}
      {labels.flatMap((label, i) => {
        const numeroDeFila = `${numeros?.[i] ?? i + 1}  `;
        /* En dos líneas, si la fila da para ellas: un nombre no se corta a media palabra (decisión 42). */
        /* Los nombres son datos: pasan por el saneado de la plantilla, como todo `Texto` (INF-06). */
        const limpio = sanearTexto(label);
        const lineas = cell >= 15 ? enDosLineas(limpio, maxChars - numeroDeFila.length) : [shorten(limpio, maxChars - numeroDeFila.length)];
        return lineas.map((linea, l) => (
          <TextoSvg key={`r${i}-${l}`} x={labelW - 5} y={top + (i + 0.5) * cell + 2 + (lineas.length > 1 ? (l === 0 ? -3.4 : 3.4) : 0)} textAnchor="end" style={letra(letraDelNombre, PAPEL.tinta)}>{l === 0 ? `${numeroDeFila}${linea}` : linea}</TextoSvg>
        ));
      })}
      {values.flatMap((row, i) => row.map((v, j) => {
        const ok = v !== null && Number.isFinite(v);
        const partida = ok && conCifras ? dosLineas?.(v, i, j) ?? null : null;
        const tinta = ok && oscura(v) ? PAPEL.blanco : PAPEL.tinta;
        return (
          <G key={`${i}-${j}`}>
            {ok
              ? <Rect x={labelW + j * cell + 0.5} y={top + i * cell + 0.5} width={cell - 1} height={cell - 1} fill={SERIES.cartera} fillOpacity={tono(v)} />
              : <Rect x={labelW + j * cell + 0.5} y={top + i * cell + 0.5} width={cell - 1} height={cell - 1} fill="none" stroke={PAPEL.filete} strokeWidth={0.5} />}
            {!conCifras ? null : partida ? partida.lineas.map((trozo, linea) => (
              <TextoSvg key={linea} x={labelW + (j + 0.5) * cell} y={top + (i + 0.5) * cell - 1.5 + linea * (LETRA_MINIMA_DEL_PAPEL + 1)} textAnchor="middle"
                style={letra(LETRA_MINIMA_DEL_PAPEL, tinta)}>{trozo}</TextoSvg>
            )) : (
              <TextoSvg x={labelW + (j + 0.5) * cell} y={top + (i + 0.5) * cell + cifraDeCasilla * 0.36} textAnchor="middle"
                style={letra(cifraDeCasilla, ok ? tinta : PAPEL.tinta3)}>{ok ? format(v) : ausente}</TextoSvg>
            )}
          </G>
        );
      }))}
    </Svg>
  );
}

/*
 * La matriz de solapamiento escribe dos líneas por casilla («al menos» y la cifra), y a 6 pt «al menos» no cabe en la casilla de 22 de la
 * de correlación: la suya llega a 30, el mismo lado mínimo que la del informe de cliente. Con 12 fondos o más ya no cabe, y va solo el
 * tono, con su escala y las diez parejas con más solapamiento debajo.
 */
const CASILLA_DEL_SOLAPAMIENTO = 30;
const cifraDelSolapamiento = (v: number) => `${Math.round(v)}`;
const lineasDelSolapamiento = (v: number, i: number, j: number): { lineas: [string, string]; palabra?: boolean } | null => {
  if (i === j) return null;
  const { antes, cifra, palabra } = cotaDelSolapamiento(v);
  return { lineas: [antes, cifra.replace(/\s%$/u, "")], palabra };
};

/** Si una matriz de estas posiciones lleva la cifra en cada casilla: para decidir si debajo van su escala de tonos y las diez parejas. */
function matrizConCifras(n: number, values: Array<Array<number | null>>, textos: (v: number, i: number, j: number) => string[], casillaMaxima?: number): boolean {
  const ausente = textoDeAusencia("falta", { estrecha: true });
  return disposicionDeLaMatriz(n, ANCHO, values.flatMap((row, i) => row.map((v, j) => (v === null || !Number.isFinite(v) ? [ausente] : textos(v, i, j)))), casillaMaxima).conCifras;
}

/**
 * La escala de tonos de una matriz, con el mismo tono que sus casillas. Sin la cifra en cada casilla (INF-28), es lo que la lee: por eso
 * dice también cómo se ve una casilla sin dato.
 */
function EscalaDeTonos({ pasos, diverging, escribir, nota, sinCifras }: { pasos: readonly number[]; diverging: boolean; escribir: (v: number) => string; nota: string; sinCifras?: boolean }) {
  const tono = (v: number) => 0.06 + 0.84 * Math.min(1, Math.max(0, diverging ? (v + 1) / 2 : v / 100));
  return (
    <View style={{ flexDirection: "row", alignItems: "center", marginTop: 6 }}>
      <Texto style={[s.pequeno, { marginRight: 6 }]}>Escala</Texto>
      {pasos.map((v) => (
        <View key={v} style={{ alignItems: "center", marginRight: 2 }}>
          <Svg width={22} height={8}><Rect x={0} y={0} width={22} height={8} fill={SERIES.cartera} fillOpacity={tono(v)} /></Svg>
          <Texto style={{ fontSize: 6.6, color: PAPEL.tinta3 }}>{escribir(v)}</Texto>
        </View>
      ))}
      <Texto style={[s.pequeno, { marginLeft: 6, flex: 1 }]}>{`${nota}${sinCifras ? " Con borde y sin tono: falta el dato." : ""}`}</Texto>
    </View>
  );
}

function CorrelationScale({ sinCifras }: { sinCifras?: boolean }) {
  return (
    <EscalaDeTonos pasos={[-1, -0.75, -0.5, -0.25, 0, 0.25, 0.5, 0.75, 1]} diverging escribir={(v) => ratio(v) ?? ""} sinCifras={sinCifras}
      nota="Más oscuro: se mueven juntos. Más claro: en sentido contrario (diversifican)." />
  );
}

/* La palabra y sus umbrales (0,70 / 0,40 / 0,15) tienen una sola definición, en `core/palabraDeLaCorrelacion.ts` (INF-20). */
function correlationWord(v: number | null | undefined): string {
  return palabraDeLaCorrelacion(v) ?? FALTA;
}

function CorrelationSheet({ m }: { m: InternalReportModel }) {
  const name = (id: string) => m.positions.find((p) => p.assetId === id)?.name ?? id;
  const main = m.horizons.find((h) => h.correlation) ?? null;
  const pairRows = (pairs: Array<{ a: string; b: string; value: number }>) => pairs.map((p) => ({ ...p, key: `${p.a}-${p.b}` }));
  type Par = ReturnType<typeof pairRows>[number];
  const hi = main?.correlation?.highest[0];
  const lo = main?.correlation?.lowest[0];
  const orden = main?.correlation ? enOrdenDePosicion(m, main.correlation.ids, main.correlation.matrix) : null;
  const conCifrasLaCorrelacion = main?.correlation
    ? matrizConCifras((orden?.ids ?? main.correlation.ids).length, orden?.values ?? main.correlation.matrix, (v) => [ratio(v) ?? ""])
    : true;
  const conNumero = (id: string, max: number) => shorten(`${numeroDe(m, id)}  ${name(id)}`, max);
  const columnasDePares: Columna<Par>[] = [
    { titulo: "Par", ancho: 196, celda: (x) => ({ texto: conNumero(x.a, 43), apunte: conNumero(x.b, 51) }) },
    { titulo: "Correl.", ancho: 46, cifra: true, celda: (x) => ratioC(x.value) }
  ];
  return (
    <Sheet m={m} section="7 · Correlaciones">
      <SectionHead number="7" title="Correlaciones entre posiciones" lead="Correlación de los rendimientos semanales de cada par de posiciones, en las mismas semanas que la simulación histórica. Solo entran las posiciones con histórico en el periodo; las que quedaron fuera figuran en la sección 10." />
      {main?.correlation ? (
        <>
          <Reading lines={[
            `La correlación media entre posiciones a ${windowLabel(main.window)} es ${ratio(main.correlation.average)}: ${correlationWord(main.correlation.average)}. ${main.motivoSinCifra ? "Es solo de las posiciones que se miden: no dice nada de la cartera entera." : num(main.correlation.average) && main.correlation.average >= CORRELACION_ALTA ? "Las posiciones tienden a subir y bajar a la vez: la diversificación real es menor de lo que sugiere el número de fondos." : num(main.correlation.average) && main.correlation.average < CORRELACION_MEDIA ? "Las posiciones se compensan entre sí: la cartera diversifica de verdad." : "Hay diversificación, pero una parte de las posiciones comparte el mismo motor."}`,
            hi ? `El par que más se mueve junto es ${name(hi.a)} y ${name(hi.b)} (${ratio(hi.value)}).` : null,
            lo ? `El par que más diversifica es ${name(lo.a)} y ${name(lo.b)} (${ratio(lo.value)}).` : null
          ]} />
          <T style={[s.cuerpo, { marginTop: 4 }]}>{porVentanas(m.horizons.filter((h) => h.correlation), "Correlación media y par más correlacionado:", (h) => `${ratio(h.correlation?.average)} y ${ratio(h.correlation?.highest[0]?.value)}`)}</T>
          {/*
            * Con más de 16 posiciones la matriz no escribe la cifra de cada casilla (INF-28): esta columna da entonces las diez parejas que
            * más se mueven juntas, con su cifra, en vez de cinco. Va aquí y no debajo de la matriz: la matriz llena su hoja, y debajo la tabla
            * quedaba sola en una hoja al 29 % (INF-22).
            */}
          <View style={s.dosColumnas} wrap={false}>
            <View style={s.columna}>
              {conCifrasLaCorrelacion ? (
                <>
                  <H3>Pares que más se mueven juntos</H3>
                  <TablaDe columnas={columnasDePares} filas={pairRows(main.correlation.highest)} />
                </>
              ) : (
                <>
                  <H3>Las diez parejas más correlacionadas</H3>
                  <TablaDe columnas={columnasDePares} filas={pairRows(parejasMasAltas(main.correlation.ids, main.correlation.matrix, 10).map((p) => ({ a: p.a, b: p.b, value: p.valor })))} />
                </>
              )}
            </View>
            <View style={s.columna}>
              <H3>Pares que más diversifican</H3>
              <TablaDe columnas={columnasDePares} filas={pairRows(main.correlation.lowest)} />
            </View>
          </View>
          {/* La matriz, la última: si no cabe todo salta ella, que llena su hoja, y no quedan los pares solos en una (31 % con 10 y con 40 posiciones). */}
          <View wrap={false}>
            <H2>Matriz de correlación · {windowLabel(main.window)}{main.horizon.extensions.length > 0 ? " · estimado" : ""}</H2>
            <NamedMatrix labels={(orden?.ids ?? main.correlation.ids).map(name)} numeros={orden?.numeros} values={orden?.values ?? main.correlation.matrix} width={ANCHO} diverging format={(v) => ratio(v)} />
            <CorrelationScale sinCifras={!conCifrasLaCorrelacion} />
          </View>
        </>
      ) : <Texto style={s.cuerpo}>Sin matriz: el análisis del periodo no tiene al menos dos posiciones con histórico común.</Texto>}
    </Sheet>
  );
}

function OptimizationSheet({ m }: { m: InternalReportModel }) {
  const conFrontera = m.horizons.filter((h) => h.horizon.frontier);
  const lead = `Solo lectura: muestra ${conFrontera.length > 0 && conFrontera.every((h) => h.motivoSinCifra) ? "las combinaciones eficientes de los activos que se miden" : "dónde está la cartera frente a las combinaciones eficientes de sus mismos activos"}. Nada se aplica desde este informe; la única puerta para optimizar es Diseño de cartera.`;
  /* Sin propuesta calculada, una línea en su sección y no una hoja (hallazgo 116). */
  const sinPropuesta = m.improvement ? null : (
    <T style={[s.pequeno, { marginTop: 6 }]}>8.2 · Propuesta de mejora de fondos. No se ha calculado una propuesta para esta composición de cartera: se calcula en Diseño de cartera › Optimizar › «Buscar sustituciones».</T>
  );
  if (!conFrontera.length) {
    /* El motivo de cada ventana, una vez: suele ser el mismo. A una sola acción no le falta la frontera: no le aplica (decisión 83). */
    const motivos = [...new Set(m.horizons.map((h) => h.horizon.frontierUnavailableReason).filter(Boolean))].join(" ");
    const unaSolaAccion = m.positions.length === 1 && esAccion(m.positions[0].instrumentType);
    const fuera = notasDeLoQueNoEntra(m, m.horizons, false);
    return (
      <Sheet m={m} section="8.1 · Frontera eficiente">
        <SectionHead number="8.1" title="Frontera eficiente y carteras de referencia" lead={lead} />
        <T style={s.cuerpo}>{unaSolaAccion ? NO_APLICA : "Frontera no disponible"}. {motivos}{fuera ? ` ${fuera}` : ""}</T>
        {sinPropuesta}
      </Sheet>
    );
  }
  const frontera = (h: InternalHorizonModel) => h.horizon.frontier!;
  const pesoEn = (lista: Array<{ assetId: string; weight: number }> | undefined, id: string) => (lista ? lista.find((w) => w.assetId === id)?.weight ?? 0 : null);
  const ids = [...new Set(conFrontera.flatMap((h) => {
    const f = frontera(h);
    return [...(f.current?.weights ?? []), ...f.maxSharpe.weights, ...f.minVolatility.weights].map((w) => w.assetId);
  }))].sort((a, b) => numeroDe(m, a) - numeroDe(m, b));
  /* Por debajo del 80 % del peso la cartera no se sitúa en la frontera (decisión 59): ni su punto, ni su columna, ni lo que se le compara. */
  const conActual = conFrontera.filter((h) => !h.motivoSinCifra);
  /* Si las dos ventanas miden las mismas posiciones, el peso actual es uno solo. */
  const actualIgual = conActual.length > 0 && ids.every((id) => conActual.every((h) => pesoEn(frontera(h).current?.weights, id) === pesoEn(frontera(conActual[0]).current?.weights, id)));
  const a = (h: InternalHorizonModel) => ventanasEnTitulo([h]);
  const columnasDeCifra = conFrontera.length * 2 + (actualIgual ? 1 : conActual.length);
  const anchoDeCifra = columnasDeCifra > 3 ? 56 : 90;
  const anchoDeNombre = ANCHO - 16 - anchoDeCifra * columnasDeCifra;
  const mayorCambio = (h: InternalHorizonModel) => {
    const f = frontera(h);
    if (!f.current || h.motivoSinCifra) return null;
    const mayor = ids.map((id) => ({ id, actual: pesoEn(f.current?.weights, id) ?? 0, ms: pesoEn(f.maxSharpe.weights, id) ?? 0 }))
      .map((x) => ({ ...x, d: x.ms - x.actual })).sort((x, y) => Math.abs(y.d) - Math.abs(x.d))[0];
    return mayor && Math.abs(mayor.d) > 0.005 ? `en ${m.positions.find((p) => p.assetId === mayor.id)?.name ?? mayor.id}, de ${pesoT(mayor.actual)} a ${pesoT(mayor.ms)}` : null;
  };
  const fueraDeLaFrontera = [...new Set(conFrontera.flatMap((h) => frontera(h).excluded.map((e) => `${m.positions.find((p) => p.assetId === e.assetId)?.name ?? e.assetId} (${e.reasonLabel})`)))];
  const topes = conFrontera.map((h) => topeDelModelo(h.horizon));
  const titulo = `Frontera eficiente · ${ventanasEnTitulo(conFrontera)}`;
  const columnas: Columna<string>[] = [
    { titulo: "#", ancho: 16, celda: (id) => String(numeroDe(m, id)) },
    { titulo: "Posición", ancho: anchoDeNombre, celda: (id) => m.positions.find((p) => p.assetId === id)?.name ?? id },
    ...(actualIgual ? [{ titulo: "Actual", ancho: anchoDeCifra, cifra: true, celda: (id: string) => peso(pesoEn(frontera(conActual[0]).current?.weights, id)) }] : []),
    ...conFrontera.flatMap((h) => [
      ...(actualIgual || h.motivoSinCifra ? [] : [{ titulo: `Actual ${a(h)}`, ancho: anchoDeCifra, cifra: true, celda: (id: string) => peso(pesoEn(frontera(h).current?.weights, id)) }]),
      { titulo: `Máx. Sharpe ${a(h)}`, ancho: anchoDeCifra, cifra: true, celda: (id: string) => peso(pesoEn(frontera(h).maxSharpe.weights, id)) },
      { titulo: `Mín. vol. ${a(h)}`, ancho: anchoDeCifra, cifra: true, celda: (id: string) => peso(pesoEn(frontera(h).minVolatility.weights, id)) }
    ])
  ];
  return (
    <Sheet m={m} section={`8.1 · ${titulo}`}>
      <SectionHead number="8.1" title={titulo} lead={lead} />
      <LoQueMide m={m} ventanas={conFrontera} />
      <Reading lines={[
        ...lineasSinCifra(m, conFrontera, (anos, motivo) => `A ${anos} años la cartera no se sitúa en la frontera, que es solo de los activos medidos. ${motivo}`),
        porVentanas(conActual, "En el modelo de la frontera la cartera actual da:", (h) => {
          const cur = frontera(h).current;
          return cur ? `${pctSigned(cur.expectedReturn)} con ${pct(cur.volatility)} (medida en la simulación: ${pctSigned(h.horizon.backtest.metrics.cagr)} con ${pct(h.horizon.backtest.metrics.volatility)})` : null;
        }),
        porVentanas(conFrontera, conFrontera.some((h) => h.horizon.frontierNotSelectable?.length) ? "La de máximo Sharpe con los activos que se pueden comprar da en el modelo:" : "La de máximo Sharpe con los mismos activos da en el modelo:", (h) => `${pctSigned(frontera(h).maxSharpe.expectedReturn)} con ${pct(frontera(h).maxSharpe.volatility)}`),
        porVentanas(conFrontera, "El mayor cambio de peso hacia la cartera de máximo Sharpe:", mayorCambio),
        notasDeLoQueNoEntra(m, conFrontera, true),
        "Las carteras de la frontera se calculan con el histórico del periodo: conocen el resultado y no garantizan nada hacia delante."
      ]} />
      {/* Hasta 7 filas, gráficas y tabla caben en la hoja. Con más, la tabla pasa a la siguiente, y las gráficas no tienen por qué seguir pequeñas. */}
      <PorVentana ventanas={conFrontera}>{(h, ancho) => (
        <View>
          <RotuloDeVentana h={h} />
          <FrontierChart h={h} width={ancho} height={ids.length > 7 ? 150 : 96} />
        </View>
      )}</PorVentana>
      <Texto style={s.pie}>Eje horizontal: volatilidad anualizada · eje vertical: rentabilidad anualizada esperada.</Texto>
      {/* Con muchas filas el bloque no cabe en una hoja, y sin poder partirse @react-pdf lo aplastaba encima de lo de arriba (medido con 37 posiciones). */}
      <View wrap={ids.length > 20}>
        <H2>Pesos de cada cartera</H2>
        <TablaConCola columnas={columnas} filas={ids} clave={(id) => id} cola={colaDeLaTabla(ids.length)}
          alPie={<>
            <T style={s.pie}>{fueraDeLaFrontera.length ? `Fuera de la frontera: ${fueraDeLaFrontera.join("; ")}. Los pesos son sobre la parte medida. ` : ""}{topes.every((x) => x !== null) ? `Tope por posición en el modelo: ${topes.every((x) => x === topes[0]) ? pct(topes[0], 0) : conFrontera.map((h, i) => `${pct(topes[i], 0)} a ${h.horizon.years} años`).join(" y ")}, según el número de activos.` : ""}</T>
            {sinPropuesta}
          </>} />
      </View>
    </Sheet>
  );
}

/**
 * La frontera de la simulación solo usa lo que se puede comprar (decisión de Óscar, 15-11-2026): lo medido que queda fuera, con
 * la misma frase que la pantalla. Suele ser lo mismo en las dos ventanas, y entonces se dice una vez. Sin ninguno, `null`.
 */
export function notasDeLoQueNoEntra(
  m: Pick<InternalReportModel, "positions">, ventanas: readonly Pick<InternalHorizonModel, "horizon">[], hayFrontera: boolean
): string | null {
  const nombreDe = (id: string) => m.positions.find((p) => p.assetId === id)?.name ?? id;
  const notas = [...new Set(ventanas.map((h) => notaDeLoQueNoEntraEnLaFrontera(h.horizon, nombreDe, { hayFrontera })).filter((x): x is string => !!x))];
  if (notas.length <= 1) return notas[0] ?? null;
  return ventanas.map((h) => {
    const nota = notaDeLoQueNoEntraEnLaFrontera(h.horizon, nombreDe, { hayFrontera });
    return nota ? `A ${h.horizon.years} años: ${nota}` : null;
  }).filter(Boolean).join(" ");
}

/** Detrás de la nota del Máximo Sharpe: qué no lleva porque no se puede comprar. Vacío si no hay nada apartado. */
function sinLoApartado(m: Pick<InternalReportModel, "positions">, ventanas: readonly Pick<InternalHorizonModel, "horizon">[]): string {
  const nombreDe = (id: string) => m.positions.find((p) => p.assetId === id)?.name ?? id;
  const frases = [...new Set(ventanas.filter((h) => h.horizon.maxSharpe).map((h) => fraseDelMaximoSinLoQueNoSePuedeComprar(h.horizon, nombreDe)).filter(Boolean))];
  return frases.length ? ` ${frases.join(" ")}` : "";
}

/** FMT-19: el día en que se calculó la propuesta, en el calendario de quien genera el informe (y no el de Greenwich). `zona`, para las pruebas. */
export function diaDeLaPropuesta(savedAt: string | null | undefined, zona?: string): string | null {
  return savedAt ? diaLocal(savedAt, zona) : null;
}

/** Decisión 8.6 (13-10-2026): la propuesta de «Mejorar cartera» entra solo en el informe interno, como última subsección de Optimización. */
function ImprovementSheet({ m }: { m: InternalReportModel }) {
  const n = "8.2";
  /* Como la pantalla y el PDF de la mejora (7245443a): el último tercio filtra las candidatas, no es una prueba fuera de la muestra. */
  const lead = "Fondos equivalentes que sustituirían a los actuales con los mismos pesos, elegidos en los dos primeros tercios de la ventana y filtrados con el último, que decide entre hasta 50 candidatas: ese tramo no es una prueba fuera de la muestra. Solo lectura: la propuesta se revisa y se aplica desde Diseño de cartera.";
  const stored = m.improvement;
  /* Sin propuesta, lo dice una línea al final de la frontera. */
  if (!stored) return null;
  const r = stored.response;
  const proposal = r.proposals[stored.proposalIndex] ?? r.proposals[0];
  const original = r.original;
  const name = (id: string) => stored.assets[id]?.name ?? m.positions.find((p) => p.assetId === id)?.name ?? id;
  const ter = (id: string) => { const v = stored.assets[id]?.ongoingCharge; return typeof v === "number" && Number.isFinite(v) ? v : null; };
  const statusLabel = IMPROVEMENT_STATUS_LABELS[r.status];
  const calculada = diaDeLaPropuesta(stored.savedAt);
  const when = calculada ? ` · calculada el ${fechaT(calculada)}` : "";
  const windows = r.windows;
  const sameClass = proposal?.substitutions.filter((sub) => sub.same_fund_class) ?? [];
  const metricRows = proposal && original ? [
    { key: "cagr", label: "Rentabilidad anualizada", before: original.metrics.confirmation.cagr, after: proposal.metrics.confirmation.cagr, kind: "rent" as const, lower: false },
    { key: "vol", label: "Volatilidad anual", before: original.metrics.confirmation.volatility, after: proposal.metrics.confirmation.volatility, kind: "pct" as const, lower: true },
    { key: "sharpe", label: "Sharpe", before: original.metrics.confirmation.sharpe, after: proposal.metrics.confirmation.sharpe, kind: "num" as const, lower: false },
    { key: "mdd", label: "Caída máxima", before: original.metrics.confirmation.max_drawdown, after: proposal.metrics.confirmation.max_drawdown, kind: "pct" as const, lower: false },
    { key: "cost", label: "Coste corriente medio", before: original.weighted_cost, after: proposal.weighted_cost, kind: "pct" as const, lower: true },
    { key: "sel", label: "Rentabilidad anualizada (ventana de selección)", before: original.metrics.selection.cagr, after: proposal.metrics.selection.cagr, kind: "rent" as const, lower: false }
  ] : [];
  type FilaDeMetrica = (typeof metricRows)[number];
  const fmtMetric = (v: number | null | undefined, kind: FilaDeMetrica["kind"]): CeldaDeTabla => (kind === "rent" ? rentabilidad(v) : kind === "pct" ? porcentaje(v) : numero(v, { decimales: 2 }));
  /* Verde si la propuesta mejora la medida, rojo si la empeora: el signo de lo que cambia para el cliente. */
  const mejora = (row: FilaDeMetrica): Signo | null => {
    if (typeof row.before !== "number" || typeof row.after !== "number") return null;
    const d = row.after - row.before;
    if (Math.abs(d) < 1e-9) return "neutro";
    return (row.lower ? d < 0 : d > 0) ? "sube" : "baja";
  };
  const fmtDelta = (row: FilaDeMetrica): CeldaDeTabla => {
    if (typeof row.before !== "number" || typeof row.after !== "number") return null;
    const d = row.after - row.before;
    return { texto: row.kind === "num" ? numero(d, { decimales: 2, conSigno: true }) : puntos(d), signo: mejora(row) };
  };
  const costRow = metricRows.find((x) => x.key === "cost");
  const sharpeRow = metricRows.find((x) => x.key === "sharpe");
  type Sustitucion = NonNullable<typeof proposal>["substitutions"][number];
  type Criterio = NonNullable<typeof proposal>["validation"][number];
  const difDeCoste = (sub: Sustitucion): CeldaDeTabla => {
    const antes = ter(sub.from_asset_id);
    const despues = ter(sub.to_asset_id);
    if (antes === null || despues === null) return null;
    return { texto: puntos(despues - antes), signo: despues < antes ? "sube" : despues > antes ? "baja" : "neutro" };
  };
  return (
    <Sheet m={m} section={`${n} · Propuesta de mejora`}>
      <SectionHead number={n} title="Propuesta de mejora de fondos" lead={lead} />
      <T style={[s.cuerpo, { marginTop: 6 }]}>{statusLabel}{when}. {cifrasEnPantalla(textoEnPantalla(improvementSummary(r)))}</T>
      {proposal && original ? (
        <>
          <Reading lines={[
            `${proposal.substitutions.length} ${proposal.substitutions.length === 1 ? "sustitución propuesta" : "sustituciones propuestas"}${sameClass.length ? `, ${sameClass.length} de ellas cambio de clase del mismo fondo` : ""}.`,
            costRow && typeof costRow.before === "number" && typeof costRow.after === "number" ? `El coste corriente medio pasaría del ${pct(costRow.before)} al ${pct(costRow.after)} (${ppT(costRow.after - costRow.before)}).` : null,
            sharpeRow && typeof sharpeRow.before === "number" && typeof sharpeRow.after === "number" ? `En la ventana de confirmación el Sharpe pasaría de ${ratio(sharpeRow.before)} a ${ratio(sharpeRow.after)}.` : null
          ]} />
          <H2>Sustituciones propuestas</H2>
          <TablaDe
            columnas={[
              { titulo: "#", ancho: 14, celda: (sub: Sustitucion) => String(numeroDe(m, sub.from_asset_id) || "") },
              { titulo: "Fondo actual", ancho: 150, celda: (sub: Sustitucion) => ({ texto: sub.from_name || name(sub.from_asset_id), apunte: sub.from_asset_id }) },
              { titulo: "Sustituto", ancho: 160, celda: (sub: Sustitucion) => ({ texto: sub.to_name || name(sub.to_asset_id), apunte: sub.to_asset_id }) },
              { titulo: "Peso", ancho: 42, cifra: true, celda: (sub: Sustitucion) => peso(sub.weight) },
              { titulo: "Correl.", ancho: 42, cifra: true, celda: (sub: Sustitucion) => numero(sub.correlation, { decimales: 2 }) },
              { titulo: "Dif. coste", ancho: 54, cifra: true, celda: difDeCoste },
              { titulo: "Tipo", ancho: 50, celda: (sub: Sustitucion) => (sub.same_fund_class ? "Otra clase" : "Sustitución") }
            ]}
            filas={proposal.substitutions} />
          {sameClass.length ? <Texto style={s.pie}>Los cambios de clase del mismo fondo no cuentan en el máximo de sustituciones.</Texto> : null}
          <H2>Antes y después en la ventana de confirmación</H2>
          <TablaDe
            columnas={[
              { titulo: "Medida", ancho: 211, celda: (row: FilaDeMetrica) => row.label },
              { titulo: "Cartera actual", ancho: 100, cifra: true, celda: (row: FilaDeMetrica) => fmtMetric(row.before, row.kind) },
              { titulo: "Propuesta", ancho: 100, cifra: true, celda: (row: FilaDeMetrica) => fmtMetric(row.after, row.kind) },
              { titulo: "Diferencia", ancho: 100, cifra: true, celda: fmtDelta }
            ]}
            filas={metricRows} />
          <T style={s.pie}>Verde: la propuesta mejora la medida (más rentabilidad o Sharpe, menos volatilidad o coste). Rojo: la empeora.{notaDeAcciones(m)}</T>
          <H2>Validación</H2>
          <TablaDe
            columnas={[
              { titulo: "Resultado", ancho: 80, celda: (c: Criterio) => (c.status === "PASS" ? "Cumple" : c.status === "FAIL" ? "No cumple" : "No evaluable") },
              { titulo: "Criterio", ancho: 431, celda: (c: Criterio) => cifrasEnPantalla(textoEnPantalla(`${c.label}${c.detail ? ` · ${c.detail}` : ""}`)) }
            ]}
            filas={proposal.validation} />
          {proposal.substitutions.map((sub) => {
            const eq = stored.equivalence[`${sub.from_asset_id}:${sub.to_asset_id}`];
            return eq ? <T key={`eq-${sub.from_asset_id}`} style={[s.pequeno, { marginTop: 3 }]}>{sub.from_name || name(sub.from_asset_id)} por {sub.to_name || name(sub.to_asset_id)}: {VERDICT_LABELS[eq.verdict]}. {eq.reason}{eq.differing.length ? ` Difieren: ${eq.differing.join("; ")}.` : ""}{eq.missing.length ? ` Sin dato: ${eq.missing.join("; ")}.` : ""}</T> : null;
          })}
        </>
      ) : (
        <T style={s.cuerpo}>{cifrasEnPantalla(r.reason ?? "")}{r.best_rejected ? ` Mejor combinación evaluada: ${r.best_rejected.substitutions.map((sub) => `${sub.from_name} por ${sub.to_name}`).join("; ")}; no cumple ${cifrasEnPantalla(r.best_rejected.failed.join(", "))}.` : ""}</T>
      )}
      <Note>
        {windows ? `Selección ${t(periodo(windows.selection.first_date, windows.selection.last_date))} (${windows.selection.weeks} semanas); confirmación ${t(periodo(windows.confirmation.first_date, windows.confirmation.last_date))} (${windows.confirmation.weeks} semanas). ` : ""}
        Medido en semanal y en euros, pesos fijos al inicio de cada ventana{r.risk_free ? `, tipo sin riesgo${tipoDeRespaldo(r) !== null ? " de respaldo" : ""} ${pct(r.risk_free.risk_free_rate)}` : ""}. Solo fondos por fondos; las retrocesiones no intervienen. Resultados históricos: no garantizan el comportamiento futuro.
        {stored.skipped.length ? ` Sin alternativa: ${stored.skipped.map((item) => `${name(item.asset_id)} (${item.reason})`).join("; ")}.` : ""}
      </Note>
    </Sheet>
  );
}

function CostsSheet({ m }: { m: InternalReportModel }) {
  const income = m.positions.reduce((sum, p) => sum + (p.retroIncomeEur ?? 0), 0);
  const costliest = [...m.positions].filter((p) => p.costEur !== null).sort((a, b) => (b.costEur ?? 0) - (a.costEur ?? 0))[0];
  const bestRetro = [...m.positions].filter((p) => p.retroIncomeEur !== null).sort((a, b) => (b.retroIncomeEur ?? 0) - (a.retroIncomeEur ?? 0))[0];
  const generated = new Date(m.generatedAt).getTime();
  const stale = m.positions.filter((p) => p.retroAsOf && (generated - new Date(p.retroAsOf).getTime()) / 86400000 > 365).length;
  /* Sin capital no hay columnas en euros; lo dice una vez la primera hoja. */
  const conCapital = m.totalCapital !== null;
  const columnas: Columna<InternalPositionRow>[] = [
    { titulo: "#", ancho: 16, celda: (r) => String(numeroDe(m, r.assetId)) },
    { titulo: "Posición", ancho: conCapital ? 258 : 464, celda: (r) => r.name },
    { titulo: "Peso", ancho: 44, cifra: true, celda: (r) => peso(r.weight) },
    ...(conCapital ? [{ titulo: "Importe", ancho: 70, cifra: true, celda: (r: InternalPositionRow) => importe(r.amount) }] : []),
    { titulo: "Coste corriente", ancho: 52, cifra: true, celda: terDe },
    { titulo: "Comisión gestión", ancho: 56, cifra: true, celda: (r) => (esAccion(r.instrumentType) ? NO_APLICA : porcentaje(r.managementFee)) },
    ...(conCapital ? [{ titulo: "Coste €/año", ancho: 66, cifra: true, celda: (r: InternalPositionRow) => (esAccion(r.instrumentType) ? NO_APLICA : importe(r.costEur)) }] : []),
    { titulo: "Retrocesión", ancho: 60, cifra: true, celda: retroDe },
    { titulo: "Vigencia retro.", ancho: 62, celda: vigenciaDe },
    ...(conCapital ? [{ titulo: "Ingreso €/año", ancho: 70, cifra: true, celda: ingresoDe }] : [])
  ];
  const ingresoTotal: CeldaDeTabla = soloAcciones(m) ? NO_APLICA : m.retro.status === "ok" && num(m.retro.annualIncomeEur) ? (m.retro.parcial ? `${importe(income)} parcial` : importe(income)) : null;
  return (
    <Sheet m={m} section="9 · Costes y comercial" orientation="landscape">
      <SectionHead number="9" title="Costes y comercial" lead={`Coste corriente y retrocesión de cada posición${m.totalCapital ? ", con el ingreso anual estimado sobre el importe actual" : ""}. Información interna: no aparece en ningún documento de cliente.`} />
      <Reading lines={[
        m.totalCapital === null || soloAcciones(m) ? null : (num(m.costs.annualCostEur)
          ? `${m.costs.missing > 0 ? `Costes corrientes identificados: unos ${eur(m.costs.annualCostEur)} al año (${pct(m.costs.weightedTer)} medio sobre el ${pct(m.costs.terCoverage, 0)} del peso con dato; el resto falta)` : `El cliente paga unos ${eur(m.costs.annualCostEur)} al año en costes corrientes (${pct(m.costs.weightedTer)} de media)`}${costliest ? `; la posición más cara es ${costliest.name} (${eur(costliest.costEur)})` : ""}.`
          : `Coste corriente medio ${pct(m.costs.weightedTer)}.`) + notaDeAcciones(m),
        m.retro.status === "ok" && num(m.retro.annualIncomeEur) && m.totalCapital && !soloAcciones(m) ? `Retrocesión estimada${m.retro.parcial ? ", parcial" : ""}: ${eur(income)} al año (${retroMediaDe(m)} medio sobre el ${pesoConRetro(m)}${m.retro.parcial ? `; un ${pct(m.retro.sobreLaCartera)} de toda la cartera` : ""})${bestRetro ? `; la que más aporta, ${bestRetro.name} (${eur(bestRetro.retroIncomeEur)})` : ""}.` : m.retro.status === "denied" ? "Esta cuenta no tiene acceso a la base de retrocesiones: la columna sale vacía, no a cero." : null,
        stale ? `${stale} ${stale === 1 ? "retrocesión tiene" : "retrocesiones tienen"} más de un año de antigüedad: conviene confirmarlas antes de usarlas.` : null
      ]} />
      <T style={[s.pequeno, { marginBottom: 4 }]}>
        {soloAcciones(m) ? "A una acción no le aplica la retrocesión. " : m.retro.status === "ok" ? `Retrocesión media sobre el ${pesoConRetro(m)}; sin registro no cuenta como cero.${m.costs.stocks > 0 ? " A una acción no le aplica." : ""} ` : m.retro.status === "denied" ? "Sin acceso a la base de retrocesiones (solo administradores). " : "No se pudieron leer las retrocesiones. "}
        {soloAcciones(m) ? "Una acción no tiene coste corriente." : `${conCapital ? "Coste anual = coste corriente × importe; media" : "Media"} sobre el ${pct(m.costs.terCoverage, 0)} del peso con dato. No incluye costes de operación. ${LO_QUE_NO_INCLUYE_EL_COSTE}${accionesACero(m)}`}
      </T>
      <TablaConCola columnas={columnas} filas={m.positions} clave={(r) => r.assetId} densa cola={colaDeLaTabla(m.positions.length)}
        total={["", "Total", peso(1), ...(conCapital ? [importe(m.totalCapital)] : []), costeParcial(m) ? `${costeMedioDe(m)} parcial` : costeMedioDe(m), "",
          ...(conCapital ? [soloAcciones(m) ? NO_APLICA : costeParcial(m) && num(m.costs.annualCostEur) ? `${importe(m.costs.annualCostEur)} parcial` : importe(m.costs.annualCostEur)] : []),
          m.retro.parcial ? `${retroMediaDe(m)} parcial` : m.retro.weightedRetroPct === null && !soloAcciones(m) ? null : retroMediaDe(m), "", ...(conCapital ? [ingresoTotal] : [])]}
        alPie={costeParcial(m) || m.retro.parcial ? (
          <>
            {costeParcial(m) ? <T style={s.pie}>El coste corriente{conCapital ? " y el coste anual son parciales" : " es parcial"}, no de toda la cartera: {costeMedioDe(m)} medio sobre el {pct(m.costs.terCoverage, 0)} del peso con dato; el resto falta.</T> : null}
            {m.retro.parcial ? <T style={s.pie}>Retrocesión e ingreso son parciales, no de toda la cartera: {retroParcial(m)}.</T> : null}
          </>
        ) : null} />
    </Sheet>
  );
}

function QualitySheet({ m }: { m: InternalReportModel }) {
  const flagText = (flags: string[]) => (flags.length ? flags.map((f) => QUALITY_FLAG_LABELS[f] ?? readableBackendLabel(f)).join(" · ") : "Sin avisos");
  const backtestText = (p: InternalPositionRow) => {
    /* El mismo motivo en las dos ventanas se dice una vez (decisión 80). */
    if (p.inBacktest["3Y"] === "excluded" && p.inBacktest["5Y"] === "excluded" && p.exclusionReason["3Y"] === p.exclusionReason["5Y"]) return `3 y 5 años fuera (${p.exclusionReason["3Y"]})`;
    return (["3Y", "5Y"] as const).map((w) => {
      const st = p.inBacktest[w];
      if (!st) return null;
      return `${windowLabel(w)} ${st === "included" ? "dentro" : st === "extended" ? "con tramo estimado" : `fuera (${p.exclusionReason[w]})`}`;
    }).filter(Boolean).join(" · ");
  };
  const withFlags = m.positions.filter((p) => p.qualityFlags.length).length;
  const fueraDelAnalisis = m.positions.filter((p) => Object.values(p.inBacktest).some((st) => st === "excluded"));
  const excluded = fueraDelAnalisis.length;
  /* Una ficha sin avisos puede quedarse fuera por su serie: se dice quién y por qué, y «Sin avisos» habla solo de la ficha. */
  const motivoDeFuera = (p: InternalPositionRow) => {
    const ventanas = (["3Y", "5Y"] as const).filter((w) => p.inBacktest[w] === "excluded");
    const motivos = [...new Set(ventanas.map((w) => p.exclusionReason[w]))];
    return `${p.name} (${pesoT(p.weight)}): ${motivos.length === 1 ? motivos[0] : ventanas.map((w) => `${windowLabel(w)}, ${p.exclusionReason[w]}`).join("; ")}`;
  };
  const extended = m.positions.filter((p) => Object.values(p.inBacktest).some((st) => st === "extended")).length;
  const noHoldings = m.positions.filter((p) => !p.holdingsAsOf && !esAccion(p.instrumentType)).length;
  const columnas: Columna<InternalPositionRow>[] = [
    { titulo: "#", ancho: 16, celda: (r) => String(numeroDe(m, r.assetId)) },
    { titulo: "Posición", ancho: 190, celda: (r) => r.name },
    { titulo: "Cobertura", ancho: 74, celda: (r) => COVERAGE_LABELS[r.coverageStatus] ?? readableBackendLabel(r.coverageStatus) },
    { titulo: "Métricas", ancho: 90, celda: (r) => ({ texto: methodShort(r.metodoDeLaFicha), apunte: origenDeLasMetricas(r.metricsFrequency, readableBackendLabel) }) },
    { titulo: "Riesgo", ancho: 70, celda: (r) => (r.sri !== null ? `${Math.round(r.sri)} · ${origenDelRiesgo(r.sriSource, readableBackendLabel) ?? "fuente que falta"}` : seEnsenaLaMetrica("indicadorDeRiesgo", r.instrumentType) ? null : NO_APLICA) },
    { titulo: "Cartera subyacente", ancho: 84, celda: (r) => ({ texto: r.holdingsAsOf ? fecha(r.holdingsAsOf) : esAccion(r.instrumentType) ? NO_APLICA : null, apunte: r.holdingsCount !== null ? rotuloDePosiciones(r.holdingsCount) : null }) },
    { titulo: "En el análisis del periodo", ancho: 130, celda: (r) => backtestText(r) || null },
    { titulo: "Avisos de la ficha", ancho: 104, celda: (r) => flagText(r.qualityFlags) }
  ];
  return (
    <Sheet m={m} section="10 · Calidad y trazabilidad" orientation="landscape">
      <SectionHead number="10" title="Calidad y trazabilidad del dato" lead="De dónde sale cada cifra, qué cubre y qué ha quedado fuera. Lo que no cuadre aquí no debería enseñarse al cliente sin revisarlo." />
      <Reading lines={[
        withFlags ? `${withFlags} de ${m.positions.length} posiciones tienen avisos de calidad en la ficha.` : "Ninguna ficha trae avisos de calidad.",
        excluded || extended ? `${excluded ? `Fuera de algún análisis del periodo, por su serie: ${fueraDelAnalisis.map(motivoDeFuera).join("; ")}` : ""}${excluded && extended ? ". " : ""}${extended ? `${extended} ${extended === 1 ? "se amplía" : "se amplían"} con una referencia validada antes de su lanzamiento` : ""}.` : "Todas las posiciones entran en los análisis del periodo con su histórico completo.",
        noHoldings ? `${noHoldings} ${noHoldings === 1 ? "posición no publica" : "posiciones no publican"} cartera: no cuentan en subyacentes, solapamiento ni mapa geográfico.` : soloAcciones(m) ? null : m.costs.stocks > 0 ? "Todos los fondos y ETF publican cartera." : "Todas las posiciones publican cartera.",
        m.costs.stocks > 0 ? `${m.costs.stocks === 1 ? "1 acción en directo: suma" : `${m.costs.stocks} acciones en directo: suman`} en subyacentes como línea propia, y en solapamiento no aplica.` : null
      ]} />
      <TablaConCola columnas={columnas} filas={m.positions} clave={(r) => r.assetId} densa cola={colaDeLaTabla(m.positions.length)} alPie={<>
        {m.horizons.length ? <View style={{ height: 8 }} /> : null}
        {m.horizons.map((h) => (
          <View key={h.window} wrap={false}>
            <T style={s.cuerpo}>
              Análisis a {windowLabel(h.window)}: cobertura {pesoEnElPapel(h.horizon.coverageWeightPercent)} del peso · {num(h.horizon.backtest.coverage?.included_assets) && num(h.horizon.backtest.coverage?.requested_assets) ? `${h.horizon.backtest.coverage.included_assets} de ${h.horizon.backtest.coverage.requested_assets} ${h.horizon.backtest.coverage.requested_assets === 1 ? "posición" : "posiciones"}` : `posiciones medidas: ${FALTA.toLocaleLowerCase("es")}`} · {num(h.horizon.backtest.coverage?.measured_observations) ? `${h.horizon.backtest.coverage.measured_observations} observaciones semanales` : `observaciones semanales: ${FALTA.toLocaleLowerCase("es")}`} · tipo sin riesgo {h.horizon.backtest.risk_free?.risk_free_rate_policy === "STATIC_FALLBACK" ? "estático (sin serie €STR)" : "€STR medio de la ventana"} · {versionDeLaReferencia(h.horizon.referenceVersion)}
            </T>
            {h.horizon.extensions.map((e) => (
              <T key={e.assetId} style={s.pequeno}>
                {m.positions.find((p) => p.assetId === e.assetId)?.name ?? e.assetId}: historia estimada {t(periodo(e.estimatedFrom, e.estimatedUntil))} con {e.reference} (validación {e.validationWeeks} semanas, correlación {ratio(e.holdoutCorrelation)}, volatilidad residual {pct(e.residualVolatility)}); observada desde {fechaT(e.observedFrom)}.
              </T>
            ))}
            {/* El tipo estático ya lo dice la línea de arriba, en palabras. */}
            {h.horizon.backtest.warnings.filter((w) => w !== "RISK_FREE_RATE_STATIC_FALLBACK").length ? <T style={s.pequeno}>Avisos: {h.horizon.backtest.warnings.filter((w) => w !== "RISK_FREE_RATE_STATIC_FALLBACK").map(readableBackendLabel).join(" · ")}</T> : null}
          </View>
        ))}
      </>} />
      {Object.entries(m.horizonErrors).map(([w, e]) => e ? <T key={w} style={s.cuerpo}>Análisis a {windowLabel(w)}: no disponible ({e}).</T> : null)}
      {m.feasibility && (m.feasibility.blocking_issues.length || m.feasibility.warnings.length) ? (
        <View wrap={false}>
          <H2>Factibilidad de restricciones</H2>
          {[...m.feasibility.blocking_issues, ...m.feasibility.warnings].map((issue, i) => <T key={i} style={s.cuerpo}>· {textoEnPantalla(issue.message)}</T>)}
        </View>
      ) : null}
      {m.reportWarnings.length ? (
        <View wrap={false}>
          <H2>Avisos del informe de cartera</H2>
          {m.reportWarnings.map((w, i) => <T key={i} style={s.pequeno}>· {w}</T>)}
        </View>
      ) : null}
    </Sheet>
  );
}

/** El tope se escribe el que ha aplicado el motor en esta cartera: la tabla entera vive en `functions_python/optimization/robust_engine.py`. */
function topesAplicados(m: InternalReportModel): string {
  const topes = m.horizons.filter((h) => h.horizon.frontier).map((h) => ({ anos: h.horizon.years, tope: topeDelModelo(h.horizon) }));
  if (!topes.length) return "";
  if (topes.some((x) => x.tope === null)) return " El tope por posición lo fija el motor según el número de activos.";
  const iguales = topes.every((x) => x.tope === topes[0].tope);
  return ` El tope por posición lo fija el motor según el número de activos: aquí, ${iguales ? pct(topes[0].tope, 0) : topes.map((x) => `${pct(x.tope, 0)} a ${x.anos} años`).join(" y ")}.`;
}

const METHOD_ROWS: Array<[string, string]> = [
  ["Análisis del periodo", "Simulación histórica de la aplicación: serie conjunta de la cartera actual con los pesos de hoy sobre el histórico común de 3 o 5 años. Se dibuja en diario y se mide en semanal (última observación de cada semana, ×52). Las posiciones sin histórico completo quedan fuera o, si existe una referencia validada, se amplían antes de su lanzamiento; ambas cosas se detallan en la sección 10."],
  ["Rentabilidad, volatilidad, Sharpe y caída máxima", "Las de la simulación histórica de la aplicación, idénticas a las del informe de cliente. Sharpe con el €STR medio de la ventana; si el BCE no responde, con un tipo estático, y la sección 6.2 dice cuál. La caída máxima se mide sobre la serie diaria."],
  ["Sortino y Calmar", "Sortino: (rentabilidad anualizada − tipo sin riesgo) / desviación bajista semanal anualizada. Calmar: rentabilidad anualizada / |caída máxima|."],
  ["Medidas frente a la referencia", "La referencia es una mezcla de dos fondos, renta fija global (IE00B18GC888) y renta variable global (IE00B03HCZ61), calculada con sus series y con los pesos fijados el primer día de cada ventana, sin reequilibrar, igual que la cartera, que parte de los pesos de hoy. Se comparan solo las fechas con dato de las dos, hasta la última común, sin arrastrar ningún valor. Sobre esas semanas: beta y correlación de los rendimientos semanales, tracking error (desviación de la diferencia × raíz de 52), rentabilidad activa, ratio de información, alfa de Jensen anualizada con el €STR, y capturas alcista y bajista (rendimiento medio de la cartera en semanas de subida o bajada de la referencia entre el de la referencia)."],
  ["VaR y CVaR", "Históricos sobre los rendimientos semanales del periodo, sin supuestos de normalidad. El VaR es el rendimiento semanal en el percentil indicado; el CVaR, la media de las semanas peores. En euros, sobre el capital que mide la serie. Solo al 95 %: al 99 % harían falta casi diez años de semanas para que la cola tuviera más de un par de datos, así que se da la peor semana del periodo, que es lo que ese percentil sería."],
  ["Años naturales, móviles y episodios", "Rentabilidad de cada año desde el cierre del anterior (marcado * si el periodo no cubre el año entero); ventanas móviles de 52 semanas; los tres episodios de caída más profundos, sin solaparse, sobre la serie diaria."],
  ["Cono estadístico", "Fórmula lognormal cerrada, sin sorteos: la mediana crece al tipo sin riesgo de la ventana, el mismo de su Sharpe, y la dispersión es la volatilidad semanal del periodo medido, sin reequilibrios ni aportaciones. Se muestran los percentiles 5, 50 y 95 de cada fecha, y no se dibuja si falta ese tipo. En euros, sobre el capital que mide la serie. Solo enseña la dispersión: no es una simulación ni una previsión."],
  ["Concentración", "HHI sobre los pesos y número efectivo de posiciones (1/HHI)."],
  /* Sin decir de cuántos puntos es la frontera (T12, 06-11-2026): el motor pide 40 (`PUNTOS_DE_LA_FRONTERA`), los reparte entre los tramos de la
     curva y quita los repetidos, y la que se dibuja en el 8.1 lleva menos: con la muestra, 19 y 12 en la base nueva. */
  ["Contribución al riesgo y frontera", "Del motor de optimización de la aplicación, sobre las mismas semanas: rentabilidades esperadas ajustadas hacia la media de los activos, covarianza regularizada, frontera eficiente y carteras de mínima volatilidad y máximo Sharpe. Por eso el modelo y la serie dan cifras distintas de la misma cartera, y la de máximo Sharpe, medida luego con la serie, puede quedar por debajo de la actual."],
  ["Composición y solapamiento", "Composición declarada del informe de cartera; subyacentes agregados de las carteras publicadas (cobertura indicada); solapamiento como suma de mínimos de los pesos reales de los títulos comunes de cada par de fondos, sin reescalar, y por eso es un mínimo: «al menos»; no cuentan derivados, sus contrapartidas ni efectivo, cuando el dato los distingue. Solo si de los dos se ha recibido al menos la mitad de la cartera, sumando el peso de sus líneas con su signo. Se escribe «más de 100 %» cuando los dos fondos invierten más que su patrimonio, con efectivo en negativo o con derivados. Geografía de la renta variable: regiones publicadas por cada fondo; lo que no nos consta queda como «No declarado», y una acción va entera a la zona de su región."],
  ["Costes y retrocesiones", "Coste corriente y comisión de gestión de la ficha; coste anual = coste corriente × importe. Retrocesión de la base comercial (solo administradores); ingreso estimado = retrocesión × importe. Un fondo o un ETF sin dato no se cuenta como cero. Una acción no tiene coste corriente: en su fila no aplica, y en la media cuenta como cero. Tampoco tiene retrocesión: no aplica, y no cuenta como dato que falta."]
];

const GLOSSARY: Array<[string, string]> = [
  ["Rentabilidad anualizada", "Crecimiento medio por año que, compuesto, lleva del valor inicial al final del periodo."],
  ["Rentabilidad activa", "Cartera menos referencia, al año."],
  ["Volatilidad", "Desviación típica anualizada de los rendimientos: cuánto oscila la cartera alrededor de su media."],
  ["Caída máxima", "Peor pérdida entre un máximo y el mínimo posterior antes de volver a superar ese máximo."],
  ["Sharpe", "Rentabilidad por encima del tipo sin riesgo por cada unidad de volatilidad. Sirve para ordenar lo que se ha medido con la misma escala."],
  ["Sortino", "Como el Sharpe, pero solo cuenta como riesgo la volatilidad de las semanas negativas."],
  ["Calmar", "Rentabilidad anualizada dividida por la caída máxima: cuánto se gana por cada punto de pérdida máxima soportada."],
  ["Beta", "Sensibilidad a la referencia: con beta 1,2, cuando la referencia sube un 1 % la cartera tiende a subir un 1,2 %."],
  ["Tracking error", "Desviación anualizada de la diferencia de rendimientos con la referencia: cuánto se separa de ella."],
  ["Ratio de información", "Rentabilidad activa por unidad de tracking error: si la separación de la referencia ha compensado."],
  ["Alfa de Jensen", "Rentabilidad que no se explica por la exposición a la referencia (beta) ni por el tipo sin riesgo."],
  ["Captura alcista / bajista", "Qué porcentaje de las subidas (o bajadas) de la referencia recoge la cartera. Ideal: alta alcista, baja bajista."],
  ["VaR / CVaR", "Pérdida semanal que solo se supera en el 5 % de las semanas; el CVaR es la pérdida media de esas semanas."],
  ["Nº efectivo de posiciones", "A cuántas posiciones de igual peso equivale la cartera (1/HHI). Cuanto más lejos del número real, más concentrada."],
  ["Correlación", "De −1 a 1: cuánto se mueven dos series a la vez. Alta entre fondos significa que diversifican poco entre sí."],
  ["Solapamiento", "Porcentaje de cartera que dos fondos tienen en común, sumando el menor peso de cada valor compartido. Solo se ve lo que publican: es un mínimo."],
  ["Equiponderada", "Los mismos activos a partes iguales, sin los que no se pueden comprar (la misma regla que la frontera)."],
  ["Frontera eficiente", "Conjunto de combinaciones de los mismos activos que dan la máxima rentabilidad para cada nivel de riesgo, con el histórico del periodo."],
  ["Coste corriente", "Gastos corrientes anuales del fondo sobre el patrimonio; es lo que el cliente paga cada año dentro del valor liquidativo."],
  ["Retrocesión", "Parte de la comisión de gestión que la gestora cede al distribuidor. Dato comercial interno; nunca se enseña al cliente."],
  ["SRI", "Indicador del KID de PRIIPs, de 1 a 7."],
  ["SRRI", "Indicador del antiguo KIID de UCITS, de 1 a 7. Otra escala: un 6 de SRRI no es un 6 de SRI."]
];

function MethodSheet({ m }: { m: InternalReportModel }) {
  return (
    <Sheet m={m} section="11 · Metodología y glosario">
      <SectionHead number="11" title="Metodología y glosario" lead="Cómo se calcula cada cifra del documento y qué significa cada término, para responder con precisión cuando el cliente pregunte." />
      <H2>Metodología</H2>
      {METHOD_ROWS.map(([title, text]) => (
        <View key={title} style={{ marginBottom: 4 }} wrap={false}>
          <Texto style={s.h3}>{title}</Texto>
          <T style={s.cuerpo}>{text}{title === "Contribución al riesgo y frontera" ? topesAplicados(m) : ""}</T>
        </View>
      ))}
      <H2>Glosario</H2>
      {GLOSSARY.map(([term, text]) => (
        <View key={term} style={s.glosarioFila} wrap={false}>
          <Texto style={s.glosarioTermino}>{term}</Texto>
          <Texto style={s.glosarioTexto}>{text}</Texto>
        </View>
      ))}
      {/* El texto legal, una vez y al final: aquí, pegado a la nota, o al final del anexo si lo hay. */}
      <View wrap={false}>
        <Note>Simulación histórica de la cartera actual: no es la rentabilidad obtenida por el cliente ni una previsión. Documento interno de trabajo del asesor; no constituye recomendación ni evaluación de idoneidad.</Note>
        {m.includeAssetSheets ? null : <AvisoLegal />}
      </View>
    </Sheet>
  );
}

/** El indicador de riesgo de una posición, con de dónde sale: «SRI del KID: 2», «SRRI: 6», «Estimado por volatilidad: 4». Sin origen, no se le pone. */
function riesgoDeLaFicha(p: InternalPositionRow): string {
  if (!seEnsenaLaMetrica("indicadorDeRiesgo", p.instrumentType)) return `Indicador de riesgo: ${NO_APLICA}`;
  if (p.sri === null) return `Indicador de riesgo: ${FALTA}`;
  const origen = origenDelRiesgo(p.sriSource, readableBackendLabel);
  return origen ? `${origen}: ${Math.round(p.sri)}` : `Indicador de riesgo: ${Math.round(p.sri)}`;
}

/**
 * Lo que sigue a «Cobertura: X del peso con vector de exposición;» bajo la mezcla de activos. A-203 (21-11-2026): lo que no lo trae
 * ya no se reparte todo por su clase —un fondo sin reparto declarado va en su fila, «Falta el dato»—, y la frase dice las tres partes.
 */
function pieDeLaMezcla(cobertura: number | null, sinReparto: number, fueraPct: number, cubreLoQueEntra: boolean): string {
  const fuera = fueraPct > 0 ? `el ${pesoT(fueraPct / 100)} queda fuera del reparto` : null;
  const sinDato = sinReparto >= 0.0005 ? `el ${pesoT(sinReparto)} no declara su reparto (${FALTA.toLocaleLowerCase("es")})` : null;
  const porSuClase = cobertura !== null && cobertura + sinReparto + fueraPct / 100 < 0.9995 ? "la inversión directa sin vector cuenta por su clase económica" : null;
  if (!sinDato) return fueraPct <= 0 ? "el resto se reparte por su clase económica." : cubreLoQueEntra ? `${fuera}.` : `lo que no lo trae se reparte por su clase económica, y ${fuera}.`;
  const partes = [porSuClase, sinDato, fuera].filter((parte): parte is string => parte !== null);
  return `${partes.slice(0, -1).join("; ")}${partes.length > 1 ? "; y " : ""}${partes[partes.length - 1]}.`;
}

/** «Exposición: RV 0 % · RF 0 % · liquidez 0 %» es cierto del oro y no dice lo que tiene: si casi todo está fuera de esas tres, se escribe (decisión 80). */
function exposicionDeLaFicha(p: InternalPositionRow): string {
  /* Sin mezcla en su ficha, el reparto es el de su clase: tres cifras dirían que la base las trae (revisión final, V3-1). */
  if (p.exposicionPorSuClase) return `Exposición: por su clase (${classLabel(p.assetClass)}), sin dato declarado`;
  /* A-203: un fondo sin reparto declarado ya no se reparte por su clase; tres ceros dirían que no tiene nada. */
  if (p.exposicionSinDato) return `Exposición: ${FALTA}`;
  const tres = `Exposición: RV ${pct(p.equity, 0)} · RF ${pct(p.fixedIncome, 0)} · liquidez ${pct(p.cash, 0)}`;
  if (!num(p.otherExposure) || p.otherExposure < 0.5) return tres;
  const rotulo = ["EQUITY", "FIXED_INCOME", "MONEY_MARKET"].includes(p.assetClass) ? "otros" : classLabel(p.assetClass).toLocaleLowerCase("es");
  return `${tres} · ${rotulo} ${pct(p.otherExposure, 0)}`;
}

function AssetSheets({ m }: { m: InternalReportModel }) {
  if (!m.includeAssetSheets) return null;
  type Ventana = { label: string; r: number | null; v: number | null; sh: number | null };
  return (
    <Sheet m={m} section="A · Anexo · fichas">
      <SectionHead number="A" title="Anexo · ficha de cada posición" lead="Datos de la ficha de cada activo tal y como están en la base: métricas por ventana, costes, riesgo, composición y cartera publicada." />
      {m.positions.map((p, indice) => {
        const ultima = indice === m.positions.length - 1;
        const asset = m.assetsById.get(p.assetId);
        const mt = asset?.metrics;
        const w = (label: string, r?: number, v?: number, sh?: number): Ventana => ({ label, r: r ?? null, v: v ?? null, sh: sh ?? null });
        const windows = [
          w("1 año", mt?.annualized_return_1y, mt?.volatility_1y, mt?.sharpe_1y),
          w("3 años", mt?.annualized_return_3y, mt?.volatility_3y, mt?.sharpe_3y),
          w("5 años", mt?.annualized_return_5y, mt?.volatility_5y, mt?.sharpe_5y),
          w("10 años", mt?.annualized_return_10y, mt?.volatility_10y, mt?.sharpe_10y)
        ];
        return (
          <View key={p.assetId} wrap={false}>
          <View style={{ marginTop: 9, paddingBottom: 7, borderBottomWidth: 0.75, borderBottomColor: PAPEL.filete }}>
            <View style={{ flexDirection: "row", alignItems: "baseline" }}>
              <T style={[s.h2Texto, { flex: 1 }]}>{numeroDe(m, p.assetId)} · {p.name}</T>
              <T style={{ fontSize: M.tabla.celda, fontWeight: 600 }}>Peso {pesoT(p.weight)}</T>
            </View>
            <T style={s.pequeno}>{p.fueraDelCatalogo ? `${p.assetId} · ${FUERA_DEL_CATALOGO}` : `${p.assetId} · ${classLabel(p.assetClass)} · ${typeLabel(p.instrumentType)} · ${p.currency}${p.category ? ` · ${p.category}` : ""}${p.region ? ` · ${regionLegible(p.region)}` : ""}`}</T>
            <View style={[s.dosColumnas, { marginTop: 4 }]}>
              <View style={{ width: 250 }}>
                <TablaConCola densa clave={(x) => x.label}
                  columnas={[
                    { titulo: "Ventana", ancho: 52, celda: (x: Ventana) => x.label },
                    { titulo: "Rentabilidad anualizada", ancho: 70, cifra: true, celda: (x: Ventana) => celdaRent(x.r) },
                    { titulo: "Volatilidad", ancho: 64, cifra: true, celda: (x: Ventana) => porcentaje(x.v) },
                    { titulo: "Sharpe", ancho: 64, cifra: true, celda: (x: Ventana) => sharpeDePosicion(p.instrumentType, x.sh) }
                  ]}
                  filas={windows} />
              </View>
              <View style={s.columna}>
                <T style={s.cuerpo}>{riesgoDeLaFicha(p)} · coste corriente {t(terDe(p))} · gestión {esAccion(p.instrumentType) ? NO_APLICA : pct(p.managementFee)} · retrocesión {t(retroDe(p))}</T>
                <T style={s.cuerpo}>En lo que va de año {pctSigned(mt?.ytd_return)} · caída máxima 5 años {pct(p.maxDrawdown5y)} · histórica {pct(mt?.max_drawdown_hist?.value)}{mt?.max_drawdown_hist?.date ? ` (${fechaT(mt.max_drawdown_hist.date)})` : ""}</T>
                <T style={s.cuerpo}>{exposicionDeLaFicha(p)}</T>
                {esAccion(p.instrumentType)
                  ? <Texto style={s.cuerpo}>Cartera: no aplica, es una acción.</Texto>
                  : <T style={s.cuerpo}>Cartera según la fuente: {p.holdingsCount !== null ? rotuloDePosiciones(p.holdingsCount) : `${FALTA} de posiciones`} · 10 mayores {pesoT(p.top10Weight !== null ? p.top10Weight / 100 : null)} · {p.holdingsAsOf ? fechaT(p.holdingsAsOf) : `fecha: ${FALTA}`}</T>}
                <T style={s.pequeno}>Métricas: {metricsMethodLabel(p.metodoDeLaFicha ?? undefined)} · actualizado {p.updatedAt ? fechaT(p.updatedAt) : FALTA} · {p.qualityFlags.length ? p.qualityFlags.map((f) => QUALITY_FLAG_LABELS[f] ?? readableBackendLabel(f)).join(" · ") : "sin avisos"}</T>
              </View>
            </View>
          </View>
          {/* El texto legal, una vez y al final, pegado a la última ficha: no se queda solo en una hoja. */}
          {ultima ? <AvisoLegal /> : null}
          </View>
        );
      })}
    </Sheet>
  );
}

function InternalReportDoc({ model, identidad }: { model: InternalReportModel; identidad: IdentidadDelAsesor }) {
  return (
    <DocumentoDeInforme tema="interno" documento={DOCUMENTO} titulo={`Informe completo - ${model.portfolioName}`} asunto="Uso interno del asesor" identidad={identidad}>
      <PaginasDeLasSecciones.Provider value={new Map()}>
        <CoverSheet m={model} />
        <SummarySheet m={model} />
        <PositionsSheet m={model} />
        <CompositionSheet m={model} />
        <UnderlyingSheet m={model} />
        <PerformanceSheets m={model} />
        <RiskOverviewSheet m={model} />
        <RiskSheets m={model} />
        <CorrelationSheet m={model} />
        <OptimizationSheet m={model} />
        <ImprovementSheet m={model} />
        <CostsSheet m={model} />
        <QualitySheet m={model} />
        <MethodSheet m={model} />
        <AssetSheets m={model} />
      </PaginasDeLasSecciones.Provider>
    </DocumentoDeInforme>
  );
}

export function buildInternalReportModelWithLabels(input: InternalReportInput): InternalReportModel {
  return buildInternalReportModel(input, {
    classLabels: CLASS_LABELS,
    typeLabels: TYPE_LABELS,
    sectorLabels: EQUITY_BREAKDOWN_LABELS,
    metricsMethodLabel
  });
}

/**
 * Documento en memoria: permite comprobar el PDF en las pruebas sin navegador. Firma la identidad del asesor (`leerIdentidad()`), o la que
 * se le dé: sin ningún dato, la cabecera queda sin membrete.
 */
export async function createInternalPortfolioReportPdfBlob(input: InternalReportInput, identidad: IdentidadDelAsesor = firmaDelInforme()): Promise<Blob> {
  const elemento: ReactElement = <InternalReportDoc model={buildInternalReportModelWithLabels(input)} identidad={identidad} />;
  return renderizarInforme(elemento);
}

/**
 * Dibuja el informe interno y lo descarga. `puedeDescargar` se pregunta con el documento ya dibujado y justo antes de
 * ofrecerlo: el informe lleva retrocesiones, y si en esos segundos se activó el Modo cliente (en esta pestaña o en otra)
 * se descarta y no se descarga (H2-05). Devuelve si se descargó.
 */
export async function downloadInternalPortfolioReportPdf(input: InternalReportInput, puedeDescargar: () => boolean = () => true): Promise<boolean> {
  /* El documento se dibuja con todo ya cargado. Si la referencia no llega, sale igual y dice que no está. */
  const { seriesDeReferenciaOAusencia } = await import("../adapters/seriesDeReferencia");
  const referencia = input.referencia !== undefined ? input.referencia : await seriesDeReferenciaOAusencia();
  const blob = await createInternalPortfolioReportPdfBlob({ ...input, referencia });
  if (!puedeDescargar()) return false;
  descargar(blob, nombreDelFicheroDelInterno(input));
  return true;
}

/** «Informe interno de la propuesta - Propuesta García - 2026-11-14.pdf»: el documento, la propuesta y el día de generación que imprime. */
export function nombreDelFicheroDelInterno(input: Pick<InternalReportInput, "report" | "generatedAt">): string {
  return nombreDelFichero({ documento: DOCUMENTO, de: input.report.portfolio_name?.trim() || null, fecha: diaDelDocumento(input.generatedAt) });
}
