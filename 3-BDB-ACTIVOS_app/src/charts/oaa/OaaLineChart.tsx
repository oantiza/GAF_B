import { memo, useId, useMemo } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  usePlotArea,
  useXAxisScale,
  useYAxisScale,
  XAxis,
  YAxis
} from "recharts";
import { base100, compactDate, FALTA_EL_DATO, primeraFechaDeCadaMes, rentabilidadDelGrafico, tooltipDate } from "./chartFormatters";
import { OaaChartFrame, type OaaChartQualityProps } from "./OaaChartFrame";
import { OaaLegend } from "./OaaLegend";
import { OaaTooltip } from "./OaaTooltip";
import { estilosPorPapel, OAA_AXIS_STYLE, OAA_CHART_COLORS, type EstiloDeSerie, type PapelDeSerie } from "./chartTheme";
import { ejeVertical, propiedadesDelEje } from "./ejeVertical";
import { separarEtiquetas, textoAlFinalDeLaLinea } from "./etiquetasFinales";

export interface OaaLinePoint {
  date: string;
  value: number | null;
}

export interface OaaLineSeries {
  id: string;
  label: string;
  /** El papel de la serie, que decide su color y su trazo (chartTheme.ts). Sin él, la primera es la cartera. */
  papel?: PapelDeSerie;
  /** EN RETIRADA: el papel manda sobre el color a mano, que ya no se pinta. */
  color?: string;
  /** El puesto de la serie entre las suyas, si su color tiene que seguirla de un bloque a otro (chartTheme.ts). */
  puesto?: number;
  values: OaaLinePoint[];
  /** Trazo discontinuo para una serie que no es la referencia (un tramo estimado, un histórico ampliado). */
  dashed?: boolean;
  /**
   * El nombre corto que se escribe al final de la línea, delante de su último valor: «1», «B». Sin él, el nombre de la
   * serie, recortado. La leyenda lleva el nombre entero.
   */
  etiquetaFinal?: string;
}

interface OaaLineChartProps extends OaaChartQualityProps {
  series: OaaLineSeries[];
  height?: number;
  ariaLabel?: string;
  referenceValue?: number;
  yAxisWidth?: number;
  yFormatter?: (value: unknown) => string;
  showLegend?: boolean;
  /** La etiqueta directa al final de cada línea, con su nombre y su último valor. Por defecto, sí. */
  etiquetasFinales?: boolean;
}

/**
 * El relleno suave bajo la línea de la cartera (14-11-2026, Óscar: «dale más vida»): un degradado vertical de su color,
 * de esta opacidad arriba a nada abajo. Solo la cartera; la referencia y las demás series, sin relleno. En la dirección A
 * (18-11-2026) baja del 18 % al 9 %: bajo una línea marina, el relleno de antes era una mancha y no un velo.
 */
const OPACIDAD_DEL_RELLENO = 0.09;

/** Dos etiquetas no se acercan más que esto, en píxeles: lo que ocupa una línea de 12 px. */
const SEPARACION_DE_ETIQUETAS = 15;
/** Ancho medio de un carácter de 12 px en la sans de la interfaz, para reservar el margen de las etiquetas. */
const ANCHO_DE_CARACTER = 6.6;
const MARGEN_MAXIMO_DE_ETIQUETAS = 150;

function ultimoPunto(serie: OaaLineSeries): OaaLinePoint | undefined {
  return [...serie.values].reverse().find((punto) => typeof punto.value === "number" && Number.isFinite(punto.value));
}

function textoFinal(serie: OaaLineSeries, yFormatter: (value: unknown) => string, sola: boolean): string | null {
  const ultimo = ultimoPunto(serie);
  return ultimo ? textoAlFinalDeLaLinea(serie, yFormatter(ultimo.value), sola) : null;
}

function EtiquetasFinales({
  series,
  estilos,
  yFormatter
}: {
  series: OaaLineSeries[];
  estilos: EstiloDeSerie[];
  yFormatter: (value: unknown) => string;
}) {
  const escalaX = useXAxisScale();
  const escalaY = useYAxisScale();
  const area = usePlotArea();
  if (!escalaX || !escalaY || !area) return null;
  const finales = series.flatMap((serie, indice) => {
    const ultimo = ultimoPunto(serie);
    const texto = textoFinal(serie, yFormatter, series.length === 1);
    const x = ultimo ? escalaX(ultimo.date) : undefined;
    const y = ultimo ? escalaY(ultimo.value) : undefined;
    return typeof x === "number" && typeof y === "number" && texto
      ? [{ id: serie.id, texto, color: estilos[indice].color, x, y }]
      : [];
  });
  const posiciones = separarEtiquetas(
    finales.map((final) => final.y),
    SEPARACION_DE_ETIQUETAS,
    area.y + 6,
    area.y + area.height - 2
  );
  return (
    <g aria-hidden="true">
      {finales.map((final, indice) => (
        <g key={final.id}>
          {/* Si dos líneas acaban juntas, la etiqueta se aparta y este trazo dice de cuál es. */}
          <line x1={final.x} x2={final.x + 7} y1={final.y} y2={posiciones[indice]} stroke={final.color} strokeWidth={1} />
          <text
            fill={OAA_CHART_COLORS.text}
            fontFamily={OAA_AXIS_STYLE.fontFamily}
            fontSize={OAA_AXIS_STYLE.fontSize}
            fontWeight={600}
            x={final.x + 9}
            y={posiciones[indice] + 4}
          >
            {final.texto}
          </text>
        </g>
      ))}
    </g>
  );
}

/**
 * Una fila por fecha, ordenadas, con el valor de cada serie o `null`. ANA-21: cada serie se indexa una vez por fecha en vez de buscar
 * cada fecha en ella (con cinco años diarios y dos series eran millones de comparaciones). Si una fecha se repite, vale la primera.
 */
// eslint-disable-next-line react-refresh/only-export-components -- función pura del gráfico, exportada para su prueba (ANA-21)
export function filasDelGrafico(series: readonly OaaLineSeries[]): Array<Record<string, string | number | null>> {
  const dates = new Set<string>();
  const indices = series.map((serie) => {
    const porFecha = new Map<string, number | null>();
    for (const point of serie.values) {
      dates.add(point.date);
      if (!porFecha.has(point.date)) porFecha.set(point.date, point.value);
    }
    return porFecha;
  });
  return Array.from(dates)
    .sort()
    .map((date) => {
      const row: Record<string, string | number | null> = { date };
      series.forEach((serie, indice) => {
        const value = indices[indice].get(date);
        row[serie.id] = typeof value === "number" && Number.isFinite(value) ? value : null;
      });
      return row;
    });
}

export const OaaLineChart = memo(function OaaLineChart({
  series,
  height = 260,
  ariaLabel,
  referenceValue,
  yAxisWidth = 52,
  yFormatter = base100,
  showLegend = true,
  etiquetasFinales = true,
  dataQuality,
  dataQualityLabel,
  dataQualityNote
}: OaaLineChartProps) {
  /* ANA-21: memorizadas sobre las series que llegan; antes `cleanSeries` era nueva en cada pintada y el memo no servía. */
  const cleanSeries = useMemo(() => series.filter((serie) => serie.values.some((point) => typeof point.value === "number")), [series]);
  const data = useMemo(() => filasDelGrafico(cleanSeries), [cleanSeries]);
  const fechasDelEje = useMemo(() => primeraFechaDeCadaMes(data.map((row) => String(row.date))), [data]);
  const estilos = useMemo(() => estilosPorPapel(cleanSeries), [cleanSeries]);
  /* El id del degradado, único por gráfico y sin los signos de `useId`, que no valen dentro de `url(#…)`. */
  const prefijoDelRelleno = `relleno-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const rellenos = cleanSeries.flatMap((serie, indice) =>
    estilos[indice].papel === "cartera" ? [{ serie, color: estilos[indice].color, id: `${prefijoDelRelleno}-${indice}` }] : []
  );
  const eje = useMemo(
    () => ejeVertical([...cleanSeries.flatMap((serie) => serie.values.map((punto) => punto.value)), referenceValue]),
    [cleanSeries, referenceValue]
  );
  const qualityDashed = dataQuality === "estimated" || dataQuality === "mixed";
  const trazosDe = (indice: number) => estilos[indice].trazos ?? (cleanSeries[indice].dashed || qualityDashed ? "5 4" : undefined);
  const enBase100 = yFormatter === base100;
  const nombre = ariaLabel ?? `Evolución de ${cleanSeries.map((serie) => serie.label).join(", ")}`;

  /* El margen derecho que piden las etiquetas directas: la más larga, con su tope. */
  const textosFinales = etiquetasFinales ? cleanSeries.map((serie) => textoFinal(serie, yFormatter, cleanSeries.length === 1) ?? "") : [];
  const largoFinal = Math.max(0, ...textosFinales.map((texto) => texto.length));
  const margenDerecho = largoFinal ? Math.min(MARGEN_MAXIMO_DE_ETIQUETAS, Math.ceil(largoFinal * ANCHO_DE_CARACTER) + 14) : 18;

  /* Base 100: la nota dice la variación desde el primer valor de cada serie. */
  const inicios = useMemo(
    () =>
      new Map(
        cleanSeries.map((serie) => [serie.id, serie.values.find((punto) => typeof punto.value === "number" && Number.isFinite(punto.value))?.value ?? null])
      ),
    [cleanSeries]
  );

  const legend = cleanSeries.map((serie, index) => ({
    id: serie.id,
    label: serie.label,
    color: estilos[index].color,
    variant: trazosDe(index) ? ("dash" as const) : ("line" as const)
  }));

  /* La tabla alternativa: una fila por mes (las mismas fechas del eje) y la última, con cada serie. */
  const alternativa = useMemo(() => {
    const ultima = data.length ? String(data[data.length - 1].date) : null;
    const fechas = ultima && !fechasDelEje.includes(ultima) ? [...fechasDelEje, ultima] : fechasDelEje;
    const porFecha = new Map(data.map((fila) => [String(fila.date), fila]));
    return {
      titulo: nombre,
      columnas: ["Fecha", ...cleanSeries.map((serie) => serie.label)],
      filas: fechas.map((fecha) => ({
        clave: fecha,
        rotulo: tooltipDate(fecha),
        celdas: cleanSeries.map((serie) => {
          const valor = porFecha.get(fecha)?.[serie.id];
          return typeof valor === "number" ? yFormatter(valor) : FALTA_EL_DATO;
        })
      }))
    };
  }, [cleanSeries, data, fechasDelEje, nombre, yFormatter]);

  return (
    <>
      <OaaChartFrame
        height={height}
        empty={cleanSeries.length === 0 || data.length < 2}
        alternativa={alternativa}
        dataQuality={dataQuality}
        dataQualityLabel={dataQualityLabel}
        dataQualityNote={dataQualityNote}
      >
        <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
          <ComposedChart
            data={data}
            margin={{ top: dataQuality ? 30 : 12, right: margenDerecho, left: 4, bottom: 2 }}
            accessibilityLayer
            role="img"
            aria-label={nombre}
          >
            <CartesianGrid stroke={OAA_CHART_COLORS.grid} strokeDasharray="0" vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={compactDate}
              /* Una etiqueta por mes, y si no caben, las que quepan sin perder la primera ni la última. */
              ticks={fechasDelEje}
              interval="preserveStartEnd"
              axisLine={{ stroke: OAA_CHART_COLORS.axis }}
              tickLine={false}
              minTickGap={20}
              tick={OAA_AXIS_STYLE}
            />
            <YAxis
              width={yAxisWidth}
              /* En base 100, si todas las marcas son enteras («90 · 100 · 110») se escriben sin decimal: «100,0» era ruido.
                 La etiqueta final, la leyenda y la tabla siguen con el suyo. */
              tickFormatter={(value) => (enBase100 && eje?.decimales === 0 ? base100(value, 0) : yFormatter(value))}
              axisLine={false}
              tickLine={false}
              tick={OAA_AXIS_STYLE}
              {...propiedadesDelEje(eje)}
            />
            {referenceValue !== undefined ? (
              <ReferenceLine y={referenceValue} stroke={OAA_CHART_COLORS.zero} strokeWidth={1} />
            ) : null}
            <Tooltip
              isAnimationActive={false}
              content={
                <OaaTooltip
                  labelFormatter={(label) => `${tooltipDate(label)}${enBase100 ? " · base 100" : ""}`}
                  valueFormatter={(value) => yFormatter(value)}
                  dashedFormatter={(item) => Boolean(trazosDe(cleanSeries.findIndex((serie) => serie.id === item.dataKey)))}
                  detailFormatter={(item) => {
                    const inicio = enBase100 ? inicios.get(String(item.dataKey)) : null;
                    return typeof inicio === "number" && inicio !== 0 && typeof item.value === "number"
                      ? `${rentabilidadDelGrafico(item.value / inicio - 1)} desde el inicio`
                      : null;
                  }}
                />
              }
            />
            {rellenos.length ? (
              <defs>
                {rellenos.map((relleno) => (
                  <linearGradient key={relleno.id} id={relleno.id} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={relleno.color} stopOpacity={OPACIDAD_DEL_RELLENO} />
                    <stop offset="100%" stopColor={relleno.color} stopOpacity={0} />
                  </linearGradient>
                ))}
              </defs>
            ) : null}
            {/* El relleno de la cartera, debajo de todas las líneas. Baja hasta el borde inferior del área de dibujo
                (`dataMin`, el mínimo del eje), parta o no de cero; no cambia el eje, porque son los mismos valores, ni
                sale en la nota ni en la leyenda. */}
            {rellenos.map((relleno) => (
              <Area
                key={relleno.id}
                type="monotone"
                dataKey={relleno.serie.id}
                baseValue="dataMin"
                stroke="none"
                fill={`url(#${relleno.id})`}
                fillOpacity={1}
                dot={false}
                activeDot={false}
                tooltipType="none"
                legendType="none"
                connectNulls={false}
                isAnimationActive={false}
              />
            ))}
            {cleanSeries.map((serie, index) => (
              <Line
                key={serie.id}
                type="monotone"
                dataKey={serie.id}
                name={serie.label}
                stroke={estilos[index].color}
                strokeWidth={estilos[index].grosor}
                strokeDasharray={trazosDe(index)}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 2, stroke: OAA_CHART_COLORS.surface }}
                connectNulls={false}
                isAnimationActive={false}
              />
            ))}
            {etiquetasFinales ? <EtiquetasFinales series={cleanSeries} estilos={estilos} yFormatter={yFormatter} /> : null}
          </ComposedChart>
        </ResponsiveContainer>
      </OaaChartFrame>
      {showLegend && cleanSeries.length > 1 ? <OaaLegend items={legend} /> : null}
    </>
  );
});
