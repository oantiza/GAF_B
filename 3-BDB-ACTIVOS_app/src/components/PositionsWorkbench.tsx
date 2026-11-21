import { useEffect, useMemo, useState } from "react";
import { getAssetDataSource } from "../adapters/assetDataSource";
import { getCommercialRetroForAssets } from "../adapters/commercialRetroStore";
import { resolvePortfolioBatch } from "../adapters/resolvePortfolioBackend";
import { useCommercialRetroAccess } from "../auth/useCommercialRetroAccess";
import type { AssetDataSourceKind } from "../types/assetDataSource";
import type { BdbAssetDetail } from "../types/bdbAssets";
import type { CommercialRetroRecord } from "../types/commercialRetro";
import { useLatestRequest } from "../core/useLatestRequest";
import { findHomogeneousAlternatives, motivoSinAlternativas, type SwapAlternative } from "../core/fundSwapper";
import { loadSwapUniverse } from "../core/swapUniverse";
import {
  effectiveCommercialRetroPct,
  resolveEffectiveCommercialRetro
} from "../core/commercialRetroEffective";
import { appLogger } from "../core/appLogger";
import { carteraPublicada } from "../core/carteraPublicada";
import { alcanceDeLaCartera, cuentaQueCuadra, rotuloDePosiciones, seExcluyen } from "../core/cuentaDePosiciones";
import { importe, peso } from "../core/formato";
import { summarizeCoveredRate } from "../core/coveredFinancialMetrics";
import { esAccion } from "../core/esAccion";
import { categoriaLegible } from "../core/etiquetasDeReparto";
import { assetRateForAverage, NOTA_DE_LAS_ACCIONES } from "../core/portfolioCosts";
import { textoDeAusencia } from "../core/textoDeAusencia";
import { parsePositionImport, type PositionImportResult } from "../core/positionImport";
import { groupPositionAmounts } from "../core/groupPositionAmounts";
import { importBoxText } from "../core/brokerPortfolioImport";
import { BROKER_IMPORT_ACCEPT, readPositionImportFileText } from "../core/importFileReader";
import {
  describeImportSummary,
  EURO_CONFIRMATION_TEXT,
  INCLUDE_UNPROVEN_KEY,
  INCLUDE_UNPROVEN_YES,
  nextChoiceValues,
  pendingChoices,
  type EuroConfirmation,
  type ImportChoice,
  type ImportChoiceValues,
  type UnprovenPositions
} from "../core/importSummary";
import { ImportChoices, ImportConfirmationTable, IncludeUnprovenBox, UnprovenTable } from "./ImportReview";
import { createSessionSlot } from "../core/sessionCaches";
import {
  csvCell,
  downloadBlob,
  downloadCsv,
  positionRowMatches,
  resolveRowsFromAssets,
  sortPositionRows,
  type PositionFilterStatus,
  type PositionRow,
  type PositionRowStatus,
  type PositionSortDirection
} from "../core/positionsShared";
import { AsyncErrorBanner } from "./AsyncErrorBanner";
import { EmptyState, LoadingState } from "./ui/AsyncState";
import { Button } from "./ui/Button";
import { FileUploadField } from "./ui/FileUploadField";
import { Ausencia } from "./ui/Ausencia";
import { Aviso } from "./ui/Aviso";
import { Campo } from "./ui/Campo";
import { Cifra } from "./ui/Cifra";
import { Distintivo } from "./ui/Distintivo";
import { MenuButton } from "./ui/MenuButton";
import { Respuesta, type DatoDeRespuesta } from "./ui/Respuesta";
import { TablaDeDatos } from "./tabla/TablaDeDatos";
import { TablaDeAlternativas } from "./TablaDeAlternativas";
import {
  columnasDePosiciones,
  filasDePosiciones,
  pieDePosiciones,
  type FilaDePosicion
} from "../adapters/tablaDePosiciones";
import { PageHeader } from "./ui/PageHeader";
import { Panel } from "./ui/Panel";
import { SegmentedTabs, type SegmentedTab } from "./ui/SegmentedTabs";
import { useClientMode } from "../app/ClientModeContext";
import { seEnsena } from "../core/modoCliente";
import { positionsToPortfolio, type PositionsPortfolioTransfer } from "../core/positionsToPortfolio";
import { anotarTraspaso, nombreDelExtracto } from "../core/notaDelTraspaso";
import { useConfirm } from "./ui/useConfirm";
import "../styles/posiciones.css";

/**
 * U-09 (auditoría 29-09). Mesa de trabajo común de «Extracto externo»
 * (`mode="extracto"`: una cartera por importe, con pesos, costes y detalle
 * por fila) y «Posiciones globales» (`mode="global"`: importes acumulados por
 * ISIN, con céntimos, total y exportación a Excel). Antes eran dos copias de
 * 700 líneas que divergían en detalles; ahora las diferencias están en
 * `MODE_CONFIG` y en unas pocas ramas explícitas por `mode`.
 */
export type PositionsWorkbenchMode = "extracto" | "global";

interface PositionsWorkbenchProps {
  mode: PositionsWorkbenchMode;
  sourceKind: AssetDataSourceKind;
  /** Auditoría 11-08 (F4): recibe las posiciones convertidas a peso y las abre
      como cartera activa en el Constructor. Lo inyecta BdbActivosApp (solo Extracto). */
  onSendToBuilder?: (portfolio: PositionsPortfolioTransfer) => void;
  /**
   * Cambia de modo desde la propia pantalla. Cuando viene, la mesa dibuja el selector
   * de los dos modos bajo su cabecera; cuando no, se comporta como antes y el modo lo
   * fija quien la monta. Lo pasa `PosicionesPage` desde el 02-11-2026, cuando los dos
   * modos dejaron de ser dos destinos del rail.
   */
  onModeChange?: (mode: PositionsWorkbenchMode) => void;
}

type SortKey =
  | "id"
  | "amount"
  | "weight"
  | "ongoingPct"
  | "costEur"
  | "retroPct"
  | "cessionPct"
  | "incomeEur"
  | "status";

/* El orden con el que la tabla RECIBE las filas: de mayor importe a menor, que es como se lee un extracto. Dejó de ser
   estado el 03-11-2026, cuando la ordenación pasó a la tabla: nadie lo cambiaba ya, y un `useState` que nunca se escribe
   es estado fingido. Fuera del componente, porque dentro era un objeto nuevo en cada render y reordenaba siempre. */
const ORDEN_INICIAL: { key: SortKey; direction: PositionSortDirection } = { key: "amount", direction: "desc" };

interface ComputedRow extends PositionRow {
  weight: number;
  ongoingPct: number | null;
  costEur: number | null;
  retroPct: number | null;
  retroSourceLabel: string | null;
  cessionPct: number | null;
  incomeEur: number | null;
  status: PositionRowStatus;
}

interface ModeConfig {
  title: string;
  description: (clientMode: boolean) => string;
  importTitle: string;
  importHelp: string;
  fileLabel: string;
  analyzeLabel: (clientMode: boolean) => string;
  /** Decimales de los importes en toda la pantalla (una columna, un número de decimales). */
  amountDigits: number;
  assetColumn: string;
  unitPlural: string;
  recognizedKpi: string;
  missingNote: string;
  footnote: (clientMode: boolean) => string;
  /** Extracto: pesos, costes y detalle por fila. Global: acumula por ISIN, total y Excel. */
  showCosts: boolean;
  showDetail: boolean;
  showTotals: boolean;
  showExcel: boolean;
  groupByIsin: boolean;
}

const MODE_CONFIG: Record<PositionsWorkbenchMode, ModeConfig> = {
  extracto: {
    title: "Extracto externo",
    description: (clientMode) =>
      clientMode
        ? "Analiza el extracto de una cartera por importe: pesos, costes corrientes y estado de cada posición."
        : "Analiza el extracto de una cartera por importe: pesos, costes corrientes, retrocesiones y estado de cada posición.",
    importTitle: "Cargar posiciones por importe",
    importHelp: "Pega las posiciones o carga un CSV/TXT o un extracto de posiciones .xls/.xlsx de Andbank. Admite importes europeos.",
    fileLabel: "Archivo de posiciones",
    analyzeLabel: () => "Analizar cartera",
    /* Los importes, iguales en los dos modos: dos decimales en la tabla. La banda los escribe sin decimales. */
    amountDigits: 2,
    assetColumn: "Activo",
    unitPlural: "posiciones",
    recognizedKpi: "Posiciones reconocidas",
    missingNote: "Se incluyen en el peso, pero no en el cálculo de costes.",
    footnote: (clientMode) =>
      clientMode
        ? "Las alternativas se ordenan por afinidad de producto, clase, región y categoría y, dentro de cada grupo de cifras del mismo cálculo y cierre, por sus métricas."
        : "La retrocesión procede de la base comercial. Costes, medias e ingresos se calculan únicamente con las posiciones de las que se conoce el dato, y se dice qué parte son. Las alternativas se ordenan por afinidad de producto, clase, región y categoría y, dentro de cada grupo de cifras del mismo cálculo y cierre, por sus métricas.",
    showCosts: true,
    showDetail: true,
    showTotals: false,
    showExcel: false,
    groupByIsin: false
  },
  global: {
    title: "Posiciones globales",
    description: (clientMode) =>
      clientMode
        ? "Importes acumulados por fondo, agrupados por ISIN."
        : "Posiciones globales: acumula los importes por ISIN y calcula las retrocesiones de cada fondo, sin desglose por cliente.",
    importTitle: "Cargar cartera global de fondos",
    importHelp:
      "Carga un Excel (.xlsx o .xls), un CSV/TXT o pega las posiciones. El fichero debe incluir ISIN e importe o valor de mercado. Agrupa todas las posiciones del mismo ISIN. Sin límite de fondos por cartera.",
    fileLabel: "Excel o archivo de posiciones",
    analyzeLabel: (clientMode) => (clientMode ? "Agrupar fondos" : "Calcular retrocesiones"),
    amountDigits: 2,
    assetColumn: "Fondo / ISIN",
    unitPlural: "fondos",
    recognizedKpi: "Fondos reconocidos",
    missingNote: "Sus importes se conservan en el patrimonio total.",
    footnote: (clientMode) =>
      clientMode
        ? "Las alternativas se ordenan por afinidad de producto, clase, región y categoría y, dentro de cada grupo de cifras del mismo cálculo y cierre, por sus métricas."
        : "La retrocesión procede de la base comercial. Medias e ingresos se calculan únicamente con las posiciones de las que se conoce el dato, y se dice qué parte son. Las alternativas se ordenan por afinidad de producto, clase, región y categoría y, dentro de cada grupo de cifras del mismo cálculo y cierre, por sus métricas.",
    showCosts: false,
    showDetail: false,
    showTotals: true,
    showExcel: true,
    groupByIsin: true
  }
};

/** Los dos modos, en el orden en que se ofrecen. Los rótulos son los que tenían
    cuando cada uno era un destino del rail, para que nadie pierda el suyo. */
const MODOS: readonly SegmentedTab<PositionsWorkbenchMode>[] = [
  { id: "extracto", label: "Extracto externo" },
  { id: "global", label: "Posiciones globales" }
];

function toDecimal(v?: number | null): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  return v;
}

/* U-08 (auditoría 29-09): la app monta esta pantalla por ruta, así que ir al
   Buscador y volver borraba el extracto pegado y repetía las llamadas. El
   análisis se guarda en una ranura de sesión (memoria; nunca localStorage:
   son datos de clientes) que se restaura al remontar y muere con la sesión.
   Cada modo tiene su ranura: Extracto y Posiciones globales no se pisan. */
interface AnalyzerSessionState {
  sourceKind: AssetDataSourceKind | null;
  text: string;
  rows: PositionRow[] | null;
  detailById: Record<string, BdbAssetDetail>;
  /** Los títulos recibidos de la cartera de cada detalle abierto, con los que se comprueba su cuenta de posiciones; `null` si no llegó. */
  titulosById: Record<string, number | null>;
  retroByAssetId: Map<string, CommercialRetroRecord>;
  /** Filas para las que se cargó `retroByAssetId`: si son las mismas, no se vuelve a consultar. */
  retroRows: PositionRow[] | null;
  cessionCoefficient: number;
  /** Avisos de la importación (N3-10): vuelven con la tabla al volver a la pantalla. */
  importWarnings: string[];
  /** Resumen de la importación (quinta pasada): lo leído, de qué columna, con qué divisa y lo descartado. */
  importSummary: string[];
  /** Lo que el asesor tiene que confirmar (séptima pasada: siempre) y el texto del cuadro al que
      corresponde: la confirmación vale para ESA importación, no para otra. */
  euroCheck: EuroConfirmation | null;
  euroCheckFor: string | null;
  euroConfirmed: boolean;
  /** El último fichero: el texto que dejó en el cuadro y su contenido. Mientras el cuadro no
      cambie, se lee el contenido (sus hojas, tablas y títulos); el cuadro trae lo mismo (I6). */
  fileImport: { text: string; content: string } | null;
  /** Octava pasada: lo que el lector no elige por el asesor (columna de importe, titular) y lo elegido. */
  importChoices: ImportChoice[];
  choiceValues: Record<string, string>;
  /** Novena pasada (I5): lo que la regla de divisa deja fuera sin prueba de EUR, o lo incluido con la segunda casilla. */
  importUnproven: UnprovenPositions | null;
}

function emptySessionState(): AnalyzerSessionState {
  return {
    sourceKind: null,
    text: "",
    rows: null,
    detailById: {},
    titulosById: {},
    retroByAssetId: new Map(),
    retroRows: null,
    cessionCoefficient: 1,
    importWarnings: [],
    importSummary: [],
    euroCheck: null,
    euroCheckFor: null,
    euroConfirmed: false,
    fileImport: null,
    importChoices: [],
    choiceValues: {},
    importUnproven: null
  };
}

const SESSION_SLOTS: Record<PositionsWorkbenchMode, ReturnType<typeof createSessionSlot<AnalyzerSessionState>>> = {
  extracto: createSessionSlot<AnalyzerSessionState>(emptySessionState),
  global: createSessionSlot<AnalyzerSessionState>(emptySessionState)
};

export function PositionsWorkbench({ mode, sourceKind, onSendToBuilder, onModeChange }: PositionsWorkbenchProps) {
  const config = MODE_CONFIG[mode];
  const sessionState = SESSION_SLOTS[mode];
  const { enabled: clientMode } = useClientMode();
  const [restored] = useState<AnalyzerSessionState>(() => {
    const saved = sessionState.read();
    return saved.sourceKind === sourceKind ? saved : emptySessionState();
  });
  const [text, setText] = useState(restored.text);
  const [rows, setRows] = useState<PositionRow[] | null>(restored.rows);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<unknown>(null);
  const [error, setError] = useState<unknown>(null);
  const [importWarnings, setImportWarnings] = useState<string[]>(restored.importWarnings);
  const [importSummary, setImportSummary] = useState<string[]>(restored.importSummary);
  const [euroCheck, setEuroCheck] = useState<EuroConfirmation | null>(restored.euroCheck);
  const [euroCheckFor, setEuroCheckFor] = useState<string | null>(restored.euroCheckFor);
  const [euroConfirmed, setEuroConfirmed] = useState(restored.euroConfirmed);
  const [fileImport, setFileImport] = useState<AnalyzerSessionState["fileImport"]>(restored.fileImport);
  const [importChoices, setImportChoices] = useState<ImportChoice[]>(restored.importChoices);
  const [choiceValues, setChoiceValues] = useState<Record<string, string>>(restored.choiceValues);
  const [importUnproven, setImportUnproven] = useState<UnprovenPositions | null>(restored.importUnproven);
  // M2 e I3 (revisión 6): gana la última lectura de fichero y el último análisis;
  // cambiar el texto o cargar otro fichero deja sin valor lo que estaba en vuelo.
  const fileRequest = useLatestRequest();
  const analyzeRequest = useLatestRequest();
  const [altFor, setAltFor] = useState<string | null>(null);
  const [altRows, setAltRows] = useState<SwapAlternative[] | null>(null);
  const [altLoading, setAltLoading] = useState(false);
  const [altError, setAltError] = useState<unknown>(null);
  // ALTA-12: las alternativas que llegan son siempre las del último «Ver».
  const altRequest = useLatestRequest();
  /* DIS-13: cada «Ver alternativas» pulsado. El bloque sale bajo la tabla entera: con 40 posiciones, fuera de la vista,
     y parecía que el botón no hacía nada. Al pedirlo se lleva allí la vista y el foco. */
  const [alternativasPedidas, setAlternativasPedidas] = useState(0);
  const { confirm, confirmDialog } = useConfirm();
  useEffect(() => {
    if (alternativasPedidas === 0) return;
    const titulo = document.getElementById("positions-alternatives-title");
    if (!titulo) return;
    const sinMovimiento = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    titulo.scrollIntoView?.({ block: "start", behavior: sinMovimiento ? "auto" : "smooth" });
    // El título no es un control: se le deja recibir el foco por código, no con el tabulador.
    titulo.setAttribute("tabindex", "-1");
    titulo.focus({ preventScroll: true });
  }, [alternativasPedidas]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [detailErrorId, setDetailErrorId] = useState<string | null>(null);
  const [detailById, setDetailById] = useState<Record<string, BdbAssetDetail>>(restored.detailById);
  const [titulosById, setTitulosById] = useState<Record<string, number | null>>(restored.titulosById ?? {});
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);
  const [retroByAssetId, setRetroByAssetId] = useState<Map<string, CommercialRetroRecord>>(restored.retroByAssetId);
  const [retroRows, setRetroRows] = useState<PositionRow[] | null>(restored.retroRows);
  const [altRetroByAssetId, setAltRetroByAssetId] = useState<Map<string, CommercialRetroRecord>>(new Map());
  const [retroError, setRetroError] = useState<unknown>(null);
  const [altRetroError, setAltRetroError] = useState<unknown>(null);
  const [retroLoading, setRetroLoading] = useState(false);
  const [retroReloadKey, setRetroReloadKey] = useState(0);
  const [altRetroReloadKey, setAltRetroReloadKey] = useState(0);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterStatus, setFilterStatus] = useState<PositionFilterStatus>("all");
  const [cessionCoefficient, setCessionCoefficient] = useState(restored.cessionCoefficient);
  const dataSource = useMemo(() => getAssetDataSource(sourceKind), [sourceKind]);
  // B4 / R-07: `commercial_retro` solo es legible por admin; sin claim no se
  // consulta y las columnas de retro quedan «sin dato» (las exportaciones siguen).
  const retroAccess = useCommercialRetroAccess();

  useEffect(() => {
    sessionState.write({
      sourceKind,
      text,
      rows,
      detailById,
      titulosById,
      retroByAssetId,
      retroRows,
      cessionCoefficient,
      importWarnings,
      importSummary,
      euroCheck,
      euroCheckFor,
      euroConfirmed,
      fileImport,
      importChoices,
      choiceValues,
      importUnproven
    });
  }, [
    choiceValues,
    cessionCoefficient,
    detailById,
    euroCheck,
    euroCheckFor,
    euroConfirmed,
    fileImport,
    importChoices,
    importSummary,
    importUnproven,
    importWarnings,
    retroByAssetId,
    retroRows,
    rows,
    sessionState,
    sourceKind,
    text,
    titulosById
  ]);

  function parseEntries(content: string, values: ImportChoiceValues = {}): PositionImportResult {
    const { entries, warnings, euroConfirmation, summary } = parsePositionImport(content, values);
    return { entries: config.groupByIsin ? groupPositionAmounts(entries) : entries, warnings, euroConfirmation, summary };
  }

  /** Lo que hay que leer: el contenido del fichero mientras el cuadro sea el que dejó; si no, el cuadro. */
  function parseCurrent(values: ImportChoiceValues): PositionImportResult {
    return parseEntries(fileImport !== null && fileImport.text === text ? fileImport.content : text, values);
  }

  /** Enseña una lectura para revisarla: resumen, elecciones y la lista para confirmar (sin confirmar). */
  function showImport(result: PositionImportResult, forText: string) {
    const confirmation: EuroConfirmation | null =
      result.euroConfirmation ??
      (result.entries.length > 0
        ? { positions: result.entries.map((entry) => ({ id: entry.id, amount: entry.amount, eurStated: false })), reason: "" }
        : null);
    setImportSummary(describeImportSummary({ ...result.summary, euroConfirmation: confirmation }, { positions: false }));
    setImportChoices(result.summary.choices);
    setImportUnproven(result.summary.unproven);
    setEuroCheck(confirmation);
    setEuroCheckFor(confirmation ? forText : null);
    setEuroConfirmed(false);
  }

  /** B1 y B5 (revisión 7): el asesor elige la columna de importe o el titular; la lectura y la confirmación se rehacen. */
  function chooseOption(key: string, value: string) {
    // I1 (revisión 9): otra elección borra la segunda casilla.
    const values = nextChoiceValues(choiceValues, key, value);
    setChoiceValues(values);
    analyzeRequest.invalidate();
    setLoading(false);
    setRows(null);
    setError(null);
    const result = parseCurrent(values);
    setImportWarnings(result.warnings);
    showImport(result, text);
  }

  async function analyze() {
    const result = parseCurrent(choiceValues);
    const { entries, warnings, summary } = result;
    // I1 (revisión 5): los avisos del fichero cargado se conservan y se SUMAN a
    // los de la relectura; antes los de la relectura los sustituían y se perdía,
    // por ejemplo, el de la fila en USD que no había entrado.
    if (warnings.length > 0) setImportWarnings((current) => [...new Set([...current, ...warnings])]);
    if (importSummary.length === 0) {
      setImportSummary(describeImportSummary(summary, { positions: false }));
      setImportChoices(summary.choices);
      setImportUnproven(summary.unproven);
    }
    // Octava pasada: con una elección pendiente (columna de importe, titular) no se confirma ni se analiza.
    if (pendingChoices(summary.choices).length > 0) {
      if (!euroCheck || euroCheckFor !== text || importChoices.length === 0) showImport(result, text);
      setRows(null);
      return;
    }
    if (entries.length === 0) {
      setRows([]);
      return;
    }
    // Séptima pasada: NADA se analiza hasta que el asesor confirma lo que enseña
    // el resumen, y la confirmación vale solo para el texto que la pidió.
    if (!euroConfirmed || euroCheckFor !== text) {
      if (!euroCheck || euroCheckFor !== text) showImport(result, text);
      setRows(null);
      return;
    }
    const request = analyzeRequest.begin();
    setLoading(true);
    setError(null);
    try {
      const resolved =
        sourceKind === "BBDD_LIVE_API"
          ? await resolvePortfolioBatch(entries.map((entry) => ({ asset_id: entry.id, amount: entry.amount })))
          : resolveRowsFromAssets(entries, await dataSource.getComparableAssets(entries.map((entry) => entry.id)));
      if (!analyzeRequest.isCurrent(request)) return;
      setRows(resolved);
    } catch (err) {
      if (!analyzeRequest.isCurrent(request)) return;
      setError(err);
      setRows(null);
    } finally {
      if (analyzeRequest.isCurrent(request)) setLoading(false);
    }
  }

  async function toggleDetail(row: PositionRow) {
    if (!row.asset) return;
    if (expandedId === row.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(row.id);
    if (detailById[row.id]) {
      return;
    }
    setDetailLoadingId(row.id);
    setDetailErrorId(null);
    try {
      const detail = await dataSource.getAssetDetail(row.id);
      if (detail) {
        /* Las líneas de su cartera, para no escribir una cuenta de posiciones que desmienten (`cuentaQueCuadra`). Si no llegan, la
           cuenta es la del proveedor, como antes: el detalle no se pierde por ellas. */
        const cartera =
          detail.holdings_summary?.has_holdings && dataSource.getAssetHoldings
            ? await dataSource.getAssetHoldings(row.id).catch((cause: unknown) => {
                appLogger.warn(`posiciones: fallo al cargar la cartera de ${row.id}`, cause);
                return null;
              })
            : null;
        setTitulosById((current) => ({ ...current, [row.id]: carteraPublicada(cartera)?.titulos ?? null }));
        setDetailById((current) => ({ ...current, [row.id]: detail }));
      }
    } catch (cause) {
      // El detalle bajo demanda no debe romper la tabla ya resuelta, pero el
      // fallo se dice y se registra (auditoría 27-07, T1): antes era invisible.
      appLogger.warn(`posiciones: fallo al cargar el detalle de ${row.id}`, cause);
      setDetailErrorId(row.id);
    } finally {
      /* UI-1 (auditoría del 16-11-2026): se abre una fila, y antes de que conteste, otra. Al llegar la primera respuesta
         se apagaba el «cargando» de la segunda, que seguía esperando. Cada respuesta apaga solo el suyo. */
      setDetailLoadingId((cargando) => (cargando === row.id ? null : cargando));
    }
  }

  async function showAlternatives(asset: BdbAssetDetail | null) {
    if (!asset) {
      return;
    }
    const requestId = altRequest.begin();
    setAltFor(asset.asset_id);
    setAltRows(null);
    setAltLoading(true);
    setAltError(null);
    try {
      const universe = await loadSwapUniverse(dataSource, [asset.instrument_type]);
      if (!altRequest.isCurrent(requestId)) return;
      const exclude = (rows ?? []).map((r) => r.id);
      setAltRows(findHomogeneousAlternatives(asset, universe, exclude));
    } catch (cause) {
      if (!altRequest.isCurrent(requestId)) return;
      setAltRows(null);
      setAltError(cause);
    } finally {
      if (altRequest.isCurrent(requestId)) setAltLoading(false);
    }
  }

  const totalAmount = (rows ?? []).reduce((s, r) => s + (Number.isFinite(r.amount) ? r.amount : 0), 0);
  const computed = useMemo<ComputedRow[]>(
    () =>
      (rows ?? []).map((r) => {
        const weight = totalAmount > 0 ? (r.amount / totalAmount) * 100 : 0;
        const ongoingPct = config.showCosts ? toDecimal(r.asset?.costs?.ongoing_charge) : null;
        const costEur = ongoingPct != null ? ongoingPct * r.amount : null;
        const retro = r.asset ? resolveEffectiveCommercialRetro(r.asset.asset_id, retroByAssetId) : null;
        const retroPct = retro?.pct ?? null;
        const cessionPct = retroPct != null ? retroPct * cessionCoefficient : null;
        const incomeEur = cessionPct != null ? (r.amount * cessionPct) / 100 : null;
        return {
          ...r,
          weight,
          ongoingPct,
          costEur,
          retroPct,
          retroSourceLabel: retro?.sourceLabel ?? null,
          cessionPct,
          incomeEur,
          status: r.asset ? "found" : "missing"
        };
      }),
    [cessionCoefficient, config.showCosts, retroByAssetId, rows, totalAmount]
  );
  const visibleComputed = useMemo(() => {
    const filtered = computed.filter(
      (row) => (filterStatus === "all" || row.status === filterStatus) && positionRowMatches(row, searchTerm)
    );
    const valueOf = (row: ComputedRow): string | number => {
      if (ORDEN_INICIAL.key === "id") return row.asset?.display_name ?? row.id;
      if (ORDEN_INICIAL.key === "status") return row.status;
      return row[ORDEN_INICIAL.key] ?? Number.NEGATIVE_INFINITY;
    };
    return sortPositionRows(filtered, valueOf, ORDEN_INICIAL.direction);
  }, [computed, filterStatus, searchTerm]);
  /* La misma media que el análisis de costes: una acción no tiene coste corriente y cuenta como cero, no como un dato
     que falta. Su fila sigue diciendo «No aplica», porque eso lo pinta `ongoingPct`, que en una acción no trae cifra. */
  const costSummary = useMemo(
    () => summarizeCoveredRate(computed.map((row) => ({
      amount: row.amount,
      rate: config.showCosts ? assetRateForAverage(row.asset) : null
    }))),
    [computed, config.showCosts]
  );
  const hayAcciones = config.showCosts && computed.some((row) => esAccion(row.asset?.instrument_type));
  const soloAcciones = hayAcciones && computed.every((row) => esAccion(row.asset?.instrument_type));
  const retroSummary = useMemo(
    () => summarizeCoveredRate(computed.map((row) => ({ amount: row.amount, rate: row.retroPct }))),
    [computed]
  );
  const totalCost = costSummary.weightedTotal;
  const totalIncome = (retroSummary.weightedTotal * cessionCoefficient) / 100;
  const found = computed.filter((r) => r.asset).length;
  /* 15-11-2026 (hallazgo 19): una posición que la base no pudo leer no es una posición que no esté en el catálogo. Se
     cuenta aparte y se dice que se arregla volviendo a analizar; con un servidor sin actualizar no hay ninguna. */
  const sinLeer = computed.filter((r) => r.sinLeer && r.sinLeer.length > 0);
  const noLeidas = sinLeer.filter((r) => !r.asset).length;
  const missing = computed.length - found - noLeidas;
  const avgCostPct = costSummary.weightedAverage;
  const averageRetroPct = retroSummary.weightedAverage;
  const eur = (value: number | null | undefined) => importe(value, { decimales: config.amountDigits }) ?? textoDeAusencia("falta");

  /* La ordenación es de la tabla desde el 03-11-2026: `setSort`, su marca y su
     `aria-sort` se fueron con los encabezados a mano. `ORDEN_INICIAL` se queda porque
     ordena `computed` antes de filtrar, y eso sigue siendo de la pantalla. */


  /**
   * I3 (revisión 6): otra importación —un fichero nuevo o un texto editado— deja
   * sin valor el resultado anterior y su confirmación. Antes la tabla, el
   * detalle y las alternativas del fichero anterior seguían a la vista con el
   * texto nuevo en el cuadro.
   */
  function clearImportResults() {
    fileRequest.invalidate();
    analyzeRequest.invalidate();
    setLoading(false);
    setExportError(null);
    setImportWarnings([]);
    setImportSummary([]);
    setEuroCheck(null);
    setEuroCheckFor(null);
    setEuroConfirmed(false);
    setFileImport(null);
    setImportChoices([]);
    setChoiceValues({});
    setImportUnproven(null);
    setRows(null);
    setError(null);
    altRequest.invalidate();
    setAltFor(null);
    setAltRows(null);
    setAltLoading(false);
    setAltError(null);
    setExpandedId(null);
    setDetailById({});
    setTitulosById({});
    setRetroByAssetId(new Map());
    setRetroRows(null);
    setAltRetroByAssetId(new Map());
    setRetroError(null);
    setAltRetroError(null);
    setRetroLoading(false);
  }

  /* DIS-24: vacía cuadro, tabla, detalle y confirmación de una vez, y no se puede deshacer: se pregunta. */
  async function resetAnalysis() {
    const seguir = await confirm({
      title: "¿Empezar una carga nueva?",
      message: "Se borran el extracto cargado y su análisis: la tabla, el detalle y las alternativas. No se puede deshacer.",
      confirmLabel: "Borrar y empezar otra",
      tone: "danger"
    });
    if (!seguir) return;
    clearImportResults();
    setText("");
    setSearchTerm("");
    setFilterStatus("all");
  }

  function exportSummaryCsv() {
    // Extracto exporta todo si el filtro deja la tabla vacía; Global exporta lo visible.
    const source = config.showCosts && visibleComputed.length === 0 ? computed : visibleComputed;
    const header = ["ISIN/ID", "Nombre", "Estado", "Retro %", "Coeficiente cesión", "Cesión %", "Importe EUR"];
    if (config.showCosts) header.push("Peso %");
    header.push("Ingreso estimado EUR");
    if (config.showCosts) header.push("Coste corriente %", "Coste anual EUR");
    const lines = [header.join(";")];
    source.forEach((row) => {
      const cells: Array<string | number | null> = [
        row.asset?.isin ?? row.id,
        row.asset?.display_name ?? row.id,
        row.status === "found" ? "Encontrado" : row.sinLeer?.includes("asset") ? "No se pudo leer" : "No encontrado",
        row.retroPct,
        cessionCoefficient,
        row.cessionPct,
        row.amount
      ];
      if (config.showCosts) cells.push(row.weight);
      cells.push(row.incomeEur);
      if (config.showCosts) cells.push(row.ongoingPct != null ? row.ongoingPct * 100 : null, row.costEur);
      lines.push(cells.map(csvCell).join(";"));
    });
    downloadCsv(lines, "resumen_fondos_cesion.csv");
  }

  async function exportExcel() {
    setExporting(true);
    setExportError(null);
    try {
      const { buildGlobalPositionsXlsx } = await import("../core/globalPositionsXlsx");
      const bytes = await buildGlobalPositionsXlsx(
        visibleComputed.map((row) => ({
          id: row.id,
          name: row.asset?.display_name ?? row.id,
          amount: row.amount,
          retroPct: row.retroPct,
          cessionPct: row.cessionPct,
          incomeEur: row.incomeEur,
          status: row.status
        })),
        clientMode
      );
      downloadBlob(
        new Blob([new Uint8Array(bytes)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
        "posiciones_globales.xlsx"
      );
    } catch (cause) {
      setExportError(cause);
    } finally {
      setExporting(false);
    }
  }

  const builderTransfer = useMemo(() => positionsToPortfolio(computed), [computed]);
  function sendToBuilder() {
    if (builderTransfer.positions.length === 0 || !onSendToBuilder) return;
    /* DIS-17: el nombre dice de dónde viene y de qué día, no el del modo; y Diseño dirá qué ha entrado y qué no. */
    const traspaso = { ...builderTransfer, name: nombreDelExtracto() };
    anotarTraspaso(traspaso);
    onSendToBuilder(traspaso);
  }

  useEffect(() => {
    let active = true;
    if (clientMode) {
      /* También se olvida para qué filas se habían pedido: si no, al quitar el modo la pantalla creía
         tenerlas ya, no repetía la consulta y decía «Cobertura de retrocesiones: 0 %» con la base
         entera ahí. */
      setRetroByAssetId(new Map()); setRetroRows(null); setRetroError(null); setRetroLoading(false);
      return () => { active = false; };
    }
    if (rows != null && retroRows === rows) {
      // U-08: retros ya cargadas para estas mismas filas (p. ej. restauradas
      // de la sesión): no se repite la consulta.
      return () => {
        active = false;
      };
    }
    const rowAssets = (rows ?? []).map((row) => row.asset).filter((asset): asset is BdbAssetDetail => Boolean(asset));
    setRetroByAssetId(new Map());
    setRetroError(null);
    if (rowAssets.length === 0 || retroAccess === "denied") {
      setRetroLoading(false);
      setRetroRows(rows);
      return () => {
        active = false;
      };
    }
    setRetroLoading(true);
    if (retroAccess === "pending") {
      return () => {
        active = false;
      };
    }
    /* «Cargando» se apaga junto con los datos, en la misma tanda. En un `finally` llegaba detrás de
       `setRetroRows`, que vuelve a lanzar este efecto: si React pintaba entre medias, `active` ya era
       falso y la pantalla se quedaba diciendo «Cargando…» con las cifras ya en la mano. */
    getCommercialRetroForAssets(rowAssets)
      .then((loaded) => {
        if (!active) return;
        setRetroByAssetId(loaded);
        setRetroRows(rows);
        setRetroLoading(false);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        appLogger.error("No se pudieron cargar las retrocesiones de posiciones.", cause);
        setRetroByAssetId(new Map());
        setRetroError(cause instanceof Error ? cause : new Error("No se pudo cargar la base comercial."));
        setRetroLoading(false);
      });
    return () => {
      active = false;
    };
  }, [clientMode, retroAccess, retroReloadKey, retroRows, rows]);

  useEffect(() => {
    let active = true;
    if (clientMode) {
      setAltRetroByAssetId(new Map()); setAltRetroError(null);
      return () => { active = false; };
    }
    const assets = (altRows ?? []).map((alt) => alt.asset);
    setAltRetroByAssetId(new Map());
    setAltRetroError(null);
    if (assets.length === 0 || retroAccess !== "granted") {
      return () => {
        active = false;
      };
    }
    getCommercialRetroForAssets(assets)
      .then((loaded) => {
        if (active) setAltRetroByAssetId(loaded);
      })
      .catch((cause: unknown) => {
        if (!active) return;
        appLogger.error("No se pudieron cargar las retrocesiones de alternativas.", cause);
        setAltRetroByAssetId(new Map());
        setAltRetroError(cause instanceof Error ? cause : new Error("No se pudo cargar la base comercial de alternativas."));
      });
    return () => {
      active = false;
    };
  }, [altRetroReloadKey, altRows, clientMode, retroAccess]);

  /* La respuesta de la pantalla: qué hay en el extracto, cuánto cuesta y cuánto retrocede. El patrimonio, en grande; los
     importes de la banda, sin decimales (en la tabla llevan dos). Lo que falta se dice con su palabra, nunca con un cero.
     La retrocesión y el ingreso son internos del asesor: no salen en Modo cliente y, a su vista, lo dicen. */
  const cargandoRetro = "Cargando…";
  const interno = (rotulo: string) => (
    <>
      {rotulo} <Distintivo tono="interno">Interno</Distintivo>
    </>
  );
  const retroKpis: DatoDeRespuesta[] = !clientMode
    ? [
        {
          rotulo: interno("Retrocesión media conocida"),
          cifra: retroLoading ? cargandoRetro : <Cifra tipo="porcentaje" valor={averageRetroPct != null ? averageRetroPct / 100 : null} />
        },
        {
          rotulo: interno(retroSummary.coverageRatio < 1 ? "Ingreso identificado" : "Ingreso estimado"),
          cifra: retroLoading ? cargandoRetro : <Cifra tipo="importeTitular" valor={retroSummary.coveredAmount > 0 ? totalIncome : null} />
        }
      ]
    : [];
  const kpis: DatoDeRespuesta[] = [
    { rotulo: "Patrimonio total", cifra: <Cifra tipo="importeTitular" valor={totalAmount} />, principal: true },
    ...(config.showCosts
      ? [
          {
            rotulo: costSummary.coverageRatio < 1 ? "Coste anual identificado" : "Coste corriente anual",
            /* Una acción y un fondo sin dato no suman 0 €: se desconoce. Y solo con acciones no es un cero, porque se leería
               como que sale gratis: no hay coste corriente que dar. */
            cifra: soloAcciones ? (
              <Ausencia clase="no-aplica" />
            ) : (
              <Cifra
                tipo="importeTitular"
                valor={computed.some((row) => row.ongoingPct != null) || (costSummary.coveredAmount > 0 && costSummary.coverageRatio === 1) ? totalCost : null}
              />
            )
          },
          {
            rotulo: "Coste medio conocido",
            cifra: soloAcciones ? <Ausencia clase="no-aplica" /> : <Cifra tipo="porcentaje" valor={avgCostPct} />,
            apunte: hayAcciones ? NOTA_DE_LAS_ACCIONES : undefined
          }
        ]
      : []),
    ...retroKpis,
    { rotulo: config.recognizedKpi, cifra: `${found} de ${computed.length}` }
  ];

  /* La tabla, sus columnas y su pie. El cálculo sigue siendo de esta pantalla; lo que
     se va es el dibujo. */
  const filasDeLaTabla = filasDePosiciones(visibleComputed, config.groupByIsin);
  const columnasDeLaTabla = columnasDePosiciones({
    columnaDelActivo: config.assetColumn,
    conCostes: config.showCosts,
    conRetro: !clientMode,
    conDetalle: config.showDetail,
    decimalesDelImporte: config.amountDigits,
    eur,
    botonDeDetalle: (posicion) =>
      posicion.asset ? (
        <Button
          /* DIS-13: dos «Ver» por fila; el nombre dice cuál y de qué posición. */
          aria-label={`${expandedId === posicion.id ? "Cerrar el detalle de" : "Ver el detalle de"} ${posicion.asset.display_name}`}
          onClick={() => toggleDetail(posicion as ComputedRow)}
          size="sm"
          variant="quiet"
        >
          {detailLoadingId === posicion.id ? "…" : expandedId === posicion.id ? "Cerrar" : "Ver"}
        </Button>
      ) : (
        /* Lo que no se ha reconocido no tiene detalle que abrir. */
        <Ausencia clase="no-aplica" />
      ),
    botonDeAlternativas: (posicion) =>
      posicion.asset ? (
        <Button
          aria-label={`Ver alternativas a ${posicion.asset.display_name}`}
          onClick={() => {
            setAlternativasPedidas((veces) => veces + 1);
            void showAlternatives(posicion.asset!);
          }}
          size="sm"
          variant="secondary"
        >
          Ver
        </Button>
      ) : (
        <Ausencia clase="no-aplica" />
      )
  });
  const pieDeLaTabla = pieDePosiciones(visibleComputed, {
    conRetro: !clientMode,
    retroCargando: retroLoading,
    eur
  });
  const detalleDeLaFila = ({ posicion }: FilaDePosicion) => {
    if (!config.showDetail || expandedId !== posicion.id) return undefined;
    const detalle = detailById[posicion.id];
    if (detalle) {
      /* La cuenta que desmienten sus líneas no se escribe, como en la ficha: queda que la cartera está publicada. */
      const cuenta = cuentaQueCuadra(detalle.holdings_summary?.positions_count, titulosById[posicion.id]);
      /* Hallazgo 20: con un servidor al día, el total de títulos y lo que cubren del patrimonio, en vez del recuento de bonos o de
         acciones que es `positions_count` en la base nueva. Sin él, como antes. */
      const alcance = alcanceDeLaCartera(detalle.holdings_summary, { titulos: titulosById[posicion.id] });
      return (
        <span>
          {detalle.holdings_summary?.has_holdings
            ? alcance
              ? `Cartera publicada: ${alcance}`
              : cuenta !== undefined ? `Cartera publicada: ${rotuloDePosiciones(cuenta)}` : "Cartera publicada"
            : `Cartera publicada: ${textoDeAusencia("falta")}`}
          {categoriaLegible(detalle.category) ? ` · Categoría: ${categoriaLegible(detalle.category)}` : ""}
        </span>
      );
    }
    if (detailLoadingId === posicion.id) return "Cargando detalle…";
    if (detailErrorId === posicion.id) {
      return "No se pudo cargar el detalle (fallo de conexión con la base). Vuelve a intentarlo.";
    }
    return "Detalle no disponible.";
  };
  const choicesPending = pendingChoices(importChoices).length > 0;
  // M1 (revisión 8): lo pendiente va en ocre, también una elección sin posiciones y lo que queda fuera sin incluir.
  const reviewPending =
    (euroCheck !== null && !euroConfirmed) || choicesPending || Boolean(importUnproven && importUnproven.positions.length > 0 && !importUnproven.included);
  const coverageWarning = !clientMode && (
    (config.showCosts && costSummary.coverageRatio < 1) || (!retroLoading && retroSummary.coverageRatio < 1)
  );

  const conPestanas = Boolean(onModeChange) && seEnsena("posicionesGlobales", clientMode);

  /* Las acciones, en la cabecera y solo con un extracto analizado: llevarlo a una propuesta es la principal; las dos
     descargas, secundarias; y «Nueva carga», que borra lo analizado, en «Más», lejos de ellas. */
  const hayAnalisis = rows != null && rows.length > 0;
  const accionesDeCabecera = hayAnalisis ? (
    <>
      {onSendToBuilder ? (
        <Button
          disabled={builderTransfer.positions.length === 0}
          onClick={sendToBuilder}
          title={`Lleva a Diseño, como propuesta nueva, las posiciones que pasan, con un capital de ${importe(builderTransfer.totalCapital) ?? ""}.`}
          variant="primary"
        >
          Llevar a una propuesta
        </Button>
      ) : null}
      {config.showExcel ? (
        <Button
          busy={exporting}
          disabled={loading || visibleComputed.length === 0 || (!clientMode && (retroLoading || Boolean(retroError)))}
          onClick={exportExcel}
          variant="secondary"
        >
          Descargar en Excel
        </Button>
      ) : null}
      {/* Auditoría 11-08 (N3.3): el CSV lleva columnas Retro/Cesión/Ingreso; en modo cliente no se ofrece. */}
      {!clientMode ? (
        <Button disabled={config.showExcel && (retroLoading || Boolean(retroError))} onClick={exportSummaryCsv} variant="secondary">
          Descargar en CSV
        </Button>
      ) : null}
      <MenuButton actions={[{ id: "nueva-carga", label: "Nueva carga", onSelect: () => void resetAnalysis(), danger: true }]} label="Más" />
    </>
  ) : undefined;

  return (
    <section className="positions-page" aria-labelledby="positions-title">
      {/* Con selector, la cabecera es la del DESTINO y el modo baja a pestaña, que es
          el patrón que ya usa Mercado: el título coincide con el rail y va ANTES del
          único nivel de pestañas. Sin selector, cada modo conserva su cabecera, que es
          como se monta en las pruebas y como se montaba cuando eran dos destinos. */}
      <PageHeader
        actions={accionesDeCabecera}
        className="positions-page-head"
        description={config.description(clientMode)}
        eyebrow="Clientes"
        title={onModeChange ? "Posiciones" : config.title}
        titleId="positions-title"
      />

      {/* En Modo cliente no hay nada que elegir: Posiciones globales es el negocio entero de la casa. */}
      {conPestanas && onModeChange ? (
        <SegmentedTabs
          idPrefix="posiciones-modo"
          label="Modo de posiciones"
          onChange={onModeChange}
          tabs={MODOS}
          value={mode}
        />
      ) : null}

      {/* MAR-14: las pestañas cambian lo que hay debajo, el modo entero, así que son pestañas de verdad y ese es su panel.
          Sin pestañas no hay panel que nombrar. El envoltorio separa los bloques como la página (`stack--bloques`). */}
      <div
        className="stack stack--bloques"
        {...(conPestanas ? { id: `posiciones-modo-panel-${mode}`, role: "tabpanel", "aria-labelledby": `posiciones-modo-tab-${mode}` } : {})}
      >

      <Panel claseDelCuerpo="stack stack--tight" titulo={config.importTitle} tituloId="positions-import-title">
        <textarea
          aria-label="Posiciones para analizar"
          className="positions-import-textarea"
          onChange={(event) => {
            setText(event.target.value);
            clearImportResults();
          }}
          placeholder={"Una posición por línea:\nISIN o id; nombre opcional; importe €\nEj.: IE00B4L5Y983; iShares Core MSCI World; 25.000,00"}
          rows={6}
          value={text}
        />
        <div className="positions-import-footer">
          <p>{config.importHelp}</p>
          <div className="positions-import-actions">
            <FileUploadField
              accept={BROKER_IMPORT_ACCEPT}
              className="positions-file-upload"
              label={config.fileLabel}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                // I3: el resultado y la confirmación del fichero anterior dejan de valer ya.
                clearImportResults();
                // M2: si se cargan dos ficheros seguidos, gana el último aunque el primero tarde más.
                const request = fileRequest.begin();
                void readPositionImportFileText(file)
                  .then((content) => {
                    if (!fileRequest.isCurrent(request)) return;
                    const result = parseEntries(content);
                    // I6: el cuadro trae el propio contenido (un HTML, como texto delimitado
                    // si se lee igual): tocarlo aplica la misma regla que leer el fichero.
                    const shown = importBoxText(content);
                    setImportWarnings(result.warnings);
                    showImport(result, shown);
                    setFileImport({ text: shown, content });
                    setText(shown);
                  })
                  .catch((readError: unknown) => {
                    if (!fileRequest.isCurrent(request)) return;
                    appLogger.warn("posiciones: fallo al leer el fichero de posiciones", readError);
                    setError(readError);
                  });
              }}
            />
            <Button busy={loading} disabled={text.trim().length === 0} onClick={analyze} variant="primary">
              {loading ? "Analizando…" : config.analyzeLabel(clientMode)}
            </Button>
          </div>
        </div>
      </Panel>

      {/* Tercera pasada (N-01 a N-06): lo que la importación no ha querido
          adivinar (columna de importe ambigua o que no es un importe, filas
          sin importe o sin identificador) se dice, no se pierde en silencio. */}
      {importWarnings.length > 0 ? (
        <div aria-label="Avisos de la importación" role="group">
          <Aviso anunciar titulo="Avisos de la importación.">
            {importWarnings.join(" ")}
          </Aviso>
        </div>
      ) : null}

      {/* Quinta pasada: red de seguridad. Tras importar se dice siempre qué se
          ha leído (posiciones y euros), de qué columna, con qué criterio de
          divisa, de qué hojas o tablas y qué filas se han descartado. */}
      {importSummary.length > 0 ? (
        /* Lo pendiente va en ocre (aviso); lo ya revisado, en azul claro (nota). El grupo lleva el nombre del resumen. */
        <div aria-label="Resumen de la importación" role="group">
          <Aviso anunciar tono={reviewPending ? "aviso" : "nota"} titulo="Resumen de la importación.">
          <div className="stack stack--tight">
            {importSummary.map((line) => (
              <span key={line}>{line}</span>
            ))}
            {/* Octava pasada (B1, B5): lo que el lector no elige por el asesor. */}
            {importChoices.length > 0 ? <ImportChoices choices={importChoices} onChoose={chooseOption} /> : null}
            {/* Novena pasada (I5): la segunda casilla, desmarcada; lo de fuera, con su importe y su motivo, va en la lista de abajo. */}
            <IncludeUnprovenBox
              unproven={importUnproven}
              disabled={choicesPending}
              onToggle={(include) => chooseOption(INCLUDE_UNPROVEN_KEY, include ? INCLUDE_UNPROVEN_YES : "no")}
            />
            {/* Séptima pasada: nada se analiza hasta que el asesor confirma lo que
                enseña el resumen, posición a posición. Octava: la casilla y el botón,
                juntos y antes de la lista (con 200 posiciones, a la vista). */}
            {euroCheck ? (
              <>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={euroConfirmed}
                    disabled={choicesPending}
                    onChange={(event) => setEuroConfirmed(event.target.checked)}
                  />
                  <span>{EURO_CONFIRMATION_TEXT}</span>
                </label>
                {choicesPending ? (
                  <span>Elige primero arriba; después marca la casilla.</span>
                ) : !euroConfirmed ? (
                  <span>Marca la casilla y pulsa «{config.analyzeLabel(clientMode)}».</span>
                ) : null}
                <div>
                  <Button busy={loading} disabled={!euroConfirmed || choicesPending} onClick={analyze} size="sm" variant="primary">
                    {config.analyzeLabel(clientMode)}
                  </Button>
                </div>
                {!euroConfirmed ? <ImportConfirmationTable positions={euroCheck.positions} /> : null}
              </>
            ) : choicesPending ? (
              <span>Elige arriba para leer el fichero.</span>
            ) : null}
            {!euroConfirmed ? <UnprovenTable unproven={importUnproven} /> : null}
          </div>
          </Aviso>
        </div>
      ) : null}

      {error ? <AsyncErrorBanner error={error} onRetry={analyze} /> : null}

      {rows == null ? null : rows.length === 0 ? (
        <EmptyState
          description="No se ha reconocido ninguna fila válida. Revisa que cada línea incluya un ISIN o identificador y un importe positivo."
          title="No hay posiciones para analizar"
        />
      ) : (
        <>
          <Respuesta datos={kpis} etiqueta="Resumen de posiciones" />

          {!clientMode && retroError ? (
            <AsyncErrorBanner error={retroError} onRetry={() => setRetroReloadKey((current) => current + 1)} />
          ) : null}

          <Panel claseDelCuerpo="stack stack--tight" titulo="Filtrar">
            <div className="posiciones-filtros">
              <Campo className="positions-search-field" rotulo="Buscar">
                <input
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="ISIN, nombre o ticker"
                  type="search"
                  value={searchTerm}
                />
              </Campo>
              {!clientMode ? (
                <Campo rotulo="Estado">
                  <select value={filterStatus} onChange={(event) => setFilterStatus(event.target.value as PositionFilterStatus)}>
                    <option value="all">Todos</option>
                    <option value="found">Reconocidos</option>
                    <option value="missing">No reconocidos</option>
                  </select>
                </Campo>
              ) : null}
              {/* Auditoría 11-08 (N3.2): el coeficiente de cesión es dato comercial;
                  en modo cliente se oculta (el gate anterior solo cubría «Estado»).
                  Control técnico de asesor (0–1, paso 0,05): `type="number"` con `lang="es"`. */}
              {!clientMode ? (
                <Campo pista="De 0 a 1: la parte de la retrocesión que se cede." rotulo={interno("Coeficiente de cesión")}>
                  <input
                    lang="es"
                    max="1"
                    min="0"
                    onChange={(event) => setCessionCoefficient(Math.max(0, Math.min(1, Number(event.target.value) || 0)))}
                    step="0.05"
                    type="number"
                    value={cessionCoefficient}
                  />
                </Campo>
              ) : null}
            </div>
            <p className="positions-filter-note">{visibleComputed.length} de {computed.length} {config.unitPlural} visibles.{!clientMode ? " La cesión estimada aplica el coeficiente a la retrocesión comercial disponible." : ""}</p>
          </Panel>

          {exportError ? <AsyncErrorBanner error={exportError} onRetry={exportExcel} /> : null}

          {onSendToBuilder ? (
            <p className="positions-filter-note">
              A la propuesta: {builderTransfer.positions.length} activos · {importe(builderTransfer.totalCapital)}.
              {builderTransfer.excludedIds.length > 0 ? ` ${seExcluyen(builderTransfer.excludedIds.length)} (${importe(builderTransfer.excludedCapital)}): ${builderTransfer.excludedIds.join(", ")}.` : ""}
            </p>
          ) : null}

          {sinLeer.length > 0 ? (
            <Aviso anunciar titulo={sinLeer.length === 1 ? "Una posición no se pudo leer de la base." : `${sinLeer.length} posiciones no se pudieron leer de la base.`}>
              No es que falten en el catálogo ni que les falte el dato: la base no contestó a tiempo, y de ellas falta la
              ficha o parte de sus cifras. Vuelve a analizar en unos segundos. {sinLeer.map((row) => row.id).join(", ")}.
            </Aviso>
          ) : null}

          {missing > 0 ? (
            <Aviso anunciar titulo={`${missing} ${missing === 1 ? "posición no reconocida" : "posiciones no reconocidas"} en el catálogo.`}>
              {config.missingNote}
            </Aviso>
          ) : null}

          {coverageWarning ? (
            <Aviso anunciar titulo="Datos parciales.">
              {config.showCosts
                ? <>Costes conocidos: {peso(costSummary.coverageRatio)} · retrocesiones conocidas: {retroLoading ? "cargando" : peso(retroSummary.coverageRatio)}.</>
                : <>Retrocesiones conocidas: {retroLoading ? "cargando" : peso(retroSummary.coverageRatio)}.</>}
              {" "}Las medias usan solo el patrimonio con dato; los totales identificados no extrapolan ni imputan cero a lo desconocido.
            </Aviso>
          ) : null}

          <Panel className="positions-table-panel" titulo={`Detalle de ${config.unitPlural}`}>
            {/*
              03-11-2026: la tabla pasa a ser `TablaDeDatos`. Era la mayor de las 49
              escritas a mano de la aplicación y la primera que se rehace contra las
              piezas. Gana lo que la pieza ya sabía y esta no: que lo que falta se
              ordene al final en vez de contar como el valor más bajo, y que una
              ausencia se pinte por su clase. Y le enseñó a la pieza dos cosas que
              otras tres tablas también tienen a mano: el pie de totales y la fila de
              detalle.
            */}
            <TablaDeDatos
              columnas={columnasDeLaTabla}
              deActivos
              detalleDe={detalleDeLaFila}
              filas={filasDeLaTabla}
              pie={config.showTotals ? pieDeLaTabla : undefined}
              rotuloDelPie="Total visible"
              titulo={`Detalle de ${config.unitPlural}`}
            />
          </Panel>

          {altFor ? (
            <Panel
              acciones={<Button onClick={() => { altRequest.invalidate(); setAltFor(null); setAltRows(null); setAltLoading(false); }} size="sm" variant="quiet">Cerrar</Button>}
              claseDelCuerpo="stack stack--tight"
              titulo="Alternativas homogéneas"
              tituloId="positions-alternatives-title"
            >
              {!clientMode && altRetroError ? (
                <AsyncErrorBanner
                  error={altRetroError}
                  onRetry={() => setAltRetroReloadKey((current) => current + 1)}
                />
              ) : null}
              {altLoading ? (
                <LoadingState>Buscando alternativas…</LoadingState>
              ) : altError ? (
                <AsyncErrorBanner
                  error={altError}
                  onRetry={() => showAlternatives((rows ?? []).find((row) => row.asset?.asset_id === altFor)?.asset ?? null)}
                />
              ) : altRows && altRows.length > 0 ? (
                <TablaDeAlternativas
                  alternativas={altRows}
                  retrocesionActual={effectiveCommercialRetroPct(altFor, retroByAssetId)}
                  retrocesiones={altRetroByAssetId}
                  titulo="Alternativas homogéneas"
                />
              ) : (
                <EmptyState
                  description={motivoSinAlternativas((rows ?? []).find((row) => row.asset?.asset_id === altFor)?.asset)}
                  title="Sin alternativas homogéneas"
                />
              )}
            </Panel>
          ) : null}

          <p className="positions-footnote">{config.footnote(clientMode)}</p>
        </>
      )}
      </div>
      {confirmDialog}
    </section>
  );
}
