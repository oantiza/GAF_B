import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

/**
 * Lo que las piezas comunes prometen, y que una hoja puede romper sin que nada falle.
 *
 * En CSS, una regla que pierde contra otra no da error: el 04-11-2026 el título de cada columna
 * de cifras salía a la izquierda en todas las tablas, con la intención escrita en el componente,
 * porque `.tabla th` pesa más que `.tabla__celda--cifra`. Aquí se comprueba lo que se decidió.
 */
const RAIZ = fileURLToPath(new URL("..", import.meta.url));
const hoja = (nombre: string) => readFileSync(join(RAIZ, "src", "styles", nombre), "utf8");
const sinComentarios = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, "");

function reglaDe(css: string, selector: string): string {
  const limpio = sinComentarios(css);
  const donde = limpio.search(new RegExp(`(^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{`));
  if (donde < 0) throw new Error(`No hay regla para ${selector}`);
  return limpio.slice(donde, limpio.indexOf("}", donde));
}

function ficherosDe(carpeta: string, salida: string[] = []): string[] {
  for (const entrada of readdirSync(carpeta, { withFileTypes: true })) {
    const ruta = join(carpeta, entrada.name);
    if (entrada.isDirectory()) ficherosDe(ruta, salida);
    else salida.push(ruta);
  }
  return salida;
}

describe("la cifra destacada", () => {
  /* Dirección A (18-11-2026): la cifra de `KpiStrip` pasa de Plex a 30 px a la serifa a 32/36, como la de la banda de
     Análisis (`.respuesta__cifra`): la serifa es la de la cifra de un indicador. */
  test("32 px en la serifa de la cifra de un indicador, el peso de los títulos, y tinta, con cualquier signo", () => {
    expect(hoja("tokens.css")).toMatch(/--cifra-indicador:\s*2rem;/);
    const cifra = reglaDe(hoja("components.css"), ".ui-kpi__value");
    expect(cifra).toContain("font-size: var(--cifra-indicador)");
    expect(cifra).toContain("font-family: var(--fuente-serifa)");
    expect(cifra).toContain("line-height: 1.125");
    expect(cifra).toContain("font-weight: var(--peso-titulo)");
    expect(cifra).toContain("color: var(--tinta)");
    expect(sinComentarios(hoja("components.css"))).not.toMatch(/\.ui-kpi__value\.(pos|neg)/);
  });

  /* 18-11-2026. «1.234.567 €» se partía en dos líneas en Comparador › Patrimonial a 1.920: allí la columna mide 163 px
     y el importe, a 32 px, 163,17 (medido en la pantalla; en la rama principal, con columnas de 171,7 px, cabía). La
     medida que no se puede leer de la hoja es el ancho del importe en la serifa de la cifra: 163,17 / 32 = 5,099 em.
     Lo demás se lee, y la prueba vigila las tres condiciones que hacen que quepa, no un número: si cambian el tamaño
     de la cifra, el umbral o el porcentaje, tienen que seguir cumpliéndose. Con los valores de hoy (32 px, 168 px y
     19 %): 5,099 × 0,19 = 0,969; 5,099 × 32 = 163,17 < 168; y 0,19 × 168 = 31,92 ≤ 32. */
  test("en una tira de importes la cifra mengua antes, y un importe de siete cifras cabe en cualquier columna", () => {
    const EM_DE_SIETE_CIFRAS = 5.099;
    const css = sinComentarios(hoja("components.css"));
    const regla = css.match(/@container \(max-width: ([\d.]+)rem\)\s*\{\s*\.ui-kpi-strip--importes \.ui-kpi__value:not\(\.ui-kpi__value--text\)\s*\{\s*font-size: ([\d.]+)cqi;\s*\}\s*\}/);
    expect(regla).not.toBeNull();
    const umbralEnPx = Number(regla![1]) * 16;
    const parteDeLaColumna = Number(regla![2]) / 100;
    /* El tamaño de la cifra, de su token: la regla de la cifra lo usa, y aquí se cuenta con él. */
    expect(reglaDe(hoja("components.css"), ".ui-kpi__value")).toContain("font-size: var(--cifra-indicador)");
    const cifraEnPx = Number(hoja("tokens.css").match(/--cifra-indicador:\s*([\d.]+)rem;/)![1]) * 16;
    /* 1. Por debajo del umbral la cifra mide una parte del ancho de su columna, y el importe, 5,099 veces eso: menos que la columna. */
    expect(EM_DE_SIETE_CIFRAS * parteDeLaColumna).toBeLessThan(1);
    /* 2. Por encima del umbral la cifra va a su tamaño entero, y el importe mide menos que la columna más estrecha de ese tramo. */
    expect(EM_DE_SIETE_CIFRAS * cifraEnPx).toBeLessThan(umbralEnPx);
    /* 3. Al cruzar el umbral la cifra no da un salto: ni crece por encima de su tamaño ni baja más de medio píxel. */
    expect(parteDeLaColumna * umbralEnPx).toBeLessThanOrEqual(cifraEnPx);
    expect(parteDeLaColumna * umbralEnPx).toBeGreaterThan(cifraEnPx - 0.5);
    /* La regla de todas las tiras no cambia: el 21 % por debajo de 152 px, que es lo que pide un porcentaje. */
    expect(css).toMatch(/@container \(max-width: 9\.5rem\)\s*\{\s*\.ui-kpi__value:not\(\.ui-kpi__value--text\)\s*\{\s*font-size: 21cqi;\s*\}\s*\}/);
  });

  test("el texto cualitativo a 16 px", () => {
    expect(reglaDe(hoja("components.css"), ".ui-kpi__value--text")).toContain("font-size: var(--texto-lg)");
    /* El tono «afirma» (índigo, para «Sin pedir») se quedó sin nadie que lo pidiera al rediseñar las pantallas: su
       regla se borró con la limpieza del 14-11-2026 y no vuelve sin alguien que la use. */
    expect(sinComentarios(hoja("components.css"))).not.toMatch(/\.ui-kpi__value\.afirma/);
  });
});

describe("la cabecera de una sección es la de la ficha (decisión 24)", () => {
  /* Dirección A (18-11-2026): el título de una tarjeta baja de 18 a 15 px, con 20 de interlínea, y sigue en la letra de
     los títulos (Plex), no en la serifa, que es solo del título de pantalla y de la cifra de un indicador. */
  test("título en tinta, 15 px con 20 de interlínea, en la letra y el peso de los títulos", () => {
    expect(hoja("tokens.css")).toMatch(/--texto-ml:\s*0\.9375rem;/);
    const titulo = reglaDe(hoja("components.css"), ".panel__title");
    expect(titulo).toContain("font-family: var(--fuente-titulos)");
    expect(titulo).toContain("font-size: var(--texto-ml)");
    expect(titulo).toContain("line-height: 1.3333");
    expect(titulo).toContain("font-weight: var(--peso-titulo)");
    expect(titulo).toContain("color: var(--tinta)");
    expect(titulo).not.toContain("--fuente-serifa");
  });

  test("la procedencia, a 12 px con 16 de interlínea", () => {
    expect(hoja("tokens.css")).toMatch(/--texto-xxs:\s*0\.75rem;/);
    const procedencia = reglaDe(hoja("components.css"), ".panel__subtitle");
    expect(procedencia).toContain("font-size: var(--texto-xxs)");
    expect(procedencia).toContain("line-height: 1.3333");
  });

  test("sin filete debajo (el bloque es una tarjeta) y la procedencia en la tinta 3", () => {
    expect(reglaDe(hoja("components.css"), ".panel__head")).toContain("border-bottom: 0");
    expect(reglaDe(hoja("components.css"), ".panel__subtitle")).toContain("color: var(--tinta-3)");
  });

  test("la ficha y Panel leen el mismo valor", () => {
    expect(reglaDe(hoja("ficha.css"), ".ficha__titulo")).toContain("font-size: var(--texto-ml)");
  });

  test("no queda ningún trazo azul bajo un título, ni en la pieza ni en las cabeceras a mano", () => {
    /* Medido antes de quitarlo: 3 reglas pintaban ese trazo de 36 x 2 px. Una que vuelva, aunque
       sea en una sola pantalla, es otra vez «parecen dos aplicaciones». */
    const css = sinComentarios(hoja("components.css")) + sinComentarios(hoja("modules.css"));
    expect(css).not.toMatch(/::after\s*\{[^}]*width: 36px[^}]*\}/);
    expect(sinComentarios(hoja("components.css"))).not.toMatch(/\.panel__head::after/);
  });

  test("ningún título de sección queda en índigo", () => {
    const css = sinComentarios(hoja("components.css")) + sinComentarios(hoja("modules.css"));
    for (const selector of [".panel__title", ".ui-page-header--section h2"]) {
      expect(reglaDe(css, selector)).not.toContain("--marca");
    }
    /* MAR-32: los títulos de los costes son `h3` desde el 14-11-2026, y la regla los viste con esa etiqueta. */
    expect(css).toMatch(/\.costs-section-heading h3 \{/);
    expect(css).not.toMatch(/\.costs-section-heading h3 \{[^}]*--marca/);
  });
});

describe("el título de una columna de cifras va sobre sus cifras", () => {
  test("en la tabla del sistema", () => {
    expect(sinComentarios(hoja("tabla.css"))).toMatch(
      /\.tabla th\.tabla__celda--cifra,\s*\.tabla th\.tabla__celda--acciones\s*\{\s*text-align: right;/
    );
  });

  test("en la tabla de la ficha", () => {
    expect(sinComentarios(hoja("ficha.css"))).toMatch(/\.ficha__tabla th\.ficha__celda--cifra\s*\{\s*text-align: right;/);
  });

  test("la primera y la última columna de cualquier tabla van a ras", () => {
    const css = sinComentarios(hoja("components.css"));
    expect(css).toMatch(/thead th:first-child,\s*tbody td:first-child,\s*tfoot th:first-child,\s*tfoot td:first-child\s*\{\s*padding-left: 0;/);
    expect(css).toMatch(/thead th:last-child,\s*tbody td:last-child,\s*tfoot th:last-child,\s*tfoot td:last-child\s*\{\s*padding-right: 0;/);
  });
});

describe("el ocre de serie no es el del aviso", () => {
  /* La regla: todo aviso en el ocre del aviso (--aviso) y con su palabra. El ocre de serie
     (--ochre-50) es otro, más claro, y solo puede vivir donde pinta una serie. */
  test("en las hojas, solo la serie de contribución negativa lo usa", () => {
    const usos = ["base", "layout", "components", "charts", "modules", "ficha", "tabla"].flatMap((nombre) =>
      sinComentarios(hoja(`${nombre}.css`))
        .split("\n")
        .filter((linea) => linea.includes("--ochre"))
    );
    expect(usos).toEqual(["  background: var(--ochre-50);"]);
    expect(reglaDe(hoja("modules.css"), ".f5-risk-swatch-negative,\n.f5-risk-bar-negative")).toContain("--ochre-50");
  });

  test("en el código, solo lo usan los gráficos", () => {
    const usan = ficherosDe(join(RAIZ, "src"))
      .filter((ruta) => /\.tsx?$/.test(ruta) && !/[\\/]reports[\\/]/.test(ruta) && !ruta.endsWith("theme.ts"))
      .filter((ruta) => /--ochre|OAA_COLORS\.gold/.test(readFileSync(ruta, "utf8")))
      .map((ruta) => relative(join(RAIZ, "src"), ruta).replace(/\\/g, "/"))
      .sort();
    /* Paso 2 del rediseño: el mapa de riesgo y rentabilidad dejó de usarlo (la línea de las carteras de referencia es
       gris y a trazos). Las dos pantallas que lo pasaban a mano, la comparativa de Simular y el panel de la
       simulación, lo quitaron al rediseñarse Diseño: ya no lo usa ninguna. */
    expect(usan).toEqual([]);
  });

  test("un aviso con filete va en el ocre del aviso, y un error en el rojo", () => {
    /* El aviso y el error los dice la pieza `Aviso` con su tono; la clase `.notice`, que se escribía a mano, se borró con
       su último uso (MAR-21). */
    expect(hoja("components.css").replace(/\/\*[\s\S]*?\*\//g, "")).not.toMatch(/\.notice\b/);
    expect(reglaDe(hoja("components.css"), ".aviso--error")).toContain("var(--baja-linea)");
    expect(reglaDe(hoja("components.css"), ".aviso--aviso")).toContain("var(--aviso-linea)");
    /* El ocre del aviso de la dirección A (18-11-2026): 6,78:1 sobre el papel. */
    expect(hoja("tokens.css")).toMatch(/--aviso:\s*#8a4b14;/);
    expect(hoja("tokens.css")).not.toMatch(/#8c3a2b/);
  });
});

describe("el ancho de la prosa", () => {
  test("notas y subtítulos a 38 em, avisos con filete a 62", () => {
    expect(reglaDe(hoja("components.css"), ".panel__subtitle")).toContain("max-width: 38em");
    expect(reglaDe(hoja("components.css"), ".ui-page-header__description")).toContain("max-width: 38em");
    expect(reglaDe(hoja("components.css"), ".field__hint")).toContain("max-width: 38em");
    expect(reglaDe(hoja("components.css"), ".aviso")).toContain("max-width: 62em");
    // El último nombre del bloque de notas: la regla es la de los quince.
    expect(reglaDe(hoja("modules.css"), ".risk-profile-disclaimer")).toContain("max-width: 38em");
  });
});

describe("el margen de la página", () => {
  /* Trampa 4 de la guía: el relleno de caja sobrevive a la caja. Sin borde ni fondo no hay contra
     qué respirar, y lo único que hace es sacar el contenido del margen de la página. */
  test.each([
    [".ficha", "ficha.css"],
    /* `.xray-comp` y `.portfolio-report-panel` desaparecieron al rediseñar Análisis e Informes: sus páginas son ahora
       `.analisis` e `.informes`, que comparten regla. */
    [".analisis,\n.informes", "analisis.css"],
    [".admin-tab-panel", "modules.css"],
    [".f5-analytics-panel", "modules.css"],
    [".wealth-comparison-results", "modules.css"]
  ])("%s no lleva relleno", (selector, fichero) => {
    expect(reglaDe(hoja(fichero), selector)).not.toMatch(/padding/);
  });

  /* Dirección A (18-11-2026): 28 px entre pestañas, y 20 en la tableta de pie, donde con 28 la sexta de Análisis bajaba
     sola a otra fila. */
  test("las pestañas van a ras, con el aire en el hueco", () => {
    expect(reglaDe(hoja("components.css"), ".ui-tab")).toContain("padding: 0;");
    expect(reglaDe(hoja("components.css"), ".ui-tabs")).toContain("gap: 0 calc(var(--s-8) + var(--s-2))");
    expect(sinComentarios(hoja("components.css"))).toMatch(/@media \(max-width: 899\.98px\) \{\s*\.ui-tabs \{\s*gap: 0 var\(--s-7\);/);
  });
});

/* La dirección A («Banca privada, puesta al día»), llevada a las piezas el 18-11-2026. Lo que se decidió sobre la
   vista previa y que una hoja puede deshacer sin que nada falle. */
describe("dirección A · las piezas comunes", () => {
  const componentes = hoja("components.css");
  const tokens = hoja("tokens.css");

  test("la cabecera de pantalla: título en la serifa a 40 px, antetítulo en versalitas y doble filete de tinta y latón", () => {
    expect(tokens).toMatch(/--titulo-lg:\s*2\.5rem;/);
    const titulo = reglaDe(componentes, ".ui-page-header h1");
    expect(titulo).toContain("font-family: var(--fuente-serifa)");
    expect(titulo).toContain("font-size: var(--titulo-lg)");
    expect(titulo).toContain("line-height: 1.15");
    expect(titulo).toContain("font-feature-settings: normal");
    const cabecera = reglaDe(componentes, "header.ui-page-header");
    /* Los dos filetes separados por 2 px de lienzo, como en la lámina (18-11-2026): el latón es el borde y la tinta, una
       sombra interior 3 px por encima. Pegados se leían como una sola raya gruesa. */
    expect(cabecera).toContain("border-bottom: 1px solid var(--laton)");
    expect(cabecera).toContain("box-shadow: inset 0 -2px 0 var(--lienzo), inset 0 -3px 0 var(--tinta)");
    const antetitulo = reglaDe(componentes, ".ui-page-header .ui-eyebrow");
    expect(antetitulo).toContain("text-transform: uppercase");
    expect(antetitulo).toContain("font-size: var(--texto-xxs)");
    /* Las versalitas son solo de la cabecera de pantalla: el antetítulo de un bloque sigue como estaba. */
    expect(reglaDe(componentes, ".ui-eyebrow,\n.section-label")).not.toMatch(/text-transform|letter-spacing: 0\.08em/);
    /* La subvista no lleva ni la serifa ni el doble filete. */
    const subvista = reglaDe(componentes, "header.ui-page-header--section");
    expect(subvista).toContain("border-bottom: 0");
    expect(subvista).toContain("box-shadow: none");
    expect(reglaDe(componentes, ".ui-page-header--section h2")).not.toContain("--fuente-serifa");
  });

  test("en la tableta de pie las acciones de la cabecera bajan bajo la descripción", () => {
    expect(sinComentarios(componentes)).toMatch(
      /@media \(max-width: 899\.98px\) \{\s*header\.ui-page-header \{\s*grid-template-columns: minmax\(0, 1fr\);\s*\}\s*\.ui-page-header > \.ui-action-toolbar \{\s*grid-area: 4 \/ 1;/
    );
  });

  test("el botón principal va en el marino de la marca, y bajo el ratón y pulsado, en los suyos", () => {
    expect(reglaDe(componentes, ".ui-button--primary")).toContain("background: var(--marca)");
    expect(reglaDe(componentes, ".ui-button--primary:hover:not(:disabled)")).toContain("background: var(--marca-encima)");
    expect(reglaDe(componentes, ".ui-button--primary:active:not(:disabled)")).toContain("background: var(--marca-pulsada)");
    expect(tokens).toMatch(/--marca:\s*#0f1e33;/);
    expect(tokens).toMatch(/--marca-encima:\s*#1a2f4d;/);
    expect(tokens).toMatch(/--marca-pulsada:\s*#0a1524;/);
  });

  test("la pestaña elegida lleva el filete marino, y las pestañas, el filete fuerte debajo", () => {
    expect(reglaDe(componentes, ".ui-tab.active::after")).toContain("background: var(--marca)");
    expect(reglaDe(componentes, ".ui-tabs")).toContain("border-bottom: 1px solid var(--filete-fuerte)");
    expect(reglaDe(componentes, ".ui-tab")).toContain("font-weight: 400");
    expect(reglaDe(componentes, ".ui-tab.active")).toContain("font-weight: 600");
  });

  test("una tarjeta lleva su sombra mínima, y un panel dentro de otro, ninguna", () => {
    expect(tokens).toMatch(/--sombra-tarjeta:\s*0 1px 2px rgba\(28, 26, 23, 0\.04\);/);
    expect(reglaDe(componentes, ".panel")).toContain("box-shadow: var(--sombra-tarjeta)");
    expect(reglaDe(componentes, ".panel .panel,\n.ui-dialog .panel")).toContain("box-shadow: none");
  });

  test("el título de un aviso va en la tinta de su tono, y el de una nota, en tinta", () => {
    expect(reglaDe(componentes, ".aviso__titulo")).toContain("color: var(--aviso-enfasis)");
    expect(reglaDe(componentes, ".aviso--nota .aviso__titulo")).toContain("color: var(--tinta)");
    expect(reglaDe(componentes, ".aviso--error .aviso__titulo,\n.aviso.async-error-banner .aviso__titulo")).toContain("color: var(--baja-enfasis)");
  });

  test("un distintivo es una etiqueta a 12 px; el de atención, en la tinta del aviso; el interno, neutro y en versalitas, y el de marca, en el azul de enlace", () => {
    const distintivo = reglaDe(componentes, ".distintivo");
    expect(distintivo).toContain("font-size: var(--texto-xxs)");
    expect(distintivo).toContain("font-weight: 500");
    expect(reglaDe(componentes, ".distintivo--aviso")).toContain("color: var(--aviso-enfasis)");
    /* «Interno» dice para quién es, no que falte algo: sin el ocre de los avisos (dirección A, 18-11-2026). */
    const interno = reglaDe(componentes, ".distintivo--interno");
    expect(interno).toContain("color: var(--tinta)");
    expect(interno).toContain("border-color: var(--tinta)");
    expect(interno).toContain("background: transparent");
    expect(interno).toContain("text-transform: uppercase");
    expect(interno).not.toMatch(/--aviso/);
    expect(reglaDe(componentes, ".distintivo--marca")).toContain("color: var(--marca-fuerte)");
  });

  test("las tres ausencias siguen pintándose distinto", () => {
    expect(reglaDe(componentes, ".ausencia--no-aplica")).toMatch(/color: var\(--tinta-3\);\s*font-style: italic;/);
    expect(reglaDe(componentes, ".ausencia--falta")).toMatch(/color: var\(--aviso\);\s*font-weight: 500;/);
    expect(reglaDe(componentes, ".ausencia--sin-pedir")).toContain("color: var(--marca)");
    /* Dentro de la cifra en serifa, una ausencia es una frase: en la letra del texto. */
    expect(reglaDe(componentes, ".respuesta__cifra .ausencia")).toContain("font-family: var(--fuente)");
  });

  test("la cifra de un indicador va en la serifa a 32/36, y su apunte, a 12 px", () => {
    expect(tokens).toMatch(/--cifra-indicador:\s*2rem;/);
    const cifra = reglaDe(componentes, ".respuesta__cifra");
    expect(cifra).toContain("font-family: var(--fuente-serifa)");
    expect(cifra).toContain("font-size: var(--cifra-indicador)");
    expect(cifra).toContain("line-height: 1.125");
    expect(reglaDe(componentes, ".respuesta__apunte")).toContain("font-size: var(--texto-xxs)");
  });

  test("la barra de una parte corre sobre su pista, y las filas llevan el filete claro", () => {
    expect(reglaDe(componentes, ".partes__carril")).toContain("background: var(--pista)");
    expect(reglaDe(componentes, ".partes__parte")).toContain("border-bottom: 1px solid var(--filete-fila)");
  });
});

describe("dirección A · remates de las piezas comunes (18-11-2026)", () => {
  const componentes = hoja("components.css");

  test("un segmentado dentro de un campo o de una pila mide lo que sus opciones, sin pesar más que una clase", () => {
    expect(reglaDe(componentes, ":where(.field, .stack) > .ui-segmented")).toContain("align-self: flex-start");
  });

  test("un campo sin `type` lleva el estilo común, sin pesar más que una etiqueta", () => {
    const campos = sinComentarios(componentes).match(/\ninput:where\(:not\(\[type\]\)\),\s*input\[type="text"\],[^{]*\{([^}]*)\}/)?.[1] ?? "";
    expect(campos).toContain("border: 1px solid var(--borde-control)");
    expect(campos).toContain("border-radius: var(--radio-control)");
  });

  test("el antetítulo de un diálogo va en versalitas, como el de la cabecera de pantalla", () => {
    const ceja = reglaDe(componentes, ".ui-dialog__eyebrow");
    expect(ceja).toContain("text-transform: uppercase");
    expect(ceja).toContain("letter-spacing: 0.08em");
    expect(ceja).toContain("font-size: var(--texto-xxs)");
  });

  test("el paginador lleva el recuento a la izquierda y el paso de página a la derecha", () => {
    expect(reglaDe(hoja("tabla.css"), ".tabla__paginas > span:first-child")).toContain("margin-right: auto");
  });

  /* `input:hover:not(:disabled)` pesa (0,2,1) y `.field [aria-invalid="true"]`, (0,2,0): bajo el ratón, el campo con
     error perdía su borde rojo, en toda la aplicación y también en el acceso. */
  test("un campo con error conserva su borde rojo bajo el ratón, y el borde del ratón no gana a ninguna clase de pantalla", () => {
    const limpio = sinComentarios(componentes);
    const encima = limpio.match(/\ninput:hover:not\(([^)]*)\),\s*select:hover:not\(([^)]*)\),\s*textarea:hover:not\(([^)]*)\)\s*\{([^}]*)\}/);
    expect(encima, "falta la regla del borde bajo el ratón").not.toBeNull();
    /* Los tres controles dejan fuera el deshabilitado y el que tiene error, en la misma lista de `:not()`: así la regla
       sigue pesando (0,2,1), lo mismo que antes, y no pasa por encima de ninguna regla de pantalla que ya ganaba. */
    for (const lista of encima!.slice(1, 4)) expect(lista.replace(/\s+/g, "")).toBe(':disabled,[aria-invalid="true"]');
    expect(encima![4]).toContain("border-color: var(--tinta-2)");
    expect(reglaDe(componentes, '.field [aria-invalid="true"]')).toContain("border-color: var(--baja)");
    /* El anillo de foco no cambia: el foco sigue poniendo su anillo sobre cualquier campo, también el que tiene error. */
    expect(reglaDe(componentes, "input:focus-visible,\nselect:focus-visible,\ntextarea:focus-visible")).toContain("box-shadow: var(--focus-ring)");
  });
});

/* Dirección A (18-11-2026): la banda de cifras bajo la cabecera de pantalla, sin caja, se había escrito cuatro veces
   (Análisis, Ficha, Salud y Diseño). Ahora es la variante abierta de la pieza, escrita una vez en components.css. */
describe("dirección A · la banda abierta de la pieza Respuesta", () => {
  const componentes = hoja("components.css");
  const pantallas = ["analisis.css", "ficha.css", "datos.css"] as const;

  test("no es una caja: sin borde ni fondo, con filetes verticales y uno inferior", () => {
    const banda = reglaDe(componentes, ".respuesta--abierta");
    expect(banda).toContain("border: 0;");
    expect(banda).toContain("border-radius: 0;");
    expect(banda).toMatch(/background: linear-gradient\(var\(--filete-fuerte\), var\(--filete-fuerte\)\) no-repeat/);
    expect(banda).not.toContain("var(--papel)");
    expect(reglaDe(componentes, ".respuesta--abierta .respuesta__dato")).toContain("border-left-color: var(--filete-fuerte)");
    /* Sin la variante la banda sigue siendo una tarjeta. */
    expect(reglaDe(componentes, ".respuesta")).toContain("background: var(--papel)");
  });

  test("va pegada al doble filete de la cabecera", () => {
    expect(reglaDe(componentes, ".ui-page-header + .respuesta--abierta")).toContain("margin-top: calc(1px - var(--s-8))");
    /* En Análisis la banda va en una sección con su método, y la que se pega es la sección. */
    expect(reglaDe(hoja("analisis.css"), ".analisis > .ui-page-header + .analisis-respuesta")).toContain("margin-top: calc(1px - var(--s-8))");
  });

  test("Análisis, la Ficha y la Salud la piden a la pieza y ninguna hoja la vuelve a escribir", () => {
    for (const fichero of ["pages/XrayPage.tsx", "components/ficha/FichaInstrumento.tsx", "pages/SaludDelCatalogoPage.tsx"]) {
      expect(readFileSync(join(RAIZ, "src", fichero), "utf8"), fichero).toMatch(/<Respuesta\s+abierta\b/);
    }
    for (const fichero of pantallas) {
      const css = sinComentarios(hoja(fichero));
      expect(css, fichero).not.toMatch(/linear-gradient\(var\(--filete-fuerte\)/);
      expect(css, fichero).not.toMatch(/margin-left: calc\(-1 \* var\(--respuesta-relleno\)\)/);
    }
  });
});

describe("dirección A · Análisis", () => {
  const analisis = hoja("analisis.css");

  test("en la tableta de pie, tres cifras y dos, en columnas", () => {
    expect(sinComentarios(analisis)).toMatch(
      /@media \(max-width: 899\.98px\) \{\s*\.analisis-respuesta \.respuesta \{\s*display: grid;\s*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/
    );
  });

  test("el selector de la referencia conserva la flecha de todo selector: solo fija el color de su fondo", () => {
    const selector = reglaDe(analisis, ".analisis-referencia");
    expect(selector).toContain("background-color: var(--papel)");
    expect(selector).not.toMatch(/background:\s/);
  });
});
