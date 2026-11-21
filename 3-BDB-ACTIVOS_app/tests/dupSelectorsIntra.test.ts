import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

/**
 * Propiedad repetida dentro de un mismo bloque como puerta (auditoría 16-10-2026,
 * BAJA-04 / MEDIA-10).
 *
 * La segunda declaración pisa a la primera sin aviso: así la cifra del donut de
 * una categoría salía en tinta y no en Prusia, y el H1 perdía el tracking de la
 * ola 1. `scripts/dupSelectors.mjs --max-intra 0` sale con código 1 ante
 * cualquiera, salvo las reservas deliberadas (`100vh` → `100dvh`).
 */
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SCRIPT = join(ROOT, "scripts", "dupSelectors.mjs");

describe("propiedades repetidas dentro de un bloque (dupSelectors --max-intra)", () => {
  test("las hojas de la app no repiten ninguna propiedad dentro de un bloque", () => {
    const run = spawnSync(process.execPath, [SCRIPT, "--max-intra", "0"], { cwd: ROOT, encoding: "utf8" });
    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0);
    expect(run.stdout).toContain("PROPIEDADES REPETIDAS DENTRO DE UN MISMO BLOQUE: 0");
  }, 30_000);

  test("caza la repetición, también dentro de @media, y respeta la reserva vh → dvh", () => {
    const root = mkdtempSync(join(tmpdir(), "dup-intra-"));
    try {
      mkdirSync(join(root, "src", "styles"), { recursive: true });
      writeFileSync(
        join(root, "src", "styles", "charts.css"),
        [
          ".cifra { color: var(--marca); line-height: 1; color: var(--tinta); }",
          "@media (max-width: 1024px) { .titulo { letter-spacing: -0.015em; letter-spacing: -0.005em; } }",
          ".alto { height: 100vh; height: 100dvh; }",
          ""
        ].join("\n")
      );
      const run = spawnSync(process.execPath, [SCRIPT, "--max-intra", "0"], {
        cwd: root,
        encoding: "utf8",
        env: { ...process.env, CSS_AUDIT_ROOT: root }
      });
      expect(run.status).toBe(1);
      expect(run.stdout).toContain("PROPIEDADES REPETIDAS DENTRO DE UN MISMO BLOQUE: 2");
      expect(run.stdout).toContain(".cifra  → color: var(--marca) ⟶ var(--tinta)");
      expect(run.stdout).toContain(".titulo  → letter-spacing: -0.015em ⟶ -0.005em");
      expect(run.stdout).not.toContain(".alto");
      expect(run.stderr).toContain("2 propiedades repetidas dentro de un bloque > 0");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);
});
