/* eslint-disable react-refresh/only-export-components */
/**
 * La comparativa de propuestas, en la plantilla única (tema cliente). Todas las diferencias se expresan como B − A.
 *
 * Las mismas partes que las seis hojas del 10-11-2026 (decisión de Óscar, «Sí, con las cinco»), sin la hoja de portada: la
 * presentación con las diferencias, el coste y la lectura; la evolución; el riesgo; la composición y la concentración; las
 * posiciones; y qué se mide de cada cartera, con su anexo. Las tablas repiten su cabecera si saltan de hoja.
 *
 * Aquí no hay «la cartera» y «la referencia»: A y B son dos series en orden, A en el color de la primera (el granate del tema) y B en el de la segunda (marino)
 * de la segunda (`SERIES` de la plantilla), en las líneas, el mapa y las barras. Las cifras van en tinta: el color de una
 * rentabilidad es el de su signo.
 */
import { G, Line, Circle, Svg, Text as TextoDeSvg, View } from "@react-pdf/renderer";
import type { BacktestSeriesPoint } from "../adapters/backtestPortfolioBackend";
import { lecturaDelCapital } from "../core/capitalDeLaComparativa";
import { descargar, hoy, nombreDelFichero } from "../core/descargaDeFicheros";
import { cuantos, fecha, fechaLarga, numero, oFalta, peso, porcentaje, puntos, ratio, rentabilidad, signoDe } from "../core/formato";
import { PESO_MINIMO_MEDIDO_PCT } from "../core/medidaDeLaCartera";
import { motivoDeQueNoAplique } from "../core/metricasPorInstrumento";
import { comparisonMetrics } from "../core/portfolioComparison";
import { pesoEnElPapel } from "../core/parteMedida";
import { comparisonConcentration, comparisonDrawdown, comparisonYearReturns, validateComparisonHistory, type ComparisonPositionRow } from "../core/portfolioComparisonReport";
import { FUERA_DEL_REPARTO } from "../core/repartoDelPapel";
import { NO_DECLARADO, SIN_SITUAR } from "../core/etiquetasDeReparto";
import { deQueVanNetasLasRentabilidades, mediaDelCoste, type CostesDeLaCartera } from "../core/mediaDelCoste";
import { LO_QUE_NO_INCLUYE_EL_COSTE } from "../core/portfolioCosts";
import { GEO_AREAS } from "../charts/worldMapGeo";
import { buildReportGeography } from "../core/repartoDelInforme";
import { textoDeAusencia } from "../core/textoDeAusencia";
import { fraseDelTipoDeRespaldo } from "../core/tipoDeRespaldo";
import { firmaDelInforme } from "./firmaDelInforme";
import { Apunte, Subtitulo } from "./textosDelInforme";
import {
  Aviso,
  AvisoLegal,
  CifrasDestacadas,
  DocumentoDeInforme,
  FUENTE,
  GraficoDeLineas,
  HojasDeSecciones,
  MEDIDAS,
  Nota,
  PAPEL,
  Parrafo,
  Presentacion,
  Tabla,
  Texto,
  TRAZO_LARGO,
  colorDeSerie,
  renderizarInforme,
  type CeldaDeTabla,
  type FilaDeTabla,
  type SeccionDeInforme,
  type SerieDeLineas
} from "./plantilla";

export interface ComparePdfMetrics {
  posiciones: number;
  ret?: number;
  vol?: number;
  sharpe?: number;
  maxdd?: number;
}
type AllocationRow = { label: string; a: number; b: number };
export type RentaVariableDeUnaCartera = { filas: Array<{ key: string; weight_percent: number }>; pesoPct: number };
export interface ComparePdfInput {
  nameA: string;
  nameB: string;
  a: ComparePdfMetrics;
  b: ComparePdfMetrics;
  maxddLabel?: string;
  periodLabel?: string;
  methodology?: string[];
  history?: { a: BacktestSeriesPoint[]; b: BacktestSeriesPoint[]; rangeLabel: string };
  classRows: AllocationRow[];
  categoryRows?: AllocationRow[];
  /**
   * La renta variable de cada cartera por región, mirando dentro de los fondos (`computeEquityRegionAllocation`): las filas, en % de su renta
   * variable, y cuánto pesa la renta variable en la cartera. Se agrupan con las zonas y los nombres del informe de cliente. Sin el campo, falta.
   */
  rentaVariable?: { a: RentaVariableDeUnaCartera; b: RentaVariableDeUnaCartera };
  /** Los costes de cada cartera (`calculatePortfolioCosts`, el coste corriente de la ficha). Sin el campo, el coste falta. */
  costes?: { a: CostesDeLaCartera; b: CostesDeLaCartera };
  /** Si entre las dos hay algún fondo: de qué van netas las rentabilidades. */
  hayFondos?: boolean;
  /** Lo que se mide de cada cartera, con las palabras del informe de cliente (`loQueSeMideDe`). Sin el campo, se dice con las cifras de `coverage`. */
  queSeMide?: { a: string; b: string };
  /** El cliente, para la cabecera («Preparado para…»), y quien lo elabora, para el membrete: solo si llegan. */
  clientName?: string;
  banker?: { name?: string; email?: string };
  positions?: ComparisonPositionRow[];
  riskFree?: number | null;
  coverage?: { a: { weight: number; included: number; total: number }; b: { weight: number; included: number; total: number } };
  extendedHistory?: boolean;
  sample?: boolean;
  /** Lo que mide esa cartera es una sola acción: su Sharpe no se imprime (§9 del método; decisión 41). */
  sharpeNoAplica?: { a: boolean; b: boolean };
  /** Por qué esa cartera no da cifras (decisión 59): la simulación mide menos del 80 % de su peso. Null o sin campo: las da. */
  sinCifra?: { a: string | null; b: string | null };
  /** El capital fijado en cada cartera. Sin él no se imprime ningún importe (decisión 42), y una no toma prestado el de la otra. */
  capitalA?: number | null;
  capitalB?: number | null;
  /** Lo que no entra en los repartos de cada cartera, con su nombre y su peso (decisión 85). Null o sin campo: entra todo. */
  fueraDelReparto?: { a: string | null; b: string | null };
  /** El tipo fijo con que se ha calculado el Sharpe, si no se pudo leer el €STR (decisión 89). Null o sin campo: se leyó. */
  tipoDeRespaldo?: number | null;
}

const DOCUMENTO = "Comparativa de propuestas";
/* A y B, dos series en orden: la primera en el granate del tema, la segunda en marino. */
const COLOR_A = colorDeSerie(0);
const COLOR_B = colorDeSerie(1);
const NO_APLICA = textoDeAusencia("no-aplica");
const FALTA = textoDeAusencia("falta");
const finite = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);
const difference = (a?: number | null, b?: number | null) => finite(a) && finite(b) ? b - a : null;
/** La diferencia B − A en puntos porcentuales. `sonPesos`: llegan en puntos (40 es un 40 %), no en fracción. */
const pp = (a?: number | null, b?: number | null, sonPesos = false) => { const d = difference(a, b); return oFalta(puntos(d === null ? null : sonPesos ? d / 100 : d)); };
/** Una rentabilidad, con el color de su signo. */
const conSigno = (fraccion: number | null | undefined): CeldaDeTabla => ({ texto: rentabilidad(fraccion), signo: signoDe(fraccion, 4) });

/**
 * Una diferencia entre dos porcentajes dentro de una frase: en «pp» y con dos decimales, como en las tablas (`puntos` del módulo común),
 * pero sin el signo, que lo dicen «más» o «menos». Así la frase y la tabla de al lado escriben la misma cifra igual: «1,74 pp».
 */
const ppEnFrase = (diferencia: number) => oFalta(puntos(Math.abs(diferencia))).replace(/^\+/, "");
/** Lo que redondea a 0,00 pp se dice «lo mismo»: con dos decimales, por debajo de media centésima de punto. */
const esLaMisma = (diferencia: number) => Math.abs(diferencia) * 100 < 0.005;

/**
 * Las diferencias de la portada en una frase: «B rindió 8,20 puntos porcentuales (pp) más al año que A, osciló 5,60 pp más y su caída
 * máxima fue 7,70 pp más honda.» En «pp» y con dos decimales, como la tabla de riesgo (14-11-2026; sustituye a la regla de un decimal del 10-11-2026). Lo que
 * redondea a 0,00 se dice igual. Null si falta la rentabilidad o la volatilidad de alguna.
 */
export function diferenciasEnFrases(
  a: Pick<ComparePdfMetrics, "ret" | "vol" | "maxdd">,
  b: Pick<ComparePdfMetrics, "ret" | "vol" | "maxdd">,
  /* Con menos de un año común `ret` es la rentabilidad del periodo, sin anualizar, y la frase no dice «al año» (15-11-2026). */
  { enElPeriodo = false }: { enElPeriodo?: boolean } = {}
): string | null {
  const ret = difference(a.ret, b.ret), vol = difference(a.vol, b.vol), caida = difference(a.maxdd, b.maxdd);
  if (ret === null || vol === null) return null;
  /* La unidad va escrita entera la primera vez que sale, con su abreviatura, y abreviada después: es un documento para el
     cliente, y una sigla que no conoce se le escribe entera (apartado 6 de SISTEMA_DISENO.md). */
  let yaDicha = false;
  const pp = (diferencia: number) => {
    const cifra = ppEnFrase(diferencia);
    if (yaDicha) return cifra;
    yaDicha = true;
    return cifra.replace(/pp$/, "puntos porcentuales (pp)");
  };
  const cuando = enElPeriodo ? "en el periodo" : "al año";
  const rinde = esLaMisma(ret) ? `B rindió lo mismo ${cuando} que A` : `B rindió ${pp(ret)} ${ret > 0 ? "más" : "menos"} ${cuando} que A`;
  const oscila = esLaMisma(vol) ? "osciló lo mismo" : `osciló ${pp(vol)} ${vol > 0 ? "más" : "menos"}`;
  /* La caída es negativa: si la de B es menor (más negativa), es más honda. «Caída máxima», como en la tabla (INF-18). */
  const cae = caida === null ? null : esLaMisma(caida) ? "su caída máxima fue igual de honda" : `su caída máxima fue ${pp(caida)} ${caida < 0 ? "más" : "menos"} honda`;
  return cae ? `${rinde}, ${oscila} y ${cae}.` : `${rinde} y ${oscila}.`;
}

/**
 * El coste corriente medio de cada cartera y su diferencia, con las palabras del informe de cliente (`mediaDelCoste`). La diferencia solo si
 * hay media de las dos; si de una no la hay, se dice de cuál. En «pp» y con dos decimales, como toda diferencia entre dos porcentajes.
 */
export function costesEnFrases(costes: ComparePdfInput["costes"]): { a: string; b: string; diferencia: string; completa: boolean } {
  const a = mediaDelCoste(costes?.a), b = mediaDelCoste(costes?.b);
  const sinMedia = [a.tasa === null ? "A" : null, b.tasa === null ? "B" : null].filter(Boolean);
  const diferencia = a.tasa !== null && b.tasa !== null
    ? (esLaMisma(b.tasa - a.tasa) ? "Las dos cuestan lo mismo al año." : `B cuesta ${ppEnFrase(b.tasa - a.tasa)} ${b.tasa > a.tasa ? "más" : "menos"} al año que A.`)
    : `Sin la media de ${sinMedia.length === 2 ? "ninguna de las dos" : sinMedia[0]} no se da una diferencia.`;
  return { a: a.texto, b: b.texto, diferencia, completa: a.completa || b.completa };
}

/** La renta variable de cada cartera por región, agrupada en las zonas del informe de cliente (`buildReportGeography`), con sus nombres. */
export function filasDeRentaVariable(rv: NonNullable<ComparePdfInput["rentaVariable"]>): Array<{ label: string; a: number | null; b: number | null }> {
  const deUna = (cartera: RentaVariableDeUnaCartera) => {
    if (!(cartera.pesoPct > 0.05)) return null;
    const { totals, noDeclarado, sinSituar } = buildReportGeography(cartera.filas, true);
    const filas = new Map<string, number>();
    for (const area of GEO_AREAS) if ((totals[area.id] ?? 0) > 0.05) filas.set(area.label, totals[area.id]);
    if (noDeclarado > 0.05) filas.set(NO_DECLARADO, noDeclarado);
    if (sinSituar > 0.05) filas.set(SIN_SITUAR, sinSituar);
    return filas;
  };
  const a = deUna(rv.a), b = deUna(rv.b);
  const etiquetas = [...new Set([...(a?.keys() ?? []), ...(b?.keys() ?? [])])];
  const alFinal = (etiqueta: string) => (etiqueta === NO_DECLARADO || etiqueta === SIN_SITUAR ? 1 : 0);
  return etiquetas
    .map((label) => ({ label, a: a ? a.get(label) ?? 0 : null, b: b ? b.get(label) ?? 0 : null }))
    .sort((x, y) => alFinal(x.label) - alFinal(y.label) || Math.max(y.a ?? 0, y.b ?? 0) - Math.max(x.a ?? 0, x.b ?? 0));
}
const short = (value: string, max = 100) => value.length > max ? `${value.slice(0, max - 1)}…` : value;

// Anexo de cobertura: las notas llegan como `${cartera}: …` o `${cartera} · …`. Se agrupan por cartera
// (quitando el prefijo); el anexo va al final del método.
type AnnexItem = { heading?: string; text: string };
export function coverageAnnexItems(input: Pick<ComparePdfInput, "nameA" | "nameB" | "methodology">): AnnexItem[] {
  const notes = input.methodology?.length ? input.methodology : ["No se han facilitado notas adicionales de cobertura."];
  if (input.nameA === input.nameB) return notes.map((text) => ({ text }));
  const owners = [{ key: "A", name: input.nameA }, { key: "B", name: input.nameB }];
  const byLength = [...owners].sort((x, y) => y.name.length - x.name.length);
  const groups = new Map<string, string[]>([["", []], ["A", []], ["B", []]]);
  for (const note of notes) {
    const owner = byLength.find((o) => note.startsWith(`${o.name}: `) || note.startsWith(`${o.name} · `));
    if (owner) groups.get(owner.key)!.push(note.slice(owner.name.length).replace(/^(:| ·)\s*/, ""));
    else groups.get("")!.push(note);
  }
  const grouped = owners.some((o) => groups.get(o.key)!.length > 0);
  if (!grouped) return notes.map((text) => ({ text }));
  const items: AnnexItem[] = [];
  const general = groups.get("")!;
  if (general.length) items.push({ heading: "Notas generales", text: general[0] }, ...general.slice(1).map((text) => ({ text })));
  for (const o of owners) {
    const own = groups.get(o.key)!;
    if (!own.length) continue;
    items.push({ heading: `${o.key} · ${short(o.name, 85)}`, text: own[0] }, ...own.slice(1).map((text) => ({ text })));
  }
  return items;
}
export function annexPages(items: AnnexItem[], size = 22): AnnexItem[][] {
  const pages: AnnexItem[][] = [];
  let rest = items;
  while (rest.length) {
    let cut = Math.min(size, rest.length);
    // Un título cuenta como una línea más; si la hoja queda llena de títulos, cede sitio.
    const headings = rest.slice(0, cut).filter((i) => i.heading).length;
    cut = Math.max(1, Math.min(cut, size - headings));
    pages.push(rest.slice(0, cut)); rest = rest.slice(cut);
  }
  return pages;
}

/* ------------------------------------------------------------------------------------------------ Las piezas propias */

/**
 * Qué es A y qué es B, con su trazo: la leyenda de las hojas que dibujan o comparan las dos. Sin línea, lo dice. B va a trazos largos, la
 * misma muestra que su línea en el gráfico: impreso en gris, A y B no se distinguen solo por el color (INF-09).
 */
function Nombres({ input, sinLinea, conTrazo = true }: { input: ComparePdfInput; sinLinea?: { a: boolean; b: boolean }; conTrazo?: boolean }) {
  return (
    <View style={{ flexDirection: "row", marginTop: 2, marginBottom: 6 }}>
      {[{ name: input.nameA, color: COLOR_A, key: "A", falta: sinLinea?.a, trazo: undefined }, { name: input.nameB, color: COLOR_B, key: "B", falta: sinLinea?.b, trazo: TRAZO_LARGO }].map((p) => (
        <View key={p.key} style={{ flex: 1, flexDirection: "row", alignItems: "flex-start", paddingRight: 10 }}>
          <Svg width={16} height={8} style={{ marginTop: 2.5 }}>
            {p.falta || !conTrazo ? null : <Line x1={0} x2={14} y1={4} y2={4} stroke={p.color} strokeWidth={2} strokeDasharray={p.trazo} />}
          </Svg>
          <Texto style={{ flex: 1, fontSize: MEDIDAS.seccion.procedencia, color: PAPEL.tinta2, lineHeight: 1.35 }}>{`${p.key} · ${short(p.name, 85)}${p.falta ? ` · ${FALTA}` : ""}`}</Texto>
        </View>
      ))}
    </View>
  );
}

/**
 * Una línea por cartera sobre las mismas fechas; la que no tiene cifra va vacía y no se dibuja, pero conserva su color. B, a trazos largos
 * (INF-09), y la leyenda del gráfico con la misma muestra.
 */
export function seriesDeLaEvolucion(a: BacktestSeriesPoint[] | null, b: BacktestSeriesPoint[] | null): { fechas: string[]; series: SerieDeLineas[] } {
  const fechas = (a?.length ? a : b ?? []).map((p) => p.date);
  const valores = (serie: BacktestSeriesPoint[] | null) => (serie?.length ? serie.map((p) => p.value) : fechas.map(() => null));
  return { fechas, series: [{ nombre: "A", valores: valores(a) }, { nombre: "B", valores: valores(b), aTrazosLargos: true }] };
}

function Evolucion({ a, b, formato, formatoDelEje, alto }: { a: BacktestSeriesPoint[] | null; b: BacktestSeriesPoint[] | null; formato: (v: number) => string | null; formatoDelEje: (v: number) => string | null; alto: number }) {
  const { fechas, series } = seriesDeLaEvolucion(a, b);
  return <GraficoDeLineas fechas={fechas} series={series} formato={formato} formatoDelEje={formatoDelEje} alto={alto} />;
}

function RiskMap({ a, b, sinCifra }: { a: ComparePdfMetrics; b: ComparePdfMetrics; sinCifra?: string }) {
  const marks = [{ m: a, label: "A", color: COLOR_A }, { m: b, label: "B", color: COLOR_B }].filter(({ m }) => finite(m.ret) && finite(m.vol));
  if (sinCifra) return <View style={{ width: 270 }}><Nota>{`Mapa: falta el dato de ${sinCifra}, y una cartera sola no se compara con nada.`}</Nota></View>;
  if (marks.length < 2) return <View style={{ width: 270 }}><Nota>Mapa: faltan métricas anualizadas comparables.</Nota></View>;
  const maxX = Math.max(.02, ...marks.map(({ m }) => m.vol! * 1.4));
  const minY = Math.min(0, ...marks.map(({ m }) => m.ret!)) - .01;
  const maxY = Math.max(.02, ...marks.map(({ m }) => m.ret!)) + .02;
  const x = (v: number) => 40 + v / maxX * 210;
  const y = (v: number) => 18 + (maxY - v) / (maxY - minY) * 113;
  const letra = { fontFamily: FUENTE.sans, fontSize: 7.4, fill: PAPEL.tinta3 };
  return <Svg width={270} height={169}>
    {[0, 1, 2, 3].map((i) => <G key={i}>
      <Line x1={40} x2={250} y1={y(minY + (maxY - minY) * i / 3)} y2={y(minY + (maxY - minY) * i / 3)} stroke={i === 0 ? PAPEL.fileteFuerte : PAPEL.filete} strokeWidth={i === 0 ? .75 : .5} />
      <TextoDeSvg x={34} y={y(minY + (maxY - minY) * i / 3) + 2.5} textAnchor="end" style={letra}>{oFalta(porcentaje(minY + (maxY - minY) * i / 3, { decimales: 0 }))}</TextoDeSvg>
      <TextoDeSvg x={x(maxX * i / 3)} y={145} textAnchor="middle" style={letra}>{oFalta(porcentaje(maxX * i / 3, { decimales: 0 }))}</TextoDeSvg>
    </G>)}
    {marks.map(({ m, label, color }, i) => <G key={label}><Circle cx={x(m.vol!)} cy={y(m.ret!)} r={4.5} fill={color} /><TextoDeSvg x={x(m.vol!) + 8} y={y(m.ret!) + (i ? 10 : -6)} style={{ fontFamily: FUENTE.sans, fontSize: 8.6, fontWeight: 600, fill: PAPEL.tinta }}>{label}</TextoDeSvg></G>)}
    <TextoDeSvg x={145} y={165} textAnchor="middle" style={letra}>Volatilidad</TextoDeSvg>
    <TextoDeSvg x={40} y={8} style={letra}>Rentabilidad anualizada</TextoDeSvg>
  </Svg>;
}

/**
 * Todas las filas si caben (10-11-2026). Si de verdad no caben, las mayores y una fila que dice que es una suma, la última antes de lo que no
 * entra, nombrando cuánto pesa la mayor de las que junta, para que no parezca la mayor por ser la suma. Lo que no entra lleva siempre su
 * propia fila, la última (decisión 85).
 */
function grouped(rows: AllocationRow[], limit: number): AllocationRow[] {
  const conPeso = rows.filter((r) => r.a > 0 || r.b > 0).sort((a, b) => Math.max(b.a, b.b) - Math.max(a.a, a.b));
  const fuera = conPeso.filter((r) => r.label === FUERA_DEL_REPARTO);
  const present = conPeso.filter((r) => r.label !== FUERA_DEL_REPARTO);
  const caben = limit - fuera.length;
  if (present.length <= caben) return [...present, ...fuera];
  const resto = present.slice(caben - 1);
  const mayor = Math.max(...resto.map((r) => Math.max(r.a, r.b)));
  return [...present.slice(0, caben - 1), { label: `Otros ${resto.length} grupos (ninguno pasa del ${oFalta(peso(mayor / 100))})`, a: resto.reduce((s, r) => s + r.a, 0), b: resto.reduce((s, r) => s + r.b, 0) }, ...fuera];
}
/** Cuántas filas caben en una tabla de la hoja de composición. */
const FILAS_DE_UNA_TABLA = 16;
function AllocationTable({ rows, limit = FILAS_DE_UNA_TABLA, titulo = "Distribución" }: { rows: AllocationRow[]; limit?: number; titulo?: string }) {
  return rows.length
    ? <Tabla columnas={[{ titulo, ancho: 46 }, { titulo: "A", ancho: 17, cifra: true }, { titulo: "B", ancho: 17, cifra: true }, { titulo: "B − A", ancho: 20, cifra: true }]} filas={grouped(rows, limit).map((r) => ({ celdas: [short(r.label, 70), peso(r.a / 100), peso(r.b / 100), pp(r.a, r.b, true)] }))} />
    : <Apunte>{`${FALTA}.`}</Apunte>;
}
/** La renta variable por región. Una cartera sin renta variable no tiene región que repartir: «No aplica». */
function RentaVariableTable({ rv }: { rv: ComparePdfInput["rentaVariable"] }) {
  if (!rv) return <Apunte>{`Renta variable por región: ${FALTA.toLocaleLowerCase("es-ES")}.`}</Apunte>;
  const filas = filasDeRentaVariable(rv);
  const pesoDe = (cartera: RentaVariableDeUnaCartera) => (cartera.pesoPct > 0.05 ? `el ${oFalta(peso(cartera.pesoPct / 100))}` : "nada");
  return <View>
    <Apunte arriba={0}>{`El reparto de la parte de renta variable de cada cartera, mirando dentro de los fondos. La renta variable pesa ${pesoDe(rv.a)} de A y ${pesoDe(rv.b)} de B.`}</Apunte>
    {filas.length ? <Tabla columnas={[{ titulo: "Región", ancho: 46 }, { titulo: "A", ancho: 17, cifra: true }, { titulo: "B", ancho: 17, cifra: true }, { titulo: "B − A", ancho: 20, cifra: true }]} filas={filas.map((f) => ({
      celdas: [f.label, f.a === null ? NO_APLICA : peso(f.a / 100), f.b === null ? NO_APLICA : peso(f.b / 100), f.a === null || f.b === null ? NO_APLICA : pp(f.a, f.b, true)]
    }))} /> : <Apunte>{`${NO_APLICA}: ninguna de las dos tiene renta variable.`}</Apunte>}
  </View>;
}
/** Una fila por clase: su nombre y sus cifras, y debajo una barra fina por cartera, sobre un filete que marca el 100 %. */
function AllocationBars({ rows }: { rows: AllocationRow[] }) {
  return <View>{grouped(rows, 12).map((r, i) => <View key={i} wrap={false} style={{ marginBottom: 6 }}>
    <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 3 }}>
      <Texto style={{ fontSize: MEDIDAS.tabla.celda, lineHeight: 1.3, color: PAPEL.tinta, flex: 1, paddingRight: 8 }}>{short(r.label, 65)}</Texto>
      <Texto style={{ fontSize: MEDIDAS.seccion.procedencia, lineHeight: 1.3, color: PAPEL.tinta2 }}>{`A ${oFalta(peso(r.a / 100))}    B ${oFalta(peso(r.b / 100))}    Diferencia ${pp(r.a, r.b, true)}`}</Texto>
    </View>
    {[{ value: r.a, color: COLOR_A }, { value: r.b, color: COLOR_B }].map(({ value, color }) => <View key={color} style={{ height: 4, marginBottom: 1.5, justifyContent: "center" }}>
      <View style={{ position: "absolute", left: 0, right: 0, top: 1.6, height: .75, backgroundColor: PAPEL.filete }} />
      <View style={{ height: 3, width: `${Math.max(0, Math.min(100, value))}%`, backgroundColor: color }} />
    </View>)}
  </View>)}</View>;
}

/* ------------------------------------------------------------------------------------------------ La lectura */

/** Todo lo que el documento escribe, calculado una vez como antes: las secciones solo lo colocan. */
function lecturaDeLaComparativa(input: ComparePdfInput) {
  const history = input.history;
  const positions = input.positions ?? [];
  const concentration = comparisonConcentration(positions);
  /* El mismo corte que la pantalla, cartera por cartera (decisión 59). La que no llega al 80 % no da cifras, y ninguna diferencia con ella sale. */
  const faltaA = input.sinCifra?.a ?? null, faltaB = input.sinCifra?.b ?? null;
  const alguna = Boolean(faltaA || faltaB), lasDos = Boolean(faltaA && faltaB);
  const cualFalta = lasDos ? "las dos" : faltaA ? "A" : "B";
  const sinLinea = { a: Boolean(faltaA), b: Boolean(faltaB) };
  const motivos = [faltaA ? `A: ${faltaA}` : null, faltaB ? `B: ${faltaB}` : null].filter((motivo): motivo is string => motivo !== null);
  const metrics = history ? [comparisonMetrics(history.a, input.riskFree ?? null), comparisonMetrics(history.b, input.riskFree ?? null)] : null;
  const [lecturaA, lecturaB] = metrics ? metrics.map((m, i) => ({ posiciones: i ? input.b.posiciones : input.a.posiciones,
    ret: m.cagr ?? undefined, vol: m.volatility ?? undefined, sharpe: m.sharpe ?? undefined, maxdd: m.maxDrawdown })) : [input.a, input.b];
  const a: ComparePdfMetrics = faltaA ? { posiciones: lecturaA.posiciones } : lecturaA;
  const b: ComparePdfMetrics = faltaB ? { posiciones: lecturaB.posiciones } : lecturaB;
  const years = history ? comparisonYearReturns(history.a, history.b) : [];
  const dd = history ? [comparisonDrawdown(history.a), comparisonDrawdown(history.b)] : null;
  const cumulativeA = faltaA ? null : metrics?.[0].cumulative, cumulativeB = faltaB ? null : metrics?.[1].cumulative;
  /* Con menos de un año de fechas comunes no se anualiza (15-11-2026): la rentabilidad es la del periodo y el Sharpe no aplica. */
  const anualizada = metrics ? metrics.every((m) => m.annualized) : true;
  /* Lo que se mide de cada una, con las palabras del informe de cliente (10-11-2026). Sin la frase hecha, con las cifras de la cobertura. */
  const posicionesEn = (n: number) => `${n} ${n === 1 ? "posición" : "posiciones"}`;
  const queSeMide = input.queSeMide ?? (input.coverage ? {
    a: `Mide el ${pesoEnElPapel(input.coverage.a.weight)} de la cartera (${input.coverage.a.included} de ${posicionesEn(input.coverage.a.total)}).`,
    b: `Mide el ${pesoEnElPapel(input.coverage.b.weight)} de la cartera (${input.coverage.b.included} de ${posicionesEn(input.coverage.b.total)}).`
  } : null);
  const llevadasAl100 = input.coverage && (input.coverage.a.weight < 99.99 || input.coverage.b.weight < 99.99) ? " Los pesos de las posiciones medidas se llevan al 100 % para calcular su serie." : "";
  const coverageNote = queSeMide ? `A · ${queSeMide.a} B · ${queSeMide.b}${llevadasAl100}` : `Lo que se mide de cada cartera: ${FALTA.toLocaleLowerCase("es-ES")}.`;
  const costes = costesEnFrases(input.costes);
  const costeDe = (row: ComparisonPositionRow) => {
    const fila = input.costes?.a.rows.find((r) => r.assetId === row.id) ?? input.costes?.b.rows.find((r) => r.assetId === row.id);
    if (!fila) return FALTA;
    return fila.aplicaCoste ? (fila.ongoingPct === null ? FALTA : oFalta(porcentaje(fila.ongoingPct))) : NO_APLICA;
  };
  /* El anexo no repite lo que se mide de cada una, que la nota de encima ya dice con las mismas palabras. */
  const yaDicho = (nota: string) => [input.nameA, input.nameB].some((nombre) => nota.startsWith(`${nombre}: Mide el `));
  const period = input.periodLabel ?? "3 años · métricas aproximadas";
  const capital = lecturaDelCapital(input.capitalA, input.capitalB, cumulativeA, cumulativeB, { a: input.coverage?.a.weight, b: input.coverage?.b.weight });
  const sharpeNoAplicaA = input.sharpeNoAplica?.a ?? false, sharpeNoAplicaB = input.sharpeNoAplica?.b ?? false;
  /*
   * Sin Sharpe en ninguna de las dos, el papel no explica cómo se lee ni cómo se calcula. El Calmar salió del papel el 10-11-2026.
   * «Sin Sharpe» es que no hay una cifra que enseñar: no anualizada, una cartera sin cifras (decisión 59), una sola acción (decisión 41)
   * o un Sharpe que no sale —sin tipo sin riesgo del periodo, o con una volatilidad nula— (CMP-5, 17-11-2026: antes explicaba un Sharpe
   * que la tabla escribía como «Falta el dato»).
   */
  const damosSharpe = (falta: string | null, noAplica: boolean, valor: number | undefined) => !falta && !noAplica && typeof valor === "number" && Number.isFinite(valor);
  const sinSharpe = !anualizada || (!damosSharpe(faltaA, sharpeNoAplicaA, a.sharpe) && !damosSharpe(faltaB, sharpeNoAplicaB, b.sharpe));
  /* Lo que no entra no es una clase: que no se diga que el mayor cambio está ahí. */
  const biggest = input.classRows.filter((r) => r.label !== FUERA_DEL_REPARTO).sort((x, y) => Math.abs(y.b - y.a) - Math.abs(x.b - x.a))[0];
  const sinComparar = lasDos
    ? `Falta el dato de las dos. ${motivos.join(" ")} Sin esas cifras no se comparan rentabilidad ni riesgo: este documento compara su composición.`
    /* CMP-1: la que sí da cifra se mide sobre su propio periodo, no sobre las fechas que compartía con la otra. */
    : `Falta el dato de ${cualFalta}. ${faltaA ?? faltaB} Sin esa cifra no se comparan rentabilidad ni riesgo. Las cifras de ${cualFalta === "A" ? "B" : "A"} son de su propio periodo.`;
  /* Las diferencias en una frase (10-11-2026); la «Lectura» de debajo ya no las repite. */
  const lasDiferencias = alguna ? sinComparar : (anualizada
    ? diferenciasEnFrases(a, b)
    : diferenciasEnFrases({ ...a, ret: cumulativeA ?? undefined }, { ...b, ret: cumulativeB ?? undefined }, { enElPeriodo: true })
  ) ?? "No hay métricas anualizadas suficientes para comparar rentabilidad y riesgo.";
  /*
   * El método, sin repetirse (10-11-2026): la nota de lo que se mide es la frase del informe de cliente. El anexo solo se pinta si alguna nota
   * no nombra todo lo que queda fuera —cuenta y manda al anexo— o si hay tramos estimados con referencias que contar. Las notas generales, que
   * no son de ninguna cartera, se quedan en la base de cálculo.
   */
  const notas = (input.methodology ?? []).filter((nota) => !yaDicho(nota));
  const deUnaCartera = (nota: string) => [input.nameA, input.nameB].some((nombre) => nota.startsWith(`${nombre}: `) || nota.startsWith(`${nombre} · `));
  const generales = notas.filter((nota) => !deUnaCartera(nota));
  const hayAnexo = [queSeMide?.a, queSeMide?.b, faltaA, faltaB].some((nota) => nota?.includes("detalladas en el anexo")) || Boolean(input.extendedHistory) || notas.some((nota) => /tramo estimado/i.test(nota));
  const anexo = hayAnexo ? coverageAnnexItems({ ...input, methodology: notas.filter(deUnaCartera) }) : [];
  const textoDeLaBase = lasDos ? "Sin cifras de ninguna de las dos, este documento compara su composición: no hay rentabilidad ni riesgo que comparar." : history ? `Ambas carteras parten de 100 en la primera fecha común. Periodo efectivo: ${history.rangeLabel}. Se utilizan las mismas ${history.a.length} observaciones para las dos carteras.` : "Sin histórico común adjunto. Las métricas recibidas son aproximadas y no permiten reconstruir la rentabilidad acumulada ni los episodios de caída.";
  const textoDelCorte = alguna ? `Por debajo del ${oFalta(numero(PESO_MINIMO_MEDIDO_PCT))} % del peso medido no se da ninguna cifra de la cartera, y una diferencia con ella tampoco. ${lasDos ? "Les pasa a las dos" : `Le pasa a ${cualFalta}`}: el motivo está en la primera hoja${hayAnexo ? ", y lo que queda fuera, en el anexo" : ""}.` : null;
  const textoDeLaSimulacion = `Simulación de las composiciones guardadas, sin aportaciones ni retiradas. Lo que no se mide se queda fuera, y los pesos de las posiciones medidas se llevan al 100 % para calcular su serie. ${deQueVanNetasLasRentabilidades(input.hayFondos ?? true)}`;
  const textoDeLasFormulas = history && !lasDos ? `${anualizada ? "Rentabilidad anualizada por días naturales." : "Las dos carteras comparten menos de un año de fechas: un periodo tan corto no se anualiza, así que la rentabilidad es la del periodo, sin anualizar, y el Sharpe no aplica."} Volatilidad con variaciones semanales y desviación típica muestral anualizada. ${sinSharpe ? "" : "Sharpe = (rentabilidad anualizada menos tipo sin riesgo) / volatilidad. "}Caída máxima calculada con todas las observaciones diarias comunes.` : null;
  /* De dónde sale cada clasificación de la hoja de composición: es método (10-11-2026). */
  const CLASIFICACIONES = "Categoría y divisa, de la ficha de cada activo («No declarado» si la de un fondo no la trae); región, de dentro de los fondos, como en el informe de cliente; coincidencia, por identificador de activo y no por lo que hay dentro.";
  const CRITERIOS = "Las diferencias se calculan siempre como B menos A, en puntos porcentuales salvo los ratios y los recuentos. Una ventaja en una métrica no determina por sí sola qué cartera es adecuada. No se han estimado impuestos ni exposiciones de dentro de los fondos que los datos no traen.";
  const parrafos = [textoDelCorte, `${textoDeLaBase} ${textoDeLaSimulacion}`, textoDeLasFormulas, CLASIFICACIONES, CRITERIOS].filter((texto): texto is string => Boolean(texto));
  const currencyRows = [...positions.reduce((map, r) => { const value = map.get(r.currency) ?? { label: r.currency, a: 0, b: 0 }; value.a += r.a; value.b += r.b; map.set(r.currency, value); return map; }, new Map<string, AllocationRow>()).values()];
  return { history, positions, concentration, faltaA, faltaB, alguna, lasDos, cualFalta, sinLinea, motivos, a, b, years, dd, cumulativeA, cumulativeB, anualizada, coverageNote, costes, costeDe, period, capital, sharpeNoAplicaA, sharpeNoAplicaB, sinSharpe, biggest, lasDiferencias, generales, anexo, parrafos, currencyRows, separateYears: years.length > 5 };
}

type Datos = { input: ComparePdfInput; l: ReturnType<typeof lecturaDeLaComparativa> };

const cifraOFalta = (falta: string | null, escrita: CeldaDeTabla): CeldaDeTabla => (falta ? FALTA : escrita);
/** Las celdas de cada año: lo de una cartera sin cifra falta, y su resta también. */
const celdasDelAnio = (l: Datos["l"], r: Datos["l"]["years"][number]): CeldaDeTabla[] => [cifraOFalta(l.faltaA, conSigno(r.a)), cifraOFalta(l.faltaB, conSigno(r.b)), l.alguna ? FALTA : pp(r.a, r.b)];
const filasDeLosAnios = (l: Datos["l"]): FilaDeTabla[] => l.years.map((r) => ({ celdas: [{ texto: r.label, apunte: `${oFalta(fecha(r.start))} a ${oFalta(fecha(r.end))}` }, ...celdasDelAnio(l, r)] }));
const COLUMNAS_DE_LOS_ANIOS = [{ titulo: "Año / fechas efectivas", ancho: 46 }, { titulo: "A", ancho: 18, cifra: true }, { titulo: "B", ancho: 18, cifra: true }, { titulo: "B − A", ancho: 18, cifra: true }];
const COLUMNAS_DEL_CAPITAL = (rotulo: string) => [{ titulo: rotulo, ancho: 46 }, { titulo: "A", ancho: 18, cifra: true }, { titulo: "B", ancho: 18, cifra: true }, { titulo: "B − A", ancho: 18, cifra: true }];

/* ------------------------------------------------------------------------------------------------ Las secciones */

const presentacion: SeccionDeInforme<Datos> = {
  id: "presentacion",
  titulo: "Presentación",
  comienzo: "presentacion",
  procede: () => true,
  Contenido: ({ datos: { input, l } }) => (
    <>
      <Presentacion
        contexto={[input.clientName?.trim() ?? "", l.history ? l.history.rangeLabel : l.period, `Fecha de emisión: ${oFalta(fechaLarga(new Date()))}`]}
        titulo={DOCUMENTO}
        /* Las dos, como en la pantalla: «Propuesta A» y «Propuesta B». «Cartera» se queda donde describe lo que hay dentro. */
        datos={[{ rotulo: "Propuesta A", valor: short(input.nameA, 120) }, { rotulo: "Propuesta B", valor: short(input.nameB, 120) }]}
      />
      {/* Sin tarjetas de cifras en la primera hoja (Óscar, 15-11-2026: las métricas, nunca en la portada). La rentabilidad anualizada y la
          volatilidad de cada cartera están en «Qué riesgo acompaña al resultado», y sus diferencias, en la frase de abajo. */}
      {input.sample ? <Aviso palabra="Muestra de maquetación.">Carteras y datos simulados para validar el diseño.</Aviso> : null}
      <Subtitulo>Las diferencias, de un vistazo</Subtitulo>
      <Apunte arriba={0}>{`De B respecto a A · ${l.period}`}</Apunte>
      <Parrafo>{l.lasDiferencias}</Parrafo>
      <Subtitulo>Coste corriente de cada cartera</Subtitulo>
      <Parrafo>{`A · ${l.costes.a}`}</Parrafo>
      <Parrafo>{`B · ${l.costes.b}`}</Parrafo>
      <Parrafo>{l.costes.diferencia}</Parrafo>
      {l.costes.completa ? <Apunte>{LO_QUE_NO_INCLUYE_EL_COSTE}</Apunte> : null}
      <Subtitulo>Lectura de la comparación</Subtitulo>
      {l.biggest && Math.abs(l.biggest.b - l.biggest.a) >= .01 ? <Parrafo>{`El mayor cambio por clase está en ${l.biggest.label.toLocaleLowerCase("es-ES")}: pasa del ${oFalta(peso(l.biggest.a / 100))} en A al ${oFalta(peso(l.biggest.b / 100))} en B (${pp(l.biggest.a, l.biggest.b, true)}).`}</Parrafo> : null}
      {l.concentration ? <Parrafo>{`Las carteras comparten ${l.concentration.shared} ${l.concentration.shared === 1 ? "posición" : "posiciones"} y un ${oFalta(peso(l.concentration.overlap / 100))} del peso. El ${oFalta(peso(l.concentration.reallocation / 100))} del capital cambia de asignación entre ambas composiciones.`}</Parrafo> : null}
      <Nota>{`${l.coverageNote}${input.extendedHistory ? " Incluye tramos estimados mediante referencias históricas." : ""}`}</Nota>
      <Apunte arriba={10}>Simulación histórica de las composiciones guardadas. Las rentabilidades pasadas no garantizan rentabilidades futuras.</Apunte>
    </>
  )
};

const evolucion: SeccionDeInforme<Datos> = {
  id: "evolucion",
  titulo: "Rentabilidad y evolución",
  comienzo: "nueva",
  procedencia: ({ input, l }) => `Evolución histórica · base 100 · ${l.period}${input.extendedHistory ? " · estimado" : ""}`,
  procede: ({ l }) => Boolean(l.history) && !l.lasDos,
  Contenido: ({ datos: { input, l } }) => {
    const history = l.history!;
    /* Con la tabla por año y la de importes en la misma hoja, el gráfico baja para que la nota no pase a otra (CMP-5). */
    const altoDelGrafico = !l.separateYears && l.capital.enEuros ? 115 : 180;
    return (
      <>
        {/* El gráfico trae su leyenda con el trazo de A y de B; aquí, qué cartera es cada una. */}
        <Nombres input={input} sinLinea={l.sinLinea} conTrazo={false} />
        {l.alguna ? <Nota>{l.motivos.join(" ")}</Nota> : null}
        <Evolucion a={l.faltaA ? null : history.a} b={l.faltaB ? null : history.b} formato={(v) => numero(v, { decimales: 1 })} formatoDelEje={(v) => numero(v)} alto={altoDelGrafico} />
        <Apunte>{`${history.rangeLabel} · ${history.a.length} observaciones comunes · Base 100, calculado en euros`}</Apunte>
        <View style={{ height: 12 }} />
        <CifrasDestacadas
          cifras={[
            { rotulo: "Acumulada A", cifra: l.faltaA ? null : rentabilidad(l.cumulativeA), signo: l.faltaA ? null : signoDe(l.cumulativeA, 4) },
            { rotulo: "Acumulada B", cifra: l.faltaB ? null : rentabilidad(l.cumulativeB), signo: l.faltaB ? null : signoDe(l.cumulativeB, 4) },
            { rotulo: "Diferencia B − A", cifra: l.alguna ? null : puntos(difference(l.cumulativeA, l.cumulativeB)) }
          ]}
        />
        {!l.separateYears ? (
          <>
            <Subtitulo>Rentabilidad por año</Subtitulo>
            <Tabla columnas={COLUMNAS_DE_LOS_ANIOS} filas={filasDeLosAnios(l)} />
            <Apunte arriba={7}>Los periodos parciales se identifican. Cada tramo enlaza con el cierre del anterior; no se suman rentabilidades.</Apunte>
            {/* CMP-5 (17-11-2026): con un capital fijado, los importes salen siempre; con cinco años o menos la tabla por año comparte hoja con ellos. */}
            {l.capital.enEuros ? (
              <>
                <Subtitulo>{l.capital.tituloDeLaTabla}</Subtitulo>
                <Tabla columnas={COLUMNAS_DEL_CAPITAL(l.capital.rotulo)} filas={l.capital.filas.map((fila) => ({ celdas: fila.cells }))} />
              </>
            ) : null}
          </>
        ) : (
          <>
            <Subtitulo>{l.capital.tituloDeLaTabla}</Subtitulo>
            <Tabla columnas={COLUMNAS_DEL_CAPITAL(l.capital.rotulo)} filas={l.capital.filas.map((fila) => ({ celdas: fila.cells }))} />
          </>
        )}
        <Nota>{l.capital.nota}</Nota>
      </>
    );
  }
};

const anioAAnio: SeccionDeInforme<Datos> = {
  id: "anio-a-anio",
  titulo: "El resultado, año a año",
  comienzo: "nueva",
  sinNumero: true,
  procedencia: ({ l }) => `Rentabilidad por año · ${l.period} · ${l.history?.rangeLabel ?? ""}`,
  procede: ({ l }) => !l.lasDos && l.separateYears,
  Contenido: ({ datos: { input, l } }) => (
    <>
      <Nombres input={input} />
      <Tabla columnas={COLUMNAS_DE_LOS_ANIOS} filas={filasDeLosAnios(l)} />
      <Nota>Las fechas de cada fila delimitan el tramo medido. Los años parciales se identifican y no se anualizan. Para obtener el resultado acumulado se multiplican los factores (1 + rentabilidad) de todos los tramos.</Nota>
    </>
  )
};

const riesgo: SeccionDeInforme<Datos> = {
  id: "riesgo",
  titulo: "Qué riesgo acompaña al resultado",
  comienzo: "nueva",
  procede: ({ l }) => !l.lasDos,
  Contenido: ({ datos: { input, l } }) => {
    const { a, b } = l;
    const filas: FilaDeTabla[] = [
      /* Sin un año común, la del periodo y, debajo, la anualizada en «No aplica», como en pantalla: la fila no desaparece. */
      ...(l.anualizada
        ? [{ celdas: ["Rentabilidad anualizada", cifraOFalta(l.faltaA, conSigno(a.ret)), cifraOFalta(l.faltaB, conSigno(b.ret)), l.alguna ? FALTA : pp(a.ret, b.ret)] }]
        : [
          { celdas: [`Rentabilidad del periodo, ${l.history?.rangeLabel ?? ""}`, cifraOFalta(l.faltaA, conSigno(l.cumulativeA)), cifraOFalta(l.faltaB, conSigno(l.cumulativeB)), l.alguna ? FALTA : pp(l.cumulativeA, l.cumulativeB)] },
          { celdas: ["Rentabilidad anualizada", cifraOFalta(l.faltaA, NO_APLICA), cifraOFalta(l.faltaB, NO_APLICA), l.alguna ? FALTA : NO_APLICA] }
        ]),
      { celdas: ["Volatilidad", cifraOFalta(l.faltaA, porcentaje(a.vol)), cifraOFalta(l.faltaB, porcentaje(b.vol)), l.alguna ? FALTA : pp(a.vol, b.vol)] },
      l.anualizada
        ? { celdas: ["Sharpe", cifraOFalta(l.faltaA, l.sharpeNoAplicaA ? NO_APLICA : ratio(a.sharpe)), cifraOFalta(l.faltaB, l.sharpeNoAplicaB ? NO_APLICA : ratio(b.sharpe)), l.alguna ? FALTA : l.sharpeNoAplicaA || l.sharpeNoAplicaB ? NO_APLICA : numero(difference(a.sharpe, b.sharpe), { decimales: 2, conSigno: true })] }
        : { celdas: ["Sharpe", cifraOFalta(l.faltaA, NO_APLICA), cifraOFalta(l.faltaB, NO_APLICA), l.alguna ? FALTA : NO_APLICA] },
      { celdas: [l.history ? "Caída máxima del periodo" : input.maxddLabel ?? "Caída máxima histórica", cifraOFalta(l.faltaA, porcentaje(a.maxdd)), cifraOFalta(l.faltaB, porcentaje(b.maxdd)), l.alguna ? FALTA : pp(a.maxdd, b.maxdd)] }
    ];
    const guia = { fontSize: MEDIDAS.nota.letra, color: PAPEL.tinta2, lineHeight: 1.45, marginTop: 6 };
    return (
      <>
        <Nombres input={input} sinLinea={l.sinLinea} />
        {l.alguna ? <Nota>{l.motivos.join(" ")}</Nota> : null}
        <Tabla columnas={[{ titulo: input.extendedHistory ? "Métrica del periodo · estimado" : "Métrica del periodo", ancho: 46 }, { titulo: "A", ancho: 18, cifra: true }, { titulo: "B", ancho: 18, cifra: true }, { titulo: "B − A", ancho: 18, cifra: true }]} filas={filas} />
        <View style={{ flexDirection: "row", marginTop: 16 }} wrap={false}>
          <RiskMap a={a} b={b} sinCifra={l.alguna ? l.cualFalta : undefined} />
          <View style={{ flex: 1, paddingLeft: 18, paddingTop: 8 }}>
            <Texto style={{ fontSize: MEDIDAS.cuerpo.letra, fontWeight: 600, lineHeight: 1.4 }}>Cómo leer las diferencias</Texto>
            <Texto style={guia}>{`${l.sinSharpe ? "Rentabilidad" : "Rentabilidad y Sharpe"}: una cifra mayor refleja un mejor resultado histórico en esa métrica. Volatilidad: una cifra menor indica menos oscilación. Caída máxima: un valor más cercano a cero refleja una pérdida menor desde máximos.`}</Texto>
            {l.sharpeNoAplicaA || l.sharpeNoAplicaB ? <Texto style={guia}>{`Sharpe: no aplica si lo que se mide es una sola acción. ${motivoDeQueNoAplique("sharpe", "STOCK")}`}</Texto> : null}
            <Texto style={guia}>{`${l.sinSharpe ? "" : `Tipo sin riesgo: ${oFalta(porcentaje(input.riskFree))}. `}El mapa muestra la relación entre rentabilidad anualizada y volatilidad.`}</Texto>
            {!l.sinSharpe && typeof input.tipoDeRespaldo === "number" ? <Texto style={guia}>{fraseDelTipoDeRespaldo(input.tipoDeRespaldo)}</Texto> : null}
          </View>
        </View>
        {l.dd ? (
          <>
            <View wrap={false}>
              <Subtitulo>Caídas desde máximos</Subtitulo>
              <Evolucion a={l.faltaA ? null : l.dd[0].series} b={l.faltaB ? null : l.dd[1].series} formato={(v) => porcentaje(v)} formatoDelEje={(v) => porcentaje(v, { decimales: 1 })} alto={140} />
            </View>
            <Tabla columnas={[{ titulo: "Peor episodio de cada cartera", ancho: 40 }, { titulo: "A", ancho: 30, cifra: true }, { titulo: "B", ancho: 30, cifra: true }]} filas={[
              { celdas: ["Máximo previo / mínimo", ...l.dd.map((d, i) => ((i ? l.faltaB : l.faltaA) ? FALTA : d.peak ? `${oFalta(fecha(d.peak))} / ${oFalta(fecha(d.trough))}` : "Sin caída"))] },
              { celdas: ["Recuperación del máximo previo", ...l.dd.map((d, i) => ((i ? l.faltaB : l.faltaA) ? FALTA : !d.peak ? "No procede" : d.recovery ? `${oFalta(fecha(d.recovery))} · ${cuantos(d.daysToRecovery ?? 0, "día", "días")}` : "No recuperado al cierre"))] }
            ]} />
            <Apunte arriba={7}>Días naturales desde el máximo previo hasta su recuperación. Cada cartera puede haber sufrido su peor episodio en fechas distintas.</Apunte>
          </>
        ) : null}
      </>
    );
  }
};

const composicion: SeccionDeInforme<Datos> = {
  id: "composicion",
  titulo: "Dónde se separan las carteras",
  comienzo: "nueva",
  procedencia: "Composición guardada completa · pesos llevados al 100 %",
  procede: () => true,
  Contenido: ({ datos: { input, l } }) => (
    <>
      <Nombres input={input} />
      {[input.fueraDelReparto?.a ? `A · ${input.fueraDelReparto.a}` : null, input.fueraDelReparto?.b ? `B · ${input.fueraDelReparto.b}` : null].filter((nota): nota is string => nota !== null).map((nota) => <Apunte key={nota} arriba={0}>{nota}</Apunte>)}
      <Subtitulo primero>Distribución por clase económica</Subtitulo>
      <AllocationBars rows={input.classRows} />
      {/* Las categorías a la izquierda; la región, la divisa y la concentración, debajo una de otra a la derecha (10-11-2026). Con la tabla de
          la plantilla, una columna que no cabe sigue en la hoja siguiente con la cabecera repetida y sin partir una fila; mover la columna
          entera dejaba la hoja casi vacía. La divisa y la concentración van enteras, con su nota. */}
      <View style={{ flexDirection: "row" }}>
        <View style={{ width: "50%", paddingRight: 12 }}><Subtitulo>Por categoría</Subtitulo><AllocationTable titulo="Categoría" rows={input.categoryRows ?? []} /></View>
        <View style={{ width: "50%", paddingLeft: 12 }}>
          <Subtitulo>Renta variable por región</Subtitulo><RentaVariableTable rv={input.rentaVariable} />
          <View wrap={false}><Subtitulo>Divisa de los activos</Subtitulo><AllocationTable titulo="Divisa" rows={l.currencyRows} /><Apunte>La divisa de la ficha no es la exposición cambiaria de dentro ni informa de sus coberturas. El histórico va en euros.</Apunte></View>
          {l.concentration ? <View wrap={false}><Subtitulo>Concentración y coincidencias</Subtitulo>
            <Tabla columnas={[{ titulo: "Indicador", ancho: 46 }, { titulo: "A", ancho: 17, cifra: true }, { titulo: "B", ancho: 17, cifra: true }, { titulo: "B − A", ancho: 20, cifra: true }]} filas={[
              { celdas: ["Posiciones con peso", numero(l.concentration.a.count), numero(l.concentration.b.count), numero(l.concentration.b.count - l.concentration.a.count, { conSigno: true })] },
              { celdas: ["Mayor posición", peso(l.concentration.a.top1 / 100), peso(l.concentration.b.top1 / 100), pp(l.concentration.a.top1, l.concentration.b.top1, true)] },
              { celdas: ["Cinco mayores posiciones", peso(l.concentration.a.top5 / 100), peso(l.concentration.b.top5 / 100), pp(l.concentration.a.top5, l.concentration.b.top5, true)] }
            ]} />
            <Apunte>{`Peso coincidente: ${oFalta(peso(l.concentration.overlap / 100))} (${l.concentration.shared === 1 ? "1 posición compartida" : `${l.concentration.shared} posiciones compartidas`}). Cambio de asignación: el ${oFalta(peso(l.concentration.reallocation / 100))} del capital se redistribuye.`}</Apunte>
          </View> : null}
        </View>
      </View>
    </>
  )
};

const posiciones: SeccionDeInforme<Datos> = {
  id: "posiciones",
  titulo: "Qué cambia en cada posición",
  comienzo: "nueva",
  procedencia: "Ordenadas por el tamaño del cambio de peso. Positivo: mayor peso en B; negativo: menor peso. Pesos de la composición guardada completa.",
  procede: ({ l }) => l.positions.length > 0,
  Contenido: ({ datos: { input, l } }) => (
    <>
      <Nombres input={input} />
      <Tabla
        columnas={[{ titulo: "Activo / identificador", ancho: 46 }, { titulo: "Peso A", ancho: 12, cifra: true }, { titulo: "Peso B", ancho: 12, cifra: true }, { titulo: "B − A", ancho: 13, cifra: true }, { titulo: "Coste corriente", ancho: 17, cifra: true }]}
        filas={l.positions.map((r) => ({ celdas: [{ texto: short(r.name, 115), apunte: `${r.id} · ${short(r.category, 80)} · ${!r.a ? "Solo en B" : !r.b ? "Solo en A" : "Compartida"}` }, peso(r.a / 100), peso(r.b / 100), pp(r.a, r.b, true), l.costeDe(r)] }))}
      />
      <Apunte arriba={8}>{`${l.positions.length} ${l.positions.length === 1 ? "posición" : "posiciones"}. Total de pesos del conjunto: A ${oFalta(peso(l.positions.reduce((s, p) => s + p.a, 0) / 100))} · B ${oFalta(peso(l.positions.reduce((s, p) => s + p.b, 0) / 100))}.`}</Apunte>
      <Nota>{`El cambio de asignación es la mitad de la suma de diferencias absolutas de peso. Es una comparación de composiciones; no incluye costes de operación ni constituye una orden de inversión. El coste corriente es el de la ficha de cada fondo; una acción no lo tiene. ${LO_QUE_NO_INCLUYE_EL_COSTE}`}</Nota>
    </>
  )
};

const metodo: SeccionDeInforme<Datos> = {
  id: "metodo",
  titulo: "Qué se mide de cada cartera y cómo",
  /* Sigue a las posiciones si cabe un buen trozo debajo; si no, abre hoja con su título. */
  juntoAlTitulo: 260,
  procede: () => true,
  Contenido: ({ datos: { input, l } }) => (
    <>
      <Nombres input={input} />
      <Nota>{l.coverageNote}</Nota>
      <Subtitulo>Cómo se calcula</Subtitulo>
      {l.parrafos.map((texto, i) => <Texto key={i} style={{ fontSize: MEDIDAS.nota.letra, color: PAPEL.tinta2, lineHeight: 1.45, marginTop: i ? 5 : 0 }}>{texto}</Texto>)}
      {l.generales.map((nota) => <Apunte key={nota}>{nota}</Apunte>)}
      {l.anexo.length ? (
        <>
          <Subtitulo>Anexo · Qué queda fuera de cada cartera</Subtitulo>
          <Apunte arriba={0}>Activos fuera del cálculo, con su motivo, y tramos estimados con referencias históricas. No alteran las cifras del informe.</Apunte>
          {l.anexo.map((item, j) => <View key={j} wrap={false}>{item.heading ? <Texto style={{ fontSize: MEDIDAS.cuerpo.letra, fontWeight: 600, lineHeight: 1.4, marginTop: 6 }}>{item.heading}</Texto> : null}<Apunte arriba={2}>{item.text}</Apunte></View>)}
        </>
      ) : null}
      <AvisoLegal />
    </>
  )
};

function CompareDoc({ input }: { input: ComparePdfInput }) {
  const cliente = input.clientName?.trim() ?? "";
  const l = lecturaDeLaComparativa(input);
  /* El título de la evolución dice si hay capital fijado: «Rentabilidad y evolución» o «Rentabilidad y valor del capital» (decisión 42). */
  const secciones: SeccionDeInforme<Datos>[] = [presentacion, { ...evolucion, titulo: l.capital.tituloDeLaHoja }, anioAAnio, riesgo, composicion, posiciones, metodo];
  return (
    <DocumentoDeInforme
      tema="cliente"
      documento={DOCUMENTO}
      titulo={`${DOCUMENTO} - ${input.nameA} vs ${input.nameB}`}
      asunto="Comparativa de dos composiciones de cartera"
      identidad={firmaDelInforme(input.banker)}
      destinatario={cliente || undefined}
    >
      <HojasDeSecciones secciones={secciones} datos={{ input, l }} />
    </DocumentoDeInforme>
  );
}

export async function createComparisonPdfBlob(input: ComparePdfInput): Promise<Blob> {
  let reportInput = input;
  if (input.history) {
    validateComparisonHistory(input.history.a, input.history.b);
    // The public exporter also accepts non-rebased paths; normalize before drawing.
    reportInput = { ...input, history: { ...input.history,
      a: input.history.a.map((p) => ({ ...p, value: p.value / input.history!.a[0].value * 100 })),
      b: input.history.b.map((p) => ({ ...p, value: p.value / input.history!.b[0].value * 100 })) } };
  }
  return renderizarInforme(<CompareDoc input={reportInput} />);
}
/** «Comparativa de propuestas - Prudente frente a Crecimiento - 2026-11-14.pdf»: las dos propuestas y el día de emisión que imprime. */
export function nombreDelFicheroDeLaComparativa(input: Pick<ComparePdfInput, "nameA" | "nameB">): string {
  const nombres = [input.nameA, input.nameB].map((nombre) => nombre.trim()).filter(Boolean);
  return nombreDelFichero({ documento: DOCUMENTO, de: nombres.join(" frente a "), fecha: hoy() });
}

export async function downloadComparisonPdf(input: ComparePdfInput): Promise<void> {
  descargar(await createComparisonPdfBlob(input), nombreDelFicheroDeLaComparativa(input));
}
