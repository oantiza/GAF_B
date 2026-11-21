import { Children, cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from "react";

/**
 * El campo de formulario: rótulo, control, pista y error, enlazados para el lector de pantalla.
 *
 * Hoy se escribe a mano 87 veces (inventario de la auditoría), y en muchas el rótulo no apunta al control o el error
 * no se anuncia al llegar al campo. Esta pieza envuelve **un solo control** —un `input`, un `select`, un `textarea` o
 * un `EuroAmountInput`— y le pone lo que el lector necesita:
 *
 * - `id`, para que el rótulo lo nombre (`<label htmlFor>`). Si el control ya trae uno, se respeta.
 * - `aria-describedby`, con la pista y el error, en ese orden, más lo que el control ya describiera.
 * - `aria-invalid`, cuando hay error.
 *
 * Usa las clases que ya existen (`field`, `field__label`, `field__hint`, `field__error`): no cambia el aspecto de los
 * campos de hoy. Lo único que añade es el borde rojo del control con error, que sale de `aria-invalid`.
 *
 * ```tsx
 * <Campo rotulo="Capital" pista="En euros, sin decimales" error={errorDeCapital}>
 *   <EuroAmountInput value={capital} onCommit={setCapital} />
 * </Campo>
 * ```
 */
export interface CampoProps {
  /** El rótulo, que nombra al control. */
  rotulo: ReactNode;
  /** Una línea de ayuda bajo el control: qué se escribe y cómo. */
  pista?: ReactNode;
  /** El error, en lenguaje llano. Con él, el control queda marcado como no válido. */
  error?: ReactNode;
  /** Añade «(opcional)» al rótulo. */
  opcional?: boolean;
  className?: string;
  /** Un solo control. */
  children: ReactElement<PropiedadesDelControl>;
}

/** Lo que la pieza lee y escribe en el control. */
interface PropiedadesDelControl {
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean | "true" | "false";
}

export function Campo({ rotulo, pista, error, opcional = false, className = "", children }: CampoProps) {
  const generado = useId();
  const control = Children.only(children);
  if (!isValidElement<PropiedadesDelControl>(control)) {
    throw new Error("Campo envuelve un solo control: un input, un select, un textarea o un EuroAmountInput.");
  }
  const id = control.props.id ?? `${generado}-control`;
  const idDeLaPista = `${generado}-pista`;
  const idDelError = `${generado}-error`;
  const hayError = error !== undefined && error !== null && error !== false && error !== "";
  const describe = [control.props["aria-describedby"], pista ? idDeLaPista : undefined, hayError ? idDelError : undefined]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={`field ${className}`.trim()}>
      <label className="field__label" htmlFor={id}>
        {rotulo}
        {opcional ? " (opcional)" : null}
      </label>
      {cloneElement(control, {
        id,
        "aria-describedby": describe || undefined,
        "aria-invalid": hayError ? true : control.props["aria-invalid"]
      })}
      {pista ? (
        <p className="field__hint" id={idDeLaPista}>
          {pista}
        </p>
      ) : null}
      {hayError ? (
        <p className="field__error" id={idDelError}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
