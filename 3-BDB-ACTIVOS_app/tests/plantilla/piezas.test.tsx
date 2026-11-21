/**
 * Las piezas de la plantilla, una a una: el contexto llega a las piezas, las cifras que faltan se dicen, la tabla no
 * deja el total solo ni pierde filas en ningún salto de hoja, el gráfico rotula sus líneas y sombrea la cartera, las barras
 * de un reparto llevan un color por categoría, la portada, las cuentas de los ejes y el compositor de secciones.
 */
import type { ReactNode } from "react";
import { describe, expect, test } from "vitest";
import { fecha, importeTitular } from "../../src/core/formato";
import {
  CifrasDestacadas,
  DocumentoDeInforme,
  GraficoDeLineas,
  Hoja,
  ListaDePartes,
  Portada,
  Rejilla,
  Tabla,
  Texto,
  renderizarInforme,
  repartirEnHojas,
  seccionesQueProceden,
  useHoja,
  useInforme,
  type SeccionDeInforme,
  type TemaDeInforme
} from "../../src/reports/plantilla";
import { colocarEtiquetas, cortesDelEje, marcasDeFechas, tramos, ultimoValor } from "../../src/reports/plantilla/escalas";
import { coloresDeLasPartes, estiloDeLasSeries } from "../../src/reports/plantilla/graficos";
import { SERIES, SERIES_DEL_TEMA, SIN_CLASIFICAR, colorDeCategoria } from "../../src/reports/plantilla/tema";
import { extractPdfMetadata, extractPdfPageTexts, extractPdfTextBaselines } from "../support/pdfText";
import { datosDeMuestra } from "./muestra";

async function hojas(contenido: ReactNode, { tema = "cliente", apaisada = false }: { tema?: TemaDeInforme; apaisada?: boolean } = {}): Promise<string[]> {
  const blob = await renderizarInforme(
    <DocumentoDeInforme tema={tema} documento="Prueba">
      <Hoja apaisada={apaisada}>{contenido}</Hoja>
    </DocumentoDeInforme>
  );
  return extractPdfPageTexts(Buffer.from(await blob.arrayBuffer()));
}

function Sonda() {
  const { tema, documento } = useInforme();
  const { apaisada, ancho } = useHoja();
  return <Texto>{`sonda ${tema} ${documento} ${apaisada ? "apaisada" : "vertical"} ${ancho.toFixed(2)}`}</Texto>;
}

describe("el contexto del documento y de la hoja", () => {
  test("@react-pdf lo propaga hasta las piezas", async () => {
    /* Márgenes de 45 desde el 14-11-2026, los del papel de antes. */
    expect((await hojas(<Sonda />, { tema: "interno", apaisada: true }))[0]).toContain("sonda interno Prueba apaisada 751.89");
    expect((await hojas(<Sonda />))[0]).toContain("sonda cliente Prueba vertical 505.28");
  }, 30_000);
});

describe("cifras destacadas y rejilla", () => {
  test("una cifra que falta se escribe con su frase de ausencia, y la que está, tal cual", async () => {
    const [texto] = await hojas(
      <>
        <CifrasDestacadas
          cifras={[
            { rotulo: "Patrimonio", cifra: importeTitular(201_298), principal: true },
            { rotulo: "Rentabilidad", cifra: null },
            { rotulo: "Volatilidad", cifra: null, motivo: "no-aplica" }
          ]}
        />
        <Rejilla datos={[{ rotulo: "Riesgo", valor: null, motivo: "sin-pedir" }, { rotulo: "Fecha", valor: fecha("2026-11-13") }]} />
      </>
    );
    expect(texto).toContain("Patrimonio 201.298 €");
    expect(texto).toContain("Rentabilidad Falta el dato");
    expect(texto).toContain("Volatilidad No aplica");
    expect(texto).toContain("Riesgo Sin pedir");
    expect(texto).toContain("Fecha 13/11/2026");
  }, 30_000);
});

describe("la tabla", () => {
  const filas = (n: number) => Array.from({ length: n }, (_, i) => ({ celdas: [`Fila ${String(i + 1).padStart(3, "0")}`, `${i + 1},00 €`] }));

  test("en cualquier salto de hoja, ninguna fila se pierde ni se repite, la cabecera se repite y el total no va solo", async () => {
    /* Unas 31 filas de una línea caben en una hoja: el barrido pasa por el salto con el total a cada lado. */
    for (let n = 26; n <= 38; n += 1) {
      const paginas = await hojas(<Tabla columnas={[{ titulo: "Concepto", ancho: 3 }, { titulo: "Importe", cifra: true }]} filas={filas(n)} total={["Suma total", "x"]} />);
      const vistas = paginas.flatMap((texto) => [...texto.matchAll(/Fila (\d{3})/g)].map((m) => Number(m[1])));
      expect(vistas, `${n} filas`).toEqual(Array.from({ length: n }, (_, i) => i + 1));
      for (const texto of paginas) expect(texto, `${n} filas: cabecera`).toContain("Concepto Importe");
      const conTotal = paginas.find((texto) => texto.includes("Suma total"))!;
      expect([...conTotal.matchAll(/Fila \d{3}/g)].length, `${n} filas: el total acompañado`).toBeGreaterThanOrEqual(2);
    }
  }, 60_000);

  test("un grupo no se queda solo al pie, y una celda vacía a propósito no se confunde con un dato que falta", async () => {
    const paginas = await hojas(
      <Tabla
        columnas={[{ titulo: "Activo" }, { titulo: "Valor", cifra: true }]}
        filas={[...filas(29), { grupo: "Grupo de cierre" }, ...filas(3).map((_, i) => ({ celdas: [`Última ${i + 1}`, i === 0 ? null : ""] }))]}
      />
    );
    const conGrupo = paginas.find((texto) => texto.includes("Grupo de cierre"))!;
    expect(conGrupo).toContain("Última 1 Falta el dato");
    expect(paginas.join(" ").match(/Falta el dato/g)?.length).toBe(1);
  }, 30_000);
});

describe("el gráfico de líneas", () => {
  test("rotula cada línea con su nombre y su último valor, y lleva leyenda con dos series", async () => {
    const datos = datosDeMuestra("cliente", 0);
    const [texto] = await hojas(
      <GraficoDeLineas
        fechas={datos.fechas}
        series={[
          { nombre: "Valor", valores: datos.valor },
          { nombre: "Aportado", valores: datos.aportado, referencia: true }
        ]}
        formato={(v) => importeTitular(v)}
      />
    );
    expect(texto).toContain("Valor");
    expect(texto).toContain("201.298 €");
    expect(texto).toContain("182.716 €");
    expect(texto).toContain("210.000 €");
    expect(texto).toContain("ene 2026");
    expect(texto.match(/Aportado/g)?.length).toBe(2);
  }, 30_000);

  test("la cartera en el color del tema y a 1,6; la referencia en la tinta secundaria y a trazos; las demás, en orden", () => {
    const lista = [
      { nombre: "Cartera", valores: [] },
      { nombre: "Referencia", valores: [], referencia: true },
      { nombre: "Otra", valores: [] }
    ];
    expect(estiloDeLasSeries(lista).map((s) => [s.color, s.grosor, s.trazo ?? null])).toEqual([
      [SERIES.cartera, 1.6, null],
      [SERIES.referencia, 1.2, "4 3"],
      [SERIES.demas[0], 1.2, null]
    ]);
    expect(estiloDeLasSeries(lista, "interno")[0].color).toBe(SERIES_DEL_TEMA.interno.cartera);
  });

  test("la cartera sola lleva su sombreado suave debajo; dos series que no son referencia, no", async () => {
    const datos = datosDeMuestra("cliente", 0);
    const pdf = async (series: Array<{ nombre: string; valores: Array<number | null>; referencia?: boolean }>) => {
      const blob = await renderizarInforme(
        <DocumentoDeInforme tema="cliente" documento="Prueba">
          <Hoja>
            <GraficoDeLineas fechas={datos.fechas} series={series} formato={(v) => importeTitular(v)} />
          </Hoja>
        </DocumentoDeInforme>
      );
      return Buffer.from(await blob.arrayBuffer()).toString("latin1");
    };
    /* El sombreado es un relleno con opacidad: @react-pdf lo escribe como un estado gráfico con /ca menor que 1. */
    const conOpacidad = (pdfTexto: string) => /\/ca\s+0\.0\d/.test(pdfTexto);
    expect(conOpacidad(await pdf([{ nombre: "Valor", valores: datos.valor }, { nombre: "Aportado", valores: datos.aportado, referencia: true }]))).toBe(true);
    expect(conOpacidad(await pdf([{ nombre: "Valor", valores: datos.valor }, { nombre: "Otra", valores: datos.aportado }]))).toBe(false);
  }, 30_000);

  test("sin dos fechas o sin cifras no dibuja nada", async () => {
    const [texto] = await hojas(
      <>
        <Texto>antes</Texto>
        <GraficoDeLineas fechas={["2026-01-02"]} series={[{ nombre: "Valor", valores: [1] }]} formato={String} />
        <GraficoDeLineas fechas={["2026-01-02", "2026-01-05"]} series={[{ nombre: "Valor", valores: [null, null] }]} formato={String} />
      </>
    );
    expect(texto).not.toContain("Valor");
  }, 30_000);
});

describe("las cuentas de los gráficos", () => {
  test("cortes redondos: 1, 2, 2,5 o 5 por potencia de diez", () => {
    expect(cortesDelEje(172_716, 201_298)).toEqual([170_000, 180_000, 190_000, 200_000, 210_000]);
    expect(cortesDelEje(-0.031, 0.047)).toEqual([-0.04, -0.02, 0, 0.02, 0.04, 0.06]);
    expect(cortesDelEje(Number.NaN, 1)).toEqual([]);
  });

  test("un hueco parte la línea", () => {
    expect(tramos([1, null, 2, 3, Number.NaN, 4])).toEqual([[0], [2, 3], [5]]);
    expect(tramos([null, null])).toEqual([]);
    expect(ultimoValor([1, 2, null])).toEqual({ indice: 1, valor: 2 });
  });

  test("el eje de fechas: meses con `fechaDeEje`, sin pasar de seis", () => {
    const marcas = marcasDeFechas(datosDeMuestra("cliente", 0).fechas).map((m) => m.texto);
    expect(marcas).toEqual(["ene 2026", "mar 2026", "may 2026", "jul 2026", "sep 2026", "nov 2026"]);
  });

  test("las etiquetas no se pisan y no se salen", () => {
    expect(colocarEtiquetas([100, 105], 21, 0, 200)).toEqual([100, 121]);
    expect(colocarEtiquetas([198, 195], 21, 0, 200)).toEqual([200, 179]);
    expect(colocarEtiquetas([-10], 21, 5, 200)).toEqual([5]);
  });
});

/* Las barras de un reparto: un color por categoría (decisión de Óscar del 14-11-2026, el papel de antes). */
describe("las barras de un reparto", () => {
  test("cada categoría lleva su color, en orden; «Otros» va en gris", async () => {
    const partes = [
      { nombre: "RV Global", fraccion: 0.4, cifra: "40,0 %" },
      { nombre: "RF Corporativa", fraccion: 0.35, cifra: "35,0 %" },
      { nombre: "Mixtos", fraccion: 0.2, cifra: "20,0 %" },
      { nombre: "Otras 3 categorías", fraccion: null, cifra: "5,0 %", color: SIN_CLASIFICAR }
    ];
    expect(coloresDeLasPartes(partes)).toEqual([colorDeCategoria(0), colorDeCategoria(1), colorDeCategoria(2), SIN_CLASIFICAR]);
    expect(new Set(coloresDeLasPartes(partes)).size).toBe(4);
    /* Y en el papel: la lista se dibuja con sus nombres y sus cifras. */
    const [texto] = await hojas(<ListaDePartes partes={partes} ancho={300} />);
    expect(texto).toContain("RV Global 40,0 %");
    expect(texto).toContain("Otras 3 categorías 5,0 %");
  }, 30_000);
});

describe("la portada", () => {
  async function portada(identidad: Parameters<typeof DocumentoDeInforme>[0]["identidad"], tema: TemaDeInforme = "cliente") {
    const blob = await renderizarInforme(
      <DocumentoDeInforme tema={tema} documento="Informe de cartera" identidad={identidad} destinatario="Familia García">
        <Portada antetitulo="Informe personalizado" titulo={"Informe\nde su cartera"} destinatario="Familia García" datos={[{ rotulo: "Fecha de creación", valor: "13 de noviembre de 2026" }, { rotulo: "Horizonte", valor: null }]} />
        <Hoja>
          <Texto>Segunda hoja</Texto>
        </Hoja>
      </DocumentoDeInforme>
    );
    const bytes = Buffer.from(await blob.arrayBuffer());
    return { bytes, texto: extractPdfPageTexts(bytes)[0].replace(/\s+/g, " "), cabecera: extractPdfTextBaselines(bytes)[0].filter((c) => c.y < 60).map((c) => c.texto.trim()) };
  }

  test("con identidad: la entidad arriba, el sello, el título, para quién, la rejilla, «Elaborado por» y el pie con «Página 1 de 2»", async () => {
    const { texto, cabecera, bytes } = await portada({ nombre: "Marta Ruiz Alonso", entidad: "Ruiz & Asociados", contacto: "marta@ejemplo.es" });
    /* La identidad, en versalitas: donde el papel de antes decía la marca de una entidad. */
    expect(cabecera).toEqual(["RUIZ & ASOCIADOS", "Informe de cartera", "CONFIDENCIAL"]);
    for (const frase of ["INFORME PERSONALIZADO", "Informe de su cartera", "Familia García", "Fecha de creación 13 de noviembre de 2026", "Horizonte Falta el dato", "Elaborado por Marta Ruiz Alonso Ruiz & Asociados · marta@ejemplo.es", "Preparado para Familia García · CONFIDENCIAL", "Página 1 de 2"]) {
      expect(texto, frase).toContain(frase);
    }
    expect(extractPdfMetadata(bytes, "Author")).toBe("Marta Ruiz Alonso");
  }, 30_000);

  test("sin identidad no va nada en su sitio, ni «Elaborado por»; y nunca una marca de entidad", async () => {
    const { texto, cabecera } = await portada({ nombre: " ", entidad: "" });
    expect(cabecera).toEqual(["Informe de cartera", "CONFIDENCIAL"]);
    expect(texto).not.toMatch(/Elaborado por|Independent|Private Bankers|undefined/);
  }, 30_000);

  test("en el tema interno, el sello es el suyo", async () => {
    const { cabecera } = await portada({ nombre: "Marta Ruiz Alonso" }, "interno");
    expect(cabecera).toEqual(["MARTA RUIZ ALONSO", "Informe de cartera", "USO INTERNO"]);
  }, 30_000);
});

describe("el compositor de secciones", () => {
  const seccion = (id: string, extra: Partial<SeccionDeInforme<{ sin: string[] }>> = {}): SeccionDeInforme<{ sin: string[] }> => ({
    id,
    titulo: id,
    procede: (datos) => !datos.sin.includes(id),
    Contenido: () => null,
    ...extra
  });
  const lista = [
    seccion("presentacion", { comienzo: "presentacion" }),
    seccion("a"),
    seccion("b"),
    seccion("c", { comienzo: "nueva" }),
    seccion("d", { apaisada: true }),
    seccion("e", { apaisada: true }),
    seccion("f"),
    seccion("g", { sinNumero: true })
  ];

  test("numera seguidas las que proceden, sin contar la presentación ni las que no llevan número", () => {
    const numeros = seccionesQueProceden(lista, { sin: ["b"] }).map((s) => `${s.id}:${s.numero ?? "-"}`);
    expect(numeros).toEqual(["presentacion:-", "a:01", "c:02", "d:03", "e:04", "f:05", "g:-"]);
  });

  test("reparte en hojas: la presentación y las nuevas abren hoja, y un cambio de orientación también", () => {
    const tiras = repartirEnHojas(seccionesQueProceden(lista, { sin: [] })).map((t) => `${t.apaisada ? "A" : "V"}[${t.secciones.map((s) => s.id).join(",")}]`);
    expect(tiras).toEqual(["V[presentacion,a,b]", "V[c]", "A[d,e]", "V[f,g]"]);
  });

  test("una sección que no procede no deja nada, ni una hoja vacía", () => {
    const tiras = repartirEnHojas(seccionesQueProceden(lista, { sin: ["c", "d", "e"] })).map((t) => t.secciones.map((s) => s.id).join(","));
    expect(tiras).toEqual(["presentacion,a,b,f,g"]);
  });

  test("dos secciones con el mismo identificador no pasan", () => {
    expect(() => seccionesQueProceden([seccion("a"), seccion("a")], { sin: [] })).toThrow(/«a»/);
  });
});
