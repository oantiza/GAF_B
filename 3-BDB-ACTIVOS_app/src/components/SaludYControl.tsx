import type { ReactNode } from "react";
import { useModoCliente } from "../app/ClientModeContext";
import { nombreConPeso } from "../core/medidaDeLaCartera";
import type { FilaDeControl, LecturaDeSalud } from "../core/saludYControl";
import { Ausencia } from "./ui/Ausencia";
import { Aviso } from "./ui/Aviso";
import { Distintivo } from "./ui/Distintivo";
import { Panel } from "./ui/Panel";

function Fila({ fila }: { fila: FilaDeControl }) {
  return (
    <div className="analisis-filas__fila">
      <dt>
        {fila.rotulo}
        {fila.nota ? <small>{fila.nota}</small> : null}
        {fila.detalle?.map((linea) => (
          <small key={linea}>{linea}</small>
        ))}
      </dt>
      <dd>
        {fila.cifra ? <span className="cifra">{fila.cifra}</span> : fila.ausencia ? <Ausencia clase={fila.ausencia} /> : null}
        {fila.revisar ? (
          <>
            {" "}
            <Distintivo tono="aviso">Revisar</Distintivo>
          </>
        ) : null}
      </dd>
    </div>
  );
}

/* La volatilidad de la cartera ya está en la respuesta de la pantalla, con su periodo: las cifras de la banda no se repiten. */
const estaEnLaRespuesta = (fila: FilaDeControl) => fila.rotulo.startsWith("Volatilidad");

/**
 * «Qué conviene mirar»: la lectura de salud y control de Análisis. La lectura se compone en `core/saludYControl`, que dice
 * por qué es así; esto la pinta como una lista de avisos —lo que pide atención, en ocre; lo que está bien, como nota— y,
 * debajo, sus datos en filas. El titular es un veredicto, no un título: el título es el del bloque.
 */
export function SaludYControl({ lectura, acciones }: { lectura: LecturaDeSalud; acciones?: ReactNode }) {
  const { seEnsena } = useModoCliente();
  const { estado, titular, porQue, fuera, alertas, filas } = lectura;
  const tonoDelTitular = estado === "a-revisar" || estado === "con-alertas" ? "aviso" : "nota";
  return (
    <Panel
      acciones={acciones}
      claseDelCuerpo="stack stack--3"
      subtitulo="Comprobaciones de la cartera con los pesos de hoy, cada una con su umbral"
      titulo="Qué conviene mirar"
      tituloId="salud-y-control-title"
    >
      <Aviso titulo={`${titular}.`} tono={tonoDelTitular}>
        {porQue}
      </Aviso>
      {fuera.map((item) => (
        <Aviso key={item.assetId} titulo={fuera.length === 1 ? "Una posición sin medir." : "Posición sin medir."}>
          {nombreConPeso(item)}: fuera de la simulación con la que se mide la cartera.
          {/* El motivo es diagnóstico del asesor; que está fuera se dice siempre. */}
          {seEnsena("calidadInterna") ? ` Motivo: ${item.motivo}.` : ""}
        </Aviso>
      ))}
      {alertas.map((alerta) => (
        <Aviso key={alerta.clave} titulo={`${alerta.palabra}.`}>
          {alerta.texto} <small className="analisis-umbral">{alerta.umbral}</small>
        </Aviso>
      ))}
      <dl className="analisis-filas">
        {filas.filter((fila) => !estaEnLaRespuesta(fila)).map((fila) => (
          <Fila fila={fila} key={fila.rotulo} />
        ))}
      </dl>
    </Panel>
  );
}
