/**
 * DIS-03: el servidor no ha guardado porque la guardada ya no es la que se abrió. Va en un módulo propio, y no
 * en `portfolioBackend.ts`, para que quien simula ese adaptador en una prueba no tenga que simular también esto.
 */
import { AppError } from "../core/appError";

export type MotivoDelConflicto = "cambiada" | "eliminada";

const TEXTO: Record<MotivoDelConflicto, string> = {
  cambiada: "No se ha guardado: la cartera guardada ha cambiado desde que la abriste, se ha guardado desde otra pestaña u otro equipo.",
  eliminada: "No se ha guardado: la cartera guardada ya no existe, se ha eliminado desde otra pestaña u otro equipo."
};

export class ConflictoAlGuardar extends AppError {
  motivo: MotivoDelConflicto;
  /** La fecha de modificación de la que hay ahora en el servidor, si la hay. */
  actualUpdatedAt?: string;

  constructor(motivo: MotivoDelConflicto, actualUpdatedAt?: string, cause?: unknown) {
    super("BACKEND", TEXTO[motivo], cause === undefined ? undefined : { cause });
    this.name = "ConflictoAlGuardar";
    this.motivo = motivo;
    if (actualUpdatedAt) this.actualUpdatedAt = actualUpdatedAt;
  }
}

const esObjeto = (valor: unknown): valor is Record<string, unknown> => typeof valor === "object" && valor !== null;

/**
 * El conflicto, si el error es el que responde `save_portfolio` (`functions_python/main.py`): código `aborted` y
 * `details.code === "PORTFOLIO_CONFLICT"`. `callBackend` lo envuelve en un AppError y el error del SDK, con su
 * `details`, queda en `cause`; se mira en los dos sitios. Cualquier otra cosa es un fallo, y se devuelve null.
 */
export function conflictoDelGuardado(error: unknown): ConflictoAlGuardar | null {
  if (error instanceof ConflictoAlGuardar) return error;
  const original = error instanceof AppError && error.cause !== undefined ? error.cause : error;
  if (!esObjeto(original) || !String(original.code ?? "").toLowerCase().includes("aborted")) return null;
  const detalle = original.details;
  if (!esObjeto(detalle) || detalle.code !== "PORTFOLIO_CONFLICT") return null;
  const actual = typeof detalle.current_updated_at === "string" ? detalle.current_updated_at : undefined;
  /* Un motivo que no se reconoce sigue siendo un conflicto: el servidor no ha escrito nada. */
  return new ConflictoAlGuardar(detalle.reason === "deleted" ? "eliminada" : "cambiada", actual, original);
}
