import type { ReactNode } from "react";
import { calculatePortfolioManagementFee, fraseDelCoste, type calculatePortfolioCosts, type PortfolioManagementFeeUnit } from "../core/portfolioCosts";
import { Aviso } from "./ui/Aviso";
import { Campo } from "./ui/Campo";
import { Cifra } from "./ui/Cifra";
import { EuroAmountInput } from "./ui/EuroAmountInput";

export interface ManagementFeeDraft { enabled: boolean; unit: PortfolioManagementFeeUnit; input: string }

/** Borrador en euros → valor del campo: vacío mientras no haya importe confirmado. */
function euroInputValue(input: string): number | null {
  if (input.trim() === "") return null;
  const amount = Number(input);
  return Number.isFinite(amount) ? amount : null;
}

/** Una fila de cifra: rótulo y cifra, con su filete. */
function Fila({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="analisis-filas__fila">
      <dt>{rotulo}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function PortfolioManagementFee({ costs, value, onChange }: {
  costs: ReturnType<typeof calculatePortfolioCosts>; value: ManagementFeeDraft; onChange: (value: ManagementFeeDraft) => void;
}) {
  const { enabled, unit, input } = value;
  const fee = calculatePortfolioManagementFee(costs, input.trim() === "" ? null : Number(input), unit);
  const invalid = input.trim() !== "" && !fee.valid;
  /* Sin capital declarado todo va en porcentajes: un importe en euros no se podría sumar a nada (decisión 5). */
  const sinCapital = costs.totalCapital == null;
  const error = invalid
    ? unit === "percent" ? "Introduce un porcentaje anual entre 0 y 100." : "Introduce un importe anual igual o mayor que cero."
    : undefined;

  return (
    <section className="costs-management-section" aria-label="Gestión de la cartera">
      <div className="costs-section-heading">
      <div><h3>Gestión de la cartera</h3><p>Comisión adicional opcional</p></div>
      <label className="check">
        <input type="checkbox" checked={enabled} onChange={(event) => onChange({ ...value, enabled: event.target.checked })} aria-label="Añadir comisión de gestión de la cartera" aria-controls="portfolio-management-fields" />
        Añadir comisión
      </label>
      </div>
      {enabled ? <div id="portfolio-management-fields" className="costs-management-fields">
        <p className="field__hint">
          Comisión adicional por gestionar la cartera, aplicada una sola vez{sinCapital ? ". Sin capital se indica en porcentaje." : " sobre el capital declarado."}{" "}
          Introduce el coste anual final que corresponda, incluidos los impuestos si los hay. Se aplica a este análisis y se recuerda
          mientras dure la sesión.
        </p>
        <div className="costs-management-controls">
          <Campo rotulo="Forma de introducir la comisión">
            <select value={unit} onChange={(event) => onChange({ ...value, unit: event.target.value as PortfolioManagementFeeUnit, input: "" })}>
              <option value="percent">Porcentaje anual (%)</option>
              <option disabled={sinCapital} value="euros">Importe anual (€)</option>
            </select>
          </Campo>
          {/* Auditoría 14-10 (MEDIA-21): el porcentaje técnico puede ser
              type="number" (guía §8); el importe en euros, NUNCA: EuroAmountInput
              entiende «1.500» como mil quinientos y confirma en blur/Enter. */}
          {unit === "percent" ? (
            <Campo error={error} rotulo="Comisión anual (%)">
              <input type="number" inputMode="decimal" lang="es" min="0" max={100}
                step="0.0001" value={input}
                onChange={(event) => onChange({ ...value, input: event.target.value })} />
            </Campo>
          ) : (
            <Campo error={error} rotulo="Comisión anual (€)">
              <EuroAmountInput
                value={euroInputValue(input)}
                onCommit={(amount) => onChange({ ...value, input: String(amount) })}
              />
            </Campo>
          )}
        </div>
        <dl aria-label="La comisión de gestión de la cartera" className="analisis-filas">
          {sinCapital ? (
            <>
              <Fila rotulo="Gestión de cartera"><Cifra tipo="porcentaje" valor={fee.rate} /></Fila>
              <Fila rotulo="Coste con gestión"><span className="cifra">{fraseDelCoste(costs, fee.combinedRate)}</span></Fila>
            </>
          ) : (
            <>
              <Fila rotulo="Gestión de cartera · coste anual"><Cifra tipo="importe" valor={fee.annualEur} /></Fila>
              <Fila rotulo="Coste con gestión (%)"><Cifra tipo="porcentaje" valor={fee.combinedRate} /></Fila>
              <Fila rotulo="Coste anual con gestión"><Cifra tipo="importe" valor={fee.combinedAnnualEur} /></Fila>
            </>
          )}
        </dl>
        {costs.missing > 0 ? <Aviso>El coste con gestión falta porque faltan costes corrientes de activos.</Aviso> : null}
      </div> : null}
    </section>
  );
}
