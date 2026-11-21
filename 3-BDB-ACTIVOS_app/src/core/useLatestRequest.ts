import { useEffect, useState } from "react";

/**
 * Control de «gana la última petición» (ALTA-12, auditoría 16-10-2026).
 *
 * Cada `begin()` devuelve un identificador nuevo e invalida los anteriores;
 * `isCurrent(id)` dice si la respuesta de esa petición sigue siendo la vigente.
 * `invalidate()` descarta la petición en vuelo sin abrir otra (p. ej. al cerrar
 * el panel que la esperaba). Así una respuesta lenta de A no pisa la de B ni
 * reabre lo que el usuario ya cerró.
 */
export interface LatestRequest {
  begin: () => number;
  isCurrent: (id: number) => boolean;
  invalidate: () => void;
}

export function createLatestRequest(): LatestRequest {
  let current = 0;
  return {
    begin: () => {
      current += 1;
      return current;
    },
    isCurrent: (id) => id === current,
    invalidate: () => {
      current += 1;
    }
  };
}

/** Versión hook: objeto estable durante la vida del componente; al desmontar,
    ninguna petición en vuelo sigue siendo vigente. */
export function useLatestRequest(): LatestRequest {
  const [request] = useState(createLatestRequest);
  useEffect(() => () => request.invalidate(), [request]);
  return request;
}
