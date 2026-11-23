import { writeFile } from "node:fs/promises";
import { describe, expect, test } from "vitest";
import { createCostsPdfBlob } from "../src/reports/costsPdf";
import { calculatePortfolioCosts } from "../src/core/portfolioCosts";
import { costAssets, costPositions } from "./support/portfolioCostFixtures";
import { extractPdfMetadata, extractPdfPageTexts, extractPdfTextBaselines, lineasCon, lineasHuerfanasDeImpuestos } from "./support/pdfText";

test("PDF de costes: importes de pantalla, comisión indicada, explicación y ninguna información comercial", async () => {
  const blob = await createCostsPdfBlob({ costs: calculatePortfolioCosts(costPositions, costAssets, 100000),
    management: { enabled: true, unit: "percent", input: "0.5" }, date: "7 de septiembre de 2026" });
  const bytes = Buffer.from(await blob.arrayBuffer());
  if (process.env.COST_REPORT_QA_PATH) await writeFile(process.env.COST_REPORT_QA_PATH, bytes);
  const pages = extractPdfPageTexts(bytes);
  expect(pages).toHaveLength(3);
  expect(pages[0]).toMatch(/2\.258\s€/);
  expect(pages[0]).toMatch(/1\.758\s€/);
  expect(pages[0]).toMatch(/(?<![\d.])500\s€/);
  expect(pages[0]).toContain("2,26 %");
  /* Los pesos, con un decimal, también su suma. */
  expect(pages[0]).toContain("181,3 %");
  expect(pages[2]).toContain("no se suma de nuevo");
  expect(pages.join(" ")).not.toMatch(/andbank|retrocesi[oó]n|coeficiente de margen/i);
  for (const asset of costAssets) expect(pages[1]).toContain(asset.asset_id);
  pages.forEach((page, i) => expect(page).toContain(`Página ${i + 1} de ${pages.length}`));
});

test("costes ausentes no se convierten en cero y una comisión desactivada no se añade", async () => {
  const assets = costAssets.map((a, i) => i === 0 ? { ...a, costs: {} } : a);
  const pages = extractPdfPageTexts(Buffer.from(await (await createCostsPdfBlob({
    costs: calculatePortfolioCosts(costPositions, assets, 100000), management: { enabled: false, unit: "euros", input: "9876" }
  })).arrayBuffer()));
  expect(leido(pages[0])).toContain("falta el dato del coste de toda la cartera");
  expect(pages[0]).not.toContain("No añadida");
  expect(pages[0]).not.toContain("Asesoramiento o gestión");
  expect(pages.join(" ")).not.toContain("9.876");
});

test("cartera grande: conserva todos los activos, letras acentuadas y pies físicos", async () => {
  const assets = Array.from({ length: 45 }, (_, i) => ({ ...costAssets[0], asset_id: `PRUEBA${i}`, isin: `PRUEBA${i}`,
    display_name: `ÁGUILA ÍNDICE ÑOÑO fondo número ${i} de inversión internacional` }));
  const positions = assets.map((a) => ({ asset_id: a.asset_id, weight_percent: 100 / 45 }));
  const pages = extractPdfPageTexts(Buffer.from(await (await createCostsPdfBlob({
    costs: calculatePortfolioCosts(positions, assets, 100000), management: { enabled: true, unit: "euros", input: "750" }
  })).arrayBuffer()));
  for (const asset of assets) expect(pages.join(" ")).toContain(asset.asset_id);
  expect(pages.join(" ")).toContain("ÁGUILA ÍNDICE ÑOÑO");
  pages.forEach((page, i) => expect(page).toContain(`Página ${i + 1} de ${pages.length}`));
  /* Desde la plantilla única (14-11-2026) la tabla sigue en las hojas que hagan falta y cada una repite su cabecera; antes eran hojas de doce
     filas con el título de la sección y «Posiciones 1 a 12». Lo que se afirma sigue siendo lo mismo: ninguna fila se pierde ni se repite, toda
     hoja con filas lleva la cabecera de su tabla, y el total va con las últimas. */
  for (const capital of [100000, 0]) {
    const hojas = extractPdfPageTexts(Buffer.from(await (await createCostsPdfBlob({
      costs: calculatePortfolioCosts(positions, assets, capital), management: { enabled: false, unit: "percent", input: "" }
    })).arrayBuffer()));
    const conFilas = hojas.filter((hoja) => /PRUEBA\d/.test(hoja));
    expect(conFilas.length).toBeGreaterThanOrEqual(3);
    expect(conFilas[0]).toContain("Costes por activo");
    conFilas.forEach((hoja) => expect(hoja).toContain("Activo / ISIN"));
    expect(conFilas.at(-1)).toContain("Coste corriente anual de los productos");
    /* Y están todas: de la 0 a la 44, en orden y sin saltarse ninguna entre hojas. */
    expect(conFilas.flatMap((hoja) => [...hoja.matchAll(/PRUEBA(\d+)/g)].map((m) => Number(m[1])))).toEqual(assets.map((_, i) => i));
  }
});

test("una acción: en su fila «No aplica», cuenta como cero, y el dato ausente de un fondo sigue sin ser un cero", async () => {
  const accion = { ...costAssets[0], asset_id: "ES0144580Y14", isin: "ES0144580Y14", display_name: "Iberdrola S.A.", instrument_type: "STOCK" as const, costs: undefined };
  const fondo = (asset_id: string, ongoing_charge?: number) => ({ ...costAssets[0], asset_id, isin: asset_id, display_name: asset_id, costs: ongoing_charge === undefined ? undefined : { ongoing_charge } });
  const positions = [{ asset_id: "F1", weight_percent: 40 }, { asset_id: "F2", weight_percent: 30 }, { asset_id: "ES0144580Y14", weight_percent: 30 }];
  const management = { enabled: false, unit: "percent" as const, input: "" };

  /* 70 % en fondos al 1 % y 30 % en una acción, sobre 100.000 €: 0,70 % y 700 €. */
  const completa = extractPdfPageTexts(Buffer.from(await (await createCostsPdfBlob({
    costs: calculatePortfolioCosts(positions, [fondo("F1", .01), fondo("F2", .01), accion], 100000), management
  })).arrayBuffer()));
  expect(completa[0]).toMatch(/(?<![\d.])700\s€/);
  expect(completa[0]).toContain("0,70 %");
  /* Una sola redacción para el mismo hecho (decisión A-65): la hoja 1 y la guía dicen la misma lista, y ninguna otra. */
  expect(leido(completa[0])).toContain("No incluye: custodia, intermediación, cambio de divisa, comisión de éxito, comisiones de entrada (suscripción) y salida (reembolso) ni impuestos");
  expect(leido(completa[2])).toContain("No incluye: custodia, intermediación, cambio de divisa, comisión de éxito, comisiones de entrada (suscripción) y salida (reembolso) ni impuestos");
  expect(completa.join(" ")).not.toContain("custodia ni corretaje");
  expect(completa[0]).not.toContain("Un dato ausente");
  expect(completa[0]).not.toContain("Todas las posiciones analizadas");
  expect(completa[1]).toContain("Iberdrola");
  expect(completa[1]).toContain("No aplica");
  expect(completa[2]).toContain("cuenta como cero en la media");

  const conHueco = extractPdfPageTexts(Buffer.from(await (await createCostsPdfBlob({
    costs: calculatePortfolioCosts(positions, [fondo("F1", .01), fondo("F2"), accion], 100000), management
  })).arrayBuffer()));
  expect(conHueco[0]).toContain("Un dato ausente no equivale a un coste cero");
  expect(leido(conHueco[0])).toContain("falta el dato del coste de toda la cartera");
  expect(conHueco[0]).toContain("No incluye: custodia");
  /* Una cartera mixta sí tiene cifra, y dice cómo cuenta la acción: es la media de toda la cartera, con ella a cero. */
  expect(completa[0]).toContain("en la media cuenta como cero");
});

test("sin acciones no se habla de ellas: ni la nota ni el párrafo de la guía", async () => {
  const pages = extractPdfPageTexts(Buffer.from(await (await createCostsPdfBlob({
    costs: calculatePortfolioCosts(costPositions, costAssets, 100000), management: { enabled: false, unit: "percent", input: "" }
  })).arrayBuffer()));
  expect(pages.join(" ")).not.toContain("custodia ni corretaje");
  expect(pages[0]).toContain("Todas las posiciones analizadas tienen un coste corriente.");
  expect(pages[0]).not.toContain("coste corriente válido");
});

const texto = async (input: Parameters<typeof createCostsPdfBlob>[0]) => extractPdfPageTexts(Buffer.from(await (await createCostsPdfBlob(input)).arrayBuffer()));
/* Como se lee: el espacio duro y el salto de línea no cuentan. */
const leido = (pagina: string) => pagina.replace(/\s+/g, " ");
const sinGestion = { enabled: false, unit: "percent" as const, input: "" };

/* Desde la plantilla única (14-11-2026) los rótulos de las cifras y las cabeceras de tabla van en minúscula; antes, en versales. */
test("con capital: el rótulo no dice «total», la hoja 1 dice lo que no incluye y los euros siguen", async () => {
  const pages = await texto({ costs: calculatePortfolioCosts(costPositions, costAssets, 100000), management: sinGestion });
  expect(pages).toHaveLength(3);
  expect(pages[0]).toContain("Coste corriente anual de los productos");
  expect(leido(pages[0])).toContain("No incluye: custodia, intermediación, cambio de divisa, comisión de éxito, comisiones de entrada (suscripción) y salida (reembolso) ni impuestos");
  expect(pages[0]).toContain("Capital analizado");
  expect(pages[0]).toMatch(/100\.000\s€/);
  expect(pages[0]).toMatch(/1\.758\s€/);
  expect(pages[1]).toContain("Coste corriente anual de los productos");
  expect(leido(pages[1])).toContain("Coste anual");
  expect(pages.join(" ")).not.toMatch(/coste total|coste corriente anual total|el total representa|total completo/i);
});

test("con la comisión dentro, la cifra no se llama solo de los productos", async () => {
  const pages = await texto({ costs: calculatePortfolioCosts(costPositions, costAssets, 100000), management: { enabled: true, unit: "percent", input: "0.5" } });
  expect(pages[0]).toContain("Coste anual de los productos y la gestión");
  expect(pages[0]).not.toContain("Coste corriente anual de los productos");
});

test("sin capital: la cifra principal en porcentaje, la hoja 2 sin Capital ni Coste anual, y ningún euro inventado", async () => {
  const pages = await texto({ costs: calculatePortfolioCosts(costPositions, costAssets, 0), management: sinGestion, date: "7 de septiembre de 2026" });
  expect(pages).toHaveLength(3);
  /* 1,76 % de media, a mano en `portfolioCosts.test.ts`. */
  expect(pages[0]).toContain("1,76 % al año, unos 176");
  expect(pages[0]).toContain("por cada 10.000");
  expect(pages[0]).toContain("capital no declarado");
  expect(pages[0]).toContain("Coste corriente anual de los productos");
  expect(leido(pages[0])).toContain("No incluye: custodia, intermediación, cambio de divisa, comisión de éxito, comisiones de entrada (suscripción) y salida (reembolso) ni impuestos");
  expect(pages[0]).not.toContain("Capital analizado");
  expect(pages[0]).not.toContain("Sobre el capital");
  expect(pages[1]).not.toMatch(/capital/i);
  expect(leido(pages[1])).not.toMatch(/coste anual(?! de los productos)/i);
  expect(pages[1]).not.toContain("€");
  /* El coste corriente lo tienen todos; la operación y la entrada, en estos activos de prueba no. Falta, no es un cero. */
  expect(pages[1]).not.toMatch(/0,00 %/);
  expect(pages[1]).toContain("Corriente");
  expect(pages[1]).toContain("Coste corriente anual de los productos");
  expect(pages[1]).toContain("1,76 %");
  for (const asset of costAssets) expect(pages[1]).toContain(asset.asset_id);
  /* Fuera de la frase y de su explicación, ni un euro; y en ningún sitio el capital de ejemplo. */
  expect(pages.join(" ")).not.toContain("100.000");
  expect(pages[0].replace(/por cada 10\.000.€/g, "").replace(/unos 176.€/g, "")).not.toContain("€");
  expect(pages[2]).not.toContain("Ejemplo de esta cartera");
});

test("sin capital y con un fondo sin dato: se dice lo que falta, y ni un cero", async () => {
  const assets = costAssets.map((a, i) => i === 0 ? { ...a, costs: {} } : a);
  const pages = await texto({ costs: calculatePortfolioCosts(costPositions, assets, 0), management: sinGestion });
  expect(pages[0]).toContain("No disponible: falta el coste de 1 de las 8 posiciones");
  expect(pages[0]).toContain("Un dato ausente no equivale a un coste cero");
  expect(pages[0]).not.toContain("Los importes identificados");
  /* Sin cifra, no hay lectura en euros que explicar. */
  expect(pages.join(" ")).not.toContain("por cada 10.000");
  expect(leido(pages[1])).toContain("Falta el dato");
  expect(pages.join(" ")).not.toContain("N/D");
  expect(pages.join(" ")).not.toContain("0,00 %");
});

describe("solo acciones (decisión A-65): «No aplica», como la pantalla, y ni un 0,00 %", () => {
  const accion = (asset_id: string) => ({ ...costAssets[0], asset_id, isin: asset_id, display_name: `Acción ${asset_id}`, instrument_type: "STOCK" as const, costs: undefined });
  const posiciones = [{ asset_id: "X1", weight_percent: 50 }, { asset_id: "X2", weight_percent: 50 }];
  const dos = [accion("X1"), accion("X2")];
  /* También el cero en euros enteros, que ya no lleva céntimos. */
  const NI_UN_CERO = /(?<![\d.,])0(,00)?\s*(%|€)/;

  test("sin capital: «No aplica» en la cifra y en las filas, y ningún euro", async () => {
    const pages = await texto({ costs: calculatePortfolioCosts(posiciones, dos, 0), management: sinGestion });
    expect(pages).toHaveLength(3);
    expect(pages[0]).toContain("No aplica");
    expect(leido(pages[0])).toContain("no hay media que dar");
    /* Sin la ligadura «fi» de «fila», que este lector no saca. */
    expect(leido(pages[0])).toContain("2 acciones: no tienen coste corriente, y en su");
    expect(pages[1]).toContain("No aplica");
    expect(pages[1]).not.toContain("€");
    expect(pages.join(" ")).not.toContain("por cada 10.000");
    expect(pages.join(" ")).not.toMatch(NI_UN_CERO);
    /* Ni cobertura ni media: en todas las filas no aplica. */
    expect(pages[0]).not.toContain("Cobertura de costes");
    expect(leido(pages.join(" "))).not.toContain("cuenta como cero");
  });

  test("con capital: el capital se queda, y las dos cifras y el total de la hoja 2 dicen «No aplica»", async () => {
    const pages = await texto({ costs: calculatePortfolioCosts(posiciones, dos, 100000), management: sinGestion });
    expect(pages).toHaveLength(3);
    expect(pages[0]).toMatch(/100\.000\s€/);
    expect(pages[0]).toContain("No aplica");
    expect(pages[1]).toContain("Coste corriente anual de los productos");
    expect(pages.join(" ")).not.toMatch(NI_UN_CERO);
  });

  test("una sola acción, en singular", async () => {
    const pages = await texto({ costs: calculatePortfolioCosts([{ asset_id: "X1", weight_percent: 100 }], [accion("X1")], 0), management: sinGestion });
    expect(leido(pages[0])).toContain("1 acción: no tiene coste corriente, y en su");
  });

  test("con comisión, la cifra es la comisión: esa sí es un coste, y se escribe", async () => {
    const conCapital = await texto({ costs: calculatePortfolioCosts(posiciones, dos, 100000), management: { enabled: true, unit: "percent", input: "0.5" } });
    expect(conCapital[0]).toContain("Coste anual de los productos y la gestión");
    expect(conCapital[0]).toMatch(/(?<![\d.])500\s€/);
    expect(conCapital[0]).toContain("0,50 %");
    expect(conCapital[0]).toContain("No aplica");
    const sinCapital = await texto({ costs: calculatePortfolioCosts(posiciones, dos, 0), management: { enabled: true, unit: "percent", input: "0.5" } });
    expect(sinCapital[0]).toContain("0,50 % al año, unos 50");
  });

  test("una comisión del 0 % sobre solo acciones tampoco se lee como gratis", async () => {
    const pages = await texto({ costs: calculatePortfolioCosts(posiciones, dos, 100000), management: { enabled: true, unit: "percent", input: "0" } });
    expect(pages[0]).toContain("Comisión indicada");
    /* La única cifra a cero es la comisión que se ha escrito, con su nombre. Desde la plantilla única (14-11-2026) la frase de la comisión
       va bajo su concepto, entre el nombre de la fila y su importe. */
    expect(leido(pages[0]).replace(/Comisión indicada: 0,00 % anual/, "").replace(/Asesoramiento o gestión de la cartera[^€]*?0.€/, "")).not.toMatch(NI_UN_CERO);
  });
});

test("una cartera mixta sigue midiendo: 90 % al 1 % y 10 % en una acción es 0,90 %, y lo dice", async () => {
  const accion = { ...costAssets[0], asset_id: "X1", isin: "X1", display_name: "Acción", instrument_type: "STOCK" as const, costs: undefined };
  const fondo = { ...costAssets[0], asset_id: "F1", isin: "F1", display_name: "Fondo", costs: { ongoing_charge: .01 } };
  const pages = await texto({ costs: calculatePortfolioCosts([{ asset_id: "F1", weight_percent: 90 }, { asset_id: "X1", weight_percent: 10 }], [fondo, accion], 0), management: sinGestion });
  expect(leido(pages[0])).toContain("0,90 % al año, unos 90");
  expect(leido(pages[0])).toContain("1 acción: no tiene coste corriente, en su");
  expect(leido(pages[0])).toContain("y en la media cuenta como cero.");
});

describe("la comisión de gestión, en palabras del cliente (decisión A-65)", () => {
  const costes = (capital: number) => calculatePortfolioCosts(costPositions, costAssets, capital);

  test("en porcentaje: «Comisión indicada: 0,50 % anual», sin cuatro decimales ni lenguaje de operador", async () => {
    const pages = await texto({ costs: costes(100000), management: { enabled: true, unit: "percent", input: "0.5" } });
    expect(leido(pages[0])).toContain("Comisión indicada: 0,50 % anual. Se suma una sola vez a los costes corrientes.");
    expect(leido(pages.join(" "))).not.toMatch(/[Mm]anual|0,5000/);
    expect(leido(pages[2])).toContain("la comisión indicada en este análisis");
  });

  test("en euros, igual", async () => {
    const pages = await texto({ costs: costes(100000), management: { enabled: true, unit: "euros", input: "750" } });
    expect(leido(pages[0])).toContain("Comisión indicada: 750,00 € anual. Se suma una sola vez a los costes corrientes.");
    expect(leido(pages.join(" "))).not.toMatch(/[Mm]anual/);
  });

  test("un porcentaje con más decimales no se redondea: es lo que ha escrito el asesor", async () => {
    const pages = await texto({ costs: costes(100000), management: { enabled: true, unit: "percent", input: "0.125" } });
    expect(leido(pages[0])).toContain("Comisión indicada: 0,125 % anual.");
  });

  test("sin capital, en euros, sigue sin sumarse a nada", async () => {
    const pages = await texto({ costs: costes(0), management: { enabled: true, unit: "euros", input: "750" } });
    expect(leido(pages[0])).toContain("Comisión indicada: 750,00 € anual. Sin capital declarado no se puede expresar en porcentaje, y por eso no se suma a los costes corrientes.");
  });
});

test("sin capital y una sola posición: su coste, y en singular", async () => {
  const pages = await texto({ costs: calculatePortfolioCosts([{ asset_id: costAssets[0].asset_id, weight_percent: 100 }], costAssets, 0), management: sinGestion });
  expect(pages[0]).toContain("1,59 % al año, unos 159");
  expect(pages[0]).toContain("1 posición analizada");
  expect(pages[1]).toContain("1 posición");
  expect(pages[1]).not.toContain("Posiciones 1 a 1");
});

test("sin capital, la comisión en porcentaje entra en la frase y en euros no se suma a nada", async () => {
  const costs = calculatePortfolioCosts(costPositions, costAssets, 0);
  const enPorcentaje = await texto({ costs, management: { enabled: true, unit: "percent", input: "0.5" } });
  expect(enPorcentaje[0]).toContain("Coste anual de los productos y la gestión");
  expect(enPorcentaje[0]).toContain("2,26 % al año, unos 226");
  expect(enPorcentaje[0]).toContain("0,50 %");

  const enEuros = await texto({ costs, management: { enabled: true, unit: "euros", input: "750" } });
  expect(enEuros[0]).toContain("Coste corriente anual de los productos");
  expect(enEuros[0]).toContain("1,76 % al año, unos 176");
  expect(enEuros[0]).toContain("750,00");
  expect(enEuros[0]).toContain("no se suma a los costes corrientes");

  const aMedias = await texto({ costs, management: { enabled: true, unit: "percent", input: "" } });
  expect(aMedias[0]).toContain("Coste anual de los productos y la gestión");
  expect(aMedias[0]).toContain("No disponible");
  expect(aMedias[0]).toContain("está pendiente");
});

test("con todos los avisos a la vez y un nombre largo, la hoja 1 no se desborda", async () => {
  const accion = { ...costAssets[0], asset_id: "X1", isin: "X1", display_name: "Acción", instrument_type: "STOCK" as const, costs: undefined };
  const assets = [...costAssets.map((a, i) => i === 0 ? { ...a, costs: {} } : a), accion];
  const positions = [...costPositions, { asset_id: "X1", weight_percent: 30 }];
  const clientName = "Nombre muy largo de un cliente ".repeat(4).slice(0, 120);
  for (const capital of [0, 100000]) {
    const pages = await texto({ costs: calculatePortfolioCosts(positions, assets, capital), management: { enabled: true, unit: "percent", input: "abc" }, clientName });
    expect(pages).toHaveLength(3);
    expect(pages[0]).toContain("La estimación mantiene constantes");
    expect(pages[0]).toContain("está pendiente");
    expect(pages[0]).toContain("se han normalizado");
  }
});

/* Desde la plantilla única (14-11-2026): sin marca de entidad en ninguna hoja, el sello «CONFIDENCIAL» en todas, y el cliente en la cabecera
   («Preparado para…») en vez de los rótulos «Informe personalizado» y «Cliente» de la portada, que ya no existe. */
test("firma y destinatario: el sello en cada hoja, «su» cartera, y para quién solo si se ha dicho", async () => {
  const costs = calculatePortfolioCosts(costPositions, costAssets, 100000);
  const sinNombre = await texto({ costs, management: sinGestion, clientName: "   " });
  expect(sinNombre[0]).toContain("El coste de su cartera");
  expect(sinNombre.join(" ")).not.toMatch(/tu cartera/i);
  expect(sinNombre.join(" ")).not.toContain("Preparado para");
  sinNombre.forEach((page) => {
    expect(page).toContain("CONFIDENCIAL");
    expect(page).not.toContain("Independent Private Bankers");
  });

  const conNombre = await texto({ costs, management: sinGestion, clientName: " Ana Ruiz " });
  conNombre.forEach((page) => expect(page).toContain("Preparado para Ana Ruiz"));
});

/* El autor es el asesor, y sin asesor no hay autor; antes era «Independent Private Bankers». */
test("los metadatos del fichero llevan el título y, si lo hay, el asesor", async () => {
  const bytes = async (clientName?: string, banker?: { name: string; email: string }) => Buffer.from(await (await createCostsPdfBlob({ costs: calculatePortfolioCosts(costPositions, costAssets, 0), management: sinGestion, clientName, banker })).arrayBuffer());
  expect(extractPdfMetadata(await bytes(), "Author")).toBeNull();
  expect(extractPdfMetadata(await bytes(undefined, { name: "Marta Gil", email: "" }), "Author")).toBe("Marta Gil");
});

test("los metadatos del fichero llevan el título", async () => {
  const leer = async (clave: "Title" | "Author", clientName?: string) => {
    const crudo = Buffer.from(await (await createCostsPdfBlob({ costs: calculatePortfolioCosts(costPositions, costAssets, 0), management: sinGestion, clientName })).arrayBuffer()).toString("latin1");
    /* En el fichero, el diccionario /Info apunta a otros objetos: «/Title 23 0 R». */
    const objeto = (numero: string) => crudo.slice(crudo.indexOf(`\n${numero} 0 obj`)).split("endobj")[0];
    return objeto(new RegExp(`/${clave} (\\d+) 0 R`).exec(objeto(/\/Info (\d+) 0 R/.exec(crudo)![1]))![1]);
  };
  expect(await leer("Title")).toContain("(El coste de su cartera)");
  expect(await leer("Title", "Ana Ruiz")).toContain("(El coste de su cartera - Ana Ruiz)");
});

test("sin que la cifra salga de un KID no se escribe «KID» junto a ella, ni se nombra al proveedor concreto, y la gestión se explica en una línea", async () => {
  for (const capital of [100000, 0]) {
    const pages = await texto({ costs: calculatePortfolioCosts(costPositions, costAssets, capital), management: sinGestion });
    expect(pages.join(" ")).not.toMatch(/KID \d|KID, sin fecha|PRIIP|Morningstar|MiFID/i);
    expect(pages[2]).toContain("Comisión por el servicio de gestión de la cartera, si la hay; ya incluye impuestos");
    expect(pages[2]).not.toContain("Debe introducirse");
    expect(pages[2]).not.toContain("Si se introduce");
  }
});

describe("decisión 43: operación, entrada máxima y fuente de cada cifra", () => {
  const fondo = (asset_id: string, costs: (typeof costAssets)[number]["costs"], display_name = `Fondo ${asset_id}`) =>
    ({ ...costAssets[0], asset_id, isin: asset_id, display_name, costs });
  const conKid = fondo("KID1", {
    ongoing_charge: .0208, ongoing_charge_source: "KID", transaction_costs: .0037, transaction_costs_source: "KID", entry_charge: .045, entry_charge_source: "KID",
    document_url: "https://ejemplo.invalid/kid.pdf", document_date: "2026-08-19"
  });
  const entradaDelProveedor = fondo("PIMCO", {
    ongoing_charge: .0139, ongoing_charge_source: "KID", transaction_costs: .0021, transaction_costs_source: "KID", entry_charge: .05, entry_charge_source: "PROVIDER",
    document_url: "https://ejemplo.invalid/kid2.pdf", document_date: "2026-04-29"
  });
  const sinKid = fondo("ETF1", { ongoing_charge: .002, ongoing_charge_source: "PROVIDER", transaction_costs: .0000263, transaction_costs_source: "PROVIDER" });
  const sinOperacion = fondo("ETF2", { ongoing_charge: .0007, ongoing_charge_source: "PROVIDER" });
  const accion = { ...costAssets[0], asset_id: "ES0144580Y14", isin: "ES0144580Y14", display_name: "Iberdrola S.A.", instrument_type: "STOCK" as const, costs: undefined };
  const pesos = (lista: Array<[string, number]>) => lista.map(([asset_id, weight_percent]) => ({ asset_id, weight_percent }));

  test("con capital: la fila de operación con su fuente y sobre qué peso, el total, y las columnas de cada activo", async () => {
    /* 50 × 0,37 + 30 × 0,21 = 24,8; 20 × 0,00263 = 0,0526. Operación 0,248526 %: 248,53 € sobre 100.000 €.
       Corriente 50 × 2,08 + 30 × 1,39 + 20 × 0,20 = 149,7: 1,497 %. Con la operación, 1,745526 %: 1.745,53 €. */
    const pages = await texto({ costs: calculatePortfolioCosts(pesos([["KID1", 50], ["PIMCO", 30], ["ETF1", 20]]), [conKid, entradaDelProveedor, sinKid], 100000), management: sinGestion });
    expect(pages).toHaveLength(3);
    expect(pages[0]).toContain("Costes de operación de los fondos");
    expect(pages[0]).toMatch(/(?<![\d.])249\s€/);
    expect(pages[0]).toContain("Del KID, 0,25 % de la cartera, medido sobre el 80,0 % del peso; del proveedor, menos de 0,01 %, sobre el 20,0 %.");
    expect(pages[0]).toContain("Coste corriente más operación");
    expect(pages[0]).toMatch(/1\.746\s€/);
    expect(pages[0]).toContain("1,75 % sobre el capital");
    /* El rótulo de la cifra principal se queda, y la cifra no cambia. */
    expect(pages[0]).toContain("Coste corriente anual de los productos");
    expect(pages[0]).toMatch(/1\.497\s€/);
    expect(leido(pages[1])).toContain("Entrada máx.");
    expect(pages[1]).toContain("Fuente");
    expect(pages[1]).toContain("KID 19/08/2026");
    expect(pages[1]).toContain("KID 29/04/2026; entrada: proveedor");
    expect(pages[1]).toContain("Proveedor de datos");
    expect(pages[1]).not.toContain("sin KID");
    expect(pages[1]).toContain("Cada cifra sale de lo que dice «Fuente»");
    expect(pages[1]).toContain("4,50 %");
    expect(pages[1]).toContain("5,00 %");
  });

  test("sin capital: en porcentajes, ningún euro, y el total también", async () => {
    const pages = await texto({ costs: calculatePortfolioCosts(pesos([["KID1", 50], ["PIMCO", 30], ["ETF1", 20]]), [conKid, entradaDelProveedor, sinKid], 0), management: sinGestion });
    expect(pages[0]).toContain("0,25 %");
    expect(pages[0]).toContain("1,75 %");
    expect(pages[1]).not.toContain("€");
    expect(pages[1]).toContain("KID 19/08/2026");
  });

  test("si solo cubre parte del peso se dice sobre cuánto, y no hay total", async () => {
    /* 80 × 0,37 = 29,6: 0,296 %. Falta el 20 %. */
    const pages = await texto({ costs: calculatePortfolioCosts(pesos([["KID1", 80], ["ETF2", 20]]), [conKid, sinOperacion], 100000), management: sinGestion });
    expect(pages[0]).toContain("Costes de operación de los fondos, parcial");
    expect(pages[0]).toMatch(/(?<![\d.])296\s€/);
    expect(pages[0]).toContain("El 20,0 % del peso no tiene el dato");
    expect(pages[0]).not.toContain("Coste corriente más operación");
    expect(leido(pages[1])).toMatch(/Falta el\s+dato/);
    expect(pages[1]).not.toContain("N/D");
  });

  test("una acción dice «No aplica» en las tres columnas, también en Fuente, y no N/D", async () => {
    const pages = await texto({ costs: calculatePortfolioCosts(pesos([["KID1", 90], ["ES0144580Y14", 10]]), [conKid, accion], 0), management: sinGestion });
    const filaDeLaAccion = pages[1].slice(pages[1].indexOf("Iberdrola"), pages[1].indexOf("Coste corriente anual"));
    expect(filaDeLaAccion.match(/No aplica/g)).toHaveLength(4);
    expect(filaDeLaAccion).not.toContain("N/D");
    expect(pages[0]).toContain("El 10,0 % son acciones, y a una acción no le aplica.");
  });

  test("solo acciones: ni fila de operación ni total, que dirían lo que no hay", async () => {
    const pages = await texto({ costs: calculatePortfolioCosts(pesos([["ES0144580Y14", 100]]), [accion], 100000), management: sinGestion });
    expect(pages[0]).not.toContain("Costes de operación de los fondos");
    expect(pages[0]).not.toContain("Coste corriente más operación");
    /* En sus filas no hay ninguna cifra con fuente: la nota que explica la columna no tiene de qué hablar. */
    expect(pages[1]).not.toContain("Cada cifra sale");
  });

  test("hoja 1 y hoja 3 no se contradicen: la cifra principal no lleva operación ni entrada, y las dos lo dicen", async () => {
    const pages = await texto({ costs: calculatePortfolioCosts(pesos([["KID1", 100]]), [conKid], 100000), management: sinGestion });
    expect(pages[0]).toContain("No entran en la cifra de arriba");
    expect(pages[2]).toContain("La cifra principal no lleva los costes de operación ni la entrada máxima");
    expect(pages[2]).not.toContain("comisiones de entrada o salida");
    /* La misma lista que la hoja 1, y no otra: una sola redacción para el mismo hecho (decisión A-65). */
    expect(leido(pages[2])).toContain("No incluye: custodia, intermediación, cambio de divisa, comisión de éxito, comisiones de entrada (suscripción) y salida (reembolso) ni impuestos.");
    expect(pages[2]).not.toContain("No se han incorporado");
  });

  test("doce filas con nombres normales caben en una hoja; con nombres muy largos, menos, y ninguna tabla se parte", async () => {
    const corto = Array.from({ length: 12 }, (_, i) => fondo(`C${i}`, conKid.costs, `Fondo corto ${i}`));
    const hojasCortas = await texto({ costs: calculatePortfolioCosts(corto.map((a) => ({ asset_id: a.asset_id, weight_percent: 100 / 12 })), corto, 100000), management: sinGestion });
    expect(hojasCortas).toHaveLength(3);

    const largo = "Principal Global Investors Funds - Finisterre Unconstrained Emerging Market Fxd Inc Fd A Hdg Acc EUR";
    const largos = Array.from({ length: 30 }, (_, i) => fondo(`L${i}`, { ...conKid.costs, entry_charge_source: "PROVIDER" }, `${largo} ${i}`));
    for (const capital of [100000, 0]) {
      const hojas = await texto({ costs: calculatePortfolioCosts(largos.map((a) => ({ asset_id: a.asset_id, weight_percent: 100 / 30 })), largos, capital), management: sinGestion });
      /* Desde la plantilla única (14-11-2026) las hojas de la tabla no repiten el título de la sección, sino la cabecera de la tabla. */
      hojas.filter((hoja) => /\bL\d+\b/.test(hoja)).forEach((hoja) => expect(hoja).toContain("Activo / ISIN"));
      expect(hojas[hojas.length - 1]).toContain("Coste corriente del activo");
      for (const a of largos) expect(hojas.join(" ")).toContain(a.asset_id);
    }
  });
});

/*
 * Lo que hacía `repartirEnHojas` (doce filas por hoja como mucho, las que quepan por su alto, y el total nunca solo en una hoja) lo hace
 * desde la plantilla única (14-11-2026) su `Tabla`: filas que no se parten, cabecera que se repite, y las dos últimas filas con el total.
 * La función se quitó con su estimador de altos (INF-27), y estas pruebas afirman lo mismo sobre el PDF.
 */
describe("las filas en hojas, sobre el PDF", () => {
  const fondos = (n: number, nombre: (i: number) => string) => Array.from({ length: n }, (_, i) => ({ ...costAssets[0], asset_id: `F${String(i).padStart(2, "0")}`, isin: `F${String(i).padStart(2, "0")}`, display_name: nombre(i) }));
  const hojasDe = (activos: ReturnType<typeof fondos>) => texto({ costs: calculatePortfolioCosts(activos.map((a) => ({ asset_id: a.asset_id, weight_percent: 100 / activos.length })), activos, 100000), management: sinGestion });

  test("trece filas cortas caben con el total en la hoja del desglose", async () => {
    const hojas = await hojasDe(fondos(13, (i) => `Fondo ${i}`));
    expect(hojas).toHaveLength(3);
    expect(hojas[1]).toContain("F12");
    expect(hojas[1]).toContain("Coste corriente anual de los productos");
  });

  test("con nombres largos salen las hojas que hagan falta; ninguna fila se pierde, y el total va con las dos últimas", async () => {
    const largo = "Principal Global Investors Funds - Finisterre Unconstrained Emerging Market Fxd Inc Fd A Hdg Acc EUR";
    const hojas = await hojasDe(fondos(30, (i) => `${largo} ${i}`));
    const conFilas = hojas.filter((hoja) => /F\d\d/.test(hoja));
    expect(conFilas.length).toBeGreaterThanOrEqual(2);
    expect(conFilas.flatMap((hoja) => [...hoja.matchAll(/\bF(\d\d)\b/g)].map((m) => Number(m[1])))).toEqual(Array.from({ length: 30 }, (_, i) => i));
    const conTotal = conFilas.find((hoja) => hoja.includes("Coste corriente anual de los productos"))!;
    expect(conTotal).toContain("F28");
    expect(conTotal).toContain("F29");
  }, 30_000);
});

describe("el papel de cliente (aprobado por Óscar el 11-11-2026)", () => {
  const costes = (capital: number) => calculatePortfolioCosts(costPositions, costAssets, capital);
  const espaciado = (rotulo: string) => new RegExp([...rotulo.replace(/\s/g, "")].join("\\s*"));
  const fondoSinDato = costAssets.map((a, i) => (i === 0 ? { ...a, costs: {} } : a));

  /* Desde la plantilla única (14-11-2026): sus dos letras, y el sello «CONFIDENCIAL» arriba en cada hoja, nunca el sello «INDEPENDENT PRIVATE
     BANKERS». Desde el 14-11-2026 (decisión de Óscar: recuperar el aspecto de los informes de antes) la plantilla vuelve a Fraunces y Roboto Flex; IBM Plex Sans y Source Serif 4, las de la plantilla de una sola tinta, salieron. */
  test("la letra es la de la plantilla y el sello va arriba, en mayúsculas", async () => {
    const blob = await createCostsPdfBlob({ costs: costes(100000), management: sinGestion });
    const bytes = Buffer.from(await blob.arrayBuffer());
    const crudo = bytes.toString("latin1");
    expect(crudo).toMatch(/\/BaseFont\s*\/[A-Z]+\+RobotoFlex/);
    expect(crudo).toMatch(/\/BaseFont\s*\/[A-Z]+\+Fraunces/);
    expect(crudo).not.toMatch(/IBMPlexSans|SourceSerif4|InstrumentSans|Newsreader/);
    extractPdfTextBaselines(bytes).forEach((cadenas) => expect(cadenas.some((c) => c.texto.trim() === "CONFIDENCIAL" && c.y < 60)).toBe(true));
    extractPdfPageTexts(bytes).forEach((hoja) => expect(hoja).not.toMatch(espaciado("INDEPENDENT PRIVATE BANKERS")));
  });

  describe("la fila de asesoramiento o gestión", () => {
    test("sin comisión indicada no sale, ni su frase; lo que no incluye el coste no cambia", async () => {
      for (const capital of [100000, 0]) {
        const pages = await texto({ costs: costes(capital), management: { enabled: false, unit: "euros", input: "750" } });
        expect(pages[0]).not.toMatch(/Asesoramiento o gestión|Gestión adicional|No añadida|No se ha añadido|Comisión indicada/);
        expect(leido(pages.join(" "))).not.toContain("la comisión indicada en este análisis");
        expect(leido(pages[2])).toContain("cada una con su fuente. La cifra principal");
        expect(leido(pages[0])).toContain("No incluye: custodia, intermediación, cambio de divisa, comisión de éxito, comisiones de entrada (suscripción) y salida (reembolso) ni impuestos.");
      }
    });

    test("con comisión sale rotulada, y se suma exactamente como antes", async () => {
      const pages = await texto({ costs: costes(100000), management: { enabled: true, unit: "percent", input: "0.5" } });
      expect(pages[0]).toContain("Asesoramiento o gestión de la cartera");
      expect(pages[0]).not.toContain("Gestión adicional");
      expect(leido(pages[0])).toContain("Comisión indicada: 0,50 % anual. Se suma una sola vez a los costes corrientes.");
      /* 1.758,26 € de los productos y 500 € de la comisión. */
      expect(pages[0]).toMatch(/2\.258\s€/);
    });

    test("en euros y sin capital va aparte y no se suma; no válida, dice que falta el dato", async () => {
      const aparte = await texto({ costs: costes(0), management: { enabled: true, unit: "euros", input: "750" } });
      expect(aparte[0]).toContain("Asesoramiento o gestión de la cartera");
      expect(aparte[0]).toContain("1,76 % al año, unos 176");
      expect(leido(aparte[0])).toContain("no se suma a los costes corrientes");

      const noValida = await texto({ costs: costes(100000), management: { enabled: true, unit: "percent", input: "abc" } });
      expect(noValida[0]).toContain("Asesoramiento o gestión de la cartera");
      expect(leido(noValida[0])).toContain("Comisión indicada: falta el dato.");
      expect(leido(noValida[0])).toContain("Falta el dato del coste con gestión.");
      expect(noValida[0]).not.toContain("N/D");
      expect(leido(noValida[0])).not.toContain("Se suma una sola vez");
    });
  });

  describe("cifras", () => {
    const CENTIMOS = /\d,\d{2}\s*€/;

    test("euros sin céntimos en tarjetas, filas, tabla y ejemplo", async () => {
      const pages = await texto({ costs: costes(100000), management: { enabled: true, unit: "percent", input: "0.5" } });
      pages.forEach((hoja) => expect(hoja).not.toMatch(CENTIMOS));
      expect(pages[0]).toMatch(/100\.000\s€/);
      /* El ejemplo de la guía: la primera fila, 18,29 / 181,25 de 100.000 € al 1,59 %. */
      expect(leido(pages[2])).toMatch(/10\.091\s€ × 1,5900 % = 160\s€ estimados al año/);
      expect(pages[1]).toMatch(/10\.091\s€/);
    });

    test("la excepción: la comisión en euros se escribe como la tecleó el asesor, y la fila va sin céntimos", async () => {
      const pages = await texto({ costs: costes(100000), management: { enabled: true, unit: "euros", input: "750.5" } });
      expect(leido(pages[0])).toMatch(/Comisión indicada: 750,50\s€ anual\./);
      expect(pages[0].replace(/750,50\s€ anual/, "")).not.toMatch(CENTIMOS);
      /* Desde la plantilla única (14-11-2026) la frase de la comisión va bajo su concepto, entre el nombre de la fila y su importe. */
      expect(leido(pages[0])).toMatch(/Asesoramiento o gestión de la cartera Comisión indicada: [^€]*€ anual\.[^€]*751\s€/);
    });

    test("la nota de la hoja 2 ya no habla de céntimos", async () => {
      const pages = await texto({ costs: costes(100000), management: sinGestion });
      expect(pages[1]).not.toMatch(/céntimos/);
      expect(leido(pages[1])).toContain("puede diferir unos euros del total");
    });

    test("un importe que redondea a cero no se escribe como un cero", async () => {
      const etf = { ...costAssets[0], asset_id: "E1", isin: "E1", display_name: "ETF", costs: { ongoing_charge: .0005 } };
      const pages = await texto({ costs: calculatePortfolioCosts([{ asset_id: "E1", weight_percent: 100 }], [etf], 500), management: sinGestion });
      expect(pages[1]).toMatch(/<\s1\s€/);
    });

    test("los pesos con un decimal, la cobertura sin decimales y las tasas con dos", async () => {
      const dos = [
        { ...costAssets[0], asset_id: "A", isin: "A", display_name: "A", costs: { ongoing_charge: .0173 } },
        { ...costAssets[0], asset_id: "B", isin: "B", display_name: "B", costs: {} }
      ];
      const pages = await texto({ costs: calculatePortfolioCosts([{ asset_id: "A", weight_percent: 87.5 }, { asset_id: "B", weight_percent: 12.5 }], dos, 100000), management: sinGestion });
      expect(pages[1]).toContain("87,5 %");
      expect(pages[1]).toContain("1,73 %");
      expect(pages[1]).not.toContain("87,50 %");
      /* El 87,5 % del peso, redondeado sin decimales. */
      expect(pages[0]).toContain("Cobertura de costes: 88 % del peso");

      const iguales = Array.from({ length: 10 }, (_, i) => ({ ...costAssets[0], asset_id: `F${i}`, isin: `F${i}`, display_name: `F${i}`, costs: { ongoing_charge: .01 } }));
      const diez = await texto({ costs: calculatePortfolioCosts(iguales.map((a) => ({ asset_id: a.asset_id, weight_percent: 10 })), iguales, 100000), management: sinGestion });
      expect(diez[1]).toContain("10,0 %");
      expect(diez[0]).toContain("Cobertura de costes: 100 % del peso");
    });
  });

  describe("«Falta el dato» y ningún «N/D»", () => {
    test("en ningún caso del papel se escribe N/D", async () => {
      const casos = [
        { costs: costes(100000), management: sinGestion },
        { costs: costes(0), management: sinGestion },
        { costs: calculatePortfolioCosts(costPositions, fondoSinDato, 100000), management: sinGestion },
        { costs: calculatePortfolioCosts(costPositions, fondoSinDato, 0), management: sinGestion },
        { costs: calculatePortfolioCosts(costPositions, fondoSinDato, 100000), management: { enabled: true, unit: "percent" as const, input: "abc" } },
        { costs: costes(0), management: { enabled: true, unit: "euros" as const, input: "" } }
      ];
      for (const caso of casos) expect((await texto(caso)).join(" ")).not.toContain("N/D");
      /* Genera seis documentos: con la máquina cargada no cabe en los cinco segundos por defecto (agotó el tiempo con la
         suite entera corriendo junto a la compilación; sola tarda poco más de dos). */
    }, 30_000);

    test("en el texto, en las filas y en la guía", async () => {
      const con = await texto({ costs: calculatePortfolioCosts(costPositions, fondoSinDato, 100000), management: sinGestion });
      /* Sin la ligadura «fi» de «identificados», que este lector no saca. */
      expect(leido(con[0])).toContain("son parciales; falta el dato del coste de toda la cartera.");
      expect(leido(con[0])).toContain("1 posición sin coste corriente.");
      expect(con[0]).not.toContain("válido");
      expect(leido(con[0])).toContain("Media ponderada: falta el dato.");
      expect(leido(con[1])).toMatch(/Falta el\s+dato/);
      /* «significa» y «suficiente» llevan la ligadura «fi», que este lector no saca. */
      expect(leido(con[2])).toMatch(/«\s*Falta el dato» sig/);
      expect(leido(con[2])).toContain("que no hay información");
      expect(con[2]).not.toContain("N/D");

      const sin = await texto({ costs: calculatePortfolioCosts(costPositions, fondoSinDato, 0), management: sinGestion });
      expect(leido(sin[0])).toContain("Falta el dato del coste de toda la cartera.");
    });
  });

  test("«Proveedor de datos» tenga o no KID la ficha, y lo mixto se sigue nombrando", async () => {
    const fondo = (asset_id: string, costs: (typeof costAssets)[number]["costs"]) => ({ ...costAssets[0], asset_id, isin: asset_id, display_name: asset_id, costs });
    const assets = [
      fondo("SINKID", { ongoing_charge: .002, ongoing_charge_source: "PROVIDER" }),
      fondo("CONKID", { ongoing_charge: .002, ongoing_charge_source: "PROVIDER", document_url: "https://ejemplo.invalid/kid.pdf" }),
      fondo("MIXTO", { ongoing_charge: .002, ongoing_charge_source: "KID", entry_charge: .05, entry_charge_source: "PROVIDER", document_url: "https://ejemplo.invalid/kid.pdf", document_date: "2026-04-29" })
    ];
    const pages = await texto({ costs: calculatePortfolioCosts(assets.map((a) => ({ asset_id: a.asset_id, weight_percent: 100 / 3 })), assets, 0), management: sinGestion });
    expect(pages[1].match(/Proveedor de datos/g)).toHaveLength(2);
    expect(pages[1]).not.toContain("sin KID");
    expect(leido(pages[1])).toContain("KID 29/04/2026; entrada: proveedor");
  });

  /* Desde la plantilla única (14-11-2026) quien elabora el informe va en el membrete de cada hoja y el cliente en la cabecera («Preparado
     para…»), en vez de los bloques «Elaborado por» y «Cliente» de la portada, que ya no existe. Se mira la cabecera de la primera hoja. */
  const cabecera = async (input: Parameters<typeof createCostsPdfBlob>[0]) =>
    extractPdfTextBaselines(Buffer.from(await (await createCostsPdfBlob(input)).arrayBuffer()))[0].filter((c) => c.y < 60).map((c) => c.texto.trim()).join(" | ");

  describe("cliente y responsable", () => {
    test("no se pinta nada si no llegan; tampoco un nombre por defecto", async () => {
      const pages = await texto({ costs: costes(100000), management: sinGestion, banker: { name: "  ", email: "" } });
      expect(await cabecera({ costs: costes(100000), management: sinGestion, banker: { name: "  ", email: "" } })).toBe("Costes de la propuesta | CONFIDENCIAL");
      expect(pages.join(" ")).not.toMatch(/Elaborado por|Preparado para/);
      expect(pages.join(" ")).not.toContain("Antiza");
    });

    test("cada uno por su lado, como llegue", async () => {
      const solo = await cabecera({ costs: costes(100000), management: sinGestion, banker: { name: "Marta Gil", email: "" } });
      expect(solo).toContain("Marta Gil");
      expect(solo).not.toContain("Preparado para");

      const los2 = await cabecera({ costs: costes(100000), management: sinGestion, clientName: "Ana Ruiz", banker: { name: "Marta Gil", email: "marta@ejemplo.invalid" } });
      /* Desde el 14-11-2026 (el aspecto de los informes de antes) «Preparado para» va en el pie de cada hoja, no en la cabecera. */
      expect(los2).not.toContain("Preparado para");
      expect(los2).toContain("Marta Gil");
      expect(los2).toContain("marta@ejemplo.invalid");
      const hojas = await texto({ costs: costes(100000), management: sinGestion, clientName: "Ana Ruiz", banker: { name: "Marta Gil", email: "marta@ejemplo.invalid" } });
      expect(hojas).toHaveLength(3);
      for (const hoja of hojas) expect(hoja).toContain("Preparado para Ana Ruiz");
    });
  });

  /* Los apartados de la guía ya no llevan número: van dentro de la sección numerada «Qué significa cada coste» (plantilla única, 14-11-2026). */
  test("lo que se queda y lo que se va: la guía de la gestión literal, sin línea de entrada, y el párrafo sin su primera frase", async () => {
    for (const capital of [100000, 0]) {
      const pages = await texto({ costs: costes(capital), management: { enabled: true, unit: "percent", input: "0.5" } });
      expect(leido(pages[2])).toContain("Gestión de la cartera Comisión por el servicio de gestión de la cartera, si la hay; ya incluye impuestos. Alcance y datos pendientes");
      expect(pages[0]).not.toMatch(/Entrada|Comisión de entrada/);
      expect(pages.join(" ")).not.toMatch(/retrocesi/i);
      expect(leido(pages[0])).not.toContain("Este informe explica");
      expect(leido(pages[0])).toContain(capital ? "Todos los importes corresponden a una estimación de un año sobre el capital analizado." : "No se ha declarado un capital: las cifras son porcentajes anuales, una estimación de un año");
    }
  });

  /* Desde la plantilla única (14-11-2026) la tabla sigue en las hojas que hagan falta con su cabecera repetida, y la nota de redondeo va una vez,
     al final de la tabla; antes, cuatro hojas de diez filas con su título y su nota cada una. */
  test("ninguna fila se parte ni se pierde, y la nota de redondeo va con la última hoja de la tabla: con 40 posiciones", async () => {
    const largo = "Principal Global Investors Funds - Finisterre Unconstrained Emerging Market Fxd Inc Fd A Hdg Acc EUR";
    const cuarenta = Array.from({ length: 40 }, (_, i) => ({ ...costAssets[0], asset_id: `L${i}`, isin: `L${i}`, display_name: i % 2 ? `${largo} ${i}` : `Fondo corto ${i}`, costs: { ongoing_charge: .01 } }));
    const hojas = await texto({ costs: calculatePortfolioCosts(cuarenta.map((a) => ({ asset_id: a.asset_id, weight_percent: 2.5 })), cuarenta, 100000), management: sinGestion });
    const conFilas = hojas.filter((hoja) => /\bL\d+\b/.test(hoja));
    conFilas.forEach((hoja) => expect(hoja).toContain("Activo / ISIN"));
    expect(conFilas.flatMap((hoja) => [...hoja.matchAll(/\bL(\d+)\b/g)].map((m) => Number(m[1])))).toEqual(cuarenta.map((_, i) => i));
    expect(conFilas.at(-1)).toContain("Los cálculos utilizan");
  });
});

test("decisión B-78: la fila de una posición cuyos datos se quedaron en una fecha lo dice, sin una hoja más; sin ninguna, nada", async () => {
  const costs = calculatePortfolioCosts(costPositions, costAssets, 100000);
  const management = { enabled: true, unit: "percent" as const, input: "0.5" };
  const parada = costAssets[0].asset_id;
  const sin = extractPdfPageTexts(Buffer.from(await (await createCostsPdfBlob({ costs, management })).arrayBuffer()));
  const con = extractPdfPageTexts(Buffer.from(await (await createCostsPdfBlob({ costs, management, seriesParadas: new Map([[parada, "2025-11-28"]]) })).arrayBuffer()));
  expect(con).toHaveLength(sin.length);
  expect(con[1].replace(/\s+/g, " ")).toContain("Sus datos llegan hasta el 28/11/2025.");
  expect(con.join(" ").match(/Sus datos llegan hasta/g)).toHaveLength(1);
  expect(sin.join(" ")).not.toContain("Sus datos llegan hasta");
  /* Mide una línea más, y el reparto lo sabe: con doce filas en la hoja y todas paradas, ninguna se sale de su hoja. */
  const doce = Array.from({ length: 24 }, (_, i) => ({ ...costAssets[0], asset_id: `PRUEBA${i}`, isin: `PRUEBA${i}`, display_name: `Fondo de prueba con un nombre largo de los reales número ${i}` }));
  const costes24 = calculatePortfolioCosts(doce.map((a) => ({ asset_id: a.asset_id, weight_percent: 100 / 24 })), doce, 100000);
  const todas = new Map(doce.map((a) => [a.asset_id, "2025-11-28"]));
  const hojas = extractPdfPageTexts(Buffer.from(await (await createCostsPdfBlob({ costs: costes24, management, seriesParadas: todas })).arrayBuffer()));
  for (const asset of doce) expect(hojas.join(" ")).toContain(asset.asset_id);
  /* Desde la plantilla única (14-11-2026), toda hoja con filas lleva la cabecera de su tabla (antes, el título de la sección). */
  hojas.filter((hoja) => /PRUEBA\d/.test(hoja)).forEach((hoja) => expect(hoja).toContain("Activo / ISIN"));
}, 60_000);

describe("las comisiones de entrada (suscripción) y salida (reembolso): un solo nombre (Óscar, 11-11-2026)", () => {
  const casos = [["con capital", 100000, false], ["sin capital", 0, false], ["con capital y gestión", 100000, true], ["sin capital y gestión", 0, true]] as const;
  test.each(casos)("%s: la portada y la guía lo dicen, «impuestos.» no se queda sola y el papel sigue en tres hojas", async (_caso, capital, gestion) => {
    const bytes = Buffer.from(await (await createCostsPdfBlob({
      costs: calculatePortfolioCosts(costPositions, costAssets, capital), management: { enabled: gestion, unit: "percent", input: gestion ? "0.5" : "" }
    })).arrayBuffer());
    const hojas = extractPdfPageTexts(bytes);
    expect(hojas).toHaveLength(3);
    expect(leido(hojas[0])).toContain("comisiones de entrada (suscripción) y salida (reembolso) ni impuestos.");
    expect(leido(hojas[2])).toContain("comisiones de entrada (suscripción) y salida (reembolso) ni impuestos.");
    expect(leido(hojas[2])).toContain("La entrada (suscripción) máxima es lo más que se puede cobrar al invertir");
    expect(leido(hojas.join(" "))).not.toMatch(/entrada y salida|suscripción o reembolso/);
    /* Decisión 80: los tres últimos términos van juntos. */
    expect(lineasHuerfanasDeImpuestos(bytes)).toEqual([]);
    for (const linea of lineasCon(bytes, "impuestos. ")) expect(linea).not.toMatch(/^impuestos\./);
    expect(lineasCon(bytes, "ni impuestos.").every((linea) => linea.includes("(reembolso) ni impuestos."))).toBe(true);
  }, 30_000);
});
