import { oFalta, peso } from "../core/formato";
import type { ParteFueraDelReparto } from "../core/radiografiaDeLaCartera";
import { Ausencia } from "./ui/Ausencia";
import { ClaseConColor } from "./ui/ClaseConColor";

export interface FilaDeReparto {
  clave: string;
  rotulo: string;
  /** El peso, de 0 a 100. */
  peso: number;
}

/**
 * Un reparto: rótulo y cifra en la misma fila, con un filete debajo y un decimal. Sin barra (principio 2):
 * cada lista la escalaba contra su propio máximo, así que el 24 % de una y el 64 % de otra pintaban lo
 * mismo, y al lado de la cifra escrita no añadía nada.
 *
 * `porClase`: las claves de las filas son clases de activo (`EQUITY`, `fixed_income`, `cash`…), y cada nombre lleva delante
 * el punto del color de su clase, el mismo del aro y de las barras de «En qué está invertida» (14-11-2026).
 *
 * `claveDeLoQueFalta`: la clave de la fila que junta las posiciones que no traen el dato del reparto —sin divisa declarada, por
 * ejemplo—. Esa fila no tiene nombre que enseñar: lo dice la pieza, «Falta el dato» en ocre, y va la última, como todo lo que un
 * reparto no sabe. Su peso se queda: sin él, las filas no llegarían al 100 % y no dirían por qué.
 */
export function FilasDeReparto({
  filas,
  vacio = "Sin datos",
  porClase = false,
  claveDeLoQueFalta
}: {
  filas: readonly FilaDeReparto[];
  vacio?: string;
  porClase?: boolean;
  claveDeLoQueFalta?: string;
}) {
  if (filas.length === 0) {
    return <p className="empty-inline">{vacio}</p>;
  }
  const esLoQueFalta = (fila: FilaDeReparto) => claveDeLoQueFalta !== undefined && fila.clave === claveDeLoQueFalta;
  const enOrden = [...filas.filter((fila) => !esLoQueFalta(fila)), ...filas.filter(esLoQueFalta)];
  return (
    <ul className="xray-dist-rows">
      {enOrden.map((fila) => (
        <li key={fila.clave}>
          {esLoQueFalta(fila) ? (
            <span className="xray-dist-label">
              <Ausencia clase="falta" />
            </span>
          ) : (
            <span className="xray-dist-label" title={fila.rotulo}>
              {porClase ? <ClaseConColor clave={fila.clave}>{fila.rotulo}</ClaseConColor> : fila.rotulo}
            </span>
          )}
          <b>{oFalta(peso(fila.peso / 100))}</b>
        </li>
      ))}
    </ul>
  );
}

/**
 * Lo que no entra en un reparto, debajo y con la misma pieza que «No declarado»: sin esa línea, las filas no llegan al 100 % y no
 * dicen por qué. `sobreLaCartera`, para los repartos que suman 100 entre las posiciones y no los pesos tal cual.
 */
export function LoQueNoEntra({ partes, sobreLaCartera = false }: { partes: readonly ParteFueraDelReparto[]; sobreLaCartera?: boolean }) {
  return (
    <>
      {partes.map((parte) => (
        <p className="xray-dist-pie" key={parte.clave}>
          <Ausencia clase="falta" motivo={`${parte.rotulo}: ${oFalta(peso((sobreLaCartera ? parte.pesoSobreLaCartera : parte.peso) / 100))} de la cartera`} />
        </p>
      ))}
    </>
  );
}
