/**
 * El registro de tipos de movimiento. Estas pruebas valen para CUALQUIER tipo registrado:
 * quien añada uno nuevo solo tiene que añadir su ejemplo a `EJEMPLOS`.
 */
import { describe, expect, it } from "vitest";
import { CERO, type Decimal } from "../../src/gestor/motor/decimal";
import type { Efecto } from "../../src/gestor/motor/efectos";
import { contextoDe, validarMovimiento } from "../../src/gestor/motor/libro";
import type { Movimiento } from "../../src/gestor/motor/modelo";
import { TIPOS, definicionDe } from "../../src/gestor/motor/movimientos/registro";
import { activo, cartera, mov } from "./ayudas";

const CARTERA = cartera(
  [activo("ACC"), activo("ACC2"), activo("FON1", "FONDO"), activo("FON2", "FONDO"), activo("BON", "BONO", "EUR", { multiplicador: "0.01" }), activo("USA", "ACCION", "USD")],
  []
);
const CONTEXTO = contextoDe(CARTERA);

/** Un movimiento válido de cada tipo. */
const EJEMPLOS: Record<string, Movimiento> = {
  aportacion: mov("aportacion", "2024-01-02", { importe: "1000" }),
  retirada: mov("retirada", "2024-01-02", { importe: "-1000" }),
  interes: mov("interes", "2024-01-02", { importe: "3.21", retencion: "0.75" }),
  comision: mov("comision", "2024-01-02", { importe: "-15", activoId: "ACC" }),
  retencion: mov("retencion", "2024-01-02", { importe: "-8.40" }),
  cambioDeDivisa: mov("cambioDeDivisa", "2024-01-02", { importe: "-1250", destino: { divisa: "USD", importe: "1500" } }),
  otroEfectivo: mov("otroEfectivo", "2024-01-02", { importe: "-2" }),
  compra: mov("compra", "2024-01-02", { activoId: "ACC", titulos: "100", precio: "20", comision: "10", gastos: "1", importe: "-2011" }),
  venta: mov("venta", "2024-01-02", { activoId: "ACC", titulos: "100", precio: "30", comision: "12", importe: "2988" }),
  suscripcion: mov("suscripcion", "2024-01-02", { activoId: "FON1", titulos: "100", precio: "50", importe: "-5000" }),
  reembolso: mov("reembolso", "2024-01-02", { activoId: "FON1", titulos: "10", precio: "60", retencion: "19", importe: "581" }),
  traspaso: mov("traspaso", "2024-01-02", { activoId: "FON1", titulos: "40", valor: "2200", destino: { activoId: "FON2", titulos: "25", fecha: "2024-01-05" } }),
  dividendo: mov("dividendo", "2024-01-02", { activoId: "ACC", importe: "24.30", retencion: "5.70" }),
  cupon: mov("cupon", "2024-01-02", { activoId: "BON", importe: "283.50", retencion: "66.50" }),
  entradaDeTitulos: mov("entradaDeTitulos", "2024-01-02", { activoId: "ACC", titulos: "40", precio: "9" }),
  salidaDeTitulos: mov("salidaDeTitulos", "2024-01-02", { activoId: "ACC", titulos: "40" }),
  extincionDeTitulos: mov("extincionDeTitulos", "2024-01-02", { activoId: "ACC", titulos: "40" }),
  dividendoEnAcciones: mov("dividendoEnAcciones", "2024-01-02", { activoId: "ACC", titulos: "5" }),
  split: mov("split", "2024-01-02", { activoId: "ACC", razon: "2" }),
  canje: mov("canje", "2024-01-02", { activoId: "ACC", destino: { activoId: "ACC2", titulos: "7" }, importe: "3.10" }),
  amortizacion: mov("amortizacion", "2024-01-02", { activoId: "BON", titulos: "10000", importe: "10000" })
};

const sumaPorDivisa = (efectos: Efecto[], de: (efecto: Efecto) => { divisa: string; importe: Decimal } | undefined): Map<string, Decimal> => {
  const suma = new Map<string, Decimal>();
  for (const efecto of efectos) {
    const parte = de(efecto);
    if (parte) suma.set(parte.divisa, (suma.get(parte.divisa) ?? CERO).plus(parte.importe));
  }
  return suma;
};

describe("el registro de tipos de movimiento", () => {
  it("cada tipo registrado tiene su ejemplo aquí", () => {
    expect(Object.keys(EJEMPLOS).sort()).toEqual(TIPOS.map((definicion) => definicion.tipo).sort());
  });

  it.each(TIPOS.map((definicion) => [definicion.tipo, definicion] as const))("%s: su ejemplo es válido y su ficha está completa", (tipo, definicion) => {
    expect(validarMovimiento(EJEMPLOS[tipo], CONTEXTO)).toEqual([]);
    expect(definicion.nombre.length).toBeGreaterThan(2);
    expect(definicion.descripcion.length).toBeGreaterThan(20);
    expect(definicion.campos.length).toBeGreaterThan(0);
    expect(definicionDe(tipo)).toBe(definicion);
  });

  /*
   * La regla que hace que las cuentas cuadren: por cada divisa, lo que un movimiento mueve
   * en efectivo es exactamente
   *     flujos externos + lo cobrado por títulos − lo pagado por títulos + ingresos netos − costes no descontados.
   * Si un tipo la incumple, el resultado de la cartera dejaría de sumar. Las entradas y salidas
   * de títulos sin efectivo (externas) quedan fuera: no pasan por la cuenta. El cambio de
   * divisa es la única excepción declarada: mueve dos divisas a propósito.
   */
  it.each(TIPOS.filter((definicion) => !definicion.cambiaDeDivisa).map((definicion) => [definicion.tipo, definicion] as const))("%s: su efectivo cuadra con sus demás efectos", (tipo, definicion) => {
    const efectos = definicion.efectos(EJEMPLOS[tipo], CONTEXTO);
    const efectivo = sumaPorDivisa(efectos, (e) => (e.clase === "efectivo" ? { divisa: e.divisa, importe: e.importe } : undefined));
    const explicado = sumaPorDivisa(efectos, (e) => {
      switch (e.clase) {
        case "flujoExterno": return { divisa: e.divisa, importe: e.importe };
        case "baja": return e.externo ? undefined : { divisa: e.cobrado.divisa, importe: e.cobrado.importe };
        case "alta": return e.externo ? undefined : { divisa: e.pagado.divisa, importe: e.pagado.importe.times(-1) };
        case "ingreso": return { divisa: e.divisa, importe: e.neto };
        case "coste": return e.yaDescontado ? undefined : { divisa: e.divisa, importe: e.importe.times(-1) };
        default: return undefined;
      }
    });
    const divisas = new Set([...efectivo.keys(), ...explicado.keys()]);
    for (const divisa of divisas) {
      expect(`${divisa} ${(efectivo.get(divisa) ?? CERO).toFixed(4)}`).toBe(`${divisa} ${(explicado.get(divisa) ?? CERO).toFixed(4)}`);
    }
  });

  it("el signo del importe que declara cada tipo es el que valida", () => {
    for (const definicion of TIPOS) {
      const ejemplo = EJEMPLOS[definicion.tipo];
      if (definicion.signoDelEfectivo !== 1 && definicion.signoDelEfectivo !== -1) continue;
      if (ejemplo.importe === undefined) continue;
      const alReves = { ...ejemplo, importe: ejemplo.importe.startsWith("-") ? ejemplo.importe.slice(1) : `-${ejemplo.importe}` };
      expect(validarMovimiento(alReves, CONTEXTO).length, definicion.tipo).toBeGreaterThan(0);
    }
  });

  it("propone el importe de una compra y de una venta a partir de títulos, precio y gastos", () => {
    const compra = definicionDe("compra")!;
    const venta = definicionDe("venta")!;
    // 100 × 20 + 10 + 1 = 2.011, con signo de cargo.
    expect(compra.importeSugerido!(EJEMPLOS.compra, CONTEXTO)?.toFixed(2)).toBe("-2011.00");
    // 100 × 30 − 12 = 2.988.
    expect(venta.importeSugerido!(EJEMPLOS.venta, CONTEXTO)?.toFixed(2)).toBe("2988.00");
    // Un bono cotiza en % del nominal: 10.000 × 98,5 × 0,01 = 9.850; + 120 de cupón corrido + 25 = 9.995.
    const bono = mov("compra", "2024-08-01", { activoId: "BON", titulos: "10000", precio: "98.5", cuponCorrido: "120", comision: "25" });
    expect(compra.importeSugerido!(bono, CONTEXTO)?.toFixed(2)).toBe("-9995.00");
    // Activo en dólares pagado en euros: 10 × 100 USD / 1,25 = 800 EUR + 5 = 805.
    const usa = mov("compra", "2024-01-03", { activoId: "USA", titulos: "10", precio: "100", cambio: "1.25", comision: "5" });
    expect(compra.importeSugerido!(usa, CONTEXTO)?.toFixed(2)).toBe("-805.00");
    // Sin cambio no se puede deducir, y no se inventa.
    expect(compra.importeSugerido!({ ...usa, cambio: undefined }, CONTEXTO)).toBeUndefined();
  });

  it("explica en lenguaje llano por qué un movimiento no vale", () => {
    expect(validarMovimiento(mov("compra", "2024-01-02", { activoId: "NOESTA", titulos: "0", importe: "-10" }), CONTEXTO)).toEqual([
      "El activo del movimiento no está en la cartera.",
      "El número de títulos tiene que ser mayor que cero."
    ]);
    expect(validarMovimiento(mov("aportacion", "2024-13-40", { importe: "abc" }), CONTEXTO)).toEqual([
      "La fecha de operación no es válida.",
      "El campo «importe» no es un número válido."
    ]);
    expect(validarMovimiento(mov("traspaso", "2024-01-02", { activoId: "FON1", titulos: "40", valor: "2200", destino: { activoId: "FON1", titulos: "25" } }), CONTEXTO)).toEqual([
      "El fondo de destino tiene que ser distinto del de origen."
    ]);
  });
});
