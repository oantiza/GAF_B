/**
 * Puerta de `firebase.funciones.json`: hook `predeploy` de ese fichero. NO ESCRIBE NADA, ni en disco ni en red.
 *
 * Aborta el despliegue salvo que lo lance `scripts/desplegarFunciones.mjs`, que es el único que comprueba la lista
 * de funciones, el destino y el estado de Git. Sin esta puerta, `firebase deploy --config firebase.funciones.json`
 * a mano subiría las 26 funciones de `main.py` (46 hasta el 21-11-2026; hallazgo 4 de la auditoría del backend, 15-11-2026).
 *
 * Por qué no escribe: el `predeploy` de `firebase.json` (`syncContractsCache.mjs`) escribe en `functions_python`, y el
 * emulador de Functions, si está en marcha, vuelve a leer las funciones al ver el cambio, con un servidor en el puerto
 * 8081, el mismo del despliegue. Una prueba (`tests/desplegarFunciones.test.ts`) exige que esta puerta no use
 * ninguna función de escritura.
 *
 * Cómo sabe que viene del guion: éste pone `GESTOR_DESPLIEGUE_DESDE_GUION=1` al lanzar la CLI, y la CLI pasa su
 * entorno al hook (firebase-tools, lib/deploy/lifecycleHooks.js, getChildEnvironment: `Object.assign({}, process.env, …)`).
 * No es una barrera contra mala fe, que exportaría la variable; es contra el despliegue a mano por descuido. Y mira además
 * el destino, que no sale de una variable que ponga el operador sino de la que pone la CLI.
 *
 * Sale con 2 y no con 1: en Windows, cross-spawn toma cualquier salida 1 por «comando no encontrado» e imprime un
 * ENOENT falso tras el mensaje (mismo criterio que `4-base-nueva/puerta-despliegue.mjs`).
 */
import { pathToFileURL } from "node:url";

export const VARIABLE_DE_LA_PUERTA = "GESTOR_DESPLIEGUE_DESDE_GUION";

/**
 * El único proyecto al que despliega este fichero (auditoría 16-11-2026, SEG-2). La CLI pone en `GCLOUD_PROJECT` el destino que
 * ha resuelto, pisando lo que hubiera en el entorno (lifecycleHooks.js, getChildEnvironment): las otras dos puertas del
 * proyecto ya lo miraban y esta no. Con la variable del guion exportada en una sesión, un despliegue a mano hacia otro
 * proyecto pasaba. Una prueba exige que sea el mismo que el del guion.
 */
export const PROYECTO_DE_DESTINO = "bdb-gestor-de-activos";

/** Cero si el entorno trae la variable del guion y el destino es el proyecto de la base nueva; dos y el mensaje en otro caso. */
export function evaluaPuerta(entorno) {
  const destino = (entorno.GCLOUD_PROJECT || "").trim();
  if (entorno[VARIABLE_DE_LA_PUERTA] === "1" && destino === PROYECTO_DE_DESTINO) {
    return { codigo: 0, mensaje: `  funciones: lanzado desde scripts/desplegarFunciones.mjs, destino ${destino}. Adelante.` };
  }
  if (entorno[VARIABLE_DE_LA_PUERTA] === "1") {
    return {
      codigo: 2,
      mensaje: [
        "",
        "  DESPLIEGUE DE FUNCIONES BLOQUEADO",
        destino === ""
          ? "  No se pudo determinar el proyecto de destino: GCLOUD_PROJECT viene vacío."
          : `  Este fichero solo despliega a ${PROYECTO_DE_DESTINO}, y el destino es ${destino}.`,
        "",
      ].join("\n"),
    };
  }
  return {
    codigo: 2,
    mensaje: [
      "",
      "  DESPLIEGUE DE FUNCIONES BLOQUEADO",
      "  Este fichero de configuración solo se despliega con el guion, que sube las 23 funciones permitidas y no las 26:",
      "    node scripts/desplegarFunciones.mjs --despliega",
      "",
    ].join("\n"),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { codigo, mensaje } = evaluaPuerta(process.env);
  (codigo === 0 ? console.log : console.error)(mensaje);
  process.exit(codigo);
}
