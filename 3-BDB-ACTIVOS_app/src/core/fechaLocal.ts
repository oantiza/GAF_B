/**
 * El día en que se genera un documento, en la hora de quien lo genera.
 *
 * Los informes guardan el instante en UTC (`toISOString`) y lo imprimían en UTC: entre medianoche y las dos de la
 * mañana salía la fecha de ayer en la portada de lo que firma el asesor. El instante se queda como está, porque es el
 * dato; lo que cambia es de qué día se dice que es.
 *
 * Devuelve el día como `AAAA-MM-DD`, que es lo que ya escriben `fmtDate` y sus parientes sin mover la fecha. `zona` es
 * un huso de la IANA, y sin ella el del navegador: existe para que la prueba no dependa del ordenador donde corra.
 */
export function diaLocal(instante: string, zona?: string): string | null {
  const texto = instante.trim();
  /* Una fecha sin hora ya es un día: pasarla por el huso la movería al anterior al oeste de Greenwich. */
  if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) return texto;
  const fecha = new Date(texto);
  if (Number.isNaN(fecha.getTime())) return null;
  const partes = new Intl.DateTimeFormat("en-CA", { timeZone: zona, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(fecha);
  const parte = (tipo: Intl.DateTimeFormatPartTypes) => partes.find((p) => p.type === tipo)?.value;
  return `${parte("year")}-${parte("month")}-${parte("day")}`;
}
