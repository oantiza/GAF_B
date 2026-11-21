import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { AppRouteId } from "../app/appRoutes";
import type { CicloDeCartera } from "../app/useCicloDeCartera";
import { getAssetDataSource } from "../adapters/assetDataSource";
import { AsyncErrorBanner } from "../components/AsyncErrorBanner";
import {
  PortfolioBuilder,
  type PortfolioBuilderInitialPanel
} from "../components/PortfolioBuilder";
import { buildLocalOptimizationPreview } from "../core/optimizationPreview";
import { importeTitular, oFalta } from "../core/formato";
import { buildLocalPortfolioImport } from "../core/portfolioImport";
import { nextChoiceValues } from "../core/importSummary";
import { buildLocalRiskProfilePreview, RISK_PROFILE_CONTRACTS } from "../core/riskProfilePreview";
import type { ContenidoDeCartera } from "../core/carteraActiva";
import type { PerfilYHorizonte } from "../core/perfilYHorizonte";
import { perfilEnSesion, ranuraDeCartera } from "../core/disenoEnSesion";
import { findSwapAlternatives, type SwapSearchMode } from "../core/fundSwapper";
import { loadSwapUniverse } from "../core/swapUniverse";
import { buildImprovementCandidates, type ImprovementCandidateSet } from "../core/portfolioImprovement";
import type { ImprovementCandidateOptions } from "../components/PortfolioImprovementPanel";
import type { SwapSelectionOptions } from "../core/fundSwapPresentation";
import { useSavedPortfolios } from "../core/useSavedPortfolios";
import { useLatestRequest } from "../core/useLatestRequest";
import { PortfolioReportPage } from "./PortfolioReportPage";
import { fetchBorradorDeCartera, type BorradorDeCartera } from "../adapters/generadorBackend";
import { useAsyncData } from "../core/useAsyncData";
import { leerNotaDelTraspaso, olvidarNotaDelTraspaso } from "../core/notaDelTraspaso";
import type {
  BdbAssetDetail,
  BdbManualPortfolioPosition,
  BdbManualPortfolioSummary,
  BdbOptimizationInput,
  BdbOptimizationPreview,
  BdbPortfolioImportResult,
  BdbRiskProfileId
} from "../types/bdbAssets";
import type { AssetDataSourceKind } from "../types/assetDataSource";

/** Las dos vistas de la página: Constructor (`/cartera`) e Informe de cliente (`/cartera/informes`). */
export type PortfolioPageView = "builder" | "report";

interface PortfolioBuilderPageProps {
  positions: BdbManualPortfolioPosition[];
  setPositions: Dispatch<SetStateAction<BdbManualPortfolioPosition[]>>;
  sourceKind: AssetDataSourceKind;
  /** F-04: `undefined` = capital sin fijar (el Constructor enseña 100.000 € ilustrativos). */
  totalCapital?: number;
  onCapitalChange: (totalCapital: number | undefined) => void;
  /** Ola 1 (E1): nombre de la cartera activa (vive en el shell). */
  portfolioName: string;
  onPortfolioNameChange: (name: string) => void;
  /**
   * CRIT-04 (auditoría 14-10-2026): la vista la decide la ruta y nada más. La
   * página no guarda copia: abrir el informe o volver al Constructor pide al
   * shell que navegue (`onViewChange`) y la URL nueva vuelve como `view`.
   */
  view?: PortfolioPageView;
  onViewChange: (view: PortfolioPageView) => void;
  initialPanel?: PortfolioBuilderInitialPanel;
  /** Qué cartera guardada está abierta, guardarla y preguntar antes de perderla. Lo lleva el marco. */
  ciclo?: CicloDeCartera;
  /** Las salidas de esta pantalla a las demás: el Buscador y Análisis. */
  onIrA?: (destino: AppRouteId) => void;
}

const NO_REPORT_LOCKS: Record<string, number> = {};

/* Una importación pendiente de confirmar es trabajo a medias: si se va a otra pantalla a mirar algo,
   sigue ahí al volver. Memoria de sesión, como el resto: es el extracto de un cliente. */
const importacionEnSesion = ranuraDeCartera<{
  result: BdbPortfolioImportResult | null;
  text: string | null;
  choices: Record<string, string>;
}>(() => ({ result: null, text: null, choices: {} }));

/**
 * Constructor (ola 3b): página autónoma del router. Los handlers de la
 * cartera activa que antes vivían en AssetSearch (838 líneas haciendo de
 * router) están aquí; el estado (posiciones y capital) sigue siendo del
 * shell de la app para que el chip del topbar y las demás páginas lo vean.
 */
export function PortfolioBuilderPage({
  positions,
  setPositions,
  sourceKind,
  totalCapital,
  onCapitalChange,
  portfolioName,
  onPortfolioNameChange,
  view = "builder",
  onViewChange,
  initialPanel = "composition",
  ciclo,
  onIrA
}: PortfolioBuilderPageProps) {
  const [importResult, setImportResult] = useState<BdbPortfolioImportResult | null>(() => importacionEnSesion.read().result);
  // M2 (revisión 6): si se importan dos ficheros seguidos, gana el último.
  const importRequest = useLatestRequest();
  // Octava pasada (B1, B5): el texto importado y lo que el asesor ha elegido (columna de importe, titular).
  const [importText, setImportText] = useState<string | null>(() => importacionEnSesion.read().text);
  const [importChoiceValues, setImportChoiceValues] = useState<Record<string, string>>(() => importacionEnSesion.read().choices);
  useEffect(() => {
    importacionEnSesion.write({ result: importResult, text: importText, choices: importChoiceValues });
  }, [importResult, importText, importChoiceValues]);
  /* Decisión 14: nadie llega con un perfil puesto. Lo elegido se conserva en la sesión, y al cambiar de
     cartera se olvida: el perfil de un cliente no es el del siguiente. Decisión 59: si la cartera que entra
     trae nivel, el ciclo ya ha puesto ese perfil en la sesión, y es lo que se lee aquí. */
  const [selectedRiskProfileId, setSelectedRiskProfileId] = useState<BdbRiskProfileId | null>(() => perfilEnSesion.read());
  const generacion = ciclo?.generacion ?? 0;
  const [generacionVista, setGeneracionVista] = useState(generacion);
  if (generacionVista !== generacion) {
    setGeneracionVista(generacion);
    setSelectedRiskProfileId(perfilEnSesion.read());
  }
  /* Otra cartera remonta el Constructor y se lleva el botón que abrió el diálogo. Sin esto el foco cae en el cuerpo de la
     página, y el siguiente Tab vuelve a «Saltar al contenido». Si el foco sigue en algún sitio, no se le mueve. */
  const generacionEnfocada = useRef(generacion);
  useEffect(() => {
    if (generacionEnfocada.current === generacion) return;
    generacionEnfocada.current = generacion;
    if (document.activeElement && document.activeElement !== document.body) return;
    document.getElementById("contenido-principal")?.focus({ preventScroll: true });
  }, [generacion]);
  function elegirPerfil(perfil: BdbRiskProfileId | null) {
    perfilEnSesion.write(perfil);
    setSelectedRiskProfileId(perfil);
  }
  /* El nivel de la cartera arrastra el perfil elegido; el perfil elegido no toca la cartera. El porqué de esa
     asimetría está en el ciclo (`useCicloDeCartera`), que es quien escribe la sesión: aquí solo se lee. */
  const fijarPerfilYHorizonte = ciclo
    ? (valor: PerfilYHorizonte) => {
        ciclo.fijarPerfilYHorizonte(valor);
        setSelectedRiskProfileId(perfilEnSesion.read());
      }
    : undefined;
  /* Sin marco no hay nada guardado que perder: las pruebas de la página la montan así. */
  const conGuardia = ciclo?.conGuardia ?? ((accion: () => void) => accion());
  function sustituirCartera(contenido: ContenidoDeCartera) {
    if (ciclo) {
      ciclo.sustituir(contenido, null);
      return;
    }
    setPositions(contenido.positions);
    onCapitalChange(contenido.capital);
    onPortfolioNameChange(contenido.nombre);
  }
  function olvidarImportacion() {
    setImportResult(null);
    setImportText(null);
    setImportChoiceValues({});
  }
  /* DIS-17: si se llega desde Posiciones con esta cartera, la nota dice qué ha entrado y qué se ha quedado fuera. */
  const [portfolioNotice, setPortfolioNotice] = useState<string | null>(() => leerNotaDelTraspaso(positions));
  useEffect(() => {
    olvidarNotaDelTraspaso();
  }, []);
  /* Una nota dice cómo está la cartera: «Cartera nueva: sin posiciones, sin capital y sin nombre», «ha vuelto a los
     pesos de antes». En cuanto la cartera cambia, deja de ser cierta y se quita. */
  const huellaDeLoQueHay = JSON.stringify([positions.map((posicion) => [posicion.asset_id, posicion.weight_percent]), totalCapital, portfolioName]);
  const notaYSuCartera = useRef<{ nota: string; huella: string } | null>(null);
  useEffect(() => {
    if (portfolioNotice === null) {
      notaYSuCartera.current = null;
    } else if (notaYSuCartera.current?.nota !== portfolioNotice) {
      notaYSuCartera.current = { nota: portfolioNotice, huella: huellaDeLoQueHay };
    } else if (notaYSuCartera.current.huella !== huellaDeLoQueHay) {
      notaYSuCartera.current = null;
      setPortfolioNotice(null);
    }
  }, [huellaDeLoQueHay, portfolioNotice]);
  const dataSource = useMemo(() => getAssetDataSource(sourceKind), [sourceKind]);
  /* La página ya no captura la frontera histórica de los paneles para el
     informe: PortfolioReport no la usa desde 7519cf0 (el PDF toma la frontera
     del análisis por ventana, fetchPortfolioHorizon), así que la cadena
     historicalFrontier/displayedFrontierRequest se retiró entera (revisión de
     ALTA-20.2, 14-10-2026). */
  /* Aquí no se abre ninguna: eso se hace en Carteras guardadas. Esto es para guardar una propuesta como
     cartera nueva y para no repetir un nombre. */
  const saved = useSavedPortfolios({ sourceKind, onNotice: setPortfolioNotice });

  /* Los candados viajan al informe solo desde el aviso del optimizador tras aplicar una propuesta. Por el menú
     llega sin ellos: en esta pantalla solo los leen los PDF, y el papel no se mueve en esta tanda. Con candados y
     una suma que no llega a 100, el interno añadiría dos bloqueos. Es decisión de Óscar si los recibe siempre. */
  const [reportLockedWeights, setReportLockedWeights] = useState<Record<string, number>>(NO_REPORT_LOCKS);
  useEffect(() => {
    if (view === "builder") setReportLockedWeights(NO_REPORT_LOCKS);
  }, [view]);

  function openReport(lockedWeights: Record<string, number> = NO_REPORT_LOCKS) {
    setReportLockedWeights(lockedWeights);
    onViewChange("report");
  }

  const load = useAsyncData<{
    assets: BdbAssetDetail[];
    summary: BdbManualPortfolioSummary | null;
    optimizationPreview: BdbOptimizationInput | null;
    localOptimizationPreview: BdbOptimizationPreview | null;
  }>(
    async () => {
      const [nextAssets, nextSummary, nextOptimizationPreview] = await Promise.all([
        dataSource.getComparableAssets(positions.map((position) => position.asset_id)),
        dataSource.buildManualPortfolioSummary(positions),
        dataSource.buildManualPortfolioOptimizationPreview(positions)
      ]);
      return {
        assets: nextAssets,
        summary: nextSummary,
        optimizationPreview: nextOptimizationPreview,
        localOptimizationPreview: buildLocalOptimizationPreview({
          sourceKind,
          positions,
          assets: nextAssets,
          summary: nextSummary
        })
      };
    },
    [dataSource, positions, sourceKind],
    /* ANA-20: en la vista Informes nada de esto se pinta (`PortfolioReportPage` pide lo suyo): no se pide. */
    { enabled: view === "builder", initialData: { assets: [], summary: null, optimizationPreview: null, localOptimizationPreview: null } }
  );
  const assets = useMemo(() => load.data?.assets ?? [], [load.data?.assets]);
  const summary = load.data?.summary ?? null;
  const optimizationPreview = load.data?.optimizationPreview ?? null;
  const localOptimizationPreview = load.data?.localOptimizationPreview ?? null;

  const riskProfilePreview = useMemo(() => {
    if (!summary || !selectedRiskProfileId) {
      return null;
    }
    return buildLocalRiskProfilePreview({
      sourceKind,
      selectedProfileId: selectedRiskProfileId,
      positions,
      assets,
      summary
    });
  }, [assets, positions, selectedRiskProfileId, sourceKind, summary]);

  // ------- Handlers de la cartera activa (antes en AssetSearch) -------

  function handleRemove(assetId: string) {
    setPositions((currentPositions) => currentPositions.filter((position) => position.asset_id !== assetId));
  }

  /** «Deshacer» tras quitar una posición: vuelve a su sitio, si no ha vuelto ya. */
  function handleRestorePosition(position: BdbManualPortfolioPosition, index: number) {
    setPositions((currentPositions) =>
      currentPositions.some((current) => current.asset_id === position.asset_id)
        ? currentPositions
        : [...currentPositions.slice(0, index), position, ...currentPositions.slice(index)]
    );
  }

  /** «Volver a los pesos anteriores» de Antes/después. */
  function handleRestorePositions(previous: BdbManualPortfolioPosition[]) {
    setPositions(previous);
    setPortfolioNotice("La cartera ha vuelto a los pesos de antes de aplicar la propuesta.");
  }

  /** «Nueva cartera»: deja Diseño como recién abierto. NO toca las carteras guardadas
   *  (se borran en su pantalla), y si hay cambios sin guardar pregunta antes. */
  function handleReset() {
    conGuardia(() => {
      // F-04: empezar otra deja el capital SIN fijar, no en 100.000 € «reales».
      sustituirCartera({ positions: [], capital: undefined, nombre: "" });
      olvidarImportacion();
      setPortfolioNotice("Cartera nueva: sin posiciones, sin capital y sin nombre.");
    });
  }

  async function handleGuardar(opciones?: { nombre?: string; comoNueva?: boolean }) {
    if (!ciclo) return { ok: false, mensaje: "No se puede guardar desde aquí." };
    const resultado = await ciclo.guardar(opciones);
    /* Si ha ido bien, ya lo dice «Guardada hoy 12:30» junto al nombre. La nota, solo si hay algo más. */
    setPortfolioNotice(resultado.ok && !resultado.conAvisos ? null : resultado.mensaje);
    return resultado;
  }

  function handleWeightChange(assetId: string, weightPercent: number) {
    const nextWeight = Number.isFinite(weightPercent) ? Math.min(Math.max(weightPercent, 0), 100) : 0;
    setPositions((currentPositions) =>
      currentPositions.map((position) =>
        position.asset_id === assetId ? { ...position, weight_percent: nextWeight } : position
      )
    );
  }

  /** Ancla en euros de una posición (`keepEuros`/`targetEuros`), sin tocar su peso. */
  function handlePositionPatch(
    assetId: string,
    patch: Pick<BdbManualPortfolioPosition, "keepEuros" | "targetEuros">
  ) {
    setPositions((currentPositions) =>
      currentPositions.map((position) =>
        position.asset_id === assetId
          ? { ...position, keepEuros: patch.keepEuros, targetEuros: patch.targetEuros }
          : position
      )
    );
  }

  function handleSwap(
    oldId: string,
    newId: string,
    newLabel: string,
    options: SwapSelectionOptions = { preserveMode: "weight" }
  ) {
    setPositions((currentPositions) => {
      if (currentPositions.some((p) => p.asset_id === newId)) return currentPositions;
      return currentPositions.map((p) =>
        p.asset_id === oldId
          ? {
              ...p,
              asset_id: newId,
              label: newLabel,
              keepEuros: options.preserveMode === "money",
              targetEuros: options.preserveMode === "money" ? options.targetEuros : undefined
            }
          : p
      );
    });
    /* Un nombre puede acabar en punto, como «Iberdrola S.A.», y la frase no lleva dos (decisión 80, en el papel).
       DIS-26: con «Mantener €» la posición pasa a importe fijo, y su fila lo marca; la nota dice qué significa. */
    setPortfolioNotice(
      `Posición sustituida por ${newLabel}${newLabel.endsWith(".") ? "" : "."}` +
        (options.preserveMode === "money"
          ? " Conserva su importe: su fila queda marcada «Importe fijo» y no se reescala si cambia el capital («Soltar» lo deshace)."
          : "")
    );
  }

  async function handleImportText(text: string): Promise<void> {
    setImportText(text);
    setImportChoiceValues({});
    await runImport(text, {});
  }

  /** B1 y B5 (revisión 7): el asesor elige la columna de importe o el titular, y la importación se rehace. */
  async function handleChooseImportOption(key: string, value: string): Promise<void> {
    if (importText === null) return;
    // I1 (revisión 9): otra elección borra la segunda casilla.
    const values = nextChoiceValues(importChoiceValues, key, value);
    setImportChoiceValues(values);
    await runImport(importText, values);
  }

  async function runImport(text: string, choices: Record<string, string>): Promise<void> {
    const request = importRequest.begin();
    // La importación anterior, si estaba pendiente, ya no se puede confirmar.
    setImportResult(null);
    const result = await buildLocalPortfolioImport({
      sourceKind,
      text,
      choices,
      resolveAsset: (assetId) => dataSource.getAssetDetail(assetId)
    });
    if (!importRequest.isCurrent(request)) return;

    setImportResult(result);
    if ((result.import_choices ?? []).some((choice) => choice.chosen === null)) {
      // Octava pasada: el lector no elige por el asesor; sin elegir, no se carga nada.
      setPortfolioNotice("Importación pendiente: elige en el resumen la columna de importe o el titular, y después confírmala.");
      return;
    }
    if (result.imported_positions.length > 0 && !result.euro_confirmed) {
      // Séptima pasada: ninguna importación se carga hasta que el asesor confirma
      // en el panel de importar lo que enseña el resumen.
      setPortfolioNotice(
        `Importación pendiente de confirmar: ${result.imported_positions.length} ${result.imported_positions.length === 1 ? "posición" : "posiciones"}. ` +
          "Revisa el resumen y confírmalo para cargarlas."
      );
      return;
    }
    if (result.imported_positions.length > 0) conGuardia(() => applyImportResult(result));
    else applyImportResult(result);
  }

  /** El asesor confirma lo que enseña el resumen: se carga la importación. */
  function handleConfirmImport(): void {
    if (!importResult || importResult.imported_positions.length === 0 || importResult.euro_confirmed) return;
    if ((importResult.import_choices ?? []).some((choice) => choice.chosen === null)) return;
    const confirmed = { ...importResult, euro_confirmed: true };
    conGuardia(() => {
      setImportResult(confirmed);
      applyImportResult(confirmed);
    });
  }

  function applyImportResult(result: BdbPortfolioImportResult): void {
    if (result.imported_positions.length > 0) {
      /* Un extracto de bróker trae el patrimonio, y los pesos salen de repartirlo:
         dejarlo en el capital por defecto encogía la cartera a 100.000 € y falseaba
         todos los importes por posición. */
      const capitalDetectado = result.detected_capital;
      const traeCapital = typeof capitalDetectado === "number" && capitalDetectado > 0;
      /* Decisión 38 de Óscar (05-11-2026): lo importado es otra cartera. Si sustituye a una con posiciones, no hereda
         su nombre ni su capital, que pueden ser los de otro cliente, salvo el capital que traiga el fichero. Sobre una
         vacía, sí: se puede poner el nombre y luego importar. Y nunca es la cartera abierta: «Guardar» no debe pisar la
         de antes. */
      const sustituyeOtra = positions.length > 0;
      const seVaElNombre = sustituyeOtra && portfolioName.trim() !== "";
      const seVaElCapital = sustituyeOtra && !traeCapital && totalCapital !== undefined;
      sustituirCartera({
        positions: result.imported_positions,
        capital: traeCapital ? capitalDetectado : sustituyeOtra ? undefined : totalCapital,
        nombre: sustituyeOtra ? "" : portfolioName
      });
      const rechazadas = result.rejected_positions.length;
      setPortfolioNotice(
        [
          result.imported_positions.length === 1 ? "Importada 1 posición" : `Importadas ${result.imported_positions.length} posiciones`,
          rechazadas === 1 ? " y 1 rechazada" : rechazadas > 1 ? ` y ${rechazadas} rechazadas` : "",
          traeCapital
            ? rechazadas > 0
              ? `. Capital tomado de las posiciones aceptadas del extracto: ${oFalta(importeTitular(capitalDetectado))}`
              : `. Capital tomado del extracto: ${oFalta(importeTitular(capitalDetectado))}`
            : "",
          ".",
          seVaElNombre && seVaElCapital
            ? " El nombre y el capital de la cartera anterior no se conservan."
            : seVaElNombre
              ? " El nombre de la cartera anterior no se conserva."
              : seVaElCapital
                ? " El capital de la cartera anterior no se conserva."
                : ""
        ].join("")
      );
    } else {
      setPortfolioNotice("La importación no ha cargado ninguna posición válida.");
    }
  }

  function handleSaveLocalPortfolio(
    name: string,
    positionsToSave: BdbManualPortfolioPosition[],
    assetsToSave: BdbAssetDetail[],
    capitalToSave: number | undefined
  ) {
    onCapitalChange(capitalToSave);
    /* Decisión 59: la propuesta hereda el nivel y el horizonte de la cartera de la que sale, tal como estén
       en pantalla, también si no tiene: es la misma cartera con otros fondos, para el mismo cliente. */
    void saved.save(name, positionsToSave, assetsToSave, capitalToSave, ciclo?.perfilYHorizonte);
  }

  // Auditoría 27-07 (T3, patrón del antiguo Resumen): identidad estable con
  // refs — cada edición de peso con el modal de sustitución abierto recreaba
  // el callback y relanzaba la búsqueda del universo.
  const findAlternativesDataRef = useRef({ assets, positions });
  useEffect(() => {
    findAlternativesDataRef.current = { assets, positions };
  }, [assets, positions]);
  const findAlternatives = useCallback(
    async (assetId: string, mode: SwapSearchMode = "homogeneous") => {
      const { assets: currentAssets, positions: currentPositions } = findAlternativesDataRef.current;
      const source =
        currentAssets.find((asset) => asset.asset_id === assetId) ?? (await dataSource.getAssetDetail(assetId));
      if (!source) {
        return [];
      }
      const universe = await loadSwapUniverse(dataSource, mode === "homogeneous" ? [source.instrument_type] : undefined);
      return findSwapAlternatives(source, universe, currentPositions.map((position) => position.asset_id), mode, mode === "homogeneous" ? 8 : Number.POSITIVE_INFINITY);
    },
    [dataSource]
  );

  /* «Mejorar cartera» (13-10-2026): el universo son los fondos del catálogo; las
     fichas de los preseleccionados se piden en lotes para no cargar todo el catálogo. */
  const buildImprovementCandidateSet = useCallback(
    async (
      currentPositions: BdbManualPortfolioPosition[],
      currentAssets: BdbAssetDetail[],
      options: ImprovementCandidateOptions
    ): Promise<ImprovementCandidateSet> => {
      const universe = await loadSwapUniverse(dataSource, ["FUND"]);
      return buildImprovementCandidates({
        positions: currentPositions,
        assets: currentAssets,
        universe,
        loadDetails: (ids) => dataSource.getComparableAssets(ids),
        equivalence: { requireSameDistribution: options.requireSameDistribution }
      });
    },
    [dataSource]
  );

  /**
   * El borrador del generador (decisión 122) es otra cartera, como lo importado (decisión 38): si sustituye a una con posiciones,
   * no hereda su nombre ni su capital, y si hay algo sin guardar se pregunta antes.
   */
  function handleUsarBorrador(borrador: BorradorDeCartera) {
    if (borrador.posiciones.length === 0) return;
    conGuardia(() => {
      const sustituyeOtra = positions.length > 0;
      sustituirCartera({
        positions: borrador.posiciones.map((posicion) => ({ asset_id: posicion.asset_id, weight_percent: posicion.peso_pct, label: posicion.nombre })),
        capital: sustituyeOtra ? undefined : totalCapital,
        nombre: sustituyeOtra ? "" : portfolioName
      });
      setPortfolioNotice(
        `Borrador del nivel ${borrador.nivel} (${borrador.nombre_del_nivel}, ${borrador.renta_variable_pct} % de renta variable) con ` +
          `${borrador.posiciones.length} ${borrador.posiciones.length === 1 ? "fondo" : "fondos"}. Borrador automático: no es una recomendación.`
      );
    });
  }

  function handleApplyImprovement(next: BdbManualPortfolioPosition[]) {
    setPositions(next);
    setPortfolioNotice("Sustituciones de «Fondos equivalentes» aplicadas. La cartera guardada original no cambia.");
  }

  if (view === "report") {
    return (
      <PortfolioReportPage
        lockedWeights={reportLockedWeights}
        onBack={() => onViewChange("builder")}
        positions={positions}
        sourceKind={sourceKind}
        totalCapital={totalCapital}
        portfolioName={portfolioName}
        onPortfolioNameChange={onPortfolioNameChange}
        savedPortfolios={saved.savedPortfolios}
        perfilYHorizonte={ciclo?.perfilYHorizonte}
      />
    );
  }

  return (
    <>
      {load.error ? <AsyncErrorBanner error={load.error} onRetry={load.retry} /> : null}
      {/* Auditoría 11-08 (N1): sin `key` por capital. Cada tecla en «Capital
          total» cambiaba el key, desmontaba el Constructor (foco perdido) y
          borraba en silencio su estado local (candados). El capital se
          sincroniza ahora como prop dentro de PortfolioBuilder; el panel
          activo ya se sincroniza con useEffect sobre initialPanel. */}
      <PortfolioBuilder
        /* Otra cartera, otro trabajo: candados, paso y demás arrancan de cero. No es un `key` por capital
           como el que se quitó en N1: esto solo cambia al sustituir la cartera, no al teclear. */
        key={generacion}
        assets={assets}
        cargandoFichas={load.loading}
        initialCapital={totalCapital}
        initialPanel={initialPanel}
        onImportText={handleImportText}
        onConfirmImport={handleConfirmImport}
        onChooseImportOption={(key, value) => void handleChooseImportOption(key, value)}
        onOpenReport={openReport}
        onRemove={handleRemove}
        onReset={handleReset}
        onSaveLocalPortfolio={handleSaveLocalPortfolio}
        guardado={ciclo ? { abierta: ciclo.abierta, sinGuardar: ciclo.sinGuardar, guardando: ciclo.guardando } : undefined}
        onGuardar={handleGuardar}
        onRestorePosition={handleRestorePosition}
        onRestorePositions={handleRestorePositions}
        onIrAlBuscador={onIrA ? () => onIrA("buscador") : undefined}
        onVerAnalisis={onIrA ? () => onIrA("analisis") : undefined}
        onWeightChange={handleWeightChange}
        onPositionPatch={handlePositionPatch}
        onAmountsChange={(update) => {
          setPositions(update.positions);
          onCapitalChange(update.totalCapital);
        }}
        onFindAlternatives={findAlternatives}
        onSwap={handleSwap}
        onBuildImprovementCandidates={buildImprovementCandidateSet}
        onApplyImprovement={handleApplyImprovement}
        onGenerarBorrador={fetchBorradorDeCartera}
        onUsarBorrador={handleUsarBorrador}
        onCapitalChange={onCapitalChange}
        portfolioName={portfolioName}
        onPortfolioNameChange={onPortfolioNameChange}
        perfilYHorizonte={ciclo?.perfilYHorizonte}
        onPerfilYHorizonteChange={fijarPerfilYHorizonte}
        localOptimizationPreview={localOptimizationPreview}
        importResult={importResult}
        optimizationPreview={optimizationPreview}
        portfolioNotice={portfolioNotice}
        positions={positions}
        riskProfilePreview={riskProfilePreview}
        riskProfiles={RISK_PROFILE_CONTRACTS}
        savedPortfolios={saved.savedPortfolios}
        selectedRiskProfileId={selectedRiskProfileId}
        summary={summary}
        onRiskProfileChange={elegirPerfil}
      />
    </>
  );
}
