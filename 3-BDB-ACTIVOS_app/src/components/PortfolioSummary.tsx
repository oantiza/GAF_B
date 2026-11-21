import type { BdbManualPortfolioSummary } from "../types/bdbAssets";
import { importeTitular, oFalta, peso } from "../core/formato";
import { CLASS_LABELS, TYPE_LABELS, readableBackendLabel } from "../core/labels";
import type { ParteFueraDelReparto } from "../core/radiografiaDeLaCartera";
import { colorDeLaClase } from "../core/coloresDeClase";
import { UNCLASSIFIED_COLOR } from "../core/theme";
import { OaaDonutChart, type OaaDonutSlice } from "../charts/oaa";
import { Ausencia } from "./ui/Ausencia";
import { Panel } from "./ui/Panel";

interface PortfolioSummaryProps {
  summary: BdbManualPortfolioSummary | null;
  /**
   * `side` (B″): bloque de la columna lateral del Constructor — aro de 230 px
   * con el capital en el hueco y la leyenda por clase debajo; el reparto por
   * vehículo queda como una línea.
   */
  variant?: "default" | "side";
  totalCapital?: number;
  /** El capital es de ejemplo: el centro del aro no lo da por bueno. */
  capitalSinFijar?: boolean;
  /** Lo que no entra en este reparto, que solo suma lo invertible: sin decirlo, el reparto se repartía el todo entre lo demás. */
  fueraDelReparto?: readonly ParteFueraDelReparto[];
}

/**
 * Reparto de la cartera por clase económica (aro, protagonista del bloque)
 * y por vehículo. Ola 1 (E3): las cifras viven en «Métricas clave».
 */
export function PortfolioSummary({ summary, variant = "default", totalCapital, capitalSinFijar = false, fueraDelReparto = [] }: PortfolioSummaryProps) {
  if (!summary) {
    return null;
  }
  const classRows = summary.by_economic_asset_class.map((bucket) => ({
    key: bucket.key,
    label: CLASS_LABELS[bucket.key] ?? readableBackendLabel(bucket.key),
    value: bucket.weight_percent
  }));
  const classCount = classRows.filter((row) => row.value > 0).length;
  /* Cada clase, en su color fijo (14-11-2026): la renta variable es azul aunque sea la tercera por peso. Lo que no entra
     en ellas va en el gris del resto (`UNCLASSIFIED_COLOR`), como «No declarado» en el aro de sectores: no es una clase. */
  const porcionesDelAro: OaaDonutSlice[] = [
    ...classRows.map((row) => ({ ...row, colorDeCategoria: colorDeLaClase(row.key) })),
    ...fueraDelReparto.map((parte) => ({ key: parte.clave, label: parte.rotulo, value: parte.peso, color: UNCLASSIFIED_COLOR }))
  ];
  const conPeso = porcionesDelAro.filter((porcion) => Number.isFinite(porcion.value) && porcion.value > 0).length;
  const vehicleLine = [
    ...summary.by_instrument_type.map((bucket) => `${TYPE_LABELS[bucket.key] ?? readableBackendLabel(bucket.key)} ${oFalta(peso(bucket.weight_percent / 100))}`),
    ...fueraDelReparto.map((parte) => `${parte.rotulo} ${oFalta(peso(parte.peso / 100))}`)
  ].join(" · ");

  if (variant === "side") {
    /* Desde el 14-11-2026 (Óscar: «le faltan colores en general»), el reparto por clase vuelve a ser un aro, como antes del
       rediseño: cada clase en su color fijo (`colorDeLaClase`, el mismo en toda la aplicación) y lo que no entra en el
       reparto, en gris, como «Otros». En el hueco, el capital y las posiciones; con una sola clase el aro se vuelve cifra. */
    const capital = typeof totalCapital === "number" && Number.isFinite(totalCapital) ? totalCapital : null;
    const posicionesYClases = `${summary.position_count} ${summary.position_count === 1 ? "posición" : "posiciones"} · ${classCount} ${classCount === 1 ? "clase" : "clases"}`;
    return (
      <Panel
        claseDelCuerpo="stack stack--tight"
        className="portfolio-allocation portfolio-allocation--side"
        /* Con una sola parte el aro es una cifra y no tiene hueco: el capital y las posiciones van bajo el título. */
        subtitulo={conPeso <= 1 ? [capital === null ? null : capitalSinFijar ? "Capital sin fijar" : importeTitular(capital), posicionesYClases].filter(Boolean).join(" · ") : undefined}
        titulo="Reparto por clase"
        tituloId="portfolio-summary-title"
      >
        {porcionesDelAro.length > 0 ? (
          <OaaDonutChart
            center={capital === null ? undefined : { value: capitalSinFijar ? "Capital sin fijar" : oFalta(importeTitular(capital)), enPalabras: capitalSinFijar, note: posicionesYClases }}
            data={porcionesDelAro}
            height={230}
            innerRadius={82}
            layout="stack"
            outerRadius={104}
          />
        ) : (
          <Ausencia clase="falta" />
        )}
        {vehicleLine ? <p className="portfolio-allocation__vehicles">Por producto · {vehicleLine}</p> : null}
      </Panel>
    );
  }

  return (
    <Panel
      claseDelCuerpo="portfolio-allocation-grid"
      className="portfolio-allocation"
      subtitulo="Clase de activo (aro) y producto"
      titulo="Reparto por clase"
      tituloId="portfolio-summary-title"
    >
        <div className="portfolio-allocation-chart">
          {porcionesDelAro.length > 0 ? (
            <OaaDonutChart data={porcionesDelAro} height={230} innerRadius={70} outerRadius={104} />
          ) : (
            <Ausencia clase="falta" />
          )}
        </div>
        <div>
          <h3>Por producto</h3>
          {summary.by_instrument_type.length > 0 || fueraDelReparto.length > 0 ? (
            <ul>
              {summary.by_instrument_type.map((bucket) => (
                <li key={bucket.key}>
                  <span>{TYPE_LABELS[bucket.key] ?? readableBackendLabel(bucket.key)}</span>
                  <strong>{oFalta(peso(bucket.weight_percent / 100))}</strong>
                </li>
              ))}
              {fueraDelReparto.map((parte) => (
                <li key={parte.clave}>
                  <span>{parte.rotulo}</span>
                  <strong>{oFalta(peso(parte.peso / 100))}</strong>
                </li>
              ))}
            </ul>
          ) : (
            <Ausencia clase="falta" />
          )}
        </div>
    </Panel>
  );
}
