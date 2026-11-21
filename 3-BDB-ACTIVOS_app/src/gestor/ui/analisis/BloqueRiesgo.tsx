/**
 * Bloque 3: cuánto se ha movido la cartera por el camino. Volatilidad y caída máxima, y los tres ratios que ponen la
 * rentabilidad frente a ese riesgo: Sharpe, Sortino y Calmar.
 */
import { Panel } from "../../../components/ui/Panel";
import type { Analisis } from "../../motor/analisis";
import { metrica } from "../../motor/metricas/registro";
import { escrito } from "../textos";
import { FilaDeMetrica } from "../piezas";
import { fraseDeLaCaida } from "./lectura";

export function BloqueRiesgo({ analisis }: { analisis: Analisis }) {
  const riesgo = analisis.riesgo;
  if (!riesgo) return null;
  const libre = riesgo.libreDeRiesgo;
  return (
    <Panel subtitulo="Volatilidad sobre rentabilidades semanales; caída máxima sobre el valor de cada día" titulo="Riesgo">
      <div className="rows">
        <FilaDeMetrica analisis={analisis} metrica={metrica("volatilidad")} nota={riesgo.volatilidad !== null ? `Medida con ${riesgo.semanas} semanas` : undefined} />
        <FilaDeMetrica analisis={analisis} metrica={metrica("maximaCaida")} nota={fraseDeLaCaida(riesgo.maximaCaida)} />
        <FilaDeMetrica
          analisis={analisis}
          metrica={metrica("sharpe")}
          nota={riesgo.sharpe !== null && libre ? `Con un tipo sin riesgo del ${escrito.porcentaje(libre.tasa)}: la media del €STR en el periodo` : undefined}
        />
        <FilaDeMetrica analisis={analisis} metrica={metrica("sortino")} nota={riesgo.sortino !== null ? `Con el mismo tipo sin riesgo y ${riesgo.semanas} semanas` : undefined} />
        <FilaDeMetrica
          analisis={analisis}
          metrica={metrica("calmar")}
          nota={
            riesgo.calmar !== null
              ? `${escrito.rentabilidad(riesgo.rentabilidadAnualizada)} al año entre una caída del ${escrito.porcentaje(Math.abs(riesgo.maximaCaida.caida))}`
              : undefined
          }
        />
      </div>
    </Panel>
  );
}
