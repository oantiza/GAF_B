/**
 * Un anuncio para el lector de pantalla, sin nada que se vea: «Trabajando…» cuando un botón se pone a trabajar.
 *
 * Usa una sola región `aria-live="polite"`, oculta a la vista, que se crea la primera vez y se queda en el documento.
 * El texto se escribe un instante después de vaciarla: una región que ya existe y cambia es lo que los lectores leen
 * de forma fiable, y vaciarla antes hace que el mismo anuncio dos veces seguidas se oiga las dos.
 *
 * No es para mensajes que se ven (eso es `useMensaje`) ni para errores (eso es `Aviso` con tono `error`).
 */
let region: HTMLElement | null = null;
let pendiente: ReturnType<typeof setTimeout> | undefined;

/** Lo que tarda en escribirse el anuncio después de vaciar la región. */
export const ESPERA_DEL_ANUNCIO_MS = 50;

export function anunciar(texto: string) {
  if (typeof document === "undefined") return;
  if (!region || !region.isConnected) {
    region = document.createElement("div");
    region.className = "sr-only";
    region.setAttribute("aria-live", "polite");
    region.setAttribute("data-anunciador", "");
    document.body.appendChild(region);
  }
  const destino = region;
  destino.textContent = "";
  if (pendiente !== undefined) clearTimeout(pendiente);
  pendiente = setTimeout(() => {
    destino.textContent = texto;
  }, ESPERA_DEL_ANUNCIO_MS);
}
