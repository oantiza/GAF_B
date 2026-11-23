import { describe, expect, test } from "vitest";
import type { InstrumentoDeLaBase } from "../src/adapters/baseNuevaLectura";
import { componerFicha } from "../src/adapters/componerFicha";
import { carteraPublicada } from "../src/core/carteraPublicada";
import { cuentaQueCuadra, rotuloDePosiciones, seExcluyen } from "../src/core/cuentaDePosiciones";
import { buildPortfolioLookThrough } from "../src/core/holdingsLookthrough";
import type { BdbAssetDetail, BdbHoldingPosition } from "../src/types/bdbAssets";

/**
 * pantalla-1 de las puertas finales (06-11-2026): la ficha de FON FINECO PATRIMONIO PERMANENTE escribía «1 posiciones» encima de diez
 * líneas con su peso. El proveedor declara 1, que en la base nueva es su número de bonos, y la ficha recibe 25 líneas. Una cuenta menor que
 * los títulos que llegan es falsa por construcción: no se escribe, y la regla es una para la ficha, Posiciones y el informe interno.
 */

const linea = (codigo: string | undefined, pesoPct: number, nombre = `${codigo ?? "sin código"} ${pesoPct}`): BdbHoldingPosition => ({
  name: nombre,
  weight_pct: pesoPct,
  ...(codigo ? { holding_type_code: codigo } : {})
});
const varias = (cuantas: number, codigo: string | undefined, desde: number) =>
  Array.from({ length: cuantas }, (_, i) => linea(codigo, desde - i / 100));

/** FON FINECO (ES0137397008) en 8092: once ETF, siete de efectivo, cuatro fondos, dos futuros de divisa y un bono. 16 títulos de 25 líneas. */
const FON_FINECO = [...varias(11, "FE", 10.56), ...varias(7, "C", 6.69), ...varias(4, "FO", 5.72), ...varias(2, "CL", 2), linea("BT", 1.5)];
/** CARTERA RENTA FIJA HORIZONTE 2026 (ES0116419005): seis bonos y una cuenta corriente. Declara 6, y es cierto. */
const HORIZONTE_2026 = [...varias(6, "BT", 16.32).map((l) => ({ ...l, weight_pct: 16.32 })), linea("C", 2.09)];

describe("la regla", () => {
  test("una cuenta menor que los títulos recibidos no se escribe; igual o mayor, sí", () => {
    expect(cuentaQueCuadra(1, 16)).toBeUndefined();
    expect(cuentaQueCuadra(11, 22)).toBeUndefined();
    expect(cuentaQueCuadra(49, 50)).toBeUndefined();
    expect(cuentaQueCuadra(6, 6)).toBe(6);
    expect(cuentaQueCuadra(49, 49)).toBe(49);
    /* iShares Core MSCI World: 1.247 según la fuente y sus 10 primeras líneas. Una lista corta no desmiente nada. */
    expect(cuentaQueCuadra(1247, 10)).toBe(1247);
  });

  test("sin nada recibido, nada la desmiente: se escribe la del proveedor", () => {
    expect(cuentaQueCuadra(5, undefined)).toBe(5);
    expect(cuentaQueCuadra(5, null)).toBe(5);
    expect(cuentaQueCuadra(1, 0)).toBe(1);
  });

  test("lo que no es un entero de al menos 1 no es una cuenta", () => {
    for (const declarada of [0, -3, 2.5, Number.NaN, Number.POSITIVE_INFINITY, "49", null, undefined]) {
      expect(cuentaQueCuadra(declarada, 0)).toBeUndefined();
    }
  });

  test("«1 posición» en singular, y el punto de los millares también en cuatro cifras", () => {
    expect(rotuloDePosiciones(1)).toBe("1 posición");
    expect(rotuloDePosiciones(2)).toBe("2 posiciones");
    expect(rotuloDePosiciones(1247)).toBe("1.247 posiciones");
    expect(rotuloDePosiciones(2376)).toBe("2.376 posiciones");
  });
});

describe("los títulos recibidos son los de `carteraPublicada`: sin efectivo, derivados ni su contrapartida (decisión 87)", () => {
  test("FON FINECO: 25 líneas y 16 títulos", () => {
    expect(carteraPublicada({ holdings: FON_FINECO })).toMatchObject({ lineas: 25, titulos: 16 });
  });

  test("seis bonos y una cuenta corriente son siete líneas y seis títulos", () => {
    expect(carteraPublicada({ holdings: HORIZONTE_2026 })).toMatchObject({ lineas: 7, titulos: 6 });
  });

  test("una línea sin peso no es nada; una sin código cuenta, como en el solapamiento; un CFD corto es una línea y no un título", () => {
    const cartera = [linea("E", 5), linea("E", 0), linea(undefined, 3), linea("SF", -7.31), linea("CQ", 1), linea("QQ", 2)];
    expect(carteraPublicada({ holdings: cartera })).toMatchObject({ lineas: 5, titulos: 2 });
  });

  test("la composición subyacente se los lleva de cada fondo, para el informe interno", async () => {
    const fondo = {
      asset_id: "ES0137397008", display_name: "FON FINECO PATRIMONIO PERMANENTE, FI", instrument_type: "FUND", economic_asset_class: "MIXED",
      holdings_summary: { has_holdings: true, positions_count: 1 }, pms_exposure: { equity: 0.3, fixed_income: 0.5, cash: 0.07, alternative: 0.13, other: 0 }
    } as unknown as BdbAssetDetail;
    const resultado = await buildPortfolioLookThrough({
      positions: [{ asset_id: "ES0137397008", weight_percent: 100 }],
      assets: [fondo],
      loadHoldings: async (assetId) => ({ asset_id: assetId, storage_mode: "SINGLE_DOCUMENT", holdings: FON_FINECO })
    });
    expect(resultado.fund_portfolios.map((f) => [f.lines, f.security_lines])).toEqual([[25, 16]]);
  });
});

/**
 * Decisión 121 (Óscar, 06-11-2026, opción C): la ficha dejó de escribir la cuenta porque `positions_count` es el número de bonos o, si no
 * hay, el de acciones. El 20-11-2026 Óscar decidió volver a escribirla con el total que la base guarda desde el 08-11, `securities_count`
 * (acciones más bonos), con la misma comprobación de antes (`cuentaQueCuadra` contra los títulos de las líneas que llegan). Si falta o la
 * desmienten, «Falta el dato» con su pieza. `positions_count` ya no se lee en la ficha.
 */
describe("la ficha escribe cuántas posiciones tiene el fondo, con `securities_count` (Óscar, 20-11-2026)", () => {
  const ficha = (bloque: Record<string, unknown>) =>
    componerFicha({
      isin: "ES0137397008",
      raiz: { instrument_type: "FUND", identity: { name: "Un fondo", currency: "EUR" } },
      tarjeta: { instrument_id: "ES0137397008" },
      calidad: undefined,
      bloques: { "declared/holdings": { source: "canonical:fondosdb", as_of: "2026-08-31", ...bloque } }
    } satisfies InstrumentoDeLaBase).secciones.find((s) => s.id === "cartera")!;
  const procedencia = (seccion: ReturnType<typeof ficha>) => seccion.procedencia.map((t) => t.texto).join("");
  const FALTA = "Declarada por el proveedor · 31/08/2026 · posiciones: Falta el dato";
  /* Las líneas del bloque, en fracción, como las guarda la base nueva. */
  const top = (lineas: BdbHoldingPosition[]) =>
    lineas.map((l) => ({ name: l.name, weight: l.weight_pct / 100, ...(l.holding_type_code ? { holding_type_code: l.holding_type_code } : {}) }));

  test("FON FINECO: declara 1 y trae 16 títulos, así que la cuenta no se escribe: «Falta el dato», y no pierde nada más", () => {
    const seccion = ficha({ positions_count: 1, securities_count: 1, top10_weight: 0.6412974, top: top(FON_FINECO) });
    expect(procedencia(seccion)).toBe(FALTA);
    /* Con su pieza, no como texto suelto. */
    expect(seccion.procedencia.find((t) => t.ausencia)).toEqual({ texto: "Falta el dato", ausencia: "falta" });
    expect(seccion.tabla?.filas).toHaveLength(10);
    expect(seccion.nota).toBe("El proveedor no declara el sector de sus posiciones.");
  });

  test("seis bonos y una cuenta: «6 posiciones», que es cierto aunque haya siete líneas, y las diez mayores detrás", () => {
    const seccion = ficha({ positions_count: 6, securities_count: 6, top10_weight: 0.9999999, top: top(HORIZONTE_2026) });
    expect(procedencia(seccion)).toBe("Declarada por el proveedor · 31/08/2026 · 6 posiciones, diez mayores 100,0\u00a0%");
    expect(seccion.tabla?.filas).toHaveLength(7);
  });

  test("sin `securities_count`, «Falta el dato» y las diez mayores detrás de una coma; `positions_count` no lo sustituye", () => {
    const pesos = [7.36, 6.39, 5.61, 5.53, 5.26, 4.95, 4.89, 4.78, 4.43, 4.05];
    const seccion = ficha({ positions_count: 300, top10_weight: 0.5324164, top: top(pesos.map((p) => linea("E", p))) });
    expect(procedencia(seccion)).toBe(`${FALTA}, diez mayores 53,2\u00a0%`);
  });

  test("una sola posición y una sola línea: «1 posición», en singular", () => {
    const seccion = ficha({ positions_count: 1, securities_count: 1, top: top([linea("FO", 99.2, "Fondo principal")]) });
    expect(procedencia(seccion)).toBe("Declarada por el proveedor · 31/08/2026 · 1 posición");
    expect(seccion.tabla?.filas).toHaveLength(1);
  });

  test("un mixto: sus 11 bonos ya no se escriben como cuenta; sus títulos, sí (MERCH-UNIVERSAL)", () => {
    const lineas = [...varias(4, "BT", 14), ...varias(2, "CL", 10), ...varias(13, "E", 4), ...varias(2, "GS", 4.1), linea("QQ", 4), ...varias(3, "B", 1)];
    expect(carteraPublicada({ holdings: lineas })).toMatchObject({ lineas: 25, titulos: 22 });
    expect(procedencia(ficha({ positions_count: 11, top: top(lineas) }))).toBe(FALTA);
    expect(procedencia(ficha({ positions_count: 11, securities_count: 48, top: top(lineas) }))).toBe("Declarada por el proveedor · 31/08/2026 · 48 posiciones");
  });

  test("R-co Valor Balanced: 243 posiciones y no «191», que son sus bonos; e iShares Core MSCI World, «1.247 posiciones»", () => {
    expect(procedencia(ficha({ positions_count: 191, securities_count: 243, top: top(varias(25, "B", 2)) }))).toBe(
      "Declarada por el proveedor · 31/08/2026 · 243 posiciones"
    );
    const diezIguales = Array.from({ length: 10 }, (_, i) => linea("E", 2.778, `Acción ${i + 1}`));
    expect(procedencia(ficha({ positions_count: 1247, securities_count: 1247, top10_weight: 0.2778, top: top(diezIguales) }))).toBe(
      "Declarada por el proveedor · 31/08/2026 · 1.247 posiciones, diez mayores 27,8\u00a0%"
    );
  });
});

describe("lo que no pasa a Diseño de cartera (A-135)", () => {
  test("«Se excluye 1 posición», no «Se excluyen 1 posiciones»; y en plural, como estaba", () => {
    expect(seExcluyen(1)).toBe("Se excluye 1 posición");
    expect(seExcluyen(2)).toBe("Se excluyen 2 posiciones");
    expect(seExcluyen(1250)).toBe("Se excluyen 1.250 posiciones");
  });
});
