// @vitest-environment happy-dom
/**
 * La lógica del asistente de importación, sin pintar (happy-dom solo por su `FileReader`, que usa la lectura): de los ficheros que suelta el usuario a
 * la cartera que quedaría, con su comprobación contra los extractos y las posiciones
 * iniciales que faltan. Con los extractos sintéticos de `andbankDeMuestra.ts`.
 */
import { describe, expect, it } from "vitest";
import { importarReconocidos, reconocer } from "../../src/gestor/importacion/registro";
import { revisar, type DecisionSobreUnActivo } from "../../src/gestor/importacion/revision";
import type { ActivoDeCatalogo } from "../../src/gestor/mercado/fichas";
import { construirLibro } from "../../src/gestor/motor/libro";
import { carteraVacia } from "../../src/gestor/motor/modelo";
import { comprobar, descripcionDeLaImportacion, fraseDeCuadre, proponerPosicionesIniciales, queSueleSignificar } from "../../src/gestor/ui/importar/comprobacion";
import { leerYReconocer, queEs, resultadosDe, sePuedeContinuar, type FicheroDelAsistente } from "../../src/gestor/ui/importar/ficheros";
import { elegidas, estaMarcada, estadoDeLaLinea, resumenDeLaRevision } from "../../src/gestor/ui/importar/revisionDelAsistente";
import {
  ISIN_BOLSA,
  ISIN_ELECTRICA,
  ISIN_MIXTO,
  ISIN_TECNOLOGIA,
  MOVIMIENTOS_COMPLETOS,
  OPERACIONES_COMPLETAS,
  POSICIONES_COMPLETAS,
  documento,
  filaDePosicion,
  filaDeSubtotal,
  tablaDePosiciones
} from "./andbankDeMuestra";

const CATALOGO: ActivoDeCatalogo[] = [
  { isin: ISIN_BOLSA, nombre: "Fondo Bolsa Mundial", tipo: "FONDO", divisa: "EUR" },
  { isin: ISIN_TECNOLOGIA, nombre: "Tecnologia Global Inc", tipo: "ACCION", divisa: "USD", ticker: "TGI" },
  { isin: "LU0000009999", nombre: "Otro Fondo Mixto Europa", tipo: "FONDO", divisa: "EUR" }
];

const vacia = () => carteraVacia({ nombre: "Importada", ahora: "2026-01-01T00:00:00.000Z", id: "c" });
const AHORA = "2026-11-13T10:00:00.000Z";

function fichero(nombre: string, html: string): File {
  return new File([html], nombre, { lastModified: 1 });
}

async function leerTodos(ficheros: File[]): Promise<FicheroDelAsistente[]> {
  return Promise.all(ficheros.map((f, i) => leerYReconocer(f, `f${i}`)));
}

const TRES = () => [fichero("mov.xls", MOVIMIENTOS_COMPLETOS), fichero("pos.xls", POSICIONES_COMPLETAS), fichero("ops.xls", OPERACIONES_COMPLETAS)];

/* Las posiciones del juego completo, con un fondo en euros más que el libro no tiene. */
const ISIN_HEREDADO = "LU0000000076";
const POSICIONES_CON_UN_FONDO_HEREDADO = tablaDePosiciones([
  filaDePosicion({ producto: "ELECTRICA DEL SUR SA", isin: ISIN_ELECTRICA, divisa: "EUR", titulos: "50", costeMedio: "12,35", precio: "15,00", fecha: "29/09/2025", coste: "617,28", valor: "750,00", plusvalia: "132,72", contravalor: "750,00" }),
  filaDeSubtotal("TOTAL ACCIONES NACIONALES", "750,00"),
  filaDePosicion({ producto: "TECNOLOGIA AMERICANA INC", isin: ISIN_TECNOLOGIA, divisa: "USD", titulos: "10", costeMedio: "198,00", precio: "210,00", fecha: "29/09/2025", coste: "1.980,00", valor: "2.100,00", plusvalia: "120,00", contravalor: "1.800,00" }),
  filaDeSubtotal("TOTAL ACCIONES INTERNACIONALES", "1.800,00"),
  filaDePosicion({ producto: "FONDO MIXTO PRUDENTE EURO", isin: ISIN_MIXTO, divisa: "EUR", titulos: "100", costeMedio: "10,00", precio: "10,90", fecha: "30/09/2025", coste: "1.000,00", valor: "1.090,00", plusvalia: "90,00", contravalor: "1.090,00" }),
  filaDePosicion({ producto: "FONDO BOLSA GLOBAL", isin: ISIN_BOLSA, divisa: "EUR", titulos: "100", costeMedio: "15,90", precio: "16,20", fecha: "29/09/2025", coste: "1.590,00", valor: "1.620,00", plusvalia: "30,00", contravalor: "1.620,00" }),
  /* 200 participaciones a 15,00 = 3.000,00. */
  filaDePosicion({ producto: "FONDO HEREDADO EURO", isin: ISIN_HEREDADO, divisa: "EUR", titulos: "200", costeMedio: "12,00", precio: "15,00", fecha: "29/09/2025", coste: "2.400,00", valor: "3.000,00", plusvalia: "600,00", contravalor: "3.000,00" }),
  filaDeSubtotal("TOTAL FONDOS INTERNACIONALES", "5.710,00"), // 1.090 + 1.620 + 3.000
  filaDeSubtotal("TOTAL CARTERA", "8.260,00") // 750 + 1.800 + 5.710
]);

/* Y otra con una acción en dólares más: su valor viene en euros y no da su precio en dólares. */
const ISIN_DOLARES = "US0000000043";
const POSICIONES_CON_UNA_ACCION_EN_DOLARES = tablaDePosiciones([
  filaDePosicion({ producto: "ELECTRICA DEL SUR SA", isin: ISIN_ELECTRICA, divisa: "EUR", titulos: "50", costeMedio: "12,35", precio: "15,00", fecha: "29/09/2025", coste: "617,28", valor: "750,00", plusvalia: "132,72", contravalor: "750,00" }),
  filaDeSubtotal("TOTAL ACCIONES NACIONALES", "750,00"),
  filaDePosicion({ producto: "TECNOLOGIA AMERICANA INC", isin: ISIN_TECNOLOGIA, divisa: "USD", titulos: "10", costeMedio: "198,00", precio: "210,00", fecha: "29/09/2025", coste: "1.980,00", valor: "2.100,00", plusvalia: "120,00", contravalor: "1.800,00" }),
  /* 10 × 50 = 500 USD, 450 EUR. */
  filaDePosicion({ producto: "ACCION AMERICANA HEREDADA", isin: ISIN_DOLARES, divisa: "USD", titulos: "10", costeMedio: "40,00", precio: "50,00", fecha: "29/09/2025", coste: "400,00", valor: "500,00", plusvalia: "100,00", contravalor: "450,00" }),
  filaDeSubtotal("TOTAL ACCIONES INTERNACIONALES", "2.250,00"), // 1.800 + 450
  filaDePosicion({ producto: "FONDO MIXTO PRUDENTE EURO", isin: ISIN_MIXTO, divisa: "EUR", titulos: "100", costeMedio: "10,00", precio: "10,90", fecha: "30/09/2025", coste: "1.000,00", valor: "1.090,00", plusvalia: "90,00", contravalor: "1.090,00" }),
  filaDePosicion({ producto: "FONDO BOLSA GLOBAL", isin: ISIN_BOLSA, divisa: "EUR", titulos: "100", costeMedio: "15,90", precio: "16,20", fecha: "29/09/2025", coste: "1.590,00", valor: "1.620,00", plusvalia: "30,00", contravalor: "1.620,00" }),
  filaDeSubtotal("TOTAL FONDOS INTERNACIONALES", "2.710,00"),
  filaDeSubtotal("TOTAL CARTERA", "5.710,00") // 750 + 2.250 + 2.710
]);

describe("paso 1: leer y reconocer los ficheros", () => {
  it("reconoce los tres extractos de Andbank y dice qué es cada uno", async () => {
    const leidos = await leerTodos(TRES());
    expect(leidos.map((f) => f.estado)).toEqual(["reconocido", "reconocido", "reconocido"]);
    expect(leidos.map(queEs)).toEqual(leidos.map((f) => `Andbank · ${f.reconocimiento!.etiqueta}`));
    expect(queEs(leidos[0])).toMatch(/^Andbank · /);
    expect(sePuedeContinuar(leidos)).toBe(true);
  });

  it("un fichero ajeno sale como no reconocido, con lo que se intentó, y solo él no deja continuar", async () => {
    const [ajeno] = await leerTodos([fichero("carta.html", "<html><body><table><tr><td>Estimado cliente</td></tr></table></body></html>")]);
    expect(ajeno.estado).toBe("no-reconocido");
    expect(ajeno.reconocimiento!.intentos.some((intento) => intento.startsWith("Andbank:"))).toBe(true);
    expect(ajeno.reconocimiento!.intentos.some((intento) => intento.startsWith("Plantilla"))).toBe(true);
    expect(sePuedeContinuar([ajeno])).toBe(false);
  });

  it("un tipo de fichero que no se lee lo dice sin intentarlo", async () => {
    const [pdf] = await leerTodos([fichero("extracto.pdf", "%PDF-1.4")]);
    expect(pdf.estado).toBe("ilegible");
    expect(pdf.error).toContain(".xls");
  });
});

describe("paso 2: la revisión", () => {
  it("da las mismas cuentas que la revisión hecha con los documentos ya leídos", async () => {
    const resultados = resultadosDe(await leerTodos(TRES()), "EUR");
    const referencia = importarReconocidos(
      [documento("mov.xls", MOVIMIENTOS_COMPLETOS), documento("pos.xls", POSICIONES_COMPLETAS), documento("ops.xls", OPERACIONES_COMPLETAS)].map(reconocer),
      { divisaBase: "EUR" }
    );
    const revision = revisar(resultados, vacia(), CATALOGO);
    const esperada = revisar(referencia, vacia(), CATALOGO);
    expect(resultados).toHaveLength(1);
    expect([revision.lineas.length, revision.listas, revision.duplicadas, revision.porRevisar]).toEqual([esperada.lineas.length, esperada.listas, esperada.duplicadas, esperada.porRevisar]);
    expect(revision.listas).toBeGreaterThan(10);
    expect(resumenDeLaRevision(revision)).toBe(`${revision.listas} movimientos listos${revision.porRevisar ? ` · ${revision.porRevisar} por revisar` : ""}`);
    /* Marcadas por defecto, las que entran por defecto. */
    expect(elegidas(revision, new Map()).size).toBe(revision.listas);
  });

  it("dejar fuera un activo desmarca sus líneas y las dice fuera; una marca a mano se respeta", async () => {
    const resultados = resultadosDe(await leerTodos(TRES()), "EUR");
    const decisiones = new Map<string, DecisionSobreUnActivo>([[ISIN_ELECTRICA, "omitir"]]);
    const revision = revisar(resultados, vacia(), CATALOGO, decisiones);
    const fuera = revision.lineas.filter((linea) => linea.propuesto.activo?.clave === ISIN_ELECTRICA);
    expect(fuera.length).toBeGreaterThan(0);
    expect(fuera.every((linea) => !estaMarcada(linea, new Map()) && estadoDeLaLinea(linea).gravedad === "fuera")).toBe(true);
    const otra = revision.lineas.find((linea) => linea.porDefecto)!;
    expect(estaMarcada(otra, new Map([[otra.propuesto.movimiento.id, false]]))).toBe(false);
  });
});

describe("paso 3: la comprobación contra los extractos", () => {
  it("con todo marcado, la cartera cuadra con los dos extractos", async () => {
    const resultados = resultadosDe(await leerTodos(TRES()), "EUR");
    const revision = revisar(resultados, vacia(), CATALOGO);
    const comprobacion = comprobar(vacia(), resultados, revision, elegidas(revision, new Map()), new Map(), [], AHORA);
    expect(comprobacion.conciliaciones).toHaveLength(2);
    expect(comprobacion.cuadra).toBe(true);
    expect(comprobacion.movimientos).toBe(revision.listas);
    expect(descripcionDeLaImportacion(comprobacion)).toBe(`Importar ${revision.listas} movimientos de Andbank`);
    const deposiciones = comprobacion.conciliaciones.find((c) => c.extracto.posiciones.length > 0)!;
    expect(fraseDeCuadre(deposiciones)).toBe("La cartera cuadra con el extracto del 30/09/2025: 4 posiciones.");
    const deEfectivo = comprobacion.conciliaciones.find((c) => c.extracto.posiciones.length === 0)!;
    expect(fraseDeCuadre(deEfectivo)).toBe("La cartera cuadra con el extracto del 15/09/2025: el saldo de efectivo.");
  });

  it("sin la aportación inicial, no cuadra el efectivo: faltan 50.000 € y lo explica", async () => {
    const resultados = resultadosDe(await leerTodos(TRES()), "EUR");
    const revision = revisar(resultados, vacia(), CATALOGO);
    const aportacion = revision.lineas.find((linea) => linea.movimiento?.tipo === "aportacion" && linea.movimiento.importe === "50000")!;
    expect(aportacion).toBeDefined();
    const marcas = new Map([[aportacion.propuesto.movimiento.id, false]]);
    const comprobacion = comprobar(vacia(), resultados, revision, elegidas(revision, marcas), new Map(), [], AHORA);
    expect(comprobacion.cuadra).toBe(false);
    const diferencias = comprobacion.conciliaciones.flatMap((c) => c.diferencias);
    expect(diferencias.map((dif) => [dif.concepto, dif.diferencia.toFixed(2)])).toEqual([["Efectivo en EUR", "-50000.00"]]);
    const conDiferencia = comprobacion.conciliaciones.find((c) => !c.cuadra)!;
    expect(queSueleSignificar(conDiferencia).join(" ")).toContain("El saldo de efectivo no coincide");
    expect(proponerPosicionesIniciales(comprobacion, revision, elegidas(revision, marcas), new Map()).propuestas).toEqual([]);
  });

  it("si el extracto declara un fondo que el libro no tiene, propone su posición inicial y, al añadirla, cuadra", async () => {
    const resultados = resultadosDe(await leerTodos([fichero("mov.xls", MOVIMIENTOS_COMPLETOS), fichero("pos.xls", POSICIONES_CON_UN_FONDO_HEREDADO), fichero("ops.xls", OPERACIONES_COMPLETAS)]), "EUR");
    const revision = revisar(resultados, vacia(), CATALOGO);
    const marcadas = elegidas(revision, new Map());
    const antes = comprobar(vacia(), resultados, revision, marcadas, new Map(), [], AHORA);
    expect(antes.cuadra).toBe(false);
    const faltan = antes.conciliaciones.flatMap((c) => c.diferencias);
    expect(faltan.map((dif) => [dif.concepto, dif.enElLibro.toFixed(), dif.enElExtracto.toFixed()])).toEqual([["FONDO HEREDADO EURO", "0", "200"]]);
    expect(queSueleSignificar(antes.conciliaciones.find((c) => !c.cuadra)!).join(" ")).toContain("faltan las posiciones iniciales");

    const { propuestas, sinProponer } = proponerPosicionesIniciales(antes, revision, marcadas, new Map());
    expect(sinProponer).toEqual([]);
    expect(propuestas).toHaveLength(1);
    const [inicial] = propuestas;
    expect(inicial.activo).toMatchObject({ id: ISIN_HEREDADO, isin: ISIN_HEREDADO, divisa: "EUR", origen: "manual" });
    /*
     * El precio propuesto: el valor declarado entre los títulos declarados,
     * 3.000,00 € / 200 = 15 € por participación. El fondo cotiza en euros, la divisa base,
     * así que no hace falta convertirlo. La fecha: el primer movimiento importado es la
     * apertura del 02-01-2025; la víspera, 01-01-2025.
     */
    expect(inicial.movimiento).toMatchObject({ tipo: "entradaDeTitulos", activoId: ISIN_HEREDADO, titulos: "200", precio: "15", fechaOperacion: "2025-01-01" });

    const despues = comprobar(vacia(), resultados, revision, marcadas, new Map(), propuestas, AHORA);
    expect(despues.cuadra).toBe(true);
    expect(despues.movimientos).toBe(revision.listas + 1);
    /* Entra con la marca de la importación, para que deshacerla la quite también, y sin errores en el libro. */
    const entrada = despues.cartera.movimientos.find((m) => m.tipo === "entradaDeTitulos")!;
    expect(entrada.origen).toMatchObject({ via: "importado", importacionId: despues.importacion.id });
    expect(construirLibro(despues.cartera).avisos).toEqual([]);
  });

  it("una posición en otra divisa no se propone: su valor viene en euros y no da el precio", async () => {
    const resultados = resultadosDe(await leerTodos([fichero("mov.xls", MOVIMIENTOS_COMPLETOS), fichero("pos.xls", POSICIONES_CON_UNA_ACCION_EN_DOLARES), fichero("ops.xls", OPERACIONES_COMPLETAS)]), "EUR");
    const revision = revisar(resultados, vacia(), CATALOGO);
    const marcadas = elegidas(revision, new Map());
    const antes = comprobar(vacia(), resultados, revision, marcadas, new Map(), [], AHORA);
    const { propuestas, sinProponer } = proponerPosicionesIniciales(antes, revision, marcadas, new Map());
    expect(propuestas).toEqual([]);
    expect(sinProponer).toHaveLength(1);
    expect(sinProponer[0]).toContain("cotiza en USD");
  });
});
