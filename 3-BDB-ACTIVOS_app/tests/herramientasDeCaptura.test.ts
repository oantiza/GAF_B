// @vitest-environment happy-dom

/**
 * Las piezas que comparten la batería de fotos (`scripts/capturaInterfaz.mjs`) y el recorrido de la auditoría
 * (`scripts/auditoriaFrontend.mjs`) desde el 19-11-2026.
 *
 * Dos cortes de texto salieron ese día midiendo a mano —«PRIVATE BANKE…» en el menú compacto y 37 de 39 nombres en el
 * calendario de Mercado—, y ninguna de las dos herramientas los habría visto, por tres razones: no miraban las ventanas
 * estrechas (ninguno de los seis anchos cae entre 1.025 y 1.239 px), no avisaban de un texto cortado, y fotografiaban
 * sin barra de desplazamiento, con 10 px más de sitio que una ventana de verdad. Estas pruebas vigilan las tres piezas
 * que lo arreglan, y las dos que salieron de poner al día las comprobaciones que ya no servían: cómo se entra en la
 * aplicación, que ahora es de todas, y el Modo cliente, que pasó de `audit:ui` al recorrido. Lo que pasa en un navegador
 * de verdad no se puede probar aquí: se midió aparte (SISTEMA_DISENO.md, apartado 14.6).
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ANCHOS_DE_TRABAJO, ANCHO_DE_TABLETA, PASADA_ESTRECHA, anchoDe, marcaDeAncho, resolverAnchos } from "../scripts/anchosDeCaptura.mjs";
import { CORTES_ADMITIDOS, recogerTextoCortado, resumirTextoCortado } from "../scripts/textoCortado.mjs";
import { TOPE_DE_CAJAS_POR_PANTALLA, describirCaja, recogerCajasQueSeDesplazan, resumirCajasQueSeDesplazan } from "../scripts/cajasQueSeDesplazan.mjs";
import { BASE_POR_DEFECTO, MARCO_DE_LA_APP, baseDeLaApp, entrar } from "../scripts/entrarEnLaApp.mjs";
import { pdfUsedFonts } from "../scripts/pdfUsedFonts.mjs";
import { CLAVE_DEL_MODO_CLIENTE, MARCA_DE_INTERNO, PALABRAS_DEL_ASESOR, comprobarModoCliente, fallosDelModoCliente } from "../scripts/modoCliente.mjs";
import { cerrarElRecorrido } from "../scripts/informeDelRecorrido.mjs";

/* Con happy-dom, `URL` es la del navegador de mentira y `readFileSync` no la entiende: las rutas van como texto. */
const APP = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const leer = (ruta: string) => readFileSync(resolve(APP, ruta), "utf8");
const BATERIA = leer("scripts/capturaInterfaz.mjs");
const RECORRIDO = leer("scripts/auditoriaFrontend.mjs");
const HUMO_DEL_INFORME = leer("scripts/smokeFlujoInforme.mjs");
const HUMO_DEL_PDF = leer("scripts/smokePdfD3.mjs");

describe("los anchos de las fotos y de las medidas", () => {
  test("los seis anchos de trabajo son los de siempre, y hasta 1.024 px van con dedo", () => {
    expect(ANCHOS_DE_TRABAJO).toEqual({ xl: [2560, 1440], l: [1920, 1080], d: [1440, 900], p: [1280, 800], t: [1024, 768], tp: [768, 1024] });
    expect(resolverAnchos("xl,l,d,p,t,tp", "d").map(({ ancho, conDedo }) => [ancho, conDedo])).toEqual([
      [2560, false],
      [1920, false],
      [1440, false],
      [1280, false],
      [1024, true],
      [768, true]
    ]);
    expect(ANCHO_DE_TABLETA).toBe(1024);
  });

  test("sin pedir nada, cada herramienta recorre lo que recorría", () => {
    expect(resolverAnchos(undefined, "l,d,tp").map((pedido) => pedido.clave)).toEqual(["l", "d", "tp"]);
    expect(resolverAnchos("", "d")).toEqual([{ clave: "d", ancho: 1440, alto: 900, conDedo: false }]);
    expect(BATERIA).toContain('resolverAnchos(process.argv[2], "d")');
    expect(RECORRIDO).toContain('resolverAnchos(process.argv[3], "l,d,tp")');
  });

  test("la pasada estrecha son los cuatro anchos donde cambia la disposición, con ratón", () => {
    expect(PASADA_ESTRECHA).toEqual(["1025", "1100", "1180", "1240"]);
    expect(resolverAnchos("estrecha", "d")).toEqual([
      { clave: "1025", ancho: 1025, alto: 800, conDedo: false },
      { clave: "1100", ancho: 1100, alto: 800, conDedo: false },
      { clave: "1180", ancho: 1180, alto: 800, conDedo: false },
      { clave: "1240", ancho: 1240, alto: 800, conDedo: false }
    ]);
    /* Cada uno es un corte declarado: ahí acaba de cambiar algo, y es donde el contenido más aprieta. */
    const cortes = leer("tests/cortesDeAncho.test.ts");
    for (const ancho of PASADA_ESTRECHA) expect(cortes, ancho).toMatch(new RegExp(`\\n\\s+${ancho}: "`));
  });

  test("por qué hace falta: ninguno de los seis anchos de trabajo cae en el menú compacto, y la pasada estrecha sí", () => {
    const enElCompacto = (ancho: number) => ancho >= 1025 && ancho <= 1239;
    expect(Object.values(ANCHOS_DE_TRABAJO).filter(([ancho]) => enElCompacto(ancho))).toEqual([]);
    expect(PASADA_ESTRECHA.map(Number).filter(enElCompacto)).toEqual([1025, 1100, 1180]);
  });

  test("un ancho se puede pedir en píxeles, y con una «d» detrás va con dedo", () => {
    expect(anchoDe("1180")).toEqual({ clave: "1180", ancho: 1180, alto: 800, conDedo: false });
    expect(anchoDe("1180d")).toEqual({ clave: "1180d", ancho: 1180, alto: 800, conDedo: true });
    /* Hasta 1.024 px es una tableta aunque no se diga, y una tableta estrecha es vertical. */
    expect(anchoDe("1000")).toEqual({ clave: "1000", ancho: 1000, alto: 800, conDedo: true });
    expect(anchoDe("768")).toEqual({ clave: "768", ancho: 768, alto: 1024, conDedo: true });
    expect(anchoDe("800")).toEqual({ clave: "800", ancho: 800, alto: 1024, conDedo: true });
    expect(anchoDe("900")).toEqual({ clave: "900", ancho: 900, alto: 800, conDedo: true });
  });

  test("los píxeles de un ancho de trabajo son ese ancho de trabajo, con su mismo alto", () => {
    /* El alto decide si la página desplaza, y con eso si lleva barra: `1440` no puede ser un portátil más bajo que `d`. */
    for (const [clave, [ancho, alto]] of Object.entries(ANCHOS_DE_TRABAJO) as [string, [number, number]][]) {
      const porNombre = anchoDe(clave);
      expect(anchoDe(String(ancho)), String(ancho)).toEqual({ ...porNombre, clave: String(ancho) });
      expect(porNombre.alto, clave).toBe(alto);
    }
  });

  test("lo que distingue a un ancho de otro son sus píxeles, con la «d» solo donde el dedo no se da por hecho", () => {
    expect(resolverAnchos("l,tp,1180,1180d,1000", "d").map(marcaDeAncho)).toEqual(["1920", "768", "1180", "1180d", "1000"]);
  });

  test("una orden mezcla nombres, píxeles y la pasada estrecha, sin repetir ninguno", () => {
    expect(resolverAnchos(" d , estrecha,1100, d ", "l").map((pedido) => pedido.clave)).toEqual(["d", "1025", "1100", "1180", "1240"]);
  });

  test("dos formas de pedir el mismo ancho cuentan como una: la segunda pisaría las fotos de la primera", () => {
    const pedidos = resolverAnchos("t,1024,1024d,tp,768,1180,1180d,d,1440", "l");
    expect(pedidos.map((pedido) => pedido.clave)).toEqual(["t", "tp", "1180", "1180d", "d"]);
    /* Ninguna marca se repite: cada una es el nombre de un juego de fotos. */
    const marcas = pedidos.map(marcaDeAncho);
    expect(new Set(marcas).size).toBe(marcas.length);
  });

  test("un ancho que no existe se dice, con los que valen: antes el guion moría sin explicarlo", () => {
    for (const malo of ["xxl", "12", "99999", "1100x", "500", "d1180"]) {
      expect(() => resolverAnchos(malo, "d"), malo).toThrow(/No sé qué ancho es «.+». Valen xl, l, d, p, t, tp, «estrecha»/);
    }
  });
});

describe("la barra de desplazamiento ocupa sitio, y las fotos la llevan", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    document.getElementById("hueco-de-la-barra")?.remove();
    vi.restoreAllMocks();
  });

  const cargar = async (barras: string) => {
    vi.stubEnv("AUDIT_BARRAS", barras);
    vi.resetModules();
    return import("../scripts/barraDeDesplazamiento.mjs");
  };
  /** Una página de mentira que ejecuta aquí lo que el guion mandaría al navegador. */
  const pagina = () => ({ evaluate: vi.fn(async (enLaPagina: () => unknown) => enLaPagina()) });
  const queDesplace = (si: boolean) => vi.spyOn(document.documentElement, "scrollHeight", "get").mockReturnValue(si ? 4000 : 400);
  const conPuntero = (grueso: boolean) => vi.spyOn(window, "matchMedia").mockReturnValue({ matches: grueso } as MediaQueryList);

  test("el navegador se lanza con las barras puestas, sin perder lo que se le pida", async () => {
    const { BARRAS_OCULTAS, lanzamiento } = await cargar("");
    expect(BARRAS_OCULTAS).toBe(false);
    expect(lanzamiento()).toEqual({ ignoreDefaultArgs: ["--hide-scrollbars"] });
    expect(lanzamiento({ executablePath: "chromium" })).toEqual({ executablePath: "chromium", ignoreDefaultArgs: ["--hide-scrollbars"] });
  });

  test("con ratón, si la pantalla desplaza se reserva el hueco de su barra; si no desplaza, no", async () => {
    const { reservarHuecoDeLaBarra } = await cargar("");
    conPuntero(false);
    queDesplace(true);
    await reservarHuecoDeLaBarra(pagina());
    expect(document.getElementById("hueco-de-la-barra")?.textContent).toBe("html { scrollbar-gutter: stable !important; }");
    /* La pantalla siguiente no desplaza: el hueco que dejó la anterior se quita. */
    vi.restoreAllMocks();
    conPuntero(false);
    queDesplace(false);
    await reservarHuecoDeLaBarra(pagina());
    expect(document.getElementById("hueco-de-la-barra")).toBeNull();
  });

  test("con dedo no se reserva nada: en una tableta la barra no ocupa sitio", async () => {
    const { reservarHuecoDeLaBarra, sinBarrasDeTableta } = await cargar("");
    conPuntero(true);
    queDesplace(true);
    expect(await reservarHuecoDeLaBarra(pagina())).toBe(0);
    expect(document.getElementById("hueco-de-la-barra")).toBeNull();
    /* Y el contexto con dedo lleva una hoja que quita las barras de cada documento que abra. */
    const contexto = { addInitScript: vi.fn() };
    await sinBarrasDeTableta(contexto);
    expect(contexto.addInitScript).toHaveBeenCalledTimes(1);
    expect(contexto.addInitScript.mock.calls[0][1]).toContain("scrollbar-width: none !important");
  });

  test("AUDIT_BARRAS=ocultas repite una pasada antigua: ni barras, ni hueco, ni hoja", async () => {
    const { BARRAS_OCULTAS, lanzamiento, reservarHuecoDeLaBarra, sinBarrasDeTableta } = await cargar("ocultas");
    expect(BARRAS_OCULTAS).toBe(true);
    expect(lanzamiento({ executablePath: "chromium" })).toEqual({ executablePath: "chromium" });
    const page = pagina();
    expect(await reservarHuecoDeLaBarra(page)).toBe(0);
    expect(page.evaluate).not.toHaveBeenCalled();
    const contexto = { addInitScript: vi.fn() };
    await sinBarrasDeTableta(contexto);
    expect(contexto.addInitScript).not.toHaveBeenCalled();
  });
});

describe("los textos cortados", () => {
  const corte = (firma: string, faltan: number, mas: Record<string, unknown> = {}) => ({ firma, texto: `texto de ${firma}`, tipo: "linea", lineas: 1, faltan, admitido: -1, ...mas });

  test("el informe agrupa por elemento: cuántos textos corta, cuál pierde más y cuánto", () => {
    const resumen = resumirTextoCortado([corte("span.nombre", 12), corte("span.nombre", 137, { texto: "USDFOMC Member Hammack Speaks" }), corte("p.rotulo", 3)], []);
    expect(resumen).toEqual({
      textoCortado: ["span.nombre, 2 textos; el que más pierde, «USDFOMC Member Hammack Speaks»: le faltan 137 px", "p.rotulo, 1 texto; el que más pierde, «texto de p.rotulo»: le faltan 3 px"],
      textosCortados: 3,
      cortesAdmitidos: 0
    });
  });

  test("el mismo elemento, recortado a una línea en un sitio y a varias en otro, son dos grupos: no se comparan píxeles de ancho con píxeles de alto", () => {
    const resumen = resumirTextoCortado([corte("span.cell-entity__name", 5), corte("span.cell-entity__name", 30, { tipo: "lineas", lineas: 2 })], []);
    expect(resumen.textoCortado).toEqual([
      "span.cell-entity__name, 1 texto; el que más pierde, «texto de span.cell-entity__name»: a 2 líneas, le faltan 30 px de alto",
      "span.cell-entity__name, 1 texto; el que más pierde, «texto de span.cell-entity__name»: le faltan 5 px"
    ]);
    expect(resumen.textosCortados).toBe(2);
  });

  test("un texto recortado a varias líneas se dice como tal", () => {
    const resumen = resumirTextoCortado([corte("span.cell-entity__name", 18, { tipo: "lineas", lineas: 3, texto: "Amundi Funds Global Equity" })], []);
    expect(resumen.textoCortado).toEqual(["span.cell-entity__name, 1 texto; el que más pierde, «Amundi Funds Global Equity»: a 3 líneas, le faltan 18 px de alto"]);
  });

  test("sin cortes, el informe queda vacío", () => {
    expect(resumirTextoCortado([], CORTES_ADMITIDOS)).toEqual({ textoCortado: [], textosCortados: 0, cortesAdmitidos: 0 });
  });

  test("lo que el sistema de diseño admite no cuenta, pero se dice cuánto hubo", () => {
    const admitidos = [{ selector: ".miga", motivo: "cede a propósito" }];
    const resumen = resumirTextoCortado([corte("span.miga", 40, { admitido: 0 }), corte("span.nombre", 5)], admitidos);
    expect(resumen.textoCortado).toEqual(["span.nombre, 1 texto; el que más pierde, «texto de span.nombre»: le faltan 5 px"]);
    expect(resumen.cortesAdmitidos).toBe(1);
  });

  test("un corte admitido «hasta» un límite deja de admitirse entero en cuanto la pantalla lo pasa", () => {
    const admitidos = [{ selector: ".evento", hasta: { textos: 3, px: 23 }, motivo: "decidido" }];
    const dentro = [corte("span.evento", 23, { admitido: 0 }), corte("span.evento", 9, { admitido: 0 }), corte("span.evento", 3, { admitido: 0 })];
    expect(resumirTextoCortado(dentro, admitidos)).toEqual({ textoCortado: [], textosCortados: 0, cortesAdmitidos: 3 });
    /* Un texto de más: el calendario vuelve a cortar más de lo decidido, y se enseñan los cuatro. */
    expect(resumirTextoCortado([...dentro, corte("span.evento", 1, { admitido: 0 })], admitidos).textosCortados).toBe(4);
    /* O uno que pierde más de lo decidido. */
    const pasado = resumirTextoCortado([corte("span.evento", 24, { admitido: 0 })], admitidos);
    expect(pasado.textosCortados).toBe(1);
    expect(pasado.cortesAdmitidos).toBe(0);
    /* El límite se decidió en píxeles enteros y la medida viene en décimas: 23,4 son 23; 23,6 ya son 24. */
    expect(resumirTextoCortado([corte("span.evento", 23.4, { admitido: 0 })], admitidos).cortesAdmitidos).toBe(1);
    expect(resumirTextoCortado([corte("span.evento", 23.6, { admitido: 0 })], admitidos).cortesAdmitidos).toBe(0);
  });

  test("lo que falta se escribe con coma, y con una décima solo por debajo de 10 px", () => {
    const resumen = resumirTextoCortado([corte("span.nombre", 0.4), corte("p.rotulo", 7.5), corte("a.enlace", 23.4)], []);
    expect(resumen.textoCortado.map((linea: string) => linea.split(": ").pop())).toEqual(["le faltan 23 px", "le faltan 7,5 px", "le faltan 0,4 px"]);
  });

  test("cada corte admitido lleva su motivo con el apartado que lo decide, y nombra clases que existen", () => {
    const hojas = readdirSync(resolve(APP, "src/styles")).filter((nombre) => nombre.endsWith(".css")).map((nombre) => leer(`src/styles/${nombre}`)).join("\n");
    expect(CORTES_ADMITIDOS.length).toBeGreaterThan(0);
    for (const admitido of CORTES_ADMITIDOS) {
      expect(admitido.motivo, admitido.selector).toMatch(/apartado 14\.\d/);
      const clases = [...admitido.selector.matchAll(/\.([a-z0-9_-]+)/g)].map((c) => c[1]);
      expect(clases.length).toBeGreaterThan(0);
      for (const clase of clases) expect(hojas, clase).toMatch(new RegExp(`\\.${clase}\\b`));
    }
    /* El del calendario es el que decidió Óscar el 19-11-2026 («En una línea»): tres nombres como mucho, el peor por 23 px. */
    expect(CORTES_ADMITIDOS.find((admitido) => admitido.selector === ".economic-event-name")?.hasta).toEqual({ textos: 3, px: 23 });
  });

  describe("lo que se recoge dentro de la página", () => {
    afterEach(() => {
      document.body.innerHTML = "";
    });

    /** Un elemento con el recorte de una línea y las medidas que se le digan: happy-dom no dispone la página. */
    const elemento = (texto: string, pide: number, cabe: number, clase = "nombre") => {
      const p = document.createElement("p");
      p.className = clase;
      p.style.cssText = "overflow-x: hidden; white-space: nowrap; text-overflow: ellipsis;";
      p.textContent = texto;
      Object.defineProperty(p, "scrollWidth", { value: pide });
      Object.defineProperty(p, "clientWidth", { value: cabe });
      p.getBoundingClientRect = () => ({ width: cabe, height: 20 }) as DOMRect;
      document.body.append(p);
      return p;
    };

    test("ve el texto al que le falta sitio, y no el que cabe", () => {
      elemento("German Buba President Nagel Speaks", 269, 262);
      elemento("Current Account", 120, 262);
      expect(recogerTextoCortado([])).toEqual([{ firma: "p.nombre", texto: "German Buba President Nagel Speaks", tipo: "linea", lineas: 1, faltan: 7, admitido: -1 }]);
    });

    test("no cuenta lo que no se ve, lo que es solo para lectores de pantalla ni un contenedor que recorta bloques", () => {
      elemento("oculto", 300, 100).hidden = true;
      elemento("para lectores", 300, 100).setAttribute("aria-hidden", "true");
      elemento("solo lectores", 300, 100, "sr-only");
      const contenedor = elemento("", 300, 100, "contenedor");
      contenedor.append(Object.assign(document.createElement("div"), { textContent: "una tarjeta dentro de una fila de tarjetas" }));
      expect(recogerTextoCortado([])).toEqual([]);
    });

    test("ve el nombre cortado aunque el texto vaya dentro de su enlace: quien recorta es el envoltorio", () => {
      /* Así va el nombre de un activo en la tabla de la propuesta: `<span class="cell-entity__name"><a>…</a></span>`.
         El envoltorio no tiene ni una letra propia, y hasta el 19-11-2026 el recorrido no lo miraba. */
      const nombre = elemento("", 300, 100, "cell-entity__name");
      nombre.append(Object.assign(document.createElement("a"), { textContent: "Amundi Funds Global Equity Sustainable Income" }));
      expect(recogerTextoCortado([])).toEqual([{ firma: "p.cell-entity__name", texto: "Amundi Funds Global Equity Sustainable Income", tipo: "linea", lineas: 1, faltan: 200, admitido: -1 }]);
    });

    test("ve el nombre recortado a un número de líneas, y no el que cabe en ellas", () => {
      /* Así recorta la tabla de la propuesta el nombre de un fondo: a dos líneas, con su enlace dentro. */
      const recortado = (pide: number, tiene: number) => {
        const nombre = document.createElement("span");
        nombre.className = "cell-entity__name";
        nombre.style.cssText = "display: -webkit-box; -webkit-line-clamp: 2; overflow: hidden;";
        nombre.append(Object.assign(document.createElement("a"), { textContent: "Amundi Funds Global Equity Sustainable Income" }));
        Object.defineProperty(nombre, "scrollHeight", { value: pide });
        Object.defineProperty(nombre, "clientHeight", { value: tiene });
        nombre.getBoundingClientRect = () => ({ width: 180, height: tiene }) as DOMRect;
        document.body.append(nombre);
      };
      recortado(60, 40);
      expect(recogerTextoCortado([])).toEqual([{ firma: "span.cell-entity__name", texto: "Amundi Funds Global Equity Sustainable Income", tipo: "lineas", lineas: 2, faltan: 20, admitido: -1 }]);
      /* Con un píxel de más, que es redondeo, no hay corte. */
      document.body.innerHTML = "";
      recortado(41, 40);
      expect(recogerTextoCortado([])).toEqual([]);
    });

    test("un recorte dentro de otro que también desborda es un solo corte, el de fuera", () => {
      const fuera = elemento("", 300, 100, "fuera");
      const dentro = document.createElement("span");
      dentro.className = "dentro";
      dentro.style.cssText = "overflow-x: hidden; white-space: nowrap;";
      dentro.textContent = "FOMC Member Hammack Speaks";
      Object.defineProperty(dentro, "scrollWidth", { value: 500 });
      Object.defineProperty(dentro, "clientWidth", { value: 300 });
      dentro.getBoundingClientRect = () => ({ width: 300, height: 20 }) as DOMRect;
      fuera.append(dentro);
      expect(recogerTextoCortado([]).map((corte: { firma: string }) => corte.firma)).toEqual(["p.fuera"]);
    });

    describe("con un navegador que mide el texto, por décimas", () => {
      afterEach(() => {
        vi.restoreAllMocks();
      });

      /** Como en un navegador: el texto mide lo que se diga, con sus décimas, y la caja, lo suyo. Los enteros dicen que cabe. */
      const medido = (texto: string, mideElTexto: number, mideLaCaja: number, estilo = "text-overflow: ellipsis;") => {
        const p = elemento(texto, Math.round(mideLaCaja), Math.round(mideLaCaja), "medido");
        p.style.cssText = `overflow-x: hidden; white-space: nowrap; ${estilo}`;
        p.getBoundingClientRect = () => ({ width: mideLaCaja, height: 20 }) as DOMRect;
        vi.spyOn(document, "createRange").mockReturnValue({ selectNodeContents: () => undefined, getClientRects: () => [{ left: 0, right: mideElTexto, width: mideElTexto, height: 20 }] } as unknown as Range);
        return p;
      };

      test("a un texto con puntos suspensivos le bastan 0,4 px de menos para cortarse, aunque los enteros digan que cabe", () => {
        /* Medido en Chromium el 19-11-2026: «…Nagel Speaks» pasa a «…Nagel Spe…» con 0,4 px de menos, y scrollWidth y
           clientWidth salen iguales. */
        medido("German Buba President Nagel Speaks", 241.25, 240.85);
        expect(recogerTextoCortado([])).toEqual([{ firma: "p.medido", texto: "German Buba President Nagel Speaks", tipo: "linea", lineas: 1, faltan: 0.4, admitido: -1 }]);
      });

      test("con 0,4 px de más no hay corte", () => {
        medido("German Buba President Nagel Speaks", 241.25, 241.65);
        expect(recogerTextoCortado([])).toEqual([]);
      });

      test("con puntos suspensivos el relleno no es sitio; sin ellos, el texto se pinta sobre el de la derecha y no se corta", () => {
        /* La caja: 30 de relleno, 226,25 de contenido y 30 de relleno. Al texto le faltan 15 px de contenido. */
        medido("German Buba President Nagel Speaks", 241.25, 286.25, "text-overflow: ellipsis; padding: 0 30px;");
        expect(recogerTextoCortado([]).map((corte: { faltan: number }) => corte.faltan)).toEqual([15]);
        document.body.innerHTML = "";
        medido("German Buba President Nagel Speaks", 241.25, 286.25, "padding: 0 30px;");
        expect(recogerTextoCortado([])).toEqual([]);
        /* Pasado el relleno, sí: 40 px de menos de contenido son 10 fuera de la caja. */
        document.body.innerHTML = "";
        medido("German Buba President Nagel Speaks", 241.25, 261.25, "padding: 0 30px;");
        expect(recogerTextoCortado([]).map((corte: { faltan: number }) => corte.faltan)).toEqual([10]);
      });

      /** Un envoltorio que recorta y no lleva ni una letra propia, con las medidas que se le digan. */
      const envoltorio = (clase: string, estilo: string, mideLaCaja: number) => {
        const caja = document.createElement("span");
        caja.className = clase;
        caja.style.cssText = `overflow-x: hidden; white-space: nowrap; ${estilo}`;
        caja.getBoundingClientRect = () => ({ width: mideLaCaja, height: 20 }) as DOMRect;
        document.body.append(caja);
        return caja;
      };
      /** Un hijo con la caja que se le diga, de la izquierda a la derecha. */
      const hijo = (padre: HTMLElement, texto: string, izquierda: number, derecha: number, estilo = "") => {
        const el = document.createElement(estilo.includes("enlace") ? "a" : "span");
        el.style.cssText = estilo.replace("enlace", "");
        el.textContent = texto;
        el.getClientRects = () => [{ left: izquierda, right: derecha, width: derecha - izquierda, height: 20 }] as unknown as DOMRectList;
        el.getBoundingClientRect = () => ({ width: derecha - izquierda, height: 20 }) as DOMRect;
        padre.append(el);
        return el;
      };

      test("el nombre que va dentro de su enlace se mide por la caja del enlace, descontando bordes y relleno del envoltorio", () => {
        /* Borde de 2 y relleno izquierdo de 8: el enlace empieza en 10. Pide 241,25 y el contenido mide 240,85. */
        const nombre = envoltorio("cell-entity__name", "text-overflow: ellipsis; border-left-width: 2px; border-right-width: 2px; padding-left: 8px;", 2 + 8 + 240.85 + 2);
        hijo(nombre, "German Buba President Nagel Speaks", 10, 251.25, "enlace");
        expect(recogerTextoCortado([])).toEqual([{ firma: "span.cell-entity__name", texto: "German Buba President Nagel Speaks", tipo: "linea", lineas: 1, faltan: 0.4, admitido: -1 }]);
      });

      test("un recuadro cuyo nombre ya cede con puntos suspensivos no es un corte del recuadro: lo es del nombre", () => {
        /* Como el recuadro de la propuesta de la barra superior: borde de 1, relleno de 12, y dentro el rótulo (para
           lectores de pantalla, 1 px), el nombre encogido hasta llenar el sitio y el estado. */
        const recuadro = envoltorio("recuadro", "border-left-width: 1px; border-right-width: 1px; padding-left: 12px; padding-right: 12px;", 1 + 12 + 268 + 12 + 1);
        hijo(recuadro, "Propuesta en curso", 12, 13);
        const valor = hijo(recuadro, "Familia García · moderada · revisión de noviembre", 13, 200, "overflow-x: hidden; white-space: nowrap; text-overflow: ellipsis;");
        valor.className = "recuadro__valor";
        /* El nombre lleva más de lo que mide, y lo recorta él: al recuadro le cuenta su caja, no lo que pide. */
        Object.defineProperty(valor, "scrollWidth", { value: 388 });
        Object.defineProperty(valor, "clientWidth", { value: 187 });
        hijo(recuadro, "sin guardar", 208, 281);
        /* El texto del nombre mide 388 px, y su caja, 187. */
        vi.spyOn(document, "createRange").mockReturnValue({ selectNodeContents: () => undefined, getClientRects: () => [{ left: 13, right: 401, width: 388, height: 20 }] } as unknown as Range);
        expect(recogerTextoCortado([]).map((corte: { firma: string; faltan: number }) => [corte.firma, corte.faltan])).toEqual([["span.recuadro__valor", 201]]);
      });

      test("un hijo que no recorta lo suyo y lleva más de lo que mide su caja cuenta por lo que pide", () => {
        /* Un bloque estrecho, o un hijo flexible al que se deja encoger: su caja mide 200 y su texto pide 320. Quien lo
           corta es el envoltorio, y midiendo solo la caja del hijo el corte no se veía. */
        const padre = envoltorio("fila", "", 200);
        const estrecho = hijo(padre, "Bank of England Monetary Policy Committee", 0, 200);
        Object.defineProperty(estrecho, "scrollWidth", { value: 320 });
        Object.defineProperty(estrecho, "clientWidth", { value: 200 });
        expect(recogerTextoCortado([]).map((corte: { firma: string; faltan: number }) => [corte.firma, corte.faltan])).toEqual([["span.fila", 120]]);
      });
    });

    test("dice a qué corte admitido responde cada uno", () => {
      elemento("Mercado", 300, 100, "topbar-crumbs__current");
      elemento("FOMC Member Hammack Speaks", 300, 100, "economic-event-name");
      const recogidos = recogerTextoCortado(CORTES_ADMITIDOS.map((admitido) => admitido.selector));
      expect(recogidos.map((c: { firma: string; admitido: number }) => [c.firma, c.admitido])).toEqual([
        ["p.topbar-crumbs__current", 0],
        ["p.economic-event-name", 1]
      ]);
    });

    test("no usa nada de fuera: reconstruida como la recibe el navegador, recoge lo mismo", () => {
      const fuente = String(recogerTextoCortado);
      expect(fuente).not.toMatch(/CORTES_ADMITIDOS|resumirTextoCortado/);
      /* `page.evaluate` manda el texto de la función: se reconstruye así, sin su módulo alrededor, y tiene que dar lo
         mismo. Un nombre de fuera usado dentro pasaría las demás pruebas y fallaría en el navegador. */
      const aislada = new Function(`return (${fuente})`)() as (admitidos: string[]) => unknown[];
      elemento("German Buba President Nagel Speaks", 269, 262);
      expect(aislada([])).toEqual([{ firma: "p.nombre", texto: "German Buba President Nagel Speaks", tipo: "linea", lineas: 1, faltan: 7, admitido: -1 }]);
      expect(aislada([])).toEqual(recogerTextoCortado([]));
    });
  });
});

/*
 * Lo que tampoco veía ninguna herramienta (19-11-2026): una caja con desplazamiento propio a la que su contenido no le
 * cabe. No desborda ni corta un texto. Así quedaba fuera de la vista el botón «Quitar» de la tabla de posiciones de
 * Diseño, de 1.180 a 1.280 px (SISTEMA_DISENO.md, apartado 14.7).
 */
describe("las cajas que se desplazan de lado", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  interface Recogida { firma: string; nombre: string; pide: number; tiene: number; fuera: number; controles: number; delTodo: number; ejemplo: string; conTeclado: boolean }

  /** Una caja con las medidas que se le digan: happy-dom no dispone la página. Su borde izquierdo está en 100. */
  const caja = (clase: string, pide: number, tiene: number, estilo = "overflow-x: auto;", etiqueta = "div") => {
    const el = document.createElement(etiqueta);
    el.className = clase;
    el.style.cssText = estilo;
    Object.defineProperty(el, "scrollWidth", { value: pide });
    Object.defineProperty(el, "clientWidth", { value: tiene });
    el.getBoundingClientRect = () => ({ left: 100, right: 100 + tiene, width: tiene, height: 300 }) as DOMRect;
    document.body.append(el);
    return el;
  };
  /** Algo dentro de una caja, de la izquierda a la derecha que se digan. */
  const dentro = <T extends HTMLElement>(padre: Element, el: T, izquierda: number, derecha: number): T => {
    el.getBoundingClientRect = () => ({ left: izquierda, right: derecha, width: derecha - izquierda, height: 30 }) as DOMRect;
    padre.append(el);
    return el;
  };
  const boton = (nombre: string, atributos: Record<string, string> = {}) => {
    const el = document.createElement("button");
    el.setAttribute("aria-label", nombre);
    for (const [clave, valor] of Object.entries(atributos)) el.setAttribute(clave, valor);
    return el;
  };
  const recoger = () => recogerCajasQueSeDesplazan() as Recogida[];

  describe("lo que se recoge dentro de la página", () => {
    test("ve la caja a la que su contenido no le cabe, y no la que le cabe, la que solo recorta ni la que no tiene desplazamiento propio", () => {
      /* Las medidas de la tabla de posiciones de Diseño a 1.280 px: pedía 590 y su tarjeta medía 583. */
      caja("portfolio-table-wrapper", 590, 583);
      caja("cabe", 500, 583);
      caja("recorta", 590, 583, "overflow-x: hidden;");
      caja("sin-desplazamiento", 590, 583, "");
      expect(recoger()).toEqual([{ firma: "div.portfolio-table-wrapper", nombre: "", pide: 590, tiene: 583, fuera: 7, controles: 0, delTodo: 0, ejemplo: "", conTeclado: false }]);
    });

    test("con un píxel de más, que es redondeo, no se desplaza; con dos, sí", () => {
      caja("justa", 584, 583);
      expect(recoger()).toEqual([]);
      caja("por-dos", 585, 583);
      expect(recoger().map((recogida) => [recogida.firma, recogida.fuera])).toEqual([["div.por-dos", 2]]);
    });

    test("también la que desplaza siempre; y no cuenta la que no se ve ni un campo de varias líneas", () => {
      caja("siempre", 700, 583, "overflow-x: scroll;");
      caja("oculta", 700, 583).hidden = true;
      caja("para-lectores", 700, 583).setAttribute("aria-hidden", "true");
      caja("invisible", 700, 583, "overflow-x: auto; visibility: hidden;");
      caja("sin-pintar", 700, 583, "overflow-x: auto; display: none;");
      const sinAlto = caja("sin-alto", 700, 583);
      sinAlto.getBoundingClientRect = () => ({ left: 100, right: 683, width: 583, height: 0 }) as DOMRect;
      caja("sin-ancho", 700, 0);
      /* Un campo de varias líneas se desplaza por dentro, y no es una caja de la disposición. */
      caja("campo", 700, 583, "overflow-x: auto;", "textarea");
      /* Y lo que va dentro de algo oculto, tampoco. */
      const plegado = document.createElement("section");
      plegado.hidden = true;
      plegado.append(caja("dentro-de-lo-plegado", 700, 583));
      document.body.append(plegado);
      expect(recoger().map((recogida) => recogida.firma)).toEqual(["div.siempre"]);
    });

    test("cuenta los controles de las filas que quedan fuera de la vista, del todo o a medias, y dice el primero", () => {
      /* La caja enseña de 100 a 683. Como en Diseño: el candado se ve, «Quitar» asoma a medias y lo demás no se ve. */
      const tabla = caja("portfolio-table-wrapper", 640, 583);
      dentro(tabla, boton("Bloquear el peso"), 600, 634);
      dentro(tabla, boton("Quitar Amundi Funds Global Equity"), 656, 690);
      dentro(tabla, boton("Ver la ficha"), 700, 734);
      expect(recoger()[0]).toMatchObject({ controles: 2, delTodo: 1, ejemplo: "Quitar Amundi Funds Global Equity", conTeclado: true });
    });

    test("un píxel no es estar fuera, y lo que quedó atrás al desplazar la caja también cuenta", () => {
      const tabla = caja("tabla", 900, 583);
      dentro(tabla, boton("Al borde"), 650, 684);
      dentro(tabla, boton("Atrás"), 40, 80);
      dentro(tabla, boton("Asomando por la izquierda"), 80, 120);
      expect(recoger()[0]).toMatchObject({ controles: 2, delTodo: 1, ejemplo: "Atrás" });
    });

    test("el borde de la caja no es sitio: lo que se ve empieza donde acaba el borde", () => {
      /* Con un borde de 4 px, la caja enseña de 104 a 687: sin contarlo, «Dentro» saldría como cortado. */
      const tabla = caja("con-borde", 700, 583, "overflow-x: auto; border-left-width: 4px;");
      dentro(tabla, boton("Dentro"), 650, 687);
      dentro(tabla, boton("Fuera"), 660, 690);
      expect(recoger()[0]).toMatchObject({ controles: 1, delTodo: 0, ejemplo: "Fuera" });
    });

    test("los botones de la cabecera de una tabla no cuentan: van con su columna", () => {
      const marco = caja("tabla__marco", 900, 583);
      marco.innerHTML = "<table><thead><tr><th></th></tr></thead><tbody><tr><td></td></tr></tbody></table>";
      dentro(marco.querySelector("th") as Element, boton("Ordenar por volatilidad"), 800, 880);
      expect(recoger()[0]).toMatchObject({ controles: 0, delTodo: 0, ejemplo: "" });
      /* El de una fila, sí: es lo que alguien busca para pulsar. */
      dentro(marco.querySelector("td") as Element, boton("Comparar"), 800, 880);
      expect(recoger()[0]).toMatchObject({ controles: 1, delTodo: 1, ejemplo: "Comparar" });
      /* La cabecera, se escriba como se escriba: una celda de cabecera de columna fuera de `thead`, o con su papel. */
      document.body.innerHTML = "";
      const otra = caja("tabla__marco", 900, 583);
      otra.innerHTML = '<table><tbody><tr><th scope="col"></th></tr></tbody></table><div role="columnheader"></div>';
      dentro(otra.querySelector("th") as Element, boton("Ordenar por nombre"), 800, 880);
      dentro(otra.querySelector("[role='columnheader']") as Element, boton("Ordenar por peso"), 800, 880);
      expect(recoger()[0]).toMatchObject({ controles: 0, ejemplo: "" });
    });

    test("un control que no se ve no cuenta, ni uno dentro de algo plegado", () => {
      const tabla = caja("tabla", 900, 583);
      dentro(tabla, boton("Sin caja"), 800, 800);
      dentro(tabla, boton("Invisible"), 800, 880).style.visibility = "hidden";
      const plegado = document.createElement("div");
      plegado.hidden = true;
      tabla.append(plegado);
      dentro(plegado, boton("Plegado"), 800, 880);
      expect(recoger()[0]).toMatchObject({ controles: 0, ejemplo: "" });
    });

    test("del control dice su nombre: su etiqueta, su texto, o lo que tenga; y lo recorta a 40 letras", () => {
      const nombreDe = (el: HTMLElement) => {
        document.body.innerHTML = "";
        dentro(caja("tabla", 900, 583), el, 800, 880);
        return recoger()[0].ejemplo;
      };
      expect(nombreDe(boton("Quitar Amundi"))).toBe("Quitar Amundi");
      expect(nombreDe(Object.assign(document.createElement("button"), { textContent: "  Añadir a\n la propuesta " }))).toBe("Añadir a la propuesta");
      const conTitulo = document.createElement("button");
      conTitulo.setAttribute("title", "Bloquear el peso");
      expect(nombreDe(conTitulo)).toBe("Bloquear el peso");
      const campo = document.createElement("input");
      campo.setAttribute("placeholder", "Peso");
      expect(nombreDe(campo)).toBe("Peso");
      expect(nombreDe(document.createElement("select"))).toBe("select");
      expect(nombreDe(boton("Quitar Amundi Funds Global Equity Sustainable Income de la propuesta"))).toBe("Quitar Amundi Funds Global Equity Sustai");
      /* Una etiqueta de solo espacios no es un nombre: vale lo siguiente que tenga algo escrito. */
      expect(nombreDe(Object.assign(boton("   "), { textContent: "Quitar" }))).toBe("Quitar");
      /* Y el que no tiene nada escrito se dice por lo que es: «el primero» no pasa a ser el siguiente. */
      document.body.innerHTML = "";
      const tabla = caja("tabla", 900, 583);
      dentro(tabla, boton("   "), 800, 880);
      dentro(tabla, boton("Otro"), 800, 880);
      expect(recoger()[0]).toMatchObject({ controles: 2, ejemplo: "button" });
    });

    test("dice si lleva con qué enfocarla: la caja se enfoca, o lleva dentro algo que se enfoca", () => {
      const alcanza = (preparar: (recienHecha: HTMLElement) => void) => {
        document.body.innerHTML = "";
        preparar(caja("tabla", 900, 583));
        return recoger()[0].conTeclado;
      };
      const enlace = (destino?: string) => {
        const a = document.createElement("a");
        if (destino) a.setAttribute("href", destino);
        return a;
      };
      /* Una tabla de cifras, sin nada dentro que se enfoque: con teclado no hay manera de llegar a lo que queda fuera. */
      expect(alcanza(() => undefined)).toBe(false);
      /* La caja se enfoca, como el marco de la pieza de tablas. */
      expect(alcanza((c) => c.setAttribute("tabindex", "0"))).toBe(true);
      expect(alcanza((c) => c.setAttribute("tabindex", "-1"))).toBe(false);
      /* O lleva dentro un botón, un enlace o un campo. Si queda fuera de la vista vale igual: al enfocarlo, la caja se
         desplaza hasta él. */
      expect(alcanza((c) => void dentro(c, boton("Quitar"), 200, 240))).toBe(true);
      expect(alcanza((c) => void dentro(c, boton("Quitar"), 800, 880))).toBe(true);
      expect(alcanza((c) => void dentro(c, enlace("/ficha"), 200, 240))).toBe(true);
      expect(alcanza((c) => void dentro(c, document.createElement("input"), 200, 240))).toBe(true);
      /* O algo que no es un control pero entra en el recorrido del tabulador. */
      expect(alcanza((c) => void dentro(c, Object.assign(document.createElement("div"), { tabIndex: 0 }), 200, 240))).toBe(true);
      /* No vale el desactivado, el que se saca del recorrido del tabulador, el que no se ve, un ancla sin destino ni un
         campo oculto. */
      expect(alcanza((c) => void dentro(c, boton("Quitar", { disabled: "" }), 200, 240))).toBe(false);
      expect(alcanza((c) => void dentro(c, boton("Quitar", { tabindex: "-1" }), 200, 240))).toBe(false);
      expect(alcanza((c) => void dentro(c, boton("Quitar"), 200, 200))).toBe(false);
      expect(alcanza((c) => void dentro(c, enlace(), 200, 240))).toBe(false);
      expect(alcanza((c) => void dentro(c, Object.assign(document.createElement("input"), { type: "hidden" }), 200, 240))).toBe(false);
      /* Lo desactivado no entra aunque lleve `tabindex="0"`; y un `tabindex` que no es un número no quita lo que un
         botón ya es. */
      expect(alcanza((c) => void dentro(c, boton("Quitar", { disabled: "", tabindex: "0" }), 200, 240))).toBe(false);
      expect(alcanza((c) => void dentro(c, boton("Quitar", { tabindex: "no" }), 200, 240))).toBe(true);
      expect(alcanza((c) => c.setAttribute("tabindex", "no"))).toBe(false);
    });

    test("la caja se llama como su etiqueta; si no la tiene, como su tabla; y su firma lleva dos clases", () => {
      caja("tabla__marco tabla__marco--cabecera-fija otra", 900, 583).setAttribute("aria-label", "Activos (tabla desplazable)");
      caja("report-table-wrapper", 900, 583).innerHTML = '<table aria-label="Comparativa de métricas"></table>';
      caja("retro-table-wrapper", 900, 583).innerHTML = "<table><caption> Retrocesiones\n por fondo </caption></table>";
      const rotulada = caja("rotulada", 900, 583, "overflow-x: auto;", "section");
      rotulada.setAttribute("aria-labelledby", "titulo-de-la-caja");
      document.body.append(Object.assign(document.createElement("h2"), { id: "titulo-de-la-caja", textContent: "Mapa de correlaciones" }));
      caja("", 900, 583, "overflow-x: auto;", "pre");
      expect(recoger().map((recogida) => [recogida.firma, recogida.nombre])).toEqual([
        ["div.tabla__marco.tabla__marco--cabecera-fija", "Activos (tabla desplazable)"],
        ["div.report-table-wrapper", "Comparativa de métricas"],
        ["div.retro-table-wrapper", "Retrocesiones por fondo"],
        ["section.rotulada", "Mapa de correlaciones"],
        ["pre", ""]
      ]);
    });

    test("no usa nada de fuera: reconstruida como la recibe el navegador, recoge lo mismo", () => {
      /* `page.evaluate` manda el texto de la función. Si dentro usara un nombre de su módulo, aquí, llamada con su
         cierre, pasaría todas las pruebas, y en el navegador daría un error: la pantalla quedaría sin medir. */
      const aislada = new Function(`return (${String(recogerCajasQueSeDesplazan)})`)() as () => Recogida[];
      const tabla = caja("portfolio-table-wrapper", 640, 583);
      dentro(tabla, boton("Quitar Amundi"), 656, 690);
      expect(aislada()).toEqual([{ firma: "div.portfolio-table-wrapper", nombre: "", pide: 640, tiene: 583, fuera: 57, controles: 1, delTodo: 0, ejemplo: "Quitar Amundi", conTeclado: true }]);
      expect(aislada()).toEqual(recoger());
    });
  });

  const recogida = (cambios: Partial<Recogida> = {}): Recogida => ({ firma: "div.portfolio-table-wrapper", nombre: "", pide: 590, tiene: 583, fuera: 7, controles: 0, delTodo: 0, ejemplo: "", conTeclado: true, ...cambios });

  test("cada caja se dice en una línea: quién es, cuánto deja fuera, qué controles esconde y si lleva con qué enfocarla", () => {
    const base = "div.portfolio-table-wrapper: pide 590 px y le caben 583 (7 px fuera de la vista)";
    expect(describirCaja(recogida())).toBe(base);
    expect(describirCaja(recogida({ firma: "div.tabla__marco", nombre: "Activos (tabla desplazable)", pide: 1420, tiene: 990, fuera: 430 }))).toBe("div.tabla__marco «Activos (tabla desplazable)»: pide 1420 px y le caben 990 (430 px fuera de la vista)");
    expect(describirCaja(recogida({ controles: 8, delTodo: 0, ejemplo: "Quitar Amundi" }))).toBe(`${base}; 8 controles fuera, todos a medias; el primero, «Quitar Amundi»`);
    expect(describirCaja(recogida({ controles: 8, delTodo: 8, ejemplo: "Quitar Amundi" }))).toBe(`${base}; 8 controles fuera, todos del todo; el primero, «Quitar Amundi»`);
    expect(describirCaja(recogida({ controles: 8, delTodo: 3, ejemplo: "Quitar Amundi" }))).toBe(`${base}; 8 controles fuera, 3 del todo y 5 a medias; el primero, «Quitar Amundi»`);
    expect(describirCaja(recogida({ controles: 1, delTodo: 1, ejemplo: "Comparar" }))).toBe(`${base}; 1 control fuera, del todo: «Comparar»`);
    expect(describirCaja(recogida({ controles: 1, delTodo: 0, ejemplo: "Comparar" }))).toBe(`${base}; 1 control fuera, a medias: «Comparar»`);
    expect(describirCaja(recogida({ conTeclado: false }))).toBe(`${base}; no se enfoca ni lleva dentro nada que se enfoque`);
    expect(describirCaja(recogida({ controles: 2, delTodo: 2, ejemplo: "Comparar", conTeclado: false }))).toBe(`${base}; 2 controles fuera, todos del todo; el primero, «Comparar»; no se enfoca ni lleva dentro nada que se enfoque`);
  });

  test("de cada pantalla van por delante las que alguien tiene que mirar, y las cuentas se hacen sobre todas", () => {
    const corriente = recogida({ firma: "div.tabla__marco", fuera: 430 });
    const pocoFuera = recogida({ firma: "div.gestor-tabla-envoltorio", fuera: 12 });
    const sinTeclado = recogida({ firma: "div.heatmap", fuera: 40, conTeclado: false });
    const conControl = recogida({ firma: "div.portfolio-table-wrapper", fuera: 7, controles: 8 });
    expect(resumirCajasQueSeDesplazan([pocoFuera, corriente, sinTeclado, conControl])).toEqual({
      cajasDesplazables: [conControl, sinTeclado, corriente, pocoFuera],
      cajasQueSeDesplazan: 4,
      cajasConControlesFuera: 1,
      cajasSinTeclado: 1
    });
    /* Entre las que esconden un control, primero la que además no lleva nada que se enfoque, aunque deje menos fuera. */
    const conLasDos = recogida({ firma: "div.las-dos", fuera: 3, controles: 1, conTeclado: false });
    expect(resumirCajasQueSeDesplazan([conControl, conLasDos]).cajasDesplazables).toEqual([conLasDos, conControl]);
    expect(resumirCajasQueSeDesplazan([])).toEqual({ cajasDesplazables: [], cajasQueSeDesplazan: 0, cajasConControlesFuera: 0, cajasSinTeclado: 0 });
  });

  test("de las corrientes se guardan doce por pantalla como mucho; de las que hay que mirar, todas; y las cuentas siguen siendo de todas", () => {
    expect(TOPE_DE_CAJAS_POR_PANTALLA).toBe(12);
    /* Quince cajas, cada una deja fuera menos que la anterior. La última, la que menos, esconde un control, y la
       penúltima no lleva nada que se enfoque: quedan trece corrientes, y de ellas se guardan doce. */
    const quince = Array.from({ length: 15 }, (_, i) => recogida({ firma: `div.caja-${i}`, fuera: 100 - i, controles: i === 14 ? 3 : 0, conTeclado: i !== 13 }));
    const resumen = resumirCajasQueSeDesplazan(quince);
    expect(resumen.cajasDesplazables.map((una: Recogida) => una.firma)).toEqual(["div.caja-14", "div.caja-13", ...Array.from({ length: 12 }, (_, i) => `div.caja-${i}`)]);
    expect(resumen).toMatchObject({ cajasQueSeDesplazan: 15, cajasConControlesFuera: 1, cajasSinTeclado: 1 });
    /* Trece que esconden un control y una sin nada que se enfoque. Con un tope para todas, esa se perdía y el informe
       decía «ninguna» donde la había. */
    const catorce = [...Array.from({ length: 13 }, (_, i) => recogida({ firma: `div.con-control-${i}`, controles: 1 })), recogida({ firma: "div.sin-foco", conTeclado: false })];
    const deMirar = resumirCajasQueSeDesplazan(catorce);
    expect(deMirar.cajasDesplazables).toHaveLength(14);
    expect(deMirar.cajasDesplazables.at(-1)).toMatchObject({ firma: "div.sin-foco", conTeclado: false });
    expect(deMirar).toMatchObject({ cajasQueSeDesplazan: 14, cajasConControlesFuera: 13, cajasSinTeclado: 1 });
  });
});

describe("la batería y el recorrido usan las mismas piezas", () => {
  test.each([
    ["la batería", BATERIA],
    ["el recorrido", RECORRIDO]
  ])("%s toma de ellas los anchos y la barra, y no lleva los suyos", (_nombre, guion) => {
    expect(guion).toMatch(/import \{[^}]*\bresolverAnchos\b[^}]*\} from "\.\/anchosDeCaptura\.mjs";/);
    expect(guion).toMatch(/import \{[^}]*\blanzamiento\b[^}]*\breservarHuecoDeLaBarra\b[^}]*\bsinBarrasDeTableta\b[^}]*\} from "\.\/barraDeDesplazamiento\.mjs";/);
    expect(guion).toMatch(/chromium\.launch\(lanzamiento\(/);
    expect(guion).toMatch(/if \(conDedo\w*\) await sinBarrasDeTableta\(/);
    /* Ni un mapa de anchos propio, ni la regla del dedo escrita a mano. */
    expect(guion).not.toMatch(/\[2560, 1440\]/);
    expect(guion).not.toMatch(/<= 1024/);
  });

  test("la batería reserva el hueco de la barra antes de medir, mide antes de fotografiar y cuenta como incidencia que la barra no esté", () => {
    const reserva = BATERIA.indexOf("const barra = await reservarHuecoDeLaBarra(page);");
    const mide = BATERIA.indexOf("const metrics = await page.evaluate(");
    const foto = BATERIA.indexOf("await fotoDePaginaEntera(page");
    expect(reserva).toBeGreaterThan(-1);
    expect(mide).toBeGreaterThan(reserva);
    expect(foto).toBeGreaterThan(mide);
    /* Con ratón, una pantalla más alta que la ventana tiene barra: si mide cero, la pasada vuelve a medir con sitio de más. */
    expect(BATERIA).toContain("const sinBarra = !BARRAS_OCULTAS && !conDedoPedido && metrics.scrollH > metrics.clientH + 1 && barra === 0;");
    expect(BATERIA).toMatch(/const bad = report\.filter\(\(r\) => [^\n]*\|\| r\.sinBarra\);/);
  });

  test("el recorrido mide siempre por el mismo sitio, y lo medido llega entero a la fila del informe", () => {
    const medir = RECORRIDO.slice(RECORRIDO.indexOf("async function medir(page) {"), RECORRIDO.indexOf("async function pasarAxe(page) {"));
    const pasos = [
      "await reservarHuecoDeLaBarra(page);",
      "await page.evaluate(medirPagina);",
      "await page.evaluate(recogerTextoCortado, CORTES_ADMITIDOS.map((corte) => corte.selector));",
      "await page.evaluate(recogerCajasQueSeDesplazan);",
      "return { ...medida, ...resumirTextoCortado(cortados), ...resumirCajasQueSeDesplazan(cajas), barra };"
    ].map((paso) => medir.indexOf(paso));
    expect(pasos.every((posicion) => posicion > -1)).toBe(true);
    expect([...pasos].sort((a, b) => a - b)).toEqual(pasos);
    /* Las cajas que se desplazan salen de su pieza, y lo que hay que mirar se dice también al paso, pantalla a pantalla. */
    expect(RECORRIDO).toContain('import { recogerCajasQueSeDesplazan, resumirCajasQueSeDesplazan } from "./cajasQueSeDesplazan.mjs";');
    expect(RECORRIDO).toContain("${medida?.cajasConControlesFuera ? `cajas con control fuera ${medida.cajasConControlesFuera} ` : \"\"}${medida?.cajasSinTeclado ? `cajas sin nada que se enfoque ${medida.cajasSinTeclado} ` : \"\"}");
    /* Nadie mide la página por su cuenta, sin pasar por ahí. */
    expect(RECORRIDO.match(/page\.evaluate\(medirPagina\)/g)).toHaveLength(1);
    expect(RECORRIDO.match(/await medir\(page\)/g)).toHaveLength(2);
    /* Y la fila lleva lo que el cierre necesita: lo medido, si iba con dedo y lo del Modo cliente. */
    expect(RECORRIDO).toMatch(/informe\.push\(\{ ancho, marca, clave, conDedo, id: pantalla\.id, ruta: pantalla\.ruta, \.\.\.\(medida \?\? \{\}\), sinMedir: medida === null, modoCliente,/);
    /* Si medir se rompe, la pantalla se apunta como no medida y la pasada sigue; y lo que no llegó a mirarse se dice
       como no mirado, no como limpio: el Modo cliente y la accesibilidad. */
    expect(RECORRIDO).toContain("anotar(`no se pudo medir: ${String(error).slice(0, 200)}`);");
    expect(RECORRIDO).toContain('if (pantalla.modoCliente && modoCliente === null) modoCliente = ["no se pudo medir en Modo cliente"];');
    expect(RECORRIDO).toContain('if (conAxe(marca) && axe === null) axe = [{ regla: "axe-no-corrio", impacto: "n/d", ayuda: "no se pudo medir la pantalla", nodos: 0, ejemplos: [] }];');
    /* La foto va aparte: si falla ella, lo medido vale, y una comprobación del Modo cliente que salió limpia sigue limpia. */
    expect(RECORRIDO).toContain("anotar(`no se pudo fotografiar: ${String(error).slice(0, 200)}`);");
    /* Y la pantalla de acceso, que se mide antes de entrar, igual que las demás. */
    expect(RECORRIDO).toContain('informe.push({ ancho, marca, clave, conDedo, id: "acceso", ...(medida ?? {}), sinMedir: medida === null, consola: [], peticiones: [], axe, msDeCarga: null, fallo });');
    expect(RECORRIDO).toMatch(/const cierre = cerrarElRecorrido\(\{\s*informe,/);
    expect(RECORRIDO).toContain("if (cierre.codigo) process.exitCode = cierre.codigo;");
  });
});

describe("el cierre del recorrido: el informe, el resumen y el código de salida", () => {
  const ANCHOS = [
    { clave: "d", ancho: 1440, alto: 900, conDedo: false },
    { clave: "tp", ancho: 768, alto: 1024, conDedo: true }
  ];
  /** Una fila como las que mide el recorrido: una pantalla que desplaza, con su barra, y sin nada que decir. */
  const fila = (cambios: Record<string, unknown> = {}) => ({
    ancho: 1440,
    marca: "1440",
    clave: "d",
    conDedo: false,
    id: "mercado",
    anchoDePagina: 1430,
    anchoDeVentana: 1430,
    altoDePagina: 2400,
    altoDeVentana: 900,
    barra: 10,
    consola: [],
    peticiones: [],
    axe: null,
    msDeCarga: 900,
    esElAcceso: false,
    titulos: ["Mercado"],
    titulosDePantalla: 1,
    desborde: [],
    textoCortado: [],
    cortesAdmitidos: 0,
    ...cambios
  });
  const enTableta = (cambios: Record<string, unknown> = {}) => fila({ ancho: 768, marca: "768", clave: "tp", conDedo: true, anchoDePagina: 768, anchoDeVentana: 768, altoDeVentana: 1024, barra: 0, ...cambios });
  const cerrar = (informe: Record<string, unknown>[], cambios: Record<string, unknown> = {}) =>
    cerrarElRecorrido({ informe, etiqueta: "prueba", base: "http://localhost:5174", fecha: "2026-11-19 05:00", pantallas: [{ id: "mercado" }], anchos: ANCHOS, barrasOcultas: false, axeEnTodos: false, marcaDeAxe: "1440", ...cambios });
  const texto = (lineas: string[]) => lineas.join("\n");

  test("una pasada sin nada que decir sale con código 0, y dice la barra que midió, no la que supone", () => {
    const cierre = cerrar([fila(), enTableta()]);
    expect(cierre.codigo).toBe(0);
    expect(cierre.errores).toEqual([]);
    expect(cierre.lineas[2]).toBe("Base: http://localhost:5174. Pantallas: 1. Anchos: 1440, 768 (una «d» detrás es con dedo). Con ratón, con la barra de desplazamiento puesta (10 px, medida en 1 pantalla que desplaza); con dedo, sin ella.");
    expect(texto(cierre.lineas)).toContain("Ninguno entre los que se miden: ningún texto que su hoja mande recortar se queda sin sitio");
    expect(texto(cierre.lineas)).toContain("Cada pantalla enseña un título de pantalla (`h1`), y solo uno.");
    expect(texto(cierre.lineas)).toContain("No se pidió ninguna pantalla en Modo cliente en esta pasada.");
  });

  test("un texto cortado sale en el informe y en la consola, y no cambia el código de salida: se lee, no es una puerta", () => {
    const corte = "span.cell-entity__name, 2 textos; el que más pierde, «Amundi Funds Global Equity»: a 2 líneas, le faltan 18 px de alto";
    const cierre = cerrar([fila({ textoCortado: [corte], textosCortados: 2 }), enTableta()]);
    expect(cierre.codigo).toBe(0);
    expect(texto(cierre.lineas)).toContain(`- **1440 · mercado** — ${corte}`);
    expect(cierre.consola).toContain(`  cortado · 1440 · mercado · ${corte}`);
    expect(cierre.consola[0]).toContain("Con texto cortado: 1.");
    /* Y dice siempre lo que no mide, para que «ninguno» no se lea como «nada se corta». */
    expect(texto(cierre.lineas)).toContain("No se mide el texto de un desplegable ni el de un campo");
  });

  test("lo que se sale de la ventana se lista, no solo se cuenta", () => {
    const cierre = cerrar([fila({ desborde: ["div.rejilla derecha=1502"] })]);
    expect(texto(cierre.lineas)).toContain("- **1440 · mercado** — div.rejilla derecha=1502");
    expect(cierre.consola).toContain("  fuera · 1440 · mercado · div.rejilla derecha=1502");
  });

  describe("las cajas que se desplazan de lado", () => {
    const caja = (cambios: Record<string, unknown> = {}) => ({ firma: "div.tabla__marco", nombre: "Activos (tabla desplazable)", pide: 1420, tiene: 990, fuera: 430, controles: 0, delTodo: 0, ejemplo: "", conTeclado: true, ...cambios });
    /** Una fila con las cajas que se digan, y sus cuentas. */
    const conCajas = (cajas: Record<string, unknown>[], cambios: Record<string, unknown> = {}) =>
      fila({ cajasDesplazables: cajas, cajasQueSeDesplazan: cajas.length, cajasConControlesFuera: cajas.filter((una) => Number(una.controles) > 0).length, cajasSinTeclado: cajas.filter((una) => !una.conTeclado).length, ...cambios });
    const seccion = (lineas: string[]) => {
      const todo = texto(lineas);
      return todo.slice(todo.indexOf("## Cajas que se desplazan de lado"), todo.indexOf("## Modo cliente"));
    };
    const DE_LA_TABLA_DE_DISENO = caja({ firma: "div.portfolio-table-wrapper", nombre: "", pide: 590, tiene: 583, fuera: 7, controles: 8, delTodo: 0, ejemplo: "Quitar Amundi" });

    test("sin ninguna, lo dice; y dice siempre lo que no mide, para que «ninguna» no se lea como «nada queda fuera»", () => {
      const cierre = cerrar([fila(), enTableta()]);
      expect(seccion(cierre.lineas)).toContain("Ninguna: en ninguna pantalla hay una caja con desplazamiento propio a la que su contenido no le quepa de ancho.");
      expect(seccion(cierre.lineas)).toContain("Los botones de la cabecera de una tabla no cuentan como controles fuera de la vista: van con su columna. No se mide lo que queda fuera en vertical");
      expect(seccion(cierre.lineas)).not.toContain("###");
      expect(cierre.consola[0]).toContain("Con cajas que se desplazan de lado: 0; con algún control fuera de la vista: 0; con alguna sin nada que se enfoque: 0.");
      expect(cierre.consola.filter((linea: string) => linea.includes("caja ·"))).toEqual([]);
    });

    test("una tabla que se desplaza dentro de su marco es lo previsto: se cuenta por clase, y no hay nada que mirar", () => {
      const cierre = cerrar([conCajas([caja()]), enTableta()]);
      expect(cierre.codigo).toBe(0);
      expect(seccion(cierre.lineas)).toContain("Que una tabla ancha lo haga es lo previsto.");
      expect(seccion(cierre.lineas)).toContain("Ninguna: tal como se abre cada pantalla, ningún botón, enlace ni campo de una fila queda fuera de la vista dentro de una caja que se desplaza.");
      expect(seccion(cierre.lineas)).toContain("Ninguna: toda caja que se desplaza de lado se puede enfocar, o lleva dentro algo que se enfoca.");
      expect(seccion(cierre.lineas)).toContain("| div.tabla__marco | 1 | 1440 | 430 px (1440 · mercado) |");
      expect(cierre.consola[0]).toContain("Con cajas que se desplazan de lado: 1; con algún control fuera de la vista: 0; con alguna sin nada que se enfoque: 0.");
      expect(cierre.consola.filter((linea: string) => linea.includes("caja ·"))).toEqual([]);
    });

    test("la que deja un control fuera de la vista se lista con su pantalla y su ancho, y sale en la consola; el código no cambia: se lee, no es una puerta", () => {
      const cierre = cerrar([conCajas([DE_LA_TABLA_DE_DISENO, caja()], { id: "diseno" }), enTableta()], { pantallas: [{ id: "diseno" }] });
      expect(cierre.codigo).toBe(0);
      const linea = "div.portfolio-table-wrapper: pide 590 px y le caben 583 (7 px fuera de la vista); 8 controles fuera, todos a medias; el primero, «Quitar Amundi»";
      /* Solo la que esconde un control: la tabla corriente de la misma pantalla no se lista ahí. */
      expect(seccion(cierre.lineas)).toContain(`### Con algún control fuera de la vista\n\n- **1440 · diseno** — ${linea}\n`);
      expect(seccion(cierre.lineas)).toContain("### Sin nada que se enfoque\n\nNinguna: toda caja");
      expect(cierre.consola).toContain(`  caja · 1440 · diseno · ${linea}`);
      expect(cierre.consola[0]).toContain("Con cajas que se desplazan de lado: 1; con algún control fuera de la vista: 1; con alguna sin nada que se enfoque: 0.");
    });

    test("la que no lleva nada que se enfoque, también, y se dice lo que eso quiere decir; una caja con las dos cosas sale en las dos listas y una vez en la consola", () => {
      const delMapa = caja({ firma: "div.heatmap", nombre: "", pide: 900, tiene: 700, fuera: 200, conTeclado: false });
      const conLasDos = { ...DE_LA_TABLA_DE_DISENO, conTeclado: false };
      const cierre = cerrar([conCajas([delMapa], { id: "analisis" }), conCajas([conLasDos, caja()], { id: "diseno" })], { pantallas: [{ id: "analisis" }, { id: "diseno" }], anchos: [ANCHOS[0]] });
      expect(cierre.codigo).toBe(0);
      const mapa = "div.heatmap: pide 900 px y le caben 700 (200 px fuera de la vista); no se enfoca ni lleva dentro nada que se enfoque";
      const tabla = "div.portfolio-table-wrapper: pide 590 px y le caben 583 (7 px fuera de la vista); 8 controles fuera, todos a medias; el primero, «Quitar Amundi»; no se enfoca ni lleva dentro nada que se enfoque";
      const loQueQuiereDecir = "Con el teclado solo se llega a lo que queda fuera de estas en un navegador que enfoque por su cuenta una caja que se desplaza: la página no lo garantiza.";
      expect(seccion(cierre.lineas)).toContain(`### Con algún control fuera de la vista\n\n- **1440 · diseno** — ${tabla}\n\n### Sin nada que se enfoque\n\n${loQueQuiereDecir}\n\n- **1440 · analisis** — ${mapa}\n- **1440 · diseno** — ${tabla}\n`);
      expect(cierre.consola.filter((linea: string) => linea.includes("caja ·"))).toEqual([`  caja · 1440 · analisis · ${mapa}`, `  caja · 1440 · diseno · ${tabla}`]);
      expect(cierre.consola[0]).toContain("Con cajas que se desplazan de lado: 2; con algún control fuera de la vista: 1; con alguna sin nada que se enfoque: 2.");
    });

    test("por clase de caja: en cuántas pantallas, a qué anchos de menor a mayor y dónde deja más fuera; primero la que se desplaza en más pantallas, y entre iguales la que más deja fuera", () => {
      /* El orden en que llegan no es el del informe: el mapa llega el primero y es el que menos pesa. */
      const cierre = cerrar(
        [
          conCajas([caja({ firma: "div.heatmap", fuera: 40 })], { id: "analisis" }),
          conCajas([caja()]),
          conCajas([caja({ fuera: 10 })], { id: "buscador" }),
          conCajas([caja({ firma: "div.gestor-tabla-envoltorio", fuera: 200 })], { id: "clientes" }),
          enTableta({ cajasDesplazables: [caja({ fuera: 600 })], cajasQueSeDesplazan: 1 }),
          fila({ id: "planes" })
        ],
        { pantallas: [{ id: "analisis" }, { id: "mercado" }, { id: "buscador" }, { id: "clientes" }, { id: "planes" }] }
      );
      const tabla = seccion(cierre.lineas);
      expect(tabla).toContain(
        "### Todas, por clase de caja\n\n| Caja | Pantallas | Anchos | Donde más deja fuera |\n|---|---|---|---|\n| div.tabla__marco | 2 | 768, 1440 | 600 px (768 · mercado) |\n| div.gestor-tabla-envoltorio | 1 | 1440 | 200 px (1440 · clientes) |\n| div.heatmap | 1 | 1440 | 40 px (1440 · analisis) |\n"
      );
      /* Una pantalla sin cajas no cuenta, y nada dice que haya más de las guardadas. */
      expect(cierre.consola[0]).toContain("Con cajas que se desplazan de lado: 5;");
      expect(tabla).not.toContain("más cajas de las que se guardan");
    });

    test("si una pantalla tiene más cajas de las que se guardan, se dice cuál y cuántas", () => {
      const cierre = cerrar([conCajas([caja()], { cajasQueSeDesplazan: 15 })], { anchos: [ANCHOS[0]] });
      expect(seccion(cierre.lineas)).toContain("En 1 pantalla hay más cajas de las que se guardan —de cada pantalla, todas las que hay que mirar y, de las demás, 12—: 1440 · mercado (15).");
    });

    test("una pantalla que no se pudo medir no rompe la cuenta de las cajas", () => {
      const rota = { ancho: 1440, marca: "1440", clave: "d", conDedo: false, id: "buscador", sinMedir: true, modoCliente: null, consola: [], peticiones: [], esperados: 0, axe: null, msDeCarga: 1200, fallo: "no se pudo medir" };
      const cierre = cerrar([conCajas([caja()]), rota], { pantallas: [{ id: "mercado" }, { id: "buscador" }], anchos: [ANCHOS[0]] });
      expect(seccion(cierre.lineas)).toContain("| div.tabla__marco | 1 | 1440 | 430 px (1440 · mercado) |");
    });
  });

  describe("el Modo cliente", () => {
    const PEDIDAS = [{ id: "mercado" }, { id: "informes-modo-cliente", modoCliente: { debeLeerse: "Informe para el cliente" } }];
    const enModoCliente = (fallos: string[], cambios: Record<string, unknown> = {}) => fila({ id: "informes-modo-cliente", modoCliente: fallos, ...cambios });

    test("medido en todos los anchos y sin fallos, lo dice contando pantallas y anchos, no filas", () => {
      const cierre = cerrar([fila(), enModoCliente([]), enTableta(), enTableta({ id: "informes-modo-cliente", modoCliente: [] })], { pantallas: PEDIDAS });
      expect(cierre.codigo).toBe(0);
      expect(texto(cierre.lineas)).toContain("En 1 pantalla medida en Modo cliente (informes-modo-cliente), a 2 anchos, el interruptor quedó encendido");
    });

    test("si se lee algo reservado al asesor, sale con código 1: es lo que no puede pasar delante de un cliente", () => {
      const cierre = cerrar([enModoCliente(["en Modo cliente se lee «etrocesi»"]), enTableta({ id: "informes-modo-cliente", modoCliente: [] })], { pantallas: PEDIDAS });
      expect(cierre.codigo).toBe(1);
      expect(cierre.errores).toEqual(["MODO CLIENTE: 1 pantalla deja ver algo reservado al asesor, o no se pudo comprobar."]);
      expect(texto(cierre.lineas)).toContain("- **1440 · informes-modo-cliente** — en Modo cliente se lee «etrocesi»");
    });

    test("si una pantalla pedida en Modo cliente no se midió en algún ancho, también: no vale decir que no se pidió", () => {
      /* Falta en la tableta, y en el portátil la fila llegó sin lo del Modo cliente. */
      const cierre = cerrar([fila({ id: "informes-modo-cliente", modoCliente: null })], { pantallas: PEDIDAS });
      expect(cierre.codigo).toBe(1);
      expect(cierre.errores).toEqual(["MODO CLIENTE: se pidió y no se midió en 1440 · informes-modo-cliente, 768 · informes-modo-cliente."]);
      expect(texto(cierre.lineas)).toContain("- **768 · informes-modo-cliente** — se pidió en Modo cliente y no se midió");
    });
  });

  test("si una pantalla del recorrido es la de acceso, no se recorrió: código 1", () => {
    const cierre = cerrar([fila({ id: "acceso", esElAcceso: true }), fila({ esElAcceso: true }), fila({ id: "buscador", esElAcceso: true })], { pantallas: [{ id: "mercado" }, { id: "buscador" }], anchos: [ANCHOS[0]] });
    expect(cierre.codigo).toBe(1);
    expect(cierre.errores).toEqual(["NO SE RECORRIÓ en 1440: estas pantallas son la de acceso: mercado, buscador."]);
  });

  test("una pantalla que desplaza y se midió sin barra hace salir con código 1: el navegador no la está pintando", () => {
    const sinBarra = cerrar([fila({ barra: 0 })], { anchos: [ANCHOS[0]] });
    expect(sinBarra.codigo).toBe(1);
    expect(sinBarra.errores[0]).toMatch(/^SIN BARRA: 1 pantalla que desplaza se midió sin barra de desplazamiento/);
    expect(texto(sinBarra.lineas)).toContain("- **1440 · mercado** — 2400 px de alto en una ventana de 900");
    /* No lo es con dedo, ni en una pantalla que no desplaza, ni cuando se pide repetir una pasada de las de antes. */
    expect(cerrar([enTableta()]).codigo).toBe(0);
    expect(cerrar([fila({ barra: 0, altoDePagina: 900 })]).codigo).toBe(0);
    const comoAntes = cerrar([fila({ barra: 0 })], { barrasOcultas: true });
    expect(comoAntes.codigo).toBe(0);
    expect(comoAntes.lineas[2]).toContain("Con las barras de desplazamiento ocultas, como en las pasadas anteriores al 19-11-2026.");
  });

  test("de la barra dice lo que midió y en cuántas pantallas, no en cuántas filas; y si no midió ninguna, no dice que la haya", () => {
    /* Dos pantallas en dos anchos con ratón son dos pantallas, a dos anchos: no cuatro pantallas. */
    const dosAnchos = [ANCHOS[0], { clave: "p", ancho: 1280, alto: 800, conDedo: false }];
    const enOtroAncho = (cambios: Record<string, unknown> = {}) => fila({ ancho: 1280, marca: "1280", clave: "p", ...cambios });
    const cuatroFilas = cerrar([fila(), fila({ id: "buscador" }), enOtroAncho(), enOtroAncho({ id: "buscador" })], { pantallas: [{ id: "mercado" }, { id: "buscador" }], anchos: dosAnchos });
    expect(cuatroFilas.lineas[2]).toContain("Con ratón, con la barra de desplazamiento puesta (10 px, medida en 2 pantallas que desplazan, a 2 anchos); con dedo, sin ella.");
    /* Ninguna pantalla desplaza: no hay barra que medir, y no se dice que esté puesta. */
    expect(cerrar([fila({ altoDePagina: 900, barra: 0 })], { anchos: [ANCHOS[0]] }).lineas[2]).toContain("Con ratón, ninguna pantalla desplaza: no hay barra que medir.");
    /* Todo con dedo. */
    expect(cerrar([enTableta()], { anchos: [ANCHOS[1]] }).lineas[2]).toContain("Todo con dedo: sin barra de desplazamiento que ocupe sitio.");
    /* Desplazan y ninguna tiene barra: la cabecera lo dice, no lo contrario. */
    const sinNinguna = cerrar([fila({ barra: 0 }), fila({ id: "buscador", barra: 0 })], { pantallas: [{ id: "mercado" }, { id: "buscador" }], anchos: [ANCHOS[0]] });
    expect(sinNinguna.lineas[2]).toContain("Con ratón, SIN barra de desplazamiento: no se midió en ninguna de las 2 pantallas que desplazan (se listan abajo).");
    expect(sinNinguna.lineas[2]).not.toContain("con la barra de desplazamiento puesta");
    expect(cerrar([fila({ barra: 0 })], { anchos: [ANCHOS[0]] }).lineas[2]).toContain("no se midió en la única pantalla que desplaza (se listan abajo).");
    /* Unas con barra y otras sin ella: se dice la medida y cuántas faltan. */
    const mezcla = cerrar([fila(), fila({ id: "buscador", barra: 0 })], { pantallas: [{ id: "mercado" }, { id: "buscador" }], anchos: [ANCHOS[0]] });
    expect(mezcla.lineas[2]).toContain("(10 px, medida en 1 pantalla que desplaza), salvo en 1 pantalla, que se lista abajo; con dedo, sin ella.");
    expect(mezcla.codigo).toBe(1);
  });

  test("una pantalla que no se pudo medir no rompe el informe de las demás, pero tampoco pasa por buena: código 1", () => {
    const rota = { ancho: 1440, marca: "1440", clave: "d", conDedo: false, id: "buscador", ruta: "/buscador", sinMedir: true, modoCliente: null, consola: [], peticiones: [], esperados: 0, axe: null, msDeCarga: 1200, fallo: "no se pudo medir: Error: Execution context was destroyed" };
    const cierre = cerrar([fila(), rota], { pantallas: [{ id: "mercado" }, { id: "buscador" }], anchos: [ANCHOS[0]] });
    expect(cierre.codigo).toBe(1);
    expect(cierre.errores).toEqual(["NO SE MIDIÓ en 1440: buscador."]);
    /* Arriba del todo, antes de cualquier «ninguno»: de esa pantalla no se sabe nada. */
    expect(cierre.lineas[4]).toBe("**Sin medir: 1 pantalla, que se lista abajo. Lo que sigue habla solo de las que sí se midieron.**");
    /* En la tabla no dice que no desborda: dice que no se sabe. */
    expect(texto(cierre.lineas)).toContain("| buscador (no se pudo medir: Error: Execution context was destroyed) | — | 0 | 0 | — | 1200 | — |");
    expect(texto(cierre.lineas)).toContain("## Pantallas que no se pudieron medir");
    expect(texto(cierre.lineas)).toContain("- **1440 · buscador** — no se pudo medir: Error: Execution context was destroyed");
    expect(cierre.consola).toContain("  sin preparar · 1440 · buscador · no se pudo medir: Error: Execution context was destroyed");
    expect(cierre.consola[0]).toContain("Sin medir: 1.");
    /* La barra se dice de la pantalla que sí se midió. */
    expect(cierre.lineas[2]).toContain("(10 px, medida en 1 pantalla que desplaza)");
    /* Si no se pudo medir ninguna, no se dice que ninguna desplaza ni que todo va con dedo: se dice eso. */
    const ninguna = cerrar([rota, { ...rota, id: "mercado" }], { pantallas: [{ id: "mercado" }, { id: "buscador" }], anchos: [ANCHOS[0]] });
    expect(ninguna.codigo).toBe(1);
    expect(ninguna.lineas[2]).toContain("Pantallas: 2. Anchos: 1440 (una «d» detrás es con dedo). No se pudo medir ninguna pantalla.");
    /* Y cada «ninguno» de abajo sería una afirmación sobre algo que no se ha mirado: se dice antes de todos ellos. */
    expect(ninguna.lineas[4]).toBe("**No se midió ninguna pantalla: los «ninguno» y «ninguna» de abajo no dicen nada de la aplicación.**");
    expect(texto(cierre.lineas)).not.toContain("No se midió ninguna pantalla");
    expect(ninguna.errores).toEqual(["NO SE MIDIÓ en 1440: buscador, mercado."]);
    /* Lo que no se midió no entra en la cuenta de la barra: con la tableta medida y una pantalla de ratón sin medir, de
       la de ratón no se sabe si desplaza, y no se dice que ninguna desplaza. */
    const conTableta = cerrar([enTableta(), rota], { pantallas: [{ id: "mercado" }, { id: "buscador" }] });
    expect(conTableta.lineas[2]).toContain("Todo con dedo: sin barra de desplazamiento que ocupe sitio.");
    expect(conTableta.lineas[2]).not.toContain("ninguna pantalla desplaza");
    expect(conTableta.errores).toEqual(["NO SE MIDIÓ en 1440: buscador."]);
    /* Si era una pantalla pedida en Modo cliente, llega además como fallo de ese modo. */
    const enModoCliente = cerrar([{ ...rota, id: "informes-modo-cliente", modoCliente: ["no se pudo medir en Modo cliente"] }], { pantallas: [{ id: "informes-modo-cliente", modoCliente: {} }], anchos: [ANCHOS[0]] });
    expect(enModoCliente.codigo).toBe(1);
    expect(enModoCliente.errores).toEqual(["NO SE MIDIÓ en 1440: informes-modo-cliente.", "MODO CLIENTE: 1 pantalla deja ver algo reservado al asesor, o no se pudo comprobar."]);
  });

  test("si lo que falla es solo la foto, lo medido vale: se dice, y el código no cambia", () => {
    const cierre = cerrar([fila({ fallo: "no se pudo fotografiar: Error: Target closed", sinMedir: false })], { anchos: [ANCHOS[0]] });
    expect(cierre.codigo).toBe(0);
    expect(texto(cierre.lineas)).toContain("## Pantallas en las que algo falló al prepararlas, medirlas o fotografiarlas");
    expect(texto(cierre.lineas)).toContain("- **1440 · mercado** — no se pudo fotografiar: Error: Target closed");
    expect(texto(cierre.lineas)).not.toContain("## Pantallas que no se pudieron medir");
  });

  test("avisa de la pantalla con más de un título de pantalla, y de la que no tiene ninguno; la de acceso no cuenta", () => {
    const cierre = cerrar([fila({ titulos: ["Mercado", "Calendario"], titulosDePantalla: 2 }), fila({ id: "buscador", titulos: [], titulosDePantalla: 0 }), fila({ id: "acceso", titulos: [], titulosDePantalla: 0, esElAcceso: true })], { pantallas: [{ id: "mercado" }, { id: "buscador" }], anchos: [ANCHOS[0]] });
    expect(texto(cierre.lineas)).toContain("- **1440 · mercado** — 2 títulos de pantalla: «Mercado», «Calendario»");
    expect(texto(cierre.lineas)).toContain("- **1440 · buscador** — ningún título de pantalla a la vista");
    expect(texto(cierre.lineas)).not.toContain("- **1440 · acceso** — ningún título");
    expect(cierre.codigo).toBe(0);
  });

  test("los saltos de encabezado y axe se dicen solo del ancho en que se pasó, salvo que se pasara en todos", () => {
    const filas = [fila({ saltos: ["h1 → h3: «Detalle»"] }), enTableta({ saltos: ["h1 → h3: «Detalle»"] })];
    expect(cerrar(filas).consola.filter((linea: string) => linea.includes("salto ·"))).toEqual(["  salto · 1440 · mercado · h1 → h3: «Detalle»"]);
    expect(cerrar(filas, { axeEnTodos: true }).consola.filter((linea: string) => linea.includes("salto ·"))).toHaveLength(2);
    expect(texto(cerrar(filas).lineas)).toContain("## Accesibilidad por regla (axe-core, WCAG 2.2 AA; solo a 1440 px)");
  });
});

describe("dónde está la aplicación y cómo se entra en ella", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  /**
   * Una página de mentira. Al abrir aparece el formulario de acceso, la aplicación ya abierta, o nada (la pantalla de
   * acceso se quedó cargando o dio un error); y, al entrar, el formulario se va o se queda, y la aplicación llega a
   * pintarse o no.
   */
  const pagina = ({ aparece, seQueda = false, sinAplicacion = false }: { aparece: "formulario" | "aplicacion" | "nada"; seQueda?: boolean; sinAplicacion?: boolean }) => {
    const hecho: string[] = [];
    const esperado: string[] = [];
    let esperas = 0;
    const campo = (nombre: string) => ({
      count: async () => (aparece === "formulario" ? 1 : 0),
      fill: async (valor: string) => void hecho.push(`${nombre}=${valor}`),
      waitFor: async () => {
        if (seQueda) throw new Error("Timeout");
        hecho.push("el formulario se fue");
      }
    });
    return {
      hecho,
      esperado,
      goto: async (direccion: string) => void hecho.push(`abre ${direccion}`),
      waitForSelector: async (selector: string) => {
        esperas += 1;
        esperado.push(selector);
        /* La primera espera es a que aparezca algo; la segunda, a la aplicación tras entrar. */
        if ((esperas === 1 && aparece === "nada") || (esperas === 2 && sinAplicacion)) throw new Error("Timeout");
      },
      locator: (selector: string) => campo(selector.includes("email") ? "correo" : "clave"),
      getByRole: (_rol: string, { name }: { name: string }) => ({ click: async () => void hecho.push(`pulsa ${name}`) }),
      waitForLoadState: async () => undefined
    };
  };
  const sinVariable = undefined as unknown as string;
  const conCredenciales = () => {
    vi.stubEnv("BDB_SHOTS_EMAIL", "asesor@prueba.test");
    vi.stubEnv("BDB_SHOTS_PASSWORD", "una-clave-de-prueba");
  };

  test("la aplicación está en localhost:5174, que es donde escucha Vite; AUDIT_BASE la cambia", () => {
    vi.stubEnv("AUDIT_BASE", sinVariable);
    vi.stubEnv("AUDIT_BASE_URL", sinVariable);
    expect(BASE_POR_DEFECTO).toBe("http://localhost:5174");
    expect(baseDeLaApp()).toBe("http://localhost:5174");
    /* Las dos pruebas de humo la llamaban AUDIT_BASE_URL: sigue valiendo, y AUDIT_BASE manda. */
    vi.stubEnv("AUDIT_BASE_URL", "http://localhost:5199");
    expect(baseDeLaApp()).toBe("http://localhost:5199");
    vi.stubEnv("AUDIT_BASE", "http://localhost:5176");
    expect(baseDeLaApp()).toBe("http://localhost:5176");
  });

  test("si lo que aparece es la aplicación ya abierta, no pide acceso y no se toca nada", async () => {
    const page = pagina({ aparece: "aplicacion" });
    expect(await entrar(page, "http://x")).toBe("no pide acceso");
    expect(page.hecho).toEqual(["abre http://x/"]);
    /* Se espera a una de las dos cosas, y a ninguna más. */
    expect(page.esperado).toEqual([`input[type="email"], ${MARCO_DE_LA_APP}`]);
  });

  test("lo que se espera existe en la aplicación: su interruptor de Modo cliente y el campo de correo del acceso", () => {
    /* Si uno de los dos selectores dejara de existir, `entrar` se pararía a los 30 s diciendo que no aparece nada. */
    expect(MARCO_DE_LA_APP).toBe('[role="switch"].topbar-switch');
    const marco = leer("src/app/BdbActivosApp.tsx");
    expect(marco).toMatch(/className=\{`topbar-switch\$\{/);
    expect(marco).toContain('role="switch"');
    expect(leer("src/auth/AuthGate.tsx")).toContain('type="email"');
  });

  test("que no haya campo de correo no quiere decir que no se pida acceso: si no aparece ni el formulario ni la aplicación, se para", async () => {
    /* La pantalla de acceso pasa por «Cargando acceso…» y «Comprobando sesión…», y tiene una de error: ninguna lleva
       campos. Hasta el 19-11-2026 se daba por abierta la aplicación y la pasada seguía sin haber entrado. */
    await expect(entrar(pagina({ aparece: "nada" }), "http://x")).rejects.toThrow(/En http:\/\/x no ha aparecido ni el formulario de acceso ni la aplicación/);
  });

  test("si lo pide, rellena el correo y la clave del entorno, pulsa Entrar y espera a que el formulario se vaya", async () => {
    conCredenciales();
    const page = pagina({ aparece: "formulario" });
    expect(await entrar(page, "http://x")).toBe("dentro");
    expect(page.hecho).toEqual(["abre http://x/", "correo=asesor@prueba.test", "clave=una-clave-de-prueba", "pulsa Entrar", "el formulario se fue"]);
    /* Dos esperas: al formulario o a la aplicación al abrir, y a la aplicación tras entrar. */
    expect(page.esperado).toEqual([`input[type="email"], ${MARCO_DE_LA_APP}`, MARCO_DE_LA_APP]);
  });

  test("sin credenciales, si el formulario se queda o si la aplicación no llega a pintarse, se para y lo dice", async () => {
    vi.stubEnv("BDB_SHOTS_EMAIL", sinVariable);
    vi.stubEnv("BDB_SHOTS_PASSWORD", sinVariable);
    await expect(entrar(pagina({ aparece: "formulario" }), "http://x")).rejects.toThrow(/Faltan BDB_SHOTS_EMAIL y BDB_SHOTS_PASSWORD/);
    conCredenciales();
    await expect(entrar(pagina({ aparece: "formulario", seQueda: true }), "http://x")).rejects.toThrow(/No se completó el acceso/);
    await expect(entrar(pagina({ aparece: "formulario", sinAplicacion: true }), "http://x")).rejects.toThrow(/la aplicación no ha llegado a pintarse/);
  });

  test("el recorrido reconoce el acceso por su pantalla, también las que no llevan campos", () => {
    expect(RECORRIDO).toContain(`esElAcceso: Boolean(document.querySelector('.auth-screen, input[type="password"]')),`);
    expect(leer("src/auth/AuthGate.tsx")).toMatch(/className="auth-screen"/);
  });

  test.each([
    ["la batería", BATERIA, true],
    ["el recorrido", RECORRIDO, true],
    ["la prueba de humo del informe", HUMO_DEL_INFORME, true],
    ["la prueba de humo del PDF", HUMO_DEL_PDF, false]
  ])("%s toma de ahí la dirección y el acceso, y no lleva los suyos", (_nombre, guion, entra) => {
    expect(guion).toMatch(/import \{[^}]*\bbaseDeLaApp\b[^}]*\} from "\.\/entrarEnLaApp\.mjs";/);
    expect(guion).toContain("const BASE = baseDeLaApp();");
    /* Ni el puerto del CI de antes, ni la dirección en la que Vite no escucha, ni las variables leídas por su cuenta. */
    expect(guion).not.toMatch(/5178|127\.0\.0\.1:51|process\.env\.AUDIT_BASE|process\.env\.BDB_SHOTS_(EMAIL|PASSWORD)/);
    /* Y nadie rellena el formulario por su cuenta. */
    expect(guion).not.toMatch(/\.fill\(/);
    expect(guion.includes("await entrar(page, BASE);")).toBe(entra);
  });

  test("la prueba de humo del informe no espera a que la red calle, y mira por las dos puertas que lo descargado sea un PDF", () => {
    /* Con la base en directo la red no calla, y se quedaba colgada. */
    expect(HUMO_DEL_INFORME).not.toContain("networkidle");
    /* El aviso del navegador al salir con cambios sin guardar es a propósito: se acepta, no cuenta como diálogo. */
    expect(HUMO_DEL_INFORME).toMatch(/if \(dialog\.type\(\) === "beforeunload"\) \{[^}]*dialog\.accept\(\)/);
    /* Lo mismo por Informes que por Análisis: un PDF con contenido, y de la cartera de un solo activo. */
    expect(HUMO_DEL_INFORME).toContain('const esUnPdfConContenido = (bytes) => bytes.subarray(0, 4).toString() === "%PDF" && bytes.length > 10_000;');
    expect(HUMO_DEL_INFORME.match(/check\(esUnPdfConContenido\(/g)).toHaveLength(2);
    expect(HUMO_DEL_INFORME).toContain("check(/^1 posición/.test(recuento),");
  });

  describe("las letras que dibujan en un PDF", () => {
    /** Un PDF mínimo de una página que dibuja «Hola» con Fraunces, con los recursos de más que se le digan. */
    const pdf = (recursos = "", objetos = "") =>
      Buffer.from(
        `%PDF-1.3\n1 0 obj\n<< /Type /Page /Resources 2 0 R /Contents 3 0 R >>\nendobj\n2 0 obj\n<< /Font << /F1 4 0 R >> ${recursos} >>\nendobj\n3 0 obj\n<< /Length 30 >>\nstream\nBT /F1 12 Tf (Hola) Tj ET\nendstream\nendobj\n4 0 obj\n<< /Type /Font /BaseFont /ABCDEF+Fraunces-Regular >>\nendobj\n${objetos}`,
        "latin1"
      );

    test("dice las letras con que una página dibuja, y una imagen incrustada no estorba", () => {
      expect(pdfUsedFonts(pdf())).toEqual(["ABCDEF+Fraunces-Regular"]);
      expect(pdfUsedFonts(pdf("/XObject << /I1 5 0 R >>", "5 0 obj\n<< /Type /XObject /Subtype /Image >>\nendobj\n"))).toEqual(["ABCDEF+Fraunces-Regular"]);
    });

    test("si una página dibuja dentro de un formulario incrustado, falla: sus letras no se ven así, y callar sería dar por mirado lo que no se miró", () => {
      const formulario = "5 0 obj\n<< /Type /XObject /Subtype /Form >>\nendobj\n";
      expect(() => pdfUsedFonts(pdf("/XObject << /X1 5 0 R >>", formulario))).toThrow(/Form XObject/);
      /* También cuando los recursos lo nombran por referencia. */
      expect(() => pdfUsedFonts(pdf("/XObject 6 0 R", `${formulario}6 0 obj\n<< /X1 5 0 R >>\nendobj\n`))).toThrow(/Form XObject/);
      /* Y se llame como se llame, o sea de la generación que sea: `/Fm-1`, «7 1 R». */
      expect(() => pdfUsedFonts(pdf("/XObject << /Fm-1 5 0 R >>", formulario))).toThrow(/Form XObject/);
      expect(() => pdfUsedFonts(pdf("/XObject << /X1 7 1 R >>", "7 1 obj\n<< /Type /XObject /Subtype /Form >>\nendobj\n"))).toThrow(/Form XObject/);
    });
  });

  test("la prueba de humo de los PDF pide las letras del papel de hoy entre las que dibujan, y que ninguna otra dibuje", () => {
    const plantilla = leer("src/reports/plantilla/fuentes.ts");
    for (const letra of ["Fraunces", "RobotoFlex"]) expect(plantilla, letra).toContain(letra);
    expect(HUMO_DEL_PDF).toContain("const ES_DE_LA_PLANTILLA = /^([A-Z]{6}\\+)?(Fraunces|RobotoFlex)-/;");
    /* Que el nombre esté en el fichero no prueba que la letra se use: se mira entre las que dibujan algún glifo. */
    expect(HUMO_DEL_PDF).toContain("r.fraunces = r.usedFonts.some(");
    expect(HUMO_DEL_PDF).toContain("r.robotoFlex = r.usedFonts.some(");
    expect(HUMO_DEL_PDF).not.toMatch(/ascii\.includes\("(Fraunces|RobotoFlex|IBMPlexSans|SourceSerif4)"\)/);
    expect(HUMO_DEL_PDF).toMatch(/!r\.fraunces \|\| !r\.robotoFlex \|\| r\.ajenas\.length > 0/);
  });
});

describe("el Modo cliente, mirado con la página entera", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  const PALABRAS = PALABRAS_DEL_ASESOR.map(({ palabra }: { palabra: string }) => palabra);
  /** El código de un fichero sin sus comentarios: lo que de verdad puede llegar a pintarse. */
  const sinComentarios = (ruta: string) => leer(ruta).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const comprobar = (debeLeerse?: string) => comprobarModoCliente({ palabras: PALABRAS, debeLeerse, marcaDeInterno: MARCA_DE_INTERNO, interruptor: MARCO_DE_LA_APP });

  test("la clave es la de la aplicación, y la marca de lo interno, la clase del distintivo", () => {
    expect(leer("src/app/ClientModeContext.tsx")).toContain(`export const CLIENT_MODE_STORAGE_KEY = "${CLAVE_DEL_MODO_CLIENTE}";`);
    expect(MARCA_DE_INTERNO).toBe(".distintivo--interno");
    expect(leer("src/styles/components.css")).toContain(".distintivo--interno {");
    expect(sinComentarios("src/components/ui/Distintivo.tsx")).toContain('interno: "distintivo--interno",');
  });

  test("cada palabra vigilada la pinta hoy el fichero que se dice, fuera de sus comentarios: una que ya no está no puede salir nunca", () => {
    expect(PALABRAS_DEL_ASESOR.length).toBeGreaterThan(0);
    for (const { palabra, vive } of PALABRAS_DEL_ASESOR) expect(sinComentarios(vive).includes(palabra), `«${palabra}» en ${vive}`).toBe(true);
    /* Las que vigilaba `audit:ui` y no estaban en ninguna pantalla, o no salían nunca con la cartera de muestra, no han vuelto. */
    for (const muerta of ["Solo asesor", "Métricas que faltan", "Factibilidad multi-activo", "lectura local", "Comprobación local", "contrato local"]) expect(PALABRAS).not.toContain(muerta);
  });

  const montar = (encendido: boolean, cuerpo: string) => {
    document.body.innerHTML = `<div id="root"><button role="switch" class="topbar-switch" aria-checked="${encendido}">Modo cliente</button><main>${cuerpo}</main></div>`;
  };

  test("con el interruptor encendido, lo que tiene que leerse a la vista y nada del asesor, no hay nada que decir", () => {
    montar(true, "<h1>Informes</h1><p>Informe para el cliente</p>");
    const comprobacion = comprobar("Informe para el cliente");
    expect(comprobacion).toEqual({ activo: true, fugas: [], internos: 0, seLee: true, debeLeerse: "Informe para el cliente" });
    expect(fallosDelModoCliente(comprobacion)).toEqual([]);
    /* Una pantalla que no se mide en Modo cliente no dice nada. */
    expect(fallosDelModoCliente(null)).toEqual([]);
  });

  test("si la página lleva algo del asesor, se dice qué; «etrocesi» caza la retrocesión en cualquiera de sus formas", () => {
    montar(true, "<p>Avisos de calidad · Retrocesiones del fondo</p>");
    expect(fallosDelModoCliente(comprobar())).toEqual(["en Modo cliente se lee «etrocesi»", "en Modo cliente se lee «Avisos de calidad»"]);
  });

  test("lo ve también dentro de un panel plegado: el asesor lo abre de un clic delante del cliente", () => {
    /* Así pinta `Panel` un cuerpo cerrado. Hasta el 19-11-2026 solo se miraba lo que se veía, y en Optimizar, donde
       todo lo reservado va dentro de un panel que empieza cerrado, la comprobación no podía fallar. */
    montar(true, '<section class="panel"><button class="panel__plegador" aria-expanded="false">Comprobación previa</button><div class="panel__body" hidden><h3>Métricas por posición</h3></div></section>');
    expect(fallosDelModoCliente(comprobar("Comprobación previa"))).toEqual(["en Modo cliente se lee «Métricas por posición»"]);
  });

  test("un distintivo «Interno» que quede en la página es una fuga, diga lo que diga su bloque", () => {
    montar(true, '<h2>Costes <span class="distintivo distintivo--interno">Interno</span></h2><p><span class="distintivo distintivo--interno">Interno</span></p>');
    expect(fallosDelModoCliente(comprobar())).toEqual(["en Modo cliente quedan 2 distintivos «Interno»"]);
  });

  test("si no se lee lo que la pantalla tiene que enseñar, no se midió nada: no puede dar limpio una pantalla vacía", () => {
    montar(true, "<p>Cargando…</p>");
    expect(fallosDelModoCliente(comprobar("Informe para el cliente"))).toEqual(["no se lee «Informe para el cliente»: la pantalla no llegó a pintarse y no se midió lo que ve el cliente"]);
  });

  test("si el modo no llegó a encenderse, lo primero que se dice es que no se midió lo que ve el cliente", () => {
    montar(false, "<p>Señales de datos</p>");
    expect(fallosDelModoCliente(comprobar())).toEqual(["el Modo cliente no quedó encendido: no se midió lo que ve el cliente", "en Modo cliente se lee «Señales de datos»"]);
    /* Sin interruptor en la página (la de acceso, por ejemplo), lo mismo. */
    document.body.innerHTML = '<div id="root">Acceso</div>';
    expect(comprobar().activo).toBe(false);
  });

  test("el recorrido mide en Modo cliente lo que el asesor enseña, con los paneles abiertos y algo que tiene que leerse", () => {
    /* Lo que tiene que leerse vive en el contenido de la pantalla, no en su cabecera, que se pinta antes de que
       lleguen los datos: con el botón «Informe para el cliente» de la cabecera de Análisis, una pestaña que se quedara
       calculando daba limpio sin haberse medido. En Optimizar y en Análisis sale además de esos datos; en Informes es
       el nombre fijo de un documento de la lista. Cada texto, con el fichero del contenido que lo pinta. */
    for (const [id, ruta, debeLeerse, loPinta] of [
      ["informes-modo-cliente", "/cartera/informes", "Informe para el cliente", "src/components/PortfolioReport.tsx"],
      ["diseno-optimizar-modo-cliente", "/cartera/optimizacion", "Comprobación previa", "src/components/OptimizationPreviewPanel.tsx"],
      ["analisis-exposicion-modo-cliente", "/analisis#pestana=exposicion", "Divisa de la clase", "src/pages/XrayPage.tsx"],
      ["analisis-datos-modo-cliente", "/analisis#pestana=datos", "Qué conviene mirar", "src/components/SaludYControl.tsx"]
    ]) {
      expect(RECORRIDO, id).toContain(`{ id: "${id}", ruta: "${ruta}", modoCliente: { debeLeerse: "${debeLeerse}" }, preparar: abrirLoPlegado }`);
      expect(sinComentarios(loPinta), `«${debeLeerse}» en ${loPinta}`).toContain(debeLeerse);
    }
    /* El de la pestaña de exposición es el título de un panel que solo existe con el análisis ya calculado, junto al
       bloque que lleva lo reservado al asesor; y no el botón de la cabecera. */
    const exposicion = sinComentarios("src/pages/XrayPage.tsx");
    const pestana = exposicion.slice(exposicion.indexOf('case "exposicion":'), exposicion.indexOf('case "fondos":'));
    expect(pestana).toContain('titulo="Divisa de la clase"');
    expect(pestana).toContain("<PortfolioXray ");
    /* Van al final de la lista: no cambian el número de orden de las fotos de las demás pantallas. */
    const lista = RECORRIDO.slice(RECORRIDO.indexOf("const PANTALLAS = ["), RECORRIDO.indexOf("].filter((pantalla) => pantalla.id.includes(FILTRO));"));
    expect(lista.indexOf('{ id: "direccion-desconocida"')).toBeLessThan(lista.indexOf('{ id: "informes-modo-cliente"'));
    expect(lista.slice(0, lista.indexOf('{ id: "direccion-desconocida"'))).not.toContain("modoCliente:");
    /* Abrir lo plegado es pulsar cada título de panel que esté cerrado. */
    expect(RECORRIDO).toContain(`page.locator('button.panel__plegador[aria-expanded="false"]')`);
    expect(sinComentarios("src/components/ui/Panel.tsx")).toMatch(/aria-expanded=\{abierto\}\s+className="panel__plegador"/);
  });

  test("en cada pantalla: enciende, abre, mide, comprueba, fotografía, apaga y sale de la aplicación, en ese orden", () => {
    const bucle = RECORRIDO.slice(RECORRIDO.indexOf("for (const pantalla of PANTALLAS) {"), RECORRIDO.indexOf("await contexto.close();"));
    const pasos = [
      "await ponerModoCliente(page, true);",
      "await pantalla.preparar(page);",
      "medida = await medir(page);",
      "await page.evaluate(comprobarModoCliente, { palabras: PALABRAS_DEL_ASESOR.map(({ palabra }) => palabra), debeLeerse: pantalla.modoCliente.debeLeerse, marcaDeInterno: MARCA_DE_INTERNO, interruptor: MARCO_DE_LA_APP })",
      "await fotoDePaginaEntera(page,",
      "await ponerModoCliente(page, false)",
      'await page.goto("about:blank")'
    ].map((paso) => bucle.indexOf(paso));
    expect(pasos.every((posicion) => posicion > -1), JSON.stringify(pasos)).toBe(true);
    expect([...pasos].sort((a, b) => a - b)).toEqual(pasos);
  });

  test("`audit:ui` se retiró: el Modo cliente y los títulos de pantalla pasaron al recorrido", () => {
    /* Lo que dejó de vigilarse lo dice `scripts/modoCliente.mjs`: ella medía en los seis anchos y salía con código 1
       ante cualquier hallazgo; el recorrido es un informe. */
    const paquete = JSON.parse(leer("package.json")) as { scripts: Record<string, string> };
    expect(paquete.scripts["audit:ui"]).toBeUndefined();
    expect(existsSync(resolve(APP, "scripts/auditInterfaz.mjs"))).toBe(false);
    expect(leer("scripts/modoCliente.mjs")).toContain("Lo que se dejó de vigilar al retirarla");
    /* Las que quedan, con su orden. */
    expect(paquete.scripts["shots:ui"]).toBe("node scripts/capturaInterfaz.mjs xl,l,d,p,t,tp");
    expect(paquete.scripts["shots:estrecha"]).toBe("node scripts/capturaInterfaz.mjs estrecha");
    expect(paquete.scripts["smoke:informe"]).toBe("node scripts/smokeFlujoInforme.mjs");
    expect(paquete.scripts["smoke:pdf"]).toBe("node scripts/smokePdfD3.mjs");
  });
});
