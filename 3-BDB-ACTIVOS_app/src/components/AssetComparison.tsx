import { useMensaje } from "./ui/useMensaje";
import { MarcaDeActivo } from "./ui/MarcaDeActivo";
import { EnlaceAFicha } from "./ui/EnlaceAFicha";
import { useEffect, useMemo, useRef, useState } from "react";
import { estilosPorPapel } from "../charts/oaa/chartTheme";
import { getAssetDataSource } from "../adapters/assetDataSource";
import { AssetPicker, type AssetPickerFilterState } from "./AssetPicker";
import type { AssetFilterValue } from "./AssetSearchFilters";
import { AssetComparisonCatalogModal } from "./AssetComparisonCatalogModal";
import {
  avisoDeCatalogoLimitado,
  COMPARISON_CATALOG_LIMIT,
  filterComparisonCatalog,
  rotuloDelCatalogo
} from "../core/assetComparisonCatalog";
import type { BdbAssetDetail, BdbAssetSearchResult, InstrumentType } from "../types/bdbAssets";
import type { AssetDataSourceKind } from "../types/assetDataSource";
import { PortfolioComparator, type CarteraActivaParaComparar } from "./PortfolioComparator";
import { createSessionSlot } from "../core/sessionCaches";
import { WealthComparator } from "./WealthComparator";
import { fetchRebasedSeries, type RebasedSeriesResponse } from "../adapters/priceSeriesBackend";
import { avisoDeVentana } from "../core/coberturaDeLaSerie";
import { AsyncErrorBanner } from "./AsyncErrorBanner";
import type { SalidaDeLaComparativa } from "../reports/assetComparePdf";
import { CorrelationHeatmap } from "../charts/CorrelationHeatmap";
import { matrizDeCorrelacion, notaDeLaCorrelacion } from "../core/correlation";
import { fraseDeLoQueNoSeDibuja } from "../core/backtestCoverage";
import { weeklyMeasurementIndices } from "../core/seriesFrequency";
import { OaaLineChart } from "../charts/oaa";
import {
  BENCHMARK_PROFILES,
  MIN_SEMANAS_COMUNES,
  benchmarkById,
  compararEnMismasFechas,
  composicionDeLaReferencia,
  otraSerieEnLaComparacion,
  pesoDeLaReferenciaAlFinal
} from "../core/benchmarkProfiles";
import { useSeriesDeReferencia } from "../core/useSeriesDeReferencia";
import { appLogger } from "../core/appLogger";
import {
  accionDeCarteraBloqueada,
  avisoDeAccionDeCartera,
  activoParaLaAccion,
  etiquetaDeAccionDeCartera,
  NO_SE_ANADE_SIN_MEDIR,
  nombreDeAccionDeCartera,
  sinPrecioNiMetricas
} from "../core/accionDeCartera";
import { iconoDeAccionDeCartera } from "./ui/iconoDeAccionDeCartera";
import { resolveEffectiveCommercialRetro } from "../core/commercialRetroEffective";
import { pestanaDelComparador } from "../core/comparacionDeCarteras";
import { fecha, numero, oFalta } from "../core/formato";
import { aniosEnPalabras } from "../core/glosarioDePantalla";
import { useCommercialRetroData } from "../core/useCommercialRetroData";
import { useCommercialRetroAccess } from "../auth/useCommercialRetroAccess";
import { esAccion } from "../core/esAccion";
import { seEnsenaLaMetrica } from "../core/metricasPorInstrumento";
import { clasificacionDeTarjeta } from "../adapters/componerLista";
import { useModoCliente } from "../app/ClientModeContext";
import { EmptyState, LoadingState } from "./ui/AsyncState";
import { Ausencia } from "./ui/Ausencia";
import { Button } from "./ui/Button";
import { DialogBody, DialogFooter, DialogHeader, ModalDialog } from "./ui/ModalDialog";
import { PageHeader } from "./ui/PageHeader";
import { Panel } from "./ui/Panel";
import { SegmentedControl } from "./ui/SegmentedControl";
import { PanelDePestana, SegmentedTabs } from "./ui/SegmentedTabs";
import { Aviso } from "./ui/Aviso";
import { Campo } from "./ui/Campo";
import { usePestanaEnLaDireccion } from "../core/usePestanaEnLaDireccion";
import { PlanoRiesgoRetorno } from "./tabla/PlanoRiesgoRetorno";
import { TablaComparativa } from "./tabla/TablaComparativa";
import {
  columnasDeActivos,
  costeCorrienteParaElInforme,
  fechaYDivisaDeLasCifras,
  filasDeActivos,
  metodologiaDeLaComparativa,
  notasDeCorteYBase,
  notasDeLaComparativa,
  notasDeLasCifrasApartadas,
  apuntesDelPapel,
  cifrasApartadasDeLaComparativa,
  puntoDeLaComparativa,
  ventanaDelInforme
} from "../adapters/comparativaDeActivos";
import { BASE_NUEVA_DISPONIBLE, leerDocumento, type Documento } from "../adapters/baseNuevaLectura";

interface BenchOverlay {
  id: string;
  name: string;
  values: number[];
}

interface AssetComparisonProps {
  assets: BdbAssetDetail[];
  sourceKind: AssetDataSourceKind;
  onRemove: (assetId: string) => void;
  onAdd?: (assetId: string) => void;
  // Auditoría 11-08 (F1.3): el comparador no permitía llevar el ganador a la
  // cartera. Recibe el MISMO handler que usan las filas del buscador
  // (AssetSearch.handleAddToPortfolio) y los ids ya en cartera para reflejar
  // el estado «Añadido».
  onAddToPortfolio?: (asset: BdbAssetSearchResult) => void;
  portfolioAssetIds?: string[];
  /** Para compararla en Comparar carteras sin guardarla antes. */
  carteraActiva?: CarteraActivaParaComparar;
  onIrACarterasGuardadas?: () => void;
  initialInstrumentFilter?: AssetFilterValue;
}

/*
 * El color de cada serie sale de su papel (apartado 7 de SISTEMA_DISENO.md): los activos comparados son series, en el orden
 * fijo de la paleta, y la cartera de referencia es la referencia, gris y a trazos. Ninguno es «la cartera»: aquí no hay una.
 * El punto de cada activo en su ficha y en la leyenda sale del mismo sitio, para que coincida con su línea.
 */
const COLORS = estilosPorPapel(Array.from({ length: 5 }, () => ({ papel: "serie" as const }))).map((estilo) => estilo.color);
const BENCHMARK_COLOR = estilosPorPapel([{ papel: "referencia" }])[0].color;
const PERIODS = [1, 3, 5, 10] as const;
const MAX = 5;
/** Valor del selector de benchmark para comparar sin ninguna referencia. */
const NO_BENCHMARK = "none";
/* Ola 3b (§5.4, G1): el comparador patrimonial deja el X-Ray (donde no usaba
   la cartera para nada) y pasa a ser la tercera pestaña de este comparador. */
type ComparisonTab = "assets" | "portfolios" | "wealth";
type ComparisonFrequency = "WEEKLY" | "DAILY";
const COMPARISON_TABS = [
  { id: "assets", label: "Activos" },
  { id: "portfolios", label: "Propuestas" },
  { id: "wealth", label: "Patrimonial" }
] as const;
/* La pestaña va en la dirección, en español: `/comparador#pestana=propuestas`. */
const PESTANA_EN_LA_DIRECCION: Record<ComparisonTab, string> = { assets: "activos", portfolios: "propuestas", wealth: "patrimonial" };
const PESTANA_DE_LA_DIRECCION: Record<string, ComparisonTab> = { activos: "assets", propuestas: "portfolios", patrimonial: "wealth" };
const PESTANAS_EN_LA_DIRECCION = Object.values(PESTANA_EN_LA_DIRECCION);
/* Sin navegador (al pintar en el servidor, como hacen algunas pruebas) no hay dirección que leer: la pestaña vive en el estado. Se
   decide una vez, al cargar el módulo, así que el orden de los ganchos no cambia nunca. */
function usePestanaSinDireccion(_pestanas: readonly string[], inicial: string): [string, (siguiente: string) => void] {
  return useState(inicial);
}
const usePestana = typeof window === "undefined" ? usePestanaSinDireccion : usePestanaEnLaDireccion;
const PERIOD_OPTIONS = PERIODS.map((years) => ({ id: years, label: years === 1 ? "1 año" : `${years} años` }));
const FREQUENCY_OPTIONS = [
  { id: "WEEKLY", label: "Semanal" },
  { id: "DAILY", label: "Diaria" }
] as const;


function RebaseChart({
  dates,
  series,
  puestos,
  benchmark
}: {
  dates: string[];
  series: RebasedSeriesResponse["series"];
  /** El puesto de cada activo en lo seleccionado, desde cero: su número y su color en toda la pantalla. */
  puestos: ReadonlyMap<string, number>;
  benchmark?: BenchOverlay | null;
}) {
  const chartSeries = [
    ...series.map((s, enElGrafico) => ({ s, si: puestos.get(s.asset_id) ?? enElGrafico })).map(({ s, si }) => ({
      id: s.asset_id,
      /* Decisión 84: quien no se dibuja no está, y los demás no se renumeran ni cambian de color. */
      puesto: si,
      /* Decisión 8: lo que se dibuja de una clase que reparte es su valor liquidativo, y no se le saca una cifra final. */
      label: s.sin_dividendos ? `${s.display_name} · Valor liquidativo, sin dividendos` : s.display_name,
      sinCifraFinal: s.sin_dividendos === true,
      papel: "serie" as const,
      color: COLORS[si % COLORS.length],
      dashed: false,
      etiquetaFinal: String(si + 1),
      values: dates.map((date, index) => ({
        date,
        value: Number.isNaN(s.values[index]) ? null : s.values[index]
      }))
    })),
    ...(benchmark
      ? [
          {
            id: benchmark.id,
            label: `${benchmark.name} · cartera de referencia`,
            papel: "referencia" as const,
            color: BENCHMARK_COLOR,
            dashed: true,
            sinCifraFinal: false,
            etiquetaFinal: "B",
            values: dates.map((date, index) => ({
              date,
              value: Number.isNaN(benchmark.values[index]) ? null : benchmark.values[index]
            }))
          }
        ]
      : [])
  ];
  const lastById = new Map(chartSeries.map((serie) => [serie.id, [...serie.values].reverse().find((point) => typeof point.value === "number")?.value]));
  return (
    <div className="cmp-chart-box">
      <OaaLineChart
        ariaLabel="Evolución comparada con base 100"
        height={286}
        referenceValue={100}
        /* El papel decide el color; el color de la leyenda es el mismo, porque sale de él. */
        series={chartSeries.map((serie) => ({ ...serie, color: undefined }))}
        showLegend={false}
      />
      <ul className="cmp-legend">
        {chartSeries.map((s) => (
          <li key={s.id}>
            {s.dashed ? (
              <span className="cmp-legend-trazo" style={{ borderTopColor: s.color }} />
            ) : (
              <span className="cmp-legend-dot" style={{ background: s.color }} />
            )}
            <b>{s.etiquetaFinal}</b>
            <span className="cmp-legend-name">{s.label}</span>
            {s.sinCifraFinal ? null : <strong>{oFalta(numero(lastById.get(s.id), { decimales: 1 }))}</strong>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* `RiskReturnMap` se retira el 03-11-2026 y lo sustituye `PlanoRiesgoRetorno`.
   Pintaba a todos los activos sobre un mismo par de ejes sin mirar de qué método salen
   sus cifras. Con él se van los rombos de los perfiles de benchmark del mapa, y eso es
   deliberado: un benchmark sintético no lo calcula ninguno de nuestros métodos, así que
   no tiene panel honesto donde ponerlo. El benchmark sigue en la evolución base 100,
   que es donde se lee. */

function filterToInstrumentTypes(filter: AssetFilterValue): InstrumentType[] | undefined {
  return filter === "ALL" ? undefined : [filter];
}

/* Hallazgo 53: periodo, frecuencia y referencia de «Comparar activos» no vuelven a su valor de partida al
   cambiar de pantalla. Nada que elija el asesor se elige solo: la referencia sigue abriendo sin ninguna. */
const mandosDeComparar = createSessionSlot(() => ({
  period: 3 as (typeof PERIODS)[number],
  freq: "DAILY" as ComparisonFrequency,
  benchOverride: NO_BENCHMARK as string
}));

export function AssetComparison({
  assets,
  sourceKind,
  onRemove,
  onAdd,
  onAddToPortfolio,
  portfolioAssetIds,
  carteraActiva,
  onIrACarterasGuardadas,
  initialInstrumentFilter = "ALL"
}: AssetComparisonProps) {
  const modoCliente = useModoCliente();
  const clientMode = modoCliente.activo;
  /* H2-05: lo que se pregunta al acabar de dibujar el informe interno, que lleva retrocesiones. */
  const clientModeRef = useRef(clientMode);
  const { decir } = useMensaje();
  useEffect(() => { clientModeRef.current = clientMode; }, [clientMode]);
  const dataSource = useMemo(() => getAssetDataSource(sourceKind), [sourceKind]);
  const [selected, setSelected] = useState<BdbAssetSearchResult[]>(assets);
  const [enSesion] = useState(() => mandosDeComparar.read());
  const [period, setPeriod] = useState<(typeof PERIODS)[number]>(enSesion.period);
  /* La pestaña, en la dirección (se puede recargar y compartir) y en la sesión, que es por donde llega quien viene de
     «Guardadas» a comparar dos propuestas: sin nada en la dirección, manda la sesión. */
  const [deLaSesion] = useState(() => PESTANA_EN_LA_DIRECCION[pestanaDelComparador.read()]);
  const [enLaDireccion, elegirEnLaDireccion] = usePestana(PESTANAS_EN_LA_DIRECCION, deLaSesion);
  const tab: ComparisonTab = PESTANA_DE_LA_DIRECCION[enLaDireccion] ?? "assets";
  const elegirPestana = (siguiente: ComparisonTab) => {
    pestanaDelComparador.write(siguiente);
    elegirEnLaDireccion(PESTANA_EN_LA_DIRECCION[siguiente]);
  };
  const [rebase, setRebase] = useState<{ key: string; data: RebasedSeriesResponse | null; source: "backend" | "none" }>({
    key: "",
    data: null,
    source: "none"
  });
  const [rebaseError, setRebaseError] = useState<unknown>(null);
  const [rebaseReload, setRebaseReload] = useState(0);
  // El grafico manda y va en diario; la correlacion se mide siempre en semanal
  // (ver correlationView), asi que el selector solo cambia lo que se dibuja.
  const [freq, setFreq] = useState<ComparisonFrequency>(enSesion.freq);
  // Abre sin referencia hasta que el asesor elija una, y la elige él (decisión 2 de Óscar): «Auto» elegía
  // por parecido con el resultado ya obtenido, y un fondo de bonos podía acabar contra «Agresivo».
  const [benchOverride, setBenchOverride] = useState<string>(enSesion.benchOverride);
  useEffect(() => {
    mandosDeComparar.write({ period, freq, benchOverride });
  }, [period, freq, benchOverride]);
  const [pickerFilters, setPickerFilters] = useState<AssetPickerFilterState>(() => ({
    activeFilter: initialInstrumentFilter,
    region: "ALL",
    assetClass: "ALL",
    category: "ALL"
  }));
  const [catalogAssets, setCatalogAssets] = useState<BdbAssetSearchResult[]>([]);
  const [catalogTotal, setCatalogTotal] = useState<number | null>(null);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState<unknown>(null);
  const [catalogReload, setCatalogReload] = useState(0);
  const [catalogOpen, setCatalogOpen] = useState(false);
  const {
    records: retroByAssetId,
    loading: retroCargando,
    error: retroError,
    retry: retryRetro
  } = useCommercialRetroData(clientMode ? [] : selected);
  const accesoARetro = useCommercialRetroAccess();

  useEffect(() => {
    if (assets.length === 0) return;
    const incomingById = new Map(assets.map((asset) => [asset.asset_id, asset]));
    setSelected((current) => {
      let changed = false;
      const merged = current.map((asset) => {
        const incoming = incomingById.get(asset.asset_id);
        if (incoming && incoming !== asset) {
          changed = true;
          return incoming;
        }
        return asset;
      });
      const currentIds = new Set(current.map((asset) => asset.asset_id));
      for (const asset of assets) {
        if (!currentIds.has(asset.asset_id) && merged.length < MAX) {
          merged.push(asset);
          changed = true;
        }
      }
      // Auditoría 27-07 (T3): devolver SIEMPRE un array nuevo cambiaba la
      // identidad de `selected` sin cambiar su contenido y el efecto de rebase
      // disparaba dos get_price_series idénticos al abrir el comparador
      // (medido en vivo: dos llamadas con 115 ms de diferencia).
      return changed ? merged : current;
    });
  }, [assets]);

  useEffect(() => {
    let active = true;
    setCatalogLoading(true);
    setCatalogError(null);
    setCatalogAssets([]);
    setCatalogTotal(null);
    const peticion = {
      query: "",
      instrumentTypes: filterToInstrumentTypes(pickerFilters.activeFilter),
      limit: COMPARISON_CATALOG_LIMIT
    };
    /* Con página se sabe el total de verdad, y el botón puede decir «200 de 1.095». */
    (dataSource.searchAssetsPage
      ? dataSource.searchAssetsPage(peticion)
      : dataSource.searchAssets(peticion).then((results) => ({ results, totalMatches: null }))
    ).then(({ results, totalMatches }) => {
      if (active) {
        setCatalogAssets(results);
        setCatalogTotal(totalMatches);
      }
    }).catch((error: unknown) => {
      if (active) setCatalogError(error);
    }).finally(() => {
      if (active) setCatalogLoading(false);
    });
    return () => {
      active = false;
    };
  }, [catalogReload, dataSource, pickerFilters.activeFilter]);

  useEffect(() => {
    if (tab !== "assets" || selected.length < 2) {
      return;
    }
    let active = true;
    const win = period === 1 ? "1Y" : period === 3 ? "3Y" : period === 5 ? "5Y" : "10Y";
    const key = `${win}:${freq}:${selected.map((a) => a.asset_id).join(",")}`;
    setRebaseError(null);
    fetchRebasedSeries(selected.map((a) => a.asset_id), win, freq)
      .then((data) => {
        if (active) {
          setRebase({ key, data, source: "backend" });
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setRebase({ key, data: null, source: "none" });
          setRebaseError(error);
        }
      });
    return () => {
      active = false;
    };
  }, [tab, selected, period, freq, rebaseReload]);

  function addAsset(asset: BdbAssetSearchResult) {
    if (selected.some((candidate) => candidate.asset_id === asset.asset_id) || selected.length >= MAX) return;
    setSelected((current) => [...current, asset]);
    onAdd?.(asset.asset_id);
  }

  function removeAsset(assetId: string) {
    setSelected((prev) => prev.filter((a) => a.asset_id !== assetId));
    onRemove(assetId);
  }

  function applyCatalogSelection(next: BdbAssetSearchResult[]) {
    const currentIds = new Set(selected.map((asset) => asset.asset_id));
    const nextIds = new Set(next.map((asset) => asset.asset_id));
    for (const asset of selected) {
      if (!nextIds.has(asset.asset_id)) onRemove(asset.asset_id);
    }
    for (const asset of next) {
      if (!currentIds.has(asset.asset_id)) onAdd?.(asset.asset_id);
    }
    setSelected(next.slice(0, MAX));
    setCatalogOpen(false);
  }

  const filteredCatalogAssets = useMemo(
    () => filterComparisonCatalog(catalogAssets, {
      instrumentTypes: filterToInstrumentTypes(pickerFilters.activeFilter),
      region: pickerFilters.region,
      assetClass: pickerFilters.assetClass,
      category: pickerFilters.category
    }),
    [catalogAssets, pickerFilters]
  );

  const rebaseWin = period === 1 ? "1Y" : period === 3 ? "3Y" : period === 5 ? "5Y" : "10Y";
  /*
   * La metodología del informe, leída de las MISMAS columnas que imprimen las cifras.
   *
   * Hasta el 03-11-2026 salía de `selected[].metrics` —la base de siempre— mientras las filas
   * del informe venían de las tarjetas nuevas, así que el pie podía describir un cálculo que
   * no era el de las cifras impresas: una fila mensual bajo un pie que dice «semanales», o un
   * aviso de mezcla que no está en lo que se imprime. Es el defecto de siempre de este
   * proyecto puesto en papel, que es donde más duele: lo que un asesor firma.
   *
   * Se calcula más abajo, junto a `columnasComparadas`, porque de ahí sale.
   */

  /*
   * Las tarjetas de la base nueva para lo que se está comparando. Son como mucho CINCO
   * lecturas sueltas, no el listado entero: `listarTarjetas` trae las 1.091 y 4 MB, que
   * es lo que el buscador necesita y esta pantalla no.
   *
   * De ahí sale `metrics.method`, que es lo que hace que el aviso de escalas y los
   * paneles del plano signifiquen algo: la base de siempre no lo declara en ninguno de
   * sus 2.178 documentos de métricas. Si una tarjeta no está —8 instrumentos de 1.097,
   * siete de ellos por decisión de alcance— su columna se pinta con las cifras de
   * siempre y se marca en la cabecera.
   */
  const [tarjetas, setTarjetas] = useState<Map<string, Documento>>(new Map());
  const idsComparados = selected.map((activo) => activo.asset_id).join(",");
  useEffect(() => {
    if (!BASE_NUEVA_DISPONIBLE || selected.length === 0) return;
    let vivo = true;
    void Promise.all(
      selected.map(async (activo) => {
        try {
          const tarjeta = await leerDocumento(`instruments/${activo.asset_id}/read/card`);
          return tarjeta ? ([activo.asset_id, tarjeta] as const) : null;
        } catch {
          /* Que la base nueva no conteste no puede dejar sin comparación al asesor:
             la columna se pinta con lo de siempre. */
          return null;
        }
      })
    ).then((pares) => {
      if (vivo) setTarjetas(new Map(pares.filter((par) => par !== null)));
    });
    return () => {
      vivo = false;
    };
  }, [idsComparados, selected]);

  const fuentesComparadas = useMemo(
    () => selected.map((activo) => ({ activo, tarjeta: tarjetas.get(activo.asset_id) })),
    [selected, tarjetas]
  );
  const columnasComparadas = useMemo(
    () =>
      /* Cada columna, con el número y el color de su activo en el gráfico (Óscar, 20-11-2026). */
      columnasDeActivos(fuentesComparadas, { modoCliente: !modoCliente.seEnsena("fuenteDeDatos") }).map((columna, indice) => {
        const puesto = selected.findIndex((activo) => activo.asset_id === columna.id);
        const enLaPantalla = puesto >= 0 ? puesto : indice;
        return { ...columna, marca: { numero: enLaPantalla + 1, color: COLORS[enLaPantalla % COLORS.length] } };
      }),
    [fuentesComparadas, modoCliente, selected]
  );
  const filasComparadas = useMemo(
    () =>
      filasDeActivos(fuentesComparadas, {
        modoCliente: clientMode,
        retroPorActivo: new Map(
          selected.map((activo) => [
            activo.asset_id,
            resolveEffectiveCommercialRetro(activo.asset_id, retroByAssetId)?.rate
          ])
        )
      }),
    [fuentesComparadas, selected, clientMode, retroByAssetId]
  );

  /**
   * Lo que el informe dice de las cifras que imprime, leído de las MISMAS columnas y filas. El valor es el que el papel
   * pone en su celda, y el método el de la columna que lo dio: la tarjeta nueva o el activo de siempre, lo que haya
   * usado. Así el pie no puede describir un cálculo distinto del que está impreso justo encima.
   */
  const metodologia = useMemo(
    () => metodologiaDeLaComparativa(columnasComparadas, filasComparadas),
    [columnasComparadas, filasComparadas]
  );

  /** Lo que el informe escribe de cada activo, leído de donde lo lee la pantalla. */
  const cifrasParaElInforme = (assetId: string) => {
    const columna = columnasComparadas.find((c) => c.id === assetId);
    const valorDe = (id: string) =>
      columna === undefined ? undefined : filasComparadas.find((f) => f.id === id)?.valor?.(columna);
    return {
      costeCorriente: costeCorrienteParaElInforme(filasComparadas, columna),
      return1y: valorDe("annualized_return-1y"),
      return3y: valorDe("annualized_return-3y"),
      return5y: valorDe("annualized_return-5y"),
      return10y: valorDe("annualized_return-10y"),
      volatility1y: valorDe("volatility-1y"),
      volatility3y: valorDe("volatility-3y"),
      sharpe3y: valorDe("sharpe-3y"),
      maxDrawdown: valorDe("caida-3y"),
      maxDrawdownLabel:
        valorDe("caida-3y") === undefined ? undefined : ("Máx. caída 3A" as const)
    };
  };

  const rebaseKey = `${rebaseWin}:${freq}:${selected.map((a) => a.asset_id).join(",")}`;
  /* La matriz de correlacion se mide SIEMPRE en semanal: el VL de los fondos no
     se publica a la misma hora, la serie diaria arrastra el dato del dia anterior
     y eso sesga la correlacion a la baja. Remuestreo igual que el backend. */
  const correlationView = useMemo(() => {
    const data = rebase.data;
    if (!data) return { dates: [] as string[], series: [] as RebasedSeriesResponse["series"] };
    const indices = data.frequency === "DAILY"
      ? weeklyMeasurementIndices(data.dates)
      : data.dates.map((_date, index) => index);
    return {
      dates: indices.map((index) => data.dates[index]),
      series: data.series.map((ser) => ({ ...ser, values: indices.map((index) => ser.values[index]) }))
    };
  }, [rebase.data]);
  /* Decisión 53: con una línea sin dividendos no se mide, y la matriz lo dice. Sin esta frase, el hueco parece un fallo. */
  const notaDeLaMatriz = notaDeLaCorrelacion(
    correlationView.series.filter((serie) => serie.sin_dividendos).map((serie) => serie.display_name)
  );

  /* Si la ventana común no cubre el periodo elegido, se dice: el botón sigue diciendo «3A». */
  const avisoDeLaEvolucion =
    rebase.key === rebaseKey && rebase.data?.coverage?.first_date && rebase.data.coverage.last_date
      ? avisoDeVentana([rebase.data.coverage.first_date, rebase.data.coverage.last_date], rebase.data.window)
      : null;

  const rebaseSettled = rebase.key === rebaseKey;
  /* Quien se ha elegido y no se dibuja lo dice aquí: si no, la línea falta sin más (decisión 55). */
  const noDibujados = rebaseSettled ? rebase.data?.excluded_assets ?? [] : [];
  /* El puesto de cada activo en lo seleccionado: su número y su color en las fichas de arriba, el gráfico, el mapa y la matriz. */
  const puestos = useMemo(() => new Map(selected.map((activo, indice) => [activo.asset_id, indice])), [selected]);

  const [exportingPdf, setExportingPdf] = useState(false);
  /* Decisión 20: fuera de Modo cliente se elige para quién sale, y bastaba con olvidar activarlo para imprimir «Retro». */
  const [eligiendoSalida, setEligiendoSalida] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  /* La referencia la elige el asesor. Se calcula en el momento con las series de sus dos fondos, y activos y
     referencia se comparan en las mismas fechas: si no hay solape, no se compara y se dice. */
  const perfilElegido = benchOverride === NO_BENCHMARK ? null : benchmarkById(benchOverride) ?? null;
  const referencia = useSeriesDeReferencia(tab === "assets" && selected.length >= 2 && perfilElegido !== null);
  const comparacion = useMemo(() => {
    if (!perfilElegido || !referencia.series || !rebaseSettled || !rebase.data || rebase.data.series.length === 0) return null;
    return compararEnMismasFechas(rebase.data.dates, rebase.data.series[0].values, perfilElegido.weights, referencia.series, rebase.data.frequency);
  }, [perfilElegido, referencia.series, rebaseSettled, rebase.data]);
  /* Lo que se dibuja: con referencia, las fechas comunes, hasta la última, y con la misma base. */
  const evolucion = useMemo(() => {
    const data = rebase.data;
    if (!data) return null;
    if (!comparacion) return { dates: data.dates, series: data.series };
    return {
      dates: comparacion.fechas,
      series: data.series.map((serie) => ({ ...serie, values: otraSerieEnLaComparacion(data.dates, serie.values, comparacion) }))
    };
  }, [rebase.data, comparacion]);
  const benchOverlay = useMemo<BenchOverlay | null>(
    () => (perfilElegido && comparacion ? { id: perfilElegido.id, name: perfilElegido.name, values: comparacion.referencia } : null),
    [perfilElegido, comparacion]
  );
  const semanal = rebase.data?.frequency === "WEEKLY";
  const hastaLaFechaComun = comparacion
    ? semanal
      ? `la semana del ${oFalta(fecha(comparacion.ultimaComun))}`
      : `el ${oFalta(fecha(comparacion.ultimaComun))}`
    : "";
  /* Sin esto el PDF podría salir sin la referencia elegida por haberlo pedido antes de que llegaran las series. */
  /* H1-11: tampoco sale mientras las series cargadas no sean las de la selección que se ve (un activo sustituido, otra
     ventana u otra frecuencia): la matriz y la base 100 del papel serían las del par anterior. Un error de carga
     cierra la petición con su clave y no bloquea. */
  const esperandoComparacion = !rebaseSettled || (perfilElegido !== null && referencia.estado === "cargando");
  /* Cómo acaba la referencia en la ventana que se ve, sin reequilibrar (decisión 86): cambia con el periodo. */
  const pesoAlFinal = perfilElegido && comparacion ? pesoDeLaReferenciaAlFinal(perfilElegido, comparacion.rentaVariableAlFinal) : null;
  const notaDeLaReferencia = !perfilElegido
    ? "Comparación entre activos, sin línea de referencia."
    : referencia.estado === "cargando"
      ? "Cargando la cartera de referencia…"
      : referencia.estado === "no-disponible"
        ? "Cartera de referencia no disponible."
        : comparacion
          ? `${perfilElegido.name}: ${composicionDeLaReferencia(perfilElegido)}.${pesoAlFinal ? ` ${pesoAlFinal}.` : ""} Activos y referencia en las mismas fechas, hasta ${hastaLaFechaComun}${comparacion.cortadaAlFinal ? ", la última común" : ""}.`
          : rebaseSettled
            ? `Sin fechas suficientes en común con ${perfilElegido.name}: no se compara. Hacen falta ${MIN_SEMANAS_COMUNES} semanas.`
            : `${perfilElegido.name}: ${composicionDeLaReferencia(perfilElegido)}.`;

  /* Informe PDF de la comparación: traslada a tablas lo mismo que hay en
     pantalla (identificación, rentabilidad, riesgo, base 100 y correlación).
     El generador se carga en diferido para no arrastrar @react-pdf al chunk
     de la pantalla. */
  const windowLabel = !rebaseSettled || !rebase.data?.coverage?.first_date
    ? `${period}A`
    : comparacion
      ? ventanaDelInforme(comparacion.primeraComun, comparacion.ultimaComun, rebase.data.window, comparacion.fechas.length, semanal)
      : ventanaDelInforme(rebase.data.coverage.first_date, rebase.data.coverage.last_date, rebase.data.window, rebase.data.coverage.common_observations, semanal);

  const base100ById = useMemo(() => {
    const out = new Map<string, number>();
    for (const serie of evolucion?.series ?? []) {
      const last = [...serie.values].reverse().find((value) => Number.isFinite(value));
      if (typeof last === "number") out.set(serie.asset_id, last);
    }
    return out;
  }, [evolucion]);

  function pedirElInforme(): void {
    if (modoCliente.seEnsena("retrocesiones")) setEligiendoSalida(true);
    else void handleExportPdf("cliente");
  }

  function descargarLaSalida(salida: SalidaDeLaComparativa): void {
    setEligiendoSalida(false);
    void handleExportPdf(salida);
  }

  async function handleExportPdf(salida: SalidaDeLaComparativa): Promise<void> {
    if (esperandoComparacion) return;
    setExportError(null);
    setExportingPdf(true);
    try {
      const { downloadAssetComparisonPdf } = await import("../reports/assetComparePdf");

      const correlationSeries = correlationView.series;
      const correlation = correlationSeries.length >= 2
        ? {
            labels: correlationSeries.map((serie) => serie.display_name),
            ...matrizDeCorrelacion(correlationView.dates, correlationSeries),
            nota: notaDeLaMatriz,
            /* El número de cada una en las tablas: quien no se dibuja no está en la matriz, y los demás no se renumeran (decisión 84). */
            numeros: correlationSeries.map((serie, index) => (puestos.get(serie.asset_id) ?? index) + 1)
          }
        : null;

      const benchLast = benchOverlay
        ? [...benchOverlay.values].reverse().find((value) => Number.isFinite(value))
        : undefined;

      /* Lo que no sale en esta salida no llega al documento: ni la retrocesión al cliente, ni la cifra final a una
         clase que reparte, que es lo que la pantalla le niega con el mismo dato. */
      const seriesDibujadas = new Map((evolucion?.series ?? []).map((serie) => [serie.asset_id, serie]));
      const retroDelInforme = (asset: BdbAssetSearchResult) => {
        if (salida !== "interno") return undefined;
        if (!seEnsenaLaMetrica("retrocesion", asset.instrument_type)) return "no-aplica" as const;
        return resolveEffectiveCommercialRetro(asset.asset_id, retroByAssetId)?.rate;
      };
      /* La frase de la pantalla, y la de cliente en la salida para el cliente, aunque no se esté en Modo cliente (decisión 84). */
      const fraseDeFuera = (asset: BdbAssetSearchResult) => {
        const fuera = noDibujados.find((item) => item.asset_id === asset.asset_id);
        return fuera ? fraseDeLoQueNoSeDibuja(asset.display_name, fuera.reason, { modoCliente: salida === "cliente" }) : undefined;
      };
      const fechasYDivisas = fechaYDivisaDeLasCifras(fuentesComparadas);
      /* Lo que cada celda de la pantalla dice bajo su cifra, de las mismas filas: la fecha de cada ventana del proveedor va en su celda (decisión A-125). */
      const apuntes = apuntesDelPapel(columnasComparadas, filasComparadas);

      const descargado = await downloadAssetComparisonPdf({
        assets: selected.map((asset) => ({
          name: asset.display_name,
          isin: asset.isin,
          ticker: asset.ticker,
          instrumentType: asset.instrument_type,
          currency: asset.currency,
          category: asset.category,
          sector: esAccion(asset.instrument_type) ? clasificacionDeTarjeta(tarjetas.get(asset.asset_id)) : undefined,
          morningstarRating: asset.morningstar_rating,
          /* Las MISMAS cifras que la pantalla, y de la misma fuente. Desde que la
             tabla lee la base nueva, tomarlas aquí del activo de siempre produciría un
             informe que no coincide con lo que el asesor acaba de mirar, y la regla de
             este proyecto es que una cifra que ve un cliente no se inventa: dos cifras
             distintas para lo mismo es inventarse una. */
          ...cifrasParaElInforme(asset.asset_id),
          calculo: metodologia.noComparable?.calculoDe[asset.asset_id],
          retro: retroDelInforme(asset),
          sinDividendos: seriesDibujadas.get(asset.asset_id)?.sin_dividendos === true,
          base100: seriesDibujadas.get(asset.asset_id)?.sin_dividendos === true ? undefined : base100ById.get(asset.asset_id),
          noSeDibuja: fraseDeFuera(asset),
          ...fechasYDivisas.get(asset.asset_id),
          apuntes: apuntes.get(asset.asset_id)
        })),
        windowLabel,
        benchmarkName: perfilElegido?.name ?? null,
        benchmarkBase100: typeof benchLast === "number" ? benchLast : undefined,
        benchmarkNote: perfilElegido ? notaDeLaReferencia : undefined,
        /* Cabecera común solo si todos miden la misma ventana; si no, neutra y
           el PDF marca la ventana de cada fila (antes mandaba selected[0]). */
        /* Una sola ventana para toda la columna, porque desde hoy la fila es una
           sola: la caída a tres años. La cabecera neutra y el cálculo de «cuál es la
           común» sobraban en cuanto dejó de haber una ventana por activo. */
        maxDrawdownLabel: "Máx. caída 3A",
        methodologyFootnote: metodologia.footnote,
        /* La frase que la pantalla pone bajo la tabla cuando una ventana empieza antes de la serie válida (decisión 112). */
        notasDeLaSerie: notasDeLaComparativa(fuentesComparadas),
        /* Y la de la cifra apartada que la pantalla pone bajo su tabla, sin la cifra (decisiones B-73 y A-125). */
        cifrasApartadas: cifrasApartadasDeLaComparativa(fuentesComparadas),
        noComparable: metodologia.noComparable && {
          columnas: metodologia.noComparable.columnas,
          sinDeclarar: metodologia.noComparable.sinDeclarar
        },
        correlation,
        salida
      }, () => salida !== "interno" || !clientModeRef.current);
      if (!descargado) decir("Informe interno descartado: se activó el Modo cliente y lleva retrocesiones.");
    } catch (error) {
      appLogger.error("Export PDF comparativa de activos fallo", error);
      setExportError("No se pudo generar el informe PDF. Vuelve a intentarlo.");
    } finally {
      setExportingPdf(false);
    }
  }

  const conCorrelacion = Boolean(rebaseSettled && rebase.data && rebase.data.series.length >= 2);
  const fechasDeLaEvolucion =
    !rebaseSettled || !rebase.data?.coverage?.first_date
      ? aniosEnPalabras(period)
      : comparacion
        ? `Del ${oFalta(fecha(comparacion.primeraComun))} al ${oFalta(fecha(comparacion.ultimaComun))} · ${numero(comparacion.fechas.length)} datos ${semanal ? "semanales" : "diarios"}`
        : `Del ${oFalta(fecha(rebase.data.coverage.first_date))} al ${oFalta(fecha(rebase.data.coverage.last_date))} · ${oFalta(numero(rebase.data.coverage.common_observations))} datos ${semanal ? "semanales" : "diarios"}`;

  return (
    <article className="asset-comparison-panel cmp">
      {/* B4 (12-08): fuera el «Volver al buscador» — el rail es la navegación; */}
      <PageHeader
        eyebrow="Activos"
        actions={
          tab === "assets" && selected.length >= 2 ? (
            <Button
              aria-haspopup={clientMode ? undefined : "dialog"}
              busy={exportingPdf || esperandoComparacion}
              onClick={pedirElInforme}
              textoAlTrabajar="Descargando el informe…"
              variant="primary"
            >
              {exportingPdf ? "Descargando el informe…" : "Descargar el informe"}
            </Button>
          ) : undefined
        }
        className="cmp-head"
        description={
          tab === "portfolios"
            ? "Enfrenta dos propuestas guardadas, o la propuesta en curso, y compara composición, riesgo y rentabilidad."
            : tab === "wealth"
              ? "Introduce tus aportaciones y el valor final. Se comparan con Letras del Tesoro y un depósito bancario mediante TIR nominal y real, antes y después de impuestos."
              : "Compara rentabilidad, riesgo y comportamiento histórico de fondos, ETF y acciones."
        }
        title="Comparador"
      />

      <SegmentedTabs
        idPrefix="comparison"
        label="Modo de comparación"
        onChange={elegirPestana}
        tabs={COMPARISON_TABS}
        value={tab}
      />

      <PanelDePestana className="stack stack--bloques" idPrefix="comparison" pestana={tab}>
        {tab === "wealth" ? (
          <WealthComparator />
        ) : tab === "portfolios" ? (
          <PortfolioComparator carteraActiva={carteraActiva} onIrACarterasGuardadas={onIrACarterasGuardadas} sourceKind={sourceKind} />
        ) : (
          <>
      {!clientMode && retroError ? <AsyncErrorBanner error={retroError} onRetry={retryRetro} /> : null}
      {catalogError ? <AsyncErrorBanner error={catalogError} onRetry={() => setCatalogReload((value) => value + 1)} /> : null}
      {exportError ? <Aviso tono="error">{exportError}</Aviso> : null}

      {/* El orden es la decisión 27 de Óscar: selección, cifras, evolución con su benchmark, mapa y
          correlación. La tabla de cifras era lo último, a 1.600 px. */}
      {/* «Qué se compara»: una sola manera visible de añadir, el buscador por nombre o ISIN, y a su lado el catálogo entero. */}
      <Panel
        acciones={
          <Button
            aria-haspopup="dialog"
            aria-label={`Elegir del catálogo: ${rotuloDelCatalogo(filteredCatalogAssets.length, catalogAssets.length, catalogTotal)}`}
            busy={catalogLoading}
            disabled={catalogLoading || filteredCatalogAssets.length === 0}
            onClick={() => setCatalogOpen(true)}
            size="sm"
            variant="quiet"
          >
            Elegir del catálogo
          </Button>
        }
        claseDelCuerpo="stack stack--tight"
        subtitulo={`${selected.length}/${MAX} seleccionados`}
        titulo="Qué se compara"
      >
        {selected.length > 0 ? (
          <div className="cmp-chips">
            {selected.map((a, i) => {
              // Auditoría 11-08 (F1.3): acción de añadir a cartera por activo comparado, junto al
              // «×» de quitar. Desde ACT-01 (13-11-2026) con la regla común, la de la ficha: este
              // Comparador tenía su propia copia y dejaba añadir lo que la ficha bloquea.
              const inPortfolio = (portfolioAssetIds ?? []).includes(a.asset_id);
              const paraLaAccion = activoParaLaAccion(a.asset_id, undefined, a);
              const sinMedir = sinPrecioNiMetricas(a);
              const addLabel = etiquetaDeAccionDeCartera(paraLaAccion, inPortfolio);
              /* ACT-01 (14-11-2026): lo bloqueado por calidad del dato se puede añadir, y se avisa. */
              const avisoDelBoton = avisoDeAccionDeCartera(paraLaAccion);
              return (
                <span className="cmp-chip" key={a.asset_id}>
                  <MarcaDeActivo color={COLORS[i % COLORS.length]} numero={i + 1} />
                  <span className="cmp-chip-name">
                    <EnlaceAFicha isin={a.asset_id}>{a.display_name}</EnlaceAFicha>
                  </span>
                  <span className="cmp-chip-acciones">
                    {onAddToPortfolio ? (
                      <Button
                        aria-label={`${nombreDeAccionDeCartera(paraLaAccion, inPortfolio)}: ${a.display_name}`}
                        disabled={accionDeCarteraBloqueada(paraLaAccion, inPortfolio)}
                        icon={iconoDeAccionDeCartera(addLabel)}
                        onClick={() => onAddToPortfolio(a)}
                        size="sm"
                        title={sinMedir ? NO_SE_ANADE_SIN_MEDIR : nombreDeAccionDeCartera(paraLaAccion, inPortfolio)}
                        variant="secondary"
                      >
                        {addLabel}
                      </Button>
                    ) : null}
                    {onAddToPortfolio && avisoDelBoton ? <Ausencia clase="falta" motivo={avisoDelBoton} /> : null}
                    <Button
                      aria-label={`Quitar ${a.display_name} de la comparación`}
                      iconOnly
                      onClick={() => removeAsset(a.asset_id)}
                      size="sm"
                      title="Quitar de la comparación"
                      variant="secondary"
                    >
                      ×
                    </Button>
                  </span>
                </span>
              );
            })}
          </div>
        ) : null}

        {/* Ya no se puede elegir, pero una selección de antes puede traerla, y el botón solo no dice por qué. */}
        {selected.filter(sinPrecioNiMetricas).map((a) => (
          <p className="cmp-note" key={a.asset_id}>
            {a.display_name}. {NO_SE_ANADE_SIN_MEDIR}
          </p>
        ))}

        {selected.length < MAX ? (
          <AssetPicker
            sourceKind={sourceKind}
            selectedIds={selected.map((a) => a.asset_id)}
            max={MAX}
            onPick={addAsset}
            filters={pickerFilters}
            onFiltersChange={setPickerFilters}
          />
        ) : null}

        {catalogOpen ? (
          <AssetComparisonCatalogModal
            assets={filteredCatalogAssets}
            selected={selected}
            sourceKind={sourceKind}
            max={MAX}
            avisoDeLimite={avisoDeCatalogoLimitado(catalogAssets, filterToInstrumentTypes(pickerFilters.activeFilter))}
            onApply={applyCatalogSelection}
            onClose={() => setCatalogOpen(false)}
          />
        ) : null}
      </Panel>

      {selected.length < 2 ? (
        <EmptyState
          description="Añade al menos dos fondos, ETF o acciones. También puedes cambiar a Propuestas para comparar dos propuestas guardadas."
          title="Selecciona dos activos para empezar"
        />
      ) : (
        <>
          {/*
            Tercer intercambio del rediseño (03-11-2026). Aquí no se sustituye la
            pantalla, se sustituyen DOS piezas suyas, y el resto de este comparador
            —series en base 100, correlación, benchmark, informe en PDF, retrocesiones—
            se queda igual porque el rediseño no lo cambia.

            El mapa anterior pintaba a TODOS los activos sobre un mismo par de ejes con
            `volatility_3y` y `annualized_return_3y`, sin mirar de qué método salen. Con
            305 acciones de muestreo diario y 767 fondos de mensual en el catálogo, eso
            pone una desviación diaria al lado de una mensual, que es lo que
            METODO_PROPIO_METRICAS prohíbe. El plano nuevo dibuja un panel por método.

            Y la tabla avisaba de esa mezcla en UNA cifra, el Sharpe a tres años, con
            una nota al pie. La nueva lo marca fila a fila, con la misma función.
          */}
          <Panel
            subtitulo="Rentabilidad y volatilidad en euros; las marcadas «proveedor», en la que él publique."
            titulo="Métricas de riesgo y rentabilidad"
          >
            <TablaComparativa
              columnas={columnasComparadas}
              filas={filasComparadas}
              notas={[
                ...notasDeCorteYBase(fuentesComparadas),
                ...notasDeLaComparativa(fuentesComparadas),
                ...notasDeLasCifrasApartadas(fuentesComparadas)
              ]}
              titulo="Métricas de los activos comparados"
            />
          </Panel>

          <Panel
            claseDelCuerpo="stack stack--tight"
            subtitulo={
              avisoDeLaEvolucion
                ? `${avisoDeLaEvolucion} · ${numero(rebase.data?.coverage?.common_observations ?? 0)} datos ${rebase.data?.frequency === "WEEKLY" ? "semanales" : "diarios"}`
                : fechasDeLaEvolucion
            }
            titulo="Evolución comparada (base 100)"
          >
            {/* Los mandos, dentro del bloque: solo gobiernan este gráfico y la matriz de correlación. */}
            <div className="cmp-bench-toolbar">
              {/* Un grupo de botones no se nombra con un `<label>`: el rótulo se ve y el grupo ya lleva su nombre. El
                  rótulo se calla para el lector de pantalla, que si no decía «Periodo, Periodo, grupo». */}
              <div className="cmp-periods">
                <div className="field">
                  <span className="field__label" aria-hidden="true">Periodo</span>
                  <SegmentedControl
                    buttonClassName="cmp-period"
                    label="Periodo"
                    onChange={setPeriod}
                    options={PERIOD_OPTIONS}
                    value={period}
                  />
                </div>
                <div className="field">
                  <span className="field__label" aria-hidden="true">Frecuencia</span>
                  <SegmentedControl
                    buttonClassName="cmp-period"
                    label="Frecuencia"
                    onChange={setFreq}
                    options={FREQUENCY_OPTIONS}
                    value={freq}
                  />
                </div>
              </div>
              <Campo rotulo="Cartera de referencia">
                <select value={benchOverride} onChange={(event) => setBenchOverride(event.target.value)}>
                  <option value={NO_BENCHMARK}>Sin cartera de referencia</option>
                  {BENCHMARK_PROFILES.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} · {Math.round(p.weights.rf * 100)}/{Math.round(p.weights.rv * 100)} RF/RV
                    </option>
                  ))}
                </select>
              </Campo>
              <span className="cmp-note" role="status">
                {notaDeLaReferencia}
                {perfilElegido && referencia.estado === "no-disponible" ? (
                  <>
                    {" "}
                    <Button onClick={referencia.reintentar} size="sm" variant="secondary">
                      Reintentar
                    </Button>
                  </>
                ) : null}
              </span>
              <p className="cmp-note cmp-bench-alcance">El periodo, la frecuencia y la cartera de referencia solo cambian este gráfico y la matriz de correlación; la tabla de arriba no cambia.</p>
            </div>
            {rebaseError ? (
              <AsyncErrorBanner
                error={rebaseError}
                onRetry={() => {
                  /* Vuelve a «cargando» mientras se repite la petición. */
                  setRebase((current) => ({ ...current, key: "" }));
                  setRebaseReload((value) => value + 1);
                }}
              />
            ) : !rebaseSettled ? (
              <LoadingState className="cmp-chart-placeholder">Cargando series históricas…</LoadingState>
            ) : evolucion && evolucion.series.length >= 2 && evolucion.dates.length >= 2 ? (
              <RebaseChart dates={evolucion.dates} series={evolucion.series} puestos={puestos} benchmark={benchOverlay} />
            ) : (
              <div className="cmp-chart-placeholder">
                <p className="asset-detail-muted">
                  {noDibujados.length > 0
                    ? "Con las series que quedan no hay comparación que dibujar."
                    : "Sin histórico común suficiente para estos activos."}
                </p>
              </div>
            )}
            {noDibujados.map((fuera) => (
              <p className="cmp-note" key={fuera.asset_id}>
                {fraseDeLoQueNoSeDibuja(
                  selected.find((activo) => activo.asset_id === fuera.asset_id)?.display_name ?? fuera.asset_id,
                  fuera.reason,
                  { modoCliente: clientMode }
                )}
              </p>
            ))}
          </Panel>

          {/* El mapa y la correlación, en dos columnas; sin correlación, el mapa ocupa todo el ancho. */}
          <div className={conCorrelacion ? "grid" : undefined}>
          <div className={conCorrelacion ? "col-6" : undefined}>
          <Panel
            subtitulo="Rentabilidad anualizada (Y) frente a volatilidad (X), a tres años. Un panel por método de cálculo: dos cifras de métodos distintos no comparten ejes."
            titulo="Mapa riesgo / rentabilidad"
          >
            {/*
              Las coordenadas salen de las MISMAS filas que la tabla, y no de
              `activo.metrics`. Hasta el 03-11-2026 el método venía de la columna y las dos
              cifras de la base anterior, así que este mapa podía poner un punto con cifras
              semanales bajo el panel «mensual» —y el panel existe justo para que eso no
              pase—.
            */}
            <PlanoRiesgoRetorno
              columnas={columnasComparadas}
              ventana="3 años"
              puntoDe={(columna) => puntoDeLaComparativa(columna, filasComparadas)}
            />
          </Panel>
          </div>

          {rebaseSettled && rebase.data && rebase.data.series.length >= 2 ? (
            <div className="col-6">
            <Panel
              subtitulo={
                /* Se mide el histórico común de lo que se compara, no el botón elegido: Carmignac E y Allianz AT2 a «10A» son ocho
                   meses. Si no llega al periodo, se dice con las palabras de la evolución de encima; las del papel, «sobre el histórico común». */
                <>
                  Correlación de rentabilidades semanales sobre el histórico común · {avisoDeLaEvolucion ?? aniosEnPalabras(period)} · claro = baja
                  (diversifica), oscuro = alta
                  {rebase.data.frequency === "DAILY" ? (
                    <>
                      {" "}· se mide en semanal aunque el gráfico vaya en diario: los VL no se publican a
                      la misma hora y en diario la correlación sale sesgada a la baja
                    </>
                  ) : null}
                </>
              }
              claseDelCuerpo="stack stack--tight"
              className="cmp-matriz"
              titulo="Matriz de correlación"
            >
              <CorrelationHeatmap
                dates={correlationView.dates}
                series={correlationView.series}
                numeros={correlationView.series.map((serie, indice) => (puestos.get(serie.asset_id) ?? indice) + 1)}
              />
              {notaDeLaMatriz ? <p className="cmp-note">{notaDeLaMatriz}</p> : null}
            </Panel>
            </div>
          ) : null}
          </div>
          </>
        )}
          </>
        )}
      </PanelDePestana>

      {eligiendoSalida ? (
        <ModalDialog labelledBy="comparativa-salida-title" onClose={() => setEligiendoSalida(false)} size="md">
          <DialogHeader
            eyebrow="Comparativa de activos"
            onClose={() => setEligiendoSalida(false)}
            title="¿Para quién es este informe?"
            titleId="comparativa-salida-title"
          />
          <DialogBody>
            <p className="asset-detail-muted">
              <b>Sin retrocesiones:</b> se puede entregar al cliente. No lleva la columna ni ninguna mención.
            </p>
            <p className="asset-detail-muted">
              <b>Con retrocesiones:</b> lleva la columna y, en el pie de cada hoja, «Documento interno · no entregar al cliente».
            </p>
            {retroError ? <AsyncErrorBanner error={retroError} onRetry={retryRetro} /> : null}
            {accesoARetro === "denied" ? (
              <p className="cmp-note" role="status">Tu cuenta no tiene acceso a las retrocesiones: este informe solo puede salir sin ellas.</p>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button
              busy={retroCargando}
              disabled={Boolean(retroError) || accesoARetro === "denied"}
              onClick={() => descargarLaSalida("interno")}
              variant="secondary"
            >
              Con retrocesiones (uso interno)
            </Button>
            <Button autoFocus onClick={() => descargarLaSalida("cliente")} variant="primary">
              Sin retrocesiones (para el cliente)
            </Button>
          </DialogFooter>
        </ModalDialog>
      ) : null}
    </article>
  );
}
