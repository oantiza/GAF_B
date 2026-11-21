import { memo, type CSSProperties } from "react";
import { Ausencia } from "../../components/ui/Ausencia";
import { textoDeAusencia } from "../../core/textoDeAusencia";
import { chartNumber } from "./chartFormatters";
import { clasesDeLaRampa, CORRELATION_THRESHOLDS, sequentialStep, tintaClaraSobre } from "./chartTheme";
import { OaaEmptyState } from "./OaaEmptyState";
import type { OaaChartQualityProps } from "./OaaChartFrame";
import { LeyendaDeLaRampa } from "./LeyendaDeLaRampa";
import { rotuloDelSello } from "./selloDeCalidad";
import { TablaAlternativa } from "./TablaAlternativa";

export interface OaaCorrelationItem {
  key: string;
  label: string;
  /** EN RETIRADA: la matriz no da color a los activos (la rampa es de la magnitud); se acepta y no se pinta. */
  color?: string;
  /**
   * El número con el que la pantalla llama a este activo en sus otros bloques. Sin él, su puesto en la matriz. Lo da
   * quien deja fuera de la matriz a alguno: los demás no se renumeran (decisión 84).
   */
  numero?: number;
}

/** Las siete clases de la correlación, con sus límites, para la leyenda. */
// eslint-disable-next-line react-refresh/only-export-components -- constante del gráfico, exportada para su prueba
export const CLASES_DE_LA_CORRELACION = clasesDeLaRampa(CORRELATION_THRESHOLDS, (valor) => chartNumber(valor, valor === 0.999 ? 3 : 2));

export interface OaaCorrelationCell {
  rowKey: string;
  columnKey: string;
  rowLabel: string;
  columnLabel: string;
  rowIndex: number;
  columnIndex: number;
  value: number | null;
  /** Lo que dice la casilla cuando no lleva cifra a propósito. Sin esto, una casilla sin cifra dice que falta el dato. */
  rotulo?: string;
}

/** Rampa secuencial (del marfil al marino, `--rampa-*`): claro = correlación baja, oscuro = alta. */
function corrStep(value: number | null): number {
  return sequentialStep(value, CORRELATION_THRESHOLDS);
}

/** Lo que se escribe en una casilla y en la tabla alternativa. */
function textoDeLaCelda(cell: OaaCorrelationCell | undefined, value: number | null, estrecha: boolean): string {
  if (cell?.rotulo) return cell.rotulo;
  return value == null || !Number.isFinite(value) ? textoDeAusencia("falta", { estrecha }) : chartNumber(value, 2);
}

/**
 * Matriz de correlación como rejilla CSS, no Recharts: celdas contiguas con
 * separación de superficie, cifra impresa en cada celda y ejes numerados que
 * remiten al índice de activos. La celda diagonal (siempre 1,00) se atenúa.
 * ANA-18: la rejilla es la imagen; sus cifras, con el nombre de cada activo, van
 * enteras en la tabla alternativa, para el lector de pantalla.
 */
export const OaaCorrelationHeatmap = memo(function OaaCorrelationHeatmap({
  cells,
  items,
  dataQuality,
  dataQualityLabel,
  dataQualityNote
}: {
  cells: OaaCorrelationCell[];
  items: OaaCorrelationItem[];
  /** Aceptado por compatibilidad; la rejilla CSS toma su altura del contenido. */
  height?: number;
} & OaaChartQualityProps) {
  const n = items.length;
  if (n < 2) {
    return <OaaEmptyState>Hacen falta al menos 2 series para la correlación.</OaaEmptyState>;
  }

  const byPosition = new Map<string, OaaCorrelationCell>();
  for (const cell of cells) {
    byPosition.set(`${cell.rowIndex}:${cell.columnIndex}`, cell);
  }
  /* Un −0,001 redondeado imprimía «−0,00»: el cero no lleva signo. */
  const valorDe = (cell: OaaCorrelationCell | undefined) => {
    const raw = cell?.value ?? null;
    return raw != null && Number.isFinite(raw) && Math.abs(raw) < 0.005 ? 0 : raw;
  };
  const nombre = `Matriz de correlación de ${n} activos; claro = correlación baja, oscuro = alta.`;
  const sello = dataQuality ? rotuloDelSello(dataQuality, dataQualityLabel) : dataQualityLabel;

  return (
    <div className="corr-heatmap">
      <TablaAlternativa
        titulo={nombre}
        columnas={["Activo", ...items.map((item) => item.label)]}
        filas={items.map((rowItem, rowIndex) => ({
          clave: rowItem.key,
          rotulo: rowItem.label,
          celdas: items.map((_, columnIndex) => {
            const cell = byPosition.get(`${rowIndex}:${columnIndex}`);
            return textoDeLaCelda(cell, valorDe(cell), false);
          })
        }))}
      />
      {/* El marco se desplaza de lado cuando la matriz no cabe (muchas posiciones, o una ventana estrecha), y sus casillas
          no se enfocan: se enfoca él, con su nombre, como el marco de la pieza de tablas (apartado 14.7 del sistema). */}
      <div aria-label={`Correlación entre ${n} activos (matriz desplazable)`} className="oaa-heatmap-scroll" role="group" tabIndex={0}>
        <div
          className="heatmap corr-heatmap-grid"
          role="img"
          aria-label={nombre}
          /* Número de columnas: valor calculado en tiempo de ejecución. */
          style={{ "--corr-n": n } as CSSProperties}
        >
          <span className="heatmap__axis heatmap__axis--head" aria-hidden="true" />
          {items.map((item, index) => (
            <span key={`c-${item.key}`} className="heatmap__axis heatmap__axis--head" aria-hidden="true">
              {item.numero ?? index + 1}
            </span>
          ))}
          {items.map((rowItem, rowIndex) => [
            <span key={`r-${rowItem.key}`} className="heatmap__axis" aria-hidden="true">
              {rowItem.numero ?? rowIndex + 1}
            </span>,
            ...items.map((columnItem, columnIndex) => {
              const cell = byPosition.get(`${rowIndex}:${columnIndex}`);
              const value = valorDe(cell);
              const step = corrStep(value);
              const diagonal = rowIndex === columnIndex;
              const display = textoDeLaCelda(cell, value, true);
              /* La tinta cambia a papel desde el paso 5 (inkOnSequentialStep): antes lo hacía desde el 6 y la cifra
                 del paso 5 quedaba a 2,32:1. El fondo lo pone la clase `oaa-rampa--N`, que lee `--rampa-N`. */
              const fondo = step >= 0 && !diagonal ? ` oaa-rampa--${step}` : "";
              return (
                <span
                  key={`${rowItem.key}-${columnItem.key}`}
                  className={`heatmap__cell${diagonal ? " is-diagonal" : ""}${fondo}${tintaClaraSobre(step) && !diagonal ? " is-dark" : ""}`}
                  title={diagonal ? undefined : `${rowItem.label} × ${columnItem.label}: ${display}`}
                >
                  {cell?.rotulo ? <Ausencia clase="no-aplica" motivo={cell.rotulo} /> : display}
                </span>
              );
            })
          ])}
        </div>
      </div>
      <div className="corr-heatmap-side">
        {dataQuality ? (
          <span className={`oaa-data-pill ${dataQuality}`}>
            {sello}
            {dataQualityNote ? <span className="sr-only">: {dataQualityNote}</span> : null}
          </span>
        ) : null}
        <LeyendaDeLaRampa titulo="Correlación" clases={CLASES_DE_LA_CORRELACION} />
        {/* Índice sin muestras de color, igual que el del solapamiento (ANA-24):
            aquí el color de celda es la rampa de magnitud, y un punto de color
            por activo sugeriría una identidad cromática que la matriz no usa. */}
        <ol className="oaa-heatmap-index oaa-heatmap-index--plain">
          {items.map((item, index) => (
            <li key={item.key}>
              <strong>{item.numero ?? index + 1}</strong>
              <span title={item.label}>{item.label}</span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
});
