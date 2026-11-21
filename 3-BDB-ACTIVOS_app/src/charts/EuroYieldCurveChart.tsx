import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { TooltipContentProps } from "recharts";
import type { EcbYieldCurveResult } from "../adapters/ecbYieldCurveBackend";
import { fecha, oFalta } from "../core/formato";
import { AsyncErrorBanner } from "../components/AsyncErrorBanner";
import { Aviso } from "../components/ui/Aviso";
import { Button } from "../components/ui/Button";
import { ejeVertical, propiedadesDelEje } from "./oaa/ejeVertical";
import { OaaChartFrame } from "./oaa/OaaChartFrame";
import { OaaTooltip } from "./oaa/OaaTooltip";
import { FALTA_EL_DATO, pctPoint } from "./oaa/chartFormatters";
import { estilosPorPapel, OAA_AXIS_STYLE, OAA_CHART_COLORS } from "./oaa/chartTheme";
import { Panel } from "../components/ui/Panel";

/* Por papel (chartTheme.ts): la curva protagonista, los bonos AAA, es la «cartera» del gráfico, marino y continua; la de
   todos los bonos de gobierno, la primera serie, azul. Ninguna es la referencia: no se compara la una con la otra. La
   segunda va a trazos (14-11-2026) para que las dos se distingan también sin color; su marca de leyenda, igual. */
const [ESTILO_AAA, ESTILO_TODOS] = estilosPorPapel([{ papel: "cartera" }, { papel: "serie" }]);
const TRAZOS_DE_TODOS = "7 5";
const NOMBRE_AAA = "Bonos AAA";
const NOMBRE_TODOS = "Todos los bonos de gobierno";
const NOMBRE_DEL_GRAFICO = "Curva spot del euro por vencimiento residual";
const X_TICKS = [0.25, 1, 5, 10, 15, 20, 25, 30];

function maturityLabel(years: number): string {
  if (years < 1) return `${Math.round(years * 12)} meses`;
  return `${years} ${years === 1 ? "año" : "años"}`;
}

/** Un tipo en puntos (2,5 es un 2,5 %), con dos decimales en la nota y la tabla. */
const tipo = (valor: unknown) => pctPoint(valor, 2);

function CurveTooltip({ active, payload, label }: Partial<TooltipContentProps<number, string>>) {
  if (typeof label !== "number") return null;
  return (
    <OaaTooltip
      active={active}
      titulo={`Plazo: ${maturityLabel(label)}`}
      filas={(payload ?? []).map((entry) => ({
        clave: String(entry.dataKey),
        nombre: entry.name,
        valor: typeof entry.value === "number" ? tipo(entry.value) : FALTA_EL_DATO,
        color: entry.color,
        /* La marca de la nota, con el trazo de su curva. */
        discontinua: entry.dataKey === "all_bonds"
      }))}
    />
  );
}

function CurveLines({ result }: { result: EcbYieldCurveResult }) {
  const rows = new Map<number, { maturity_years: number; aaa?: number; all_bonds?: number }>();
  result.aaa.forEach((point) => rows.set(point.maturity_years, { ...rows.get(point.maturity_years), maturity_years: point.maturity_years, aaa: point.yield_pct }));
  result.all_bonds.forEach((point) => rows.set(point.maturity_years, { ...rows.get(point.maturity_years), maturity_years: point.maturity_years, all_bonds: point.yield_pct }));
  const data = Array.from(rows.values()).sort((left, right) => left.maturity_years - right.maturity_years);
  const eje = ejeVertical(data.flatMap((fila) => [fila.aaa, fila.all_bonds]));
  const alternativa = {
    titulo: NOMBRE_DEL_GRAFICO,
    columnas: ["Plazo", NOMBRE_AAA, NOMBRE_TODOS],
    filas: data.map((fila) => ({
      clave: String(fila.maturity_years),
      rotulo: maturityLabel(fila.maturity_years),
      celdas: [typeof fila.aaa === "number" ? tipo(fila.aaa) : FALTA_EL_DATO, typeof fila.all_bonds === "number" ? tipo(fila.all_bonds) : FALTA_EL_DATO]
    }))
  };
  return (
    <>
      <OaaChartFrame height={330} empty={data.length === 0} emptyText="Curva BCE sin observaciones disponibles." alternativa={alternativa}>
        <ResponsiveContainer width="100%" height="100%" minWidth={1} minHeight={1}>
          <LineChart data={data} margin={{ top: 16, right: 24, left: 4, bottom: 10 }} accessibilityLayer role="img" aria-label={NOMBRE_DEL_GRAFICO}>
            <CartesianGrid stroke={OAA_CHART_COLORS.grid} strokeDasharray="0" vertical={false} />
            <XAxis
              dataKey="maturity_years"
              type="number"
              domain={[0.25, 30]}
              ticks={X_TICKS}
              tickFormatter={maturityLabel}
              minTickGap={8}
              axisLine={{ stroke: OAA_CHART_COLORS.axis }}
              tickLine={false}
              tick={OAA_AXIS_STYLE}
            />
            <YAxis
              width={52}
              /* Un decimal como poco; dos si las marcas van de 0,25 en 0,25, para que la marca diga lo que marca. */
              tickFormatter={(value) => pctPoint(value, Math.max(1, eje?.decimales ?? 1))}
              axisLine={false}
              tickLine={false}
              tick={OAA_AXIS_STYLE}
              {...propiedadesDelEje(eje)}
            />
            <ReferenceLine y={0} stroke={OAA_CHART_COLORS.textMuted} strokeWidth={0.9} />
            <Tooltip isAnimationActive={false} content={<CurveTooltip />} cursor={{ stroke: "var(--filete)", strokeDasharray: "3 3" }} />
            {result.aaa.length ? <Line type="monotone" dataKey="aaa" name={NOMBRE_AAA} stroke={ESTILO_AAA.color} strokeWidth={ESTILO_AAA.grosor} dot={false} activeDot={{ r: 4 }} connectNulls={false} isAnimationActive={false} /> : null}
            {result.all_bonds.length ? <Line type="monotone" dataKey="all_bonds" name={NOMBRE_TODOS} stroke={ESTILO_TODOS.color} strokeWidth={ESTILO_TODOS.grosor} strokeDasharray={TRAZOS_DE_TODOS} dot={false} activeDot={{ r: 4 }} connectNulls={false} isAnimationActive={false} /> : null}
          </LineChart>
        </ResponsiveContainer>
      </OaaChartFrame>
      {/* Su propia leyenda, con las reglas de `.euro-yield-legend` en modules.css (no es de este paso): pasa a
          OaaLegend cuando se rehaga la pantalla de Mercado y se borren esas reglas. */}
      <ul className="euro-yield-legend" aria-label="Leyenda de la curva de tipos">
        {result.aaa.length ? <li><i style={{ borderColor: ESTILO_AAA.color }} /><span>{NOMBRE_AAA}</span></li> : null}
        {result.all_bonds.length ? <li><i className="is-dashed" style={{ borderColor: ESTILO_TODOS.color }} /><span>{NOMBRE_TODOS}</span></li> : null}
      </ul>
    </>
  );
}

/* DIR-09: la nota llega del servidor como «AAA: omitida por fecha antigua 2026-11-11 | todos los
   bonos: …». En pantalla, cada parte es una frase que empieza en mayúscula y la fecha va con el
   formato común (11/11/2026). El servidor no se toca: esto es solo cómo se enseña. El mensaje en inglés del tiempo
   agotado, que el servidor pasa tal cual, se dice en español. */
const TIEMPO_AGOTADO = /the read operation timed out\.?/gi;
function notaEnPantalla(notas: string): string {
  return notas
    .split(" | ")
    .map((parte) => parte.trim())
    .filter(Boolean)
    .map((parte) => {
      const conFecha = parte
        .replace(/\b\d{4}-\d{2}-\d{2}\b/g, (iso) => fecha(iso) ?? iso)
        .replace(TIEMPO_AGOTADO, "el BCE no respondió a tiempo");
      const frase = conFecha.charAt(0).toLocaleUpperCase("es") + conFecha.slice(1);
      return /[.!?]$/.test(frase) ? frase : `${frase}.`;
    })
    .join(" ");
}

export function EuroYieldCurvePanel({ result, loading, error, onRetry }: {
  result: EcbYieldCurveResult | null;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  /* Sin un solo punto no hay curva parcial, sino ninguna: un solo mensaje con «Reintentar», en vez de la etiqueta de
     parcial y el gráfico vacío. La nota del servidor va dentro del mismo aviso, bajo su título, porque dice el motivo:
     no es lo mismo que el BCE no respondiera que una curva omitida por vieja. */
  const sinCurva = !!result && !result.aaa.length && !result.all_bonds.length;
  const isPartial = !!result && !sinCurva && (result.aaa.length < 18 || result.all_bonds.length < 18);
  const partialText = result
    ? `Curva parcial: AAA ${result.aaa.length}/18 · todos los bonos ${result.all_bonds.length}/18. Los puntos ausentes no se estiman.`
    : "";
  return (
    <Panel
      claseDelCuerpo="stack stack--tight"
      className="macro-chart-panel euro-yield-panel"
      estado={isPartial ? <span className="macro-source-status is-partial">Curva parcial</span> : null}
      subtitulo={`Banco Central Europeo${result?.as_of_date ? ` · dato a ${oFalta(fecha(result.as_of_date))}` : ""} · tipo spot Svensson por vencimiento residual, de 3 meses a 30 años.`}
      titulo="Curva de tipos del euro"
      tituloId="euro-yield-title"
    >
      {error ? <AsyncErrorBanner error={error} onRetry={onRetry} /> : null}
      {loading ? <div className="euro-yield-loading" role="status">Consultando la curva de tipos del BCE…</div> : null}
      {!loading && sinCurva ? (
        <Aviso accion={<Button onClick={onRetry} size="sm">Reintentar</Button>} tono="error" titulo="No hemos podido leer la curva del BCE.">
          {result?.notes ? <p>{notaEnPantalla(result.notes)}</p> : null}
        </Aviso>
      ) : null}
      {!loading && result && !sinCurva ? <CurveLines result={result} /> : null}
      {!loading && result && isPartial ? <p className="euro-yield-partial" role="note">{partialText}{result.notes ? ` ${notaEnPantalla(result.notes)}` : ""}</p> : null}
    </Panel>
  );
}
