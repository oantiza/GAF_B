/**
 * 4-base-nueva/puerta-despliegue.mjs — hook `predeploy` de esta carpeta.
 *
 * Lo declara firebase.json en cada objetivo. Si este fichero no sale con 0, la CLI aborta
 * y no se despliega nada. Hasta el 03-11-2026 esta carpeta no tenia puerta ninguna, y es
 * la unica que alcanza un proyecto REAL: la app, que si la tiene, apunta por defecto a
 * `gestor-activos-local`, que no existe en la nube.
 *
 * Es una LISTA DE PERMITIDOS DE UNO, no una prohibicion. Rechazar solo el proyecto de
 * BDB dejaria pasar cualquier tercer proyecto que apareciera manana.
 *
 * El id vive AQUI, en la barrera, y no se toma de `.firebaserc`: si saliera de ahi,
 * editar un fichero de configuracion moveria la barrera, que es exactamente el defecto
 * que se cerro en C-1. Pero dos copias del mismo id son dos sitios donde cambiar uno y
 * olvidar el otro, asi que esta puerta COMPARA las dos y aborta si discrepan. El
 * `.firebaserc` es configuracion; esto es barrera, y la barrera comprueba que la
 * configuracion no se ha movido por debajo.
 *
 * De donde sale el destino, MEDIDO y no supuesto: la CLI construye el entorno del hook
 * con `Object.assign({}, process.env, { GCLOUD_PROJECT: projectId, ... })`
 * (firebase-tools, lib/deploy/lifecycleHooks.js, getChildEnvironment), donde projectId
 * es `needProjectId(options)` —el proyecto que de verdad ha resuelto, venga de
 * `--project`, de `firebase use` (que manda sobre el `.firebaserc`), de un alias o del
 * `.firebaserc`—. Al asignarse DESPUES de volcar `process.env`, sobrescribe cualquier
 * valor que haya puesto el operador: exportar `GCLOUD_PROJECT` a mano no engana a esta
 * puerta. Se comprobo ejecutando ese codigo de la CLI instalada, con el valor mentido.
 *
 * Sale con 2 y no con 1: en Windows, cross-spawn —con el que la CLI lanza el hook— toma
 * cualquier salida 1 por "comando no encontrado" e imprime un ENOENT falso tras el mensaje.
 *
 * Y FALLA CERRADA: si no puede determinar el destino, rechaza. Un hook que ante la duda
 * deja pasar es decoracion.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PERMITIDOS = ["bdb-gestor-de-activos"];
const PROYECTO_DE_BDB = "bbdd-activos-financieros";
const AQUI = dirname(fileURLToPath(import.meta.url));
const CABECERAS = [
  "Content-Security-Policy", "X-Content-Type-Options", "X-Frame-Options", "Referrer-Policy",
  "Permissions-Policy", "Cross-Origin-Opener-Policy", "Cache-Control",
];

function rechaza(...lineas) {
  console.error(["", "  DESPLIEGUE BLOQUEADO - base nueva", ...lineas.map((l) => "  " + l), ""].join("\n"));
  process.exit(2);
}

/* 1. La configuracion no se ha movido por debajo de la barrera. */
let declarado;
try {
  declarado = JSON.parse(readFileSync(join(AQUI, ".firebaserc"), "utf8"))?.projects?.default;
} catch (error) {
  rechaza(
    `No se pudo leer .firebaserc: ${error.message}`,
    "Sin saber que proyecto declara esta carpeta, no se despliega."
  );
}
if (declarado !== PERMITIDOS[0]) {
  rechaza(
    `.firebaserc declara "${declarado}" y esta puerta permite "${PERMITIDOS[0]}".`,
    "Discrepan, asi que una de las dos se ha movido. Si el cambio es correcto,",
    "actualiza PERMITIDOS en este fichero: es la barrera, y se cambia a la vista."
  );
}

/* 2. El destino real, puesto por la CLI. */
const destino = (process.env.GCLOUD_PROJECT || "").trim();

/* 3. Falla cerrada. */
if (!destino) {
  rechaza(
    "No se pudo determinar el proyecto destino: GCLOUD_PROJECT viene vacio.",
    "Esta puerta falla cerrada a proposito: sin saber a donde, no se despliega.",
    "(Ejecutando este fichero a mano, esto es lo esperado: la variable la pone",
    " la CLI al lanzar el hook.)"
  );
}

/* 4. Y el destino es el unico permitido. */
if (!PERMITIDOS.includes(destino)) {
  rechaza(
    `Destino: ${destino}`,
    destino === PROYECTO_DE_BDB
      ? "Ese es el proyecto de BDB, que esta EN USO. Esta carpeta no despliega ahi."
      : "Esta carpeta despliega a un solo proyecto, y ese no es.",
    `Permitido: ${PERMITIDOS.join(", ")}`
  );
}

/* 5. El sitio no sale sin sus cabeceras. Se comprueba aqui porque esto corre en cada despliegue:
 * el test de cabeceras de la app solo lee el firebase.json de la app, y el sitio no sale de alli. */
let config;
try {
  config = JSON.parse(readFileSync(join(AQUI, "firebase.json"), "utf8"));
} catch (error) {
  rechaza(`No se pudo leer firebase.json: ${error.message}`);
}
if (config.hosting) {
  const cabeceras = config.hosting.headers?.find((regla) => regla.source === "**")?.headers ?? [];
  const faltan = CABECERAS.filter((clave) => !cabeceras.some((h) => h.key === clave));
  if (faltan.length > 0) {
    rechaza(`El sitio saldria sin estas cabeceras de seguridad: ${faltan.join(", ")}.`);
  }
  const csp = cabeceras.find((h) => h.key === "Content-Security-Policy").value;
  if (csp.includes(PROYECTO_DE_BDB) || !csp.includes(`https://${destino}.firebaseapp.com`)) {
    rechaza(`La CSP debe nombrar el dominio de acceso de ${destino} y no el de BDB: sin el, falla el acceso con Google.`);
  }
}

console.log(`  base nueva: destino ${destino}, permitido. Adelante.`);
