/**
 * La referencia de una cartera: su codificación en `activoId`, la lista que se ofrece, qué es
 * cada una en llano, y su serie para un periodo —la mezcla de una cartera de referencia fijada el
 * primer día del periodo y el índice del €STR capitalizado—, con cifras hechas a mano.
 */
import { describe, expect, it } from "vitest";
import { preparar } from "../../src/gestor/motor/analisis";
import {
  claseDeLaReferencia,
  descripcionDeLaReferencia,
  indiceDelEstr,
  nombreDeLaReferencia,
  notaDeLosPesos,
  OPCIONES_DE_REFERENCIA,
  opcionDeLaLista,
  referenciaDeLaOpcion,
  serieDeLaReferencia
} from "../../src/gestor/motor/referencia";
import { analizarConLaReferencia } from "../../src/gestor/ui/estado/useAnalisisDeCartera";
import { activo, cartera, mov, serie } from "./ayudas";

describe("la codificación de la referencia en activoId", () => {
  it("distingue cartera de referencia, liquidez y activo", () => {
    const perfil = claseDeLaReferencia({ activoId: "perfil:equilibrado" });
    expect(perfil.clase).toBe("perfil");
    expect(perfil.clase === "perfil" && perfil.perfil.weights).toEqual({ rf: 0.5, rv: 0.5 });
    expect(claseDeLaReferencia({ activoId: "tipo:ESTR" })).toEqual({ clase: "liquidez" });
    expect(claseDeLaReferencia({ activoId: "IE00B6R52259" })).toEqual({ clase: "activo", isin: "IE00B6R52259" });
    /* La referencia sintética de la demostración es un activo: su serie llega hecha. */
    expect(claseDeLaReferencia({ activoId: "DEMO-INDICE" })).toEqual({ clase: "activo", isin: "DEMO-INDICE" });
    /* Un prefijo reservado que no se conoce no se toma por un ISIN. */
    expect(claseDeLaReferencia({ activoId: "perfil:temerario" })).toEqual({ clase: "desconocida", codigo: "perfil:temerario" });
    expect(claseDeLaReferencia({ activoId: "tipo:EURIBOR" })).toEqual({ clase: "desconocida", codigo: "tipo:EURIBOR" });
  });

  it("ofrece las cinco carteras de referencia, los tres índices de Rendimiento y la liquidez, y cada código vuelve a su opción", () => {
    expect(OPCIONES_DE_REFERENCIA.map((grupo) => [grupo.titulo, grupo.opciones.map((opcion) => opcion.rotulo)])).toEqual([
      ["Carteras de referencia", ["Conservador", "Moderado", "Equilibrado", "Dinámico", "Agresivo"]],
      ["Índices", ["MSCI ACWI", "IBEX 35 con dividendos", "Renta fija global"]],
      ["Liquidez", ["Liquidez (€STR capitalizado)"]]
    ]);
    expect(OPCIONES_DE_REFERENCIA[1].opciones.map((opcion) => opcion.codigo)).toEqual(["IE00B6R52259", "ES0105336038", "IE00BDBRDM35"]);
    for (const grupo of OPCIONES_DE_REFERENCIA) {
      for (const opcion of grupo.opciones) {
        const guardada = referenciaDeLaOpcion(opcion);
        expect(opcionDeLaLista(guardada.activoId)).toBe(opcion);
        expect(claseDeLaReferencia(guardada).clase).not.toBe("desconocida");
      }
    }
  });

  it("dice en llano qué es cada una", () => {
    expect(descripcionDeLaReferencia({ activoId: "perfil:equilibrado", nombre: "x" })).toBe(
      "50\u00a0% renta fija global y 50\u00a0% renta variable global, con los pesos fijados el primer día, sin reequilibrar."
    );
    expect(descripcionDeLaReferencia({ activoId: "perfil:conservador", nombre: "x" })).toBe("100\u00a0% renta fija global.");
    expect(descripcionDeLaReferencia({ activoId: "IE00B6R52259", nombre: "MSCI ACWI" }, "iShares MSCI ACWI")).toBe(
      "Bolsa mundial, países desarrollados y emergentes. Se sigue con un fondo cotizado que lo replica, iShares MSCI ACWI (IE00B6R52259), en la divisa de la cartera."
    );
    expect(descripcionDeLaReferencia({ activoId: "LU0000000001", nombre: "Un fondo" })).toBe("Un activo del catálogo, LU0000000001, en la divisa de la cartera.");
    expect(descripcionDeLaReferencia({ activoId: "tipo:ESTR", nombre: "x" })).toContain("€STR del BCE");
    expect(notaDeLosPesos({ activoId: "perfil:dinamico", nombre: "x" })).toBe("Sus pesos se fijan el primer día del periodo y se dejan derivar: no se reequilibran.");
    expect(notaDeLosPesos({ activoId: "perfil:agresivo", nombre: "x" })).toBeNull();
    expect(notaDeLosPesos({ activoId: "IE00B6R52259", nombre: "x" })).toBeNull();
    /* El nombre de una opción de la lista es el de la lista, aunque el guardado se haya quedado viejo. */
    expect(nombreDeLaReferencia({ activoId: "perfil:moderado", nombre: "Moderado (viejo)" })).toBe("Cartera de referencia Moderado");
    expect(nombreDeLaReferencia({ activoId: "LU0000000001", nombre: "Un fondo" })).toBe("Un fondo");
  });
});

/*
 * Los dos fondos base, a mano:
 *   RF: 100 el 2 ene, 110 el 4, 121 el 8.   RV: 100 el 2 ene, 80 el 4, 120 el 8.
 * Equilibrado desde el 2 ene (pesos 50/50 ese día, sin reequilibrar):
 *   4 ene: 100 × (0,5 × 110/100 + 0,5 × 80/100) = 95
 *   8 ene: 100 × (0,5 × 121/100 + 0,5 × 120/100) = 120,5
 * Equilibrado desde el 4 ene (pesos 50/50 el día 4):
 *   8 ene: 100 × (0,5 × 121/110 + 0,5 × 120/80) = 100 × (0,55 + 0,75) = 130
 * Reequilibrada a diario desde el 2 saldría 95 × (0,5 × 1,1 + 0,5 × 1,5) = 123,5 el día 8: no es esa.
 */
const RF = serie(["2024-01-02", 100], ["2024-01-04", 110], ["2024-01-08", 121]);
const RV = serie(["2024-01-02", 100], ["2024-01-04", 80], ["2024-01-08", 120]);
const EQUILIBRADO = { nombre: "Cartera de referencia Equilibrado", base: { rf: RF, rv: RV }, pesos: { rf: 0.5, rv: 0.5 } };

describe("la serie de una cartera de referencia para un periodo", () => {
  it("fija los pesos el primer día del periodo: dos periodos dan series distintas, y cada una arranca 50/50", () => {
    const desdeEl2 = serieDeLaReferencia(EQUILIBRADO, "2024-01-02", "2024-01-10");
    const desdeEl4 = serieDeLaReferencia(EQUILIBRADO, "2024-01-04", "2024-01-10");
    expect("serie" in desdeEl2 && desdeEl2.serie).toEqual(serie(["2024-01-02", 100], ["2024-01-04", 95], ["2024-01-08", 120.5]));
    expect("serie" in desdeEl4 && desdeEl4.serie.map((punto) => punto.fecha)).toEqual(["2024-01-04", "2024-01-08"]);
    expect("serie" in desdeEl4 && desdeEl4.serie[1].valor).toBeCloseTo(130, 10);
  });

  it("sin datos de los fondos el primer día no arranca más tarde: lo dice", () => {
    const pronto = serieDeLaReferencia(EQUILIBRADO, "2023-12-01", "2024-01-10");
    expect(pronto).toEqual({ nombre: EQUILIBRADO.nombre, motivo: "Los dos fondos de la cartera de referencia no tienen datos desde el inicio del periodo (01-12-2023)." });
  });

  it("en el análisis, cambiar el periodo la recalcula", () => {
    const A = activo("A", "FONDO");
    const carteraA = cartera([A], [
      mov("aportacion", "2024-01-02", { importe: "1000" }),
      mov("suscripcion", "2024-01-02", { activoId: "A", titulos: "10", precio: "100", importe: "-1000" })
    ]);
    const preparado = preparar(carteraA, { precios: new Map([["A", serie(["2024-01-02", 100], ["2024-01-10", 102])]]), cambios: new Map() }, new Map(), "2024-01-10");
    const p1 = analizarConLaReferencia(preparado, { desde: "2024-01-02", hasta: "2024-01-10" }, EQUILIBRADO);
    const p2 = analizarConLaReferencia(preparado, { desde: "2024-01-04", hasta: "2024-01-10" }, EQUILIBRADO);
    expect(p1.referencia?.disponible).toBe(true);
    expect(p1.referencia?.serie[0]).toEqual({ fecha: "2024-01-02", valor: 100 });
    expect(p1.referencia?.rentabilidad).toBeCloseTo(0.205, 12);
    expect(p2.referencia?.serie[0]).toEqual({ fecha: "2024-01-04", valor: 100 });
    expect(p2.referencia?.rentabilidad).toBeCloseTo(0.3, 12);
    /* Sin datos de un fondo, la referencia no se da, con su motivo y no uno genérico. */
    const sinDatos = analizarConLaReferencia(preparado, { desde: "2024-01-02", hasta: "2024-01-10" }, { nombre: "Cartera de referencia Equilibrado", motivo: "Falta la serie." });
    expect(sinDatos.referencia).toMatchObject({ disponible: false, motivo: "Falta la serie.", rentabilidad: null, diferencia: null });
    expect(sinDatos.rentabilidad?.twr).toBeCloseTo(0.02, 12);
  });
});

/*
 * El €STR, a mano (ACT/360, días naturales, con el tipo del día publicado anterior):
 *   vie 5 ene 3,60 %, lun 8 ene 3,65 %, mar 9 ene 3,70 %.
 *   Desde el sábado 6: base 100 el viernes 5, último publicado en o antes.
 *   lun 8: 100 × (1 + 0,036 × 3/360) = 100,03
 *   mar 9: 100,03 × (1 + 0,0365 × 1/360) = 100,03 + 0,01014193055… = 100,04014193055…
 */
const ESTR = serie(["2024-01-05", 0.036], ["2024-01-08", 0.0365], ["2024-01-09", 0.037]);

describe("el índice del €STR capitalizado", () => {
  it("capitaliza a diario con ACT/360 por días naturales, como el de Python", () => {
    const indice = indiceDelEstr(ESTR, "2024-01-06", "2024-01-09");
    expect("serie" in indice).toBe(true);
    if (!("serie" in indice)) return;
    expect(indice.serie.map((punto) => punto.fecha)).toEqual(["2024-01-05", "2024-01-08", "2024-01-09"]);
    expect(indice.serie[0].valor).toBe(100);
    expect(indice.serie[1].valor).toBeCloseTo(100.03, 12);
    expect(indice.serie[2].valor).toBeCloseTo(100.04014193055, 10);
  });

  it("no se inventa: sin dato al inicio, con un hueco o atrasado, no hay índice y dice por qué", () => {
    expect(indiceDelEstr(ESTR, "2024-01-01", "2024-01-09")).toEqual({ motivo: "El €STR de la plataforma empieza el 05-01-2024, después del inicio del periodo: antes de su primer dato la liquidez no se inventa." });
    expect(indiceDelEstr(serie(["2024-01-05", 0.036], ["2024-01-15", 0.036]), "2024-01-05", "2024-01-15")).toEqual({
      motivo: "Al €STR de la plataforma le faltan los datos entre el 05-01-2024 y el 15-01-2024: la liquidez no se puede construir en este periodo."
    });
    expect(indiceDelEstr(ESTR, "2024-01-06", "2024-01-20")).toEqual({ motivo: "El €STR de la plataforma llega hasta el 09-01-2024: está atrasado para este periodo." });
    expect(indiceDelEstr([], "2024-01-06", "2024-01-09")).toEqual({ motivo: "La plataforma no tiene el €STR: no se puede construir la liquidez." });
  });

  it("como referencia, se construye desde el primer día del periodo", () => {
    const liquidez = serieDeLaReferencia({ nombre: "Liquidez (€STR)", estr: ESTR }, "2024-01-06", "2024-01-09");
    expect("serie" in liquidez && liquidez.serie[2].valor).toBeCloseTo(100.04014193055, 10);
    /* Un activo pasa tal cual. */
    expect(serieDeLaReferencia({ nombre: "Índice", serie: RF }, "2024-01-04", "2024-01-08")).toEqual({ nombre: "Índice", serie: RF });
  });
});
