/* eslint-disable react-refresh/only-export-components */
// Export PDF del comparador de ACTIVOS (hasta 5), con la plantilla única de informes (`./plantilla`): papel blanco, la
// identidad del asesor en la cabecera y ningún relleno de color salvo el del dato (las casillas de la matriz).
// Hermano de comparePdf.tsx (que compara dos CARTERAS); carga perezosa desde el componente, y si fallara, el llamador captura.
//
// Sin gráficos: el documento traslada a tablas lo que se ve en pantalla (identificación, rentabilidad, riesgo y coste, base
// 100 y matriz de correlación), que es lo que sobrevive a una impresión en blanco y negro. Como no hay gráfico, los activos
// no llevan color: se identifican por su número, el mismo en todas las tablas.

import { StyleSheet, View } from "@react-pdf/renderer";
import type { ReactElement } from "react";
import type { CifrasDelProveedorEnElPapel, ColumnaDelInforme } from "../adapters/comparativaDeActivos";
import { NO_SE_MIDE } from "../core/correlation";
import { descargar, diaDelDocumento, nombreDelFichero } from "../core/descargaDeFicheros";
import { categoriaLegible } from "../core/etiquetasDeReparto";
import { esAccion } from "../core/esAccion";
import { fecha as escribirFecha, fechaLarga, numero, oFalta, porcentaje, ratio, rentabilidad, signoDe } from "../core/formato";
import { leerIdentidad } from "../core/identidadDelAsesor";
import { readableBackendLabel, TYPE_LABELS } from "../core/labels";
import { seEnsenaLaMetrica } from "../core/metricasPorInstrumento";
import { textoDeAusencia } from "../core/textoDeAusencia";
import { ventanasEnPalabras } from "./ventanasEnPalabras";
import {
  Aviso,
  AvisoLegal,
  DocumentoDeInforme,
  Hoja,
  MEDIDAS,
  Nota,
  PAPEL,
  Parrafo,
  Presentacion,
  SERIES_DEL_TEMA,
  useInforme,
  Tabla,
  Texto,
  TituloDeSeccion,
  renderizarInforme,
  type CeldaDeTabla,
  type ColumnaDeTabla,
  type IdentidadDelAsesor
} from "./plantilla";

/**
 * Para quién sale el informe (decisión 20 de Óscar). Es el mismo documento con dos salidas: «cliente» se puede
 * entregar, va en el tema de cliente y no lleva ni la columna ni rastro de la retrocesión; «interno» va en el tema
 * interno («USO INTERNO» y «No entregar al cliente» en cada hoja) y lleva la columna. En Modo cliente siempre sale
 * «cliente»: lo decide quien lo pide.
 */
export type SalidaDeLaComparativa = "cliente" | "interno";

/*
 * El mismo fondo no da la misma rentabilidad en las dos tablas: una cifra sale de su método, a su cierre, y la base 100 de la
 * serie en la ventana común (hallazgo 35). No se dice «meses cerrados» porque no vale para todos: una acción va a diario, y las
 * hay del proveedor.
 */
const DIFIERE_DE_LA_EVOLUCION = "La rentabilidad puede diferir de la base 100: otro cálculo y otras fechas.";

/** Lo que el documento dice de sí mismo: en la cabecera, en su título y en el nombre del fichero. */
const DOCUMENTO = "Comparativa de activos";

export interface AssetComparePdfAsset {
  name: string;
  /**
   * El color de su serie en la pantalla. El papel ya no lo usa: no lleva gráfico, y los colores del papel son los de la
   * plantilla (`SERIES`). Se admite para no cambiar cómo llama la pantalla.
   */
  color?: string;
  isin?: string;
  ticker?: string;
  /** Código del backend (`FUND`, `ETF`, `STOCK`…): el PDF lo traduce con TYPE_LABELS. */
  instrumentType?: string;
  currency?: string;
  category?: string;
  /** El sector de una acción, que no tiene categoría de fondo: lo que escribe esa fila en pantalla. Sin él, no aplica (decisión 83). */
  sector?: string;
  morningstarRating?: number | null;
  /** Métricas en tanto por uno (0,0725 = 7,25 %). */
  return1y?: number;
  return3y?: number;
  return5y?: number;
  return10y?: number;
  volatility1y?: number;
  volatility3y?: number;
  sharpe3y?: number;
  maxDrawdown?: number;
  /** Ventana de SU máxima caída («Máx. caída (hist.)» o «Máx. caída 5A»): cada
      activo usa la más larga que tenga, así que dos filas pueden diferir. */
  maxDrawdownLabel?: string;
  /**
   * El coste corriente de la fila «Coste corriente» de la pantalla (hallazgo ACT-09), en tanto por uno, sin recalcular:
   * `null` si a este activo le falta el dato, «no-aplica» si no le aplica (una acción). Sin el campo en ningún activo, la
   * columna no sale: el papel no dice que falta lo que no se le ha pasado.
   */
  costeCorriente?: number | null | "no-aplica";
  /** De qué salen sus cifras, si alguna columna no es comparable: «con datos semanales», «con la cifra del proveedor». */
  calculo?: string;
  /** Retrocesión efectiva, en tanto por uno, o que a este activo no le aplica. Solo la lee la salida interna. */
  retro?: number | "no-aplica";
  /** Valor final de la serie rebasada a 100 en la ventana comparada. */
  base100?: number;
  /**
   * Su serie es el valor liquidativo de una clase que reparte, sin sus dividendos (decisión 8). Es el mismo dato con
   * que la pantalla rotula la evolución y le quita la cifra final, y aquí tampoco se imprime: no se compara con las demás.
   */
  sinDividendos?: boolean;
  /** La frase de la pantalla, si el servidor no lo ha dibujado: el hueco se explica (decisión 84). En la salida para el cliente, la frase de cliente. */
  noSeDibuja?: string;
  /** A qué fecha están sus cifras, si no es la misma en todas (decisión 80). */
  cierre?: string;
  /** La divisa de sus cifras, si son las del proveedor y no van en euros (decisión 80). */
  sinConvertir?: string;
  /** Las del proveedor en una ficha con cifras nuestras, si van a otra fecha o en otra divisa (decisión 110): se dicen aparte. */
  delProveedor?: CifrasDelProveedorEnElPapel[];
  /**
   * Lo que la celda de la pantalla dice bajo su cifra, columna a columna (decisión A-125): «Del proveedor · a 31/10/2026», «A 30/09/2026»,
   * «Sin fecha». Va en su celda, y la fecha que ya va en la celda no se repite en la nota de fechas.
   */
  apuntes?: Partial<Record<ColumnaDelInforme, string>>;
}

export interface AssetComparePdfInput {
  assets: AssetComparePdfAsset[];
  /** Ventana comparada, tal cual se muestra bajo el gráfico ("3A" o la cobertura real). */
  windowLabel: string;
  /** Nombre de la cartera de referencia; null si se comparó sin ella. */
  benchmarkName: string | null;
  benchmarkBase100?: number;
  /** Qué es la referencia y hasta qué fecha se compara, o que no está disponible. Va donde se compara. */
  benchmarkNote?: string;
  /** Cabecera de la columna de máxima caída cuando todos los activos comparten
      ventana. Si las filas traen ventanas distintas, el PDF usa una cabecera
      neutra y marca la ventana en cada fila. */
  maxDrawdownLabel: string;
  methodologyFootnote: string;
  /**
   * Lo que la pantalla marca «No comparable entre sí» (decisión 42). Las filas son los activos, así que la marca va en la
   * cabecera de la columna, y el método se nombra activo por activo, con `calculo`. Sin nada que marcar, no está.
   */
  noComparable?: { columnas: readonly ColumnaDelInforme[]; sinDeclarar: boolean };
  correlation?: {
    labels: string[];
    matrix: (number | null)[][];
    /** Decisión 53: con la línea de quien reparte no se mide. Sus casillas lo dicen, y `nota` dice por qué. */
    noSeMide?: boolean[];
    nota?: string | null;
    /** El número de cada serie en las tablas: la matriz no lleva a quien no se dibuja, y un fondo tiene un solo número en todo el documento (decisión 84). */
    numeros?: number[];
  } | null;
  /**
   * Por qué falta una ventana a la que la serie de un activo llega: la misma frase que la pantalla y la ficha, con su nombre (decisión 112).
   * Sin ella la casilla decía que faltaba sin motivo, que es lo que la 84 quitó del papel.
   */
  notasDeLaSerie?: readonly string[];
  /**
   * Por qué una celda dice que falta el dato porque nuestra cifra se apartó por salirse de su rango (decisión B-73, en el papel por la A-125): la
   * frase de la pantalla, sin la cifra, con la fila a la que va. Las de rentabilidad bajo su tabla; las demás, bajo la de riesgo.
   */
  cifrasApartadas?: ReadonlyArray<{ fila: string; nota: string }>;
  salida: SalidaDeLaComparativa;
  /** Quién firma. Sin ella, la que el asesor guardó en este navegador (`leerIdentidad`). */
  identidad?: IdentidadDelAsesor;
  /** Cuándo se genera. Por defecto, ahora. */
  generado?: Date;
}

/** Tipo de instrumento legible: «Fondo», «ETF», «Acción»… nunca el código. */
export function instrumentTypeLabel(code?: string): string {
  if (!code) return textoDeAusencia("falta");
  return TYPE_LABELS[code.trim().toUpperCase()] ?? readableBackendLabel(code);
}

const tipoDe = (asset: AssetComparePdfAsset) => asset.instrumentType?.trim().toUpperCase();
const esUnaAccion = (asset: AssetComparePdfAsset) => esAccion(tipoDe(asset));

/** Lo que no aplica: una celda sin cifra que lo dice, distinta de la que falta. */
const NO_APLICA_CELDA: CeldaDeTabla = { texto: null, motivo: "no-aplica" };

/** Una rentabilidad: con su signo y en verde o rojo, mirando la cifra ya redondeada a dos decimales de porcentaje. */
function celdaDeRentabilidad(valor: number | undefined, apunte?: string): CeldaDeTabla {
  return { texto: rentabilidad(valor), signo: signoDe(valor, 4), apunte };
}

/** El Sharpe de una fila. Por el tipo que la misma fila imprime, y no por el número: una acción dice que no aplica, no que falta (decisión 41). */
function celdaDeSharpe(asset: AssetComparePdfAsset): CeldaDeTabla {
  if (!seEnsenaLaMetrica("sharpe", tipoDe(asset))) return NO_APLICA_CELDA;
  return { texto: ratio(asset.sharpe3y), apunte: asset.apuntes?.["sharpe-3y"] };
}

/** Por el tipo, como el Sharpe: las estrellas de una acción no faltan, no le aplican (decisión 83). */
function celdaDeMorningstar({ instrumentType, morningstarRating }: AssetComparePdfAsset): CeldaDeTabla {
  if (!seEnsenaLaMetrica("morningstar", instrumentType?.trim().toUpperCase())) return NO_APLICA_CELDA;
  return typeof morningstarRating === "number" ? `${morningstarRating}/5` : null;
}

/** Una acción no tiene categoría de fondo: su sector, como la pantalla, y sin sector no aplica. Falta el dato queda para el fondo que no la trae (decisión 83). */
function celdaDeCategoria(asset: AssetComparePdfAsset): CeldaDeTabla {
  if (esUnaAccion(asset)) return asset.sector ? asset.sector : NO_APLICA_CELDA;
  /* Sin cortar (decisión 101): a 22 letras, «EAA Fund Global Large…» valía igual para tres categorías. */
  return categoriaLegible(asset.category) ?? null;
}

/** El coste corriente que da la pantalla (ACT-09): «No aplica» en una acción aunque llegue cifra, y la cifra sin color. */
function celdaDeCoste(asset: AssetComparePdfAsset): CeldaDeTabla {
  if (asset.costeCorriente === "no-aplica" || !seEnsenaLaMetrica("costeCorriente", tipoDe(asset))) return NO_APLICA_CELDA;
  return porcentaje(asset.costeCorriente);
}

function celdaDeRetro(asset: AssetComparePdfAsset): CeldaDeTabla {
  if (asset.retro === "no-aplica") return NO_APLICA_CELDA;
  return porcentaje(typeof asset.retro === "number" ? asset.retro : undefined);
}

/**
 * A qué fecha y en qué divisa está cada activo, en una línea, y solo si hay algo que decir: el mismo «a 30/09/2026» que la cabecera de su columna en pantalla si
 * no coinciden, y «con la cifra del proveedor, sin convertir» donde lo sea (decisión 80, hallazgo 35). Los activos van por su número: la hoja no da para más.
 */
function notaDeFechaYDivisa(assets: readonly AssetComparePdfAsset[]): string | null {
  /* Lo que la nota dice de cada grupo de cifras del proveedor: si su celda ya lleva la fecha (decisión A-125), la fecha no se repite aquí, y un
     grupo que solo estaba para decir la fecha no sale. */
  const gruposDe = (asset: AssetComparePdfAsset) =>
    (asset.delProveedor ?? []).flatMap((grupo) => {
      const fechaEnLaCelda = grupo.columnas.every((columna) => Boolean(asset.apuntes?.[COLUMNA_DEL_ROTULO[columna]]));
      if (fechaEnLaCelda && !grupo.sinConvertir) return [];
      return [fechaEnLaCelda ? { ...grupo, fecha: undefined, sinFecha: undefined } : grupo];
    });
  const porActivo = assets.flatMap((asset, index) => {
    const partes = [asset.cierre ? `a ${oFalta(escribirFecha(asset.cierre))}` : null, asset.sinConvertir ? `con la cifra del proveedor, sin convertir (${asset.sinConvertir})` : null].filter(Boolean);
    /* Las del proveedor de una ficha con cifras nuestras, con sus columnas: «rentabilidad 3A, 5A y 10A del proveedor, a 30/09/2026» (revisión final, V3-5).
       Su 1A, «sin fecha» (decisión 114); y las rentabilidades de un activo con todas sus cifras del proveedor, también (decisión 119). */
    const aparte = gruposDe(asset).map(({ columnas, fecha, sinFecha, sinConvertir }) =>
      `${columnasEnPalabras(columnas)} del proveedor${sinConvertir ? `, sin convertir (${sinConvertir})` : ""}${fecha ? `, a ${oFalta(escribirFecha(fecha))}` : sinFecha ? ", sin fecha" : ""}`);
    const todo = [partes.join(", "), ...aparte].filter(Boolean);
    return todo.length > 0 ? [`${index + 1}. ${todo.join("; ")}`] : [];
  });
  if (porActivo.length === 0) return null;
  const aparte = assets.flatMap(gruposDe);
  const queDice = [
    assets.some((asset) => asset.cierre) || aparte.some((grupo) => grupo.fecha || grupo.sinFecha) ? "a su fecha" : null,
    assets.some((asset) => asset.sinConvertir) || aparte.some((grupo) => grupo.sinConvertir) ? "en su divisa" : null
  ].filter(Boolean).join(" y ");
  return `Cada cifra, ${queDice}: ${porActivo.join(" · ")}.`;
}

/** La columna del papel por su rótulo en `CifrasDelProveedorEnElPapel`: «3A» es la rentabilidad a 3 años. */
const COLUMNA_DEL_ROTULO: Record<string, ColumnaDelInforme> = {
  "1A": "annualized_return-1y",
  "3A": "annualized_return-3y",
  "5A": "annualized_return-5y",
  "10A": "annualized_return-10y",
  "Vol 1A": "volatility-1y",
  "Vol 3A": "volatility-3y",
  "Sharpe 3A": "sharpe-3y",
  "Máx. caída 3A": "caida-3y"
};

/** «3A, 5A y 10A» con su rótulo, «rentabilidad», y lo demás como lo rotula su columna: «rentabilidad 10A», «Vol 3A y Sharpe 3A». */
function columnasEnPalabras(columnas: readonly string[]): string {
  const enLista = (lista: readonly string[]) => (lista.length > 1 ? `${lista.slice(0, -1).join(", ")} y ${lista[lista.length - 1]}` : lista[0] ?? "");
  const anos = columnas.filter((columna) => /^\d+A$/.test(columna));
  return enLista([...(anos.length > 0 ? [`rentabilidad ${enLista(anos)}`] : []), ...columnas.filter((columna) => !/^\d+A$/.test(columna))]);
}

/**
 * Lo que se dice bajo las tablas cuando alguna columna no es comparable. De una cifra que no dice de qué sale no se afirma que
 * sea de otro método: se dice que no se puede afirmar lo contrario. Los activos van seguidos: uno por línea, con dos
 * activos el papel pasa de una hoja a dos.
 */
function avisoDeLoNoComparable({ assets, noComparable }: Pick<AssetComparePdfInput, "assets" | "noComparable">): string {
  const cabecera = noComparable?.sinDeclarar
    ? "* No comparable entre sí: en las columnas marcadas no se puede afirmar que las cifras salgan del mismo cálculo."
    : "* No comparable entre sí: las columnas marcadas mezclan métodos de cálculo.";
  const porActivo = assets.flatMap((asset, index) => (asset.calculo ? [`${index + 1}. ${asset.name}: ${asset.calculo}.`] : []));
  return `${cabecera}\n${porActivo.join(" ")}`;
}

/** Ventana corta de una etiqueta de máxima caída: «hist.» o «5A». */
function drawdownWindow(label?: string): string {
  if (!label) return "";
  if (/hist/i.test(label)) return "hist.";
  const match = /(\d+A)\b/.exec(label);
  return match ? match[1] : "";
}

/**
 * Cabecera y sufijo de la columna de máxima caída. Antes la cabecera salía de
 * la ventana del PRIMER activo y se aplicaba a todos, aunque otro midiera otra
 * ventana (auditoría 14-10, MEDIA-18c).
 */
export function drawdownColumn(input: Pick<AssetComparePdfInput, "assets" | "maxDrawdownLabel">): {
  header: string;
  mixed: boolean;
  /** Ventanas que alguna fila muestra de verdad («hist.», «5A»), para la nota. */
  windows: string[];
} {
  /* Solo cuentan las filas con cifra: un activo sin dato no fuerza la mezcla ni
     añade a la nota una ventana que ninguna fila enseña (revisión 14-10). */
  const shown = input.assets.filter((asset) => typeof asset.maxDrawdown === "number" && Number.isFinite(asset.maxDrawdown));
  const labels = new Set(shown.map((asset) => asset.maxDrawdownLabel).filter((label): label is string => Boolean(label)));
  const windows = [...new Set([...labels].map(drawdownWindow).filter(Boolean))];
  if (labels.size > 1) return { header: "Máx. caída", mixed: true, windows };
  return { header: labels.size === 1 ? [...labels][0] : input.maxDrawdownLabel, mixed: false, windows };
}

/** El rótulo de la caída con la palabra del sistema (apartado 6) y la ventana en palabras: «Máx. caída 3A» se imprime «Caída máxima 3 años». */
const conLaPalabraDelSistema = (rotulo: string) => ventanasEnPalabras(rotulo);

const DRAWDOWN_WINDOW_NOTES: Record<string, string> = {
  "hist.": "«hist.» es su histórico completo",
  "5A": "«5 años», los últimos cinco"
};

/* ------------------------------------------------------------------------------------------------ La matriz */

function hexARgb(hex: string): [number, number, number] {
  const valor = hex.replace("#", "");
  return [parseInt(valor.slice(0, 2), 16), parseInt(valor.slice(2, 4), 16), parseInt(valor.slice(4, 6), 16)];
}

function mezcla(desde: string, hasta: string, t: number): string {
  const [r1, g1, b1] = hexARgb(desde);
  const [r2, g2, b2] = hexARgb(hasta);
  const acotado = Math.min(1, Math.max(0, t));
  const canal = (a: number, b: number) => Math.round(a + (b - a) * acotado);
  return `rgb(${canal(r1, r2)}, ${canal(g1, g2)}, ${canal(b1, b2)})`;
}

/**
 * Una sola tinta, la de la cartera en el tema del documento (granate en el de cliente, acero en el interno), de claro a oscuro:
 * claro = baja (diversifica), oscuro = alta. Sin cifra, sin relleno.
 */
function rellenoDeLaCasilla(valor: number | null, tinta: string): string {
  if (valor === null || !Number.isFinite(valor)) return PAPEL.blanco;
  return mezcla(PAPEL.blanco, tinta, (valor + 1) / 2);
}

function tintaDeLaCasilla(valor: number | null): string {
  if (valor === null || !Number.isFinite(valor)) return PAPEL.tinta3;
  /* Letra blanca solo donde el fondo es oscuro de verdad (correlación por encima de 0,6): en los tonos medios, la tinta se lee mejor. */
  return (valor + 1) / 2 > 0.8 ? PAPEL.blanco : PAPEL.tinta;
}

const s = StyleSheet.create({
  matriz: { marginTop: 6 },
  filaDeLaMatriz: { flexDirection: "row", borderBottomWidth: MEDIDAS.tabla.filete, borderBottomColor: PAPEL.filete },
  cabeceraDeLaMatriz: { flexDirection: "row", borderBottomWidth: MEDIDAS.tabla.filete, borderBottomColor: PAPEL.fileteFuerte },
  rotuloDeLaMatriz: { flex: 2.2, fontSize: MEDIDAS.tabla.celda, lineHeight: 1.3, paddingVertical: MEDIDAS.tabla.rellenoVertical, paddingRight: 6 },
  numeroDeLaMatriz: { flex: 1, fontSize: MEDIDAS.tabla.cabecera, fontWeight: 600, color: PAPEL.tinta3, textAlign: "center", lineHeight: 1.3, paddingVertical: MEDIDAS.tabla.rellenoVertical },
  casilla: { flex: 1, justifyContent: "center", paddingVertical: MEDIDAS.tabla.rellenoVertical, borderLeftWidth: MEDIDAS.tabla.filete, borderLeftColor: PAPEL.blanco },
  cifraDeLaCasilla: { fontSize: MEDIDAS.tabla.celda, textAlign: "center", lineHeight: 1.3 },
  ausenciaDeLaCasilla: { fontSize: MEDIDAS.tabla.apunte, textAlign: "center", lineHeight: 1.3 },
  cierre: { marginTop: 6 }
});

function Matriz({ correlation }: { correlation: NonNullable<AssetComparePdfInput["correlation"]> }) {
  const numeroDe = (indice: number) => correlation.numeros?.[indice] ?? indice + 1;
  const { tema } = useInforme();
  const tinta = SERIES_DEL_TEMA[tema].cartera;
  return (
    <View style={s.matriz}>
      <View style={s.cabeceraDeLaMatriz}>
        <Texto style={s.rotuloDeLaMatriz}> </Texto>
        {correlation.labels.map((_rotulo, indice) => (
          <Texto key={`cabecera-${indice}`} style={s.numeroDeLaMatriz}>{String(numeroDe(indice))}</Texto>
        ))}
      </View>
      {correlation.matrix.map((fila, f) => (
        <View key={`fila-${f}`} style={s.filaDeLaMatriz} wrap={false}>
          <Texto style={s.rotuloDeLaMatriz}>{`${numeroDe(f)}. ${correlation.labels[f] ?? ""}`}</Texto>
          {fila.map((valor, c) => {
            const noSeMide = f !== c && Boolean(correlation.noSeMide?.[f] || correlation.noSeMide?.[c]);
            const conCifra = !noSeMide && valor !== null && Number.isFinite(valor);
            /* En la matriz la cifra va siempre impresa: el color la refuerza, no la sustituye. */
            return (
              <View key={`casilla-${f}-${c}`} style={[s.casilla, { backgroundColor: conCifra ? rellenoDeLaCasilla(valor, tinta) : PAPEL.blanco }]}>
                {conCifra ? (
                  <Texto style={[s.cifraDeLaCasilla, { color: tintaDeLaCasilla(valor) }]}>{numero(valor, { decimales: 2 }) ?? ""}</Texto>
                ) : (
                  <Texto style={[s.ausenciaDeLaCasilla, { color: PAPEL.tinta3 }]}>{noSeMide ? NO_SE_MIDE : textoDeAusencia("falta")}</Texto>
                )}
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}

/* ------------------------------------------------------------------------------------------------ El documento */

/** Los números de sección, seguidos, solo para las que salen. */
function numerador() {
  let n = 0;
  return () => {
    n += 1;
    return String(n).padStart(2, "0");
  };
}

/** Varias frases en una nota, una por línea; sin frases, nada. */
function NotaDeLineas({ lineas }: { lineas: readonly string[] }): ReactElement | null {
  return lineas.length > 0 ? <Nota>{lineas.join("\n")}</Nota> : null;
}

function AssetCompareDoc({ input }: { input: AssetComparePdfInput }) {
  const { assets, correlation } = input;
  const interno = input.salida === "interno";
  const hoy = fechaLarga(input.generado ?? new Date()) ?? "";
  const drawdown = drawdownColumn(input);
  const marca = (columna: ColumnaDelInforme) => (input.noComparable?.columnas.includes(columna) ? " *" : "");
  const hayEvolucion = assets.some((asset) => typeof asset.base100 === "number" || asset.sinDividendos || asset.noSeDibuja);
  const hayCoste = assets.some((asset) => asset.costeCorriente !== undefined);
  const hayMatriz = Boolean(correlation && correlation.labels.length >= 2);
  const fechaYDivisa = notaDeFechaYDivisa(assets);
  /* Las cifras apartadas (decisión A-125): cada nota bajo la tabla de su fila. */
  const esDeRentabilidad = (fila: string) => fila.startsWith("annualized_return-");
  const apartadasDeLaRentabilidad = (input.cifrasApartadas ?? []).filter(({ fila }) => esDeRentabilidad(fila)).map(({ nota }) => nota);
  const apartadasDelRiesgo = (input.cifrasApartadas ?? []).filter(({ fila }) => !esDeRentabilidad(fila)).map(({ nota }) => nota);
  const siguiente = numerador();
  const nombre = (asset: AssetComparePdfAsset, indice: number): CeldaDeTabla => `${indice + 1}. ${asset.name}`;

  const columnasDeRiesgo: ColumnaDeTabla[] = [
    { titulo: "Activo", ancho: 2.6 },
    { titulo: `Volatilidad 1 año${marca("volatility-1y")}`, cifra: true },
    { titulo: `Volatilidad 3 años${marca("volatility-3y")}`, cifra: true },
    { titulo: `Sharpe 3 años${marca("sharpe-3y")}`, cifra: true },
    { titulo: `${conLaPalabraDelSistema(drawdown.header)}${marca("caida-3y")}`, ancho: 1.3, cifra: true },
    ...(hayCoste ? [{ titulo: "Coste corriente", cifra: true }] : []),
    ...(interno ? [{ titulo: "Retrocesión", cifra: true }] : [])
  ];

  const cierre = (
    <View style={s.cierre}>
      <Parrafo>Comparativa elaborada con series de precios y cifras del proveedor.</Parrafo>
      <AvisoLegal />
    </View>
  );

  return (
    <DocumentoDeInforme
      tema={interno ? "interno" : "cliente"}
      documento={DOCUMENTO}
      titulo={`${DOCUMENTO} (${assets.length})${interno ? " · uso interno" : ""}`}
      asunto={interno ? "Uso interno del asesor" : undefined}
      identidad={input.identidad ?? leerIdentidad()}
    >
      <Hoja>
        <Presentacion
          contexto={[
            `${assets.length} activos`,
            ventanasEnPalabras(input.windowLabel),
            input.benchmarkName ? `Cartera de referencia: ${input.benchmarkName}` : "Sin cartera de referencia",
            hoy
          ]}
          titulo={DOCUMENTO}
        />

        {/* Seguida y no «arriba del todo»: tras la presentación, el título grande quedaba pegado a su filete corto. */}
        <TituloDeSeccion numero={siguiente()} titulo="Activos comparados" juntoAlTitulo={60} />
        <Tabla
          columnas={[
            { titulo: "Activo", ancho: 2.6 },
            { titulo: "ISIN", ancho: 1.3 },
            /* Fondo, ETF o acción: «Producto», como en la pantalla (apartado 6 del sistema). */
            { titulo: "Producto", ancho: 0.8 },
            { titulo: "Divisa", ancho: 0.6 },
            { titulo: assets.some(esUnaAccion) ? "Categoría o sector" : "Categoría", ancho: 1.9 }
          ]}
          filas={assets.map((asset, indice) => ({
            celdas: [nombre(asset, indice), asset.isin || null, asset.instrumentType ? instrumentTypeLabel(asset.instrumentType) : null, asset.currency || null, celdaDeCategoria(asset)]
          }))}
        />

        <TituloDeSeccion numero={siguiente()} titulo="Rentabilidad anualizada" juntoAlTitulo={60} />
        <Tabla
          columnas={[
            { titulo: "Activo", ancho: 2.6 },
            { titulo: `1 año${marca("annualized_return-1y")}`, cifra: true },
            { titulo: `3 años${marca("annualized_return-3y")}`, cifra: true },
            { titulo: `5 años${marca("annualized_return-5y")}`, cifra: true },
            { titulo: `10 años${marca("annualized_return-10y")}`, cifra: true },
            { titulo: "Morningstar", cifra: true }
          ]}
          filas={assets.map((asset, indice) => ({
            celdas: [
              nombre(asset, indice),
              celdaDeRentabilidad(asset.return1y, asset.apuntes?.["annualized_return-1y"]),
              celdaDeRentabilidad(asset.return3y, asset.apuntes?.["annualized_return-3y"]),
              celdaDeRentabilidad(asset.return5y, asset.apuntes?.["annualized_return-5y"]),
              celdaDeRentabilidad(asset.return10y, asset.apuntes?.["annualized_return-10y"]),
              celdaDeMorningstar(asset)
            ]
          }))}
        />
        <NotaDeLineas lineas={[...(input.notasDeLaSerie ?? []), ...apartadasDeLaRentabilidad]} />

        <TituloDeSeccion numero={siguiente()} titulo={hayCoste ? "Riesgo y coste" : "Riesgo"} juntoAlTitulo={60} />
        <Tabla
          columnas={columnasDeRiesgo}
          filas={assets.map((asset, indice) => {
            const caida = porcentaje(asset.maxDrawdown);
            const ventana = drawdown.mixed && caida !== null ? drawdownWindow(asset.maxDrawdownLabel) : "";
            return {
              celdas: [
                nombre(asset, indice),
                { texto: porcentaje(asset.volatility1y), apunte: asset.apuntes?.["volatility-1y"] },
                { texto: porcentaje(asset.volatility3y), apunte: asset.apuntes?.["volatility-3y"] },
                celdaDeSharpe(asset),
                caida !== null && ventana ? `${caida} · ${ventanasEnPalabras(ventana)}` : caida,
                ...(hayCoste ? [celdaDeCoste(asset)] : []),
                ...(interno ? [celdaDeRetro(asset)] : [])
              ]
            };
          })}
        />
        <NotaDeLineas
          lineas={[
            ...apartadasDelRiesgo,
            ...(drawdown.mixed
              ? [`Caída máxima: cada activo usa la ventana más larga disponible; ${drawdown.windows.map((window) => DRAWDOWN_WINDOW_NOTES[window] ?? `«${window}»`).join(" y ")}.`]
              : []),
            ventanasEnPalabras(`${input.methodologyFootnote}${hayEvolucion ? ` ${DIFIERE_DE_LA_EVOLUCION}` : ""}`),
            ...(fechaYDivisa ? [ventanasEnPalabras(fechaYDivisa)] : [])
          ]}
        />
        {input.noComparable ? <Aviso>{avisoDeLoNoComparable(input)}</Aviso> : null}

        {hayEvolucion ? (
          <>
            {/* El título y su tabla, juntos y enteros: es una fila por activo (seis como mucho: cinco y la referencia), y suelta
                se partía con una fila al pie de una hoja y el resto en la siguiente, con la cabecera repetida (14-11-2026). */}
            <View wrap={false}>
            <TituloDeSeccion
              numero={siguiente()}
              titulo="Evolución comparada (base 100)"
              procedencia={`Valor al cierre de la ventana partiendo de 100. ${ventanasEnPalabras(input.windowLabel)}.${input.benchmarkNote ? ` ${input.benchmarkNote}` : ""}`}
              juntoAlTitulo={60}
            />
            <Tabla
              columnas={[{ titulo: "Serie", ancho: 2.6 }, { titulo: "Base 100", ancho: 1.4, cifra: true }]}
              filas={[
                ...assets.map((asset, indice) => ({
                  celdas: [
                    nombre(asset, indice),
                    asset.sinDividendos ? "Valor liquidativo, sin dividendos" : asset.noSeDibuja ? "No se dibuja" : numero(asset.base100, { decimales: 1 })
                  ]
                })),
                ...(input.benchmarkName && typeof input.benchmarkBase100 === "number"
                  ? [{ celdas: [`${input.benchmarkName} · cartera de referencia`, numero(input.benchmarkBase100, { decimales: 1 })] }]
                  : [])
              ]}
            />
            </View>
            <NotaDeLineas lineas={assets.flatMap((asset) => (asset.noSeDibuja ? [asset.noSeDibuja] : []))} />
          </>
        ) : null}

        {hayMatriz && correlation ? (
          <>
            <TituloDeSeccion
              numero={siguiente()}
              titulo="Matriz de correlación"
              procedencia="Rentabilidades semanales sobre el histórico común · claro = baja (diversifica), oscuro = alta."
              juntoAlTitulo={120}
            />
            {/* Juntas: la matriz y el cierre. El texto legal solo es una hoja casi vacía, y partida deja un trozo al pie de la anterior. */}
            <View wrap={false}>
              {correlation.nota ? <Nota>{correlation.nota}</Nota> : null}
              <Matriz correlation={correlation} />
              {cierre}
            </View>
          </>
        ) : (
          <View wrap={false}>{cierre}</View>
        )}
      </Hoja>
    </DocumentoDeInforme>
  );
}

/** Blob del informe. Separado de la descarga para poder ejercitarlo en tests. */
export async function createAssetComparisonPdfBlob(input: AssetComparePdfInput): Promise<Blob> {
  return renderizarInforme(<AssetCompareDoc input={input} />);
}

/**
 * El nombre del fichero: «Comparativa de activos - A frente a B - 2026-11-14.pdf», con los dos primeros activos y cuántos más hay.
 * El de uso interno lo dice junto al documento, para que no se confunda con el otro en el correo.
 */
export function nombreDelFicheroDeLaComparativa(input: Pick<AssetComparePdfInput, "assets" | "salida" | "generado">): string {
  const nombres = input.assets.map((asset) => asset.name.trim()).filter(Boolean);
  const de = nombres.length > 2 ? `${nombres.slice(0, 2).join(" frente a ")} y ${nombres.length - 2} más` : nombres.join(" frente a ");
  return nombreDelFichero({
    documento: input.salida === "interno" ? `${DOCUMENTO} (uso interno)` : DOCUMENTO,
    de,
    fecha: diaDelDocumento(input.generado)
  });
}

export async function downloadAssetComparisonPdf(input: AssetComparePdfInput): Promise<void> {
  descargar(await createAssetComparisonPdfBlob(input), nombreDelFicheroDeLaComparativa(input));
}
