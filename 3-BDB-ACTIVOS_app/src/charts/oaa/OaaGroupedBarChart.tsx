import { memo } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { pctPoint, pesoDelGrafico } from "./chartFormatters";
import { OaaChartFrame, type OaaChartQualityProps } from "./OaaChartFrame";
import { OaaLegend } from "./OaaLegend";
import { OaaTooltip } from "./OaaTooltip";
import { estilosPorPapel, grisPideReferencia, OAA_AXIS_STYLE, OAA_CHART_COLORS, repartoConOtros, type PapelDeSerie } from "./chartTheme";

export interface OaaGroupedBarRow {
  key: string;
  label: string;
  /** En puntos: 24 es un 24 %. */
  a: number;
  b: number;
}

/** Más de seis categorías: de la sexta en adelante se suman en «Otros». */
function sumarFilas(grupo: readonly OaaGroupedBarRow[], otros: { key: string; label: string }): OaaGroupedBarRow {
  return { ...otros, a: grupo.reduce((suma, fila) => suma + fila.a, 0), b: grupo.reduce((suma, fila) => suma + fila.b, 0) };
}

export const OaaGroupedBarChart = memo(function OaaGroupedBarChart({
  rows,
  aLabel,
  bLabel,
  aPapel,
  bPapel,
  aColor = "var(--borde-control)",
  bColor,
  height = 300,
  dataQuality,
  dataQualityLabel,
  dataQualityNote,
  ariaLabel
}: {
  rows: OaaGroupedBarRow[];
  aLabel: string;
  bLabel: string;
  /**
   * El papel de la serie `a`. Sin él, la referencia si su color a mano es gris (el de siempre: el peso estratégico), y
   * entonces va en el gris cálido de la referencia; si no, una serie.
   */
  aPapel?: PapelDeSerie;
  /** El papel de la serie `b`. Sin él, la cartera. */
  bPapel?: PapelDeSerie;
  /** EN RETIRADA: el papel manda sobre el color. */
  aColor?: string;
  /** EN RETIRADA: el papel manda sobre el color. */
  bColor?: string;
  height?: number;
  ariaLabel?: string;
} & OaaChartQualityProps) {
  void bColor;
  const [estiloA, estiloB] = estilosPorPapel([
    { papel: aPapel ?? (grisPideReferencia(aColor) ? "referencia" : "serie") },
    { papel: bPapel ?? "cartera" }
  ]);
  const filas = repartoConOtros(rows, sumarFilas);
  const nombre = ariaLabel ?? `${aLabel} frente a ${bLabel} por ${filas.length} categorías`;
  const legend = [
    { id: "a", label: aLabel, color: estiloA.color },
    { id: "b", label: bLabel, color: estiloB.color }
  ];

  return (
    <>
      <OaaChartFrame
        height={height}
        empty={rows.length === 0}
        emptyText="Sin datos de distribución."
        alternativa={{
          titulo: nombre,
          columnas: ["Categoría", aLabel, bLabel],
          filas: filas.map((fila) => ({ clave: fila.key, rotulo: fila.label, celdas: [pesoDelGrafico(fila.a), pesoDelGrafico(fila.b)] }))
        }}
        dataQuality={dataQuality}
        dataQualityLabel={dataQualityLabel}
        dataQualityNote={dataQualityNote}
      >
        <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
          <BarChart
            data={filas}
            margin={{ top: dataQuality ? 30 : 12, right: 16, left: 0, bottom: 4 }}
            accessibilityLayer
            role="img"
            aria-label={nombre}
          >
            <CartesianGrid stroke={OAA_CHART_COLORS.grid} strokeDasharray="0" vertical={false} />
            <XAxis dataKey="label" axisLine={{ stroke: OAA_CHART_COLORS.axis }} tickLine={false} tick={OAA_AXIS_STYLE} interval={0} />
            <YAxis width={48} tickFormatter={(value) => pctPoint(value, 0)} axisLine={false} tickLine={false} tick={OAA_AXIS_STYLE} />
            <Tooltip
              isAnimationActive={false}
              content={<OaaTooltip valueFormatter={(value) => pesoDelGrafico(value)} />}
              cursor={{ fill: OAA_CHART_COLORS.chartCursorFill }}
            />
            <Bar dataKey="a" name={aLabel} fill={estiloA.color} radius={0} maxBarSize={42} isAnimationActive={false} />
            <Bar dataKey="b" name={bLabel} fill={estiloB.color} radius={0} maxBarSize={42} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </OaaChartFrame>
      <OaaLegend items={legend} />
    </>
  );
});
