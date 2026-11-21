import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * Hallazgo 5 de la auditoría del backend (16-11-2026): las reglas de la base de producción
 * (`4-base-nueva/firestore.rules`) exigen sesión CON correo verificado, como ya lo exigían las
 * Functions y la propia app. Hasta ese día bastaba la sesión, y con el alta abierta quien se
 * registrase sin verificar leía el catálogo directamente contra Firestore.
 *
 * Esta prueba no sustituye a `4-base-nueva/probar-reglas.mjs`, que es la que comprueba contra el
 * emulador lo que de verdad contesta cada regla. Lo que hace es fallar en segundos, sin emulador,
 * si `esAsesor()` vuelve a ser solo `request.auth != null` o si alguna regla concede lectura sin
 * pasar por ella.
 */
const REGLAS = readFileSync(resolve(process.cwd(), "..", "4-base-nueva", "firestore.rules"), "utf8");

/** El cuerpo de una función de las reglas, sin comentarios y con los espacios colapsados. */
function cuerpoDe(nombre: string): string {
  const inicio = REGLAS.search(new RegExp(`function\\s+${nombre}\\s*\\(`));
  expect(inicio, `no encuentro la función ${nombre}()`).toBeGreaterThanOrEqual(0);
  const abre = REGLAS.indexOf("{", inicio);
  let nivel = 1;
  let i = abre + 1;
  for (; i < REGLAS.length && nivel > 0; i += 1) {
    if (REGLAS[i] === "{") nivel += 1;
    else if (REGLAS[i] === "}") nivel -= 1;
  }
  return REGLAS.slice(abre + 1, i - 1)
    .replace(/\/\/.*$/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Las condiciones de cada `allow` que conceda algo, sin comentarios. */
function condicionesQueConceden(): string[] {
  const sinComentarios = REGLAS.replace(/\/\/.*$/gm, "");
  const condiciones: string[] = [];
  for (const m of sinComentarios.matchAll(/allow\s+[^:;]+:\s*if\s+([^;]+);/g)) {
    const condicion = m[1].replace(/\s+/g, " ").trim();
    if (condicion !== "false") condiciones.push(condicion);
  }
  return condiciones;
}

describe("las reglas de la base nueva exigen el correo verificado", () => {
  it("esAsesor() pide sesión y email_verified == true", () => {
    const cuerpo = cuerpoDe("esAsesor");
    expect(cuerpo).toContain("request.auth != null");
    expect(cuerpo).toContain("request.auth.token.email_verified == true");
    /* Y no solo la sesión: la forma de antes del 16-11-2026 tiene que fallar aquí. */
    expect(cuerpo).not.toBe("return request.auth != null;");
  });

  it("el administrador se apoya en esAsesor(): el claim no sustituye al correo", () => {
    expect(cuerpoDe("esAdministrador")).toContain("esAsesor()");
    expect(cuerpoDe("esAdministrador")).toContain("request.auth.token.admin == true");
    expect(cuerpoDe("isAdmin")).toBe("return esAdministrador();");
  });

  it("toda regla que concede pasa por esAsesor() o por el administrador", () => {
    const condiciones = condicionesQueConceden();
    expect(condiciones.length).toBeGreaterThan(10);
    for (const condicion of condiciones) {
      expect(condicion, `concede sin correo verificado: ${condicion}`).toMatch(/^(esAsesor\(\)|isAdmin\(\)|esAdministrador\(\))(\s|$)/);
    }
  });

  it("la sesión sola no aparece en ninguna otra parte", () => {
    const fuera = REGLAS.replace(/\/\/.*$/gm, "").split("request.auth != null").length - 1;
    expect(fuera).toBe(1);
  });
});
