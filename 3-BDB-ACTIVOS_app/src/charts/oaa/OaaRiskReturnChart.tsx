import { memo } from "react";
import { CartesianGrid, ComposedChart, Line, ResponsiveContainer, Scatter, Tooltip, usePlotArea, useXAxisScale, useYAxisScale, XAxis, YAxis, ZAxis } from "recharts";
import { pctDecimal, rentabilidadDelGrafico, volatilidadDelGrafico } from "./chartFormatters";
import { colocarNombres } from "./etiquetasDelMapa";
import { OaaChartFrame, type OaaChartQualityProps } from "./OaaChartFrame";
import { OaaLegend } from "./OaaLegend";
import { OaaTooltip } from "./OaaTooltip";
import {
  COLOR_DE_LA_CARTERA,
  COLOR_DE_LA_REFERENCIA,
  COLOR_DEL_PUNTO_DE_CONTEXTO,
  estilosPorPapel,
  OAA_AXIS_STYLE,
  OAA_CHART_COLORS,
  OAA_STROKE,
  TRAZOS_DE_LA_REFERENCIA,
  type PapelDeSerie
} from "./chartTheme";

export interface OaaRiskReturnPoint {
  id: string;
  label: string;
  vol: number;
  ret: number;
  /** EN RETIRADA: el color lo decide el papel del punto (la cartera, marino; cada referencia, rombo en el gris de la referencia). */
  color?: string;
  /** El papel de una cartera comparada (`marks`); sin él, la primera es la cartera y las demás, series en orden. */
  papel?: PapelDeSerie;
  kind?: "asset" | "portfolio" | "benchmark" | "mark";
}

function isValidPoint(point: OaaRiskReturnPoint): boolean {
  return Number.isFinite(point.vol) && Number.isFinite(point.ret) && point.vol >= 0;
}

/** Los dos ejes llevan su nombre: sin él, dos porcentajes no se distinguen (ANA-04). */
export const EJE_DE_VOLATILIDAD = "Volatilidad";
export const EJE_DE_RENTABILIDAD = "Rentabilidad anualizada";
const NOMBRE_DE_EJE = { fontSize: OAA_AXIS_STYLE.fontSize, fill: OAA_AXIS_STYLE.fill };

type Forma = "punto" | "rombo" | "aro";

interface PuntoDibujado extends OaaRiskReturnPoint {
  color: string;
  forma: Forma;
  /** Se escribe su nombre junto al punto: la identidad no depende solo del color. */
  rotulado: boolean;
  tipo: string;
  z: number;
}

const radioDe = (forma: Forma): number => (forma === "rombo" ? 6.5 : forma === "aro" ? 4 : 6);

/** Un punto del mapa con su forma. Su nombre lo escribe `NombresDelMapa`, que ve todos los puntos a la vez. */
function PuntoDelMapa(props: { cx?: number; cy?: number; payload?: PuntoDibujado }) {
  const { cx, cy, payload } = props;
  if (typeof cx !== "number" || typeof cy !== "number" || !payload) return null;
  const r = radioDe(payload.forma);
  return payload.forma === "rombo" ? (
    <path d={`M${cx} ${cy - r}L${cx + r} ${cy}L${cx} ${cy + r}L${cx - r} ${cy}Z`} fill={payload.color} stroke="var(--papel)" strokeWidth={1.4} />
  ) : payload.forma === "aro" ? (
    <circle cx={cx} cy={cy} r={r} fill="var(--papel)" stroke={payload.color} strokeWidth={1.5} />
  ) : (
    <circle cx={cx} cy={cy} r={r} fill={payload.color} stroke="var(--papel)" strokeWidth={2} />
  );
}

/** Ancho medio de un carácter de 12 px en negrita de la sans de la interfaz, para saber cuánto ocupa un nombre. */
const ANCHO_DE_CARACTER = 6.9;

/**
 * El nombre de cada punto que lo lleva, en tinta, junto a su marca. Se colocan todos a la vez (`etiquetasDelMapa.ts`):
 * a la derecha si cabe y no pisa nada; si no, a la izquierda, encima o debajo. La cartera elige sitio la primera.
 */
function NombresDelMapa({ puntos }: { puntos: PuntoDibujado[] }) {
  const escalaX = useXAxisScale();
  const escalaY = useYAxisScale();
  const area = usePlotArea();
  if (!escalaX || !escalaY || !area) return null;
  const situados = puntos.flatMap((punto) => {
    const x = escalaX(punto.vol);
    const y = escalaY(punto.ret);
    return typeof x === "number" && typeof y === "number" ? [{ punto, x, y, radio: radioDe(punto.forma) }] : [];
  });
  const conNombre = situados.filter(({ punto }) => punto.rotulado);
  const nombres = colocarNombres(
    conNombre.map(({ punto, x, y, radio }) => ({ id: `${punto.tipo}-${punto.id}`, x, y, radio, ancho: punto.label.length * ANCHO_DE_CARACTER, prioridad: punto.z })),
    area,
    situados.filter(({ punto }) => !punto.rotulado)
  );
  return (
    <g>
      {conNombre.map(({ punto }, indice) => {
        const nombre = nombres[indice];
        return nombre ? (
          <text
            key={nombre.id}
            x={nombre.x}
            y={nombre.y}
            textAnchor={nombre.ancla}
            fontFamily={OAA_AXIS_STYLE.fontFamily} fontSize={OAA_AXIS_STYLE.fontSize} fontWeight={600} fill={OAA_CHART_COLORS.text}>
            {punto.label}
          </text>
        ) : null;
      })}
    </g>
  );
}

export const OaaRiskReturnChart = memo(function OaaRiskReturnChart({
  holdings = [],
  benchmarks = [],
  portfolio,
  marks = [],
  height = 330,
  ariaLabel = "Mapa de volatilidad y rentabilidad anualizada",
  dataQuality,
  dataQualityLabel,
  dataQualityNote,
  showLegend = true,
  xDomain,
  yDomain
}: {
  holdings?: OaaRiskReturnPoint[];
  benchmarks?: OaaRiskReturnPoint[];
  portfolio?: OaaRiskReturnPoint | null;
  marks?: OaaRiskReturnPoint[];
  height?: number;
  ariaLabel?: string;
  showLegend?: boolean;
  xDomain?: [number, number];
  yDomain?: [number, number];
} & OaaChartQualityProps) {
  /* Los activos sueltos son el contexto: un aro gris, con su nombre en la nota y en la tabla. */
  const assetData: PuntoDibujado[] = holdings
    .filter(isValidPoint)
    .map((point) => ({ ...point, color: COLOR_DEL_PUNTO_DE_CONTEXTO, forma: "aro", rotulado: false, tipo: "Activo", z: 42 }));
  /* ANA-04: cada cartera de referencia, un rombo CON SU NOMBRE, en el color de la referencia (gris cálido desde la
     dirección A, 18-11-2026); la línea que las une, en el mismo color y a trazos. */
  const benchData: PuntoDibujado[] = benchmarks
    .filter(isValidPoint)
    .map((point) => ({ ...point, color: COLOR_DE_LA_REFERENCIA, forma: "rombo", rotulado: true, tipo: "Cartera de referencia", z: 46 }));
  const marcasValidas = marks.filter(isValidPoint);
  const estilosDeMarcas = estilosPorPapel(marcasValidas);
  const markData: PuntoDibujado[] = marcasValidas.map((point, index) => ({
    ...point,
    color: estilosDeMarcas[index].color,
    forma: estilosDeMarcas[index].papel === "referencia" ? "rombo" : "punto",
    rotulado: true,
    tipo: estilosDeMarcas[index].papel === "referencia" ? "Referencia" : "Cartera comparada",
    z: 80
  }));
  /* La cartera del cliente es SIEMPRE marino, `--serie-1`, y lleva su nombre. */
  const portfolioData: PuntoDibujado[] =
    portfolio && isValidPoint(portfolio)
      ? [{ ...portfolio, color: COLOR_DE_LA_CARTERA, forma: "punto", rotulado: true, tipo: "Cartera", z: 92 }]
      : [];
  const all = [...assetData, ...benchData, ...markData, ...portfolioData];
  const benchLine = [...benchData].sort((a, b) => a.vol - b.vol);

  const legend = [
    portfolioData.length ? { id: "portfolio", label: portfolioData[0].label, color: portfolioData[0].color } : null,
    ...markData.map((mark) => ({ id: `mark-${mark.id}`, label: mark.label, color: mark.color })),
    assetData.length ? { id: "assets", label: "Activos", color: COLOR_DEL_PUNTO_DE_CONTEXTO, hollow: true } : null,
    benchData.length ? { id: "bench", label: "Carteras de referencia", color: COLOR_DE_LA_REFERENCIA } : null
  ].filter((item): item is { id: string; label: string; color: string; hollow?: boolean } => item !== null);

  const alternativa = {
    titulo: ariaLabel,
    columnas: ["Punto", "Qué es", EJE_DE_VOLATILIDAD, EJE_DE_RENTABILIDAD],
    filas: [...portfolioData, ...markData, ...benchData, ...assetData].map((point) => ({
      clave: `${point.tipo}-${point.id}`,
      rotulo: point.label,
      celdas: [point.tipo, volatilidadDelGrafico(point.vol), rentabilidadDelGrafico(point.ret)]
    }))
  };

  return (
    <>
      <OaaChartFrame
        height={height}
        empty={all.length === 0}
        emptyText="Sin volatilidad y rentabilidad suficientes para el mapa."
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
              name={EJE_DE_VOLATILIDAD}
              label={{ value: EJE_DE_VOLATILIDAD, position: "bottom", offset: 6, style: NOMBRE_DE_EJE }}
              tickFormatter={(value) => pctDecimal(value, 1)}
              axisLine={{ stroke: OAA_CHART_COLORS.axis }}
              tickLine={false}
              tick={OAA_AXIS_STYLE}
              domain={xDomain ?? ["auto", "auto"]}
            />
            <YAxis
              type="number"
              dataKey="ret"
              name={EJE_DE_RENTABILIDAD}
              label={{ value: EJE_DE_RENTABILIDAD, angle: -90, position: "left", offset: 0, style: { ...NOMBRE_DE_EJE, textAnchor: "middle" } }}
              tickFormatter={(value) => pctDecimal(value, 1)}
              axisLine={false}
              tickLine={false}
              tick={OAA_AXIS_STYLE}
              domain={yDomain ?? ["auto", "auto"]}
              width={58}
            />
            <ZAxis type="number" dataKey="z" range={[46, 120]} />
            <Tooltip
              isAnimationActive={false}
              content={({ active, payload }) => {
                const punto = payload?.[0]?.payload as PuntoDibujado | undefined;
                return punto ? (
                  /* Sin la fila «z» ni las cifras repetidas: el nombre arriba y las dos cifras con su nombre entero. */
                  <OaaTooltip
                    active={active}
                    titulo={punto.label}
                    filas={[
                      { clave: "vol", nombre: EJE_DE_VOLATILIDAD, valor: volatilidadDelGrafico(punto.vol), color: punto.color },
                      { clave: "ret", nombre: EJE_DE_RENTABILIDAD, valor: rentabilidadDelGrafico(punto.ret), color: punto.color }
                    ]}
                  />
                ) : null;
              }}
              cursor={{ stroke: OAA_CHART_COLORS.textMuted, strokeDasharray: "3 3" }}
            />
            {benchLine.length > 1 ? (
              <Line
                data={benchLine}
                dataKey="ret"
                stroke={COLOR_DE_LA_REFERENCIA}
                strokeDasharray={TRAZOS_DE_LA_REFERENCIA}
                strokeWidth={OAA_STROKE.context}
                dot={false}
                activeDot={false}
                isAnimationActive={false}
              />
            ) : null}
            {assetData.length ? <Scatter name="Activos" data={assetData} shape={<PuntoDelMapa />} isAnimationActive={false} /> : null}
            {benchData.length ? <Scatter name="Carteras de referencia" data={benchData} shape={<PuntoDelMapa />} isAnimationActive={false} /> : null}
            {markData.map((mark) => (
              <Scatter key={mark.id} name={mark.label} data={[mark]} shape={<PuntoDelMapa />} isAnimationActive={false} />
            ))}
            {portfolioData.length ? <Scatter name={portfolioData[0].label} data={portfolioData} shape={<PuntoDelMapa />} isAnimationActive={false} /> : null}
            <NombresDelMapa puntos={all} />
          </ComposedChart>
        </ResponsiveContainer>
      </OaaChartFrame>
      {showLegend ? <OaaLegend items={legend} /> : null}
    </>
  );
});
