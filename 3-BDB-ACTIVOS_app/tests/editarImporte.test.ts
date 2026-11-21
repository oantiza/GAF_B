import { describe, expect, test } from "vitest";
import { editarImporte, fraseDelImporteAjustado, hayPesoFijado } from "../src/core/asignacionTactica";
import { portfolioPositionAmount, updatePortfolioAmount } from "../src/core/portfolioAmounts";
import type { BdbManualPortfolioPosition } from "../src/types/bdbAssets";

/**
 * Decisión 37 de Óscar (05-11-2026): manda el peso. Editar un importe no mueve lo fijado, nunca.
 * Todos los resultados esperados están hechos a mano, sobre 100.000 € salvo que se diga otra cosa: con el capital
 * fijo, 1.000 € son un punto.
 */
const CAPITAL = 100000;
const cartera = (pesos: Record<string, number>): BdbManualPortfolioPosition[] =>
  Object.entries(pesos).map(([asset_id, weight_percent]) => ({ asset_id, weight_percent }));
const pesos = (posiciones: BdbManualPortfolioPosition[]) =>
  Object.fromEntries(posiciones.map((posicion) => [posicion.asset_id, posicion.weight_percent]));
const suma = (posiciones: BdbManualPortfolioPosition[]) => posiciones.reduce((total, posicion) => total + posicion.weight_percent, 0);
const espacios = (texto: string) => texto.replace(/\u00a0/g, " ");

function esperaPesos(reales: BdbManualPortfolioPosition[], esperados: Record<string, number>) {
  expect(Object.keys(pesos(reales))).toEqual(Object.keys(esperados));
  for (const [id, peso] of Object.entries(esperados)) expect(pesos(reales)[id], id).toBeCloseTo(peso, 9);
}

describe("el caso del encargo: A fijada al 40 %, B y C libres", () => {
  const FIJADA_A = { A: true };

  test.each([
    ["40 / 30 / 30", { A: 40, B: 30, C: 30 }],
    ["40 / 20 / 40", { A: 40, B: 20, C: 40 }],
    ["40 / 60 / 0", { A: 40, B: 60, C: 0 }],
    ["40 / 0 / 60", { A: 40, B: 0, C: 60 }]
  ])("desde %s, B a 30.000 da A 40 %%, B 30 %%, C 30 %%, y el capital no cambia", (_nombre, inicio) => {
    const resultado = editarImporte(cartera(inicio), CAPITAL, "B", 30000, FIJADA_A)!;
    esperaPesos(resultado.update.positions, { A: 40, B: 30, C: 30 });
    expect(pesos(resultado.update.positions).A).toBe(40);
    expect(resultado.update.totalCapital).toBe(CAPITAL);
    expect(resultado.ajuste).toBeNull();
  });

  test("B a 70.000 no cabe: B se queda en 60.000, C a 0, y se dice con la cifra", () => {
    const resultado = editarImporte(cartera({ A: 40, B: 30, C: 30 }), CAPITAL, "B", 70000, FIJADA_A)!;
    esperaPesos(resultado.update.positions, { A: 40, B: 60, C: 0 });
    expect(resultado.update.totalCapital).toBe(CAPITAL);
    expect(resultado.update.positions.map((posicion) => portfolioPositionAmount(posicion, CAPITAL))).toEqual([40000, 60000, 0]);
    expect(resultado.ajuste).toEqual({ motivo: "no-cabe", pedido: 70000, queda: 60000, fijado: 40, libresACero: 1 });
    expect(espacios(fraseDelImporteAjustado(resultado.ajuste!, "Fondo B", "quita un candado"))).toBe(
      "El importe no cabe porque hay un 40,0 % fijado: «Fondo B» se queda en 60.000,00 € en vez de 70.000,00 €, y la otra posición libre pasa a 0 €. Para que quepa, sube el capital o quita un candado."
    );
  });

  test("B a 60.000 cabe justo: C a 0 sin decir nada, porque el importe es el pedido", () => {
    const resultado = editarImporte(cartera({ A: 40, B: 30, C: 30 }), CAPITAL, "B", 60000, FIJADA_A)!;
    esperaPesos(resultado.update.positions, { A: 40, B: 60, C: 0 });
    expect(resultado.ajuste).toBeNull();
  });

  test("B a 0: lo que suelta B va a C", () => {
    const resultado = editarImporte(cartera({ A: 40, B: 30, C: 30 }), CAPITAL, "B", 0, FIJADA_A)!;
    esperaPesos(resultado.update.positions, { A: 40, B: 0, C: 60 });
    expect(resultado.ajuste).toBeNull();
  });

  test("escribir lo que ya hay no cambia nada", () => {
    const inicio = cartera({ A: 40, B: 30, C: 30 });
    const resultado = editarImporte(inicio, CAPITAL, "B", 30000, FIJADA_A)!;
    expect(resultado.update.positions).toBe(inicio);
    expect(resultado.ajuste).toBeNull();
  });
});

describe("cómo se reparte entre las libres", () => {
  test("en su proporción: de 60 libres, B toma 30 y C:D siguen 3:1", () => {
    const resultado = editarImporte(cartera({ A: 40, B: 20, C: 30, D: 10 }), CAPITAL, "B", 30000, { A: true })!;
    esperaPesos(resultado.update.positions, { A: 40, B: 30, C: 22.5, D: 7.5 });
  });

  test("a partes iguales si todas están a 0 %", () => {
    const resultado = editarImporte(cartera({ A: 40, B: 60, C: 0, D: 0 }), CAPITAL, "B", 30000, { A: true })!;
    esperaPesos(resultado.update.positions, { A: 40, B: 30, C: 15, D: 15 });
  });

  test("con varias a cero la frase habla en plural", () => {
    const resultado = editarImporte(cartera({ A: 40, B: 20, C: 30, D: 10 }), CAPITAL, "B", 90000, { A: true })!;
    esperaPesos(resultado.update.positions, { A: 40, B: 60, C: 0, D: 0 });
    expect(fraseDelImporteAjustado(resultado.ajuste!, "B", "quita un candado")).toContain("las otras posiciones libres pasan a 0");
  });

  test("la cartera de muestra: iShares fijada al 24 %, Amundi de 10.000 a 20.000", () => {
    /* Quedan 76 para las libres. Amundi toma 20, y las otras cinco reparten 56 sobre los 66 que sumaban. */
    const inicio = cartera({ iShares: 24, Vanguard: 12, Amundi: 10, Robeco: 8, PIMCO: 20, JPMorgan: 10, Rco: 9, Goldman: 7 });
    const resultado = editarImporte(inicio, CAPITAL, "Amundi", 20000, { iShares: true })!;
    const escala = 56 / 66;
    esperaPesos(resultado.update.positions, {
      iShares: 24,
      Vanguard: 12 * escala,
      Amundi: 20,
      Robeco: 8 * escala,
      PIMCO: 20 * escala,
      JPMorgan: 10 * escala,
      Rco: 9 * escala,
      Goldman: 7 * escala
    });
    expect(resultado.update.totalCapital).toBe(CAPITAL);
    expect(suma(resultado.update.positions)).toBeCloseTo(100, 10);
  });

  test("con céntimos: 10.000,25 € son 10,00025 puntos, y salen exactos los euros de todas", () => {
    const resultado = editarImporte(cartera({ A: 60, B: 40, C: 0 }), CAPITAL, "C", 10000.25, { A: true })!;
    esperaPesos(resultado.update.positions, { A: 60, B: 29.99975, C: 10.00025 });
    expect(resultado.update.positions.map((posicion) => portfolioPositionAmount(posicion, CAPITAL))).toEqual([60000, 29999.75, 10000.25]);
    expect(resultado.ajuste).toBeNull();
  });
});

describe("lo fijado no se mueve, ni en una centésima", () => {
  test("un peso con más decimales de los que se enseñan sale idéntico", () => {
    const resultado = editarImporte(cartera({ A: 33.333333, B: 33.333333, C: 33.333334 }), CAPITAL, "B", 50000, { A: true })!;
    expect(pesos(resultado.update.positions).A).toBe(33.333333);
    expect(pesos(resultado.update.positions).B).toBeCloseTo(50, 9);
    expect(pesos(resultado.update.positions).C).toBeCloseTo(16.666667, 9);
  });

  test("cien ediciones seguidas: A sigue en 40 exacto, el capital no se mueve y la suma no deriva", () => {
    let posiciones = cartera({ A: 40, B: 30, C: 30 });
    for (let vuelta = 0; vuelta < 100; vuelta += 1) {
      posiciones = editarImporte(posiciones, CAPITAL, vuelta % 2 ? "B" : "C", 12345.67 + vuelta, { A: true })!.update.positions;
    }
    expect(pesos(posiciones).A).toBe(40);
    expect(suma(posiciones)).toBeCloseTo(100, 9);
  });

  test("una posición de importe fijo tampoco: conserva peso y objetivo, y la libre absorbe", () => {
    const inicio: BdbManualPortfolioPosition[] = [
      { asset_id: "A", weight_percent: 40 },
      { asset_id: "E", weight_percent: 20, keepEuros: true, targetEuros: 20000 },
      { asset_id: "B", weight_percent: 20 },
      { asset_id: "C", weight_percent: 20 }
    ];
    const resultado = editarImporte(inicio, CAPITAL, "B", 30000, { A: true })!;
    esperaPesos(resultado.update.positions, { A: 40, E: 20, B: 30, C: 10 });
    expect(resultado.update.positions[1]).toMatchObject({ keepEuros: true, targetEuros: 20000 });
  });

  test("cuenta lo fijado por las dos vías: 60 % fijado deja 40 para B y C", () => {
    const inicio: BdbManualPortfolioPosition[] = [
      { asset_id: "A", weight_percent: 40 },
      { asset_id: "E", weight_percent: 20, keepEuros: true, targetEuros: 20000 },
      { asset_id: "B", weight_percent: 20 },
      { asset_id: "C", weight_percent: 20 }
    ];
    const resultado = editarImporte(inicio, CAPITAL, "B", 50000, { A: true })!;
    esperaPesos(resultado.update.positions, { A: 40, E: 20, B: 40, C: 0 });
    expect(resultado.ajuste).toMatchObject({ motivo: "no-cabe", queda: 40000, fijado: 60 });
  });

  test("la fila de importe fijo que se edita pasa a su importe nuevo", () => {
    const inicio: BdbManualPortfolioPosition[] = [
      { asset_id: "A", weight_percent: 40 },
      { asset_id: "E", weight_percent: 30, keepEuros: true, targetEuros: 30000 },
      { asset_id: "C", weight_percent: 30 }
    ];
    const resultado = editarImporte(inicio, CAPITAL, "E", 20000, { A: true })!;
    esperaPesos(resultado.update.positions, { A: 40, E: 20, C: 40 });
    expect(resultado.update.positions[1]).toMatchObject({ keepEuros: true, targetEuros: 20000 });
  });
});

describe("casos límite", () => {
  test("todo fijado menos la que se edita: pida lo que pida, es lo que deja lo fijado", () => {
    const inicio = cartera({ A: 40, D: 30, B: 30 });
    const candados = { A: true, D: true };

    const deMas = editarImporte(inicio, CAPITAL, "B", 50000, candados)!;
    expect(deMas.update.positions).toBe(inicio);
    expect(deMas.update.totalCapital).toBe(CAPITAL);
    expect(deMas.ajuste).toEqual({ motivo: "no-cabe", pedido: 50000, queda: 30000, fijado: 70, libresACero: 0 });
    expect(espacios(fraseDelImporteAjustado(deMas.ajuste!, "B", "quita un candado"))).toBe(
      "El importe no cabe porque hay un 70,0 % fijado: «B» se queda en 30.000,00 € en vez de 50.000,00 €. Para que quepa, sube el capital o quita un candado."
    );

    const deMenos = editarImporte(inicio, CAPITAL, "B", 20000, candados)!;
    expect(deMenos.update.positions).toBe(inicio);
    expect(deMenos.ajuste).toEqual({ motivo: "unica-libre", pedido: 20000, queda: 30000 });
    expect(espacios(fraseDelImporteAjustado(deMenos.ajuste!, "B", "quita un candado"))).toBe(
      "«B» es la única posición libre: su importe es lo que deja lo fijado, 30.000,00 €, y no 20.000,00 €. Para darle otro, quita un candado."
    );
  });

  test("suma de candados igual a 100 %: no cabe nada, no se toca nada, y subir el capital no ayuda", () => {
    const inicio = cartera({ A: 60, B: 40, C: 0 });
    const resultado = editarImporte(inicio, CAPITAL, "C", 10000, { A: true, B: true })!;
    expect(resultado.update.positions).toBe(inicio);
    expect(resultado.ajuste).toEqual({ motivo: "no-cabe", pedido: 10000, queda: 0, fijado: 100, libresACero: 0 });
    expect(espacios(fraseDelImporteAjustado(resultado.ajuste!, "C", "quita un candado"))).toBe(
      "El importe no cabe porque hay un 100,0 % fijado: «C» se queda en 0,00 € en vez de 10.000,00 €. Para que quepa, quita un candado."
    );
  });

  test("candados por encima de 100 %: tampoco se toca nada", () => {
    const inicio = cartera({ A: 70, B: 50, C: 10 });
    const resultado = editarImporte(inicio, CAPITAL, "C", 5000, { A: true, B: true })!;
    expect(resultado.update.positions).toBe(inicio);
    expect(resultado.ajuste).toEqual({ motivo: "no-cabe", pedido: 5000, queda: 10000, fijado: 120, libresACero: 0 });
  });

  test("una sola posición libre: es la edición de siempre, y el importe manda el capital", () => {
    const resultado = editarImporte(cartera({ A: 100 }), CAPITAL, "A", 50000, {})!;
    expect(resultado.update.totalCapital).toBe(50000);
    expect(pesos(resultado.update.positions).A).toBe(100);
    expect(resultado.ajuste).toBeNull();
  });

  test("una sola posición fijada, o cualquier fila fijada: su importe no se edita", () => {
    expect(editarImporte(cartera({ A: 100 }), CAPITAL, "A", 50000, { A: true })).toBeNull();
    expect(editarImporte(cartera({ A: 40, B: 60 }), CAPITAL, "A", 50000, { A: true })).toBeNull();
  });

  test("capital a 0 con un peso fijado: no hay sobre qué traducir, y se dice", () => {
    const inicio = cartera({ A: 40, B: 60 });
    const resultado = editarImporte(inicio, 0, "B", 30000, { A: true })!;
    expect(resultado.update.positions).toBe(inicio);
    expect(resultado.ajuste).toEqual({ motivo: "sin-capital" });
    expect(fraseDelImporteAjustado(resultado.ajuste!, "B", "quita un candado")).toContain("escríbelo primero");
  });

  test("entradas que no se pueden leer: como siempre, nada", () => {
    const inicio = cartera({ A: 40, B: 30, C: 30 });
    for (const importe of [NaN, Infinity, -1, Number.MAX_VALUE]) expect(editarImporte(inicio, CAPITAL, "B", importe, { A: true })).toBeNull();
    expect(editarImporte(inicio, CAPITAL, "X", 5, { A: true })).toBeNull();
    expect(editarImporte(inicio, NaN, "B", 5, { A: true })).toBeNull();
  });
});

/*
 * A mano: 100.000 € y 200.000 € sobre 300.000 € pesan un tercio y dos tercios. Son cocientes de céntimos, sin redondear, y
 * en coma flotante 33,33… + 66,66… da 99,99999999999999: esa diferencia no es peso que quede libre.
 */
describe("el ruido de sumar pesos no es un hueco", () => {
  const UN_TERCIO = (100000 / 300000) * 100;
  const DOS_TERCIOS = (200000 / 300000) * 100;

  test("dos candados que suman 100 % con ruido: no cabe nada, no se toca nada, y subir el capital no ayuda", () => {
    expect(UN_TERCIO + DOS_TERCIOS).not.toBe(100);
    const inicio = cartera({ A: UN_TERCIO, B: DOS_TERCIOS, C: 0 });
    const resultado = editarImporte(inicio, 300000, "C", 10000, { A: true, B: true })!;
    expect(resultado.update.positions).toBe(inicio);
    expect(resultado.ajuste).toEqual({ motivo: "no-cabe", pedido: 10000, queda: 0, fijado: 100, libresACero: 0 });
    expect(espacios(fraseDelImporteAjustado(resultado.ajuste!, "C", "quita un candado"))).toBe(
      "El importe no cabe porque hay un 100,0 % fijado: «C» se queda en 0,00 € en vez de 10.000,00 €. Para que quepa, quita un candado."
    );
  });

  test("todo fijado menos la editada, en tercios: no hay nada que aplicar, así que no se pedirá fijar el capital", () => {
    const inicio = cartera({ A: 100 / 3, D: 100 / 3, B: 100 / 3 });
    expect(100 - (100 / 3 + 100 / 3)).not.toBe(100 / 3);
    const resultado = editarImporte(inicio, 300000, "B", 150000, { A: true, D: true })!;
    expect(resultado.update.positions).toBe(inicio);
    expect(resultado.ajuste).toMatchObject({ motivo: "no-cabe", pedido: 150000, queda: 100000 });
  });

  test("lo que deja la editada a las demás libres, si es ruido, es un 0 de verdad", () => {
    const inicio = cartera({ A: UN_TERCIO, B: UN_TERCIO, C: UN_TERCIO });
    const resultado = editarImporte(inicio, 300000, "B", 200000, { A: true })!;
    expect(pesos(resultado.update.positions).C).toBe(0);
    expect(pesos(resultado.update.positions).A).toBe(UN_TERCIO);
    expect(resultado.ajuste).toBeNull();
  });
});

describe("si la cartera no cuadraba, nadie asigna por el asesor lo que no estaba asignado", () => {
  test("sumaba 60: B sube a 30 y C se queda en 10; la suma dice 80 y faltan 20.000 €", () => {
    const resultado = editarImporte(cartera({ A: 40, B: 10, C: 10 }), CAPITAL, "B", 30000, { A: true })!;
    esperaPesos(resultado.update.positions, { A: 40, B: 30, C: 10 });
    expect(pesos(resultado.update.positions).C).toBe(10);
    expect(resultado.ajuste).toBeNull();
  });

  test("las libres solo bajan si no caben: B a 55 deja 5 para C", () => {
    const resultado = editarImporte(cartera({ A: 40, B: 10, C: 10 }), CAPITAL, "B", 55000, { A: true })!;
    esperaPesos(resultado.update.positions, { A: 40, B: 55, C: 5 });
    expect(resultado.ajuste).toBeNull();
  });

  test("y el tope sigue siendo lo que deja lo fijado", () => {
    const resultado = editarImporte(cartera({ A: 40, B: 10, C: 10 }), CAPITAL, "B", 70000, { A: true })!;
    esperaPesos(resultado.update.positions, { A: 40, B: 60, C: 0 });
    expect(resultado.ajuste).toEqual({ motivo: "no-cabe", pedido: 70000, queda: 60000, fijado: 40, libresACero: 1 });
  });

  test("sin otra libre y sin cuadrar, el importe pedido cabe tal cual", () => {
    const resultado = editarImporte(cartera({ A: 40, D: 30, B: 10 }), CAPITAL, "B", 20000, { A: true, D: true })!;
    esperaPesos(resultado.update.positions, { A: 40, D: 30, B: 20 });
    expect(resultado.ajuste).toBeNull();
  });

  test("sumaba más de 100: lo libre baja hasta caber", () => {
    const resultado = editarImporte(cartera({ A: 40, B: 40, C: 40 }), CAPITAL, "B", 30000, { A: true })!;
    esperaPesos(resultado.update.positions, { A: 40, B: 30, C: 30 });
  });
});

describe("sin peso fijado, nada cambia respecto a lo de siempre", () => {
  test("sin candados: se conservan los demás importes y el capital es la suma", () => {
    const inicio = cartera({ A: 60, B: 40 });
    const resultado = editarImporte(inicio, CAPITAL, "B", 25000.37, {})!;
    expect(resultado.update).toEqual(updatePortfolioAmount(inicio, CAPITAL, "B", 25000.37));
    expect(resultado.update.totalCapital).toBe(85000.37);
    expect(resultado.ajuste).toBeNull();
  });

  test("un candado sobre un 0 % no fija nada: 0 sobre cualquier capital sigue siendo 0", () => {
    const inicio = cartera({ A: 0, B: 60, C: 40 });
    expect(hayPesoFijado(inicio, { A: true })).toBe(false);
    const resultado = editarImporte(inicio, CAPITAL, "B", 70000, { A: true })!;
    expect(resultado.update.totalCapital).toBe(110000);
    expect(pesos(resultado.update.positions).A).toBe(0);
  });

  test("con un candado sobre un 0 % y capital a 0 se puede escribir el primer importe", () => {
    const resultado = editarImporte(cartera({ A: 0, B: 0 }), 0, "B", 1000, { A: true })!;
    expect(resultado.update.totalCapital).toBe(1000);
    expect(pesos(resultado.update.positions)).toEqual({ A: 0, B: 100 });
  });

  test("solo importes fijos, sin candados: también lo de siempre", () => {
    const inicio: BdbManualPortfolioPosition[] = [
      { asset_id: "E", weight_percent: 40, keepEuros: true, targetEuros: 40000 },
      { asset_id: "B", weight_percent: 60 }
    ];
    expect(hayPesoFijado(inicio, {})).toBe(false);
    const resultado = editarImporte(inicio, CAPITAL, "B", 40000, {})!;
    expect(resultado.update.totalCapital).toBe(80000);
    expect(portfolioPositionAmount(resultado.update.positions[0], 80000)).toBe(40000);
  });

  test("un candado apagado o de otra cartera no cuenta", () => {
    expect(hayPesoFijado(cartera({ A: 60, B: 40 }), { A: false, Z: true })).toBe(false);
    expect(hayPesoFijado(cartera({ A: 60, B: 40 }), { A: true })).toBe(true);
  });
});
