/**
 * El nombre de la casa en pantalla. Decisión 23 de Óscar (04-11-2026).
 *
 * Había seis firmas en pantalla: OAA, BDB Activos, Fundamental Intelligence e Independent
 * Private Bankers, según dónde se mirara. Queda una, y queda en un solo sitio para que el
 * menú, el acceso y la pestaña del navegador no vuelvan a separarse.
 *
 * Solo pantalla. Los PDF tienen su sello en `src/reports/` y este fichero no se importa
 * desde allí: lo que firma y entrega un asesor no cambia de rebote.
 */
export const LINEAS_DE_LA_CASA = ["Independent", "Private Bankers"] as const;

export const NOMBRE_DE_LA_CASA = LINEAS_DE_LA_CASA.join(" ");

/** Lo que cabe en la caja de la marca, con el menú plegado. */
export const MONOGRAMA_DE_LA_CASA = "IPB";
