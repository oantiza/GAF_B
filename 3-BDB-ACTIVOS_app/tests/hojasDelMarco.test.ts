import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vitest";
import * as tema from "../src/core/theme";
import * as regiones from "../src/core/regionTaxonomy";

/**
 * Reglas de hoja del marco, de las tablas y de la documentación de estilos (bloque G del cierre de la auditoría del
 * frontend, 14-11-2026). Ninguna se ve en una prueba de componente: happy-dom no pinta, y una regla que falta o que
 * vuelve a su valor de antes no rompe nada que se pueda pulsar.
 */

const leer = (ruta: string) => readFileSync(new URL(`../${ruta}`, import.meta.url), "utf8");
const hoja = (nombre: string) => leer(`src/styles/${nombre}`);
const sinComentarios = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");
const normal = (texto: string) => texto.replace(/\s+/g, " ").trim();

const HOJAS = readdirSync(new URL("../src/styles/", import.meta.url)).filter((nombre) => nombre.endsWith(".css")).sort();

interface Regla { selectores: string[]; cuerpo: string }

/** Las reglas de una hoja (también las de dentro de una `@media`), con sus selectores normalizados. */
function reglasDe(css: string): Regla[] {
  return [...sinComentarios(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((c) => ({
    selectores: c[1].split(",").map(normal),
    cuerpo: c[2]
  }));
}

/** El cuerpo de la primera regla cuyo selector (entero, normalizado) es `selector`. */
function cuerpoDe(css: string, selector: string): string | null {
  return reglasDe(css).find((regla) => regla.selectores.includes(normal(selector)))?.cuerpo ?? null;
}

/** El valor de una propiedad dentro de un cuerpo de regla. */
function valor(cuerpo: string | null, propiedad: string): string | undefined {
  return cuerpo?.match(new RegExp(`(?:^|[;{\\s])${propiedad}\\s*:\\s*([^;]+);`))?.[1].trim();
}

/** Lo que hay dentro de la primera `@media` cuya condición empieza por `condicion`, con sus llaves equilibradas. */
function bloqueMedia(css: string, condicion: string): string {
  const limpio = sinComentarios(css);
  const inicio = limpio.indexOf(`@media ${condicion}`);
  if (inicio < 0) throw new Error(`No hay @media ${condicion}`);
  const abre = limpio.indexOf("{", inicio);
  let profundidad = 0;
  for (let i = abre; i < limpio.length; i += 1) {
    if (limpio[i] === "{") profundidad += 1;
    if (limpio[i] === "}") profundidad -= 1;
    if (profundidad === 0) return limpio.slice(abre + 1, i);
  }
  throw new Error(`@media ${condicion} sin cerrar`);
}

describe("MAR-11 · con colores forzados, lo elegido no se marca solo con un fondo", () => {
  const forzados = bloqueMedia(hoja("base.css"), "(forced-colors: active)");

  test("la entrada activa del menú lleva un contorno en colores del sistema (su pastilla es un fondo, que el modo quita)", () => {
    expect(valor(cuerpoDe(forzados, ".rail-link.active"), "outline")).toMatch(/solid CanvasText/);
  });

  test("la pestaña elegida lleva un subrayado de borde, no el filete de fondo que el modo quita", () => {
    expect(valor(cuerpoDe(forzados, ".ui-tab.active"), "border-bottom")).toMatch(/solid Highlight/);
  });

  test("un distintivo lleva un contorno, con el peso para ganar a `.badge { border: 0 }`", () => {
    expect(valor(cuerpoDe(forzados, ":root .badge"), "border")).toMatch(/solid CanvasText/);
    expect(valor(cuerpoDe(hoja("components.css"), ".badge"), "border")).toBe("0");
  });
});

describe("MAR-13 · la cabecera de una tabla escrita a mano es la de TablaDeDatos", () => {
  const pieza = cuerpoDe(hoja("tabla.css"), ".tabla th");
  const PROPIEDADES = ["font-size", "font-weight", "color"] as const;

  test.each(PROPIEDADES)("`thead th` (components.css) lleva el mismo %s que `.tabla th`", (propiedad) => {
    expect(valor(pieza, propiedad)).toBeDefined();
    expect(valor(cuerpoDe(hoja("components.css"), "thead th"), propiedad)).toBe(valor(pieza, propiedad));
  });

  /* Las cabeceras que se apartan a propósito, con su razón. Todo lo demás que pinte una cabecera de columna tiene que
     coincidir con la pieza. Los encabezados de FILA (`tbody th`, `scope="row"`) son nombres y no entran aquí. */
  const APARTADAS: Record<string, string> = {
    ".tabla th": "es la pieza",
    /* La de las tablas de activos (`.tabla--activos thead th`) dejó de apartarse con la dirección A (18-11-2026): su
       cabecera es la de toda tabla, 12 px en seminegra, y la regla ya no cambia el tamaño, el peso ni la tinta. */
    ".tabla--comparativa thead th": "en la comparativa cada columna es un instrumento: su cabecera es un nombre, en tinta y a 14 px"
  };

  const cabecerasDeColumna = HOJAS.filter((nombre) => nombre !== "impresion.css").flatMap((nombre) =>
    reglasDe(hoja(nombre)).flatMap(({ selectores, cuerpo }) =>
      selectores
        .filter((selector) => {
          const ultimo = selector.split(/[\s>]+/).pop() ?? "";
          if (!/^th(?=$|[.:[])/.test(ultimo)) return false;
          // El rótulo del pie de totales (`.tabla__pie > th`) es un encabezado de fila, como los de `tfoot`.
          return !/tbody|tfoot|scope="row"|celda--fila|tabla__pie|::after|::before|button/.test(selector);
        })
        .map((selector) => ({ nombre, selector, cuerpo }))
    )
  );

  test("la cabecera de la pieza va a 12 px, en seminegra y en la tinta 2, con un filete de tinta que viaja con ella", () => {
    expect(valor(pieza, "font-size")).toBe("var(--texto-xxs)");
    expect(valor(pieza, "font-weight")).toBe("600");
    expect(valor(pieza, "color")).toBe("var(--tinta-2)");
    const pegada = cuerpoDe(hoja("tabla.css"), ".tabla thead th");
    expect(valor(pegada, "box-shadow")).toBe("inset 0 -1px 0 var(--tinta)");
    expect(valor(pegada, "border-bottom")).toBe("0");
    /* Las filas, con el filete claro de dentro de una tarjeta; el pie, con el de tinta de la cabecera. */
    expect(valor(cuerpoDe(hoja("tabla.css"), ".tabla td"), "border-bottom")).toBe("1px solid var(--filete-fila)");
    expect(valor(cuerpoDe(hoja("tabla.css"), ".tabla .tabla__pie > td"), "border-top")).toBe("1px solid var(--tinta)");
  });

  test("la prueba ve las cabeceras de las tablas escritas a mano", () => {
    const vistos = cabecerasDeColumna.map(({ selector }) => selector);
    expect(vistos).toContain("thead th");
    expect(vistos).toContain(".gestor-tabla th");
    expect(vistos).toContain(".jubilacion-saldos thead th");
    expect(vistos).toContain(".costs-table th");
  });

  test("ninguna cabecera de columna escrita a mano cambia el tamaño, el peso o la tinta", () => {
    const distintas = cabecerasDeColumna
      .filter(({ selector }) => !(selector in APARTADAS))
      .flatMap(({ nombre, selector, cuerpo }) =>
        PROPIEDADES.filter((propiedad) => {
          const suyo = valor(cuerpo, propiedad);
          return suyo !== undefined && suyo !== valor(pieza, propiedad);
        }).map((propiedad) => `${nombre} · ${selector} · ${propiedad}: ${valor(cuerpo, propiedad)}`)
      );
    expect(distintas).toEqual([]);
  });
});

describe("MAR-17 y MAR-18 · tabla.css: ningún tamaño bajo la escala y ningún espaciado fuera de ella", () => {
  const tabla = hoja("tabla.css");

  test("el rótulo de eje del plano va a 12 px, el tamaño menor de la escala", () => {
    expect(valor(cuerpoDe(tabla, ".plano__eje-rotulo"), "font-size")).toBe("var(--texto-xs)");
  });

  test("ningún tamaño de letra en píxeles", () => {
    expect(sinComentarios(tabla)).not.toMatch(/font-size\s*:\s*[\d.]+px/);
  });

  test("rellenos, márgenes y huecos salen de los tokens de espaciado", () => {
    const sueltos = reglasDe(tabla).flatMap(({ selectores, cuerpo }) =>
      [...cuerpo.matchAll(/(?:^|[;\s])((?:padding|margin|gap|row-gap|column-gap)[\w-]*)\s*:\s*([^;]+);/g)]
        .filter((d) => /\d+(?:\.\d+)?px/.test(d[2]))
        .map((d) => `${selectores.join(", ")} · ${d[1]}: ${d[2].trim()}`)
    );
    expect(sueltos).toEqual([]);
  });
});

describe("MAR-19 · capas, el color de la barra del navegador y lo que no usa nadie", () => {
  test("ninguna hoja escribe un z-index con número: salen de los tokens --z-*", () => {
    const numericos = HOJAS.filter((nombre) => nombre !== "tokens.css").flatMap((nombre) =>
      [...sinComentarios(hoja(nombre)).matchAll(/z-index\s*:\s*(-?\d+)\s*;/g)].map((c) => `${nombre}: z-index ${c[1]}`)
    );
    expect(numericos).toEqual([]);
    expect(hoja("tokens.css")).toMatch(/--z-pegado:\s*1;/);
    expect(hoja("tokens.css")).toMatch(/--z-sello:\s*2;/);
  });

  test("el theme-color de index.html es el color de la barra superior (--lienzo)", () => {
    const lienzo = hoja("tokens.css").match(/--lienzo:\s*(#[0-9a-f]{6});/i)?.[1];
    expect(lienzo).toBeDefined();
    const meta = leer("index.html").match(/<meta name="theme-color" content="([^"]+)"/)?.[1];
    expect(meta?.toLowerCase()).toBe(lienzo?.toLowerCase());
  });

  test("la animación oaa-pulse, que no usaba nadie, se ha borrado", () => {
    for (const nombre of HOJAS) expect(hoja(nombre), nombre).not.toContain("oaa-pulse");
  });
});

describe("MAR-06 · el signo con color lo pone la pieza Cifra, y las clases .pos y .neg ya no existen", () => {
  test("Cifra pinta el signo en verde y en rojo", () => {
    const componentes = hoja("components.css");
    expect(valor(cuerpoDe(componentes, ".cifra--sube"), "color")).toBe("var(--sube)");
    expect(valor(cuerpoDe(componentes, ".cifra--baja"), "color")).toBe("var(--baja)");
  });

  test("base.css ya no dice que una cifra «no es buena ni mala», y nombra la regla del signo", () => {
    const base = normal(hoja("base.css"));
    expect(base).not.toContain("no es buena ni mala");
    expect(base).toContain("verde (--sube) si gana y rojo (--baja) si pierde");
  });

  test("ninguna hoja define .pos, .neg, .u-pos ni .u-neg: pintaban en tinta, que es no pintar nada", () => {
    for (const nombre of ["base.css", "components.css", "modules.css"]) {
      const css = hoja(nombre);
      for (const clase of [".pos", ".neg", ".u-pos", ".u-neg"]) expect(cuerpoDe(css, clase), `${nombre} ${clase}`).toBeNull();
    }
  });
});

describe("MAR-28 · la documentación de estilos, al día", () => {
  const readme = leer("src/styles/README.md");

  test.each(HOJAS)("el README de estilos lista %s", (nombre) => {
    expect(readme).toContain(`\`${nombre}\``);
  });

  test("no habla de «Rendimiento» ni del «benchmark», y los comentarios de las hojas tampoco lo contradicen", () => {
    expect(readme).not.toMatch(/Rendimiento|benchmark/i);
    expect(hoja("tokens.css")).not.toContain("Rendimiento");
    expect(normal(hoja("components.css"))).not.toContain("correcto/ganancia");
  });

  test("dice la regla del color del signo y la de los cortes de ancho, con todos los cortes de su prueba", () => {
    expect(readme).toContain("**El signo de un resultado lleva color.**");
    expect(readme).toContain("tests/cortesDeAncho.test.ts");
    const prueba = leer("tests/cortesDeAncho.test.ts");
    const lista = prueba.slice(prueba.indexOf("const CORTES_DE_ANCHO"), prueba.indexOf("const CORTES_DE_ALTO"));
    const cortes = [...lista.matchAll(/^\s*(\d+):/gm)].map((c) => Number(c[1]));
    expect(cortes.length).toBeGreaterThan(10);
    const conPunto = (n: number) => (n >= 1000 ? `${Math.floor(n / 1000)}.${String(n % 1000).padStart(3, "0")}` : String(n));
    for (const corte of cortes) expect(readme, `corte ${corte}`).toContain(conPunto(corte));
  });
});

describe("DIS-25 · la tabla de posiciones de Diseño desplaza dentro de su envoltorio", () => {
  test("el envoltorio desplaza en horizontal, porque la tabla pide su ancho mínimo", () => {
    expect(valor(cuerpoDe(hoja("diseno.css"), ".diseno-paso .portfolio-table-wrapper"), "overflow-x")).toBe("auto");
    expect(valor(cuerpoDe(hoja("modules.css"), ".portfolio-table"), "min-width")).toMatch(/px$/);
  });

  test("la tabla va dentro de ese envoltorio, y el envoltorio dentro del paso de Diseño", () => {
    expect(leer("src/components/PortfolioPositionsTable.tsx")).toContain('className="portfolio-table-wrapper"');
    expect(leer("src/components/PortfolioBuilder.tsx")).toMatch(/className="[^"]*\bdiseno-paso\b/);
  });
});

describe("ANA-23 y MAR-20 · sin las secuencias de color que no usa nadie", () => {
  test("theme.ts ya no exporta CATEGORICAL_SERIES_BESIDE_UNCLASSIFIED", () => {
    expect("CATEGORICAL_SERIES_BESIDE_UNCLASSIFIED" in tema).toBe(false);
  });

  /* El 14-11-2026 se borraron por no tener uso (el mapa iba en una sola tinta) y el mismo día volvieron, por decisión de
     Óscar: en el mapa, un color por zona es imprescindible. Lo que se vigila ahora es que cada zona tenga el suyo y que la
     intensidad siga al peso. */
  test("cada zona del mapa tiene su color, distinto de los otros dos, y más intenso con más peso", () => {
    const zonas = ["america", "emea", "asia"] as const;
    const plenos = zonas.map((zona) => regiones.ZONE_CHIP[zona]);
    expect(new Set(plenos).size).toBe(3);
    for (const zona of zonas) {
      const tramos = [10, 30, 60, 90].map((peso) => regiones.zoneColor(zona, peso));
      expect(new Set(tramos).size, `${zona}: cuatro tramos distintos`).toBe(4);
      expect(tramos[3], `${zona}: el tramo de más peso es el color pleno`).toBe(regiones.ZONE_CHIP[zona]);
      expect(regiones.zoneColor(zona, Number.NaN)).toBe(tramos[0]);
    }
  });
});

describe("dirección A · el recuadro de la propuesta en la barra: el estado se lee entero siempre (18-11-2026)", () => {
  /* A 768, «sin guardar» se quedaba en «si…», y en «Planes y EPSV» en «·.»; a 1.024, con la miga larga de Propuestas
     guardadas, en «sin gu…». Y aunque por debajo de 900 se arregló, de 900 a 1.010 seguía cortado, y de 1.025 a 1.150,
     con el menú desplegado, llegaba a no verse nada. Es un estado y va en el color de aviso: no cede, a ningún ancho.
     Cede, por este orden: la miga (la sección y después el nombre de la pantalla, con elipsis, que deja de verse sin
     sitio para unas seis letras), el correo, el nombre de la propuesta y, lo último, el recuento. Medido cada 10 px de
     768 a 1.300, y a 1.440, 1.920 y 2.560, en Diseño, Propuestas guardadas, Análisis y Planes y EPSV, con el menú
     desplegado y plegado, con el aviso de la cuenta y sin él (y un correo largo). */
  const layout = hoja("layout.css");
  const estrecha = bloqueMedia(layout, "(max-width: 899.98px)");

  /** Lo que hay dentro de la `@container` cuya condición es exactamente `condicion`. */
  function bloqueContenedor(css: string, condicion: string): string {
    const limpio = sinComentarios(css);
    const inicio = limpio.indexOf(`@container ${condicion} {`);
    if (inicio < 0) throw new Error(`No hay @container ${condicion}`);
    const abre = limpio.indexOf("{", inicio);
    let profundidad = 0;
    for (let i = abre; i < limpio.length; i += 1) {
      if (limpio[i] === "{") profundidad += 1;
      if (limpio[i] === "}") profundidad -= 1;
      if (profundidad === 0) return limpio.slice(abre + 1, i);
    }
    throw new Error(`@container ${condicion} sin cerrar`);
  }

  test("el estado no encoge ni se recorta, y sigue en el color de aviso", () => {
    const estado = cuerpoDe(layout, ".topbar-chip__estado");
    expect(valor(estado, "flex")).toBe("none");
    expect(valor(estado, "color")).toBe("var(--aviso)");
    expect(valor(estado, "text-overflow")).toBeUndefined();
    expect(valor(estado, "overflow")).toBeUndefined();
    /* Ninguna regla de ninguna hoja le devuelve el encogimiento o el recorte. */
    for (const nombre of HOJAS) {
      for (const regla of reglasDe(hoja(nombre)).filter((r) => r.selectores.some((sel) => sel.includes("topbar-chip__estado")))) {
        expect(regla.cuerpo, `${nombre}: ${regla.selectores.join(", ")}`).not.toMatch(/flex-shrink|text-overflow|overflow|max-width/);
      }
    }
  });

  test("la miga es lo primero que cede, a cualquier ancho: toma lo que sobra de la barra y es un contenedor", () => {
    const miga = cuerpoDe(layout, ".topbar-crumbs");
    expect(valor(miga, "flex")).toBe("1 1 0");
    expect(valor(miga, "min-width")).toBe("0");
    expect(valor(miga, "container-type")).toBe("inline-size");
    expect(valor(miga, "overflow")).toBe("hidden");
    /* El separador no crece: si creciera, se quedaría la mitad de lo que sobra y la miga cedería antes de tiempo. */
    expect(valor(cuerpoDe(layout, ".topbar-spacer"), "flex")).toBe("none");
    const actual = cuerpoDe(layout, ".topbar-crumbs__current");
    expect(valor(actual, "min-width")).toBe("0");
    expect(valor(actual, "text-overflow")).toBe("ellipsis");
    expect(valor(actual, "white-space")).toBe("nowrap");
    expect(valor(cuerpoDe(layout, ".topbar-crumbs__paso"), "white-space")).toBe("nowrap");
  });

  test("sin sitio, la sección y después el nombre de la pantalla dejan de verse, pero no de leerse; nunca con una o dos letras", () => {
    /* 32ch: la sección más larga («Activos / Buscador /», 23,7ch medidos) más el mínimo de la pantalla. 8ch: unas seis
       letras con su elipsis. Las dos medidas, en la letra de la miga. */
    const sinSeccion = bloqueContenedor(layout, "(max-width: 32ch)");
    const sinPantalla = bloqueContenedor(layout, "(max-width: 8ch)");
    for (const [bloque, selector] of [[sinSeccion, ".topbar-crumbs__paso"], [sinPantalla, ".topbar-crumbs__current"]] as const) {
      const cuerpo = cuerpoDe(bloque, selector);
      expect(valor(cuerpo, "clip-path"), selector).toBe("inset(50%)");
      expect(valor(cuerpo, "position"), selector).toBe("absolute");
      expect(cuerpo, selector).not.toMatch(/display:\s*none/);
    }
  });

  test("el grupo de la derecha no encoge mientras quepa, a cualquier ancho, y nunca se sale de la barra", () => {
    const grupo = cuerpoDe(layout, ".topbar-cluster");
    expect(valor(grupo, "flex")).toBe("none");
    expect(valor(grupo, "max-width")).toBe("100%");
    expect(valor(grupo, "min-width")).toBe("0");
  });

  test("dentro del grupo, el correo cede antes que el nombre de la propuesta, y como él hasta 6ch; «Revisar seguridad», no", () => {
    const cuenta = cuerpoDe(layout, ".topbar-account:not(.topbar-account--aviso)");
    expect(Number(valor(cuenta, "flex-shrink"))).toBeGreaterThanOrEqual(10000);
    expect(valor(cuenta, "min-width")).toBe("calc(6ch + 2 * var(--s-4))");
    const correo = cuerpoDe(layout, ".topbar-account__email");
    expect(valor(correo, "min-width")).toBe("0");
    expect(valor(correo, "text-overflow")).toBe("ellipsis");
    expect(valor(cuerpoDe(layout, ".topbar-chip__value"), "min-width")).toBe("6ch");
    /* Con el nombre a la vista el recuento no cede: no lleva recorte fuera de la franja estrecha. */
    expect(valor(cuerpoDe(layout, ".topbar-chip__count"), "overflow")).toBeUndefined();
    expect(valor(cuerpoDe(layout, ".topbar-chip__count"), "min-width")).toBeUndefined();
  });

  test("por debajo de 900, sin la miga ni el nombre a la vista, lo último que cede es el recuento, con elipsis", () => {
    const recuento = cuerpoDe(estrecha, ".topbar-chip__count");
    expect(valor(recuento, "min-width")).toBe("0");
    expect(valor(recuento, "overflow")).toBe("hidden");
    expect(valor(recuento, "text-overflow")).toBe("ellipsis");
  });

  test("por debajo de 900 dejan de verse el correo, el rótulo y el nombre de la propuesta y la miga, y nada más", () => {
    const ocultos = reglasDe(estrecha)
      .filter((regla) => /display:\s*none|clip-path/.test(regla.cuerpo))
      .flatMap((regla) => regla.selectores)
      .sort();
    expect(ocultos).toEqual([".topbar-account__email", ".topbar-chip__label", ".topbar-chip__value", ".topbar-crumbs"]);
    /* La miga no se quita del árbol (`display: none`): se recorta, como el nombre, y el lector la sigue leyendo. */
    const recortados = reglasDe(estrecha).filter((regla) => /clip-path/.test(regla.cuerpo)).flatMap((regla) => regla.selectores);
    expect(recortados).toContain(".topbar-crumbs");
  });
});

describe("dirección A · ninguna letra del marco baja de 12 px (Óscar, 19-11-2026)", () => {
  /* La lámina dibujaba a 11 px el rótulo de grupo del menú y el subtítulo de la casa, y la migración los trajo así
     sin escribir la excepción. El sistema de diseño dice que ninguna letra a la vista baja de 12 px, y Óscar los subió
     a 12 (SISTEMA_DISENO.md, apartado 14.4). Estas pruebas son la regla en las hojas: happy-dom no pinta. */
  const tokens = sinComentarios(hoja("tokens.css"));
  const layout = hoja("layout.css");
  const enPx = (cifra: string, unidad: string) => (unidad === "rem" ? Number(cifra) * 16 : Number(cifra));

  test("el rótulo de grupo del menú y el subtítulo de la casa van en el menor tamaño de la escala, que son 12 px", () => {
    expect(tokens).toMatch(/--texto-xxs:\s*0\.75rem;/);
    expect(tokens).toMatch(/--rail-texto-rotulo:\s*var\(--texto-xxs\);/);
    expect(valor(cuerpoDe(layout, ".rail-section__label"), "font-size")).toBe("var(--rail-texto-rotulo)");
    expect(valor(cuerpoDe(layout, ".rail-brand__sub"), "font-size")).toBe("var(--rail-texto-rotulo)");
  });

  test("ningún token de tamaño de letra baja de 12 px", () => {
    const tamanos = [...tokens.matchAll(/(--(?:texto|titulo|cifra|rail-texto)-[a-z-]+):\s*([\d.]+)(rem|px);/g)].map((c) => ({ token: c[1], px: enPx(c[2], c[3]) }));
    expect(tamanos.length).toBeGreaterThan(10);
    expect(tamanos.filter((t) => t.px < 12).map((t) => `${t.token}: ${t.px} px`)).toEqual([]);
  });

  test("ninguna hoja escribe a mano un tamaño de letra: todo `font-size` es un token de 12 px o más, o está aquí con su razón", () => {
    /* Un tamaño escrito a mano es por donde vuelve una letra de 11 px. Lo que no es un token está en una de estas dos
       listas, y las dos solo bajan: una entrada que ya no usa ninguna hoja también hace fallar la prueba. */
    /** Llevan el tamaño del texto que las rodea: no pueden encogerlo. */
    const HEREDAN = ["inherit", "100%"];
    /** Encogen la letra, o la hacen menguar con su caja. Van contadas: una de más hace fallar la prueba, y quien la
        añada mide antes lo que pinta. */
    const MENGUAN: Record<string, { veces: number; razon: string }> = {
      "0.95em": { veces: 1, razon: "el código (`code`, `kbd`, `samp`, `pre`), algo menor que el texto en que va" },
      "0.9375em": { veces: 1, razon: "`.mono`: un código junto a un texto, proporcional a él" },
      "0.9em": { veces: 1, razon: "el código dentro de la prosa de un informe (`.prose code`), que va a 14 px" },
      "min(1em, var(--texto-md))": { veces: 1, razon: "una ausencia hereda el tamaño con tope, para que en una cifra de 32 px no grite" },
      "21cqi": { veces: 1, razon: "la cifra de un indicador mengua con su columna cuando no cabe (`KpiStrip`)" },
      "min(var(--cifra-indicador), calc(200cqi / var(--kpi-caracteres, 11)))": {
        veces: 1,
        razon: "la de una tira de importes mengua según lo larga que sea la más larga, para que quepan ocho cifras con signo"
      }
    };
    const limpias = HOJAS.map((nombre) => ({ nombre, css: sinComentarios(hoja(nombre)) }));
    const tamanos = limpias.flatMap(({ nombre, css }) => [...css.matchAll(/font-size\s*:\s*([^;}]+)/g)].map((c) => ({ nombre, valor: normal(c[1]) })));
    /* Un suelo, para que una lectura que no ve nada no pase. Medido el 21-11-2026: 384, después de borrar las pantallas
       de la base vieja en Sistema (eran más de 400). */
    expect(tamanos.length).toBeGreaterThan(350);
    const veces = (valor: string) => tamanos.filter((t) => t.valor === valor).length;
    const variableDe = (valor: string) => valor.match(/^var\((--[a-z0-9-]+)\)$/)?.[1];
    const sueltos = tamanos.filter((t) => !variableDe(t.valor) && !HEREDAN.includes(t.valor) && !(t.valor in MENGUAN));
    expect(sueltos.map((t) => `${t.nombre}: ${t.valor}`)).toEqual([]);
    expect(HEREDAN.filter((valor) => veces(valor) === 0)).toEqual([]);
    expect(Object.fromEntries(Object.keys(MENGUAN).map((valor) => [valor, veces(valor)]))).toEqual(
      Object.fromEntries(Object.entries(MENGUAN).map(([valor, dato]) => [valor, dato.veces]))
    );

    /* Cada variable que una hoja usa como tamaño de letra vale 12 px o más en todas sus definiciones, por sí misma o
       por la variable a la que apunta: también las que no se llaman como las de la escala (`--cell-fs`). */
    const definicionesDe = (variable: string) =>
      limpias.flatMap(({ css }) => [...css.matchAll(new RegExp(`(?<![a-z0-9-])${variable}\\s*:\\s*([^;}]+)`, "g"))].map((c) => normal(c[1])));
    const pxDe = (valor: string, saltos = 0): number => {
      const literal = valor.match(/^([\d.]+)(rem|px)$/);
      if (literal) return enPx(literal[1], literal[2]);
      const apuntada = variableDe(valor);
      if (!apuntada || saltos > 4) return Number.NaN;
      const suyas = definicionesDe(apuntada);
      return suyas.length > 0 ? Math.min(...suyas.map((una) => pxDe(una, saltos + 1))) : Number.NaN;
    };
    const usadas = [...new Set(tamanos.flatMap((t) => variableDe(t.valor) ?? []))];
    expect(usadas.length).toBeGreaterThan(10);
    expect(usadas.map((variable) => ({ variable, px: pxDe(`var(${variable})`) })).filter((una) => !(una.px >= 12))).toEqual([]);

    /* Y por si un `font` abreviado trajera su tamaño: solo se admite el que hereda. */
    const abreviados = limpias.flatMap(({ nombre, css }) => [...css.matchAll(/[;{\s]font\s*:\s*([^;}]+)/g)].map((c) => `${nombre}: ${normal(c[1])}`));
    expect(abreviados.length).toBeGreaterThan(0);
    expect(abreviados.filter((valor) => !valor.endsWith(": inherit"))).toEqual([]);
  });

  test("en el menú compacto el subtítulo de la casa cabe entero: lleva menos espaciado entre letras que en el ancho", () => {
    /* Medido el 19-11-2026: a 12 px y con 0,16 em mide 134,5 px, y en el menú de 224 px su sitio son 132. Como la regla
       lo recorta con puntos suspensivos, se leía «PRIVATE BANKE…». Con 0,13 em mide 129 px, en Chromium y a las cinco
       escalas de pantalla emuladas (1, 1,25, 1,5, 1,75 y 2). */
    const subtitulo = cuerpoDe(layout, ".rail-brand__sub");
    expect(valor(subtitulo, "letter-spacing")).toBe("0.16em");
    expect(valor(subtitulo, "text-overflow")).toBe("ellipsis");
    const compacto = bloqueMedia(layout, "(max-width: 1239.98px)");
    expect(valor(cuerpoDe(compacto, ".rail-brand__sub"), "letter-spacing")).toBe("0.13em");
    /* Y en ese orden: con la misma especificidad gana la última, así que la del menú compacto va después. */
    const limpia = sinComentarios(layout);
    expect(limpia.indexOf("@media (max-width: 1239.98px)")).toBeGreaterThan(limpia.indexOf(".rail-brand__sub {"));
  });
});

describe("dirección A · el calendario económico decide por el sitio de su lista, no por la ventana (Óscar, 19-11-2026)", () => {
  /* Con las cifras al lado, al nombre del evento le queda lo que sobra. La regla «las cifras bajan por debajo de 1.025»
     miraba la ventana, y entre 1.025 y 1.239 px el menú mide 224 px en vez de 96: a 1.100 al nombre le quedaban 132 px
     y se cortaban 37 de 39 («FOMC Membe…»). Óscar decidió que ahí vaya a dos líneas, como en tableta, y lo decide el
     ancho de la lista (SISTEMA_DISENO.md, apartado 14.5). happy-dom no evalúa consultas de contenedor: estas pruebas
     leen las hojas, todas, porque una regla de otra hoja también puede deshacerlo. */
  const hojas = HOJAS.map((nombre) => ({ nombre, css: sinComentarios(hoja(nombre)) }));
  const modulos = sinComentarios(hoja("modules.css"));
  const tokens = sinComentarios(hoja("tokens.css"));

  /** Las reglas-arroba de un tipo (`media`, `container`): su condición, su cuerpo con las llaves equilibradas y dónde empiezan. */
  const arrobas = (css: string, tipo: string) =>
    [...css.matchAll(new RegExp(`@${tipo}\\s+([^{]+)\\{`, "g"))].map((c) => {
      const desde = c.index + c[0].length;
      let profundidad = 1;
      let i = desde;
      for (; i < css.length && profundidad > 0; i += 1) {
        if (css[i] === "{") profundidad += 1;
        if (css[i] === "}") profundidad -= 1;
      }
      return { condicion: normal(c[1]), cuerpo: css.slice(desde, i - 1), posicion: c.index };
    });
  /** Las reglas-arroba de cualquier hoja que tocan una fila del calendario: por su clase propia o por la que comparte. */
  const queTocanLaFila = (tipo: string) =>
    hojas.flatMap(({ nombre, css }) =>
      arrobas(css, tipo).filter((a) => /\.(?:economic-event-|market-event-row)/.test(a.cuerpo)).map((a) => ({ ...a, nombre }))
    );
  const medida = (texto: string) => {
    const m = texto.match(/^([\d.]+)(rem|px)$/);
    if (!m) throw new Error(`No es una medida en rem o px: ${texto}`);
    return m[2] === "rem" ? Number(m[1]) * 16 : Number(m[1]);
  };
  const token = (nombre: string) => {
    const m = tokens.match(new RegExp(`(?<![a-z0-9-])${nombre}:\\s*([^;]+);`));
    if (!m) throw new Error(`tokens.css no define ${nombre}`);
    return medida(normal(m[1]));
  };
  const deLaFila = queTocanLaFila("container");

  test("la lista del calendario es el único contenedor con ese nombre, y ninguna hoja le vuelve a declarar el contenedor", () => {
    const declaran = hojas.flatMap(({ nombre, css }) =>
      reglasDe(css).flatMap((regla) =>
        ["container", "container-type", "container-name"].flatMap((propiedad) => {
          const dicho = valor(regla.cuerpo, propiedad);
          const esDeLaLista = regla.selectores.some((selector) => selector.includes("market-agenda-list"));
          return dicho !== undefined && (esDeLaLista || dicho.includes("calendario")) ? `${nombre}: ${regla.selectores.join(", ")} { ${propiedad}: ${dicho} }` : [];
        })
      )
    );
    expect(declaran).toEqual(["modules.css: .market-agenda-list { container: calendario / inline-size }"]);
  });

  test("en una línea, las cifras tienen sus tres columnas enteras y el nombre se queda con el resto", () => {
    expect(valor(cuerpoDe(modulos, ".economic-event-row"), "grid-template-columns")).toBe(
      "68px 5em minmax(0, 1fr) calc(3 * var(--calendario-cifra-w) + 2 * var(--s-5))"
    );
    expect(valor(cuerpoDe(modulos, ".economic-event-values"), "grid-template-columns")).toBe("repeat(3, var(--calendario-cifra-w))");
  });

  test("las cifras bajan a una segunda línea por el ancho de la lista: ninguna `@media` de ninguna hoja toca la fila", () => {
    expect(queTocanLaFila("media").map((a) => `${a.nombre}: @media ${a.condicion}`)).toEqual([]);
    expect(deLaFila.map((a) => `${a.nombre}: @container ${a.condicion}`)).toEqual(["modules.css: @container calendario (max-width: 56.24rem)"]);
    expect(valor(cuerpoDe(deLaFila[0].cuerpo, ".economic-event-row"), "grid-template-columns")).toBe("68px 5em minmax(0, 1fr)");
    const cifras = cuerpoDe(deLaFila[0].cuerpo, ".economic-event-values");
    expect(valor(cifras, "grid-column")).toBe("3");
    expect(valor(cifras, "justify-content")).toBe("end");
    /* Y después de la regla base, que tiene la misma especificidad (una clase): gana la última. */
    const base = modulos.indexOf("\n.economic-event-row {");
    expect(base).toBeGreaterThan(-1);
    expect(deLaFila[0].posicion).toBeGreaterThan(base);
  });

  test("el umbral es lo que la fila tiene fijo más 246 px de nombre, en rem: si cambia una medida, se vuelve a calcular", () => {
    /* La hora (68 px), el sello de impacto (5 em de una letra de 14 px), tres huecos, y tres cifras con sus dos huecos.
       El 18-11-2026 la casilla de cada cifra pasó de 7,5 a 9,5 rem sin medir cómo quedaba el nombre en el menú
       compacto, y los nombres se quedaron sin sitio: por eso el umbral se comprueba contra los tokens, y no solo se escribe. Va en rem porque casi todo lo
       fijo crece con la letra del navegador; aquí se cuenta con la letra de siempre, 16 px. */
    const fila = cuerpoDe(modulos, ".market-event-row");
    expect(valor(fila, "gap")).toBe("var(--s-5)");
    expect(valor(fila, "font-size")).toBe("var(--texto-sm)");
    const hueco = token("--s-5");
    const fijo = 68 + 5 * token("--texto-sm") + 3 * hueco + 3 * token("--calendario-cifra-w") + 2 * hueco;
    expect(fijo).toBe(654);
    const umbral = deLaFila[0].condicion.match(/^calendario \(max-width:\s*([\d.]+)rem\)$/);
    expect(umbral).not.toBeNull();
    /* «Por debajo de N» se escribe aquí N − 0,01 rem: 56.24rem por 56,25. */
    expect(Math.round((Number.parseFloat(umbral?.[1] ?? "0") + 0.01) * 16)).toBe(fijo + 246);
  });
});

describe("19-11-2026 · lo que encontraron las comprobaciones, arreglado (apartado 14.7 del sistema)", () => {
  const modulos = hoja("modules.css");
  const tabla = hoja("tabla.css");
  const planes = hoja("planes.css");
  const componentes = hoja("components.css");

  /** Todos los bloques `@media` de una hoja con esa condición exacta: hay varios con la misma, y `bloqueMedia` da solo el primero. */
  function bloquesMedia(css: string, condicion: string): string[] {
    const limpio = sinComentarios(css);
    const bloques: string[] = [];
    let desde = 0;
    for (;;) {
      const inicio = limpio.indexOf(`@media ${condicion} {`, desde);
      if (inicio < 0) return bloques;
      const abre = limpio.indexOf("{", inicio);
      let profundidad = 0;
      let fin = abre;
      for (let i = abre; i < limpio.length; i += 1) {
        if (limpio[i] === "{") profundidad += 1;
        if (limpio[i] === "}") profundidad -= 1;
        if (profundidad === 0) { fin = i; break; }
      }
      bloques.push(limpio.slice(abre + 1, fin));
      desde = fin;
    }
  }
  /** El cuerpo de la regla de ese selector dentro de alguna `@media` con esa condición. */
  const enMedia = (css: string, condicion: string, selector: string) =>
    bloquesMedia(css, condicion).map((bloque) => cuerpoDe(bloque, selector)).find((cuerpo) => cuerpo !== null) ?? null;
  /** Dónde empieza, en la hoja sin comentarios, la primera regla que lleva ese selector. */
  const posicion = (css: string, selector: string) => sinComentarios(css).indexOf(selector);

  test("Diseño: por debajo de 1.440 px la columna lateral baja debajo de la tabla, y el hueco ancho es solo de cuando van lado a lado", () => {
    expect(valor(enMedia(modulos, "(max-width: 1439.98px)", ".builder-compose > .col-8"), "grid-column")).toBe("span 12");
    expect(valor(enMedia(modulos, "(max-width: 1439.98px)", ".builder-compose > .col-4"), "grid-column")).toBe("span 12");
    expect(valor(enMedia(modulos, "(min-width: 1440px)", ".builder-compose"), "column-gap")).toBe("var(--s-10)");
    /* Una sola regla reparte esas dos columnas: la de 1.024 de antes ya no está, y nada las vuelve a poner lado a lado. */
    expect(reglasDe(modulos).filter((regla) => regla.selectores.includes(".builder-compose > .col-8"))).toHaveLength(1);
    expect(sinComentarios(modulos)).not.toMatch(/@media \(min-width: 1180px\) \{\s*\.builder-compose \{/);
  });

  test("Diseño: debajo de la tabla, las tarjetas de la lateral van en dos columnas que se reparten solas, y solo entre la tableta y los 1.440 px", () => {
    const condicion = "(min-width: 1025px) and (max-width: 1439.98px)";
    const lateral = enMedia(modulos, condicion, ".builder-compose__side");
    /* Columnas de texto, no una rejilla: las tarjetas se reparten por altura en su orden de lectura, sean cuatro o
       tres (en Modo cliente no está la del estado). En rejilla, la del riesgo dejaba un hueco junto a la del estado. */
    expect(valor(lateral, "display")).toBe("block");
    expect(valor(lateral, "columns")).toBe("2");
    expect(valor(lateral, "column-gap")).toBe("var(--s-6)");
    expect(valor(lateral, "grid-template-columns")).toBeUndefined();
    /* Ninguna tarjeta se parte entre las dos columnas, y entre una y la siguiente sigue el hueco de siempre. */
    expect(valor(enMedia(modulos, condicion, ".builder-compose__side > .panel"), "break-inside")).toBe("avoid");
    expect(valor(enMedia(modulos, condicion, ".builder-compose__side > .panel"), "margin-bottom")).toBeUndefined();
    expect(valor(cuerpoDe(modulos, ".builder-compose__side > .panel"), "margin-bottom")).toBe("var(--s-6)");
    /* Va detrás de la regla que apila la lateral: con el mismo peso, gana la última. */
    const limpio = sinComentarios(modulos);
    expect(limpio.indexOf(`@media ${condicion}`)).toBeGreaterThan(limpio.indexOf("\n.builder-compose__side {"));
    expect(limpio.indexOf(`@media ${condicion}`)).toBeGreaterThan(limpio.indexOf("\n.builder-compose__side > .panel:last-child {"));
    /* Fuera de ese tramo sigue siendo una columna. */
    expect(valor(cuerpoDe(modulos, ".builder-compose__side"), "flex-direction")).toBe("column");
  });

  test("Diseño: el nombre del activo llega a cuatro líneas, y con dedo sale entero", () => {
    const nombre = cuerpoDe(modulos, ".portfolio-table .cell-entity__name");
    expect(valor(nombre, "-webkit-line-clamp")).toBe("4");
    expect(valor(nombre, "line-clamp")).toBe("4");
    expect(valor(enMedia(modulos, "(pointer: coarse)", ".portfolio-table .cell-entity__name"), "line-clamp")).toBe("none");
  });

  test("ficha de un plan: si el rótulo y el valor no caben en una línea, el valor baja; el rótulo no encoge por debajo de su palabra más larga", () => {
    expect(valor(cuerpoDe(planes, ".planes-ficha__lateral .rows__item"), "flex-wrap")).toBe("wrap");
    expect(valor(cuerpoDe(planes, ".planes-ficha__lateral .rows__label"), "flex")).toBe("1 1 min-content");
    /* La pieza no cambia: fuera de esa tarjeta la fila no parte, el rótulo se recorta a dos líneas y el valor no parte. */
    expect(valor(cuerpoDe(componentes, ".rows__item"), "flex-wrap")).toBeUndefined();
    expect(valor(cuerpoDe(componentes, ".rows__label"), "-webkit-line-clamp")).toBe("2");
    expect(valor(cuerpoDe(componentes, ".rows__value"), "white-space")).toBe("nowrap");
  });

  test("ficha de un plan: el rótulo se lee entero, y un valor más ancho que la tarjeta parte por palabras en vez de salirse", () => {
    /* Medido con las gestoras y los productos más largos del catálogo: un rótulo largo junto a un valor corto perdía
       el final, y «Entidad de previsión social voluntaria (EPSV)» se salía de la tarjeta hasta 92 px. */
    const rotulo = cuerpoDe(planes, ".planes-ficha__lateral .rows__label");
    expect(valor(rotulo, "display")).toBe("block");
    expect(valor(rotulo, "overflow")).toBe("visible");
    expect(valor(rotulo, "-webkit-line-clamp")).toBe("none");
    expect(valor(rotulo, "line-clamp")).toBe("none");
    const dato = cuerpoDe(planes, ".planes-ficha__lateral .rows__value");
    expect(valor(dato, "white-space")).toBe("normal");
    expect(valor(dato, "text-align")).toBe("right");
    expect(valor(dato, "overflow-wrap")).toBe("anywhere");
    /* La tarjeta es la de la ficha, y sus filas son las de la pieza. */
    const ficha = leer("src/components/planes/FichaDelPlan.tsx");
    expect(ficha).toContain("planes-ficha__lateral");
  });

  test("una fila que es una frase se lee entera, y las señales de datos de Análisis lo son", () => {
    const frase = cuerpoDe(componentes, ".rows__label--frase");
    expect(valor(frase, "display")).toBe("block");
    expect(valor(frase, "overflow")).toBe("visible");
    expect(valor(frase, "-webkit-line-clamp")).toBe("none");
    /* Detrás de la regla del rótulo, que con el mismo peso la pisaría. */
    expect(posicion(componentes, "\n.rows__label--frase {")).toBeGreaterThan(posicion(componentes, "\n.rows__label {"));
    const radiografia = leer("src/components/PortfolioXray.tsx");
    const senales = radiografia.slice(radiografia.indexOf("<h3>Señales de datos</h3>"));
    expect(senales.match(/className="rows__label rows__label--frase"/g)).toHaveLength(2);
    expect(senales).not.toMatch(/className="rows__label"/);
  });

  test("la fila bajo el ratón de una tabla de activos va en el azul tenue, también en sus columnas fijas", () => {
    for (const selector of [".tabla--activos tbody tr:hover td", ".tabla--activos tbody tr:hover .tabla__celda--fila"]) {
      expect(valor(cuerpoDe(tabla, selector), "background"), selector).toBe("var(--marca-tenue)");
    }
    /* Detrás de la regla de toda tabla, que la pinta en el lienzo y pesa lo mismo. */
    expect(valor(cuerpoDe(tabla, ".tabla tbody tr:hover td"), "background")).toBe("var(--lienzo)");
    expect(posicion(tabla, "\n.tabla--activos tbody tr:hover td,")).toBeGreaterThan(posicion(tabla, "\n.tabla tbody tr:hover td,"));
    /* Las celdas fijas del Buscador y de Planes pintan su fondo: repiten el de la fila. */
    const estrecho = "screen and (max-width: 1439.98px)";
    expect(valor(enMedia(tabla, estrecho, ".buscador-nuevo .tabla tbody tr:where(:not(.tabla__grupo)):hover td:first-child"), "background")).toBe("var(--marca-tenue)");
    expect(valor(enMedia(tabla, estrecho, ".buscador-nuevo .tabla tbody tr:hover .tabla__celda--acciones"), "background")).toBe("var(--marca-tenue)");
    expect(valor(enMedia(planes, "(max-width: 1439.98px)", ".planes-lista .tabla tbody tr:hover > .tabla__celda--acciones"), "background")).toBe("var(--marca-tenue)");
    /* Y la del diálogo de sustituir un fondo, que también es una tabla de activos con la última celda fija. Su regla
       tiene que pesar más que la que le da el papel: más clases, o las mismas y más elementos. */
    const fija = ".swap-dialog .tabla-de-alternativas .tabla__celda--acciones";
    const fijaBajoElRaton = ".swap-dialog .tabla-de-alternativas tbody tr:hover > .tabla__celda--acciones";
    expect(valor(cuerpoDe(modulos, fija), "background")).toBe("var(--papel)");
    expect(valor(cuerpoDe(modulos, fijaBajoElRaton), "background")).toBe("var(--marca-tenue)");
    const clases = (selector: string) => (selector.match(/[.:](?!where)[\w-]+/g) ?? []).length;
    expect(clases(fijaBajoElRaton)).toBeGreaterThan(clases(fija));
    expect(leer("src/components/TablaDeAlternativas.tsx")).toMatch(/<TablaDeDatos[^>]*\bdeActivos\b/);
    /* La tabla de posiciones de Diseño, que no pasa por la pieza, ya iba en ese azul. */
    expect(valor(cuerpoDe(modulos, ".portfolio-table tbody tr:hover td"), "background")).toBe("var(--marca-tenue)");
  });

  test("la banda de un grupo no es una fila: bajo el ratón no cambia, ni en su celda fija", () => {
    /* Pesa más que el realce de toda fila y que el azul de las tablas de activos (una clase más), sin depender del orden. */
    expect(valor(cuerpoDe(tabla, ".tabla tbody tr.tabla__grupo:hover td"), "background")).toBe("var(--banda-fuerte)");
    expect(valor(cuerpoDe(tabla, ".tabla__grupo td"), "background")).toBe("var(--banda-fuerte)");
    /* En el Buscador, por debajo de 1.440 px, la primera celda es fija y pinta su fondo: la regla que la tiñe bajo el
       ratón deja fuera a la banda, y lo hace con `:where()`, que no pesa: la fila marcada para comparar le sigue ganando. */
    const estrecho = "screen and (max-width: 1439.98px)";
    expect(enMedia(tabla, estrecho, ".buscador-nuevo .tabla tbody tr:hover td:first-child")).toBeNull();
    expect(valor(enMedia(tabla, estrecho, ".buscador-nuevo .tabla__grupo td:first-child"), "background")).toBe("var(--banda-fuerte)");
    expect(valor(cuerpoDe(tabla, '.buscador-nuevo .tabla__marco .tabla tbody tr:has(.tabla__accion[aria-pressed="true"]) td'), "background")).toBe("var(--banda)");
  });
});

/* Guardas de la hoja, no la medición: happy-dom no pinta. Que las tres tarjetas queden a la misma altura y a qué
   distancia va cada cifra de su nombre lo midió una sonda en el navegador, ancho por ancho (apartado 14.8). Aquí se
   fija lo que la hoja tiene que seguir diciendo para que eso siga siendo verdad, y se fija la regla ENTERA, no una
   propiedad suelta: una declaración de más —un `gap`, un `margin-left: auto`, un `justify-content`— deshace el reparto
   sin tocar ninguna de las que ya estaban. Quien añada una a estas reglas, que mida antes con la sonda y la apunte aquí. */
describe("19-11-2026 · Crisis pasadas: las tres tarjetas a la misma altura y la cifra junto a su nombre (apartado 14.8 del sistema)", () => {
  const modulos = hoja("modules.css");
  const componente = leer("src/components/HistoricalStressCards.tsx");

  /** Las declaraciones de una regla, propiedad a valor: todas, también una última sin punto y coma. */
  const declaraciones = (cuerpo: string | null): Record<string, string> => {
    if (cuerpo === null) throw new Error("Esa regla no está en la hoja");
    return Object.fromEntries(cuerpo.split(";").map((trozo) => trozo.trim()).filter(Boolean).map((trozo) => {
      const corte = trozo.indexOf(":");
      return [trozo.slice(0, corte).trim(), normal(trozo.slice(corte + 1))];
    }));
  };
  /** La regla de la hoja con ese selector: la primera, que es la de fuera del corte (lo comprueba la última prueba). */
  const regla = (selector: string) => declaraciones(cuerpoDe(modulos, selector));

  /** El bloque `@media` de esa condición que lleva ese selector: en la hoja hay varios con la misma condición. */
  const bloqueCon = (condicion: string, selector: string) => {
    const limpio = sinComentarios(modulos);
    const marca = `@media ${condicion} {`;
    for (let desde = limpio.indexOf(marca); desde >= 0; desde = limpio.indexOf(marca, desde + 1)) {
      const bloque = bloqueMedia(limpio.slice(desde), condicion);
      if (cuerpoDe(bloque, selector) !== null) return bloque;
    }
    throw new Error(`Ningún @media ${condicion} lleva ${selector}`);
  };

  test("la rejilla reparte las filas y cada tarjeta las toma (`subgrid`), sin hueco entre filas", () => {
    /* Sin hueco entre filas: una que ninguna tarjeta ocupa (el motivo, si el episodio se calcula; el activo que más
       restó, en Modo cliente) no abre sitio. Con `gap`, cada fila vacía sumaría el suyo. */
    /* 24 px entre tarjetas desde el 20-11-2026 (Óscar; apartado 14.14, medido con la sonda en los seis anchos, en 1.380 y en 1.440). */
    expect(regla(".f5-stress-grid")).toEqual({ display: "grid", "grid-template-columns": "repeat(3, minmax(0, 1fr))", "column-gap": "var(--s-8)", "row-gap": "0" });
    /* Siete filas desde el 20-11-2026 —la séptima, la frase de las mismas fechas de la historia común—, las de la rejilla, y una columna que no crece con lo que lleva dentro: sin declararla sería `auto`,
       y una palabra larga sin espacios la ensancharía, con todas las piezas, hacia la tarjeta vecina. */
    expect(regla(".f5-stress-card")).toEqual({ display: "grid", "grid-template-columns": "minmax(0, 1fr)", "grid-template-rows": "subgrid", "grid-row": "span 7", "min-width": "0" });
    /* El aire entre las piezas de una tarjeta lo pone cada una con su margen, que pesa más que el `margin: 0` de la
       lista de cifras (una clase y un elemento contra una clase). */
    expect(regla(".f5-stress-card > :not(header)")).toEqual({ "margin-top": "var(--s-4)" });
  });

  test("cada pieza va a su fila: la cabecera, el motivo, las cifras en dos filas, el activo que más restó y los excluidos", () => {
    expect(regla(".f5-stress-card > header")).toEqual({ "grid-row": "1" });
    /* El motivo de que no haya datos, delante de las cifras y arriba de su fila: el grupo de estados vacíos lo
       centraría en una caja que aquí mide lo que el motivo más largo de las tres tarjetas. */
    expect(regla(".f5-stress-card > .f5-stress-no-data")).toEqual({ "grid-row": "2", "justify-content": "flex-start" });
    /* Lo que va en lugar de las cifras cuando el episodio no llega al 60 % lleva su clase, y ocupa el sitio de las
       cifras y el del activo que más restó, arriba y sin el relleno de arriba del grupo: su primera línea, a la altura
       de los rótulos de las cifras de sus vecinas. Pesa una clase más que la regla del motivo: no depende del orden. */
    expect(regla(".f5-stress-card > .f5-stress-no-data.f5-stress-sin-cifra")).toEqual({ "grid-row": "3 / span 3", "align-self": "start", "padding-top": "0" });
    expect(componente).toContain('className="f5-stress-no-data f5-stress-sin-cifra"');
    expect(regla(".f5-stress-card > .f5-stress-metrics")).toEqual({ "grid-row": "3 / span 2" });
    expect(regla(".f5-stress-card > .f5-stress-detail")).toEqual({ "grid-row": "5" });
    /* Los excluidos son el último detalle de la tarjeta: su regla pesa más que la del detalle. `last-of-type`, porque en la
       historia común detrás va la frase de las mismas fechas, que es un párrafo y va a la séptima fila (20-11-2026). */
    expect(regla(".f5-stress-card > .f5-stress-detail:last-of-type")).toEqual({ "grid-row": "6" });
    expect(regla(".f5-stress-card > .f5-stress-mismas-fechas")).toEqual({ "grid-row": "7", color: "var(--tinta-2)", "font-size": "var(--texto-xs)", "line-height": "var(--lh-snug)" });
    expect(componente).toContain('<p className="f5-stress-mismas-fechas">');
  });

  test("las dos filas de las cifras son también de la rejilla, y el aire entre ellas es un margen", () => {
    /* Como en la tarjeta: sin `gap` entre filas, para no depender de cómo trate cada navegador el de una rejilla que
       toma sus filas de otra. */
    expect(regla(".f5-stress-metrics")).toEqual({
      display: "grid", "grid-template-columns": "max-content minmax(0, 1.35fr) minmax(0, 1fr)", "grid-template-rows": "subgrid",
      "align-items": "start", "column-gap": "var(--s-5)", "row-gap": "0", margin: "0", "min-width": "0"
    });
    expect(regla(".f5-stress-metrics > div:nth-child(n + 4)")).toEqual({ "margin-top": "var(--s-5)" });
    /* La caída ocupa las dos filas; «Peso medido» es la cuarta pieza de la lista, y la única de la segunda fila. Si
       el orden de las cuatro cambia, el margen de la regla de arriba cae en otra. */
    expect(regla(".f5-stress-drop")).toEqual({ "grid-row": "span 2" });
    const lista = componente.match(/<dl className="f5-stress-metrics">([\s\S]*?)<\/dl>/)?.[1] ?? "";
    expect([...lista.matchAll(/<dt>([\s\S]*?)<\/dt>/g)].map((hallado) => hallado[1])).toEqual([
      '{maximo ? "Caída máxima" : "Caída"}', "Duración", "Recuperación", '{clientMode ? "Calculado sobre" : "Peso medido"}'
    ]);
  });

  test("una bajo otra, por debajo de 1.380 px, cada tarjeta vuelve a ser una columna y no comparte filas", () => {
    const estrecho = bloqueCon("(max-width: 1379.98px)", ".f5-stress-grid");
    expect(declaraciones(cuerpoDe(estrecho, ".f5-stress-grid"))).toEqual({ "grid-template-columns": "minmax(0, 1fr)", "row-gap": "var(--s-8)" });
    /* Sin `gap`: el aire entre piezas ya lo pone el margen de cada una, y con los dos saldría doble. */
    expect(declaraciones(cuerpoDe(estrecho, ".f5-stress-card"))).toEqual({ display: "flex", "flex-direction": "column", "grid-row": "auto" });
    /* Pesan lo mismo que las reglas de arriba y ganan por ir después: si el bloque sube, a 768 px habría tres columnas. */
    const limpio = sinComentarios(modulos);
    const dondeElBloque = limpio.indexOf(estrecho);
    for (const deFuera of [".f5-stress-grid {", ".f5-stress-card {"]) {
      expect(limpio.indexOf(deFuera)).toBeGreaterThan(-1);
      expect(dondeElBloque).toBeGreaterThan(limpio.indexOf(deFuera));
    }
  });

  test("el activo que más restó y su cifra: una fila que no los separa y que parte si no caben en una línea", () => {
    /* Ni rejilla con la cifra en el otro extremo, ni nada que la empuje allí: ni `justify-content` en la fila, ni
       un margen automático en la cifra, ni un nombre que crezca hasta ocupar la línea. */
    expect(regla(".f5-stress-detail > p")).toEqual({ display: "flex", "flex-wrap": "wrap", "align-items": "baseline", "column-gap": "var(--s-5)", "min-width": "0" });
    /* El nombre puede partir; la cifra, no. */
    expect(regla(".f5-stress-detail > p > strong")).toEqual({ "font-weight": "500", color: "var(--tinta)", "min-width": "0", "overflow-wrap": "break-word" });
    expect(regla(".f5-stress-detail > p > span")).toEqual({ "font-variant-numeric": "tabular-nums", "white-space": "nowrap" });
  });

  test("las reglas del bloque son estas y solo estas, en una sola hoja, y ninguna depende de `:has()`", () => {
    /* Todo selector que nombre una pieza del bloque, en cualquier hoja, con las veces que aparece. Las pruebas de
       arriba leen la primera regla de cada selector: una segunda más abajo, con otro valor, ganaría en la pantalla y
       aquí no se vería. La rejilla y la tarjeta están dos veces porque la segunda es la del corte de 1.380 px; las
       cuatro de `dt` y `dd`, porque comparten una regla y además llevan la suya. */
    const delBloque = HOJAS.flatMap((nombre) => reglasDe(hoja(nombre)).flatMap((unaRegla) => unaRegla.selectores.filter((selector) => selector.includes("f5-stress")).map((selector) => `${nombre} · ${selector}`)));
    const unaVez = [
      ".f5-stress-no-data",
      ".f5-stress-card > :not(header)", ".f5-stress-card > header", ".f5-stress-card > .f5-stress-no-data",
      ".f5-stress-card > .f5-stress-no-data.f5-stress-sin-cifra", ".f5-stress-card > .f5-stress-metrics",
      ".f5-stress-card > .f5-stress-detail", ".f5-stress-card > .f5-stress-detail:last-of-type", ".f5-stress-card > .f5-stress-mismas-fechas", ".f5-stress-card > header h3",
      ".f5-stress-metrics", ".f5-stress-metrics > div", ".f5-stress-metrics > div:nth-child(n + 4)", ".f5-stress-drop",
      ".f5-stress-detail > h4", ".f5-stress-detail > p", ".f5-stress-detail > p > strong", ".f5-stress-detail > p > span",
      ".f5-stress-detail > ul", ".f5-stress-detail > ul > li", ".f5-stress-detail > ul > li > span", ".f5-stress-detail > ul > li > small"
    ];
    const dosVeces = [".f5-stress-grid", ".f5-stress-card", ".f5-stress-metrics dt", ".f5-stress-metrics dd", ".f5-stress-drop dt", ".f5-stress-drop dd"];
    expect([...delBloque].sort()).toEqual([...unaVez, ...dosVeces, ...dosVeces].map((selector) => `modules.css · ${selector}`).sort());
    expect(delBloque.filter((selector) => selector.includes(":has("))).toEqual([]);
  });
});
