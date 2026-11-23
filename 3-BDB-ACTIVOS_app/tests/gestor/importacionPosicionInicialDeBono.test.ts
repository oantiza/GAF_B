/**
 * H1-08 (a) de la auditoría del 22-11-2026: un bono nuevo, sin catálogo, que entra por «Posición inicial» de la plantilla
 * se daba de alta como «Otro», sin el multiplicador 0,01. 10.000 de nominal al 98,5 valían 10.000 × 98,5 = 985.000 € en
 * vez de 10.000 × 98,5 × 0,01 = 9.850 €, con la línea en «Listo» y sin aviso. El arreglo de las compras (`a13227c5`) no
 * cubría las entradas de títulos, que es la forma documentada de empezar una cartera. Ahora la entrada supone «Otro» débil
 * y, si nada en el documento dice el tipo, la revisión pregunta. Cada cifra esperada sale de la cuenta escrita junto a ella.
 */
import { describe, expect, it } from "vitest";
import { importadorDePlantilla } from "../../src/gestor/importacion/plantilla";
import { MOTIVO_FALTA_EL_TIPO, activoNuevoDelTipo, activosCitados, aplicarImportacion, revisar, type DecisionSobreUnActivo } from "../../src/gestor/importacion/revision";
import type { DocumentoLeido, ResultadoDeImportacion } from "../../src/gestor/importacion/tipos";
import { cargarMercado, olvidarMercado, type FuenteDeMercado } from "../../src/gestor/mercado/cargar";
import type { ActivoDeCatalogo } from "../../src/gestor/mercado/fichas";
import { carteraVacia, type Cartera } from "../../src/gestor/motor/modelo";
import { valorar } from "../../src/gestor/motor/valoracion";
import { estadoDeLaLinea, seleccionable } from "../../src/gestor/ui/importar/revisionDelAsistente";

const DIA = "2026-01-07";
const ISIN_BONO = "ES0000000052";
const CABECERA = ["Fecha", "Tipo", "ISIN", "Nombre", "Títulos", "Precio", "Divisa del activo", "Importe", "Valor"];

function hoja(filas: Array<Record<string, string>>): string[][] {
  return [CABECERA, ...filas.map((fila) => CABECERA.map((columna) => fila[columna] ?? ""))];
}

function importar(tabla: string[][]): ResultadoDeImportacion {
  const doc: DocumentoLeido = { nombre: "plantilla.xlsx", texto: "", tablas: [tabla] };
  const resultado = importadorDePlantilla.importar([{ documento: doc, tipo: "movimientos" }], { divisaBase: "EUR" });
  expect(resultado.errores).toEqual([]);
  return resultado;
}

const vacia = (): Cartera => carteraVacia({ nombre: "Importada", ahora: "2026-01-01T00:00:00.000Z", id: "c" });

function aplicarTodo(resultado: ResultadoDeImportacion, decisiones: Map<string, DecisionSobreUnActivo> = new Map(), catalogo: ActivoDeCatalogo[] = []): Cartera {
  const revision = revisar([resultado], vacia(), catalogo, decisiones);
  const elegidas = new Set(revision.lineas.filter((linea) => linea.movimiento && linea.errores.length === 0).map((linea) => linea.propuesto.movimiento.id));
  return aplicarImportacion(vacia(), [resultado], revision, elegidas, decisiones, "2026-11-22T10:00:00.000Z").cartera;
}

const SIN_MERCADO: FuenteDeMercado = {
  preciosDelAnio: async () => undefined,
  cambiosDelAnio: async () => undefined,
  libreDeRiesgoDelAnio: async () => undefined,
  tarjeta: async () => undefined
};

async function valorDelDia(cartera: Cartera): Promise<number> {
  olvidarMercado();
  const mercado = await cargarMercado(cartera, DIA, SIN_MERCADO);
  const v = valorar(cartera, mercado.datos, { hasta: DIA });
  return v.valor[v.indice.get(DIA)!];
}

const posicionInicial = (tipo = "Posición inicial", extra: Record<string, string> = {}) =>
  hoja([{ Fecha: "07/01/2026", Tipo: tipo, ISIN: ISIN_BONO, Nombre: "Bono Ejemplo 2030", Títulos: "10000", Precio: "98,5", "Divisa del activo": "EUR", ...extra }]);

describe("H1-08 (a): un bono nuevo por «Posición inicial»", () => {
  it("la entrada de títulos solo supone el tipo: la cita lleva «Otro» y `tipoSupuesto`", () => {
    for (const rotulo of ["Posición inicial", "Traspaso de entrada", "Alta de títulos", "Recepción de títulos"]) {
      expect(activosCitados([importar(posicionInicial(rotulo))]).find((a) => a.citado.clave === ISIN_BONO)!.citado, rotulo).toMatchObject({ tipo: "OTRO", tipoSupuesto: true });
    }
  });

  it("sin catálogo, el activo espera a que el asesor diga el tipo, y su entrada no se puede marcar", () => {
    const revision = revisar([importar(posicionInicial())], vacia(), []);
    const bono = revision.activos.find((a) => a.citado.clave === ISIN_BONO)!;
    expect(bono.estado).toBe("falta-el-tipo");
    expect(bono.propuesto).toBeUndefined();
    const linea = revision.lineas.find((l) => l.propuesto.movimiento.tipo === "entradaDeTitulos")!;
    expect(linea.movimiento).toBeUndefined();
    expect(linea.motivo).toBe(MOTIVO_FALTA_EL_TIPO);
    expect(seleccionable(linea)).toBe(false);
    expect(estadoDeLaLinea(linea).etiqueta).toBe("Falta el tipo");
    expect(revision.listas).toBe(0);
    expect(revision.porRevisar).toBe(1);
  });

  it("dicho «bono»: 10.000 × 98,5 × 0,01 = 9.850 €; dicho «otro», 10.000 × 98,5 = 985.000 €, que es lo que entraba antes sin preguntar", async () => {
    const resultado = importar(posicionInicial());
    const [citado] = activosCitados([resultado]).filter((a) => a.citado.clave === ISIN_BONO);
    const comoBono = new Map<string, DecisionSobreUnActivo>([[ISIN_BONO, activoNuevoDelTipo(citado.citado, "BONO", "EUR")]]);
    expect(await valorDelDia(aplicarTodo(resultado, comoBono))).toBeCloseTo(9850, 8);
    const comoOtro = new Map<string, DecisionSobreUnActivo>([[ISIN_BONO, activoNuevoDelTipo(citado.citado, "OTRO", "EUR")]]);
    expect(await valorDelDia(aplicarTodo(resultado, comoOtro))).toBeCloseTo(985000, 6);
  });

  it("con el catálogo, o con otra fila que diga el tipo, no pregunta", async () => {
    const catalogo: ActivoDeCatalogo[] = [{ isin: ISIN_BONO, nombre: "Bono Ejemplo 2030", tipo: "BONO", divisa: "EUR" }];
    expect(revisar([importar(posicionInicial())], vacia(), catalogo).activos.find((a) => a.citado.clave === ISIN_BONO)!.estado).toBe("en-catalogo");

    /* Un cupón del mismo bono en el documento dice «bono» (firme): gana sobre el «Otro» supuesto de la entrada. */
    const conCupon = hoja([
      { Fecha: "07/01/2026", Tipo: "Posición inicial", ISIN: ISIN_BONO, Nombre: "Bono Ejemplo 2030", Títulos: "10000", Precio: "98,5", "Divisa del activo": "EUR" },
      { Fecha: "15/03/2026", Tipo: "Cupones", ISIN: ISIN_BONO, Nombre: "Bono Ejemplo 2030", Importe: "300" }
    ]);
    const resultado = importar(conCupon);
    const bono = revisar([resultado], vacia(), []).activos.find((a) => a.citado.clave === ISIN_BONO)!;
    expect(bono.estado).toBe("nuevo");
    expect(bono.propuesto).toMatchObject({ tipo: "BONO", multiplicador: "0.01" });
    /* 10.000 × 98,5 × 0,01 = 9.850 € el día de la entrada (el cupón llega en marzo). */
    expect(await valorDelDia(aplicarTodo(resultado))).toBeCloseTo(9850, 8);
  });
});
