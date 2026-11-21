import type { ReactNode } from "react";

export type TonoDeAviso = "aviso" | "nota" | "error";

/**
 * Algo que el asesor debe saber: la pieza que sustituye a los 167 avisos escritos a mano con 36 clases.
 *
 * Tres tonos, cada uno con un significado fijo en toda la app (apartado 4 de `SISTEMA_DISENO.md`):
 *
 * | `tono`  | Color  | Cuándo                                                            |
 * |---------|--------|-------------------------------------------------------------------|
 * | `aviso` | ocre   | Pide la atención del asesor: una posición sin medir, un dato que falta |
 * | `nota`  | azul claro | Informa o confirma: «Diversificación correcta»                    |
 * | `error` | rojo   | Algo ha fallado: una carga, una validación                        |
 *
 * Una caja con borde de 1 px y fondo suave, los dos en el color del tono, y la esquina de pieza (`--radio-pieza`).
 * **Un aviso lleva siempre su palabra, nunca solo el color**: el `titulo` es esa palabra («Una posición sin medir.»),
 * en negrita y en el color del tono. Sin título, el lector de pantalla oye el tono delante («Aviso.»), y quien ve,
 * el texto.
 *
 * El de error se anuncia al aparecer (`role="alert"`); los demás, solo si se pide con `anunciar` (`role="status"`):
 * un aviso que ya estaba al cargar la pantalla no se grita.
 *
 * ```tsx
 * <Aviso tono="aviso" titulo="Una posición sin medir.">
 *   Vanguard S&P 500 UCITS ETF (12,0 %) queda fuera de la simulación.
 * </Aviso>
 * <Aviso tono="error" titulo="No se pudo cargar." accion={<Button size="sm" onClick={reintentar}>Reintentar</Button>}>
 *   El servidor no responde.
 * </Aviso>
 * ```
 */
export interface AvisoProps {
  /** `aviso` por defecto. */
  tono?: TonoDeAviso;
  /** La entrada en negrita, que es la palabra del aviso. Termina en punto. */
  titulo?: ReactNode;
  /** Un botón o un enlace, a la derecha: «Reintentar», «Ver las posiciones». */
  accion?: ReactNode;
  /** Pide que un aviso que no es de error se anuncie al aparecer. */
  anunciar?: boolean;
  className?: string;
  children?: ReactNode;
}

/** Lo que oye el lector cuando el aviso no trae título. */
const PALABRA_DEL_TONO: Record<TonoDeAviso, string> = {
  aviso: "Aviso.",
  nota: "Nota.",
  error: "Error."
};

/* Escritas enteras, y no `aviso--${tono}`: así el censo de CSS ve que cada regla tiene quien la use. */
const CLASE_DEL_TONO: Record<TonoDeAviso, string> = {
  aviso: "aviso--aviso",
  nota: "aviso--nota",
  error: "aviso--error"
};

export function Aviso({ tono = "aviso", titulo, accion, anunciar = false, className = "", children }: AvisoProps) {
  const role = tono === "error" ? "alert" : anunciar ? "status" : undefined;
  return (
    <div className={`aviso ${CLASE_DEL_TONO[tono]} ${className}`.trim()} role={role}>
      <div className="aviso__texto">
        {titulo ? <strong className="aviso__titulo">{titulo}</strong> : <span className="sr-only">{PALABRA_DEL_TONO[tono]} </span>}
        {titulo && children ? " " : null}
        {children}
      </div>
      {accion ? <div className="aviso__accion">{accion}</div> : null}
    </div>
  );
}
