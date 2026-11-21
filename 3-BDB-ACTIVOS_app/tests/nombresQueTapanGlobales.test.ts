/**
 * Código (auditoría de frontend, ACT-24): una variable que se llama como un global del navegador lo tapa
 * dentro de su función. En la evolución de la ficha el estado se llamaba `window`, y cualquier
 * `window.…` escrito después debajo leía la ventana elegida, no el navegador.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

const RAIZ = join(__dirname, "..");
const FICHEROS = [
  "src/components/AssetHistoryChart.tsx",
  "src/components/AssetComparison.tsx",
  "src/components/AssetDetail.tsx",
  "src/pages/MercadoPage.tsx",
  "src/pages/MacroPage.tsx",
  "src/pages/StrategyPage.tsx",
  "src/pages/BuscadorNuevoPage.tsx"
];
const GLOBALES = ["window", "document", "location", "history", "navigator", "name", "self", "top", "parent", "event"];
const DECLARA = new RegExp(
  `(?:const|let|var)\\s+(?:\\[\\s*(?:${GLOBALES.join("|")})\\b|(?:${GLOBALES.join("|")})\\s*=)`
);

test.each(FICHEROS)("%s no declara variables con el nombre de un global del navegador", (ruta) => {
  const codigo = readFileSync(join(RAIZ, ruta), "utf8");
  expect(codigo.match(DECLARA)?.[0]).toBeUndefined();
});
