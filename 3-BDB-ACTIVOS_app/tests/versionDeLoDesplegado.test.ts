/**
 * Qué commit está en producción (auditoría del 16-11-2026, SEG-3).
 *
 * El sitio se compilaba desde `HEAD` sin estampar nada, y el despliegue de funciones no apuntaba cuál subía.
 * Ahora el sitio lleva un `version.json` y las funciones dejan una línea en un registro local.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { commitDe, comparacion, escribirVersion, registrarDespliegue } from "../../4-base-nueva/version.mjs";

const COMMIT = { commit: "20f729f0aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", corto: "20f729f0", fecha_del_commit: "2026-11-16T14:23:00+01:00" };
const AHORA = new Date("2026-11-16T15:30:00.000Z");

describe("la versión de lo desplegado", () => {
  test("el commit de una carpeta del repositorio es el de Git, entero y corto", () => {
    const aqui = commitDe(process.cwd());
    expect(aqui.commit).toMatch(/^[0-9a-f]{40}$/);
    expect(aqui.corto).toBe(aqui.commit.slice(0, 8));
    expect(aqui.fecha_del_commit).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  test("el sitio se estampa con el commit del que sale y la hora de la compilación", () => {
    const carpeta = mkdtempSync(join(tmpdir(), "version-"));
    try {
      const escrito = escribirVersion(carpeta, COMMIT, AHORA);
      expect(escrito).toEqual({ ...COMMIT, compilado: "2026-11-16T15:30:00.000Z" });
      expect(JSON.parse(readFileSync(join(carpeta, "version.json"), "utf8"))).toEqual(escrito);
    } finally {
      rmSync(carpeta, { recursive: true, force: true });
    }
  });

  test("cada despliegue de funciones añade una línea al registro, sin pisar las anteriores", () => {
    const carpeta = mkdtempSync(join(tmpdir(), "despliegues-"));
    const registro = join(carpeta, "despliegues.jsonl");
    try {
      registrarDespliegue({ que: "funciones", ...COMMIT, funciones: 23 }, registro, AHORA);
      registrarDespliegue({ que: "funciones", ...COMMIT, corto: "otro0000", funciones: 23 }, registro, new Date("2026-11-17T09:00:00.000Z"));
      const lineas = readFileSync(registro, "utf8").trim().split("\n").map((linea) => JSON.parse(linea));
      expect(lineas).toHaveLength(2);
      expect(lineas[0]).toMatchObject({ fecha: "2026-11-16T15:30:00.000Z", que: "funciones", corto: "20f729f0", funciones: 23 });
      expect(lineas[1]).toMatchObject({ fecha: "2026-11-17T09:00:00.000Z", corto: "otro0000" });
    } finally {
      rmSync(carpeta, { recursive: true, force: true });
    }
  });

  test("comparar lo publicado con lo de aquí dice si es el mismo commit, si es otro o si no se sabe", () => {
    const publicado = { ...COMMIT, compilado: "2026-11-16T15:30:00.000Z" };
    expect(comparacion(publicado, COMMIT)).toBe("La web publicada sale de 20f729f0, que es el commit de aquí (compilado el 2026-11-16T15:30:00.000Z).");
    expect(comparacion(publicado, { ...COMMIT, commit: "5dec3147".padEnd(40, "0"), corto: "5dec3147" })).toBe(
      "La web publicada sale de 20f729f0 (compilado el 2026-11-16T15:30:00.000Z), y aquí está 5dec3147: no son el mismo."
    );
    expect(comparacion(null, COMMIT)).toContain("no lleva version.json");
  });

  test("los dos guiones lo usan: compilar estampa el sitio y desplegar apunta solo si acaba bien", () => {
    const compilar = readFileSync("../4-base-nueva/compilar-sitio.mjs", "utf8");
    expect(compilar).toContain("const commit = commitDe(APP);");
    expect(compilar).toContain("escribirVersion(SITIO, commit)");
    const desplegar = readFileSync("scripts/desplegarFunciones.mjs", "utf8");
    expect(desplegar).toMatch(/if \(r\.status === 0\) \{\s+registrarDespliegue\(/);
    /* El sitio no esconde el fichero: solo ignora los que empiezan por punto. */
    const hosting = JSON.parse(readFileSync("../4-base-nueva/firebase.json", "utf8")).hosting;
    expect(hosting.public).toBe("sitio");
    expect(hosting.ignore).toEqual(["**/.*"]);
    /* Y el registro local no va al repositorio. */
    expect(readFileSync("../.gitignore", "utf8")).toContain("4-base-nueva/despliegues.jsonl");
  });
});
