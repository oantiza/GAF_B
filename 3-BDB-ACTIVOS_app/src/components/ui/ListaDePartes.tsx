import type { CSSProperties, ReactNode } from "react";
import { Cifra } from "./Cifra";

/**
 * Las partes de un todo, comparadas: nombre, una barra fina y el peso. Es la `.partes` de la maqueta y sustituye a las
 * cuatro variantes de barra de proporción que hay hoy.
 *
 * Es uno de los pocos sitios donde el sistema admite una barra, y por una razón: una fila de barras que compara las
 * partes de un todo explica algo que la columna de cifras sola no explica de un vistazo. Pero **se lee sin la barra**:
 * el nombre y la cifra son texto, y la barra va oculta al lector de pantalla.
 *
 * - La barra es proporcional a la fracción (0,54 llena el 54 % del carril), en el marino de la serie de la cartera.
 * - `color` le da a una parte el color de su categoría (la clase de activo, la zona del mapa): el mismo que lleva en el
 *   aro y en el mapa. El color sigue a la categoría, nunca al puesto: las partes de una lista ordenada por peso (sectores,
 *   posiciones) no lo llevan.
 * - `apagada` la pinta en el gris de la referencia: es «Resto», «Otros», «Sin clasificar».
 * - Una fracción que falta se dice con `Ausencia` («Falta el dato») y su carril queda vacío.
 *
 * ```tsx
 * <ListaDePartes etiqueta="Por clase de activo" partes={[
 *   { nombre: "Renta variable", fraccion: 0.54 },
 *   { nombre: "Otros", fraccion: 0.07, apagada: true }
 * ]} />
 * ```
 */
export interface ParteDeUnTodo {
  nombre: ReactNode;
  /** La parte, como fracción del todo: 0,54 es el 54,0 %. */
  fraccion: number | null;
  /** Una segunda línea bajo el nombre, en gris. */
  apunte?: ReactNode;
  /** «Resto», «Otros»: la barra en gris. */
  apagada?: boolean;
  /** El color de la categoría de la parte (`colorDeLaClase`, `ZONE_CHIP`). Sin él, el marino de la cartera. */
  color?: string;
}

export interface ListaDePartesProps {
  partes: readonly ParteDeUnTodo[];
  /** El nombre accesible de la lista: de qué todo son las partes. */
  etiqueta?: string;
  className?: string;
}

/** El ancho de la barra, entre el 0 y el 100 % del carril. */
function anchoDe(fraccion: number | null): string {
  if (typeof fraccion !== "number" || !Number.isFinite(fraccion)) return "0%";
  return `${Math.min(1, Math.max(0, fraccion)) * 100}%`;
}

export function ListaDePartes({ partes, etiqueta, className = "" }: ListaDePartesProps) {
  return (
    <ul aria-label={etiqueta} className={`partes ${className}`.trim()}>
      {partes.map((parte, indice) => (
        <li
          className={parte.apagada ? "partes__parte partes__parte--apagada" : "partes__parte"}
          key={indice}
          /* El color de la categoría: valor por dato, en tiempo de ejecución. */
          style={parte.color && !parte.apagada ? ({ "--parte-color": parte.color } as CSSProperties) : undefined}
        >
          <span className="partes__nombre">
            {parte.nombre}
            {parte.apunte ? <span className="partes__apunte">{parte.apunte}</span> : null}
          </span>
          <span aria-hidden="true" className="partes__carril">
            <span className="partes__barra" style={{ width: anchoDe(parte.fraccion) }} />
          </span>
          <span className="partes__cifra">
            <Cifra tipo="peso" valor={parte.fraccion} />
          </span>
        </li>
      ))}
    </ul>
  );
}
