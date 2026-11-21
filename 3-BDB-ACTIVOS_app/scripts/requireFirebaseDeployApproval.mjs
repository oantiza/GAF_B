/**
 * Puerta del despliegue de la app: hook `predeploy` de cada objetivo de firebase.json. Si no
 * sale con 0, la CLI aborta antes de subir nada.
 *
 * Hoy esta carpeta no tiene ningún destino legítimo en la nube, y por eso la lista está vacía:
 *   - El sitio y las reglas de `bdb-gestor-de-activos` salen de 4-base-nueva. Las reglas de
 *     aquí no nombran `instruments` ni `advisor_id`, y `dist/` no es el sitio que se publica:
 *     desplegarlos pisaría los buenos.
 *   - Las Functions no tienen decisión tomada, y su .env apunta al emulador.
 *   - `gestor-activos-local` no existe en la nube: es del emulador, donde esto no corre.
 *
 * Hasta el 03-11-2026 esta puerta pedía una frase y con ella autorizaba cualquier destino, el
 * proyecto de BDB incluido. La frase se retiró: añadir un id a esta lista es la aprobación, y
 * queda en el historial.
 *
 * El destino sale de GCLOUD_PROJECT, que la CLI pisa con el proyecto que ha resuelto
 * (firebase-tools, lib/deploy/lifecycleHooks.js), así que exportarlo a mano no engaña a esta
 * puerta. Comprobado ejecutando ese código de la CLI. Si falta, rechaza.
 *
 * Sale con 2 y no con 1: en Windows, cross-spawn —con el que la CLI lanza el hook— toma
 * cualquier salida 1 por «comando no encontrado» e imprime un ENOENT falso tras el mensaje.
 */
const PERMITIDOS = [];
const PROYECTO_DE_BDB = "bbdd-activos-financieros";

function rechaza(...lineas) {
  console.error(["Firebase deploy blocked for BDB-ACTIVOS.", ...lineas].join("\n"));
  process.exit(2);
}

const destino = (process.env.GCLOUD_PROJECT || "").trim();
if (!destino) {
  rechaza(
    "No se pudo determinar el proyecto destino: GCLOUD_PROJECT viene vacio.",
    "Falla cerrada a proposito: sin saber a donde, no se despliega.",
    "(Ejecutando este fichero a mano es lo esperado: la variable la pone la CLI.)"
  );
}

if (!PERMITIDOS.includes(destino)) {
  rechaza(
    `Destino: ${destino}.`,
    destino === PROYECTO_DE_BDB
      ? "Ese es el proyecto de BDB, que esta EN USO. Esta app no despliega ahi."
      : "Desde esta carpeta no se despliega a ningun proyecto.",
    "El sitio, las reglas y los indices se despliegan desde 4-base-nueva."
  );
}

console.log(`  app: destino ${destino}, permitido. Adelante.`);
