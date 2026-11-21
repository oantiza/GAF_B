import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, test } from "vitest";
import { numero } from "../src/core/formato";
import {
  caidaEnPantalla,
  cifrasEnPantalla,
  estadoDeLosDatos,
  etiquetaDeCodigo,
  ETIQUETAS_DE_METRICA,
  textoEnPantalla,
  ventanaEnPalabras
} from "../src/core/glosarioDePantalla";
import { COVERAGE_LABELS, METRIC_KEY_LABELS, QUALITY_FLAG_LABELS } from "../src/core/labels";
import { resumenDeLaMejoraEnPantalla, improvementSummary } from "../src/core/portfolioImprovement";
import type { ImprovementResponse } from "../src/adapters/improvePortfolioBackend";

/**
 * El glosario de pantalla (decisión 28 de Óscar): una palabra por concepto, sin mover el papel.
 * Los textos de entrada son los que hoy escriben los módulos compartidos con los PDF, literales.
 */

describe("lo que el papel escribe, en palabras de la pantalla", () => {
  /* El «%» que pone `textoEnPantalla` va tras un espacio que no parte la línea (MAR-26): antes era uno normal. */
  test.each([
    ["La suma de pesos está por debajo de 100%.", "La suma de pesos está por debajo del 100\u00a0%."],
    ["La suma de pesos supera 100%.", "La suma de pesos supera el 100\u00a0%."],
    ["Metricas parciales (60% de la cartera).", "Métricas parciales (60\u00a0% de la cartera)."],
    ["IE00B4L5Y983 es benchmark/no invertible y no contribuye a métricas ni allocation invertible.", "IE00B4L5Y983 es un índice o no es invertible, y no entra en las métricas ni en el reparto."],
    ["MSCI World es INDEX/benchmark y no puede optimizarse como posición invertible.", "MSCI World es un índice y no se puede optimizar como posición invertible."],
    ["Fondo X no es invertible según el contrato local.", "Fondo X no es invertible."],
    ["LU000 no existe en la fuente de datos activa.", "LU000 no está en el catálogo."],
    ["Fondo X tiene limites incompatibles.", "Fondo X tiene límites incompatibles."],
    ["Todas las posiciones estan fijadas y la suma no llega al objetivo.", "Todas las posiciones están fijadas y la suma no llega al objetivo."],
    ["Candados y minimos dejan la cartera por encima del 100%.", "Candados y mínimos dejan la cartera por encima del 100\u00a0%."],
    ["Candados y maximos no permiten alcanzar el 100%.", "Candados y máximos no permiten alcanzar el 100\u00a0%."],
    ["Los pesos fijados superan el 100% disponible.", "Los pesos fijados superan el 100\u00a0% disponible."],
    ["Sin ficha cargada en la fuente activa.", "Sin ficha cargada en el catálogo."],
    ["Aviso de datos: activo no encontrado en la fuente local.", "Aviso de datos: activo no encontrado en el catálogo."],
    ["Sin serie de precios en la maestra", "Sin serie de precios"],
    ["Backend anterior: tasa libre de riesgo no disponible.", "Versión anterior del servidor: tipo sin riesgo no disponible."],
    ["Alta de benchmark/serie comparativa en la maestra. No bloquea TIR/TWR de cartera.", "Alta del índice de referencia en el catálogo. No bloquea TIR/TWR de cartera."],
    ["Fondo X: Cobertura parcial", "Fondo X: Datos parciales"],
    ["88,0 % del peso representado; los pesos incluidos se normalizan al 100 %.", "88,0 % de peso medido; los pesos incluidos se normalizan al 100 %."],
    ["Máxima caída (selección)", "Caída máxima (selección)"],
    ["Falta el Sharpe: las dos carteras no tienen una tasa sin riesgo comparable.", "Falta el Sharpe: las dos carteras no tienen un tipo sin riesgo comparable."],
    ["La tasa sin riesgo utiliza cobertura parcial o una tasa de respaldo; el Sharpe es aproximado.", "El tipo sin riesgo solo se conoce en parte de la ventana o es uno de respaldo; el Sharpe es aproximado."],
    ["Vehículo: Fondo frente a ETF", "Producto: Fondo frente a ETF"],
    ["Una sustitución que mejora rentabilidad anualizada, sharpe.", "Una sustitución que mejora rentabilidad anualizada, Sharpe."],
    ["LU000: histórico ampliado con MSCI, del 2020-01-31 al 2021-02-05.", "LU000: histórico ampliado con MSCI, del 31/01/2020 al 05/02/2021."]
  ])("%s", (papel, pantalla) => {
    expect(textoEnPantalla(papel)).toBe(pantalla);
  });

  test("la cobertura de divisa es la única que se queda: esa sí lo es", () => {
    expect(textoEnPantalla("Difieren: Cobertura de divisa")).toBe("Difieren: Cobertura de divisa");
  });

  test("lo que no conoce lo deja igual", () => {
    expect(textoEnPantalla("Un aviso cualquiera del servidor.")).toBe("Un aviso cualquiera del servidor.");
  });
});

describe("los rótulos de pantalla no mueven los del papel", () => {
  test("las métricas", () => {
    expect(ETIQUETAS_DE_METRICA.annualized_return_3y).toBe("Rentabilidad anualizada 3 años");
    expect(ETIQUETAS_DE_METRICA.max_drawdown_5y).toBe("Caída máxima 5 años");
    expect(ETIQUETAS_DE_METRICA.ter).toBe("Coste corriente");
    /* Lo que leen los PDF, intacto. */
    expect(METRIC_KEY_LABELS.annualized_return_3y).toBe("Rentabilidad 3A");
    expect(METRIC_KEY_LABELS.max_drawdown_5y).toBe("Máx. caída 5A");
    expect(METRIC_KEY_LABELS.ter).toBe("Gastos corrientes (TER)");
  });

  test("los códigos", () => {
    expect(etiquetaDeCodigo("PARTIAL_COVERAGE")).toBe("Datos parciales");
    expect(etiquetaDeCodigo("COMPLETE")).toBe("Datos completos");
    expect(etiquetaDeCodigo("UNSUPPORTED_INSTRUMENT_TYPE")).toBe("Producto no admitido");
    /* «Tipo de instrumento» es «Producto» (fondo, ETF o acción); «Clase de activo» es otra cosa (FMT-15). */
    expect(textoEnPantalla("Tipo de instrumento no admitido")).toBe("Producto no admitido");
    /* Una media por peso se llama «media»: el servidor escribe «ponderado» en el rótulo de su comprobación de coste. */
    expect(textoEnPantalla("Coste corriente ponderado")).toBe("Coste corriente medio");
    expect(textoEnPantalla("Mejora el coste corriente ponderado.")).toBe("Mejora el coste corriente medio.");
    expect(etiquetaDeCodigo("PRICE_SERIES_MISSING")).toBe("Sin serie de precios");
    expect(etiquetaDeCodigo("MISSING_HOLDINGS")).toBe("Sin cartera publicada");
    expect(estadoDeLosDatos("partial")).toBe("Datos parciales");
    expect(estadoDeLosDatos(undefined)).toBeNull();
    /* Lo que leen los PDF, intacto. */
    expect(QUALITY_FLAG_LABELS.PARTIAL_COVERAGE).toBe("Cobertura parcial");
    expect(COVERAGE_LABELS.COMPLETE).toBe("Cobertura completa");
  });

  test("la caída y la ventana", () => {
    expect(caidaEnPantalla("Máx. caída (hist.)")).toBe("Caída máxima histórica");
    expect(caidaEnPantalla("Máx. caída 5A")).toBe("Caída máxima 5 años");
    expect(ventanaEnPalabras("3Y")).toBe("3 años");
    expect(ventanaEnPalabras("1Y")).toBe("1 año");
  });
});

describe("los millares", () => {
  test("con punto también en las cuatro cifras, sin tocar lo que imprime el papel", () => {
    /* Con el módulo único, que agrupa siempre: también en el papel, que antes escribía «1007,8». */
    expect(numero(1092)).toBe("1.092");
    expect(numero(1007.81, { decimales: 1 })).toBe("1.007,8");
    expect(numero(131370.7, { decimales: 1 })).toBe("131.370,7");
    expect(numero(305)).toBe("305");
    expect(numero(-3733)).toBe("\u22123.733");
    expect(numero(null)).toBeNull();
  });
});

describe("Mejorar cartera dice qué posición es y por qué", () => {
  const base: ImprovementResponse = {
    schema_version: "portfolio-improvement.v1",
    status: "INSUFFICIENT_DATA",
    proposals: [],
    rejected_candidates: {},
    excluded_assets: [],
    evaluated_combinations: 0,
    warnings: []
  };
  const nombreDe = (id: string) => ({ V: "Vanguard S&P 500", N: "Fondo Nuevo", F: "Fondo Fuera", S: "Fondo Sin Motivo" })[id] ?? id;

  test("bloqueada por calidad: tiene precios, y decir que no los tiene sería falso", () => {
    const respuesta = { ...base, missing_assets: ["V"], excluded_assets: [{ asset_id: "V", reason: "QUALITY_BLOCKED" }] };
    expect(resumenDeLaMejoraEnPantalla(respuesta, nombreDe)).toBe(
      "Vanguard S&P 500: su serie de precios no pasó el control de calidad. Sustitúyelo para poder evaluar la cartera."
    );
  });

  describe("histórico corto (decisión 97): dice qué ventana falta, y solo aconseja la otra si la cubre", () => {
    const corto = (window: ImprovementResponse["window"], covers_window?: string): ImprovementResponse => ({
      ...base,
      window,
      missing_assets: ["N"],
      excluded_assets: [{ asset_id: "N", reason: "INSUFFICIENT_HISTORY", ...(covers_window ? { covers_window } : {}) }]
    });

    test("a 3 años no hay otra más corta a la que ir", () => {
      const frase = resumenDeLaMejoraEnPantalla(corto("3Y"), nombreDe);
      expect(frase).toBe("Fondo Nuevo no tiene precios para los 3 años, la ventana más corta aquí: sustitúyelo o quítalo para evaluar el resto.");
      expect(frase).not.toContain("otra ventana");
    });

    test("a 5 años, si cubre los 3, se aconsejan", () => {
      expect(resumenDeLaMejoraEnPantalla(corto("5Y", "3Y"), nombreDe)).toBe("Fondo Nuevo no tiene precios para los 5 años. Prueba a 3 años o sustitúyelo.");
    });

    test("a 5 años, si tampoco cubre los 3, no se aconseja lo que no va a funcionar", () => {
      const frase = resumenDeLaMejoraEnPantalla(corto("5Y"), nombreDe);
      expect(frase).toBe("Fondo Nuevo no tiene precios para los 5 años, ni para los 3, la ventana más corta aquí: sustitúyelo o quítalo para evaluar el resto.");
      expect(frase).not.toContain("Prueba a 3 años");
    });

    test("sin ventana no se afirma cuál", () => {
      expect(resumenDeLaMejoraEnPantalla(corto(undefined), nombreDe)).toBe("Fondo Nuevo no tiene precios para toda la ventana: sustitúyelo o quítalo para evaluar el resto.");
    });

    test("dos a la vez, cada una lo suyo", () => {
      const respuesta: ImprovementResponse = {
        ...base,
        window: "5Y",
        missing_assets: ["N", "F"],
        excluded_assets: [{ asset_id: "N", reason: "INSUFFICIENT_HISTORY", covers_window: "3Y" }, { asset_id: "F", reason: "INSUFFICIENT_HISTORY" }]
      };
      const frase = resumenDeLaMejoraEnPantalla(respuesta, nombreDe);
      expect(frase).toContain("Fondo Nuevo no tiene precios para los 5 años. Prueba a 3 años o sustitúyelo.");
      expect(frase).toContain("Fondo Fuera no tiene precios para los 5 años, ni para los 3,");
    });

    test("si no falta nadie, lo que falla es lo común: la frase de siempre, y sin nombrar a nadie", () => {
      expect(resumenDeLaMejoraEnPantalla({ ...base, window: "3Y", missing_assets: [] }, nombreDe)).toBe("La cartera no tiene histórico común suficiente en la ventana.");
    });
  });

  test("un fondo que reparte no tiene nada malo: dice que falta nuestro dato, sin empujar a venderlo", () => {
    const respuesta = { ...base, missing_assets: ["F"], excluded_assets: [{ asset_id: "F", reason: "DISTRIBUTES_WITHOUT_PAYMENTS" }] };
    const frase = resumenDeLaMejoraEnPantalla(respuesta, nombreDe);
    expect(frase).toBe("Fondo Fuera. Este fondo reparte y no tenemos todos sus pagos: mientras esté en la cartera no se puede evaluar.");
    expect(frase).not.toMatch(/sustit/i);
    /* La lógica no cambia: sigue siendo datos insuficientes, y el papel sigue diciendo lo suyo. */
    expect(improvementSummary(respuesta)).toBe("Una posición de la cartera no tiene serie que cubra la ventana.");
  });

  test("otro motivo conocido, y uno que no llega: no se inventa ninguno", () => {
    const respuesta = {
      ...base,
      missing_assets: ["F", "S"],
      excluded_assets: [{ asset_id: "F", reason: "PRICE_SERIES_MISSING" }]
    };
    expect(resumenDeLaMejoraEnPantalla(respuesta, nombreDe)).toBe(
      "Fondo Fuera: sin serie de precios. Sustitúyelo para poder evaluar la cartera. Fondo Sin Motivo no se ha podido medir en esta ventana."
    );
  });

  test("sin posiciones concretas, la frase de siempre; y el papel no cambia", () => {
    expect(resumenDeLaMejoraEnPantalla(base, nombreDe)).toBe("La cartera no tiene histórico común suficiente en la ventana.");
    const respuesta = { ...base, missing_assets: ["V"], excluded_assets: [{ asset_id: "V", reason: "QUALITY_BLOCKED" }] };
    expect(improvementSummary(respuesta)).toBe("Una posición de la cartera no tiene serie que cubra la ventana.");
  });
});

describe("el glosario, en el código de pantalla", () => {
  /* Solo las palabras que no tienen otro sentido. «Cobertura» no entra: la de divisa se queda. Mira los
     textos, no los comentarios, que explican de dónde venimos. */
  const PROHIBIDAS: RegExp[] = [
    /\bTER\b/,
    /Gastos corrientes/,
    /Máx\. caída/,
    /Máxima caída/,
    /Clase económica/,
    /[Vv]ehículo/,
    /\bretorno\b/i,
    /\btasa (sin|libre)/i,
    /parte cubierta/i,
    /Sin conexión con el backend|El backend no respondió/,
    /\bETFs\b/
  ];
  /* Los rótulos que `AssetComparison` le pasa a su PDF: el papel no cambia en esta tanda. */
  const DEL_PAPEL = new Set(["AssetComparison.tsx:Máx. caída 3A"]);

  function ficheros(dir: string, out: string[] = []): string[] {
    for (const nombre of readdirSync(dir)) {
      const ruta = join(dir, nombre);
      if (statSync(ruta).isDirectory()) ficheros(ruta, out);
      else if (nombre.endsWith(".tsx")) out.push(ruta);
    }
    return out;
  }

  function textosDe(ruta: string): string[] {
    const fuente = ts.createSourceFile(ruta, readFileSync(ruta, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const textos: string[] = [];
    const mira = (nodo: ts.Node): void => {
      if (ts.isStringLiteralLike(nodo) || ts.isJsxText(nodo) || ts.isTemplateHead(nodo) || ts.isTemplateMiddle(nodo) || ts.isTemplateTail(nodo)) {
        textos.push(nodo.text);
      }
      ts.forEachChild(nodo, mira);
    };
    mira(fuente);
    return textos;
  }

  test("ninguna pantalla vuelve a escribir lo que el glosario quitó", () => {
    const raiz = new URL("../src/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
    const pantallas = [...ficheros(join(raiz, "components")), ...ficheros(join(raiz, "pages")), ...ficheros(join(raiz, "charts"))];
    expect(pantallas.length).toBeGreaterThan(50);
    const encontradas = pantallas.flatMap((ruta) => {
      const nombre = ruta.split(/[\\/]/).at(-1);
      return textosDe(ruta)
        .filter((texto) => PROHIBIDAS.some((patron) => patron.test(texto)) && !DEL_PAPEL.has(`${nombre}:${texto}`))
        .map((texto) => `${nombre}: ${texto}`);
    });
    expect(encontradas).toEqual([]);
  });
});

describe("las cifras que llegan tal cual del servidor", () => {
  test("coma decimal, signo menos y espacio antes de la unidad", () => {
    expect(cifrasEnPantalla("TER 1.25% frente a 0.60%")).toBe("TER 1,25\u00a0% frente a 0,60\u00a0%");
    expect(cifrasEnPantalla("Retorno -0.2 pp")).toBe("Retorno \u22120,2\u00a0pp");
    expect(cifrasEnPantalla("(-3.1%)")).toBe("(\u22123,1\u00a0%)");
    expect(cifrasEnPantalla("-10.6%")).toBe("\u221210,6\u00a0%");
  });

  /* FMT-02 y MAR-26: un punto entre dígitos no siempre es decimal. Cada caso, escrito a mano. */
  test("un punto de millar se queda: «1.500 €» son mil quinientos euros, no uno y medio", () => {
    expect(cifrasEnPantalla("Ahorro de 1.500 €")).toBe("Ahorro de 1.500 €");
    expect(cifrasEnPantalla("1.234 activos")).toBe("1.234 activos");
    expect(cifrasEnPantalla("1.234.567 €")).toBe("1.234.567 €");
  });

  test("varios puntos no son una cifra decimal: una versión y una fecha se quedan como están", () => {
    expect(cifrasEnPantalla("versión 2.3.1")).toBe("versión 2.3.1");
    expect(cifrasEnPantalla("el 13.11.2026")).toBe("el 13.11.2026");
  });

  test("un decimal se convierte, también con tres cifras si es de un porcentaje o empieza por cero", () => {
    expect(cifrasEnPantalla("12.5%")).toBe("12,5\u00a0%");
    expect(cifrasEnPantalla("TER 0.125")).toBe("TER 0,125");
    expect(cifrasEnPantalla("1.375%")).toBe("1,375\u00a0%");
  });

  test("una cifra a la inglesa con millares pasa entera a la española", () => {
    // 1,234.5K = mil doscientos treinta y cuatro con cinco miles: «1.234,5K».
    expect(cifrasEnPantalla("1,234.5K")).toBe("1.234,5K");
    // Ya en español: no se toca.
    expect(cifrasEnPantalla("1.234,5 €")).toBe("1.234,5 €");
  });

  test("el % se separa de una sola forma en las dos funciones: con un espacio que no parte la línea", () => {
    expect(textoEnPantalla("60%")).toBe("60\u00a0%");
    expect(cifrasEnPantalla("60%")).toBe("60\u00a0%");
    expect(cifrasEnPantalla("60 %")).toBe("60\u00a0%");
  });

  test("no toca lo que no es una cifra con decimales", () => {
    expect(cifrasEnPantalla("Desde 2026-10-20")).toBe("Desde 2026-10-20");
    expect(cifrasEnPantalla("LU0011889846")).toBe("LU0011889846");
    expect(cifrasEnPantalla("Euro-Aggregate 3-5 años")).toBe("Euro-Aggregate 3-5 años");
    expect(cifrasEnPantalla("")).toBe("");
  });
});
