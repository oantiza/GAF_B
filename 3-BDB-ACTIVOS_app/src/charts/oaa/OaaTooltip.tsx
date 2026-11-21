import type { ReactNode } from "react";
import { chartNumber } from "./chartFormatters";

interface TooltipPayloadItem {
  name?: string;
  value?: unknown;
  color?: string;
  dataKey?: string;
  /** `"none"`: la marca no quiere fila en la nota (el relleno de la cartera, que repite su línea). */
  type?: string;
  payload?: Record<string, unknown>;
}

/** Una fila de la nota: su marca de color, su nombre entero y su cifra con unidad. */
export interface FilaDeLaNota {
  clave: string;
  nombre: ReactNode;
  valor: ReactNode;
  color?: string;
  /** La marca es un trazo discontinuo: la serie es la referencia. */
  discontinua?: boolean;
  /** Opacidad de la marca, para una banda (la del cono). */
  opacidad?: number;
  /** Lo que se dice debajo de la cifra: la variación desde el inicio en base 100. */
  detalle?: ReactNode;
}

export interface OaaTooltipProps {
  active?: boolean;
  label?: unknown;
  payload?: TooltipPayloadItem[];
  labelFormatter?: (label: unknown, payload?: TooltipPayloadItem[]) => string;
  valueFormatter?: (value: unknown, item: TooltipPayloadItem) => string;
  /** El nombre de la fila de cada serie; por defecto, el `name` que le dio el gráfico. */
  nameFormatter?: (item: TooltipPayloadItem) => ReactNode;
  /** Lo que va bajo la cifra de una serie (la variación desde el inicio en base 100). */
  detailFormatter?: (item: TooltipPayloadItem) => ReactNode;
  /** Si la marca de una serie es discontinua. */
  dashedFormatter?: (item: TooltipPayloadItem) => boolean;
  payloadFormatter?: (payload: Record<string, unknown>) => ReactNode;
  /** La cabecera de la nota, en lugar de `labelFormatter(label)`: la fecha o la categoría. */
  titulo?: ReactNode;
  /** Las filas, ya escritas, en lugar de las del `payload` de Recharts: para las piezas que dibujan su propio SVG. */
  filas?: FilaDeLaNota[];
  /** Un bloque más, al pie: las mayores posiciones comunes de una casilla del solapamiento. */
  extra?: ReactNode;
}

/**
 * La nota al pasar el cursor: una sola pieza para todos los gráficos (apartado 7, punto 5). Arriba, la fecha o la
 * categoría; debajo, una fila por serie con su marca de color, su nombre entero y su cifra con unidad.
 */
export function OaaTooltip({
  active,
  label,
  payload,
  labelFormatter,
  valueFormatter = (value) => chartNumber(value),
  nameFormatter,
  detailFormatter,
  dashedFormatter,
  payloadFormatter,
  titulo,
  filas,
  extra
}: OaaTooltipProps) {
  if (!active) {
    return null;
  }

  /* Recharts solo aparta las marcas con `tooltipType="none"` en su nota por defecto: a una nota propia le llegan
     todas, con `type: "none"`. Sin apartarlas aquí, la cartera salía dos veces —su línea y su relleno— y con la
     misma clave. */
  const clean = (payload ?? []).filter((item) => item.type !== "none" && item.value !== null && item.value !== undefined);
  const lineas: FilaDeLaNota[] =
    filas ??
    clean.map((item) => ({
      clave: `${String(item.dataKey ?? item.name)}-${String(item.value)}`,
      nombre: nameFormatter ? nameFormatter(item) : (item.name ?? item.dataKey),
      valor: valueFormatter(item.value, item),
      color: item.color,
      discontinua: dashedFormatter?.(item),
      detalle: detailFormatter?.(item)
    }));
  if (!lineas.length && !extra) {
    return null;
  }

  const bodyPayload = clean[0]?.payload;
  const cabecera = titulo ?? (labelFormatter ? labelFormatter(label, clean) : String(label ?? ""));

  return (
    <div className="oaa-chart-tooltip">
      {cabecera ? <div className="oaa-chart-tooltip-label">{cabecera}</div> : null}
      {lineas.length ? (
        <div className="oaa-chart-tooltip-items">
          {lineas.map((linea) => (
            <div className="oaa-chart-tooltip-row" key={linea.clave}>
              <span
                className={linea.discontinua ? "oaa-chart-tooltip-dot oaa-chart-tooltip-dot--trazos" : "oaa-chart-tooltip-dot"}
                /* El color de la serie: valor por dato, en tiempo de ejecución. */
                style={
                  linea.discontinua
                    ? /* Una marca a trazos sin color es la de la referencia: su gris cálido, `--serie-referencia`. */
                      { borderTopColor: linea.color ?? "var(--serie-referencia)" }
                    : { background: linea.color ?? "var(--serie-1)", opacity: linea.opacidad }
                }
              />
              <span>{linea.nombre}</span>
              <strong>
                {linea.valor}
                {linea.detalle ? <small className="oaa-chart-tooltip-detalle">{linea.detalle}</small> : null}
              </strong>
            </div>
          ))}
        </div>
      ) : null}
      {payloadFormatter && bodyPayload ? <div className="oaa-chart-tooltip-extra">{payloadFormatter(bodyPayload)}</div> : null}
      {extra ? <div className="oaa-chart-tooltip-extra">{extra}</div> : null}
    </div>
  );
}
