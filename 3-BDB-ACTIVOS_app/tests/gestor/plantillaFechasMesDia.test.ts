/**
 * Auditoría integral del 16-11-2026, hallazgo GES-12 (la parte de las fechas). La plantilla leía toda fecha con barras como
 * día/mes. Un fichero exportado en mes/día entraba mal sin decirlo: «04/25/2026» se rechazaba («no entiendo la fecha») y
 * «03/04/2026», que es el 4 de marzo, entraba como el 3 de abril.
 *
 * Una fecha con un número mayor que 12 solo se puede leer de una manera, y eso es lo que decide el orden de todo el fichero.
 */
import { describe, expect, it } from "vitest";
import { importadorDePlantilla } from "../../src/gestor/importacion/plantilla";
import { leerFecha, ordenDeLasFechas } from "../../src/gestor/importacion/plantilla/leer";
import type { DocumentoLeido } from "../../src/gestor/importacion/tipos";

const CABECERA = ["Fecha", "Tipo", "Importe"];

function documento(filas: string[][], nombre = "movimientos.csv"): DocumentoLeido {
  const tabla = [CABECERA, ...filas];
  return { nombre, texto: tabla.map((fila) => fila.join(";")).join("\n"), tablas: [tabla] };
}

const importar = (filas: string[][]) => importadorDePlantilla.importar([{ documento: documento(filas), tipo: "movimientos" }], { divisaBase: "EUR" });
const fechasDe = (filas: string[][]) => importar(filas).movimientos.map((propuesto) => propuesto.movimiento.fechaOperacion);

describe("GES-12 · el orden de día y mes lo dicen las propias fechas", () => {
  it("una sola fecha con el segundo número mayor que 12 decide que el fichero viene en mes/día", () => {
    /* «04/25/2026» no puede ser día/mes: no hay mes 25. */
    expect(ordenDeLasFechas(["03/04/2026", "04/25/2026", "12/01/2026"])).toEqual({ orden: "mes-dia", soloMesDia: 1, soloDiaMes: 0, contradictorio: false });
    /* «25/04/2026» no puede ser mes/día: decide día/mes. */
    expect(ordenDeLasFechas(["03/04/2026", "25/04/2026"])).toEqual({ orden: "dia-mes", soloMesDia: 0, soloDiaMes: 1, contradictorio: false });
  });

  it("sin ninguna fecha que decida, día/mes: es como se escribe aquí", () => {
    expect(ordenDeLasFechas(["03/04/2026", "12/01/2026"]).orden).toBe("dia-mes");
    /* Las fechas ISO y los números de Excel no dicen nada del orden. */
    expect(ordenDeLasFechas(["2026-04-25", "46339", ""])).toEqual({ orden: "dia-mes", soloMesDia: 0, soloDiaMes: 0, contradictorio: false });
  });

  it("con fechas de las dos clases el fichero se contradice, y se lee como día/mes", () => {
    expect(ordenDeLasFechas(["25/04/2026", "04/25/2026"])).toEqual({ orden: "dia-mes", soloMesDia: 1, soloDiaMes: 1, contradictorio: true });
  });

  it("leerFecha lee en el orden que se le dice, y sin decírselo, día/mes como siempre", () => {
    expect(leerFecha("03/04/2026")).toBe("2026-04-03");
    expect(leerFecha("03/04/2026", "mes-dia")).toBe("2026-03-04");
    expect(leerFecha("04/25/2026", "mes-dia")).toBe("2026-04-25");
    expect(leerFecha("04/25/2026")).toBeUndefined();
    /* El orden no toca a las ISO ni a los números de Excel. */
    expect(leerFecha("2026-04-03", "mes-dia")).toBe("2026-04-03");
    expect(leerFecha("46339", "mes-dia")).toBe("2026-11-13");
  });
});

describe("GES-12 · un fichero en mes/día entra con sus fechas, y se dice", () => {
  const EN_MES_DIA = [
    ["03/04/2026", "Aportación", "1000"],
    ["04/25/2026", "Aportación", "500"],
    ["12/01/2026", "Retirada", "200"]
  ];

  it("las tres fechas se leen en mes/día: 4 de marzo, 25 de abril y 1 de diciembre", () => {
    /* Antes: 3 de abril, sin fecha y 12 de enero. Salen ordenadas por fecha. */
    expect(fechasDe(EN_MES_DIA)).toEqual(["2026-03-04", "2026-04-25", "2026-12-01"]);
  });

  it("y un aviso dice cómo se han leído, para que se compruebe", () => {
    expect(importar(EN_MES_DIA).avisos).toContain(
      "«movimientos.csv»: las fechas vienen como mes/día/año (hay una que solo se puede leer así) y se han leído todas en ese orden. Compruébalo: «03/04/2026» se ha tomado como el 4 de marzo."
    );
  });

  it("un fichero en día/mes se lee como siempre, sin aviso de fechas", () => {
    const resultado = importar([
      ["03/04/2026", "Aportación", "1000"],
      ["25/04/2026", "Aportación", "500"]
    ]);
    expect(resultado.movimientos.map((propuesto) => propuesto.movimiento.fechaOperacion)).toEqual(["2026-04-03", "2026-04-25"]);
    expect(resultado.avisos.filter((aviso) => aviso.includes("fechas"))).toEqual([]);
  });

  it("si el fichero se contradice, se lee como día/mes, la que no encaja se queda sin fecha y se dice", () => {
    const resultado = importar([
      ["25/04/2026", "Aportación", "1000"],
      ["04/26/2026", "Aportación", "500"]
    ]);
    expect(resultado.avisos).toContain(
      "«movimientos.csv»: hay fechas que solo pueden ser día/mes y otras que solo pueden ser mes/día. Se han leído como día/mes, y las que no encajan se han quedado sin fecha: revisa el fichero."
    );
    const [conFecha, sinFecha] = resultado.movimientos;
    expect(conFecha.movimiento.fechaOperacion).toBe("2026-04-25");
    expect(sinFecha.movimiento.fechaOperacion).toBe("");
    expect(sinFecha.requiereRevision).toBe(true);
  });
});
