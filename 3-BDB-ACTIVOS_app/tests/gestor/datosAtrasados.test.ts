/**
 * Auditoría integral del 16-11-2026, hallazgos GES-4 y GES-5. El refresco de los datos es a mano, y dos cosas envejecían
 * sin decirlo: el tipo de cambio con el que se valora lo que está en otra divisa, y el índice de referencia con el que se
 * compara la cartera.
 *
 * Las cifras esperadas salen de las cuentas a mano escritas junto a cada una.
 */
import { describe, expect, test } from "vitest";
import { RETRASO_MAXIMO_DE_LA_REFERENCIA, analizar, preparar } from "../../src/gestor/motor/analisis";
import { DIAS_DE_PRECIO_ANTIGUO, comprobarIntegridad } from "../../src/gestor/motor/integridad";
import { valorar, type DatosDeMercado } from "../../src/gestor/motor/valoracion";
import { activo, cartera, mov, serie, serieDiaria } from "./ayudas";

const TODO = { desde: "1900-01-01", hasta: "2100-01-01" };

describe("GES-4 · un tipo de cambio antiguo se dice", () => {
  /* 100 € aportados el 01-01-2024 y una acción en dólares a 125 USD, a 1,25 USD por euro. El precio llega hasta el 30-06. */
  const c = cartera(
    [activo("U", "ACCION", "USD")],
    [mov("aportacion", "2024-01-01", { importe: "100" }), mov("compra", "2024-01-01", { activoId: "U", titulos: "1", precio: "125", importe: "-100", cambio: "1.25" })]
  );
  const mercadoCon = (cambios: Array<[string, number]>): DatosDeMercado => ({
    precios: new Map([["U", serie(["2024-01-01", 125], ["2024-06-30", 125])]]),
    cambios: new Map([["USD", serie(...cambios)]])
  });
  const delCambio = (mercado: DatosDeMercado, hasta: string) =>
    comprobarIntegridad(c, valorar(c, mercado, { hasta }), hasta, mercado).avisos.filter((aviso) => aviso.codigo === "CAMBIO_ANTIGUO");

  test("con el cambio parado el 02-01, el 30-06 se valora con un cambio de hace 180 días, y se avisa", () => {
    const mercado = mercadoCon([["2024-01-01", 1.25], ["2024-01-02", 1.25]]);
    const v = valorar(c, mercado, { hasta: "2024-06-30" });
    /* La fecha del cambio usado consta: 02-01. Del 02-01 al 30-06 de 2024: 29 + 29 + 31 + 30 + 31 + 30 = 180 días. */
    expect(v.fechaDelCambio("USD", "2024-06-30")).toBe("2024-01-02");
    expect(v.fechaDelCambio("EUR", "2024-06-30")).toBeUndefined();
    expect(delCambio(mercado, "2024-06-30")).toEqual([
      {
        gravedad: "aviso",
        codigo: "CAMBIO_ANTIGUO",
        fecha: "2024-01-02",
        mensaje: "El último tipo de cambio USD/EUR es del 02/01/2024, de hace 180 días: con él se valora Activo U."
      }
    ]);
  });

  test("hasta una semana no avisa; al octavo día, sí: el mismo plazo que los precios", () => {
    expect(DIAS_DE_PRECIO_ANTIGUO).toBe(7);
    const mercado = mercadoCon([["2024-01-01", 1.25], ["2024-06-20", 1.25]]);
    /* Del 20-06 al 27-06 van 7 días; al 28-06, 8. */
    expect(delCambio(mercado, "2024-06-27")).toEqual([]);
    expect(delCambio(mercado, "2024-06-28").map((aviso) => aviso.mensaje)).toEqual([
      "El último tipo de cambio USD/EUR es del 20/06/2024, de hace 8 días: con él se valora Activo U."
    ]);
  });

  test("una cartera toda en euros no tiene de qué avisar", () => {
    const enEuros = cartera([activo("E")], [mov("aportacion", "2024-01-01", { importe: "100" }), mov("compra", "2024-01-01", { activoId: "E", titulos: "1", precio: "100", importe: "-100" })]);
    const mercado: DatosDeMercado = { precios: new Map([["E", serie(["2024-01-01", 100], ["2024-06-30", 100])]]), cambios: new Map() };
    expect(comprobarIntegridad(enEuros, valorar(enEuros, mercado, { hasta: "2024-06-30" }), "2024-06-30", mercado).avisos.some((aviso) => aviso.codigo === "CAMBIO_ANTIGUO")).toBe(false);
  });
});

describe("GES-5 · con un índice atrasado no hay comparación", () => {
  /* 1.000 € en 10 títulos de A a 100 € el 01-01-2024; A vale 120 € el 30-06: la cartera gana un 20 %. */
  const c = cartera(
    [activo("A")],
    [mov("aportacion", "2024-01-01", { importe: "1000" }), mov("compra", "2024-01-01", { activoId: "A", titulos: "10", precio: "100", importe: "-1000" })]
  );
  const mercado: DatosDeMercado = { precios: new Map([["A", serie(["2024-01-01", 100], ["2024-06-30", 120])]]), cambios: new Map() };
  const conLaSerie = (puntos: Array<{ fecha: string; valor: number }>) => analizar(preparar(c, mercado, new Map(), "2024-06-30"), TODO, { nombre: "Índice", serie: puntos }).referencia;
  const conIndice = (puntos: Array<[string, number]>) => conLaSerie(serie(...puntos));
  /* Desde el 20-11-2026 un índice con huecos de más de 7 días tampoco se compara (`referenciaConHuecos.test.ts`): el de
     estas pruebas, que antes eran dos datos sueltos, lleva un dato cada día, para que solo cuente lo atrasado que acaba. */
  const indiceDiario = (hasta: string) => conLaSerie(serieDiaria("2023-12-29", hasta, 100, 110));

  test("un índice que acaba en febrero ya no se compara: antes salía +1 % frente al +20 % de la cartera", () => {
    const referencia = conIndice([["2023-12-29", 100], ["2024-02-15", 101]]);
    expect(referencia?.disponible).toBe(false);
    expect(referencia?.rentabilidad).toBeNull();
    expect(referencia?.diferencia).toBeNull();
    expect(referencia?.motivo).toBe("El índice llega hasta el 15/02/2024: está atrasado para este periodo.");
  });

  test("al día se compara como siempre: el índice pasa de 100 a 110 (+10 %) y la cartera gana 10 puntos más", () => {
    const referencia = indiceDiario("2024-06-28");
    expect(referencia?.disponible).toBe(true);
    expect(referencia?.rentabilidad).toBeCloseTo(0.1, 12);
    /* 20 % − 10 % = 10 puntos. */
    expect(referencia?.diferencia).toBeCloseTo(0.1, 12);
  });

  test("el corte es de una semana: a 7 días del final se compara, a 8 no", () => {
    expect(RETRASO_MAXIMO_DE_LA_REFERENCIA).toBe(7);
    expect(indiceDiario("2024-06-23")?.disponible).toBe(true);
    expect(indiceDiario("2024-06-22")?.motivo).toBe("El índice llega hasta el 22/06/2024: está atrasado para este periodo.");
  });
});
