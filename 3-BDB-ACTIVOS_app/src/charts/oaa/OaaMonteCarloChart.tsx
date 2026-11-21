import { memo, useMemo } from "react";
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { aNAnios, MARGEN_DERECHO_DEL_CONO } from "./ejeDelCono";
import { base100, compactDate } from "./chartFormatters";
import { ejeVertical, propiedadesDelEje } from "./ejeVertical";
import { OaaChartFrame, type OaaChartQualityProps } from "./OaaChartFrame";
import { OaaLegend } from "./OaaLegend";
import { OaaTooltip, type FilaDeLaNota } from "./OaaTooltip";
import { COLOR_DE_LA_CARTERA, OAA_AXIS_STYLE, OAA_CHART_COLORS, OAA_STROKE } from "./chartTheme";
import { buildMonteCarloProjection } from "../../core/monteCarloProjection";

/* Un solo color, el de la cartera (`--serie-1`), y una opacidad por banda: lo comparten el
   gráfico y su leyenda, que antes pintaba cuadrados sólidos (y uno en
   --brand-40, color que el gráfico no usa) y la misma muestra para la banda
   p25-p75 y para la mediana discontinua (auditoría 16-10). */
const CONE_COLOR = COLOR_DE_LA_CARTERA;
const BANDA_INTERIOR = "Percentil 25 a 75";
const BANDA_EXTERIOR = "Percentil 5 a 95";

const OUTER_BAND_OPACITY = 0.12;
const INNER_BAND_OPACITY = 0.22;
/* La banda interior se pinta SOBRE la exterior: su tono visible es la suma. */
const INNER_BAND_VISIBLE_OPACITY = 1 - (1 - OUTER_BAND_OPACITY) * (1 - INNER_BAND_OPACITY);

export interface OaaMonteCarloPoint {
  date: string;
  value: number;
}

const numero = (valor: unknown): number | null => (typeof valor === "number" && Number.isFinite(valor) ? valor : null);

/**
 * El tooltip del cono (ANA-02). El cono se dibuja apilando una base transparente (p5, p25) y el hueco hasta el extremo superior
 * (p95 − p5, p75 − p25): son series de dibujo, y el tooltip genérico las listaba y enseñaba la anchura como si fuera un nivel. Este lee
 * la fila del punto y escribe la mediana y los dos extremos de cada banda, y dice si el punto es del histórico o de la proyección.
 */
export function TooltipDelCono({
  active,
  payload,
  yFormatter = base100
}: {
  active?: boolean;
  payload?: Array<{ payload?: Record<string, unknown> }>;
  yFormatter?: (value: unknown) => string;
}) {
  const fila = active ? payload?.[0]?.payload : undefined;
  if (!fila) return null;
  const historico = numero(fila.hist);
  const p5 = numero(fila.p5);
  const p25 = numero(fila.p25);
  const p50 = numero(fila.p50);
  const p75Gap = numero(fila.p75Gap);
  const p95Gap = numero(fila.p95Gap);
  /* El punto de hoy lleva el histórico y el arranque del cono, que ahí tiene anchura cero: es del histórico. */
  const filas: FilaDeLaNota[] = historico !== null
    ? [{ clave: "hist", nombre: "Histórico", valor: yFormatter(historico), color: CONE_COLOR }]
    : [
        ...(p50 !== null ? [{ clave: "p50", nombre: "Mediana", valor: yFormatter(p50), color: CONE_COLOR, discontinua: true }] : []),
        ...(p25 !== null && p75Gap !== null
          ? [{ clave: "inner", nombre: BANDA_INTERIOR, valor: `de ${yFormatter(p25)} a ${yFormatter(p25 + p75Gap)}`, color: CONE_COLOR, opacidad: INNER_BAND_VISIBLE_OPACITY }]
          : []),
        ...(p5 !== null && p95Gap !== null
          ? [{ clave: "outer", nombre: BANDA_EXTERIOR, valor: `de ${yFormatter(p5)} a ${yFormatter(p5 + p95Gap)}`, color: CONE_COLOR, opacidad: OUTER_BAND_OPACITY }]
          : [])
      ];
  if (!filas.length) return null;
  const enBase100 = yFormatter === base100 ? " · base 100" : "";
  return <OaaTooltip active titulo={`${historico !== null ? "Histórico" : "Proyección"}${enBase100}`} filas={filas} />;
}

export const OaaMonteCarloChart = memo(function OaaMonteCarloChart({
  series,
  frequency,
  horizonYears = 3,
  height = 250,
  yAxisWidth = 52,
  yFormatter = base100,
  dataQuality = "estimated",
  dataQualityLabel = "Proyección",
  dataQualityNote = "Cono estadístico calculado desde deriva y volatilidad históricas.",
  ariaLabel
}: {
  series: OaaMonteCarloPoint[];
  frequency: "WEEKLY" | "DAILY";
  horizonYears?: number;
  height?: number;
  yAxisWidth?: number;
  yFormatter?: (value: unknown) => string;
  ariaLabel?: string;
} & OaaChartQualityProps) {
  const model = useMemo(() => {
    const observed = series.filter((point) => Number.isFinite(point.value) && point.value > 0);
    const projection = buildMonteCarloProjection(series, frequency, horizonYears);
    if (!projection) return null;
    const rows: Array<Record<string, number | string | null>> = observed.map((point, index) => ({
      index,
      label: index === 0 ? compactDate(point.date) : index === observed.length - 1 ? "Hoy" : "",
      hist: point.value,
      p5: null,
      p25: null,
      p50: null,
      p75Gap: null,
      p95Gap: null
    }));
    for (const point of projection.points) {
      const bands = {
        p5: point.p5,
        p25: point.p25,
        p50: point.p50,
        p75Gap: point.p75 - point.p25,
        p95Gap: point.p95 - point.p5
      };
      if (point.step === 0) Object.assign(rows[rows.length - 1], bands);
      else rows.push({
        index: observed.length - 1 + point.step,
        label: point.step % projection.stepsPerYear === 0 ? aNAnios(point.step / projection.stepsPerYear) : "",
        hist: null, ...bands
      });
    }
    return { rows, ticks: rows.filter((row) => row.label).map((row) => Number(row.index)) };
  }, [frequency, horizonYears, series]);

  /* El eje abarca el histórico, la banda entera del cono (del percentil 5 al 95) y la línea de 100. */
  const eje = useMemo(() => {
    const cifra = (valor: number | string | null | undefined) => (typeof valor === "number" ? valor : null);
    return ejeVertical([
      100,
      ...(model?.rows ?? []).flatMap((fila) => {
        const p5 = cifra(fila.p5);
        const ancho = cifra(fila.p95Gap);
        return [cifra(fila.hist), p5, p5 !== null && ancho !== null ? p5 + ancho : null];
      })
    ]);
  }, [model]);

  const nombre = ariaLabel ?? `Proyección estadística a ${horizonYears} años: histórico, mediana y bandas de percentiles 25 a 75 y 5 a 95`;
  /* La tabla alternativa: el arranque, hoy y el final de cada año del horizonte, con la mediana y las dos bandas. */
  const alternativa = model
    ? {
        titulo: nombre,
        columnas: ["Momento", "Histórico", "Mediana", BANDA_INTERIOR, BANDA_EXTERIOR],
        filas: model.rows
          .filter((row) => row.label)
          .map((row) => {
            const valor = (clave: string) => (typeof row[clave] === "number" ? yFormatter(row[clave]) : "");
            const banda = (base: string, hueco: string) =>
              typeof row[base] === "number" && typeof row[hueco] === "number"
                ? `de ${yFormatter(row[base])} a ${yFormatter(Number(row[base]) + Number(row[hueco]))}`
                : "";
            return {
              clave: String(row.index),
              rotulo: String(row.label),
              celdas: [valor("hist"), valor("p50"), banda("p25", "p75Gap"), banda("p5", "p95Gap")]
            };
          })
      }
    : undefined;

  return (
    <div>
      <OaaChartFrame
        height={height}
        empty={!model}
        emptyText="Serie demasiado corta para proyectar el cono."
        alternativa={alternativa}
        dataQuality={dataQuality}
        dataQualityLabel={dataQualityLabel}
        dataQualityNote={dataQualityNote}
      >
        <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
          <ComposedChart
            data={model?.rows ?? []}
            margin={{ top: 12, right: MARGEN_DERECHO_DEL_CONO, left: 4, bottom: 4 }}
            accessibilityLayer
            role="img"
            aria-label={nombre}
          >
            <CartesianGrid stroke={OAA_CHART_COLORS.grid} strokeDasharray="0" vertical={false} />
            <XAxis dataKey="index" type="number" domain={["dataMin", "dataMax"]} ticks={model?.ticks} interval={0} tickFormatter={(value) => String(model?.rows.find((row) => row.index === value)?.label ?? "")} tickLine={false} axisLine={{ stroke: OAA_CHART_COLORS.axis }} tick={OAA_AXIS_STYLE} />
            <YAxis width={yAxisWidth} tickFormatter={(value) => yFormatter(value)} axisLine={false} tickLine={false} tick={OAA_AXIS_STYLE} {...propiedadesDelEje(eje)} />
            <ReferenceLine y={100} stroke={OAA_CHART_COLORS.textMuted} strokeDasharray="3 3" strokeWidth={0.8} />
            <Tooltip isAnimationActive={false} content={<TooltipDelCono yFormatter={yFormatter} />} />
            <Area dataKey="p5" stackId="outer" stroke="none" fill="transparent" isAnimationActive={false} />
            <Area dataKey="p95Gap" stackId="outer" name={BANDA_EXTERIOR} stroke="none" fill={CONE_COLOR} fillOpacity={OUTER_BAND_OPACITY} isAnimationActive={false} />
            <Area dataKey="p25" stackId="inner" stroke="none" fill="transparent" isAnimationActive={false} />
            <Area dataKey="p75Gap" stackId="inner" name={BANDA_INTERIOR} stroke="none" fill={CONE_COLOR} fillOpacity={INNER_BAND_OPACITY} isAnimationActive={false} />
            <Line dataKey="hist" name="Histórico" stroke={CONE_COLOR} strokeWidth={OAA_STROKE.lead} dot={false} isAnimationActive={false} />
            <Line dataKey="p50" name="Mediana" stroke={CONE_COLOR} strokeWidth={OAA_STROKE.compare} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </OaaChartFrame>
      {model ? (
        <OaaLegend
          items={[
            { id: "hist", label: "Histórico", color: CONE_COLOR, variant: "line" },
            { id: "median", label: "Mediana", color: CONE_COLOR, variant: "dash" },
            { id: "inner", label: BANDA_INTERIOR, color: CONE_COLOR, variant: "band", opacity: INNER_BAND_VISIBLE_OPACITY },
            { id: "outer", label: BANDA_EXTERIOR, color: CONE_COLOR, variant: "band", opacity: OUTER_BAND_OPACITY }
          ]}
        />
      ) : null}
      <p className="asset-detail-muted oaa-chart-footnote">
        Proyección estadística (lognormal) a {horizonYears} años desde la deriva y volatilidad históricas. No es una predicción ni asesoramiento.
      </p>
    </div>
  );
});
