import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const SCRIPTS = fileURLToPath(new URL("../scripts", import.meta.url));

/**
 * `fullPage` apaga la emulación táctil de Chromium (scripts/fotoDePaginaEntera.mjs), y con ella la batería a 1024 y 768
 * fotografiaba una tablet con ratón sin que nada fallara. Un guion con dedo no la escribe.
 */
describe("la foto con dedo", () => {
  test("ningún guion con hasTouch usa fullPage: pasa por fotoDePaginaEntera", () => {
    const conDedo = readdirSync(SCRIPTS)
      .filter((fichero) => fichero.endsWith(".mjs") && fichero !== "fotoDePaginaEntera.mjs")
      .map((fichero) => ({ fichero, texto: readFileSync(join(SCRIPTS, fichero), "utf8") }))
      .filter(({ texto }) => /hasTouch/.test(texto));
    expect(conDedo.map(({ fichero }) => fichero)).toContain("capturaInterfaz.mjs");
    for (const { fichero, texto } of conDedo) expect(texto, fichero).not.toMatch(/fullPage/);
  });

  test("la batería falla si la foto no fue con dedo donde debía", () => {
    const bateria = readFileSync(join(SCRIPTS, "capturaInterfaz.mjs"), "utf8");
    expect(bateria).toContain("fotoDePaginaEntera(page");
    expect(bateria).toMatch(/const bad = report\.filter\([^\n]*!r\.conDedoComoDebe/);
  });
});
