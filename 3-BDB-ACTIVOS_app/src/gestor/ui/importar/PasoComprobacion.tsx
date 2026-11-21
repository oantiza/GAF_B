/**
 * Paso 3 del asistente: cómo quedaría la cartera y si cuadra con lo que declaran los
 * extractos, antes de tocar nada. Si faltan las posiciones iniciales, se ofrecen.
 */
import { useMemo } from "react";
import { Button } from "../../../components/ui/Button";
import type { DecisionSobreUnActivo, Revision } from "../../importacion/revision";
import { aNumero, d, type Decimal } from "../../motor/decimal";
import type { Conciliacion, DiferenciaDeConciliacion } from "../../motor/integridad";
import { Distintivo } from "../../../components/ui/Distintivo";
import { escrito } from "../textos";
import { LineaDeAviso } from "../piezas";
import { fraseDeCuadre, proponerPosicionesIniciales, queSueleSignificar, type Comprobacion, type PosicionInicial } from "./comprobacion";

function cifraDe(diferencia: DiferenciaDeConciliacion, valor: Decimal, conSigno = false): string {
  if (diferencia.clase === "efectivo") {
    const divisa = diferencia.concepto.replace("Efectivo en ", "");
    return conSigno ? escrito.importeConSigno(aNumero(valor), divisa) : escrito.importe(aNumero(valor), divisa);
  }
  const texto = escrito.titulos(valor);
  return conSigno && valor.gt(0) ? `+${texto}` : texto;
}

function ConciliacionDeUnExtracto({ conciliacion }: { conciliacion: Conciliacion }) {
  if (conciliacion.cuadra) {
    return (
      <p className="gestor-comprobado">
        <Distintivo tono="marca">Cuadra</Distintivo> {fraseDeCuadre(conciliacion)}
      </p>
    );
  }
  const { extracto } = conciliacion;
  return (
    <div className="stack stack--3">
      <p className="gestor-comprobado">
        <Distintivo tono="aviso">No cuadra</Distintivo> Con el extracto del {escrito.fecha(extracto.fecha)}{extracto.documento ? ` («${extracto.documento}»)` : ""}, a esa fecha:
      </p>
      <div aria-label="Comparación del libro con el extracto (tabla desplazable)" className="gestor-tabla-envoltorio" role="group" tabIndex={0}>
        <table className="gestor-tabla">
          <thead>
            <tr>
              <th>Concepto</th>
              <th className="gestor-tabla__cifra">En el libro</th>
              <th className="gestor-tabla__cifra">En el extracto</th>
              <th className="gestor-tabla__cifra">Diferencia</th>
            </tr>
          </thead>
          <tbody>
            {conciliacion.diferencias.map((diferencia) => (
              <tr key={`${diferencia.clase}-${diferencia.concepto}`}>
                <td>{diferencia.concepto}{diferencia.clase === "titulos" ? <span className="gestor-fila__nota">Títulos</span> : null}</td>
                <td className="gestor-tabla__cifra">{cifraDe(diferencia, diferencia.enElLibro)}</td>
                <td className="gestor-tabla__cifra">{cifraDe(diferencia, diferencia.enElExtracto)}</td>
                <td className="gestor-tabla__cifra">{cifraDe(diferencia, diferencia.diferencia, true)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {queSueleSignificar(conciliacion).map((frase) => (
        <p className="cmp-note" key={frase}>{frase}</p>
      ))}
    </div>
  );
}

function DescripcionDeLaInicial({ inicial }: { inicial: PosicionInicial }) {
  const { activo, movimiento } = inicial;
  return (
    <>
      {activo.nombre}
      <span className="gestor-fila__nota">
        Entrada de {escrito.titulos(d(movimiento.titulos ?? "0"))} títulos a {movimiento.precio ? escrito.precio(aNumero(d(movimiento.precio)), activo.divisa) : "precio desconocido"} el {escrito.fecha(movimiento.fechaOperacion)}
      </span>
    </>
  );
}

export function PasoComprobacion({ comprobacion, revision, elegidas, decisiones, iniciales, alAnadirIniciales, alQuitarInicial }: {
  comprobacion: Comprobacion;
  revision: Revision;
  elegidas: ReadonlySet<string>;
  decisiones: ReadonlyMap<string, DecisionSobreUnActivo>;
  iniciales: readonly PosicionInicial[];
  alAnadirIniciales: (iniciales: PosicionInicial[]) => void;
  alQuitarInicial: (indice: number) => void;
}) {
  const propuesta = useMemo(() => proponerPosicionesIniciales(comprobacion, revision, elegidas, decisiones), [comprobacion, revision, elegidas, decisiones]);
  const { conciliaciones } = comprobacion;

  return (
    <div className="stack">
      <p className="cmp-note">Antes de tocar la cartera, se comprueba cómo quedaría con lo elegido y si coincide con lo que declaran los extractos, a la fecha de cada uno.</p>

      {conciliaciones.length === 0 ? (
        <p className="gestor-comprobado">
          <Distintivo>Sin comprobar</Distintivo> Los documentos no traen posiciones ni saldos con los que comparar, así que no se puede comprobar que la cartera cuadre. Repasa las cifras en la cartera después de importar.
        </p>
      ) : (
        conciliaciones.map((conciliacion) => <ConciliacionDeUnExtracto conciliacion={conciliacion} key={conciliacion.extracto.id} />)
      )}

      {propuesta.propuestas.length > 0 ? (
        <div className="stack stack--3">
          <h3 className="gestor-subtitulo">Posiciones iniciales que faltan</h3>
          <p className="cmp-note">Se añade una entrada de títulos por cada una, la víspera del primer movimiento importado, con el precio que sale del extracto (su valor entre sus títulos). Su valor cuenta como aportación.</p>
          <div className="rows">
            {propuesta.propuestas.map((inicial) => (
              <div className="rows__item gestor-fila" key={inicial.activo.id}>
                <span className="rows__label">
                  <DescripcionDeLaInicial inicial={inicial} />
                </span>
              </div>
            ))}
          </div>
          <div className="row">
            <Button onClick={() => alAnadirIniciales(propuesta.propuestas)} variant="primary">Añadir las posiciones iniciales que faltan</Button>
          </div>
        </div>
      ) : null}
      {propuesta.sinProponer.length > 0 ? (
        <ul className="gestor-avisos">
          {propuesta.sinProponer.map((motivo) => (
            <LineaDeAviso gravedad="aviso" key={motivo}>{motivo}</LineaDeAviso>
          ))}
        </ul>
      ) : null}

      {iniciales.length > 0 ? (
        <div className="stack stack--3">
          <h3 className="gestor-subtitulo">Posiciones iniciales añadidas</h3>
          <div className="rows">
            {iniciales.map((inicial, indice) => (
              <div className="rows__item gestor-fila" key={`${inicial.activo.id}-${indice}`}>
                <span className="rows__label">
                  <DescripcionDeLaInicial inicial={inicial} />
                </span>
                <span className="rows__value">
                  <Button onClick={() => alQuitarInicial(indice)} size="sm" variant="quiet">Quitar</Button>
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {conciliaciones.length > 0 && !comprobacion.cuadra ? (
        <p className="cmp-note">Puedes importar igualmente: la diferencia seguirá a la vista en los avisos de la cartera hasta que se resuelva.</p>
      ) : null}
    </div>
  );
}
