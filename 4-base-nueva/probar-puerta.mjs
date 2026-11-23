/**
 * 4-base-nueva/probar-puerta.mjs — comprueba la puerta del despliegue SIN desplegar.
 *
 *   node 4-base-nueva/probar-puerta.mjs
 *
 * Invoca `puerta-despliegue.mjs` como lo hace la CLI —proceso aparte, con el entorno
 * puesto a mano— y mira el codigo de salida y el mensaje. No hay red, no hay despliegue.
 *
 * El cuarto caso existe por si mismo: comprueba que esto es una lista de PERMITIDOS y no
 * una prohibicion del proyecto de BDB. Una prohibicion dejaria pasar cualquier tercer
 * proyecto que apareciera manana, y ese es el fallo que no se veria hasta que pasara.
 *
 * Y el quinto itera sobre las claves del PROPIO firebase.json en vez de sobre una lista
 * escrita a mano, para que anadir un objetivo de despliegue nuevo sin puerta rompa esta
 * comprobacion. El test equivalente de la app hace lo mismo desde el 03-11-2026.
 *
 * LO QUE NO COMPRUEBA, dicho a proposito: que la CLI ponga de verdad `GCLOUD_PROJECT` con
 * el proyecto resuelto. Eso se midio el 03-11-2026 ejecutando su codigo de hooks
 * (docs/historico-bdb/AUDITORIA_2026-11-03.md, al final), y una actualizacion de firebase-tools podria
 * cambiarlo: aqui solo se invoca la puerta directamente.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const PUERTA = join(AQUI, "puerta-despliegue.mjs");
const PERMITIDO = "bdb-gestor-de-activos";

/* Claves de firebase.json que son objetivos de DESPLIEGUE. `emulators` no lo es. */
const OBJETIVOS_DESPLEGABLES = new Set([
  "hosting", "functions", "firestore", "database", "storage",
  "remoteconfig", "extensions", "dataconnect", "apphosting",
]);

function invoca(proyecto, puerta = PUERTA) {
  const env = { ...process.env };
  delete env.GCLOUD_PROJECT;
  if (proyecto !== undefined) env.GCLOUD_PROJECT = proyecto;
  const r = spawnSync(process.execPath, [puerta], { env, encoding: "utf8" });
  return { codigo: r.status, salida: (r.stdout || "") + (r.stderr || "") };
}

let fallos = 0;
function caso(nombre, condicion, visto) {
  if (condicion) {
    console.log(`  OK    ${nombre}`);
  } else {
    fallos += 1;
    console.log(`  FALLA ${nombre}`);
    console.log(`        visto: ${String(visto).replace(/\s+/g, " ").trim().slice(0, 160)}`);
  }
}

console.log("\n== La puerta del despliegue de la base nueva ==\n");

const bueno = invoca(PERMITIDO);
caso(`con ${PERMITIDO} -> pasa`, bueno.codigo === 0 && /permitido/.test(bueno.salida), `codigo ${bueno.codigo}: ${bueno.salida}`);
console.log(`        dice: ${bueno.salida.trim()}`);

const bdb = invoca("bbdd-activos-financieros");
caso("con el proyecto de BDB -> rechaza y lo nombra",
  bdb.codigo === 2 && /BDB/.test(bdb.salida) && /EN USO/.test(bdb.salida),
  `codigo ${bdb.codigo}: ${bdb.salida}`);

const vacio = invoca(undefined);
caso("sin proyecto -> rechaza (falla cerrada)",
  vacio.codigo === 2 && /falla cerrada/.test(vacio.salida),
  `codigo ${vacio.codigo}: ${vacio.salida}`);

const tercero = invoca("un-proyecto-que-aparece-manana");
caso("con un tercer proyecto -> rechaza (es lista de permitidos, no prohibicion)",
  tercero.codigo === 2, `codigo ${tercero.codigo}: ${tercero.salida}`);

const config = JSON.parse(readFileSync(join(AQUI, "firebase.json"), "utf8"));
const sinPuerta = Object.keys(config)
  .filter((clave) => OBJETIVOS_DESPLEGABLES.has(clave))
  .filter((clave) => !(config[clave].predeploy || []).some((c) => c.includes("puerta-despliegue.mjs")));
caso("todos los objetivos de despliegue de firebase.json llevan la puerta",
  sinPuerta.length === 0, `sin puerta: ${sinPuerta.join(", ") || "(ninguno)"}`);

/* Cabeceras: la puerta se ejecuta en una copia temporal con un firebase.json estropeado. */
function conFirebaseJson(modificar) {
  const dir = mkdtempSync(join(tmpdir(), "puerta-"));
  try {
    copyFileSync(PUERTA, join(dir, "puerta-despliegue.mjs"));
    copyFileSync(join(AQUI, ".firebaserc"), join(dir, ".firebaserc"));
    const copia = structuredClone(config);
    modificar(copia);
    writeFileSync(join(dir, "firebase.json"), JSON.stringify(copia));
    return invoca(PERMITIDO, join(dir, "puerta-despliegue.mjs"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const cspDe = (cfg) => cfg.hosting.headers.find((r) => r.source === "**").headers.find((h) => h.key === "Content-Security-Policy");

const sinCabeceras = conFirebaseJson((c) => { delete c.hosting.headers; });
caso("sin cabeceras -> rechaza", sinCabeceras.codigo === 2 && /cabeceras/.test(sinCabeceras.salida), `codigo ${sinCabeceras.codigo}: ${sinCabeceras.salida}`);

/* P2-08 (21-11-2026): HSTS entra en la lista de la puerta. Hosting ya lo sirve por su cuenta; esto
   asegura que la intención está escrita y no depende de un valor por defecto de otro. */
const sinHsts = conFirebaseJson((c) => {
  const global = c.hosting.headers.find((r) => r.source === "**");
  global.headers = global.headers.filter((h) => h.key !== "Strict-Transport-Security");
});
caso("sin Strict-Transport-Security -> rechaza", sinHsts.codigo === 2 && /Strict-Transport-Security/.test(sinHsts.salida), `codigo ${sinHsts.codigo}: ${sinHsts.salida}`);

const cspDeBdb = conFirebaseJson((c) => { cspDe(c).value = cspDe(c).value.replace(`${PERMITIDO}.firebaseapp.com`, "bbdd-activos-financieros.firebaseapp.com"); });
caso("con el dominio de acceso de BDB en la CSP -> rechaza", cspDeBdb.codigo === 2 && /CSP/.test(cspDeBdb.salida), `codigo ${cspDeBdb.codigo}: ${cspDeBdb.salida}`);

/* Si la politica de la app cambia, esta debe revisarse: difieren solo en el dominio de acceso. */
const app = JSON.parse(readFileSync(join(AQUI, "..", "3-BDB-ACTIVOS_app", "firebase.json"), "utf8"));
const esperadas = JSON.stringify(app.hosting.headers).replace("bbdd-activos-financieros.firebaseapp.com", `${PERMITIDO}.firebaseapp.com`);
caso("las cabeceras son las de la app, salvo el dominio de acceso", JSON.stringify(config.hosting.headers) === esperadas, "difieren de 3-BDB-ACTIVOS_app/firebase.json");

console.log(fallos === 0 ? "\n  Todas las comprobaciones pasan.\n" : `\n  ${fallos} fallan.\n`);
process.exit(fallos === 0 ? 0 : 1);
