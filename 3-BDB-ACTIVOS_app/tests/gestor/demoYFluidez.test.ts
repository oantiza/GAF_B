/**
 * La cartera de demostración (que tiene que ser coherente: es lo primero que ve quien prueba
 * el gestor) y la fluidez del motor con una cartera de varios años y cientos de movimientos.
 */
import { describe, expect, it } from "vitest";
import { demostracion, esDemostracion } from "../../src/gestor/demo/carteraDemo";
import { analizar, periodosHabituales, preparar } from "../../src/gestor/motor/analisis";
import { sumarDias } from "../../src/gestor/motor/fechas";
import { contextoDe, validarMovimiento } from "../../src/gestor/motor/libro";
import type { Movimiento } from "../../src/gestor/motor/modelo";
import { TIPOS } from "../../src/gestor/motor/movimientos/registro";
import type { DatosDeMercado, Punto } from "../../src/gestor/motor/valoracion";
import { activo, cartera, mov } from "./ayudas";

const HOY = "2026-11-13";

describe("la cartera de demostración", () => {
  const demo = demostracion(HOY);
  const preparado = preparar(demo.cartera, demo.mercado, demo.fichas, HOY);
  const periodos = periodosHabituales(preparado.valoracion, HOY);
  const desdeElInicio = analizar(preparado, periodos.find((periodo) => periodo.id === "inicio")!.periodo, demo.referencia);

  it("es siempre la misma para una misma fecha y se reconoce como demostración", () => {
    expect(JSON.stringify(demostracion(HOY).cartera)).toBe(JSON.stringify(demo.cartera));
    expect(esDemostracion(demo.cartera)).toBe(true);
    expect(demo.cartera.activos.every((a) => a.nombre.includes("(demo)"))).toBe(true);
  });

  it("todos sus movimientos son válidos y recorren los tipos de un día a día", () => {
    const contexto = contextoDe(demo.cartera);
    expect(demo.cartera.movimientos.flatMap((movimiento) => validarMovimiento(movimiento, contexto))).toEqual([]);
    const tipos = new Set(demo.cartera.movimientos.map((movimiento) => movimiento.tipo));
    for (const tipo of ["aportacion", "retirada", "compra", "venta", "suscripcion", "traspaso", "dividendo", "cupon", "comision", "interes", "split"]) {
      expect(tipos.has(tipo), tipo).toBe(true);
    }
    expect(demo.cartera.movimientos.length).toBeGreaterThan(60);
  });

  it("no tiene errores de integridad y cuadra con su extracto", () => {
    expect(desdeElInicio.integridad.errores).toBe(0);
    expect(desdeElInicio.integridad.conciliaciones.map((conciliacion) => conciliacion.cuadra)).toEqual([true]);
    expect(desdeElInicio.integridad.avisos.filter((aviso) => aviso.codigo === "EFECTIVO_EN_NEGATIVO")).toEqual([]);
    expect(desdeElInicio.valoracion.avisos).toEqual([]);
  });

  it("da un análisis completo: rentabilidad, riesgo, referencia, desglose con divisa y una posición cerrada", () => {
    expect(desdeElInicio.patrimonio).toBeGreaterThan(100000);
    expect(desdeElInicio.rentabilidad?.anualiza).toBe(true);
    expect(desdeElInicio.rentabilidad?.tir).not.toBeNull();
    expect(desdeElInicio.riesgo?.volatilidad).toBeGreaterThan(0.02);
    expect(desdeElInicio.riesgo?.sharpe).not.toBeNull();
    expect(desdeElInicio.referencia?.disponible).toBe(true);
    expect(desdeElInicio.desglose?.divisa).not.toBe(0);
    expect(desdeElInicio.desglose?.ingresos).toBeGreaterThan(0);
    expect(desdeElInicio.cerradas.some((cerrada) => cerrada.cerradaDelTodo)).toBe(true);
    expect(desdeElInicio.bonos).toHaveLength(1);
    expect(desdeElInicio.bonos[0].proximos.length).toBeGreaterThan(0);
    // El desglose suma el resultado y la contribución suma la rentabilidad.
    expect(desdeElInicio.desglose!.resultado).toBeCloseTo(desdeElInicio.rentabilidad!.resultado, 6);
    expect(desdeElInicio.desglose!.contribucionTotal).toBeCloseTo(desdeElInicio.rentabilidad!.twr, 10);
    // Ningún día da un salto que delate una valoración incoherente (un split o un traspaso mal tratados).
    const peorDia = Math.max(...Array.from(desdeElInicio.valoracion.rentabilidad, (r) => Math.abs(r)));
    expect(peorDia).toBeLessThan(0.06);
  });

  it("todos los periodos habituales están disponibles con tres años de historia", () => {
    expect(periodos.map((periodo) => [periodo.id, periodo.disponible])).toEqual([["anio", true], ["1a", true], ["3a", true], ["inicio", true]]);
  });
});

describe("fluidez", () => {
  it("analiza diez años y más de mil movimientos en menos de un segundo", () => {
    /* Cuarenta activos, diez años: una aportación y siete operaciones al mes, y dividendos trimestrales. */
    const inicio = "2016-11-14";
    const activos = Array.from({ length: 40 }, (_, i) => activo(`A${i}`, i % 2 === 0 ? "FONDO" : "ACCION", i % 5 === 0 ? "USD" : "EUR"));
    const precios = new Map<string, Punto[]>();
    const dias = Array.from({ length: 3650 }, (_, i) => sumarDias(inicio, i));
    activos.forEach((a, i) => precios.set(a.id, dias.map((fecha, k) => ({ fecha, valor: 100 + i + Math.sin(k / (20 + i)) * 5 + k * 0.01 }))));
    const mercado: DatosDeMercado = { precios, cambios: new Map([["USD", dias.map((fecha, k) => ({ fecha, valor: 1.1 + Math.sin(k / 300) * 0.05 }))]]) };
    const movimientos: Movimiento[] = [mov("aportacion", inicio, { importe: "2000000" })];
    for (let mes = 0; mes < 120; mes += 1) {
      const fecha = sumarDias(inicio, mes * 30 + 1);
      movimientos.push(mov("aportacion", fecha, { importe: "1000" }));
      for (let j = 0; j < 7; j += 1) {
        const a = activos[(mes * 7 + j) % 40];
        const dolares = a.divisa === "USD";
        movimientos.push(mov(a.tipo === "FONDO" ? "suscripcion" : "compra", sumarDias(fecha, j + 1), { activoId: a.id, titulos: "10", precio: "100", importe: "-1000", ...(dolares ? { cambio: "1.1" } : {}) }));
        if (mes > 12 && j === 0) movimientos.push(mov(a.tipo === "FONDO" ? "reembolso" : "venta", sumarDias(fecha, 9), { activoId: a.id, titulos: "3", precio: "110", importe: "330", ...(dolares ? { cambio: "1.1" } : {}) }));
        if (mes % 3 === 0 && a.tipo === "ACCION") movimientos.push(mov("dividendo", sumarDias(fecha, 12), { activoId: a.id, importe: "8.10", retencion: "1.90" }));
      }
    }
    expect(movimientos.length).toBeGreaterThan(1000);
    const grande = cartera(activos, movimientos);
    const hasta = sumarDias(inicio, 3649);

    const t0 = performance.now();
    const preparado = preparar(grande, mercado, new Map(), hasta);
    const t1 = performance.now();
    const analisis = analizar(preparado, { desde: inicio, hasta });
    const t2 = performance.now();
    const otroPeriodo = analizar(preparado, { desde: sumarDias(hasta, -365), hasta });
    const t3 = performance.now();

    expect(analisis.integridad.errores).toBe(0);
    expect(analisis.posiciones.length).toBe(40);
    expect(otroPeriodo.rentabilidad?.dias).toBe(365);
    /* Holgura amplia para una máquina lenta: en un portátil normal son unos 150 ms en total. */
    expect(t1 - t0).toBeLessThan(1000);
    expect(t2 - t1).toBeLessThan(1000);
    expect(t3 - t2).toBeLessThan(1000);
  });

  it("el registro tiene veintiún tipos de movimiento", () => {
    expect(TIPOS).toHaveLength(21);
  });
});
