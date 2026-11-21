import { useEffect, useMemo, useState } from "react";
import { getAssetDataSource } from "../adapters/assetDataSource";
import { backendListPortfolios, usesBackendPersistence } from "../adapters/portfolioBackend";
import { fetchComparisonHistory } from "../adapters/portfolioComparisonHistory";
import { seriesParadas } from "../adapters/finDeLaSerie";
import { useModoCliente } from "../app/ClientModeContext";
import { carterasQueSeOfrecen, eleccionDeCarteras, loQueFaltaEnLaComparacion, periodoDeLaComparacion, type EleccionDeCarteras } from "../core/comparacionDeCarteras";
import { readLocalPortfoliosFromStorage } from "../core/localPortfolioStorage";
import { esFaltaDeDatos } from "../core/appError";
import { clasificacionQueFalta, entradaDeLaComparativa, notasDeLaComparativa, sharpeDeUnaSolaAccion, type ComparativaCargada } from "../core/entradaDeComparativa";
import { alinearLasQueDanCifra, comparisonAllocations, comparisonCoverage, comparisonPositions, type ComparisonAllocationRow, type ComparisonHistory, type ComparisonPeriod, type ComparisonResult } from "../core/portfolioComparison";
import type { BdbAssetDetail, BdbManualPortfolioPosition, BdbSavedLocalPortfolio } from "../types/bdbAssets";
import type { AssetDataSource, AssetDataSourceKind } from "../types/assetDataSource";
import "../styles/comparador.css";
import { OaaLegend, OaaLineChart, OaaRiskReturnChart, type OaaRiskReturnPoint } from "../charts/oaa";
import { estilosPorPapel, type PapelDeSerie } from "../charts/oaa/chartTheme";
import { numero, oFalta, periodo, peso, porcentaje } from "../core/formato";
import { categoriaLegible, regionLegible } from "../core/etiquetasDeReparto";
import { fueraDeLaMedida, hayCifraDeCartera, MOTIVO_SIN_SERIE, motivoPorPocoPeso, motivoPorPocoPesoYFuera, PESO_MINIMO_MEDIDO_PCT } from "../core/medidaDeLaCartera";
import { motivoDeQueNoAplique } from "../core/metricasPorInstrumento";
import { textoEnPantalla } from "../core/glosarioDePantalla";
import { AsyncErrorBanner } from "./AsyncErrorBanner";
import { EmptyState, LoadingState } from "./ui/AsyncState";
import { Ausencia } from "./ui/Ausencia";
import { Aviso } from "./ui/Aviso";
import { Button } from "./ui/Button";
import { Campo } from "./ui/Campo";
import { Cifra, type TipoDeCifra } from "./ui/Cifra";
import { ClaseConColor } from "./ui/ClaseConColor";
import { claseDeLaDiferencia, NOTA_DEL_COLOR_DE_LA_DIFERENCIA, type SentidoDeLaCifra } from "../core/sentidoDeLaDiferencia";
import { Panel } from "./ui/Panel";
import { Respuesta } from "./ui/Respuesta";
import { SegmentedControl } from "./ui/SegmentedControl";

/*
 * Los colores de A y B salen del papel de la serie (chartTheme.ts): A es la propuesta que se mira, `--serie-1`; B es la
 * primera serie, `--serie-2`, también cuando A no se dibuja. El puesto fijo de B es lo que le deja su color sola.
 */
const PAPEL_A = { papel: "cartera" as PapelDeSerie };
const PAPEL_B = { papel: "serie" as PapelDeSerie, puesto: 0 };
const [ESTILO_A, ESTILO_B] = estilosPorPapel([PAPEL_A, PAPEL_B]);
const PERIODS = [{ id: "3Y", label: "3 años" }, { id: "5Y", label: "5 años" }, { id: "10Y", label: "10 años" }] as const;

function getStorage() {
  try { return typeof window !== "undefined" ? window.localStorage : undefined; }
  catch { return undefined; }
}

/**
 * Las barras de A y B por grupo. Con `porClase`, el nombre de cada clase de activo lleva delante el punto de su color fijo, el mismo
 * que en el aro de Diseño y en «En qué está invertida» (14-11-2026): las barras siguen en el color de A y de B, que es lo que comparan.
 */
function AllocationBars({ rows, nameA, nameB, porClase = false }: { rows: ComparisonAllocationRow[]; nameA: string; nameB: string; porClase?: boolean }) {
  // Keep every weight, grouping the smaller categories for a readable overview.
  const visible = rows.length > 8 ? [...rows.slice(0, 7), {
    key: "__remainder", label: "Resto de grupos",
    a: rows.slice(7).reduce((sum, row) => sum + row.a, 0),
    b: rows.slice(7).reduce((sum, row) => sum + row.b, 0)
  }] : rows;
  /* Los pesos llegan en puntos (40 es un 40 %): el formato recibe fracciones. */
  const pesoDe = (puntos: number) => oFalta(peso(puntos / 100));
  return <div className="pcmp-allocation-bars">{visible.map((row) => <div key={row.key}>
    <div className="pcmp-allocation-label"><span>{porClase && row.key !== "__remainder" ? <ClaseConColor clave={row.key}>{row.label}</ClaseConColor> : row.label}</span><span><b className="pcmp-name--a">{pesoDe(row.a)}</b><span aria-hidden="true"> · </span><b className="pcmp-name--b">{pesoDe(row.b)}</b></span></div>
    <div className="pcmp-bar-track" role="img" aria-label={`${nameA}, ${row.label}: ${pesoDe(row.a)}`}><span className="pcmp-bar--a" style={{ width: `${row.a}%` }} /></div>
    <div className="pcmp-bar-track" role="img" aria-label={`${nameB}, ${row.label}: ${pesoDe(row.b)}`}><span className="pcmp-bar--b" style={{ width: `${row.b}%` }} /></div>
  </div>)}</div>;
}

/** `a` o `b` en null: el servidor ha dicho que con esos datos no se puede simular esa cartera, que mide un 0 %. Sin ninguna de las dos no hay `result`. */
interface LoadedComparison { period: ComparisonPeriod; a: ComparisonHistory | null; b: ComparisonHistory | null; result: ComparisonResult | null }

function ComparisonDashboard({ a, b, dataSource, sourceKind, conLaActiva }: {
  a: BdbSavedLocalPortfolio;
  b: BdbSavedLocalPortfolio;
  dataSource: AssetDataSource;
  sourceKind: AssetDataSourceKind;
  /** Una de las dos es la cartera activa sin guardar: el papel habla de composiciones guardadas. */
  conLaActiva: boolean;
}) {
  const [period, setPeriodo] = useState<ComparisonPeriod>(() => periodoDeLaComparacion.read());
  const setPeriod = (siguiente: ComparisonPeriod) => {
    periodoDeLaComparacion.write(siguiente);
    setPeriodo(siguiente);
  };
  const [history, setHistory] = useState<LoadedComparison | null>(null);
  const [historyError, setHistoryError] = useState<unknown>(null);
  const [historyReload, setHistoryReload] = useState(0);
  const [assets, setAssets] = useState<BdbAssetDetail[] | null>(null);
  const [assetsError, setAssetsError] = useState<unknown>(null);
  const [assetsReload, setAssetsReload] = useState(0);
  const [allocation, setAllocation] = useState<"category" | "economic_asset_class">("category");
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<unknown>(null);
  const live = sourceKind === "BBDD_LIVE_API";

  useEffect(() => {
    let active = true;
    setAssets(null); setAssetsError(null);
    const ids = [...new Set([...a.positions, ...b.positions].map((p) => p.asset_id))];
    dataSource.getComparableAssets(ids).then((result) => { if (active) setAssets(result); })
      .catch((error: unknown) => { if (active) setAssetsError(error); });
    return () => { active = false; };
  }, [a.positions, b.positions, dataSource, assetsReload]);

  useEffect(() => {
    if (!live) return;
    let active = true;
    setHistory(null); setHistoryError(null);
    Promise.allSettled([fetchComparisonHistory(a.positions, period), fetchComparisonHistory(b.positions, period)]).then((results) => {
      if (!active) return;
      /* Que con estos datos no se pueda no es un fallo: reintentar no lo arregla, y la otra cartera no pierde lo suyo. */
      const failures = results.flatMap((result, index) => result.status === "rejected" && !esFaltaDeDatos(result.reason)
        ? [`${index === 0 ? a.name : b.name}: ${result.reason instanceof Error ? result.reason.message : "No se pudo obtener el histórico."}`] : []);
      if (failures.length) { setHistoryError(new Error(failures.join(" "))); return; }
      const left = results[0].status === "fulfilled" ? results[0].value : null;
      const right = results[1].status === "fulfilled" ? results[1].value : null;
      /* CMP-1: la que no llega al 80 % del peso no da cifra, y sus fechas no recortan a la otra. */
      const lado = (historia: ComparisonHistory | null, posiciones: BdbSavedLocalPortfolio["positions"]) =>
        ({ historia, daCifra: historia !== null && hayCifraDeCartera(comparisonCoverage(historia, posiciones).weight) });
      try { setHistory({ period, a: left, b: right, result: alinearLasQueDanCifra(lado(left, a.positions), lado(right, b.positions), period) }); }
      catch (error) { setHistoryError(error); }
    });
    return () => { active = false; };
  }, [live, a.positions, b.positions, a.name, b.name, period, historyReload]);

  const current = history?.period === period ? history : null;
  const result = current?.result ?? undefined;
  const coverageA = current?.a ? comparisonCoverage(current.a, a.positions) : null;
  const coverageB = current?.b ? comparisonCoverage(current.b, b.positions) : null;
  const sinSerieA = Boolean(current) && !current?.a;
  const sinSerieB = Boolean(current) && !current?.b;
  /* Sin serie que cubra el 80 % del peso no hay cifra de la cartera (decisión 36): ni en la tabla, ni en su curva ni en su punto del mapa, porque aquí al
     lado hay otra cartera y una parte no se compara con una cartera entera (decisión 104). En Analítica avanzada y en Diseño no la hay, y la parte medida
     sigue dibujada (decisión 60). */
  const faltaA = sinSerieA || (coverageA !== null && !hayCifraDeCartera(coverageA.weight));
  const faltaB = sinSerieB || (coverageB !== null && !hayCifraDeCartera(coverageB.weight));
  const motivoDe = (cartera: BdbSavedLocalPortfolio, historia: ComparisonHistory | null | undefined, peso: number) => {
    if (!assets || !historia) return motivoPorPocoPeso(peso);
    const posiciones = comparisonPositions(cartera.positions).map((posicion) => ({ ...posicion, label: cartera.positions.find((p) => p.asset_id === posicion.asset_id)?.label }));
    return motivoPorPocoPesoYFuera(peso, fueraDeLaMedida(historia, posiciones, assets));
  };
  const falta = loQueFaltaEnLaComparacion(
    sinSerieA ? MOTIVO_SIN_SERIE : faltaA && coverageA ? motivoDe(a, current?.a, coverageA.weight) : null,
    sinSerieB ? MOTIVO_SIN_SERIE : faltaB && coverageB ? motivoDe(b, current?.b, coverageB.weight) : null
  );
  const dibuja = ({ id }: { id: string }) => (id === "A" ? falta.dibujaA : falta.dibujaB);
  const legend = [{ id: "A", label: a.name, color: ESTILO_A.color }, { id: "B", label: b.name, color: ESTILO_B.color }];
  const legendaDeLaSerie = legend.filter(dibuja);
  const marks: OaaRiskReturnPoint[] = result ? [
    { id: "A", label: a.name, metrics: result.metricsA, papel: PAPEL_A.papel },
    { id: "B", label: b.name, metrics: result.metricsB, papel: PAPEL_B.papel }
  ].filter(dibuja).flatMap(({ metrics, ...point }) => metrics.cagr !== null && metrics.volatility !== null ? [{ ...point, ret: metrics.cagr, vol: metrics.volatility }] : []) : [];
  const extended = !!current && (Boolean(current.a?.extensionNotes.length) || Boolean(current.b?.extensionNotes.length));
  /* El rótulo es de lo que se dibuja: los tramos estimados de una cartera sin cifra no están en la curva de la otra. */
  const extendedDibujado = !!current && ((falta.dibujaA && Boolean(current.a?.extensionNotes.length)) || (falta.dibujaB && Boolean(current.b?.extensionNotes.length)));
  /* Lo que se mide en parte, de las que se dibujan. La que no llega al 80 % ya lo dice con su motivo. */
  const coberturasDibujadas = [
    falta.dibujaA && coverageA && coverageA.weight < 99.99 ? `${a.name}: ${textoEnPantalla(coverageA.note)}` : null,
    falta.dibujaB && coverageB && coverageB.weight < 99.99 ? `${b.name}: ${textoEnPantalla(coverageB.note)}` : null
  ].filter(Boolean).join(" ");
  /* `comparisonAllocations` también lo lee el papel. Lo que la ficha no trae se llama igual en los dos (decisión 113); lo demás, con las palabras de la pantalla. */
  const allocationRows = useMemo(
    () => assets ? comparisonAllocations(a.positions, b.positions, assets, allocation, clasificacionQueFalta).map((row) => ({ ...row, label: categoriaLegible(row.label) ?? row.label })) : [],
    [assets, a.positions, b.positions, allocation]
  );
  const regionRows = useMemo(
    () => assets ? comparisonAllocations(a.positions, b.positions, assets, "region", clasificacionQueFalta).map((row) => ({ ...row, label: regionLegible(row.label) })) : [],
    [assets, a.positions, b.positions]
  );
  /* Una cartera que mide una sola acción tiene el Sharpe de esa acción, y eso no se enseña. */
  const sharpeNoAplicaA = assets ? sharpeDeUnaSolaAccion(current?.a, a.positions, assets) : false;
  const sharpeNoAplicaB = assets ? sharpeDeUnaSolaAccion(current?.b, b.positions, assets) : false;
  const periodLabel = result?.periodLabel ?? `${Number.parseInt(period, 10)} años`;
  /* Qué es cada cifra decide cómo se escribe (apartado 6): la rentabilidad con signo y color; la volatilidad y la caída,
     porcentajes sin color; el Sharpe, un ratio. La diferencia de dos porcentajes va en puntos.
     Desde el 14-11-2026 (Óscar: recuperar el color de antes del rediseño) la diferencia B − A vuelve a ir en verde si B mejora y en
     rojo si empeora, según el sentido de cada cifra: más rentabilidad y más Sharpe, mejor; menos volatilidad y una caída más cerca de
     cero, mejor. El signo escrito no cambia. */
  /* Con menos de un año común no se anualiza (15-11-2026): la rentabilidad que se da es la del periodo, con sus fechas, y la
     anualizada y el Sharpe no aplican. Lo que no aplica no entra en ninguna diferencia. */
  const sinAnualizar = result !== null && result !== undefined && !result.annualized;
  const motivoSinAnualizar = "Menos de un año de fechas comunes: un periodo tan corto no se anualiza.";
  const metricRows: { label: string; a: number | null | undefined; b: number | null | undefined; tipo: TipoDeCifra; sentido: SentidoDeLaCifra; noAplicaA?: boolean; noAplicaB?: boolean; motivoNoAplica?: string }[] = [
    { label: sinAnualizar ? `Rentabilidad del periodo, ${result.rangeLabel}` : "Rentabilidad acumulada", a: result?.metricsA.cumulative, b: result?.metricsB.cumulative, tipo: "rentabilidad", sentido: "mas" },
    { label: "Rentabilidad anualizada", a: result?.metricsA.cagr, b: result?.metricsB.cagr, tipo: "rentabilidad", sentido: "mas", noAplicaA: sinAnualizar, noAplicaB: sinAnualizar, motivoNoAplica: motivoSinAnualizar },
    { label: "Volatilidad anual", a: result?.metricsA.volatility, b: result?.metricsB.volatility, tipo: "porcentaje", sentido: "menos" },
    { label: "Sharpe", a: result?.metricsA.sharpe, b: result?.metricsB.sharpe, tipo: "ratio", sentido: "mas", noAplicaA: sharpeNoAplicaA || sinAnualizar, noAplicaB: sharpeNoAplicaB || sinAnualizar, motivoNoAplica: sinAnualizar ? motivoSinAnualizar : undefined },
    { label: "Caída máxima", a: result?.metricsA.maxDrawdown, b: result?.metricsB.maxDrawdown, tipo: "porcentaje", sentido: "menosProfunda" }
  ];
  /* La respuesta: la rentabilidad anualizada de cada una y su diferencia, con la volatilidad de apunte. Sin un año común, la del periodo. */
  const rentabilidadDeLaRespuesta = sinAnualizar ? "Rentabilidad del periodo" : "Rentabilidad anualizada";
  const cuandoDeLaRespuesta = sinAnualizar ? result.rangeLabel : periodLabel;
  const cagrA = faltaA ? null : sinAnualizar ? result.metricsA.cumulative : result?.metricsA.cagr;
  const cagrB = faltaB ? null : sinAnualizar ? result.metricsB.cumulative : result?.metricsB.cagr;
  const volatilidadDe = (falta: boolean, valor: number | null | undefined) => falta ? null : porcentaje(valor);
  const volatilidadA = volatilidadDe(faltaA, result?.metricsA.volatility);
  const volatilidadB = volatilidadDe(faltaB, result?.metricsB.volatility);
  const loading = live && !current && !historyError;
  /* Las notas y el papel son de dos carteras con su simulación: con un 0 % no hay de dónde sacarlos. */
  const cargada: ComparativaCargada | null = current?.a && current.b && current.result ? { period: current.period, a: current.a, b: current.b, result: current.result } : null;
  const details = cargada ? notasDeLaComparativa(a, b, cargada, assets ?? []) : [];

  /* Auditoría 16-10: la descarga es una función con nombre para que el banner de
     error pueda reintentarla (antes el error del PDF no ofrecía «Reintentar»). */
  async function exportPdf() {
    if (!cargada || !assets) return;
    setExporting(true); setExportError(null);
    try {
      const paradas = await seriesParadas([...a.positions, ...b.positions].map((p) => p.asset_id), new Date().toISOString());
      const { downloadComparisonPdf } = await import("../reports/comparePdf");
      await downloadComparisonPdf(entradaDeLaComparativa({ a, b, cargada, assets, seriesParadas: paradas }));
    } catch (error) { setExportError(error); }
    finally { setExporting(false); }
  }

  /* La diferencia B − A de una fila: en puntos si son porcentajes, con signo si es un ratio. */
  const diferenciaDe = (row: (typeof metricRows)[number]) => {
    const delta = typeof row.a === "number" && typeof row.b === "number" ? row.b - row.a : null;
    const clase = claseDeLaDiferencia(row.a, row.b, row.sentido, row.tipo === "ratio" ? 2 : 4);
    return row.tipo === "ratio"
      ? <Cifra className={clase} tipo="ratio" valor={delta} conSigno estrecha />
      : <Cifra className={clase} colorDeSigno={false} tipo="puntos" valor={delta} estrecha />;
  };
  const cuantosDe = (incluidos: number, total: number) => `${oFalta(numero(incluidos))} / ${oFalta(numero(total))}`;

  return <>
    <Panel
      acciones={<>
        <SegmentedControl label="Periodo de la comparación" value={period} options={PERIODS} onChange={setPeriod} />
        <Button size="sm" variant="secondary" busy={exporting} textoAlTrabajar="Descargando el informe…" disabled={!cargada || !assets || conLaActiva} onClick={() => void exportPdf()}>{exporting ? "Descargando el informe…" : "Descargar el informe"}</Button>
      </>}
      claseDelCuerpo="stack stack--tight"
      subtitulo={falta.soloComposicion ? "Sin cifras de ninguna de las dos: se compara su composición." : "Mismo periodo, misma base 100 y valores en euros."}
      titulo="Comparativa de propuestas"
    >
      {/* El informe dice «composiciones guardadas» en cuatro sitios y se entrega al cliente: de una que no lo está, sería falso. */}
      {conLaActiva ? <Aviso tono="nota">Para descargar el informe, guarda antes la propuesta en curso: el documento habla de composiciones guardadas.</Aviso> : null}
      {sinSerieA || sinSerieB ? <Aviso tono="nota">Este informe no se genera mientras la simulación no mida ninguna posición de una de las dos.</Aviso> : null}
      {exportError ? <AsyncErrorBanner error={exportError} onRetry={() => void exportPdf()} /> : null}
      {!live ? <Aviso tono="nota">Con los datos de muestra no hay histórico que comparar: solo se puede comparar la distribución.</Aviso> : null}
      {historyError ? <AsyncErrorBanner error={historyError} onRetry={() => setHistoryReload((value) => value + 1)} /> : null}
      {loading ? <LoadingState>{`Calculando las dos propuestas a ${Number.parseInt(period, 10)} años…`}</LoadingState> : null}
      {falta.aviso || (result && (!result.coversPeriod || coberturasDibujadas)) ? <Aviso>
        {falta.aviso ? <p>{falta.aviso}</p> : null}
        {falta.soloComposicion || !result ? null : !result.coversPeriod ? <p>{textoEnPantalla(result.notes[0])}</p> : coberturasDibujadas ? <p>La comparación representa solo los activos con histórico utilizable.</p> : null}
        {coberturasDibujadas ? <p>{coberturasDibujadas}</p> : null}
      </Aviso> : null}
      {/* Primero la respuesta: cuánto rinde cada una al año y cuánto se separan. El detalle, en los bloques de abajo. */}
      {result && !falta.soloComposicion ? <Respuesta
        datos={[
          { rotulo: `${rentabilidadDeLaRespuesta} · ${a.name}`, cifra: <Cifra tipo="rentabilidad" valor={cagrA} />, apunte: volatilidadA ? `Volatilidad ${volatilidadA}` : undefined },
          { rotulo: `${rentabilidadDeLaRespuesta} · ${b.name}`, cifra: <Cifra tipo="rentabilidad" valor={cagrB} />, apunte: volatilidadB ? `Volatilidad ${volatilidadB}` : undefined },
          {
            rotulo: "Diferencia B − A",
            cifra: <Cifra tipo="puntos" valor={typeof cagrA === "number" && typeof cagrB === "number" ? cagrB - cagrA : null} />,
            apunte: `En ${rentabilidadDeLaRespuesta.toLocaleLowerCase("es-ES")} · ${cuandoDeLaRespuesta}`
          }
        ]}
        etiqueta={`${rentabilidadDeLaRespuesta} de las dos propuestas · ${cuandoDeLaRespuesta}`}
      /> : null}
    </Panel>

    <div className="pcmp-dashboard">
      {falta.soloComposicion ? null : <>
        <Panel className="pcmp-panel" claseDelCuerpo="stack stack--tight" subtitulo={`Simulación con los pesos de hoy · ${periodLabel}`} titulo="Evolución histórica (base 100)">
          <OaaLineChart series={result ? [
            /* Al final de cada línea, «A» y «B», como las llaman los dos selectores: el nombre de una propuesta suele ser
               largo y se cortaba («Familia García… 140,3»). El nombre entero va en la leyenda. */
            { id: "A", label: a.name, ...PAPEL_A, etiquetaFinal: "A", values: result.seriesA },
            { id: "B", label: b.name, ...PAPEL_B, etiquetaFinal: "B", values: result.seriesB }
          ].filter(dibuja) : []} height={310} referenceValue={100} ariaLabel={`Evolución de ${legendaDeLaSerie.map((item) => item.label).join(" y ")} · ${periodLabel}`}
            dataQuality={extendedDibujado ? "mixed" : undefined} dataQualityLabel={extendedDibujado ? "Histórico ampliado" : undefined} />
          {/* Con dos líneas, la leyenda la pone la gráfica; con una, hay que decir de quién es. */}
          {result && legendaDeLaSerie.length === 1 ? <OaaLegend items={legendaDeLaSerie.map((item) => ({ ...item, hollow: extendedDibujado }))} /> : null}
          {falta.notaDeLaCurva ? <p className="cmp-note">{falta.notaDeLaCurva}</p> : null}
          <p className="cmp-note">{result ? `${oFalta(periodo(result.firstDate, result.lastDate))} · ${oFalta(numero(result.seriesA.length))} observaciones comunes.` : "Histórico pendiente de cálculo."}</p>
        </Panel>
        <Panel className="pcmp-panel" claseDelCuerpo="stack stack--tight" subtitulo="Eje horizontal: volatilidad anual. Eje vertical: rentabilidad anualizada." titulo={`Mapa de riesgo y rentabilidad · ${periodLabel}`}>
          <OaaRiskReturnChart marks={marks} height={310} showLegend={false} ariaLabel={`Mapa de riesgo y rentabilidad de las propuestas · ${periodLabel}`}
            xDomain={[0, Math.max(.02, Math.ceil(Math.max(0, ...marks.map((p) => p.vol)) * 1.35 / .02) * .02)]}
            yDomain={[Math.floor(Math.min(0, ...marks.map((p) => p.ret)) * 1.2 / .02) * .02, Math.max(.02, Math.ceil(Math.max(0, ...marks.map((p) => p.ret)) * 1.2 / .02) * .02)]} />
          {result ? <OaaLegend items={legendaDeLaSerie} /> : null}
          {falta.notaDelMapa ? <p className="cmp-note">{falta.notaDelMapa}</p> : null}
        </Panel>
      </>}
      <Panel className="pcmp-panel" claseDelCuerpo="stack stack--tight" subtitulo="Simulación con los pesos de hoy" titulo={`${falta.soloComposicion ? "Peso medido" : "Rentabilidad y riesgo"} · ${periodLabel}`}>
        {/* ANA-29: el orden de la tabla común (MetricasComparativas): A · B · Diferencia. */}
        <div className="cmp-table-wrap"><table className="cmp-table pcmp-metrics-table" aria-label={falta.soloComposicion ? "Peso medido" : "Métricas comparadas"}>
          <thead><tr><th scope="col" className="cmp-th-left">Métrica</th><th scope="col" className="cmp-num pcmp-name--a">{a.name}</th><th scope="col" className="cmp-num pcmp-name--b">{b.name}</th>{falta.soloComposicion ? null : <th scope="col" className="cmp-num">Diferencia B − A</th>}</tr></thead>
          <tbody>{falta.soloComposicion ? null : metricRows.map((row) => {
            const noAplica = <span title={row.motivoNoAplica ?? motivoDeQueNoAplique("sharpe", "STOCK")}><Ausencia clase="no-aplica" /></span>;
            const falta = <Ausencia clase="falta" estrecha />;
            return <tr key={row.label}><td>{row.label}</td><td className="cmp-num">{faltaA ? falta : row.noAplicaA ? noAplica : <Cifra tipo={row.tipo} valor={row.a} estrecha />}</td>
              <td className="cmp-num">{faltaB ? falta : row.noAplicaB ? noAplica : <Cifra tipo={row.tipo} valor={row.b} estrecha />}</td>
              <td className="cmp-num">{faltaA || faltaB ? falta : row.noAplicaA || row.noAplicaB ? noAplica : diferenciaDe(row)}</td></tr>;
          })}
          <tr><td>Peso medido</td><td className="cmp-num"><Cifra tipo="peso" valor={sinSerieA ? 0 : coverageA ? coverageA.weight / 100 : null} estrecha /></td><td className="cmp-num"><Cifra tipo="peso" valor={sinSerieB ? 0 : coverageB ? coverageB.weight / 100 : null} estrecha /></td>{falta.soloComposicion ? null : <td />}</tr>
          <tr><td>Activos incluidos / total</td><td className="cmp-num">{sinSerieA ? cuantosDe(0, comparisonPositions(a.positions).length) : coverageA ? cuantosDe(coverageA.included, coverageA.total) : <Ausencia clase="falta" estrecha />}</td><td className="cmp-num">{sinSerieB ? cuantosDe(0, comparisonPositions(b.positions).length) : coverageB ? cuantosDe(coverageB.included, coverageB.total) : <Ausencia clase="falta" estrecha />}</td>{falta.soloComposicion ? null : <td />}</tr>
          </tbody></table></div>
        {falta.soloComposicion ? null : <>
          {faltaA ? <p className="cmp-note">{a.name}: {coverageA ? motivoPorPocoPeso(coverageA.weight) : MOTIVO_SIN_SERIE}</p> : null}
          {faltaB ? <p className="cmp-note">{b.name}: {coverageB ? motivoPorPocoPeso(coverageB.weight) : MOTIVO_SIN_SERIE}</p> : null}
          <p className="cmp-note">Rentabilidad anualizada por calendario; volatilidad y Sharpe con variaciones semanales; caída máxima en diario. Diferencia B − A, en puntos porcentuales (pp) salvo Sharpe. En volatilidad, menor es mejor; en caída, más cerca de cero es mejor. {NOTA_DEL_COLOR_DE_LA_DIFERENCIA}</p>
          {result?.riskFree !== null && result?.riskFree !== undefined ? <p className="cmp-note">Tipo sin riesgo común: {oFalta(porcentaje(result.riskFree))}. {extendedDibujado ? "Incluye tramos estimados mediante referencias históricas." : ""}</p> : null}
        </>}
      </Panel>
      <Panel
        acciones={<SegmentedControl label="Agrupar la composición" value={allocation} onChange={setAllocation} options={[{ id: "category", label: "Categoría" }, { id: "economic_asset_class", label: "Clase" }]} />}
        className="pcmp-panel"
        claseDelCuerpo="stack stack--tight"
        subtitulo="Composición actual completa, con pesos normalizados"
        titulo="Composición"
      >
        {assetsError ? <AsyncErrorBanner error={assetsError} onRetry={() => setAssetsReload((value) => value + 1)} /> : !assets ? <LoadingState>Cargando la distribución…</LoadingState> : <>
          <OaaLegend items={legend} />
          <div className="pcmp-allocations"><div><h3>{allocation === "category" ? "Por categoría" : "Por clase de activo"}</h3><AllocationBars porClase={allocation === "economic_asset_class"} rows={allocationRows} nameA={a.name} nameB={b.name} /></div>
            <div><h3>Por región</h3><AllocationBars rows={regionRows} nameA={a.name} nameB={b.name} /></div></div>
          <p className="cmp-note">Clasificación de la ficha del activo; lo que la ficha de un fondo no trae figura como «No declarado».</p>
        </>}
      </Panel>
    </div>
    {current ? <Panel claseDelCuerpo="stack stack--tight pcmp-methodology" plegable titulo={`Peso medido y método de la comparación${extended ? " · incluye histórico ampliado" : ""}`}>
      <p>{falta.aviso
        ? `Simulación con los pesos de hoy de cada cartera, sin aportaciones ni retiradas. Por debajo del ${oFalta(porcentaje(PESO_MINIMO_MEDIDO_PCT / 100, { decimales: 0 }))} del peso medido no se da ninguna cifra de la cartera, y una diferencia con ella tampoco.`
        : "Simulación con los pesos de hoy de cada cartera, sin aportaciones ni retiradas. Las dos propuestas parten de 100 en la primera fecha común; las cifras describen exclusivamente el periodo dibujado."}</p>
      {period === "10Y" ? <p>A 10 años solo se incluyen activos con histórico suficiente; no se extrapolan los activos más recientes.</p> : null}
      {details.length > 0 ? <ul>{details.map((note, index) => <li key={index}>{textoEnPantalla(note)}</li>)}</ul> : null}
    </Panel> : null}
  </>;
}

/** La cartera que hay en Diseño, para compararla sin tener que guardarla antes (hallazgo 121). */
export interface CarteraActivaParaComparar {
  positions: BdbManualPortfolioPosition[];
  nombre: string;
  capital: number | undefined;
  sinGuardar: boolean;
}

const ID_DE_LA_ACTIVA = "cartera-activa";

const cuantasPosiciones = (cartera: BdbSavedLocalPortfolio) =>
  `${cartera.positions.length} ${cartera.positions.length === 1 ? "posición" : "posiciones"}`;

export function PortfolioComparator({ sourceKind, carteraActiva, onIrACarterasGuardadas }: {
  sourceKind: AssetDataSourceKind;
  carteraActiva?: CarteraActivaParaComparar;
  onIrACarterasGuardadas?: () => void;
}) {
  const dataSource = useMemo(() => getAssetDataSource(sourceKind), [sourceKind]);
  const backend = usesBackendPersistence(sourceKind);
  const localPortfolios = useMemo(() => readLocalPortfoliosFromStorage(getStorage()).filter((p) => p.sourceKind === sourceKind), [sourceKind]);
  const [remote, setRemote] = useState<BdbSavedLocalPortfolio[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [reload, setReload] = useState(0);
  const { seEnsena } = useModoCliente();
  const seVenLasDemas = seEnsena("otrasCarteras");
  const [eleccion, setEleccion] = useState<EleccionDeCarteras>(() => eleccionDeCarteras.read());
  const { a: idA, b: idB } = eleccion;
  const elegir = (cambio: Partial<EleccionDeCarteras>) => {
    const siguiente = { ...eleccion, ...cambio };
    eleccionDeCarteras.write(siguiente);
    setEleccion(siguiente);
  };
  useEffect(() => {
    if (!backend) return;
    let active = true;
    setRemote(null); setError(null);
    backendListPortfolios().then((list) => { if (active) setRemote(list); }).catch((cause: unknown) => { if (active) setError(cause); });
    return () => { active = false; };
  }, [backend, reload]);
  /* Solo si tiene algo que no está guardado: si no, ya está en la lista con su nombre. */
  const activa = useMemo<BdbSavedLocalPortfolio | null>(() => {
    if (!carteraActiva?.sinGuardar || carteraActiva.positions.length === 0) return null;
    return {
      portfolio_id: ID_DE_LA_ACTIVA,
      name: carteraActiva.nombre.trim() || "Propuesta en curso",
      positions: carteraActiva.positions,
      created_at: "",
      updated_at: "",
      sourceKind,
      total_capital: carteraActiva.capital
    };
  }, [carteraActiva, sourceKind]);
  const guardadas = backend ? remote ?? [] : localPortfolios;
  const portfolios = activa ? [activa, ...guardadas] : guardadas;
  const rotuloDe = (p: BdbSavedLocalPortfolio) => (p.portfolio_id === ID_DE_LA_ACTIVA ? "Propuesta en curso (sin guardar)" : p.name);
  const a = portfolios.find((p) => p.portfolio_id === idA);
  const b = portfolios.find((p) => p.portfolio_id === idB);
  const ofrecidas = carterasQueSeOfrecen(portfolios, eleccion, seVenLasDemas);
  let selectionError: unknown = null;
  try { if (a && b) { comparisonPositions(a.positions); comparisonPositions(b.positions); } }
  catch (cause) { selectionError = cause; }
  /* Un selector por propuesta, con su rótulo enlazado y, de pista, cuántas posiciones tiene la elegida. */
  const selector = (lado: "a" | "b") => {
    const elegida = lado === "a" ? a : b;
    const id = lado === "a" ? idA : idB;
    const otra = lado === "a" ? idB : idA;
    return <Campo pista={elegida ? cuantasPosiciones(elegida) : undefined} rotulo={<span className={lado === "a" ? "pcmp-name--a" : "pcmp-name--b"}>{lado === "a" ? "Propuesta A" : "Propuesta B"}</span>}>
      <select value={elegida ? id : ""} onChange={(event) => elegir(lado === "a" ? { a: event.target.value } : { b: event.target.value })}>
        <option disabled={!seVenLasDemas && Boolean(elegida)} value="">Elige una propuesta…</option>{ofrecidas.map((p) => <option disabled={p.portfolio_id === otra} key={p.portfolio_id} value={p.portfolio_id}>{rotuloDe(p)}</option>)}
      </select>
    </Campo>;
  };
  return <div className="pcmp">
    <div className="pcmp-pick">
      {selector("a")}
      <span className="pcmp-vs">frente a</span>
      {selector("b")}
    </div>
    {!seVenLasDemas ? <p className="cmp-note">Sal de Modo cliente para ver otras propuestas.</p> : null}
    {error ? <AsyncErrorBanner error={error} onRetry={() => setReload((value) => value + 1)} /> : backend && !remote ? <LoadingState>Cargando las propuestas guardadas…</LoadingState>
      : portfolios.length < 2 ? <EmptyState title="Se necesitan dos propuestas" description="Guarda al menos dos propuestas en Diseño para compararlas aquí." action={onIrACarterasGuardadas && seVenLasDemas ? <Button onClick={onIrACarterasGuardadas} variant="secondary">Ir a Guardadas</Button> : undefined} />
      : !a || !b || a.portfolio_id === b.portfolio_id ? (seVenLasDemas
        ? <EmptyState title="Elige dos propuestas" description="Elige una propuesta distinta en cada selector." />
        : <EmptyState title="Las dos propuestas se eligen antes de entrar" description="Con Modo cliente, los selectores solo enseñan las propuestas ya elegidas." />)
      : selectionError ? <AsyncErrorBanner error={selectionError} />
      : <ComparisonDashboard conLaActiva={a.portfolio_id === ID_DE_LA_ACTIVA || b.portfolio_id === ID_DE_LA_ACTIVA} key={JSON.stringify([sourceKind, a.portfolio_id, a.positions, b.portfolio_id, b.positions])} a={a} b={b} dataSource={dataSource} sourceKind={sourceKind} />}
  </div>;
}
