/**
 * El camino a la base nueva: cuál se usa y cuándo.
 *
 * Son dos, y el reparto es por ENTORNO y no por configuración. En desarrollo, REST contra el
 * emulador de la base nueva (8092) con `Bearer owner`, un token que solo el emulador acepta y
 * que salta las reglas. En producción, el SDK contra el proyecto real, con la sesión del
 * asesor, que es lo que las reglas comprueban.
 *
 * Lo que estas pruebas fijan es que **no se puedan cruzar**: ni el camino de desarrollo existe
 * en producción —ahí ese token no vale nada— ni el del SDK se usa en desarrollo, donde el SDK
 * de la aplicación apunta al emulador del OTRO proyecto, que es una base distinta.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const PROYECTO_NUEVO = "bdb-gestor-de-activos";

async function cargar(opciones: { dev: boolean; projectId: string | undefined; emuladores?: boolean }) {
    vi.resetModules();
    vi.stubEnv("DEV", opciones.dev);
    vi.stubEnv("PROD", !opciones.dev);
    vi.doMock("../src/firebaseEnv", () => ({
        firebaseConfig: { projectId: opciones.projectId },
        FIREBASE_CONFIGURED: opciones.projectId !== undefined,
        PRODUCCION_SIN_CONFIGURAR: false,
        APUNTA_A_BDB: false,
        FUNCTIONS_REGION: "europe-west1",
        USE_EMULATORS: opciones.emuladores === true
    }));
    vi.doMock("../src/firebase", () => ({ auth: null, firestore: null, functions: null }));
    return await import("../src/adapters/baseNuevaLectura");
}

afterEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock("../src/firebaseEnv");
    vi.doUnmock("../src/firebase");
    vi.resetModules();
});

describe("el camino a la base nueva", () => {
    it("en desarrollo hay camino, apunte donde apunte la aplicacion", async () => {
        /* El emulador de la base nueva es suyo y no depende de a qué proyecto apunte el
           resto de la aplicación: en desarrollo se lee siempre. */
        const conElViejo = await cargar({ dev: true, projectId: "gestor-activos-local" });
        expect(conElViejo.BASE_NUEVA_DISPONIBLE).toBe(true);

        const conElNuevo = await cargar({ dev: true, projectId: PROYECTO_NUEVO });
        expect(conElNuevo.BASE_NUEVA_DISPONIBLE).toBe(true);
    });

    it("en produccion solo hay camino si la aplicacion es la de ese proyecto", async () => {
        const sinConfigurar = await cargar({ dev: false, projectId: undefined });
        expect(sinConfigurar.BASE_NUEVA_DISPONIBLE).toBe(false);

        /* Configurada contra el proyecto VIEJO no hay camino, y es lo correcto: el SDK
           hablaría con otra base de datos, no con esta. */
        const conElViejo = await cargar({ dev: false, projectId: "gestor-activos-local" });
        expect(conElViejo.BASE_NUEVA_DISPONIBLE).toBe(false);

        const conElNuevo = await cargar({ dev: false, projectId: PROYECTO_NUEVO });
        expect(conElNuevo.BASE_NUEVA_DISPONIBLE).toBe(true);
    });

    it("en desarrollo contra los emuladores del proyecto nuevo se lee por el SDK, como en la nube (21-11-2026)", async () => {
        /* El desarrollo local usa el proyecto de la base nueva: el SDK habla con su emulador
           con la sesión del usuario local y las reglas de la nube. */
        const local = await cargar({ dev: true, projectId: PROYECTO_NUEVO, emuladores: true });
        expect(local.LEE_LA_NUBE).toBe(true);

        /* Sin emuladores, en desarrollo nunca el SDK: leería la nube real. */
        const sinEmuladores = await cargar({ dev: true, projectId: PROYECTO_NUEVO, emuladores: false });
        expect(sinEmuladores.LEE_LA_NUBE).toBe(false);

        /* Configurado contra la base vieja, el SDK apunta a otra base: REST contra 8092. */
        const conElViejo = await cargar({ dev: true, projectId: "gestor-activos-local", emuladores: true });
        expect(conElViejo.LEE_LA_NUBE).toBe(false);
    });

    it("en produccion sin conexion, la lectura lo DICE en vez de callar, en palabras llanas", async () => {
        /* `firestore` es null porque la aplicación no se configuró. La lectura tiene que
           fallar con un motivo, no devolver una lista vacía: una lista vacía se lee como
           «no hay instrumentos». Lo que lee el asesor no lleva el id del proyecto ni el
           nombre de la variable (FMT-22): eso va a la consola del desarrollador. */
        const registro = vi.spyOn(console, "error").mockImplementation(() => undefined);
        const { leerDocumento } = await cargar({ dev: false, projectId: PROYECTO_NUEVO });
        const { MENSAJE_SIN_CONEXION } = await import("../src/adapters/baseNuevaLecturaSdk");
        const fallo = await leerDocumento("instruments/ES0105836003").then(
            () => undefined,
            (error: unknown) => error as Error
        );
        expect(fallo?.message).toBe(MENSAJE_SIN_CONEXION);
        expect(fallo?.message).not.toMatch(/VITE_|bdb-gestor|conexion|aplicacion/);
        expect(fallo?.message).toMatch(/base de datos/);
        expect(registro.mock.calls.flat().join(" ")).toMatch(/VITE_FIREBASE_PROJECT_ID/);
        registro.mockRestore();
    });
});
