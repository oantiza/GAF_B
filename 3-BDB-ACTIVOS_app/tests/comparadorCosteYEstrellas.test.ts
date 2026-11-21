/**
 * Comparador de activos (auditoría de frontend, ACT-09 y ACT-21).
 * - ACT-09: la tabla gana la fila «Coste corriente», con el dato que ya trae cada activo (la tarjeta de
 *   la base nueva y, sin ella, el activo de siempre), «Falta el dato» cuando falta y «No aplica» en una
 *   acción.
 * - ACT-21: las estrellas de Morningstar se redondean y se acotan a [0, 5]: 3,5 no pinta cuatro
 *   estrellas a medias ni un 6 rompe la tabla.
 */
import { describe, expect, it } from "vitest";
import { costeCorrienteParaElInforme, filasDeActivos, type FuenteDeColumna } from "../src/adapters/comparativaDeActivos";

const activo = (id: string, tipo: string, extra: Record<string, unknown> = {}) =>
  ({ asset_id: id, isin: id, display_name: id, instrument_type: tipo, metrics: {}, ...extra }) as unknown as FuenteDeColumna["activo"];
const columna = (id: string) => ({ id }) as never;

describe("ACT-09: la fila del coste corriente", () => {
  const conTarjeta: FuenteDeColumna = {
    activo: activo("FONDO1", "FUND"),
    tarjeta: { instrument_type: "FUND", costs: { ongoing_charge: 0.0185 } } as unknown as FuenteDeColumna["tarjeta"]
  };
  const sinTarjeta: FuenteDeColumna = { activo: activo("FONDO2", "FUND", { costs: { ongoing_charge: 0.0062 } }) };
  const sinDato: FuenteDeColumna = {
    activo: activo("FONDO3", "FUND"),
    tarjeta: { instrument_type: "FUND", costs: { ongoing_charge: null } } as unknown as FuenteDeColumna["tarjeta"]
  };
  const accion: FuenteDeColumna = { activo: activo("ACCION", "STOCK") };

  it("lee el coste de cada activo, dice que falta cuando falta y que no aplica en una acción", () => {
    const fila = filasDeActivos([conTarjeta, sinTarjeta, sinDato, accion], { modoCliente: false }).find((f) => f.id === "coste-corriente");
    expect(fila?.titulo).toBe("Coste corriente");
    /* 0,0185 es un 1,85 %; 0,0062 es un 0,62 %. */
    /* Se comparan sin fijarse en qué espacio pone el formateador antes de «%». */
    expect(fila!.celda(columna("FONDO1")).texto?.replace(/\s/g, " ")).toBe("1,85 %");
    expect(fila!.celda(columna("FONDO2")).texto?.replace(/\s/g, " ")).toBe("0,62 %");
    expect(fila!.celda(columna("FONDO3"))).toEqual({ texto: "Falta el dato", ausencia: "falta" });
    expect(fila!.celda(columna("ACCION"))).toEqual({ texto: "No aplica", ausencia: "no-aplica" });
  });

  it("lo que se pasa al informe en PDF es la fracción, «no-aplica» en una acción y null si falta el dato", () => {
    const filas = filasDeActivos([conTarjeta, accion, sinDato], { modoCliente: false });
    expect(costeCorrienteParaElInforme(filas, columna("FONDO1"))).toBe(0.0185);
    expect(costeCorrienteParaElInforme(filas, columna("ACCION"))).toBe("no-aplica");
    expect(costeCorrienteParaElInforme(filas, columna("FONDO3"))).toBeNull();
    /* Sin la fila (solo acciones) el papel no la pinta, como la pantalla. */
    const soloAcciones = filasDeActivos([accion, { activo: activo("OTRA", "STOCK") }], { modoCliente: false });
    expect(costeCorrienteParaElInforme(soloAcciones, columna("ACCION"))).toBeUndefined();
  });

  it("en una tabla solo de acciones no sale: una fila entera de «No aplica» no dice nada", () => {
    const ids = filasDeActivos([accion, { activo: activo("OTRA", "STOCK") }], { modoCliente: false }).map((f) => f.id);
    expect(ids).not.toContain("coste-corriente");
  });
});

describe("ACT-21: las estrellas de Morningstar", () => {
  const estrellas = (rating: number) =>
    filasDeActivos([{ activo: activo("F", "FUND", { morningstar_rating: rating }) }], { modoCliente: false })
      .find((f) => f.id === "estrellas")!
      .celda(columna("F"));

  it("3,5 se redondea a 4 y 4,4 a 4", () => {
    expect(estrellas(3.5).texto).toBe("★★★★☆");
    expect(estrellas(4.4).texto).toBe("★★★★☆");
  });

  it("más de 5 se queda en 5, y la tabla no se rompe", () => {
    expect(() => estrellas(6)).not.toThrow();
    expect(estrellas(6).texto).toBe("★★★★★");
  });
});
