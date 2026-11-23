import { memo } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { pesoDelGrafico as pctPoint } from "./chartFormatters";
import { OaaChartFrame, type OaaChartQualityProps } from "./OaaChartFrame";
import { OaaLegend } from "./OaaLegend";
import { OaaTooltip } from "./OaaTooltip";
import { coloresDelReparto, repartoConOtros } from "./chartTheme";
import { NOTA_DEL_ARO_NETO } from "../../core/repartoNeto";

export interface OaaDonutSlice {
  key: string;
  label: string;
  /** En puntos: 24 es un 24 %. */
  value: number;
  /**
   * EN RETIRADA: el color lo decide el orden y el papel («Otros», «No declarado» van en gris). Solo se mira para
   * entender que un gris pasado a mano es un resto.
   */
  color?: string;
  /**
   * El color fijo de la categoría (la clase de activo, `colorDeLaClase`), el mismo en toda la aplicación. Una porción
   * con nombre propio que lo trae lo lleva; las que no, el de su orden entre ellas, sin repetir un color ya usado por
   * una categoría fija; el resto, gris (`coloresDelReparto`). Lo agrupado en «Otros» lo pierde.
   */
  colorDeCategoria?: string;
}

/**
 * Más de seis categorías no se pintan con seis colores reciclados: de la sexta en adelante, «Otros». La porción sumada
 * no hereda el color de ninguna de las suyas: es un resto, y va en gris.
 */
function sumarPorciones(grupo: readonly OaaDonutSlice[], otros: { key: string; label: string }): OaaDonutSlice {
  return { ...otros, value: grupo.reduce((suma, porcion) => suma + porcion.value, 0) };
}

export const OaaDonutChart = memo(function OaaDonutChart({
  data,
  height = 238,
  innerRadius = 62,
  outerRadius = 86,
  dataQuality,
  dataQualityLabel,
  dataQualityNote,
  center,
  layout = "row",
  ariaLabel
}: {
  data: OaaDonutSlice[];
  height?: number;
  innerRadius?: number;
  outerRadius?: number;
  /** Cifra y nota en el hueco del aro (B″: capital y n.º de posiciones). */
  /** `enPalabras`: el valor es una frase, no una cifra, y va al tamaño de una frase. */
  center?: { value: string; note?: string; enPalabras?: boolean };
  /** `stack`: leyenda debajo del aro (columna lateral); `row`: al lado. */
  layout?: "row" | "stack";
  /** Nombre accesible del gráfico; por defecto, el reparto en texto. */
  ariaLabel?: string;
} & OaaChartQualityProps) {
  const slices = repartoConOtros(
    data.filter((item) => Number.isFinite(item.value) && item.value > 0),
    sumarPorciones
  );
  /*
   * Un reparto neto (C-29, 21-11-2026) puede traer una parte negativa —un corto, liquidez prestada— y otra por encima del 100 %.
   * Un aro no puede dibujar una porción negativa: dibuja las positivas, y la negativa va en la leyenda con su signo y sin porción
   * (muestra hueca). Lo dice la nota de debajo, porque entonces las porciones no son partes de 100.
   */
  const negativas = data.filter((item) => Number.isFinite(item.value) && item.value < -0.05);
  const esNeto = negativas.length > 0 || slices.some((slice) => slice.value > 100.05);
  const colores = coloresDelReparto(slices);
  const legend = [
    ...slices.map((slice, index) => ({
      id: slice.key,
      label: slice.label,
      color: colores[index],
      value: pctPoint(slice.value)
    })),
    ...negativas.map((parte) => ({
      id: parte.key,
      label: parte.label,
      color: parte.colorDeCategoria ?? parte.color ?? "var(--clase-resto)",
      value: pctPoint(parte.value),
      hollow: true
    }))
  ];
  const nombre = ariaLabel ?? `Reparto: ${legend.map((item) => `${item.label} ${item.value}`).join(", ")}`;
  const nota = esNeto ? <p className="oaa-donut-nota">{NOTA_DEL_ARO_NETO}</p> : null;

  // Revisión 12-08 (B2): un donut de una sola porción es un gráfico sin
  // información — con una única categoría, la cifra dice lo mismo y mejor.
  // La regla nació en la Divisa del Análisis y ahora vive aquí, para todos.
  if (slices.length === 1 && negativas.length === 0) {
    const only = slices[0];
    return (
      <div className="oaa-donut-layout oaa-donut-layout--single">
        <OaaChartFrame
          height={104}
          className="oaa-donut-frame oaa-donut-frame--single"
          dataQuality={dataQuality}
          dataQualityLabel={dataQualityLabel}
          dataQualityNote={dataQualityNote}
        >
          <div className="oaa-donut-single" role="img" aria-label={`${only.label}: ${pctPoint(only.value)}`}>
            <strong>{pctPoint(only.value)}</strong>
            <span>{only.label}</span>
          </div>
        </OaaChartFrame>
      </div>
    );
  }

  return (
    <div className={layout === "stack" ? "oaa-donut-layout oaa-donut-layout--stack" : "oaa-donut-layout"}>
      <OaaChartFrame
        height={height}
        className={center ? "oaa-donut-frame oaa-donut-frame--centered" : "oaa-donut-frame"}
        empty={slices.length === 0}
        emptyText="Sin datos de distribución."
        alternativa={{
          titulo: nombre,
          columnas: ["Categoría", "Peso"],
          filas: legend.map((item) => ({ clave: item.id, rotulo: item.label, celdas: [item.value] }))
        }}
        dataQuality={dataQuality}
        dataQualityLabel={dataQualityLabel}
        dataQualityNote={dataQualityNote}
      >
        <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
          <PieChart accessibilityLayer role="img" aria-label={nombre}>
            <Pie
              data={slices}
              dataKey="value"
              nameKey="label"
              innerRadius={innerRadius}
              outerRadius={outerRadius}
              paddingAngle={3}
              stroke="var(--papel)"
              strokeWidth={2}
              isAnimationActive={false}
            >
              {slices.map((slice, index) => (
                <Cell key={slice.key} fill={colores[index]} />
              ))}
            </Pie>
            <Tooltip isAnimationActive={false} content={<OaaTooltip valueFormatter={(value) => pctPoint(value)} />} />
          </PieChart>
        </ResponsiveContainer>
        {center ? (
          <div className="oaa-donut-center" aria-hidden="true">
            <strong className={center.enPalabras ? "is-en-palabras" : undefined}>{center.value}</strong>
            {center.note ? <small>{center.note}</small> : null}
          </div>
        ) : null}
      </OaaChartFrame>
      <OaaLegend items={legend} />
      {nota}
    </div>
  );
});
