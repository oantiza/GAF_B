/**
 * src/config/projectAllowlist.ts — el ÚNICO sitio donde viven los project id de Firestore
 * autorizados, y para qué está autorizado cada uno.
 *
 * Por qué existe: hasta el 30-10-2026 este valor estaba copiado como literal en dieciséis
 * ficheros y con dos ortografías distintas (`ALLOWED_PROJECT_IDS` con un Set, y
 * `const PROJECT_ID` con un `!==`). Heredados del clon, los dieciséis nombraban el
 * proyecto real de BDB, `bbdd-activos-financieros`, con dos efectos malos a la vez:
 * ninguna etapa de escritura arrancaba aquí, y el arreglo intuitivo ante el error
 * —apuntar `FIREBASE_PROJECT_ID` al proyecto de BDB— habría puesto al clon a escribir en
 * la maestra de producción. Al corregirlos, un grep de la primera ortografía se dejó
 * cinco. Con una sola constante eso no puede volver a pasar.
 *
 * Esta barrera NO depende de variables de entorno: está en el código, así que una
 * variable mal puesta no la abre. Es la octava barrera de aislamiento del `README.md`.
 *
 * ## Dos proyectos, y por qué no un conjunto con los dos dentro (01-11-2026)
 *
 * Desde el paso B del plan de independencia hay **dos** bases, cada una en su proyecto y en
 * su emulador: la de siempre y la nueva. La forma fácil de hacerle sitio a la nueva era
 * meter su id en `ALLOWED_PROJECT_IDS` y seguir. Está mal, y mal de la misma manera que los
 * cinco defectos del 01-11: con las dos dentro del mismo conjunto, un `FIREBASE_PROJECT_ID`
 * equivocado escribe los documentos de la base nueva en el proyecto de la vieja, la
 * comprobación lo autoriza, el escritor dice que todo fue bien, y lo escrito es
 * perfectamente válido salvo en que está en la base que no es. Ninguna auditoría lo detecta,
 * porque cada documento es correcto.
 *
 * Así que los dos id están aquí, pero **separados por papel**: cada escritor conoce el suyo
 * y rechaza el otro. Ampliar la barrera no es ensancharla.
 *
 * Lo que NO va aquí: `restoreBackupToEmulator.ts`, `subirALaNube.ts` y
 * `verReglasDesplegadas.ts` nombran el proyecto de BDB **para prohibirlo**. Esos literales
 * dicen otra cosa y se quedan donde están, declarados uno a uno en la prueba que barre los
 * repositorios: `3-BDB-ACTIVOS_app/tests/barreraDeBdb.test.ts`. Para Python, esta misma pareja
 * de proyectos vive en `3-BDB-ACTIVOS_app/functions_python/master_project.py`, y esa prueba
 * falla si dejan de coincidir.
 */

/**
 * El proyecto de la base **de siempre**: el clon sembrado de la copia de la maestra de BDB.
 * Era el que autorizaba todo el camino de escritura heredado (`load:fondosdb`,
 * `republish:fondosdb`, `audit:consistency` y los scripts de mantenimiento).
 *
 * **Desde el 21-11-2026 no lo importa ningún programa.** Ese camino se borró con la base vieja
 * (decisiones 30 a 39 de Óscar, sobre `CENSO_BASE_VIEJA_2026-11-21.md`; el estado anterior está en
 * la etiqueta de Git `referencia-base-vieja-2026-11-21`). Se queda a propósito, por tres razones:
 * es la pareja de `PROYECTO_BASE_DE_SIEMPRE` de `functions_python/master_project.py`, que se
 * conserva como defecto seguro (un id que no existe en la nube) y que
 * `3-BDB-ACTIVOS_app/tests/barreraDeBdb.test.ts` compara con este; sin el conjunto, la prueba que
 * impide meter el id real en él (`tests/projectAllowlist.test.ts`) no tendría qué vigilar; y si
 * algún día vuelve una comprobación contra la base de siempre, tiene que encontrar aquí la
 * separación por papel y no reinventarla.
 *
 * Se llama `ALLOWED_PROJECT_ID` y no `PROYECTO_BASE_VIEJA` porque así lo nombraban las
 * dieciséis comprobaciones que lo importaban, y la prueba que barre los repositorios lo busca
 * con ese nombre.
 */
export const ALLOWED_PROJECT_ID = 'gestor-activos-local';

/** Misma cosa en forma de conjunto, para los sitios que comprueban con `.has()`. */
export const ALLOWED_PROJECT_IDS: ReadonlySet<string> = new Set<string>([ALLOWED_PROJECT_ID]);

/** `true` solo si el project id es exactamente el de la base de siempre. */
export function isAllowedProjectId(projectId: string | undefined | null): boolean {
    return typeof projectId === 'string' && ALLOWED_PROJECT_IDS.has(projectId);
}

/**
 * El proyecto de la **base nueva**, F0 del plan de ejecución (01-11-2026).
 *
 * Es el proyecto **real** que Óscar creó en Firebase, no un nombre de laboratorio, y se usa
 * tal cual en el emulador a propósito: el emulador no comprueba credenciales y acepta
 * cualquier id, así que el ensayo local queda idéntico al destino de verdad y no hay un
 * renombrado pendiente el día que llegue la clave de servicio.
 *
 * **Y por eso este id es peligroso de un modo que el anterior no era.** Hasta hoy, el id
 * autorizado aquí no existía en la nube: una credencial de más no podía hacer daño porque no
 * había a dónde escribir. La mitad de la barrera era que el nombre fuese falso. Con un
 * proyecto real, eso desaparece, y lo único que separa este código de una escritura en la
 * nube es que la conexión vaya al emulador. Por eso la obliga el escritor, en código
 * (`HOST_EMULADOR_BASE_NUEVA`, puesta por `obtenerDb`), y no una variable de entorno.
 *
 * Consecuencia que no se puede relajar: **este id no entra en `ALLOWED_PROJECT_IDS`**. Ese
 * conjunto lo consultaban seis comprobaciones (contadas el 20-11-2026: `auditConsistency`,
 * `reclassifyStock`, `republish`, `writer`, `runCarterasDryRun` y `runCompactPriceSeries`, borradas
 * el 21-11-2026 con la base vieja) que luego llamaban a `initializeApp` **sin exigir emulador**.
 * Hoy no lo consulta ninguna, pero la regla sigue: cualquiera que lo use para autorizar una
 * conexión hereda esa forma, y meter aquí un proyecto real la dejaría escribiendo en la nube en
 * cuanto exista una clave. `tests/projectAllowlist.test.ts` falla si alguien los junta.
 */
export const PROYECTO_BASE_NUEVA = 'bdb-gestor-de-activos';

/**
 * Dónde escucha el emulador de la base nueva. Está aquí, al lado del id, por dos razones.
 *
 * La primera: las dos cosas juntas son el destino completo, y un id correcto contra el puerto
 * de la base vieja escribiría en la base equivocada igual de bien.
 *
 * La segunda, desde que el id es de un proyecto real: **esto es lo único que dice «local»**.
 * El id ya no lo dice. Si esta constante deja de imponerse, el mismo código apunta a la nube.
 */
export const HOST_EMULADOR_BASE_NUEVA = '127.0.0.1:8092';

/**
 * Dónde escucha el emulador de la base DE SIEMPRE, la sembrada de la copia de la maestra.
 *
 * Está aquí por lo mismo que la de arriba: lo que separa las dos bases es **el puerto**, no el
 * id de proyecto —los dos emuladores arrancan en `singleProjectMode` y sirven con cualquier
 * id—, así que el puerto merece un nombre y no quedarse suelto en un script.
 *
 * Y una advertencia sobre su uso: esto es para **leer** una copia de la maestra. Desde el 21-11-2026
 * lo usa solo `scripts/restoreBackupToEmulator.ts` (decisión 33: la única vía para abrir esas copias
 * en un Firestore), que siembra aquí y se niega a sembrar en el puerto de la base nueva.
 * Nada que escriba la base nueva debe apuntar aquí: el escritor de la base nueva impone su propio host, y esa
 * imposición es la que hace que una equivocación de entorno no acabe en la base equivocada.
 */
export const HOST_EMULADOR_BASE_DE_SIEMPRE = '127.0.0.1:8082';

/** `true` solo si el project id es exactamente el de la base nueva. */
export function esProyectoBaseNueva(projectId: string | undefined | null): boolean {
    return projectId === PROYECTO_BASE_NUEVA;
}
