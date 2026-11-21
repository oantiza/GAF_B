import { useSyncExternalStore } from "react";
import { leerLosMensajes, pausar, quitarMensaje, reanudar, suscribirseALosMensajes } from "./useMensaje";

/**
 * La región de los mensajes efímeros: confirma que algo se ha hecho («Guardado», «Copiado»). Se monta **una vez**, en
 * `src/App.tsx`; las pantallas no la montan, piden el mensaje con `useMensaje()`:
 *
 * ```tsx
 * const { decir } = useMensaje();
 * await guardar();
 * decir("Propuesta guardada");
 * ```
 *
 * - Es una región `aria-live="polite"` que está siempre en el documento, así que el lector de pantalla lee cada
 *   mensaje al llegar sin interrumpir lo que esté diciendo.
 * - Cada mensaje se va solo a los cuatro segundos; mientras el ratón o el foco están encima, espera. Se puede cerrar
 *   antes con su botón.
 * - No roba el foco: quien escribe sigue donde estaba.
 */
export function Mensajes() {
  const mensajes = useSyncExternalStore(suscribirseALosMensajes, leerLosMensajes, leerLosMensajes);
  return (
    <div aria-live="polite" className="mensajes">
      {mensajes.map((mensaje) => (
        <div
          className="mensaje"
          key={mensaje.id}
          onBlur={(evento) => {
            if (!evento.currentTarget.contains(evento.relatedTarget as Node | null)) reanudar(mensaje.id);
          }}
          onFocus={() => pausar(mensaje.id)}
          onMouseEnter={() => pausar(mensaje.id)}
          onMouseLeave={() => reanudar(mensaje.id)}
        >
          <p className="mensaje__texto">{mensaje.texto}</p>
          {/* Un nombre corto: va dentro de la región que se anuncia, y repetir el texto haría que se oyera dos veces. */}
          <button aria-label="Cerrar el mensaje" className="mensaje__cerrar" onClick={() => quitarMensaje(mensaje.id)} type="button">
            <span aria-hidden="true">×</span>
          </button>
        </div>
      ))}
    </div>
  );
}
