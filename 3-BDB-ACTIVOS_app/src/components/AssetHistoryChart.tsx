/**
 * PAR-D: evolución histórica del activo en su ficha (paridad con el
 * HistoricalChart del legacy). Reusa la callable get_price_series
 * (price-series.v1) ya validada, rebasada a 100.
 */
import { useEffect, useState } from "react";
import { fetchRebasedSeries, type RebaseWindow } from "../adapters/priceSeriesBackend";
import { useModoCliente } from "../app/ClientModeContext";
import { serieNoDisponible } from "../core/backtestCoverage";
import { avisoDeVentana } from "../core/coberturaDeLaSerie";
import { useAsyncData } from "../core/useAsyncData";
import { AsyncErrorBanner } from "./AsyncErrorBanner";
import { numero, oFalta, periodo, rentabilidad } from "../core/formato";
import { textoDeAusencia } from "../core/textoDeAusencia";
import type { BdbAssetDetail } from "../types/bdbAssets";
import type { EvolucionDeLaFicha } from "../types/fichaInstrumento";
import { OaaLineChart } from "../charts/oaa";
import { CabeceraDeSeccion } from "./ficha/CabeceraDeSeccion";
import { Cifra } from "./ui/Cifra";
import { Esqueleto } from "./ui/Esqueleto";
import { SegmentedControl } from "./ui/SegmentedControl";
/* La pieza trae su hoja: si la pidiera cada pantalla, una que la olvide la pinta sin estilo. */
import "../styles/ficha.css";

const WINDOWS: { id: RebaseWindow; label: string }[] = [
  { id: "1Y", label: "1 año" },
  { id: "3Y", label: "3 años" },
  { id: "5Y", label: "5 años" },
  { id: "10Y", label: "10 años" }
];

/** La variación del periodo, como la escribe la fila: es una rentabilidad, «+57,90 %». */
const escribirVariacion = (cifra: number) => oFalta(rentabilidad(cifra));

export function AssetHistoryChart({
  asset,
  alCargar
}: {
  asset: Pick<BdbAssetDetail, "asset_id" | "display_name" | "quality_flags">;
  /** Recibe lo que se está dibujando, o `null` si no hay serie dibujada: lo lee la ficha para imprimirlo (decisión A-124). */
  alCargar?: (evolucion: EvolucionDeLaFicha | null) => void;
}) {
  const [ventana, setVentana] = useState<RebaseWindow>("3Y");
  const { activo: modoCliente } = useModoCliente();
  const hasHistory = !asset.quality_flags.includes("MISSING_HISTORY");

  const load = useAsyncData(
    // Diario: es un grafico, no una medida. Sin politica de historico minimo:
    // la ficha de un fondo joven tiene que pintar lo que haya.
    () => fetchRebasedSeries([asset.asset_id], ventana, "DAILY"),
    [asset.asset_id, ventana],
    { enabled: hasHistory }
  );

  const response = load.data ?? null;
  const serie = response?.series.find((s) => s.asset_id === asset.asset_id) ?? response?.series[0] ?? null;
  const excludedReason = response?.excluded_assets.find((e) => e.asset_id === asset.asset_id)?.reason ?? null;
  const finalValue = serie && serie.values.length > 0 ? serie.values[serie.values.length - 1] : null;
  const variation = finalValue !== null ? finalValue / 100 - 1 : null;
  const hayCifras = Boolean(serie && serie.values.length > 1 && response);
  /* De qué a qué va la serie: «del 14/11/2023 al 13/11/2026». */
  const delPeriodo = periodo(response?.dates[0], response?.dates[response.dates.length - 1]);
  /* Decisión 8: la serie de una clase que reparte baja cada vez que paga. Se dibuja, se dice qué es y no se le saca una variación. */
  const sinDividendos = serie?.sin_dividendos === true;
  const aviso = response ? avisoDeVentana(response.dates, ventana) : null;
  const procedencia =
    hayCifras && response
      ? [
          sinDividendos ? "Valor liquidativo, sin dividendos" : null,
          "Base 100",
          response.frequency === "WEEKLY" ? "semanal" : "diaria",
          response.base_currency,
          `${numero(response.dates.length)} observaciones`,
          aviso ?? delPeriodo
        ].filter(Boolean).join(" · ")
      : "Base 100 al inicio del periodo";

  /* Lo que se está viendo, para el papel (decisión A-124): la misma serie, la misma procedencia y la misma variación. Sin serie
     dibujada, nada: el papel no inventa una evolución que la pantalla no enseña. */
  const dibujada = hasHistory && !load.error && !load.loading && hayCifras && serie && response ? serie : null;
  useEffect(() => {
    if (!alCargar) return;
    if (!dibujada || !response) {
      alCargar(null);
      return;
    }
    alCargar({
      procedencia,
      fechas: response.dates,
      valores: response.dates.map((_fecha, indice) => dibujada.values[indice] ?? null),
      variacion: sinDividendos ? undefined : variation === null ? textoDeAusencia("falta") : escribirVariacion(variation)
    });
  }, [alCargar, dibujada, response, procedencia, sinDividendos, variation]);

  return (
    <section aria-labelledby="asset-detail-history-title">
      <CabeceraDeSeccion
        acciones={
          /* Auditoría 14-10 (MEDIA-21): mismo SegmentedControl que el periodo
             del comparador, en vez de botones con aria-pressed a mano. */
          <SegmentedControl
            buttonClassName="cmp-period"
            className="cmp-periods"
            label="Periodo del histórico"
            onChange={setVentana}
            options={WINDOWS.map((w) => ({ ...w, disabled: !hasHistory }))}
            value={ventana}
          />
        }
        procedencia={procedencia}
        titulo="Evolución histórica"
        tituloId="asset-detail-history-title"
      />

      {!hasHistory ? (
        <p className="asset-detail-muted">Este activo no tiene serie de precios para dibujar su evolución.</p>
      ) : load.error ? (
        <AsyncErrorBanner error={load.error} onRetry={load.retry} />
      ) : load.loading ? (
        <div role="status">
          <span className="sr-only">Cargando la serie…</span>
          <Esqueleto alto={280} />
        </div>
      ) : serie && serie.values.length > 1 && response ? (
        <>
          <OaaLineChart
            series={[
              {
                id: asset.asset_id,
                label: asset.display_name,
                /* El activo de la ficha es la serie principal: marino, siempre (apartado 7 de SISTEMA_DISENO.md). */
                papel: "cartera",
                values: response.dates.map((date, index) => ({ date, value: serie.values[index] ?? null }))
              }
            ]}
            referenceValue={100}
            ariaLabel={`Evolución histórica de ${asset.display_name}, rebasada a 100`}
          />
          {sinDividendos ? null : (
            <div className="ficha__fila">
              <span className="ficha__rotulo">Variación del periodo</span>
              <span className="ficha__valor">
                {/* Una rentabilidad: dos decimales, con signo y su color (formato común). */}
                <Cifra tipo="rentabilidad" valor={variation} />
              </span>
            </div>
          )}
        </>
      ) : (
        <p className="asset-detail-muted">
          {serieNoDisponible(excludedReason, { modoCliente })}
        </p>
      )}
    </section>
  );
}
