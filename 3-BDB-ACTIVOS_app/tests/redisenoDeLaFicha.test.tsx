import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { FichaInstrumento } from "../src/components/ficha/FichaInstrumento";
import {
  pestanaDeLaSeccion,
  respuestaDeLaFicha,
  rentabilidadesDelResumen,
  tipoEnFrase
} from "../src/components/ficha/mapaDeLaFicha";
import { ACCION_DE_MUESTRA, FONDO_DE_MUESTRA } from "./fixtures/fichasDeMuestra";
import type { FichaInstrumento as ModeloDeFicha } from "../src/types/fichaInstrumento";

/**
 * La ficha del rediseño «Informe vivo» (paso 4, 14-11-2026): la cabecera, la banda de la respuesta, las pestañas y el Resumen.
 * Lo que se comprueba es que la banda y el Resumen dicen lo MISMO que la sección de donde sale cada cifra (no la vuelven a
 * escribir), que lo que no aplica no ocupa casilla, y que cada sección cae en su pestaña.
 */

const seccion = (ficha: ModeloDeFicha, id: string) => ficha.secciones.find((s) => s.id === id)!;
const pinta = (ficha: ModeloDeFicha, extra: Partial<Parameters<typeof FichaInstrumento>[0]> = {}) =>
  renderToStaticMarkup(<FichaInstrumento ficha={ficha} {...extra} />);

describe("la banda de la respuesta", () => {
  test("un fondo: las seis cifras, las mismas que sus secciones, y solo las rentabilidades con color", () => {
    const datos = respuestaDeLaFicha(FONDO_DE_MUESTRA);
    expect(datos.map((dato) => dato.rotulo)).toEqual([
      "Precio",
      "Rentabilidad 1 año",
      "Rentabilidad anualizada 3 años",
      "Volatilidad 3 años",
      "Coste corriente",
      "Riesgo (SRI)"
    ]);
    const filaDe = (id: string, rotulo: string) => seccion(FONDO_DE_MUESTRA, id).filas.find((fila) => fila.rotulo === rotulo)!.valor;
    expect(datos[1].valor).toBe(filaDe("rentabilidad", "1 año"));
    expect(datos[2].valor).toBe(filaDe("rentabilidad", "3 años"));
    expect(datos[4].valor).toBe(filaDe("coste", "Coste corriente"));
    expect(datos[1].signo).toBe("sube");
    expect(datos[3].signo).toBeUndefined();
    expect(datos[4].signo).toBeUndefined();
    /* La fecha del proveedor vale para 3, 5 y 10 años: el 1 año va sin fecha, como en su sección. */
    expect(datos[1].apunte).toBe("del proveedor, sin fecha");
    expect(datos[2].apunte).toBe("del proveedor · a 31 oct 2026");
    expect(datos[4].apunte).toMatch(/^al año · del KID/);
  });

  test("una acción: sin coste corriente (no le aplica) y el riesgo dice que no aplica", () => {
    const datos = respuestaDeLaFicha(ACCION_DE_MUESTRA);
    expect(datos.map((dato) => dato.id)).not.toContain("coste");
    expect(datos.find((dato) => dato.id === "riesgo")).toMatchObject({ valor: "No aplica", ausencia: "no-aplica" });
    /* La volatilidad, sin color, y con la caída máxima de nuestra tabla como apunte. */
    expect(datos.find((dato) => dato.id === "volatilidad-3")?.apunte).toMatch(/^caída máxima, /);
  });

  test("nunca menos de tres casillas: lo que falta dice «Falta el dato»", () => {
    const vacia: ModeloDeFicha = { ...ACCION_DE_MUESTRA, secciones: [] };
    const datos = respuestaDeLaFicha(vacia);
    expect(datos).toHaveLength(3);
    expect(datos.every((dato) => dato.ausencia === "falta" && dato.valor === "Falta el dato")).toBe(true);
  });

  test("la banda se pinta con su nombre accesible y las cifras con el color de su signo", () => {
    const html = pinta(FONDO_DE_MUESTRA);
    expect(html).toContain(`aria-label="Lo esencial de ${FONDO_DE_MUESTRA.nombre}"`);
    expect(html).toMatch(/respuesta__cifra cifra--sube">\+15,84/);
  });
});

describe("las pestañas", () => {
  test("cada sección va a la suya por su identificador, y lo que no está en el mapa cae en «Documentos y datos»", () => {
    expect(pestanaDeLaSeccion("metricas")).toBe("rentabilidad");
    expect(pestanaDeLaSeccion("regiones")).toBe("cartera");
    expect(pestanaDeLaSeccion("valoracion")).toBe("fundamentales");
    expect(pestanaDeLaSeccion("coste")).toBe("costes");
    expect(pestanaDeLaSeccion("calidad")).toBe("documentos");
    expect(pestanaDeLaSeccion("una-seccion-nueva")).toBe("documentos");
  });

  test("una pestaña sin contenido no se enseña, y las demás quedan montadas y ocultas", () => {
    const fondo = pinta(FONDO_DE_MUESTRA);
    const pestanasDe = (html: string) => [...html.matchAll(/role="tab"[^>]*>([^<]+)</g)].map((m) => m[1]);
    expect(pestanasDe(fondo)).toEqual(["Resumen", "Rentabilidad y riesgo", "Cartera", "Costes", "Documentos y datos"]);
    /* Una acción no tiene costes ni fundamentales cargados. */
    expect(pestanasDe(pinta(ACCION_DE_MUESTRA))).not.toContain("Costes");
    /* Solo el Resumen se ve; el resto, en su panel oculto. */
    expect(fondo).toMatch(/id="ficha-panel-resumen" role="tabpanel"/);
    expect(fondo).toMatch(/hidden="" id="ficha-panel-costes"/);
  });

  test("la pestaña elegida por quien la monta es la que se ve", () => {
    const html = pinta(FONDO_DE_MUESTRA, { pestana: "costes" });
    expect(html).toMatch(/aria-selected="true"[^>]*>Costes</);
    expect(html).not.toMatch(/hidden="" id="ficha-panel-costes"/);
    expect(html).toMatch(/hidden="" id="ficha-panel-resumen"/);
  });

  test("lo que solo ve el asesor lleva el distintivo «Interno»", () => {
    expect(pinta(FONDO_DE_MUESTRA)).toMatch(/Procedencia y calidad <span class="distintivo distintivo--interno">Interno<\/span>/);
  });

  test("los fundamentales que llegan tarde tienen su pestaña y su hueco reservado (ACT-08)", () => {
    const html = pinta(ACCION_DE_MUESTRA, { fundamentalesPendientes: <p className="ficha__nota">Cargando…</p> });
    expect(html).toMatch(/role="tab"[^>]*>Fundamentales</);
    expect(html).toMatch(/id="ficha-panel-fundamentales"[^>]*><p class="ficha__nota">Cargando…/);
  });
});

describe("el Resumen", () => {
  test("la tabla de rentabilidades por periodo lleva las mismas cifras que la sección", () => {
    const tabla = rentabilidadesDelResumen(FONDO_DE_MUESTRA)!;
    expect(tabla.columnas).toEqual(["En el año", "1 año", "3 años", "5 años", "10 años"]);
    const delProveedor = seccion(FONDO_DE_MUESTRA, "rentabilidad").filas;
    expect(tabla.celdas[1]).toBe(delProveedor.find((fila) => fila.rotulo === "1 año")!.valor);
  });

  test("la rentabilidad del año de nuestra tabla entra en el Resumen, se llame «YTD» o «En el año», con el rótulo del Resumen", () => {
    /* Nuestra tabla con la columna del año, como la compone `conColumnaDelAnio`: desde el 17-11-2026 se llama «YTD». */
    const conElAnio = (nombre: string): ModeloDeFicha => ({
      ...ACCION_DE_MUESTRA,
      secciones: ACCION_DE_MUESTRA.secciones.map((s) =>
        s.id === "metricas" && s.tabla
          ? {
              ...s,
              tabla: {
                ...s.tabla,
                columnas: [s.tabla.columnas[0], nombre, ...s.tabla.columnas.slice(1)],
                filas: s.tabla.filas.map((f, i) => [f[0], i === 0 ? "+4,12 %" : "", ...f.slice(1)])
              }
            }
          : s
      )
    });
    for (const nombre of ["YTD", "En el año"]) {
      const tabla = rentabilidadesDelResumen(conElAnio(nombre))!;
      expect(tabla.columnas).toEqual(["En el año", "1 año", "3 años", "5 años"]);
      expect(tabla.celdas[0]).toBe("+4,12 %");
    }
    /* Sin la columna del año, el Resumen no se la inventa. */
    expect(rentabilidadesDelResumen(ACCION_DE_MUESTRA)!.columnas).toEqual(["1 año", "3 años", "5 años"]);
  });

  test("abre con la evolución y los bloques cortos, cada uno con su enlace a la pestaña del detalle", () => {
    /* El reparto lleva su peso en fracción, como lo compone `seccionDeRegiones` (la muestra es anterior a ese campo). */
    const conPesos: ModeloDeFicha = {
      ...FONDO_DE_MUESTRA,
      secciones: FONDO_DE_MUESTRA.secciones.map((s) =>
        s.id === "regiones" ? { ...s, filas: [{ rotulo: "Eurozona", valor: "92,10 %", peso: 0.921 }, { rotulo: "Reino Unido", valor: "7,90 %", peso: 0.079 }] } : s
      )
    };
    const html = pinta(conPesos, { evolucion: <p>La evolución</p> });
    const resumen = html.split('id="ficha-panel-resumen"')[1].split('id="ficha-panel-rentabilidad"')[0];
    expect(resumen.indexOf("La evolución")).toBeLessThan(resumen.indexOf("En qué invierte"));
    expect(resumen).toContain("Lo que cuesta");
    expect(resumen).toContain("Ver la cartera");
    expect(resumen).toMatch(/partes__cifra"><span class="cifra">92,1/);
    expect(resumen).toContain("Ver los costes");
  });

  test("sin bloques cortos, la evolución ocupa todo el ancho", () => {
    const sinLateral: ModeloDeFicha = { ...ACCION_DE_MUESTRA, secciones: ACCION_DE_MUESTRA.secciones.filter((s) => s.id === "metricas") };
    expect(pinta(sinLateral, { evolucion: <p>La evolución</p> })).toContain('class="ficha__resumen ficha__resumen--una"');
  });
});

describe("la cabecera", () => {
  test("el tipo como frase, el nombre como único h1 y el ISIN aparte", () => {
    expect(tipoEnFrase("FONDO DE INVERSIÓN")).toBe("Fondo de inversión");
    expect(tipoEnFrase("ETF")).toBe("ETF");
    const html = pinta(FONDO_DE_MUESTRA);
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain(`<span class="ficha__isin">${FONDO_DE_MUESTRA.identificacion.split(" · ")[0]}</span>`);
  });
});
