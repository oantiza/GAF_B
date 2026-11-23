import { usePortfolioHorizon } from "../core/usePortfolioHorizon";
import { fetchPortfolioHorizon } from "../adapters/portfolioHorizon";
import { setAnalysisWindow } from "../core/analysisPreferences";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type {
  BdbAssetDetail,
  BdbManualPortfolioPosition,
  BdbPortfolioLookThrough,
  BdbPortfolioReport,
  BdbSavedLocalPortfolio
} from "../types/bdbAssets";
import type { PortfolioFeasibilityCheck } from "../core/portfolioConstraints";
import { AsyncErrorBanner } from "./AsyncErrorBanner";
import { AvisoDelInforme } from "./AvisoDelInforme";
import { AppError, esFaltaDeDatos, toAppError } from "../core/appError";
import { appLogger } from "../core/appLogger";
import { referenciaMasCercana } from "../core/referenciaPorNivel";
import { nombreDelNivel } from "../core/textoDelNivelDePerfil";
import * as formato from "../core/formato";
import { Aviso } from "./ui/Aviso";
import { useMensaje } from "./ui/useMensaje";
import { Button } from "./ui/Button";
import { Campo } from "./ui/Campo";
import { Distintivo } from "./ui/Distintivo";
import { DialogBody, DialogFooter, DialogHeader, ModalDialog } from "./ui/ModalDialog";
import { PageHeader } from "./ui/PageHeader";
import { SegmentedControl } from "./ui/SegmentedControl";
import { BenchmarkSelect } from "./BenchmarkSelect";
import { DatosDelAsesorDialog } from "./DatosDelAsesorDialog";
import { CONTENIDO_DEL_INFORME_DE_CLIENTE, DialogoDelInformeDeCliente, FirmaDeLosInformes } from "./DialogoDelInformeDeCliente";
import { useBenchmark } from "../app/BenchmarkContext";
import { disenoEnSesion } from "../core/disenoEnSesion";
import { useIdentidadDelInforme } from "../core/identidadDelInforme";
import { useModoCliente } from "../app/ClientModeContext";
import { useCommercialRetroAccess } from "../auth/useCommercialRetroAccess";
import { getAssetDataSource } from "../adapters/assetDataSource";
import { usesBackendPersistence } from "../adapters/portfolioBackend";
import { conLaReplica, loadReportOverlap } from "../core/reportOverlap";
import { entradaDelInformeDeCliente, motivoParaNoGenerarElInformeDeCliente, posicionesDelInformeDeCliente } from "../core/reportPipelineCliente";
import { buildPortfolioLookThrough } from "../core/holdingsLookthrough";
import { cargasDeLaCartera } from "../adapters/carteraDelEmisor";
import type { InternalReportInput, InternalReportWindow } from "../core/internalPortfolioReport";
import { CARTERA_ACTIVA, eleccionDeCarteras, eleccionDeLaPropuesta } from "../core/comparacionDeCarteras";
import { improvementFingerprint, loadImprovementResult } from "../core/improvementResultStore";
import type { PortfolioHorizon } from "../adapters/portfolioHorizon";
import { seriesParadas } from "../adapters/finDeLaSerie";
import { CostsModal } from "./CostsModal";
import type { PerfilYHorizonte } from "../core/perfilYHorizonte";
import { DialogoDeComparativa } from "./DialogoDeComparativa";
import { DialogoDePropuesta } from "./DialogoDePropuesta";
import { Panel } from "./ui/Panel";

interface PortfolioReportProps {
  originalPositions?: BdbManualPortfolioPosition[];
  report: BdbPortfolioReport;
  /** B7: activos con métricas 3A; el PDF dibuja la frontera estimada por
      composición cuando el análisis no trae frontera histórica. */
  assets?: BdbAssetDetail[];
  feasibility: PortfolioFeasibilityCheck;
  lockedWeights?: Record<string, number>;
  /** Solo para el informe completo: en esta pantalla ya no se pinta. */
  lookThrough?: BdbPortfolioLookThrough | null;
  totalCapital?: number;
  /** P3.2: distribución canónica de regiones (computeEquityRegionAllocation) — la
      misma que Resumen/X-Ray. Viaja al PDF del informe de cliente para la geografía. */
  regionRows?: Array<{ key: string; weight_percent: number }>;
  /** El nivel de perfil y el horizonte de la cartera activa: el informe de cliente los pone en la portada si están puestos. */
  perfilYHorizonte?: PerfilYHorizonte;
  /** El nombre real de la cartera activa. Vacío, la pantalla dice «Cartera sin nombre». */
  portfolioName?: string;
  onPortfolioNameChange?: (name: string) => void;
  /** Ir a Diseño de cartera, que es donde se fija el capital y se calcula la mejora. */
  onIrADiseno?: () => void;
  /** Las carteras guardadas: sin dos no hay comparativa. */
  savedPortfolios?: readonly BdbSavedLocalPortfolio[];
}

/* El interno sale aunque la simulación no mida nada, y lo dice dentro: si algún día los datos no dan, no es por eso, y el motivo dice por qué. */
const EL_INTERNO_NO_SE_PUEDE_GENERAR = "No se puede generar este informe con los datos de hoy.";
const AVISO_INTERNO_DESCARTADO = "Informe interno descartado: se activó el Modo cliente y lleva retrocesiones.";

const PERIODOS = [
  { id: "3Y", label: "3 años" },
  { id: "5Y", label: "5 años" }
] as const;

/**
 * En qué estado está un documento antes de una reunión (I1, Óscar, 21-11-2026). «Listo»: sale con lo que hay. «Falta algo»: sale,
 * pero le falta un dato que se pone fuera de su diálogo (el capital, en Diseño). «Bloqueado»: con los datos de hoy no se puede
 * preparar, y su botón no se pulsa. El color refuerza la palabra, no la sustituye.
 *
 * A-200 (Óscar, 21-11-2026): «Bloqueado» va en ocre, como «Falta algo»; el rojo queda para las pérdidas y lo que va «en contra», y
 * la palabra distingue los dos estados. A-201 (el mismo día): lo que solo se pide en el diálogo al pulsar «Preparar» —las dos
 * carteras, Actual y Propuesta, el motivo, el nombre— no es un dato que falte: el documento está «Listo», y su fila dice qué se
 * pedirá (`pide`), sin aviso.
 */
type EstadoDelDocumento = "listo" | "falta" | "bloqueado";

const DISTINTIVO_DEL_ESTADO: Record<EstadoDelDocumento, ReactNode> = {
  listo: <Distintivo tono="marca">Listo</Distintivo>,
  falta: <Distintivo tono="aviso">Falta algo</Distintivo>,
  bloqueado: <Distintivo tono="aviso">Bloqueado</Distintivo>
};

/**
 * Una fila de la lista: qué documento es y en qué estado está (un `Distintivo`), qué contiene en una línea, qué le falta como
 * `Aviso`, con la acción que lo arregla a su derecha (`arreglo`), y su botón. Para quién es lo dice el grupo en que va, «Para el
 * cliente» o «Internos» (I2). El error de un documento que se descarga sin diálogo sale aquí, en su fila, y no arriba de la página.
 */
function Documento({ nombre, bloqueado = false, contiene, pide, falta, arreglo, boton, error }: {
  nombre: string;
  /** Con los datos de hoy no se puede preparar: su botón está desactivado por eso, no porque otro documento se esté preparando. */
  bloqueado?: boolean;
  contiene: string;
  /** Lo que su diálogo pedirá al pulsar «Preparar» (A-201): no cambia el estado, que sigue «Listo». */
  pide?: string;
  falta?: ReactNode;
  /** Lo que lo arregla, si se arregla fuera de esta pantalla: «Fijar en Diseño», «Ir a Optimizar». Solo con `falta`. */
  arreglo?: ReactNode;
  boton: ReactNode;
  error?: ReactNode;
}) {
  const estado: EstadoDelDocumento = bloqueado ? "bloqueado" : falta ? "falta" : "listo";
  return (
    <li className="informes-lista__documento">
      <div className="informes-lista__texto">
        <h3 className="informes-lista__nombre">
          {nombre} {DISTINTIVO_DEL_ESTADO[estado]}
        </h3>
        <p className="informes-lista__contiene">{contiene}</p>
        {pide && !falta ? <p className="informes-lista__contiene">{pide}</p> : null}
        {falta ? <Aviso accion={arreglo}>{falta}</Aviso> : null}
        {error}
      </div>
      <div className="informes-lista__boton">{boton}</div>
    </li>
  );
}

/**
 * «Informes»: los documentos de esta cartera. Decisión 25 de Óscar (04-11-2026).
 *
 * Hasta aquí esta pantalla decía «Vista previa del documento A4» y no lo era: el mapa, la evolución, la
 * frontera y la guía no estaban, y lo que enseñaba no salía en el PDF. Ahora, arriba, los datos con los que
 * se generan los documentos; debajo, cada documento con su público, su botón y lo que le falta. Lo que se
 * pintaba aquí queda en Análisis.
 *
 * **Las funciones de generar no cambian, y los PDF tampoco:** solo se mueve la puerta. El nombre por
 * defecto que imprime el papel sigue siendo el suyo; el «Cartera sin nombre» de aquí es de la pantalla.
 */
export function PortfolioReport({
  report,
  originalPositions,
  assets = [],
  feasibility,
  lockedWeights,
  lookThrough,
  totalCapital,
  regionRows,
  perfilYHorizonte,
  portfolioName = "",
  onPortfolioNameChange,
  onIrADiseno,
  savedPortfolios = []
}: PortfolioReportProps) {
  const { activo: clientMode, seEnsena } = useModoCliente();
  const analyticsPositions: BdbManualPortfolioPosition[] = originalPositions ?? report.positions;
  const huella = improvementFingerprint(analyticsPositions);
  // El benchmark que el usuario haya elegido en Análisis: el informe compara contra ese.
  const { benchmarkId, setBenchmarkId } = useBenchmark();
  const [pdfBusy, setPdfBusy] = useState(false);
  const nivelDeLaCartera = perfilYHorizonte?.risk_profile_level;
  const referenciaCercana = clientMode ? undefined : referenciaMasCercana(nivelDeLaCartera);
  const propuestaDeReferencia = referenciaCercana && referenciaCercana.id !== benchmarkId ? referenciaCercana : undefined;
  const [pdfError, setPdfError] = useState<unknown>(null);
  const [nombre, setNombre] = useState(portfolioName);
  const [clientDialogOpen, setClientDialogOpen] = useState(false);
  const [costesAbiertos, setCostesAbiertos] = useState(false);
  const [comparativaAbierta, setComparativaAbierta] = useState(false);
  const [propuestaAbierta, setPropuestaAbierta] = useState(false);
  // El responsable comercial estaba escrito a mano en la portada del PDF.
  /* Quien firma es la identidad del asesor («Firma de los informes»); el nombre y el contacto ya no se piden en esta pantalla. */
  const { bankerName, bankerEmail, clientName, setClientName } = useIdentidadDelInforme(huella);
  const [firmaAbierta, setFirmaAbierta] = useState(false);

  /* Se mira la composición y no el informe, que se recalcula también al ponerle nombre a la cartera. */
  useEffect(() => {
    setClientDialogOpen(false);
    setPdfError(null);
  }, [huella]);

  const cerrarElDialogoDeCliente = () => {
    setClientDialogOpen(false);
    setPdfError(null);
  };

  useEffect(() => {
    setNombre(portfolioName);
  }, [portfolioName]);

  const nombreEscrito = nombre.trim();
  const confirmarNombre = () => {
    if (nombreEscrito !== portfolioName.trim()) onPortfolioNameChange?.(nombreEscrito);
  };
  /* Lo que imprime el papel se queda como está: sin nombre, su defecto. Con nombre, el que acaba de
     escribirse, aunque el informe aún no se haya recalculado con él. Cada posición lleva la réplica de su ficha, que el solapamiento de los
     dos papeles necesita para decir que un ETF sintético replica con una permuta y no que «no publica». */
  const informe = useMemo(
    () => ({ ...report, ...(nombreEscrito ? { portfolio_name: nombreEscrito } : {}), positions: conLaReplica(report.positions, assets) }),
    [nombreEscrito, report, assets]
  );

  const analyticsLoad = usePortfolioHorizon(analyticsPositions);
  /* Como en Análisis: lo que no se podía a 3 años puede poderse a 5, y el aviso era de lo de antes. */
  useEffect(() => setPdfError(null), [analyticsLoad.window]);
  const capitalFijado = typeof totalCapital === "number" && Number.isFinite(totalCapital) && totalCapital > 0;
  /* INF-1 (auditoría 16-11-2026): con pesos que no suman 100 el informe de cliente no se genera. El de costes y el interno sí:
     normalizan y lo dicen en el papel. Dónde se arregla es una instrucción al asesor; delante del cliente basta con decir que no cuadra. */
  const informeDeClienteBloqueado = motivoParaNoGenerarElInformeDeCliente(report);
  const faltaAlInformeDeCliente = informeDeClienteBloqueado
    ?? (!capitalFijado ? "Capital sin fijar: el informe saldrá sin importes." : undefined);
  /* I1 (21-11-2026): lo que falta, con la acción que lo arregla al lado. Es una instrucción al asesor: delante del cliente basta
     con decir qué falta, y en Modo cliente no sale. Cada una va al paso de Diseño donde se arregla. */
  const irAlPaso = (paso: "compose" | "optimize", texto: string) =>
    onIrADiseno && !clientMode ? (
      <Button
        onClick={() => {
          disenoEnSesion.write({ ...disenoEnSesion.read(), step: paso });
          onIrADiseno();
        }}
        size="sm"
        variant="quiet"
      >
        {texto}
      </Button>
    ) : undefined;
  const fijarElCapital = irAlPaso("compose", "Fijar en Diseño");
  const arregloDelInformeDeCliente = informeDeClienteBloqueado ? irAlPaso("compose", "Ajustar en Diseño") : !capitalFijado ? fijarElCapital : undefined;
  /* Una cartera se guarda en la cabecera de Diseño, con «Guardar» o «Guardar como…», en cualquier paso: se va sin cambiarlo. */
  const guardarEnDiseno =
    onIrADiseno && !clientMode ? (
      <Button onClick={onIrADiseno} size="sm" variant="quiet">
        Guardar en Diseño
      </Button>
    ) : undefined;

  /* 13-10-2026: informe completo para el asesor. Solo fuera del modo cliente: lleva
     retrocesiones e ingresos. Pide el análisis a 3 y 5 años, el solapamiento y las
     retrocesiones; lo que falle se dice en el documento, no lo bloquea. */
  const retroAccess = useCommercialRetroAccess();
  const [internalDialogOpen, setInternalDialogOpen] = useState(false);
  const [internalBusy, setInternalBusy] = useState(false);
  const [internalError, setInternalError] = useState<AppError | null>(null);
  const [internalAnnex, setInternalAnnex] = useState(true);
  const cerrarElDialogoInterno = () => {
    setInternalDialogOpen(false);
    setInternalError(null);
  };
  /* INF-4 (auditoría del 16-11-2026): el informe interno espera dos análisis de hasta cinco minutos cada uno, y mientras
     tanto el diálogo no dejaba hacer nada. Cancelar deja de esperar: el servidor no se puede parar, pero lo que acabe
     calculando se queda en la caché de la sesión y un segundo intento no lo vuelve a pedir. */
  const esperaDelInterno = useRef<AbortController | null>(null);
  const cancelarElInterno = () => {
    esperaDelInterno.current?.abort();
    esperaDelInterno.current = null;
    setInternalBusy(false);
    cerrarElDialogoInterno();
  };
  useEffect(() => () => esperaDelInterno.current?.abort(), []);
  /* H2-05: el informe interno lleva retrocesiones e ingresos. Si se activa el Modo cliente (aquí o en otra pestaña, que lo
     sincroniza) con uno en preparación, se deja de esperar y no se descarga: se avisa de que se descartó. */
  const clientModeRef = useRef(clientMode);
  const { decir } = useMensaje();
  useEffect(() => {
    clientModeRef.current = clientMode;
    if (clientMode && esperaDelInterno.current) {
      cancelarElInterno();
      decir(AVISO_INTERNO_DESCARTADO);
    }
  }, [clientMode]); // eslint-disable-line react-hooks/exhaustive-deps -- solo reacciona al cambio de modo

  const calculoDeMejora = useMemo(() => loadImprovementResult(analyticsPositions), [huella]); // eslint-disable-line react-hooks/exhaustive-deps -- la huella ya contiene ids y pesos
  /* Se guarda cualquier resultado, también el que no encontró nada. Ese no es una propuesta: su papel saldría
     con la hoja casi vacía y «Por qué cada cambio» sin ningún cambio. En Optimizar tampoco se puede exportar. */
  const propuesta = calculoDeMejora && calculoDeMejora.response.proposals.length > 0 ? calculoDeMejora : null;
  const [propuestaBusy, setPropuestaBusy] = useState(false);
  const [propuestaError, setPropuestaError] = useState<AppError | null>(null);

  async function downloadInternalPdf() {
    const espera = new AbortController();
    esperaDelInterno.current = espera;
    const cancelado = () => espera.signal.aborted;
    setInternalBusy(true);
    setInternalError(null);
    try {
      const windows: InternalReportWindow[] = ["3Y", "5Y"];
      const settled = await Promise.allSettled(windows.map((w) => fetchPortfolioHorizon(analyticsPositions, w, espera.signal)));
      if (cancelado()) return;
      const horizons: Partial<Record<InternalReportWindow, PortfolioHorizon | null>> = {};
      const horizonErrors: Partial<Record<InternalReportWindow, string>> = {};
      settled.forEach((result, i) => {
        if (result.status === "fulfilled") horizons[windows[i]] = result.value;
        else horizonErrors[windows[i]] = result.reason instanceof Error ? result.reason.message : "no se pudo calcular";
      });
      /* Las secciones 4.1 y 4.2 del interno: un ETF con la cartera completa de su emisor la usa en vez de la del proveedor (decisión B-79).
         La 4.1 (los subyacentes) es el único sitio donde se enseña esa cartera por dentro; el informe de cliente recibe solo su
         solapamiento ya medido (más abajo, `downloadPdf`). */
      const cargas = cargasDeLaCartera(getAssetDataSource(report.mode), { activos: assets });
      let overlap: InternalReportInput["overlap"] = null;
      let overlapError: string | null = null;
      try {
        overlap = await loadReportOverlap(informe.positions, cargas);
      } catch (error) {
        overlapError = error instanceof Error ? error.message : "no se pudieron cargar los subyacentes";
      }
      /* La de pantalla es la del proveedor, porque de ella salen también las «Mayores acciones» que se ven en Modo cliente. Si falla, se queda. */
      let subyacentes = lookThrough;
      if (cargas.puedeTraerLaDelEmisor && cargas.getAssetHoldings) {
        try {
          subyacentes = await buildPortfolioLookThrough({
            positions: analyticsPositions,
            assets,
            loadHoldings: cargas.getAssetHoldings,
            loadHoldingsMany: cargas.getAssetHoldingsMany
          });
        } catch (error) {
          appLogger.warn("internal report: look-through con la cartera del emisor no disponible; se usa el del proveedor", error);
        }
      }
      let retro: InternalReportInput["retro"] = { status: "denied", records: new Map() };
      if (retroAccess === "granted") {
        try {
          const { getCommercialRetroForAssets } = await import("../adapters/commercialRetroStore");
          const keys = assets.map((asset) => ({ asset_id: asset.asset_id, isin: asset.isin }));
          retro = { status: "ok", records: await getCommercialRetroForAssets(keys) };
        } catch (error) {
          appLogger.error("internal report retro failed", error);
          retro = { status: "error", records: new Map() };
        }
      }
      const generatedAt = new Date().toISOString();
      const paradas = await seriesParadas(analyticsPositions.map((p) => p.asset_id), generatedAt);
      const { downloadInternalPortfolioReportPdf } = await import("../reports/internalPortfolioReportPdf");
      /* Última parada antes de dibujar: un documento que se canceló no se descarga. */
      if (cancelado()) return;
      const descargado = await downloadInternalPortfolioReportPdf({
        report: informe,
        assets,
        positions: analyticsPositions.map((p) => ({ asset_id: p.asset_id, weight_percent: p.weight_percent })),
        totalCapital,
        benchmarkId,
        horizons,
        horizonErrors,
        sinSerie: settled.every((result) => result.status === "rejected" && esFaltaDeDatos(result.reason)),
        lookThrough: subyacentes,
        overlap,
        overlapError,
        retro,
        regionRows,
        feasibility,
        generatedAt,
        seriesParadas: paradas,
        includeAssetSheets: internalAnnex,
        // Decisión 8.6: último cálculo de «Mejorar cartera» de esta misma composición, si lo hay.
        improvement: loadImprovementResult(analyticsPositions)
      }, () => !cancelado() && !clientModeRef.current);
      if (cancelado()) return;
      if (!descargado) {
        /* Se activó el Modo cliente mientras se dibujaba: el documento con retrocesiones no sale. */
        setInternalDialogOpen(false);
        decir(AVISO_INTERNO_DESCARTADO);
        return;
      }
      confirmarNombre();
      setInternalDialogOpen(false);
    } catch (error) {
      if (cancelado()) return;
      appLogger.error("internal portfolio report pdf failed", error);
      /* Como el de cliente (decisión 105): lo que dice el servidor de los datos se conserva, con su código y su motivo; lo demás se reintenta. */
      setInternalError(esFaltaDeDatos(error) ? toAppError(error) : new AppError("BACKEND", "No se pudo generar el informe interno. Reinténtalo en unos segundos.", { cause: error }));
    } finally {
      /* Solo el intento en curso apaga el «Preparando…»: uno cancelado que acaba tarde no toca al siguiente. */
      if (esperaDelInterno.current === espera) {
        esperaDelInterno.current = null;
        setInternalBusy(false);
      }
    }
  }

  async function downloadPdf() {
    if (informeDeClienteBloqueado) return;
    setPdfBusy(true);
    setPdfError(null);
    try {
      const analytics = await fetchPortfolioHorizon(analyticsPositions, analyticsLoad.window);
      const paradas = await seriesParadas(analyticsPositions.map((p) => p.asset_id), new Date().toISOString());

      const { downloadInformeDeClientePdf: descargar, rentabilidadPorDividendoDe } = await import("../reports/informeDeClientePdf");
      /* El solapamiento del papel se mide aquí, con las mismas cargas que la matriz de Análisis: un ETF, con la cartera completa de su
         emisor (decisión del 14-11-2026). El papel no lee esa cartera: recibe la cifra. */
      const overlap = await loadReportOverlap(
        posicionesDelInformeDeCliente(report, assets),
        cargasDeLaCartera(getAssetDataSource(report.mode), { activos: assets })
      );
      /* ANA-01: la entrada la monta la misma función que en Análisis —réplica, Modo cliente, viabilidad con los candados, regiones
         canónicas y dividendos—. El nombre que acaba de escribirse sale en el papel aunque el informe aún no se haya recalculado. */
      await descargar(entradaDelInformeDeCliente({
        overlap,
        report,
        nombreDeLaCartera: nombreEscrito,
        positions: analyticsPositions,
        assets,
        lockedWeights,
        clientMode,
        analysis: analytics,
        seriesParadas: paradas,
        benchmarkId,
        totalCapital,
        clientName,
        banker: { name: bankerName, email: bankerEmail },
        perfilYHorizonte,
        rentabilidadPorDividendoDe
      }));
      confirmarNombre();
      setClientDialogOpen(false);
    } catch (error) {
      appLogger.error("portfolio report pdf failed", error);
      /* Lo que dice el servidor de los datos se conserva tal cual: con su código y su motivo. Decisión 105. */
      setPdfError(esFaltaDeDatos(error) ? error : new AppError("BACKEND", "No se pudo generar el PDF del informe. Reinténtalo en unos segundos.", { cause: error }));
    } finally {
      setPdfBusy(false);
    }
  }

  async function descargarPropuesta() {
    if (!propuesta) return;
    setPropuestaBusy(true);
    setPropuestaError(null);
    try {
      const { downloadImprovementProposalPdf } = await import("../reports/improvementProposalPdf");
      await downloadImprovementProposalPdf({ portfolioName: nombreEscrito, ...propuesta });
    } catch (error) {
      appLogger.error("improvement proposal pdf failed", error);
      setPropuestaError(new AppError("BACKEND", "No se pudo generar la propuesta de mejora. Reinténtalo en unos segundos.", { cause: error }));
    } finally {
      setPropuestaBusy(false);
    }
  }

  const nombreVisible = nombreEscrito || "sin nombre";
  /* Las carteras con las que se puede comparar. Las guardadas en el navegador llevan su fuente; las de la
     cuenta, no hace falta: son todas de la misma. */
  const conLaMismaFuente = usesBackendPersistence(report.mode)
    ? savedPortfolios
    : savedPortfolios.filter((cartera) => cartera.sourceKind === report.mode);
  const hayHistorico = report.mode === "BBDD_LIVE_API";
  const hayDosCarteras = conLaMismaFuente.length >= 2;
  /* La elección es la de Comparar carteras: con Modo cliente, A y B se eligen antes de entrar. */
  const eleccion = eleccionDeCarteras.read();
  const yaElegidas = [eleccion.a, eleccion.b].every((id) => id && conLaMismaFuente.some((cartera) => cartera.portfolio_id === id));
  const comparativaBloqueada = !hayHistorico
    ? "Con los datos de muestra no hay histórico que comparar."
    : !hayDosCarteras
      ? "Faltan dos carteras guardadas."
      : !seEnsena("otrasCarteras") && !yaElegidas
        ? "Las dos carteras se eligen antes de entrar: sal de Modo cliente para elegirlas."
        : undefined;
  /* A-201: elegir las dos carteras se hace en su diálogo; no es un dato que falte. */
  const faltaALaComparativa = comparativaBloqueada;
  const pideLaComparativa = yaElegidas ? undefined : "Al preparar, se eligen las dos carteras.";
  /* La Propuesta de cambio: con la activa y una guardada ya hay dos. Y la misma regla: con Modo cliente, se eligen antes de entrar. */
  const eleccionDePropuesta = eleccionDeLaPropuesta.read();
  const propuestaYaElegida = [eleccionDePropuesta.actual, eleccionDePropuesta.propuesta].every(
    (id) => id === CARTERA_ACTIVA || (id && conLaMismaFuente.some((cartera) => cartera.portfolio_id === id))
  );
  const propuestaDeCambioBloqueada = !hayHistorico
    ? "Con los datos de muestra no hay histórico que comparar."
    : conLaMismaFuente.length === 0
      ? "Falta una cartera guardada con la que comparar la activa."
      : !seEnsena("otrasCarteras") && !propuestaYaElegida
        ? "Actual y Propuesta se eligen antes de entrar: sal de Modo cliente para elegirlas."
        : undefined;
  /* A-201: Actual, Propuesta y el motivo se ponen en su diálogo; no son datos que falten. */
  const faltaALaPropuestaDeCambio = propuestaDeCambioBloqueada;
  const pideLaPropuestaDeCambio = propuestaYaElegida
    ? "Al preparar, se escribe el motivo."
    : "Al preparar, se eligen Actual y Propuesta y se escribe el motivo.";

  /* Un campo de nombre en el diálogo interno mientras la propuesta no lo tenga. Comparte valor con el de arriba. */
  const campoDeNombre = !nombreEscrito ? (
    <Campo pista="La propuesta no tiene nombre: el que escribas sale en el informe y se guarda en la propuesta." rotulo="Nombre de la propuesta">
      <input maxLength={80} onChange={(event) => setNombre(event.target.value)} type="text" value={nombre} />
    </Campo>
  ) : null;
  /* I3 (21-11-2026): el botón de la lista dice «Preparar» en las seis filas, también en la que descarga sin diálogo; el del
     diálogo, «Descargar el informe». */
  const preparar = (documento: string, abrir: () => void, opciones: { disabled?: boolean; primario?: boolean; busy?: boolean } = {}) => (
    <Button
      aria-label={`Preparar: ${documento}`}
      busy={opciones.busy}
      disabled={opciones.disabled}
      onClick={abrir}
      variant={opciones.primario ? "primary" : "secondary"}
    >
      Preparar
    </Button>
  );

  return (
    <article className="informes">
      <PageHeader
        description="Los documentos que se pueden entregar de esta propuesta, y lo que les falta."
        eyebrow={`Propuesta · ${nombreVisible}`}
        title="Informes"
      />

      {/* Los datos con los que salen los documentos. La firma, la del asesor, se escribe una vez en «Tus datos en los informes». */}
      <Panel claseDelCuerpo="stack stack--tight" subtitulo="Con ellos salen todos los documentos de la lista." titulo="Datos de los documentos">
        <div className="informes-datos">
          <Campo rotulo="Nombre de la propuesta">
            <input maxLength={80} onBlur={confirmarNombre} onChange={(event) => setNombre(event.target.value)} type="text" value={nombre} />
          </Campo>
          {/* MAR-10: el capital no se escribe aquí, se lee; va en un `output`, que es lo que un rótulo puede nombrar. */}
          <Campo rotulo="Capital">
            {capitalFijado ? (
              <output className="informes-datos__valor cifra">{formato.importe(totalCapital)}</output>
            ) : (
              <output className="informes-datos__valor">
                <Distintivo tono="aviso">Sin fijar</Distintivo>
                {/* Es una instrucción al asesor: delante del cliente basta con decir que no está. */}
                {onIrADiseno && !clientMode ? (
                  <>
                    {" "}
                    {/* El campo del capital solo está en Componer: a ese paso se va, venga de donde venga. */}
                    <Button
                      onClick={() => {
                        disenoEnSesion.write({ ...disenoEnSesion.read(), step: "compose" });
                        onIrADiseno();
                      }}
                      size="sm"
                      variant="quiet"
                    >
                      Fijar en Diseño
                    </Button>
                  </>
                ) : null}
              </output>
            )}
          </Campo>
          <Campo opcional pista="Vacío, el informe sale sin nombre de cliente." rotulo="Preparado para">
            <input disabled={pdfBusy} maxLength={120} onChange={(event) => setClientName(event.target.value)} type="text" value={clientName} />
          </Campo>
          <div className="stack stack--2">
            <BenchmarkSelect disabled={pdfBusy} />
            {/* Decisión C-26: una propuesta, no un cambio. La referencia es una preferencia de toda la app y solo la
                cambia el asesor al pulsar; trabajo suyo, así que en Modo cliente no se enseña. */}
            {propuestaDeReferencia && nivelDeLaCartera !== undefined ? (
              <p className="field__hint">
                Para el nivel {nivelDeLaCartera}
                {nombreDelNivel(nivelDeLaCartera) ? ` (${nombreDelNivel(nivelDeLaCartera)})` : ""}, la referencia más cercana en renta variable es{" "}
                {propuestaDeReferencia.name}.{" "}
                <Button disabled={pdfBusy} onClick={() => setBenchmarkId(propuestaDeReferencia.id)} size="sm" variant="secondary">
                  Usar {propuestaDeReferencia.name}
                </Button>
              </p>
            ) : null}
          </div>
          <div className="field">
            <span className="field__label">Periodo</span>
            <SegmentedControl label="Periodo" onChange={setAnalysisWindow} options={PERIODOS} value={analyticsLoad.window} />
          </div>
        </div>
        <FirmaDeLosInformes alCambiar={() => setFirmaAbierta(true)} deshabilitado={pdfBusy} />
      </Panel>

      {/* I2 (21-11-2026): dos grupos con título. Para quién es cada documento lo dice su grupo, y su fila dice en qué estado está. */}
      <Panel subtitulo="Se entregan al cliente, en el papel del cliente." titulo="Para el cliente">
        <ul className="informes-lista">
          <Documento
            arreglo={arregloDelInformeDeCliente}
            bloqueado={Boolean(informeDeClienteBloqueado)}
            boton={preparar("Informe de la propuesta", () => setClientDialogOpen(true), { disabled: pdfBusy || Boolean(informeDeClienteBloqueado), primario: true })}
            contiene={CONTENIDO_DEL_INFORME_DE_CLIENTE}
            falta={faltaAlInformeDeCliente}
            nombre="Informe de la propuesta"
          />
          <Documento
            arreglo={fijarElCapital}
            boton={preparar("Costes de la propuesta", () => setCostesAbiertos(true))}
            contiene="Coste corriente de cada posición, media ponderada y, si se añade, la comisión de gestión de la cartera."
            falta={!capitalFijado ? "Capital sin fijar: el informe saldrá en porcentajes." : undefined}
            nombre="Costes de la propuesta"
          />
          <Documento
            /* Las dos carteras se eligen en su diálogo («Preparar»); lo que se arregla fuera es tener dos guardadas. */
            arreglo={hayHistorico && !hayDosCarteras ? guardarEnDiseno : undefined}
            bloqueado={Boolean(comparativaBloqueada)}
            boton={preparar("Comparativa de propuestas", () => setComparativaAbierta(true), { disabled: Boolean(comparativaBloqueada) })}
            contiene="Dos propuestas guardadas en el mismo periodo: evolución, riesgo y composición."
            falta={faltaALaComparativa}
            nombre="Comparativa de propuestas"
            pide={pideLaComparativa}
          />
          <Documento
            arreglo={hayHistorico && conLaMismaFuente.length === 0 ? guardarEnDiseno : undefined}
            bloqueado={Boolean(propuestaDeCambioBloqueada)}
            boton={preparar("Propuesta de cambio", () => setPropuestaAbierta(true), { disabled: Boolean(propuestaDeCambioBloqueada) })}
            contiene="Actual y Propuesta en el mismo periodo: qué cambia en cada posición, rentabilidad, volatilidad y caída, crisis pasadas, coste corriente, motivo y plan de ejecución."
            falta={faltaALaPropuestaDeCambio}
            nombre="Propuesta de cambio"
            pide={pideLaPropuestaDeCambio}
          />
        </ul>
      </Panel>

      {seEnsena("documentosInternos") ? (
        <Panel
          estado={<Distintivo tono="interno">Interno</Distintivo>}
          subtitulo="Documentos de trabajo del asesor: no se entregan al cliente y no salen en Modo cliente."
          titulo="Internos"
        >
          <ul className="informes-lista">
            <Documento
              boton={preparar("Informe interno del asesor", () => setInternalDialogOpen(true), { disabled: pdfBusy || internalBusy })}
              contiene="Todas las cifras de la cartera, incluidas retrocesiones e ingresos estimados. Puede tardar varios minutos, y se puede cancelar."
              nombre="Informe interno del asesor"
            />
            <Documento
              arreglo={propuesta ? undefined : irAlPaso("optimize", "Ir a Optimizar")}
              bloqueado={!propuesta}
              /* Se descarga sin diálogo, y el botón también dice «Preparar» (I3): mientras se genera, se ocupa. */
              boton={preparar("Propuesta de mejora", () => void descargarPropuesta(), { busy: propuestaBusy, disabled: !propuesta || propuestaBusy })}
              contiene="Las sustituciones que ha evaluado «Fondos equivalentes» para esta composición, con su equivalencia y sus descartes."
              error={propuestaError ? <AsyncErrorBanner error={propuestaError} onRetry={() => void descargarPropuesta()} /> : null}
              falta={
                propuesta
                  ? undefined
                  : calculoDeMejora
                    ? "El último cálculo no encontró sustituciones: no hay propuesta que descargar."
                    : "Falta calcularla en Diseño, en Optimizar."
              }
              nombre="Propuesta de mejora"
            />
          </ul>
        </Panel>
      ) : null}

      {clientDialogOpen ? (
        <DialogoDelInformeDeCliente
          alCambiarCliente={setClientName}
          alCambiarNombre={setNombre}
          alCerrar={cerrarElDialogoDeCliente}
          alDescargar={() => void downloadPdf()}
          bloqueo={informeDeClienteBloqueado}
          capital={totalCapital}
          cliente={clientName}
          error={pdfError}
          nombre={nombre}
          ocupado={pdfBusy}
          pedirNombre={!nombreEscrito}
          pesoMedidoPct={analyticsLoad.data?.coverageWeightPercent}
        />
      ) : null}
      <DatosDelAsesorDialog abierto={firmaAbierta} alCerrar={() => setFirmaAbierta(false)} />

      {internalDialogOpen && !clientMode ? <ModalDialog labelledBy="report-internal-title" size="sm" onClose={() => { if (!internalBusy) cerrarElDialogoInterno(); }}>
        <DialogHeader
          titleId="report-internal-title"
          eyebrow="Uso interno del asesor"
          title="Informe interno del asesor"
          onClose={internalBusy ? undefined : cerrarElDialogoInterno}
        />
        <DialogBody className="stack stack--3">
          {/* Dentro, como el del informe de cliente: detrás del diálogo, difuminado, no se leía. */}
          {internalError ? <AvisoDelInforme error={internalError} frase={EL_INTERNO_NO_SE_PUEDE_GENERAR} onRetry={() => void downloadInternalPdf()} /> : null}
          {campoDeNombre}
          <p className="analisis-nota">
            Documento de trabajo con todas las cifras de la cartera, incluidas retrocesiones e ingresos estimados: índice, resumen ejecutivo, posiciones, composición, rentabilidad y riesgo a 3 y 5 años, correlaciones, optimización, costes, calidad del dato y glosario. Calcula el análisis a 3 y 5 años y puede tardar varios minutos; mientras tanto se puede cancelar. No se entrega al cliente.
          </p>
          {/* 14-10-2026: sin cliente ni «Elaborado por»: es un documento de trabajo del
              asesor y la portada lleva cartera, fecha, capital y benchmark. */}
          <label className="check">
            <input type="checkbox" checked={internalAnnex} disabled={internalBusy} onChange={(event) => setInternalAnnex(event.target.checked)} autoFocus />
            Incluir el anexo con la ficha de cada posición
          </label>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={internalBusy ? cancelarElInterno : cerrarElDialogoInterno}>Cancelar</Button>
          <Button variant="primary" busy={internalBusy} disabled={internalBusy || esFaltaDeDatos(internalError)} onClick={() => void downloadInternalPdf()}>{internalBusy ? "Preparando…" : "Descargar el informe"}</Button>
        </DialogFooter>
      </ModalDialog> : null}

      {costesAbiertos ? (
        <CostsModal assets={assets} onClose={() => setCostesAbiertos(false)} positions={analyticsPositions} responsable={{ name: bankerName, email: bankerEmail }} totalCapital={totalCapital} />
      ) : null}
      {comparativaAbierta ? (
        <DialogoDeComparativa carteras={conLaMismaFuente} onClose={() => setComparativaAbierta(false)} sourceKind={report.mode} identidad={{ cliente: clientName, responsable: { name: bankerName, email: bankerEmail } }} />
      ) : null}
      {propuestaAbierta ? (
        <DialogoDePropuesta
          activa={{ name: nombreEscrito, positions: analyticsPositions, capital: totalCapital }}
          carteras={conLaMismaFuente}
          cliente={clientName}
          onClose={() => setPropuestaAbierta(false)}
          responsable={{ name: bankerName, email: bankerEmail }}
          sourceKind={report.mode}
        />
      ) : null}
    </article>
  );
}
