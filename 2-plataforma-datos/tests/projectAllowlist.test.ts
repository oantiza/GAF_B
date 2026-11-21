import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import {
    ALLOWED_PROJECT_ID,
    ALLOWED_PROJECT_IDS,
    HOST_EMULADOR_BASE_NUEVA,
    PROYECTO_BASE_NUEVA,
    esProyectoBaseNueva,
    isAllowedProjectId
} from '../src/config/projectAllowlist';

const BDB_PROJECT_ID = 'bbdd-activos-financieros';

/**
 * Estas pruebas son la red de la octava barrera de aislamiento: que el proyecto de BDB
 * no pueda volver a colarse en una comprobación, ni por un literal copiado ni por un
 * cambio distraído de la constante.
 */
describe('allowlist de project id', () => {
    it('autoriza el clon y solo el clon', () => {
        expect(ALLOWED_PROJECT_ID).toBe('gestor-activos-local');
        expect([...ALLOWED_PROJECT_IDS]).toEqual(['gestor-activos-local']);
    });

    it('rechaza el proyecto real de BDB', () => {
        expect(isAllowedProjectId(BDB_PROJECT_ID)).toBe(false);
        expect(ALLOWED_PROJECT_IDS.has(BDB_PROJECT_ID)).toBe(false);
    });

    it('el proyecto de la base nueva es OTRO, y las dos comprobaciones no se solapan', () => {
        // Dos razones, y la segunda es la grave.
        //
        // Una: no es un conjunto con dos id dentro. Si lo fuera, un FIREBASE_PROJECT_ID
        // equivocado escribiria la base nueva en el proyecto de la vieja y la comprobacion lo
        // autorizaria, con cada documento perfectamente valido y ninguna auditoria capaz de
        // verlo.
        //
        // Dos: `bdb-gestor-de-activos` es un proyecto REAL en la nube. ALLOWED_PROJECT_IDS lo
        // consultan catorce comprobaciones que despues llaman a initializeApp SIN exigir
        // emulador; hoy eso es inofensivo solo porque `gestor-activos-local` no existe en la
        // nube. Meter el proyecto real en ese conjunto las dejaria escribiendo fuera en cuanto
        // exista una clave de servicio. Esta prueba es la que no deja juntarlos.
        expect(PROYECTO_BASE_NUEVA).toBe('bdb-gestor-de-activos');
        expect(PROYECTO_BASE_NUEVA).not.toBe(ALLOWED_PROJECT_ID);
        expect(isAllowedProjectId(PROYECTO_BASE_NUEVA)).toBe(false);
        expect(ALLOWED_PROJECT_IDS.has(PROYECTO_BASE_NUEVA)).toBe(false);
        expect(esProyectoBaseNueva(ALLOWED_PROJECT_ID)).toBe(false);
    });

    it('el conjunto heredado sigue teniendo UN solo id, y es el que no existe en la nube', () => {
        // El tamano es la comprobacion: cualquiera que anada un segundo id a este conjunto
        // —el real de la base nueva, o cualquier otro— tiene que pasar por aqui y leer por que
        // no se hace.
        expect(ALLOWED_PROJECT_IDS.size).toBe(1);
        expect([...ALLOWED_PROJECT_IDS]).toEqual(['gestor-activos-local']);
    });

    it('la comprobacion de la base nueva rechaza BDB, lo ausente y lo vacio', () => {
        expect(esProyectoBaseNueva(BDB_PROJECT_ID)).toBe(false);
        expect(esProyectoBaseNueva(undefined)).toBe(false);
        expect(esProyectoBaseNueva(null)).toBe(false);
        expect(esProyectoBaseNueva('')).toBe(false);
        expect(esProyectoBaseNueva('otro-proyecto')).toBe(false);
    });

    it('el emulador de la base nueva es loopback y no el puerto de la base vieja', () => {
        // El puerto forma parte del destino: un project id correcto contra el puerto de la
        // base vieja escribiria en la base equivocada igual de bien.
        expect(HOST_EMULADOR_BASE_NUEVA).toBe('127.0.0.1:8092');
        expect(HOST_EMULADOR_BASE_NUEVA.startsWith('127.0.0.1:')).toBe(true);
        expect(HOST_EMULADOR_BASE_NUEVA).not.toBe('127.0.0.1:8082');
    });

    it('la sonda de las Functions desplegadas mira el proyecto de aqui, no el de BDB', () => {
        const sonda = fs.readFileSync(
            path.resolve(__dirname, '..', 'scripts', 'runBdbDeployedFunctionsStockSmoke.ts'),
            'utf-8'
        );
        expect(sonda).toContain('const PROJECT = PROYECTO_BASE_NUEVA;');
        expect(sonda).not.toContain(BDB_PROJECT_ID);
    });

    it('rechaza lo ausente, lo vacio y cualquier otro proyecto', () => {
        expect(isAllowedProjectId(undefined)).toBe(false);
        expect(isAllowedProjectId(null)).toBe(false);
        expect(isAllowedProjectId('')).toBe(false);
        expect(isAllowedProjectId('otro-proyecto')).toBe(false);
    });

    it('ningun fichero de src ni de scripts repite el literal del proyecto de BDB, salvo los que lo nombran a proposito', () => {
        // Lo que esta prueba persigue es que nadie escriba ese literal como proyecto
        // AUTORIZADO. Nombrarlo diciendo otra cosa esta bien, y hay dos maneras de hacerlo:
        //
        //   - PROHIBIENDOLO. Las dos guardas de copias, y desde el 03-11-2026 los dos
        //     scripts que hablan con la nube de verdad: los dos comprueban la clave de
        //     servicio contra ese id para negarla, porque en la carpeta de claves hay dos y
        //     la otra abre la base de PRODUCCION de BDB.
        //   - COMO DOCUMENTACION. La cabecera de la propia allowlist, que lo nombra para
        //     explicar de donde viene la barrera, y `asesores.ts`, que dice de que proyecto
        //     venia el uid de origen de las carteras.
        //
        // Ninguna de las dos es "proyecto autorizado", que es la unica que importa. La sonda de
        // las Functions desplegadas estuvo en esta lista hasta el 05-11-2026 (decision 106):
        // ya no nombra a BDB, mira el proyecto de aqui. La prueba que barre todos los
        // repositorios es `3-BDB-ACTIVOS_app/tests/barreraDeBdb.test.ts`.
        const permitidos = new Set([
            path.join('src', 'config', 'projectAllowlist.ts'),
            path.join('src', 'config', 'baseNueva', 'asesores.ts'),
            path.join('scripts', 'restoreBackupToEmulator.ts'),
            path.join('scripts', 'runBackupExport.ts'),
            path.join('scripts', 'subirALaNube.ts'),
            path.join('scripts', 'verReglasDesplegadas.ts')
        ]);

        const raiz = path.resolve(__dirname, '..');
        const culpables: string[] = [];

        const recorrer = (dir: string) => {
            for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
                const completa = path.join(dir, entrada.name);
                if (entrada.isDirectory()) {
                    recorrer(completa);
                } else if (entrada.name.endsWith('.ts')) {
                    const relativa = path.relative(raiz, completa);
                    if (permitidos.has(relativa)) continue;
                    if (fs.readFileSync(completa, 'utf-8').includes(BDB_PROJECT_ID)) culpables.push(relativa);
                }
            }
        };

        for (const carpeta of ['src', 'scripts']) recorrer(path.join(raiz, carpeta));
        expect(culpables).toEqual([]);
    });
});
