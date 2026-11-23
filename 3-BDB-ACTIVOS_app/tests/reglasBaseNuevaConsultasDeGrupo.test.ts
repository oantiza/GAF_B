import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/*
 * P1-10 de la auditoría integral (20-11-2026): en las reglas de producción
 * (`4-base-nueva/firestore.rules`), una regla de grupo `match /{ruta=**}/<nombre>/{doc}` abre
 * CUALQUIER colección con ese nombre, a cualquier profundidad, y como las reglas se combinan con O
 * gana al `if false` de las carteras y los clientes. Hasta el 21-11-2026 había cinco y el navegador
 * usaba dos.
 *
 * Esta prueba ata las dos listas: las reglas de grupo que concede el fichero son exactamente las
 * consultas de grupo que lanza el navegador (`collectionGroup(...)` en `src/`). `targets` tenía la
 * suya, conservada a la espera de Óscar; la retiró él el 21-11-2026 (A-207) y la prueba exige que no
 * vuelva. Una consulta de grupo nueva sin su regla, o una regla de grupo que nadie usa, la ponen roja. Lo que contesta cada
 * regla lo comprueba `4-base-nueva/probar-reglas.mjs` contra el emulador.
 */
const REGLAS = readFileSync(resolve(process.cwd(), "..", "4-base-nueva", "firestore.rules"), "utf8").replace(/\/\/.*$/gm, "");

/** Lo que se conserva sin que el navegador lo consulte, con su razón. Desde A-207 no queda nada. */
const CONSERVADAS_SIN_USO = new Set<string>();

function reglasDeGrupo(): string[] {
  return [...REGLAS.matchAll(/match\s+\/\{[a-z_]+=\*\*\}\/([a-z_]+)\/\{[a-z_]+\}/g)].map((m) => m[1]).sort();
}

function consultasDeGrupoDelNavegador(): string[] {
  const codigo = readFileSync(resolve(process.cwd(), "src/adapters/baseNuevaLecturaSdk.ts"), "utf8");
  return [...codigo.matchAll(/collectionGroup\(\s*[^,]+,\s*"([a-z_]+)"\s*\)/g)].map((m) => m[1]).sort();
}

describe("las reglas de grupo de la base nueva son las que usa el navegador", () => {
  it("el navegador consulta en grupo las tarjetas y la calidad, y nada más", () => {
    expect(consultasDeGrupoDelNavegador()).toEqual(["quality", "read"]);
  });

  it("ningún otro fichero de src/ lanza una consulta de grupo", () => {
    const ficheros = execFileSync("git", ["grep", "--untracked", "-l", "collectionGroup(", "--", "src"], { encoding: "utf8" })
      .split(/\r?\n/)
      .filter(Boolean);
    expect(ficheros).toEqual(["src/adapters/baseNuevaLecturaSdk.ts"]);
  });

  it("cada regla de grupo responde a una consulta, salvo las que se conservan con su razón", () => {
    const esperadas = [...new Set([...consultasDeGrupoDelNavegador(), ...CONSERVADAS_SIN_USO])].sort();
    expect(reglasDeGrupo()).toEqual(esperadas);
  });

  it("A-207: `targets` ya no tiene regla de grupo, y sus objetivos siguen leyéndose por la ruta de su cartera", () => {
    expect(REGLAS).not.toMatch(/\{[a-z_]+=\*\*\}\/targets\//);
    expect(REGLAS).toMatch(/match \/portfolios\/\{cartera\} \{[\s\S]*?match \/targets\/\{instrumento\} \{\s*allow read: if esAsesor\(\) && resource\.data\.advisor_id == request\.auth\.uid;/);
  });

  it("ya no hay reglas de grupo para los bloques ni los trozos de cartera", () => {
    for (const nombre of ["declared", "computed", "holdings_chunks"]) {
      expect(REGLAS).not.toMatch(new RegExp(`\\{[a-z_]+=\\*\\*\\}/${nombre}/`));
    }
    /* Y el catálogo los sigue sirviendo por su ruta: el comodín anidado de `instruments`. */
    expect(REGLAS).toMatch(/match \/instruments\/\{instrumento\} \{[\s\S]*?match \/\{resto=\*\*\} \{\s*allow read: if esAsesor\(\);/);
  });
});
