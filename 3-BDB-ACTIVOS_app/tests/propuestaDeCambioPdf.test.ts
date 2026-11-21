/**
 * La Propuesta de cambio en papel: se lee el TEXTO del PDF generado, no el código que lo escribe. Lo que el documento debe decir, lo
 * que no debe decir nunca (que la propuesta es mejor, A y B, retrocesiones) y que no se sale de sus hojas.
 */
import { describe, expect, test } from "vitest";
import { propuestaDeCambio, type EntradaDeLaPropuesta } from "../src/core/propuestaDeCambio";
import { SIN_COMISIONES_NI_IMPUESTOS } from "../src/core/textosDeCartera";
import { celdaDeCrisis, createPropuestaDeCambioPdfBlob } from "../src/reports/propuestaDeCambioPdf";
import { ACTIVOS, ACTUAL, activo, crisisConCifra, escenario, historia, PROPUESTA, SERIE_ACTUAL, SERIE_PROPUESTA } from "./support/propuestaFixtures";
import { extractPdfLanguage, extractPdfMetadata, extractPdfPageTexts, extractPdfTextBaselines } from "./support/pdfText";

const IDS_ACTUAL = ["LU0000000001", "LU0000000002"];
const IDS_PROPUESTA = ["LU0000000001", "LU0000000003", "ES0144580Y14"];

const conCrisis = (ids: readonly string[], serie: typeof SERIE_ACTUAL, covid: number, tipos: number) =>
  historia(ids, serie, { stress_scenarios: [crisisConCifra("COVID", covid), crisisConCifra("RATES_2022", tipos), escenario("COMMON_HISTORY")] });

const entrada = (cambios: Partial<EntradaDeLaPropuesta> = {}): EntradaDeLaPropuesta => ({
  actual: ACTUAL,
  propuesta: PROPUESTA,
  periodo: "3Y",
  historiaActual: conCrisis(IDS_ACTUAL, SERIE_ACTUAL, -20.57, -14.87),
  historiaPropuesta: conCrisis(IDS_PROPUESTA, SERIE_PROPUESTA, -24.1, -11.2),
  assets: ACTIVOS,
  capital: 100000,
  cliente: "Ana Ruiz",
  motivo: "Bajar el coste corriente.",
  generadoEn: "2026-11-05T09:00:00Z",
  ...cambios
});

async function hojasDe(cambios: Partial<EntradaDeLaPropuesta> = {}) {
  const bytes = Buffer.from(await (await createPropuestaDeCambioPdfBlob(propuestaDeCambio(entrada(cambios)))).arrayBuffer());
  const hojas = extractPdfPageTexts(bytes);
  return { bytes, hojas, texto: hojas.join(" ").replace(/\s+/g, " ") };
}

/* Como se lee: el espacio duro del «€» y el salto de línea no cuentan. */
const leido = (texto: string) => texto.replaceAll("\u00a0", " ");

describe("lo que dice", () => {
  test("todo, y en este orden: lo que pide la decisión 32", async () => {
    const { texto } = await hojasDe();
    const orden = [
      "Propuesta de cambio",
      "Para Ana Ruiz",
      "Qué cambia, posición a posición",
      "Rentabilidad, volatilidad y caída",
      "Cómo se habrían comportado en crisis pasadas",
      "Coste corriente",
      "Motivo de la propuesta",
      "Plan de ejecución",
      SIN_COMISIONES_NI_IMPUESTOS,
      "Simulación: no es una recomendación"
    ];
    let hasta = -1;
    for (const trozo of orden) {
      const donde = texto.indexOf(trozo, hasta + 1);
      expect(donde, `falta o está fuera de orden: ${trozo}`).toBeGreaterThan(hasta);
      hasta = donde;
    }
  }, 30_000);

  test("con la muestra, tres hojas y cada una con su pie, su sello y su total", async () => {
    const { hojas } = await hojasDe();
    expect(hojas).toHaveLength(3);
    hojas.forEach((hoja, i) => {
      expect(hoja).toContain(`Página ${i + 1} de 3`);
      /* Desde la plantilla única (14-11-2026): el nombre del documento y el sello, en la cabecera y en el pie; antes, el pie decía
         «Independent Private Bankers · Propuesta de cambio · Confidencial». */
      expect(hoja).toContain("Propuesta de cambio");
      expect(hoja).toContain("CONFIDENCIAL");
      expect(hoja).not.toContain("Independent");
    });
  }, 30_000);

  test("Actual y Propuesta, rótulos fijos, y no A y B", async () => {
    const { texto } = await hojasDe();
    expect(texto).not.toMatch(/\b(Cartera|Peso) [AB]\b|B − A|B menos A/);
    expect(texto).toContain("Diferencia: Propuesta menos Actual");
  }, 30_000);

  test("las cifras calculadas a mano: pesos, diferencias, coste y plan", async () => {
    const { texto } = await hojasDe();
    const leer = leido(texto);
    expect(leer).toContain("Fondo B");
    expect(leer).toContain("40,00 %");
    expect(leer).toContain("−40,00");
    expect(leer).toContain("0,80 % al año");
    expect(leer).toContain("0,56 % al año");
    expect(leer).toContain("800,00 €");
    expect(leer).toContain("560,00 €");
    expect(leer).toContain("−240,00 €");
    expect(leer).toContain("40.000 €");
    expect(leer).toContain("50.000 €");
    expect(leer).toContain("−20,57 %");
    expect(leer).toContain("−24,10 %");
  }, 30_000);

  test("una acción: «No aplica» en su fila, y cuenta como cero en la media con su nota", async () => {
    const { texto } = await hojasDe();
    expect(texto).toContain("No aplica");
    expect(texto).toContain("en la media cuenta como cero");
    expect(texto).toContain("No incluye: custodia, intermediación, cambio de divisa, comisión de éxito, comisiones de entrada (suscripción) y salida (reembolso) ni impuestos.");
  }, 30_000);

  test("si una cifra sale en parte de un tramo estimado, la cabecera lo dice; y el coste deja fuera los costes de operación, con las palabras del interno", async () => {
    const conTramo = await hojasDe({ historiaPropuesta: historia(IDS_PROPUESTA, SERIE_PROPUESTA, {}, ["LU0000000003: tramo estimado con MSCI World, del 2023-01-02 al 2024-06-30."]) });
    expect(conTramo.texto).toMatch(/Cifra · estimado|CIFRA · ESTIMADO/);
    const sinTramo = await hojasDe();
    expect(sinTramo.texto).not.toMatch(/Cifra · estimado|CIFRA · ESTIMADO/);
    expect(sinTramo.texto).toContain("No incluye costes de operación. No incluye: custodia, intermediación, cambio de divisa, comisión de éxito, comisiones de entrada (suscripción) y salida (reembolso) ni impuestos.");
  }, 30_000);

  test("la línea de comisiones e impuestos es la de la decisión 45, de su único sitio", async () => {
    const { texto } = await hojasDe();
    expect(SIN_COMISIONES_NI_IMPUESTOS).toBe("No incluye comisiones de entrada (suscripción) o salida (reembolso) ni impuestos por el cambio.");
    expect(texto).toContain(SIN_COMISIONES_NI_IMPUESTOS);
  }, 30_000);

  test("lo que no se puede simular se dice, y no hay ceros ni rayas", async () => {
    const { texto } = await hojasDe({ historiaPropuesta: null });
    expect(texto).toContain("Falta el dato");
    expect(texto).toContain("Propuesta: ninguna de sus posiciones tiene serie");
    expect(texto).not.toContain(" — ");
    expect(texto).not.toContain("N/D");
  }, 30_000);
});

describe("«Elaborado por» (decisión A-64)", () => {
  /* Desde la plantilla única (14-11-2026) quien elabora el documento va en el membrete de cada hoja, a la izquierda de la cabecera, y no en
     una línea «Elaborado por…» de la portada, que ya no existe. Se mira la cabecera: el nombre y, debajo, el contacto. */
  const membrete = (bytes: Buffer, hoja = 0) => extractPdfTextBaselines(bytes)[hoja].filter((c) => c.y < 60).map((c) => c.texto.trim());

  test("con nombre y correo, en el membrete de cada hoja", async () => {
    const { bytes, hojas } = await hojasDe({ responsable: { name: "Marta López", email: "marta@ejemplo.es" } });
    hojas.forEach((_, i) => {
      expect(membrete(bytes, i)).toContain("Marta López");
      expect(membrete(bytes, i)).toContain("marta@ejemplo.es");
    });
    expect(hojas.join(" ")).not.toContain("Elaborado por");
  }, 30_000);

  test("con solo el nombre o solo el correo, lo que haya", async () => {
    const soloNombre = await hojasDe({ responsable: { name: "Marta López", email: "" } });
    expect(membrete(soloNombre.bytes)).toContain("Marta López");
    expect(soloNombre.hojas[0]).not.toContain("marta@");
    const soloCorreo = await hojasDe({ responsable: { name: "  ", email: "marta@ejemplo.es" } });
    expect(membrete(soloCorreo.bytes)).toContain("marta@ejemplo.es");
  }, 30_000);

  test("vacío, no sale ni el rótulo: la misma línea vacía que el informe de cliente", async () => {
    const { texto, hojas } = await hojasDe({ responsable: { name: "   ", email: "" } });
    expect(texto).not.toMatch(/elaborado por/i);
    expect(hojas).toHaveLength(3);
  }, 30_000);

  /* INF-01: ningún nombre de persona escrito en el código; el responsable por defecto lo pone el diálogo, con el nombre de la cuenta. */
  test("sin campo, sin firma, como el informe de cliente", async () => {
    const { texto } = await hojasDe();
    expect(texto).not.toMatch(/elaborado por/i);
    expect(texto).not.toContain("Antiza");
  }, 30_000);

  test("no le quita sitio a la tabla: con firma salen las mismas hojas y ninguna fila sin su encabezado", async () => {
    const sin = await hojasDe({ responsable: { name: "", email: "" } });
    const con = await hojasDe({ responsable: { name: "Nombre muy largo de una asesora ".repeat(3).trim(), email: "correo-de-la-asesora@una-asesoria-con-un-dominio-largo.es" } });
    expect(con.hojas).toHaveLength(sin.hojas.length);
  }, 30_000);
});

describe("lo que no dice nunca", () => {
  test("ninguna frase valora, ni dice que la propuesta es mejor", async () => {
    const { texto } = await hojasDe();
    /* «ni es la peor pérdida posible» dice lo que una cifra no es: no compara nada. */
    expect(texto.replace("ni es la peor pérdida posible", "")).not.toMatch(/mejor|peor|conviene|recomendamos|excelente|ventaja|superior|óptim|atractiv/i);
  }, 30_000);

  test("no lleva retrocesiones, ni ingresos, ni jerga", async () => {
    const { texto } = await hojasDe();
    expect(texto).not.toMatch(/retroces|ingreso|cesión|CAGR|benchmark|Sharpe|backend|Monte Carlo/i);
  }, 30_000);

  test("sin motivo no sale: nada lo escribe por el asesor", () => {
    expect(() => propuestaDeCambio(entrada({ motivo: "" }))).toThrow();
  });
});

describe("el motivo y las notas, tal cual", () => {
  /* Las fuentes de la plantilla (IBM Plex Sans y Source Serif 4, subconjunto latino) no tienen «č», «→» ni «≈», que Roboto Flex sí tenía:
     `sanearTexto` las cambia por su lectura y nunca deja un hueco. Antes se esperaba «Komerční … 5,5 % → 0 %» y «≈ 12 €» tal cual. */
  test("con sus saltos de línea, sus acentos, sus cifras y, lo que estas fuentes no tienen, con su lectura", async () => {
    const motivo = "Komerční banka sale de la cartera: 5,5 % → 0 %.\n\nEl «Fondo Ñ» ≈ 12 € por participación.";
    const { hojas } = await hojasDe({ motivo });
    const hoja = hojas[2];
    expect(hoja).toContain("Komercní banka sale de la cartera: 5,5 % a 0 %.");
    expect(hoja).toContain("El «Fondo Ñ» aprox. 12 € por participación.");
  }, 30_000);

  test("lo que no tiene letra en estas fuentes no deja un hueco", async () => {
    const { hojas } = await hojasDe({ motivo: "Cerrar 日本 antes del cierre del año." });
    expect(hojas[2]).toContain("Cerrar");
    expect(hojas[2]).toContain("(sin transcripción latina)");
    expect(hojas[2]).toContain("antes del cierre del año.");
  }, 30_000);

  test("las notas sobre la ejecución salen solo si se han escrito, y un nombre sin transcripción lleva su código", async () => {
    const sin = await hojasDe();
    expect(sin.texto).not.toContain("Notas de su asesor");
    const con = await hojasDe({ notasDelPlan: "Ejecutar por tramos: primero las salidas." });
    expect(con.texto).toContain("Notas de su asesor sobre la ejecución:");
    expect(con.texto).toContain("Ejecutar por tramos: primero las salidas.");
  }, 30_000);

  /* Roboto Flex tenía cirílico; las fuentes de la plantilla no. El nombre no desaparece en silencio: se dice que no tiene transcripción, y su
     código sigue debajo. Antes se esperaba «Сбербанк» tal cual. */
  test("un nombre en otro alfabeto no deja un hueco: lo dice, y su código sigue", async () => {
    const { texto } = await hojasDe({
      assets: [...ACTIVOS.filter((a) => a.asset_id !== "LU0000000003"), activo("LU0000000003", "Сбербанк", 0.002)]
    });
    /* El lector de texto de las pruebas mete un espacio tras el paréntesis. */
    expect(texto).toMatch(/\( ?sin transcripción latina\)/);
    expect(texto).toContain("LU0000000003");
  }, 30_000);
});

describe("con capital y sin capital", () => {
  test("sin capital: ningún importe en el plan, y dicho una sola vez", async () => {
    const { texto } = await hojasDe({ capital: null });
    expect(texto.split("este documento va en porcentajes").length - 1).toBe(1);
    expect(texto).not.toContain("Importe");
    expect(texto).not.toContain("50.000");
    expect(texto).not.toContain("100.000");
    /* Los euros por cada 10.000 € son una escala para leer un porcentaje: los escribe el informe de costes. */
    expect(leido(texto)).toContain("unos 80 € por cada 10.000 €");
  }, 30_000);

  test("con capital: se dice cuál, y los importes son sobre él", async () => {
    const { texto } = await hojasDe();
    expect(leido(texto)).toContain("Capital de la composición Actual: 100.000,00 €.");
    expect(texto).toContain("Importe");
    expect(texto).toContain("Importes sobre el capital de la composición Actual");
    expect(texto).not.toContain("este documento va en porcentajes");
  }, 30_000);
});

describe("sin cliente, y sin salirse de las hojas", () => {
  test("sin cliente no hay «Para», ni en el papel ni en los metadatos", async () => {
    const { texto, bytes } = await hojasDe({ cliente: "" });
    expect(texto).not.toContain("Para ");
    expect(extractPdfMetadata(bytes, "Title")).toBe("Propuesta de cambio");
    /* El autor es el asesor, y sin asesor no hay autor; antes era «Independent Private Bankers». */
    expect(extractPdfMetadata(bytes, "Author")).toBeNull();
  }, 30_000);

  /* Las dos letras de la plantilla. Desde el 14-11-2026 (decisión de Óscar: recuperar el aspecto de los informes de antes) la plantilla vuelve a Fraunces y Roboto Flex; IBM Plex Sans y Source Serif 4, las de la plantilla de una sola tinta, salieron. */
  test("el tipo de letra es el de la plantilla, y ninguno de los retirados", async () => {
    const { bytes } = await hojasDe();
    const crudo = bytes.toString("latin1");
    expect(crudo).toMatch(/RobotoFlex/);
    expect(crudo).toMatch(/Fraunces/);
    expect(crudo).not.toMatch(/IBMPlexSans|SourceSerif4|InstrumentSans|Newsreader/);
  }, 30_000);

  test("nueve filas con los nombres de la base y un nombre de cartera en dos líneas: la tabla cabe en la portada y no abre una hoja para la última", async () => {
    /* El caso de la revisión final (V2-1): Global Brands 60 y JPMorgan 40 frente a la muestra. Antes salían 4 hojas, la 2 con Goldman sola. */
    const nombres: Array<[string, string]> = [
      ["LU2295319300", "Morgan Stanley Investment Funds - Global Brands Fund A (EUR)"],
      ["LU0430492750", "JPMorgan Funds - Euro Aggregate Bond Fund C (acc) EUR"],
      ["IE00B4L5Y983", "iShares Core MSCI World UCITS ETF USD (Acc)"],
      ["IE00B11XZ103", "PIMCO GIS Global Bond Fund E Class EUR (Hedged) Accumulation"],
      ["IE00B3XXRP09", "Vanguard S&P 500 UCITS ETF"],
      ["LU1883318740", "Amundi Funds - Global Equity Responsible A EUR (C)"],
      ["FR0013367265", "R-co Valor Balanced C EUR"],
      ["LU0329355670", "Robeco QI Emerging Markets Active Equities D €"],
      ["LU1103307408", "Goldman Sachs Absolute Return Tracker Portfolio Other Currency Acc EUR-Hedged"]
    ];
    const activos = nombres.map(([id, nombre]) => activo(id, nombre, 0.01));
    const actual = [{ asset_id: "LU2295319300", weight_percent: 60 }, { asset_id: "LU0430492750", weight_percent: 40 }];
    const propuesta = [["IE00B4L5Y983", 24], ["IE00B11XZ103", 20], ["IE00B3XXRP09", 12], ["LU0430492750", 10], ["LU1883318740", 10], ["FR0013367265", 9], ["LU0329355670", 8], ["LU1103307408", 7]]
      .map(([asset_id, weight_percent]) => ({ asset_id: asset_id as string, weight_percent: weight_percent as number }));
    const { hojas } = await hojasDe({
      actual: { name: "Prueba V2 Global Brands 60 JPMorgan 40", positions: actual },
      propuesta: { name: "Prueba V2 muestra", positions: propuesta },
      assets: activos,
      capital: null,
      historiaActual: historia(actual.map((p) => p.asset_id), SERIE_ACTUAL),
      historiaPropuesta: historia(propuesta.map((p) => p.asset_id), SERIE_PROPUESTA)
    });
    expect(hojas).toHaveLength(3);
    expect(hojas.join(" ")).not.toContain("continuación");
    for (const [id] of nombres) expect(hojas[0], id).toContain(id);
    expect(hojas[0]).toContain("Total");
    expect(hojas[0]).toContain("Cambia de posición el 90,00 % de la cartera");
  }, 30_000);

  test("con 28 posiciones de nombres largos, ninguna fila queda sin el encabezado de su tabla", async () => {
    const muchos = Array.from({ length: 28 }, (_, i) => activo(`LU10000000${String(i).padStart(2, "0")}`, i % 3 === 0 ? `Un fondo de nombre muy largo con clase institucional acumulativa en euros cubierta número ${i}` : `Fondo global ${i}`, 0.01));
    const a = muchos.slice(0, 16).map((m, i) => ({ asset_id: m.asset_id, weight_percent: 100 / 16 + (i === 0 ? 1 : i === 1 ? -1 : 0) }));
    const b = muchos.slice(8).map((m) => ({ asset_id: m.asset_id, weight_percent: 5 }));
    const { hojas } = await hojasDe({
      actual: { name: "Una cartera con un nombre bastante largo, para ver si se come el sitio de la tabla en su portada", positions: a },
      propuesta: { name: "Propuesta", positions: b },
      assets: muchos,
      historiaActual: historia(a.map((p) => p.asset_id), SERIE_ACTUAL),
      historiaPropuesta: historia(b.map((p) => p.asset_id), SERIE_PROPUESTA),
      motivo: "Un motivo largo. ".repeat(70).trim()
    });
    hojas.forEach((hoja, i) => {
      expect(hoja, `hoja ${i + 1}`).toContain(`Página ${i + 1} de ${hojas.length}`);
      /* Una fila de la tabla lleva siempre un ISIN. Donde hay filas, está su encabezado. */
      if (/LU10000000\d\d/.test(hoja)) expect(hoja, `hoja ${i + 1}`).toMatch(/POSICIÓN|OPERACIÓN/i);
    });
    const todas = hojas.join(" ");
    for (const m of muchos) expect(todas).toContain(m.asset_id);
  }, 60_000);
});

describe("decisión B-78: una posición cuyos datos se quedaron en una fecha", () => {
  test("va entre las notas de las cifras, con su nombre y su fecha, sin una hoja más; sin ninguna, nada", async () => {
    const sin = await hojasDe();
    const con = await hojasDe({ seriesParadas: new Map([["LU0000000002", "2025-11-28"]]) });
    expect(con.hojas).toHaveLength(sin.hojas.length);
    expect(con.texto).toContain("Fondo B: sus datos llegan hasta el 28/11/2025.");
    expect(sin.texto).not.toContain("sus datos llegan hasta");
    expect(con.texto).not.toMatch(/serie parada/i);
  }, 30_000);

  test("solo de las posiciones de las dos composiciones", () => {
    const modelo = propuestaDeCambio(entrada({ seriesParadas: new Map([["OTRO", "2025-11-28"]]) }));
    expect(modelo.cifras.notas.join(" ")).not.toContain("sus datos llegan hasta");
  });
});

describe("la cifra de una crisis, en tinta (14-11-2026)", () => {
  /* El informe de cliente, el interno y la pantalla la escriben en tinta: es una medida de riesgo, como la caída máxima. Antes, en rojo. */
  test("ninguna celda de una crisis lleva el color de un signo", () => {
    const modelo = propuestaDeCambio(entrada());
    const celdas = modelo.crisis.filas.flatMap((fila) => [celdaDeCrisis(fila.actual), celdaDeCrisis(fila.propuesta)]);
    expect(celdas.some((celda) => typeof celda === "object" && celda !== null && celda.texto?.startsWith("−"))).toBe(true);
    for (const celda of celdas) expect(typeof celda === "object" && celda !== null ? celda.signo : undefined).toBeUndefined();
    expect(celdaDeCrisis({ cifra: "+3,10\u00a0%", lineas: ["Mide el 100,0\u00a0%"] } as Parameters<typeof celdaDeCrisis>[0])).toEqual({ texto: "+3,10\u00a0%", apunte: "Mide el 100,0\u00a0%" });
  });
});

describe("INF-24: los metadatos del documento", () => {
  test("el idioma es «es» y el autor es el asesor que lo elabora", async () => {
    const { bytes } = await hojasDe({ responsable: { name: "Marta López", email: "marta@ejemplo.es" } });
    expect(extractPdfLanguage(bytes)).toBe("es");
    expect(extractPdfMetadata(bytes, "Author")).toBe("Marta López");
  }, 30_000);
});
