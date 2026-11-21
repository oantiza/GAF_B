/**
 * Despliega en `bdb-gestor-de-activos` las Functions que la base nueva puede servir, y solo esas.
 *
 *   node scripts/desplegarFunciones.mjs             # comprueba y enseña qué haría. No despliega.
 *   node scripts/desplegarFunciones.mjs --despliega # lo hace. Lo lanza Óscar.
 *
 * Usa `firebase.funciones.json`, que solo declara Functions: así este despliegue no puede pisar
 * las reglas ni el sitio, que salen de `4-base-nueva`. `firebase.json` sigue cerrado con su puerta.
 *
 * Por qué una lista y no todas: de las 51 funciones de `main.py`, las programadas y los `admin_*` que
 * escriben trabajan con la forma de la base vieja (`assets`, `metrics`) y crearían esas colecciones
 * en la base nueva. Las que piden claves de Secret Manager no se pueden desplegar sin crearlas antes,
 * y por eso solo entran las de `SECRETOS`, que ya existen en este proyecto.
 *
 * Desde el 15-11-2026 (auditoría del backend, decisión de Óscar) tampoco entran once que la web publicada
 * no llama. Siguen en `main.py` y en el emulador local, que carga todas:
 *   - `get_system_status`, `admin_db_status`, `admin_list_assets`, `admin_asset_detail`, `admin_fund_quality` y
 *     `admin_backfill_candidates` leen `assets` y `meta`, que en la base nueva no existen: contestaban «0 activos»
 *     o «no encontrado», y sus pestañas ya estaban ocultas en la web publicada (`SECCIONES_DE_LA_NUBE`).
 *   - `analyze_real_portfolio`, `save_real_analysis`, `list_real_analyses` y `delete_real_analysis` eran de
 *     «Análisis rápido de extractos», pantalla retirada el 14-11-2026.
 *   - `get_portfolio`: la pantalla recibe las carteras enteras con `list_portfolios`.
 * Quitar una función de esta lista no la borra de la nube: eso es `firebase functions:delete`, y lo lanza Óscar.
 *
 * El emulador de Functions, si está en marcha, vigila esta misma carpeta. Al ver un cambio vuelve a
 * leer las funciones con un servidor en el puerto 8081, el mismo que usa el despliegue. Si coinciden,
 * el despliegue puede leer las de otro proyecto: pasó el 03-11-2026, con las cuentas de servicio de
 * `gestor-activos-local`. Por eso los contratos se sincronizan antes, solo si hace falta, y se espera.
 */
import { spawnSync } from "node:child_process";
import { connect } from "node:net";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const PROYECTO = "bdb-gestor-de-activos";

export const FUNCIONES = [
  "search_assets", "get_asset_detail", "get_asset_holdings", "get_asset_holdings_batch", "compare_assets",
  "resolve_portfolio", "optimize_portfolio", "get_price_series", "backtest_portfolio", "improve_portfolio", "generate_portfolio_draft",
  "get_macro_reference", "get_ecb_rates", "get_euro_yield_curve", "get_weekly_report", "get_economic_calendar",
  "save_portfolio", "list_portfolios", "delete_portfolio",
  "get_dividends_calendar", "get_earnings_calendar", "analyze_portfolio", "admin_publish_report"
];

/** Los secretos que este despliegue puede pedir. */
export const SECRETOS = ["GEMINI_API_KEY"];

/**
 * Los ISIN de `isins` que el contenido de un fichero de entorno no libera en `variable`. Lee como la CLI de Firebase: gana la
 * última línea, una línea comentada no cuenta, y el valor puede llevar comillas o un comentario detrás.
 */
export function liberacionesQueFaltan(contenido, variable, isins) {
  let valor = "";
  for (const linea of contenido.split(/\r?\n/)) {
    const encontrada = new RegExp(`^\\s*(?:export\\s+)?${variable}\\s*=\\s*(.*)$`).exec(linea);
    if (encontrada) valor = encontrada[1].replace(/\s+#.*$/, "").trim().replace(/^(["'])(.*)\1$/, "$2");
  }
  const liberados = new Set(valor.split(",").map((isin) => isin.trim()));
  return isins.filter((isin) => !liberados.has(isin));
}

/** Los fallos que impiden desplegar. Vacío: se puede. */
export function motivosParaNoDesplegar(app) {
  const motivos = [];
  const main = readFileSync(join(app, "functions_python", "main.py"), "utf8");
  for (const nombre of FUNCIONES) {
    const definicion = new RegExp(`@https_fn\\.on_call\\([^\\n]*\\)?[\\s\\S]{0,300}?\\ndef ${nombre}\\(`);
    if (!definicion.test(main)) motivos.push(`${nombre} no es una función invocable de main.py`);
  }

  /* El bloque de cada función de la lista no puede pedir secretos. */
  for (const nombre of FUNCIONES) {
    const inicio = main.indexOf(`\ndef ${nombre}(`);
    const decorador = main.slice(main.lastIndexOf("@https_fn.on_call", inicio), inicio);
    for (const pedido of decorador.match(/secrets=\[([^\]]*)\]/)?.[1].match(/[A-Z_]+/g) ?? []) {
      if (!SECRETOS.includes(pedido)) motivos.push(`${nombre} pide ${pedido}, que este despliegue no lleva`);
    }
  }

  const dotenv = join(app, "functions_python", ".env");
  const delProyecto = join(app, "functions_python", `.env.${PROYECTO}`);
  /* Se sube como variable de entorno. El cliente de Firestore comprueba `is not None`, así que
     en la nube buscaría un emulador, incluso con el valor vacío. */
  for (const fichero of [dotenv, delProyecto]) {
    if (existsSync(fichero) && /^\s*FIRESTORE_EMULATOR_HOST\s*=/m.test(readFileSync(fichero, "utf8"))) {
      motivos.push(`${fichero} declara FIRESTORE_EMULATOR_HOST: en la nube buscaría un emulador`);
    }
  }
  if (!existsSync(delProyecto)) {
    motivos.push(`falta ${delProyecto}`);
  } else {
    const contenido = readFileSync(delProyecto, "utf8");
    if (!new RegExp(`^MASTER_PROJECT_ID=${PROYECTO}\\s*$`, "m").test(contenido)) {
      motivos.push(`.env.${PROYECTO} no declara MASTER_PROJECT_ID=${PROYECTO}`);
    }
    if (/^(BDB_ACTIVOS_ENABLE_MASTER_WRITES)=YES/m.test(contenido)) {
      motivos.push(`.env.${PROYECTO} abre las escrituras viejas`);
    }
    /* Ese fichero no está en Git, y la línea ya se perdió una vez sin que nadie se enterara: nueve instrumentos reparados se
       quedaron fuera de toda simulación. Sin ella nada se rompe, y por eso se mira aquí. La lista está versionada. */
    const { variable, isins } = JSON.parse(readFileSync(join(app, "functions_python", "verified_price_repair_releases.json"), "utf8"));
    const faltan = liberacionesQueFaltan(contenido, variable, isins);
    if (faltan.length > 0) {
      motivos.push(`.env.${PROYECTO} no libera en ${variable}: ${faltan.join(", ")}. Sin ellos siguen en cuarentena, fuera de simulación y frontera`);
    }
  }

  const estado = spawnSync("git", ["status", "--porcelain", "--", "functions_python"], { cwd: app, encoding: "utf8" });
  if (estado.status !== 0) motivos.push("no se pudo mirar el estado de Git");
  else if (estado.stdout.trim() !== "") motivos.push("functions_python tiene cambios sin commit: se desplegaría algo sin registrar");
  return motivos;
}

/** Si algo escucha ya en un puerto local. */
function escucha(puerto) {
  return new Promise((resolver) => {
    const socket = connect({ host: "127.0.0.1", port: puerto, timeout: 1500 });
    const fin = (valor) => { socket.destroy(); resolver(valor); };
    socket.once("connect", () => fin(true));
    socket.once("error", () => fin(false));
    socket.once("timeout", () => fin(false));
  });
}

async function main() {
  const app = join(dirname(fileURLToPath(import.meta.url)), "..");
  const motivos = motivosParaNoDesplegar(app);
  console.log(`destino   : ${PROYECTO}`);
  console.log(`funciones : ${FUNCIONES.length}`);
  if (motivos.length > 0) {
    console.error("\nNo se despliega:");
    for (const motivo of motivos) console.error(`  - ${motivo}`);
    process.exit(2);
  }
  console.log("comprobaciones: todas bien");
  const solo = FUNCIONES.map((nombre) => `functions:${nombre}`).join(",");
  const argumentos = ["firebase", "deploy", "--config", "firebase.funciones.json", "--project", PROYECTO, "--only", solo];
  if (!process.argv.includes("--despliega")) {
    console.log("\nNADA desplegado. Con --despliega se ejecutaría:");
    console.log(`  npx ${argumentos.join(" ")}`);
    return;
  }
  const contratos = spawnSync("node", ["scripts/syncContractsCache.mjs", "--check"], { cwd: app, encoding: "utf8" });
  if (contratos.status !== 0) {
    console.log("Sincronizando contratos y esperando 30 s a que el emulador termine de releer...");
    const sync = spawnSync("node", ["scripts/syncContractsCache.mjs"], { cwd: app, stdio: "inherit" });
    if (sync.status !== 0) process.exit(2);
    await new Promise((resuelve) => setTimeout(resuelve, 30000));
  }
  if (await escucha(8081)) {
    console.error("\nNo se despliega: algo escucha en el puerto 8081, y el despliegue podría leer sus funciones.");
    process.exit(2);
  }
  /* SEG-3: qué commit se sube. Con `functions_python` sin cambios pendientes (se ha comprobado arriba), el commit lo dice todo. */
  const { commitDe, registrarDespliegue, REGISTRO_DE_DESPLIEGUES } = await import("../../4-base-nueva/version.mjs");
  const commit = commitDe(app);
  console.log(`commit    : ${commit.corto} · ${commit.fecha_del_commit}`);
  /* La puerta de `firebase.funciones.json` (scripts/puertaFunciones.mjs) solo deja pasar si ve esta variable. */
  const r = spawnSync("npx", argumentos, {
    cwd: app, stdio: "inherit", shell: process.platform === "win32",
    env: { ...process.env, GESTOR_DESPLIEGUE_DESDE_GUION: "1" },
  });
  if (r.status === 0) {
    registrarDespliegue({ que: "funciones", proyecto: PROYECTO, ...commit, funciones: FUNCIONES.length });
    console.log(`\nApuntado en ${REGISTRO_DE_DESPLIEGUES}: funciones desde ${commit.corto}.`);
  } else {
    console.error(`\nEl despliegue ha terminado con ${r.status}: no se apunta. Si se cortó, repítelo.`);
  }
  process.exit(r.status ?? 2);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
