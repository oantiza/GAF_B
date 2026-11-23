import "../styles/analisis.css";
import { setAnalysisWindow, useAnalysisWindow } from "../core/analysisPreferences";
import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from "react";
import { getAssetDataSource } from "../adapters/assetDataSource";
import { cargasDeLaCartera } from "../adapters/carteraDelEmisor";
import { seriesParadas, useSeriesParadas } from "../adapters/finDeLaSerie";
import type { PortfolioHorizon } from "../adapters/portfolioHorizon";
import { APP_ROUTE_PATHS } from "../app/appRoutes";
import { AsyncErrorBanner } from "../components/AsyncErrorBanner";
import { ComposicionDeLaCartera } from "../components/ComposicionDeLaCartera";
import { DialogoDelInformeDeCliente } from "../components/DialogoDelInformeDeCliente";
import { FilasDeReparto, LoQueNoEntra } from "../components/FilasDeReparto";
import { PortfolioDataDiagnostic } from "../components/PortfolioDataDiagnostic";
import { PortfolioReportWarnings } from "../components/PortfolioReportWarnings";
import { ComposicionSubyacente, MayoresAcciones, PortfolioXray } from "../components/PortfolioXray";
import { SaludYControl } from "../components/SaludYControl";
import { XrayMetricsStyle } from "../components/XrayMetricsStyle";
import { RegionAllocation } from "../components/RegionAllocation";
import { RiesgoPorClase } from "../components/RiesgoPorClase";
import { useReportLookThrough } from "../core/reportPipeline";
import { loadReportOverlap } from "../core/reportOverlap";
import { entradaDelInformeDeCliente, motivoParaNoGenerarElInformeDeCliente, posicionesDelInformeDeCliente } from "../core/reportPipelineCliente";
import { XrayAdvanced } from "../components/XrayAdvanced";
import { backtestCoverageNotices } from "../core/backtestCoverage";
import { CLAVE_SIN_DATO_DEL_REPARTO } from "../core/portfolio";
import { evaluatePortfolioHealth } from "../core/portfolioHealth";
import { riesgoMedidoDe } from "../core/riesgoMedido";
import { esSinClasificar } from "../core/riesgoPorClase";
import { checkPortfolioFeasibility, createDefaultPortfolioConstraints } from "../core/portfolioConstraints";
import { AppError, esFaltaDeDatos, limiteDelCalculo, motivoDelServidor, toAppError } from "../core/appError";
import { referenceProfilesForDates } from "../core/benchmarkProfiles";
import * as formato from "../core/formato";
import { CLASS_LABELS, readableBackendLabel } from "../core/labels";
import { colorDeLaClase } from "../core/coloresDeClase";
import { aniosEnPalabras } from "../core/glosarioDePantalla";
import { repartoDeLaCartera } from "../core/radiografiaDeLaCartera";
import {
  aportacionAlRiesgo,
  avisosDePantalla,
  conTramosEstimados,
  cifrasDelProveedorEnOtraDivisa,
  esUnaSolaAccion,
  fueraDeLaMedida,
  idsConPeso,
  leerLaTira,
  MIDIENDO,
  soloAcciones
} from "../core/medidaDeLaCartera";
import { motivoDeQueNoAplique } from "../core/metricasPorInstrumento";
import { seEnsena } from "../core/modoCliente";
import { calculatePortfolioCosts, esSoloDeAcciones } from "../core/portfolioCosts";
import { leerSaludYControl } from "../core/saludYControl";
import { avisoDeSerieParada, posicionesParadas } from "../core/serieParada";
import { usePestanaEnLaDireccion } from "../core/usePestanaEnLaDireccion";
import { useSeriesDeReferencia } from "../core/useSeriesDeReferencia";
import type {
  BdbAssetDetail,
  BdbManualPortfolioPosition,
  BdbPortfolioReport
} from "../types/bdbAssets";
import type { AssetDataSourceKind } from "../types/assetDataSource";
import { useAsyncData } from "../core/useAsyncData";
import { Button } from "../components/ui/Button";
import { EmptyState, LoadingState } from "../components/ui/AsyncState";
import { Aviso } from "../components/ui/Aviso";
import { Cifra } from "../components/ui/Cifra";
import { Distintivo } from "../components/ui/Distintivo";
import { Esqueleto } from "../components/ui/Esqueleto";
import { ListaDePartes } from "../components/ui/ListaDePartes";
import { PageHeader } from "../components/ui/PageHeader";
import { Panel } from "../components/ui/Panel";
import { Respuesta, type DatoDeRespuesta } from "../components/ui/Respuesta";
import { SegmentedControl } from "../components/ui/SegmentedControl";
import { PanelDePestana, SegmentedTabs } from "../components/ui/SegmentedTabs";
import { useClientMode } from "../app/ClientModeContext";
import { useBenchmark } from "../app/BenchmarkContext";
import { BenchmarkSelect } from "../components/BenchmarkSelect";
import { useIdentidadDelInforme } from "../core/identidadDelInforme";
import { improvementFingerprint } from "../core/improvementResultStore";
import type { PerfilYHorizonte } from "../core/perfilYHorizonte";
import { calculateUnderwaterSeries } from "../core/underwater";

interface XrayPageProps {
  positions: BdbManualPortfolioPosition[];
  sourceKind: AssetDataSourceKind;
  totalCapital?: number;
  /** B6: nombre real de la cartera activa (chip del shell); cabecera del informe y de los PDF. */
  portfolioName?: string;
  /** Guarda el nombre que se le ponga a la cartera en el diálogo del informe, como en Informes. Sin él, el nombre sale en el papel y no se guarda. */
  onPortfolioNameChange?: (name: string) => void;
  /** El nivel de perfil y el horizonte de la cartera activa: el informe de cliente los pone en la portada si están puestos. */
  perfilYHorizonte?: PerfilYHorizonte;
  onBack: () => void;
  /**
   * «Abrir en Diseño». Sin él, el enlace lleva a la dirección de Diseño sin recargar la aplicación (la misma que el menú), y
   * con Ctrl o el botón central se abre en otra pestaña.
   */
  onIrADiseno?: () => void;
}

/* Las seis preguntas de Análisis (rediseño, 14-11-2026): el detalle, a un clic; la pestaña, en la dirección. «Datos» es del
   asesor y no existe en Modo cliente. */
type Pestana = "resumen" | "exposicion" | "fondos" | "referencia" | "diversificacion" | "datos";

const PESTANAS: { id: Pestana; label: string }[] = [
  { id: "resumen", label: "Resumen" },
  { id: "exposicion", label: "Exposición" },
  { id: "fondos", label: "Dentro de los fondos" },
  { id: "referencia", label: "Frente a la referencia" },
  { id: "diversificacion", label: "Diversificación" },
  { id: "datos", label: "Datos" }
];
const PESTANAS_DEL_CLIENTE = PESTANAS.filter((pestana) => pestana.id !== "datos");
const IDS_DE_PESTANA = PESTANAS.map((pestana) => pestana.id);
const IDS_DEL_CLIENTE = PESTANAS_DEL_CLIENTE.map((pestana) => pestana.id);

const PERIODOS = [
  { id: "3Y", label: "3 años" },
  { id: "5Y", label: "5 años" }
] as const;

/**
 * El tramo de la caída máxima de una serie: desde el máximo anterior hasta el mínimo. Es la misma cuenta que la curva de caída
 * (`calculateUnderwaterSeries`), y solo da las fechas: la cifra es la de la simulación.
 */
function tramoDeLaCaida(serie: readonly { date: string; value: number }[]): { desde: string; hasta: string; caida: number } | null {
  const caidas = calculateUnderwaterSeries(serie.map((punto) => punto.value));
  let fondo = -1;
  caidas.forEach((caida, indice) => {
    if (Number.isFinite(caida) && caida < 0 && (fondo < 0 || caida < caidas[fondo])) fondo = indice;
  });
  if (fondo < 0) return null;
  let maximo = fondo;
  for (let indice = fondo; indice >= 0; indice -= 1) {
    if (serie[indice].value >= serie[maximo].value) maximo = indice;
  }
  return { desde: serie[maximo].date, hasta: serie[fondo].date, caida: caidas[fondo] };
}

/** Va a otra dirección de la aplicación sin recargarla: la misma entrada del historial que pinta el menú. */
function irA(ruta: string, evento: MouseEvent<HTMLAnchorElement>, alternativa?: () => void) {
  if (evento.button !== 0 || evento.metaKey || evento.ctrlKey || evento.shiftKey || evento.altKey) return;
  evento.preventDefault();
  if (alternativa) return alternativa();
  window.history.pushState(window.history.state, "", ruta);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function XrayPage({ positions, sourceKind, totalCapital, portfolioName, onPortfolioNameChange, perfilYHorizonte, onBack, onIrADiseno }: XrayPageProps) {
  const { enabled: clientMode } = useClientMode();
  const { benchmarkId } = useBenchmark();
  const analysisWindow = useAnalysisWindow();
  const anos = analysisWindow === "5Y" ? 5 : 3;
  const [pestana, elegir] = usePestanaEnLaDireccion<Pestana>(clientMode ? IDS_DEL_CLIENTE : IDS_DE_PESTANA, "resumen");
  const [pdfError, setPdfError] = useState<AppError | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [dialogoAbierto, setDialogoAbierto] = useState(false);
  /* ANA-12: como en Informes, si la cartera no tiene nombre el diálogo lo pide, con el mismo rótulo, y sale en el papel. */
  const [nombreEscrito, setNombreEscrito] = useState("");
  const sinNombre = !portfolioName?.trim();
  /* El diálogo deja cambiar el periodo: lo que no se podía a 3 años puede poderse a 5. */
  useEffect(() => setPdfError(null), [analysisWindow]);
  const cerrarElDialogo = () => {
    setDialogoAbierto(false);
    setPdfError(null);
  };
  /* Para quién es el informe de cliente: lo mismo que se haya escrito en Informes. La firma es la identidad del asesor. */
  const { bankerName, bankerEmail, clientName, setClientName } = useIdentidadDelInforme(improvementFingerprint(positions));
  const dataSource = useMemo(() => getAssetDataSource(sourceKind), [sourceKind]);

  /* ANA-31: el resumen de la cartera ya no se pide. Solo servía para comprobar que existía antes de generar el PDF, que no lo usa. */
  const load = useAsyncData<{
    report: BdbPortfolioReport | null;
    assets: BdbAssetDetail[];
  }>(
    async () => {
      const [r, a] = await Promise.all([
        dataSource.buildManualPortfolioReport(positions, portfolioName),
        dataSource.getComparableAssets(positions.map((p) => p.asset_id))
      ]);
      return { report: r, assets: a };
    },
    [dataSource, portfolioName, positions],
    { enabled: positions.length > 0, initialData: { report: null, assets: [] } }
  );
  const report = load.data?.report ?? null;
  const assets = useMemo(() => load.data?.assets ?? [], [load.data?.assets]);
  /* El solapamiento, en la matriz de la pantalla y en el informe de cliente: un ETF con la cartera completa de su emisor la usa
     en vez de la del proveedor, también en Modo cliente (decisión B-79, revisada por Óscar el 14-11-2026: «no los dejes fuera»). */
  const cargasDelSolapamiento = useMemo(() => cargasDeLaCartera(dataSource, { activos: assets }), [assets, dataSource]);
  /* El riesgo de la cartera se mide con sus series, en el periodo elegido. Comparte caché con Diseño, y trae la contribución
     al riesgo desde el primer momento. */
  const hayPeso = idsConPeso(positions).length > 0;
  const medicion = useAsyncData<PortfolioHorizon>(
    async () => (await import("../adapters/portfolioHorizon")).fetchPortfolioHorizon(positions, analysisWindow),
    [positions, analysisWindow],
    /* Con todos los pesos a 0 no hay nada que simular: el servidor lo rechaza, y se leía como un fallo. */
    { enabled: hayPeso }
  );
  /* Al cambiar de periodo, lo medido a 3 años no se enseña como si fuera a 5. */
  const horizonte = medicion.data?.window === analysisWindow ? medicion.data : null;
  const midiendo = medicion.loading || (!horizonte && !medicion.error && hayPeso);
  const medido = riesgoMedidoDe(horizonte);
  /* Si el servidor dice que con estos datos no se puede, reintentar no lo arregla: se dice en su sitio, sin banner de fallo. */
  const sinSerie = !midiendo && esFaltaDeDatos(medicion.error);
  /* Un tope del cálculo tampoco se arregla reintentando: se dice el límite y cuántas tiene la cartera. */
  const limite = midiendo ? null : limiteDelCalculo(medicion.error);
  const medicionFallida = Boolean(medicion.error) && !sinSerie && !limite;
  /* Por encima de 40 activos no hay frontera, y la aportación al riesgo viaja fuera de ella: `riskContributions` la junta. */
  const riskContributions = aportacionAlRiesgo(horizonte);
  const portfolioHealth = useMemo(
    () => evaluatePortfolioHealth({
      positions,
      assets,
      riskContributions,
      riesgoMedido: midiendo ? undefined : Boolean(medido)
    }),
    [assets, medido, midiendo, positions, riskContributions]
  );
  const portfolioConstraints = useMemo(() => createDefaultPortfolioConstraints(), []);
  const feasibility = useMemo(
    () => checkPortfolioFeasibility({ assets, positions, constraints: portfolioConstraints }),
    [assets, portfolioConstraints, positions]
  );
  const fuera = useMemo(() => fueraDeLaMedida(horizonte, positions, assets), [assets, horizonte, positions]);
  const enOtraDivisa = useMemo(() => cifrasDelProveedorEnOtraDivisa(positions, assets), [assets, positions]);
  const lectura = useMemo(
    () => leerSaludYControl({ positions, assets, feasibility, salud: portfolioHealth, horizonte, midiendo, medicionFallida, sinSerie }),
    [assets, feasibility, horizonte, medicionFallida, midiendo, portfolioHealth, positions, sinSerie]
  );
  // S6b (P6): el pipeline compartido con Informes. También en Modo cliente: «Mayores acciones» sale de aquí.
  const { lookThroughLoad, isLookThroughPending } = useReportLookThrough({
    dataSource,
    positions,
    assets,
    ready: Boolean(report && assets.length > 0 && positions.length > 0)
  });
  /* El coste corriente de la cartera: la misma cuenta que el informe de costes, con los activos que ya trae la pantalla. */
  const costes = useMemo(() => calculatePortfolioCosts(positions, assets, totalCapital ?? 0), [assets, positions, totalCapital]);
  /* La cartera de referencia elegida, medida en las mismas fechas que la cartera, para el apunte de la respuesta. Solo si son
     las mismas fechas del periodo: si no, su cifra no es del mismo tramo y no se pone al lado. */
  const referencia = useSeriesDeReferencia(positions.length > 0);
  const referenciaElegida = useMemo(() => {
    const serie = horizonte?.backtest.portfolio_series;
    if (!serie || !referencia.series || !medido) return null;
    const ventana = referenceProfilesForDates(serie.map((p) => p.date), serie.map((p) => p.value), referencia.series);
    return ventana?.mismaVentana ? ventana.profiles.find((perfil) => perfil.id === benchmarkId) ?? null : null;
  }, [benchmarkId, horizonte, medido, referencia.series]);
  const tramo = useMemo(() => {
    if (!horizonte || !medido) return null;
    const encontrado = tramoDeLaCaida(horizonte.backtest.portfolio_series);
    /* Las fechas solo si son las de la misma cifra: si no cuadra, no se escriben unas fechas que no le corresponden. */
    return encontrado && Math.abs(encontrado.caida - medido.maxDrawdown) < 0.0005 ? encontrado : null;
  }, [horizonte, medido]);

  async function downloadClientReportPdf(): Promise<boolean> {
    setPdfError(null);
    if (!report) {
      setPdfError(new AppError("BACKEND", "El informe de cliente todavía no está listo. Reinténtalo cuando termine el cálculo."));
      return false;
    }
    /* INF-1: con pesos que no suman 100 no se genera; el diálogo ya lo dice y no deja descargar. */
    if (motivoParaNoGenerarElInformeDeCliente(report)) return false;
    setPdfBusy(true);
    try {
      // Ola 2 (P3): misma caché de sesión que la pantalla «Informes» —
      // las dos puertas del informe de cliente comparten feed y no repiten el backtest.
      const { fetchPortfolioHorizon } = await import("../adapters/portfolioHorizon");
      const analytics = await fetchPortfolioHorizon(positions, analysisWindow);
      const paradas = await seriesParadas(positions.map((p) => p.asset_id), new Date().toISOString());

      const { downloadInformeDeClientePdf: descargar, rentabilidadPorDividendoDe } = await import("../reports/informeDeClientePdf");
      /* El solapamiento del papel se mide aquí, con las mismas cargas que la matriz de la pantalla: el papel no lee la cartera del emisor. */
      const overlap = await loadReportOverlap(posicionesDelInformeDeCliente(report, assets), cargasDelSolapamiento);
      /* ANA-01: la entrada la monta la misma función que en Informes —réplica, Modo cliente, viabilidad, regiones y dividendos—.
         Aquí sin pesos bloqueados, que solo los tiene el Constructor. */
      await descargar(entradaDelInformeDeCliente({
        overlap,
        report,
        ...(sinNombre ? { nombreDeLaCartera: nombreEscrito } : {}),
        positions,
        assets,
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
      if (sinNombre && nombreEscrito.trim()) onPortfolioNameChange?.(nombreEscrito.trim());
      return true;
    } catch (error) {
      /* A2.3: toAppError conserva el mensaje accionable original en vez de taparlo con uno genérico. */
      setPdfError(toAppError(error, "No se pudo preparar el informe de cliente. Reinténtalo en unos segundos."));
      return false;
    } finally {
      setPdfBusy(false);
    }
  }

  async function descargarDesdeElDialogo() {
    const ok = await downloadClientReportPdf();
    if (ok) setDialogoAbierto(false);
  }

  const m = report?.summary.weighted_metrics;
  const avisosDelDiagnostico = report ? avisosDePantalla(report.data_diagnostic.top_warnings, m, horizonte?.coverageWeightPercent, enOtraDivisa) : [];
  /* Si lo que se mide es una sola acción, la cartera es la acción: su Sharpe no se enseña. */
  const loMedido = horizonte ? horizonte.backtest.asset_ids : idsConPeso(positions);
  const unaSolaAccion = esUnaSolaAccion(loMedido, assets);
  /* Sin serie que cubra el 80 % del peso, ninguna cifra de la cartera: «Falta el dato» y por qué (decisión 36). */
  const tira = leerLaTira({
    horizonte,
    fuera,
    midiendo,
    medicionFallida,
    sinSerie,
    limite,
    hayPeso,
    anos,
    unaSolaAccion,
    sinFondos: soloAcciones(loMedido, assets)
  });
  /* Por qué los datos no dan: lo escribe el servidor y es cocina del asesor. */
  const motivoDeLaSerie = sinSerie && !clientMode ? motivoDelServidor(medicion.error) : undefined;
  /* Los avisos del tipo sin riesgo viajan con las métricas; lo que queda fuera ya lo dice la procedencia. */
  const avisosDeLaMedida = medido && horizonte ? backtestCoverageNotices({ ...horizonte.backtest, excluded_assets: [] }) : [];
  /* Decisión B-78: es del asesor, y en Modo cliente no se enseña ni se pide. El informe de cliente lo dice con sus palabras. */
  const conAvisoDeSerie = seEnsena("calidadInterna", clientMode);
  const paradas = useSeriesParadas(positions.map((p) => p.asset_id), conAvisoDeSerie);
  const avisosDeSerieParada = conAvisoDeSerie
    ? posicionesParadas(positions, paradas, (p) => p.asset_id, (p) => assets.find((asset) => asset.asset_id === p.asset_id)?.display_name ?? p.label ?? p.asset_id).map(avisoDeSerieParada)
    : [];

  const filasDeReparto = (buckets: { key: string; weight_percent: number }[] | undefined, rotulo: (clave: string) => string) =>
    (buckets ?? [])
      .filter((bucket) => bucket.weight_percent > 0.05)
      .map((bucket) => ({ clave: bucket.key, rotulo: rotulo(bucket.key), peso: bucket.weight_percent }));
  const xray = report?.xray ?? null;
  /* A-202 (Óscar, 21-11-2026): «Otros» es una clase y «Sin clasificar», una posición de la que no se sabe la clase. `CLASS_LABELS`
     llama «Otros» a `UNKNOWN`, y en «En qué está invertida» salía así al lado de «Riesgo por clase de activo», que la llama
     «Sin clasificar». Va al final, como en el riesgo: es lo que falta, no una clase más. */
  const filasDeClase = filasDeReparto(xray?.by_economic_asset_class, (clave) =>
    esSinClasificar(clave) ? "Sin clasificar" : (CLASS_LABELS[clave] ?? readableBackendLabel(clave))
  ).sort((a, b) => Number(esSinClasificar(a.clave)) - Number(esSinClasificar(b.clave)));
  const filasDeDivisa = filasDeReparto(xray?.by_currency, (clave) => clave);
  const reparto = repartoDeLaCartera(report?.summary);

  /* ---------------------------------------------------------------- la respuesta */
  const medida = tira.estado === "medida" && medido ? medido : null;
  const cifraDe = (cifra: ReactNode) => (tira.estado === "midiendo" ? <span className="cifra">{MIDIENDO}</span> : cifra);
  const capitalFijado = typeof totalCapital === "number" && Number.isFinite(totalCapital) && totalCapital > 0;
  const soloDeAcciones = esSoloDeAcciones(costes);
  /* Cada cifra de la serie dice su periodo, «Volatilidad · 5 años», como antes del rediseño (14-11-2026): el de la simulación, y
     mientras llega, el elegido. El coste corriente es de hoy y no lleva periodo. */
  const conPeriodo = (nombre: string) => `${nombre} · ${aniosEnPalabras(horizonte?.years ?? anos)}`;
  /* Con el histórico ampliado con referencias, las cuatro cifras son en parte una estimación, y se dice junto a ellas. */
  const estimada = tira.estado === "medida" && conTramosEstimados(horizonte);
  const datosDeLaRespuesta: DatoDeRespuesta[] = [
    {
      rotulo: conPeriodo("Rentabilidad anualizada"),
      cifra: cifraDe(<Cifra tipo="rentabilidad" valor={medida?.cagr} />),
      apunte: referenciaElegida ? `la referencia, ${formato.rentabilidad(referenciaElegida.ret)}` : undefined
    },
    {
      rotulo: conPeriodo("Volatilidad"),
      cifra: cifraDe(<Cifra tipo="porcentaje" valor={medida?.volatility} />),
      apunte: referenciaElegida ? `la referencia, ${formato.porcentaje(referenciaElegida.vol)}` : undefined
    },
    unaSolaAccion
      ? { rotulo: conPeriodo("Ratio de Sharpe"), cifra: <Cifra ausencia="no-aplica" tipo="ratio" valor={null} />, apunte: motivoDeQueNoAplique("sharpe", "STOCK") }
      : {
          rotulo: conPeriodo("Ratio de Sharpe"),
          cifra: cifraDe(<Cifra tipo="ratio" valor={medida?.sharpe} />),
          apunte: medida && horizonte ? `tipo sin riesgo, ${formato.porcentaje(horizonte.backtest.metrics.rf_rate)}` : undefined
        },
    {
      rotulo: conPeriodo("Caída máxima"),
      cifra: cifraDe(<Cifra tipo="porcentaje" valor={medida?.maxDrawdown} />),
      apunte: medida ? (tramo ? formato.periodo(tramo.desde, tramo.hasta) : "en el periodo medido") : undefined
    },
    {
      rotulo: "Coste corriente de la cartera",
      cifra: soloDeAcciones ? <Cifra ausencia="no-aplica" tipo="porcentaje" valor={null} /> : <Cifra tipo="porcentaje" valor={costes.avgCostPct} />,
      apunte: soloDeAcciones
        ? "solo hay acciones, que no tienen coste corriente"
        : costes.avgCostPct === null
          ? costes.missing > 0
            ? `falta el coste de ${costes.missing} de las ${costes.rows.length} posiciones`
            : undefined
          : capitalFijado && costes.totalCostEur !== null
            ? `${formato.importeTitular(costes.totalCostEur)} al año sobre ${formato.importeTitular(totalCapital)}`
            : "al año, sobre el patrimonio"
    }
  ];

  const contexto = [
    "Propuesta",
    portfolioName?.trim() || "sin nombre",
    `${positions.length} ${positions.length === 1 ? "posición" : "posiciones"}`,
    capitalFijado ? formato.importeTitular(totalCapital) : null
  ]
    .filter(Boolean)
    .join(" · ");
  const rutaDeDiseno = APP_ROUTE_PATHS.cartera;
  const enlaceADiseno = (
    <a className="analisis-enlace" href={rutaDeDiseno} onClick={(evento) => irA(rutaDeDiseno, evento, onIrADiseno)}>
      Abrir en Diseño
    </a>
  );
  const verLaPestana = (destino: Pestana, texto: string) => (
    <Button onClick={() => elegir(destino)} size="sm" variant="quiet">
      {texto}
    </Button>
  );
  const interno = <Distintivo tono="interno">Interno</Distintivo>;

  const cargando = !report ? (
    load.error ? null : (
      /* ANA-08: si la carga ha fallado, el error ya está dicho arriba con su «Reintentar»; esto no va a terminar. */
      <div className="stack stack--3" aria-busy="true">
        <LoadingState>Calculando el análisis…</LoadingState>
        <Esqueleto alto={280} />
      </div>
    )
  ) : null;

  const contenidoDeLaPestana = (): ReactNode => {
    if (!report) return cargando;
    switch (pestana) {
      case "resumen":
        return (
          <div className="analisis-rejilla">
            <div className="analisis-rejilla__ancha">
              <XrayAdvanced
                alVerElDetalle={() => elegir("referencia")}
                assets={assets}
                falloDichoFuera={medicionFallida}
                positions={positions}
                seccion="resumen"
              />
            </div>
            <div className="analisis-rejilla__estrecha">
              <SaludYControl lectura={lectura} />
            </div>
            <div className="analisis-rejilla__ancha analisis-rejilla__ancha--mas">
              <ComposicionDeLaCartera
                acciones={enlaceADiseno}
                anos={anos}
                assets={assets}
                capital={totalCapital}
                fuera={fuera}
                horizonte={horizonte}
                limiteDePosiciones={6}
                limites={feasibility.bounds}
                midiendo={midiendo}
                posicionesDelInforme={report.positions}
                positions={positions}
              />
            </div>
            {/* AN1 (21-11-2026): el peso de cada clase y, a su lado, lo que aporta al riesgo. Lado a lado si caben; si no, uno bajo otro. */}
            <div className="analisis-rejilla__estrecha analisis-rejilla__estrecha--menos analisis-clases">
              <div className="analisis-clases__rejilla">
                <Panel acciones={verLaPestana("exposicion", "Ver la exposición")} claseDelCuerpo="stack stack--3" subtitulo="Por clase de activo · pesos de hoy" titulo="En qué está invertida">
                  {filasDeClase.length > 0 ? (
                    <ListaDePartes
                      etiqueta="Peso por clase de activo"
                      partes={[
                        /* Cada clase en su color fijo, el mismo que en el aro de Diseño (14-11-2026); lo que no entra, apagado. */
                        ...filasDeClase.map((fila) => ({
                          nombre: fila.rotulo,
                          fraccion: fila.peso / 100,
                          color: colorDeLaClase(fila.clave),
                          apagada: esSinClasificar(fila.clave)
                        })),
                        ...reparto.fuera.map((parte) => ({ nombre: parte.rotulo, fraccion: parte.peso / 100, apagada: true }))
                      ]}
                    />
                  ) : (
                    <p className="analisis-nota">Sin clases con peso asignado en esta cartera.</p>
                  )}
                </Panel>
                <RiesgoPorClase anos={anos} assets={assets} horizonte={horizonte} midiendo={midiendo} />
              </div>
            </div>
          </div>
        );
      case "exposicion":
        return (
          <div className="stack stack--bloques">
            <div className="grid">
              <Panel claseDelCuerpo="stack stack--tight" className="col-6" subtitulo="Peso por clase de activo." titulo="Clase de activo">
                <FilasDeReparto filas={filasDeClase} porClase vacio="Sin clases con peso asignado en esta cartera." />
                <LoQueNoEntra partes={reparto.fuera} />
              </Panel>
              <Panel claseDelCuerpo="stack stack--tight" className="col-6" subtitulo="La de la clase de cada posición. No es exposición a divisa." titulo="Divisa de la clase">
                {/* Las posiciones sin divisa declarada llegan juntas bajo una clave propia: en pantalla lo dice la pieza, no un «N/D». */}
                <FilasDeReparto claveDeLoQueFalta={CLAVE_SIN_DATO_DEL_REPARTO} filas={filasDeDivisa} vacio="Sin divisa declarada en las posiciones de esta cartera." />
                <LoQueNoEntra partes={reparto.fuera} />
              </Panel>
            </div>
            <RegionAllocation positions={positions} assets={assets} />
            <PortfolioXray xray={report.xray} fueraDeLaMedida={fuera} posiciones={report.positions} reparto={reparto} />
          </div>
        );
      case "fondos":
        return (
          <div className="stack stack--bloques">
            <XrayMetricsStyle assets={assets} positions={positions} />
            <MayoresAcciones
              error={lookThroughLoad.error?.message ?? null}
              loading={lookThroughLoad.loading || isLookThroughPending}
              lookThrough={lookThroughLoad.data}
            />
            {!clientMode ? (
              <ComposicionSubyacente
                error={lookThroughLoad.error?.message ?? null}
                loading={lookThroughLoad.loading || isLookThroughPending}
                lookThrough={lookThroughLoad.data}
              />
            ) : null}
          </div>
        );
      case "referencia":
        return <XrayAdvanced assets={assets} falloDichoFuera={medicionFallida} positions={positions} seccion="referencia" />;
      case "diversificacion":
        return (
          <XrayAdvanced
            assets={assets}
            falloDichoFuera={medicionFallida}
            loadHoldings={cargasDelSolapamiento.getAssetHoldings}
            loadHoldingsMany={cargasDelSolapamiento.getAssetHoldingsMany}
            positions={positions}
            seccion="diversificacion"
          />
        );
      case "datos":
        /* Lo interno del asesor. La pestaña no existe en Modo cliente; por si acaso, tampoco su contenido. */
        return clientMode ? null : (
          <div className="stack stack--bloques">
            {avisosDeSerieParada.length > 0 ? (
              <Panel claseDelCuerpo="stack stack--3" estado={interno} subtitulo="Series que han dejado de llegar" titulo="Avisos del asesor">
                {avisosDeSerieParada.map((aviso) => (
                  <Aviso key={aviso}>{aviso}</Aviso>
                ))}
              </Panel>
            ) : null}
            <PortfolioDataDiagnostic
              diagnostic={{
                ...report.data_diagnostic,
                top_warnings: avisosDelDiagnostico
              }}
              fuera={fuera}
              posiciones={report.positions}
            />
            <PortfolioReportWarnings
              enOtraDivisa={enOtraDivisa}
              pesoMedidoPct={horizonte?.coverageWeightPercent}
              report={report}
              yaDichos={avisosDelDiagnostico}
            />
          </div>
        );
    }
  };

  return (
    <article className="analisis">
      <PageHeader
        actions={
          <>
            {/* El periodo y la cartera de referencia gobiernan la respuesta, las pestañas y el informe (decisión 27). */}
            <SegmentedControl label="Periodo" onChange={setAnalysisWindow} options={PERIODOS} value={analysisWindow} />
            <BenchmarkSelect variante="cabecera" />
            <Button disabled={!report || pdfBusy} onClick={() => setDialogoAbierto(true)} variant="primary">
              Informe de la propuesta
            </Button>
          </>
        }
        description="Cómo se habría comportado esta cartera y qué lleva dentro, con los pesos de hoy."
        eyebrow={contexto}
        title="Análisis"
      />

      {dialogoAbierto ? (
        <DialogoDelInformeDeCliente
          alCambiarCliente={setClientName}
          alCambiarNombre={setNombreEscrito}
          alCerrar={cerrarElDialogo}
          alDescargar={() => void descargarDesdeElDialogo()}
          bloqueo={report ? motivoParaNoGenerarElInformeDeCliente(report) : null}
          capital={totalCapital}
          cliente={clientName}
          error={pdfError}
          nombre={sinNombre ? nombreEscrito : (portfolioName ?? "")}
          ocupado={pdfBusy}
          pedirNombre={sinNombre}
          pesoMedidoPct={horizonte?.coverageWeightPercent}
        />
      ) : null}

      {positions.length === 0 ? (
        <EmptyState
          action={
            <Button onClick={onBack} variant="primary">
              Ir al Buscador
            </Button>
          }
          description="Añade activos desde el Buscador y asígnales pesos. El Análisis te enseñará cómo se habría comportado la cartera, qué lleva dentro y cómo se compara con su referencia."
          nivel={2}
          title="Aún no hay propuesta que analizar"
        />
      ) : (
        <>
          {report ? (
            <section aria-label="Rentabilidad y riesgo de la cartera" className="analisis-respuesta">
              <Respuesta abierta datos={datosDeLaRespuesta} etiqueta={`Rentabilidad y riesgo de la cartera, ${anos} años`} />
              {tira.estado === "falta" ? (
                <Aviso titulo="Sin cifras de la cartera.">
                  {tira.motivo}
                  {motivoDeLaSerie ? ` Motivo: ${motivoDeLaSerie}` : ""}
                </Aviso>
              ) : null}
              {/* Qué simulación es, entre qué fechas y qué parte del peso mide. */}
              <p className="analisis-metodo">
                {/* Una estimación no se presenta como un hecho: la marca va delante de la procedencia, que dice de dónde sale. */}
                {estimada ? (
                  <>
                    <Distintivo tono="aviso">Estimado</Distintivo>{" "}
                  </>
                ) : null}
                {tira.procedencia}.{tira.estado === "medida" ? ` ${tira.notaTrasLaProcedencia}` : ""}
              </p>
              {avisosDeLaMedida.map((aviso) => (
                <Aviso key={aviso} tono="nota">
                  {aviso}
                </Aviso>
              ))}
            </section>
          ) : load.error ? null : (
            <Esqueleto alto={120} />
          )}

          {load.error ? <AsyncErrorBanner error={load.error} onRetry={load.retry} /> : null}
          {/* Un fallo pasajero de la simulación: se dice una vez, aquí, con «Reintentar»; los bloques dicen que no la hay. */}
          {medicionFallida ? <AsyncErrorBanner error={medicion.error} onRetry={medicion.retry} /> : null}

          <SegmentedTabs
            className="analisis-pestanas"
            idPrefix="analisis"
            label="Secciones del análisis"
            onChange={elegir}
            tabs={clientMode ? PESTANAS_DEL_CLIENTE : PESTANAS}
            value={pestana}
          />
          <PanelDePestana idPrefix="analisis" pestana={pestana}>
            {contenidoDeLaPestana()}
          </PanelDePestana>
        </>
      )}
    </article>
  );
}
