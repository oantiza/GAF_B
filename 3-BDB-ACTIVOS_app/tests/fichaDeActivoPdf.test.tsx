/**
 * Decisión A-124 (09-11-2026): la ficha de un activo, en papel. El documento imprime el MISMO modelo que la pantalla, compuesto por
 * `componerFicha` con el `modoCliente` de la pantalla, así que en Modo cliente no lleva nada del emisor sin una línea de lógica
 * propia. Las pruebas leen el PDF GENERADO, no el código que lo escribe.
 */
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, test } from "vitest";
import type { Documento, InstrumentoDeLaBase } from "../src/adapters/baseNuevaLectura";
import { componerFicha } from "../src/adapters/componerFicha";
import {
  bloquesDelPapel,
  createFichaDeActivoPdfBlob,
  lineaDelPie,
  loQueLlevaLaCabecera,
  marcasDelEje,
  nombreDelFicheroDeLaFicha,
  type FichaDeActivoPdfInput
} from "../src/reports/fichaDeActivoPdf";
import type { EvolucionDeLaFicha } from "../src/types/fichaInstrumento";
import { extractPdfFontFaces, extractPdfPageTexts } from "./support/pdfText";

const HOY = new Date("2026-11-09T10:00:00Z");
const GENERADO = new Date(2026, 10, 9, 21, 52);

/* Un fondo con lo que la ficha de LU1295551144 trae: costes, reparto, sectores, estilo, tamaño, su caja y el objetivo. */
const FONDO: InstrumentoDeLaBase = {
  isin: "LU1295551144",
  raiz: { identity: { name: "Capital Group New Perspective Fund (LUX) B", currency: "EUR" }, instrument_type: "FUND" },
  tarjeta: {
    instrument_id: "LU1295551144",
    identity: { name: "Capital Group New Perspective Fund (LUX) B" },
    exposure: {
      asset_mix: { equity: 0.972, cash: 0.0267, other: 0.0012 },
      sectors: { technology: 0.3439, industrials: 0.1287 },
      equity_styles: { growth: 0.4198, blend: 0.4176, value: 0.1626 },
      market_caps: { large: 0.8625, mid: 0.1291, small: 0.0085 }
    }
  },
  calidad: undefined,
  bloques: {
    "declared/costs": { as_of: "2026-10-05", ongoing_charge: 0.0159, ongoing_charge_source: "KID", document_date: "2026-10-05" },
    "declared/exposure": {
      source: "MORNINGSTAR",
      as_of: "2026-09-30",
      confidence: "HIGH",
      equity_style_box: {
        large_value: 0.1318, large_blend: 0.3654, large_growth: 0.3653,
        mid_value: 0.0274, mid_blend: 0.0497, mid_growth: 0.052,
        small_value: 0.0035, small_blend: 0.0026, small_growth: 0.0023
      }
    },
    "declared/profile": { as_of: "2026-10-31", distribution_policy: "ACCUMULATING", objective: "The Fund's investment objective is to provide long-term growth of capital." }
  }
} as unknown as InstrumentoDeLaBase;

/* El ETF de las pruebas de la decisión 53, con bloque del emisor y mercado objetivo. */
const DEL_EMISOR: Documento = {
  source: "issuer:invesco",
  as_of: "2026-11-08",
  costs: { ongoing_charge: 0.0005, swap_fee: 0.000718 },
  distribution_policy: { value: "ACCUMULATING", text: "Accumulating" },
  replication: { type: "SYNTHETIC", method: "Synthetic" },
  index: { name: "S&P 500® Total Return (Net) Index" },
  nav: { series_class: "ISSUER_NAV_DERIVED", currency: "USD", last_date: "2026-11-05", last_value: 14.7862 },
  holdings: { as_of: "2026-11-04", positions_count: 629, top10_weight: 0.424, nature: "SUBSTITUTE_BASKET" }
};
const ETF: InstrumentoDeLaBase = {
  isin: "IE00B3YCGJ38",
  raiz: { instrument_type: "ETF", identity: { name: "Invesco S&P 500 UCITS ETF", currency: "USD" } },
  tarjeta: { instrument_id: "IE00B3YCGJ38" },
  calidad: undefined,
  bloques: {
    "declared/issuer_data": DEL_EMISOR,
    "computed/premium_discount": { status: "PUBLISHED", as_of: "2026-11-03", observations: 247, mean: 0.000277, latest: -0.00066, nav_adjustment: "NONE" },
    "declared/target_market": {
      source: "issuer:invesco",
      target_market_as_of: "2026-09-30",
      investor_type: { retail: "YES", professional: "YES", eligible_counterparty: "YES" },
      knowledge: { basic: "YES", informed: "YES", advanced: "YES" },
      min_holding_period: { years: 5 }
    },
    "declared/costs": { as_of: "2026-10-31", ongoing_charge: 0.0005, ongoing_charge_source: "KID", document_date: "2026-08-21" },
    "declared/profile": { as_of: "2026-10-31", distribution_policy: "UNKNOWN" },
    "declared/regulatory": { as_of: "2026-10-31", sri: 4, kid_evidence: { document_date: "2026-08-21" } }
  }
};

const EVOLUCION: EvolucionDeLaFicha = {
  procedencia: "Base 100 · diaria · EUR · 5 observaciones · oct 2023 – oct 2026",
  fechas: ["2023-10-30", "2024-06-03", "2025-01-06", "2025-08-04", "2026-10-30"],
  valores: [100, 112.5, null, 131.2, 157.9],
  variacion: "+57,9 %"
};

function entrada(instrumento: InstrumentoDeLaBase, modoCliente: boolean, extra: Partial<FichaDeActivoPdfInput> = {}): FichaDeActivoPdfInput {
  return {
    ficha: componerFicha(instrumento, undefined, { modoCliente, hoy: HOY }),
    isin: instrumento.isin,
    modoCliente,
    generado: GENERADO,
    datosA: "2026-11-09T14:05:20.205Z",
    ...extra
  };
}

async function leer(input: FichaDeActivoPdfInput): Promise<{ hojas: string[]; texto: string; bytes: Buffer }> {
  const bytes = Buffer.from(await (await createFichaDeActivoPdfBlob(input)).arrayBuffer());
  const hojas = extractPdfPageTexts(bytes);
  return { hojas, texto: hojas.join(" ").replace(/\s+/g, " "), bytes };
}

describe("A-124. El papel imprime el modelo de la pantalla", () => {
  /* Desde la plantilla única (14-11-2026) el papel lleva las dos tipografías de la plantilla, las de la pantalla, y ninguna de antes. */
  test("es un PDF, con las fuentes de la plantilla y ninguna de los papeles de antes", async () => {
    const { bytes } = await leer(entrada(FONDO, false));
    expect(bytes.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    const crudo = bytes.toString("latin1");
    /* Desde el 14-11-2026 (decisión de Óscar: recuperar el aspecto de los informes de antes) la plantilla vuelve a Fraunces y Roboto Flex; IBM Plex Sans y Source Serif 4, las de la plantilla de una sola tinta, salieron. */
    expect(crudo).toMatch(/RobotoFlex/);
    expect(crudo).toMatch(/Fraunces/);
    expect(crudo).not.toMatch(/Newsreader|InstrumentSans|IBMPlexSans|SourceSerif4|Helvetica/);
  }, 20_000);

  test("todas las secciones, en el orden de la pantalla, cada una con su procedencia", async () => {
    const input = entrada(FONDO, false);
    /* El lector de prueba pierde las ligaduras «fi» y «fl» (tests/support/pdfText.ts): se comparan sin ellas. */
    const sinLigaduras = (cadena: string) => cadena.replace(/f[il]/g, "");
    const texto = sinLigaduras((await leer(input)).texto);
    const titulos = input.ficha.secciones.filter((s) => !s.ancha).concat(input.ficha.secciones.filter((s) => s.ancha)).map((s) => s.titulo);
    let desde = 0;
    for (const titulo of titulos) {
      const en = texto.indexOf(sinLigaduras(titulo), desde);
      expect(en, titulo).toBeGreaterThanOrEqual(0);
      desde = en + sinLigaduras(titulo).length;
    }
    for (const seccion of input.ficha.secciones) {
      expect(texto, seccion.id).toContain(sinLigaduras(seccion.procedencia.map((trozo) => trozo.texto).join("").replace(/\s+/g, " ")));
    }
  }, 20_000);

  test("la caja de estilo, con sus nueve cifras y la nota de la celda con más peso", async () => {
    const { texto } = await leer(entrada(FONDO, false));
    expect(texto).toContain("Caja de estilo y tamaño");
    /* Pesos con un decimal (apartado 6): 0,1318 → 13,2 %; 0,0035 → 0,4 %, medio hacia fuera. El texto del papel se lee con los espacios
       normalizados, así que el espacio duro sale como uno normal. */
    for (const cifra of ["13,2 %", "36,5 %", "2,7 %", "5,0 %", "5,2 %", "0,4 %", "0,3 %", "0,2 %"]) expect(texto).toContain(cifra);
    /* 36,54 y 36,53 se escriben igual a un decimal: a la precisión escrita empatan, y la nota dice las dos. */
    expect(texto).toContain("Las celdas con más peso, empatadas y destacadas: grande · mixto y grande · crecimiento, 36,5 % cada una.");
  }, 20_000);

  test("el objetivo, citado en su idioma", async () => {
    const { texto } = await leer(entrada(FONDO, false));
    /* Entre comillas y sin traducir; el lector de prueba separa la comilla de apertura de la primera letra. */
    expect(texto).toMatch(/« ?The Fund's investment objective is to provide long-term growth of capital\.»/);
  }, 20_000);

  /* El pie de cada hoja es ahora el de la plantilla (sello, advertencia y número); el nombre, el ISIN, cuándo, con qué datos y para
     quién pasan a la presentación de la primera hoja, con el formato común de fecha y hora. */
  test("la primera hoja dice el nombre, el ISIN, cuándo, con qué datos y para quién; cada hoja, su número", async () => {
    const { hojas } = await leer(entrada(FONDO, false));
    expect(hojas.length).toBeGreaterThanOrEqual(1);
    const primera = hojas[0].replace(/\s+/g, " ");
    expect(primera).toContain("Capital Group New Perspective Fund (LUX) B");
    expect(primera).toContain("LU1295551144");
    expect(primera).toContain("Generado el 09/11/2026 21:52 · base de datos del 09/11/2026 · modo interno");
    hojas.forEach((hoja, indice) => expect(hoja).toContain(`Página ${indice + 1} de ${hojas.length}`));
  }, 20_000);

  test("la evolución se dibuja si la ficha la tiene cargada, con su procedencia y su variación; si no, no hay sección", async () => {
    const con = (await leer(entrada(FONDO, false, { evolucion: EVOLUCION }))).texto;
    expect(con).toContain("Evolución histórica");
    expect(con).toContain("Base 100 · diaria · EUR · 5 observaciones · oct 2023 – oct 2026");
    expect(con).toContain("Variación del periodo");
    expect(con).toContain("+57,9 %");
    const sin = (await leer(entrada(FONDO, false, { evolucion: null }))).texto;
    expect(sin).not.toContain("Evolución histórica");
    /* Una clase que reparte: se dibuja y no lleva variación, como en pantalla. */
    const sinVariacion = (await leer(entrada(FONDO, false, { evolucion: { ...EVOLUCION, variacion: undefined } }))).texto;
    expect(sinVariacion).toContain("Evolución histórica");
    expect(sinVariacion).not.toContain("Variación del periodo");
  }, 30_000);
});

describe("A-124. En Modo cliente, lo que el modelo de Modo cliente trae", () => {
  const TEXTOS_DEL_EMISOR = ["Valor liquidativo del emisor", "Lo que dice el emisor", "Comisión de swap", "Para quién está pensado"];

  test("el modelo de Modo cliente no tiene secciones del emisor, y el papel tampoco", async () => {
    const interno = await leer(entrada(ETF, false));
    for (const texto of TEXTOS_DEL_EMISOR) expect(interno.texto, texto).toContain(texto);
    const cliente = await leer(entrada(ETF, true));
    expect(cliente.texto).toContain("Invesco S&P 500 UCITS ETF");
    for (const texto of TEXTOS_DEL_EMISOR) expect(cliente.texto, texto).not.toContain(texto);
    expect(cliente.texto).not.toMatch(/Invesco\)|issuer:invesco/);
  }, 30_000);

  /* Para quién es lo dicen la presentación y el tema: «CONFIDENCIAL» en el de cliente, «USO INTERNO» y «No entregar al cliente» en el interno. */
  test("la presentación dice para quién es, y la cabecera solo dice «uso interno» en el interno", async () => {
    const cliente = (await leer(entrada(FONDO, true))).texto;
    expect(cliente).toContain("Generado el 09/11/2026 21:52 · base de datos del 09/11/2026 · para el cliente");
    expect(cliente).not.toMatch(/uso interno|No entregar al cliente/i);
    expect(cliente).toContain("Ficha de activo CONFIDENCIAL");
    expect(cliente).not.toContain("Procedencia y calidad");
    const interno = (await leer(entrada(FONDO, false))).texto;
    expect(interno).toContain("Ficha de activo USO INTERNO No entregar al cliente");
  }, 30_000);
});

describe("A-126. El papel de cliente no lleva lo que habla al asesor", () => {
  /* La tira lleva ahora el título de sección de la plantilla, sin número: «Qué puedes hacer con él», en minúsculas. */
  const DE_LA_TIRA = ["Qué puedes hacer con él", "Entrar en una radiografía", "Métricas nuestras", "Compararlo con sus pares"];

  test("la tira «Qué puedes hacer con él» sale en el interno y no en el de cliente", async () => {
    const interno = (await leer(entrada(FONDO, false))).texto;
    for (const texto of DE_LA_TIRA) expect(interno, texto).toContain(texto);
    const cliente = (await leer(entrada(FONDO, true))).texto;
    for (const texto of DE_LA_TIRA) expect(cliente, texto).not.toContain(texto);
    /* Lo que la tira resumía sigue en su sección: no se pierde ninguna cifra. */
    expect(cliente).toContain("Coste");
    expect(cliente).toContain("1,59 %");
  }, 30_000);

  test("«Disponibilidad · Sin medir» sale en el interno y no en el de cliente", async () => {
    const interno = (await leer(entrada(FONDO, false))).texto;
    expect(interno).toContain("Disponibilidad");
    expect(interno).toContain("Sin medir");
    const cliente = (await leer(entrada(FONDO, true))).texto;
    expect(cliente).not.toContain("Disponibilidad");
    expect(cliente).not.toContain("Sin medir");
  }, 30_000);

  test("que cotiza o que dejó de cotizar es un hecho del instrumento, y se queda en los dos", async () => {
    const conEstado = (availability: Record<string, unknown>) =>
      ({ ...FONDO, raiz: { ...(FONDO.raiz as Record<string, unknown>), availability } }) as unknown as InstrumentoDeLaBase;
    const cotiza = componerFicha(conEstado({ state: "TRADING", last_checked: "2026-11-09" }), undefined, { modoCliente: true, hoy: HOY });
    expect(loQueLlevaLaCabecera(cotiza, true)).toEqual({ conTira: false, conDisponibilidad: true });
    const baja = conEstado({ state: "DELISTED", since: "2026-06-30" });
    expect(loQueLlevaLaCabecera(componerFicha(baja, undefined, { modoCliente: true, hoy: HOY }), true).conDisponibilidad).toBe(true);
    const cliente = (await leer(entrada(baja, true))).texto;
    expect(cliente).toContain("Dejó de cotizar");
    /* Y en el interno, todo como estaba. */
    expect(loQueLlevaLaCabecera(componerFicha(FONDO, undefined, { hoy: HOY }), false)).toEqual({ conTira: true, conDisponibilidad: true });
  }, 30_000);
});

describe("A-124. Lo que el papel decide por su cuenta, que es poco", () => {
  /* Desde el 14-11-2026, con la convención común de los ficheros (ANA-19, INF-25): «Ficha de activo - <activo> - <AAAA-MM-DD>.pdf». La de
     la pantalla normal es de uso interno y lo dice; la del Modo cliente es la que se entrega. Antes: «Ficha_<ISIN>_<fecha>[_cliente].pdf». */
  test("el nombre del fichero: el documento, el activo (o su ISIN) y el día; la de la pantalla normal, de uso interno", () => {
    expect(nombreDelFicheroDeLaFicha({ isin: "LU1295551144", generado: GENERADO, modoCliente: false })).toBe("Ficha de activo (uso interno) - LU1295551144 - 2026-11-09.pdf");
    expect(nombreDelFicheroDeLaFicha({ ficha: { nombre: "Fondo de prueba" }, isin: "LU1295551144", generado: GENERADO, modoCliente: true })).toBe("Ficha de activo - Fondo de prueba - 2026-11-09.pdf");
  });

  test("sin fecha de la ficha, el pie lo dice", () => {
    /* Con el formato común de fecha y hora (antes, «9 nov 2026, 21:52»). */
    expect(lineaDelPie({ generado: GENERADO, modoCliente: false })).toBe("Generado el 09/11/2026 21:52 · base de datos sin fecha · modo interno");
  });

  test("las del flujo de columnas, de dos en dos y en su orden; después las anchas", () => {
    const ficha = componerFicha(FONDO, undefined, { hoy: HOY });
    const bloques = bloquesDelPapel(ficha);
    const leidas = bloques.flatMap((bloque) => ("ancha" in bloque ? [bloque.ancha.id] : bloque.estrechas.map((s) => s.id)));
    expect(leidas).toEqual([...ficha.secciones.filter((s) => !s.ancha), ...ficha.secciones.filter((s) => s.ancha)].map((s) => s.id));
    for (const bloque of bloques) if (!("ancha" in bloque)) expect(bloque.estrechas.length).toBeLessThanOrEqual(2);
  });

  test("las marcas del eje: pasos redondos que cubren la serie", () => {
    expect(marcasDelEje(98, 158)).toEqual([80, 100, 120, 140, 160]);
    expect(marcasDelEje(100, 112)).toEqual([100, 105, 110, 115]);
    expect(marcasDelEje(100, 109)).toEqual([100, 102.5, 105, 107.5, 110]);
    expect(marcasDelEje(100, 100)).toEqual([100]);
  });

  test("cada línea es una sola cadena, y no hay cursivas, que el papel no puede imprimir", () => {
    const codigo = readFileSync("src/reports/fichaDeActivoPdf.tsx", "utf8");
    const fuente = ts.createSourceFile("fichaDeActivoPdf.tsx", codigo, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const conVariosTramos: string[] = [];
    const visitar = (nodo: ts.Node): void => {
      /* Desde la plantilla el texto se escribe con su `Texto`; la regla es la misma. */
      if (ts.isJsxElement(nodo) && ["Text", "Texto"].includes(nodo.openingElement.tagName.getText())) {
        const tramos = nodo.children.filter((hijo) => !(ts.isJsxText(hijo) && hijo.containsOnlyTriviaWhiteSpaces));
        if (tramos.length > 1) conVariosTramos.push(nodo.getText());
      }
      ts.forEachChild(nodo, visitar);
    };
    visitar(fuente);
    expect(conVariosTramos).toEqual([]);
    /* Newsreader no trae cursiva: pedirla rompe el documento. */
    expect(codigo).not.toMatch(/fontStyle/);
  });
});

/*
 * Decisión A-128 (09-11-2026): los pesos de la ficha se aprobaron sobre el papel de antes, con Newsreader e Instrument Sans y
 * nueve estilos. Desde la plantilla única (14-11-2026) la ficha escribe con las dos tipografías de la plantilla, que solo traen
 * 400 y 600: un peso que no tiene cara saldría con la de otro. Esto vigila que la ficha no pida ninguno más y que el PDF lleve una
 * cara por peso.
 */
/* Desde el 14-11-2026 las caras de la plantilla son las seis de Fraunces (300, 400, 600) y Roboto Flex (400, 500, 600). */
const CARAS_DE_LA_PLANTILLA = ["Fraunces-Light", "Fraunces-Regular", "Fraunces-SemiBold", "RobotoFlex-Regular", "RobotoFlex-Medium", "RobotoFlex-SemiBold"];

describe("A-128. La ficha lleva los pesos que tiene la plantilla, y ninguno más", () => {
  test("los pesos que pide son 400 o 600", () => {
    const codigo = readFileSync("src/reports/fichaDeActivoPdf.tsx", "utf8");
    const pesos = [...codigo.matchAll(/fontWeight:\s*(\d+)/g)].map((m) => Number(m[1]));
    expect(pesos.length).toBeGreaterThan(0);
    for (const peso of pesos) expect([400, 600]).toContain(peso);
  });

  test("el papel generado incrusta una cara por peso, en el interno y en el de cliente", async () => {
    for (const cliente of [false, true]) {
      const caras = extractPdfFontFaces((await leer(entrada(FONDO, cliente))).bytes);
      for (const cara of caras) expect(CARAS_DE_LA_PLANTILLA).toContain(cara);
      expect(new Set(caras).size).toBe(caras.length);
    }
  }, 30_000);

  test("un título de sección no se parte con guion", async () => {
    /* El título más largo, «Para quién está pensado (según el fabricante)», baja de línea por un espacio: el `Texto` de la plantilla no parte palabras. */
    const { texto } = await leer(entrada(ETF, false));
    expect(texto).toContain("Para quién está pensado (según el fabricante)");
    expect(texto).not.toMatch(/fabri-/);
  }, 30_000);
});

describe("Los títulos de sección, con la pieza de la plantilla", () => {
  /*
   * Hasta la plantilla única esto vigilaba que cada título cupiera en una línea a 12 pt y que las hojas fueran 2 y 1. Ahora el
   * título lo pone `TituloDeSeccion` (numerado, con su filete y su procedencia), y en una columna el más largo baja a una segunda
   * línea por un espacio. Se vigila que cada título salga entero y que las hojas de cada caso no cambien sin querer: la cabecera de
   * la plantilla es más alta que la banda de antes, y el fondo de cliente pasa de 1 a 2 hojas (medido el 14-11-2026).
   */
  const CASOS: Array<[string, InstrumentoDeLaBase, boolean, number]> = [
    ["fondo interno", FONDO, false, 2],
    ["fondo de cliente", FONDO, true, 2],
    ["ETF interno", ETF, false, 2],
    ["ETF de cliente", ETF, true, 1]
  ];

  test("el título de sección es el de la plantilla, no un estilo propio", () => {
    const codigo = readFileSync("src/reports/fichaDeActivoPdf.tsx", "utf8");
    expect(codigo).toMatch(/<TituloDeSeccion /);
    expect(codigo).not.toMatch(/titulo: \{ fontFamily/);
  });

  test.each(CASOS)("%s: cada título sale entero y el número de hojas no cambia", async (_nombre, instrumento, modoCliente, hojas) => {
    const input = entrada(instrumento, modoCliente);
    const bytes = Buffer.from(await (await createFichaDeActivoPdfBlob(input)).arrayBuffer());
    /* El lector pierde las ligaduras «fi» y «fl». */
    const sinLigaduras = (cadena: string) => cadena.replace(/f[il]/g, "").replace(/\s+/g, " ").trim();
    const texto = sinLigaduras(extractPdfPageTexts(bytes).join(" "));
    for (const seccion of input.ficha.secciones) expect(texto, seccion.titulo).toContain(sinLigaduras(seccion.titulo));
    expect(extractPdfPageTexts(bytes)).toHaveLength(hojas);
  }, 30_000);

  test("con la evolución y su gráfico, tres hojas", async () => {
    expect((await leer(entrada(FONDO, false, { evolucion: EVOLUCION }))).hojas).toHaveLength(3);
  }, 30_000);
});
