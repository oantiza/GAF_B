/**
 * Los cortes de ancho de las hojas de estilo (MAR-12).
 *
 * Había 22 anchos distintos en las `@media`, y parejas a un píxel: `max-width: 1023px` en unas hojas y `1024px` en
 * otras, así que a 1.024 px exactos —un iPad apaisado, que es uno de los seis anchos de trabajo— el menú decía
 * «tableta» y medio contenido decía «escritorio». Lo mismo con 1.179 y 1.180, 1.279,98 y 1.280, 899,98 y 900.
 *
 * La regla, una sola:
 *   - un corte «por debajo de N» se escribe `max-width: (N − 0,02)px`;
 *   - un corte «desde N» se escribe `min-width: Npx`.
 * Así dos hojas que hablan del mismo corte no pueden discrepar en un píxel, y un ancho con decimales (una ventana
 * con zoom) no cae entre los dos.
 *
 * Y la lista de cortes es la de abajo, cada uno con para qué sirve. Un corte nuevo se añade aquí con su motivo, o se
 * usa uno de los que hay: lo segundo es casi siempre lo correcto.
 */
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";

const CARPETA = new URL("../src/styles/", import.meta.url);
const HOJAS = readdirSync(CARPETA).filter((nombre) => nombre.endsWith(".css")).sort();
const sinComentarios = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

/** Cada corte, con el ancho N desde el que deja de valer lo de «por debajo» y empieza lo de «desde». */
const CORTES_DE_ANCHO: Record<number, string> = {
  768: "el ancho mínimo de la aplicación: por debajo no hay versión, la página conserva su ancho y se desplaza",
  860: "cuatro cifras en fila pasan a dos por dos, y las rejillas de dos columnas de un módulo, a una",
  900: "la barra superior se queda con lo imprescindible: sin el correo de la cuenta, sin el nombre de la propuesta y sin la miga; y la tarjeta de Propuestas guardadas reduce su relleno lateral",
  1000: "la miga de la barra superior enseña solo dónde estás, sin la sección",
  1025: "tableta: hasta 1.024 px inclusive (un iPad apaisado mide 1.024 y es una tableta), menú estrecho con el nombre bajo el icono y el contenido en su disposición de tableta",
  1100: "la pestaña en curso baja de la barra superior a una lengüeta bajo ella",
  1180: "las rejillas de dos y tres columnas de una pantalla pasan a una",
  1240: "el menú lateral pasa a su ancho compacto y la página, a sus márgenes estrechos",
  1380: "las tarjetas de crisis pasadas, en una columna",
  1440: "portátil: las columnas «solo en ancho» de una tabla se pliegan en su apunte, el Buscador desplaza dentro de su marco y pone los botones de la fila uno sobre otro (hasta la decisión A-172, desde 1.280), la respuesta de Jubilación deja de quedarse fija, la barra superior pliega el rótulo de la propuesta y el correo junto a un aviso de la cuenta, y en Diseño la columna lateral baja debajo de la tabla de posiciones (19-11-2026; de ahí a la tableta, con sus tarjetas en dos columnas)",
  1800: "monitor grande: se ensancha el marco de la página, y las tablas enseñan sus columnas de más",
  2200: "monitor muy grande: el marco de la página, aún más ancho y con más margen (el menú no cambia)"
};
const CORTES_DE_ALTO: Record<number, string> = {
  1000: "con poca altura, la respuesta de Jubilación no se queda fija: taparía el formulario"
};

interface Condicion { hoja: string; propiedad: string; valor: string }

/** Todas las condiciones de tamaño de todas las `@media` de todas las hojas. */
const CONDICIONES: Condicion[] = HOJAS.flatMap((hoja) => {
  const css = sinComentarios(readFileSync(new URL(hoja, CARPETA), "utf8"));
  return [...css.matchAll(/@media([^{]*)\{/g)].flatMap((regla) =>
    [...regla[1].matchAll(/\(\s*([a-z-]*(?:width|height))\s*:\s*([^)]+?)\s*\)/g)].map((c) => ({ hoja, propiedad: c[1], valor: c[2] }))
  );
});

const corteDe = (c: Condicion): number => (c.propiedad.startsWith("max-") ? Math.round(Number.parseFloat(c.valor) + 0.02) : Number.parseFloat(c.valor));

describe("MAR-12 · los cortes de ancho de las hojas", () => {
  test("la prueba ve las hojas y sus condiciones", () => {
    expect(HOJAS.length).toBeGreaterThan(10);
    expect(CONDICIONES.length).toBeGreaterThan(30);
  });

  test("solo se corta por `max-` y `min-`, en píxeles", () => {
    for (const c of CONDICIONES) {
      expect(["max-width", "min-width", "max-height", "min-height"], `${c.hoja}: ${c.propiedad}`).toContain(c.propiedad);
      expect(c.valor, `${c.hoja}: ${c.propiedad}: ${c.valor}`).toMatch(/^\d+(\.\d+)?px$/);
    }
  });

  test("«por debajo de N» es `max: (N − 0,02)px`", () => {
    for (const c of CONDICIONES.filter((x) => x.propiedad.startsWith("max-"))) {
      expect(c.valor, `${c.hoja}: ${c.propiedad}: ${c.valor}`).toMatch(/^\d+\.98px$/);
    }
  });

  test("«desde N» es `min: Npx`, entero", () => {
    for (const c of CONDICIONES.filter((x) => x.propiedad.startsWith("min-"))) {
      expect(c.valor, `${c.hoja}: ${c.propiedad}: ${c.valor}`).toMatch(/^\d+px$/);
    }
  });

  test("los cortes de ancho son exactamente los declarados, cada uno con su motivo", () => {
    const usados = [...new Set(CONDICIONES.filter((c) => c.propiedad.endsWith("width")).map(corteDe))].sort((a, b) => a - b);
    expect(usados).toEqual(Object.keys(CORTES_DE_ANCHO).map(Number).sort((a, b) => a - b));
    for (const motivo of Object.values(CORTES_DE_ANCHO)) expect(motivo.length).toBeGreaterThan(20);
  });

  test("y los de alto, también", () => {
    const usados = [...new Set(CONDICIONES.filter((c) => c.propiedad.endsWith("height")).map(corteDe))].sort((a, b) => a - b);
    expect(usados).toEqual(Object.keys(CORTES_DE_ALTO).map(Number).sort((a, b) => a - b));
  });

  test("a 1.024 px exactos, todas las hojas dicen lo mismo: tableta", () => {
    /* El defecto: unas reglas valían hasta 1.023 y otras hasta 1.024. Ninguna condición puede partir en 1.024. */
    const enLaFrontera = CONDICIONES.filter((c) => c.propiedad.endsWith("width") && [1023, 1024].includes(corteDe(c)));
    expect(enLaFrontera).toEqual([]);
    const deTableta = CONDICIONES.filter((c) => c.propiedad === "max-width" && corteDe(c) === 1025);
    expect(new Set(deTableta.map((c) => c.valor))).toEqual(new Set(["1024.98px"]));
    /* El menú, el contenido común y las pantallas: todas las hojas que tienen disposición de tableta. */
    expect(new Set(deTableta.map((c) => c.hoja))).toEqual(new Set(["analisis.css", "diseno.css", "ficha.css", "gestor.css", "layout.css", "modules.css", "planes.css"]));
  });
});
