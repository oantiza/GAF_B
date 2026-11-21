import type { ReactNode } from "react";
import type { Signo } from "../../core/formato";

/**
 * La banda de cifras que contesta la pantalla: la segunda de las cinco partes de toda pantalla (cabecera, respuesta,
 * pestañas, bloques, notas). Evoluciona de `KpiStrip`, que sigue en las pantallas que aún no se han rehecho.
 *
 * - **De tres a seis datos.** Cada uno con su rótulo, su cifra y, si hace falta, su apunte: de cuándo es o con qué se
 *   compara («la referencia, +9,15 %»).
 * - **Una sola cifra principal**, en `--cifra-xl`: la que contesta la pregunta de la pantalla («Patrimonio»). Si se
 *   marcan varias, solo cuenta la primera.
 * - **Los rótulos reservan dos líneas**, para que las cifras queden alineadas aunque un rótulo sea largo.
 * - **El color del signo** lo da `signo` (`sube`, `baja`, `neutro`), o la propia `Cifra` que se pase como `cifra`,
 *   que es lo preferible: así el formato, el color y la ausencia salen del mismo sitio.
 *
 * Es un grupo con nombre (`etiqueta`), y cada dato se lee en orden: rótulo, cifra, apunte. Aspecto: `.respuesta` y
 * su variante `.respuesta--abierta` de `src/styles/components.css`. La hoja `docs/frontend/maquetas/sistema.css` es
 * la propuesta del 13-11-2026 y ya no es su aspecto.
 *
 * ```tsx
 * <Respuesta etiqueta="Cuánto vale y cuánto ha ganado" datos={[
 *   { rotulo: "Patrimonio", cifra: <Cifra tipo="importeTitular" valor={201298} />, apunte: "a 13/11/2026", principal: true },
 *   { rotulo: "Rentabilidad de la cartera", cifra: <Cifra tipo="rentabilidad" valor={0.1039} />, apunte: "su referencia, +13,88 %" }
 * ]} />
 * ```
 */
export interface DatoDeRespuesta {
  rotulo: ReactNode;
  cifra: ReactNode;
  /** La línea bajo la cifra: de cuándo es, con qué se compara. */
  apunte?: ReactNode;
  /** La cifra que contesta la pantalla, en grande. Como mucho una. */
  principal?: boolean;
  /** El color del signo, si la cifra no lo trae ya. */
  signo?: Signo;
}

export interface RespuestaProps {
  /** El nombre accesible del grupo: qué pregunta contesta la banda. */
  etiqueta: string;
  /** De tres a seis. */
  datos: readonly DatoDeRespuesta[];
  /**
   * La banda de la pantalla, bajo su cabecera: sin caja, con filetes verticales y uno inferior, y pegada al doble
   * filete de la cabecera cuando la sigue (`.respuesta--abierta`). Sin ella, la banda es una tarjeta (o una pieza de
   * banda dentro de una tarjeta).
   */
  abierta?: boolean;
  className?: string;
}

/* Escritas enteras para que el censo de CSS vea su uso. */
const CLASE_DEL_SIGNO: Record<Signo, string> = {
  sube: "cifra--sube",
  baja: "cifra--baja",
  neutro: ""
};

export function Respuesta({ etiqueta, datos, abierta = false, className = "" }: RespuestaProps) {
  const principal = datos.findIndex((dato) => dato.principal);
  return (
    <div aria-label={etiqueta} className={["respuesta", abierta ? "respuesta--abierta" : "", className].filter(Boolean).join(" ")} role="group">
      {datos.map((dato, indice) => (
        <div className={indice === principal ? "respuesta__dato respuesta__dato--principal" : "respuesta__dato"} key={indice}>
          <p className="respuesta__rotulo">{dato.rotulo}</p>
          <p className={["respuesta__cifra", dato.signo ? CLASE_DEL_SIGNO[dato.signo] : ""].filter(Boolean).join(" ")}>{dato.cifra}</p>
          {dato.apunte ? <p className="respuesta__apunte">{dato.apunte}</p> : null}
        </div>
      ))}
    </div>
  );
}
