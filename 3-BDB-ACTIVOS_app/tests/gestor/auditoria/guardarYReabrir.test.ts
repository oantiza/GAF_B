/**
 * Auditoría · guardar y volver a abrir una cartera no cambia ninguna cifra.
 *
 * Con la cartera de demostración y con otra de decimales difíciles («0.1», «1234.560»,
 * «0.000001», negativos, títulos con seis decimales, un bono, dos divisas, un precio a mano y
 * un campo de `extensiones`):
 *   (a) escribir → leer → escribir da exactamente el mismo texto;
 *   (b) el `Analisis` completo es idéntico antes y después de guardar y leer;
 *   (c) el orden de los movimientos en el fichero no cambia el resultado;
 *   (d) un campo desconocido se conserva al reescribir.
 */
import Big from "big.js";
import { describe, expect, it } from "vitest";
import { leer, serializar } from "../../../src/gestor/almacen/formato";
import { demostracion } from "../../../src/gestor/demo/carteraDemo";
import { analizar, periodosHabituales, preparar, type Analisis } from "../../../src/gestor/motor/analisis";
import type { Cartera, Movimiento } from "../../../src/gestor/motor/modelo";
import type { DatosDeMercado } from "../../../src/gestor/motor/valoracion";
import { activo, cartera, mov } from "../ayudas";
import { mercado } from "./ayudasAuditoria";

const GUARDADO = "2026-11-13T12:00:00.000Z";
const HOY = "2026-11-13";

/**
 * Un `Analisis` en datos planos para compararlo en profundidad: los decimales como su texto, los
 * `Map` como listas de pares, los arrays tipados como arrays y las funciones fuera (no son datos).
 */
function plano(valor: unknown): unknown {
  if (valor instanceof Big) return { decimal: valor.toFixed() };
  if (valor instanceof Map) return { mapa: [...valor.entries()].map(([clave, v]) => [plano(clave), plano(v)]) };
  if (valor instanceof Set) return { conjunto: [...valor].map(plano) };
  if (ArrayBuffer.isView(valor)) return Array.from(valor as unknown as ArrayLike<number>);
  if (Array.isArray(valor)) return valor.map(plano);
  if (typeof valor === "function") return undefined;
  if (typeof valor === "object" && valor !== null) {
    const salida: Record<string, unknown> = {};
    for (const clave of Object.keys(valor).sort()) {
      const v = plano((valor as Record<string, unknown>)[clave]);
      if (v !== undefined) salida[clave] = v;
    }
    return salida;
  }
  return valor;
}

/** Guarda y vuelve a leer. */
function guardarYLeer(c: Cartera): Cartera {
  return leer(serializar(c, GUARDADO)).cartera;
}

/** Baraja con semilla fija (mulberry32 + Fisher–Yates), para que la prueba sea siempre la misma. */
function barajar<T>(lista: readonly T[], semilla: number): T[] {
  let a = semilla >>> 0;
  const azar = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const copia = [...lista];
  for (let i = copia.length - 1; i > 0; i -= 1) {
    const j = Math.floor(azar() * (i + 1));
    [copia[i], copia[j]] = [copia[j], copia[i]];
  }
  return copia;
}

/* ------------------------------------------------------------- la cartera de decimales difíciles */

const BONO = { cupon: "0.0275", frecuencia: 2 as const, vencimiento: "2031-03-15", base: "ACT/ACT" as const, amortizacion: "100.000" };

function carteraDificil(): Cartera {
  /* Ningún día tiene dos movimientos del mismo tipo: el orden dentro del día lo decide solo el tipo. */
  const movimientos: Movimiento[] = [
    mov("aportacion", "2025-01-02", { id: "d-01", importe: "50000.000", nota: "Alta «con comillas» y ñ" }),
    mov("suscripcion", "2025-01-02", { id: "d-02", activoId: "ES0000000AAA", titulos: "12.345678", precio: "101.234567", importe: "-1249.80", fechaValor: "2025-01-06" }),
    mov("cambioDeDivisa", "2025-01-03", { id: "d-03", divisa: "EUR", importe: "-0.1", destino: { divisa: "USD", importe: "0.108500" } }),
    mov("compra", "2025-01-03", { id: "d-04", activoId: "USX", titulos: "10.000001", precio: "1234.560", cambio: "1.0850", comision: "0.1", importe: "-11378.4361" }),
    mov("compra", "2025-01-07", { id: "d-05", activoId: "BONX", titulos: "5000", precio: "99.875", cuponCorrido: "42.31", comision: "0.000001", importe: "-5036.060001" }),
    mov("comision", "2025-01-15", { id: "d-06", importe: "-0.1", nota: "Custodia" }),
    mov("interes", "2025-01-31", { id: "d-07", importe: "-0.000001" }),
    mov("cambioDeDivisa", "2025-02-03", { id: "d-08", divisa: "EUR", importe: "-1234.560", destino: { divisa: "USD", importe: "1339.49760" } }),
    mov("dividendo", "2025-02-14", { id: "d-09", activoId: "USX", divisa: "USD", importe: "1.234560", retencion: "0.000001" }),
    mov("reembolso", "2025-03-03", { id: "d-10", activoId: "ES0000000AAA", titulos: "2.000001", precio: "102.5", importe: "205.00", retencion: "0.1" }),
    mov("retencion", "2025-03-04", { id: "d-11", importe: "-0.000001" }),
    mov("retirada", "2025-03-10", { id: "d-12", importe: "-0.1" })
  ];
  return cartera(
    [
      activo("ES0000000AAA", "FONDO", "EUR", { isin: "ES0000000AAA", clasificacion: { gastosCorrientes: "0.0125" } }),
      activo("USX", "ACCION", "USD", { ticker: "USX" }),
      activo("BONX", "BONO", "EUR", { multiplicador: "0.01", bono: BONO })
    ],
    movimientos,
    {
      cliente: { id: "cli-1", nombre: "Cliente de prueba" },
      preciosManuales: [
        { activoId: "BONX", fecha: "2025-02-28", precio: "100.125" },
        { activoId: "USX", fecha: "2025-03-07", precio: "1250.000001" }
      ],
      extractos: [{ id: "x-1", fecha: "2025-03-10", posiciones: [{ activoId: "USX", nombre: "USX", titulos: "10.000001" }], efectivo: [{ divisa: "EUR", saldo: "-0.1" }] }],
      extensiones: { asignacionObjetivo: { rentaVariable: "0.6", rentaFija: "0.4" }, bandas: [0.1, -0.05, 1e-7], mandato: null }
    }
  );
}

const MERCADO_DIFICIL: DatosDeMercado = mercado(
  { "ES0000000AAA": [["2025-01-02", 101.234567], ["2025-02-03", 101.9], ["2025-03-03", 102.5], ["2025-03-10", 103.000001]], USX: [["2025-01-03", 1234.56], ["2025-02-14", 1240.1]] },
  { USD: [["2025-01-03", 1.085], ["2025-02-03", 1.085], ["2025-03-01", 1.0791]] }
);
const HASTA_DIFICIL = "2025-03-10";
const analisisDificil = (c: Cartera): Analisis => analizar(preparar(c, MERCADO_DIFICIL, new Map(), HASTA_DIFICIL), { desde: "1900-01-01", hasta: HASTA_DIFICIL });

/* ------------------------------------------------------------- la demostración */

const demo = demostracion(HOY);
const analisisDemo = (c: Cartera): Analisis => {
  const preparado = preparar(c, demo.mercado, demo.fichas, HOY);
  const periodo = periodosHabituales(preparado.valoracion, HOY).find((p) => p.id === "inicio")!.periodo;
  return analizar(preparado, periodo, demo.referencia);
};

describe("(a) escribir → leer → escribir da el mismo texto", () => {
  it("con la cartera de demostración", () => {
    const texto = serializar(demo.cartera, GUARDADO);
    expect(serializar(guardarYLeer(demo.cartera), GUARDADO)).toBe(texto);
  });

  it("con la cartera de decimales difíciles, que conserva cada cifra tal como se escribió", () => {
    const texto = serializar(carteraDificil(), GUARDADO);
    expect(serializar(guardarYLeer(carteraDificil()), GUARDADO)).toBe(texto);
    /* Los ceros de la derecha y los seis decimales no se tocan: un fichero no reescribe lo que el usuario tecleó. */
    for (const cifra of ['"50000.000"', '"1234.560"', '"0.000001"', '"-0.000001"', '"12.345678"', '"10.000001"', '"100.000"', '"1339.49760"']) {
      expect(texto).toContain(cifra);
    }
  });

  it("un fichero con las claves en otro orden se reescribe en el orden canónico", () => {
    const texto = serializar(carteraDificil(), GUARDADO);
    const alReves = (valor: unknown): unknown =>
      Array.isArray(valor) ? valor.map(alReves)
        : typeof valor === "object" && valor !== null ? Object.fromEntries(Object.entries(valor).reverse().map(([k, v]) => [k, alReves(v)]))
          : valor;
    const desordenado = JSON.stringify(alReves(JSON.parse(texto)));
    expect(serializar(leer(desordenado).cartera, GUARDADO)).toBe(texto);
  });
});

describe("(b) el análisis completo es idéntico antes y después de guardar y leer", () => {
  it("con la cartera de demostración", () => {
    expect(plano(analisisDemo(guardarYLeer(demo.cartera)))).toEqual(plano(analisisDemo(demo.cartera)));
  });

  it("con la cartera de decimales difíciles", () => {
    const antes = analisisDificil(carteraDificil());
    expect(plano(analisisDificil(guardarYLeer(carteraDificil())))).toEqual(plano(antes));
    /* Que la comparación compara algo: hay posiciones, un bono y efectivo en dos divisas. */
    expect(antes.posiciones.map((p) => p.activo.id).sort()).toEqual(["BONX", "ES0000000AAA", "USX"]);
    expect(antes.efectivo.porDivisa.map((linea) => linea.divisa).sort()).toEqual(["EUR", "USD"]);
    expect(antes.bonos).toHaveLength(1);
  });

  it("los saldos exactos también: el euro de la cartera difícil, a mano", () => {
    /*
     * EUR: 50.000 − 1.249,80 = 48.750,20;  − 0,1 = 48.750,10;  − 11.378,4361 = 37.371,6639;  − 5.036,060001 = 32.335,603899;
     *      − 0,1 = 32.335,503899;  − 0,000001 = 32.335,503898;  − 1.234,56 = 31.100,943898;  + 205 = 31.305,943898;
     *      − 0,000001 = 31.305,943897;  − 0,1 = 31.305,843897
     * USD: 0,1085 + 1.339,4976 + 1,23456 = 1.340,84066
     */
    const leida = analisisDificil(guardarYLeer(carteraDificil()));
    const saldo = (divisa: string) => leida.efectivo.porDivisa.find((linea) => linea.divisa === divisa)!.saldo.toFixed();
    expect(saldo("EUR")).toBe("31305.843897");
    expect(saldo("USD")).toBe("1340.84066");
  });
});

/** Las cifras de un análisis, redondeadas muy por debajo del céntimo: para comparar carteras cuyo orden de sumas cambia. */
function cifras(a: Analisis): unknown {
  const r = (x: number | null | undefined) => (x === null || x === undefined ? x : Math.round(x * 1e8) / 1e8);
  return {
    patrimonio: r(a.patrimonio),
    rentabilidad: a.rentabilidad && { twr: r(a.rentabilidad.twr), tir: r(a.rentabilidad.tir), resultado: r(a.rentabilidad.resultado), aportaciones: r(a.rentabilidad.aportacionesNetas) },
    desglose: a.desglose && { ...a.desglose.cuadrado, precio: r(a.desglose.precio), divisa: r(a.desglose.divisa) },
    posiciones: a.posiciones.map((p) => [p.activo.id, p.titulos.toFixed(), r(p.valor), r(p.coste), r(p.latente), r(p.contribucion)]).sort(),
    efectivo: a.efectivo.porDivisa.map((linea) => [linea.divisa, linea.saldo.toFixed(), r(linea.valor)]).sort(),
    realizado: r(a.realizado),
    latente: r(a.latente),
    costes: [r(a.ingresosYCostes.costesDeOperacion), r(a.ingresosYCostes.costesDelServicio), r(a.ingresosYCostes.impuestos), r(a.ingresosYCostes.ingresosNetos)],
    volatilidad: r(a.riesgo?.volatilidad),
    caida: r(a.riesgo?.maximaCaida.caida),
    serie: a.serie.map((p) => [p.fecha, r(p.valor)])
  };
}

describe("(c) el orden de los movimientos en el fichero no cambia el resultado", () => {
  it("la cartera difícil, barajada de tres maneras, da el mismo análisis completo", () => {
    const original = carteraDificil();
    const esperado = plano(analisisDificil(original));
    for (const semilla of [1, 7, 2026]) {
      const barajada = { ...original, movimientos: barajar(original.movimientos, semilla) };
      expect(barajada.movimientos.map((m) => m.id)).not.toEqual(original.movimientos.map((m) => m.id));
      /* Lo único que cambia es el orden de `cartera.movimientos` dentro del libro: se compara todo lo demás. */
      expect(plano(analisisDificil(guardarYLeer(barajada)))).toEqual(esperado);
    }
  });

  it("la demostración, barajada, da las mismas cifras", () => {
    const esperado = cifras(analisisDemo(demo.cartera));
    for (const semilla of [3, 11]) {
      const barajada = { ...demo.cartera, movimientos: barajar(demo.cartera.movimientos, semilla) };
      expect(cifras(analisisDemo(barajada))).toEqual(esperado);
    }
  });
});

describe("(d) un campo desconocido se conserva al reescribir", () => {
  it("en la cartera, en un activo, en un movimiento, en su destino y en las extensiones", () => {
    const fichero = JSON.parse(serializar(carteraDificil(), GUARDADO));
    fichero.campoDelFuturo = "del fichero";
    fichero.cartera.mandato = { perfil: "moderado", bandas: [0.05, 0.1] };
    fichero.cartera.activos[0].isinAlternativo = "LU0000000000";
    fichero.cartera.movimientos[2].etiqueta = "rebalanceo";
    fichero.cartera.movimientos[2].destino.cuenta = "USD-2";
    fichero.cartera.extensiones.nuevo = { z: 1, a: "0.000001" };
    const reescrito = JSON.parse(serializar(leer(JSON.stringify(fichero)).cartera, GUARDADO));
    expect(reescrito.cartera.mandato).toEqual({ perfil: "moderado", bandas: [0.05, 0.1] });
    expect(reescrito.cartera.activos[0].isinAlternativo).toBe("LU0000000000");
    expect(reescrito.cartera.movimientos[2].etiqueta).toBe("rebalanceo");
    expect(reescrito.cartera.movimientos[2].destino.cuenta).toBe("USD-2");
    expect(reescrito.cartera.extensiones.nuevo).toEqual({ z: 1, a: "0.000001" });
    expect(reescrito.cartera.extensiones.bandas).toEqual([0.1, -0.05, 1e-7]);
    expect(reescrito.cartera.extensiones.mandato).toBeNull();
  });

  it("y el texto reescrito ya es estable: una segunda vuelta no lo cambia", () => {
    const fichero = JSON.parse(serializar(carteraDificil(), GUARDADO));
    fichero.cartera.mandato = { perfil: "moderado" };
    const primera = serializar(leer(JSON.stringify(fichero)).cartera, GUARDADO);
    expect(serializar(leer(primera).cartera, GUARDADO)).toBe(primera);
  });
});
