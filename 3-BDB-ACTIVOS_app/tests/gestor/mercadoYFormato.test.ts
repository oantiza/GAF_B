/**
 * La carga de datos de mercado (con una fuente en memoria, sin red) y el formato de cifras
 * de la pantalla.
 */
import { describe, expect, it } from "vitest";
import { cargarMercado, cargarMercadoDeActivos, olvidarMercado, type FuenteDeMercado } from "../../src/gestor/mercado/cargar";
import { activoDeCatalogo, activoDesdeElCatalogo, fichaDeLaTarjeta } from "../../src/gestor/mercado/fichas";
import { d } from "../../src/gestor/motor/decimal";
import { claseDelSigno, fecha, fechaCorta, fechaLarga, importe, importeConSigno, importeRedondo, porcentaje, porcentajeConSigno, precio, puntos, titulos } from "../../src/gestor/ui/formato";
import { activo, cartera, mov } from "./ayudas";

type Documento = Record<string, unknown>;

/** Una fuente en memoria: los documentos por su ruta, y un registro de lo que se pidió. */
function fuenteEnMemoria(documentos: Record<string, Documento>, fallan: string[] = []): FuenteDeMercado & { pedidos: string[] } {
  const pedidos: string[] = [];
  const leer = async (ruta: string): Promise<Documento | undefined> => {
    pedidos.push(ruta);
    if (fallan.some((prefijo) => ruta.startsWith(prefijo))) throw new Error("permiso denegado");
    return documentos[ruta];
  };
  return {
    pedidos,
    preciosDelAnio: (isin, anio) => leer(`precios/${isin}/${anio}`),
    cambiosDelAnio: (divisa, anio) => leer(`cambios/${divisa}/${anio}`),
    libreDeRiesgoDelAnio: (anio) => leer(`estr/${anio}`),
    tarjeta: (isin) => leer(`tarjeta/${isin}`)
  };
}

const puntos2024 = (valores: Array<[string, number]>) => valores.map(([date, value]) => ({ date, value }));

const DOCUMENTOS: Record<string, Documento> = {
  "precios/ES0000000001/2024": { price_class: "MARKET_PRICE", currency: "EUR", points: puntos2024([["2024-01-02", 10], ["2024-03-01", 11]]) },
  "precios/LU0000000002/2024": { price_class: "NAV", currency: "EUR", points: puntos2024([["2024-01-02", 100]]) },
  "precios/US0000000003/2024": { price_class: "MARKET_PRICE", currency: "USD", points: puntos2024([["2024-01-02", 50]]) },
  "precios/GB0000000004/2024": { price_class: "MARKET_PRICE", currency: "GBX", points: puntos2024([["2024-01-02", 250]]) },
  "cambios/USD/2024": { points: puntos2024([["2024-01-02", 1.1], ["2024-03-01", 1.08]]) },
  "cambios/GBP/2024": { points: puntos2024([["2024-01-02", 0.86]]) },
  "estr/2024": { points: puntos2024([["2024-01-02", 0.039]]) },
  "tarjeta/ES0000000001": { instrument_id: "ES0000000001", instrument_type: "STOCK", identity: { name: "Eléctrica, S.A.", currency: "EUR", ticker: "ELE" }, classification: { sector: "Utilities" } },
  "tarjeta/LU0000000002": {
    instrument_id: "LU0000000002",
    instrument_type: "FUND",
    identity: { name: "Fondo Mixto", currency: "EUR" },
    classification: { category: "Mixtos moderados" },
    costs: { ongoing_charge: 0.0125 },
    exposure: { asset_mix: { equity: 0.6, fixed_income: 0.35, cash: 0.05 }, equity_regions: { united_states: 0.5, eurozone: 0.3, united_kingdom: 0.2 }, sectors: { technology: 0.4, healthcare: 0.6 } }
  }
};

const ACTIVOS = [
  activo("ES0000000001", "ACCION", "EUR", { isin: "ES0000000001", origen: "catalogo" }),
  activo("LU0000000002", "FONDO", "EUR", { isin: "LU0000000002", origen: "catalogo" }),
  activo("US0000000003", "ACCION", "USD", { isin: "US0000000003", origen: "catalogo" }),
  activo("GB0000000004", "ACCION", "GBX", { isin: "GB0000000004", origen: "catalogo" }),
  activo("PROPIO", "OTRO", "EUR")
];
const CARTERA = cartera(ACTIVOS, [
  mov("aportacion", "2024-01-02", { importe: "10000" }),
  ...ACTIVOS.map((a) => mov("entradaDeTitulos", "2024-01-02", { activoId: a.id, titulos: "1", precio: "1" }))
]);

describe("cargar los datos de mercado de una cartera", () => {
  it("pide solo ISIN y divisas, por años, y nada de la cartera", async () => {
    olvidarMercado();
    const fuente = fuenteEnMemoria(DOCUMENTOS);
    await cargarMercado(CARTERA, "2024-06-30", fuente);
    /* Un año antes del primer movimiento (hace falta un precio en o antes de su fecha) hasta el año final. */
    expect(fuente.pedidos.filter((ruta) => ruta.startsWith("precios/ES0000000001")).sort()).toEqual(["precios/ES0000000001/2023", "precios/ES0000000001/2024"]);
    /* El activo propio no está en el catálogo: no se pide. */
    expect(fuente.pedidos.some((ruta) => ruta.includes("PROPIO"))).toBe(false);
    /* Ninguna petición lleva un importe, un título ni el nombre de la cartera. */
    expect(fuente.pedidos.every((ruta) => /^(precios|cambios|estr|tarjeta)\/[A-Z0-9]+(\/\d{4})?$/.test(ruta))).toBe(true);
  });

  it("entrega precios, cambios, tipo libre de riesgo y fichas, y marca las series ajustadas por dividendos", async () => {
    olvidarMercado();
    const mercado = await cargarMercado(CARTERA, "2024-06-30", fuenteEnMemoria(DOCUMENTOS));
    expect(mercado.datos.precios.get("ES0000000001")).toEqual([{ fecha: "2024-01-02", valor: 10 }, { fecha: "2024-03-01", valor: 11 }]);
    /* Acciones (precio de mercado): ajustadas. El fondo (valor liquidativo): no. */
    expect([...mercado.datos.ajustadasPorDividendos!].sort()).toEqual(["ES0000000001", "GB0000000004", "US0000000003"]);
    expect(mercado.datos.cambios.get("USD")).toEqual([{ fecha: "2024-01-02", valor: 1.1 }, { fecha: "2024-03-01", valor: 1.08 }]);
    /* Una acción que cotiza en peniques: su cambio es el de la libra por cien. */
    expect(mercado.datos.cambios.get("GBX")).toEqual([{ fecha: "2024-01-02", valor: 86 }]);
    expect(mercado.datos.libreDeRiesgo).toEqual([{ fecha: "2024-01-02", valor: 0.039 }]);
    expect(mercado.ultimoDato).toBe("2024-03-01");
    expect(mercado.fichas.get("LU0000000002")?.gastosCorrientes).toBe(0.0125);
    expect(mercado.avisos).toEqual([]);
  });

  describe("una serie en una divisa distinta de la del activo", () => {
    /* Un ETF comprado en dólares cuya línea en la plataforma cotiza en euros: 50 € y 54 €. */
    const etf = activo("IE0000000009", "ETF", "USD", { origen: "catalogo", isin: "IE0000000009" });
    const libro = cartera([etf], [mov("compra", "2024-01-02", { activoId: "IE0000000009", titulos: "10", precio: "55", importe: "-500", divisa: "EUR" })]);
    const documentos = {
      ...DOCUMENTOS,
      "precios/IE0000000009/2024": { price_class: "MARKET_PRICE", currency: "EUR", points: puntos2024([["2024-01-02", 50], ["2024-03-01", 54]]) }
    };

    it("se lleva a la divisa del activo con el cambio de cada día, y lo dice", async () => {
      olvidarMercado();
      const mercado = await cargarMercado(libro, "2024-06-30", fuenteEnMemoria(documentos));
      /* 50 € × 1,10 = 55 $; 54 € × 1,08 = 58,32 $. */
      const puntos = mercado.datos.precios.get("IE0000000009")!;
      expect(puntos.map((punto) => punto.fecha)).toEqual(["2024-01-02", "2024-03-01"]);
      expect(puntos[0].valor).toBeCloseTo(55, 10);
      expect(puntos[1].valor).toBeCloseTo(58.32, 10);
      /* Del catálogo: la divisa no la anotó nadie, sale de su ficha (A-199). */
      expect(mercado.avisos).toEqual(["La serie de precios de Activo IE0000000009 está en EUR y su ficha del catálogo, en USD: se ha convertido con el cambio de cada día."]);
    });

    it("sin el tipo de cambio no se usa, y se dice", async () => {
      olvidarMercado();
      const mercado = await cargarMercado(libro, "2024-06-30", fuenteEnMemoria(documentos, ["cambios/"]));
      expect(mercado.datos.precios.has("IE0000000009")).toBe(false);
      expect(mercado.datos.ajustadasPorDividendos!.has("IE0000000009")).toBe(false);
      expect(mercado.avisos.some((aviso) => aviso.includes("falta el tipo de cambio para convertirla"))).toBe(true);
    });
  });

  it("si no se pueden leer los cambios, lo dice y sigue con lo demás", async () => {
    olvidarMercado();
    const mercado = await cargarMercado(CARTERA, "2024-06-30", fuenteEnMemoria(DOCUMENTOS, ["cambios/", "estr/"]));
    expect(mercado.datos.precios.size).toBe(4);
    expect(mercado.datos.cambios.size).toBe(0);
    expect(mercado.avisos.some((aviso) => aviso.startsWith("No se han podido leer los tipos de cambio diarios"))).toBe(true);
    expect(mercado.avisos.some((aviso) => aviso.includes("€STR"))).toBe(true);
  });

  it("dice qué activos del catálogo no tienen serie", async () => {
    olvidarMercado();
    const sinSerie = { ...DOCUMENTOS };
    delete sinSerie["precios/LU0000000002/2024"];
    const mercado = await cargarMercado(CARTERA, "2024-06-30", fuenteEnMemoria(sinSerie));
    expect(mercado.avisos.some((aviso) => aviso.includes("Activo LU0000000002"))).toBe(true);
  });

  it("lleva el índice de referencia a la divisa de la cartera", async () => {
    olvidarMercado();
    const conReferencia = { ...CARTERA, referencia: { activoId: "US0000000003", nombre: "Índice en dólares" } };
    const tarjetas = { ...DOCUMENTOS, "tarjeta/US0000000003": { instrument_id: "US0000000003", identity: { name: "Índice", currency: "USD" } } };
    const mercado = await cargarMercado(conReferencia, "2024-06-30", fuenteEnMemoria(tarjetas));
    /* 50 USD al cambio 1,10 = 45,4545 EUR. */
    const referencia = mercado.referencia;
    expect(referencia && "serie" in referencia && referencia.serie[0].valor).toBeCloseTo(50 / 1.1, 10);
    expect(referencia?.nombre).toBe("Índice en dólares");
  });

  it("para una cartera de referencia trae las series de sus dos fondos y sus pesos, sin mezclarlas todavía", async () => {
    olvidarMercado();
    const conPerfil = { ...CARTERA, referencia: { activoId: "perfil:dinamico", nombre: "Dinámico" } };
    const fondos = {
      ...DOCUMENTOS,
      "precios/IE00B18GC888/2024": { price_class: "NAV", currency: "EUR", points: puntos2024([["2024-01-02", 20], ["2024-03-01", 21]]) },
      "precios/IE00B03HCZ61/2024": { price_class: "NAV", currency: "EUR", points: puntos2024([["2024-01-02", 30], ["2024-03-01", 33]]) },
      "tarjeta/IE00B18GC888": { instrument_id: "IE00B18GC888", identity: { name: "Fondo de renta fija global", currency: "EUR" } },
      "tarjeta/IE00B03HCZ61": { instrument_id: "IE00B03HCZ61", identity: { name: "Fondo de renta variable global", currency: "EUR" } }
    };
    const fuente = fuenteEnMemoria(fondos);
    const mercado = await cargarMercado(conPerfil, "2024-06-30", fuente);
    expect(mercado.referencia).toEqual({
      nombre: "Cartera de referencia Dinámico",
      base: { rf: [{ fecha: "2024-01-02", valor: 20 }, { fecha: "2024-03-01", valor: 21 }], rv: [{ fecha: "2024-01-02", valor: 30 }, { fecha: "2024-03-01", valor: 33 }] },
      pesos: { rf: 0.25, rv: 0.75 }
    });
    /* Tampoco aquí sale nada de la cartera: solo los ISIN de los dos fondos. */
    expect(fuente.pedidos.every((ruta) => /^(precios|cambios|estr|tarjeta)\/[A-Z0-9]+(\/\d{4})?$/.test(ruta))).toBe(true);

    olvidarMercado();
    const sinRentaVariable = { ...fondos };
    delete sinRentaVariable["precios/IE00B03HCZ61/2024"];
    const sinUno = await cargarMercado(conPerfil, "2024-06-30", fuenteEnMemoria(sinRentaVariable));
    expect(sinUno.referencia).toEqual({
      nombre: "Cartera de referencia Dinámico",
      motivo: "La cartera de referencia Dinámico no se puede calcular: la plataforma no tiene la serie de Fondo de renta variable global (IE00B03HCZ61)."
    });
    expect(sinUno.avisos).toContain("La cartera de referencia Dinámico no se puede calcular: la plataforma no tiene la serie de Fondo de renta variable global (IE00B03HCZ61).");
  });

  it("para la liquidez trae el €STR, y solo con la cartera en euros", async () => {
    olvidarMercado();
    const conLiquidez = { ...CARTERA, referencia: { activoId: "tipo:ESTR", nombre: "Liquidez" } };
    const mercado = await cargarMercado(conLiquidez, "2024-06-30", fuenteEnMemoria(DOCUMENTOS));
    expect(mercado.referencia).toEqual({ nombre: "Liquidez (€STR)", estr: [{ fecha: "2024-01-02", valor: 0.039 }] });

    olvidarMercado();
    const enDolares = await cargarMercado({ ...conLiquidez, divisaBase: "USD" }, "2024-06-30", fuenteEnMemoria(DOCUMENTOS));
    expect(enDolares.referencia).toEqual({ nombre: "Liquidez (€STR)", motivo: "La liquidez se mide con el €STR, un tipo en euros: solo se compara con una cartera en euros." });

    olvidarMercado();
    const sinEstr = await cargarMercado(conLiquidez, "2024-06-30", fuenteEnMemoria(DOCUMENTOS, ["estr/"]));
    expect(sinEstr.referencia).toEqual({ nombre: "Liquidez (€STR)", motivo: "La plataforma no tiene el €STR: no se puede comparar con la liquidez." });
  });

  it("una referencia guardada que esta versión no conoce no se compara, y se dice", async () => {
    olvidarMercado();
    const mercado = await cargarMercado({ ...CARTERA, referencia: { activoId: "perfil:temerario", nombre: "Temerario" } }, "2024-06-30", fuenteEnMemoria(DOCUMENTOS));
    expect(mercado.referencia).toEqual({ nombre: "Temerario", motivo: "Esta versión de la aplicación no reconoce la referencia guardada en la cartera (perfil:temerario): elige otra." });
  });

  it("carga el mercado de una lista de activos sin que haya movimientos todavía", async () => {
    olvidarMercado();
    const mercado = await cargarMercadoDeActivos(ACTIVOS.slice(0, 2), "EUR", "2024-01-02", "2024-06-30", fuenteEnMemoria(DOCUMENTOS));
    expect([...mercado.datos.precios.keys()].sort()).toEqual(["ES0000000001", "LU0000000002"]);
  });
});

describe("de la tarjeta de un instrumento a su ficha", () => {
  it("un fondo reparte su renta variable por zonas y sectores", () => {
    const ficha = fichaDeLaTarjeta(DOCUMENTOS["tarjeta/LU0000000002"]);
    expect(ficha.clases).toEqual({ "Renta variable": 0.6, "Renta fija": 0.35, Liquidez: 0.05 });
    expect(ficha.rentaVariable).toBe(0.6);
    /* Estados Unidos es Norteamérica; la eurozona y el Reino Unido, Europa (0,3 + 0,2). */
    expect(ficha.regiones).toEqual({ "Norteamérica": 0.5, Europa: 0.5 });
    expect(ficha.sectores).toEqual({ "Tecnología": 0.4, Salud: 0.6 });
  });

  it("un reparto que pasa de 1 da la renta variable reescalada, la misma que sus clases (P2-05)", () => {
    /* 0,90 + 0,15 = 1,05: la renta variable es 0,90 / 1,05 = 0,857143, en las clases y en la cifra suelta. */
    const ficha = fichaDeLaTarjeta({ instrument_id: "LU0000000099", instrument_type: "FUND", exposure: { asset_mix: { equity: 0.9, fixed_income: 0.15 } } });
    expect(ficha.clases?.["Renta variable"]).toBeCloseTo(0.9 / 1.05, 12);
    expect(ficha.rentaVariable).toBeCloseTo(0.9 / 1.05, 12);
    /* Sin renta variable declarada, cero; sin reparto, no consta. */
    expect(fichaDeLaTarjeta({ instrument_id: "LU0000000098", instrument_type: "FUND", exposure: { asset_mix: { equity: 0, fixed_income: 1 } } }).rentaVariable).toBe(0);
    expect(fichaDeLaTarjeta({ instrument_id: "LU0000000097", instrument_type: "FUND" }).rentaVariable).toBeUndefined();
  });

  it("una acción es renta variable, de la zona de su país y de su sector", () => {
    const ficha = fichaDeLaTarjeta(DOCUMENTOS["tarjeta/ES0000000001"]);
    expect(ficha.clases).toEqual({ "Renta variable": 1 });
    expect(ficha.regiones).toEqual({ Europa: 1 });
    expect(ficha.sectores).toEqual({ Utilities: 1 });
    expect(ficha.gastosCorrientes).toBeUndefined();
  });

  it("da de alta un activo del catálogo con su ISIN como identificador", () => {
    const deCatalogo = activoDeCatalogo(DOCUMENTOS["tarjeta/ES0000000001"])!;
    expect(deCatalogo).toEqual({ isin: "ES0000000001", nombre: "Eléctrica, S.A.", tipo: "ACCION", divisa: "EUR", ticker: "ELE", detalle: "Utilities" });
    expect(activoDesdeElCatalogo(deCatalogo)).toEqual({ id: "ES0000000001", isin: "ES0000000001", nombre: "Eléctrica, S.A.", tipo: "ACCION", divisa: "EUR", ticker: "ELE", origen: "catalogo" });
    expect(activoDeCatalogo({ identity: {} })).toBeUndefined();
  });
});

describe("cómo se escriben las cifras en pantalla", () => {
  const SIN_ESPACIO_DURO = (texto: string) => texto.replaceAll(String.fromCharCode(160), " ");

  it("importes en español, con el menos tipográfico y la divisa detrás", () => {
    expect(SIN_ESPACIO_DURO(importe(1234.5))).toBe("1.234,50 €");
    expect(SIN_ESPACIO_DURO(importe(-120, "USD"))).toBe("−120,00 USD"); // fuera del euro, el código ISO
    expect(SIN_ESPACIO_DURO(importe(5000, "CHF"))).toBe("5.000,00 CHF");
    expect(SIN_ESPACIO_DURO(importeRedondo(201297.99))).toBe("201.298 €");
    expect(SIN_ESPACIO_DURO(importe(1000))).toBe("1.000,00 €"); // el punto de millares también en cuatro cifras
  });

  it("el signo siempre a la vista cuando se pide, y nunca un cero con signo", () => {
    expect(SIN_ESPACIO_DURO(importeConSigno(18581.6))).toBe("+18.581,60 €");
    expect(SIN_ESPACIO_DURO(importeConSigno(-175.2))).toBe("−175,20 €");
    expect(SIN_ESPACIO_DURO(importeConSigno(0.001))).toBe("0,00 €");
    expect(SIN_ESPACIO_DURO(importeConSigno(-0.001))).toBe("0,00 €");
  });

  it("porcentajes a partir de fracciones, y diferencias en puntos", () => {
    expect(SIN_ESPACIO_DURO(porcentaje(0.1039))).toBe("10,39 %");
    expect(SIN_ESPACIO_DURO(porcentajeConSigno(-0.0254))).toBe("−2,54 %");
    expect(SIN_ESPACIO_DURO(porcentaje(0.471, 1))).toBe("47,1 %");
    expect(SIN_ESPACIO_DURO(puntos(0.00211))).toBe("+0,21 pp");
  });

  it("títulos y precios con los decimales que tienen", () => {
    expect(titulos(d("523.1261"))).toBe("523,1261");
    expect(titulos(d("1051"))).toBe("1.051");
    expect(SIN_ESPACIO_DURO(precio(181.3171, "EUR"))).toBe("181,3171 €");
    expect(precio(3.4)).toBe("3,40");
  });

  it("fechas", () => {
    expect(fecha("2026-11-13")).toBe("13/11/2026"); // la fecha de tabla y detalle del módulo único
    expect(fechaLarga("2026-03-01")).toBe("1 de marzo de 2026");
    expect(fechaCorta("2026-03-01")).toBe("01/03/2026");
  });

  it("el color depende solo del signo de la cifra", () => {
    expect(claseDelSigno(12.3)).toBe("gestor-sube");
    expect(claseDelSigno(-0.5)).toBe("gestor-baja");
    expect(claseDelSigno(0)).toBe("");
    expect(claseDelSigno(0.00001)).toBe(""); // redondea a cero: no tiene color
    expect(claseDelSigno(null)).toBe("");
  });
});
