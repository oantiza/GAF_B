import { memo } from "react";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { estilosPorPapel, OAA_AXIS_STYLE, OAA_CHART_COLORS, OaaChartFrame, OaaLegend, OaaTooltip, type OaaLegendItem } from "../../charts/oaa";
import * as formato from "../../core/formato";
import { cortesDelEje, type PuntoDeIngresos, type PuntoDeSaldos } from "../../core/jubilacion/lectura";
import type { ClaveDeEscenario } from "../../core/jubilacion/motor";
import { marcasDeEdad } from "./marcasDeEdad";

/**
 * Los dos gráficos de Jubilación. Los dos son series en el tiempo, que es lo que la dirección de pantalla deja
 * dibujar: el ingreso de cada año y el patrimonio que queda. La cascada del bruto al neto y la barra de
 * composición del simulador de origen no están: repetían cifras que ya se leen en su tabla.
 *
 * El color no opina y sale del papel de cada serie (`estilosPorPapel`, apartado 7 de `SISTEMA_DISENO.md`): la
 * pensión es la serie principal, en marino; los ahorros y la previsión, las series que le siguen; el IRPF va en el
 * gris de la referencia —es la parte del bruto que no llega—, no en rojo. Ningún escenario va en verde: una
 * rentabilidad más alta no es «la buena», es otra hipótesis.
 */
const [PENSION, AHORROS, PREVISION, IRPF] = estilosPorPapel([{ papel: "cartera" }, { papel: "serie" }, { papel: "serie" }, { papel: "referencia" }]);
const COLOR_DE_INGRESO = { pension: PENSION.color, ahorros: AHORROS.color, prevision: PREVISION.color, irpf: IRPF.color } as const;

/* Cada escenario, con su color por su papel y su trazo: las líneas no se distinguen solo por el color. La hipótesis es
   la serie principal; los otros tres, series en orden, cada uno con su trazo. */
const [BASE, CONSERVADOR, OPTIMISTA, ESTRES] = estilosPorPapel([{ papel: "cartera" }, { papel: "serie" }, { papel: "serie" }, { papel: "serie" }]);
const TRAZO_DE_ESCENARIO: Record<ClaveDeEscenario, { color: string; ancho: number; trazo?: string }> = {
  base: { color: BASE.color, ancho: BASE.grosor },
  conservador: { color: CONSERVADOR.color, ancho: CONSERVADOR.grosor, trazo: "6 4" },
  optimista: { color: OPTIMISTA.color, ancho: OPTIMISTA.grosor, trazo: "2 3" },
  estres: { color: ESTRES.color, ancho: ESTRES.grosor, trazo: "9 3 2 3" }
};

/** El importe entero, el mismo en los dos ejes y en las notas (PLA-19, FMT-18): «2.000 €», «200.000 €». */
const euros = (valor: unknown): string => (typeof valor === "number" ? (formato.importeTitular(valor) ?? "") : "");

const aLaEdad = (edad: unknown): string => `A los ${String(edad)} años`;

export const GraficoDeIngresos = memo(function GraficoDeIngresos({
  serie,
  figura,
  edadAgotado,
  alto = 300
}: {
  serie: PuntoDeIngresos[];
  /** «EPSV» o «Plan», para la leyenda. */
  figura: string;
  /** La edad a la que se agotan los ahorros, si se agotan antes del final. */
  edadAgotado: number | null;
  alto?: number;
}) {
  /* Cortes redondos —0, 1.000, 2.000…—, los mismos que lleva el informe: los que elige la librería salían de 850 en 850. */
  const cortes = cortesDelEje(Math.max(1, ...serie.map((punto) => punto.bruto)));
  const hayAhorros = serie.some((punto) => punto.ahorros > 0.5);
  const hayPrevision = serie.some((punto) => punto.prevision > 0.5);
  const leyenda: OaaLegendItem[] = [
    { id: "pension", label: "Pensión neta", color: COLOR_DE_INGRESO.pension },
    ...(hayAhorros ? [{ id: "ahorros", label: "Ahorros netos", color: COLOR_DE_INGRESO.ahorros }] : []),
    ...(hayPrevision ? [{ id: "prevision", label: `${figura}, neto`, color: COLOR_DE_INGRESO.prevision }] : []),
    { id: "irpf", label: "IRPF", color: COLOR_DE_INGRESO.irpf }
  ];
  return (
    <>
      <OaaChartFrame empty={serie.length === 0} emptyText="Sin años que proyectar." height={alto}>
        <ResponsiveContainer height="100%" minHeight={1} minWidth={1} width="100%">
          <BarChart
            accessibilityLayer
            aria-label={`Ingreso mensual de cada año, de los ${serie[0]?.edad} a los ${serie.at(-1)?.edad} años: lo que queda de cada fuente y el IRPF`}
            barCategoryGap="12%"
            data={serie}
            margin={{ top: 12, right: 8, left: 0, bottom: 4 }}
          >
            <CartesianGrid stroke={OAA_CHART_COLORS.grid} strokeDasharray="0" vertical={false} />
            <XAxis axisLine={{ stroke: OAA_CHART_COLORS.axis }} dataKey="edad" interval={0} tick={OAA_AXIS_STYLE} tickLine={false} ticks={marcasDeEdad(serie.map((punto) => punto.edad))} />
            <YAxis axisLine={false} domain={[0, cortes[cortes.length - 1]]} tick={OAA_AXIS_STYLE} tickFormatter={euros} tickLine={false} ticks={cortes} width={84} />
            <Tooltip content={<OaaTooltip labelFormatter={aLaEdad} valueFormatter={euros} />} cursor={{ fill: OAA_CHART_COLORS.chartCursorFill }} />
            <Bar dataKey="pension" fill={COLOR_DE_INGRESO.pension} isAnimationActive={false} name="Pensión neta" stackId="ingreso" />
            {hayAhorros ? <Bar dataKey="ahorros" fill={COLOR_DE_INGRESO.ahorros} isAnimationActive={false} name="Ahorros netos" stackId="ingreso" /> : null}
            {hayPrevision ? <Bar dataKey="prevision" fill={COLOR_DE_INGRESO.prevision} isAnimationActive={false} name={`${figura}, neto`} stackId="ingreso" /> : null}
            <Bar dataKey="irpf" fill={COLOR_DE_INGRESO.irpf} isAnimationActive={false} name="IRPF" stackId="ingreso" />
            {edadAgotado !== null ? (
              <ReferenceLine
                label={{ value: "Ahorros agotados", position: "insideTopRight", fill: OAA_CHART_COLORS.text, fontSize: OAA_AXIS_STYLE.fontSize }}
                stroke={OAA_CHART_COLORS.zero}
                strokeDasharray="4 4"
                x={edadAgotado}
              />
            ) : null}
          </BarChart>
        </ResponsiveContainer>
      </OaaChartFrame>
      <OaaLegend items={leyenda} />
    </>
  );
});

export const GraficoDeSaldos = memo(function GraficoDeSaldos({
  serie,
  escenarios,
  alto = 300
}: {
  serie: PuntoDeSaldos[];
  /** Los escenarios que hay, en su orden, con su nombre. */
  escenarios: ReadonlyArray<{ clave: ClaveDeEscenario; nombre: string }>;
  alto?: number;
}) {
  const cortes = cortesDelEje(Math.max(1, ...serie.flatMap((punto) => escenarios.map(({ clave }) => punto[clave] ?? 0))));
  const leyenda: OaaLegendItem[] = escenarios.map(({ clave, nombre }) => ({
    id: clave,
    label: nombre,
    color: TRAZO_DE_ESCENARIO[clave].color,
    variant: TRAZO_DE_ESCENARIO[clave].trazo ? "dash" : "line"
  }));
  return (
    <>
      <OaaChartFrame empty={serie.length === 0} emptyText="Sin años que proyectar." height={alto}>
        <ResponsiveContainer height="100%" minHeight={1} minWidth={1} width="100%">
          <LineChart
            accessibilityLayer
            aria-label={`Patrimonio que queda cada año, de los ${serie[0]?.edad} a los ${serie.at(-1)?.edad} años, según la rentabilidad`}
            data={serie}
            margin={{ top: 12, right: 12, left: 0, bottom: 4 }}
          >
            <CartesianGrid stroke={OAA_CHART_COLORS.grid} strokeDasharray="0" vertical={false} />
            <XAxis axisLine={{ stroke: OAA_CHART_COLORS.axis }} dataKey="edad" interval={0} tick={OAA_AXIS_STYLE} tickLine={false} ticks={marcasDeEdad(serie.map((punto) => punto.edad))} />
            <YAxis axisLine={false} domain={[0, cortes[cortes.length - 1]]} tick={OAA_AXIS_STYLE} tickFormatter={euros} tickLine={false} ticks={cortes} width={84} />
            <Tooltip content={<OaaTooltip labelFormatter={aLaEdad} valueFormatter={euros} />} cursor={{ stroke: OAA_CHART_COLORS.crosshair, strokeWidth: 1 }} />
            {escenarios.map(({ clave, nombre }) => {
              const trazo = TRAZO_DE_ESCENARIO[clave];
              return (
                <Line
                  dataKey={clave}
                  dot={false}
                  isAnimationActive={false}
                  key={clave}
                  name={nombre}
                  stroke={trazo.color}
                  strokeDasharray={trazo.trazo}
                  strokeLinecap="round"
                  strokeWidth={trazo.ancho}
                  type="linear"
                />
              );
            })}
          </LineChart>
        </ResponsiveContainer>
      </OaaChartFrame>
      <OaaLegend items={leyenda} />
    </>
  );
});
