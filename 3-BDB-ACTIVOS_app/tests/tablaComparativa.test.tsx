import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import {
  TablaComparativa,
  type ColumnaComparada,
  type FilaComparada
} from "../src/components/tabla/TablaComparativa";
import { PlanoRiesgoRetorno } from "../src/components/tabla/PlanoRiesgoRetorno";
import { METRICS_METHOD_LABELS } from "../src/core/labels";

/**
 * La comparativa.
 *
 * Comparar es donde mezclar escalas hace más daño: en una tabla ordenable se puede
 * agrupar, pero aquí las columnas SON los instrumentos que el asesor ha elegido. Así
 * que la fila se marca.
 *
 * Y esto no lo inventa el rediseño: el comparador de hoy ya avisa de la mezcla para el
 * Sharpe a tres años desde el 03-09-2026, con la misma función. Lo que cambia es que
 * ahora lo hace cada fila de cifras y no solo esa.
 */

const FONDO: ColumnaComparada = {
  id: "f1",
  nombre: "Un fondo",
  metodo: "EXTRACTOR_MONTHLY_V1",
  frecuencia: "MONTHLY"
};
const OTRO_FONDO: ColumnaComparada = {
  id: "f2",
  nombre: "Otro fondo",
  metodo: "EXTRACTOR_MONTHLY_V1",
  frecuencia: "MONTHLY"
};
const ACCION: ColumnaComparada = {
  id: "a1",
  nombre: "Una acción",
  metodo: "EXTRACTOR_DAILY_V1",
  frecuencia: "DAILY"
};

const VALORES: Record<string, number | undefined> = { f1: 0.05, f2: 0.17, a1: 0.21 };

const FILAS: FilaComparada[] = [
  { id: "que", titulo: "Qué es", celda: () => ({ texto: "—" }) },
  {
    id: "vol",
    titulo: "Volatilidad 1 año",
    comparable: true,
    valor: (c) => VALORES[c.id],
    celda: (c) => ({ texto: String(VALORES[c.id] ?? "") })
  }
];

const pinta = (columnas: ColumnaComparada[], filas = FILAS) =>
  renderToStaticMarkup(<TablaComparativa columnas={columnas} filas={filas} titulo="Prueba" />);

describe("tabla comparativa", () => {
  test("dos instrumentos del mismo método se comparan sin marcas", () => {
    const html = pinta([FONDO, OTRO_FONDO]);
    expect(html).not.toContain("tabla__fila--incomparable");
    expect(html).not.toContain("No comparable entre sí");
    expect(html).not.toContain("tabla__aviso");
  });

  test("en cuanto entra otro método, la fila de cifras se marca", () => {
    const html = pinta([FONDO, ACCION]);
    expect(html).toContain("tabla__fila--incomparable");
    expect(html).toContain("No comparable entre sí");
    expect(html).toContain("tabla__aviso");
  });

  test("una fila que no es de cifras nunca se marca, aunque los métodos difieran", () => {
    const html = pinta([FONDO, ACCION]);
    // «Qué es» no declara `comparable`, así que la marca no puede tocarla.
    const trozo = html.slice(html.indexOf("Qué es"), html.indexOf("Volatilidad"));
    expect(trozo).not.toContain("No comparable entre sí");
  });

  test("una columna SIN la cifra no aporta método: contarla daría un aviso falso", () => {
    /* Si la acción no tiene volatilidad, la única metodología presente es la del fondo
       y la fila es comparable. Es la regla que ya aplicaba el comparador de hoy. */
    const sinValor: FilaComparada[] = [
      {
        id: "vol",
        titulo: "Volatilidad 1 año",
        comparable: true,
        valor: (c) => (c.id === "a1" ? undefined : VALORES[c.id]),
        celda: (c) =>
          c.id === "a1"
            ? { texto: "Falta el dato", ausencia: "falta" as const }
            : { texto: String(VALORES[c.id]) }
      }
    ];
    const html = pinta([FONDO, ACCION], sinValor);
    expect(html).not.toContain("No comparable entre sí");
    expect(html).toContain("tabla__celda--falta");
  });

  test("es una tabla con encabezado de fila: la cifra se lee sabiendo de qué es", () => {
    const html = pinta([FONDO, ACCION]);
    expect(html).toContain('scope="row"');
    expect(html).toContain('scope="col"');
    expect(html).toContain("<caption");
  });

  test("los métodos de la base nueva tienen etiqueta propia y distinta", () => {
    /* Sin esto, el aviso diría «2 son EXTRACTOR_MONTHLY_V1», que no es castellano. Y
       las dos etiquetas no pueden ser la misma: son dos métodos, no dos nombres. */
    expect(METRICS_METHOD_LABELS.EXTRACTOR_MONTHLY_V1).toBeDefined();
    expect(METRICS_METHOD_LABELS.EXTRACTOR_DAILY_V1).toBeDefined();
    expect(METRICS_METHOD_LABELS.EXTRACTOR_MONTHLY_V1).not.toBe(
      METRICS_METHOD_LABELS.EXTRACTOR_DAILY_V1
    );
  });
});

describe("el plano riesgo-retorno", () => {
  const punto = (columna: ColumnaComparada) => ({
    id: columna.id,
    nombre: columna.nombre,
    metodo: columna.metodo,
    volatilidad: VALORES[columna.id],
    rentabilidad: 0.1
  });

  test("un panel por método: los ejes son las cifras que no se pueden mezclar", () => {
    const uno = renderToStaticMarkup(
      <PlanoRiesgoRetorno columnas={[FONDO, OTRO_FONDO]} puntoDe={punto} />
    );
    expect((uno.match(/class="plano"/g) ?? []).length).toBe(1);

    const dos = renderToStaticMarkup(
      <PlanoRiesgoRetorno columnas={[FONDO, ACCION]} puntoDe={punto} />
    );
    expect((dos.match(/class="plano"/g) ?? []).length).toBe(2);
    expect(dos).toContain("Un panel por método");
  });

  test("con un solo método no hay nada que advertir", () => {
    const html = renderToStaticMarkup(
      <PlanoRiesgoRetorno columnas={[FONDO, OTRO_FONDO]} puntoDe={punto} />
    );
    expect(html).not.toContain("Un panel por método");
  });

  test("cada punto lleva su etiqueta pegada: la identidad no la da el color", () => {
    const html = renderToStaticMarkup(
      <PlanoRiesgoRetorno columnas={[FONDO, OTRO_FONDO]} puntoDe={punto} />
    );
    expect((html.match(/plano__etiqueta/g) ?? []).length).toBe(2);
    expect(html).toContain("Un fondo");
    expect(html).toContain("Otro fondo");
  });

  test("el cero de rentabilidad siempre está: sin él, perder menos parece ganar", () => {
    const html = renderToStaticMarkup(
      <PlanoRiesgoRetorno
        columnas={[FONDO, OTRO_FONDO]}
        puntoDe={(c) => ({ ...punto(c), rentabilidad: 0.2 })}
      />
    );
    expect(html).toContain("plano__cero");
    expect(html).toContain("0\u00a0%");
  });

  test("cada eje lleva sus marcas con su valor, y las dos cifras van junto al nombre", () => {
    const html = renderToStaticMarkup(
      <PlanoRiesgoRetorno
        columnas={[FONDO, OTRO_FONDO]}
        puntoDe={(c) => ({ ...punto(c), rentabilidad: c.id === "f1" ? 0.0214 : 0.1633 })}
      />
    );
    const marcas = [...html.matchAll(/class="plano__marca-eje"[^>]*>([^<]+)</g)].map((marca) => marca[1]);
    /* 5, 10, 15 y 20 % en volatilidad; de 0 a 20 % en rentabilidad, con el cero siempre dentro. */
    expect(marcas).toEqual(["5\u00a0%", "10\u00a0%", "15\u00a0%", "20\u00a0%", "0\u00a0%", "5\u00a0%", "10\u00a0%", "15\u00a0%", "20\u00a0%"]);
    expect(html).toContain("vol. 5,00\u00a0% · +2,14\u00a0%");
    expect(html).toContain("vol. 17,00\u00a0% · +16,33\u00a0%");
  });

  test("si el nombre entero no cabe, número junto al punto y debajo la lista con el nombre entero", () => {
    const largo = "DPAM B - Equities NewGems Sustainable B Cap con un nombre muy largo de verdad";
    const columnas = [FONDO, { ...OTRO_FONDO, nombre: largo }];
    const html = renderToStaticMarkup(
      <PlanoRiesgoRetorno columnas={columnas} puntoDe={(c) => ({ ...punto(c), nombre: c.nombre })} />
    );
    expect(html).not.toContain("plano__etiqueta");
    expect(html.match(/class="plano__numero"/g) ?? []).toHaveLength(2);
    /* Ni un nombre cortado: el final es lo que distingue una clase de otra. */
    expect(html).not.toContain("…");
    const lista = html.slice(html.indexOf("plano__indice"));
    expect(lista).toContain(largo);
    expect(lista).toContain("<b>1</b> · Un fondo");
    expect(lista).toContain("<b>2</b> · " + largo);
    expect(lista).toContain("vol. 17,00\u00a0% · +10,00\u00a0%");
  });

  test("el número es el de la selección, no el del panel", () => {
    const html = renderToStaticMarkup(
      <PlanoRiesgoRetorno
        columnas={[ACCION, { ...FONDO, nombre: "DPAM B - Bonds Eur Government B EUR Capitalisation" }, { ...OTRO_FONDO, nombre: "DPAM B - Equities NewGems Sustainable B Cap Class" }]}
        puntoDe={(c) => ({ ...punto(c), nombre: c.nombre })}
      />
    );
    const numeros = [...html.matchAll(/class="plano__numero"[^>]*>(\d)</g)].map((numero) => numero[1]);
    expect(numeros).toEqual(["2", "3"]);
  });

  test("un panel con un solo instrumento no dibuja plano: su línea y por qué", () => {
    const html = renderToStaticMarkup(
      <PlanoRiesgoRetorno columnas={[FONDO, OTRO_FONDO, ACCION]} puntoDe={punto} ventana="3 años" />
    );
    expect(html.match(/plano__lienzo/g) ?? []).toHaveLength(1);
    expect(html).toContain("<b>Una acción</b>");
    expect(html).toContain("Volatilidad 3 años 21,00\u00a0% · Rentabilidad 3 años +10,00\u00a0%");
    expect(html).toContain("No se sitúa frente a los demás porque su método es otro.");
    expect(html).toContain("Un panel por método");
  });

  test("un panel sin las dos cifras lo dice en vez de dibujar un plano vacío", () => {
    const html = renderToStaticMarkup(
      <PlanoRiesgoRetorno
        columnas={[FONDO]}
        puntoDe={(c) => ({ ...punto(c), volatilidad: undefined })}
      />
    );
    expect(html).toContain("plano__vacio");
    expect(html).not.toContain("plano__marca");
  });
});

describe("MAR-25 · el marco de la tabla comparativa", () => {
  const html = renderToStaticMarkup(
    <TablaComparativa
      columnas={[FONDO, ACCION]}
      filas={FILAS}
      notas={["Una nota repetida.", "Una nota repetida."]}
      titulo="Métricas comparadas"
    />
  );

  test("el marco desplazable se puede enfocar y tiene nombre, como el de TablaDeDatos", () => {
    expect(html).toMatch(
      /<div aria-label="Métricas comparadas \(tabla desplazable\)" class="tabla__marco" role="group" tabindex="0">/
    );
  });

  test("la celda de la esquina dice qué hay en la primera columna", () => {
    expect(html).toContain('<th scope="col"><span class="sr-only">Dato</span></th>');
  });

  test("las notas van fuera del marco, y dos iguales salen las dos", () => {
    const marco = html.slice(html.indexOf('class="tabla__marco"'), html.indexOf("</table>"));
    const despues = html.slice(html.indexOf("</table>"));
    expect(marco).not.toContain("Una nota repetida.");
    expect(despues.indexOf("</div>")).toBeLessThan(despues.indexOf("Una nota repetida."));
    expect(despues.split("Una nota repetida.").length - 1).toBe(2);
  });
});

describe("la marca de cada activo (Óscar, 20-11-2026: «Marcar activos en el Comparador»)", () => {
  test("con marca, la cabecera de su columna lleva su número y su color delante del nombre; sin marca, nada", () => {
    const html = renderToStaticMarkup(
      <TablaComparativa
        columnas={[{ ...FONDO, marca: { numero: 1, color: "#123456" } }, { ...OTRO_FONDO, marca: { numero: 2, color: "#654321" } }, ACCION]}
        filas={FILAS}
        titulo="Comparados"
      />
    );
    const cabecera = html.slice(html.indexOf("<thead>"), html.indexOf("</thead>"));
    expect(cabecera.match(/class="marca-de-activo"/g)?.length).toBe(2);
    expect(cabecera).toMatch(/background:#123456[^>]*><\/span><span>1<\/span><\/span>Un fondo/);
    expect(cabecera).toMatch(/background:#654321[^>]*><\/span><span>2<\/span><\/span>Otro fondo/);
    /* La acción no lleva marca: la pieza no la inventa. */
    expect(cabecera).toMatch(/scope="col">Una acción/);
  });
});

describe("el signo de una rentabilidad (Óscar, 20-11-2026: verde y rojo en la tabla comparada)", () => {
  test("una celda con signo lleva el color de la pieza Cifra; sin signo, o neutra, ninguno", () => {
    const filas: FilaComparada[] = [
      {
        id: "r",
        titulo: "Rentabilidad",
        celda: (c) =>
          c.id === "f1" ? { texto: "+1,82 %", signo: "sube" } : c.id === "f2" ? { texto: "−3,10 %", signo: "baja" } : { texto: "+0,00 %", signo: "neutro" }
      },
      { id: "v", titulo: "Volatilidad", celda: () => ({ texto: "9,40 %" }) }
    ];
    const html = renderToStaticMarkup(<TablaComparativa columnas={[FONDO, OTRO_FONDO, ACCION]} filas={filas} titulo="Comparados" />);
    expect(html).toContain('<span class="cifra cifra--sube">+1,82 %</span>');
    expect(html).toContain('<span class="cifra cifra--baja">−3,10 %</span>');
    expect(html).toContain("<span>+0,00 %</span>");
    expect(html).toContain("<span>9,40 %</span>");
  });
});
