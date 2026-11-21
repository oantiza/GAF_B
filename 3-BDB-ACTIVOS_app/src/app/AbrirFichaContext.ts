import { createContext, useContext } from "react";

/**
 * Cómo se abre una ficha sin recargar la aplicación. Lo pone el marco, que es quien sabe de
 * direcciones y de qué pantalla se viene; lo usa `EnlaceAFicha`, desde cualquier tabla.
 *
 * Fuera del marco no hay nadie que lo ponga, y el enlace sigue funcionando como un enlace normal.
 */
export const AbrirFichaContext = createContext<((assetId: string) => void) | null>(null);

export function useAbrirFicha(): ((assetId: string) => void) | null {
  return useContext(AbrirFichaContext);
}
