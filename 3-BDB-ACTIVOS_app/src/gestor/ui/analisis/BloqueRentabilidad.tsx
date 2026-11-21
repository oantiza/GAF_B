/**
 * Bloque 1: cuánto ha rendido la cartera en el periodo, en porcentaje y en euros; y, aparte, lo que ha rendido en el
 * último año y en los últimos 3 y 5 años hasta la fecha, que no depende del periodo elegido.
 */
import { Cifra } from "../../../components/ui/Cifra";
import { NotaEmergente } from "../../../components/ui/NotaEmergente";
import { Panel } from "../../../components/ui/Panel";
import { fechaDeInicioDelPeriodo, type Analisis } from "../../motor/analisis";
import { metrica } from "../../motor/metricas/registro";
import type { AniosRecientes } from "../../motor/ultimosAnios";
import { escrito } from "../textos";
import { FilaDeDato, FilaDeMetrica, ValorDeMetrica } from "../piezas";

/** Las tres filas de «Últimos años»: su rótulo y la métrica de su acumulada. La anualizada (3 y 5 años) va en la misma línea del análisis. */
const ULTIMOS_ANIOS: ReadonlyArray<{ anios: AniosRecientes; rotulo: string; acumulada: string }> = [
  { anios: 1, rotulo: "Último año", acumulada: "rentabilidadUltimoAnio" },
  { anios: 3, rotulo: "Últimos 3 años", acumulada: "rentabilidadUltimos3Anios" },
  { anios: 5, rotulo: "Últimos 5 años", acumulada: "rentabilidadUltimos5Anios" }
];

/** Una fila de «Últimos años»: la acumulada y, debajo, la anualizada; las fechas en la nota, o el motivo si no llega. */
function FilaDeLosUltimosAnios({ analisis, fila }: { analisis: Analisis; fila: (typeof ULTIMOS_ANIOS)[number] }) {
  const linea = analisis.ultimosAnios.find((candidata) => candidata.anios === fila.anios);
  if (!linea) return null;
  const acumulada = metrica(fila.acumulada);
  return (
    <FilaDeDato
      nota={linea.desde ? `Del ${escrito.fecha(linea.desde)} al ${escrito.fecha(linea.hasta)}` : undefined}
      /* La ventana acaba en la fecha del análisis: si alguna posición no tiene precio, la cuenta como cero y lo dice. */
      salvedad={acumulada.salvedad?.(analisis)}
      rotulo={
        <>
          {fila.rotulo}{" "}
          <NotaEmergente termino={fila.rotulo.toLowerCase()}>
            {fila.anios > 1 ? `${acumulada.ayuda} Debajo, la misma rentabilidad expresada como media por año.` : acumulada.ayuda}
          </NotaEmergente>
        </>
      }
    >
      <ValorDeMetrica analisis={analisis} metrica={acumulada} />
      {linea.anualizada !== null ? (
        <span className="gestor-fila__anual">
          <Cifra tipo="rentabilidad" valor={linea.anualizada} /> al año
        </span>
      ) : null}
    </FilaDeDato>
  );
}

export function BloqueRentabilidad({ analisis }: { analisis: Analisis }) {
  const rentabilidad = analisis.rentabilidad;
  if (!rentabilidad) return null;
  return (
    <Panel claseDelCuerpo="stack stack--tight" subtitulo={`Del ${escrito.fecha(fechaDeInicioDelPeriodo(analisis))} al ${escrito.fecha(rentabilidad.hasta)}`} titulo="Rentabilidad">
      <div className="gestor-columnas">
        <div>
          <h3 className="gestor-subtitulo">En porcentaje</h3>
          <div className="rows">
            <FilaDeMetrica analisis={analisis} metrica={metrica("rentabilidad")} />
            <FilaDeMetrica analisis={analisis} metrica={metrica("rentabilidadAnualizada")} />
            <FilaDeMetrica analisis={analisis} metrica={metrica("rentabilidadDelCliente")} nota={rentabilidad.anualiza ? "Al año" : "En el periodo"} />
          </div>
        </div>
        <div>
          <h3 className="gestor-subtitulo">{analisis.cartera.divisaBase === "EUR" ? "En euros" : `En ${analisis.cartera.divisaBase}`}</h3>
          <div className="rows">
            <FilaDeMetrica analisis={analisis} metrica={metrica("resultado")} />
            <FilaDeMetrica analisis={analisis} metrica={metrica("aportacionesNetas")} />
            <FilaDeMetrica analisis={analisis} metrica={metrica("resultadoRealizado")} nota="En las ventas del periodo" />
            <FilaDeMetrica analisis={analisis} metrica={metrica("resultadoLatente")} nota={`De lo que sigue en cartera, a ${escrito.fecha(analisis.fecha)}`} />
          </div>
        </div>
        {analisis.ultimosAnios.length > 0 ? (
          <div>
            <h3 className="gestor-subtitulo">Últimos años, sin depender del periodo elegido</h3>
            <div className="rows">
              {ULTIMOS_ANIOS.map((fila) => (
                <FilaDeLosUltimosAnios analisis={analisis} fila={fila} key={fila.anios} />
              ))}
            </div>
          </div>
        ) : null}
      </div>
      <p className="cmp-note">
        La rentabilidad mide la cartera y no depende de cuándo aportó o retiró dinero el cliente; la rentabilidad del cliente sí lo tiene en cuenta. Por eso pueden diferir.
      </p>
    </Panel>
  );
}
