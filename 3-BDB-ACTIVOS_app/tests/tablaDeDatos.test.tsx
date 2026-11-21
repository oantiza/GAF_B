import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { TablaDeDatos } from "../src/components/tabla/TablaDeDatos";
import { COLUMNAS_DEL_BUSCADOR, componerFila } from "../src/adapters/componerLista";
import type { ColumnaDeTabla, FilaAgrupable } from "../src/types/tablaDeDatos";

/**
 * La tabla del sistema.
 *
 * Lo que se comprueba aquí es lo que la costumbre anterior no hacía: que sea una tabla
 * de verdad para quien la lee con un lector de pantalla, que lo que falta no se pinte
 * como lo que no aplica, y que una columna de escala mixta no se pueda ordenar como si
 * tuviera una sola. Esa última es la regla del proyecto —nunca se ordena una cifra
 * contra otra de escala distinta— y es la razón de que esta pieza exista.
 */

interface Caso extends FilaAgrupable {
  id: string;
  escala?: string;
  cifra?: number;
}

const COLUMNA: ColumnaDeTabla<Caso>[] = [
  { id: "id", titulo: "Qué", celda: (f) => ({ texto: f.id, valor: f.id }) },
  {
    id: "cifra",
    titulo: "Cifra",
    cifra: true,
    escalaMixta: true,
    celda: (f) =>
      f.cifra === undefined
        ? { texto: "Falta", ausencia: "falta" as const }
        : { texto: String(f.cifra), valor: f.cifra }
  }
];

const pinta = (filas: Caso[], columnas = COLUMNA) =>
  renderToStaticMarkup(<TablaDeDatos columnas={columnas} filas={filas} titulo="Prueba" />);

describe("tabla de datos", () => {
  test("lo que va delante va delante, en su orden, y lo demás sigue en el suyo", () => {
    const filas: Caso[] = ["Artisan", "Grupo San Jose", "Sanofi", "Santander"].map((id) => ({ id }));
    const orden = (html: string) => [...html.matchAll(/<td[^>]*><span>([^<]+)<\/span>/g)].map((m) => m[1]);
    const conOrden = (primero?: (fila: Caso) => boolean) =>
      orden(renderToStaticMarkup(<TablaDeDatos columnas={COLUMNA.slice(0, 1)} estado={{ orden: "id", sentido: 1, pagina: 1 }} filas={filas} primero={primero} titulo="Prueba" />));
    expect(conOrden()).toEqual(["Artisan", "Grupo San Jose", "Sanofi", "Santander"]);
    expect(conOrden((fila) => fila.id.startsWith("San"))).toEqual(["Sanofi", "Santander", "Artisan", "Grupo San Jose"]);
  });

  test("es una tabla de verdad, no una rejilla con la cabecera escondida", () => {
    const html = pinta([{ id: "a", cifra: 1 }]);
    expect(html).toContain("<table");
    expect(html).toContain('scope="col"');
    expect(html).toContain("<caption");
    // La de hoy marca su cabecera aria-hidden; esta no puede hacerlo.
    expect(html).not.toContain('aria-hidden="true"');
  });

  test("lo que falta no se pinta como lo que no aplica", () => {
    const columnas: ColumnaDeTabla<Caso>[] = [
      { id: "a", titulo: "A", celda: () => ({ texto: "No aplica", ausencia: "no-aplica" as const }) },
      { id: "b", titulo: "B", celda: () => ({ texto: "Falta", ausencia: "falta" as const }) },
      { id: "c", titulo: "C", celda: () => ({ texto: "Pedirlo", ausencia: "sin-pedir" as const }) }
    ];
    const html = pinta([{ id: "x" }], columnas);
    expect(html).toContain("tabla__celda--no-aplica");
    expect(html).toContain("tabla__celda--falta");
    expect(html).toContain("tabla__celda--sin-pedir");
  });

  test("ninguna ausencia se escribe con un guion, que se lee como cero", () => {
    const html = pinta([{ id: "a" }, { id: "b", cifra: 3 }]);
    const celdas = [...html.matchAll(/<span[^>]*>([^<]*)<\/span>/g)].map((m) => m[1].trim());
    for (const celda of celdas) expect(celda).not.toMatch(/^[-–—]$/);
  });

  test("marca solo la fila que quien la monta dice que está elegida, y sin eso ninguna", () => {
    const filas: Caso[] = [{ id: "a" }, { id: "b" }];
    const html = renderToStaticMarkup(
      <TablaDeDatos columnas={COLUMNA} filas={filas} seleccionada={(f) => f.id === "b"} titulo="Prueba" />
    );
    const marcadas = html.split('<tr class="is-selected">').slice(1).map((resto) => resto.split("</tr>")[0]);
    expect(marcadas).toHaveLength(1);
    expect(marcadas[0]).toContain(">b<");
    expect(pinta(filas)).not.toContain("is-selected");
  });
});

/* Las tablas de activos (Óscar, 17-11-2026, sobre una captura del aspecto anterior): su letra es otra, y el ISIN del
   apunte va aparte para escribirse en la mono. */
describe("las tablas de activos", () => {
  const conApunte = (apunte: string): ColumnaDeTabla<Caso>[] => [{ id: "a", titulo: "Activo", celda: (f) => ({ texto: f.id, apunte }) }];

  test("solo la que se dice de activos lleva la variante; las demás siguen como estaban", () => {
    const columnas = conApunte("x");
    expect(renderToStaticMarkup(<TablaDeDatos columnas={columnas} deActivos filas={[{ id: "a" }]} titulo="Prueba" />)).toContain(
      'class="tabla tabla--activos"'
    );
    expect(pinta([{ id: "a" }], columnas)).toContain('class="tabla"');
  });

  test("el ISIN que abre el apunte va aparte y lo que le sigue, el método, no", () => {
    expect(pinta([{ id: "a" }], conApunte("LU0996182563 · mensual"))).toContain(
      '<span class="tabla__apunte"><span class="tabla__isin">LU0996182563</span> · mensual</span>'
    );
  });

  test("un apunte que no empieza por un ISIN se escribe tal cual: un código de plan, una categoría", () => {
    expect(pinta([{ id: "a" }], conApunte("N5138 · EPSV"))).toContain('<span class="tabla__apunte">N5138 · EPSV</span>');
    expect(pinta([{ id: "a" }], conApunte("RF Euro"))).not.toContain("tabla__isin");
  });

  test("lo que va delante del nombre se pinta en su misma celda, antes del texto", () => {
    const columnas: ColumnaDeTabla<Caso>[] = [
      { id: "a", titulo: "Activo", celda: (f) => ({ texto: f.id, apunte: "ES0144580Y14", antes: <button type="button">fav</button> }) }
    ];
    expect(pinta([{ id: "Iberdrola" }], columnas)).toContain(
      '<span class="tabla__con-antes"><button type="button">fav</button><span><span>Iberdrola</span><span class="tabla__apunte"><span class="tabla__isin">ES0144580Y14</span></span></span></span>'
    );
  });
});

describe("el orden no mezcla escalas", () => {
  /*
   * En el catálogo conviven 641 instrumentos con métricas calculadas sobre meses, 297
   * sobre días y 130 copiadas del proveedor. Ordenar los 1.076 por volatilidad pone una
   * desviación mensual al lado de una diaria. La tabla no lo impide: lo agrupa.
   */
  const mixtas: Caso[] = [
    { id: "mensual-1", escala: "EXTRACTOR_MONTHLY_V1", cifra: 5 },
    { id: "diario-1", escala: "EXTRACTOR_DAILY_V1", cifra: 1 },
    { id: "mensual-2", escala: "EXTRACTOR_MONTHLY_V1", cifra: 9 }
  ];

  test("sin ordenar no agrupa: agrupar sin motivo sería ruido", () => {
    expect(pinta(mixtas)).not.toContain("tabla__grupo");
  });

  test("una sola escala en pantalla tampoco agrupa", () => {
    const soloMensuales = mixtas.filter((f) => f.escala === "EXTRACTOR_MONTHLY_V1");
    const html = renderToStaticMarkup(
      <TablaDeDatos columnas={COLUMNA} filas={soloMensuales} titulo="Prueba" />
    );
    expect(html).not.toContain("tabla__grupo");
  });

  test("el marcador de agrupación y el aviso existen en el componente", () => {
    /* El agrupado se dispara al pulsar el encabezado, que es estado de cliente; lo que
       esta prueba fija es que el componente trae la pieza y el texto que la explica. */
    const fuente = readFileSync(
      new URL("../src/components/tabla/TablaDeDatos.tsx", import.meta.url),
      "utf8"
    );
    expect(fuente).toContain("escalaMixta");
    expect(fuente).toContain("tabla__grupo");
    expect(fuente).toContain("no tiene una sola escala");
    expect(fuente).toContain("ordenados entre ellos, no");
  });
});

describe("páginas", () => {
  const muchas: Caso[] = Array.from({ length: 25 }, (_, i) => ({ id: `f${i}`, cifra: i }));
  /* El `<tr>` de la cabecera no es una fila de datos: se cuenta solo el cuerpo. */
  const cuerpo = (html: string) => html.slice(html.indexOf("<tbody>"));
  const cuantas = (html: string) => (cuerpo(html).match(/<tr>/g) ?? []).length;

  test("sin porPagina se pintan todas, que es lo que había", () => {
    const html = renderToStaticMarkup(<TablaDeDatos columnas={COLUMNA} filas={muchas} titulo="x" />);
    expect(cuantas(html)).toBe(muchas.length);
  });

  test("con porPagina se pinta una página y se dice de cuántas", () => {
    const html = renderToStaticMarkup(
      <TablaDeDatos columnas={COLUMNA} filas={muchas} porPagina={10} titulo="x" />
    );
    expect(cuantas(html)).toBe(10);
    expect(html).toContain("1–10 de 25");
    expect(html).toContain("tabla__paginas");
  });

  test("una sola página no enseña la navegación: sería un control que no hace nada", () => {
    const html = renderToStaticMarkup(
      <TablaDeDatos columnas={COLUMNA} filas={muchas.slice(0, 4)} porPagina={10} titulo="x" />
    );
    expect(html).not.toContain("tabla__paginas");
  });

  test("el grupo partido entre dos páginas repite su encabezado", () => {
    /* Lo comprueba sobre el componente: la página 2 es estado de cliente, y lo que aquí
       se fija es que el caso está contemplado y con qué palabras se cuenta. */
    const fuente = readFileSync(
      new URL("../src/components/tabla/TablaDeDatos.tsx", import.meta.url),
      "utf8"
    );
    expect(fuente).toContain("continúa de la página anterior");
    expect(fuente).toContain("continua: true");
  });
});

describe("las filas del buscador salen de la tarjeta", () => {
  const tarjeta = {
    instrument_id: "ES0105836003",
    instrument_type: "STOCK",
    identity: { name: "Inmocemento, S.A.", currency: "EUR" },
    classification: { sector: "Financial Services" },
    metrics: { method: "EXTRACTOR_DAILY_V1", volatility: { "1y": 0.318683 } },
    quality: { coverage: 0.473684 }
  };

  test("una acción no tiene Sharpe ni estrellas que enseñar, y eso NO es un hueco", () => {
    const fila = componerFila(tarjeta);
    const sharpe = COLUMNAS_DEL_BUSCADOR.find((c) => c.id === "sharpe3a")!.celda(fila);
    const estrellas = COLUMNAS_DEL_BUSCADOR.find((c) => c.id === "estrellas")!.celda(fila);
    expect(sharpe.ausencia).toBe("no-aplica");
    expect(estrellas.ausencia).toBe("no-aplica");
    expect(estrellas.texto).toBe("No aplica");
  });

  test("el coste, el patrimonio y «Datos disponibles» ya no son columnas de la lista (decisión A-172)", () => {
    const ids = COLUMNAS_DEL_BUSCADOR.map((c) => c.id);
    for (const fuera of ["coste", "patrimonio", "cobertura"]) expect(ids, fuera).not.toContain(fuera);
    /* Las estrellas, junto a la categoría contra la que puntúan (Óscar, 17-11-2026). */
    expect(ids).toEqual(["nombre", "clasificacion", "estrellas", "divisa", "rentabilidad1a", "volatilidad1a", "volatilidad3a", "sharpe3a"]);
  });

  test("las estrellas de un fondo: tres son «★★★☆☆», y fuera de 1 a 5 se acotan o faltan", () => {
    const estrellas = COLUMNAS_DEL_BUSCADOR.find((c) => c.id === "estrellas")!;
    const fondo = (puntuacion: unknown) =>
      componerFila({ instrument_id: "LU0000000001", instrument_type: "FUND", identity: { name: "Fondo", currency: "EUR" }, classification: { morningstar_rating: puntuacion } });
    expect(estrellas.celda(fondo(3))).toEqual({ texto: "★★★☆☆", valor: 3 });
    expect(estrellas.celda(fondo(5))).toEqual({ texto: "★★★★★", valor: 5 });
    /* ACT-21: un 6 no rompe la tabla, y sin puntuación o con 0 no hay estrellas. */
    expect(estrellas.celda(fondo(6)).valor).toBe(5);
    expect(estrellas.celda(fondo(0)).ausencia).toBe("falta");
    expect(estrellas.celda(fondo(undefined)).ausencia).toBe("falta");
  });

  test("lo que sí es un hueco se marca como tal", () => {
    const sinMetricas = componerFila({ ...tarjeta, metrics: undefined });
    const volatilidad = COLUMNAS_DEL_BUSCADOR.find((c) => c.id === "volatilidad1a")!.celda(
      sinMetricas
    );
    expect(volatilidad.ausencia).toBe("falta");
  });

  test("la escala de la fila es el método con que se calculó su cifra", () => {
    expect(componerFila(tarjeta).escala).toBe("EXTRACTOR_DAILY_V1");
  });

  test("el sector en inglés se traduce, y lo que no conocemos se deja crudo", () => {
    expect(componerFila(tarjeta).clasificacion).toBe("Financieras");
    const raro = componerFila({ ...tarjeta, classification: { sector: "Quantum Widgets" } });
    expect(raro.clasificacion).toBe("Quantum Widgets");
  });

  /*
   * Decisión A-171 (Óscar, 16-11-2026): el Sharpe del Buscador va a 3 años. Con doce meses el error típico del Sharpe
   * anualizado ronda ±1, y esta es la pantalla donde se ordena para elegir. La rentabilidad y la volatilidad siguen a 1 año.
   */
  describe("el Sharpe de la lista es el de 3 años", () => {
    const sharpe = COLUMNAS_DEL_BUSCADOR.find((c) => c.id === "sharpe3a")!;
    const fondo = (metrics: Record<string, unknown>) =>
      componerFila({ instrument_id: "LU0000000001", instrument_type: "FUND", identity: { name: "Fondo", currency: "EUR" }, metrics });
    const NUESTRAS = { method: "EXTRACTOR_MONTHLY_V2", annualized_return: { "1y": 0.08 }, volatility: { "1y": 0.1 } };

    test("la columna se llama así, y ya no hay columna del Sharpe a 1 año", () => {
      expect(sharpe.titulo).toBe("Sharpe\u00a03A");
      expect(sharpe.tituloCompleto).toBe("Sharpe 3 años");
      expect(COLUMNAS_DEL_BUSCADOR.some((c) => c.id === "sharpe1a")).toBe(false);
    });

    test("con las dos ventanas, se enseña la de 3 años y no la de 1", () => {
      const fila = fondo({ ...NUESTRAS, sharpe: { "1y": 0.93, "3y": 1.42 } });
      expect(fila.sharpe3a).toBe(1.42);
      expect(sharpe.celda(fila)).toEqual({ texto: "1,42", valor: 1.42 });
      expect(fila.escalaDelSharpe).toBe("EXTRACTOR_MONTHLY_V2");
    });

    test("un fondo con menos de 3 años no tiene Sharpe en la lista: el de 1 año no ocupa su sitio", () => {
      const fila = fondo({ ...NUESTRAS, sharpe: { "1y": 0.93 } });
      expect(fila.sharpe3a).toBeUndefined();
      expect(sharpe.celda(fila).ausencia).toBe("falta");
      expect(sharpe.celda(fila).valor).toBeUndefined();
    });

    test("si el de 3 años es del proveedor, la fila sigue siendo nuestra y es la celda la que lo dice", () => {
      const fila = fondo({ ...NUESTRAS, sharpe: { "1y": 0.93 }, provider: { method: "TRAILING_PROVIDER", sharpe: { "3y": 0.61 } } });
      /* La rentabilidad y la volatilidad a 1 año son nuestras: la fila no pasa a «proveedor» por su Sharpe. */
      expect(fila.escala).toBe("EXTRACTOR_MONTHLY_V2");
      expect(fila.escalaDelSharpe).toBe("TRAILING_PROVIDER");
      expect(sharpe.celda(fila)).toEqual({ texto: "0,61", valor: 0.61, apunte: "proveedor" });
      /* Y al ordenar por Sharpe va con los del proveedor, no con los nuestros. */
      expect(sharpe.escalaDe?.(fila)).toBe("TRAILING_PROVIDER");
    });

    test("en una fila que ya es del proveedor, el Sharpe no repite lo que dice el nombre", () => {
      const fila = fondo({ method: "EXTRACTOR_MONTHLY_V2", provider: { method: "TRAILING_PROVIDER", annualized_return: { "1y": 0.05 }, volatility: { "1y": 0.07 }, sharpe: { "3y": 0.4 } } });
      expect(fila.escala).toBe("TRAILING_PROVIDER");
      expect(sharpe.celda(fila)).toEqual({ texto: "0,40", valor: 0.4 });
    });

    test("sin Sharpe, al ordenar por él la fila se queda en el grupo de su método", () => {
      const fila = fondo(NUESTRAS);
      expect(fila.escalaDelSharpe).toBeUndefined();
      expect(sharpe.escalaDe?.(fila)).toBe("EXTRACTOR_MONTHLY_V2");
    });

    test("el de una acción no aplica, aunque su tarjeta lo trajera", () => {
      const accion = componerFila({ ...tarjeta, metrics: { method: "EXTRACTOR_DAILY_V2", sharpe: { "3y": 1.1 } } });
      expect(accion.sharpe3a).toBeUndefined();
      expect(accion.escalaDelSharpe).toBeUndefined();
      expect(sharpe.celda(accion).ausencia).toBe("no-aplica");
    });
  });

  /* Decisión A-172 (Óscar, 16-11-2026): la volatilidad a 3 años se añade junto a la de 1 año, que se queda. */
  describe("la volatilidad de la lista va a 1 y a 3 años", () => {
    const columna = (id: string) => COLUMNAS_DEL_BUSCADOR.find((c) => c.id === id)!;
    const fondo = (metrics: Record<string, unknown>) =>
      componerFila({ instrument_id: "LU0000000001", instrument_type: "FUND", identity: { name: "Fondo", currency: "EUR" }, metrics });

    test("las dos columnas están, la de 3 años justo detrás de la de 1 y delante del Sharpe", () => {
      const ids = COLUMNAS_DEL_BUSCADOR.map((c) => c.id);
      expect(ids.slice(ids.indexOf("volatilidad1a"), ids.indexOf("sharpe3a") + 1)).toEqual(["volatilidad1a", "volatilidad3a", "sharpe3a"]);
      expect(columna("volatilidad1a").titulo).toBe("Vol.\u00a01A");
      expect(columna("volatilidad3a").titulo).toBe("Vol.\u00a03A");
      expect(columna("volatilidad3a").tituloCompleto).toBe("Volatilidad 3 años");
    });

    test("cada columna lee su ventana: 0,10 es un 10,00 % y 0,125 un 12,50 %", () => {
      const fila = fondo({ method: "EXTRACTOR_MONTHLY_V3", annualized_return: { "1y": 0.08 }, volatility: { "1y": 0.1, "3y": 0.125 } });
      expect(columna("volatilidad1a").celda(fila)).toEqual({ texto: "10,00\u00a0%", valor: 0.1 });
      expect(columna("volatilidad3a").celda(fila)).toEqual({ texto: "12,50\u00a0%", valor: 0.125 });
      expect(fila.escalaDeLaVolatilidad3a).toBe("EXTRACTOR_MONTHLY_V3");
    });

    test("sin 3 años de historia falta la de 3, y la de 1 sigue", () => {
      const fila = fondo({ method: "EXTRACTOR_MONTHLY_V3", volatility: { "1y": 0.1 } });
      expect(columna("volatilidad3a").celda(fila).ausencia).toBe("falta");
      expect(columna("volatilidad1a").celda(fila).valor).toBe(0.1);
      expect(columna("volatilidad3a").escalaDe?.(fila)).toBe("EXTRACTOR_MONTHLY_V3");
    });

    test("si la de 3 años es del proveedor, lo dice la celda y la fila sigue siendo nuestra", () => {
      const fila = fondo({ method: "EXTRACTOR_MONTHLY_V3", annualized_return: { "1y": 0.08 }, volatility: { "1y": 0.1 }, provider: { method: "TRAILING_PROVIDER", volatility: { "3y": 0.2 } } });
      expect(fila.escala).toBe("EXTRACTOR_MONTHLY_V3");
      expect(columna("volatilidad3a").celda(fila)).toEqual({ texto: "20,00\u00a0%", valor: 0.2, apunte: "proveedor" });
      expect(columna("volatilidad3a").escalaDe?.(fila)).toBe("TRAILING_PROVIDER");
      /* La de 1 año es nuestra y no lleva apunte. */
      expect(columna("volatilidad1a").celda(fila).apunte).toBeUndefined();
    });

    test("una acción sí tiene volatilidad a 3 años: no es el Sharpe", () => {
      const accion = componerFila({ ...tarjeta, metrics: { method: "EXTRACTOR_DAILY_V3", volatility: { "1y": 0.318683, "3y": 0.29 } } });
      expect(columna("volatilidad3a").celda(accion)).toEqual({ texto: "29,00\u00a0%", valor: 0.29 });
    });
  });

  test("al ordenar, la tabla agrupa por la escala de la columna cuando la columna la dice", () => {
    /* Dos filas del mismo método; la cifra de la segunda es del proveedor. Por la fila no habría grupos; por la columna, dos. */
    const filas: Array<Caso & { suya?: string }> = [
      { id: "a", escala: "EXTRACTOR_MONTHLY_V2", cifra: 1 },
      { id: "b", escala: "EXTRACTOR_MONTHLY_V2", cifra: 2, suya: "TRAILING_PROVIDER" }
    ];
    const columnas = (conEscalaPropia: boolean): ColumnaDeTabla<Caso & { suya?: string }>[] => [
      { id: "cifra", titulo: "Cifra", cifra: true, escalaMixta: true, celda: (f) => ({ texto: String(f.cifra), valor: f.cifra }), ...(conEscalaPropia ? { escalaDe: (f) => f.suya ?? f.escala } : {}) }
    ];
    const html = (conEscalaPropia: boolean) =>
      renderToStaticMarkup(<TablaDeDatos columnas={columnas(conEscalaPropia)} estado={{ orden: "cifra", sentido: 1, pagina: 1 }} filas={filas} titulo="Prueba" />);
    const grupos = (texto: string) => (texto.match(/class="tabla__grupo"/g) ?? []).length;
    expect(grupos(html(false))).toBe(0);
    expect(grupos(html(true))).toBe(2);
  });

  test("ninguna hoja de la tabla declara un color en crudo", () => {
    const hoja = readFileSync(new URL("../src/styles/tabla.css", import.meta.url), "utf8");
    const sinComentarios = hoja.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(sinComentarios).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(sinComentarios).not.toMatch(/\brgba?\(/);
  });
});
