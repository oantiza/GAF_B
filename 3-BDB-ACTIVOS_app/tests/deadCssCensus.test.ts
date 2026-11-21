import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { CLASES_SIN_REGLA_PERMITIDAS } from "../scripts/clasesSinReglaPermitidas.mjs";

/**
 * Censo de CSS muerto como puerta (auditoría 14-10-2026).
 *
 * `scripts/deadCssD3.mjs` sale con código 1 si encuentra una clase muerta sin
 * prefijo dinámico o un token huérfano. Las .recharts-* van en lista blanca
 * (las genera la librería) y --serie-4..7 cuentan como vivas mientras su
 * valor siga en el espejo theme.ts.
 */
const ROOT = fileURLToPath(new URL("..", import.meta.url));

/* «Esta lista solo baja», y hasta aquí no lo hacía cumplir nada: una entrada nueva pasaba. Al quitar una, baja el número;
   para añadir una hay que venir a subirlo, con su motivo, y eso se ve. */
const EXCEPCIONES_COMO_MUCHO = 56;

describe("censo de CSS muerto (deadCssD3)", () => {
  test("la lista de excepciones solo baja", () => {
    expect(Object.keys(CLASES_SIN_REGLA_PERMITIDAS).length).toBeLessThanOrEqual(EXCEPCIONES_COMO_MUCHO);
  });

  test("una clase no vive de que su nombre sea un trozo de otra, ni de un comentario ni de un rol", () => {
    const root = mkdtempSync(join(tmpdir(), "dead-css-"));
    try {
      mkdirSync(join(root, "src", "styles"), { recursive: true });
      writeFileSync(join(root, "index.html"), "<div></div>\n");
      writeFileSync(join(root, "src", "styles", "modules.css"), ".toolbar { color: inherit; }\n.dot { color: inherit; }\n.viva { color: inherit; }\n");
      writeFileSync(
        join(root, "src", "Caja.tsx"),
        '// .dot en un comentario\nexport const A = () => <p className="viva ui-action-toolbar cmp-legend-dot" role="toolbar" />;\n'
      );
      const run = spawnSync(process.execPath, [join(ROOT, "scripts", "deadCssD3.mjs")], {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, CSS_AUDIT_ROOT: root }
      });
      const muertas = String(run.stdout).split("=== TOKENS HUÉRFANOS ===")[0];
      expect(muertas).toContain("toolbar  [modules.css]");
      expect(muertas).toContain("dot  [modules.css]");
      expect(muertas).not.toContain("viva");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  test("sin clases muertas ni tokens huérfanos", () => {
    const run = spawnSync(process.execPath, ["scripts/deadCssD3.mjs"], { cwd: ROOT, encoding: "utf8" });
    expect(run.status, run.stdout).toBe(0);
    expect(run.stdout).toMatch(/Lista blanca de librería \(recharts-\): \d+ clases/);
    expect(run.stdout).toContain("Total: 0 tokens");
    expect(run.stdout).toMatch(/Consumidos por el espejo theme\.ts: .*--serie-4/);
    // Puerta inversa (16-10): ningún var(--x) sin declarar (--border y --muted
    // pasaron así a modules.css y dejaban la propiedad inválida sin avisar).
    expect(run.stdout).toContain("Total: 0 tokens sin declarar");
    // Ninguna línea de clase muerta «dura» (las ⚠ DYN se revisan a mano).
    const section = run.stdout.split("=== TOKENS HUÉRFANOS ===")[0];
    const hardDead = section.split("\n").filter((line) => /^\s{5}\S/.test(line));
    expect(hardDead).toEqual([]);
    // Puerta inversa de clases (04-11): ninguna clase escrita sin regla ni excepción.
    expect(run.stdout).toContain("Total: 0 clases sin regla");
    expect(run.stdout).toContain("Total: 0 excepciones caducadas");
  }, 30_000);

  test("la puerta inversa caza un var() sin declarar y respeta las declaraciones en línea", () => {
    const root = mkdtempSync(join(tmpdir(), "dead-css-"));
    try {
      mkdirSync(join(root, "src", "styles"), { recursive: true });
      writeFileSync(join(root, "index.html"), "<div class=\"caja\"></div>\n");
      writeFileSync(join(root, "src", "styles", "tokens.css"), ":root {\n  --filete: #dde3e9;\n}\n");
      writeFileSync(
        join(root, "src", "styles", "modules.css"),
        ".caja { border-top: 1px solid var(--filete); color: var(--muted); width: calc(var(--n) * 1px); }\n"
      );
      // --n se declara en línea desde el TSX: cuenta como declarado.
      writeFileSync(join(root, "src", "Caja.tsx"), "export const s = { \"--n\": 3 };\n");
      const run = spawnSync(process.execPath, [join(ROOT, "scripts", "deadCssD3.mjs")], {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, CSS_AUDIT_ROOT: root }
      });
      expect(run.status, run.stdout).toBe(1);
      const section = run.stdout.split("=== TOKENS USADOS Y NO DECLARADOS ===")[1] ?? "";
      expect(section).toContain("--muted  [modules.css]");
      expect(section).not.toContain("--n ");
      expect(section).not.toContain("--filete ");
      expect(run.stdout).toContain("Total: 1 tokens sin declarar");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  describe("la puerta inversa de clases", () => {
    const enUnArbol = (comprobar: (censar: (tsx: string) => ReturnType<typeof spawnSync>) => void) => {
      const root = mkdtempSync(join(tmpdir(), "dead-css-"));
      try {
        mkdirSync(join(root, "src", "styles"), { recursive: true });
        writeFileSync(join(root, "index.html"), "<div></div>\n");
        writeFileSync(join(root, "src", "styles", "modules.css"), ".caja, .otra { color: inherit; }\n");
        comprobar((tsx) => {
          writeFileSync(join(root, "src", "Caja.tsx"), tsx);
          return spawnSync(process.execPath, [join(ROOT, "scripts", "deadCssD3.mjs")], {
            cwd: root,
            encoding: "utf8",
            env: { ...process.env, CSS_AUDIT_ROOT: root }
          });
        });
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    };
    const sinRegla = (salida: unknown) =>
      String(salida).split("=== CLASES ESCRITAS SIN REGLA ===")[1].split("Total:")[0].trim();

    test("falla con una clase inventada, la nombra, y deja de fallar al quitarla", () => {
      enUnArbol((censar) => {
        const conElla = censar('export const A = () => <p className="caja inventada-a-proposito otra" />;\n');
        expect(conElla.status, String(conElla.stdout)).toBe(1);
        expect(sinRegla(conElla.stdout)).toBe("inventada-a-proposito  [Caja.tsx]");

        const sinElla = censar('export const A = () => <p className="caja otra" />;\n');
        expect(sinElla.status, String(sinElla.stdout)).toBe(0);
        expect(String(sinElla.stdout)).toContain("Total: 0 clases sin regla");
      });
    }, 30_000);

    test("la encuentra en línea, en una constante, en un objeto, en una función y en un fichero .ts", () => {
      enUnArbol((censar) => {
        const salida = censar(`export const A = ({ si }: { si: boolean }) => (
          <>
            <p className={si ? "en-condicional" : "caja"} />
            <p className={\`caja \${si ? "en-plantilla" : ""} en-su-texto\`} />
            <p className={["en-lista", si ? "otra" : ""].filter(Boolean).join(" ")} />
            <Pieza claseDelCuerpo="en-el-cuerpo" valueClassName="en-otra-propiedad" />
            <p className={si && "en-conjuncion"} />
          </>
        );\n`);
        expect(salida.status, String(salida.stdout)).toBe(1);
        expect(sinRegla(salida.stdout).split("\n").map((linea) => linea.split("  ")[0]).sort()).toEqual([
          "en-condicional",
          "en-conjuncion",
          "en-el-cuerpo",
          "en-lista",
          "en-otra-propiedad",
          "en-plantilla",
          "en-su-texto"
        ]);
      });
    }, 30_000);

    test("sigue lo que no está escrito en el atributo", () => {
      enUnArbol((censar) => {
        const salida = censar(`const CLASE = "en-constante";
          const ESTILOS = { a: "en-mapa", b: "caja" };
          function claseDe() { return "en-funcion"; }
          const propiedades = { className: "en-objeto" };
          export const A = ({ tipo }: { tipo: "a" | "b" }) => (
            <>
              <p className={CLASE} />
              <p className={ESTILOS.a} />
              <p className={ESTILOS[tipo]} />
              <p className={claseDe()} />
              <p {...propiedades} />
            </>
          );\n`);
        expect(salida.status, String(salida.stdout)).toBe(1);
        expect(sinRegla(salida.stdout).split("\n").map((linea) => linea.split("  ")[0]).sort()).toEqual([
          "en-constante",
          "en-funcion",
          "en-mapa",
          "en-objeto"
        ]);
      });
    }, 30_000);

    test("lo que NO ve, dicho aquí para que nadie lo dé por cubierto: nombres compuestos en la ejecución y otras propiedades", () => {
      enUnArbol((censar) => {
        const salida = censar(`export const A = ({ de }: { de: string }) => (
          <>
            <p className={\`caja otra caja--\${de}\`} />
            <Pieza clase="esto-es-un-valor" tone="esto-tambien" />
          </>
        );\n`);
        expect(salida.status, String(salida.stdout)).toBe(0);
      });
    }, 30_000);

    test("una expresión pegada a un texto es un trozo de nombre, no una clase", () => {
      enUnArbol((censar) => {
        const salida = censar(`const estado = "falso";
          export const A = () => <p className={\`caja caja-\${estado} otra\`} />;\n`);
        expect(salida.status, String(salida.stdout)).toBe(0);
      });
    }, 30_000);

    test("no confunde con una clase lo que no lo es", () => {
      enUnArbol((censar) => {
        const salida = censar(`export const A = ({ tipo, de }: { tipo: string; de: string }) => (
          <>
            <p className={tipo === "FUND" ? "caja" : "otra"} />
            <p className={\`caja-\${de}\`} />
            <p className={\`\${de}-caja otra\`} />
            <p className={ESTILOS[tipo]} />
            <p title="esto no es una clase" />
          </>
        );\n`);
        expect(salida.status, String(salida.stdout)).toBe(0);
        expect(sinRegla(salida.stdout)).toBe("");
      });
    }, 30_000);
  });
});
