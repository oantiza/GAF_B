import { memo } from "react";
import { CartesianGrid, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import type { CajaDeEstilo } from "../../core/cajaDeEstilo";
import { OAA_COLORS } from "../../core/theme";
import { pesoDelGrafico } from "./chartFormatters";
import { OaaChartFrame, type OaaChartQualityProps } from "./OaaChartFrame";
import { OaaTooltip } from "./OaaTooltip";
import { OAA_AXIS_STYLE, OAA_CHART_COLORS } from "./chartTheme";
import { COLUMNAS_DE_LA_CAJA as COLS, FILAS_DE_LA_CAJA as ROWS, puntosDeLaCaja, type StyleBoxPoint } from "./puntosDeLaCaja";

/** Un peso, con un decimal, como el resto de pesos: «24,0 %». */
function percentLabel(value: number): string {
  return pesoDelGrafico(value);
}

/** El nombre entero de la columna, para la nota y la tabla: en el eje cabe «Crecim.», no en una frase. */
const NOMBRE_DE_LA_COLUMNA: Record<string, string> = { "Crecim.": "Crecimiento" };
const nombreDeColumna = (rotulo: string) => NOMBRE_DE_LA_COLUMNA[rotulo] ?? rotulo;
const NOMBRE_DEL_EJE = { fill: OAA_CHART_COLORS.textSecondary, fontSize: OAA_AXIS_STYLE.fontSize };

function StyleBoxCellShape(props: unknown) {
  const { cx, cy, payload } = props as { cx?: number; cy?: number; payload?: StyleBoxPoint };
  if (typeof cx !== "number" || typeof cy !== "number" || !payload) {
    return null;
  }

  const size = payload.size;
  return (
    <g>
      <rect
        x={cx - size / 2}
        y={cy - size / 2}
        width={size}
        height={size}
        fill={payload.fill}
        stroke={OAA_COLORS.surface}
        strokeWidth={1}
      />
      {Math.abs(payload.value) >= 1 ? (
        <text
          x={cx}
          y={cy + 4}
          textAnchor="middle"
          fill={payload.textColor}
          fontFamily="var(--fuente)"
          fontSize={OAA_AXIS_STYLE.fontSize}
          fontWeight={600}
        >
          {percentLabel(payload.value)}
        </text>
      ) : null}
    </g>
  );
}

function StyleBoxTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload?: StyleBoxPoint }> }) {
  const point = payload?.[0]?.payload;
  if (!point) return null;
  return (
    <OaaTooltip
      active={active}
      titulo="Estilo y tamaño"
      filas={[
        {
          clave: point.id,
          nombre: `${point.rowLabel} · ${nombreDeColumna(point.columnLabel)}`,
          valor: percentLabel(point.value),
          color: point.fill
        }
      ]}
    />
  );
}

export const OaaStyleBoxChart = memo(function OaaStyleBoxChart({
  celdas,
  cell = 52,
  height,
  ariaLabel = "Caja de estilo y tamaño",
  dataQuality,
  dataQualityLabel,
  dataQualityNote
}: {
  /** En % de la renta variable. Sin nada que dibujar no se monta: quien lo llama dice por qué. */
  celdas: CajaDeEstilo["celdas"];
  cell?: number;
  height?: number;
  ariaLabel?: string;
} & OaaChartQualityProps) {
  const points = puntosDeLaCaja(celdas, cell);
  const ticks = [0, 1, 2];

  /* La tabla alternativa: la caja tal cual, una fila por tamaño y una columna por estilo. */
  const alternativa = {
    titulo: ariaLabel,
    columnas: ["Tamaño", ...COLS.map((columna) => nombreDeColumna(columna.label))],
    filas: ROWS.map((fila) => ({
      clave: fila.key,
      rotulo: fila.label,
      celdas: COLS.map((columna) => {
        const punto = points.find((p) => p.rowLabel === fila.label && p.columnLabel === columna.label);
        return punto ? percentLabel(punto.value) : "";
      })
    }))
  };

  return (
    <OaaChartFrame
      height={height ?? Math.max(222, cell * 3 + 92)}
      alternativa={alternativa}
      dataQuality={dataQuality}
      dataQualityLabel={dataQualityLabel}
      dataQualityNote={dataQualityNote}
    >
      <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
        <ScatterChart margin={{ top: dataQuality ? 34 : 18, right: 18, left: 4, bottom: 24 }} accessibilityLayer role="img" aria-label={ariaLabel}>
          <CartesianGrid stroke={OAA_CHART_COLORS.grid} strokeDasharray="0" vertical={false} />
          <XAxis
            type="number"
            dataKey="x"
            domain={[-0.5, COLS.length - 0.5]}
            ticks={ticks}
            tickFormatter={(value) => COLS[Number(value)]?.label ?? ""}
            tickLine={false}
            axisLine={{ stroke: OAA_CHART_COLORS.axis }}
            tick={OAA_AXIS_STYLE}
            label={{ value: "Estilo", position: "insideBottom", offset: -10, ...NOMBRE_DEL_EJE }}
          />
          <YAxis
            type="number"
            dataKey="y"
            domain={[-0.5, ROWS.length - 0.5]}
            ticks={ticks}
            tickFormatter={(value) => ROWS[ROWS.length - 1 - Number(value)]?.label ?? ""}
            tickLine={false}
            axisLine={false}
            tick={OAA_AXIS_STYLE}
            width={74}
            label={{ value: "Tamaño", angle: -90, position: "insideLeft", ...NOMBRE_DEL_EJE }}
          />
          <ZAxis range={[1, 1]} />
          <Tooltip isAnimationActive={false} content={<StyleBoxTooltip />} cursor={{ stroke: "var(--filete)", strokeDasharray: "3 3" }} />
          <Scatter data={points} shape={<StyleBoxCellShape />} isAnimationActive={false} />
        </ScatterChart>
      </ResponsiveContainer>
    </OaaChartFrame>
  );
});
