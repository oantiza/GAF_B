import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

/**
 * Explica un término junto a él: «SRI», «Sharpe», «caída máxima». Sustituirá a los `title=` —que no se ven con el
 * teclado ni en una tableta— y a los botones de ayuda de 20 px.
 *
 * Es un botón «?» de 24 px como mínimo (el objetivo táctil que pide WCAG 2.2), con nombre accesible «Qué es …», que
 * abre y cierra una nota junto a él:
 *
 * - **Se abre** con clic, con un toque o con Intro o Espacio (es un `<button>`, y por eso funciona igual en tableta).
 * - **Se cierra** con Escape (el foco se queda en el botón), al volver a pulsarlo, al pulsar fuera o cuando el foco
 *   sale de la pieza.
 * - **Se anuncia**: la nota es una región `role="status"` que existe desde el principio y se llena al abrir, así que
 *   el lector de pantalla la lee sin que haya que ir a buscarla. El botón dice si está abierta (`aria-expanded`).
 *
 * Dentro de un diálogo, el Escape que cierra la nota no cierra también el diálogo.
 *
 * ```tsx
 * Riesgo (SRI) <NotaEmergente termino="el SRI">El indicador de riesgo del documento de datos fundamentales, de 1 a 7.</NotaEmergente>
 * ```
 */
export interface NotaEmergenteProps {
  /** El término que se explica, para el nombre del botón: «Qué es el SRI». */
  termino: string;
  /** Otro nombre para el botón, si «Qué es …» no encaja: «Cómo se calcula la rentabilidad». */
  nombre?: string;
  /** La explicación. Texto corto: una o dos frases. */
  children: ReactNode;
  className?: string;
}

export function NotaEmergente({ termino, nombre, children, className = "" }: NotaEmergenteProps) {
  const [abierta, setAbierta] = useState(false);
  const [haciaLaIzquierda, setHaciaLaIzquierda] = useState(false);
  const idDeLaNota = useId();
  const pieza = useRef<HTMLSpanElement>(null);
  const boton = useRef<HTMLButtonElement>(null);

  /* Pulsar fuera la cierra: en una tableta no hay «salir con el ratón», y sin esto la nota se quedaría abierta. */
  useEffect(() => {
    if (!abierta) return;
    const alPulsar = (evento: PointerEvent) => {
      if (pieza.current && evento.target instanceof Node && !pieza.current.contains(evento.target)) setAbierta(false);
    };
    document.addEventListener("pointerdown", alPulsar);
    return () => document.removeEventListener("pointerdown", alPulsar);
  }, [abierta]);

  const alTeclear = (evento: KeyboardEvent<HTMLSpanElement>) => {
    if (evento.key !== "Escape" || !abierta) return;
    /* Que no llegue al diálogo que la contiene: el Escape era para la nota. */
    evento.stopPropagation();
    setAbierta(false);
    boton.current?.focus();
  };

  return (
    <span
      className={`nota-emergente ${className}`.trim()}
      onBlur={(evento) => {
        if (!evento.currentTarget.contains(evento.relatedTarget as Node | null)) setAbierta(false);
      }}
      onKeyDown={alTeclear}
      ref={pieza}
    >
      <button
        aria-controls={idDeLaNota}
        aria-expanded={abierta}
        aria-label={nombre ?? `Qué es ${termino}`}
        className="nota-emergente__boton"
        onClick={(evento) => {
          /* En la mitad derecha de la ventana, la nota crece hacia la izquierda: si no, se saldría por el borde (o la
             recortaría la banda de la respuesta, que recorta de lado). */
          const caja = evento.currentTarget.getBoundingClientRect();
          setHaciaLaIzquierda(caja.left > window.innerWidth / 2);
          setAbierta((antes) => !antes);
        }}
        ref={boton}
        type="button"
      >
        <span aria-hidden="true">?</span>
      </button>
      <span
        className={haciaLaIzquierda ? "nota-emergente__nota nota-emergente__nota--izquierda" : "nota-emergente__nota"}
        id={idDeLaNota}
        role="status"
      >
        {abierta ? children : null}
      </span>
    </span>
  );
}
