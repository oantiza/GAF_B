/**
 * La Propuesta de cambio (decisión 32): lo que compone el documento, con resultados conocidos, calculados a mano (ver
 * `tests/support/propuestaFixtures.ts`). El PDF, en `propuestaDeCambioPdf.test.ts`.
 */
import { describe, expect, test } from "vitest";
import { diaLocal } from "../src/core/fechaLocal";
import { parteMedidaDeLaSimulacion } from "../src/core/parteMedida";
import {
  costesDeLasDos,
  crisisDeLasDos,
  faltaParaLaPropuesta,
  filasDeCambios,
  mismaComposicion,
  eurosQueCuadran,
  planDeEjecucion,
  propuestaDeCambio,
  puntosConSigno,
  repartirEnHojas,
  type EntradaDeLaPropuesta
} from "../src/core/propuestaDeCambio";
import { ACTIVOS, ACTUAL, activo, crisisConCifra, escenario, historia, PROPUESTA, semanas, SERIE_ACTUAL, SERIE_PROPUESTA } from "./support/propuestaFixtures";

/* `fmtEur` pone un espacio duro delante del «€»: aquí se escribe uno normal, que es lo que se lee. */
const conEuros = (texto: string) => texto.replaceAll(" €", " €");

const IDS_ACTUAL = ["LU0000000001", "LU0000000002"];
const IDS_PROPUESTA = ["LU0000000001", "LU0000000003", "ES0144580Y14"];

const entrada = (cambios: Partial<EntradaDeLaPropuesta> = {}): EntradaDeLaPropuesta => ({
  actual: ACTUAL,
  propuesta: PROPUESTA,
  periodo: "3Y",
  historiaActual: historia(IDS_ACTUAL, SERIE_ACTUAL),
  historiaPropuesta: historia(IDS_PROPUESTA, SERIE_PROPUESTA),
  assets: ACTIVOS,
  capital: 100000,
  cliente: "Ana Ruiz",
  motivo: "Un motivo escrito por el asesor.",
  generadoEn: "2026-11-05T09:00:00Z",
  ...cambios
});

describe("qué cambia, posición a posición", () => {
  test("peso antes y después, y la diferencia en puntos, de mayor a menor cambio", () => {
    const filas = filasDeCambios(ACTUAL, PROPUESTA, ACTIVOS);
    expect(filas.map((f) => [f.nombre, f.textoActual, f.textoPropuesta, f.textoDiferencia, f.donde])).toEqual([
      ["Fondo B", "40,0\u00a0%", "0,0\u00a0%", "−40,00\u00a0pp", "Solo en Actual"],
      ["Fondo C", "0,0\u00a0%", "30,0\u00a0%", "+30,00\u00a0pp", "Solo en Propuesta"],
      ["Iberdrola", "0,0\u00a0%", "20,0\u00a0%", "+20,00\u00a0pp", "Solo en Propuesta"],
      ["Fondo A", "60,0\u00a0%", "50,0\u00a0%", "−10,00\u00a0pp", null]
    ]);
  });

  test("una acción dice «No aplica»; un fondo sin coste, «Falta el dato»: no se pintan igual, y ninguno es un cero", () => {
    const filas = filasDeCambios(
      { name: "A", positions: [{ asset_id: "FONDO", weight_percent: 50 }, { asset_id: "ACCION", weight_percent: 50 }] },
      { name: "B", positions: [{ asset_id: "FONDO", weight_percent: 100 }] },
      [activo("FONDO", "Fondo sin coste", null), activo("ACCION", "Iberdrola", 0.5, "STOCK")]
    );
    expect(filas.find((f) => f.id === "ACCION")?.coste).toBe("No aplica");
    expect(filas.find((f) => f.id === "FONDO")?.coste).toBe("Falta el dato");
  });

  test("una posición que no cambia sale, y dice «Sin cambio»; así los pesos suman 100 a la vista", () => {
    const filas = filasDeCambios(
      { name: "A", positions: [{ asset_id: "X", weight_percent: 50 }, { asset_id: "Y", weight_percent: 50 }] },
      { name: "B", positions: [{ asset_id: "X", weight_percent: 50 }, { asset_id: "Z", weight_percent: 50 }] },
      []
    );
    expect(filas.find((f) => f.id === "X")?.textoDiferencia).toBe("Sin cambio");
    expect(filas.reduce((s, f) => s + f.pesoActual, 0)).toBe(100);
    expect(filas.reduce((s, f) => s + f.pesoPropuesta, 0)).toBe(100);
  });

  test("pesos que no suman 100 se llevan al 100 % antes de restar: 110 con 55 y 55 son 50 y 50", () => {
    const [fila] = filasDeCambios(
      { name: "A", positions: [{ asset_id: "X", weight_percent: 55 }, { asset_id: "Y", weight_percent: 55 }] },
      { name: "B", positions: [{ asset_id: "X", weight_percent: 60 }, { asset_id: "Y", weight_percent: 40 }] },
      []
    );
    expect(fila.pesoActual).toBeCloseTo(50, 10);
    expect(fila.diferencia).toBeCloseTo(10, 10);
  });

  test("una posición al 0 % no existe: ni sale ni se puede operar", () => {
    const filas = filasDeCambios(
      { name: "A", positions: [{ asset_id: "X", weight_percent: 100 }, { asset_id: "Y", weight_percent: 0 }] },
      { name: "B", positions: [{ asset_id: "X", weight_percent: 100 }, { asset_id: "Z", weight_percent: 0 }] },
      []
    );
    expect(filas.map((f) => f.id)).toEqual(["X"]);
  });

  test("dice qué lado no la mide en la simulación", () => {
    const actual = parteMedidaDeLaSimulacion({ asset_ids: ["LU0000000001"], excluded_assets: [{ asset_id: "LU0000000002", reason: "QUALITY_BLOCKED" }] as never }, ACTUAL.positions);
    const filas = filasDeCambios(ACTUAL, PROPUESTA, ACTIVOS, { actual, propuesta: null });
    expect(filas.find((f) => f.id === "LU0000000002")?.fueraDeLaSimulacion).toBe("Fuera de la simulación en Actual");
    expect(filas.find((f) => f.id === "LU0000000001")?.fueraDeLaSimulacion).toBeNull();
  });
});

describe("plan de ejecución", () => {
  const filas = filasDeCambios(ACTUAL, PROPUESTA, ACTIVOS);

  test("con capital: importes; primero lo que libera dinero y después lo que lo usa, de mayor a menor", () => {
    const plan = planDeEjecucion(filas, 100000);
    expect(plan.pasos.map((p) => [p.operacion, p.nombre, p.textoPuntos, p.textoImporte])).toEqual([
      ["Salir", "Fondo B", "40,00\u00a0%", conEuros("40.000 €")],
      ["Reducir", "Fondo A", "10,00\u00a0%", conEuros("10.000 €")],
      ["Incorporar", "Fondo C", "30,00\u00a0%", conEuros("30.000 €")],
      ["Incorporar", "Iberdrola", "20,00\u00a0%", conEuros("20.000 €")]
    ]);
    expect(plan.textoTotalPuntos).toBe("50,00\u00a0%");
    expect(plan.textoTotalImporte).toBe(conEuros("50.000 €"));
  });

  test("lo que sale y lo que entra son lo mismo, y es el total", () => {
    const plan = planDeEjecucion(filas, 123456.78);
    const sale = plan.pasos.filter((p) => p.operacion === "Salir" || p.operacion === "Reducir").reduce((s, p) => s + (p.importe ?? 0), 0);
    const entra = plan.pasos.filter((p) => p.operacion === "Incorporar" || p.operacion === "Aumentar").reduce((s, p) => s + (p.importe ?? 0), 0);
    expect(sale).toBeCloseTo(entra, 6);
    expect(sale).toBeCloseTo(plan.totalImporte ?? NaN, 6);
    expect(plan.totalImporte).toBeCloseTo(61728.39, 2);
  });

  test("los importes escritos suman el total escrito, de cada lado (CMP-4)", () => {
    /* 123.456,78 € y los cambios de siempre: B −40, A −10, C +30, Iberdrola +20.
       Sale:  B 49.382,712 y A 12.345,678 → 61.728,39 → se escribe 61.728. Truncados, 49.382 + 12.345 = 61.727: falta un
              euro, que va al de mayor resto (B, 0,712 frente a 0,678) → 49.383 y 12.345. Redondeando cada uno por su
              cuenta salían 49.383 y 12.346, que suman 61.729.
       Entra: C 37.037,034 e Iberdrola 24.691,356 → 61.728,39 → 61.728. Truncados ya suman 61.728: 37.037 y 24.691. */
    const plan = planDeEjecucion(filas, 123456.78);
    expect(plan.pasos.map((p) => [p.nombre, p.textoImporte])).toEqual([
      ["Fondo B", conEuros("49.383 €")],
      ["Fondo A", conEuros("12.345 €")],
      ["Fondo C", conEuros("37.037 €")],
      ["Iberdrola", conEuros("24.691 €")]
    ]);
    expect(plan.textoTotalImporte).toBe(conEuros("61.728 €"));
    /* El importe exacto de cada paso no se toca: es con el que se hacen las cuentas. */
    expect(plan.pasos[0].importe).toBeCloseTo(49382.712, 3);
  });

  test("euros que cuadran: la suma de lo escrito es el redondeo de la suma, y los empates van por orden", () => {
    expect(eurosQueCuadran([49382.712, 12345.678])).toEqual([49383, 12345]);
    expect(eurosQueCuadran([37037.034, 24691.356])).toEqual([37037, 24691]);
    /* Tres tercios de 100: 33,33… cada uno suman 100; dos se quedan en 33 y el euro va al primero. */
    expect(eurosQueCuadran([100 / 3, 100 / 3, 100 / 3])).toEqual([34, 33, 33]);
    /* Importes ya enteros, y una lista vacía. */
    expect(eurosQueCuadran([40000, 10000])).toEqual([40000, 10000]);
    expect(eurosQueCuadran([])).toEqual([]);
  });

  test("sin capital, o con un capital que no vale: porcentajes y ningún euro", () => {
    for (const capital of [null, undefined, 0, -5, Number.NaN]) {
      const plan = planDeEjecucion(filas, capital);
      expect(plan.capital).toBeNull();
      expect(plan.totalImporte).toBeNull();
      expect(plan.textoTotalImporte).toBeNull();
      expect(plan.pasos.every((p) => p.importe === null && p.textoImporte === null)).toBe(true);
      expect(plan.textoTotalPuntos).toBe("50,00\u00a0%");
    }
  });

  test("subir y bajar lo que ya está: «Aumentar» y «Reducir»", () => {
    const plan = planDeEjecucion(filasDeCambios(
      { name: "A", positions: [{ asset_id: "X", weight_percent: 70 }, { asset_id: "Y", weight_percent: 30 }] },
      { name: "B", positions: [{ asset_id: "X", weight_percent: 60 }, { asset_id: "Y", weight_percent: 40 }] },
      []
    ), null);
    expect(plan.pasos.map((p) => [p.operacion, p.id])).toEqual([["Reducir", "X"], ["Aumentar", "Y"]]);
  });

  test("un cambio de menos de una centésima de punto no es una operación, y se dice cuántos hay", () => {
    const plan = planDeEjecucion(filasDeCambios(
      { name: "A", positions: [{ asset_id: "X", weight_percent: 50 }, { asset_id: "Y", weight_percent: 50 }] },
      { name: "B", positions: [{ asset_id: "X", weight_percent: 50.002 }, { asset_id: "Y", weight_percent: 49.998 }] },
      []
    ), 100000);
    expect(plan.pasos).toEqual([]);
    expect(plan.menoresSinListar).toBe(2);
  });
});

describe("rentabilidad, volatilidad y caída, en la misma ventana", () => {
  /* De la serie de la prueba, sin pasar por el código: 157 semanas son 1.092 días. */
  const anos = 1092 / 365.2425;
  const cagrActual = (133.1 / 100) ** (1 / anos) - 1;
  const cagrPropuesta = (128 / 100) ** (1 / anos) - 1;

  test("las dos con las mismas fechas, y sale lo calculado a mano", () => {
    const { cifras } = propuestaDeCambio(entrada());
    expect(cifras.periodo).toBe("3 años");
    expect(cifras.ventana).toBe("Del 02/01/2023 al 29/12/2025 (157 fechas comunes), en euros");
    const [rentabilidad, , caida] = cifras.filas;
    expect(rentabilidad.rotulo).toBe("Rentabilidad anualizada");
    expect(rentabilidad.actual).toBe(`+${(cagrActual * 100).toFixed(2).replace(".", ",")}\u00a0%`);
    expect(rentabilidad.propuesta).toBe(`+${(cagrPropuesta * 100).toFixed(2).replace(".", ",")}\u00a0%`);
    /* Caídas: 110 → 99 son −10 %; 120 → 96 son −20 %. */
    expect(caida.actual).toBe("−10,00\u00a0%");
    expect(caida.propuesta).toBe("−20,00\u00a0%");
    expect(caida.diferencia).toBe("−10,00\u00a0pp");
  });

  test("la volatilidad, con la desviación muestral de las variaciones semanales, anualizada por 52", () => {
    const desviacion = (serie: typeof SERIE_ACTUAL) => {
      const r = serie.slice(1).map((p, i) => p.value / serie[i].value - 1);
      const media = r.reduce((s, x) => s + x, 0) / r.length;
      return Math.sqrt((r.reduce((s, x) => s + (x - media) ** 2, 0) / (r.length - 1)) * 52);
    };
    const { cifras } = propuestaDeCambio(entrada());
    expect(cifras.filas[1].actual).toBe(`${(desviacion(SERIE_ACTUAL) * 100).toFixed(2).replace(".", ",")}\u00a0%`);
    expect(cifras.filas[1].propuesta).toBe(`${(desviacion(SERIE_PROPUESTA) * 100).toFixed(2).replace(".", ",")}\u00a0%`);
  });

  test("dice de qué son netas: con fondos, del coste corriente, y este no se resta otra vez; sin fondos, no se habla de ellos", () => {
    expect(propuestaDeCambio(entrada()).netasDe).toContain("netas del coste corriente de los fondos");
    const soloAcciones = { name: "S", positions: [{ asset_id: "ES0144580Y14", weight_percent: 100 }] };
    const conAcciones = { name: "T", positions: [{ asset_id: "ES0144580Y14", weight_percent: 50 }, { asset_id: "ES0000000009", weight_percent: 50 }] };
    const modelo = propuestaDeCambio(entrada({
      actual: soloAcciones,
      propuesta: conAcciones,
      assets: [...ACTIVOS, activo("ES0000000009", "Otra acción", null, "STOCK")],
      historiaActual: historia(["ES0144580Y14"], SERIE_ACTUAL),
      historiaPropuesta: historia(["ES0144580Y14", "ES0000000009"], SERIE_PROPUESTA)
    }));
    expect(modelo.netasDe).not.toContain("fondos");
  });

  test("con el 100 % medido no se habla de cobertura", () => {
    const { cifras } = propuestaDeCambio(entrada());
    expect(cifras.notas.join(" ")).not.toMatch(/Mide|mide el/);
  });

  test("si baja del 100 %, cada lado dice lo suyo", () => {
    const { cifras } = propuestaDeCambio(entrada({
      historiaPropuesta: historia(["LU0000000001", "LU0000000003"], SERIE_PROPUESTA, { excluded_assets: [{ asset_id: "ES0144580Y14", reason: "INSUFFICIENT_HISTORY" }] as never })
    }));
    expect(cifras.notas).toEqual([
      "Propuesta: mide el 80,0\u00a0% de la cartera (2 de 3 posiciones); queda fuera Iberdrola (20,0\u00a0%) por no tener historia suficiente en este periodo."
    ]);
    expect(cifras.filas[0].propuesta).not.toBe("Falta el dato");
  });

  test("por debajo del 80 % no hay cifra de esa cartera, ni diferencia: decisión 36", () => {
    const { cifras } = propuestaDeCambio(entrada({
      historiaActual: historia(["LU0000000001"], SERIE_ACTUAL, { excluded_assets: [{ asset_id: "LU0000000002", reason: "QUALITY_BLOCKED" }] as never })
    }));
    for (const fila of cifras.filas) {
      expect(fila.actual).toBe("Falta el dato");
      expect(fila.diferencia).toBe("Falta el dato");
      expect(fila.propuesta).not.toBe("Falta el dato");
    }
    expect(cifras.notas).toContain("Actual: la simulación mide el 60,0\u00a0% del peso, y para dar una cifra de la cartera hace falta al menos el 80\u00a0%.");
    expect(cifras.notas.join(" ")).toContain("Fondo B (40,0\u00a0%) por una incidencia en su serie de precios");
  });

  test("con más de tres fuera, la frase las cuenta y las detalla el documento, sin hablar de ningún anexo", () => {
    const pesos = ["A", "B", "C", "D", "E"].map((id) => ({ asset_id: id, weight_percent: 10 }));
    const propuesta = { name: "Muchas", positions: [...pesos, { asset_id: "LU0000000001", weight_percent: 50 }] };
    const modelo = propuestaDeCambio(entrada({
      propuesta,
      historiaPropuesta: historia(["LU0000000001"], SERIE_PROPUESTA, {
        excluded_assets: pesos.map((p) => ({ asset_id: p.asset_id, reason: "PRICE_SERIES_MISSING" })) as never
      })
    }));
    const nota = modelo.cifras.notas.join(" ");
    expect(nota).toContain("quedan fuera 5 posiciones (50,0\u00a0% del peso), detalladas debajo");
    expect(nota).not.toContain("anexo");
    expect(modelo.fueraDetallado.map((f) => f.nombre)).toEqual(["A", "B", "C", "D", "E"]);
    expect(modelo.fueraDetallado[0]).toMatchObject({ rotulo: "Propuesta", peso: "10,0\u00a0%", motivo: "no tener serie de precios" });
  });

  test("una simulación que mide otras posiciones no es de esta composición: sin cifra, y dicho", () => {
    const { cifras } = propuestaDeCambio(entrada({ historiaActual: historia(["OTRO"], SERIE_ACTUAL) }));
    expect(cifras.filas[0].actual).toBe("Falta el dato");
    expect(cifras.notas).toContain("Actual: la simulación no corresponde a las posiciones de esta composición, y no se da ninguna cifra.");
  });

  test("sin simulación de un lado, el otro da sus cifras sobre su propio periodo, y el resto del documento sale (CMP-2)", () => {
    /* Hasta el 17-11-2026 no se daba ninguna cifra, mientras Comparar carteras enseñaba las de la que sí tenía serie. */
    const modelo = propuestaDeCambio(entrada({ historiaPropuesta: null }));
    expect(modelo.cifras.ventana).toBe("Del 02/01/2023 al 29/12/2025 (157 fechas), en euros");
    expect(modelo.cifras.filas.every((f) => f.actual !== "Falta el dato" && f.propuesta === "Falta el dato" && f.diferencia === "Falta el dato")).toBe(true);
    expect(modelo.cifras.notas.join(" ")).toContain("Propuesta: ninguna de sus posiciones tiene serie suficiente");
    expect(modelo.cifras.notas).toContain("Solo se dan las cifras de la cartera actual, medidas sobre su propio periodo: sin la otra no hay fechas comunes.");
    /* Sin ninguna de las dos, ninguna cifra. */
    const sinNinguna = propuestaDeCambio(entrada({ historiaActual: null, historiaPropuesta: null }));
    expect(sinNinguna.cifras.ventana).toBeNull();
    expect(sinNinguna.cifras.filas.every((f) => f.actual === "Falta el dato" && f.propuesta === "Falta el dato" && f.diferencia === "Falta el dato")).toBe(true);
    expect(sinNinguna.cifras.notas).toContain("Sin ninguna de las dos simulaciones no hay cifras que dar.");
    expect(modelo.plan.textoTotalPuntos).toBe("50,00\u00a0%");
    expect(modelo.costes.filas[0].actual).toBe("0,80\u00a0% al año");
  });

  test("si no llegan a cubrir el periodo pedido, se dice", () => {
    const cortas = semanas(Array.from({ length: 60 }, (_, i) => 100 + i));
    const modelo = propuestaDeCambio(entrada({ historiaActual: historia(IDS_ACTUAL, cortas), historiaPropuesta: historia(IDS_PROPUESTA, cortas) }));
    expect(modelo.cifras.periodo).toBe("periodo disponible");
    expect(modelo.cifras.notas.join(" ")).toContain("Se han pedido 3 años");
  });

  test("lo estimado se dice, con el nombre y las fechas como las lee el cliente", () => {
    const modelo = propuestaDeCambio(entrada({
      historiaPropuesta: historia(IDS_PROPUESTA, SERIE_PROPUESTA, {}, ["LU0000000003: tramo estimado con MSCI World, del 2023-01-02 al 2024-06-30."])
    }));
    expect(modelo.cifras.notas).toContain("Propuesta: Fondo C: tramo estimado con MSCI World, del 02/01/2023 al 30/06/2024.");
    /* Y la cabecera de la tabla lo dice, como en la Comparativa de carteras. Sin tramo, no. */
    expect(modelo.cifras.conTramoEstimado).toBe(true);
    expect(propuestaDeCambio(entrada()).cifras.conTramoEstimado).toBe(false);
  });

  test("el signo: un cero redondeado no lleva ninguno", () => {
    expect(puntosConSigno(1.5)).toBe("+1,50\u00a0pp");
    expect(puntosConSigno(-1.5)).toBe("−1,50\u00a0pp");
    expect(puntosConSigno(0.001)).toBe("0,00\u00a0pp");
    expect(puntosConSigno(-0.001)).toBe("0,00\u00a0pp");
  });
});

describe("crisis pasadas de las dos", () => {
  const posicion = (nombre: string, pesoPct: number) => () => ({ nombre, pesoPct });

  test("cada una con su cifra, sus fechas y lo que mide, y no se restan", () => {
    const crisis = crisisDeLasDos(
      [crisisConCifra("COVID", -20.57, 79, 6, 8), crisisConCifra("RATES_2022", -14.87), escenario("COMMON_HISTORY")],
      [crisisConCifra("COVID", -24.1), crisisConCifra("RATES_2022", -11.2), escenario("COMMON_HISTORY")],
      posicion("X", 10),
      posicion("Y", 10)
    );
    expect(crisis.sinNinguna).toBeNull();
    expect(crisis.filas.map((f) => f.nombre)).toEqual(["COVID-19", "Tipos 2022"]);
    expect(crisis.filas[0].actual.cifra).toBe("−20,57\u00a0%");
    expect(crisis.filas[0].actual.lineas).toEqual(["Del 19/02/2020 al 23/03/2020", "Mide el 79,0\u00a0% de la cartera (6 de 8 posiciones)"]);
    expect(crisis.filas[0].propuesta.cifra).toBe("−24,10\u00a0%");
    expect(Object.keys(crisis.filas[0])).not.toContain("diferencia");
  });

  test("«Historia común» no es una crisis y no sale", () => {
    const crisis = crisisDeLasDos([crisisConCifra("COVID", -5), escenario("COMMON_HISTORY", { drawdown_pct: -30 })], null, posicion("X", 10), posicion("Y", 10));
    expect(crisis.filas.map((f) => f.id)).toEqual(["COVID"]);
  });

  test("si solo una tiene datos, la otra dice que no los tiene: nunca un cero", () => {
    const crisis = crisisDeLasDos(
      [crisisConCifra("COVID", -5), escenario("RATES_2022"), escenario("COMMON_HISTORY")],
      [escenario("COVID"), escenario("RATES_2022"), escenario("COMMON_HISTORY")],
      posicion("X", 10),
      posicion("Y", 10)
    );
    expect(crisis.filas[0].propuesta.cifra).toBeNull();
    expect(crisis.filas[0].propuesta.lineas[0]).toBe("Sin datos");
    expect(crisis.filas[1].actual.cifra).toBeNull();
    expect(crisis.filas[1].actual.lineas[1]).toContain("Ninguna posición tenía precios");
  });

  test("sin datos en ninguna, una frase y ninguna fila", () => {
    const crisis = crisisDeLasDos(
      [escenario("COVID"), escenario("RATES_2022"), escenario("COMMON_HISTORY")],
      undefined,
      posicion("X", 10),
      posicion("Y", 10)
    );
    expect(crisis.filas).toEqual([]);
    expect(crisis.sinNinguna).toContain("Ni Actual ni Propuesta");
  });

  test("decisión 103: por debajo del 60 % no hay cifra, y la celda dice lo que mide y quién queda fuera", () => {
    const crisis = crisisDeLasDos([crisisConCifra("COVID", -5, 25, 1, 4, [{ asset_id: "B", reason: "NO_DATA_AT_WINDOW_START" }])], null, posicion("Fondo B", 75), posicion("Y", 10));
    expect(crisis.filas[0].actual).toEqual({ cifra: null, lineas: ["Falta el dato", "Mide el 25,0\u00a0% de la cartera, y hace falta al menos el 60\u00a0%.", "Fuera: Fondo B (75,0\u00a0%)"] });
    /* Con el 60 %, la cifra sigue. */
    expect(crisisDeLasDos([crisisConCifra("COVID", -5, 60, 1, 4)], null, posicion("X", 10), posicion("Y", 10)).filas[0].actual.cifra).toBe("−5,00\u00a0%");
  });
});

describe("coste corriente antes y después", () => {
  test("sin capital: la frase del informe de costes y la diferencia en puntos", () => {
    const { filas, hayAcciones } = costesDeLasDos(ACTUAL, PROPUESTA, ACTIVOS, null);
    expect(filas).toEqual([{
      rotulo: "Coste corriente anual de los productos",
      actual: conEuros("0,80\u00a0% al año, unos 80 € por cada 10.000 €"),
      propuesta: conEuros("0,56\u00a0% al año, unos 56 € por cada 10.000 €"),
      diferencia: "−0,24\u00a0pp"
    }]);
    expect(hayAcciones).toBe(true);
  });

  test("con capital: el porcentaje y los euros sobre ese capital", () => {
    const { filas } = costesDeLasDos(ACTUAL, PROPUESTA, ACTIVOS, 100000);
    expect(filas).toEqual([
      { rotulo: "Coste corriente anual de los productos", actual: "0,80\u00a0% al año", propuesta: "0,56\u00a0% al año", diferencia: "−0,24\u00a0pp" },
      { rotulo: conEuros("En euros al año, sobre 100.000,00 €"), actual: conEuros("800,00 €"), propuesta: conEuros("560,00 €"), diferencia: conEuros("−240,00 €") }
    ]);
  });

  test("si falta el coste de un fondo no hay media ni diferencia: se dice cuánto falta, y un dato ausente no es un cero", () => {
    const sinCoste = [activo("A", "A", 0.01), activo("B", "B", null)];
    const { filas } = costesDeLasDos(
      { name: "A", positions: [{ asset_id: "A", weight_percent: 100 }] },
      { name: "B", positions: [{ asset_id: "A", weight_percent: 50 }, { asset_id: "B", weight_percent: 50 }] },
      sinCoste,
      100000
    );
    expect(filas[0]).toMatchObject({ actual: "1,00\u00a0% al año", propuesta: "No disponible: falta el coste de 1 de las 2 posiciones", diferencia: "Falta el dato" });
    expect(filas[1]).toMatchObject({ actual: conEuros("1.000,00 €"), propuesta: "Falta el dato", diferencia: "Falta el dato" });
  });

  describe("solo acciones (decisión A-65): «No aplica», ni un 0,00 % ni unos 0,00 €", () => {
    const FONDO = { name: "A", positions: [{ asset_id: "X", weight_percent: 100 }] };
    const ACCION = { name: "B", positions: [{ asset_id: "ES0144580Y14", weight_percent: 100 }] };
    const OTRA = { name: "C", positions: [{ asset_id: "US0378331005", weight_percent: 100 }] };
    const ACTIVOS_DE_LA_PRUEBA = [activo("X", "Fondo", 0.01), activo("ES0144580Y14", "Iberdrola", null, "STOCK"), activo("US0378331005", "Apple", null, "STOCK")];

    test("sin capital: dice «No aplica», y la diferencia con un fondo se mide con la acción a cero", () => {
      const { filas } = costesDeLasDos(FONDO, ACCION, ACTIVOS_DE_LA_PRUEBA, null);
      expect(filas[0].propuesta).toBe("No aplica");
      expect(filas[0].diferencia).toBe("−1,00\u00a0pp");
    });

    test("con capital: lo mismo en la fila de euros", () => {
      const { filas } = costesDeLasDos(FONDO, ACCION, ACTIVOS_DE_LA_PRUEBA, 100000);
      expect(filas[0]).toMatchObject({ actual: "1,00\u00a0% al año", propuesta: "No aplica", diferencia: "−1,00\u00a0pp" });
      expect(filas[1]).toMatchObject({ actual: conEuros("1.000,00 €"), propuesta: "No aplica", diferencia: conEuros("−1.000,00 €") });
    });

    test("las dos solo de acciones: no hay nada que restar", () => {
      const { filas, sinMediaEnNinguna } = costesDeLasDos(ACCION, OTRA, ACTIVOS_DE_LA_PRUEBA, 100000);
      expect(sinMediaEnNinguna).toBe(true);
      expect(costesDeLasDos(FONDO, ACCION, ACTIVOS_DE_LA_PRUEBA, 100000).sinMediaEnNinguna).toBe(false);
      expect(filas[0]).toMatchObject({ actual: "No aplica", propuesta: "No aplica", diferencia: "No aplica" });
      expect(filas[1]).toMatchObject({ actual: "No aplica", propuesta: "No aplica", diferencia: "No aplica" });
    });
  });
});

describe("lo que impide descargar", () => {
  const motivo = "Un motivo";

  test("falta lo que falta, en orden", () => {
    expect(faltaParaLaPropuesta({ actual: null, propuesta: null, motivo })).toBe("Falta elegir Actual y Propuesta.");
    expect(faltaParaLaPropuesta({ actual: ACTUAL, propuesta: null, motivo })).toBe("Falta elegir la composición Propuesta.");
    expect(faltaParaLaPropuesta({ actual: null, propuesta: PROPUESTA, motivo })).toBe("Falta elegir la composición Actual.");
    expect(faltaParaLaPropuesta({ actual: ACTUAL, propuesta: PROPUESTA, motivo: "" })).toBe("Falta escribir el motivo de la propuesta.");
    expect(faltaParaLaPropuesta({ actual: ACTUAL, propuesta: PROPUESTA, motivo: "   \n " })).toBe("Falta escribir el motivo de la propuesta.");
    expect(faltaParaLaPropuesta({ actual: ACTUAL, propuesta: PROPUESTA, motivo })).toBeNull();
  });

  test("la misma composición no es un cambio, aunque los pesos estén escritos de otra forma", () => {
    const igual = { name: "Otra", positions: ACTUAL.positions.map((p) => ({ ...p, weight_percent: p.weight_percent * 2 })) };
    expect(mismaComposicion(ACTUAL, igual)).toBe(true);
    expect(faltaParaLaPropuesta({ actual: ACTUAL, propuesta: igual, motivo })).toContain("misma composición");
    expect(mismaComposicion(ACTUAL, PROPUESTA)).toBe(false);
  });

  test("una cartera sin peso, o con un peso negativo, no se puede comparar", () => {
    const vacia = { name: "Vacía", positions: [{ asset_id: "X", weight_percent: 0 }] };
    expect(faltaParaLaPropuesta({ actual: vacia, propuesta: PROPUESTA, motivo })).toBe("Actual no tiene posiciones con peso.");
    expect(faltaParaLaPropuesta({ actual: ACTUAL, propuesta: vacia, motivo })).toBe("Propuesta no tiene posiciones con peso.");
    const negativa = { name: "Mal", positions: [{ asset_id: "X", weight_percent: 50 }, { asset_id: "Y", weight_percent: -1 }] };
    expect(faltaParaLaPropuesta({ actual: ACTUAL, propuesta: negativa, motivo })).toContain("Revisa los pesos");
  });

  test("sin motivo no hay documento: el motivo no se inventa", () => {
    expect(() => propuestaDeCambio(entrada({ motivo: "  " }))).toThrow("Falta escribir el motivo");
  });
});

describe("el documento", () => {
  test("el motivo y las notas, tal cual; el cliente solo si se ha escrito; la fecha, la de quien lo genera", () => {
    const modelo = propuestaDeCambio(entrada({ motivo: "  Primera línea.\n\nTercera línea.  ", notasDelPlan: " Por tramos. ", generadoEn: "2026-11-04T23:30:00Z" }));
    expect(modelo.motivo).toBe("Primera línea.\n\nTercera línea.");
    expect(modelo.notasDelPlan).toBe("Por tramos.");
    expect(modelo.cliente).toBe("Ana Ruiz");
    expect(propuestaDeCambio(entrada({ cliente: "  " })).cliente).toBe("");
    expect(modelo.fecha).toBe(diaLocal("2026-11-04T23:30:00Z")?.split("-").reverse().join("/"));
  });

  test("el capital se dice una vez: cuál, o que todo va en porcentajes", () => {
    expect(propuestaDeCambio(entrada()).fraseDelCapital).toBe(conEuros("Capital de la composición Actual: 100.000,00 €."));
    expect(propuestaDeCambio(entrada({ capital: null })).fraseDelCapital).toBe("No se ha fijado un capital: este documento va en porcentajes.");
  });

  test("sin nombre de cartera no se inventa ninguno", () => {
    const modelo = propuestaDeCambio(entrada({ actual: { ...ACTUAL, name: "  " } }));
    expect(modelo.nombreActual).toBe("Cartera sin nombre");
  });

  test("el resumen de los cambios y los totales salen de las filas", () => {
    const modelo = propuestaDeCambio(entrada());
    expect(modelo.resumenDeCambios).toBe("Cambia de posición el 50,00\u00a0% de la cartera: se mantiene 1 posición, sale 1 y entran 2.");
    expect(modelo.totalActual).toBe("100,0\u00a0%");
    expect(modelo.totalPropuesta).toBe("100,0\u00a0%");
    expect(modelo.posicionesActual).toBe(2);
    expect(modelo.posicionesPropuesta).toBe(3);
  });

  test("pesos que no suman 100: se dice", () => {
    const modelo = propuestaDeCambio(entrada({ propuesta: { name: "B", positions: PROPUESTA.positions.map((p) => ({ ...p, weight_percent: p.weight_percent * 1.1 })) } }));
    expect(modelo.notasDePeso).toEqual(["Los pesos de Propuesta sumaban 110,0\u00a0% y se han llevado al 100 % para este documento."]);
    expect(modelo.totalPropuesta).toBe("100,0\u00a0%");
  });
});

describe("repartir en hojas", () => {
  test("cabe lo que cabe, la primera hoja con su hueco y las demás con el suyo", () => {
    const hojas = repartirEnHojas([10, 10, 10, 10, 10], (alto) => alto, 25, 30);
    expect(hojas).toEqual([[10, 10], [10, 10, 10]]);
  });

  test("sin filas, una hoja vacía; si la primera no cabe en su hoja, la tabla empieza en la siguiente", () => {
    expect(repartirEnHojas([], () => 1, 10, 10)).toEqual([[]]);
    expect(repartirEnHojas([50], (alto) => alto, 10, 100)).toEqual([[], [50]]);
  });
});
