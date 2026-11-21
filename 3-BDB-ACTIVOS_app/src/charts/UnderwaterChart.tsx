import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { memo } from "react";
import { OaaChartFrame, type OaaChartQualityProps } from "./oaa/OaaChartFrame";
import { compactDate, FALTA_EL_DATO, pctDeEje, primeraFechaDeCadaMes, tooltipDate, volatilidadDelGrafico } from "./oaa/chartFormatters";
import { OAA_COLORS } from "../core/theme";
import { estilosPorPapel, OAA_AXIS_STYLE, OAA_CHART_COLORS, OAA_STROKE, type EstiloDeSerie, type PapelDeSerie } from "./oaa/chartTheme";
import { OaaLegend } from "./oaa/OaaLegend";
import { OaaTooltip } from "./oaa/OaaTooltip";

export interface UnderwaterSeries {
  id: string;
  label: string;
  /** El papel decide el color (chartTheme.ts). Sin él, la primera es la cartera. */
  papel?: PapelDeSerie;
  /**
   * EN RETIRADA: este color no se pinta. Con una sola serie, la caída va en el rojo del signo (`--baja`); con dos o
   * más, cada una en el color de su papel (la cartera, marino; la referencia, gris cálido y a trazos).
   */
  color?: string;
  values: { date: string; value: number | null }[];
}

export interface UnderwaterChartProps extends OaaChartQualityProps {
  series: UnderwaterSeries[];
  height?: number;
  ariaLabel?: string;
}

interface UnderwaterDataRow {
  date: string;
  [seriesId: string]: string | number | null;
}

export const UnderwaterChart = memo(function UnderwaterChart({
  series,
  height = 250,
  ariaLabel,
  dataQuality,
  dataQualityLabel,
  dataQualityNote
}: UnderwaterChartProps) {
  if (!series || series.length === 0) {
    return null;
  }

  // Find the minimum value (max drawdown) across all series to show annotations if desired.
  // We'll also merge all series by date
  const dateMap = new Map<string, UnderwaterDataRow>();

  for (const s of series) {
    for (const point of s.values) {
      if (!dateMap.has(point.date)) {
        dateMap.set(point.date, { date: point.date });
      }
      dateMap.get(point.date)![s.id] = point.value;
    }
  }

  const data = Array.from(dateMap.values()).sort((a, b) => a.date.localeCompare(b.date));

  // Escala del eje Y: el mínimo entre TODAS las series.
  let minVal = 0;
  for (const row of data) {
    for (const s of series) {
      const v = row[s.id];
      if (typeof v === "number" && v < minVal) {
        minVal = v;
      }
    }
  }

  // La marca vertical señala la máxima caída de la SERIE PROTAGONISTA (la
  // cartera), que es la misma cifra que anuncia la cabecera del bloque.
  const lead = series[0];
  let minDataPoint: UnderwaterDataRow | null = null;
  let leadMin = 0;
  for (const row of data) {
    const v = row[lead.id];
    if (typeof v === "number" && v < leadMin) {
      leadMin = v;
      minDataPoint = row;
    }
  }

  // Round minimum for yAxis domain, e.g., -0.25 -> -0.3
  const yMin = Math.min(0, Math.floor(minVal * 10) / 10);

  /* ANA-22: el eje por fechas, como el de la evolución que va encima: la primera fecha de cada mes, escrita «nov 2026».
     Antes marcaba años («2023»), también para un primer punto de noviembre. */
  const ticks = primeraFechaDeCadaMes(data.map((row) => row.date));
  /* 14-11-2026 (Óscar: recuperar el color): una caída sola es un resultado, y va en el rojo del signo, continua y de
     2 px. Con dos o más, el rojo no diría cuál es cuál, y cada una lleva el color de su papel. */
  const estilos: EstiloDeSerie[] =
    series.length === 1 ? [{ papel: "cartera", color: OAA_COLORS.baja, grosor: OAA_STROKE.lead }] : estilosPorPapel(series);
  const nombre = ariaLabel ?? `Caída desde máximos de ${series.map((s) => s.label).join(", ")}`;
  const ultima = data.length ? data[data.length - 1].date : null;
  const fechasDeLaTabla = ultima && !ticks.includes(ultima) ? [...ticks, ultima] : ticks;
  const porFecha = new Map(data.map((row) => [row.date, row]));
  const alternativa = {
    titulo: nombre,
    columnas: ["Fecha", ...series.map((s) => s.label)],
    filas: fechasDeLaTabla.map((fecha) => ({
      clave: fecha,
      rotulo: tooltipDate(fecha),
      celdas: series.map((s) => {
        const valor = porFecha.get(fecha)?.[s.id];
        return typeof valor === "number" ? volatilidadDelGrafico(valor) : FALTA_EL_DATO;
      })
    }))
  };

  return (
    <>
      <OaaChartFrame
        height={height}
        empty={data.length === 0}
        emptyText="No hay datos para calcular la caída máxima"
        alternativa={alternativa}
        dataQuality={dataQuality}
        dataQualityLabel={dataQualityLabel}
        dataQualityNote={dataQualityNote}
      >
        <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
          <AreaChart
            data={data}
            margin={{ top: dataQuality ? 34 : 20, right: 20, left: 10, bottom: 0 }}
            accessibilityLayer
            role="img"
            aria-label={nombre}
          >
            <CartesianGrid stroke={OAA_CHART_COLORS.grid} strokeDasharray="0" vertical={false} />
            <XAxis
              dataKey="date"
              ticks={ticks}
              tickFormatter={compactDate}
              interval="preserveStartEnd"
              minTickGap={20}
              tick={OAA_AXIS_STYLE}
              axisLine={{ stroke: OAA_CHART_COLORS.axis }}
              tickLine={false}
              tickMargin={8}
            />
            <YAxis
              domain={[yMin, 0]}
              tickFormatter={pctDeEje}
              tick={OAA_AXIS_STYLE}
              axisLine={false}
              tickLine={false}
            />
            <Tooltip
              isAnimationActive={false}
              content={
                <OaaTooltip
                  labelFormatter={tooltipDate}
                  valueFormatter={volatilidadDelGrafico}
                  dashedFormatter={(item) => Boolean(estilos[series.findIndex((s) => s.id === item.dataKey)]?.trazos)}
                />
              }
              cursor={{ stroke: "var(--filete)", strokeDasharray: "3 3" }}
            />
            <ReferenceLine y={0} stroke="var(--filete)" strokeWidth={1} />
            {minDataPoint && (
              /* Marca el punto de máxima caída; la cifra vive en la cabecera del
                 bloque, no dentro del área de trazado. */
              <ReferenceLine x={minDataPoint.date} stroke={OAA_CHART_COLORS.zero} strokeWidth={1} />
            )}
            {series.map((s, index) => (
              <Area
                key={s.id}
                type="monotone"
                dataKey={s.id}
                name={s.label}
                stroke={estilos[index].color}
                strokeWidth={estilos[index].grosor}
                strokeDasharray={estilos[index].trazos}
                fill={estilos[index].color}
                /* Relleno solo en la serie protagonista. */
                fillOpacity={index === 0 ? 0.12 : 0}
                isAnimationActive={false}
                connectNulls
              />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </OaaChartFrame>
      {series.length > 1 ? (
        <OaaLegend
          items={series.map((s, index) => ({
            id: s.id,
            label: s.label,
            color: estilos[index].color,
            variant: estilos[index].trazos ? "dash" : "line"
          }))}
        />
      ) : null}
    </>
  );
});
