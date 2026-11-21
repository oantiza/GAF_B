/**
 * El informe de costes, leído del papel: con la demostración en dos periodos, con una cartera
 * sencilla, con una vacía y con una hecha a mano con muchos cargos e impuestos. Se afirma sobre
 * el texto impreso. Cada PDF queda en `output/gestor/` para mirarlo página a página.
 */
import { describe, expect, test } from "vitest";
import { crearInformePdf } from "../../src/gestor/informes";
import { importe as importeComun, porcentaje as porcentajeComun } from "../../src/core/formato";
import { SECCIONES_DE_COSTES } from "../../src/gestor/informes/registro";
import { CARGOS_SIN_AGRUPAR } from "../../src/gestor/informes/secciones/costes/servicio";
import type { DatosDelInforme } from "../../src/gestor/informes/tipos";
import { analizar, preparar } from "../../src/gestor/motor/analisis";
import type { FichaDeActivo } from "../../src/gestor/motor/composicion";
import { sumarDias } from "../../src/gestor/motor/fechas";
import type { Punto } from "../../src/gestor/motor/valoracion";
import { activo, cartera, mov } from "./ayudas";
import { datosDeLaDemo, datosSencillos, datosVacios, HOY, logotipoDePrueba, paginasDe, plano } from "./informesAyudas";

/* Las cifras con el módulo común, como las escribe ahora el informe (antes, con `gestor/informes/formato.ts`). */
const importe = (valor: number | null) => importeComun(valor) ?? "";
const porcentaje = (valor: number | null) => porcentajeComun(valor) ?? "";

const ASESOR: DatosDelInforme["asesor"] = { nombre: "Laura Asesora Ejemplo", entidad: "Asesores Independientes Ejemplo, EAF", logotipo: logotipoDePrueba() };

function hojasEnOrden(paginas: string[]) {
  paginas.forEach((pagina, i) => {
    expect(pagina, `página ${i + 1}`).toContain(`Página ${i + 1} de ${paginas.length}`);
    expect(pagina, `página ${i + 1}`).not.toMatch(/undefined|NaN|\[object|Infinity/);
    /* La cabecera de la plantilla dice qué documento es, y el sello sale en la cabecera y en el pie (antes, el pie decía
       «Informe de costes · Confidencial»). */
    expect(pagina, `página ${i + 1}`).toContain("Informe de costes");
    expect(pagina.match(/CONFIDENCIAL/g)?.length ?? 0, `página ${i + 1}`).toBeGreaterThanOrEqual(2);
  });
}

/** Los títulos de estos detalles son también filas del resumen: que no procedan se ve en su total, no en su título. */
/* «Coste corriente», con el vocabulario del apartado 6 de SISTEMA_DISENO.md (antes, «gastos corrientes»). */
const TOTAL_DEL_DETALLE: Record<string, string> = { servicio: "Total de costes del servicio", operaciones: "Total de costes de las operaciones", productos: "Los fondos y ETF cobran un coste corriente" };

/** Las secciones que proceden salen por su título; las que no, no. */
function secciones(datos: DatosDelInforme, texto: string) {
  for (const seccion of SECCIONES_DE_COSTES.filter((s) => s.comienzo !== "presentacion")) {
    if (seccion.procede(datos)) expect(texto, seccion.id).toContain(seccion.titulo);
    else expect(texto, seccion.id).not.toContain(TOTAL_DEL_DETALLE[seccion.id] ?? seccion.titulo);
  }
}

const suma = (lista: Array<{ importe: number } | { coste: number }>) => lista.reduce((total, linea) => total + ("importe" in linea ? linea.importe : linea.coste), 0);

/**
 * Una cartera con dieciocho cargos de custodia (uno por quincena), una venta de un fondo con
 * retención, un dividendo con retención, un impuesto apuntado, un fondo con gastos corrientes
 * conocidos y otro sin ellos.
 */
function datosConMuchosCargos(): DatosDelInforme {
  const desde = "2026-01-02";
  const dias: string[] = [];
  for (let dia = sumarDias(desde, -5); dia <= HOY; dia = sumarDias(dia, 1)) dias.push(dia);
  const activos = [
    activo("FA", "FONDO", "EUR", { nombre: "Fondo Global de Prueba" }),
    activo("FB", "FONDO", "EUR", { nombre: "Fondo Sin Ficha de Prueba" }),
    activo("AC", "ACCION", "EUR", { nombre: "Acción de Prueba" })
  ];
  const precios = new Map<string, Punto[]>(activos.map((a, i) => [a.id, dias.map((fecha, k) => ({ fecha, valor: 50 + i * 10 + k * 0.02 }))]));
  const precioDe = (id: string, fecha: string) => precios.get(id)!.find((p) => p.fecha === fecha)!.valor;
  const movimientos = [
    mov("aportacion", desde, { importe: "60000" }),
    mov("suscripcion", desde, { activoId: "FA", titulos: "400", precio: String(precioDe("FA", desde)), comision: "12", importe: `-${(400 * precioDe("FA", desde) + 12).toFixed(2)}` }),
    mov("suscripcion", desde, { activoId: "FB", titulos: "300", precio: String(precioDe("FB", desde)), importe: `-${(300 * precioDe("FB", desde)).toFixed(2)}` }),
    mov("compra", desde, { activoId: "AC", titulos: "200", precio: String(precioDe("AC", desde)), comision: "8", gastos: "1.5", importe: `-${(200 * precioDe("AC", desde) + 9.5).toFixed(2)}` }),
    ...Array.from({ length: 18 }, (_, i) => mov("comision", sumarDias("2026-01-15", i * 15), { importe: "-4.25", nota: i % 3 === 0 ? "Comisión de administración" : "Custodia" })),
    mov("dividendo", "2026-05-20", { activoId: "AC", importe: "81", retencion: "19" }),
    mov("reembolso", "2026-07-01", { activoId: "FA", titulos: "100", precio: String(precioDe("FA", "2026-07-01")), retencion: "30", importe: (100 * precioDe("FA", "2026-07-01") - 30).toFixed(2) }),
    mov("retencion", "2026-09-01", { importe: "-7.5", nota: "Impuesto apuntado" })
  ];
  const c = cartera(activos, movimientos, { nombre: "Cartera con muchos cargos" });
  const fichas = new Map<string, FichaDeActivo>([["FA", { gastosCorrientes: 0.0145 }]]);
  const preparado = preparar(c, { precios, cambios: new Map() }, fichas, HOY);
  return { analisis: analizar(preparado, { desde: "2025-12-31", hasta: HOY }), cartera: c, generado: HOY };
}

describe("el informe de costes", () => {
  const casos = [
    { nombre: "costes-inicio", datos: datosDeLaDemo("inicio") },
    { nombre: "costes-inicio-con-asesor", datos: datosDeLaDemo("inicio", ASESOR) },
    { nombre: "costes-anio", datos: datosDeLaDemo("anio") },
    { nombre: "costes-anio-con-asesor", datos: datosDeLaDemo("anio", ASESOR) }
  ];

  for (const { nombre, datos } of casos) {
    test(`${nombre}: se genera, lleva los totales del análisis y el detalle suma el resumen`, async () => {
      const { bytes, paginas } = await paginasDe(await crearInformePdf("costes", datos), nombre);
      expect(bytes.subarray(0, 4).toString("latin1")).toBe("%PDF");
      expect(paginas.length).toBeGreaterThanOrEqual(2);
      expect(paginas.length).toBeLessThanOrEqual(10);
      hojasEnOrden(paginas);
      const texto = paginas.join("\n");
      const ic = datos.analisis.ingresosYCostes;
      console.log(`[${nombre}] ${paginas.length} páginas`, { servicio: ic.cargosDelServicio.length, operaciones: ic.costesPorOperacion.length, productos: ic.porProducto.length, sinDato: ic.productosSinGastosCorrientes });
      expect(paginas[0]).toContain("Informe de costes");
      expect(paginas[0]).toContain("Cartera de demostración");
      expect(texto).not.toContain("Independent Private Bankers");
      secciones(datos, texto);

      /* Los totales del resumen, como los escribe el informe. */
      for (const cifra of [ic.costesDelServicio, ic.costesDeOperacion, ic.costesExplicitos, ic.costesTotales, ic.patrimonioMedio]) expect(texto).toContain(plano(importe(cifra)));
      expect(texto).toContain(plano(porcentaje(ic.costesTotalesPct)));
      /* Cada detalle suma exactamente su total del resumen. */
      expect(suma(ic.cargosDelServicio)).toBe(ic.costesDelServicio);
      expect(suma(ic.costesPorOperacion)).toBe(ic.costesDeOperacion);
      if (ic.gastosCorrientes !== null) {
        expect(suma(ic.porProducto)).toBe(ic.gastosCorrientes);
        expect(texto).toContain("Total de costes de los productos");
        for (const producto of ic.porProducto) expect(texto).toContain(producto.nombre);
      }
      if (ic.costesPorOperacion.length > 0) expect(texto).toContain("Total de costes de las operaciones");
      if (ic.cargosDelServicio.length > 0) expect(texto).toContain("Total de costes del servicio");
      for (const nombreSinDato of ic.productosSinGastosCorrientes) expect(texto).toContain(nombreSinDato);
      expect(texto).toContain("Cartera de demostración: sus activos, precios y movimientos son inventados.");
      if (datos.asesor) expect(paginas[0]).toContain("Laura Asesora Ejemplo");
    });
  }

  test("con muchos cargos los agrupa por concepto, y da los impuestos por su origen", async () => {
    const datos = datosConMuchosCargos();
    const ic = datos.analisis.ingresosYCostes;
    expect(ic.cargosDelServicio.length).toBe(18);
    expect(ic.cargosDelServicio.length).toBeGreaterThan(CARGOS_SIN_AGRUPAR);
    /* 18 × 4,25 = 76,50 €. Operaciones: 12 € de la suscripción y 8 + 1,50 € de la compra = 21,50 €. */
    expect(ic.costesDelServicio).toBeCloseTo(76.5, 9);
    expect(ic.costesDeOperacion).toBeCloseTo(21.5, 9);
    /* Retenciones: 19 € del dividendo; apuntados: 30 € del reembolso y 7,50 € del impuesto = 37,50 €. */
    expect(ic.dividendos.retencion).toBeCloseTo(19, 9);
    expect(ic.impuestosApuntados).toBeCloseTo(37.5, 9);
    expect(ic.impuestos).toBeCloseTo(56.5, 9);
    expect(ic.productosSinGastosCorrientes).toEqual(["Fondo Sin Ficha de Prueba"]);

    const { paginas } = await paginasDe(await crearInformePdf("costes", datos), "costes-muchos-cargos");
    hojasEnOrden(paginas);
    const texto = paginas.join("\n");
    secciones(datos, texto);
    expect(texto).toContain("18 cargos, agrupados por concepto");
    expect(texto).toContain("Comisión de administración");
    expect(texto).toContain(plano(importe(6 * 4.25)));
    expect(texto).toContain(plano(importe(12 * 4.25)));
    expect(texto).toContain(plano(importe(76.5)));
    expect(texto).toContain(plano(importe(21.5)));
    expect(texto).toContain("Retenciones sobre dividendos");
    expect(texto).toContain("Otros impuestos y retenciones apuntados en la cuenta");
    expect(texto).toContain(plano(importe(56.5)));
    expect(texto).toMatch(/No se conoce el coste corriente de este producto, así que no está incluido en el total: Fondo Sin Ficha de Prueba\./);
    expect(texto).toContain("Total de costes conocidos");
  });

  test("con una cartera sencilla, sin costes de servicio ni operaciones, solo dice lo que hay", async () => {
    const datos = datosSencillos();
    const ic = datos.analisis.ingresosYCostes;
    expect(ic.cargosDelServicio).toEqual([]);
    expect(ic.costesPorOperacion).toEqual([]);
    const { paginas } = await paginasDe(await crearInformePdf("costes", datos), "costes-sencilla");
    hojasEnOrden(paginas);
    const texto = paginas.join("\n");
    secciones(datos, texto);
    expect(texto).not.toContain("Impuestos retenidos");
    expect(texto).toContain("Lo que ha costado su cartera");
  });

  test("una cartera vacía no lanza y dice que no hay datos", async () => {
    const { paginas } = await paginasDe(await crearInformePdf("costes", datosVacios()), "costes-vacia");
    hojasEnOrden(paginas);
    expect(paginas.length).toBe(1);
    const texto = paginas.join("\n");
    expect(texto).toContain("todavía no tiene movimientos: no hay cifras que enseñar");
    expect(texto).not.toContain("Lo que ha costado su cartera");
    expect(texto).not.toContain("Cómo se han calculado");
  });
});
