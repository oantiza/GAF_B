/**
 * Recorrido de la auditoría del frontend (13-11-2026).
 *
 * Recorre todas las pantallas principales con la cartera de muestra, y de cada una guarda la captura de página entera
 * y mide lo que una captura no enseña: errores de consola, errores de página, peticiones fallidas, desborde horizontal
 * y fallos de accesibilidad (axe-core, WCAG 2.2 AA). Sirve para el «antes» y el «después» del rediseño: la misma orden
 * con otra etiqueta.
 *
 *   node scripts/auditoriaFrontend.mjs antes            # 1920, 1440 y 768
 *   node scripts/auditoriaFrontend.mjs despues d,tp     # solo portátil y tableta
 *   node scripts/auditoriaFrontend.mjs antes d gestor   # solo las pantallas cuyo nombre contiene «gestor»
 *   node scripts/auditoriaFrontend.mjs estrecha estrecha  # la pasada estrecha: 1.025, 1.100, 1.180 y 1.240
 *   node scripts/auditoriaFrontend.mjs ipad 1080d,1180d   # un ancho en píxeles; con una «d», con dedo
 *
 * Los anchos son los de `anchosDeCaptura.mjs`. Con ratón se mide y se fotografía con la barra de desplazamiento
 * puesta, que es como se ve en una ventana; con dedo, sin ella (`barraDeDesplazamiento.mjs`). Y de cada pantalla se
 * recogen los textos cortados con puntos suspensivos o a un número de líneas (`textoCortado.mjs`) y las cajas que se
 * desplazan de lado, con los controles que dejan fuera de la vista y si se alcanzan con el teclado
 * (`cajasQueSeDesplazan.mjs`).
 *
 * axe-core pasa en un solo ancho, el portátil si se pide (tarda); con `AUDIT_AXE=todos`, en todos los pedidos.
 *
 * Cuatro pantallas se miden además en Modo cliente (`modoCliente.mjs`: Informes, Optimizar y dos pestañas de
 * Análisis), con sus paneles plegados abiertos: que el interruptor quede encendido, que se lea lo que la pantalla
 * tiene que enseñar y que la página no lleve nada reservado al asesor. El recorrido es un informe que alguien lee, no una puerta: solo sale con código 1 cuando la pasada no ha
 * medido lo que dice (`informeDelRecorrido.mjs`).
 *
 * Entorno: `AUDIT_BASE` (por defecto http://localhost:5174; nunca 127.0.0.1, Vite escucha solo en ::1) y las
 * credenciales del usuario local del emulador en `BDB_SHOTS_EMAIL` y `BDB_SHOTS_PASSWORD` (las declara
 * `scripts/seedEmulatorUser.mjs`; `entrarEnLaApp.mjs`). Las capturas van a `docs/frontend/capturas/<etiqueta>/` de la
 * raíz del repositorio, con `informe.json` e `informe.md` al lado; `AUDIT_OUT` las manda a otra carpeta.
 */
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SEED_POSITIONS, SEED_SCRIPT } from "./carteraDeMuestra.mjs";
import { fotoDePaginaEntera } from "./fotoDePaginaEntera.mjs";
import { marcaDeAncho, resolverAnchos } from "./anchosDeCaptura.mjs";
import { BARRAS_OCULTAS, lanzamiento, reservarHuecoDeLaBarra, sinBarrasDeTableta } from "./barraDeDesplazamiento.mjs";
import { CORTES_ADMITIDOS, recogerTextoCortado, resumirTextoCortado } from "./textoCortado.mjs";
import { recogerCajasQueSeDesplazan, resumirCajasQueSeDesplazan } from "./cajasQueSeDesplazan.mjs";
import { MARCO_DE_LA_APP, baseDeLaApp, entrar } from "./entrarEnLaApp.mjs";
import { CLAVE_DEL_MODO_CLIENTE, MARCA_DE_INTERNO, PALABRAS_DEL_ASESOR, comprobarModoCliente, fallosDelModoCliente } from "./modoCliente.mjs";
import { cerrarElRecorrido } from "./informeDelRecorrido.mjs";

const APP = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = baseDeLaApp();
const ETIQUETA = process.argv[2] || "antes";
const ANCHOS_PEDIDOS = resolverAnchos(process.argv[3], "l,d,tp");
const FILTRO = process.argv[4] || "";
const SALIDA = process.env.AUDIT_OUT || resolve(APP, "..", "docs", "frontend", "capturas", ETIQUETA);

/**
 * El ancho en el que se pasa axe: una vez basta, el marcado es casi el mismo en todos. El portátil si se pide —por su
 * nombre o por sus píxeles—; si no, el primero. Se guarda su marca, que es lo que distingue a un ancho de otro.
 */
const MARCA_DE_AXE = marcaDeAncho(ANCHOS_PEDIDOS.find((pedido) => pedido.ancho === 1440 && !pedido.conDedo) ?? ANCHOS_PEDIDOS[0]);
const AXE_EN_TODOS = process.env.AUDIT_AXE === "todos";
/** Si en este ancho se pasa axe-core y se cuentan los saltos de encabezado. */
const conAxe = (marca) => AXE_EN_TODOS || marca === MARCA_DE_AXE;

const AXE = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");

const pulsar = (rol, nombre) => async (page) => {
  await page.getByRole(rol, { name: nombre, exact: true }).first().click();
  await page.waitForTimeout(900);
};

/**
 * Abre todos los paneles plegados de la pantalla. Un panel plegable empieza cerrado y su cuerpo lleva `hidden`: lo que
 * hay dentro ni se ve ni sale en la foto, y el asesor lo abre de un clic. Al abrir uno pueden aparecer otros dentro.
 */
async function abrirLoPlegado(page) {
  for (let vuelta = 0; vuelta < 6; vuelta += 1) {
    const cerrados = page.locator('button.panel__plegador[aria-expanded="false"]');
    const cuantos = await cerrados.count();
    if (!cuantos) return;
    /* Tras cada clic, el primero que sigue cerrado es el siguiente. */
    for (let indice = 0; indice < cuantos; indice += 1) await cerrados.first().click();
    await page.waitForTimeout(400);
  }
}

/**
 * El informe de estrategia tiene dos cadencias (diario y semanal) y hasta tres vistas, que no van en la dirección:
 * se llega pulsando. Si no hay tal cadencia o tal vista, la preparación falla y el recorrido lo anota.
 */
const estrategia = (cadencia, vista) => async (page) => {
  await pulsar("button", cadencia)(page);
  await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => {});
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"], .loading-note, .strategy-loading'), null, { timeout: 20000 }).catch(() => {});
  await pulsar("button", vista)(page);
};

/**
 * Dobla en la red la respuesta de una llamada al servidor, solo para la pantalla que lo pide: se fotografía con datos
 * sin escribir nada en la base. La llamada va a otro origen (el emulador de Functions), así que la respuesta lleva sus
 * cabeceras de origen cruzado y se contesta también a la consulta previa del navegador.
 */
const doblarLlamada = (nombre, resultado) => async (page) => {
  const cabeceras = { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "POST, OPTIONS" };
  await page.route(`**/${nombre}`, async (ruta) => {
    if (ruta.request().method() === "OPTIONS") return ruta.fulfill({ status: 204, headers: cabeceras });
    return ruta.fulfill({ status: 200, headers: cabeceras, contentType: "application/json", body: JSON.stringify({ result: resultado }) });
  });
};
const quitarDoble = (nombre) => (page) => page.unroute(`**/${nombre}`);

/** Tres propuestas guardadas de muestra, con los activos de la cartera de muestra: la lista de Guardadas y el Comparador. */
const pesos = (reparto) => SEED_POSITIONS.filter((_, indice) => reparto[indice] > 0).map((posicion, indice) => ({ ...posicion, weight_percent: reparto.filter((peso) => peso > 0)[indice] }));
const PROPUESTAS_DE_MUESTRA = {
  schema_version: "1",
  count: 3,
  portfolios: [
    { portfolio_id: "muestra-moderada", name: "Familia García · moderada", created_at: "2026-10-02T09:15:00Z", updated_at: "2026-11-12T10:30:00Z", positions: SEED_POSITIONS, total_capital: 250000, risk_profile_level: 5, horizon_years: 7 },
    { portfolio_id: "muestra-prudente", name: "Ruiz Alonso · prudente", created_at: "2026-09-18T16:40:00Z", updated_at: "2026-11-05T12:05:00Z", positions: pesos([10, 0, 5, 0, 40, 30, 15, 0]), total_capital: 120000, risk_profile_level: 3, horizon_years: 4 },
    { portfolio_id: "muestra-crecimiento", name: "Propuesta de crecimiento", created_at: "2026-11-10T08:00:00Z", updated_at: "2026-11-10T08:00:00Z", positions: pesos([35, 0, 25, 20, 10, 0, 10, 0]) }
  ]
};

/**
 * Abre la cartera de demostración de «Carteras de clientes» (carpeta privada del navegador, solo en desarrollo), va a
 * una pestaña y, dentro de Análisis, a una de sus cuatro vistas. La demostración está a la vista en el primer uso y,
 * con la lista ya pintada, dentro de «Más».
 */
const gestor = (pestana, vista) => async (page) => {
  const directo = page.getByRole("button", { name: "Ver la cartera de demostración" });
  if (await directo.count()) await directo.first().click();
  else {
    await page.getByRole("button", { name: "Más", exact: true }).first().click();
    await page.getByRole("menuitem", { name: /Ver la cartera de demostración/ }).click();
  }
  await page.getByText("Patrimonio").first().waitFor({ timeout: 20000 });
  if (pestana) await pulsar("tab", pestana)(page);
  if (vista) await pulsar("button", vista)(page);
  await page.waitForTimeout(1200);
};

/** Las pantallas, en el orden del menú. `preparar` deja la pantalla en el estado que se quiere fotografiar. */
const PANTALLAS = [
  /* Las pestañas van en la dirección (`#pestana=…`): cada una es una pantalla que fotografiar. */
  { id: "mercado", ruta: "/mercado" },
  { id: "mercado-dividendos", ruta: "/mercado#pestana=dividendos" },
  { id: "mercado-resultados", ruta: "/mercado#pestana=resultados" },
  { id: "mercado-estrategia", ruta: "/mercado#pestana=estrategia" },
  /* Las demás vistas del informe de estrategia: su texto completo, y el semanal con su asignación. La dirección es la
     misma en las cinco y el navegador no recarga, así que cada una dice su cadencia y su vista. */
  { id: "mercado-estrategia-informe", ruta: "/mercado#pestana=estrategia", preparar: estrategia("Diario", "Informe completo") },
  { id: "mercado-estrategia-semanal", ruta: "/mercado#pestana=estrategia", preparar: estrategia("Semanal", "Resumen") },
  { id: "mercado-estrategia-semanal-asignacion", ruta: "/mercado#pestana=estrategia", preparar: estrategia("Semanal", "Asignación") },
  { id: "mercado-estrategia-semanal-informe", ruta: "/mercado#pestana=estrategia", preparar: estrategia("Semanal", "Informe completo") },
  { id: "buscador", ruta: "/buscador" },
  { id: "ficha-fondo", ruta: "/activo/LU1883318740" },
  { id: "ficha-fondo-rentabilidad", ruta: "/activo/LU1883318740#pestana=rentabilidad" },
  { id: "ficha-fondo-cartera", ruta: "/activo/LU1883318740#pestana=cartera" },
  { id: "ficha-fondo-costes", ruta: "/activo/LU1883318740#pestana=costes" },
  { id: "ficha-fondo-documentos", ruta: "/activo/LU1883318740#pestana=documentos" },
  { id: "ficha-etf", ruta: "/activo/IE00B4L5Y983" },
  { id: "ficha-etf-rentabilidad", ruta: "/activo/IE00B4L5Y983#pestana=rentabilidad" },
  { id: "ficha-etf-cartera", ruta: "/activo/IE00B4L5Y983#pestana=cartera" },
  { id: "ficha-etf-costes", ruta: "/activo/IE00B4L5Y983#pestana=costes" },
  { id: "ficha-etf-documentos", ruta: "/activo/IE00B4L5Y983#pestana=documentos" },
  { id: "ficha-accion", ruta: "/activo/US0378331005" },
  { id: "ficha-accion-rentabilidad", ruta: "/activo/US0378331005#pestana=rentabilidad" },
  { id: "ficha-accion-cartera", ruta: "/activo/US0378331005#pestana=cartera" },
  { id: "ficha-accion-documentos", ruta: "/activo/US0378331005#pestana=documentos" },
  { id: "comparador", ruta: "/comparador" },
  { id: "comparador-propuestas", ruta: "/comparador#pestana=propuestas" },
  /* Con dos propuestas elegidas: la lista se dobla en la red y la comparación se calcula de verdad. */
  {
    id: "comparador-propuestas-datos",
    ruta: "/comparador#pestana=propuestas",
    antes: doblarLlamada("list_portfolios", PROPUESTAS_DE_MUESTRA),
    preparar: async (page) => {
      /* La dirección es la misma que la de la pantalla anterior y el navegador no recarga: se recarga a mano para que
         la lista se pida otra vez, ya con el doble puesto. */
      await page.reload({ waitUntil: "load" });
      await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(1200);
      await page.getByLabel("Propuesta A", { exact: true }).selectOption("muestra-moderada");
      await page.getByLabel("Propuesta B", { exact: true }).selectOption("muestra-prudente");
      await page.waitForLoadState("networkidle", { timeout: 25000 }).catch(() => {});
      await page.waitForFunction(() => !document.querySelector('[aria-busy="true"], .loading-note'), null, { timeout: 25000 }).catch(() => {});
      await page.waitForTimeout(1500);
    },
    despues: quitarDoble("list_portfolios")
  },
  { id: "comparador-patrimonial", ruta: "/comparador#pestana=patrimonial" },
  /* Con el ejemplo cargado: la respuesta y la tabla, sin pedir todavía la inflación ni las alternativas. */
  {
    id: "comparador-patrimonial-ejemplo",
    ruta: "/comparador#pestana=patrimonial",
    preparar: async (page) => {
      await page.getByRole("button", { name: "Cargar ejemplo" }).first().click();
      await page.waitForTimeout(800);
    }
  },
  { id: "diseno", ruta: "/cartera" },
  { id: "diseno-comprobar", ruta: "/cartera", preparar: pulsar("tab", "Comprobar") },
  { id: "diseno-optimizar", ruta: "/cartera/optimizacion" },
  { id: "diseno-simular", ruta: "/cartera", preparar: pulsar("tab", "Simular") },
  { id: "analisis", ruta: "/analisis" },
  { id: "analisis-exposicion", ruta: "/analisis#pestana=exposicion" },
  { id: "analisis-fondos", ruta: "/analisis#pestana=fondos" },
  { id: "analisis-referencia", ruta: "/analisis#pestana=referencia" },
  { id: "analisis-diversificacion", ruta: "/analisis#pestana=diversificacion" },
  { id: "analisis-datos", ruta: "/analisis#pestana=datos" },
  { id: "informes", ruta: "/cartera/informes" },
  { id: "carteras-guardadas", ruta: "/carteras-guardadas" },
  /* Con tres propuestas: la lista se dobla en la red (no se escribe en la base) y la radiografía de la primera lee sus
     activos de verdad. */
  {
    id: "carteras-guardadas-lista",
    ruta: "/carteras-guardadas",
    antes: doblarLlamada("list_portfolios", PROPUESTAS_DE_MUESTRA),
    preparar: async (page) => {
      await page.locator(".enlace-a-ficha").first().click();
      await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => {});
      await page.waitForTimeout(1500);
      /* La radiografía se lleva el foco y el desplazamiento: para la foto, arriba y sin foco. */
      await page.evaluate(() => {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        window.scrollTo(0, 0);
      });
      await page.waitForTimeout(300);
    },
    despues: quitarDoble("list_portfolios")
  },
  { id: "gestor-entrada", ruta: "/cartera-real?carpeta=prueba" },
  { id: "gestor-resumen", ruta: "/cartera-real?carpeta=prueba", preparar: gestor(null) },
  { id: "gestor-cuentas", ruta: "/cartera-real?carpeta=prueba", preparar: gestor("Cuentas") },
  { id: "gestor-movimientos", ruta: "/cartera-real?carpeta=prueba", preparar: gestor("Movimientos") },
  { id: "gestor-analisis", ruta: "/cartera-real?carpeta=prueba", preparar: gestor("Análisis") },
  { id: "gestor-analisis-composicion", ruta: "/cartera-real?carpeta=prueba", preparar: gestor("Análisis", "Composición") },
  { id: "gestor-analisis-ingresos", ruta: "/cartera-real?carpeta=prueba", preparar: gestor("Análisis", "Ingresos y costes") },
  { id: "gestor-analisis-comprobaciones", ruta: "/cartera-real?carpeta=prueba", preparar: gestor("Análisis", "Comprobaciones") },
  { id: "gestor-comparar", ruta: "/cartera-real?carpeta=prueba", preparar: gestor("Comparar") },
  { id: "posiciones", ruta: "/posiciones" },
  { id: "jubilacion", ruta: "/jubilacion" },
  /* Con el ejemplo cargado: vacía, la pantalla no enseña ni la respuesta ni las cuentas. */
  { id: "jubilacion-ejemplo", ruta: "/jubilacion", preparar: pulsar("button", "Cargar un ejemplo") },
  { id: "planes", ruta: "/jubilacion/planes" },
  /* La ficha del primer plan de la lista. */
  {
    id: "planes-ficha",
    ruta: "/jubilacion/planes",
    preparar: async (page) => {
      await page.locator("table tbody a").first().click();
      await page.waitForTimeout(1500);
    }
  },
  /* Dos planes marcados y comparados: la tabla lado a lado y el gráfico en base 100. */
  {
    id: "planes-comparar",
    ruta: "/jubilacion/planes",
    preparar: async (page) => {
      const marcar = page.locator("table tbody").getByRole("button", { name: /^Comparar/ });
      await marcar.nth(0).click();
      await marcar.nth(1).click();
      await page.getByRole("button", { name: "Comparar 2 planes", exact: true }).click();
      await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => {});
      await page.waitForTimeout(1500);
    }
  },
  { id: "salud-catalogo", ruta: "/salud-catalogo" },
  { id: "sistema", ruta: "/sistema" },
  /* Las demás pestañas de Sistema, que solo ve un administrador. */
  { id: "sistema-estado", ruta: "/sistema#pestana=estado" },
  { id: "sistema-calidad", ruta: "/sistema#pestana=calidad" },
  { id: "sistema-historicos", ruta: "/sistema#pestana=historicos" },
  { id: "sistema-inspeccion", ruta: "/sistema#pestana=inspeccion" },
  { id: "sistema-retrocesiones", ruta: "/sistema#pestana=retrocesiones" },
  { id: "sistema-ingesta", ruta: "/sistema#pestana=ingesta" },
  /* Operaciones habla con un servicio local del extractor (127.0.0.1:8766). Sin él, la pantalla lo dice y ofrece
     reintentar; el navegador anota por su cuenta la conexión rechazada, y eso no es un fallo de la aplicación. */
  { id: "sistema-operaciones", ruta: "/sistema#pestana=operaciones", esperado: [/127.0.0.1:8766/, /ERR_CONNECTION_REFUSED/] },
  { id: "sistema-referencia", ruta: "/sistema#pestana=referencia" },
  { id: "direccion-desconocida", ruta: "/esta-direccion-no-existe" },
  /* Lo que el asesor enseña con el Modo cliente puesto, medido con él y con sus paneles abiertos: Informes y Optimizar,
     que son las que miraba `audit:ui` (auditoría del 16-10-2026), y las dos pestañas de Análisis donde vive algo
     reservado a él. `debeLeerse` es algo que la pantalla enseña también en ese modo y que vive en su contenido, no
     en su cabecera, que se pinta antes de que lleguen los datos; en Optimizar y en Análisis sale además de esos
     datos. Si no se lee, la pantalla no llegó a pintarse y no se ha medido nada (en Modo cliente la pestaña «Datos»
     no existe, y la dirección lleva al resumen). Van al final, para no cambiar el número de orden de las fotos de
     las demás. */
  { id: "informes-modo-cliente", ruta: "/cartera/informes", modoCliente: { debeLeerse: "Informe para el cliente" }, preparar: abrirLoPlegado },
  { id: "diseno-optimizar-modo-cliente", ruta: "/cartera/optimizacion", modoCliente: { debeLeerse: "Comprobación previa" }, preparar: abrirLoPlegado },
  { id: "analisis-exposicion-modo-cliente", ruta: "/analisis#pestana=exposicion", modoCliente: { debeLeerse: "Divisa de la clase" }, preparar: abrirLoPlegado },
  { id: "analisis-datos-modo-cliente", ruta: "/analisis#pestana=datos", modoCliente: { debeLeerse: "Qué conviene mirar" }, preparar: abrirLoPlegado }
].filter((pantalla) => pantalla.id.includes(FILTRO));

/** Lo que se mide dentro de la página: desborde horizontal, títulos, tablas apretadas, saltos de encabezado, letra pequeña y cifras que no caben. */
function medirPagina() {
  const raiz = document.documentElement;
  const ancho = raiz.clientWidth;
  const desbordan = [];
  /* Una tabla con las filas de cuatro líneas o más: la columna del nombre se ha quedado sin sitio y cada fila se
     estira. No desborda ni rompe nada, así que ninguna otra medida la ve; solo se ve en la captura, si se mira
     entera. Pasó en Planes al rediseñarla: de una línea por plan a siete, y nadie lo midió. */
  const apretadas = [];
  document.querySelectorAll("table").forEach((tabla) => {
    const filas = [...tabla.querySelectorAll("tbody > tr")].filter((fila) => fila.getBoundingClientRect().height > 0);
    if (filas.length < 5) return;
    const altos = filas.map((fila) => fila.getBoundingClientRect().height).sort((a, b) => a - b);
    const mediana = altos[Math.floor(altos.length / 2)];
    if (mediana < 96) return;
    const primera = filas[0].firstElementChild;
    const clases = typeof tabla.className === "string" ? tabla.className.split(" ").filter(Boolean).slice(0, 2).join(".") : "";
    apretadas.push(`table.${clases}: ${filas.length} filas, ${Math.round(mediana)} px de alto mediano, primera columna de ${primera ? Math.round(primera.getBoundingClientRect().width) : 0} px`);
  });
  document.querySelectorAll("body *").forEach((el) => {
    const caja = el.getBoundingClientRect();
    if (caja.width <= 0 || (caja.right <= ancho + 2 && caja.left >= -2)) return;
    if (getComputedStyle(el).position === "fixed") return;
    for (let padre = el.parentElement; padre; padre = padre.parentElement) {
      const desborde = getComputedStyle(padre).overflowX;
      if (desborde === "auto" || desborde === "scroll" || desborde === "hidden") return;
    }
    const clases = typeof el.className === "string" ? el.className.split(" ").filter(Boolean).slice(0, 3).join(".") : "";
    desbordan.push(`${el.tagName.toLowerCase()}.${clases} derecha=${Math.round(caja.right)}`);
  });
  /* Los saltos de nivel entre encabezados que se ven: de un `h1` a un `h3` sin `h2` en medio. Quien recorre la página
     por encabezados (lector de pantalla) encuentra la estructura rota. Solo cuenta bajar más de un nivel de golpe. */
  const saltos = [];
  let anterior = 0;
  document.querySelectorAll("h1, h2, h3, h4, h5, h6").forEach((titulo) => {
    const caja = titulo.getBoundingClientRect();
    if (caja.width === 0 && caja.height === 0) return;
    if (titulo.closest("[hidden], [aria-hidden='true']")) return;
    const nivel = Number(titulo.tagName[1]);
    if (anterior > 0 && nivel > anterior + 1) saltos.push(`h${anterior} → h${nivel}: «${(titulo.textContent || "").trim().slice(0, 50)}»`);
    anterior = nivel;
  });
  /* Los títulos de pantalla que se ven: tiene que haber uno. Con dos, quien llega con un lector de pantalla no sabe
     cuál es el de la pantalla; sin ninguno, no sabe dónde está. Que no hubiera dos lo miraba `audit:ui`, y pasó aquí
     al retirarla (19-11-2026). */
  const titulos = [...document.querySelectorAll("h1")]
    .filter((titulo) => {
      const caja = titulo.getBoundingClientRect();
      return (caja.width > 0 || caja.height > 0) && !titulo.closest("[hidden], [aria-hidden='true']");
    })
    .map((titulo) => (titulo.textContent || "").trim().slice(0, 70));
  /* Texto por debajo del tamaño más pequeño del sistema (12 px). Casi siempre es un título o un rótulo que se ha quedado
     con el tamaño que el navegador da a su etiqueta: no desborda ni rompe nada, y en la captura solo se ve mirando de
     cerca. Pasó en el «Informe completo» de Estrategia: sus títulos de sección, `h6` sin regla, medían 9 px sobre
     párrafos de 14, y nadie lo midió. No cuenta lo que no se ve ni lo que va dentro de un dibujo. El umbral es 11,95 y
     no 12 por precaución, por si una letra de 12 no saliera exacta al calcularla (no se ha visto ningún caso); hasta
     el 19-11-2026 era 11,5, y una letra de 11,7 px habría pasado sin aviso. */
  const pequenas = new Map();
  const paseo = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let nodo = paseo.nextNode(); nodo; nodo = paseo.nextNode()) {
    if (!nodo.nodeValue || !nodo.nodeValue.trim()) continue;
    const el = nodo.parentElement;
    if (!el || el.closest("[hidden], [aria-hidden='true'], svg, script, style, noscript, .sr-only")) continue;
    const caja = el.getBoundingClientRect();
    if (caja.width < 2 || caja.height < 2) continue;
    const tamano = Number.parseFloat(getComputedStyle(el).fontSize);
    if (!(tamano < 11.95)) continue;
    const clases = typeof el.className === "string" ? el.className.split(" ").filter(Boolean).slice(0, 2).join(".") : "";
    const clave = `${el.tagName.toLowerCase()}${clases ? "." + clases : ""} a ${Math.round(tamano * 10) / 10} px`;
    const previa = pequenas.get(clave) ?? { veces: 0, ejemplo: nodo.nodeValue.trim().slice(0, 40) };
    previa.veces += 1;
    pequenas.set(clave, previa);
  }
  /* Una cifra de la banda de respuesta que no cabe en su casilla: cruza el filete y toca la cifra de al lado. La banda
     recorta lo que sale de ella, así que no cuenta como desborde, y solo se ve mirando la captura de cerca. Pasó en la
     ficha de una acción en tableta: «350,69 USD» no cabía en una casilla de 110 px. Se mide el texto de la cifra, no su
     caja, que mide lo que la casilla aunque el texto se salga. */
  const cifrasFuera = [];
  document.querySelectorAll(".respuesta__dato").forEach((dato) => {
    const cifra = dato.querySelector(".respuesta__cifra");
    const caja = dato.getBoundingClientRect();
    if (!cifra || caja.width === 0) return;
    const limite = caja.right - (Number.parseFloat(getComputedStyle(dato).paddingRight) || 0);
    const rango = document.createRange();
    rango.selectNodeContents(cifra);
    const texto = rango.getBoundingClientRect();
    if (texto.width > 0 && texto.right > limite + 1) cifrasFuera.push(`«${(cifra.textContent || "").trim().slice(0, 24)}» se sale ${Math.round(texto.right - limite)} px`);
  });
  return {
    cifrasFuera,
    letraPequena: [...pequenas].slice(0, 8).map(([clave, dato]) => `${clave}, ${dato.veces} ${dato.veces === 1 ? "vez" : "veces"}: «${dato.ejemplo}»`),
    /* La pantalla de acceso: su formulario, o cualquiera de las suyas sin campos («Cargando acceso…», la de error).
       Si una pantalla del recorrido es una de ellas, no se entró. */
    esElAcceso: Boolean(document.querySelector('.auth-screen, input[type="password"]')),
    titulo: document.title,
    titulos,
    titulosDePantalla: titulos.length,
    anchoDePagina: raiz.scrollWidth,
    anchoDeVentana: ancho,
    altoDePagina: raiz.scrollHeight,
    altoDeVentana: window.innerHeight,
    desborde: [...new Set(desbordan)].slice(0, 8),
    apretadas,
    saltos: saltos.slice(0, 6)
  };
}

/**
 * Mide una pantalla tal como está: reserva el hueco de la barra de desplazamiento, mide la página y recoge los textos
 * cortados y las cajas que se desplazan de lado.
 */
async function medir(page) {
  const barra = await reservarHuecoDeLaBarra(page);
  const medida = await page.evaluate(medirPagina);
  const cortados = await page.evaluate(recogerTextoCortado, CORTES_ADMITIDOS.map((corte) => corte.selector));
  const cajas = await page.evaluate(recogerCajasQueSeDesplazan);
  return { ...medida, ...resumirTextoCortado(cortados), ...resumirCajasQueSeDesplazan(cajas), barra };
}

async function pasarAxe(page) {
  /* axe mira qué tapa a cada control tal como está la página en ese momento. Con la página desplazada (pulsar una
     pestaña la baja), la barra de arriba, que es fija, tapa a medias lo que pasa por debajo, y axe lo cuenta como un
     control demasiado pequeño. Se mide con la página arriba del todo, que es como se abre. */
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(150);
  await page.evaluate(AXE);
  const resultado = await page.evaluate(() =>
    window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] } })
  );
  return resultado.violations.map((fallo) => ({
    regla: fallo.id,
    impacto: fallo.impact,
    ayuda: fallo.help,
    nodos: fallo.nodes.length,
    ejemplos: fallo.nodes.slice(0, 3).map((nodo) => `${nodo.target.join(" ")}${nodo.any?.[0]?.message ? " — " + nodo.any[0].message : ""}`.slice(0, 260))
  }));
}

/**
 * Espera a que la pantalla termine de pintarse. La red no llega a callar en las pantallas que escuchan la base en
 * directo (carteras guardadas): se espera a que calle, con tope, y después a que no quede nada marcado como «cargando».
 */
async function asentar(page) {
  await page.waitForLoadState("networkidle", { timeout: 12000 }).catch(() => {});
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"], .loading-note'), null, { timeout: 20000 }).catch(() => {});
}

/** Escribe el Modo cliente en el almacenamiento del navegador, que es de donde la aplicación lo lee al montar. */
const ponerModoCliente = (page, encendido) =>
  page.evaluate(([clave, valor]) => window.localStorage.setItem(clave, valor), [CLAVE_DEL_MODO_CLIENTE, String(encendido)]);

mkdirSync(SALIDA, { recursive: true });
const navegador = await chromium.launch(lanzamiento(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}));
const informe = [];

for (const pedido of ANCHOS_PEDIDOS) {
  const { clave, ancho, alto, conDedo } = pedido;
  /* Cómo se nombra este ancho en las fotos y en el informe: sus píxeles, con una «d» si va con dedo más allá de la tableta. */
  const marca = marcaDeAncho(pedido);
  const contexto = await navegador.newContext({ viewport: { width: ancho, height: alto }, hasTouch: conDedo, deviceScaleFactor: 1, locale: "es-ES" });
  if (conDedo) await sinBarrasDeTableta(contexto);
  const page = await contexto.newPage();

  /* La pantalla de acceso, antes de entrar: es la primera que ve cualquiera. Si no se puede medir, se apunta como no
     medida y la pasada sigue, igual que las demás. */
  if (!FILTRO || "acceso".includes(FILTRO)) {
    let medida = null;
    let axe = null;
    let fallo = null;
    try {
      await page.goto(BASE + "/", { waitUntil: "networkidle", timeout: 30000 });
      medida = await medir(page);
      if (conAxe(marca)) axe = await pasarAxe(page).catch((error) => [{ regla: "axe-no-corrio", impacto: "n/d", ayuda: String(error).slice(0, 120), nodos: 0, ejemplos: [] }]);
      await fotoDePaginaEntera(page, resolve(SALIDA, `${marca}-00-acceso.jpg`));
    } catch (error) {
      fallo = `${medida ? "no se pudo fotografiar" : "no se pudo medir"}: ${String(error).slice(0, 200)}`;
    }
    informe.push({ ancho, marca, clave, conDedo, id: "acceso", ...(medida ?? {}), sinMedir: medida === null, consola: [], peticiones: [], axe, msDeCarga: null, fallo });
  }

  await contexto.addInitScript(SEED_SCRIPT, SEED_POSITIONS);
  /* El comparador de activos, con tres activos ya elegidos: vacío no enseña nada. */
  await contexto.addInitScript((ids) => {
    for (const almacen of [window.localStorage, window.sessionStorage]) {
      try {
        almacen.setItem("bdb-activos.comparison-selection.v1", JSON.stringify(ids));
      } catch {
        /* Sin almacenamiento, el comparador sale vacío. */
      }
    }
  }, SEED_POSITIONS.slice(0, 3).map((posicion) => posicion.asset_id));
  await entrar(page, BASE);

  const consola = [];
  const peticiones = [];
  page.on("console", (mensaje) => {
    if (mensaje.type() === "error" || mensaje.type() === "warning") consola.push(`${mensaje.type()}: ${mensaje.text().slice(0, 300)}`);
  });
  page.on("pageerror", (error) => consola.push(`pageerror: ${String(error).slice(0, 300)}`));
  page.on("response", (respuesta) => {
    if (respuesta.status() >= 400) peticiones.push(`${respuesta.status()} ${respuesta.request().method()} ${respuesta.url().slice(0, 180)}`);
  });
  page.on("requestfailed", (peticion) => {
    const motivo = peticion.failure()?.errorText ?? "";
    if (!/ERR_ABORTED/.test(motivo)) peticiones.push(`fallida ${peticion.method()} ${peticion.url().slice(0, 180)} ${motivo}`);
  });

  let orden = 0;
  for (const pantalla of PANTALLAS) {
    orden += 1;
    consola.length = 0;
    peticiones.length = 0;
    const inicio = Date.now();
    let fallo = null;
    /* Lo que falle en una pantalla se suma: el segundo fallo no borra el primero. */
    const anotar = (texto) => {
      fallo = [fallo, texto].filter(Boolean).join("; ");
    };
    try {
      if (pantalla.antes) await pantalla.antes(page);
      await page.goto(BASE + pantalla.ruta, { waitUntil: "load", timeout: 45000 });
    } catch (error) {
      anotar(`no cargó: ${String(error).slice(0, 120)}`);
    }
    await asentar(page);
    const msDeCarga = Date.now() - inicio;
    await page.waitForTimeout(1200);
    if (pantalla.modoCliente) {
      /* La aplicación lee el modo al montar: se enciende y se recarga. */
      try {
        await ponerModoCliente(page, true);
        await page.reload({ waitUntil: "load", timeout: 45000 });
        await asentar(page);
        await page.waitForTimeout(1200);
      } catch (error) {
        anotar(`no se pudo poner el Modo cliente: ${String(error).slice(0, 160)}`);
      }
    }
    if (pantalla.preparar) {
      try {
        await pantalla.preparar(page);
      } catch (error) {
        anotar(`no se pudo preparar: ${String(error).slice(0, 200)}`);
      }
    }
    /* Si medir se rompe —una navegación tardía puede llevarse la página a media medida—, la pantalla se apunta como
       no medida y la pasada sigue: perder una pantalla no puede costar el informe de todos los anchos. Pero no pasa
       por buena: una pantalla sin medir hace salir al recorrido con código 1 (`informeDelRecorrido.mjs`). */
    let medida = null;
    let modoCliente = null;
    let axe = null;
    try {
      medida = await medir(page);
      if (pantalla.modoCliente) {
        modoCliente = fallosDelModoCliente(
          await page.evaluate(comprobarModoCliente, { palabras: PALABRAS_DEL_ASESOR.map(({ palabra }) => palabra), debeLeerse: pantalla.modoCliente.debeLeerse, marcaDeInterno: MARCA_DE_INTERNO, interruptor: MARCO_DE_LA_APP })
        );
      }
      if (conAxe(marca)) axe = await pasarAxe(page).catch((error) => [{ regla: "axe-no-corrio", impacto: "n/d", ayuda: String(error).slice(0, 120), nodos: 0, ejemplos: [] }]);
    } catch (error) {
      anotar(`no se pudo medir: ${String(error).slice(0, 200)}`);
      /* Lo que no llegó a mirarse se dice como no mirado, no como limpio: ni el Modo cliente ni la accesibilidad. */
      if (pantalla.modoCliente && modoCliente === null) modoCliente = ["no se pudo medir en Modo cliente"];
      if (conAxe(marca) && axe === null) axe = [{ regla: "axe-no-corrio", impacto: "n/d", ayuda: "no se pudo medir la pantalla", nodos: 0, ejemplos: [] }];
    }
    /* La foto, aparte: si falla ella, lo medido vale y se dice que lo que faltó fue la foto. */
    try {
      await fotoDePaginaEntera(page, resolve(SALIDA, `${marca}-${String(orden).padStart(2, "0")}-${pantalla.id}.jpg`));
    } catch (error) {
      anotar(`no se pudo fotografiar: ${String(error).slice(0, 200)}`);
    }
    if (pantalla.despues) await pantalla.despues(page).catch(() => {});
    /* Lo que una pantalla declara como esperado no cuenta como fallo, pero se anota cuántas veces pasó. */
    const esEsperado = (texto) => (pantalla.esperado ?? []).some((patron) => patron.test(texto));
    const esperados = [...consola, ...peticiones].filter(esEsperado).length;
    const deLaConsola = [...new Set(consola.filter((texto) => !esEsperado(texto)))].slice(0, 8);
    const deLasPeticiones = [...new Set(peticiones.filter((texto) => !esEsperado(texto)))].slice(0, 8);
    informe.push({ ancho, marca, clave, conDedo, id: pantalla.id, ruta: pantalla.ruta, ...(medida ?? {}), sinMedir: medida === null, modoCliente, consola: deLaConsola, peticiones: deLasPeticiones, esperados, axe, msDeCarga, fallo });
    process.stdout.write(`${marca} ${pantalla.id} · ${medida && medida.anchoDePagina > medida.anchoDeVentana + 1 ? "DESBORDA " : ""}${modoCliente?.length ? `MODO CLIENTE ${modoCliente.length} ` : ""}${medida?.textosCortados ? `cortados ${medida.textosCortados} ` : ""}${medida?.cajasConControlesFuera ? `cajas con control fuera ${medida.cajasConControlesFuera} ` : ""}${medida?.cajasSinTeclado ? `cajas sin nada que se enfoque ${medida.cajasSinTeclado} ` : ""}${deLaConsola.length ? `consola ${deLaConsola.length} ` : ""}${deLasPeticiones.length ? `peticiones ${deLasPeticiones.length} ` : ""}${esperados ? `esperados ${esperados} ` : ""}${axe ? `axe ${axe.reduce((suma, f) => suma + f.nodos, 0)} ` : ""}${fallo ?? ""}\n`);
    /* Fuera del Modo cliente para la pantalla siguiente. La aplicación lo lee al montar, así que se sale de ella: la
       siguiente carga entera, vaya a la ruta que vaya, y lo lee apagado. Va al final de la vuelta, con la fila ya
       apuntada: en la página en blanco la siembra de la cartera de muestra no tiene dónde escribir y da un error, que
       es de esta herramienta y no de la aplicación; la lista de la consola se vacía al empezar la pantalla siguiente. */
    if (pantalla.modoCliente) {
      await ponerModoCliente(page, false).catch(() => {});
      await page.goto("about:blank").catch(() => {});
    }
  }
  await contexto.close();
}
await navegador.close();

writeFileSync(resolve(SALIDA, "informe.json"), JSON.stringify(informe, null, 2));

/* El cierre —el informe legible, el resumen y el código de salida— sale de `informeDelRecorrido.mjs`. */
const cierre = cerrarElRecorrido({
  informe,
  etiqueta: ETIQUETA,
  base: BASE,
  fecha: new Date().toISOString().slice(0, 16).replace("T", " "),
  pantallas: PANTALLAS,
  anchos: ANCHOS_PEDIDOS,
  barrasOcultas: BARRAS_OCULTAS,
  axeEnTodos: AXE_EN_TODOS,
  marcaDeAxe: MARCA_DE_AXE
});
writeFileSync(resolve(SALIDA, "informe.md"), cierre.lineas.join("\n") + "\n");
for (const linea of cierre.consola) console.log(linea);
console.log(`Salida: ${SALIDA}`);
for (const error of cierre.errores) console.error(error);
if (cierre.codigo) process.exitCode = cierre.codigo;
