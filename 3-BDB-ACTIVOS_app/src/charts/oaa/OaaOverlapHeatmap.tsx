import { memo, useRef, useState, type CSSProperties, type FocusEvent, type KeyboardEvent, type MouseEvent } from "react";
import { Ausencia } from "../../components/ui/Ausencia";
import { textoDeLaCasilla } from "../../core/overlap";
import { textoDeAusencia } from "../../core/textoDeAusencia";
import { SEQUENTIAL_RAMP } from "../../core/theme";
import { pctPoint, pesoDelGrafico } from "./chartFormatters";
import type { OaaChartQualityProps } from "./OaaChartFrame";
import { OaaEmptyState } from "./OaaEmptyState";
import { OaaTooltip } from "./OaaTooltip";
import { LeyendaDeLaRampa } from "./LeyendaDeLaRampa";
import { clasesDeLaRampa, OVERLAP_THRESHOLDS, sequentialStep, tintaClaraSobre } from "./chartTheme";
import { rotuloDelSello } from "./selloDeCalidad";
import { TablaAlternativa } from "./TablaAlternativa";

/** Las siete clases del solapamiento, con sus límites, para la leyenda (las mismas que la correlación, ANA-24). */
// eslint-disable-next-line react-refresh/only-export-components -- constante del gráfico, exportada para su prueba
export const CLASES_DEL_SOLAPAMIENTO = clasesDeLaRampa(OVERLAP_THRESHOLDS, (valor) => pctPoint(valor, 0), { exclusiveFirst: true });

export interface OaaOverlapItem {
  key: string;
  label: string;
  /** EN RETIRADA: la matriz no da color a los activos (la rampa es de la magnitud); se acepta y no se pinta. */
  color?: string;
  /** Bajo el nombre: cuántas posiciones y qué peso se han mirado de esa cartera. */
  detalle?: string;
}

export interface OaaOverlapCell {
  rowKey: string;
  columnKey: string;
  rowLabel: string;
  columnLabel: string;
  rowIndex: number;
  columnIndex: number;
  /** Lo común visto, en puntos: un mínimo, que con derivados puede pasar de 100. */
  value: number | null;
  commonTop: Array<{ name: string; weight: number }>;
  /** Sin cifra porque no aplica, no porque falte: una acción no tiene subyacentes. */
  noAplica?: boolean;
}

interface CasillaDibujada extends OaaOverlapCell {
  /** El paso de la rampa, o -1 sin cifra. */
  paso: number;
  displayValue: string;
  /** Lo que dice la casilla en dos líneas: «al menos» y su cifra. Null si es una sola, como la diagonal o lo que falta. */
  dosLineas: [string, string] | null;
}

/** Paso de la rampa secuencial (misma que la matriz de correlación): solapamiento como magnitud. */
function overlapStep(value: number | null): number {
  return sequentialStep(value, OVERLAP_THRESHOLDS, { exclusiveFirst: true });
}

/** Las mayores posiciones comunes de una casilla, en una frase, para la tabla alternativa y el nombre de la casilla. */
function comunesEnTexto(cell: OaaOverlapCell): string {
  return cell.commonTop?.length
    ? `; mayores posiciones comunes: ${cell.commonTop.map((asset) => `${asset.name} ${pesoDelGrafico(asset.weight)}`).join(", ")}`
    : "";
}

/** La nota de una casilla: el par, su cifra y las mayores posiciones comunes. */
function NotaDeLaCasilla({ cell }: { cell: CasillaDibujada }) {
  return (
    <OaaTooltip
      active
      titulo="Solapamiento"
      filas={[
        {
          clave: "celda",
          nombre: `${cell.rowLabel} y ${cell.columnLabel}`,
          valor: cell.displayValue,
          color: cell.paso >= 0 ? SEQUENTIAL_RAMP[cell.paso] : undefined
        }
      ]}
      extra={
        cell.commonTop && cell.commonTop.length > 0 ? (
          <div className="oaa-overlap-common">
            <div className="oaa-overlap-common__title">Mayores posiciones comunes:</div>
            <ul>
              {cell.commonTop.map((asset, i) => (
                <li key={i}>
                  <span>{asset.name}</span>
                  <strong>{pesoDelGrafico(asset.weight)}</strong>
                </li>
              ))}
            </ul>
          </div>
        ) : null
      }
    />
  );
}

/** Lo que mide una nota de ancho, como mucho (`.oaa-chart-tooltip`): para no sacarla por la derecha del marco. */
const ANCHO_DE_LA_NOTA = 300;

/**
 * Matriz de solapamiento como rejilla CSS, la misma pieza que la de correlación (14-11-2026: con el diagrama de
 * dispersión de Recharts a todo el ancho, las casillas quedaban sueltas y no se leía como una matriz). Casillas del
 * mismo tamaño, contiguas, alineadas a la izquierda y numeradas por fila y columna, que remiten al índice; si no caben,
 * se desplaza su marco (`oaa-heatmap-scroll`) y nunca la página.
 *
 * La nota con las mayores posiciones comunes sale al pasar el ratón por una casilla y al enfocarla: la rejilla es UNA
 * parada de teclado, y las flechas van de casilla en casilla (Inicio y Fin, al principio y al final de la fila; Escape
 * cierra la nota). Cada casilla lleva su nombre entero, y la tabla alternativa trae todas las cifras (ANA-18).
 */
export const OaaOverlapHeatmap = memo(function OaaOverlapHeatmap({
  cells,
  items,
  dataQuality,
  dataQualityLabel,
  dataQualityNote,
  ariaLabel
}: {
  cells: OaaOverlapCell[];
  items: OaaOverlapItem[];
  /** Aceptado por compatibilidad; la rejilla CSS toma su altura del contenido. */
  height?: number;
  ariaLabel?: string;
} & OaaChartQualityProps) {
  const n = items.length;
  const marco = useRef<HTMLDivElement | null>(null);
  const rejilla = useRef<HTMLDivElement | null>(null);
  /* La casilla que recibe el foco al entrar en la rejilla, y la que enseña su nota (con su sitio en el marco). */
  const [enfocada, setEnfocada] = useState<[number, number]>([0, n > 1 ? 1 : 0]);
  const [nota, setNota] = useState<{ fila: number; columna: number; x: number; y: number } | null>(null);

  if (n < 2) {
    return <OaaEmptyState>Hacen falta al menos 2 series para calcular el solapamiento.</OaaEmptyState>;
  }

  const porPosicion = new Map<string, CasillaDibujada>();
  for (const cell of cells) {
    const diagonal = cell.rowIndex === cell.columnIndex;
    const { texto, dosLineas } = textoDeLaCasilla(cell.value, diagonal);
    porPosicion.set(`${cell.rowIndex}:${cell.columnIndex}`, {
      ...cell,
      paso: overlapStep(cell.value),
      /* Lo que falta ya llega escrito «Falta» del módulo del solapamiento. */
      displayValue: cell.noAplica ? textoDeAusencia("no-aplica") : texto,
      dosLineas: cell.noAplica ? null : dosLineas
    });
  }
  const nombre = ariaLabel ?? `Mapa de solapamiento de ${n} activos; claro = solapamiento bajo, oscuro = alto.`;
  const sello = dataQuality ? rotuloDelSello(dataQuality, dataQualityLabel) : dataQualityLabel;
  const [filaEnfocada, columnaEnfocada] = [Math.min(enfocada[0], n - 1), Math.min(enfocada[1], n - 1)];

  const nombreDeLaCasilla = (fila: number, columna: number): string => {
    const casilla = porPosicion.get(`${fila}:${columna}`);
    if (!casilla) return `${items[fila].label} y ${items[columna].label}: ${textoDeAusencia("falta")}`;
    return `${casilla.rowLabel} y ${casilla.columnLabel}: ${casilla.displayValue}${comunesEnTexto(casilla)}`;
  };

  /* La nota se coloca bajo la casilla, dentro del marco, sin salirse por la derecha. */
  const abrirNota = (fila: number, columna: number, elemento: HTMLElement) => {
    const caja = marco.current?.getBoundingClientRect();
    const celda = elemento.getBoundingClientRect();
    if (!caja) return;
    const x = Math.max(0, Math.min(celda.left - caja.left, caja.width - ANCHO_DE_LA_NOTA));
    setNota({ fila, columna, x, y: celda.bottom - caja.top + 4 });
  };

  const mover = (evento: KeyboardEvent<HTMLElement>, fila: number, columna: number) => {
    const destinos: Record<string, [number, number]> = {
      ArrowRight: [fila, Math.min(n - 1, columna + 1)],
      ArrowLeft: [fila, Math.max(0, columna - 1)],
      ArrowDown: [Math.min(n - 1, fila + 1), columna],
      ArrowUp: [Math.max(0, fila - 1), columna],
      Home: [fila, 0],
      End: [fila, n - 1]
    };
    if (evento.key === "Escape") {
      setNota(null);
      return;
    }
    const destino = destinos[evento.key];
    if (!destino) return;
    evento.preventDefault();
    setEnfocada(destino);
    rejilla.current?.querySelector<HTMLElement>(`[data-casilla="${destino[0]}:${destino[1]}"]`)?.focus();
  };

  const casillaDeLaNota = nota ? porPosicion.get(`${nota.fila}:${nota.columna}`) : undefined;

  return (
    <div className="corr-heatmap">
      <TablaAlternativa
        titulo={nombre}
        columnas={["Activo", ...items.map((item) => item.label)]}
        filas={items.map((rowItem, rowIndex) => ({
          clave: rowItem.key,
          rotulo: rowItem.label,
          celdas: items.map((_, columnIndex) => {
            const point = porPosicion.get(`${rowIndex}:${columnIndex}`);
            return point ? `${point.displayValue}${comunesEnTexto(point)}` : textoDeAusencia("falta");
          })
        }))}
      />
      <div className="overlap-heatmap-marco" ref={marco}>
        <div className="oaa-heatmap-scroll">
          <div
            ref={rejilla}
            className="heatmap corr-heatmap-grid overlap-heatmap-grid"
            role="group"
            aria-label={nombre}
            /* Número de columnas: valor calculado en tiempo de ejecución. */
            style={{ "--corr-n": n } as CSSProperties}
            onMouseLeave={() => setNota(null)}
          >
            <span className="heatmap__axis heatmap__axis--head" aria-hidden="true" />
            {items.map((item, index) => (
              <span key={`c-${item.key}`} className="heatmap__axis heatmap__axis--head" aria-hidden="true">
                {index + 1}
              </span>
            ))}
            {items.map((rowItem, rowIndex) => [
              <span key={`r-${rowItem.key}`} className="heatmap__axis" aria-hidden="true">
                {rowIndex + 1}
              </span>,
              ...items.map((columnItem, columnIndex) => {
                const casilla = porPosicion.get(`${rowIndex}:${columnIndex}`);
                const diagonal = rowIndex === columnIndex;
                const paso = casilla?.paso ?? -1;
                /* El fondo lo pone la clase `oaa-rampa--N`, que lee `--rampa-N`; la tinta cambia a papel desde el paso 5.
                   La diagonal (el fondo consigo mismo, siempre 100 %) va neutra, como en la correlación. */
                const fondo = paso >= 0 && !diagonal ? ` oaa-rampa--${paso}` : "";
                const oscura = tintaClaraSobre(paso) && !diagonal ? " is-dark" : "";
                const abrir = (evento: MouseEvent<HTMLElement> | FocusEvent<HTMLElement>) => abrirNota(rowIndex, columnIndex, evento.currentTarget);
                return (
                  <span
                    key={`${rowItem.key}-${columnItem.key}`}
                    className={`heatmap__cell${diagonal ? " is-diagonal" : ""}${fondo}${oscura}`}
                    data-casilla={`${rowIndex}:${columnIndex}`}
                    role="img"
                    aria-label={nombreDeLaCasilla(rowIndex, columnIndex)}
                    tabIndex={rowIndex === filaEnfocada && columnIndex === columnaEnfocada ? 0 : -1}
                    onMouseEnter={abrir}
                    onFocus={(evento) => {
                      setEnfocada([rowIndex, columnIndex]);
                      abrir(evento);
                    }}
                    onBlur={() => setNota(null)}
                    onKeyDown={(evento) => mover(evento, rowIndex, columnIndex)}
                  >
                    {casilla?.noAplica ? (
                      <Ausencia clase="no-aplica" />
                    ) : casilla?.dosLineas ? (
                      <>
                        {casilla.dosLineas[0]}
                        <br />
                        {casilla.dosLineas[1]}
                      </>
                    ) : (
                      (casilla?.displayValue ?? textoDeAusencia("falta", { estrecha: true }))
                    )}
                  </span>
                );
              })
            ])}
          </div>
        </div>
        {nota && casillaDeLaNota ? (
          <div className="overlap-heatmap-nota" style={{ left: nota.x, top: nota.y }} aria-hidden="true">
            <NotaDeLaCasilla cell={casillaDeLaNota} />
          </div>
        ) : null}
      </div>
      <div className="corr-heatmap-side">
        {dataQuality ? (
          <span className={`oaa-data-pill ${dataQuality}`}>
            {sello}
            {dataQualityNote ? <span className="sr-only">: {dataQualityNote}</span> : null}
          </span>
        ) : null}
        <LeyendaDeLaRampa titulo="Solapamiento" clases={CLASES_DEL_SOLAPAMIENTO} />
        {/* Índice sin muestras de color, como el de la correlación (ANA-24): la rampa es de la magnitud. */}
        <ol className="oaa-heatmap-index oaa-heatmap-index--plain">
          {items.map((item, index) => (
            <li key={item.key}>
              <strong>{index + 1}</strong>
              <span title={item.label}>
                {item.label}
                {item.detalle ? <small className="oaa-heatmap-index__detalle">{item.detalle}</small> : null}
              </span>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
});
