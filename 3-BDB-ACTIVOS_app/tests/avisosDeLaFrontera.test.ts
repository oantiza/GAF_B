import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import { avisoDeLaFrontera } from "../src/core/avisosDeLaFrontera";

/** Los avisos de la frontera llegan del servidor como códigos, y un código no llega a pantalla. */
describe("los avisos de la frontera", () => {
  test("un código conocido dice lo que pasa, también delante del cliente", () => {
    expect(avisoDeLaFrontera("RETURN_SIGNAL_WEAK", true)).toContain("Diferencias de rentabilidad esperada reducidas");
    expect(avisoDeLaFrontera("MAX_SHARPE_FROM_FRONTIER", true)).toBe("El máximo Sharpe se ha tomado del mejor punto de la frontera, porque con estos límites no se resuelve directamente: es aproximado.");
    /* Con rotación decía que ningún activo superaba el tipo sin riesgo, sin ser cierto: son dos avisos. */
    expect(avisoDeLaFrontera("MAX_SHARPE_UNDEFINED_FALLBACK", true)).toContain("Ningún activo supera el tipo sin riesgo");
    /* OPT-2: el periodo que acaba hace más de un mes, que el servidor manda desde `portfolio_horizon.py`. */
    expect(avisoDeLaFrontera("PERIOD_END_STALE", true)).toContain("El periodo medido acaba hace más de un mes");
  });

  test("uno que aún no se conoce: el cliente no lo ve y el asesor sí, dicho como lo que es", () => {
    expect(avisoDeLaFrontera("ALGO_NUEVO", true)).toBeNull();
    expect(avisoDeLaFrontera("ALGO_NUEVO", false)).toBe("Aviso del cálculo sin traducir: ALGO_NUEVO.");
  });

  test("una frase ya escrita pasa por el glosario", () => {
    expect(avisoDeLaFrontera("La tasa sin riesgo no cubre la ventana.", true)).toBe("El tipo sin riesgo no cubre la ventana.");
  });

  test("todo lo que el servidor de hoy puede mandar tiene su frase", () => {
    const carpeta = new URL("../functions_python/optimization/", import.meta.url);
    const codigos = new Set(
      readdirSync(carpeta)
        .filter((nombre) => nombre === "repository.py" || nombre === "robust_engine.py")
        .flatMap((nombre) => [...readFileSync(new URL(nombre, carpeta), "utf8").matchAll(/warnings\.append\("([A-Z0-9_]+)"\)/g)].map((m) => m[1]))
    );
    expect(codigos.size).toBeGreaterThan(5);
    const sinFrase = [...codigos].filter((codigo) => avisoDeLaFrontera(codigo, true) === null);
    expect(sinFrase).toEqual([]);
  });
});
