import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, test } from "vitest";
import {
  createAssetComparisonPdfBlob,
  drawdownColumn,
  instrumentTypeLabel,
  nombreDelFicheroDeLaComparativa,
  type AssetComparePdfInput
} from "../src/reports/assetComparePdf";
import { columnasDeActivos, filasDeActivos, type FuenteDeColumna } from "../src/adapters/comparativaDeActivos";
import { extractPdfPageTexts } from "./support/pdfText";

const input: AssetComparePdfInput = {
  assets: [
    {
      name: "MFS European Research A1 EUR",
      color: "#143D66",
      isin: "LU0094557526",
      ticker: "MFSER",
      instrumentType: "FUND",
      currency: "EUR",
      category: "RV Europa Cap. Grande Blend",
      morningstarRating: 4,
      return1y: 0.184,
      return3y: 0.121,
      return5y: 0.098,
      return10y: 0.074,
      volatility1y: 0.112,
      volatility3y: 0.128,
      sharpe3y: 0.82,
      maxDrawdown: -0.243,
      retro: 0.0055,
      base100: 141.2
    },
    {
      name: "JPM Europe Strategic Value D Acc EUR",
      color: "#B66A3C",
      isin: "LU0117858752",
      instrumentType: "FUND",
      currency: "EUR",
      category: "RV Europa Cap. Grande Value",
      morningstarRating: null,
      return3y: 0.144,
      volatility3y: 0.151,
      sharpe3y: 0.9,
      maxDrawdown: -0.312,
      base100: 152.8
    }
  ],
  windowLabel: "01/09/2023 a 03/09/2026 · 3A · 157 obs. semanales",
  benchmarkName: "Equilibrado",
  benchmarkBase100: 123.4,
  maxDrawdownLabel: "Máx. caída 5A",
  methodologyFootnote: "Sharpe 3A calculado con €STR como activo sin riesgo.",
  correlation: {
    labels: ["MFS European Research A1 EUR", "JPM Europe Strategic Value D Acc EUR"],
    matrix: [
      [1, 0.87],
      [0.87, 1]
    ]
  },
  salida: "interno"
};

async function expectPdfBlob(blob: Blob): Promise<void> {
  expect(blob.type).toBe("application/pdf");
  expect(blob.size).toBeGreaterThan(1000);
  const header = await blob.slice(0, 5).text();
  expect(header).toBe("%PDF-");
}

describe("informe PDF de comparación de activos", () => {
  test("renderiza el informe completo (con benchmark, retro y correlación)", async () => {
    await expectPdfBlob(await createAssetComparisonPdfBlob(input));
  }, 15_000);

  test("renderiza sin benchmark, sin retro y sin correlación (la salida para el cliente)", async () => {
    const blob = await createAssetComparisonPdfBlob({
      ...input,
      benchmarkName: null,
      benchmarkBase100: undefined,
      correlation: null,
      salida: "cliente",
      assets: input.assets.map((asset) => ({ ...asset, retro: undefined }))
    });
    await expectPdfBlob(blob);
  }, 15_000);

  test("auditoría 14-10 (MEDIA-18c): tipo en español y máxima caída con la ventana de cada fila", async () => {
    expect(instrumentTypeLabel("FUND")).toBe("Fondo");
    expect(instrumentTypeLabel("stock")).toBe("Acción");
    /* Antes «N/D»: lo que falta se dice con las palabras del sistema. */
    expect(instrumentTypeLabel(undefined)).toBe("Falta el dato");
    // Misma ventana en todas las filas: la cabecera la nombra.
    expect(drawdownColumn({ ...input, assets: input.assets.map((a) => ({ ...a, maxDrawdownLabel: "Máx. caída 5A" })) }))
      .toEqual({ header: "Máx. caída 5A", mixed: false, windows: ["5A"] });
    // Un activo SIN cifra (assetMetrics le pone «5A» por defecto) no fuerza la mezcla.
    const withMissing = drawdownColumn({
      ...input,
      assets: [
        { ...input.assets[0], maxDrawdownLabel: "Máx. caída (hist.)" },
        { ...input.assets[1], maxDrawdown: undefined, maxDrawdownLabel: "Máx. caída 5A" }
      ]
    });
    expect(withMissing).toEqual({ header: "Máx. caída (hist.)", mixed: false, windows: ["hist."] });
    // Ventanas distintas: cabecera neutra, no la del primer activo.
    const mixedInput: AssetComparePdfInput = {
      ...input,
      maxDrawdownLabel: "Máx. caída",
      assets: [
        { ...input.assets[0], maxDrawdownLabel: "Máx. caída (hist.)" },
        { ...input.assets[1], maxDrawdownLabel: "Máx. caída 5A" }
      ]
    };
    expect(drawdownColumn(mixedInput)).toEqual({ header: "Máx. caída", mixed: true, windows: ["hist.", "5A"] });

    const text = extractPdfPageTexts(Buffer.from(await (await createAssetComparisonPdfBlob(mixedInput)).arrayBuffer())).join(" ");
    expect(text).toContain("Fondo");
    expect(text).not.toContain("FUND");
    // Con dos decimales, como la pantalla (FMT-01).
    expect(text).toContain("−24,30 % · hist.");
    // El lector de texto separa «5A» en «5 A» (posicionado del glifo), igual que «1 A» en la cabecera.
    expect(text).toMatch(/−31,20 % · 5 años/);
    expect(text).not.toContain("Máx. caída (hist.)");
  }, 15_000);

  test("aguanta métricas ausentes sin romper", async () => {
    const blob = await createAssetComparisonPdfBlob({
      ...input,
      assets: [
        { name: "Activo sin datos", color: "#143D66", isin: "ES0000000000" },
        { name: "Otro sin datos", color: "#B66A3C" }
      ],
      correlation: null
    });
    await expectPdfBlob(blob);
  }, 15_000);
});

/** Texto de cada hoja, con los espacios del lector normalizados, y los metadatos del documento. */
async function leer(entrada: AssetComparePdfInput) {
  const bytes = Buffer.from(await (await createAssetComparisonPdfBlob(entrada)).arrayBuffer());
  const crudo = bytes.toString("latin1");
  /* El diccionario de metadatos apunta a un objeto aparte con la cadena: «/Author 21 0 R» y «21 0 obj (…)». */
  const metadato = (campo: string) => {
    const objeto = new RegExp(`/${campo} (\\d+) 0 R`).exec(crudo)?.[1];
    return objeto ? new RegExp(`\\b${objeto} 0 obj\\s*\\(((?:[^()\\\\]|\\\\.)*)\\)`).exec(crudo)?.[1] : undefined;
  };
  return {
    hojas: extractPdfPageTexts(bytes).map((hoja) => hoja.replace(/\s+/g, " ")),
    autor: metadato("Author"),
    titulo: metadato("Title"),
    asunto: metadato("Subject")
  };
}

/*
 * Desde la plantilla única (migración de informes, 14-11-2026) la marca de la casa desaparece: cada salida lleva el sello de su
 * tema en la cabecera y en el pie de cada hoja («CONFIDENCIAL» la de cliente, «USO INTERNO» y «No entregar al cliente» la
 * interna) y el autor del PDF es el asesor (aquí, sin identidad guardada, ninguno). Lo que no cambia es lo que oculta cada salida.
 */
describe("las dos salidas (decisión 20) y su sello", () => {
  const cinco: AssetComparePdfInput = {
    ...input,
    assets: Array.from({ length: 5 }, (_, indice) => ({ ...input.assets[0], name: `Activo ${indice + 1}`, isin: `LU000000000${indice}` })),
    correlation: {
      labels: Array.from({ length: 5 }, (_, indice) => `Activo ${indice + 1}`),
      matrix: Array.from({ length: 5 }, () => [1, 0.5, 0.5, 0.5, 0.5])
    }
  };

  test("para el cliente: ni columna ni rastro, aunque la entrada traiga la cifra, y su sello en cada hoja", async () => {
    const { hojas, autor, titulo, asunto } = await leer({ ...cinco, salida: "cliente" });
    expect(hojas.length).toBeGreaterThan(1);
    for (const hoja of hojas) {
      expect(hoja).not.toMatch(/retro/i);
      expect(hoja).not.toMatch(/uso interno|documento interno|no entregar/i);
      expect(hoja).not.toContain("BDB");
      expect(hoja).not.toMatch(/Independent|Private Bankers/);
      expect(hoja, hoja).toContain("Comparativa de activos CONFIDENCIAL");
    }
    expect(hojas.join(" ")).not.toContain("0,55 %");
    expect(autor).toBeUndefined();
    expect(titulo).toContain("Comparativa de activos");
    expect(titulo).not.toMatch(/interno|retro/i);
    expect(asunto).toBeUndefined();
  }, 15_000);

  test("con retrocesiones: la columna, y en CADA hoja que no se entrega", async () => {
    const { hojas, autor, asunto } = await leer({ ...cinco, salida: "interno" });
    expect(hojas.length).toBeGreaterThan(1);
    for (const hoja of hojas) {
      expect(hoja).toContain("Comparativa de activos USO INTERNO No entregar al cliente");
      expect(hoja).not.toMatch(/Independent|Private Bankers/);
      expect(hoja).not.toContain("BDB");
    }
    expect(hojas.join(" ")).toContain("Retrocesión");
    expect(hojas.join(" ")).toContain("0,55 %");
    expect(autor).toBeUndefined();
    expect(asunto).toBe("Uso interno del asesor");
  }, 15_000);

  test("en la columna, lo que no aplica y lo que falta no se pintan igual", async () => {
    const { hojas } = await leer({
      ...input,
      correlation: null,
      assets: [
        { ...input.assets[0], name: "Una acción", instrumentType: "STOCK", retro: "no-aplica" },
        { ...input.assets[1], name: "Un fondo sin el dato", retro: undefined }
      ]
    });
    /* Lo que falta ya no dice «N/D»: dice «Falta el dato», como la pantalla (formato común de la plantilla). */
    const riesgo = hojas.join(" ").split("Retrocesión")[1];
    expect(riesgo).toContain("No aplica");
    expect(riesgo).toContain("Falta el dato");
  }, 15_000);

  /* Desde el 14-11-2026, con la convención común de los ficheros (ANA-19, INF-25): el documento, «A frente a B» y el día. Antes,
     «[uso-interno-]comparativa-activos-<nombres>.pdf». El interno lo sigue diciendo junto al documento. */
  test("el nombre del fichero distingue las dos, y el interno lo dice junto al documento", () => {
    const generado = new Date("2026-11-14T12:00:00Z");
    const paraElCliente = nombreDelFicheroDeLaComparativa({ ...input, salida: "cliente", generado });
    const interno = nombreDelFicheroDeLaComparativa({ ...input, salida: "interno", generado });
    expect(paraElCliente).toBe(`Comparativa de activos - ${input.assets[0].name} frente a ${input.assets[1].name} - 2026-11-14.pdf`);
    expect(interno).toBe(`Comparativa de activos (uso interno) - ${input.assets[0].name} frente a ${input.assets[1].name} - 2026-11-14.pdf`);
    expect(paraElCliente).not.toMatch(/interno|retro/);
  });

  test("«Producto», y no «Tipo», para fondo, ETF o acción", async () => {
    const texto = (await leer({ ...input, salida: "cliente" })).hojas.join(" ");
    expect(texto).toMatch(/Activo ISIN Producto Divisa Categoría/);
    expect(texto).not.toMatch(/ISIN Tipo /);
  }, 15_000);

  test("el rótulo de las estrellas: «Estrellas» en el papel de cliente, «Morningstar» en el interno (H3-01)", async () => {
    const cliente = (await leer({ ...input, salida: "cliente" })).hojas.join(" ");
    expect(cliente).toMatch(/10 años Estrellas/);
    expect(cliente).not.toContain("Morningstar");
    const interno = (await leer({ ...input, salida: "interno" })).hojas.join(" ");
    expect(interno).toMatch(/10 años Morningstar/);
  }, 15_000);

  test("el pie llega como se le da, y el documento no escribe otro", async () => {
    const texto = (await leer({ ...input, salida: "cliente" })).hojas.join(" ");
    /* La ventana, en palabras al imprimir (revisión del 14-11-2026): el pie llega «Sharpe 3A…» y sale «Sharpe a 3 años…». */
    expect(texto).toContain("Sharpe a 3 años calculado con €STR como activo sin riesgo.");
    expect(texto).not.toContain("calculada por");
    expect(texto).not.toContain("*");
  }, 15_000);
});

/* Una cifra del proveedor junto a una calculada: lo que la pantalla marca, y lo que dice de cada activo. */
const sinComparar: AssetComparePdfInput = {
  ...input,
  correlation: null,
  noComparable: { columnas: ["annualized_return-1y", "annualized_return-3y", "volatility-3y", "sharpe-3y", "caida-3y"], sinDeclarar: false },
  assets: [
    { ...input.assets[0], calculo: "con datos semanales" },
    { ...input.assets[1], calculo: "con la cifra del proveedor" }
  ]
};

describe.each(["cliente", "interno"] as const)("lo que no se compara, en la salida %s (decisión 42)", (salida) => {
  test("la marca va en la cabecera de cada columna que mezcla, y solo en esas", async () => {
    const texto = (await leer({ ...sinComparar, salida })).hojas.join(" ");
    const rentabilidad = texto.split("Rentabilidad anualizada")[1].split("Riesgo")[0];
    /* El lector de texto separa «1A» en «1 A» (posicionado del glifo). */
    /* Las ventanas en palabras: «1 año», «3 años»… (revisión del 14-11-2026). */
    expect(rentabilidad).toMatch(/1 año \*/);
    expect(rentabilidad).toMatch(/3 años \*/);
    expect(rentabilidad).not.toMatch(/5 años \*/);
    expect(rentabilidad).not.toMatch(/10 años \*/);
    expect(rentabilidad).not.toMatch(/Morningstar \*/);
    /* Las cabeceras con las palabras del sistema (apartado 6): «Volatilidad» y «Caída máxima», no «Vol» ni «Máx. caída». */
    const riesgo = texto.split("Riesgo")[1];
    expect(riesgo).toMatch(/Volatilidad 1 año(?! \*)/);
    expect(riesgo).toMatch(/Volatilidad 3 años \*/);
    expect(riesgo).toMatch(/Sharpe 3 años \*/);
    expect(riesgo).toMatch(/Caída máxima 5 años \*/);
  }, 15_000);

  test("y debajo, el método de cada activo con su nombre y su número, sin afirmar uno para todos", async () => {
    const texto = (await leer({ ...sinComparar, salida })).hojas.join(" ");
    expect(texto.indexOf("* No comparable")).toBeGreaterThan(texto.indexOf("Sharpe a 3 años calculado"));
    expect(texto).toContain("* No comparable entre sí: las columnas marcadas mezclan métodos de cálculo.");
    expect(texto).toContain("1. MFS European Research A1 EUR: con datos semanales.");
    expect(texto).toContain("2. JPM Europe Strategic Value D Acc EUR: con la cifra del proveedor.");
    expect(texto).not.toMatch(/meses cerrados/);
  }, 15_000);

  test("si una cifra no dice de qué sale, no se afirma que sea de otro método", async () => {
    const texto = (await leer({ ...sinComparar, salida, noComparable: { ...sinComparar.noComparable!, sinDeclarar: true } })).hojas.join(" ");
    /* El lector pierde la ligadura «fi» de «afirmar» (`tests/support/pdfText.ts`). */
    expect(texto).toMatch(/\* No comparable entre sí: en las columnas marcadas no se puede a\S*rmar que las cifras salgan del mismo cálculo\./);
    expect(texto).not.toContain("mezclan métodos");
  }, 15_000);

  test("sin nada que marcar, ni marca ni aviso", async () => {
    const texto = (await leer({ ...input, salida })).hojas.join(" ");
    expect(texto).not.toContain("*");
    expect(texto).not.toContain("No comparable");
  }, 15_000);

  test("una acción dice «No aplica» en el Sharpe, aunque la entrada traiga la cifra; un fondo sin él dice «Falta el dato» (decisión 41)", async () => {
    const texto = (await leer({
      ...input,
      salida,
      correlation: null,
      assets: [
        { ...input.assets[0], name: "Una acción", instrumentType: "STOCK", sharpe3y: 0.98, retro: "no-aplica" },
        { ...input.assets[0], name: "Otra acción", instrumentType: " stock ", sharpe3y: undefined, retro: "no-aplica" },
        { ...input.assets[1], name: "Un fondo sin el dato", sharpe3y: undefined, retro: undefined },
        { ...input.assets[1], name: "Un fondo con el dato", sharpe3y: 0.9, retro: undefined }
      ]
    })).hojas.join(" ");
    const riesgo = texto.split("Riesgo")[1];
    expect(riesgo).not.toContain("0,98");
    expect(riesgo).toContain("0,90");
    const fila = (nombre: string) => riesgo.split(nombre)[1].split(/\d\. |Sharpe 3A|Volatilidad/)[0];
    expect(fila("Una acción")).toContain("No aplica");
    expect(fila("Otra acción")).toContain("No aplica");
    expect(fila("Un fondo sin el dato")).toContain("Falta el dato");
    expect(fila("Un fondo sin el dato")).not.toContain("No aplica");
  }, 15_000);

  test("las palabras: «Acción» donde la base dice «accion», y de dónde salen los datos sin nombrar la base", async () => {
    const texto = (await leer({ ...input, salida, assets: [{ ...input.assets[0], instrumentType: "STOCK", category: "accion" }, input.assets[1]] })).hojas.join(" ");
    expect(texto).not.toMatch(/\baccion\b/);
    expect(texto).not.toMatch(/base maestra|plataforma/);
    expect(texto).toContain("Comparativa elaborada con series de precios y cifras del proveedor.");
  }, 15_000);

  test("el pie dice por qué la rentabilidad puede no casar con la evolución en base 100, y solo si la hay", async () => {
    const FRASE = "La rentabilidad puede diferir de la base 100: otro cálculo y otras fechas.";
    expect((await leer({ ...input, salida })).hojas.join(" ")).toContain(FRASE);
    const sinEvolucion = (await leer({ ...input, salida, assets: input.assets.map((asset) => ({ ...asset, base100: undefined })) })).hojas.join(" ");
    expect(sinEvolucion).not.toContain("Evolución comparada");
    expect(sinEvolucion).not.toContain(FRASE);
  }, 15_000);
});

test("la nota legal no se queda sola en una hoja: va con la tabla de correlación", async () => {
  /* Dos activos, aviso y referencia: la correlación y la nota no caben en la primera hoja, y van juntas a la segunda. Desde la
     plantilla el cierre es su frase y el texto legal de la plantilla, sin «Generado por» ni marca. */
  const { hojas } = await leer({
    ...sinComparar,
    correlation: input.correlation,
    salida: "cliente",
    benchmarkNote: "Equilibrado: 50 % renta fija global y 50 % renta variable global, con los pesos fijados el primer día, sin reequilibrar. Activos y referencia en las mismas fechas, hasta el 27 oct 2026."
  });
  expect(hojas).toHaveLength(2);
  expect(hojas[0]).not.toContain("Comparativa elaborada con series");
  expect(hojas[0]).not.toContain("Matriz de correlación");
  expect(hojas[1]).toContain("Matriz de correlación");
  expect(hojas[1]).toContain("Comparativa elaborada con series de precios y cifras del proveedor.");
  expect(hojas[1]).toContain("Documento informativo preparado por su asesor");
}, 15_000);

test("cada línea es una sola cadena: dos tramos seguidos se pisan en el papel, y ni el tipado ni el texto lo ven", () => {
  const fuente = ts.createSourceFile(
    "assetComparePdf.tsx",
    readFileSync("src/reports/assetComparePdf.tsx", "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const textos: string[] = [];
  const conVariosTramos: string[] = [];
  const visitar = (nodo: ts.Node): void => {
    /* Desde la plantilla el texto se escribe con su `Texto`, que sanea; la regla es la misma. */
    if (ts.isJsxElement(nodo) && ["Text", "Texto"].includes(nodo.openingElement.tagName.getText())) {
      const tramos = nodo.children.filter((hijo) => !(ts.isJsxText(hijo) && hijo.containsOnlyTriviaWhiteSpaces));
      textos.push(nodo.getText());
      if (tramos.length > 1) conVariosTramos.push(nodo.getText());
    }
    ts.forEachChild(nodo, visitar);
  };
  visitar(fuente);
  expect(textos.length).toBeGreaterThan(2);
  expect(conVariosTramos).toEqual([]);
});

describe("un fondo que reparte (decisión 8)", () => {
  const entrada: AssetComparePdfInput = {
    ...input,
    salida: "cliente",
    correlation: null,
    assets: [{ ...input.assets[0], base100: 148.9, sinDividendos: true }, input.assets[1]]
  };

  test("rotulado como la pantalla y sin cifra final; el otro sigue con la suya", async () => {
    const texto = (await leer(entrada)).hojas.join(" ");
    const seccion = texto.split("Evolución comparada")[1];
    expect(seccion).toContain("Valor liquidativo, sin dividendos");
    expect(seccion).not.toContain("148,9");
    expect(seccion).toContain("152,8");
  }, 15_000);

  test("con su línea no se mide la correlación: la casilla lo dice, la nota dice por qué, y las demás conservan su cifra (decisión 53)", async () => {
    const hojas = (await leer({
      ...entrada,
      assets: [entrada.assets[0], entrada.assets[1], { ...input.assets[1], name: "Tercero", isin: "LU0000000003" }],
      correlation: {
        labels: ["MFS European Research A1 EUR", "JPM Europe Strategic Value D Acc EUR", "Tercero"],
        matrix: [[1, null, null], [null, 1, 0.75], [null, 0.75, 1]],
        noSeMide: [true, false, false],
        nota: "No se mide la correlación de MFS European Research A1 EUR: su línea es el valor liquidativo, sin dividendos, y cada pago se leería como una caída."
      }
    })).hojas.join(" ");
    const matriz = hojas.split("Matriz de correlación")[1];
    expect(matriz).toContain("No se mide la correlación de MFS European Research A1 EUR: su línea es el valor liquidativo");
    expect(matriz.match(/No se mide(?! la)/g)).toHaveLength(4);
    expect(matriz).toContain("0,75");
    expect(matriz).not.toContain("N/D");
  }, 15_000);

  test("sin marca no hay frase, y un hueco de verdad sigue diciendo que falta el dato", async () => {
    const hojas = (await leer({
      ...entrada,
      correlation: { labels: ["MFS European Research A1 EUR", "JPM Europe Strategic Value D Acc EUR"], matrix: [[1, null], [null, 1]] }
    })).hojas.join(" ");
    const matriz = hojas.split("Matriz de correlación")[1];
    expect(matriz).not.toContain("No se mide");
    expect(matriz).toContain("Falta el dato");
  }, 15_000);

  test("la sección sale aunque ninguno tenga cifra", async () => {
    const texto = (await leer({
      ...entrada,
      benchmarkName: null,
      benchmarkBase100: undefined,
      assets: entrada.assets.map((asset) => ({ ...asset, base100: undefined, sinDividendos: true }))
    })).hojas.join(" ");
    expect(texto).toContain("Evolución comparada");
    expect(texto.match(/Valor liquidativo, sin dividendos/g)).toHaveLength(2);
  }, 15_000);
});

describe("decisiones 80, 83 y 84: lo que queda de la Comparativa de activos", () => {
  const conFondoSinDibujar: AssetComparePdfInput = {
    ...input,
    salida: "cliente",
    assets: [
      { ...input.assets[0], name: "Fidelity", base100: undefined, noSeDibuja: "Fidelity no se dibuja: su serie está en revisión." },
      { ...input.assets[1], name: "iShares" },
      { ...input.assets[1], name: "Robeco", isin: "LU2133220793" }
    ],
    correlation: { labels: ["iShares", "Robeco"], numeros: [2, 3], matrix: [[1, 0.5], [0.5, 1]] }
  };

  test("el que no se dibuja lo dice en su casilla y debajo, y la matriz conserva los números de las tablas", async () => {
    const texto = (await leer(conFondoSinDibujar)).hojas.join(" ").replace(/\s+/g, " ");
    expect(texto).toContain("No se dibuja");
    expect(texto).toContain("Fidelity no se dibuja: su serie está en revisión.");
    expect(texto).toContain("2. iShares");
    expect(texto).toContain("3. Robeco");
    /* En la matriz no hay ningún 1: quien no se dibuja no está. */
    expect(texto).not.toMatch(/1\. iShares/);
  }, 15_000);

  test("sin números, los de siempre", async () => {
    const texto = (await leer({ ...conFondoSinDibujar, correlation: { labels: ["iShares", "Robeco"], matrix: [[1, 0.5], [0.5, 1]] } })).hojas.join(" ").replace(/\s+/g, " ");
    expect(texto).toContain("1. iShares");
  }, 15_000);

  test("una acción: su sector o «No aplica» en la categoría, «No aplica» en Morningstar; un fondo sin el dato dice que falta", async () => {
    const texto = (await leer({
      ...input,
      salida: "cliente",
      correlation: undefined,
      assets: [
        { ...input.assets[0], name: "Con sector", instrumentType: "STOCK", category: undefined, sector: "Utilities", morningstarRating: null, retro: "no-aplica" },
        { ...input.assets[0], name: "Sin sector", instrumentType: "STOCK", category: undefined, morningstarRating: null, retro: "no-aplica" },
        { ...input.assets[1], name: "Un fondo", category: undefined, morningstarRating: null }
      ]
    })).hojas.join(" ").replace(/\s+/g, " ");
    expect(texto).toContain("Categoría o sector");
    expect(texto).toMatch(/Con sector .*Utilities/);
    expect(texto).toMatch(/Sin sector .*No aplica/);
    expect(texto).toMatch(/Un fondo .*Falta el dato/);
  }, 15_000);

  test("la fecha y la divisa de cada activo, y solo si hay algo que decir", async () => {
    const SIN = (await leer({ ...input, salida: "cliente" })).hojas.join(" ");
    expect(SIN).not.toContain("Cada cifra, a su fecha");
    const texto = (await leer({
      ...input,
      salida: "cliente",
      assets: [{ ...input.assets[0], cierre: "2026-10-31" }, { ...input.assets[1], cierre: "2026-09-30", sinConvertir: "USD" }]
    })).hojas.join(" ").replace(/\s+/g, " ");
    expect(texto).toContain("Cada cifra, a su fecha y en su divisa: 1. a 31/10/2026 · 2. a 30/09/2026, con la cifra del proveedor, sin convertir (USD).");
    const soloLaFecha = (await leer({ ...input, salida: "cliente", assets: [{ ...input.assets[0], cierre: "2026-10-31" }, { ...input.assets[1], cierre: "2026-09-30" }] })).hojas.join(" ").replace(/\s+/g, " ");
    expect(soloLaFecha).toContain("Cada cifra, a su fecha: 1. a 31/10/2026 · 2. a 30/09/2026.");
    const soloLaDivisa = (await leer({ ...input, salida: "cliente", assets: [input.assets[0], { ...input.assets[1], sinConvertir: "USD" }] })).hojas.join(" ").replace(/\s+/g, " ");
    expect(soloLaDivisa).toContain("Cada cifra, en su divisa: 2. con la cifra del proveedor, sin convertir (USD).");
  }, 15_000);

  test("las del proveedor de una ficha con cifras nuestras, con sus columnas, su fecha y su divisa (revisión final, V3-5)", async () => {
    /* Allianz AT2: 1 año nuestro a 31 oct y sus 3, 5 y 10 años del proveedor a 30 sept. La pantalla lo dice en cada celda. */
    const at2 = (await leer({
      ...input,
      salida: "cliente",
      assets: [{ ...input.assets[0], cierre: "2026-10-31", delProveedor: [{ columnas: ["3A", "5A", "10A"], fecha: "2026-09-30" }] }, { ...input.assets[1], cierre: "2026-10-31" }]
    })).hojas.join(" ").replace(/\s+/g, " ");
    expect(at2).toContain("Cada cifra, a su fecha: 1. a 31/10/2026; rentabilidad 3 años, 5 años y 10 años del proveedor, a 30/09/2026 · 2. a 31/10/2026.");
    /* Vanguard: su 10 años del proveedor, a su fecha y en dólares, como dice el interno. */
    const vanguard = (await leer({
      ...input,
      salida: "interno",
      assets: [{ ...input.assets[0], cierre: "2026-10-31", delProveedor: [{ columnas: ["10A"], fecha: "2026-09-30", sinConvertir: "USD" }] }, { ...input.assets[1], cierre: "2026-10-31" }]
    })).hojas.join(" ").replace(/\s+/g, " ");
    expect(vanguard).toContain("Cada cifra, a su fecha y en su divisa: 1. a 31/10/2026; rentabilidad 10 años del proveedor, sin convertir (USD), a 30/09/2026 · 2. a 31/10/2026.");
    /* Y de riesgo y rentabilidad juntas, cada una con su rótulo. */
    const mezcla = (await leer({ ...input, salida: "cliente", assets: [{ ...input.assets[0], delProveedor: [{ columnas: ["5A", "Vol 3A", "Sharpe 3A"], sinConvertir: "USD" }] }, input.assets[1]] })).hojas.join(" ").replace(/\s+/g, " ");
    expect(mezcla).toContain("Cada cifra, en su divisa: 1. rentabilidad 5 años, volatilidad 3 años y Sharpe 3 años del proveedor, sin convertir (USD).");
  }, 15_000);

  test("la rentabilidad del proveedor a 1 año, «sin fecha» (decisión 114)", async () => {
    /* Hamco Global Value: nuestro «En el año»; del proveedor, 3 y 5 años a 30 sept, y su 1 año, que no es de esa fecha. */
    const hamco = (await leer({
      ...input,
      salida: "cliente",
      assets: [{ ...input.assets[0], cierre: "2026-10-31", delProveedor: [{ columnas: ["3A", "5A"], fecha: "2026-09-30" }, { columnas: ["1A"], sinFecha: true }] }, { ...input.assets[1], cierre: "2026-10-31" }]
    })).hojas.join(" ").replace(/\s+/g, " ");
    expect(hamco).toContain("Cada cifra, a su fecha: 1. a 31/10/2026; rentabilidad 3 años y 5 años del proveedor, a 30/09/2026; rentabilidad 1 año del proveedor, sin fecha · 2. a 31/10/2026.");
  }, 15_000);

  test("las rentabilidades de un activo con todas sus cifras del proveedor, «sin fecha»; su riesgo, con la de su columna (decisión 119)", async () => {
    /* JPMorgan Taiwan A (dist) con Allianz AT2, en la base nueva: su tarjeta lleva la fecha de su riesgo, 31 oct, y sus rentabilidades son del 30 sept. */
    for (const salida of ["cliente", "interno"] as const) {
      const taiwan = (await leer({
        ...input,
        salida,
        assets: [
          { ...input.assets[0], cierre: "2026-10-31", sinConvertir: "USD", delProveedor: [{ columnas: ["1A", "3A", "5A", "10A"], sinFecha: true }] },
          { ...input.assets[1], cierre: "2026-10-31", delProveedor: [{ columnas: ["3A", "5A", "10A"], fecha: "2026-09-30" }] }
        ]
      })).hojas.join(" ").replace(/\s+/g, " ");
      expect(taiwan).toContain(
        "Cada cifra, a su fecha y en su divisa: 1. a 31/10/2026, con la cifra del proveedor, sin convertir (USD); rentabilidad 1 año, 3 años, 5 años y 10 años del proveedor, sin fecha · 2. a 31/10/2026; rentabilidad 3 años, 5 años y 10 años del proveedor, a 30/09/2026."
      );
    }
  }, 15_000);
});

describe("decisión A-125: el papel dice lo mismo que la pantalla de B-73 y B-74", () => {
  const APARTADA = "JPM Europe Strategic Value D Acc EUR. Falta el dato de la rentabilidad anualizada a 1 año: la cifra calculada se sale del rango que admitimos, y la apartamos.";
  const APARTADA_VOL = "JPM Europe Strategic Value D Acc EUR. Falta el dato de la volatilidad a 1 año: la cifra calculada se sale del rango que admitimos, y la apartamos.";
  /* Allianz AT2 con el mapa de fechas: su 1 año del proveedor a 31 oct y su 3 años a 30 sept, cada uno en su celda, como en pantalla. El JPM, con
     su 1 año y su volatilidad a 1 año apartados. */
  const conNotas: AssetComparePdfInput = {
    ...input,
    salida: "cliente",
    assets: [
      {
        ...input.assets[0],
        cierre: "2026-10-31",
        delProveedor: [{ columnas: ["1A"], fecha: "2026-10-31" }, { columnas: ["3A"], fecha: "2026-09-30" }],
        apuntes: { "annualized_return-1y": "Del proveedor · a 31/10/2026", "annualized_return-3y": "Del proveedor · a 30/09/2026" }
      },
      { ...input.assets[1], return1y: undefined, volatility1y: undefined, cierre: "2026-09-30" }
    ],
    cifrasApartadas: [
      { fila: "annualized_return-1y", nota: APARTADA },
      { fila: "volatility-1y", nota: APARTADA_VOL }
    ]
  };

  test("la fecha de cada ventana del proveedor va en su celda, y la nota de fechas no la repite", async () => {
    const texto = (await leer(conNotas)).hojas.join(" ").replace(/\s+/g, " ");
    expect(texto).toContain("Del proveedor · a 31/10/2026");
    expect(texto).toContain("Del proveedor · a 30/09/2026");
    expect(texto).toContain("Cada cifra, a su fecha: 1. a 31/10/2026 · 2. a 30/09/2026.");
    expect(texto).not.toContain("rentabilidad 1 año del proveedor");
    expect(texto).not.toContain("rentabilidad 3 años del proveedor");
  }, 15_000);

  test("lo que la celda no dice se sigue diciendo en la nota: la divisa, sin repetir la fecha", async () => {
    const texto = (await leer({
      ...conNotas,
      assets: [{ ...conNotas.assets[0], delProveedor: [{ columnas: ["3A"], fecha: "2026-09-30", sinConvertir: "USD" }] }, conNotas.assets[1]]
    })).hojas.join(" ").replace(/\s+/g, " ");
    expect(texto).toContain("1. a 31/10/2026; rentabilidad 3 años del proveedor, sin convertir (USD) · 2. a 30/09/2026.");
  }, 15_000);

  test("la nota de la cifra apartada, sin la cifra, bajo la tabla de su fila", async () => {
    const texto = (await leer(conNotas)).hojas.join(" ").replace(/\s+/g, " ");
    const enRentabilidad = texto.indexOf(APARTADA);
    const enRiesgo = texto.indexOf(APARTADA_VOL);
    const riesgo = texto.indexOf("Riesgo Activo");
    expect(enRentabilidad).toBeGreaterThan(texto.indexOf("Rentabilidad anualizada"));
    expect(enRentabilidad).toBeLessThan(riesgo);
    expect(enRiesgo).toBeGreaterThan(riesgo);
    /* Ni la cifra calculada ni el límite: es papel que puede ir a un cliente. */
    expect(texto).not.toMatch(/calculamos|máximo que admitimos/);
  }, 15_000);

  test("sin notas ni apuntes, el papel queda como estaba", async () => {
    const antes = (await leer({ ...input, salida: "cliente" })).hojas.join(" ");
    const conVacios = (await leer({ ...input, salida: "cliente", cifrasApartadas: [], assets: input.assets.map((asset) => ({ ...asset, apuntes: {} })) })).hojas.join(" ");
    expect(conVacios.replace(/Generado.*$/m, "")).toBe(antes.replace(/Generado.*$/m, ""));
  }, 15_000);
});

/*
 * FMT-01 (auditoría de frontend, 13-11-2026): la pantalla del Comparador escribía «+7,46 %» y su PDF «7,5 %», sin signo, para la misma
 * rentabilidad; la volatilidad y la caída, con dos decimales frente a uno. El PDF escribe esas cifras igual que la tabla de la que sale.
 * Cuentas a mano: 0,0746 × 100 = 7,46; −0,0312 × 100 = −3,12; 0,1234 × 100 = 12,34; −0,2431 × 100 = −24,31.
 */
describe("la comparativa de activos escribe en el PDF las cifras igual que en la pantalla (FMT-01)", () => {
  const activo = {
    asset_id: "LU0000000001",
    display_name: "Fondo de prueba de renta variable europea",
    isin: "LU0000000001",
    instrument_type: "FUND",
    metrics: {}
  } as unknown as FuenteDeColumna["activo"];
  const tarjeta = {
    instrument_type: "FUND",
    metrics: {
      method: "EXTRACTOR_MONTHLY_V1",
      frequency: "MONTHLY",
      annualized_return: { "1y": -0.0312, "3y": 0.0746 },
      volatility: { "3y": 0.1234 },
      max_drawdown: { "3y": -0.2431 }
    }
  } as unknown as FuenteDeColumna["tarjeta"];

  test("rentabilidad con su signo y dos decimales, volatilidad y caída con dos: el texto de cada fila coincide", async () => {
    const fuentes: FuenteDeColumna[] = [{ activo, tarjeta }];
    const [columna] = columnasDeActivos(fuentes);
    const filas = filasDeActivos(fuentes, { modoCliente: true });
    const enPantalla = (id: string) => filas.find((fila) => fila.id === id)!.celda(columna!).texto;
    const esperadas = {
      "annualized_return-1y": "−3,12 %",
      "annualized_return-3y": "+7,46 %",
      "volatility-3y": "12,34 %",
      "caida-3y": "−24,31 %"
    };
    for (const [id, texto] of Object.entries(esperadas)) expect(enPantalla(id).replace(/\s/g, " "), id).toBe(texto);

    const papel = extractPdfPageTexts(Buffer.from(await (await createAssetComparisonPdfBlob({
      ...input,
      salida: "cliente",
      correlation: null,
      assets: [{
        name: activo.display_name,
        color: "#143D66",
        isin: activo.isin,
        instrumentType: "FUND",
        currency: "EUR",
        return1y: -0.0312,
        return3y: 0.0746,
        volatility3y: 0.1234,
        maxDrawdown: -0.2431,
        base100: 120
      }]
    })).arrayBuffer())).join(" ").replace(/\s/g, " ");
    for (const id of Object.keys(esperadas)) expect(papel, id).toContain(enPantalla(id).replace(/\s/g, " "));
    expect(papel).not.toMatch(/\b7,5 %|12,3 %|24,3 %/);
  }, 15_000);
});
