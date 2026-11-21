import { describe, expect, test } from "vitest";
import { ROTULO_DEL_REPARTO_12M } from "../src/adapters/componerFicha";
import { componerSalud, nombreDelAviso, rutaEnPalabras } from "../src/adapters/componerSalud";
import type { Documento } from "../src/adapters/baseNuevaLectura";

/**
 * La salud del catálogo.
 *
 * Lo que esta pantalla tiene que separar bien es lo único que la hace útil: un campo
 * que falta en TODOS los instrumentos no es un hueco de cobertura, es una decisión
 * pendiente o un cálculo que no se produce, y se arregla una vez. Medido el 02-11-2026
 * sobre las 1.077 calidades, hay once campos así —el Sortino en sus cuatro ventanas
 * entre ellos—, y mezclarlos con la cobertura normal los esconde.
 */

const calidad = (
  presentes: number,
  aplicables: number,
  ausencias: Array<[string, string]>,
  fitness: Record<string, boolean> = {},
  avisos: Array<[string, string]> = []
): Documento => ({
  present_paths: presentes,
  applicable_paths: aplicables,
  absences: ausencias.map(([path, reason]) => ({ path, reason })),
  fitness: Object.fromEntries(Object.entries(fitness).map(([k, apt]) => [k, { apt }])),
  warnings: avisos.map(([code, message]) => ({ code, message }))
});

describe("salud del catálogo", () => {
  const catalogo = [
    calidad(5, 10, [["a.figi", "NOT_PROVIDED"], ["b.sri", "NOT_APPLICABLE"]], { USO: true }),
    calidad(7, 10, [["a.figi", "NOT_PROVIDED"], ["c.indice", "NOT_YET_FETCHED"]], { USO: false })
  ];

  test("la cobertura es agregada, no la media de las coberturas", () => {
    const salud = componerSalud(catalogo);
    expect(salud.presentes).toBe(12);
    expect(salud.aplicables).toBe(20);
    expect(salud.cobertura).toBe(0.6);
  });

  test("separa las tres clases de ausencia, que no son lo mismo", () => {
    const salud = componerSalud(catalogo);
    expect(salud.porClase).toEqual({ falta: 2, noAplica: 1, sinPedir: 1 });
  });

  test("marca lo que falta en TODOS, que es lo que se arregla una vez", () => {
    const salud = componerSalud(catalogo);
    const figi = salud.rutas.find((r) => r.ruta === "a.figi");
    expect(figi).toMatchObject({ cuantos: 2, enTodos: true });
    expect(salud.rutas.find((r) => r.ruta === "b.sri")).toMatchObject({ enTodos: false });
  });

  test("las rutas salen de la que más falta a la que menos", () => {
    const salud = componerSalud(catalogo);
    for (let i = 1; i < salud.rutas.length; i += 1) {
      expect(salud.rutas[i - 1].cuantos).toBeGreaterThanOrEqual(salud.rutas[i].cuantos);
    }
  });

  test("las aptitudes salen de la PEOR a la mejor: lo que hay que arreglar, arriba", () => {
    const salud = componerSalud([
      calidad(1, 1, [], { BUENA: true, MALA: false }),
      calidad(1, 1, [], { BUENA: true, MALA: false })
    ]);
    expect(salud.aptitudes[0].clave).toBe("MALA");
    expect(salud.aptitudes[0]).toMatchObject({ si: 0, no: 2 });
  });

  test("los avisos se cuentan y conservan su mensaje, que es del dato", () => {
    const salud = componerSalud([
      calidad(1, 1, [], {}, [["SIN_X", "una explicación larga"]]),
      calidad(1, 1, [], {}, [["SIN_X", "una explicación larga"]])
    ]);
    expect(salud.avisos[0]).toMatchObject({ codigo: "SIN_X", cuantos: 2 });
    expect(salud.avisos[0].mensaje).toBe("una explicación larga");
  });

  test("cada aviso lleva su nombre escrito, con tildes; uno nuevo se escribe a partir de su código", () => {
    expect(nombreDelAviso("METRICAS_DE_MUESTREO_DIARIO")).toBe("Métricas de muestreo diario");
    expect(nombreDelAviso("POLITICA_DE_DISTRIBUCION_DESCONOCIDA")).toBe("Política de distribución desconocida");
    expect(nombreDelAviso("INDICE_SIN_DIVISA_NI_VARIANTE")).toBe("Índice sin divisa ni variante");
    expect(nombreDelAviso("OTRO_AVISO_NUEVO")).toBe("Otro aviso nuevo");
  });

  test("un dato se llama igual que en la ficha, y ninguno dice «rendimiento» (FMT-13)", () => {
    expect(rutaEnPalabras("declared/distributions.yield_12m")).toBe(ROTULO_DEL_REPARTO_12M);
    expect(rutaEnPalabras("declared/distributions.yield_12m")).toBe("Rentabilidad por reparto, 12 meses");
    expect(rutaEnPalabras("declared/costs.ongoing_charge")).toBe("Coste corriente");
  });

  test("un catálogo vacío no divide entre cero", () => {
    const salud = componerSalud([]);
    expect(salud.cobertura).toBe(0);
    expect(salud.instrumentos).toBe(0);
    expect(salud.rutas).toEqual([]);
  });
});
