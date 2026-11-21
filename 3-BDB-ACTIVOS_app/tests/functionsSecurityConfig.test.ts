import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/** Cuerpo de una función de nivel superior de main.py: desde `def <name>(` hasta
 *  el siguiente `@...` o `def ` en columna 0 (o el final del fichero). */
function topLevelFunctionBody(source: string, name: string): string {
  const start = source.search(new RegExp(`^def ${name}\\(`, "m"));
  if (start < 0) throw new Error(`def ${name} no encontrado en main.py`);
  const rest = source.slice(start + `def ${name}(`.length);
  const next = rest.search(/^(@|def |class )/m);
  return next < 0 ? rest : rest.slice(0, next);
}

describe("Cloud Functions security configuration", () => {
  const main = readFileSync(resolve(process.cwd(), "functions_python/main.py"), "utf8");

  it("caps global and optimizer scale", () => {
    expect(main).toContain("max_instances=5");
    expect(main).toContain("memory=options.MemoryOption.GB_1, max_instances=5");
    expect(main).toContain('_cap_list(req.data, "positions", CAP_SIMULATION_POSITIONS if bundle else CAP_SERIES_ASSETS, "posiciones")');
  });

  it("supports staged App Check enforcement and logs missing tokens", () => {
    expect(main).toContain('BDB_APPCHECK_ENFORCE');
    expect(main).toContain("enforce_app_check=APPCHECK_ENFORCED");
    expect(main).toContain('LOGGER.warning("app_check_token_missing")');
  });

  it("rate limits costly callable functions per authenticated user", () => {
    expect(main).toContain('operation="optimize_portfolio", limit_per_minute=12');
    expect(main).toContain('operation="analyze_portfolio", limit_per_minute=6');
    expect(main).toContain('operation="save_portfolio", limit_per_minute=30');
    expect(main).toContain('operation="list_portfolios", limit_per_minute=60');
    expect(main).toContain('operation="delete_portfolio", limit_per_minute=30');
    expect(main).toContain('operation="get_euro_yield_curve", limit_per_minute=30');
  });

  /* S-11 (auditoría 29-09): el `[\s\S]*` voraz pasaba aunque la función no
     llamase a `_require_auth` (bastaba que cualquier def posterior lo hiciera).
     Ahora se acota al cuerpo de cada función: desde su `def` hasta el siguiente
     decorador o `def` de nivel superior. Hasta el 17-11-2026 se comprobaba con los
     análisis guardados de la cartera real, que se borraron con su motor (decisión
     A-188); las carteras por UID son el mismo caso. */
  it("keeps portfolios in authenticated UID-scoped callables", () => {
    for (const name of ["save_portfolio", "list_portfolios", "delete_portfolio"]) {
      expect(topLevelFunctionBody(main, name), `${name} debe abrir con uid = _require_auth`).toMatch(
        /^\s+uid = _require_auth\(req, operation="[a-z_]+", limit_per_minute=\d+\)/m
      );
    }
  });

  it("la comprobación acotada falla si una función pierde su _require_auth", () => {
    const sinAuth = main.replace(
      /(def list_portfolios\(req: https_fn\.CallableRequest\):\n)\s+uid = _require_auth\([^\n]*\n/,
      "$1    uid = req.auth.uid\n"
    );
    expect(sinAuth).not.toBe(main);
    expect(topLevelFunctionBody(sinAuth, "list_portfolios")).not.toMatch(/_require_auth/);
    // y la función vecina sigue teniendo el suyo: la acotación no mezcla cuerpos.
    expect(topLevelFunctionBody(sinAuth, "delete_portfolio")).toMatch(/_require_auth/);
  });

  it("separates read-only and controlled-writer runtime identities", () => {
    expect(main).toContain("bdb-functions-reader@");
    expect(main).toContain("bdb-functions-writer@");
    expect(main).toContain("service_account=READER_SERVICE_ACCOUNT");
    expect(main.match(/service_account=WRITER_SERVICE_ACCOUNT/g)?.length ?? 0).toBeGreaterThanOrEqual(10);
  });
});
