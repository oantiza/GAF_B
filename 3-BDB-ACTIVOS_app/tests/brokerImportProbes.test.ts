/* Batería de aceptación del importador (undécima pasada de la auditoría del
   16-10-2026): las 454 sondas —las 87 del arreglador, las 65 de la revisión 4,
   las 87 de la revisión 5, las 54 de la revisión 6, las 55 de la revisión 7,
   las 60 de la revisión 8, las 40 de la revisión 9 y 6 de la revisión 10— con el juez ESTRICTO (un aviso solo cuenta si nombra
   la fila), por los tres caminos: pegar en Posiciones globales, cargar el
   fichero real y el Constructor. La confirmación es siempre, así que lo que el
   resumen enseña para confirmar tiene que ser el importe en EUR correcto, o la
   fila tiene que quedar fuera con un aviso que la nombre. Con una elección
   pendiente (columna de importe, titular, fecha) no se confirma sin elegir, y
   el caso es bueno solo si alguna opción da un resultado sin ✘ («⇄»). Cada
   sonda tiene su veredicto esperado (M3) y lo usado tras confirmar es lo
   enseñado. Con la INCLUSIÓN EXPLÍCITA (I5), lo que la regla de divisa deja
   fuera no se usa sin la segunda casilla y, con ella, el resumen lo enseña con
   su importe y marcado. La pantalla no usa nada hasta la confirmación: lo
   comprueban importConfirmationGateUi, importNinthPassUi y
   portfolioImportEuroConfirmation.

   Si se pone SONDAS_OUT, escribe ahí el detalle de cada sonda (JSON). */
import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cases152 } from "./importProbes/cases152";
import { EXPECTED_INCLUSION, EXPECTED_VERDICTS } from "./importProbes/expectedVerdicts";
import { casesR5 } from "./importProbes/casesReview5";
import { casesR6 } from "./importProbes/casesReview6";
import { casesR7 } from "./importProbes/casesReview7";
import { casesR8 } from "./importProbes/casesReview8";
import { casesR9 } from "./importProbes/casesReview9";
import { casesR10 } from "./importProbes/casesReview10";
import { isFailing, runCase, type ProbeCase, type ProbeResult } from "./importProbes/harness";

/**
 * La clase residual aceptada (V36, V38 y N08r8): un fichero que no menciona
 * ninguna divisa salvo el euro, con forma idéntica al Andbank «Mercado». En
 * N08r8 solo lo dice el nombre del fichero. Y el residual de diseño de la
 * revisión 9 (P06 y P11): una mención en una fila vale para esa fila. Ver
 * expectedVerdicts.
 */
const RESIDUAL = ["V36", "V38", "N08r8", "P06", "P11"];

async function runAll(list: ProbeCase[]): Promise<ProbeResult[]> {
  const out: ProbeResult[] = [];
  for (const c of list) out.push(await runCase(c));
  return out;
}

describe("aceptación de la undécima pasada · 454 sondas con el juez estricto", () => {
  it("cada sonda da su veredicto esperado por los tres caminos, lo usado es lo enseñado, la inclusión explícita enseña bien y solo la clase residual da ✘", async () => {
    const results = await runAll([...cases152, ...casesR5, ...casesR6, ...casesR7, ...casesR8, ...casesR9, ...casesR10]);
    if (process.env.SONDAS_OUT) writeFileSync(process.env.SONDAS_OUT, JSON.stringify(results, null, 1), "utf8");
    expect(results).toHaveLength(454);
    expect(new Set(results.map((r) => r.id)).size).toBe(454);
    expect(Object.keys(EXPECTED_VERDICTS)).toHaveLength(454);

    const changed = results
      .filter((r) => {
        const expected = EXPECTED_VERDICTS[r.id];
        return expected?.[0] !== r.gp || expected?.[1] !== r.file || expected?.[2] !== r.cons;
      })
      .map((r) => `${r.id}: esperado ${EXPECTED_VERDICTS[r.id]?.join(" / ")}, da ${r.gp} / ${r.file} / ${r.cons} · ${r.gpShown} · ${r.gpWarnings.join(" | ")}`);
    expect(changed).toEqual([]);

    expect(results.filter((r) => !r.usedEqualsShown).map((r) => r.id)).toEqual([]);

    // Inclusión explícita: las mismas sondas que antes, y en cada camino que la tiene, «✔i».
    expect(results.filter((r) => r.incl).map((r) => r.id)).toEqual(EXPECTED_INCLUSION);
    const badInclusion = results.filter((r) => r.incl.split(" / ").some((part) => part !== "" && part !== "✔i")).map((r) => `${r.id}: ${r.incl}`);
    expect(badInclusion).toEqual([]);

    const failing = results.filter((r) => isFailing(r.gp) || isFailing(r.file) || isFailing(r.cons)).map((r) => r.id);
    expect(failing).toEqual(RESIDUAL);
  }, 900_000);
});
