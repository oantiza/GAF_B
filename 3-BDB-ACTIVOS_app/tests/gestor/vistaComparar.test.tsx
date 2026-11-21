// @vitest-environment happy-dom
/**
 * La pestaña «Comparar»: el cálculo de cada candidata (sin React, con una fuente de mercado
 * y un catálogo en memoria) y la pantalla en el caso que no tiene nada que leer de fuera.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FuenteDeMercado } from "../../src/gestor/mercado/cargar";
import { olvidarMercado } from "../../src/gestor/mercado/cargar";
import type { ActivoDeCatalogo } from "../../src/gestor/mercado/fichas";
import { analizarCarteraDeDiseno, analizarCarteraDelGestor, capitalDeReferencia, CAPITAL_POR_DEFECTO, type ContextoDeComparacion } from "../../src/gestor/ui/comparar/calcular";
import { VistaComparar } from "../../src/gestor/ui/vistas/VistaComparar";
import { activo, cartera, mov } from "./ayudas";
import { datosDeLaDemo, panel, pintar, titulos, type Pintado } from "./vistaAnalisisDatos";

const ISIN_A = "XA0000000001";
const ISIN_B = "XB0000000002";
const ISIN_FUERA = "XZ0000000009";

/* Dos activos: A pasa de 100 € a 110 € (+10 %) y B de 50 € a 45 € (−10 %) entre el 31 dic 2025 y el 30 jun 2026. */
const PRECIOS: Record<string, Record<number, Array<{ date: string; value: number }>>> = {
  [ISIN_A]: { 2025: [{ date: "2025-12-31", value: 100 }], 2026: [{ date: "2026-06-30", value: 110 }] },
  [ISIN_B]: { 2025: [{ date: "2025-12-31", value: 50 }], 2026: [{ date: "2026-06-30", value: 45 }] }
};

const fuente: FuenteDeMercado = {
  preciosDelAnio: async (isin, anio) => (PRECIOS[isin]?.[anio] ? { points: PRECIOS[isin][anio], currency: "EUR", price_class: "NAV" } : undefined),
  cambiosDelAnio: async () => undefined,
  libreDeRiesgoDelAnio: async () => undefined,
  tarjeta: async () => undefined
};

const CATALOGO: ActivoDeCatalogo[] = [
  { isin: ISIN_A, nombre: "Fondo A", tipo: "FONDO", divisa: "EUR" },
  { isin: ISIN_B, nombre: "Fondo B", tipo: "FONDO", divisa: "EUR" }
];

const contexto: ContextoDeComparacion = {
  periodo: { desde: "2025-12-31", hasta: "2026-06-30" },
  hoy: "2026-06-30",
  divisaBase: "EUR",
  capital: 100_000,
  fuente,
  catalogo: async () => CATALOGO,
  almacen: null
};

beforeEach(() => olvidarMercado());

describe("calcular una cartera de Diseño", () => {
  it("una cartera 60/40 da la rentabilidad calculada a mano", async () => {
    /*
     * 100.000 € el 31 dic 2025: 60.000 € en A a 100 € = 600 participaciones; 40.000 € en B a 50 € = 800.
     * El 30 jun 2026: 600 × 110 = 66.000 € y 800 × 45 = 36.000 € → 102.000 €.
     * Rentabilidad: 102.000 / 100.000 − 1 = +2 % (= 0,6 × 10 % + 0,4 × −10 %, sin reequilibrar).
     */
    const comparada = await analizarCarteraDeDiseno(
      { clase: "diseno", clave: "diseno:p1", nombre: "Modelo 60/40", posiciones: [{ isin: ISIN_A, pesoPorCien: 60 }, { isin: ISIN_B, pesoPorCien: 40 }] },
      contexto
    );
    expect(comparada.noEncontrados).toEqual([]);
    expect(comparada.sinComprar).toEqual([]);
    expect(comparada.invertido).toBeCloseTo(1, 12);
    expect(comparada.analisis.rentabilidad!.valorInicial).toBeCloseTo(100_000, 6);
    expect(comparada.analisis.rentabilidad!.valorFinal).toBeCloseTo(102_000, 6);
    expect(comparada.analisis.rentabilidad!.twr).toBeCloseTo(0.02, 10);
    expect(comparada.empiezaEl).toBeUndefined();
    expect(comparada.sinHistoria).toBe(false);
  });

  it("un ISIN que el catálogo no tiene sale como no encontrado y su peso se queda en efectivo", async () => {
    /*
     * 60 % en A, 30 % en B y 10 % en un ISIN que no está: 60.000 € → 66.000 €, 30.000 € → 27.000 € y 10.000 € en efectivo.
     * 103.000 / 100.000 − 1 = +3 %.
     */
    const comparada = await analizarCarteraDeDiseno(
      { clase: "diseno", clave: "diseno:p2", nombre: "Con un ISIN de fuera", posiciones: [{ isin: ISIN_A, pesoPorCien: 60 }, { isin: ISIN_B, pesoPorCien: 30 }, { isin: ISIN_FUERA, pesoPorCien: 10 }] },
      contexto
    );
    expect(comparada.noEncontrados).toEqual([{ isin: ISIN_FUERA, peso: 0.1 }]);
    expect(comparada.invertido).toBeCloseTo(0.9, 12);
    expect(comparada.analisis.rentabilidad!.twr).toBeCloseTo(0.03, 10);
  });

  it("si ningún activo está en el catálogo, no se simula: se dice", async () => {
    await expect(analizarCarteraDeDiseno({ clase: "diseno", clave: "diseno:p3", nombre: "Nada", posiciones: [{ isin: ISIN_FUERA, pesoPorCien: 100 }] }, contexto)).rejects.toThrow(/catálogo/);
  });

  it("el capital de la simulación es el valor inicial de la abierta, o 100.000 si no valía nada", () => {
    const demo = datosDeLaDemo("inicio").analisis;
    expect(demo.rentabilidad!.valorInicial).toBe(0);
    expect(capitalDeReferencia(demo)).toBe(CAPITAL_POR_DEFECTO);
    const anio = datosDeLaDemo("anio").analisis;
    expect(capitalDeReferencia(anio)).toBe(anio.rentabilidad!.valorInicial);
  });
});

describe("calcular una cartera del gestor", () => {
  it("se analiza en el periodo común y dice si empieza después", async () => {
    /* Empieza el 2 feb 2026, después del inicio del periodo (31 dic 2025): se mide desde su víspera. */
    const otra = cartera([activo("M", "FONDO")], [
      mov("aportacion", "2026-02-02", { importe: "1000" }),
      mov("suscripcion", "2026-02-02", { activoId: "M", titulos: "10", precio: "100", importe: "-1000" })
    ], { nombre: "Otra del gestor" });
    const almacen = { abrir: async () => ({ cartera: otra, versionOriginal: 1, migrada: false }) };
    const comparada = await analizarCarteraDelGestor({ clase: "gestor", clave: "gestor:otra", nombre: "Otra", fichero: "Otra.cartera.json" }, { ...contexto, almacen });
    expect(comparada.nombre).toBe("Otra del gestor");
    expect(comparada.empiezaEl).toBe("2026-02-01");
    expect(comparada.analisis.periodo.hasta).toBe("2026-06-30");
  });
});

describe("VistaComparar", () => {
  let pintado: Pintado | undefined;
  afterEach(async () => {
    await pintado?.desmontar();
    pintado = undefined;
  });

  it("sin carpeta y con la demo: no lanza y explica qué se puede comparar", async () => {
    pintado = await pintar(<VistaComparar datos={datosDeLaDemo()} onSendToBuilder={() => undefined} />);
    const { vista } = pintado;
    expect(titulos(vista)).toEqual(["Con qué carteras comparar", "Comparación"]);
    const selector = panel(vista, "Con qué carteras comparar").textContent ?? "";
    /* GES-28: el entorno de prueba no tiene acceso a carpetas, como Firefox: no se le pide que elija una. */
    expect(selector).toContain("Este navegador no deja abrir una carpeta de carteras");
    expect(selector).not.toContain("Elígela en la entrada del gestor");
    expect(selector).toContain("cartera de demostración");
    /* La tabla ya tiene la columna de la abierta, con sus cifras. */
    const tabla = panel(vista, "Comparación");
    expect(tabla.querySelector("thead")!.textContent).toContain("Esta cartera");
    expect(tabla.querySelectorAll("tbody tr")).toHaveLength(5);
    expect(tabla.textContent).toContain("Elige arriba hasta 3 carteras");
  });
});
