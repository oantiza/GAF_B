import { memo } from "react";
import { CartesianGrid, ComposedChart, Line, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis, ZAxis } from "recharts";
import { pctDecimal, rentabilidadDelGrafico, volatilidadDelGrafico } from "./chartFormatters";
import { OaaChartFrame, type OaaChartQualityProps } from "./OaaChartFrame";
import { OaaLegend } from "./OaaLegend";
import { OaaTooltip } from "./OaaTooltip";
import {
  COLOR_DE_LA_CARTERA,
  COLOR_DE_LA_REFERENCIA,
  COLOR_DEL_CONTEXTO,
  COLOR_DEL_PUNTO_DE_CONTEXTO,
  colorDeLaSerie,
  grisPideReferencia,
  OAA_AXIS_STYLE,
  OAA_CHART_COLORS,
  OAA_STROKE,
  type PapelDeSerie
} from "./chartTheme";

export interface OaaFrontierPoint {
  vol: number;
  ret: number;
}

export interface OaaFrontierMark extends OaaFrontierPoint {
  id: string;
  label: string;
  /** EN RETIRADA: el papel manda sobre el color, que ya no se pinta (salvo para entender que un gris es referencia). */
  color?: string;
  /**
   * El papel del punto. Sin él: el de `id: "current"` es la cartera (marino); uno pasado en gris, la referencia (rombo
   * en el gris cálido de la referencia: «Tu objetivo», la rentabilidad objetivo); los demás, las candidatas del optimizador, series en orden (azul,
   * verde salvia, latón, violeta).
   */
  papel?: PapelDeSerie;
  hollow?: boolean;
  /** Etiqueta directa junto al punto (B″: «Cartera actual» sin leyenda que buscar). */
  labelled?: boolean;
}

interface MarcaDibujada extends OaaFrontierMark {
  color: string;
  papel: PapelDeSerie;
}

/** El papel de cada punto de la frontera, y su color. */
function marcasConPapel(marks: readonly OaaFrontierMark[]): MarcaDibujada[] {
  let orden = 0;
  return marks.map((mark) => {
    const papel: PapelDeSerie = mark.papel ?? (mark.id === "current" ? "cartera" : grisPideReferencia(mark.color) ? "referencia" : "serie");
    if (papel === "cartera") return { ...mark, papel, color: COLOR_DE_LA_CARTERA };
    if (papel === "referencia") return { ...mark, papel, color: COLOR_DE_LA_REFERENCIA };
    const color = colorDeLaSerie(orden);
    orden += 1;
    return { ...mark, papel, color };
  });
}

/* Un punto de la frontera: círculo (lleno o hueco) o, la referencia, rombo; con su nombre a la derecha si va rotulado. */
function PuntoDeLaFrontera(props: { cx?: number; cy?: number; payload?: MarcaDibujada }) {
  const { cx, cy, payload } = props;
  if (typeof cx !== "number" || typeof cy !== "number" || !payload) return null;
  const r = payload.papel === "referencia" ? 7 : 6;
  const marca =
    payload.papel === "referencia" ? (
      <path d={`M${cx} ${cy - r}L${cx + r} ${cy}L${cx} ${cy + r}L${cx - r} ${cy}Z`} fill={payload.color} stroke="var(--papel)" strokeWidth={1.4} />
    ) : (
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill={payload.hollow ? "var(--papel)" : payload.color}
        stroke={payload.hollow ? payload.color : "var(--papel)"}
        strokeWidth={2}
      />
    );
  return (
    <g>
      {marca}
      {payload.labelled ? (
        <text x={cx + r + 5} y={cy + 4} fontFamily={OAA_AXIS_STYLE.fontFamily} fontSize={OAA_AXIS_STYLE.fontSize} fontWeight={600} fill={OAA_CHART_COLORS.text}>
          {payload.label}
        </text>
      ) : null}
    </g>
  );
}

/* Dos ejes con porcentajes: sin decir cuál es cada uno, la curva no se puede leer. La rentabilidad es
   «estimada» en todas las fronteras: la del modelo regularizado y la de composición. */
const EJE_X = "Volatilidad anualizada";
const EJE_Y = "Rentabilidad anualizada estimada";
const NOMBRE_DE_EJE = { fontSize: OAA_AXIS_STYLE.fontSize, fill: OAA_AXIS_STYLE.fill };

export const OaaFrontierChart = memo(function OaaFrontierChart({
  frontier,
  assets = [],
  marks,
  height = 390,
  ariaLabel = "Frontera eficiente",
  dataQuality,
  dataQualityLabel,
  dataQualityNote,
  frontierLabel = "Frontera",
  assetsLabel = "Activos",
  assetsColor,
  rotuloDelEjeY = EJE_Y
}: {
  frontier: OaaFrontierPoint[];
  assets?: OaaFrontierMark[];
  marks: OaaFrontierMark[];
  height?: number;
  /** El nombre del eje vertical que se dibuja. En un gráfico bajo el entero no cabe: se pasa uno corto, y la tabla
      alternativa conserva el completo. */
  rotuloDelEjeY?: string;
  ariaLabel?: string;
  frontierLabel?: string;
  assetsLabel?: string;
  /** EN RETIRADA: los activos son el contexto y van siempre en gris. */
  assetsColor?: string;
} & OaaChartQualityProps) {
  void assetsColor;
  const curve = frontier.filter((point) => Number.isFinite(point.vol) && Number.isFinite(point.ret)).sort((a, b) => a.vol - b.vol);
  const cleanAssets = assets.filter((point) => Number.isFinite(point.vol) && Number.isFinite(point.ret));
  const cleanMarks = marcasConPapel(marks.filter((point) => Number.isFinite(point.vol) && Number.isFinite(point.ret)));
  const all = [...curve, ...cleanAssets, ...cleanMarks];
  /* Lo que ya lleva su rótulo junto al punto no se vuelve a buscar en la leyenda. */
  const legend = [
    ...cleanMarks.filter((mark) => !mark.labelled).map((mark) => ({ id: mark.id, label: mark.label, color: mark.color, hollow: mark.hollow })),
    curve.length ? { id: "frontier", label: frontierLabel, color: COLOR_DEL_CONTEXTO, variant: "line" as const } : null,
    cleanAssets.length ? { id: "assets", label: assetsLabel, color: COLOR_DEL_PUNTO_DE_CONTEXTO, hollow: true } : null
  ].filter((item) => item !== null);

  const alternativa = {
    titulo: ariaLabel,
    columnas: ["Punto", EJE_X, EJE_Y],
    filas: [
      ...cleanMarks.map((mark) => ({ clave: `m-${mark.id}`, rotulo: mark.label, celdas: [volatilidadDelGrafico(mark.vol), rentabilidadDelGrafico(mark.ret)] })),
      ...cleanAssets.map((asset) => ({ clave: `a-${asset.id}`, rotulo: asset.label, celdas: [volatilidadDelGrafico(asset.vol), rentabilidadDelGrafico(asset.ret)] })),
      ...curve.map((point, indice) => ({
        clave: `f-${indice}`,
        rotulo: `${frontierLabel}, punto ${indice + 1}`,
        celdas: [volatilidadDelGrafico(point.vol), rentabilidadDelGrafico(point.ret)]
      }))
    ]
  };

  return (
    <div className="grafico-de-frontera">
      <OaaChartFrame
        height={height}
        empty={all.length < 2}
        emptyText="Sin datos suficientes para trazar la frontera."
        alternativa={alternativa}
        dataQuality={dataQuality}
        dataQualityLabel={dataQualityLabel}
        dataQualityNote={dataQualityNote}
      >
        <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
          <ComposedChart margin={{ top: 14, right: 22, left: 14, bottom: 26 }} accessibilityLayer role="img" aria-label={ariaLabel}>
            <CartesianGrid stroke={OAA_CHART_COLORS.grid} strokeDasharray="0" vertical={false} />
            <XAxis
              type="number"
              dataKey="vol"
              name="Volatilidad"
              label={{ value: EJE_X, position: "bottom", offset: 6, style: NOMBRE_DE_EJE }}
              tickFormatter={(value) => pctDecimal(value, 1)}
              axisLine={{ stroke: OAA_CHART_COLORS.axis }}
              tickLine={false}
              tick={OAA_AXIS_STYLE}
              domain={["auto", "auto"]}
            />
            <YAxis
              type="number"
              dataKey="ret"
              name="Rentabilidad"
              label={{ value: rotuloDelEjeY, angle: -90, position: "left", offset: 0, style: { ...NOMBRE_DE_EJE, textAnchor: "middle" } }}
              tickFormatter={(value) => pctDecimal(value, 1)}
              axisLine={false}
              tickLine={false}
              tick={OAA_AXIS_STYLE}
              width={58}
              domain={["auto", "auto"]}
            />
            <ZAxis type="number" dataKey="z" range={[52, 120]} />
            <Tooltip
              isAnimationActive={false}
              content={({ active, payload }) => {
                const punto = payload?.[0]?.payload as (OaaFrontierPoint & { label?: string; color?: string }) | undefined;
                return punto ? (
                  <OaaTooltip
                    active={active}
                    titulo={punto.label ?? `Punto de la ${frontierLabel.toLocaleLowerCase("es")}`}
                    filas={[
                      { clave: "vol", nombre: "Volatilidad", valor: volatilidadDelGrafico(punto.vol), color: punto.color ?? COLOR_DEL_CONTEXTO },
                      { clave: "ret", nombre: "Rentabilidad", valor: rentabilidadDelGrafico(punto.ret), color: punto.color ?? COLOR_DEL_CONTEXTO }
                    ]}
                  />
                ) : null;
              }}
            />
            {curve.length > 1 ? (
              /* Ola 3 (decisión de Oscar): la frontera se traza continua
                 también cuando es aproximada — lo dice el distintivo de
                 calidad del dato y el subtítulo, no el trazo. El punteado
                 queda para proyecciones y escenarios. Es el contexto del
                 gráfico: tinta apagada, no el marino de la cartera. */
              <Line
                data={curve}
                dataKey="ret"
                stroke={COLOR_DEL_CONTEXTO}
                strokeWidth={OAA_STROKE.compare}
                dot={false}
                isAnimationActive={false}
              />
            ) : null}
            {cleanAssets.length ? (
              <Scatter
                name={assetsLabel}
                data={cleanAssets.map((point) => ({ ...point, color: COLOR_DEL_PUNTO_DE_CONTEXTO, z: 40 }))}
                fill="var(--papel)"
                stroke={COLOR_DEL_PUNTO_DE_CONTEXTO}
                strokeWidth={1.5}
                isAnimationActive={false}
              />
            ) : null}
            {cleanMarks.map((mark) => (
              <Scatter key={mark.id} name={mark.label} data={[{ ...mark, z: 86 }]} shape={<PuntoDeLaFrontera />} isAnimationActive={false} />
            ))}
          </ComposedChart>
        </ResponsiveContainer>
      </OaaChartFrame>
      <OaaLegend items={legend} />
    </div>
  );
});
