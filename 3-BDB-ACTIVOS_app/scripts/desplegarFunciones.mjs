/**
 * Despliega en `bdb-gestor-de-activos` las Functions que la base nueva puede servir, y solo esas.
 *
 *   node scripts/desplegarFunciones.mjs             # comprueba y enseña qué haría. No despliega.
 *   node scripts/desplegarFunciones.mjs --despliega # lo hace. Lo lanza Óscar.
 *
 * Usa `firebase.funciones.json`, que solo declara Functions: así este despliegue no puede pisar
 * las reglas ni el sitio, que salen de `4-base-nueva`. `firebase.json` sigue cerrado con su puerta.
 *
 * Por qué una lista y no todas: de las 26 funciones de `main.py`, las tres programadas de informes
 * (`scheduled_publish_weekly_report`, `scheduled_publish_daily_report`, `scheduled_recover_strategy_reports`)
 * no entran: la automatización de informes está apagada por decisión de Óscar (03-11-2026). Las que piden
 * claves de Secret Manager no se pueden desplegar sin crearlas antes, y por eso solo entran las de `SECRETOS`,
 * que ya existen en este proyecto.
 *
 * Hasta el 21-11-2026 `main.py` declaraba 46. Las 20 que trabajaban con la forma de la base vieja (`assets`,
 * `metrics/latest`, `meta/*`) —`get_system_status`, once `admin_*` y ocho programadas de precios, métricas,
 * integridad, índice y VL revisados— no estaban en esta lista y se borraron del código ese día (decisión 31 del
 * censo `CENSO_BASE_VIEJA_2026-11-21.md`). Seis de ellas (`get_system_status` y cinco `admin_*` de lectura)
 * habían estado desplegadas y se borraron de la nube el 15-11-2026 (A-146, `67906a6d`, comprobado entonces),
 * junto con las cuatro de «Análisis rápido de extractos» y `get_portfolio`, que la web publicada no llamaba.
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
 * El valor de `variable` en el contenido de un fichero de entorno, o `undefined` si no la declara. Lee como la CLI de Firebase:
 * gana la última línea, una línea comentada no cuenta, admite `export` y espacios alrededor del `=`, y el valor puede llevar
 * comillas o un comentario detrás.
 */
export function valorEnElEntorno(contenido, variable) {
  let valor;
  for (const linea of contenido.split(/\r?\n/)) {
    const encontrada = new RegExp(`^\\s*(?:export\\s+)?${variable}\\s*=\\s*(.*)$`).exec(linea);
    if (encontrada) valor = encontrada[1].replace(/\s+#.*$/, "").trim().replace(/^(["'])(.*)\1$/, "$2");
  }
  return valor;
}

/**
 * El valor que verá la función desplegada (P2-09, 21-11-2026). Al desplegar, la CLI carga `.env` y después `.env.<proyecto>`,
 * que manda donde declaran lo mismo: hay que leer los dos, en ese orden, y no solo el del proyecto. `contenidos` va en ese orden;
 * un fichero que no existe se pasa como `undefined`.
 */
export function valorEfectivo(contenidos, variable) {
  let valor;
  for (const contenido of contenidos) {
    const suyo = contenido === undefined ? undefined : valorEnElEntorno(contenido, variable);
    if (suyo !== undefined) valor = suyo;
  }
  return valor;
}

/** Los ISIN de `isins` que el contenido de un fichero de entorno no libera en `variable`. */
export function liberacionesQueFaltan(contenido, variable, isins) {
  const liberados = new Set((valorEnElEntorno(contenido, variable) ?? "").split(",").map((isin) => isin.trim()));
  return isins.filter((isin) => !liberados.has(isin));
}

/**
 * La variable que abría las escrituras de la forma vieja (`write_governance.py`, borrado el 21-11-2026 con la base vieja).
 * Ya no la lee nadie, y se sigue rechazando con valor: un entorno que la declare viene de antes, o de una copia equivocada.
 */
export const ESCRITURAS_VIEJAS = "BDB_ACTIVOS_ENABLE_MASTER_WRITES";

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
  const leer = (fichero) => (existsSync(fichero) ? readFileSync(fichero, "utf8") : undefined);
  /* Los dos que carga la CLI al desplegar, en su orden: el del proyecto manda sobre el común. */
  const entornos = [leer(dotenv), leer(delProyecto)];
  for (const [i, fichero] of [dotenv, delProyecto].entries()) {
    if (entornos[i] !== undefined && valorEnElEntorno(entornos[i], "FIRESTORE_EMULATOR_HOST") !== undefined) {
      motivos.push(`${fichero} declara FIRESTORE_EMULATOR_HOST: en la nube buscaría un emulador`);
    }
  }
  if (entornos[1] === undefined) {
    motivos.push(`falta ${delProyecto}`);
  } else {
    if (valorEfectivo(entornos, "MASTER_PROJECT_ID") !== PROYECTO) {
      motivos.push(`.env.${PROYECTO} no declara MASTER_PROJECT_ID=${PROYECTO}`);
    }
    /* Con cualquier valor, y mirando también `.env`: la función solo las abre con la frase entera, pero un valor aquí es o
       esa frase o una equivocación, y antes solo se veía `=YES` al principio de línea y en el fichero del proyecto. */
    const escrituras = valorEfectivo(entornos, ESCRITURAS_VIEJAS);
    if (escrituras !== undefined && escrituras !== "") {
      motivos.push(`el entorno del despliegue declara ${ESCRITURAS_VIEJAS} con valor: abriría las escrituras viejas`);
    }
    /* Ese fichero no está en Git, y la línea ya se perdió una vez sin que nadie se enterara: nueve instrumentos reparados se
       quedaron fuera de toda simulación. Sin ella nada se rompe, y por eso se mira aquí. La lista está versionada. */
    const { variable, isins } = JSON.parse(readFileSync(join(app, "functions_python", "verified_price_repair_releases.json"), "utf8"));
    const liberados = new Set((valorEfectivo(entornos, variable) ?? "").split(",").map((isin) => isin.trim()));
    const faltan = isins.filter((isin) => !liberados.has(isin));
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
  /* H3-04 (22-11-2026): los contratos se sincronizan ANTES de comprobar que Git está limpio. Sincronizar escribe en
     `functions_python/contracts_cache`, que se despliega: hecho después de la comprobación, subía contratos que ningún commit
     apuntaba. Así, si la sincronización cambia algo, la comprobación lo ve y exige el commit. Solo con `--despliega`: sin él
     el guion no escribe nada. */
  if (process.argv.includes("--despliega")) {
    const contratos = spawnSync("node", ["scripts/syncContractsCache.mjs", "--check"], { cwd: app, encoding: "utf8" });
    if (contratos.status !== 0) {
      console.log("Sincronizando contratos y esperando 30 s a que el emulador termine de releer...");
      const sync = spawnSync("node", ["scripts/syncContractsCache.mjs"], { cwd: app, stdio: "inherit" });
      if (sync.status !== 0) process.exit(2);
      await new Promise((resuelve) => setTimeout(resuelve, 30000));
    }
  }
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
    /* `status` es null cuando el proceso no llegó a arrancar (`error`) o lo mataron (`signal`): antes eso salía como «terminado
       con null» y sin causa, y es la forma en que un despliegue se corta «sin error». */
    const causa = r.error ? `no se pudo lanzar: ${r.error.message}` : r.signal ? `lo cortó la señal ${r.signal}` : `terminó con el código ${r.status}`;
    console.error(`\nEl despliegue no se completó (${causa}): no se apunta. Si se cortó, repítelo.`);
  }
  process.exit(r.status ?? 2);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
