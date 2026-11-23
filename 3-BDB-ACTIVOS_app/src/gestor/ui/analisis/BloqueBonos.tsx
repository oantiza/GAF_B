/**
 * Bloque 9: los bonos de la cartera, con lo que el cliente va a cobrar de ellos. Solo sale
 * si hay alguno. Los importes van en la divisa de cada bono.
 */
import { Ausencia } from "../../../components/ui/Ausencia";
import { Panel } from "../../../components/ui/Panel";
import type { Analisis } from "../../motor/analisis";
import { escrito } from "../textos";
import { FilaDeDato } from "../piezas";

export function BloqueBonos({ analisis }: { analisis: Analisis }) {
  if (analisis.bonos.length === 0) return null;
  return (
    <Panel subtitulo={`A ${escrito.fecha(analisis.fecha)} · próximos cobros de los dos años siguientes, en bruto y en la divisa de cada bono`} titulo="Bonos">
      <div className="gestor-columnas">
        {analisis.bonos.map((bono) => {
          const divisa = bono.activo.divisa;
          return (
            <div key={bono.activo.id}>
              <h3 className="gestor-subtitulo">{bono.activo.nombre}</h3>
              <div className="rows">
                <FilaDeDato rotulo="Nominal">{escrito.importe(bono.nominal, divisa)}</FilaDeDato>
                <FilaDeDato nota={bono.cuponCorrido === null ? "Sin precio, el bono no tiene valor y no se da su cupón corrido" : "Lo devengado desde el último cupón: se cobra en el próximo"} rotulo="Cupón corrido">
                  {bono.cuponCorrido === null ? <Ausencia clase="falta" /> : escrito.importe(bono.cuponCorrido, divisa)}
                </FilaDeDato>
                <FilaDeDato nota={bono.vencido ? "Vencido: comprueba que se ha apuntado la devolución del nominal." : undefined} rotulo="Vencimiento">
                  {escrito.fecha(bono.vencimiento)}
                </FilaDeDato>
              </div>
              <h3 className="gestor-subtitulo">Próximos cobros</h3>
              {bono.proximos.length === 0 ? (
                <p className="cmp-note">No hay cobros en los próximos dos años.</p>
              ) : (
                <div className="rows">
                  {bono.proximos.map((pago) => (
                    <FilaDeDato key={`${pago.clase}-${pago.fecha}`} nota={escrito.fecha(pago.fecha)} rotulo={pago.clase === "cupon" ? "Cupón" : "Devolución del nominal"}>
                      {escrito.importe(pago.importe, divisa)}
                    </FilaDeDato>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
