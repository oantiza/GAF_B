import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { evaluaPuerta, PROYECTO_DE_DESTINO, VARIABLE_DE_LA_PUERTA } from "../scripts/puertaFunciones.mjs";
import { liberacionesQueFaltan, motivosParaNoDesplegar, PROYECTO } from "../scripts/desplegarFunciones.mjs";

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
