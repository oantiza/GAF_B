import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  DEPOSIT_RATE_MAX_PCT,
  DEPOSIT_RATE_MIN_PCT,
  fetchMacroReference,
  isDepositRatePctValid,
  type BizkaiaTaxBracket,
  type MacroReference,
  type PatrimonialComparison
} from "../adapters/macroReferenceBackend";
import {
  aportacionesValidas,
  cifrasDelModo,
  EJEMPLO_PATRIMONIAL,
  filasAMedias,
  hoyEnHoraLocal,
  huellaDeLosDatos,
  primerDiaDelMes,
  quedaAlgoDelEjemplo,
  resultadoPatrimonial,
  valoresDelModo,
  type AportacionPatrimonial
} from "../core/comparadorPatrimonial";
import { fecha, importe, importeTitular, numero, oFalta, porcentaje, rentabilidad } from "../core/formato";
import { createSessionSlot } from "../core/sessionCaches";
import { textoDeAusencia } from "../core/textoDeAusencia";
import { yearsBetween } from "../core/xirr";
import type { CeldaDeTabla, ColumnaDeTabla } from "../types/tablaDeDatos";
import { AsyncErrorBanner } from "./AsyncErrorBanner";
import { TablaDeDatos } from "./tabla/TablaDeDatos";
import { EmptyState } from "./ui/AsyncState";
import { Aviso } from "./ui/Aviso";
import { notasDeLaReferencia } from "../core/referenciaMacro";
import { Button } from "./ui/Button";
import { Campo } from "./ui/Campo";
import { Cifra } from "./ui/Cifra";
import { EuroAmountInput } from "./ui/EuroAmountInput";
import { KpiStrip } from "./ui/KpiStrip";
import { Panel } from "./ui/Panel";
import { Respuesta, type DatoDeRespuesta } from "./ui/Respuesta";
import "../styles/comparador.css";

interface WealthComparisonResultsProps {
  comparison: PatrimonialComparison;
  netTaxes: boolean;
  depositRateUsedPct?: number | null;
  taxBrackets?: BizkaiaTaxBracket[];
  /** Si lo comparado sale del ejemplo: cada fila lo dice. */
  ejemplo?: boolean;
}

const FALTA = textoDeAusencia("falta");
/* Una TIR es una rentabilidad: dos decimales y siempre con signo. El servidor la da en puntos (6,2 es un 6,20 %). */
const tirEnPuntos = (value: number | null): CeldaDeTabla =>
  typeof value === "number" ? { texto: oFalta(rentabilidad(value / 100)), valor: value } : { texto: FALTA, ausencia: "falta" };
/* En la tabla, el importe con sus dos decimales. */
const euros = (value: number | null): CeldaDeTabla =>
  typeof value === "number" ? { texto: oFalta(importe(value)), valor: value } : { texto: FALTA, ausencia: "falta" };

function taxScaleText(brackets: BizkaiaTaxBracket[]): string {
  return brackets
    .map((bracket) => {
      const rateDigits = Number.isInteger(bracket.rate_pct)
        ? 0
        : Number.isInteger(bracket.rate_pct * 10)
          ? 1
          : 2;
      /* Un tipo de la escala se escribe como lo publica la norma, «19 %» o «25,5 %»: con los decimales que tiene. */
      return `desde ${oFalta(importeTitular(bracket.threshold_eur))}: ${oFalta(porcentaje(bracket.rate_pct / 100, { decimales: rateDigits }))}`;
    })
    .join(" · ");
}

interface FilaDeAlternativa {
  id: string;
  nombre: string;
  value: number | null;
  nominal: number | null;
  real: number | null;
}

export function WealthComparisonResults({
  comparison,
  netTaxes,
  depositRateUsedPct,
  taxBrackets,
  ejemplo = false
}: WealthComparisonResultsProps) {
  const mode = netTaxes ? "neto" : "bruto";
  const tir = netTaxes ? "neta" : "bruta";
  const depositLabel =
    typeof depositRateUsedPct === "number"
      ? `Depósito bancario (${oFalta(porcentaje(depositRateUsedPct / 100))} fijo, renovación anual)`
      : "Depósito bancario (curva histórica anual)";
  const filas: FilaDeAlternativa[] = (
    [
      ["cartera", "Cartera introducida", comparison.cartera],
      ["letras", "Letras del Tesoro", comparison.letras],
      ["deposito", depositLabel, comparison.deposito]
    ] as const
  ).map(([id, nombre, alternative]) => ({ id, nombre, ...valoresDelModo(alternative, netTaxes) }));
  /* Tres filas que se leen en este orden: la cartera y sus dos alternativas. No hay nada que ordenar. */
  const columnas: ColumnaDeTabla<FilaDeAlternativa>[] = [
    {
      id: "alternativa",
      titulo: "Alternativa",
      sinOrden: true,
      celda: (fila) => ({ texto: fila.nombre, apunte: ejemplo ? "Ejemplo" : undefined })
    },
    { id: "valor", titulo: `Valor final ${mode}`, cifra: true, sinOrden: true, celda: (fila) => euros(fila.value) },
    { id: "nominal", titulo: `TIR nominal ${tir}`, cifra: true, sinOrden: true, celda: (fila) => tirEnPuntos(fila.nominal) },
    { id: "real", titulo: `TIR real ${tir}`, cifra: true, sinOrden: true, celda: (fila) => tirEnPuntos(fila.real) }
  ];

  return (
    <div className="wealth-comparison-results" aria-live="polite" data-tax-mode={mode}>
      <TablaDeDatos columnas={columnas} filas={filas} titulo={`Comparativa patrimonial en modo ${mode}`} />
      {taxBrackets?.length ? (
        <p className="cmp-note wealth-tax-scale">
          <strong>Escala progresiva Bizkaia:</strong> {taxScaleText(taxBrackets)}.
        </p>
      ) : null}
    </div>
  );
}

const FILA_VACIA: AportacionPatrimonial = { id: 1, date: "", amount: null };

/**
 * Lo tecleado en esta pestaña sobrevive a ir a otra pantalla, como los demás mandos del Comparador. En
 * memoria, como todo lo que puede ser de un cliente: nunca en el almacenamiento del navegador. Sin el estado
 * de la consulta en curso, que al volver ya no tendría quien la recibiera.
 */
const patrimonialEnSesion = createSessionSlot(() => ({
  flows: [FILA_VACIA],
  finalValue: null as number | null,
  finalDate: hoyEnHoraLocal(),
  ejemploCargado: false,
  depositRate: "",
  netTaxes: false,
  data: null as MacroReference | null,
  huella: ""
}));

export function WealthComparator() {
  /* Abre vacío. Hasta el 04-11-2026 abría con cifras escritas aquí y una TIR de 6,11 % sin rótulo de
     ejemplo: delante del cliente se leían como suyas. */
  const [enSesion] = useState(() => patrimonialEnSesion.read());
  const [flows, setFlows] = useState<AportacionPatrimonial[]>(enSesion.flows);
  const [finalValue, setFinalValue] = useState<number | null>(enSesion.finalValue);
  const [finalDate, setFinalDate] = useState<string>(enSesion.finalDate);
  const [ejemploCargado, setEjemploCargado] = useState(enSesion.ejemploCargado);
  /* `huella`: de qué datos es lo que ha devuelto el servidor. Solo se pinta mientras sigan siendo esos. */
  const [macro, setMacro] = useState<{ loading: boolean; data: MacroReference | null; error: unknown | null; huella: string }>({
    loading: false,
    data: enSesion.data,
    error: null,
    huella: enSesion.huella
  });
  const [depositRate, setDepositRate] = useState<string>(enSesion.depositRate);
  const [netTaxes, setNetTaxes] = useState<boolean>(enSesion.netTaxes);
  useEffect(() => {
    patrimonialEnSesion.write({ flows, finalValue, finalDate, ejemploCargado, depositRate, netTaxes, data: macro.data, huella: macro.huella });
  }, [flows, finalValue, finalDate, ejemploCargado, depositRate, netTaxes, macro.data, macro.huella]);
  const parsedDepositRate = depositRate.trim() === "" ? null : Number(depositRate);
  const depositRateIsValid = parsedDepositRate === null || isDepositRatePctValid(parsedDepositRate);

  const addFlow = () =>
    setFlows((previous) => [...previous, { id: (previous.at(-1)?.id ?? 0) + 1, date: "", amount: null }]);
  const removeFlow = (id: number) => setFlows((previous) => previous.filter((flow) => flow.id !== id));
  const updateFlow = (id: number, patch: Partial<AportacionPatrimonial>) =>
    setFlows((previous) => previous.map((flow) => (flow.id === id ? { ...flow, ...patch } : flow)));

  const result = useMemo(() => resultadoPatrimonial(flows, finalValue, finalDate), [flows, finalValue, finalDate]);
  const hayDatos = result.start !== "";
  const formularioVacio = finalValue === null && flows.every((flow) => !flow.date && flow.amount === null);
  const esEjemplo = ejemploCargado && quedaAlgoDelEjemplo(flows, finalValue, finalDate);
  const aMedias = filasAMedias(flows);

  /* Un ejemplo no se suma a lo que ya hubiera: cargar y quitar empiezan de cero, consulta incluida. */
  const empezarDeCero = (ejemplo: boolean) => {
    setFlows(ejemplo ? EJEMPLO_PATRIMONIAL.flows.map((flow) => ({ ...flow })) : [FILA_VACIA]);
    setFinalValue(ejemplo ? EJEMPLO_PATRIMONIAL.finalValue : null);
    setFinalDate(ejemplo ? EJEMPLO_PATRIMONIAL.finalDate : hoyEnHoraLocal());
    setEjemploCargado(ejemplo);
    setMacro({ loading: false, data: null, error: null, huella: "" });
  };

  const huellaActual = huellaDeLosDatos(flows, finalValue, finalDate, parsedDepositRate);

  const loadMacro = () => {
    if (!result.start || !result.end || !depositRateIsValid || finalValue === null) return;
    const huella = huellaActual;
    setMacro((actual) => ({ ...actual, loading: true, error: null }));
    /* Desde el día 1 del mes: el IPC es mensual, y pedido desde el día de la aportación no llega el de ese mes. */
    fetchMacroReference(primerDiaDelMes(result.start), result.end, {
      flows: aportacionesValidas(flows),
      finalValue,
      depositRatePct: parsedDepositRate ?? undefined
    })
      .then((data) => setMacro({ loading: false, data, error: null, huella }))
      .catch((error: unknown) => setMacro((actual) => ({ ...actual, loading: false, error })));
  };

  /* Cualquier cambio en los datos retira lo que dijo el servidor: una TIR de los datos de antes junto a un
     valor final nuevo es una cifra falsa. La TIR de «Magnitudes clave» vuelve a la local. */
  const vigente = macro.data && macro.huella === huellaActual ? macro.data : null;
  const caducado = macro.data !== null && vigente === null;
  const inflation = vigente?.inflation_annual_pct;
  const letrasRate = vigente?.letras_avg_rate_pct;
  const comparison = vigente?.comparison ?? null;

  const approximateLetrasValue = useMemo(() => {
    if (typeof letrasRate !== "number") return null;
    return aportacionesValidas(flows).reduce(
      (sum, flow) =>
        sum + flow.amount * Math.pow(1 + letrasRate / 100, yearsBetween(new Date(flow.date), new Date(finalDate))),
      0
    );
  }, [letrasRate, flows, finalDate]);
  const delModo = cifrasDelModo({
    comparison,
    neto: netTaxes,
    finalValue,
    tirLocal: result.tir,
    inflacionAnualPct: inflation,
    anos: result.years,
    letrasAproximado: approximateLetrasValue
  });
  const tirDelModo = delModo.modo === "neto" ? "neta" : delModo.modo === "bruto" ? "bruta" : "";
  const valorDelModo = delModo.modo ?? "";

  /* Mientras quede un dato del ejemplo, cada cifra que sale de él lo dice. */
  const rotulo: ReactNode = esEjemplo ? <span className="wealth-ejemplo">Ejemplo</span> : null;

  /* La TIR de la cartera frente a la de cada alternativa, en puntos: de la tabla del servidor, en el modo elegido. */
  const tirDe = (alternativa: "cartera" | "letras" | "deposito") => {
    const nominal = comparison ? valoresDelModo(comparison[alternativa], netTaxes).nominal : null;
    return typeof nominal === "number" ? nominal / 100 : null;
  };
  const frenteA = (alternativa: "letras" | "deposito") => {
    const suya = tirDe(alternativa);
    const nuestra = tirDe("cartera");
    return suya !== null && nuestra !== null ? nuestra - suya : null;
  };
  const datosDeLaRespuesta: DatoDeRespuesta[] = [
    {
      rotulo: `TIR nominal ${tirDelModo}`.trim(),
      cifra: <Cifra tipo="rentabilidad" valor={delModo.tirNominal} />,
      apunte: rotulo ?? "Tasa interna de rentabilidad, anual",
      principal: true
    },
    ...(comparison
      ? [
          {
            rotulo: "Frente a Letras del Tesoro",
            cifra: <Cifra tipo="puntos" valor={frenteA("letras")} />,
            apunte: rotulo ?? `Letras, ${oFalta(rentabilidad(tirDe("letras")))}`
          },
          {
            rotulo: "Frente al depósito",
            cifra: <Cifra tipo="puntos" valor={frenteA("deposito")} />,
            apunte: rotulo ?? `Depósito, ${oFalta(rentabilidad(tirDe("deposito")))}`
          }
        ]
      : []),
    { rotulo: "Capital aportado", cifra: <Cifra tipo="importeTitular" valor={result.capital} />, apunte: rotulo },
    { rotulo: `Valor final ${valorDelModo}`.trim(), cifra: <Cifra tipo="importeTitular" valor={delModo.valorFinal} />, apunte: rotulo },
    {
      rotulo: "Horizonte",
      cifra: result.years > 0 ? `${oFalta(numero(result.years, { decimales: 1 }))} años` : <Cifra tipo="numero" valor={null} />,
      apunte: rotulo
    }
  ];

  return (
    <div className="wealth">
      {/* Primero la respuesta: la TIR de la cartera y, calculadas las alternativas, cuánto se separa de cada una. */}
      {hayDatos ? (
        <Respuesta datos={datosDeLaRespuesta} etiqueta="La TIR de la cartera frente a las alternativas" />
      ) : result.posterior ? (
        <Aviso anunciar titulo="Fechas que no cuadran.">
          La aportación del {oFalta(fecha(result.posterior))} es posterior a la fecha final ({oFalta(fecha(finalDate))}). Con esas
          fechas no hay TIR ni comparación: corrige una de las dos.
        </Aviso>
      ) : (
        <EmptyState
          description="Con ellos se calcula la TIR (tasa interna de rentabilidad) de la cartera y se puede comparar con Letras del Tesoro y un depósito."
          title="Introduce tus aportaciones y el valor final"
        />
      )}

      <div className="wealth-grid">
        <div className="wealth-flows">
          <Panel
            acciones={
              formularioVacio ? (
                <Button onClick={() => empezarDeCero(true)} size="sm" variant="quiet">
                  Cargar ejemplo
                </Button>
              ) : esEjemplo ? (
                <Button onClick={() => empezarDeCero(false)} size="sm" variant="quiet">
                  Quitar ejemplo
                </Button>
              ) : null
            }
            claseDelCuerpo="stack stack--tight"
            titulo="Aportaciones"
          >
            {esEjemplo ? <Aviso titulo="Ejemplo.">Cifras inventadas para enseñar la pantalla: no son de ningún cliente.</Aviso> : null}
            <table className="cmp-table wealth-aportaciones" aria-label="Aportaciones">
              <thead>
                <tr>
                  <th scope="col" className="cmp-th-left">Fecha</th>
                  <th scope="col" className="cmp-num">Importe {rotulo}</th>
                  <th scope="col"><span className="ui-visually-hidden">Quitar</span></th>
                </tr>
              </thead>
              <tbody>
                {flows.map((flow, indice) => (
                  <tr key={flow.id}>
                    <td>
                      <input
                        aria-label={`Fecha de la aportación ${indice + 1}`}
                        type="date"
                        value={flow.date}
                        onChange={(event) => updateFlow(flow.id, { date: event.target.value })}
                      />
                    </td>
                    <td>
                      {/* U-12: importe con parser europeo («20.000» son veinte mil), no type=number. */}
                      <EuroAmountInput
                        ariaLabel={`Importe de la aportación ${indice + 1}`}
                        min={0}
                        onCommit={(amount) => updateFlow(flow.id, { amount: Math.max(0, amount) })}
                        value={flow.amount}
                      />
                    </td>
                    <td>
                      <Button variant="quiet" size="sm" iconOnly onClick={() => removeFlow(flow.id)} aria-label={`Quitar la aportación ${indice + 1}`} title="Quitar aportación">
                        ×
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div>
              <Button size="sm" onClick={addFlow}>+ Añadir aportación</Button>
            </div>
            {aMedias > 0 ? (
              <p className="cmp-note">
                {aMedias === 1
                  ? "Una fila sin fecha o sin importe no cuenta en el cálculo."
                  : `${aMedias} filas sin fecha o sin importe no cuentan en el cálculo.`}
              </p>
            ) : null}
            <div className="wealth-final">
              <Campo rotulo={<>Valor final (€) {rotulo}</>}>
                <EuroAmountInput min={0} onCommit={(amount) => setFinalValue(Math.max(0, amount))} value={finalValue} />
              </Campo>
              <Campo rotulo={<>Fecha final {rotulo}</>}>
                <input type="date" value={finalDate} onChange={(event) => setFinalDate(event.target.value)} />
              </Campo>
            </div>
          </Panel>
        </div>

        <div className="wealth-out stack stack--bloques">
          <Panel
            acciones={
              <Button
                variant="primary"
                busy={macro.loading}
                onClick={loadMacro}
                disabled={!hayDatos || !depositRateIsValid}
              >
                {macro.loading ? "Calculando…" : "Calcular inflación, Letras y depósito"}
              </Button>
            }
            titulo="Patrimonio real y alternativas"
          >
            {macro.error ? (
              <AsyncErrorBanner error={macro.error} onRetry={loadMacro} />
            ) : vigente ? (
              <KpiStrip
                /* Tres de las seis cifras son importes: con un patrimonio de siete cifras no cabían a 1.920. Con ocho, o
                   con siete y signo —la ventaja lo lleva—, siguen sin caber: lo dice la regla, en `components.css`. */
                importes
                items={[
                  { label: "Inflación anual (IPC)", value: <Cifra tipo="porcentaje" valor={typeof inflation === "number" ? inflation / 100 : null} />, note: rotulo },
                  { label: valorDelModo ? `Valor real ${valorDelModo} (€ de inicio)` : "Valor real (€ de inicio)", value: <Cifra tipo="importeTitular" valor={delModo.valorReal} />, note: rotulo },
                  { label: `TIR real ${tirDelModo}`.trim(), value: <Cifra tipo="rentabilidad" valor={delModo.tirReal} />, note: rotulo },
                  { label: "Tipo de las Letras (medio)", value: <Cifra tipo="porcentaje" valor={typeof letrasRate === "number" ? letrasRate / 100 : null} />, note: rotulo },
                  { label: `En Letras del Tesoro ${valorDelModo}`.trim(), value: <Cifra tipo="importeTitular" valor={delModo.enLetras} />, note: rotulo },
                  /* Es un resultado en euros: dice si se gana o se pierde frente a Letras, y lleva su signo y su color. */
                  { label: `Ventaja frente a Letras ${tirDelModo}`.trim(), value: <Cifra tipo="importeTitular" valor={delModo.ventaja} conSigno colorDeSigno />, note: rotulo }
                ]}
              />
            ) : (
              <p className="cmp-note">
                {!hayDatos
                  ? "Con las aportaciones y el valor final, «Calcular inflación, Letras y depósito» obtiene el IPC, las Letras y la simulación fiscal de las tres alternativas."
                  : caducado
                    ? "Los datos han cambiado desde el último cálculo. Pulsa «Calcular inflación, Letras y depósito» para obtener las cifras de estos datos."
                    : "Pulsa «Calcular inflación, Letras y depósito» para obtener el IPC, las Letras y la simulación fiscal de las tres alternativas."}
              </p>
            )}
          </Panel>

          <Panel claseDelCuerpo="stack stack--tight" titulo="Cartera, Letras y depósito">
            <div className="wealth-comparison-controls">
              <Campo
                error={depositRateIsValid ? undefined : `Introduce un tipo entre ${oFalta(porcentaje(DEPOSIT_RATE_MIN_PCT / 100, { decimales: 0 }))} y ${oFalta(porcentaje(DEPOSIT_RATE_MAX_PCT / 100, { decimales: 0 }))}.`}
                pista="Vacío: curva histórica por año. El tipo fijo se renueva anualmente."
                rotulo="Tipo del depósito (% anual)"
              >
                <input
                  className="wealth-tipo"
                  type="number"
                  inputMode="decimal"
                  lang="es"
                  step={0.05}
                  min={DEPOSIT_RATE_MIN_PCT}
                  max={DEPOSIT_RATE_MAX_PCT}
                  value={depositRate}
                  placeholder="Curva histórica"
                  onChange={(event) => setDepositRate(event.target.value)}
                />
              </Campo>
              <fieldset className="comparador-casillas">
                <legend className="field__label">Fiscalidad</legend>
                <label className="wealth-tax-check">
                  <input
                    type="checkbox"
                    checked={netTaxes}
                    onChange={(event) => setNetTaxes(event.target.checked)}
                  />
                  <span>Neto de impuestos (Bizkaia)</span>
                </label>
              </fieldset>
            </div>
            <p className="cmp-note wealth-tax-mechanics">
              La cartera difiere impuestos hasta el reembolso (liquidación simulada al final del horizonte); depósitos y Letras tributan al devengo
              <span>. En la simulación, el depósito liquida cada año y las Letras una sola vez al vencimiento final.</span>
            </p>
            {comparison ? (
              <WealthComparisonResults
                comparison={comparison}
                netTaxes={netTaxes}
                depositRateUsedPct={vigente?.deposit_rate_used_pct}
                taxBrackets={vigente?.bizkaia_tax_brackets}
                ejemplo={esEjemplo}
              />
            ) : (
              <p className="cmp-note">
                La tabla bruta y neta se calcula al pulsar «Calcular inflación, Letras y depósito».
              </p>
            )}
            {vigente ? notasDeLaReferencia(vigente).map((texto) => <p className="cmp-note" key={texto}>{texto}</p>) : null}
            {vigente?.notes ? <p className="cmp-note">{vigente.notes}</p> : null}
          </Panel>
        </div>
      </div>

      <Aviso tono="nota" titulo="Informativo.">
        Cálculo orientativo con datos públicos del INE y del Banco de España. La escala fiscal se aplica solo a la
        simulación y no incorpora otras rentas del ahorro. No constituye asesoramiento personalizado ni fiscal.
      </Aviso>
    </div>
  );
}
