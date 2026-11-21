/**
 * El almacén de los mensajes efímeros y el gancho que los pide. La región que los pinta es `<Mensajes />`
 * (`MensajeEfimero.tsx`), montada una sola vez en `src/App.tsx`.
 *
 * Vive fuera de React, en el módulo, para que cualquier pantalla pueda decir «Guardado» sin envolverse en un proveedor:
 * `const { decir } = useMensaje(); … decir("Guardado");`. Si la región no está montada, el mensaje no se ve y no pasa
 * nada más.
 */

export interface MensajeEfimero {
  id: number;
  texto: string;
}

/** Lo que dura un mensaje a la vista si nadie lo cierra ni lo tiene bajo el foco. */
export const DURACION_DEL_MENSAJE_MS = 4000;

let mensajes: readonly MensajeEfimero[] = [];
let siguienteId = 1;
const oyentes = new Set<() => void>();
const temporizadores = new Map<number, ReturnType<typeof setTimeout>>();

function avisar() {
  for (const oyente of oyentes) oyente();
}

function programar(id: number) {
  pausar(id);
  temporizadores.set(
    id,
    setTimeout(() => quitarMensaje(id), DURACION_DEL_MENSAJE_MS)
  );
}

/** Para la cuenta atrás de un mensaje: mientras el ratón o el foco están en él, no se va. */
export function pausar(id: number) {
  const temporizador = temporizadores.get(id);
  if (temporizador !== undefined) clearTimeout(temporizador);
  temporizadores.delete(id);
}

/** Vuelve a contar los cuatro segundos desde cero. */
export function reanudar(id: number) {
  if (mensajes.some((mensaje) => mensaje.id === id)) programar(id);
}

export function quitarMensaje(id: number) {
  pausar(id);
  const antes = mensajes.length;
  mensajes = mensajes.filter((mensaje) => mensaje.id !== id);
  if (mensajes.length !== antes) avisar();
}

/** Pone un mensaje, que se va solo a los cuatro segundos. */
export function decir(texto: string) {
  const id = siguienteId++;
  mensajes = [...mensajes, { id, texto }];
  programar(id);
  avisar();
}

export function suscribirseALosMensajes(oyente: () => void) {
  oyentes.add(oyente);
  return () => {
    oyentes.delete(oyente);
  };
}

export function leerLosMensajes(): readonly MensajeEfimero[] {
  return mensajes;
}

/** Para las pruebas: deja el almacén vacío. */
export function vaciarLosMensajes() {
  for (const id of temporizadores.keys()) pausar(id);
  mensajes = [];
  avisar();
}

/**
 * `decir(texto)` confirma que algo se ha hecho: «Guardado», «Copiado», «Descargado». Solo para eso; un error o algo que
 * el asesor tiene que leer con calma es un `Aviso`, que no se va solo.
 */
export function useMensaje(): { decir: (texto: string) => void } {
  return GANCHO;
}

const GANCHO = { decir };
