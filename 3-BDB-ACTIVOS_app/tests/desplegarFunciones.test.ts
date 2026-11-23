import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { evaluaPuerta, PROYECTO_DE_DESTINO, VARIABLE_DE_LA_PUERTA } from "../scripts/puertaFunciones.mjs";
import {
  ESCRITURAS_VIEJAS,
  liberacionesQueFaltan,
  motivosParaNoDesplegar,
  PROYECTO,
  valorEfectivo,
  valorEnElEntorno
} from "../scripts/desplegarFunciones.mjs";

const main = readFileSync("functions_python/main.py", "utf8");
const guion = readFileSync("scripts/desplegarFunciones.mjs", "utf8");
const lista = [...guion.slice(guion.indexOf("FUNCIONES = ["), guion.indexOf("];", guion.indexOf("FUNCIONES = ["))).matchAll(/"([a-z_0-9]+)"/g)].map((m) => m[1]);

describe("el despliegue acotado de Functions", () => {
  test("ninguna programada, y los únicos secretos son los de la lista", () => {
    expect(lista.length).toBeGreaterThan(20);
    for (const nombre of lista) {
      const inicio = main.indexOf(`\ndef ${nombre}(`);
      expect(inicio, nombre).toBeGreaterThan(0);
      const decorador = main.slice(main.lastIndexOf("@", main.lastIndexOf("@https_fn", inicio)), inicio);
      expect(decorador, nombre).toContain("on_call");
      for (const pedido of decorador.match(/secrets=\[([^\]]*)\]/)?.[1].match(/[A-Z_]+/g) ?? []) {
        expect(["GEMINI_API_KEY"], nombre).toContain(pedido);
      }
    }
  });

  test("ningún admin que escriba, salvo el que publica el informe", () => {
    /* Escribe solo su colección de informes y su estado: la forma vieja no le afecta. */
    expect(lista).toContain("admin_publish_report");
    for (const nombre of lista.filter((n) => n.startsWith("admin_") && n !== "admin_publish_report")) {
      const inicio = main.indexOf(`\ndef ${nombre}(`);
      expect(main.slice(main.lastIndexOf("@https_fn", inicio), inicio), nombre).not.toContain("WRITER_SERVICE_ACCOUNT");
    }
  });

  test("ninguna que la web publicada no llame (auditoría del backend, 15-11-2026)", () => {
    /* Las de administración que leen `assets` y `meta` contestaban «0 activos» sobre la base nueva; las de
       «Análisis rápido» se quedaron sin pantalla el 14-11. Volver a subir una es decidirlo, no arrastrarla. */
    expect(lista.filter((n) => n.startsWith("admin_"))).toEqual(["admin_publish_report"]);
    for (const retirada of ["get_system_status", "get_portfolio", "analyze_real_portfolio", "save_real_analysis", "list_real_analyses", "delete_real_analysis"]) {
      expect(lista, retirada).not.toContain(retirada);
    }
    expect(lista).toHaveLength(23);
  });

  test("main.py declara 26 y solo se quedan fuera las tres programadas de informes (21-11-2026)", () => {
    /* Hasta el 21-11-2026 eran 46: las 20 de la base vieja se borraron del código (decisión 31 del censo de la base vieja). */
    const declaradas = [...main.matchAll(/^@(?:https_fn\.on_call|scheduler_fn\.on_schedule)\([\s\S]*?\ndef ([a-z_0-9]+)\(/gm)].map((m) => m[1]);
    expect(declaradas).toHaveLength(26);
    expect(new Set(declaradas).size).toBe(26);
    for (const nombre of lista) expect(declaradas, nombre).toContain(nombre);
    expect(declaradas.filter((n) => !lista.includes(n)).sort()).toEqual([
      "scheduled_publish_daily_report", "scheduled_publish_weekly_report", "scheduled_recover_strategy_reports",
    ]);
    for (const borrada of ["get_system_status", "admin_db_status", "admin_refresh_prices", "scheduled_refresh_prices", "scheduled_integrity_check"]) {
      expect(declaradas, borrada).not.toContain(borrada);
    }
    expect(evaluaPuerta({}).mensaje).toContain("sube las 23 funciones permitidas y no las 26");
  });

  test("su configuración no puede tocar reglas ni sitio", () => {
    expect(Object.keys(JSON.parse(readFileSync("firebase.funciones.json", "utf8")))).toEqual(["functions"]);
  });

  test("su predeploy es solo la puerta, y la puerta no escribe en disco (el de firebase.json sí escribe y el emulador lo ve)", () => {
    expect(JSON.parse(readFileSync("firebase.funciones.json", "utf8")).functions.predeploy).toEqual(["node scripts/puertaFunciones.mjs"]);
    const puerta = readFileSync("scripts/puertaFunciones.mjs", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(puerta).not.toMatch(/writeFile|appendFile|mkdir|rmSync|unlink|rename|copyFile|createWriteStream|spawn|exec/);
    expect(puerta).not.toMatch(/node:fs|node:child_process/);
  });

  test("la puerta: sin la variable aborta con 2 y dice la orden; con ella pasa", () => {
    const sin = evaluaPuerta({});
    expect(sin.codigo).toBe(2);
    expect(sin.mensaje).toContain("node scripts/desplegarFunciones.mjs --despliega");
    expect(evaluaPuerta({ [VARIABLE_DE_LA_PUERTA]: "0", GCLOUD_PROJECT: PROYECTO_DE_DESTINO }).codigo).toBe(2);
    expect(evaluaPuerta({ [VARIABLE_DE_LA_PUERTA]: "1", GCLOUD_PROJECT: PROYECTO_DE_DESTINO }).codigo).toBe(0);
  });

  /* Auditoría 16-11-2026 (SEG-2): con la variable del guion exportada, un despliegue a mano hacia otro proyecto pasaba. */
  test("la puerta mira también el destino: otro proyecto, o ninguno, no pasa aunque venga la variable", () => {
    expect(PROYECTO_DE_DESTINO).toBe(PROYECTO);
    const otro = evaluaPuerta({ [VARIABLE_DE_LA_PUERTA]: "1", GCLOUD_PROJECT: "gestor-activos-local" });
    expect(otro.codigo).toBe(2);
    expect(otro.mensaje).toContain("Este fichero solo despliega a bdb-gestor-de-activos, y el destino es gestor-activos-local.");
    const ninguno = evaluaPuerta({ [VARIABLE_DE_LA_PUERTA]: "1" });
    expect(ninguno.codigo).toBe(2);
    expect(ninguno.mensaje).toContain("GCLOUD_PROJECT viene vacío");
    expect(evaluaPuerta({ [VARIABLE_DE_LA_PUERTA]: "1", GCLOUD_PROJECT: "  " }).codigo).toBe(2);
  });

  test("ejecutada como la CLI: sin la variable o sin el destino sale con 2; con los dos, con 0", () => {
    const base = { ...process.env };
    delete base[VARIABLE_DE_LA_PUERTA];
    delete base.GCLOUD_PROJECT;
    expect(spawnSync("node", ["scripts/puertaFunciones.mjs"], { env: base, encoding: "utf8" }).status).toBe(2);
    expect(spawnSync("node", ["scripts/puertaFunciones.mjs"], { env: { ...base, [VARIABLE_DE_LA_PUERTA]: "1" }, encoding: "utf8" }).status).toBe(2);
    expect(spawnSync("node", ["scripts/puertaFunciones.mjs"], { env: { ...base, [VARIABLE_DE_LA_PUERTA]: "1", GCLOUD_PROJECT: PROYECTO_DE_DESTINO }, encoding: "utf8" }).status).toBe(0);
  });

  test("el guion pone la variable que la puerta exige al lanzar la CLI", () => {
    expect(guion).toContain(`${VARIABLE_DE_LA_PUERTA}: "1"`);
  });

  test("sin --despliega no ejecuta el despliegue", () => {
    expect(guion).toContain('process.argv.includes("--despliega")');
  });
});

/* La lista versionada, y no una copia. Si no son nueve o cambia alguno, lo dice la prueba de Python contra las cuarentenas. */
const { variable, isins } = JSON.parse(readFileSync("functions_python/verified_price_repair_releases.json", "utf8")) as { variable: string; isins: string[] };

describe("la línea que libera lo reparado (decisión 58)", () => {
  /* El motivo real, con un fichero de entorno de prueba: el de verdad no está en Git. */
  function motivoConElEntorno(contenido: string | null): string | undefined {
    const app = mkdtempSync(join(tmpdir(), "desplegar-"));
    try {
      mkdirSync(join(app, "functions_python"));
      writeFileSync(join(app, "functions_python", "main.py"), main);
      writeFileSync(join(app, "functions_python", "verified_price_repair_releases.json"), JSON.stringify({ variable, isins }));
      if (contenido !== null) writeFileSync(join(app, "functions_python", `.env.${PROYECTO}`), contenido);
      return motivosParaNoDesplegar(app).find((motivo: string) => motivo.includes(variable));
    } finally {
      rmSync(app, { recursive: true, force: true });
    }
  }

  test("la lista tiene la forma que la comprobación lee", () => {
    expect(variable).toBe("BDB_VERIFIED_PRICE_REPAIR_RELEASES");
    expect(new Set(isins).size).toBe(isins.length);
    expect(isins.length).toBeGreaterThan(0);
  });

  test("sin la línea aborta, nombrando la variable y cada ISIN", () => {
    const motivo = motivoConElEntorno(`MASTER_PROJECT_ID=${PROYECTO}\n`);
    expect(motivo).toContain(variable);
    for (const isin of isins) expect(motivo).toContain(isin);
  });

  test("con la línea entera no hay motivo, y con una de menos nombra solo la que falta", () => {
    expect(motivoConElEntorno(`MASTER_PROJECT_ID=${PROYECTO}\n${variable}=${isins.join(",")}\n`)).toBeUndefined();
    const motivo = motivoConElEntorno(`${variable}=${isins.slice(1).join(",")}\n`);
    expect(motivo).toContain(isins[0]);
    for (const isin of isins.slice(1)) expect(motivo).not.toContain(isin);
  });

  test("lee como la CLI: gana la última, una comentada no cuenta, y admite comillas, espacios y CRLF", () => {
    const entera = isins.join(",");
    expect(liberacionesQueFaltan(`${variable}=${entera}\r\n`, variable, isins)).toEqual([]);
    expect(liberacionesQueFaltan(`${variable}="${entera}"\n`, variable, isins)).toEqual([]);
    expect(liberacionesQueFaltan(`${variable}=${isins.join(" , ")} # reparados\n`, variable, isins)).toEqual([]);
    expect(liberacionesQueFaltan(`export ${variable}=${entera}\n`, variable, isins)).toEqual([]);
    expect(liberacionesQueFaltan(`# ${variable}=${entera}\n`, variable, isins)).toEqual(isins);
    expect(liberacionesQueFaltan(`${variable}=${entera}\n${variable}=\n`, variable, isins)).toEqual(isins);
    expect(liberacionesQueFaltan("", variable, isins)).toEqual(isins);
    expect(liberacionesQueFaltan(`OTRA_${variable}=${entera}\n`, variable, isins)).toEqual(isins);
  });

  test("sin el fichero de entorno, el motivo es ese y no este", () => {
    expect(motivoConElEntorno(null)).toBeUndefined();
  });
});

describe("las escrituras viejas, leídas en los dos ficheros que carga la CLI (P2-09, 21-11-2026)", () => {
  const ABRE = "YES_I_UNDERSTAND_MASTER_DB_WRITES";
  const liberacion = `${variable}=${isins.join(",")}\n`;
  /* Todos los motivos con un `.env` común y un `.env.<proyecto>` de prueba: los de verdad no están en Git. */
  function motivosCon(comun: string | null, delProyecto: string | null): string[] {
    const app = mkdtempSync(join(tmpdir(), "desplegar-"));
    try {
      mkdirSync(join(app, "functions_python"));
      writeFileSync(join(app, "functions_python", "main.py"), main);
      writeFileSync(join(app, "functions_python", "verified_price_repair_releases.json"), JSON.stringify({ variable, isins }));
      if (comun !== null) writeFileSync(join(app, "functions_python", ".env"), comun);
      if (delProyecto !== null) writeFileSync(join(app, "functions_python", `.env.${PROYECTO}`), delProyecto);
      /* La carpeta no es un repositorio: ese motivo es de la prueba, no del entorno. */
      return motivosParaNoDesplegar(app).filter((motivo: string) => !motivo.includes("Git"));
    } finally {
      rmSync(app, { recursive: true, force: true });
    }
  }
  const proyectoBueno = `MASTER_PROJECT_ID=${PROYECTO}\n${liberacion}`;
  const abre = (motivos: string[]) => motivos.some((motivo) => motivo.includes(ESCRITURAS_VIEJAS));

  test("con los dos ficheros como los de hoy, no hay motivo", () => {
    expect(motivosCon("MASTER_PROJECT_ID=gestor-activos-local\n", proyectoBueno)).toEqual([]);
  });

  test("abiertas en `.env`, que antes no se miraba, no se despliega", () => {
    expect(abre(motivosCon(`${ESCRITURAS_VIEJAS}=${ABRE}\n`, proyectoBueno))).toBe(true);
  });

  test("con `export`, espacios o comillas, también se ven", () => {
    expect(abre(motivosCon(null, `${proyectoBueno}export ${ESCRITURAS_VIEJAS} = "${ABRE}"\n`))).toBe(true);
    expect(abre(motivosCon(null, `${proyectoBueno}  ${ESCRITURAS_VIEJAS}=${ABRE}\r\n`))).toBe(true);
  });

  test("gana la última línea y el fichero del proyecto manda sobre el común, como en la CLI", () => {
    expect(abre(motivosCon(null, `${proyectoBueno}${ESCRITURAS_VIEJAS}=${ABRE}\n${ESCRITURAS_VIEJAS}=\n`))).toBe(false);
    expect(abre(motivosCon(null, `${proyectoBueno}${ESCRITURAS_VIEJAS}=\n${ESCRITURAS_VIEJAS}=${ABRE}\n`))).toBe(true);
    expect(abre(motivosCon(`${ESCRITURAS_VIEJAS}=${ABRE}\n`, `${proyectoBueno}${ESCRITURAS_VIEJAS}=\n`))).toBe(false);
  });

  test("vacía o comentada no abre nada, y cualquier otro valor no se despliega", () => {
    expect(abre(motivosCon(`${ESCRITURAS_VIEJAS}=\n`, `${proyectoBueno}# ${ESCRITURAS_VIEJAS}=${ABRE}\n`))).toBe(false);
    expect(abre(motivosCon(null, `${proyectoBueno}${ESCRITURAS_VIEJAS}=no\n`))).toBe(true);
  });

  test("el proyecto de la maestra es el que queda tras leer los dos", () => {
    const sinProyecto = (motivos: string[]) => motivos.some((motivo) => motivo.includes("MASTER_PROJECT_ID"));
    expect(sinProyecto(motivosCon(`MASTER_PROJECT_ID=${PROYECTO}\n`, liberacion))).toBe(false);
    expect(sinProyecto(motivosCon("MASTER_PROJECT_ID=gestor-activos-local\n", liberacion))).toBe(true);
    expect(sinProyecto(motivosCon(null, `MASTER_PROJECT_ID = "${PROYECTO}"\n${liberacion}`))).toBe(false);
  });

  test("un emulador declarado con `export` en cualquiera de los dos también para", () => {
    expect(motivosCon("export FIRESTORE_EMULATOR_HOST=127.0.0.1:8092\n", proyectoBueno).join(" ")).toContain("FIRESTORE_EMULATOR_HOST");
    expect(motivosCon("# FIRESTORE_EMULATOR_HOST=127.0.0.1:8092\n", proyectoBueno)).toEqual([]);
  });

  test("la lectura de un valor suelto", () => {
    expect(valorEnElEntorno("A=1\nA=2\n", "A")).toBe("2");
    expect(valorEnElEntorno("AB=1\n", "A")).toBeUndefined();
    expect(valorEnElEntorno("A=\n", "A")).toBe("");
    expect(valorEfectivo([undefined, "A=1\n", "B=2\n"], "A")).toBe("1");
    expect(valorEfectivo(["A=1\n", "A='3' # el del proyecto\n"], "A")).toBe("3");
  });
  test("H3-04: los contratos se sincronizan antes de comprobar que Git está limpio, y solo con --despliega", () => {
    /* Lee el fuente y no ejecuta el guion: ejecutarlo desplegaría. */
    const cuerpo = guion.slice(guion.indexOf("async function main()"));
    const sincroniza = cuerpo.indexOf('"scripts/syncContractsCache.mjs"]');
    const comprueba = cuerpo.indexOf("motivosParaNoDesplegar(app)");
    const despliega = cuerpo.indexOf('"firebase", "deploy"');
    expect(sincroniza, "sincroniza los contratos").toBeGreaterThan(0);
    expect(comprueba, "comprueba Git y el entorno").toBeGreaterThan(0);
    expect(sincroniza).toBeLessThan(comprueba);
    expect(comprueba).toBeLessThan(despliega);
    /* Y sin --despliega no escribe nada: la sincronización cuelga de esa bandera. */
    const bandera = cuerpo.lastIndexOf('process.argv.includes("--despliega")', sincroniza);
    expect(bandera).toBeGreaterThanOrEqual(0);
    expect(bandera).toBeLessThan(sincroniza);
    expect(cuerpo.slice(bandera, sincroniza)).not.toContain("motivosParaNoDesplegar");
    /* Ninguna sincronización queda después de la comprobación. */
    expect(cuerpo.indexOf("syncContractsCache.mjs", comprueba)).toBe(-1);
  });
});
