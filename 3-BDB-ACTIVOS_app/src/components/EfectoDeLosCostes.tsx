import { useId } from "react";
import { efectoDeLosCostes, RENTABILIDAD_SUPUESTA_MAXIMA, RENTABILIDAD_SUPUESTA_MINIMA, rentabilidadSupuesta } from "../core/efectoDeLosCostes";
import { importe, importeTitular, oFalta, porcentaje } from "../core/formato";
import { seEnsena } from "../core/modoCliente";
import { BASE_DE_LECTURA_EUR, calculatePortfolioManagementFee, type calculatePortfolioCosts } from "../core/portfolioCosts";
import type { ManagementFeeDraft } from "./PortfolioManagementFee";
import { Ausencia } from "./ui/Ausencia";
import { Campo } from "./ui/Campo";
import { Cifra } from "./ui/Cifra";
import { Panel } from "./ui/Panel";

/** Un porcentaje escrito por el asesor, tal como lo ha escrito, sin signo y sin decimales de más: «5 %», «3,5 %», «4,25 %». */
function supuestoEscrito(tasa: number): string {
  const puntos = tasa * 100;
  const decimales = [0, 1, 2].find((digitos) => Math.abs(Number(puntos.toFixed(digitos)) - puntos) < 1e-9) ?? 2;
  return oFalta(porcentaje(tasa, { decimales }));
}

/**
 * El efecto de los costes con el tiempo, dentro del cuadro de Costes (Óscar, 11-11-2026): cuánto menos tendría el cliente al cabo
 * de 5 y 10 años por lo que cuesta su cartera. El cálculo y lo que deja fuera viven en `core/efectoDeLosCostes.ts`. No va a ningún
 * papel.
 *
 * Sin capital declarado se lee sobre la misma base que el resto del cuadro, `BASE_DE_LECTURA_EUR`, y lo dice: no es el dinero de
 * nadie (decisión 5). En Modo cliente sale igual, salvo la mención de las retrocesiones, que es lo que el modo quita.
 */
export function EfectoDeLosCostes({ costs, management, rentabilidad, onRentabilidad, clientMode }: {
  costs: ReturnType<typeof calculatePortfolioCosts>;
  management: ManagementFeeDraft;
  /** Lo que hay escrito en el campo, en puntos porcentuales: «5». */
  rentabilidad: string;
  onRentabilidad: (valor: string) => void;
  clientMode: boolean;
}) {
  const idDelError = useId();
  const sinCapital = costs.totalCapital == null;
  const capital = costs.totalCapital ?? BASE_DE_LECTURA_EUR;
  const fee = calculatePortfolioManagementFee(costs, management.input.trim() === "" ? null : Number(management.input), management.unit);
  const supuesta = rentabilidadSupuesta(rentabilidad);
  const efecto = efectoDeLosCostes({ costs, capital, gestion: { enabled: management.enabled, fee }, rentabilidad: supuesta });
  const invalida = supuesta == null;
  const base = sinCapital ? `Por cada ${oFalta(importeTitular(BASE_DE_LECTURA_EUR))} de ejemplo, no el capital de esta cartera` : `Sobre el capital analizado, ${oFalta(importe(capital))}`;
  const subtitulo = efecto.estado === "calculado"
    ? `${base} · rentabilidad supuesta del ${supuestoEscrito(efecto.rentabilidad)} anual antes de costes, la misma para todo · coste de ${oFalta(porcentaje(efecto.coste))} al año${efecto.soloGestion ? ", solo el de la gestión de la cartera: las acciones no tienen coste corriente" : efecto.gestion != null ? ", con la gestión de la cartera" : ""}`
    : `${base} · rentabilidad supuesta antes de costes, la misma para todo`;

  return (
    <Panel
      nivel={3}
      titulo="Efecto de los costes con el tiempo"
      subtitulo={subtitulo}
      claseDelCuerpo="stack stack--tight"
      acciones={efecto.estado === "no-aplica" ? undefined : (
        <Campo className="costs-margin-field" rotulo="Rentabilidad supuesta antes de costes (% al año)">
          <input type="number" inputMode="decimal" lang="es" step="0.1"
            min={RENTABILIDAD_SUPUESTA_MINIMA * 100} max={RENTABILIDAD_SUPUESTA_MAXIMA * 100}
            value={rentabilidad} className="costs-margin-input"
            aria-invalid={invalida || undefined} aria-describedby={invalida ? idDelError : undefined}
            onChange={(event) => onRentabilidad(event.target.value)} />
        </Campo>
      )}
    >
      {efecto.estado === "calculado" ? (
        <div className="table-wrap" role="region" aria-label="Efecto de los costes a 5 y 10 años" tabIndex={0}>
          <table className="dialog-table" aria-label="Efecto de los costes a 5 y 10 años">
            <thead>
              <tr>
                <th scope="col">Horizonte</th>
                <th className="num" scope="col">Sin costes</th>
                <th className="num" scope="col">Con costes</th>
                <th className="num" scope="col">Diferencia</th>
                <th className="num" scope="col">Sobre el resultado sin costes</th>
              </tr>
            </thead>
            <tbody>
              {efecto.filas.map((fila) => (
                <tr key={fila.anos}>
                  <th scope="row">{`${fila.anos} años`}</th>
                  <td className="num"><Cifra tipo="importe" valor={fila.sinCostes} /></td>
                  <td className="num"><Cifra tipo="importe" valor={fila.conCostes} /></td>
                  <td className="num is-strong"><Cifra tipo="importe" valor={fila.diferencia} /></td>
                  <td className="num"><Cifra tipo="peso" valor={fila.diferenciaPct} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : efecto.estado === "no-aplica" ? (
        <p><Ausencia clase="no-aplica" />. {efecto.motivo}</p>
      ) : (
        <p id={invalida ? idDelError : undefined}><Ausencia clase="falta" motivo={efecto.motivo} /></p>
      )}
      {efecto.estado === "no-aplica" ? null : <p className="field__hint">
        Una ilustración, no una previsión: la rentabilidad es un supuesto, no la de esta cartera, y el coste se descuenta cada año al
        mismo nivel. No entran la entrada (suscripción) máxima, que es un máximo de folleto y rara vez se cobra, ni los costes de
        operación, que solo se conocen en parte{seEnsena("retrocesiones", clientMode) ? "; tampoco las retrocesiones, que ya van dentro del coste de cada fondo" : ""}.
      </p>}
    </Panel>
  );
}
