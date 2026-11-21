/**
 * Bloque 4: la rentabilidad de cada mes y de cada año de toda la historia de la cartera. Cada
 * casilla lleva su cifra con el signo escrito y el fondo de su signo en cinco intensidades
 * (`claseDelMes`), que dice de un vistazo si el mes fue bueno o malo y cuánto; el total del año,
 * su color de signo.
 */
import { Cifra } from "../../../components/ui/Cifra";
import { Panel } from "../../../components/ui/Panel";
import type { Analisis } from "../../motor/analisis";
import { NOMBRE_DEL_MES } from "../formato";
import { NotaDeLoContadoComoCero } from "../piezas";
import { escrito } from "../textos";
import { claseDelMes } from "./lectura";

export function BloqueMeses({ analisis }: { analisis: Pick<Analisis, "porMeses" | "sinPrecio"> }) {
  const { porMeses } = analisis;
  if (porMeses.length === 0) return null;
  /* El año más reciente arriba: es el que se mira primero. */
  const anios = [...porMeses].reverse();
  const hayParciales = anios.some((anio) => anio.parcial);
  const hayHuecos = anios.some((anio) => anio.meses.some((mes) => mes === null));
  return (
    <Panel claseDelCuerpo="stack stack--tight" subtitulo="Toda la historia de la cartera, sin depender del periodo elegido" titulo="Rentabilidad por meses y años">
      <div aria-label="Rentabilidad por meses y años (tabla desplazable)" className="gestor-tabla-envoltorio" role="group" tabIndex={0}>
        <table className="gestor-tabla gestor-meses">
          <caption className="gestor-oculto">Rentabilidad de la cartera en cada mes y en cada año</caption>
          <thead>
            <tr>
              <th scope="col">Año</th>
              {NOMBRE_DEL_MES.map((mes) => (
                <th className="gestor-tabla__cifra" key={mes} scope="col">{mes}</th>
              ))}
              <th className="gestor-tabla__cifra gestor-meses__total" scope="col">Año</th>
            </tr>
          </thead>
          <tbody>
            {anios.map((anio) => (
              <tr key={anio.anio}>
                <th scope="row">{anio.anio}</th>
                {anio.meses.map((mes, indice) => (
                  <td className={`gestor-tabla__cifra gestor-mes ${mes ? claseDelMes(mes.rentabilidad) : ""}`.trim()} key={NOMBRE_DEL_MES[indice]}>
                    {mes ? `${escrito.rentabilidad(mes.rentabilidad)}${mes.parcial ? "*" : ""}` : ""}
                  </td>
                ))}
                <td className="gestor-tabla__cifra gestor-meses__total">
                  <Cifra tipo="rentabilidad" valor={anio.total} />
                  {anio.parcial ? "*" : ""}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {hayParciales || hayHuecos ? (
        <p className="cmp-note">
          {hayParciales ? "* Mes o año incompleto: es el primero de la cartera o aún está en curso. " : ""}
          {hayHuecos ? "Las casillas vacías son meses sin historia: anteriores al primer movimiento o todavía por llegar." : ""}
        </p>
      ) : null}
      {/* Cada mes sale de la serie del valor: el mes en que se compró una posición sin precio sale como una pérdida. */}
      <NotaDeLoContadoComoCero analisis={analisis} />
    </Panel>
  );
}
