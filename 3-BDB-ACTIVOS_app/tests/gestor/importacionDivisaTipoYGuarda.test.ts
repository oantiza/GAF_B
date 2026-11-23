/**
 * Tres arreglos de la importación del 22-11-2026, aprobados por Óscar ese día. Cada cifra esperada sale de una cuenta a
 * mano escrita junto a ella, nunca de la salida del motor.
 *
 * 1. «GBp» (peniques) se leía como «GBP» (libras): la plantilla y el extracto de posiciones de Andbank pasaban la divisa a
 *    mayúsculas. 10 acciones a 250 GBp, con la libra a 0,80 por euro, son 10 × 250 p = 25 £ y 25 / 0,80 = 31,25 €; leídas
 *    en libras valían 2.500 / 0,80 = 3.125 €, y la cartera (100 € de entrada, 31,25 € pagados) 3.193,75 € en vez de 100 €.
 * 2. Un bono comprado con «Compra» a secas se daba de alta como acción, sin el multiplicador 0,01: 10.000 de nominal al
 *    98,5 valían 985.000 €, y con 10.000 € de entrada y 9.850 € pagados, la cartera 985.150 € en vez de 10.000 €
 *    (9.850 € del bono y 150 € de efectivo). Ahora «Compra de bonos» dice bono, y un activo nuevo cuyo tipo solo se supone
 *    espera en la revisión a que el asesor diga qué es.
 * 3. La guarda: una compra o una venta cuyo importe difiere más de un 2 % de títulos × precio × multiplicador (con el
 *    cambio de la fila) lleva un aviso con las dos cifras. Habría cazado los dos casos de arriba, que son cien veces.
 */
import { describe, expect, it } from "vitest";
import { leerPosiciones } from "../../src/gestor/importacion/andbank/posiciones";
import { importadorDePlantilla } from "../../src/gestor/importacion/plantilla";
import { importarReconocidos, reconocer } from "../../src/gestor/importacion/registro";
import {
  MOTIVO_FALTA_EL_TIPO,
  activoNuevoDelTipo,
  activosCitados,
  aplicarImportacion,
  descuadreDelImporte,
  revisar,
  type DecisionSobreUnActivo
} from "../../src/gestor/importacion/revision";
import type { DocumentoLeido, ResultadoDeImportacion } from "../../src/gestor/importacion/tipos";
import { cargarMercado, olvidarMercado, type FuenteDeMercado } from "../../src/gestor/mercado/cargar";
import type { ActivoDeCatalogo } from "../../src/gestor/mercado/fichas";
import { carteraVacia, type Activo, type Cartera, type TipoDeActivo } from "../../src/gestor/motor/modelo";
import { valorar } from "../../src/gestor/motor/valoracion";
import { estadoDeLaLinea, hayQueMirar, queSeHara, seleccionable } from "../../src/gestor/ui/importar/revisionDelAsistente";
import { documento as documentoDeAndbank, filaDeOperacion, filaDePosicion, filaDeSubtotal, tablaDeOperaciones, tablaDePosiciones } from "./andbankDeMuestra";

const ENTRADA = "05/01/2026";
const COMPRA = "07/01/2026";
const DIA = "2026-01-07";
const ISIN_GB = "GB0000000012";
const ISIN_BONO = "ES0000000052";
const ISIN_ACCION = "ES0000000060";

const CABECERA = ["Fecha", "Tipo", "ISIN", "Nombre", "Títulos", "Precio", "Divisa del activo", "Importe", "Cambio", "Cupón corrido", "Comisión"];

function hoja(filas: Array<Record<string, string>>): string[][] {
  return [CABECERA, ...filas.map((fila) => CABECERA.map((columna) => fila[columna] ?? ""))];
}

function importar(...tablas: string[][][]): ResultadoDeImportacion {
  const doc: DocumentoLeido = { nombre: "plantilla.xlsx", texto: "", tablas };
  const resultado = importadorDePlantilla.importar([{ documento: doc, tipo: "movimientos" }], { divisaBase: "EUR" });
  expect(resultado.errores).toEqual([]);
  return resultado;
}

const vacia = (): Cartera => carteraVacia({ nombre: "Importada", ahora: "2026-01-01T00:00:00.000Z", id: "c" });

/** Aplica todas las líneas que se pueden aplicar, con las decisiones dadas. */
function aplicarTodo(resultados: ResultadoDeImportacion[], decisiones: Map<string, DecisionSobreUnActivo> = new Map(), catalogo: ActivoDeCatalogo[] = []): Cartera {
  const revision = revisar(resultados, vacia(), catalogo, decisiones);
  const elegidas = new Set(revision.lineas.filter((linea) => linea.movimiento && linea.errores.length === 0).map((linea) => linea.propuesto.movimiento.id));
  return aplicarImportacion(vacia(), resultados, revision, elegidas, decisiones, "2026-11-22T10:00:00.000Z").cartera;
}

/** Una fuente de mercado en memoria con un solo dato: la libra a 0,80 por euro. Lo demás no está. */
const SOLO_LA_LIBRA: FuenteDeMercado = {
  preciosDelAnio: async () => undefined,
  cambiosDelAnio: async (divisa, anio) => (divisa === "GBP" && anio === 2026 ? { points: [{ date: "2026-01-02", value: 0.8 }] } : undefined),
  libreDeRiesgoDelAnio: async () => undefined,
  tarjeta: async () => undefined
};

/** El valor de la cartera el día de la compra, con los cambios que carga el mercado (los peniques, la libra por cien). */
async function valorDelDia(cartera: Cartera): Promise<number> {
  olvidarMercado();
  const mercado = await cargarMercado(cartera, DIA, SOLO_LA_LIBRA);
  const v = valorar(cartera, mercado.datos, { hasta: DIA });
  return v.valor[v.indice.get(DIA)!];
}

describe("1. los peniques no son libras", () => {
  const compraEn = (divisa: string, precio: string) =>
    hoja([
      { Fecha: ENTRADA, Tipo: "Aportación", Importe: "100" },
      { Fecha: COMPRA, Tipo: "Compra de acciones", ISIN: ISIN_GB, Nombre: "Acción británica", Títulos: "10", Precio: precio, "Divisa del activo": divisa, Importe: "-31,25" }
    ]);

  it("la hoja de movimientos conserva «GBp»; «GBX» y «GBP» como llegan", () => {
    expect(importar(compraEn("GBp", "250")).movimientos[1].activo?.divisa).toBe("GBp");
    expect(importar(compraEn("GBX", "250")).movimientos[1].activo?.divisa).toBe("GBX");
    expect(importar(compraEn("gbx", "250")).movimientos[1].activo?.divisa).toBe("GBX");
    expect(importar(compraEn("GBP", "2,50")).movimientos[1].activo?.divisa).toBe("GBP");
    expect(importar(compraEn("gbp", "2,50")).movimientos[1].activo?.divisa).toBe("GBP");
  });

  it("10 a 250 GBp son 31,25 €, y la cartera vale los 100 € que entraron; antes, 3.193,75 €", async () => {
    /* 10 × 250 p = 2.500 p = 25 £; 25 / 0,80 = 31,25 €. Efectivo: 100 − 31,25 = 68,75 €. Total: 31,25 + 68,75 = 100 €. */
    expect(await valorDelDia(aplicarTodo([importar(compraEn("GBp", "250"))]))).toBeCloseTo(100, 8);
    expect(await valorDelDia(aplicarTodo([importar(compraEn("GBX", "250"))]))).toBeCloseTo(100, 8);
    /* En libras de verdad, 10 a 2,50 £: 25 / 0,80 = 31,25 €, la misma cuenta. */
    expect(await valorDelDia(aplicarTodo([importar(compraEn("GBP", "2,50"))]))).toBeCloseTo(100, 8);
    /* Lo que hacía la lectura de antes: 250 leído en libras, 2.500 / 0,80 = 3.125 €, más 68,75 € = 3.193,75 €. */
    expect(await valorDelDia(aplicarTodo([importar(compraEn("GBP", "250"))]))).toBeCloseTo(3193.75, 8);
  });

  it("la hoja «Posiciones» de la plantilla conserva «GBp» en el activo y en el precio", () => {
    const posiciones = [
      ["Fecha", "ISIN", "Nombre", "Títulos", "Valor", "Precio", "Divisa"],
      ["07/01/2026", ISIN_GB, "Acción británica", "10", "31,25", "250", "GBp"],
      ["07/01/2026", "GB0000000020", "Otra británica", "10", "31,25", "250", "GBX"],
      ["07/01/2026", "GB0000000038", "Una en libras", "10", "31,25", "2,50", "GBP"]
    ];
    const resultado = importar(compraEn("GBp", "250"), posiciones);
    expect(resultado.avisos).toEqual([]);
    expect(resultado.extractos[0].posiciones.map((p) => [p.activo.divisa, p.cotizacion, p.divisa])).toEqual([
      ["GBp", "250", "GBp"],
      ["GBX", "250", "GBX"],
      ["GBP", "2.5", "GBP"]
    ]);
  });

  it("el extracto de posiciones de Andbank conserva «GBp», y la operación sin divisa toma la de su posición", () => {
    /* 10 × 250 = 2.500 GBp de valor en su divisa; contravalor 31,25 €. */
    const posiciones = tablaDePosiciones([
      filaDePosicion({ producto: "ACCION BRITANICA PLC", isin: ISIN_GB, divisa: "GBp", titulos: "10", costeMedio: "250,00", precio: "250,00", fecha: "07/01/2026", coste: "2.500,00", valor: "2.500,00", plusvalia: "0,00", contravalor: "31,25" }),
      filaDeSubtotal("TOTAL ACCIONES INTERNACIONALES", "31,25"),
      filaDeSubtotal("TOTAL CARTERA", "31,25")
    ]);
    const leido = leerPosiciones(documentoDeAndbank("pos.xls", posiciones));
    expect(leido.posiciones[0].divisa).toBe("GBp");
    expect(leido.avisos).toEqual([]);

    const operaciones = tablaDeOperaciones([filaDeOperacion("2026-01-07", "2026-01-09", "COMPRA", ISIN_GB, "ACCION BRITANICA PLC", "10", "", "250.00", "31.25")]);
    const [resultado] = importarReconocidos([documentoDeAndbank("pos.xls", posiciones), documentoDeAndbank("ops.xls", operaciones)].map(reconocer), { divisaBase: "EUR" });
    expect(resultado.errores).toEqual([]);
    /* La operación no trae divisa: `citarOperacion` toma la de la posición, «GBp», no «GBP». */
    expect(resultado.movimientos.find((p) => p.activo?.isin === ISIN_GB)?.activo?.divisa).toBe("GBp");
    const declarada = resultado.extractos.find((extracto) => extracto.posiciones.length > 0)!.posiciones[0];
    expect([declarada.activo.divisa, declarada.precio, declarada.divisa]).toEqual(["GBp", "250", "GBp"]);
  });
});

describe("2. un bono no es una acción", () => {
  const compra = (tipo: string, extra: Record<string, string> = {}) =>
    hoja([
      { Fecha: ENTRADA, Tipo: "Aportación", Importe: "10000" },
      { Fecha: COMPRA, Tipo: tipo, ISIN: ISIN_BONO, Nombre: "Bono Ejemplo 2030", Títulos: "10000", Precio: "98,5", Importe: "-9850", ...extra }
    ]);

  const citado = (resultado: ResultadoDeImportacion, isin: string) => activosCitados([resultado]).find((a) => a.citado.isin === isin)!;

  it("«Compra de bonos» y «Venta de bonos» dicen bono; «Compra de acciones», acción; «Compra» a secas solo lo supone", () => {
    expect(citado(importar(compra("Compra de bonos")), ISIN_BONO).citado).toMatchObject({ tipo: "BONO" });
    expect(citado(importar(compra("Compra de bonos")), ISIN_BONO).citado.tipoSupuesto).toBeUndefined();
    expect(citado(importar(compra("Venta de bonos", { Importe: "9850" })), ISIN_BONO).citado.tipo).toBe("BONO");
    expect(citado(importar(compra("Compra de acciones")), ISIN_BONO).citado.tipoSupuesto).toBeUndefined();
    expect(citado(importar(compra("Compra")), ISIN_BONO).citado).toMatchObject({ tipo: "ACCION", tipoSupuesto: true });
  });

  it("con «Compra» a secas y sin catálogo, el activo espera a que el asesor diga el tipo, y su compra no entra", () => {
    const resultado = importar(compra("Compra"));
    const revision = revisar([resultado], vacia(), []);
    const bono = revision.activos.find((a) => a.citado.clave === ISIN_BONO)!;
    expect(bono.estado).toBe("falta-el-tipo");
    expect(bono.propuesto).toBeUndefined();
    expect(queSeHara(bono, undefined, new Set())).toBe("Falta decir qué tipo de activo es");
    const linea = revision.lineas.find((l) => l.propuesto.movimiento.tipo === "compra")!;
    expect(linea.movimiento).toBeUndefined();
    expect(linea.motivo).toBe(MOTIVO_FALTA_EL_TIPO);
    expect(seleccionable(linea)).toBe(false);
    expect(estadoDeLaLinea(linea)).toEqual({ etiqueta: "Falta el tipo", gravedad: "pendiente", detalle: "Falta decir qué tipo de activo es." });
    /* La aportación no depende de él: entra. */
    expect(revision.listas).toBe(1);
    expect(revision.porRevisar).toBe(1);
  });

  it("dicho «bono»: 0,01 de multiplicador, ningún aviso, y la cartera vale 10.000 €; dicho «acción», la guarda lo caza", async () => {
    const resultado = importar(compra("Compra"));
    const [citadoDelBono] = activosCitados([resultado]).filter((a) => a.citado.clave === ISIN_BONO);
    const comoBono = activoNuevoDelTipo(citadoDelBono.citado, "BONO", "EUR");
    expect(comoBono).toMatchObject({ id: ISIN_BONO, isin: ISIN_BONO, tipo: "BONO", multiplicador: "0.01", origen: "manual" });
    const decisiones = new Map<string, DecisionSobreUnActivo>([[ISIN_BONO, comoBono]]);
    const revision = revisar([resultado], vacia(), [], decisiones);
    expect(revision.lineas.every((l) => l.porDefecto && l.avisos.length === 0)).toBe(true);
    expect(queSeHara(revision.activos.find((a) => a.citado.clave === ISIN_BONO)!, comoBono, new Set())).toBe("Activo propio con precio a mano (bono, con el precio en % del nominal): Bono Ejemplo 2030");
    /* 10.000 × 98,5 × 0,01 = 9.850 € del bono; 10.000 − 9.850 = 150 € de efectivo; 10.000 € en total. */
    expect(await valorDelDia(aplicarTodo([resultado], decisiones))).toBeCloseTo(10000, 8);

    const comoAccion = new Map<string, DecisionSobreUnActivo>([[ISIN_BONO, activoNuevoDelTipo(citadoDelBono.citado, "ACCION", "EUR")]]);
    const linea = revisar([resultado], vacia(), [], comoAccion).lineas.find((l) => l.propuesto.movimiento.tipo === "compra")!;
    /* 10.000 × 98,5 = 985.000 €, frente a los 9.850 € de la fila: cien veces. */
    expect(linea.avisos).toEqual([
      "El importe no cuadra con los títulos y el precio: con 10.000 títulos a 98,50 € sería 985.000,00 €, y la fila dice 9.850,00 €. Es unas cien veces más: si es un bono, su precio va en % del nominal; si cotiza en peniques, su divisa es «GBp»."
    ]);
    expect(estadoDeLaLinea(linea).etiqueta).toBe("Revisar");
    expect(hayQueMirar(linea)).toBe(true);
    /* El asesor puede importarla igual: es un aviso, no un error. Y así valía: 985.000 + 150 = 985.150 €. */
    expect(seleccionable(linea)).toBe(true);
    expect(await valorDelDia(aplicarTodo([resultado], comoAccion))).toBeCloseTo(985150, 6);
  });

  it("con cupón corrido es bono sin preguntar: 9.850 + 50 = 9.900 € pagados, y la guarda calla", async () => {
    const resultado = importar(compra("Compra", { Importe: "-9900", "Cupón corrido": "50" }));
    const revision = revisar([resultado], vacia(), []);
    const bono = revision.activos.find((a) => a.citado.clave === ISIN_BONO)!;
    expect(bono.estado).toBe("nuevo");
    expect(bono.propuesto).toMatchObject({ tipo: "BONO", multiplicador: "0.01" });
    expect(revision.lineas.every((l) => l.porDefecto && l.avisos.length === 0)).toBe(true);
    /* Efectivo: 10.000 − 9.900 = 100 €. El bono, a su precio de compra sin el corrido: 9.850 €, más el cupón devengado del
       día, que el motor solo suma con las condiciones del bono, que este no tiene. Total: 9.950 €. */
    expect(await valorDelDia(aplicarTodo([resultado]))).toBeCloseTo(9950, 6);
  });

  it("«Compra de bonos» a la par: 10.000 × 100 × 0,01 = 10.000 €, sin pregunta ni aviso", () => {
    const resultado = importar(compra("Compra de bonos", { Precio: "100", Importe: "-10000" }));
    const revision = revisar([resultado], vacia(), []);
    expect(revision.activos.find((a) => a.citado.clave === ISIN_BONO)!.estado).toBe("nuevo");
    expect(revision.lineas.every((l) => l.porDefecto && l.avisos.length === 0)).toBe(true);
  });

  it("una acción a 98,5 sigue siendo acción cuando lo dice la fila o el catálogo", () => {
    /* 100 × 98,5 = 9.850 €: lo pagado. */
    const filas = hoja([
      { Fecha: ENTRADA, Tipo: "Aportación", Importe: "10000" },
      { Fecha: COMPRA, Tipo: "Compra de acciones", ISIN: ISIN_ACCION, Nombre: "Acción a 98,5", Títulos: "100", Precio: "98,5", Importe: "-9850" }
    ]);
    const porLaFila = revisar([importar(filas)], vacia(), []);
    const accion = porLaFila.activos.find((a) => a.citado.clave === ISIN_ACCION)!;
    expect(accion.estado).toBe("nuevo");
    expect(accion.propuesto).toMatchObject({ tipo: "ACCION" });
    expect(accion.propuesto!.multiplicador).toBeUndefined();
    expect(porLaFila.lineas.every((l) => l.porDefecto && l.avisos.length === 0)).toBe(true);

    /* «Compra» a secas, pero el catálogo la tiene: del catálogo, sin preguntar el tipo. */
    const conCompra = filas.map((fila) => fila.map((celda) => (celda === "Compra de acciones" ? "Compra" : celda)));
    const catalogo: ActivoDeCatalogo[] = [{ isin: ISIN_ACCION, nombre: "Acción a 98,5", tipo: "ACCION", divisa: "EUR" }];
    const porElCatalogo = revisar([importar(conCompra)], vacia(), catalogo);
    expect(porElCatalogo.activos.find((a) => a.citado.clave === ISIN_ACCION)!.estado).toBe("en-catalogo");
    expect(porElCatalogo.lineas.every((l) => l.porDefecto && l.avisos.length === 0)).toBe(true);
  });

  it("«Venta de bonos» no se confunde con otros tipos: cada rótulo de tipo de activo es un sinónimo de compra o de venta", async () => {
    const { TIPO_DE_ACTIVO_DE_LOS_ROTULOS, reconocerTipo } = await import("../../src/gestor/importacion/plantilla/columnas");
    for (const [rotulo, tipo] of Object.entries(TIPO_DE_ACTIVO_DE_LOS_ROTULOS) as Array<[string, TipoDeActivo]>) {
      expect(["compra", "venta"], rotulo).toContain(reconocerTipo(rotulo)?.tipo);
      expect(["ACCION", "BONO", "ETF"], rotulo).toContain(tipo);
    }
  });
});

describe("3. la guarda del importe", () => {
  const EUR: Activo = { id: "A", nombre: "Acción", tipo: "ACCION", divisa: "EUR", origen: "manual" };
  const contexto = (activo: Activo) => ({ divisaBase: "EUR", activo: (id: string | undefined) => (id === activo.id ? activo : undefined) });
  const compra = (campos: Record<string, string>) => ({ id: "m", tipo: "compra", fechaOperacion: DIA, activoId: "A", ...campos });

  it("calla dentro del 2 % y habla por encima", () => {
    /* 100 × 98,5 = 9.850 €. 9.850 × 1,02 = 10.047 €: 10.040 € cabe; 10.050 € no. */
    expect(descuadreDelImporte(compra({ titulos: "100", precio: "98.5", importe: "-9850" }), contexto(EUR))).toBeUndefined();
    expect(descuadreDelImporte(compra({ titulos: "100", precio: "98.5", importe: "-10040" }), contexto(EUR))).toBeUndefined();
    expect(descuadreDelImporte(compra({ titulos: "100", precio: "98.5", importe: "-10050" }), contexto(EUR))).toBe(
      "El importe no cuadra con los títulos y el precio: con 100 títulos a 98,50 € sería 9.850,00 €, y la fila dice 10.050,00 €."
    );
    /* Con la comisión de la fila, dentro del importe: 9.850 + 150 = 10.000 €, que cuadra. */
    expect(descuadreDelImporte(compra({ titulos: "100", precio: "98.5", importe: "-10000", comision: "150" }), contexto(EUR))).toBeUndefined();
  });

  it("sin cambio con que convertir no compara", () => {
    const enDolares: Activo = { ...EUR, divisa: "USD" };
    expect(descuadreDelImporte(compra({ titulos: "10", precio: "100", importe: "-1" }), contexto(enDolares))).toBeUndefined();
  });

  it("caza los peniques leídos como libras, y dice cómo va el cambio de los peniques", () => {
    /* Lo que leía la plantilla antes: 250 en libras. Con el cambio de la fila, 0,80 libras por euro: 2.500 / 0,80 = 3.125 €,
       frente a 31,25 €. */
    const filas = (divisa: string, cambio: string) =>
      hoja([{ Fecha: COMPRA, Tipo: "Compra de acciones", ISIN: ISIN_GB, Nombre: "Acción británica", Títulos: "10", Precio: "250", "Divisa del activo": divisa, Importe: "-31,25", Cambio: cambio }]);
    const avisos = (divisa: string, cambio: string) => revisar([importar(filas(divisa, cambio))], vacia(), []).lineas[0].avisos;
    expect(avisos("GBP", "0,80")).toEqual([
      "El importe no cuadra con los títulos y el precio: con 10 títulos a 250,00 GBP y un cambio de 0,8000 sería 3.125,00 €, y la fila dice 31,25 €. Es unas cien veces más: si es un bono, su precio va en % del nominal; si cotiza en peniques, su divisa es «GBp»."
    ]);
    /* En peniques, el cambio de la fila es de peniques por euro, como lo usa el motor: 80. 2.500 / 80 = 31,25 €. */
    expect(avisos("GBp", "80")).toEqual([]);
    /* Y si se escribe en libras por euro, la guarda lo dice. */
    expect(avisos("GBp", "0,80")).toEqual([
      "El importe no cuadra con los títulos y el precio: con 10 títulos a 250,00 GBp y un cambio de 0,8000 sería 3.125,00 €, y la fila dice 31,25 €. Es unas cien veces más: el cambio de «GBp» va en peniques por 1 de EUR, y 0,8000 libras se escriben 80,00."
    ]);
  });
});
