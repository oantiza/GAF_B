/**
 * Auditoría · arreglos medios y bajos del motor del gestor (MOT-07, FMT-03, DIR-03). Cada cifra
 * esperada lleva su cuenta a mano junto a ella.
 */
import { describe, expect, it } from "vitest";
import { comprobarIntegridad } from "../../../src/gestor/motor/integridad";
import { rentabilidadDelPeriodo } from "../../../src/gestor/motor/rentabilidad";
import { valorar } from "../../../src/gestor/motor/valoracion";
import { activo, cartera, mov } from "../ayudas";
import { mercado } from "./ayudasAuditoria";

describe("GES-12 · un año son 365 días: desde ahí se anualiza, también un año bisiesto (antes MOT-07, hasta 366 no)", () => {
  /* 10 participaciones a 100 el 02-01-2023; 110 el 02-01-2024, 111 el 03-01-2024 y 121 el 02-01-2025. */
  const FON = activo("FON", "FONDO");
  const c = cartera([FON], [
    mov("aportacion", "2023-01-02", { importe: "1000" }),
    mov("suscripcion", "2023-01-02", { activoId: "FON", titulos: "10", precio: "100", importe: "-1000" })
  ]);
  const v = valorar(c, mercado({ FON: [["2023-01-02", 100], ["2024-01-02", 110], ["2024-01-03", 111], ["2025-01-02", 121]] }), { hasta: "2025-01-02" });

  it("el año natural 2024, bisiesto (366 días), se anualiza", () => {
    /* Del cierre del 31-12-2023 al del 31-12-2024: 366 días. El 31-12-2023 el fondo sigue a 100 (el 110 llega el 02-01):
       1.000; el 31-12-2024 vale su último precio, 111: 1.110. TWR = 11 %, anualizada 1,11^(365,2425 / 366) − 1 = 10,976 %.
       Sin flujos dentro, la TIR es la misma: −1.000 al principio y +1.110 al final. */
    const r = rentabilidadDelPeriodo(v, { desde: "2023-12-31", hasta: "2024-12-31" })!;
    expect(r.dias).toBe(366);
    expect(r.twr).toBeCloseTo(0.11, 12);
    expect(r.anualiza).toBe(true);
    expect(r.twrAnualizada).toBeCloseTo(0.109760275863, 12);
    expect(r.tirAnualizada).toBeCloseTo(0.109760275863, 9);
  });

  it("365 días se anualizan; 364, no", () => {
    /* Del 02-01-2023 al 02-01-2024: 365 días, TWR = 1.100 / 1.000 − 1 = 10 %, anualizada 1,1^(365,2425 / 365) − 1 = 10,00697 %. */
    const unAnio = rentabilidadDelPeriodo(v, { desde: "2023-01-02", hasta: "2024-01-02" })!;
    expect(unAnio.dias).toBe(365);
    expect(unAnio.anualiza).toBe(true);
    expect(unAnio.twrAnualizada).toBeCloseTo(0.100069656974, 12);
    /* Del 02-01-2023 al 01-01-2024: 364 días; el fondo sigue a 100, TWR 0, y no se anualiza: es la del periodo. */
    const casi = rentabilidadDelPeriodo(v, { desde: "2023-01-02", hasta: "2024-01-01" })!;
    expect(casi.dias).toBe(364);
    expect([casi.anualiza, casi.twrAnualizada, casi.tirAnualizada]).toEqual([false, null, null]);
  });

  it("desde 367 días se anualiza, con años = días / 365,2425", () => {
    /* Del 02-01-2023 al 04-01-2024: 367 días; el 04-01 sigue valiendo 111 (último precio). TWR = 1.110 / 1.000 − 1 = 11 %. */
    const r = rentabilidadDelPeriodo(v, { desde: "2023-01-02", hasta: "2024-01-04" })!;
    expect(r.dias).toBe(367);
    expect(r.anualiza).toBe(true);
    expect(r.twrAnualizada).toBeCloseTo(Math.pow(1.11, 365.2425 / 367) - 1, 12);
  });
});

describe("FMT-03 · los avisos del motor salen con formato español", () => {
  const ISO = /\d{4}-\d{2}-\d{2}/;

  it("efectivo en negativo: fecha dd/mm/aaaa e importe con punto de millar y signo menos tipográfico", () => {
    /* Aporta 1.000 el 01-03-2026 y compra el 14-03 por 2.250,40: saldo 1.000 − 2.250,40 = −1.250,40. */
    const c = cartera([activo("ACC")], [
      mov("aportacion", "2026-03-01", { importe: "1000" }),
      mov("compra", "2026-03-14", { activoId: "ACC", titulos: "10", precio: "225.04", importe: "-2250.40" })
    ]);
    const v = valorar(c, mercado({ ACC: [["2026-03-14", 225.04]] }), { hasta: "2026-03-16" });
    const aviso = comprobarIntegridad(c, v, "2026-03-16").avisos.find((a) => a.codigo === "EFECTIVO_EN_NEGATIVO")!;
    expect(aviso.mensaje).toContain("desde el 14/03/2026");
    expect(aviso.mensaje).toContain("llega a −1.250,40 EUR");
  });

  it("títulos en descubierto: fecha española y títulos con coma decimal", () => {
    /* Compra 10 y vende 12,5: salen 12,5 y solo había 10. */
    const c = cartera([activo("ACC")], [
      mov("aportacion", "2026-03-01", { importe: "1000" }),
      mov("compra", "2026-03-02", { activoId: "ACC", titulos: "10", precio: "100", importe: "-1000" }),
      mov("venta", "2026-03-14", { activoId: "ACC", titulos: "12.5", precio: "100", importe: "1250" })
    ]);
    const v = valorar(c, mercado({ ACC: [["2026-03-02", 100]] }), { hasta: "2026-03-16" });
    const aviso = comprobarIntegridad(c, v, "2026-03-16").avisos.find((a) => a.codigo === "DESCUBIERTO_DE_TITULOS")!;
    expect(aviso.mensaje).toContain("El 14/03/2026 salen 12,5 títulos de Activo ACC y solo había 10:");
  });

  it("duplicados, concentración y conciliación: ninguna fecha ISO ni punto decimal", () => {
    /* Dos aportaciones iguales de 1.250,40 el 01-03-2026; todo en efectivo salvo 10 títulos a 100 (1.000 de 2.500,80: un 40,0 %). */
    const c = cartera([activo("ACC")], [
      mov("aportacion", "2026-03-01", { importe: "1250.40" }),
      mov("aportacion", "2026-03-01", { importe: "1250.40" }),
      mov("compra", "2026-03-02", { activoId: "ACC", titulos: "10", precio: "100", importe: "-1000" })
    ], { extractos: [{ id: "e1", fecha: "2026-03-10", posiciones: [{ isin: "XX", nombre: "Otro", titulos: "5" }], efectivo: [] }] });
    const v = valorar(c, mercado({ ACC: [["2026-03-02", 100]] }), { hasta: "2026-03-10" });
    const avisos = comprobarIntegridad(c, v, "2026-03-10").avisos;
    expect(avisos.find((a) => a.codigo === "POSIBLE_DUPLICADO")!.mensaje).toContain("el 01/03/2026: aportación por 1.250,40 EUR");
    expect(avisos.find((a) => a.codigo === "CONCENTRACION")!.mensaje).toContain("pesa un 40,0 %"); // 1.000 / 2.500,80 = 39,98 %
    expect(avisos.find((a) => a.codigo === "NO_CUADRA_CON_EL_EXTRACTO")!.mensaje).toContain("extracto del 10/03/2026");
    for (const aviso of avisos) expect(aviso.mensaje).not.toMatch(ISO);
  });

  it("los avisos de la valoración y del libro (cambio y precio que faltan) también", () => {
    /* Un activo en USD sin tipo de cambio ni en el mercado ni en la operación, y otro sin ningún precio. */
    const c = cartera([activo("USA", "ACCION", "USD"), activo("SIN")], [
      mov("aportacion", "2026-03-01", { importe: "5000" }),
      mov("compra", "2026-03-02", { activoId: "USA", titulos: "10", precio: "100", importe: "-1000", divisa: "USD" }),
      mov("entradaDeTitulos", "2026-03-03", { activoId: "SIN", titulos: "5", valor: "0" })
    ]);
    const v = valorar(c, mercado({ USA: [["2026-03-02", 100]] }), { hasta: "2026-03-05" });
    const mensajes = [...v.avisos.map((a) => a.mensaje), ...v.libro.avisos.map((a) => a.mensaje)];
    expect(mensajes.length).toBeGreaterThan(0);
    expect(mensajes.some((m) => m.includes("02/03/2026"))).toBe(true);
    for (const mensaje of mensajes) expect(mensaje).not.toMatch(ISO);
  });
});

describe("DIR-03 · «Comprobaciones» avisa de un precio de operación muy alejado del de mercado", () => {
  const LU = activo("LU", "FONDO", "EUR", { isin: "LU1883318740" });

  it("una suscripción a 160,40 de un fondo que ese día vale 500 da un aviso (se aleja un 68 %)", () => {
    /* |160,40 / 500 − 1| = 0,6792 → «68 %», por encima del umbral del 20 %. */
    const c = cartera([LU], [
      mov("aportacion", "2026-01-02", { importe: "10000" }),
      mov("suscripcion", "2026-01-05", { activoId: "LU", titulos: "12.5", precio: "160.40", importe: "-2005" })
    ]);
    const v = valorar(c, mercado({ LU: [["2026-01-02", 498], ["2026-01-05", 500]] }), { hasta: "2026-01-07" });
    const aviso = comprobarIntegridad(c, v, "2026-01-07", mercado({ LU: [["2026-01-02", 498], ["2026-01-05", 500]] })).avisos.find((a) => a.codigo === "PRECIO_ALEJADO_DEL_MERCADO");
    expect(aviso?.gravedad).toBe("aviso");
    expect(aviso?.mensaje).toContain("05/01/2026");
    expect(aviso?.mensaje).toContain("68 %");
    expect(aviso?.movimientoIds).toEqual([c.movimientos[1].id]);
  });

  it("un precio a un 2 % del de mercado no avisa", () => {
    /* 510 / 500 − 1 = 2 %. */
    const c = cartera([LU], [
      mov("aportacion", "2026-01-02", { importe: "10000" }),
      mov("suscripcion", "2026-01-05", { activoId: "LU", titulos: "10", precio: "510", importe: "-5100" })
    ]);
    const m = mercado({ LU: [["2026-01-05", 500]] });
    const v = valorar(c, m, { hasta: "2026-01-07" });
    expect(comprobarIntegridad(c, v, "2026-01-07", m).avisos.some((a) => a.codigo === "PRECIO_ALEJADO_DEL_MERCADO")).toBe(false);
  });

  it("una compra antes de un split, con la serie ya ajustada por él, se compara con el precio de antes del split", () => {
    /* Serie ajustada por el split 2×1 del 10-01: 50 el 02-01, que antes del split eran 50 × 2 = 100. Compra a 100: 0 %. */
    const c = cartera([activo("ACC")], [
      mov("aportacion", "2025-01-02", { importe: "1000" }),
      mov("compra", "2025-01-02", { activoId: "ACC", titulos: "10", precio: "100", importe: "-1000" }),
      mov("split", "2025-01-10", { activoId: "ACC", razon: "2", serieAjustada: true })
    ]);
    const m = mercado({ ACC: [["2025-01-02", 50], ["2025-01-10", 50]] });
    const v = valorar(c, m, { hasta: "2025-01-12" });
    expect(comprobarIntegridad(c, v, "2025-01-12", m).avisos.some((a) => a.codigo === "PRECIO_ALEJADO_DEL_MERCADO")).toBe(false);
  });
});
