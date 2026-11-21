import { usePortfolioHorizon } from "../core/usePortfolioHorizon";
import { SIN_PESOS_NO_HAY_SIMULACION } from "../core/textoDeAusencia";
import { HorizonProvenance } from "./PortfolioHorizonPanel";
import { FrontierPanel } from "./FrontierPanel";
import { OaaCorrelationHeatmap } from "../charts/oaa";
import { useMemo } from "react";
import type { BdbAssetDetail, BdbManualPortfolioPosition } from "../types/bdbAssets";
import { appLogger } from "../core/appLogger";
import { OaaLineChart, OaaRiskReturnChart } from "../charts/oaa";
import { OverlapHeatmap } from "../charts/OverlapHeatmap";
import { UnderwaterChart, type UnderwaterSeries } from "../charts/UnderwaterChart";
import { calculateUnderwaterSeries } from "../core/underwater";
import type { BdbAssetHoldings } from "../types/bdbAssets";
import { useAsyncData } from "../core/useAsyncData";
import { MIN_SEMANAS_COMUNES, benchmarkById, compararEnMismasFechas, composicionDeLaReferencia, pesoDeLaReferenciaAlFinal, referenceProfilesForDates, tampocoSeReequilibra } from "../core/benchmarkProfiles";
import { useSeriesDeReferencia } from "../core/useSeriesDeReferencia";
import { useBenchmark } from "../app/BenchmarkContext";
import { useModoCliente } from "../app/ClientModeContext";
import * as formato from "../core/formato";
import { aniosEnPalabras } from "../core/glosarioDePantalla";
import { coberturaDeLaSimulacion, conTramosEstimados, diferencialConLaReferencia, hayCifraDeCartera, leerLaTira, motivoPorPocoPeso, rotuloDeLaSerie } from "../core/medidaDeLaCartera";
import { esFaltaDeDatos, limiteDelCalculo } from "../core/appError";
import { AsyncErrorBanner } from "./AsyncErrorBanner";
import { HistoricalStressCards } from "./HistoricalStressCards";
import { Ausencia } from "./ui/Ausencia";
import { Aviso } from "./ui/Aviso";
import { Button } from "./ui/Button";
import { Cifra } from "./ui/Cifra";
import { Esqueleto } from "./ui/Esqueleto";
import { Panel } from "./ui/Panel";

import { MATRICES_MAX_POSITIONS, selectTopPositionsByWeight } from "../core/topPositions";

/**
 * Qué parte de la analítica se pinta, según la pestaña de Análisis que la monta:
 *
 * - `resumen`: solo el gráfico de evolución frente a la cartera de referencia, con su enlace al detalle.
 * - `referencia`: la evolución con su cierre (cartera, referencia y diferencia en pp) y la caída máxima; el mapa de riesgo y
 *   rentabilidad frente a las carteras de referencia; y las crisis pasadas (ANA-15).
 * - `diversificacion`: la frontera eficiente, el aviso de matrices limitadas, la matriz de correlación y la de solapamiento.
 * - `todo` (por defecto): `referencia` y `diversificacion` seguidas.
 *
 * La frontera eficiente volvió aquí el 14-11-2026 (Óscar: recuperar los datos de antes del rediseño, que la había dejado solo en
 * Diseño → Optimizar): es el primer bloque de Diversificación, como antes lo era en «Analítica avanzada».
 */
export type SeccionDeLaAnalitica = "todo" | "resumen" | "referencia" | "diversificacion";

interface XrayAdvancedProps {
  positions: BdbManualPortfolioPosition[];
  assets: BdbAssetDetail[];
  loadHoldings?: (assetId: string) => Promise<BdbAssetHoldings | null>;
  /** Ola 3b: carga de holdings en lote (una llamada, n ids). Si está, gana. */
  loadHoldingsMany?: (assetIds: string[]) => Promise<Map<string, BdbAssetHoldings | null>>;
  /** Qué bloques se pintan. `todo` por defecto. */
  seccion?: SeccionDeLaAnalitica;
  /** En `resumen`, el enlace «Ver el detalle» del bloque de evolución: lleva a la pestaña «Frente a la referencia». */
  alVerElDetalle?: () => void;
  /** La página ya dice, con su «Reintentar», que la simulación ha fallado: aquí no se repite (ANA-05). */
  falloDichoFuera?: boolean;
}

export function XrayAdvanced({
  positions,
  assets,
  loadHoldings,
  loadHoldingsMany,
  seccion = "todo",
  alVerElDetalle,
  falloDichoFuera = false
}: XrayAdvancedProps) {
  const conReferencia = seccion === "todo" || seccion === "referencia";
  const conMatrices = seccion === "todo" || seccion === "diversificacion";
  // La simulación mide la cartera entera; las dos matrices se dibujan con las
  // MATRICES_MAX_POSITIONS posiciones de mayor peso y se avisa (D3; 10-11-2026).
  const analysisSelection = useMemo(
    () => selectTopPositionsByWeight(positions, MATRICES_MAX_POSITIONS),
    [positions]
  );
  const analysedPositions = analysisSelection.positions;
  const assetIds = useMemo(() => analysedPositions.map((p) => p.asset_id), [analysedPositions]);
  const analysis = usePortfolioHorizon(positions);
  const period = analysis.window;
  const error = analysis.error;
  const resp = analysis.data?.backtest;
  const settled = Boolean(analysis.data);
  /* ANA-05 y ANA-06: además del resultado hay tres estados, y no se confunden. Sin ningún peso no se pide nada; si el servidor dice
     que con estos datos no se puede, o la cartera pasa de un tope del cálculo, reintentar no lo arregla y no se ofrece; y un fallo de la
     petición se dice una sola vez, con «Reintentar». Las palabras son las de «Rentabilidad y riesgo» en Visión general. */
  const hayPeso = positions.some((p) => p.weight_percent > 0);
  const causa = analysis.causa ?? error;
  const sinSerie = Boolean(error) && esFaltaDeDatos(causa);
  const limite = error ? limiteDelCalculo(causa) : null;
  const fallo = Boolean(error) && !sinSerie && !limite;
  const lecturaSinSimulacion =
    !settled && (!hayPeso || sinSerie || limite)
      ? leerLaTira({ horizonte: null, fuera: [], midiendo: false, sinSerie, limite, hayPeso, anos: Number(period[0]) })
      : null;
  const noSePuede = lecturaSinSimulacion?.estado === "falta" ? lecturaSinSimulacion.motivo : null;
  /* Lo que se dibuja es la reconstrucción con los pesos de hoy, y si algo se queda fuera, de la parte medida. */
  const rotuloDeLaCartera = analysis.data ? rotuloDeLaSerie(analysis.data) : "Cartera";
  /* Las carteras de referencia se calculan en el momento con las series de sus dos fondos. Si no llegan, se dice. */
  const referencia = useSeriesDeReferencia();
  /* El mapa las mide en las MISMAS fechas que la cartera. Si llegan menos lejos, la cartera se mide también
     hasta ahí, y se escribe: su punto ya no es la cifra del periodo, pero compara lo comparable. */
  const referenceWindow = useMemo(
    () =>
      resp && referencia.series
        ? referenceProfilesForDates(
            resp.portfolio_series.map((point) => point.date),
            resp.portfolio_series.map((point) => point.value),
            referencia.series
          )
        : null,
    [resp, referencia.series]
  );
  const rrPortfolio = resp
    ? {
        vol: referenceWindow && !referenceWindow.mismaVentana ? referenceWindow.cartera.vol : resp.metrics.volatility,
        ret: referenceWindow && !referenceWindow.mismaVentana ? referenceWindow.cartera.ret : resp.metrics.cagr,
        label: rotuloDeLaCartera
      }
    : null;
  const referenceNote =
    referencia.estado === "no-disponible"
      ? "Cartera de referencia no disponible."
      : referencia.estado === "cargando"
        ? "Cargando las carteras de referencia…"
        : !referenceWindow
          ? `Sin fechas suficientes en común con las carteras de referencia: no se comparan. Hacen falta ${MIN_SEMANAS_COMUNES} semanas.`
          : referenceWindow.mismaVentana
            ? `Carteras de referencia medidas en la misma ventana que la cartera (${aniosEnPalabras(Number(period[0]))}, semanal, ${formato.periodo(referenceWindow.firstDate, referenceWindow.lastDate)}).`
            : `Cartera y carteras de referencia medidas en las mismas fechas, semanal, ${formato.periodo(referenceWindow.firstDate, referenceWindow.lastDate)}, la última común; la cifra de la cartera es de ese tramo, no del periodo.`;
  const { benchmarkId } = useBenchmark();
  /* En Modo cliente la matriz mide igual, pero no dice que la cartera de un ETF es la de su emisor (B-79, revisada el 14-11-2026). */
  const nombrarAlEmisor = useModoCliente().seEnsena("carteraDelEmisor");

  const holdingsLoad = useAsyncData(
    async () => {
      if (!loadHoldings && !loadHoldingsMany) return { holdings: [], failedIds: [] as string[] };
      // Ola 3b: una sola llamada batch cuando el adaptador la ofrece — el
      // abanico de n llamadas simultáneas provocaba cola y arranques en frío
      // en el servidor (X-Ray utilizable a ~7 s, medido en producción 11-08).
      if (loadHoldingsMany) {
        try {
          const byId = await loadHoldingsMany(assetIds);
          return { holdings: assetIds.map((id) => byId.get(id) ?? null), failedIds: [] as string[] };
        } catch (cause) {
          appLogger.warn("xray: fallo de la carga batch de holdings; se degrada a llamadas sueltas", cause);
          if (!loadHoldings) {
            return { holdings: assetIds.map(() => null), failedIds: [...assetIds] };
          }
        }
      }
      const failedIds: string[] = [];
      const promises = assetIds.map(async (id) => {
        try {
          return await loadHoldings!(id);
        } catch (cause) {
          // Auditoría 27-07 (T1): un fallo por activo dejaba el mapa de solapamiento
          // incompleto sin distinguirse de "sin holdings publicados".
          appLogger.warn(`xray: holdings no disponibles para ${id}`, cause);
          failedIds.push(id);
          return null;
        }
      });
      const holdings = await Promise.all(promises);
      return { holdings, failedIds };
    },
    [assetIds, loadHoldings, loadHoldingsMany],
    /* Con una sola posición no hay pares que solapar: no se piden sus subyacentes (ANA-07). Y solo donde se pinta la matriz. */
    { enabled: conMatrices && Boolean((loadHoldings || loadHoldingsMany) && assetIds.length > 1), initialData: { holdings: [], failedIds: [] } }
  );

  const overlapSeries = useMemo(() => {
    const fallidos = new Set(holdingsLoad.data?.failedIds ?? []);
    return assetIds.map((assetId, i) => {
      const asset = assets.find((a) => a.asset_id === assetId);
      const holdings = holdingsLoad.data?.holdings[i] ?? null;
      return {
        asset_id: assetId,
        display_name: asset?.display_name ?? assetId,
        instrument_type: asset?.instrument_type,
        replica: asset?.product_profile?.replication,
        holdings,
        noSePudoLeer: fallidos.has(assetId)
      };
    });
  }, [assetIds, assets, holdingsLoad.data]);

  const holdingsFailedNames = useMemo(() => {
    const failed = holdingsLoad.data?.failedIds ?? [];
    return failed.map((id) => assets.find((a) => a.asset_id === id)?.display_name ?? id);
  }, [assets, holdingsLoad.data]);

  /* Cartera y referencia se comparan en las mismas fechas y hasta la última común, que se escribe. Lo que no
     tiene dato en una de las dos no se arrastra: esa fecha no se compara. */
  const perfilElegido = benchmarkById(benchmarkId);
  const comparacion = useMemo(() => {
    if (!resp || !referencia.series || !perfilElegido) return null;
    return compararEnMismasFechas(resp.portfolio_series.map((p) => p.date), resp.portfolio_series.map((p) => p.value), perfilElegido.weights, referencia.series);
  }, [perfilElegido, referencia.series, resp]);
  /* Cómo acaba la referencia en este periodo, sin reequilibrar (decisión 86): cambia con el periodo. */
  const pesoAlFinal = comparacion && perfilElegido ? pesoDeLaReferenciaAlFinal(perfilElegido, comparacion.rentaVariableAlFinal) : null;

  const evolution = useMemo(() => {
    if (!resp) return null;
    const dates = comparacion?.fechas ?? resp.portfolio_series.map((p) => p.date);
    const values = comparacion?.valores ?? resp.portfolio_series.map((p) => p.value);
    return { dates, values, last: values.at(-1) ?? 100 };
  }, [comparacion, resp]);

  const benchmarkEvolution = useMemo(() => {
    if (!comparacion || !perfilElegido) return null;
    return { profile: perfilElegido, values: comparacion.referencia, last: comparacion.referencia.at(-1) ?? null };
  }, [perfilElegido, comparacion]);

  const underwaterSeries = useMemo(() => {
    if (!evolution) return null;
    const portfolioDrawdowns = calculateUnderwaterSeries(evolution.values);
    const series: UnderwaterSeries[] = [
      {
        id: "portfolio",
        label: rotuloDeLaCartera,
        papel: "cartera" as const,
        values: evolution.dates.map((date, index) => ({ date, value: portfolioDrawdowns[index] }))
      }
    ];

    if (benchmarkEvolution && benchmarkEvolution.values.length > 0) {
      const benchmarkDrawdowns = calculateUnderwaterSeries(benchmarkEvolution.values);
      series.push({
        id: `benchmark-${benchmarkEvolution.profile.id}`,
        label: benchmarkEvolution.profile.name,
        papel: "referencia" as const,
        values: evolution.dates.map((date, index) => ({ date, value: benchmarkDrawdowns[index] }))
      });
    }

    return series;
  }, [evolution, benchmarkEvolution, rotuloDeLaCartera]);

  /* Las series rebasadas llegan del backend con el identificador como nombre;
     para el índice de la matriz se sustituye por el nombre comercial. */
  /* La correlacion se mide SIEMPRE en semanal, se dibuje en diario o no: el VL
     de los fondos se publica con retraso y la serie diaria esta autocorrelacionada,
     lo que sesga la correlacion a la baja y hace parecer mas diversificada de lo
     que es a una cartera que no lo esta. */
  /* Con más posiciones que MATRICES_MAX_POSITIONS, la matriz es la de las mayores: la misma cifra de la
     simulación, solo las filas y columnas de esas posiciones. Hasta ese número sale entera, como antes. */
  const enLaMatriz = useMemo(() => new Set(assetIds), [assetIds]);
  const corr = useMemo(() => {
    if (!resp) return null;
    const indices = resp.asset_ids.map((key, index) => ({ key, index }))
      .filter(({ key }) => analysisSelection.omittedCount === 0 || enLaMatriz.has(key));
    if (indices.length < 2) return null;
    const items = indices.map(({ key }) => ({ key, label: assets.find((a) => a.asset_id === key)?.display_name ?? key }));
    return { items, cells: items.flatMap((row,rowIndex) => items.map((col,columnIndex) => ({
      rowKey:row.key,columnKey:col.key,rowLabel:row.label,columnLabel:col.label,rowIndex,columnIndex,
      value:resp.correlation_matrix[indices[rowIndex].index][indices[columnIndex].index]
    }))) };
  }, [resp, assets, analysisSelection.omittedCount, enLaMatriz]);

  /* Punto de máxima caída de la cartera: la cifra vive en la cabecera del
     bloque de drawdown, no impresa dentro del área de trazado. Se mide con toda su serie en el tramo dibujado, no
     solo en las fechas comunes con la referencia: sobre todo el periodo es la Caída máxima de las demás pantallas. */
  const maxDrawdown = useMemo(() => {
    if (!resp || !evolution) return null;
    const desde = evolution.dates[0];
    const hasta = evolution.dates[evolution.dates.length - 1];
    const tramo = resp.portfolio_series.filter((point) => point.date >= desde && point.date <= hasta);
    const caidas = calculateUnderwaterSeries(tramo.map((point) => point.value));
    let min: { date: string; value: number } | null = null;
    caidas.forEach((value, index) => {
      if (Number.isFinite(value) && (min === null || value < min.value)) min = { date: tramo[index].date, value };
    });
    return min !== null && (min as { value: number }).value < 0 ? (min as { date: string; value: number }) : null;
  }, [evolution, resp]);

  /* ANA-21: las series del gráfico de evolución no se rehacen en cada pintada; así su memorización sirve. */
  const seriesDeLaEvolucion = useMemo(
    () =>
      evolution
        ? [
            {
              id: "portfolio",
              label: rotuloDeLaCartera,
              papel: "cartera" as const,
              values: evolution.dates.map((date, index) => ({ date, value: evolution.values[index] ?? null }))
            },
            ...(benchmarkEvolution
              ? [
                  {
                    id: `benchmark-${benchmarkEvolution.profile.id}`,
                    label: benchmarkEvolution.profile.name,
                    papel: "referencia" as const,
                    values: evolution.dates.map((date, index) => ({
                      date,
                      value: Number.isFinite(benchmarkEvolution.values[index]) ? benchmarkEvolution.values[index] : null
                    }))
                  }
                ]
              : [])
          ]
        : [],
    [benchmarkEvolution, evolution, rotuloDeLaCartera]
  );

  /* ANA-07: con una sola posición se pinta todo lo que tiene sentido con un fondo (la evolución frente a la referencia, la caída, el
     mapa); solo las dos matrices necesitan dos, y lo dicen en su sitio. */
  const unaSolaPosicion = assetIds.length < 2;

  /* Por debajo del 80 % del peso no hay cifra de la cartera (decisión 36): lo que se dibuja sigue diciendo que es la parte
     medida, y lo que se le compare a una cartera entera no se escribe. */
  const pesoMedido = analysis.data?.coverageWeightPercent ?? 100;
  const parteMedida = hayCifraDeCartera(pesoMedido) ? null : rotuloDeLaCartera.toLowerCase();
  const finalDeLaReferencia = benchmarkEvolution?.last;
  const diferencial =
    evolution && typeof finalDeLaReferencia === "number" ? diferencialConLaReferencia(evolution.last, finalDeLaReferencia, pesoMedido) : null;

  /* El estado de la simulación, dicho una sola vez (ANA-05): el fallo, en el primer bloque que la dibuja; los demás, que no la hay. */
  const conEvolucion = seccion !== "diversificacion";
  const sinSimulacion = (aqui: boolean) =>
    fallo ? (
      aqui && !falloDichoFuera ? <AsyncErrorBanner error={causa} onRetry={analysis.retry} /> : <p className="analisis-nota">Sin simulación no hay nada que dibujar.</p>
    ) : noSePuede ? (
      <div className="stack stack--2">
        <Ausencia clase="falta" />
        <p className="analisis-nota">{noSePuede}</p>
      </div>
    ) : !settled && analysis.sinPesos ? (
      <p className="analisis-nota">{SIN_PESOS_NO_HAY_SIMULACION}</p>
    ) : !settled ? (
      <div className="stack stack--2" aria-busy="true">
        <p className="analisis-nota" role="status">Calculando series…</p>
        <Esqueleto alto={aqui ? 300 : 200} />
      </div>
    ) : null;

  const procedenciaDeLaEvolucion = analysis.data
    ? `Base 100 · ${aniosEnPalabras(analysis.data.years)} · ${formato.peso(analysis.data.coverageWeightPercent / 100)} del peso medido`
    : "Base 100";

  const grafico = (
    <OaaLineChart
      height={300}
      series={seriesDeLaEvolucion}
      referenceValue={100}
      ariaLabel="Evolución simulada de la cartera y de la cartera de referencia elegida, con base 100"
    />
  );

  /* La línea de qué se compara y en qué fechas, bajo el título del detalle. */
  const fechasDeLaEvolucion = evolution ? (
    <p className="analisis-nota">
      {formato.periodo(comparacion?.primeraComun ?? resp?.coverage?.first_date, comparacion?.ultimaComun ?? resp?.coverage?.last_date)} ·{" "}
      {comparacion ? evolution.dates.length : resp?.coverage?.common_observations} observaciones{" "}
      {resp?.frequency === "DAILY" ? "diarias" : "semanales"}
      {/* Cuánta cartera mide, en la misma línea que las fechas: debajo iban otra vez las fechas, escritas de otra forma. */}
      {analysis.data ? ` · ${coberturaDeLaSimulacion(analysis.data)}` : ""}
      {comparacion && perfilElegido
        ? `. Cartera y referencia en las mismas fechas, hasta el ${formato.fecha(comparacion.ultimaComun)}${comparacion.cortadaAlFinal ? `, la última común: la simulación de la cartera llega al ${formato.fecha(resp?.coverage?.last_date)}` : ""}. ${perfilElegido.name}: ${composicionDeLaReferencia(perfilElegido)}.${pesoAlFinal ? ` ${pesoAlFinal}.` : ""} La cartera parte de los pesos de hoy y ${tampocoSeReequilibra(perfilElegido)}.`
        : referencia.estado === "no-disponible"
          ? ". Cartera de referencia no disponible: se dibuja solo la cartera."
          : referencia.estado === "lista"
            ? `. Sin fechas suficientes en común con la cartera de referencia: no se comparan. Hacen falta ${MIN_SEMANAS_COMUNES} semanas.`
            : ""}
      {referencia.estado === "no-disponible" ? (
        <>
          {" "}
          <Button onClick={referencia.reintentar} size="sm" variant="secondary">
            Reintentar
          </Button>
        </>
      ) : null}
    </p>
  ) : null;

  const sinHistoricoComun = (
    <p className="analisis-nota">Sin histórico común suficiente para estos activos. Amplía el periodo o revisa las posiciones sin serie.</p>
  );

  return (
    <div className="stack stack--bloques">
      {seccion === "resumen" ? (
        <Panel
          acciones={
            alVerElDetalle ? (
              <Button onClick={alVerElDetalle} size="sm" variant="quiet">
                Ver el detalle
              </Button>
            ) : undefined
          }
          claseDelCuerpo="stack stack--tight"
          subtitulo={procedenciaDeLaEvolucion}
          titulo="Evolución frente a la cartera de referencia"
        >
          {sinSimulacion(true) ?? (evolution ? grafico : sinHistoricoComun)}
        </Panel>
      ) : null}

      {conReferencia ? (
        <>
          {/* La evolución con su cierre y la caída máxima: una sola historia temporal en un bloque. */}
          <Panel
            claseDelCuerpo="stack stack--tight"
            subtitulo="Simulación con los pesos de hoy, frente a la cartera de referencia elegida, las dos con base 100."
            titulo="Evolución histórica de la cartera"
          >
            {sinSimulacion(true) ??
              (evolution ? (
                <>
                  {fechasDeLaEvolucion}
                  {analysis.data ? <HorizonProvenance analysis={analysis.data} assets={assets} conPeriodo={false} /> : null}
                  {grafico}
                  <dl className="analisis-cierre" aria-label="Cómo acaba el periodo, en base 100">
                    <div className="analisis-cierre__dato">
                      <dt>{rotuloDeLaCartera}</dt>
                      <dd>
                        <Cifra decimales={1} tipo="numero" valor={evolution.last} /> (<Cifra tipo="rentabilidad" valor={(evolution.last - 100) / 100} />)
                      </dd>
                    </div>
                    {benchmarkEvolution?.last !== null && benchmarkEvolution?.last !== undefined ? (
                      <>
                        <div className="analisis-cierre__dato">
                          <dt>{benchmarkEvolution.profile.name}</dt>
                          <dd>
                            <Cifra decimales={1} tipo="numero" valor={benchmarkEvolution.last} /> (<Cifra tipo="rentabilidad" valor={(benchmarkEvolution.last - 100) / 100} />)
                          </dd>
                        </div>
                        {/* ANA-09: la diferencia de dos rentabilidades acumuladas va en puntos porcentuales, con su unidad. */}
                        <div className="analisis-cierre__dato">
                          <dt>Diferencia acumulada</dt>
                          <dd>{diferencial === null ? <Ausencia clase="falta" /> : <Cifra tipo="puntos" valor={diferencial / 100} />}</dd>
                        </div>
                      </>
                    ) : referencia.estado === "cargando" ? null : (
                      <div className="analisis-cierre__dato">
                        <dt>Cartera de referencia</dt>
                        <dd>
                          <Ausencia
                            clase="falta"
                            motivo={referencia.estado === "no-disponible" ? "No disponible" : "Sin datos suficientes para este periodo"}
                          />
                        </dd>
                      </div>
                    )}
                  </dl>
                  {typeof finalDeLaReferencia === "number" && diferencial === null ? <p className="analisis-nota">{motivoPorPocoPeso(pesoMedido)}</p> : null}
                  {underwaterSeries ? (
                    <div className="stack stack--2">
                      <h3 className="analisis-subtitulo">Caída máxima</h3>
                      {/* La cifra está en la respuesta de la pantalla: aquí, cuándo tocó fondo y de qué es la curva. */}
                      {maxDrawdown ? (
                        <p className="analisis-nota analisis-caida">
                          {parteMedida ? `De la ${parteMedida}. ` : ""}El punto más bajo, el {formato.fecha(maxDrawdown.date)}.
                        </p>
                      ) : null}
                      <UnderwaterChart series={underwaterSeries} height={190} ariaLabel="Caída máxima de la cartera y de la cartera de referencia elegida" />
                    </div>
                  ) : null}
                </>
              ) : (
                sinHistoricoComun
              ))}
          </Panel>

          <Panel
            claseDelCuerpo="stack stack--tight"
            subtitulo={`Simulación con los pesos de hoy (volatilidad y rentabilidad anualizada a ${aniosEnPalabras(Number(period[0]))}${conTramosEstimados(analysis.data) ? " · estimado" : ""}) frente a las carteras de referencia.`}
            titulo="Mapa de riesgo y rentabilidad frente a las carteras de referencia"
          >
            {sinSimulacion(false) ?? (
              <>
                <OaaRiskReturnChart
                  portfolio={rrPortfolio ? { id: "portfolio", label: rrPortfolio.label, vol: rrPortfolio.vol, ret: rrPortfolio.ret } : null}
                  benchmarks={referenceWindow?.profiles ?? []}
                  height={320}
                  ariaLabel="Mapa de riesgo y rentabilidad de la cartera frente a las carteras de referencia"
                  dataQuality="estimated"
                  dataQualityLabel="Sintético"
                  dataQualityNote={referenceNote}
                />
                <p className="analisis-nota">
                  {referenceNote} Carteras sintéticas: combinaciones globales de renta fija y variable en euros. No son recomendación de inversión.
                </p>
              </>
            )}
          </Panel>

          {/* ANA-15: las crisis pasadas, que lleva el informe para el cliente, se ven también aquí. Vienen en la misma simulación. */}
          {analysis.data ? (
            <HistoricalStressCards
              assetLabels={Object.fromEntries(assets.map((asset) => [asset.asset_id, asset.display_name]))}
              positions={positions}
              scenarios={analysis.data.backtest.stress_scenarios}
            />
          ) : null}
        </>
      ) : null}

      {conMatrices ? (
        <>
          {/* La misma simulación que el resto de la pestaña: la petición va a la caché por la misma huella. Si ha fallado, o los datos
              no dan, lo dice como los demás bloques, sin repetir el «Reintentar» de la página (ANA-05). Sin pesos, la estimada por
              composición, como antes. */}
          {fallo || (noSePuede && hayPeso) ? (
            <Panel claseDelCuerpo="stack stack--tight" titulo="Frontera eficiente">
              {sinSimulacion(false)}
            </Panel>
          ) : (
            <FrontierPanel assets={assets} positions={positions} />
          )}
          {analysisSelection.omittedCount > 0 ? (
            <Aviso titulo={`Matrices de correlación y de solapamiento con las ${analysedPositions.length} mayores posiciones.`}>
              Cubren el {formato.peso(analysisSelection.coveredWeightPercent / 100)} del peso de la cartera: {analysisSelection.omittedCount} posiciones
              menores quedan fuera, porque una matriz más grande no se lee. La evolución, las cifras y la caída máxima son de la cartera entera.
            </Aviso>
          ) : null}

          <Panel
            claseDelCuerpo="stack stack--tight"
            subtitulo="Rentabilidades semanales · claro = baja (diversifica), oscuro = alta."
            titulo="Matriz de correlación"
          >
            {unaSolaPosicion ? (
              <p className="analisis-nota">La matriz de correlación necesita al menos dos posiciones.</p>
            ) : (
              sinSimulacion(!conEvolucion) ??
              (corr ? (
                <OaaCorrelationHeatmap
                  items={corr.items}
                  cells={corr.cells}
                  dataQuality={conTramosEstimados(analysis.data) ? "estimated" : "real"}
                  dataQualityLabel={conTramosEstimados(analysis.data) ? "Estimado" : undefined}
                />
              ) : (
                <p className="analisis-nota">Sin series históricas comunes con las que calcular la correlación.</p>
              ))
            )}
          </Panel>

          <Panel
            claseDelCuerpo="stack stack--tight"
            subtitulo="Subyacentes comunes entre fondos y ETF, con el peso real de las posiciones que publican. Es un mínimo: el real puede ser mayor."
            titulo="Matriz de solapamiento"
          >
            {unaSolaPosicion ? (
              <p className="analisis-nota">La matriz de solapamiento necesita al menos dos posiciones.</p>
            ) : holdingsLoad.error ? (
              <AsyncErrorBanner error={holdingsLoad.error} onRetry={holdingsLoad.retry} />
            ) : holdingsLoad.loading ? (
              <div className="stack stack--2" aria-busy="true">
                <p className="analisis-nota" role="status">Cargando subyacentes…</p>
                <Esqueleto alto={200} />
              </div>
            ) : overlapSeries.length > 0 ? (
              <>
                {holdingsFailedNames.length > 0 ? (
                  <Aviso titulo="Mapa incompleto.">
                    No se pudieron cargar los subyacentes de {holdingsFailedNames.join(", ")} (fallo de conexión, no falta de datos).
                  </Aviso>
                ) : null}
                <OverlapHeatmap nombrarAlEmisor={nombrarAlEmisor} series={overlapSeries} />
              </>
            ) : (
              <p className="analisis-nota">Sin datos de solapamiento para esta cartera.</p>
            )}
          </Panel>
        </>
      ) : null}
    </div>
  );
}
