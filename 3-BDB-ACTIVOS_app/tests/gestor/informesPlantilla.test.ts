/**
 * Los tres informes de la cartera de un cliente con la plantilla única (`src/reports/plantilla/`), leídos del PDF: el
 * informe de cartera y el de costes con el tema de cliente, y el del asesor con el interno. En cada uno: ninguna marca de
 * entidad ni hueco de código; el sello de su tema en la cabecera y en el pie de todas las hojas; «Página x de N»; la
 * identidad del asesor cuando llega, la que guardó para todos los informes cuando no llega, y nada cuando no hay
 * ninguna; y las cifras principales, las del análisis escritas con el módulo común.
 *
 * Con `INFORMES_PDF=<carpeta>` escribe allí cada PDF, en una carpeta por documento, para mirarlos hoja a hoja.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, test, vi } from "vitest";

/* Sin cuenta, `leerIdentidad()` no tiene nada que dar; con ella, el nombre visible de la cuenta. */
const sesion = vi.hoisted(() => ({
  auth: { currentUser: null as { uid?: string; displayName: string | null } | null },
  firestore: null,
  functions: null,
  appCheckReady: Promise.resolve()
}));
vi.mock("../../src/firebase", () => sesion);

import { importe, importeTitular, porcentaje, rentabilidad } from "../../src/core/formato";
import { crearInformePdf } from "../../src/gestor/informes";
import { cifraDeMetrica, motivoDeMetrica } from "../../src/gestor/informes/secciones/comun";
import type { DatosDelInforme, TipoDeInforme } from "../../src/gestor/informes/tipos";
import { analizar, preparar } from "../../src/gestor/motor/analisis";
import { sumarDias } from "../../src/gestor/motor/fechas";
import type { FichaDeActivo } from "../../src/gestor/motor/composicion";
import { METRICAS, metrica } from "../../src/gestor/motor/metricas/registro";
import type { Punto } from "../../src/gestor/motor/valoracion";
import { extractPdfPageTexts, extractPdfTextBaselines, extractPdfTextRuns } from "../support/pdfText";
import { activo, cartera, mov } from "./ayudas";
import { datosDeLaDemo, HOY, logotipoDePrueba, plano } from "./informesAyudas";

const ASESOR: NonNullable<DatosDelInforme["asesor"]> = { nombre: "Laura Asesora Ejemplo", entidad: "Asesores Independientes Ejemplo, EAF", contacto: "laura@ejemplo.test", logotipo: logotipoDePrueba() };

/** Lo que va bajo el nombre del documento: para quién es, si la cartera tiene cliente. */
const preparadoPara = (d: DatosDelInforme) => (d.analisis.cartera.cliente ? `Preparado para ${d.analisis.cartera.cliente}` : null);

const TEMA: Record<TipoDeInforme, { sello: string; documento: string; bajo: (datos: DatosDelInforme) => string | null }> = {
  cliente: { sello: "CONFIDENCIAL", documento: "Informe de la cartera", bajo: preparadoPara },
  costes: { sello: "CONFIDENCIAL", documento: "Costes de la cartera", bajo: preparadoPara },
  asesor: { sello: "USO INTERNO", documento: "Informe del asesor", bajo: () => "No entregar al cliente" }
};

/**
 * El caso largo: cuarenta fondos con nombres largos, uno en dólares, dos sin precio, una venta, más de cuarenta
 * movimientos (el del cliente enseña los cuarenta últimos), un fondo con coste corriente conocido y los demás sin él.
 */
function datosLargos(): DatosDelInforme {
  const desde = "2025-01-02";
  const dias: string[] = [];
  for (let dia = sumarDias(desde, -5); dia <= HOY; dia = sumarDias(dia, 1)) dias.push(dia);
  const activos = Array.from({ length: 40 }, (_, i) =>
    activo(`F${i + 1}`, "FONDO", i === 7 ? "USD" : "EUR", {
      nombre: `Fondo de inversión número ${i + 1} con un nombre muy largo, clase institucional acumulación cubierta en euros`,
      isin: `LU${String(1_000_000_000 + i * 7_654_321).slice(0, 10)}`
    })
  );
  /* Los dos últimos no tienen serie de precios: cuentan como cero, y el informe lo dice. */
  const conPrecio = activos.slice(0, 38);
  const precios = new Map<string, Punto[]>(conPrecio.map((a, i) => [a.id, dias.map((fecha, k) => ({ fecha, valor: 50 + i + Math.sin(k / 9 + i) * 4 + k * 0.01 }))]));
  const cambios = new Map<string, Punto[]>([["USD", dias.map((fecha) => ({ fecha, valor: 1.08 }))]]);
  const precioDe = (id: string, fecha: string) => precios.get(id)?.find((p) => p.fecha === fecha)?.valor ?? 10;
  const movimientos = [
    mov("aportacion", desde, { importe: "500000" }),
    ...activos.map((a) => mov("suscripcion", desde, { activoId: a.id, titulos: "100", precio: String(precioDe(a.id, desde)), importe: `-${(100 * precioDe(a.id, desde)).toFixed(2)}`, divisa: a.divisa === "USD" ? "USD" : undefined, cambio: a.divisa === "USD" ? "1.08" : undefined })),
    ...Array.from({ length: 12 }, (_, i) => mov("comision", sumarDias("2026-01-15", i * 25), { importe: "-12.5", nota: "Custodia" })),
    mov("reembolso", "2026-03-02", { activoId: "F3", titulos: "40", precio: String(precioDe("F3", "2026-03-02")), importe: (40 * precioDe("F3", "2026-03-02")).toFixed(2) })
  ];
  const c = cartera(activos, movimientos, { nombre: "Cartera de la familia con un nombre largo para el informe", cliente: { nombre: "Familia Fernández-Villaverde de la Torre" } });
  const fichas = new Map<string, FichaDeActivo>([["F1", { gastosCorrientes: 0.0145 }]]);
  const preparado = preparar(c, { precios, cambios }, fichas, HOY);
  return { analisis: analizar(preparado, { desde: "2025-12-31", hasta: HOY }), cartera: c, generado: HOY };
}

async function generar(tipo: TipoDeInforme, datos: DatosDelInforme, caso: string) {
  const bytes = Buffer.from(await (await crearInformePdf(tipo, datos)).arrayBuffer());
  const carpeta = process.env.INFORMES_PDF;
  if (carpeta) {
    const destino = path.join(carpeta, tipo === "cliente" ? "gestor-informe-de-cartera" : tipo === "costes" ? "gestor-informe-de-costes" : "gestor-informe-del-asesor");
    mkdirSync(destino, { recursive: true });
    writeFileSync(path.join(destino, `${caso}.pdf`), bytes);
  }
  const altos = [...bytes.toString("latin1").matchAll(/\/MediaBox\s*\[\s*0 0 ([\d.]+) ([\d.]+)\s*\]/g)].map((m) => Number(m[2]));
  return { bytes, hojas: extractPdfPageTexts(bytes).map(plano), lineas: extractPdfTextBaselines(bytes), altos, cadenas: extractPdfTextRuns(bytes).flat().join("\n") };
}

/** Lo que tiene que cumplir toda hoja de cualquiera de los tres. */
function comprobarLasHojas(tipo: TipoDeInforme, datos: DatosDelInforme, pdf: Awaited<ReturnType<typeof generar>>) {
  const { sello, documento, bajo } = TEMA[tipo];
  const n = pdf.hojas.length;
  pdf.hojas.forEach((texto, i) => {
    for (const prohibido of ["Independent", "Private Bankers", "N/D", "NaN", "undefined", "Infinity", "[object"]) expect(texto, `hoja ${i + 1}: ${prohibido}`).not.toContain(prohibido);
    expect(texto, `hoja ${i + 1}`).toContain(documento);
    const linea = bajo(datos);
    if (linea) expect(texto, `hoja ${i + 1}`).toContain(linea);
    const lineas = pdf.lineas[i];
    const sellos = lineas.filter((l) => l.texto.trim() === sello);
    expect(sellos.some((l) => l.y < 60), `hoja ${i + 1}: sello en la cabecera`).toBe(true);
    expect(sellos.some((l) => l.y > pdf.altos[i] - 40), `hoja ${i + 1}: sello en el pie`).toBe(true);
    const pie = lineas.find((l) => /^Página \d+ de \d+$/.test(l.texto.trim()));
    expect(pie?.texto.trim(), `hoja ${i + 1}`).toBe(`Página ${i + 1} de ${n}`);
  });
  /* Ningún guion por menos ni una cifra del módulo común (con sus decimales) separada de su unidad por un espacio que se
     parte. Un «47,1 %» dentro de un aviso del motor es texto del motor, y un nombre de activo es un dato, no una cifra. */
  const nombres = datos.cartera.activos.map((a) => a.nombre);
  const partidas = pdf.cadenas.split("\n").filter((cadena) => /\d,\d\d [€%]/.test(cadena) && !nombres.some((nombre) => nombre.includes(cadena.trim())));
  expect(partidas, "un nombre de activo puede llevar «3,25 %»: no cuenta").toEqual([]);
  expect(pdf.cadenas).not.toMatch(/(^|[\s(])-\d/);
}

/**
 * Lo que dice la cabecera de la primera hoja con cabecera. Desde el 14-11-2026 (decisión de Óscar: recuperar el aspecto de los informes de
 * antes) el informe de cartera abre con la portada a página completa, que arriba lleva la identidad en versalitas, el documento y el sello:
 * la cabecera de las hojas se mira en la segunda. Y la cabecera es la del papel de antes: a la izquierda el documento y el sello (con «No
 * entregar al cliente» debajo en el interno); a la derecha la entidad y, debajo, quién firma y su contacto. «Preparado para» va en el pie.
 */
const cabecera = (pdf: Awaited<ReturnType<typeof generar>>, hoja = 0) => pdf.lineas[hoja].filter((l) => l.y < 60).map((l) => l.texto.trim());
const hojaConCabecera = (tipo: TipoDeInforme) => (tipo === "cliente" ? 1 : 0);

beforeEach(() => {
  sesion.auth.currentUser = null;
});

describe.each(["cliente", "costes", "asesor"] as const)("el informe «%s» con la plantilla", (tipo) => {
  test("con la identidad del asesor: membrete, sello y páginas en todas las hojas, sin marca de entidad", async () => {
    const datos = datosDeLaDemo("inicio", ASESOR);
    const pdf = await generar(tipo, datos, "demo-con-asesor");
    comprobarLasHojas(tipo, datos, pdf);
    expect(cabecera(pdf, hojaConCabecera(tipo))).toContain("Asesores Independientes Ejemplo, EAF");
    expect(cabecera(pdf, hojaConCabecera(tipo))).toContain("Laura Asesora Ejemplo · laura@ejemplo.test");
    expect([...pdf.bytes.toString("latin1").matchAll(/\/Subtype\s*\/Image/g)].length).toBeGreaterThanOrEqual(1);
  }, 60_000);

  test("sin identidad que llegue ni guardada: la cabecera solo dice qué documento es, el sello y para quién", async () => {
    const datos = datosDeLaDemo("anio");
    const pdf = await generar(tipo, datos, "demo-sin-asesor");
    comprobarLasHojas(tipo, datos, pdf);
    const bajo = tipo === "asesor" ? ["No entregar al cliente"] : [];
    expect(cabecera(pdf)).toEqual([TEMA[tipo].documento, TEMA[tipo].sello, ...bajo]);
    expect(cabecera(pdf, hojaConCabecera(tipo))).toEqual([TEMA[tipo].documento, TEMA[tipo].sello, ...bajo]);
    expect(pdf.hojas.join("\n")).not.toContain("Elaborado por");
  }, 60_000);

  test("sin identidad que llegue: firma la que el asesor guardó para todos los informes (`leerIdentidad`)", async () => {
    sesion.auth.currentUser = { uid: "", displayName: "Nombre De La Cuenta" };
    const datos = datosDeLaDemo("anio");
    const pdf = await generar(tipo, datos, "demo-con-la-identidad-guardada");
    expect(cabecera(pdf, hojaConCabecera(tipo))).toContain("Nombre De La Cuenta");
  }, 60_000);

  test("el caso largo: cuarenta posiciones, nombres largos y precios que faltan", async () => {
    const datos = datosLargos();
    const pdf = await generar(tipo, datos, "largo");
    comprobarLasHojas(tipo, datos, pdf);
  }, 60_000);
});

describe("las cifras principales son las del análisis, con el formato común", () => {
  const datos = datosDeLaDemo("inicio");
  const a = datos.analisis;
  const divisa = a.cartera.divisaBase;

  test("informe de cartera: lo que vale, lo ganado, la rentabilidad y el riesgo", async () => {
    const pdf = await generar("cliente", datos, "cifras");
    const r = a.rentabilidad!;
    /*
     * La portada lleva solo el nombre (Óscar, 16-11-2026): ninguna cifra. Patrimonio, resultado y rentabilidad abren «Cómo ha ido su
     * cartera», detrás de la cartera, con espacio duro y menos tipográfico.
     */
    const hojas = extractPdfTextRuns(pdf.bytes).map((runs) => runs.join("\n"));
    expect(hojas[0]).not.toContain(importeTitular(a.patrimonio, { divisa }));
    expect(hojas[0]).not.toContain(importeTitular(r.resultado, { divisa, conSigno: true }));
    const cifras = hojas.find((hoja) => hoja.includes("Cómo ha ido su cartera"));
    expect(cifras).toBeDefined();
    expect(cifras).toContain(importeTitular(a.patrimonio, { divisa }));
    expect(cifras).toContain(importeTitular(r.resultado, { divisa, conSigno: true }));
    expect(cifras).toContain(rentabilidad(r.twr));
    /* Y la cartera va antes que las cifras. */
    expect(hojas.findIndex((hoja) => hoja.includes("Su cartera"))).toBeLessThan(hojas.indexOf(cifras!));
    for (const id of ["volatilidad", "maximaCaida"]) expect(pdf.cadenas, id).toContain(cifraDeMetrica(metrica(id), a) ?? motivoDeMetrica(metrica(id), a));
    expect(pdf.cadenas).toContain(importe(a.desglose!.cuadrado.resultado, { divisa, conSigno: true }));
  }, 60_000);

  test("informe de costes: el total y su porcentaje sobre el patrimonio medio", async () => {
    const pdf = await generar("costes", datos, "cifras");
    const ic = a.ingresosYCostes;
    expect(pdf.cadenas).toContain(importe(ic.costesTotales, { divisa }));
    expect(pdf.cadenas).toContain(porcentaje(ic.costesTotalesPct));
    expect(pdf.cadenas).toContain(importe(ic.patrimonioMedio, { divisa }));
  }, 60_000);

  test("informe del asesor: todas las métricas del registro, en la primera hoja", async () => {
    const pdf = await generar("asesor", datos, "cifras");
    /* El texto de la hoja, no sus cadenas: «+11,17 pp» sale en dos cadenas, «+11,17» y «pp». */
    for (const m of METRICAS) expect(pdf.hojas[0], m.id).toContain(plano(cifraDeMetrica(m, a) ?? motivoDeMetrica(m, a)));
  }, 60_000);

  /* Un periodo de menos de un año no se anualiza: no es un dato que falte, es que no corresponde. La fila «Rentabilidad anualizada del
     Sharpe» escribía «Falta el dato» (14-11-2026, visto al añadir Sortino y Calmar a su lado, que sí daban su motivo). */
  test("informe del asesor, con el año en curso: la rentabilidad anualizada del Sharpe dice por qué no sale", async () => {
    const delAnio = datosDeLaDemo("anio");
    expect(delAnio.analisis.riesgo?.rentabilidadAnualizada).toBeNull();
    const pdf = await generar("asesor", delAnio, "anio-sin-anualizar");
    const hoja = pdf.hojas.find((texto) => texto.includes("Rentabilidad anualizada del Sharpe"));
    expect(hoja).toBeDefined();
    const trasElRotulo = hoja!.slice(hoja!.indexOf("Rentabilidad anualizada del Sharpe")).replace(/\s+/g, " ").slice(0, 110);
    expect(trasElRotulo).toContain("Hace falta al menos un año de historia.");
    expect(trasElRotulo).not.toContain("Falta el dato");
  }, 60_000);
});
