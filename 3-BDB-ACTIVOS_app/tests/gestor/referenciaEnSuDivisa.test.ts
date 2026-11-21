/**
 * La referencia se convierte con la divisa de su serie, no con la de su ficha (decisión de Óscar del 20-11-2026, A-195).
 *
 * El «MSCI ACWI» de la lista es un ETF con la ficha en dólares y la serie de precios en euros (cotiza en Xetra). La
 * referencia tomaba la divisa de la ficha y dividía esos precios en euros por el cambio del dólar: en una cartera de
 * prueba del 02-01 al 20-11-2026, «su referencia» salía +24,27 % y la serie da +16,41 %. Las posiciones de la cartera
 * no tenían el fallo: miran la divisa de la serie. Ahora la referencia también.
 *
 * Las cifras esperadas salen de las cuentas a mano escritas junto a cada una.
 */
import { describe, expect, it } from "vitest";
import { cargarMercado, olvidarMercado, type FuenteDeMercado } from "../../src/gestor/mercado/cargar";
import { preparar } from "../../src/gestor/motor/analisis";
import type { Cartera } from "../../src/gestor/motor/modelo";
import { analizarConLaReferencia } from "../../src/gestor/ui/estado/useAnalisisDeCartera";
import { activo, cartera, mov, serieDiaria } from "./ayudas";

type Documento = Record<string, unknown>;

function fuenteEnMemoria(documentos: Record<string, Documento>): FuenteDeMercado {
  const leer = async (ruta: string): Promise<Documento | undefined> => documentos[ruta];
  return {
    preciosDelAnio: (isin, anio) => leer(`precios/${isin}/${anio}`),
    cambiosDelAnio: (divisa, anio) => leer(`cambios/${divisa}/${anio}`),
    libreDeRiesgoDelAnio: (anio) => leer(`estr/${anio}`),
    tarjeta: (isin) => leer(`tarjeta/${isin}`)
  };
}

const puntos = (valores: Array<[string, number]>) => valores.map(([date, value]) => ({ date, value }));
/** Un dato cada día entre dos fechas, con `inicial` todos los días menos el último, que vale `final`; partido por años. */
const diario = (desde: string, hasta: string, inicial: number, final: number) => {
  const dias = serieDiaria(desde, hasta, inicial, final);
  const porAnio = (anio: string) => puntos(dias.filter((p) => p.fecha.startsWith(anio)).map((p) => [p.fecha, p.valor]));
  return { 2023: porAnio("2023"), 2024: porAnio("2024") };
};

const FIN = "2024-03-01";
const REF = "IE0000000009";
/* La cartera: 1.000 € aportados el 02-01-2024 y 10 títulos de una acción en euros a 100 €; vale 110 € el 01-03. +10 %. */
const ACCION = activo("ES0000000001", "ACCION", "EUR", { isin: "ES0000000001", origen: "catalogo" });
const MOVIMIENTOS = [
  mov("aportacion", "2024-01-02", { importe: "1000" }),
  mov("compra", "2024-01-02", { activoId: "ES0000000001", titulos: "10", precio: "100", importe: "-1000" })
];
const BASE: Record<string, Documento> = {
  "precios/ES0000000001/2024": { price_class: "MARKET_PRICE", currency: "EUR", points: puntos([["2024-01-02", 100], [FIN, 110]]) },
  "tarjeta/ES0000000001": { identity: { name: "Acción", currency: "EUR" } },
  /* El dólar: 1,10 por euro hasta el 29-02 y 1,08 desde el 01-03. */
  "cambios/USD/2023": { points: puntos([["2023-12-29", 1.1]]) },
  "cambios/USD/2024": { points: puntos([[FIN, 1.08]]) },
  "cambios/GBP/2023": { points: puntos([["2023-12-29", 0.86]]) }
};
const conReferencia = (c: Cartera): Cartera => ({ ...c, referencia: { activoId: REF, nombre: "Índice de prueba" } });
/** La serie de la referencia y la comparación, por el mismo camino que la pantalla. */
async function referenciaDe(documentos: Record<string, Documento>, c: Cartera = conReferencia(cartera([ACCION], MOVIMIENTOS))) {
  olvidarMercado();
  const mercado = await cargarMercado(c, FIN, fuenteEnMemoria({ ...BASE, ...documentos }));
  const entrada = mercado.referencia!;
  const analizada = analizarConLaReferencia(preparar(c, mercado.datos, mercado.fichas, FIN), { desde: "1900-01-01", hasta: "2100-01-01" }, entrada).referencia;
  return { entrada, analizada, avisos: mercado.avisos };
}
const serieDe = (entrada: Awaited<ReturnType<typeof referenciaDe>>["entrada"]) => ("serie" in entrada ? entrada.serie : []);

describe("el caso del MSCI ACWI: ficha en dólares, serie en euros", () => {
  /* La serie: 50 € cada día del 29-12-2023 al 29-02-2024 y 54 € el 01-03. */
  const enEuros = diario("2023-12-29", FIN, 50, 54);
  const documentos = {
    [`precios/${REF}/2023`]: { price_class: "MARKET_PRICE", currency: "EUR", points: enEuros[2023] },
    [`precios/${REF}/2024`]: { price_class: "MARKET_PRICE", currency: "EUR", points: enEuros[2024] },
    [`tarjeta/${REF}`]: { identity: { name: "ETF mundial", currency: "USD" } }
  };

  it("los precios en euros se quedan como están: la referencia gana 54 / 50 − 1 = +8 %, no +10 %", async () => {
    const { entrada, analizada } = await referenciaDe(documentos);
    const serie = serieDe(entrada);
    expect(serie[0]).toEqual({ fecha: "2023-12-29", valor: 50 });
    expect(serie.at(-1)).toEqual({ fecha: FIN, valor: 54 });
    /* Antes: (54 / 1,08) / (50 / 1,10) − 1 = 50 / 45,4545 − 1 = +10 %. */
    expect(analizada?.disponible).toBe(true);
    expect(analizada?.rentabilidad).toBeCloseTo(0.08, 12);
    /* La cartera gana un 10 %: 10 − 8 = 2 puntos a su favor. Antes, 10 − 10 = 0. */
    expect(analizada?.diferencia).toBeCloseTo(0.02, 12);
  });
});

describe("cada precio, con la divisa de su serie", () => {
  it("al revés: ficha en euros y serie en dólares, se convierte con el dólar", async () => {
    /* 55 $ cada día y 58,32 $ el 01-03: 55 / 1,10 = 50 € y 58,32 / 1,08 = 54 €. +8 %. */
    const enDolares = diario("2023-12-29", FIN, 55, 58.32);
    const { entrada, analizada } = await referenciaDe({
      [`precios/${REF}/2023`]: { currency: "USD", points: enDolares[2023] },
      [`precios/${REF}/2024`]: { currency: "USD", points: enDolares[2024] },
      [`tarjeta/${REF}`]: { identity: { name: "ETF", currency: "EUR" } }
    });
    const serie = serieDe(entrada);
    expect(serie[0].valor).toBeCloseTo(50, 10);
    expect(serie.at(-1)!.valor).toBeCloseTo(54, 10);
    expect(analizada?.rentabilidad).toBeCloseTo(0.08, 12);
  });

  it("si la serie no dice su divisa, vale la de la ficha", async () => {
    /* Sin `currency` en los documentos y la ficha en dólares: 55 / 1,10 = 50 €. */
    const enDolares = diario("2023-12-29", FIN, 55, 58.32);
    const { entrada } = await referenciaDe({
      [`precios/${REF}/2023`]: { points: enDolares[2023] },
      [`precios/${REF}/2024`]: { points: enDolares[2024] },
      [`tarjeta/${REF}`]: { identity: { name: "ETF", currency: "USD" } }
    });
    expect(serieDe(entrada)[0].valor).toBeCloseTo(50, 10);
  });

  it("si un año de la serie está en otra divisa, cada año con la suya", async () => {
    /* 2023 en dólares (55 $ / 1,10 = 50 €) y 2024 en euros (54 €, sin convertir). */
    const { entrada } = await referenciaDe({
      [`precios/${REF}/2023`]: { currency: "USD", points: puntos([["2023-12-29", 55]]) },
      [`precios/${REF}/2024`]: { currency: "EUR", points: puntos([["2024-01-02", 54]]) },
      [`tarjeta/${REF}`]: { identity: { name: "ETF", currency: "USD" } }
    });
    const serie = serieDe(entrada);
    expect(serie.map((p) => p.fecha)).toEqual(["2023-12-29", "2024-01-02"]);
    expect(serie[0].valor).toBeCloseTo(50, 10);
    expect(serie[1].valor).toBe(54);
  });

  it("los precios salen ordenados por fecha aunque un documento los traiga desordenados", async () => {
    const { entrada } = await referenciaDe({
      [`precios/${REF}/2024`]: { currency: "EUR", points: puntos([["2024-02-01", 52], ["2024-01-02", 51]]) },
      [`tarjeta/${REF}`]: { identity: { name: "ETF", currency: "EUR" } }
    });
    expect(serieDe(entrada)).toEqual([{ fecha: "2024-01-02", valor: 51 }, { fecha: "2024-02-01", valor: 52 }]);
  });

  it("con una cartera en dólares y la serie en peniques, el cambio se cruza a través del euro", async () => {
    /*
     * Peniques por dólar = (peniques por euro) / (dólares por euro) = 86 / 1,10 = 78,1818…; 250 peniques son
     * 250 / 78,1818… = 250 × 1,10 / 86 = 3,1976744… $.
     */
    const ENDOLAR = activo("US0000000003", "ACCION", "USD", { isin: "US0000000003", origen: "catalogo" });
    const enDolares = conReferencia({
      ...cartera([ENDOLAR], [mov("aportacion", "2024-01-02", { importe: "1000" }), mov("compra", "2024-01-02", { activoId: "US0000000003", titulos: "10", precio: "100", importe: "-1000" })]),
      divisaBase: "USD"
    });
    const { entrada } = await referenciaDe(
      {
        "precios/US0000000003/2024": { currency: "USD", points: puntos([["2024-01-02", 100], [FIN, 110]]) },
        [`precios/${REF}/2023`]: { currency: "GBX", points: puntos([["2023-12-29", 250]]) },
        [`tarjeta/${REF}`]: { identity: { name: "ETF", currency: "GBP" } }
      },
      enDolares
    );
    expect(serieDe(entrada)[0].valor).toBeCloseTo((250 * 1.1) / 86, 12);
  });

  it("una serie en peniques se convierte con la libra por cien", async () => {
    /* 250 peniques con la libra a 0,86 por euro: 250 / 86 = 2,9069767… €. */
    const { entrada } = await referenciaDe({
      [`precios/${REF}/2023`]: { currency: "GBX", points: puntos([["2023-12-29", 250]]) },
      [`tarjeta/${REF}`]: { identity: { name: "ETF", currency: "GBP" } }
    });
    expect(serieDe(entrada)[0].valor).toBeCloseTo(250 / 86, 12);
  });

  it("con una cartera en dólares, la serie en euros se lleva a dólares", async () => {
    /*
     * La cartera, en dólares, sin nada en euros: el cambio del euro frente al dólar es la inversa del del dólar frente al
     * euro. 50 € con el dólar a 1,10 por euro son 55 $; 54 € a 1,08, 58,32 $. Antes, con la ficha en dólares —la divisa
     * de la cartera—, los precios en euros se tomaban como dólares sin convertir.
     */
    const ENDOLAR = activo("US0000000003", "ACCION", "USD", { isin: "US0000000003", origen: "catalogo" });
    const enDolares = conReferencia({
      ...cartera([ENDOLAR], [mov("aportacion", "2024-01-02", { importe: "1000" }), mov("compra", "2024-01-02", { activoId: "US0000000003", titulos: "10", precio: "100", importe: "-1000" })]),
      divisaBase: "USD"
    });
    const enEuros = diario("2023-12-29", FIN, 50, 54);
    const { entrada } = await referenciaDe(
      {
        "precios/US0000000003/2024": { currency: "USD", points: puntos([["2024-01-02", 100], [FIN, 110]]) },
        [`precios/${REF}/2023`]: { currency: "EUR", points: enEuros[2023] },
        [`precios/${REF}/2024`]: { currency: "EUR", points: enEuros[2024] },
        [`tarjeta/${REF}`]: { identity: { name: "ETF mundial", currency: "USD" } }
      },
      enDolares
    );
    const serie = serieDe(entrada);
    expect(serie[0].valor).toBeCloseTo(55, 10);
    expect(serie.at(-1)!.valor).toBeCloseTo(58.32, 10);
  });
});

describe("sin el tipo de cambio", () => {
  it("dice que falta el cambio, y no que falta la serie", async () => {
    /* Una serie en francos suizos y la plataforma sin el cambio del franco. */
    const { entrada, avisos } = await referenciaDe({
      [`precios/${REF}/2024`]: { currency: "CHF", points: puntos([["2024-01-02", 90]]) },
      [`tarjeta/${REF}`]: { identity: { name: "ETF", currency: "CHF" } }
    });
    const motivo = "La serie de la referencia (Índice de prueba) está en CHF y la plataforma no tiene el tipo de cambio para llevarla a EUR: no se puede comparar.";
    expect(entrada).toEqual({ nombre: "Índice de prueba", motivo });
    expect(avisos).toContain(motivo);
  });

  it("en una cartera de referencia, también", async () => {
    /* Los dos fondos con la serie en francos suizos y la plataforma sin el cambio del franco. */
    const c = { ...cartera([ACCION], MOVIMIENTOS), referencia: { activoId: "perfil:equilibrado", nombre: "Equilibrado" } };
    const { entrada } = await referenciaDe(
      {
        "precios/IE00B18GC888/2024": { currency: "CHF", points: puntos([["2024-01-02", 20]]) },
        "precios/IE00B03HCZ61/2024": { currency: "CHF", points: puntos([["2024-01-02", 30]]) }
      },
      c
    );
    expect(entrada).toEqual({
      nombre: "Cartera de referencia Equilibrado",
      motivo: "La cartera de referencia Equilibrado no se puede calcular: la serie de sus fondos está en CHF y la plataforma no tiene el tipo de cambio para llevarla a EUR."
    });
  });

  it("sin serie sigue diciendo que no hay serie", async () => {
    const { entrada } = await referenciaDe({ [`tarjeta/${REF}`]: { identity: { name: "ETF", currency: "USD" } } });
    expect(entrada).toEqual({ nombre: "Índice de prueba", motivo: "La plataforma no tiene serie de precios de la referencia (Índice de prueba): no se puede comparar." });
  });
});
