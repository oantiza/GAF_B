import { memo, useMemo } from "react";
import { CartesianGrid, LabelList, ReferenceArea, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { SEQUENTIAL_RAMP } from "../../core/theme";
import { OaaChartFrame, type OaaChartQualityProps } from "./OaaChartFrame";
import { OaaTooltip } from "./OaaTooltip";
import { OAA_AXIS_STYLE, OAA_CHART_COLORS } from "./chartTheme";

export interface OaaRiskMatrixPoint {
  id: string;
  label: string;
  probability: "Baja" | "Media" | "Alta" | string;
  impact: "Bajo" | "Medio" | "Alto" | string;
}

const PROBABILITY_LABELS = ["Baja", "Media", "Alta"];
const IMPACT_LABELS = ["Bajo", "Medio", "Alto"];
const PROBABILITY_X: Record<string, number> = { Baja: 0, Media: 1, Alta: 2 };
const IMPACT_Y: Record<string, number> = { Bajo: 0, Medio: 1, Alto: 2 };
/** Fondo del cuadrante por severidad (probabilidad + impacto): UNA magnitud, así que una sola tinta, los cinco
    pasos claros de la rampa secuencial. Antes iba de índigo a ocre y a un rojo de aviso, que en un gráfico dicen
    otra cosa (paso 2 del rediseño). El texto de cada riesgo aporta la lectura exacta; el color solo ordena. Los
    puntos, marino, se leen sobre el más oscuro (6,1:1). */
const CELL_BG = SEQUENTIAL_RAMP.slice(0, 5);
const NOMBRE_DEL_EJE = { fill: OAA_CHART_COLORS.textSecondary, fontSize: OAA_AXIS_STYLE.fontSize };

/** Área del punto en px². Lleva dentro el número que lo casa con la lista de debajo: con 92, un
    punto de 11 px, el número no se leía. */
const TAMANO_DEL_PUNTO = 280;

export const OaaRiskMatrixChart = memo(function OaaRiskMatrixChart({
  points,
  height = 260,
  ariaLabel = "Matriz de riesgos: probabilidad por impacto",
  dataQuality,
  dataQualityLabel,
  dataQualityNote
}: {
  points: OaaRiskMatrixPoint[];
  height?: number;
  ariaLabel?: string;
} & OaaChartQualityProps) {
  const data = useMemo(() => {
    const cellCount = new Map<string, number>();
    return points.map((point, index) => {
      const baseX = PROBABILITY_X[point.probability] ?? 1;
      const y = IMPACT_Y[point.impact] ?? 1;
      const key = `${baseX}:${y}`;
      const count = cellCount.get(key) ?? 0;
      cellCount.set(key, count + 1);
      const offset = [0, 0.14, -0.14, 0.28, -0.28][count] ?? (count % 2 === 0 ? -0.32 : 0.32);
      return {
        ...point,
        index: index + 1,
        x: Math.max(-0.38, Math.min(2.38, baseX + offset)),
        y,
        z: TAMANO_DEL_PUNTO
      };
    });
  }, [points]);

  return (
    <OaaChartFrame
      height={height}
      empty={data.length === 0}
      emptyText="Sin riesgos destacados para esta lectura."
      alternativa={{
        titulo: ariaLabel,
        columnas: ["Riesgo", "Número", "Probabilidad", "Impacto"],
        filas: data.map((point) => ({ clave: point.id, rotulo: point.label, celdas: [String(point.index), point.probability, point.impact] }))
      }}
      dataQuality={dataQuality}
      dataQualityLabel={dataQualityLabel}
      dataQualityNote={dataQualityNote}
    >
      <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
        <ScatterChart margin={{ top: dataQuality ? 30 : 14, right: 16, left: 0, bottom: 12 }} accessibilityLayer role="img" aria-label={ariaLabel}>
          {[0, 1, 2].map((probability) =>
            [0, 1, 2].map((impact) => (
              <ReferenceArea
                key={`${probability}-${impact}`}
                x1={probability - 0.5}
                x2={probability + 0.5}
                y1={impact - 0.5}
                y2={impact + 0.5}
                fill={CELL_BG[probability + impact]}
                stroke={OAA_CHART_COLORS.grid}
                strokeOpacity={0.8}
                ifOverflow="extendDomain"
              />
            ))
          )}
          <CartesianGrid stroke={OAA_CHART_COLORS.grid} strokeDasharray="0" vertical={false} />
          <XAxis
            type="number"
            dataKey="x"
            domain={[-0.5, 2.5]}
            ticks={[0, 1, 2]}
            tickFormatter={(value) => PROBABILITY_LABELS[Number(value)] ?? ""}
            axisLine={{ stroke: OAA_CHART_COLORS.axis }}
            tickLine={false}
            tick={OAA_AXIS_STYLE}
            label={{ value: "Probabilidad", position: "insideBottom", offset: -8, ...NOMBRE_DEL_EJE }}
          />
          <YAxis
            type="number"
            dataKey="y"
            domain={[-0.5, 2.5]}
            ticks={[0, 1, 2]}
            tickFormatter={(value) => IMPACT_LABELS[Number(value)] ?? ""}
            axisLine={false}
            tickLine={false}
            tick={OAA_AXIS_STYLE}
            width={58}
            label={{ value: "Impacto", angle: -90, position: "insideLeft", ...NOMBRE_DEL_EJE }}
          />
          <ZAxis type="number" dataKey="z" range={[TAMANO_DEL_PUNTO, TAMANO_DEL_PUNTO]} />
          <Tooltip
            isAnimationActive={false}
            content={({ active, payload }) => {
              const punto = payload?.[0]?.payload as (OaaRiskMatrixPoint & { index: number }) | undefined;
              return punto ? (
                <OaaTooltip
                  active={active}
                  titulo={`${punto.index}. ${punto.label}`}
                  filas={[
                    { clave: "p", nombre: "Probabilidad", valor: punto.probability, color: OAA_CHART_COLORS.spruce },
                    { clave: "i", nombre: "Impacto", valor: punto.impact, color: OAA_CHART_COLORS.spruce }
                  ]}
                />
              ) : null;
            }}
            cursor={{ stroke: OAA_CHART_COLORS.textMuted, strokeDasharray: "3 3" }}
          />
          <Scatter data={data} fill="var(--marca)" stroke="var(--papel)" strokeWidth={2} isAnimationActive={false}>
            <LabelList className="oaa-matriz-numero" dataKey="index" position="inside" fontSize={OAA_AXIS_STYLE.fontSize} />
          </Scatter>
        </ScatterChart>
      </ResponsiveContainer>
    </OaaChartFrame>
  );
});
