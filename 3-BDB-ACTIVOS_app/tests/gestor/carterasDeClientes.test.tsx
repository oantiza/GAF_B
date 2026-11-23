// @vitest-environment happy-dom
/**
 * Carteras de clientes tras el rediseño (14-11-2026): la entrada (cabecera, buscar en la lista y sus estados), la
 * respuesta de una cartera (las cifras del titular, con el formato común), sus pestañas en la dirección, el periodo
 * solo donde gobierna, los enlaces «Ver…» del Resumen, el importe de un movimiento sin color y las acciones de «Más»
 * que dicen por qué están desactivadas.
 */
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const control = vi.hoisted(() => ({ almacen: null as unknown, fase: "lista" as string }));
vi.mock("../../src/gestor/ui/estado/useAlmacen", () => ({
  useAlmacen: () => ({ estado: { fase: control.fase, almacen: control.almacen, nombre: "Carteras" }, error: null, elegir: async () => undefined, reanudar: async () => undefined, olvidar: async () => undefined })
}));
vi.mock("../../src/gestor/mercado/plataforma", () => ({ HAY_PLATAFORMA: false, catalogoDeActivos: async () => [] }));
vi.mock("../../src/gestor/informes", () => ({ descargarInformePdf: vi.fn(), descargarExcel: vi.fn() }));

import * as formato from "../../src/core/formato";
import type { AlmacenDeCarteras, ResumenDeCartera } from "../../src/gestor/almacen/almacen";
import { demostracion } from "../../src/gestor/demo/carteraDemo";
import { fechaDeInicioDelPeriodo } from "../../src/gestor/motor/analisis";
import { hoy } from "../../src/gestor/motor/fechas";
import { metrica } from "../../src/gestor/motor/metricas/registro";
import { GestorDeCarterasPage } from "../../src/gestor/ui/GestorDeCarterasPage";
import { RespuestaDeLaCartera } from "../../src/gestor/ui/RespuestaDeLaCartera";
import { VistaDeCartera } from "../../src/gestor/ui/VistaDeCartera";
import { VistaResumen } from "../../src/gestor/ui/vistas/VistaResumen";
import { BloqueCerradas } from "../../src/gestor/ui/analisis/BloqueCerradas";
import { VistaCuentas } from "../../src/gestor/ui/vistas/VistaCuentas";
import { VistaMovimientos } from "../../src/gestor/ui/vistas/VistaMovimientos";
import type { MercadoCargado } from "../../src/gestor/mercado/cargar";
import { saltosDeNivel } from "../support/saltosDeNivel";
import { activo, cartera, mov, serie } from "./ayudas";
import { datosDeLaDemo, datosDeVista, panel, pintar, type Pintado } from "./vistaAnalisisDatos";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let pintado: Pintado | undefined;
afterEach(async () => {
  await pintado?.desmontar();
  pintado = undefined;
  control.fase = "lista";
  window.history.replaceState(null, "", "/");
});

async function esperar(condicion: () => boolean) {
  for (let intento = 0; intento < 100 && !condicion(); intento += 1) {
    await act(async () => {
      await new Promise((resolver) => setTimeout(resolver, 0));
    });
  }
  expect(condicion()).toBe(true);
}

const boton = (texto: string) => [...document.body.querySelectorAll("button")].find((b) => b.textContent?.trim() === texto || b.getAttribute("aria-label") === texto);

const resumen = (nombre: string, cliente?: string): ResumenDeCartera => ({ fichero: `${nombre}.cartera.json`, id: nombre, nombre, cliente, divisaBase: "EUR", movimientos: 3, modificada: "2026-11-01T10:00:00.000Z" });

async function escribir(input: HTMLInputElement, valor: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, valor);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("la entrada: Carteras de clientes", () => {
  it("la cabecera dice dónde están las carteras, con «Nueva cartera» como principal, «Importar extractos» y lo demás en «Más»", async () => {
    window.scrollTo = (() => undefined) as typeof window.scrollTo;
    control.almacen = { nombre: "Carteras", retiradas: async () => [], listar: async () => [resumen("Familia García", "Marta García")] } as unknown as AlmacenDeCarteras;
    pintado = await pintar(<GestorDeCarterasPage />);
    await esperar(() => (document.body.textContent ?? "").includes("Familia García"));
    expect(document.body.querySelector("h1")?.textContent).toBe("Carteras de clientes");
    expect(document.body.querySelector(".ui-page-header__description")?.textContent).toContain("en la carpeta «Carteras»");
    const acciones = [...document.body.querySelectorAll(".ui-action-toolbar > button")];
    expect(acciones.map((b) => b.textContent?.trim())).toEqual(["Importar extractos", "Nueva cartera"]);
    expect(boton("Nueva cartera")!.className).toContain("ui-button--primary");

    await act(async () => boton("Más")!.click());
    const enElMenu = [...document.body.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent ?? "");
    expect(enElMenu.some((texto) => texto.startsWith("Ver la cartera de demostración"))).toBe(true);
    expect(enElMenu.some((texto) => texto.startsWith("Cambiar de carpeta"))).toBe(true);
  });

  it("buscar filtra la lista por el nombre de la cartera o del cliente, sin mirar tildes ni mayúsculas", async () => {
    window.scrollTo = (() => undefined) as typeof window.scrollTo;
    control.almacen = { nombre: "Carteras", retiradas: async () => [], listar: async () => [resumen("Familia García", "Marta García"), resumen("Familia Ruiz", "Luis Ruiz"), resumen("Sociedad Olmo")] } as unknown as AlmacenDeCarteras;
    pintado = await pintar(<GestorDeCarterasPage />);
    await esperar(() => document.body.querySelectorAll("tbody tr").length === 3);
    const buscar = document.body.querySelector<HTMLInputElement>('input[type="search"]')!;
    expect(document.getElementById(buscar.id) === buscar && document.querySelector(`label[for="${buscar.id}"]`)?.textContent).toBe("Buscar");

    await escribir(buscar, "garcia");
    expect([...document.body.querySelectorAll("tbody tr")].map((tr) => tr.querySelector("th")?.textContent)).toEqual(["Familia García"]);
    await escribir(buscar, "LUIS");
    expect([...document.body.querySelectorAll("tbody tr")].map((tr) => tr.querySelector("th")?.textContent)).toEqual(["Familia Ruiz"]);
    expect(document.body.textContent).toContain("1 de 3 carteras");
    await escribir(buscar, "nadie");
    expect(document.body.querySelector("tbody")).toBeNull();
    expect(document.body.textContent).toContain("Ninguna cartera responde a «nadie».");
  });

  it("estados: leyendo la carpeta, carpeta vacía y carpeta que no se puede leer", async () => {
    window.scrollTo = (() => undefined) as typeof window.scrollTo;
    control.almacen = { nombre: "Carteras", retiradas: async () => [], listar: () => new Promise(() => undefined) } as unknown as AlmacenDeCarteras;
    pintado = await pintar(<GestorDeCarterasPage />);
    expect(document.body.textContent).toContain("Leyendo la carpeta de carteras…");
    await pintado.desmontar();

    control.almacen = { nombre: "Carteras", retiradas: async () => [], listar: async () => [] } as unknown as AlmacenDeCarteras;
    pintado = await pintar(<GestorDeCarterasPage />);
    await esperar(() => (document.body.textContent ?? "").includes("Aún no hay carteras"));
    expect(boton("Ver la cartera de demostración")).toBeDefined();
    await pintado.desmontar();

    control.almacen = { nombre: "Carteras", retiradas: async () => [], listar: async () => { throw new Error("Sin permiso para leer la carpeta."); } } as unknown as AlmacenDeCarteras;
    pintado = await pintar(<GestorDeCarterasPage />);
    await esperar(() => (document.body.textContent ?? "").includes("No se puede leer la carpeta de carteras"));
    expect(document.body.textContent).toContain("Sin permiso para leer la carpeta.");
    expect(boton("Elegir la carpeta de nuevo")).toBeDefined();
  });
});

describe("la respuesta de una cartera", () => {
  it("cuatro cifras, las del titular, con el formato común: patrimonio en grande y sin decimales, resultado y las dos rentabilidades con signo", async () => {
    const datos = datosDeLaDemo("anio");
    const { analisis } = datos;
    const r = analisis.rentabilidad!;
    pintado = await pintar(<RespuestaDeLaCartera datos={datos} />);
    const grupo = pintado.vista.querySelector('[role="group"][aria-label="Cuánto vale y cuánto ha ganado"]')!;
    const datosDeLaBanda = [...grupo.querySelectorAll(".respuesta__dato")].map((dato) => ({
      rotulo: dato.querySelector(".respuesta__rotulo")!.firstChild!.textContent!.trim(),
      cifra: dato.querySelector(".respuesta__cifra")!.textContent,
      principal: dato.classList.contains("respuesta__dato--principal")
    }));
    expect(datosDeLaBanda).toEqual([
      { rotulo: "Patrimonio", cifra: formato.importeTitular(analisis.patrimonio), principal: true },
      { rotulo: "Resultado del periodo", cifra: formato.importeTitular(r.resultado, { conSigno: true }), principal: false },
      { rotulo: "Rentabilidad de la cartera", cifra: formato.rentabilidad(r.twr), principal: false },
      { rotulo: "Rentabilidad del cliente", cifra: formato.rentabilidad(metrica("rentabilidadDelCliente").valor(analisis)), principal: false }
    ]);
    const apuntes = [...grupo.querySelectorAll(".respuesta__apunte")].map((apunte) => apunte.textContent);
    expect(apuntes[0]).toBe(`a ${formato.fecha(analisis.fecha)} · ${formato.importeTitular(analisis.patrimonio - analisis.efectivo.total)} en valores y ${formato.importeTitular(analisis.efectivo.total)} en efectivo`);
    expect(apuntes[1]).toBe(formato.periodo(fechaDeInicioDelPeriodo(analisis), analisis.periodo.hasta));
    expect(apuntes[2]).toBe(`su referencia, ${formato.rentabilidad(analisis.referencia!.rentabilidad)}`);
    expect(apuntes[3]).toContain("cuenta cuándo aportó");
    /* Las dos rentabilidades explican cuál es cuál, con el teclado. */
    expect([...grupo.querySelectorAll(".nota-emergente__boton")].map((b) => b.getAttribute("aria-label"))).toEqual(["Qué es la rentabilidad de la cartera", "Qué es la rentabilidad del cliente"]);
    /* El color de lo que se gana o se pierde, y ninguno en el patrimonio. */
    const cifras = [...grupo.querySelectorAll(".respuesta__cifra .cifra")];
    expect(cifras[0].className).toBe("cifra");
    for (const cifra of cifras.slice(1)) expect(cifra.className).toMatch(/cifra--(sube|baja)/);
  });

  it("con una cartera sin nada que medir no se pinta", async () => {
    const datos = datosDeLaDemo();
    pintado = await pintar(<RespuestaDeLaCartera datos={{ ...datos, analisis: { ...datos.analisis, vacia: true } }} />);
    expect(pintado.vista.innerHTML).toBe("");
  });
});

describe("el Resumen", () => {
  it("como la maqueta: evolución y últimos movimientos a la izquierda; de dónde viene el resultado y en qué está invertida a la derecha", async () => {
    pintado = await pintar(<VistaResumen datos={datosDeLaDemo("anio")} />);
    const rejilla = pintado.vista.querySelector(".gestor-rejilla")!;
    const bloques = [...rejilla.querySelectorAll(":scope > section.panel")].map((seccion) => ({
      titulo: seccion.querySelector(".panel__title")!.textContent,
      columna: seccion.classList.contains("gestor-rejilla__ancha") ? "ancha" : "estrecha"
    }));
    expect(bloques).toEqual([
      { titulo: "Evolución del patrimonio", columna: "ancha" },
      { titulo: "De dónde viene el resultado", columna: "estrecha" },
      { titulo: "Últimos movimientos", columna: "ancha" },
      { titulo: "En qué está invertida", columna: "estrecha" }
    ]);
    /* En qué está invertida, como partes de un todo. */
    expect(panel(pintado.vista, "En qué está invertida").querySelector("ul.partes")).not.toBeNull();
  });

  it("el importe de un movimiento va en tinta, con su signo; el resultado, con su color", async () => {
    pintado = await pintar(<VistaResumen datos={datosDeLaDemo("anio")} />);
    const ultimos = panel(pintado.vista, "Últimos movimientos");
    expect(ultimos.querySelectorAll("tbody tr").length).toBeGreaterThan(0);
    expect(ultimos.querySelector(".cifra--sube, .cifra--baja")).toBeNull();
    expect([...ultimos.querySelectorAll("tbody td")].some((td) => /^[+−]\d/.test(td.textContent ?? ""))).toBe(true);
    const total = panel(pintado.vista, "De dónde viene el resultado").querySelector(".gestor-fila--total .cifra")!;
    expect(total.className).toMatch(/cifra--(sube|baja)/);
  });

  it("una celda sin dato lo dice con su texto de ausencia, no en blanco: los títulos de una aportación «No aplica»", async () => {
    pintado = await pintar(<VistaResumen datos={datosDeLaDemo("anio")} />);
    const ultimos = panel(pintado.vista, "Últimos movimientos");
    const ausencias = [...ultimos.querySelectorAll("tbody .tabla__ausencia")];
    expect(ausencias.length).toBeGreaterThan(0);
    expect(ausencias.every((celda) => (celda.textContent ?? "").trim() !== "")).toBe(true);
    const aportacion = [...ultimos.querySelectorAll("tbody tr")].find((fila) => fila.textContent?.includes("Aportación"))!;
    expect(aportacion.querySelector(".tabla__ausencia")?.textContent).toBe("No aplica");
  });

  it("«Ver las comprobaciones» lleva a Análisis, a su vista «Comprobaciones»; «Ver el análisis», a «Composición»", async () => {
    const irA = vi.fn();
    const datos = { ...datosDeLaDemo("anio"), irA };
    /* Con un aviso de mercado sale el bloque de lo que hay que revisar. */
    const conAviso = { ...datos, mercado: { ...datos.mercado, mercado: { ...datos.mercado.mercado, avisos: ["No se han podido leer los cambios."] } } };
    pintado = await pintar(<VistaResumen datos={conAviso} />);
    await act(async () => boton("Ver las comprobaciones")!.click());
    expect(irA).toHaveBeenLastCalledWith("analisis", "comprobaciones");
    await act(async () => boton("Ver el análisis")!.click());
    expect(irA).toHaveBeenLastCalledWith("analisis", "composicion");
    await act(async () => boton("Ver todos")!.click());
    expect(irA).toHaveBeenLastCalledWith("movimientos");
  });

  it("sin movimientos, el estado vacío dice qué hacer", async () => {
    const datos = datosDeLaDemo();
    pintado = await pintar(<VistaResumen datos={{ ...datos, abierta: { ...datos.abierta, cartera: { ...datos.abierta.cartera, movimientos: [] } } }} />);
    expect(pintado.vista.querySelector(".ui-empty-state h2")?.textContent).toBe("Esta cartera aún no tiene movimientos");
    expect(pintado.vista.textContent).toContain("«Importar extractos»");
  });
});

/* Lo que dice cada celda de una tabla, por el título de su columna: la fila la encabeza su `th`, con el nombre. */
function celdas(tabla: HTMLElement, nombreDeLaFila: string): Record<string, string> {
  const titulos = [...tabla.querySelectorAll("thead th")].map((th) => (th.querySelector("button")?.childNodes[0]?.textContent ?? th.textContent ?? "").trim());
  const fila = [...tabla.querySelectorAll("tbody tr")].find((tr) => tr.querySelector("th")?.textContent?.startsWith(nombreDeLaFila));
  if (!fila) throw new Error(`No hay una fila «${nombreDeLaFila}».`);
  const texto = [...fila.children].map((celda) => (celda.querySelector(".tabla__ausencia")?.textContent ?? celda.childNodes[0]?.textContent ?? "").trim());
  return Object.fromEntries(titulos.map((titulo, i) => [titulo, texto[i]]));
}

describe("un dato que falta se dice, no se deja en blanco", () => {
  it("Cuentas: una posición sin precio lo dice en Precio, y una sin coste conocido, en Coste", async () => {
    /*
     * El cambio del dólar empieza el 04-01, el día después de las dos compras.
     * B, una acción en dólares comprada pagando en euros, sin precio declarado y sin serie de mercado: el precio implícito
     * de la operación se deduce con el cambio de ese día (A-196), y ese día no hay ninguno, así que B no tiene ningún
     * precio. Su coste sí se sabe: 1.000 € pagados.
     * C, en dólares, comprada con dólares el 03-01, sin cambio a euros ese día: se sabe su precio (120 $ por título, el de
     * la operación), pero no lo que costó en la divisa de la cartera. Hoy sí hay cambio, y se valora. (Sin ningún cambio,
     * tampoco tendría valor: va como una sin precio desde el 22-11-2026.)
     */
    const B = activo("B", "ACCION", "USD");
    const C = activo("C", "ACCION", "USD");
    const mercado: MercadoCargado = { datos: { precios: new Map(), cambios: new Map([["USD", serie(["2025-01-04", 1.25])]]) }, fichas: new Map(), avisos: [] };
    const conHuecos = cartera([B, C], [
      mov("aportacion", "2025-01-02", { importe: "2000" }),
      mov("aportacion", "2025-01-02", { importe: "600", divisa: "USD" }),
      mov("compra", "2025-01-03", { activoId: "B", titulos: "10", importe: "-1000" }),
      mov("compra", "2025-01-03", { activoId: "C", titulos: "5", precio: "120", divisa: "USD", importe: "-600" })
    ]);
    pintado = await pintar(<VistaCuentas datos={datosDeVista(conHuecos, mercado)} />);
    const valores = panel(pintado.vista, "Cuenta de valores");
    const sinPrecio = celdas(valores, "Activo B");
    expect(sinPrecio.Precio).toBe("Falta el dato");
    expect(sinPrecio.Coste).toBe("1.000,00\u00a0€");
    const sinCoste = celdas(valores, "Activo C");
    expect(sinCoste.Coste).toBe("Falta el dato");
    expect(sinCoste.Precio).toBe("120,00\u00a0USD");
    /* Sin coste no hay resultado latente: también lo dice. */
    expect(sinCoste["Resultado latente"]).toBe("Falta el dato");
  });

  it("Posiciones cerradas: una venta de títulos que el libro no tenía lo dice en Coste y en Resultado", async () => {
    /* Se compran 4 títulos por 400 € y se venden 10 por 1.500 €: de 6 de los 10 no se sabe lo que costaron. */
    const ACC = activo("ACC");
    const mercado: MercadoCargado = { datos: { precios: new Map([["ACC", serie(["2024-01-03", 100], ["2024-02-01", 150])]]), cambios: new Map() }, fichas: new Map(), avisos: [] };
    const conVentaIncompleta = cartera([ACC], [
      mov("aportacion", "2024-01-02", { importe: "1000" }),
      mov("compra", "2024-01-03", { activoId: "ACC", titulos: "4", importe: "-400" }),
      mov("venta", "2024-02-01", { activoId: "ACC", titulos: "10", importe: "1500" })
    ]);
    pintado = await pintar(<BloqueCerradas analisis={datosDeVista(conVentaIncompleta, mercado).analisis} />);
    const cerradas = panel(pintado.vista, "Posiciones cerradas");
    const venta = celdas(cerradas, "Activo ACC");
    expect(venta.Coste).toBe("Falta el dato");
    expect(venta.Resultado).toBe("Falta el dato");
    expect(venta.Cobrado).toBe("1.500,00\u00a0€");
    expect(cerradas.textContent).toContain("Falta el coste de alguna venta");
  });

  it("el Libro de la cartera de demostración no deja ninguna celda vacía", async () => {
    pintado = await pintar(<VistaMovimientos datos={datosDeLaDemo()} />);
    const filas = [...pintado.vista.querySelectorAll("tbody tr")];
    expect(filas.length).toBeGreaterThan(0);
    expect(pintado.vista.querySelectorAll("tbody .tabla__ausencia").length).toBeGreaterThan(0);
    const vacias = filas.flatMap((fila) => [...fila.children].filter((celda) => (celda.textContent ?? "").trim() === "").map((celda) => `${fila.querySelector("th")?.textContent} · columna ${[...fila.children].indexOf(celda) + 1}`));
    expect(vacias).toEqual([]);
  });
});

describe("una cartera abierta", () => {
  const abrirLaDemo = async () => {
    window.scrollTo = (() => undefined) as typeof window.scrollTo;
    pintado = await pintar(<VistaDeCartera alVolver={() => undefined} almacen={null} fichero={null} inicial={demostracion(hoy()).cartera} />);
    await esperar(() => document.body.querySelector(".respuesta") !== null);
  };

  it("cabecera: vuelta, contexto, título y procedencia; «Añadir movimiento» como principal", async () => {
    await abrirLaDemo();
    expect(boton("← Carteras de clientes")).toBeDefined();
    const cabecera = document.body.querySelector(".ui-page-header")!;
    expect(cabecera.querySelector(".ui-eyebrow")?.textContent).toMatch(/^Cartera de cliente · .* · en euros$/);
    expect(cabecera.querySelector(".ui-page-header__description")?.textContent).toMatch(/Demostración: no se guarda · \d+ movimientos/);
    expect([...cabecera.querySelectorAll(".ui-action-toolbar > button")].map((b) => b.textContent?.trim())).toEqual(["Informes", "Importar extractos", "Añadir movimiento"]);
    expect(boton("Añadir movimiento")!.className).toContain("ui-button--primary");
  });

  /* MAR-32: `h1` la cartera, `h2` cada bloque, `h3` lo que va dentro; ni en el Resumen ni en las cuatro vistas del
     Análisis se salta un nivel. */
  it("ningún nivel de encabezado se salta: el Resumen y las vistas del Análisis", async () => {
    await abrirLaDemo();
    const pantalla = pintado!.vista;
    expect(pantalla.querySelector("h1")).not.toBeNull();
    expect(saltosDeNivel(pantalla), "Resumen").toEqual([]);
    await act(async () => boton("Análisis")!.click());
    for (const vista of ["Rentabilidad", "Composición", "Ingresos y costes", "Comprobaciones"]) {
      await act(async () => boton(vista)!.click());
      expect(document.body.querySelector('[role="tabpanel"] .panel__title'), vista).not.toBeNull();
      expect(saltosDeNivel(pantalla), `Análisis · ${vista}`).toEqual([]);
    }
  });

  it("las acciones desactivadas de «Más» dicen por qué", async () => {
    await abrirLaDemo();
    await act(async () => boton("Más")!.click());
    const items = [...document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
    const versiones = items.find((item) => item.textContent?.startsWith("Versiones anteriores"))!;
    expect(versiones.disabled).toBe(true);
    expect(versiones.textContent).toContain("La cartera de demostración no se guarda");
    const descargar = items.find((item) => item.textContent?.startsWith("Descargar una copia de la cartera"))!;
    expect(descargar.disabled).toBe(true);
    expect(descargar.textContent).toContain("no se descarga");
    expect(items.find((item) => item.textContent?.startsWith("Deshacer"))!.textContent).toContain("No hay nada que deshacer.");
  });

  it("la pestaña elegida va en la dirección, y se recupera al volver a abrir la vista", async () => {
    await abrirLaDemo();
    const pestanas = [...document.body.querySelectorAll('[role="tab"]')].map((tab) => tab.textContent);
    expect(pestanas).toEqual(["Resumen", "Cuentas", "Movimientos", "Análisis", "Comparar"]);
    await act(async () => boton("Cuentas")!.click());
    expect(window.location.hash).toBe("#pestana=cuentas");
    expect(document.body.querySelector('[role="tabpanel"]')?.getAttribute("aria-labelledby")).toBe("gestor-tab-cuentas");
    await pintado!.desmontar();
    pintado = undefined;

    /* Como al recargar: la dirección ya trae la pestaña. */
    await abrirLaDemo();
    expect(document.body.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("Cuentas");
    expect(document.body.querySelector('[role="tabpanel"]')?.id).toBe("gestor-panel-cuentas");
  });

  it("el periodo solo se enseña donde gobierna: no en Cuentas ni en Movimientos, que dicen a qué fecha están", async () => {
    await abrirLaDemo();
    const hayPeriodo = () => document.body.querySelector('[role="group"][aria-label="Periodo"]') !== null;
    expect(hayPeriodo()).toBe(true);
    await act(async () => boton("Cuentas")!.click());
    expect(hayPeriodo()).toBe(false);
    expect(document.body.textContent).toContain(`a ${formato.fecha(hoy())}`);
    await act(async () => boton("Movimientos")!.click());
    expect(hayPeriodo()).toBe(false);
    expect(document.body.textContent).toContain(`el libro entero, a ${formato.fecha(hoy())}`);
    await act(async () => boton("Análisis")!.click());
    expect(hayPeriodo()).toBe(true);
  });

  it("«Ver el análisis» abre Análisis en su vista «Composición», y las dos van en la dirección", async () => {
    await abrirLaDemo();
    const ver = boton("Ver el análisis")!;
    expect(ver).toBeDefined();
    await act(async () => ver.click());
    expect(window.location.hash).toBe("#vista=composicion&pestana=analisis");
    expect(document.body.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("Análisis");
    const titulos = [...document.body.querySelectorAll(".panel__title")].map((t) => t.textContent);
    expect(titulos[0]).toBe("Composición");
    expect(titulos).toContain("Contribución de cada posición");
  });
});
