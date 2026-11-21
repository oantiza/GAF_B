/**
 * Series ajustadas por dividendos: el precio real se reconstruye con los dividendos del libro.
 *
 * En cada caso se parte de los precios REALES que tuvo el activo, se construye a mano la serie
 * ajustada que publicaría un proveedor (los precios anteriores a un dividendo, rebajados) y se
 * comprueba que la valoración recupera los valores reales.
 */
import { describe, expect, it } from "vitest";
import { desgloseDelPeriodo } from "../../src/gestor/motor/desglose";
import { rentabilidadDelPeriodo } from "../../src/gestor/motor/rentabilidad";
import { valorar, type DatosDeMercado } from "../../src/gestor/motor/valoracion";
import { activo, cartera, mov, serie } from "./ayudas";

const TODO = { desde: "1900-01-01", hasta: "2100-01-01" };
const redondo = (valores: Float64Array): number[] => [...valores].map((x) => Number(x.toFixed(6)));

function mercado(precios: Record<string, Array<[string, number]>>, ajustadas: string[], cambios: Record<string, Array<[string, number]>> = {}): DatosDeMercado {
  return {
    precios: new Map(Object.entries(precios).map(([id, puntos]) => [id, serie(...puntos)])),
    cambios: new Map(Object.entries(cambios).map(([divisa, puntos]) => [divisa, serie(...puntos)])),
    ajustadasPorDividendos: new Set(ajustadas)
  };
}

describe("una acción que paga un dividendo", () => {
  /*
   * Precios reales: 100, 100, 95 (el día 3 paga 5 € brutos por título y cae esos 5 €) y 104,50 (+10 %).
   * Serie ajustada del proveedor: lo anterior al dividendo, multiplicado por 95/100 → 95, 95, 95 y 104,50.
   *
   * Diez títulos comprados a 100 €. El dividendo: 50 € brutos, 9,50 € de retención, 40,50 € netos.
   *
   *   día 1  10 × 100 = 1.000 €
   *   día 2  10 × 100 = 1.000 €
   *   día 3  10 × 95 + 40,50 = 990,50 €     (se pierde la retención: −9,50 €)
   *   día 4  10 × 104,50 + 40,50 = 1.085,50 €
   *
   * Factor del día 1 y 2: 1 + 5 / 95 = 1,052632; 95 × 1,052632 = 100. Desde el día 3, factor 1.
   */
  const c = cartera([activo("ACC")], [
    mov("aportacion", "2024-01-01", { importe: "1000" }),
    mov("compra", "2024-01-01", { activoId: "ACC", titulos: "10", precio: "100", importe: "-1000" }),
    mov("dividendo", "2024-01-03", { activoId: "ACC", importe: "40.50", retencion: "9.50" })
  ]);
  const precios: Array<[string, number]> = [["2024-01-01", 95], ["2024-01-02", 95], ["2024-01-03", 95], ["2024-01-04", 104.5]];

  it("se valora a su precio real de cada día, no al de la serie ajustada", () => {
    const v = valorar(c, mercado({ ACC: precios }, ["ACC"]), { hasta: "2024-01-04" });
    expect(redondo(v.valor)).toEqual([1000, 1000, 990.5, 1085.5]);
    expect(redondo(v.porActivo.get("ACC")!.precio)).toEqual([100, 100, 95, 104.5]);
  });

  it("el dividendo cuenta una sola vez: baja el precio y entra como ingreso", () => {
    const v = valorar(c, mercado({ ACC: precios }, ["ACC"]), { hasta: "2024-01-04" });
    const d = desgloseDelPeriodo(v, TODO)!;
    expect(d.precio).toBeCloseTo(45, 9); //      de 100 a 104,50 por título: +4,50 × 10
    expect(d.ingresos).toBeCloseTo(40.5, 9); //  el dividendo neto
    expect(d.resultado).toBeCloseTo(85.5, 9); // 1.085,50 − 1.000
    // TWR: (990,50 / 1.000) × (1.085,50 / 990,50) − 1 = 8,55 %
    expect(rentabilidadDelPeriodo(v, TODO)!.twr).toBeCloseTo(0.0855, 12);
  });

  it("sin reconstruir el precio, el día de la compra saldría una pérdida que no existe", () => {
    const sinAjuste = valorar(c, mercado({ ACC: precios }, []), { hasta: "2024-01-04" });
    expect(redondo(sinAjuste.valor)).toEqual([950, 950, 990.5, 1085.5]); // −5 % falso el primer día
  });
});

describe("una posición ya vendida", () => {
  it("se ancla en el precio de su venta, porque la serie lleva dividendos posteriores que el libro no conoce", () => {
    /*
     * Se compran 10 títulos a 100 € y se venden al día siguiente a 110 €. Años después la acción ha
     * pagado dividendos y la serie ajustada marca 90 y 99 esos dos días (todo rebajado un 10 %).
     * Factor: 110 / 99 = 1,1111; día 1: 90 × 1,1111 = 100. Valores: 1.000 € y 1.100 €. TWR 10 %.
     */
    const c = cartera([activo("ACC")], [
      mov("aportacion", "2020-03-02", { importe: "1000" }),
      mov("compra", "2020-03-02", { activoId: "ACC", titulos: "10", precio: "100", importe: "-1000" }),
      mov("venta", "2020-03-03", { activoId: "ACC", titulos: "10", precio: "110", importe: "1100" })
    ]);
    const v = valorar(c, mercado({ ACC: [["2020-03-02", 90], ["2020-03-03", 99], ["2026-11-06", 150]] }, ["ACC"]));
    expect(redondo(v.valor)).toEqual([1000, 1100]);
    expect(rentabilidadDelPeriodo(v, TODO)!.twr).toBeCloseTo(0.1, 12);
  });
});

describe("un dividendo en acciones", () => {
  it("no produce un salto: la serie lo trata como un dividendo y los títulos nuevos lo compensan", () => {
    /*
     * 20 títulos a 100 €. La empresa entrega 1 acción nueva por cada 20: el precio real pasa de 100 a
     * 100 / 1,05 = 95,238 € y el accionista tiene 21 títulos: 21 × 95,238 = 2.000 €, lo mismo que antes.
     * La serie ajustada marca 95,238 los dos días. Factor antes de la entrega: 21 / 20 = 1,05.
     */
    const precio = 100 / 1.05;
    const c = cartera([activo("ACC")], [
      mov("aportacion", "2024-01-01", { importe: "2000" }),
      mov("compra", "2024-01-01", { activoId: "ACC", titulos: "20", precio: "100", importe: "-2000" }),
      mov("dividendoEnAcciones", "2024-01-02", { activoId: "ACC", titulos: "1" })
    ]);
    const v = valorar(c, mercado({ ACC: [["2024-01-01", precio], ["2024-01-02", precio]] }, ["ACC"]));
    expect(redondo(v.valor)).toEqual([2000, 2000]);
    expect([...v.rentabilidad]).toEqual([0, 0]);
  });
});

describe("un dividendo de una acción en dólares cobrado en euros", () => {
  it("pasa el bruto a la divisa del activo con el cambio de la operación", () => {
    /*
     * Cambio fijo de 1,25 USD por EUR. Precio real: 51,25 USD y, tras pagar 1,25 USD por título, 50 USD.
     * Serie ajustada: 50 y 50. Diez títulos: 512,50 USD = 410 €.
     * Dividendo: 12,50 USD brutos = 10 €; retención 2 €; neto 8 €.
     *   día 1  512,50 USD / 1,25 = 410 €
     *   día 2  500 USD / 1,25 = 400 € + 8 € = 408 €   (−2 € de retención)
     * Factor del día 1: 1 + 1,25 / 50 = 1,025; 50 × 1,025 = 51,25.
     */
    const c = cartera([activo("USA", "ACCION", "USD")], [
      mov("aportacion", "2024-01-01", { importe: "410" }),
      mov("compra", "2024-01-01", { activoId: "USA", titulos: "10", precio: "51.25", cambio: "1.25", importe: "-410" }),
      mov("dividendo", "2024-01-02", { activoId: "USA", importe: "8", retencion: "2", cambio: "1.25" })
    ]);
    const m = mercado({ USA: [["2024-01-01", 50], ["2024-01-02", 50]] }, ["USA"], { USD: [["2024-01-01", 1.25]] });
    const v = valorar(c, m);
    expect(redondo(v.valor)).toEqual([410, 408]);
    const d = desgloseDelPeriodo(v, TODO)!;
    expect(d.precio).toBeCloseTo(-10, 9); // 12,50 USD menos de precio = 10 €
    expect(d.ingresos).toBeCloseTo(8, 9);
    expect(d.divisa).toBeCloseTo(0, 9);
  });
});

describe("lo que no se ajusta", () => {
  it("un fondo (valor liquidativo sin ajustar) se valora tal cual, aunque reparta", () => {
    const c = cartera([activo("FON", "FONDO")], [
      mov("aportacion", "2024-01-01", { importe: "1000" }),
      mov("suscripcion", "2024-01-01", { activoId: "FON", titulos: "10", precio: "100", importe: "-1000" }),
      mov("dividendo", "2024-01-02", { activoId: "FON", importe: "40.50", retencion: "9.50" })
    ]);
    // El valor liquidativo de un fondo de reparto cae de verdad el día del reparto: 100 → 95.
    const v = valorar(c, mercado({ FON: [["2024-01-01", 100], ["2024-01-02", 95]] }, []));
    expect(redondo(v.valor)).toEqual([1000, 990.5]);
  });
});

describe("un dividendo que no se ha registrado", () => {
  /*
   * Diez títulos comprados a 100 € el 1 de enero. En marzo la acción paga 5 € por título y la serie del proveedor
   * rebaja todo lo anterior: marca 95 el día de la compra. Si el dividendo NO está en el libro, el precio que sale
   * de la serie ese día es 95 y lo pagado, 100: un 5,3 % por encima. Es la señal de que falta un dividendo.
   */
  const precios: Array<[string, number]> = [["2024-01-01", 95], ["2024-03-15", 95], ["2024-06-30", 95]];
  const compra = [
    mov("aportacion", "2024-01-01", { importe: "1000" }),
    mov("compra", "2024-01-01", { activoId: "ACC", titulos: "10", precio: "100", importe: "-1000" })
  ];

  it("se avisa, diciendo desde cuándo mirar", () => {
    const v = valorar(cartera([activo("ACC")], compra), mercado({ ACC: precios }, ["ACC"]), { hasta: "2024-06-30" });
    const aviso = v.avisos.find((candidato) => candidato.codigo === "DIVIDENDOS_SIN_REGISTRAR");
    expect(aviso?.activoId).toBe("ACC");
    expect(aviso?.desde).toBe("2024-01-01");
    expect(aviso?.mensaje).toContain("5,3 %"); // 100 / 95 − 1
  });

  it("con el dividendo anotado no hay aviso", () => {
    const conDividendo = [...compra, mov("dividendo", "2024-03-15", { activoId: "ACC", importe: "40.50", retencion: "9.50" })];
    const v = valorar(cartera([activo("ACC")], conDividendo), mercado({ ACC: precios }, ["ACC"]), { hasta: "2024-06-30" });
    expect(v.avisos).toEqual([]);
  });

  describe("y un dividendo anotado por su neto, que no es un dividendo que falte", () => {
    /*
     * La acción valía 100 € y pagó 30 € brutos por título: cayó a 70 €, y la serie del proveedor marca 70 también antes.
     * Diez títulos comprados a 100 €. El banco abona el dividendo NETO, sin decir la retención.
     */
    const plana: Array<[string, number]> = [["2024-01-01", 70], ["2024-03-15", 70], ["2024-06-30", 70]];
    const con = (isin: string, netoTotal: string) =>
      valorar(
        cartera([activo("ACC", "ACCION", "EUR", { isin })], [...compra, mov("dividendo", "2024-03-15", { activoId: "ACC", importe: netoTotal })]),
        mercado({ ACC: plana }, ["ACC"]),
        { hasta: "2024-06-30" }
      );

    it("un valor español con su 19 % retenido no avisa", () => {
      /* Neto 24,30 € por título. Con él solo, el precio del día de la compra sale 70 + 24,30 = 94,30 €: un 6,0 % por debajo
         de lo pagado, y antes avisaba. Contando con una retención de hasta el 20 %: 70 + 24,30 / 0,8 = 100,38 €. Cuadra. */
      const v = con("ES0000000001", "243");
      expect(v.avisos).toEqual([]);
      /* Y la valoración no cambia por ello: el día de la compra, 10 × 94,30 €. */
      expect(v.valor[0]).toBeCloseTo(943, 6);
    });

    it("pero si ni con la retención cuadra, se avisa con lo que sigue sin explicarse", () => {
      /* Solo consta un neto de 8,10 € por título: 70 + 8,10 / 0,8 = 80,125 €; lo pagado, 100 €: un 24,8 % por encima. */
      const aviso = con("ES0000000001", "81").avisos.find((candidato) => candidato.codigo === "DIVIDENDOS_SIN_REGISTRAR");
      expect(aviso?.mensaje).toContain("24,8 %");
      expect(aviso?.mensaje).toContain("ampliación de capital");
    });

    it("un valor extranjero admite además la retención de su país", () => {
      /* Neto 19,80 € por título (34 % retenido entre origen y España): 70 + 19,80 / 0,54 = 106,67 €. No avisa. */
      expect(con("US0000000001", "198").avisos).toEqual([]);
      /* El mismo neto en un valor español no se explica con el 20 %: 70 + 19,80 / 0,8 = 94,75 €; un 5,5 % por encima. */
      const aviso = con("ES0000000001", "198").avisos.find((candidato) => candidato.codigo === "DIVIDENDOS_SIN_REGISTRAR");
      expect(aviso?.mensaje).toContain("5,5 %");
    });

    it("con la retención anotada no se supone ninguna", () => {
      /* 24,30 € netos y 5,70 € de retención por título: 30 € brutos, y 70 + 30 = 100 €. Cuadra sin suponer nada. */
      const v = valorar(
        cartera([activo("ACC", "ACCION", "EUR", { isin: "ES0000000001" })], [...compra, mov("dividendo", "2024-03-15", { activoId: "ACC", importe: "243", retencion: "57" })]),
        mercado({ ACC: plana }, ["ACC"]),
        { hasta: "2024-06-30" }
      );
      expect(v.avisos).toEqual([]);
      expect(v.valor[0]).toBeCloseTo(1000, 6);
    });
  });

  it("una compra reciente no avisa: la diferencia puede ser el movimiento del día", () => {
    const v = valorar(cartera([activo("ACC")], compra), mercado({ ACC: precios.slice(0, 1).concat([["2024-02-15", 95]]) }, ["ACC"]), { hasta: "2024-02-15" });
    expect(v.avisos).toEqual([]);
  });
});
