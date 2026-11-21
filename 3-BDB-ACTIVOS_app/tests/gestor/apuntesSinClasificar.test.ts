/**
 * Auditoría integral del 16-11-2026, hallazgo GES-3. «Otro cargo o abono» cuenta como resultado, no como aportación ni
 * retirada: un abono de 1.000 € en una cartera de 1.000 € es un +100 % ese día. Llegaba ahí cualquier ingreso del cliente con
 * un rótulo no reconocido («Transferencia» a secas, en la plantilla), y una vez importado nada lo decía.
 *
 * Las cifras esperadas salen de las cuentas a mano escritas junto a cada una.
 */
import { describe, expect, test } from "vitest";
import { importadorDePlantilla } from "../../src/gestor/importacion/plantilla";
import type { DocumentoLeido, MovimientoPropuesto } from "../../src/gestor/importacion/tipos";
import { PESO_DE_UN_APUNTE_SIN_CLASIFICAR, comprobarIntegridad } from "../../src/gestor/motor/integridad";
import { valorar } from "../../src/gestor/motor/valoracion";
import { cartera, mov } from "./ayudas";

describe("GES-3 · un «Otro cargo o abono» que pesa se dice, con lo que mueve la rentabilidad", () => {
  /* 1.000 € aportados el 01-01-2024. El 02-01, un abono sin clasificar de 1.000 €; el 03-01, otro de 3 €; el 04-01, un cargo sin clasificar de 500 €. */
  const c = cartera(
    [],
    [
      mov("aportacion", "2024-01-01", { importe: "1000" }),
      mov("otroEfectivo", "2024-01-02", { id: "abono-grande", importe: "1000" }),
      mov("otroEfectivo", "2024-01-03", { id: "abono-pequeno", importe: "3" }),
      mov("otroEfectivo", "2024-01-04", { id: "cargo", importe: "-500" })
    ]
  );
  const v = valorar(c);
  const sinClasificar = comprobarIntegridad(c, v, "2024-01-04").avisos.filter((aviso) => aviso.codigo === "APUNTE_SIN_CLASIFICAR");

  test("el motor los cuenta como resultado: es lo que el aviso explica", () => {
    /* Día 2: (2.000 − 0) / (1.000 + 0) − 1 = +100 %. Día 4: 1.503 / 2.003 − 1 = −24,96 %. */
    expect(v.rentabilidad[1]).toBeCloseTo(1, 12);
    expect(v.rentabilidad[3]).toBeCloseTo(1503 / 2003 - 1, 12);
  });

  test("el abono de 1.000 € sobre 1.000 € de capital suma un 100,0 %; el cargo de 500 € sobre 2.003 €, resta un 25,0 %", () => {
    /* 500 / 2.003 = 24,96 %, que con un decimal es 25,0 %. */
    expect(sinClasificar).toEqual([
      {
        gravedad: "aviso",
        codigo: "APUNTE_SIN_CLASIFICAR",
        movimientoIds: ["abono-grande"],
        fecha: "2024-01-02",
        mensaje:
          "El abono de 1.000,00 EUR del 02/01/2024 está sin clasificar («Otro cargo o abono») y cuenta como ganancia: suma un 100,0 % a la rentabilidad de ese día. Si es dinero que ha puesto el cliente, cámbialo a aportación."
      },
      {
        gravedad: "aviso",
        codigo: "APUNTE_SIN_CLASIFICAR",
        movimientoIds: ["cargo"],
        fecha: "2024-01-04",
        mensaje:
          "El cargo de 500,00 EUR del 04/01/2024 está sin clasificar («Otro cargo o abono») y cuenta como pérdida: resta un 25,0 % a la rentabilidad de ese día. Si es dinero que ha retirado el cliente, cámbialo a retirada."
      }
    ]);
  });

  test("el de 3 € sobre 2.000 € (0,15 %) no avisa: por debajo de medio punto del día es ruido", () => {
    expect(PESO_DE_UN_APUNTE_SIN_CLASIFICAR).toBe(0.005);
    expect(sinClasificar.some((aviso) => aviso.movimientoIds?.includes("abono-pequeno"))).toBe(false);
  });

  test("a una fecha anterior no se avisa de lo que aún no ha pasado", () => {
    const antes = comprobarIntegridad(c, v, "2024-01-01").avisos.filter((aviso) => aviso.codigo === "APUNTE_SIN_CLASIFICAR");
    expect(antes).toEqual([]);
  });

  test("clasificado como aportación, deja de contar como ganancia y de avisar", () => {
    const corregida = { ...c, movimientos: c.movimientos.map((movimiento) => (movimiento.id === "abono-grande" ? { ...movimiento, tipo: "aportacion" } : movimiento)) };
    const w = valorar(corregida);
    /* Día 2: (2.000 − 0) / (1.000 + 1.000) − 1 = 0 %. */
    expect(w.rentabilidad[1]).toBeCloseTo(0, 12);
    expect(comprobarIntegridad(corregida, w, "2024-01-04").avisos.some((aviso) => aviso.movimientoIds?.includes("abono-grande"))).toBe(false);
  });
});

describe("GES-3 · en la plantilla, «Transferencia» es una aportación o una retirada según su signo", () => {
  const CABECERA = ["Fecha", "Tipo", "ISIN", "Nombre", "Títulos", "Precio", "Importe", "Divisa", "Comisión", "Retención", "Nota"];
  function unaFila(valores: Record<string, string>): MovimientoPropuesto {
    const tabla = [CABECERA, CABECERA.map((columna) => valores[columna] ?? "")];
    const documento: DocumentoLeido = { nombre: "movimientos.csv", texto: tabla.map((fila) => fila.join(";")).join("\n"), tablas: [tabla] };
    const resultado = importadorDePlantilla.importar([{ documento, tipo: "movimientos" }], { divisaBase: "EUR" });
    expect(resultado.errores).toEqual([]);
    expect(resultado.movimientos).toHaveLength(1);
    return resultado.movimientos[0];
  }

  test("con importe positivo es una aportación, y lo dice", () => {
    const propuesto = unaFila({ Fecha: "02/01/2024", Tipo: "Transferencia", Importe: "1000" });
    expect(propuesto.movimiento.tipo).toBe("aportacion");
    expect(propuesto.movimiento.importe).toBe("1000");
    expect(propuesto.requiereRevision).toBe(false);
    expect(propuesto.avisos).toEqual(["«Transferencia» con importe positivo: se lee como aportación. Si no es dinero que entra o sale de la cartera, cámbiale el tipo."]);
  });

  test("con importe negativo es una retirada", () => {
    const propuesto = unaFila({ Fecha: "02/01/2024", Tipo: "transferencia", Importe: "-250" });
    expect(propuesto.movimiento.tipo).toBe("retirada");
    expect(propuesto.movimiento.importe).toBe("-250");
    expect(propuesto.avisos).toEqual(["«transferencia» con importe negativo: se lee como retirada. Si no es dinero que entra o sale de la cartera, cámbiale el tipo."]);
  });

  test("sin importe no hay signo que leer: sigue sin reconocerse y se marca para revisar", () => {
    const propuesto = unaFila({ Fecha: "02/01/2024", Tipo: "Transferencia" });
    expect(propuesto.movimiento.tipo).toBe("otroEfectivo");
    expect(propuesto.requiereRevision).toBe(true);
    expect(propuesto.avisos[0]).toMatch(/^No reconozco el tipo «Transferencia»\./);
  });

  test("lo que ya se reconocía no cambia: «Transferencia recibida» es una aportación sin aviso", () => {
    const propuesto = unaFila({ Fecha: "02/01/2024", Tipo: "Transferencia recibida", Importe: "1000" });
    expect(propuesto.movimiento.tipo).toBe("aportacion");
    expect(propuesto.avisos).toEqual([]);
  });
});
