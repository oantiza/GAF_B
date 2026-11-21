import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

/**
 * Una pieza trae su hoja (hallazgo 150). Si la pidiera cada pantalla, una que la olvide pinta la pieza sin estilo:
 * ya pasó con el plano, que se estiró al ancho de la sección con los rótulos enormes.
 */

const leer = (ruta: string) => readFileSync(new URL(`../src/${ruta}`, import.meta.url), "utf8");

test.each([
  ["components/tabla/TablaDeDatos.tsx", "tabla.css"],
  ["components/tabla/TablaComparativa.tsx", "tabla.css"],
  ["components/tabla/PlanoRiesgoRetorno.tsx", "tabla.css"],
  ["components/ficha/FichaInstrumento.tsx", "ficha.css"],
  ["components/AssetHistoryChart.tsx", "ficha.css"]
])("%s carga %s", (pieza, hoja) => {
  expect(leer(pieza)).toContain(`styles/${hoja}";`);
});

test.each(["pages/StrategyPage.tsx", "components/AssetComparison.tsx", "components/PositionsWorkbench.tsx"])(
  "%s usa las piezas y no pide la hoja por ellas",
  (pantalla) => {
    expect(leer(pantalla)).not.toContain('styles/tabla.css"');
  }
);
