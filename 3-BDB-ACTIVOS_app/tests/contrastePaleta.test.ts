import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

/**
 * El contraste de la paleta, como puerta.
 *
 * Un color no llega a pantalla con un número al lado que diga si se lee. Se elige
 * mirándolo, y mirándolo sobre un monitor bueno a plena luz: `#8590a4` sobre
 * `#ffffff` **parece** un gris de nota perfectamente legible y da **3,22:1**, por
 * debajo del 4,5:1 que WCAG AA pide para texto normal.
 *
 * Pasó: ese valor es el que la dirección elegida escribió para la tinta terciaria, y
 * la tinta terciaria es la que lleva **la procedencia** —el principio 1 de esa misma
 * dirección, «nada se afirma sin decir quién lo dice y desde cuándo»—, los
 * encabezados de tabla y las cejas. Estuvo en pantalla en la ficha y en la tabla
 * hasta que se midió, el 03-11-2026.
 *
 * No hay exención por tamaño: los tres usos van a 11,5-12,5 px, y el texto grande
 * empieza en 18,66 px en negrita o 24 px normal.
 *
 * Esta puerta lee los valores del propio `tokens.css`, así que cubre también lo que
 * venga después: el día que la paleta de la dirección sustituya a la de toda la
 * aplicación, el par que no se lea falla aquí antes de llegar a nadie.
 */
const TOKENS = readFileSync(fileURLToPath(new URL("../src/styles/tokens.css", import.meta.url)), "utf8");

function token(nombre: string): string {
  const encaje = TOKENS.match(new RegExp(`^\\s*--${nombre}:\\s*(#[0-9a-fA-F]{6});`, "m"));
  if (!encaje) throw new Error(`El token --${nombre} no existe o no es un color literal`);
  return encaje[1];
}

/** Como `token`, pero sigue los alias: `--rail-active-ink: var(--marco)`. */
function colorDe(nombre: string): string {
  const encaje = TOKENS.match(new RegExp(`^\\s*--${nombre}:\\s*([^;]+);`, "m"));
  if (!encaje) throw new Error(`El token --${nombre} no existe`);
  const alias = encaje[1].trim().match(/^var\(--([\w-]+)\)$/);
  return alias ? colorDe(alias[1]) : encaje[1].trim();
}

/** Luminancia relativa (WCAG 2.x). */
function luminancia(hex: string): number {
  const canal = (i: number) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal(1) + 0.7152 * canal(3) + 0.0722 * canal(5);
}

function contraste(a: string, b: string): number {
  const [alta, baja] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (alta + 0.05) / (baja + 0.05);
}

/** Texto a 11,5-16 px: WCAG AA exige 4,5:1. Ninguno de estos es texto grande. */
const PARES_DE_TEXTO: [string, string, string][] = [
  ["la cifra y el texto principal", "tinta", "papel"],
  ["el rótulo, el de un campo y la nota", "tinta-2", "papel"],
  ["la procedencia, el encabezado de tabla y la ceja", "tinta-3", "papel"],
  ["la procedencia sobre la banda de grupo", "tinta-3", "banda-fuerte"],
  ["la procedencia sobre la fila bajo el cursor", "tinta-3", "banda"],
  /* MAR-07: sobre la fila elegida y bajo el ratón de una tabla escrita a mano, el apunte va en tinta 2 (tabla.css). */
  ["el apunte sobre la fila elegida", "tinta-2", "banda-fuerte"],
  ["el apunte bajo el ratón en una tabla escrita a mano", "tinta-2", "marca-tenue"],
  ["lo afirmativo", "marca", "papel"],
  ["el papel sobre lo afirmativo (botón)", "papel", "marca"],
  ["el signo de lo que sube", "sube", "papel"],
  ["lo que sube sobre su casilla", "sube", "sube-suave"],
  ["el signo de lo que baja, el error y la acción destructiva", "baja", "papel"],
  ["la acción destructiva bajo el ratón", "baja", "baja-suave"],
  ["el papel sobre la acción destructiva pulsada", "papel", "baja"],
  ["lo que pide atención: el aviso y el dato que falta", "aviso", "papel"],
  ["el aviso sobre su fondo", "aviso", "aviso-suave"],
  /* Dirección A (18-11-2026): el título de un aviso y la palabra de un distintivo de atención van en una tinta propia,
     más oscura que el ocre; el título de un error, en un rojo más hondo que el del signo. */
  ["el título de un aviso sobre su fondo", "aviso-enfasis", "aviso-suave"],
  ["un distintivo de atención sobre el papel", "aviso-enfasis", "papel"],
  ["un distintivo de atención sobre el lienzo (el «Estimado» del método de Análisis)", "aviso-enfasis", "lienzo"],
  ["el título de un error sobre su fondo", "baja-enfasis", "baja-suave"],
  ["el título de una nota, en tinta, sobre su fondo", "tinta", "marca-tenue"],
  ["el botón discreto de una tarjeta y el distintivo de marca, en el azul de enlace", "marca-fuerte", "papel"],
  ["el botón discreto de una tarjeta bajo el ratón", "marca", "marca-tenue"],
  ["el papel sobre el botón principal bajo el ratón", "papel", "marca-encima"],
  ["el papel sobre el botón principal pulsado", "papel", "marca-pulsada"],
  ["el apunte de una cifra y la descripción, en tinta 2, sobre el lienzo", "tinta-2", "lienzo"],
  /* El lienzo: la cabecera de página, la barra superior y lo que no es tarjeta van sobre él. */
  ["el título y el texto sobre el lienzo", "tinta", "lienzo"],
  ["el rótulo sobre el lienzo", "tinta-2", "lienzo"],
  ["la procedencia y la ceja sobre el lienzo", "tinta-3", "lienzo"],
  ["lo afirmativo sobre el lienzo", "marca", "lienzo"],
  ["el aviso sobre el lienzo («Cambios sin guardar», «Revisar seguridad»)", "aviso", "lienzo"],
  /* La fila elegida de una tabla (`tbody tr.is-selected`, components.css) va en --banda-fuerte desde el 18-11-2026,
     como en la lámina: antes era un azul propio, --marca-suave, que se retiró. Lleva las tintas de una celda (tabla.css). */
  ["el texto de la fila elegida", "tinta", "banda-fuerte"],
  ["el «no aplica» de la fila elegida", "tinta-3", "banda-fuerte"],
  ["el dato que falta en la fila elegida", "aviso", "banda-fuerte"],
  ["el «sin pedir» y el nombre bajo el ratón en la fila elegida", "marca", "banda-fuerte"],
  /* La fila bajo el ratón de una tabla de activos vuelve a --marca-tenue el 19-11-2026 (`.tabla--activos tbody tr:hover
     td`, tabla.css; apartado 14.7 del sistema): todo lo que se lee en esa fila, sobre ese azul. La que menos margen
     tiene es la cifra en verde. El nombre y la cifra van en tinta, que ya se mide arriba sobre ese fondo («el título de
     una nota»). Estos pares miden la paleta; que la fila use ese fondo lo vigila tests/hojasDelMarco.test.ts. */
  ["el ISIN y el «no aplica» bajo el ratón en una tabla de activos", "tinta-3", "marca-tenue"],
  ["lo que sube bajo el ratón en una tabla de activos", "sube", "marca-tenue"],
  ["lo que baja bajo el ratón en una tabla de activos", "baja", "marca-tenue"],
  ["el dato que falta bajo el ratón en una tabla de activos", "aviso", "marca-tenue"],
  ["el enlace bajo el ratón en una tabla de activos", "marca-fuerte", "marca-tenue"],
];

/* Las cifras del sistema, con dos decimales: si un valor se toca, la cifra que dicen tokens.css y el documento deja de
   ser cierta y esta prueba lo dice. Las de la dirección A (18-11-2026), calculadas aparte con la fórmula de WCAG 2.x;
   el verde y el rojo del signo no cambian (los copia el papel), sus fondos suaves sí. */
const CONTRASTES_DEL_SISTEMA: [string, string, number][] = [
  ["aviso", "papel", 6.78],
  ["aviso", "aviso-suave", 6.29],
  ["baja", "papel", 5.85],
  ["sube", "papel", 5.35],
  ["sube", "sube-suave", 4.72],
  ["baja", "baja-suave", 5.21],
  ["tinta-3", "lienzo", 5.37],
  /* Las piezas de la dirección A, calculadas aparte (scratchpad/contraste-piezas.mjs). */
  ["aviso-enfasis", "aviso-suave", 7.05],
  ["aviso-enfasis", "papel", 7.6],
  ["baja-enfasis", "baja-suave", 8.9],
  ["papel", "marca-encima", 13.48],
  ["papel", "marca-pulsada", 18.33]
];

describe("contraste de la paleta de la dirección elegida", () => {
  test.each(PARES_DE_TEXTO)("%s se lee (4,5:1)", (_que, tinta, fondo) => {
    const razon = contraste(token(tinta), token(fondo));
    expect(
      Number(razon.toFixed(2)),
      `--${tinta} sobre --${fondo} da ${razon.toFixed(2)}:1 (${token(tinta)} sobre ${token(fondo)})`
    ).toBeGreaterThanOrEqual(4.5);
  });

  test.each(CONTRASTES_DEL_SISTEMA)("--%s sobre --%s da %s:1, lo que dice el sistema", (tinta, fondo, esperado) => {
    expect(Number(contraste(token(tinta), token(fondo)).toFixed(2))).toBe(esperado);
  });

  /* MAR-07: con la paleta anterior la tinta 3 no se leía sobre la fila elegida (4,14:1), y por eso la hoja cambia el
     apunte a la tinta 2 ahí y bajo el ratón. Con la del diseño «Nuevo» ya llegaba (4,72:1) y con la de la dirección A,
     sobre la banda fuerte, también (5,05:1), con poco margen: la regla se queda, y la tinta 2 da margen. */
  test("sobre la fila elegida el apunte cambia a la tinta 2, que se lee con margen", () => {
    expect(contraste(token("tinta-2"), token("banda-fuerte"))).toBeGreaterThan(contraste(token("tinta-3"), token("banda-fuerte")));
    const TABLA = readFileSync(fileURLToPath(new URL("../src/styles/tabla.css", import.meta.url)), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const regla = TABLA.match(/tbody tr\.is-selected \.tabla__apunte,\s*tbody tr:hover \.tabla__apunte\s*\{([^}]*)\}/);
    expect(regla?.[1]).toContain("color: var(--tinta-2)");
  });

  test("la terracota se retiró: ni su color ni sus tokens quedan en la paleta", () => {
    expect(TOKENS.toLowerCase()).not.toContain("#8c3a2b");
    expect(TOKENS).not.toMatch(/--(negative|warning|ficha-baja)[\w-]*\s*:/);
  });

  /* WCAG 1.4.11: lo que hace reconocible un control pide 3:1, y es un trazo, no texto. El
     borde de los campos era el mismo filete que separa secciones, 1,64:1, y las casillas sin
     marcar y las cajas de Peso e Importe casi se perdían. */
  test("el borde de un control se reconoce (3:1), y al pasar el ratón no se apaga", () => {
    const papel = colorDe("papel");
    const borde = contraste(colorDe("borde-control"), papel);
    expect(Number(borde.toFixed(2))).toBeGreaterThanOrEqual(3);
    /* Bajo el ratón el borde pasa a la tinta 2 (components.css): oscurece, no aclara. */
    expect(contraste(colorDe("tinta-2"), papel)).toBeGreaterThan(borde);
  });

  test("el filete entre filas sigue siendo un filete: no se mueve con el borde de los controles", () => {
    expect(token("filete")).toBe("#e4ddcf");
    expect(token("filete-fuerte")).toBe("#d9d2c3");
    expect(token("borde-control")).not.toBe(token("filete-fuerte"));
  });

  /* El marco (hallazgos 4, 123 y 138 de la auditoría del 04-11-2026). Desde la dirección A (18-11-2026) el menú es
     marino y usa las tintas de tokens.css, que son las de ese fondo; la barra superior va sobre el lienzo y layout.css le
     da sus tintas claras sobre los mismos nombres de token (`--rail-ink`…). Se mide cada pareja y se comprueba que la hoja
     la usa, porque una tinta buena en los tokens no vale de nada si la regla pinta otra: así estuvo «Salir» en 1,86:1
     sobre la barra oscura de antes. */
  describe("el marco: menú y barra superior", () => {
    const LAYOUT = readFileSync(fileURLToPath(new URL("../src/styles/layout.css", import.meta.url)), "utf8").replace(
      /\/\*[\s\S]*?\*\//g,
      ""
    );
    const bloque = (selector: string) => {
      const desde = LAYOUT.indexOf(`${selector} {`);
      if (desde < 0) throw new Error(`layout.css no tiene la regla ${selector}`);
      return LAYOUT.slice(desde, LAYOUT.indexOf("}", desde));
    };
    const barra = bloque(".app-topbar");
    const menu = bloque(".app-rail");
    /* El valor de una tinta de la barra: el token al que la apunta layout.css. */
    const deLaBarra = (nombre: string) => {
      const apunta = barra.match(new RegExp(`--${nombre}:\\s*var\\(--([\\w-]+)\\)`))?.[1];
      if (!apunta) throw new Error(`layout.css no da valor a --${nombre} en la barra superior`);
      return colorDe(apunta);
    };
    /* Un fondo translúcido sobre el marino, como lo pinta el navegador: canal a canal y redondeado a entero. */
    const sobreElMarino = (nombre: string) => {
      const rgba = colorDe(nombre).match(/^rgba\(\s*(\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\s*\)$/);
      if (!rgba) throw new Error(`--${nombre} no es un rgba`);
      const marino = colorDe("marco");
      const alfa = Number(rgba[4]);
      return (
        "#" +
        [1, 3, 5]
          .map((i, k) => Math.round(parseInt(marino.slice(i, i + 2), 16) * (1 - alfa) + Number(rgba[k + 1]) * alfa))
          .map((canal) => canal.toString(16).padStart(2, "0"))
          .join("")
      );
    };

    test("la barra se da tintas claras y el menú es marino con las de tokens.css", () => {
      expect(barra).toContain("--rail-ink: var(--tinta-2)");
      expect(barra).toContain("background: var(--lienzo)");
      expect(menu).toContain("background: var(--marco)");
      /* Si el menú redefiniera una tinta, lo medido aquí no sería lo que pinta. */
      expect(menu).not.toMatch(/--rail-[\w-]+\s*:/);
    });

    /* No basta con la primera regla `.app-rail {`: cualquier regla del menú, también dentro de un @media, podría
       redefinir una tinta `--rail-*` y pintar otra cosa que la medida. Se barren todas las reglas de layout.css cuyo
       selector apunta al menú. No hay excepciones: la única que da valor a `--rail-*` es la barra superior
       (`.app-topbar`), que no es el menú, y `.app-shell[data-rail=…]`, que da el ancho (`--rail-w`) y no apunta al menú. */
    test("ninguna regla del menú en layout.css redefine una tinta --rail-*", () => {
      const reglasDelMenu = [...LAYOUT.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
        .map(([, selector, cuerpo]) => ({ selector: selector.trim(), cuerpo }))
        .filter(({ selector }) => /\.app-rail|\.rail-/.test(selector));
      /* Un barrido que no ve reglas no protege nada. */
      expect(reglasDelMenu.length).toBeGreaterThan(5);
      expect(reglasDelMenu.map(({ selector }) => selector)).toContain(".app-rail");
      const queRedefinen = reglasDelMenu.filter(({ cuerpo }) => /--rail-[\w-]+\s*:/.test(cuerpo)).map(({ selector }) => selector);
      expect(queRedefinen).toEqual([]);
    });

    test.each([
      ["«Salir», el correo y la miga, sobre la barra", "rail-ink", "lienzo"],
      ["lo de dentro del recuadro de la propuesta", "rail-ink", "papel"],
      ["el nombre de la propuesta y la página en curso", "rail-ink-active", "lienzo"],
      ["el rótulo de lo que sigue en la barra", "rail-ink-label", "lienzo"]
    ])("%s se lee (4,5:1)", (_que, tinta, fondo) => {
      const razon = contraste(deLaBarra(tinta), colorDe(fondo));
      expect(Number(razon.toFixed(2)), `--${tinta} da ${razon.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    });

    test("el recuadro de la propuesta y la pista del interruptor se reconocen sobre el papel (3:1)", () => {
      expect(contraste(deLaBarra("rail-chip-line"), colorDe("papel"))).toBeGreaterThanOrEqual(3);
      expect(contraste(deLaBarra("rail-switch-track"), colorDe("papel"))).toBeGreaterThanOrEqual(3);
    });

    /* El menú marino. Las cifras, con dos decimales y calculadas aparte con la fórmula de WCAG 2.x: son las que dice
       tokens.css. La entrada activa y la que está bajo el ratón llevan un blanco translúcido sobre el marino. */
    test.each([
      ["una entrada del menú", "rail-ink", () => colorDe("marco"), 13.2],
      ["el rótulo de un grupo, los iconos y el cargo", "rail-ink-label", () => colorDe("marco"), 7.58],
      ["el nombre de la marca y el de quien entra", "rail-ink-marca", () => colorDe("marco"), 14.6],
      ["el rótulo del grupo en el que se está, en latón claro", "rail-marker", () => colorDe("marco"), 7.3],
      ["una entrada del menú bajo el ratón", "rail-ink-active", () => sobreElMarino("rail-hover"), 14.67],
      ["la entrada activa del menú", "rail-active-ink", () => sobreElMarino("rail-active"), 13.36],
      ["el icono de la entrada activa, en latón claro", "rail-marker", () => sobreElMarino("rail-active"), 5.82]
    ])("%s se lee sobre el marino (4,5:1)", (_que, tinta, fondo, esperado) => {
      const razon = contraste(colorDe(tinta), fondo());
      expect(Number(razon.toFixed(2)), `--${tinta} da ${razon.toFixed(2)}:1`).toBe(esperado);
      expect(razon).toBeGreaterThanOrEqual(4.5);
    });

    /* El filete latón y el anillo de foco son trazos: 3:1 sobre el marino y sobre la entrada activa. El filete es un
       seudoelemento, no una sombra, para que el anillo (un box-shadow) no lo pise ni lo borre. */
    test("el filete latón de la entrada activa y el anillo de foco se ven sobre el marino (3:1)", () => {
      const activa = sobreElMarino("rail-active");
      expect(Number(contraste(colorDe("laton"), colorDe("marco")).toFixed(2))).toBe(4.75);
      expect(Number(contraste(colorDe("laton"), activa).toFixed(2))).toBe(3.79);
      expect(Number(contraste(colorDe("rail-ink"), activa).toFixed(2))).toBe(10.53);
      expect(LAYOUT).toMatch(/\.rail-link\.active::before\s*\{[^}]*background: var\(--laton\)/);
      expect(LAYOUT).toMatch(/\.rail-link:focus-visible\s*\{\s*box-shadow: var\(--focus-ring-dark-inset\);/);
      expect(bloque(".rail-link.active,\n.rail-link.active:hover:not([aria-disabled=\"true\"])")).not.toContain("box-shadow");
    });

    test.each([
      [".app-topbar .ui-button--quiet", "--rail-ink"],
      [".topbar-account__aviso", "--aviso"],
      [".topbar-chip__estado", "--aviso"],
      [".app-topbar .badge.is-warn", "--aviso"]
    ])("%s pinta con %s", (selector, tinta) => {
      const desde = LAYOUT.indexOf(`${selector} {`);
      expect(desde, selector).toBeGreaterThan(-1);
      expect(LAYOUT.slice(desde, LAYOUT.indexOf("}", desde))).toContain(`color: var(${tinta})`);
    });

    /* El aviso emergente (.mensaje) sigue siendo oscuro y usa las tintas de tokens.css. */
    test("la cruz del aviso emergente se lee sobre su fondo oscuro", () => {
      expect(contraste(colorDe("rail-ink"), colorDe("marco"))).toBeGreaterThanOrEqual(4.5);
    });
  });

  /* El foco (hallazgo 86): un solo anillo. Era el azul retirado, con transparencia, y en una casilla
     marcada se quedaba en 1,38:1. Un anillo es un trazo, así que pide 3:1. Desde la dirección A va en el
     azul de enlace (--marca-fuerte), no en el marino del botón principal (--marca). */
  describe("el anillo de foco", () => {
    const COMPONENTES = readFileSync(fileURLToPath(new URL("../src/styles/components.css", import.meta.url)), "utf8");

    test("va en el azul de enlace sobre el papel, y en la tinta clara sobre la barra", () => {
      expect(TOKENS).toMatch(/--focus-ring: 0 0 0 2px var\(--papel\), 0 0 0 4px var\(--marca-fuerte\);/);
      expect(TOKENS).toMatch(/--focus-ring-inset: inset 0 0 0 2px var\(--marca-fuerte\);/);
      expect(TOKENS).toMatch(/--focus-ring-dark: 0 0 0 2px var\(--marco\), 0 0 0 4px var\(--rail-ink\);/);
      expect(contraste(colorDe("marca-fuerte"), colorDe("papel"))).toBeGreaterThanOrEqual(3);
      expect(contraste(colorDe("rail-ink"), colorDe("marco"))).toBeGreaterThanOrEqual(3);
    });

    test("no queda el halo de los campos, y casillas y radios llevan el mismo anillo", () => {
      expect(TOKENS).not.toContain("--focus-glow");
      expect(COMPONENTES).not.toContain("--focus-glow");
      expect(COMPONENTES).toMatch(/input:focus-visible,\s*select:focus-visible,\s*textarea:focus-visible\s*\{[^}]*box-shadow: var\(--focus-ring\)/);
    });

    /* Dirección A (18-11-2026): la opción elegida de un selector es marina, y sobre ella el azul del anillo no se ve
       (1,69:1). Va por dentro igual, pero con un filete de papel delante, que sobre el marino da 16,75:1. */
    test("en un selector va por dentro del marco, que recortaría el de fuera, y con un filete de papel que se ve sobre la opción elegida", () => {
      expect(COMPONENTES).toMatch(/\.ui-segmented__button:focus-visible\s*\{\s*box-shadow: var\(--focus-ring-inset-doble\)/);
      expect(TOKENS).toMatch(/--focus-ring-inset-doble: inset 0 0 0 2px var\(--papel\), inset 0 0 0 4px var\(--marca-fuerte\);/);
      expect(COMPONENTES).toMatch(/\.ui-segmented__button\.active\s*\{[^}]*background:\s*var\(--marca\);/);
      expect(contraste(colorDe("papel"), colorDe("marca"))).toBeGreaterThanOrEqual(3);
      expect(contraste(colorDe("marca-fuerte"), colorDe("papel"))).toBeGreaterThanOrEqual(3);
    });

    /* Con contraste forzado el navegador quita las sombras, y el anillo es una sombra: sin un
       contorno real, el foco desaparece. */
    test("con contraste forzado es un contorno real", () => {
      const BASE = readFileSync(fileURLToPath(new URL("../src/styles/base.css", import.meta.url)), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      expect(BASE).toMatch(/@media \(forced-colors: active\)\s*\{\s*:focus-visible\s*\{\s*outline: 2px solid Highlight !important;/);
    });
  });

  /* Lo que esta puerta NO comprueba, y conviene que conste: si el índigo y el
     ocre del aviso se distinguen ENTRE SÍ (con la terracota, que era la de antes, daba 1,32:1). Se intentó con el cociente de contraste y
     dio 1,32:1, que parecía un suspenso y no lo es: el cociente mide luminancia,
     y esos dos son igual de oscuros a propósito —uno afirma y otro avisa, ninguno
     grita más que el otro—. Lo que los separa es el tono, y eso se mide con una
     diferencia perceptual en un espacio uniforme, no con WCAG. Cuando haga falta
     —el día que entren en un gráfico, uno al lado del otro— se mide con el
     validador de paletas de `dataviz`, que además comprueba las tres formas de
     daltonismo. Aquí se dejaría una cifra que no dice lo que parece decir. */
});
