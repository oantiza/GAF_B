// @vitest-environment happy-dom
/**
 * La pestaña «Cuentas» y el color de las cifras de los bloques del análisis.
 *
 * GES-06: las cuentas se dan a la fecha que dice su campo, no a la del final del periodo que se
 * eligió en otra pestaña. MOT-03: una cifra que se escribe «0,00 €» no se pinta en rojo ni en verde.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { MercadoCargado } from "../../src/gestor/mercado/cargar";
import { analizar, type Analisis } from "../../src/gestor/motor/analisis";
import { BloqueCerradas } from "../../src/gestor/ui/analisis/BloqueCerradas";
import { VistaCuentas } from "../../src/gestor/ui/vistas/VistaCuentas";
import { activo, cartera, mov, serie } from "./ayudas";
import { datosDeVista, panel, pintar, type Pintado } from "./vistaAnalisisDatos";

let pintado: Pintado | undefined;
afterEach(async () => {
  await pintado?.desmontar();
  pintado = undefined;
});

/* 10.000 € el 2 ene 2025 en 100 participaciones de un fondo a 100 €; vale 105 € el 30 jun 2025 y 110 € hoy. */
const FONDO = activo("A", "FONDO");
const MERCADO: MercadoCargado = {
  datos: { precios: new Map([["A", serie(["2025-01-02", 100], ["2025-06-30", 105], ["2026-11-13", 110])]]), cambios: new Map() },
  fichas: new Map(),
  avisos: []
};
const CARTERA = cartera([FONDO], [
  mov("aportacion", "2025-01-02", { importe: "10000" }),
  mov("suscripcion", "2025-01-02", { activoId: "A", titulos: "100", precio: "100", importe: "-10000" })
]);

describe("GES-06 · Cuentas a la fecha de su campo", () => {
  it("con un periodo elegido que acaba antes de hoy, Cuentas a hoy da el patrimonio de hoy", async () => {
    const datos = datosDeVista(CARTERA, MERCADO);
    /* En Resumen se eligió «Entre dos fechas», hasta el 30 jun 2025. */
    const periodo = { desde: datos.periodo.desde, hasta: "2025-06-30" };
    const conPeriodo = { ...datos, periodo, elegido: { id: "libre" as const, libre: periodo }, analisis: analizar(datos.preparado, periodo) };
    pintado = await pintar(<VistaCuentas datos={conPeriodo} />);
    const valores = panel(pintado.vista, "Cuenta de valores");
    /* 100 participaciones × 110 € = 11.000,00 €, sin efectivo: lo aportado se invirtió entero. */
    expect(valores.textContent).toContain("11.000,00\u00a0€ en total");
    expect(valores.textContent).toContain("a 13/11/2026");
    expect(valores.textContent).not.toContain("10.500,00 €");
  });
});

describe("MOT-03 · un importe escrito como cero no lleva color", () => {
  it("en Posiciones cerradas, un resultado de −0,004 € se escribe «0,00 €» sin la clase de bajada", async () => {
    const analisis = {
      cartera: CARTERA,
      cerradas: [{ activo: FONDO, activoId: "A", titulos: 1, coste: 100, cobrado: 99.996, resultado: -0.004, resultadoPct: -0.00004, primeraCompra: "2025-01-02", ultimaVenta: "2025-06-30", cerradaDelTodo: true, incompleto: false }],
      realizado: -0.004
    } as unknown as Analisis;
    pintado = await pintar(<BloqueCerradas analisis={analisis} />);
    const ceros = [...pintado.vista.querySelectorAll(".cifra")].filter((nodo) => nodo.textContent === "0,00\u00a0€");
    expect(ceros.length).toBeGreaterThan(0);
    for (const nodo of ceros) {
      expect(nodo.classList.contains("cifra--baja")).toBe(false);
      expect(nodo.classList.contains("cifra--sube")).toBe(false);
    }
  });
});
