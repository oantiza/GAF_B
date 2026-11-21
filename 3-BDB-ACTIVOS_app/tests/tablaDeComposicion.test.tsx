import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { columnasDeComposicion, filasDeComposicion, limiteDe, textoDeCalidad } from "../src/adapters/tablaDeComposicion";
import { ClientModeProvider } from "../src/app/ClientModeContext";
import { ComposicionDeLaCartera } from "../src/components/ComposicionDeLaCartera";
import { calculatePortfolioCosts } from "../src/core/portfolioCosts";
import type { BdbAssetDetail, BdbManualPortfolioPosition, BdbPortfolioReport } from "../src/types/bdbAssets";

const activo = (id: string, categoria: string, volatilidad?: number): BdbAssetDetail =>
  ({ asset_id: id, display_name: `Fondo ${id}`, category: categoria, instrument_type: "FUND", economic_asset_class: "EQUITY", currency: "EUR", metrics: { volatility_3y: volatilidad } }) as unknown as BdbAssetDetail;

const assets = [activo("A", "RV Global", 0.1185), activo("B", "RV Global", 0.0419), activo("C", "RF Euro"), activo("D", "Mixtos", 0.066)];
const positions: BdbManualPortfolioPosition[] = [
  { asset_id: "A", weight_percent: 10 },
  { asset_id: "B", weight_percent: 30 },
  { asset_id: "C", weight_percent: 20 },
  { asset_id: "D", weight_percent: 40 }
];

const columnas = (opciones: Partial<Parameters<typeof columnasDeComposicion>[0]> = {}) =>
  columnasDeComposicion({ clientMode: false, conImporte: false, conLimites: false, midiendo: false, ...opciones });

describe("las filas de la composición", () => {
  const filas = filasDeComposicion({ positions, assets });

  test("un grupo de un solo fondo es una fila, y el orden es por peso, no alfabético", () => {
    expect(filas.map((fila) => fila.id)).toEqual(["grupo-RV Global", "B", "A", "D", "C"]);
    const grupo = filas[0];
    expect(grupo).toMatchObject({ cabeceraDeGrupo: true, nombre: "RV Global", pesoPct: 40 });
    expect(filas.filter((fila) => fila.cabeceraDeGrupo)).toHaveLength(1);
  });

  test("la estrategia de un fondo solo va con su código; la de un grupo, en su cabecera", () => {
    expect(filas.find((fila) => fila.id === "D")?.apunte).toBe("D · Mixtos");
    expect(filas.find((fila) => fila.id === "B")?.apunte).toBe("B");
    expect(filas.find((fila) => fila.id === "B")?.grupoDeFilas).toBe("RV Global");
    expect(filas.find((fila) => fila.id === "D")?.grupoDeFilas).toBeUndefined();
  });

  test("cada peso sale una vez y la suma de las posiciones es la de la cartera", () => {
    const deFondos = filas.filter((fila) => !fila.cabeceraDeGrupo);
    expect(deFondos.reduce((suma, fila) => suma + fila.pesoPct, 0)).toBe(100);
    expect(new Set(deFondos.map((fila) => fila.id)).size).toBe(4);
  });

  test("el importe solo existe con capital fijado", () => {
    expect(filas.every((fila) => fila.importe === null)).toBe(true);
    const conCapital = filasDeComposicion({ positions, assets, capital: 200_000 });
    expect(conCapital.find((fila) => fila.id === "D")?.importe).toBe(80_000);
    expect(conCapital[0].importe).toBe(80_000);
  });
});

describe("el importe de Análisis y el capital de Costes salen de la misma cuenta (ANA-13)", () => {
  /* Cuatro posiciones al 24,5 % suman 98 %. Costes reparte el capital entero en proporción a los pesos:
     24,5 / 98 × 100.000 € = 25.000 € cada una, y el total es el capital, 100.000 €. Antes Análisis daba 24,5 % × 100.000 = 24.500 €. */
  const alCuarto: BdbManualPortfolioPosition[] = ["A", "B", "C", "D"].map((asset_id) => ({ asset_id, weight_percent: 24.5 }));

  test("cada posición vale lo mismo que en el cuadro de costes", () => {
    const filas = filasDeComposicion({ positions: alCuarto, assets, capital: 100_000 }).filter((fila) => !fila.cabeceraDeGrupo);
    expect(filas.map((fila) => fila.importe)).toEqual([25_000, 25_000, 25_000, 25_000]);
    const costes = calculatePortfolioCosts(alCuarto, assets, 100_000);
    for (const fila of filas) expect(fila.importe).toBeCloseTo(costes.rows.find((row) => row.assetId === fila.id)!.capital!, 6);
  });

  test("el pie suma el capital entero, y la tabla dice que reparte como el cuadro de costes", () => {
    const html = renderToStaticMarkup(createElement(ClientModeProvider, {
      initialValue: false,
      children: createElement(ComposicionDeLaCartera, { positions: alCuarto, assets, horizonte: null, fuera: [], midiendo: false, capital: 100_000 })
    }));
    expect(html).toMatch(/98,0\s%/);
    /* Importes de tabla con dos decimales (apartado 6): «100.000,00 €», antes «100.000 €». */
    expect(html).toMatch(/100\.000,00\s€/);
    expect(html).not.toMatch(/98\.000/);
    expect(html.replace(/\u00a0/g, " ")).toContain("Los pesos suman 98,0 %: el importe reparte el capital entero en proporción a ellos, como el cuadro de costes.");
  });

  test("si suman 100, ni cambia nada ni se avisa", () => {
    const html = renderToStaticMarkup(createElement(ClientModeProvider, {
      initialValue: false,
      children: createElement(ComposicionDeLaCartera, { positions, assets, horizonte: null, fuera: [], midiendo: false, capital: 100_000 })
    }));
    expect(html).not.toContain("Los pesos suman");
  });
});

describe("las columnas", () => {
  const ids = (lista: ReturnType<typeof columnas>) => lista.map((columna) => columna.id);

  test("activo y peso primero, cifras marcadas para ir a la derecha", () => {
    const lista = columnas();
    expect(ids(lista).slice(0, 2)).toEqual(["activo", "peso"]);
    expect(lista.find((c) => c.id === "peso")?.cifra).toBe(true);
    expect(lista.find((c) => c.id === "aporta")?.cifra).toBe(true);
    /* ANA-14: el rótulo dice la ventana con palabras, la del periodo elegido. */
    expect(lista.find((c) => c.id === "volatilidad")?.titulo).toBe("Vol. 3A");
    expect(lista.find((c) => c.id === "volatilidad")?.tituloCompleto).toBe("Volatilidad 3 años");
    expect(lista.find((c) => c.id === "activo")?.encabezaFila).toBe(true);
  });

  test("sin capital no hay columna de importe; sin límite propio, tampoco de límites", () => {
    expect(ids(columnas())).not.toContain("importe");
    expect(ids(columnas())).not.toContain("limites");
    expect(ids(columnas({ conImporte: true }))).toContain("importe");
    expect(ids(columnas({ conLimites: true }))).toContain("limites");
  });

  test("con Modo cliente, sin límites ni calidad del dato", () => {
    const lista = ids(columnas({ clientMode: true, conLimites: true }));
    expect(lista).not.toContain("limites");
    expect(lista).not.toContain("calidad");
    expect(ids(columnas())).toContain("calidad");
  });
});

describe("lo que aporta al riesgo", () => {
  const celda = (aporta: number | undefined, resto: Record<string, unknown> = {}, midiendo = false) =>
    columnas({ midiendo }).find((c) => c.id === "aporta")!.celda({ id: "x", nombre: "x", pesoPct: 10, importe: null, fueraDeLaSerie: false, noInvertible: false, aportaPct: aporta, ...resto });

  test("el ocre de la atención, solo por encima del umbral y con su palabra; la cifra, en tinta", () => {
    expect(celda(40).nodo).toBeUndefined();
    /* El módulo de formato separa la cifra del «%» con un espacio duro. */
    expect(celda(40).texto).toBe("40,0\u00a0%");
    const html = renderToStaticMarkup(createElement("div", null, celda(44.48).nodo));
    expect(html).toMatch(/44,5\s%/);
    /* Rediseño: la palabra va en la pieza `Distintivo` de aviso; antes, la cifra entera en terracota. */
    expect(html).toContain('<span class="distintivo distintivo--aviso">Revisar</span>');
  });

  test("fuera de la serie, midiendo y falta son tres cosas distintas", () => {
    expect(celda(undefined, { fueraDeLaSerie: true })).toMatchObject({ texto: "Fuera de la simulación", ausencia: "falta" });
    expect(celda(undefined, {}, true)).toMatchObject({ texto: "Midiendo…", ausencia: "no-aplica" });
    expect(celda(undefined)).toMatchObject({ texto: "Falta el dato", ausencia: "falta" });
  });
});

describe("textos que estaban mal", () => {
  type Resumen = BdbPortfolioReport["positions"][number]["data_quality_summary"];

  test("«Cobertura Cobertura completa · 1 avisos» es «Completa · 1 aviso»", () => {
    expect(textoDeCalidad({ coverage_status: "COMPLETE", warnings_count: 1 } as unknown as Resumen)).toBe("Completa · 1 aviso");
    expect(textoDeCalidad({ coverage_status: "PARTIAL", warnings_count: 0 } as unknown as Resumen)).toBe("Parcial · 0 avisos");
    expect(textoDeCalidad({ coverage_status: "COMPLETE", warnings_count: 2 } as unknown as Resumen)).toBe("Completa · 2 avisos");
    expect(textoDeCalidad(undefined)).toBeUndefined();
  });

  test("0–100 % no es un límite: es la ausencia de uno", () => {
    expect(limiteDe({ asset_id: "A", min_weight: 0, max_weight: 1 })).toBeUndefined();
    expect(limiteDe({ asset_id: "A", min_weight: 0.05, max_weight: 0.35 })).toBe("5,0–35,0\u00a0%");
    expect(limiteDe({ asset_id: "A", min_weight: 0.2, max_weight: 0.2 })).toBe("20,0\u00a0% fijo");
    expect(limiteDe({ asset_id: "A", min_weight: 0.24, max_weight: 0.24, locked_weight: 0.24 })).toBe("Fijado · 24,0\u00a0%");
    expect(limiteDe(undefined)).toBeUndefined();
  });
});

describe("la tabla en pantalla", () => {
  const pinta = (props: Partial<Parameters<typeof ComposicionDeLaCartera>[0]> = {}, clientMode = false) =>
    renderToStaticMarkup(createElement(ClientModeProvider, {
      initialValue: clientMode,
      children: createElement(ComposicionDeLaCartera, { positions, assets, horizonte: null, fuera: [], midiendo: false, ...props })
    }));

  test("es la tabla del sistema, con el fondo como encabezado de su fila y la estrategia de su grupo", () => {
    const html = pinta();
    expect(html).toContain('class="tabla tabla--activos"');
    /* La columna es además la del nombre de un activo (`nombre`): no baja de su ancho mínimo. */
    expect(html).toMatch(/<th class="tabla__celda--nombre tabla__celda--fila" scope="rowgroup">/);
    expect(html).toMatch(/<th class="tabla__celda--nombre tabla__celda--fila" scope="row">/);
    /* Dos grupos de filas: el de la estrategia y las sueltas, cada uno en su cuerpo. */
    expect((html.match(/<tbody>/g) ?? []).length).toBe(2);
    /* El pie dice de qué es el total y cuántas posiciones tiene (maqueta); antes «Total cartera». */
    expect(html).toContain("Toda la cartera · 4 posiciones");
    expect(html).toMatch(/100,0\s%/);
  });

  test("sin capital, una nota en vez de una columna de rayas", () => {
    const html = pinta();
    expect(html).toContain("Capital sin fijar");
    expect(html).not.toContain("Importe");
    expect(html).not.toContain("—");
    const conCapital = pinta({ capital: 100_000 });
    expect(conCapital).not.toContain("Capital sin fijar");
    expect(conCapital).toContain("Importe");
    expect(conCapital).toMatch(/100\.000,00\s€/);
  });
});

describe("lo que la revisión del 05-11-2026 encontró en esta tabla", () => {
  const accion = { asset_id: "IB", display_name: "Iberdrola", instrument_type: "STOCK", economic_asset_class: "EQUITY", category: "accion", currency: "EUR", metrics: { volatility_3y: 0.2 } } as never;
  const accion2 = { asset_id: "AN", display_name: "Acciona", instrument_type: "STOCK", economic_asset_class: "EQUITY", category: "accion", currency: "EUR", metrics: { volatility_3y: 0.3 } } as never;
  const delProveedor = (currency: string) =>
    ({ asset_id: "ETF", display_name: "iShares", instrument_type: "ETF", economic_asset_class: "EQUITY", category: "RV Global", currency, metrics: { volatility_3y: 0.119, metrics_method: "TRAILING_PROVIDER" } }) as never;
  const opciones = { clientMode: false, conImporte: false, conLimites: false, midiendo: false };
  const celda = (id: string, fila: unknown, extra: Record<string, unknown> = {}) =>
    columnasDeComposicion({ ...opciones, ...extra }).find((columna) => columna.id === id)!.celda(fila as never);

  test("con un solo activo medido, «Aporta al riesgo» no aplica: no es que falte", () => {
    const [fila] = filasDeComposicion({ positions: [{ asset_id: "IB", weight_percent: 100 }], assets: [accion] });
    expect(celda("aporta", fila, { unSoloMedido: true })).toEqual({ texto: "No aplica", ausencia: "no-aplica" });
    expect(celda("aporta", fila)).toEqual({ texto: "Falta el dato", ausencia: "falta" });
  });

  test("la categoría «accion» se escribe bien también en la cabecera de grupo", () => {
    const filas = filasDeComposicion({ positions: [{ asset_id: "IB", weight_percent: 50 }, { asset_id: "AN", weight_percent: 50 }], assets: [accion, accion2] });
    expect(filas[0]).toMatchObject({ cabeceraDeGrupo: true, nombre: "Acciones" });
    const [una] = filasDeComposicion({ positions: [{ asset_id: "IB", weight_percent: 100 }], assets: [accion] });
    expect(una.apunte).toBe("IB · Acciones");
  });

  test("una acción sin categoría, como las trae la base nueva, es «Acciones» y no «Renta variable» (revisión final, V6-3)", () => {
    const sinCategoria = (id: string) => ({ ...(accion as object), asset_id: id, category: undefined }) as never;
    const fondoSinCategoria = { asset_id: "FX", display_name: "Fondo sin categoría", instrument_type: "FUND", economic_asset_class: "EQUITY", currency: "EUR", metrics: {} } as never;
    const filas = filasDeComposicion({
      positions: [{ asset_id: "IBE", weight_percent: 50 }, { asset_id: "APL", weight_percent: 30 }, { asset_id: "FX", weight_percent: 20 }],
      assets: [sinCategoria("IBE"), sinCategoria("APL"), fondoSinCategoria]
    });
    expect(filas[0]).toMatchObject({ cabeceraDeGrupo: true, nombre: "Acciones", pesoPct: 80 });
    /* Un fondo sin categoría sigue yendo por su clase: no se mezcla con las acciones. */
    expect(filas.find((fila) => fila.id === "FX")?.apunte).toBe("FX · Renta variable");
  });

  test("la volatilidad del proveedor no se lee como una de las nuestras", () => {
    const [enDolares] = filasDeComposicion({ positions: [{ asset_id: "ETF", weight_percent: 100 }], assets: [delProveedor("USD")] });
    /* Dos decimales, como toda volatilidad (apartado 6); antes «11,9 %». */
    expect(celda("volatilidad", enDolares)).toMatchObject({ texto: "11,90\u00a0%", apunte: "Del proveedor, en USD" });
    /* Con Modo cliente, quién la da es cocina; la divisa no. */
    expect(celda("volatilidad", enDolares, { clientMode: true })).toMatchObject({ apunte: "En USD, sin convertir" });
    const [enEuros] = filasDeComposicion({ positions: [{ asset_id: "ETF", weight_percent: 100 }], assets: [delProveedor("EUR")] });
    expect(celda("volatilidad", enEuros)).toMatchObject({ apunte: "Del proveedor" });
    expect(celda("volatilidad", enEuros, { clientMode: true }).apunte).toBeUndefined();
    const [propia] = filasDeComposicion({ positions: [{ asset_id: "IB", weight_percent: 100 }], assets: [accion] });
    expect(celda("volatilidad", propia).apunte).toBeUndefined();
  });
});

/**
 * ANA-14 (rediseño, 14-11-2026): dos cifras solo se leen juntas si son de la misma ventana. «Aporta al riesgo» sale de la
 * simulación del periodo elegido, así que la volatilidad de cada activo, en la columna de al lado, también: la de 3 años con
 * «3 años» y la de 5 con «5 años» (`volatility_5y`). Si el activo no la tiene para ese periodo, falta; nunca la de otra ventana.
 */
describe("ANA-14: la volatilidad de cada activo es la del periodo elegido", () => {
  const fondo = (asset_id: string, metrics: Record<string, unknown>) =>
    ({ asset_id, display_name: `Fondo ${asset_id}`, instrument_type: "FUND", economic_asset_class: "EQUITY", category: "RV Global", currency: "EUR", metrics }) as never;
  const conLasDos = fondo("V", { volatility_3y: 0.1, volatility_5y: 0.14 });
  const soloTres = fondo("T", { volatility_3y: 0.12 });
  const celda = (fila: unknown, anos: 3 | 5) =>
    columnasDeComposicion({ clientMode: false, conImporte: false, conLimites: false, midiendo: false, anos }).find((columna) => columna.id === "volatilidad")!.celda(fila as never);
  const fila = (activo: never, anos?: 3 | 5) => filasDeComposicion({ positions: [{ asset_id: (activo as { asset_id: string }).asset_id, weight_percent: 100 }], assets: [activo], anos })[0];

  test("con «3 años», la de 3 años; con «5 años», la de 5", () => {
    expect(fila(conLasDos).volatilidad).toBe(0.1);
    expect(fila(conLasDos, 3).volatilidad).toBe(0.1);
    expect(fila(conLasDos, 5).volatilidad).toBe(0.14);
    expect(celda(fila(conLasDos, 5), 5)).toMatchObject({ texto: "14,00\u00a0%", valor: 0.14 });
  });

  test("sin la de 5 años, «Falta el dato»: no se pone la de 3 en su lugar", () => {
    expect(fila(soloTres, 5).volatilidad).toBeUndefined();
    expect(celda(fila(soloTres, 5), 5)).toEqual({ texto: "Falta el dato", ausencia: "falta" });
    expect(celda(fila(soloTres, 3), 3)).toMatchObject({ texto: "12,00\u00a0%" });
  });

  test("el rótulo dice el periodo con palabras", () => {
    const titulo = (anos: 3 | 5) => columnasDeComposicion({ clientMode: false, conImporte: false, conLimites: false, midiendo: false, anos }).find((columna) => columna.id === "volatilidad")!.titulo;
    expect(titulo(3)).toBe("Vol. 3A");
    expect(titulo(5)).toBe("Vol. 5A");
    const completo = (anos: 3 | 5) => columnasDeComposicion({ clientMode: false, conImporte: false, conLimites: false, midiendo: false, anos }).find((columna) => columna.id === "volatilidad")!.tituloCompleto;
    expect(completo(3)).toBe("Volatilidad 3 años");
    expect(completo(5)).toBe("Volatilidad 5 años");
  });

  test("quién da la cifra se mira en la misma ventana: del proveedor a 5 años no lo es a 3", () => {
    const mixto = fondo("M", { volatility_3y: 0.1, volatility_5y: 0.13, metrics_by_window: { "3y": { method: "WEEKLY_LOG" }, "5y": { method: "TRAILING_PROVIDER" } } });
    expect(celda(fila(mixto, 5), 5).apunte).toBe("Del proveedor");
    expect(celda(fila(mixto, 3), 3).apunte).toBeUndefined();
  });

  test("la tabla en pantalla con «5 años» lleva su rótulo y su cifra", () => {
    const html = renderToStaticMarkup(createElement(ClientModeProvider, {
      initialValue: false,
      children: createElement(ComposicionDeLaCartera, { positions: [{ asset_id: "V", weight_percent: 100 }], assets: [conLasDos], horizonte: null, fuera: [], midiendo: false, anos: 5 })
    }));
    expect(html).toContain("Volatilidad 5 años");
    expect(html).toMatch(/14,00\s%/);
    expect(html).not.toMatch(/10,00\s%/);
  });
});
