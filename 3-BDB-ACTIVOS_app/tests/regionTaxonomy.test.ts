import { describe, expect, test } from "vitest";
import { componerFila } from "../src/adapters/componerLista";
import { seccionDeRegiones } from "../src/adapters/componerFicha";
import type { Documento } from "../src/adapters/baseNuevaLectura";
import { computeEquityRegionAllocation } from "../src/core/equityRegions";
import { buildRegionTable, zonasDeUnReparto } from "../src/core/regionTaxonomy";
import type { BdbAssetDetail } from "../src/types/bdbAssets";

const fila = (tabla: ReturnType<typeof buildRegionTable>["table"], rotulo: string) => tabla.find((r) => r.label === rotulo)?.value;

/**
 * La cartera de muestra, con sus datos reales: los pesos y la renta variable de la base vieja y las regiones tal
 * como las guarda (forma antigua) o como las trae el extractor con sus trece zonas (forma nueva). Los resultados
 * esperados se calcularon aparte, en Python, sobre esos mismos números; no se han copiado de lo que da este código.
 */
const fondo = (asset_id: string, equity: number, equity_regions: Record<string, number> | undefined) =>
  ({
    asset_id,
    display_name: asset_id,
    instrument_type: "FUND",
    economic_asset_class: "EQUITY",
    pms_exposure: { equity, fixed_income: 1 - equity, cash: 0, alternative: 0, real_asset: 0, other: 0 },
    exposure_detail: equity_regions ? { equity_regions } : undefined
  }) as unknown as BdbAssetDetail;

const POSICIONES = [
  { asset_id: "ISHARES", weight_percent: 24 },
  { asset_id: "VANGUARD", weight_percent: 12 },
  { asset_id: "AMUNDI", weight_percent: 10 },
  { asset_id: "ROBECO", weight_percent: 8 },
  { asset_id: "PIMCO", weight_percent: 20 },
  { asset_id: "JPM", weight_percent: 10 },
  { asset_id: "RCO", weight_percent: 9 },
  { asset_id: "GS", weight_percent: 7 }
];

/* El peso en renta variable, como lo lee `assetPmsShares`: tal cual si es un reparto neto, sobre su suma con signo (decisión 63). El de PIMCO, con bonos al 165,5 % y liquidez al −65,5 %, también lo es desde la C-29 (21-11-2026), y su bolsa es −0,03 %: no tiene renta variable que repartir. */
const PESO_EN_RV = { ISHARES: 0.996335, VANGUARD: 1, AMUNDI: 0.991679 / 0.999999, ROBECO: 1.000547, PIMCO: 0, JPM: 0, RCO: 0.408636 / 1.000001, GS: 0.003187 / 0.999983 };

const FORMA_ANTIGUA: Record<string, Record<string, number> | undefined> = {
  ISHARES: { united_states: 0.729231, other: 0.036061, latin_america: 0.001492, united_kingdom: 0.033126, eurozone: 0.07906, europe_ex_euro: 0.037935, middle_east: 0.002597, asia: 0.083188, asia_emerging: 0.001199 },
  VANGUARD: { united_states: 0.995235, latin_america: 0.000608, united_kingdom: 0.000322, eurozone: 0.000372, europe_ex_euro: 0.002555, asia_emerging: 0.000908, other: 0.001516, asia: 0.000908 },
  AMUNDI: { united_states: 0.499268, other: 0.029689, united_kingdom: 0.061751, eurozone: 0.261475, europe_ex_euro: 0.083904, asia: 0.07834, asia_emerging: 0.014426 },
  ROBECO: { united_states: 0.003118, latin_america: 0.078085, eurozone: 0.000759, europe_emerging: 0.016303, other: 0.525098, middle_east: 0.052606, asia: 0.836991, asia_emerging: 0.372851 },
  PIMCO: { united_states: 1 },
  JPM: undefined,
  RCO: { united_states: 0.404215, other: 0.412353, latin_america: 0.058847, united_kingdom: 0.02434, eurozone: 0.116745, europe_ex_euro: 0.042347, asia_emerging: 0.242149, asia: 0.242149 },
  GS: { united_states: 0.994974, latin_america: 0.000937, united_kingdom: 0.000312, eurozone: 0.000375, europe_ex_euro: 0.002497, asia_emerging: 0.000905, other: 0.001842, asia: 0.000905 }
};

const FORMA_NUEVA: Record<string, Record<string, number> | undefined> = {
  ISHARES: { united_states: 0.72882853, canada: 0.03454937, latin_america: 0.0013426, united_kingdom: 0.03359596, eurozone: 0.07714049, europe_ex_euro: 0.03961401, middle_east: 0.00251845, japan: 0.05693378, australasia: 0.01605747, asia_developed: 0.00821776, asia_emerging: 0.00120158 },
  VANGUARD: { united_states: 0.99535591, latin_america: 0.0006177, united_kingdom: 0.0002928, eurozone: 0.0003515, europe_ex_euro: 0.00245479, asia_emerging: 0.0009273 },
  AMUNDI: { united_states: 0.5045573, canada: 0.01469753, united_kingdom: 0.06046672, eurozone: 0.25528924, europe_ex_euro: 0.08319134, japan: 0.06627587, asia_emerging: 0.015522 },
  ROBECO: { united_states: 0.00280956, latin_america: 0.07396296, eurozone: 0.00083707, europe_emerging: 0.01431914, africa: 0.01354098, middle_east: 0.05001828, asia_developed: 0.49079395, asia_emerging: 0.35371807 },
  PIMCO: { united_states: 1 },
  JPM: undefined,
  RCO: { united_states: 0.39424134, canada: 0.10712789, latin_america: 0.06516548, united_kingdom: 0.02738894, eurozone: 0.11642548, europe_ex_euro: 0.04526499, asia_emerging: 0.24438588 },
  GS: { united_states: 0.99497393, latin_america: 0.00093653, united_kingdom: 0.00031218, eurozone: 0.00037461, europe_ex_euro: 0.00249742, asia_emerging: 0.00090532 }
};

const activos = (regiones: Record<string, Record<string, number> | undefined>) =>
  Object.entries(regiones).map(([id, reparto]) => fondo(id, PESO_EN_RV[id as keyof typeof PESO_EN_RV], reparto));

const unDecimal = (n: number) => Math.round(n * 10) / 10;

describe("cada zona, una sola vez (decisión 7)", () => {
  test("forma antigua: la cartera de muestra da América 65,4, Europa / O. Medio / África 16,1 y Asia 18,5, que suman 100", () => {
    /* Era 65,5 (65,4505) hasta que Robeco cuenta su bolsa neta, 100,05 % y no 99,96 % (decisión 63): 65,442, calculado aparte. */
    const salida = computeEquityRegionAllocation(POSICIONES, activos(FORMA_ANTIGUA));
    const { macroTotals, other } = buildRegionTable(salida.rows);
    expect(unDecimal(macroTotals.america)).toBe(65.4);
    expect(unDecimal(macroTotals.emea)).toBe(16.1);
    expect(unDecimal(macroTotals.asia)).toBe(18.5);
    expect(macroTotals.america + macroTotals.emea + macroTotals.asia).toBeCloseTo(100, 1);
    /* Ni «Sin asignar» ni «Sin situar»: no queda nada sin zona. */
    expect(other).toBe(0);
    expect(salida.unclassified_weight_percent).toBe(0);
    expect(salida.canadaYAfricaSinSeparar).toBe(true);
  });

  test("forma nueva: la misma cartera da América 66,2, Europa / O. Medio / África 15,6 y Asia 18,2, y la nota desaparece sola", () => {
    const salida = computeEquityRegionAllocation(POSICIONES, activos(FORMA_NUEVA));
    const { macroTotals, other, table } = buildRegionTable(salida.rows);
    expect(unDecimal(macroTotals.america)).toBe(66.2);
    expect(unDecimal(macroTotals.emea)).toBe(15.6);
    expect(unDecimal(macroTotals.asia)).toBe(18.2);
    expect(macroTotals.america + macroTotals.emea + macroTotals.asia).toBeCloseTo(100, 6);
    expect(other).toBe(0);
    expect(salida.canadaYAfricaSinSeparar).toBeUndefined();
    /* Las zonas que antes no se veían, cada una en su fila. */
    expect(fila(table, "Canadá")).toBeGreaterThan(0);
    expect(fila(table, "Japón")).toBeGreaterThan(0);
    expect(fila(table, "Australasia")).toBeGreaterThan(0);
    expect(fila(table, "Asia - Desarrollada")).toBeGreaterThan(0);
    expect(fila(table, "Asia - Emergente")).toBeGreaterThan(0);
    expect(fila(table, "Asia, sin desglose")).toBe(0);
  });

  test("un fondo de la India no está tres veces en Asia", () => {
    /* Robeco Indian Equities: suma 300 % en la base nueva. */
    const { zonas, canadaYAfricaSinSeparar, asiaEmergenteDentroDeAsia } = zonasDeUnReparto({ asia: 1, asia_emerging: 1, other: 1 });
    expect(zonas).toEqual({ asia: 1 });
    expect(asiaEmergenteDentroDeAsia).toBe(1);
    expect(canadaYAfricaSinSeparar).toBe(true);
  });

  test("un fondo emergente deja de perder Asia al dividir por lo que no suma", () => {
    /* Robeco QI: 84,45 % en Asia en la base nueva, y salía un 65 % en el mapa. Aquí, sobre lo que cuenta. */
    const robeco = { united_states: 0.00281, latin_america: 0.073963, eurozone: 0.000837, europe_emerging: 0.014319, other: 0.50217, middle_east: 0.050018, asia: 0.844512, asia_emerging: 0.353718 };
    const salida = computeEquityRegionAllocation([{ asset_id: "R", weight_percent: 100 }], [fondo("R", 1, robeco)]);
    const { macroTotals } = buildRegionTable(salida.rows);
    expect(macroTotals.asia).toBeCloseTo((0.844512 / 0.986459) * 100, 4);
  });

  test("la fila que antes decía «Asia - Emergente» dice lo que es", () => {
    const { table } = buildRegionTable([{ key: "asia", weight_percent: 18.5 }]);
    expect(fila(table, "Asia, sin desglose")).toBe(18.5);
    expect(fila(table, "Asia - Emergente")).toBe(0);
  });

  test("forma antigua sin nada en Asia: «Otras» tampoco cuenta y la nota sale", () => {
    /* Latinoamérica 100, Otras 100: 68 fondos así en la base vieja. */
    const { zonas, canadaYAfricaSinSeparar, sinZona } = zonasDeUnReparto({ latin_america: 1, other: 1 });
    expect(zonas).toEqual({ latin_america: 1 });
    expect(canadaYAfricaSinSeparar).toBe(true);
    expect(sinZona).toBe(0);
  });

  test("sin «other» no hay nota: un fondo solo de EE. UU. no tiene nada que separar", () => {
    const { canadaYAfricaSinSeparar } = zonasDeUnReparto({ united_states: 1 });
    expect(canadaYAfricaSinSeparar).toBe(false);
  });

  test("forma nueva con un «other»: de verdad no tiene zona, se dice y no se reparte entre las demás", () => {
    const reparto = { united_states: 0.6, canada: 0.1, other: 0.3 };
    expect(zonasDeUnReparto(reparto)).toMatchObject({ canadaYAfricaSinSeparar: false, sinZona: 0.3, zonas: { united_states: 0.6, canada: 0.1 } });
    const salida = computeEquityRegionAllocation([{ asset_id: "F", weight_percent: 100 }], [fondo("F", 1, reparto)]);
    expect(salida.rows.find((r) => r.key === "united_states")?.weight_percent).toBeCloseTo(60, 6);
    expect(salida.unclassified_weight_percent).toBeCloseTo(30, 6);
    expect(salida.canadaYAfricaSinSeparar).toBeUndefined();
  });

  test("forma nueva: «asia_emerging» sin el total de Asia es una zona, no un «de la cual»", () => {
    const { zonas, asiaEmergenteDentroDeAsia } = zonasDeUnReparto({ asia_emerging: 0.35, asia_developed: 0.5, japan: 0.15 });
    expect(zonas).toEqual({ asia_emerging: 0.35, asia_developed: 0.5, japan: 0.15 });
    expect(asiaEmergenteDentroDeAsia).toBeNull();
  });

  test("durante una subida parcial conviven las dos formas: cada instrumento se lee por la suya", () => {
    const salida = computeEquityRegionAllocation(
      [{ asset_id: "A", weight_percent: 50 }, { asset_id: "B", weight_percent: 50 }],
      [fondo("A", 1, { asia: 1, asia_emerging: 0.4, other: 0.4 }), fondo("B", 1, { japan: 0.5, asia_developed: 0.5 })]
    );
    const { macroTotals, table } = buildRegionTable(salida.rows);
    expect(macroTotals.asia).toBeCloseTo(100, 6);
    expect(fila(table, "Asia, sin desglose")).toBeCloseTo(50, 6);
    expect(fila(table, "Japón")).toBeCloseTo(25, 6);
    expect(salida.canadaYAfricaSinSeparar).toBe(true);
  });

  test("un reparto vacío, cero o negativo no aporta nada", () => {
    expect(zonasDeUnReparto(undefined)).toEqual({ zonas: {}, asiaEmergenteDentroDeAsia: null, canadaYAfricaSinSeparar: false, sinZona: 0 });
    expect(zonasDeUnReparto({ asia: 0, other: -1 }).zonas).toEqual({});
  });

  test("un fondo que solo trae «other» no se da por repartido: cuenta como sin desglose", () => {
    const salida = computeEquityRegionAllocation([{ asset_id: "F", weight_percent: 100 }], [{ ...fondo("F", 1, { other: 1 }), currency: "HKD" } as BdbAssetDetail]);
    expect(salida.rows).toEqual([]);
    expect(salida.unclassified_weight_percent).toBe(100);
    expect(salida.canadaYAfricaSinSeparar).toBe(true);
  });
});

describe("el mapa no pierde lo que la taxonomía no conoce", () => {
  test("una acción con «Iberia» está en la zona euro: nunca 0,0 % con el activo dentro", () => {
    const { table, macroTotals, other } = buildRegionTable([{ key: "Iberia", weight_percent: 100 }]);
    expect(macroTotals).toEqual({ america: 0, emea: 100, asia: 0 });
    expect(fila(table, "Zona Euro")).toBe(100);
    expect(fila(table, "Europa / O. Medio / África")).toBe(100);
    expect(other).toBe(0);
  });

  test("de «Europe» se sabe la zona y no el detalle: tiene su fila", () => {
    const { table, macroTotals } = buildRegionTable([{ key: "Europe", weight_percent: 30 }]);
    expect(macroTotals.emea).toBe(30);
    expect(fila(table, "Europa, sin desglose")).toBe(30);
    /* Dentro de su grupo: antes de que empiece Asia. */
    const rotulos = table.map((r) => r.label);
    expect(rotulos.indexOf("Europa, sin desglose")).toBeLessThan(rotulos.indexOf("Asia"));
    expect(rotulos.indexOf("Europa, sin desglose")).toBeGreaterThan(rotulos.indexOf("Europa / O. Medio / África"));
  });

  test("la cartera mixta suma lo que debe", () => {
    /* iShares 40 + Iberdrola 30 + Inmocemento 30: las zonas sumaban 68,5 %. */
    const { macroTotals, other } = buildRegionTable([
      { key: "united_states", weight_percent: 28.5 },
      { key: "eurozone", weight_percent: 2.5 },
      { key: "japan", weight_percent: 3 },
      { key: "Iberia", weight_percent: 66 }
    ]);
    expect(macroTotals.america).toBe(28.5);
    expect(macroTotals.emea).toBe(68.5);
    expect(macroTotals.asia).toBe(3);
    expect(other).toBe(0);
  });

  test("lo que no se sabe situar se dice, no se reparte", () => {
    const { macroTotals, other } = buildRegionTable([
      { key: "united_states", weight_percent: 60 },
      { key: "Global", weight_percent: 2 }
    ]);
    expect(macroTotals).toEqual({ america: 60, emea: 0, asia: 0 });
    expect(other).toBeCloseTo(2, 10);
  });
});

describe("la ficha dice el total de Asia con su parte emergente (decisión 7)", () => {
  test("forma antigua: Asia 84,45 %, de la cual emergente 35,37 %, y «Otras» desaparece", () => {
    /* Robeco QI en la base nueva. */
    const { filas, nota } = seccionDeRegiones({ united_states: 0.00281, latin_america: 0.073963, eurozone: 0.000837, europe_emerging: 0.014319, other: 0.50217, middle_east: 0.050018, asia: 0.844512, asia_emerging: 0.353718 });
    const rotulos = filas.map((f) => f.rotulo);
    /* Con su peso en número, que es lo que el papel dibuja como barra (decisión A-124). */
    /* Un reparto es un peso: un decimal (apartado 6). */
    expect(filas[0]).toEqual({ rotulo: "Asia", valor: "84,5\u00a0%", peso: 0.844512 });
    expect(filas[1]).toEqual({ rotulo: "de la cual emergente", valor: "35,4\u00a0%", peso: 0.353718 });
    expect(rotulos).not.toContain("Otras");
    expect(rotulos).not.toContain("Asia emergente");
    expect(nota).toBe("Canadá y África aún no se separan.");
  });

  test("forma nueva: cada zona con su nombre, sin «de la cual» y sin nota", () => {
    const { filas, nota } = seccionDeRegiones({ asia_developed: 0.4908, asia_emerging: 0.3537, latin_america: 0.074, africa: 0.0135, canada: 0.01, japan: 0.03, australasia: 0.02 });
    expect(filas.map((f) => f.rotulo)).toEqual(["Asia desarrollada", "Asia emergente", "Latinoamérica", "Japón", "Australasia", "África", "Canadá"]);
    expect(nota).toBeUndefined();
  });

  test("forma nueva con un «other» de verdad: se dice como lo que es", () => {
    const { filas } = seccionDeRegiones({ united_states: 0.9, canada: 0.05, other: 0.05 });
    expect(filas.at(-1)).toMatchObject({ rotulo: "Sin zona", valor: "5,0\u00a0%" });
    expect(filas.at(-1)?.peso).toBeCloseTo(0.05, 12);
  });
});

describe("la región de un fondo en la lista (decisión 7)", () => {
  const region = (equity_regions: Record<string, number>) => componerFila({ instrument_id: "X", exposure: { equity_regions } } as Documento).region;

  test("«Otras» no es la región mayor de nadie, aunque sea la que más pese", () => {
    /* R-co Valor Balanced: 41,7 % en «other» y 39,4 % en EE. UU. */
    expect(region({ united_states: 0.394, other: 0.417, asia: 0.244, asia_emerging: 0.244 })).toBe("united_states");
    expect(region({ other: 1 })).toBeUndefined();
  });

  test("forma nueva: la zona con más peso", () => {
    expect(region({ canada: 0.65, united_states: 0.15 })).toBe("canada");
  });
});
