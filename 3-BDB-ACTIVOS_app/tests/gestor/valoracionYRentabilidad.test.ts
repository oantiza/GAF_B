/**
 * Valoración, TWR, TIR, desglose y contribución, con carteras pequeñas calculadas a mano.
 *
 * Cada cifra esperada lleva su cuenta al lado. Ninguna sale del motor.
 */
import { describe, expect, it } from "vitest";
import { xirr } from "../../src/core/xirr";
import { desgloseDelPeriodo } from "../../src/gestor/motor/desglose";
import { anualizar, rentabilidadDelPeriodo, rentabilidadPorMeses, serieBase100, tirDeFlujos } from "../../src/gestor/motor/rentabilidad";
import { FUENTE, valorar, type DatosDeMercado } from "../../src/gestor/motor/valoracion";
import { activo, cartera, mov, serie } from "./ayudas";

const mercado = (precios: Record<string, Array<[string, number]>>, cambios: Record<string, Array<[string, number]>> = {}): DatosDeMercado => ({
  precios: new Map(Object.entries(precios).map(([id, puntos]) => [id, serie(...puntos)])),
  cambios: new Map(Object.entries(cambios).map(([divisa, puntos]) => [divisa, serie(...puntos)]))
});

const TODO = { desde: "1900-01-01", hasta: "2100-01-01" };
const pct = (valor: number | null | undefined, decimales = 4): string => (valor === null || valor === undefined ? "sin dato" : (valor * 100).toFixed(decimales));

describe("rentabilidad ponderada por tiempo (TWR)", () => {
  /*
   * Diez títulos comprados a 100. Suben a 110, se aportan 1.100 € más (que se quedan en
   * efectivo) y los títulos suben a 121.
   *
   *   día 1  V = 1.000            entra 1.000   r = 1.000 / (0 + 1.000) − 1     = 0
   *   día 2  V = 1.100                          r = 1.100 / 1.000 − 1           = 10 %
   *   día 3  V = 1.100 + 1.100    entra 1.100   r = 2.200 / (1.100 + 1.100) − 1 = 0
   *   día 4  V = 1.210 + 1.100                  r = 2.310 / 2.200 − 1           = 5 %
   *   día 5  V = 2.310 − 500      salen 500     r = (1.810 + 500) / 2.310 − 1   = 0
   *
   * TWR = 1,10 × 1,05 − 1 = 15,5 %. La aportación y la retirada no la mueven.
   */
  const c = cartera([activo("ACC")], [
    mov("aportacion", "2024-01-01", { importe: "1000" }),
    mov("compra", "2024-01-01", { activoId: "ACC", titulos: "10", precio: "100", importe: "-1000" }),
    mov("aportacion", "2024-01-03", { importe: "1100" }),
    mov("retirada", "2024-01-05", { importe: "-500" })
  ]);
  const m = mercado({ ACC: [["2024-01-01", 100], ["2024-01-02", 110], ["2024-01-04", 121]] });
  const v = valorar(c, m);

  it("valora cada día y mide su rentabilidad sin que los flujos la alteren", () => {
    expect(v.dias).toEqual(["2024-01-01", "2024-01-02", "2024-01-03", "2024-01-04", "2024-01-05"]);
    expect([...v.valor]).toEqual([1000, 1100, 2200, 2310, 1810]);
    expect([...v.entradas]).toEqual([1000, 0, 1100, 0, 0]);
    expect([...v.salidas]).toEqual([0, 0, 0, 0, -500]);
    expect([...v.rentabilidad].map((r) => pct(r))).toEqual(["0.0000", "10.0000", "0.0000", "5.0000", "0.0000"]);
  });

  it("da la rentabilidad y el resultado de todo el periodo", () => {
    const r = rentabilidadDelPeriodo(v, TODO)!;
    expect(pct(r.twr)).toBe("15.5000");
    expect(r.valorInicial).toBe(0);
    expect(r.valorFinal).toBe(1810);
    expect(r.aportacionesNetas).toBe(1600); // 1.000 + 1.100 − 500
    expect(r.resultado).toBeCloseTo(210, 9); // 1.810 − 1.600: 100 € de la primera subida y 110 € de la segunda
    expect(r.twrAnualizada).toBeNull(); // cinco días no se anualizan
    expect(r.anualiza).toBe(false);
  });

  it("mide entre dos fechas cualesquiera, desde el cierre de la primera", () => {
    const r = rentabilidadDelPeriodo(v, { desde: "2024-01-02", hasta: "2024-01-04" })!;
    expect(r.valorInicial).toBe(1100);
    expect(r.valorFinal).toBe(2310);
    expect(r.aportacionesNetas).toBe(1100);
    expect(r.resultado).toBeCloseTo(110, 9); // 2.310 − 1.100 − 1.100
    expect(pct(r.twr)).toBe("5.0000");
    expect(serieBase100(v, { desde: "2024-01-02", hasta: "2024-01-04" }).map((p) => [p.fecha, Number(p.valor.toFixed(6))])).toEqual([
      ["2024-01-02", 100],
      ["2024-01-03", 100],
      ["2024-01-04", 105]
    ]);
  });

  it("no hay rentabilidad antes del primer movimiento ni en un periodo vacío", () => {
    expect(rentabilidadDelPeriodo(v, { desde: "2023-01-01", hasta: "2023-12-31" })).toBeUndefined();
    expect(rentabilidadDelPeriodo(v, { desde: "2024-01-04", hasta: "2024-01-04" })).toBeUndefined();
  });
});

describe("rentabilidad del cliente (TIR)", () => {
  /*
   * 1.000 € el 1 de enero de 2024 y otros 1.000 € a mitad de periodo; al final hay 2.152,50 €.
   * El periodo dura 366 días (de la víspera, 31-12-2023, al 31-12-2024) y la segunda aportación
   * entra con 183 días cumplidos: justo la mitad. Con y = (1 + R)^(1/2):
   *
   *     1.000 y² + 1.000 y = 2.152,50   →   y = 1,05   →   R = 1,05² − 1 = 10,25 %
   *
   * La TWR de la misma cartera es otra cosa: el único día con resultado es el último,
   * 2.152,50 / 2.000 − 1 = 7,625 %. La TIR es mayor porque la mitad del dinero estuvo menos tiempo.
   */
  const c = cartera([], [
    mov("aportacion", "2024-01-01", { importe: "1000" }),
    mov("aportacion", "2024-07-02", { importe: "1000" }),
    mov("interes", "2024-12-31", { importe: "152.50" })
  ]);
  const r = rentabilidadDelPeriodo(valorar(c), TODO)!;

  it("resuelve la tasa que iguala lo aportado con lo que hay", () => {
    expect(r.dias).toBe(366);
    expect(pct(r.tir, 6)).toBe("10.250000");
    expect(pct(r.twr, 6)).toBe("7.625000");
  });

  it("el año natural 2024 (366 días) es un año y se anualiza por fechas", () => {
    /* GES-12 (decisión de Óscar del 17-11-2026): desde 365 días se anualiza, también un año bisiesto. Años = 366 / 365,2425:
         TIR: 1,1025^(365,2425 / 366) − 1 = 1,1025^0,997930 − 1 = 10,2277 %.
         TWR: 1,07625^(365,2425 / 366) − 1 = 7,6086 %. */
    expect(r.anualiza).toBe(true);
    expect(r.tirAnualizada).toBeCloseTo(0.1022773624, 9);
    expect(r.twrAnualizada).toBeCloseTo(0.0760863307, 9);
    expect(anualizar(0.21, 730.485)).toBeCloseTo(0.1, 12); // 21 % en dos años exactos es un 10 % anual
    // (1 + 10,25 %)^(365,2425 / 367) − 1, si el periodo durase un día más
    expect(anualizar(0.1025, 367)).toBeCloseTo(Math.pow(1.1025, 365.2425 / 367) - 1, 12);
  });

  it("coincide con la TIR que ya usa la app (core/xirr.ts)", () => {
    const anual = xirr([
      { date: new Date("2023-12-31T00:00:00Z"), amount: -1000 },
      { date: new Date("2024-07-01T00:00:00Z"), amount: -1000 }, // inicio del 2 de julio = cierre del 1
      { date: new Date("2024-12-31T00:00:00Z"), amount: 2152.5 }
    ])!;
    expect(Math.pow(1 + anual, 366 / 365.2425) - 1).toBeCloseTo(r.tir!, 7);
  });

  it("un caso de libro: 1.000 € que se hacen 1.100 € en un periodo", () => {
    expect(tirDeFlujos([{ dia: 0, importe: -1000 }, { dia: 365, importe: 1100 }], 365)).toBeCloseTo(0.1, 12);
    expect(tirDeFlujos([{ dia: 0, importe: -1000 }, { dia: 10, importe: 500 }], 10)).toBeCloseTo(-0.5, 12);
  });

  it("no inventa una tasa cuando no la hay", () => {
    expect(tirDeFlujos([{ dia: 0, importe: 1000 }, { dia: 10, importe: 500 }], 10)).toBeNull(); // todo del mismo signo
    expect(tirDeFlujos([{ dia: 0, importe: -1000 }], 0)).toBeNull();
  });
});

describe("desglose del resultado y contribución, con divisa", () => {
  /*
   * Cartera en euros con una acción en dólares. El cambio es dólares por euro.
   *
   *   día 1  cambio 1,25  precio 100 USD   Se aportan 1.000 € y se compran 10 títulos: 1.000 USD = 800 €.
   *          posición 800 €, efectivo 200 €, V = 1.000 €.
   *   día 2  cambio 1,25  precio 110 USD   posición 1.100 USD = 880 €. Sube 100 USD = 80 € por PRECIO.
   *          Además se carga una comisión de custodia de 5 €. V = 880 + 195 = 1.075 €.  r = 7,5 %
   *   día 3  cambio 1,00  precio 110 USD   posición 1.100 USD = 1.100 €. Sube 220 € solo por DIVISA.
   *          Se cobra un dividendo neto de 17 €. V = 1.100 + 195 + 17 = 1.312 €.  r = 1.312 / 1.075 − 1
   *
   *   Resultado: 1.312 − 1.000 = 312 € = 80 (precio) + 17 (ingresos) + 220 (divisa) − 5 (costes).
   *   TWR = 1.312 / 1.000 − 1 = 31,2 % (no hay flujos tras el primer día).
   *   Contribución de la acción: 80 / 1.000 + (220 + 17) / 1.075 × 1,075 = 0,08 + 0,237 = 31,7 puntos.
   *   Contribución del efectivo (la comisión): −5 / 1.000 = −0,5 puntos.  Suma: 31,2.
   */
  const c = cartera([activo("USA", "ACCION", "USD")], [
    mov("aportacion", "2024-01-01", { importe: "1000" }),
    mov("compra", "2024-01-01", { activoId: "USA", titulos: "10", precio: "100", cambio: "1.25", importe: "-800" }),
    mov("comision", "2024-01-02", { importe: "-5" }),
    mov("dividendo", "2024-01-03", { activoId: "USA", importe: "17", retencion: "3" })
  ]);
  const m = mercado(
    { USA: [["2024-01-01", 100], ["2024-01-02", 110], ["2024-01-03", 110]] },
    { USD: [["2024-01-01", 1.25], ["2024-01-02", 1.25], ["2024-01-03", 1.0]] }
  );
  const v = valorar(c, m);
  const d = desgloseDelPeriodo(v, TODO)!;

  it("valora en la divisa base con el cambio de cada día", () => {
    expect([...v.valor].map((x) => Number(x.toFixed(6)))).toEqual([1000, 1075, 1312]);
    expect([...v.porActivo.get("USA")!.valor].map((x) => Number(x.toFixed(6)))).toEqual([800, 880, 1100]);
  });

  it("separa precio, ingresos, divisa y costes, y la suma es el resultado", () => {
    expect(d.precio).toBeCloseTo(80, 9);
    expect(d.ingresos).toBeCloseTo(17, 9);
    expect(d.divisa).toBeCloseTo(220, 9);
    expect(d.costes).toBeCloseTo(5, 9);
    expect(d.resultado).toBeCloseTo(312, 9);
    expect(d.resultado).toBeCloseTo(rentabilidadDelPeriodo(v, TODO)!.resultado, 9);
    expect(d.cuadrado).toEqual({ precio: 80, ingresos: 17, divisa: 220, costes: 5, resultado: 312 });
  });

  it("la contribución de cada posición suma la rentabilidad de la cartera", () => {
    const usa = d.posiciones.find((p) => p.activoId === "USA")!;
    expect(usa.contribucion).toBeCloseTo(0.317, 12);
    expect(d.efectivo.contribucion).toBeCloseTo(-0.005, 12);
    expect(d.contribucionTotal).toBeCloseTo(0.312, 12);
    expect(d.contribucionTotal).toBeCloseTo(rentabilidadDelPeriodo(v, TODO)!.twr, 12);
    expect(usa.resultado).toBeCloseTo(317, 9); // 80 + 220 + 17
  });

  it("un activo en la divisa base no tiene efecto divisa", () => {
    const enEuros = cartera([activo("ACC")], [
      mov("aportacion", "2024-01-01", { importe: "1000" }),
      mov("compra", "2024-01-01", { activoId: "ACC", titulos: "10", precio: "100", comision: "7.35", importe: "-1007.35" })
    ]);
    const desglose = desgloseDelPeriodo(valorar(enEuros, mercado({ ACC: [["2024-01-01", 100], ["2024-01-02", 103.37]] }), { hasta: "2024-01-02" }), TODO)!;
    expect(desglose.divisa).toBe(0);
    // La comisión de la compra va dentro del precio pagado: 10 × 103,37 − 1.007,35 = 26,35.
    expect(desglose.precio).toBeCloseTo(26.35, 9);
    expect(desglose.costes).toBe(0);
  });

  it("el efectivo en otra divisa aporta su efecto divisa", () => {
    // 1.000 € aportados; 500 € se cambian por 625 USD al 1,25. Cuando el dólar pasa a valer 1 €, los 625 USD son 625 €.
    const conDolares = cartera([], [
      mov("aportacion", "2024-01-01", { importe: "1000" }),
      mov("cambioDeDivisa", "2024-01-01", { importe: "-500", destino: { divisa: "USD", importe: "625" } }),
      mov("interes", "2024-01-03", { importe: "0.01" })
    ]);
    const valoracion = valorar(conDolares, mercado({}, { USD: [["2024-01-01", 1.25], ["2024-01-03", 1.0]] }));
    expect([...valoracion.valor].map((x) => Number(x.toFixed(6)))).toEqual([1000, 1000, 1125.01]);
    const desglose = desgloseDelPeriodo(valoracion, TODO)!;
    expect(desglose.divisa).toBeCloseTo(125, 9);
    expect(desglose.ingresos).toBeCloseTo(0.01, 9);
    expect(desglose.precio).toBe(0);
  });
});

describe("casos de valoración", () => {
  it("una entrada y una salida de títulos son flujos externos a su valor de mercado", () => {
    /*
     * Llegan 10 títulos que costaron 9 € y hoy valen 20 €: entran 200 € de fuera. Suben a 22 € (+10 %).
     * Se entregan 5 a otra entidad a 22 €: salen 110 €. Ni la entrada ni la salida son rentabilidad.
     */
    const c = cartera([activo("ACC")], [
      mov("entradaDeTitulos", "2024-01-01", { activoId: "ACC", titulos: "10", precio: "9" }),
      mov("salidaDeTitulos", "2024-01-03", { activoId: "ACC", titulos: "5" })
    ]);
    const v = valorar(c, mercado({ ACC: [["2024-01-01", 20], ["2024-01-02", 22]] }));
    expect([...v.valor]).toEqual([200, 220, 110]);
    expect([...v.entradas]).toEqual([200, 0, 0]);
    expect([...v.salidas]).toEqual([0, 0, -110]);
    expect([...v.rentabilidad].map((r) => pct(r))).toEqual(["0.0000", "10.0000", "0.0000"]);
    const r = rentabilidadDelPeriodo(v, TODO)!;
    expect(r.resultado).toBeCloseTo(20, 9); // 110 − (200 − 110)
  });

  it("unos derechos que se asignan gratis y luego se ejercen no son ni una aportación ni una retirada", () => {
    /*
     * 1.000 € aportados y 10 acciones compradas a 100 €. El día 2 se asignan 10 derechos sin coste; el día 3 se venden 4
     * a 2 € (8 € que entran en la cuenta) y con eso los derechos tienen precio: los 6 que quedan valen 12 €. El día 4 se
     * ejercen esos 6: dejan de existir. Lo único que ha entrado de fuera son los 1.000 € del primer día.
     */
    const c = cartera([activo("ACC"), activo("DER")], [
      mov("aportacion", "2024-01-01", { importe: "1000" }),
      mov("compra", "2024-01-01", { activoId: "ACC", titulos: "10", precio: "100", importe: "-1000" }),
      mov("dividendoEnAcciones", "2024-01-02", { activoId: "DER", titulos: "10" }),
      mov("venta", "2024-01-03", { activoId: "DER", titulos: "4", precio: "2", importe: "8" }),
      mov("extincionDeTitulos", "2024-01-04", { activoId: "DER", titulos: "6" })
    ]);
    const v = valorar(c, mercado({ ACC: [["2024-01-01", 100]] }));
    /* Día 3: 1.000 de acciones + 8 de efectivo + 6 × 2 de derechos = 1.020. Día 4: los derechos ya no están: 1.008. */
    expect([...v.valor]).toEqual([1000, 1000, 1020, 1008]);
    expect([...v.entradas]).toEqual([1000, 0, 0, 0]);
    expect([...v.salidas]).toEqual([0, 0, 0, 0]);
    const r = rentabilidadDelPeriodo(v, TODO)!;
    /* Lo ganado es lo cobrado por los derechos vendidos: 8 €. */
    expect(r.resultado).toBeCloseTo(8, 9);
    expect(r.aportacionesNetas).toBeCloseTo(1000, 9);
  });

  it("un split con la serie ya ajustada no produce ningún salto", () => {
    /*
     * 10 títulos a 100 €. Split de 2 por 1 el día 3. La serie de la plataforma viene ajustada hacia
     * atrás: 50, 55 y 56. Antes del split la valoración usa 20 títulos «de hoy» × 50 = 1.000 €.
     */
    const c = cartera([activo("ACC")], [
      mov("aportacion", "2024-01-01", { importe: "1000" }),
      mov("compra", "2024-01-01", { activoId: "ACC", titulos: "10", precio: "100", importe: "-1000" }),
      mov("split", "2024-01-03", { activoId: "ACC", razon: "2" })
    ]);
    const v = valorar(c, mercado({ ACC: [["2024-01-01", 50], ["2024-01-02", 55], ["2024-01-03", 56]] }));
    expect([...v.valor]).toEqual([1000, 1100, 1120]);
    const serieDelActivo = v.porActivo.get("ACC")!;
    expect([...serieDelActivo.titulos]).toEqual([10, 10, 20]); // los títulos reales de cada día
    expect([...serieDelActivo.precio]).toEqual([100, 110, 56]); // y el precio real de cada día
  });

  it("un traspaso que tarda unos días no hace desaparecer el dinero", () => {
    const c = cartera([activo("FON1", "FONDO"), activo("FON2", "FONDO")], [
      mov("aportacion", "2024-01-01", { importe: "2000" }),
      mov("suscripcion", "2024-01-01", { activoId: "FON1", titulos: "40", precio: "50", importe: "-2000" }),
      mov("traspaso", "2024-01-03", { activoId: "FON1", titulos: "40", valor: "2200", destino: { activoId: "FON2", titulos: "25", fecha: "2024-01-05" } })
    ]);
    const v = valorar(c, mercado({ FON1: [["2024-01-01", 50], ["2024-01-02", 55]], FON2: [["2024-01-05", 88]] }), { hasta: "2024-01-05" });
    // 2.000 → 2.200 (día 2) → 2.200 en tránsito (días 3 y 4) → 25 × 88 = 2.200 en el fondo nuevo (día 5).
    expect([...v.valor]).toEqual([2000, 2200, 2200, 2200, 2200]);
    expect([...v.efectivo]).toEqual([0, 0, 2200, 2200, 0]);
    expect(pct(rentabilidadDelPeriodo(v, TODO)!.twr)).toBe("10.0000");
  });

  it("sin serie de la plataforma valora al último precio contratado, y un precio a mano lo corrige", () => {
    const c = cartera([activo("RARO")], [
      mov("aportacion", "2024-01-01", { importe: "1000" }),
      mov("compra", "2024-01-01", { activoId: "RARO", titulos: "10", precio: "100", importe: "-1000" })
    ], { preciosManuales: [{ activoId: "RARO", fecha: "2024-01-03", precio: "105" }] });
    const v = valorar(c, undefined, { hasta: "2024-01-04" });
    expect([...v.valor]).toEqual([1000, 1000, 1050, 1050]);
    const fuentes = v.porActivo.get("RARO")!;
    expect([...fuentes.fuente]).toEqual([FUENTE.operacion, FUENTE.operacion, FUENTE.manual, FUENTE.manual]);
    expect([...fuentes.antiguedad]).toEqual([0, 1, 0, 1]);
    expect(v.avisos).toEqual([]);
  });

  describe("el precio que declara un extracto del banco", () => {
    /* 100 participaciones a 100 €. La plataforma llega al 5 de enero (102 €); el banco declara 10.500 € el día 9. */
    const movimientos = [
      mov("aportacion", "2026-01-02", { importe: "10000" }),
      mov("suscripcion", "2026-01-02", { activoId: "F", titulos: "100", precio: "100", importe: "-10000" })
    ];
    const extracto = (valor: string) => ({ id: "e1", fecha: "2026-01-09", posiciones: [{ activoId: "F", nombre: "Fondo", titulos: "100", valor }], efectivo: [] });

    it("vale cuando es más reciente que el último precio de la plataforma", () => {
      const c = cartera([activo("F", "FONDO")], movimientos, { extractos: [extracto("10500")] });
      const mercado: DatosDeMercado = { precios: new Map([["F", serie(["2026-01-02", 100], ["2026-01-05", 102])]]), cambios: new Map() };
      const v = valorar(c, mercado, { hasta: "2026-01-10" });
      /* Días 2, 3 y 4 a 100 €; 5 a 8 a 102 €; desde el 9, lo que dice el banco: 10.500 € entre 100 = 105 €. */
      expect([...v.valor]).toEqual([10000, 10000, 10000, 10200, 10200, 10200, 10200, 10500, 10500]);
      const del = v.porActivo.get("F")!;
      expect([...del.fuente].slice(6)).toEqual([FUENTE.mercado, FUENTE.extracto, FUENTE.extracto]);
      expect(del.precio[7]).toBeCloseTo(105, 10);
      expect([...del.antiguedad].slice(6)).toEqual([3, 0, 1]);
    });

    it("se fecha con la cotización de la posición, no con la del extracto (GES-10)", () => {
      /* El extracto es del 9, pero el banco valoró este fondo con su valor del 7: el precio de 105 € es del día 7.
         Días 2, 3 y 4 a 100 €; el 5 y el 6, a 102 €; desde el 7, 105 €. Con la fecha del extracto, el 7 y el 8 seguían a 102 €. */
      const conSuFecha = { ...extracto("10500"), posiciones: [{ activoId: "F", nombre: "Fondo", titulos: "100", valor: "10500", fecha: "2026-01-07" }] };
      const c = cartera([activo("F", "FONDO")], movimientos, { extractos: [conSuFecha] });
      const mercado: DatosDeMercado = { precios: new Map([["F", serie(["2026-01-02", 100], ["2026-01-05", 102])]]), cambios: new Map() };
      const v = valorar(c, mercado, { hasta: "2026-01-10" });
      expect([...v.valor]).toEqual([10000, 10000, 10000, 10200, 10200, 10500, 10500, 10500, 10500]);
      expect(v.porActivo.get("F")!.fuente[5]).toBe(FUENTE.extracto);
      /* Y dentro del tramo de la plataforma manda la plataforma, mirando la fecha de la posición: con su valor del 4, no entra. */
      const delCuatro = { ...conSuFecha, posiciones: [{ ...conSuFecha.posiciones[0], fecha: "2026-01-04" }] };
      const dentro = valorar(cartera([activo("F", "FONDO")], movimientos, { extractos: [delCuatro] }), mercado, { hasta: "2026-01-10" });
      expect(dentro.valor[2]).toBe(10000);
      expect([...dentro.porActivo.get("F")!.fuente].every((fuente) => fuente === FUENTE.mercado)).toBe(true);
    });

    it("no vale si la plataforma ya tiene un precio de ese día o posterior", () => {
      const c = cartera([activo("F", "FONDO")], movimientos, { extractos: [extracto("10500")] });
      const mercado: DatosDeMercado = { precios: new Map([["F", serie(["2026-01-02", 100], ["2026-01-05", 102], ["2026-01-12", 104])]]), cambios: new Map() };
      const v = valorar(c, mercado, { hasta: "2026-01-12" });
      /* El 9 sigue a 102 €, el último de la plataforma hasta entonces; el 12, a 104 €. */
      expect(v.valor[7]).toBe(10200);
      expect(v.valor[10]).toBe(10400);
      expect([...v.porActivo.get("F")!.fuente].every((fuente) => fuente === FUENTE.mercado)).toBe(true);
    });

    it("en otra divisa, el valor declarado en euros se lleva a la del activo con el cambio del día", () => {
      /* 100 títulos en dólares. El banco declara 9.000 € con el dólar a 1,10: 9.900 $ entre 100 = 99 $ por título. */
      const c = cartera([activo("U", "ACCION", "USD")], [
        mov("entradaDeTitulos", "2026-01-02", { activoId: "U", titulos: "100", precio: "90" })
      ], { extractos: [{ id: "e1", fecha: "2026-01-05", posiciones: [{ activoId: "U", nombre: "Acción", titulos: "100", valor: "9000" }], efectivo: [] }] });
      const mercado: DatosDeMercado = { precios: new Map(), cambios: new Map([["USD", serie(["2026-01-02", 1.125], ["2026-01-05", 1.1])]]) };
      const v = valorar(c, mercado, { hasta: "2026-01-05" });
      /* El día 2: 100 × 90 $ / 1,125 = 8.000 €. El día 5: lo declarado, 9.000 €. */
      expect(v.valor[0]).toBeCloseTo(8000, 8);
      expect(v.valor[3]).toBeCloseTo(9000, 8);
      expect(v.porActivo.get("U")!.precio[3]).toBeCloseTo(99, 8);
      expect(v.porActivo.get("U")!.fuente[3]).toBe(FUENTE.extracto);
    });

    it("un bono no toma el precio del extracto: el banco lo valora con su cupón corrido", () => {
      const c = cartera([activo("B", "BONO")], [
        mov("entradaDeTitulos", "2026-01-02", { activoId: "B", titulos: "100", precio: "100" })
      ], { extractos: [{ id: "e1", fecha: "2026-01-05", posiciones: [{ activoId: "B", nombre: "Bono", titulos: "100", valor: "10300" }], efectivo: [] }] });
      const v = valorar(c, undefined, { hasta: "2026-01-05" });
      expect(v.porActivo.get("B")!.fuente[3]).toBe(FUENTE.operacion);
    });
  });

  it("dice qué no puede valorar en vez de inventarlo", () => {
    const c = cartera([activo("JAP", "ACCION", "JPY")], [
      mov("entradaDeTitulos", "2024-01-01", { activoId: "JAP", titulos: "10", precio: "1000" })
    ]);
    const v = valorar(c);
    expect(v.avisos.map((aviso) => [aviso.codigo, aviso.divisa])).toEqual([["SIN_CAMBIO", "JPY"]]);
    expect([...v.valor]).toEqual([0]);
  });

  it("un canje pasa el valor de un activo al otro sin que ninguno gane ni pierda por ello", () => {
    const c = cartera([activo("VIEJO"), activo("NUEVO")], [
      mov("aportacion", "2024-01-01", { importe: "1000" }),
      mov("compra", "2024-01-01", { activoId: "VIEJO", titulos: "10", precio: "100", importe: "-1000" }),
      mov("canje", "2024-01-03", { activoId: "VIEJO", destino: { activoId: "NUEVO", titulos: "5" } })
    ]);
    const v = valorar(c, mercado({ VIEJO: [["2024-01-01", 100], ["2024-01-02", 110]], NUEVO: [["2024-01-03", 222]] }));
    // Día 3: 5 títulos nuevos a 222 = 1.110 €. La subida de 10 € del día queda en el activo antiguo.
    expect([...v.valor]).toEqual([1000, 1100, 1110]);
    const d = desgloseDelPeriodo(v, TODO)!;
    expect(d.posiciones.find((p) => p.activoId === "VIEJO")!.resultado).toBeCloseTo(110, 9);
    expect(d.posiciones.find((p) => p.activoId === "NUEVO")!.resultado).toBeCloseTo(0, 9);
  });
});

describe("tabla de rentabilidad por meses", () => {
  it("encadena los días de cada mes y los meses de cada año", () => {
    /*
     * 1.000 € el 1 de enero. El 31 de enero se abonan 10 € de intereses: enero, +1 %.
     * El 15 de febrero, 20,20 €: febrero, 20,20 / 1.010 = +2 %. Año: 1,01 × 1,02 − 1 = 3,02 %.
     */
    const c = cartera([], [
      mov("aportacion", "2024-01-01", { importe: "1000" }),
      mov("interes", "2024-01-31", { importe: "10" }),
      mov("interes", "2024-02-15", { importe: "20.20" })
    ]);
    const tabla = rentabilidadPorMeses(valorar(c, undefined, { hasta: "2024-02-29" }));
    expect(tabla).toHaveLength(1);
    expect(tabla[0].anio).toBe(2024);
    expect(pct(tabla[0].meses[0]?.rentabilidad)).toBe("1.0000");
    expect(pct(tabla[0].meses[1]?.rentabilidad)).toBe("2.0000");
    expect(tabla[0].meses[0]?.parcial).toBe(false);
    expect(tabla[0].meses[2]).toBeNull();
    expect(pct(tabla[0].total)).toBe("3.0200");
    expect(tabla[0].parcial).toBe(true); // el año no está entero
  });
});
