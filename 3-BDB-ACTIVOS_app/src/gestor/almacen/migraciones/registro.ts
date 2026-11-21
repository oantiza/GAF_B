/**
 * Las migraciones del fichero de cartera: cómo se lleva un fichero de una versión del
 * formato a la siguiente.
 *
 * Hoy solo existe la versión 1 y el registro está vacío. Cuando el formato cambie de forma
 * que un fichero viejo ya no se lea bien tal cual, se añade una migración así:
 *
 *   1. Crear `migraciones/v1aV2.ts` con una función `Migracion` que reciba el objeto del
 *      fichero entero en la versión 1 y devuelva el de la versión 2. No debe tocar lo que
 *      no entiende (`cartera.extensiones` y cualquier campo desconocido se conservan) ni
 *      depender del reloj, de la red o del disco: es una transformación pura de datos.
 *   2. Registrarla aquí con la versión de ORIGEN como clave: `1: v1aV2`.
 *   3. Subir `VERSION_ACTUAL` en `formato.ts` a 2. Desde ese momento `serializar` escribe
 *      la versión 2 y `leer` lleva cualquier fichero de la 1 a la 2 al abrirlo.
 *   4. Si cambian los campos de `Cartera`, ajustar el orden de claves de `formato.ts` y su
 *      validación de estructura.
 *   5. Añadir su prueba en `tests/gestor/almacenFormato.test.ts` con un fichero de la
 *      versión anterior escrito como TEXTO dentro de la propia prueba (no generado con
 *      `serializar`, que ya escribe la versión nueva), y comprobar que `leer` lo devuelve
 *      migrado, con `versionOriginal: 1` y `migrada: true`.
 *
 * Una migración no se borra nunca mientras pueda quedar en un disco un fichero de su versión
 * de origen: la cadena se aplica paso a paso, de la versión del fichero a la actual, y si falta
 * un eslabón el fichero no se abre (`SIN_MIGRACION`).
 */

/** Lleva el contenido del fichero de la versión `n` a la `n + 1`. Recibe y devuelve el objeto del fichero entero. */
export type Migracion = (fichero: Record<string, unknown>) => Record<string, unknown>;

/** Clave: la versión de ORIGEN. `MIGRACIONES[1]` llevaría de la 1 a la 2. */
export type Migraciones = Readonly<Record<number, Migracion>>;

export const MIGRACIONES: Migraciones = {};
