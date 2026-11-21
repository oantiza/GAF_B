import { useId, useState } from "react";
import type { BdbManualPortfolioPosition } from "../types/bdbAssets";
import type { PortfolioAmountUpdate } from "../core/portfolioAmounts";
import { Button } from "./ui/Button";
import { EuroAmountInput } from "./ui/EuroAmountInput";
import { importe, importeTitular, oFalta } from "../core/formato";
import { Aviso } from "./ui/Aviso";
import { Campo } from "./ui/Campo";
import { Panel } from "./ui/Panel";

interface CapitalContributionPanelProps {
  positions: BdbManualPortfolioPosition[];
  totalCapital: number;
  /** Candados del Constructor: esas posiciones conservan su peso con cualquier estrategia. */
  locks?: Record<string, boolean>;
  /**
   * Aplica la aportación de una vez: pesos, importes fijos y capital nuevos.
   * Antes eran dos pasos (pesos y luego capital) y el segundo devolvía las
   * posiciones de importe fijo a su importe anterior: se perdían euros.
   * Devuelve `false` si al final no se ha aplicado: el capital sin fijar pide confirmación antes.
   */
  onApply: (update: PortfolioAmountUpdate) => void | boolean | Promise<boolean>;
  /** El capital es de ejemplo: lo dice, y aportar sobre él se confirma antes (hallazgo 48). */
  capitalSinFijar?: boolean;
  /** Dentro del diálogo «Añadir dinero» de Diseño: sin el bloque, que el diálogo ya tiene su título. */
  enDialogo?: boolean;
}

type Strategy = "proportional" | "equal" | "toward_equal";

const roundCents = (v: number) => Math.round(v * 100) / 100;

const STRATEGIES: { id: Strategy; label: string; help: string }[] = [
  { id: "proportional", label: "Proporcional", help: "Reparte la aportación según los pesos actuales. Si la cartera suma el 100 %, tu asignación (%) no cambia: solo sube el capital." },
  { id: "equal", label: "Igual entre posiciones", help: "Reparte la aportación a partes iguales entre las posiciones sin candado (también las que están a 0 %)." },
  { id: "toward_equal", label: "Hacia equipeso", help: "Da más a las posiciones sin candado con menos peso, acercando la cartera a un reparto equilibrado." }
];

export function CapitalContributionPanel({ positions, totalCapital, locks = {}, onApply, capitalSinFijar = false, enDialogo = false }: CapitalContributionPanelProps) {
  const strategyGroup = useId();
  const [amount, setAmount] = useState<number>(10000);
  const [strategy, setStrategy] = useState<Strategy>("proportional");
  const [applied, setApplied] = useState<string | null>(null);

  if (positions.length === 0) {
    return null;
  }

  const canApply = totalCapital > 0 && amount > 0;
  const newCapital = totalCapital + Math.max(0, amount);

  async function apply() {
    if (!canApply) {
      return;
    }
    const C = totalCapital;
    const A = Math.max(0, amount);
    const Cp = C + A;
    const currentEuros = positions.map((p) => ((p.weight_percent || 0) / 100) * C);

    /* Revisión del 14-10-2026: los candados conservan su peso con cualquier
       estrategia, como al cambiar el capital. Una posición con candado recibe
       justo la parte que mantiene su peso (peso × aportación) y el resto se
       reparte entre las demás según la estrategia. */
    const locked = positions.map((p) => Boolean(locks[p.asset_id]));
    const extra = positions.map((p, i) => (locked[i] ? ((p.weight_percent || 0) / 100) * A : 0));
    const open = positions.map((_, i) => i).filter((i) => !locked[i]);
    const openAmount = Math.max(0, A - extra.reduce((s, e) => s + e, 0));
    const n = open.length;
    if (n > 0) {
      if (strategy === "equal") {
        open.forEach((i) => { extra[i] = openAmount / n; });
      } else if (strategy === "toward_equal") {
        const targetEur = (open.reduce((s, i) => s + currentEuros[i], 0) + openAmount) / n;
        const deficits = open.map((i) => Math.max(0, targetEur - currentEuros[i]));
        const sumDef = deficits.reduce((s, d) => s + d, 0);
        open.forEach((i, k) => { extra[i] = sumDef > 0 ? openAmount * (deficits[k] / sumDef) : openAmount / n; });
      } else {
        // proporcional
        const openWeight = open.reduce((s, i) => s + (positions[i].weight_percent || 0), 0);
        open.forEach((i) => {
          extra[i] = openWeight > 0 ? openAmount * ((positions[i].weight_percent || 0) / openWeight) : openAmount / n;
        });
      }
    }
    const unassigned = n === 0 ? openAmount : 0;

    /* Cada posición recibe su parte según la estrategia, también las de importe
       fijo (`keepEuros`): su importe fijo pasa a ser el nuevo, así que siguen
       fijas sin perder lo aportado. Pesos sin redondear (como al editar un
       importe): peso × capital devuelve el euro exacto y la suma no deriva. */
    const nextCapital = roundCents(Cp);
    let fixedThatReceived = 0;
    const nextPositions = positions.map((p, i) => {
      const newEur = currentEuros[i] + extra[i];
      const weight_percent = locked[i] ? p.weight_percent || 0 : nextCapital > 0 ? (newEur / nextCapital) * 100 : 0;
      if (!p.keepEuros) return { ...p, weight_percent };
      if (extra[i] > 0) fixedThatReceived += 1;
      return { ...p, weight_percent, targetEuros: roundCents(newEur) };
    });
    if ((await onApply({ positions: nextPositions, totalCapital: nextCapital })) === false) {
      return;
    }
    setApplied(
      `Aportación de ${oFalta(importeTitular(A))} aplicada (${STRATEGIES.find((s) => s.id === strategy)?.label}). Capital nuevo: ${oFalta(importeTitular(Cp))}.` +
        (fixedThatReceived > 0 ? " Las posiciones de importe fijo pasan a su importe nuevo." : "") +
        (unassigned >= 0.005 ? ` Todas las posiciones tienen candado: ${oFalta(importe(unassigned))} quedan sin asignar.` : "")
    );
  }

  const procedencia = `${capitalSinFijar ? `Capital sin fijar: ${oFalta(importeTitular(totalCapital))} de ejemplo.` : `Capital actual: ${oFalta(importeTitular(totalCapital))}.`} Indica cuánto aportas y cómo repartirlo; se recalculan pesos y capital.`;
  const cuerpo = (
    <>
      <Campo
        className="capital-amount"
        pista={`→ capital nuevo ${oFalta(importeTitular(newCapital))}${capitalSinFijar ? " (sobre el de ejemplo)" : ""}`}
        rotulo="Aportación en euros"
      >
        {/* Revisión 12-08: mismo campo de importe europeo que el capital. */}
        <EuroAmountInput
          value={amount}
          onCommit={(value) => {
            setAmount(value);
            setApplied(null);
          }}
          ariaLabel="Importe de la aportación en euros"
        />
      </Campo>

      <fieldset className="capital-strategy">
        <legend className="ui-visually-hidden">Cómo repartir la aportación</legend>
        {STRATEGIES.map((s) => (
          <label className="capital-strategy-option" key={s.id}>
            <input
              type="radio"
              name={strategyGroup}
              value={s.id}
              checked={strategy === s.id}
              onChange={() => { setStrategy(s.id); setApplied(null); }}
            />
            <strong>{s.label}</strong>
            <span className="capital-strategy-help">{s.help}</span>
          </label>
        ))}
      </fieldset>

      <div className="capital-actions">
        <Button variant="primary" onClick={() => void apply()} disabled={!canApply}>
          Aplicar aportación
        </Button>
      </div>

      {applied ? (
        <Aviso anunciar tono="nota">
          {applied}
        </Aviso>
      ) : null}

      {/* DIS-15: la herramienta que reordena sin aportar se llama aquí como se llama en la pantalla. */}
      <p className="capital-note">
        Las posiciones con candado conservan su peso con cualquier opción. Si la cartera suma el 100 %, tras aplicar
        sigue sumando el 100 % del nuevo capital. Para mantener el capital y solo reordenar, usa «Repartir por clase».
      </p>
    </>
  );

  if (enDialogo) {
    return (
      <div className="stack stack--tight">
        <p className="field__hint">{procedencia}</p>
        {cuerpo}
      </div>
    );
  }

  return (
    <Panel claseDelCuerpo="stack stack--tight" subtitulo={procedencia} titulo="Añadir dinero">
      {cuerpo}
    </Panel>
  );
}
