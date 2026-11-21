/**
 * Quién es el asesor en ESTE proyecto, y de quién viene cada cartera.
 *
 * ───────────────────────────────────────────────────────────────────────────────────────
 * POR QUÉ EL DUEÑO NO SE HEREDA DE LA FUENTE
 *
 * Las reglas conceden una cartera comparando su `advisor_id` con el uid de la sesión. Y un uid
 * identifica a una persona **dentro de un proyecto**: el mismo asesor tiene uno distinto en
 * cada uno. Las carteras que vienen de BDB traen el suyo de allí, que aquí no es nadie.
 *
 * Copiarlo tal cual escribe documentos que nadie puede leer: el asesor entra y ve «ninguna
 * cartera guardada», con la base entera dentro. Pasó el 11-07-2026 en BDB, cuando una rotación
 * de credenciales recreó la cuenta con uid nuevo, y
 * `3-BDB-ACTIVOS_app/functions_python/scripts/migrate_portfolios_uid.py` existe por eso.
 *
 * Así que la fuente dice **a quién reconocer** y este fichero dice **quién es aquí**. Un uid de
 * origen que no esté en el mapa para la cartera: asignarla al único asesor que hay sería
 * inventarse de quién es, y de quién es una cartera no se supone.
 *
 * MEDIDO el 03-11-2026: el Auth de `bdb-gestor-de-activos` tiene un usuario,
 * `ZrsncU5WDMXdmwZWFpVgdYniOcg1` (oantiza@gmail.com), creado desde la consola. El uid de origen
 * es el de Óscar en BDB, verificado en el navegador el 11-07-2026.
 * ───────────────────────────────────────────────────────────────────────────────────────
 */

/** Óscar, en el proyecto nuevo. Sale de su Auth, no de ningún fichero de la fuente. */
export const ASESOR_DE_LA_BASE_NUEVA = 'ZrsncU5WDMXdmwZWFpVgdYniOcg1';

/**
 * Qué uid de origen es quién aquí.
 *
 * Es un mapa y no una constante porque el día que haya un segundo asesor, o que se traiga
 * trabajo de otra base, la pregunta «¿de quién era esto?» seguirá teniendo respuesta.
 */
const EQUIVALENCIAS: Readonly<Record<string, string>> = {
    /* Óscar en BDB (`bbdd-activos-financieros`). */
    QMte7jgYd4PdutS3bLLXfY5uKzo1: ASESOR_DE_LA_BASE_NUEVA
};

/** El uid que le toca aquí, o `undefined` si ese uid de origen no es nadie de este proyecto. */
export function asesorEnLaBaseNueva(uidDeOrigen: string): string | undefined {
    return EQUIVALENCIAS[uidDeOrigen];
}
