import type { ReactNode } from "react";
import { colorDeLaClase } from "../../core/coloresDeClase";

/**
 * El nombre de una categoría con el punto de su color delante: el mismo color que lleva en el aro del reparto, en las
 * barras de «En qué está invertida» y en el mapa. Pensada para la clase de activo de una fila de tabla.
 *
 * El punto es decorativo y va oculto al lector de pantalla: el nombre lo dice todo, y el color solo lo enlaza con el
 * gráfico de al lado.
 *
 * ```tsx
 * <ClaseConColor clave={asset.economic_asset_class}>Renta variable</ClaseConColor>
 * <ClaseConColor color={ZONE_CHIP.america}>América</ClaseConColor>
 * ```
 */
export interface ClaseConColorProps {
  /** La clave de la clase de activo (`EQUITY`, `fixed_income`…): de ella sale el color. */
  clave?: string | null;
  /** El color, si no es una clase de activo (una zona del mapa). Manda sobre `clave`. */
  color?: string;
  children: ReactNode;
}

export function ClaseConColor({ clave, color, children }: ClaseConColorProps) {
  return (
    <span className="clase-con-color">
      {/* El color de la categoría: valor por dato, en tiempo de ejecución. */}
      <i aria-hidden="true" className="clase-con-color__punto" style={{ background: color ?? colorDeLaClase(clave) }} />
      {children}
    </span>
  );
}
