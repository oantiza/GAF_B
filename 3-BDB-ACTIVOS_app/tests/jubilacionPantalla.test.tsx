// @vitest-environment happy-dom

/**
 * La pantalla de Jubilación, montada de verdad. Lo que se vigila es lo que un cliente tendría delante: que abre
 * sin cifras, que un ejemplo se dice ejemplo, que lo que falta se dice que falta y no sale como un cero, y que
 * las cifras de pantalla son las del motor.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const fuente = vi.hoisted(() => ({ getComparableAssets: vi.fn() }));
vi.mock("../src/adapters/assetDataSource", () => ({ getAssetDataSource: () => fuente }));
/* El papel tiene sus propias pruebas: aquí solo se mira con qué se le llama. */
const papel = vi.hoisted(() => ({ downloadJubilacionPdf: vi.fn() }));
vi.mock("../src/reports/jubilacionPdf", () => papel);

import { importeTitular } from "../src/core/formato";
import { guardarIdentidad } from "../src/core/identidadDelAsesor";
import { clearSessionCaches } from "../src/core/sessionCaches";
import { JubilacionPage } from "../src/pages/JubilacionPage";

let root: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.resetAllMocks();
  /* Lo escrito vive en memoria y sobrevive al desmontaje: cada prueba empieza como una sesión nueva. */
  clearSessionCaches();
  const contenedor = document.createElement("div");
  document.body.appendChild(contenedor);
  root = createRoot(contenedor);
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

const montar = (props: Partial<Parameters<typeof JubilacionPage>[0]> = {}) =>
  act(async () => root.render(<JubilacionPage portfolioName="" positions={[]} sourceKind="firebaseLiveApi" totalCapital={undefined} {...props} />));

const texto = () => document.body.textContent ?? "";
const boton = (rotulo: string) => {
  const encontrado = [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === rotulo);
  if (!encontrado) throw new Error(`Falta el botón «${rotulo}»`);
  return encontrado;
};
const pulsar = (rotulo: string) => act(async () => boton(rotulo).click());
/** La cifra de la respuesta: lo que le queda al cliente al mes. */
const neto = () => document.querySelector(".jubilacion-respuesta__valor")?.firstChild?.textContent;
/** Una de las líneas que la explican, por su rótulo. */
const linea = (rotulo: string) =>
  [...document.querySelectorAll(".jubilacion-libro .rows__item")].find((fila) => fila.querySelector(".rows__label")?.textContent === rotulo)?.querySelector(".rows__value")?.textContent;
/** Los títulos de sección de lo que sale: lo que hay junto al formulario y lo que va debajo, a todo el ancho. */
const titulosDelResultado = () =>
  [...document.querySelectorAll(".panel__title")].filter((titulo) => !titulo.closest(".jubilacion-datos")).map((titulo) => titulo.textContent);
/** Un campo por su rótulo: la pieza `Campo` enlaza el rótulo con su control por `htmlFor`. */
const campo = (rotulo: string) => {
  const etiqueta = [...document.querySelectorAll<HTMLLabelElement>("label.field__label")].find((label) => label.textContent === rotulo);
  const entrada = etiqueta ? document.getElementById(etiqueta.htmlFor) : null;
  if (!(entrada instanceof HTMLInputElement || entrada instanceof HTMLSelectElement)) throw new Error(`Falta el campo «${rotulo}»`);
  return entrada;
};
/** El error que la pieza `Campo` pone junto a su control. */
const errorDe = (rotulo: string) => campo(rotulo).closest(".field")?.querySelector(".field__error")?.textContent;

/** Teclear en un campo numérico o elegir en un desplegable: cambia al momento. */
async function escribir(rotulo: string, valor: string) {
  await act(async () => {
    const entrada = campo(rotulo);
    const prototipo = entrada instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototipo, "value")!.set!.call(entrada, valor);
    entrada.dispatchEvent(new Event(entrada instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}

/** Un importe confirma al salir del campo: foco, escribir y salir. */
async function confirmarImporte(entrada: () => HTMLInputElement, valor: string) {
  await act(async () => entrada().focus());
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(entrada(), valor);
    entrada().dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => entrada().blur());
}
const importe = (nombre: string) => () => {
  const entrada = document.querySelector<HTMLInputElement>(`input[aria-label="${nombre}"]`);
  if (!entrada) throw new Error(`Falta el importe «${nombre}»`);
  return entrada;
};

describe("Jubilación en pantalla", () => {
  test("abre vacía: sin cifras, sin informe que pedir y con el ejemplo ofrecido", async () => {
    await montar();
    expect(document.querySelector("h1")?.textContent).toBe("Jubilación");
    expect(document.querySelector(".jubilacion-respuesta")).toBeNull();
    expect(texto()).toContain("Escribe los datos del cliente");
    expect(boton("Informe para el cliente").disabled).toBe(true);
    expect(texto()).not.toContain("Ejemplo");
    /* La residencia sí está puesta, con su norma a la vista: es la procedencia de todo lo que venga después. */
    expect(campo("Territorio").value).toBe("bizkaia");
    expect(texto()).toContain("IRPF de Bizkaia 2026 · NF 13/2013 · fuentes consultadas el 04-10-2026");
    /* Ningún título de sección es un párrafo, y hay uno por bloque del formulario: la residencia fiscal va la primera,
       porque de ella sale la norma de todo lo demás (J1, Óscar, 21-11-2026; hasta entonces iba al final). */
    expect([...document.querySelectorAll("h2.panel__title")].map((h) => h.textContent)).toEqual(["Residencia fiscal", "El cliente", "Ahorros e inversiones", "EPSV", "Hipótesis"]);
  });

  test("lo que falta se dice que falta, y no sale una fila de ceros", async () => {
    await montar();
    await escribir("Edad actual", "66");
    expect(texto()).toContain("Falta la pensión, los ahorros o la previsión social del cliente.");
    expect(document.querySelector(".jubilacion-respuesta")).toBeNull();
    await confirmarImporte(() => campo("Pensión pública bruta, por paga") as HTMLInputElement, "1.800");
    /* 1.800 × 14 = 25.200; − bonificación 3.000 = 22.200 → 18.080 × 23 % + 4.120 × 28 % = 5.312; − 1.615 = 3.697; deducción por edad 393 × (30.000 − 22.200) / 10.000 = 306,54 → 3.390,46. Neto: 21.809,54 al año, 1.817 al mes. */
    expect(neto()).toBe(importeTitular(1817));
    expect(linea("Ingreso bruto")).toBe(importeTitular(2100));
    /* Sin ahorros no hay nada que pueda acabarse: se dice, y no se enseñan escenarios. */
    expect(texto()).toContain("Sin ahorros que retirar.");
    expect(texto()).not.toContain("Hasta cuándo llegan los ahorros");
    expect(texto()).not.toContain("Ejemplo");
    expect(boton("Informe para el cliente").disabled).toBe(false);
  });

  test("el ejemplo se dice ejemplo, y sus cifras son las del motor", async () => {
    await montar();
    await pulsar("Cargar un ejemplo");
    expect(document.querySelector(".distintivo")?.textContent).toBe("Ejemplo");
    expect(texto()).toContain("Cifras inventadas para enseñar la pantalla: no son de ningún cliente.");
    /* El caso de regresión del motor: 2.575,58 € netos al mes. */
    expect(neto()).toBe(importeTitular(2576));
    expect(texto()).toContain("Después del IRPF de Bizkaia. Los ahorros duran hasta los 95 años.");
    expect(texto()).toContain("Simulación · primer año de jubilación, a los 65 · media mensual del año · euros de hoy");
    /* Una sola cifra, y a su lado las líneas que la explican: 2.333 de pensión y 657 de los ahorros suman 2.990; menos 414 de
       IRPF, los 2.576 de la cifra. El IRPF exacto es 414,58 al mes, pero redondeado suelto (415) las líneas no sumaban la
       cifra (2.990 − 415 = 2.575): es lo que va del bruto al neto ya redondeados (PLA-21). */
    expect(document.querySelectorAll(".jubilacion-respuesta__valor")).toHaveLength(1);
    expect([...document.querySelectorAll(".jubilacion-libro .rows__label")].map((r) => r.textContent)).toEqual(["Pensión pública", "De los ahorros", "Ingreso bruto", "IRPF · 13,9\u00a0% del bruto", "Ingreso neto"]);
    expect(linea("Pensión pública")).toBe(importeTitular(2333));
    expect(linea("De los ahorros")).toBe(importeTitular(657));
    expect(linea("Ingreso bruto")).toBe(importeTitular(2990));
    expect(linea("IRPF · 13,9\u00a0% del bruto")).toBe(importeTitular(-414));
    expect(linea("Ingreso neto")).toBe(importeTitular(2576));
    /* Es una simulación, y las rentabilidades se eligen para simular: se dice junto a los escenarios, en las hipótesis y al pie. */
    expect(texto()).toContain("Rentabilidades elegidas para simular, no previstas ni prometidas");
    expect(texto()).toContain("Se eligen para simular: no son una previsión ni una promesa");
    expect(document.querySelector(".jubilacion-pie")?.textContent).toMatch(/^Simulación\..*elegidas para simular: no son una previsión ni una promesa\. No es una liquidación\s+tributaria, ni asesoramiento fiscal personalizado, ni una recomendación de inversión\./);
    /* Los escenarios, en frases; y los dos que se acaban antes de la edad del plan, señalados. */
    const frases = [...document.querySelectorAll(".jubilacion-frase")].map((f) => [f.querySelector(".rows__label")?.textContent, f.querySelector(".rows__value")?.textContent, f.classList.contains("jubilacion-frase--agota")]);
    expect(frases).toEqual([
      ["Con la hipótesis, un 3,0\u00a0% al año", "Llegan justo a los 95 años", false],
      ["Si rinden un 1,5\u00a0% al año", "Se agotan a los 89 años", true],
      ["Si rinden un 4,5\u00a0% al año", `Llegan a los 95 años y sobran ${importeTitular(76918)}`, false],
      ["Con un mal comienzo: −12\u00a0% y −5\u00a0% los dos primeros años; después, 3,0\u00a0%", "Se agotan a los 89 años", true]
    ]);
    /* Las secciones del resultado, cada una con su título de verdad y su procedencia debajo: primero la respuesta, después las cuentas. */
    expect(titulosDelResultado()).toEqual(["Hasta cuándo llegan los ahorros", "El ingreso de cada año", "Cuánto dura el patrimonio", "Del bruto al neto", "Qué tributa y dónde", "Año a año", "El método y las fuentes"]);
    /* Junto al formulario va la respuesta con sus gráficos; las cuentas, debajo, a todo el ancho y bajo su rótulo. */
    expect([...document.querySelectorAll(".jubilacion-resultado h2.panel__title")].map((h) => h.textContent)).toEqual(["Hasta cuándo llegan los ahorros", "El ingreso de cada año", "Cuánto dura el patrimonio"]);
    /* MAR-32: los bloques son `h2`; el único `h2` que no es de un bloque es el rótulo de las cuentas, y los paneles de
       las cuentas, que van bajo él, son `h3`. */
    expect([...document.querySelectorAll("h2:not(.panel__title)")].map((h) => h.textContent)).toEqual(["Las cuentas, para comprobarlas"]);
    expect([...document.querySelectorAll("h3.panel__title")].map((h) => h.textContent)).toEqual(["Del bruto al neto", "Qué tributa y dónde", "Año a año", "El método y las fuentes"]);
    for (const subtitulo of document.querySelectorAll(".panel-head-text > .panel__subtitle")) {
      expect(subtitulo.textContent).not.toMatch(/[{}]|undefined/);
    }
    /* El libro cuadra a la vista: la última fila es el neto del año, 30.906,99 €. */
    expect(texto()).toContain("Ingreso neto");
    expect(texto()).toContain(importeTitular(30907));
    /* Treinta años en la tabla, de los 65 a los 94. */
    const anios = [...document.querySelectorAll("table")].find((tabla) => tabla.querySelector("caption")?.textContent?.startsWith("El plan año a año"));
    expect(anios?.querySelectorAll("tbody tr")).toHaveLength(30);
    /* Vaciar pregunta antes, y deja la pantalla como abrió. */
    await pulsar("Vaciar");
    expect(texto()).toContain("¿Vaciar la simulación?");
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>(".ui-dialog button")].find((b) => b.textContent?.trim() === "Vaciar")!.click());
    expect(document.querySelector(".jubilacion-respuesta")).toBeNull();
    expect(texto()).not.toContain("Cifras inventadas");
  });

  test("las unidades cambian todas las cifras a la vez, y dicen cuáles son", async () => {
    await montar();
    await pulsar("Cargar un ejemplo");
    await escribir("Edad actual", "60");
    await pulsar("Aún no");
    expect(texto()).toContain("Falta la edad a la que se jubilará el cliente.");
    await escribir("Edad de jubilación", "65");
    const deHoy = neto();
    expect(texto()).toContain("Simulación · al jubilarse a los 65, dentro de 5 años · media mensual del año · euros de hoy");
    await pulsar("Euros de cada año");
    expect(texto()).toContain("Simulación · al jubilarse a los 65, dentro de 5 años · media mensual del año · euros de cada año");
    expect(neto()).not.toBe(deHoy);
    /* Cinco años de un IPC del 2 %: la pensión nominal del primer año es 28.000 × 1,02^5 = 30.914,26 al año, 2.576 al mes en bruto... y está en la tabla. */
    expect(texto()).toContain(importeTitular(28000 * 1.02 ** 5));
  });

  test("sin el coste de adquisición se calcula y se avisa de qué se ha supuesto", async () => {
    await montar();
    await escribir("Edad actual", "65");
    await confirmarImporte(importe("Fondos de inversión: valor de hoy"), "100.000");
    expect(texto()).toContain("Falta el coste de adquisición de los fondos de inversión: se calcula con el coste igual al valor de hoy.");
    await confirmarImporte(importe("Lo aportado a los fondos de inversión"), "60.000");
    expect(texto()).not.toContain("Falta el coste de adquisición");
  });

  test("sin desglose dice que el saldo se da por aportado hasta 2025, y con un año de antigüedad que no (N05)", async () => {
    await montar();
    await pulsar("Tiene una EPSV");
    await pulsar("Sin desglose");
    expect(texto()).toContain("El simulador trata el saldo como aportado hasta 2025. Si el cliente ha aportado en 2026, el certificado de la EPSV da el reparto exacto.");
    await escribir("Años desde la primera aportación", "1");
    expect(texto()).toContain(
      "Con un año de antigüedad o menos, la primera aportación puede ser de 2026: el simulador trata el saldo entero como posterior a 2025 y no aplica el régimen transitorio. El certificado de la EPSV da el reparto exacto."
    );
    expect(texto()).not.toContain("El simulador trata el saldo como aportado hasta 2025.");
  });

  test("sin desglose, con un año de antigüedad y el cliente ya jubilado, «más de 2 años» se desmarca sola y dice por qué (H1-03)", async () => {
    await montar();
    await escribir("Edad actual", "65");
    await pulsar("Ya jubilado");
    await pulsar("Tiene una EPSV");
    await pulsar("Sin desglose");
    await pulsar("De una vez");
    const casilla = () => {
      const c = [...document.querySelectorAll<HTMLLabelElement>("label.jubilacion-casilla")].find((l) => l.textContent?.includes("más de 2 años"));
      if (!c) throw new Error("Falta la casilla de los dos años");
      return c.querySelector("input")!;
    };
    const AVISO = "Con la antigüedad escrita, no han pasado más de 2 años desde la primera aportación: el cobro no tiene la reducción.";
    expect(casilla().checked).toBe(true);
    expect(texto()).not.toContain(AVISO);
    await escribir("Años desde la primera aportación", "1");
    expect(casilla().checked).toBe(false);
    expect(texto()).toContain(AVISO);
    /* Con tres años vuelve a ser posible: el aviso desaparece y la casilla NO se remarca sola. */
    await escribir("Años desde la primera aportación", "3");
    expect(texto()).not.toContain(AVISO);
    expect(casilla().checked).toBe(false);
  });

  test("con certificado, la rentabilidad de un tramo admite una pérdida (N06)", async () => {
    await montar();
    await pulsar("Tiene una EPSV");
    const rentabilidad = importe("Aportado desde el 1/1/2026: rentabilidad");
    await confirmarImporte(rentabilidad, "−20.000");
    expect(rentabilidad().getAttribute("aria-invalid")).not.toBe("true");
    expect(rentabilidad().value).toBe("-20.000");
  });

  test("cambiar a un territorio de plan de pensiones cambia la figura y vacía la EPSV", async () => {
    await montar();
    await pulsar("Cargar un ejemplo");
    await pulsar("Tiene una EPSV");
    await confirmarImporte(importe("Aportado hasta el 31/12/2025: saldo"), "80.000");
    expect(titulosDelResultado()).toContain("En renta, de una vez o parte de cada forma");
    await escribir("Territorio", "navarra");
    expect([...document.querySelectorAll(".jubilacion-datos h2.panel__title")].map((h) => h.textContent)).toContain("Plan de pensiones");
    expect(texto()).toContain("IRPF de Navarra 2026 · DFL 4/2008");
    expect(texto()).toContain("Sin plan de pensiones, el cálculo usa la pensión y los ahorros.");
    expect(texto()).not.toContain("En renta, de una vez o parte de cada forma");
    /* En territorio común aparece la comunidad, y su ley encabeza la procedencia. */
    await escribir("Territorio", "estatal");
    expect(document.querySelector<HTMLSelectElement>(".jubilacion-datos select:not([value='estatal'])")).not.toBeNull();
    expect(texto()).toContain("Escala de referencia");
  });

  test("el caso de la Hacienda Foral se ofrece en Bizkaia, se rotula y enseña los dos regímenes", async () => {
    await montar();
    await escribir("Edad actual", "65");
    await pulsar("Cargar el caso de la Hacienda Foral");
    expect(texto()).toContain("Caso práctico de EPSV que publica la Hacienda Foral de Bizkaia para 2026");
    expect(document.querySelector(".distintivo")?.textContent).toBe("Ejemplo");
    expect(titulosDelResultado()).toContain("Lo que queda del cobro en capital");
    expect(texto()).toContain("Régimen transitorio");
    expect(texto()).toContain("Régimen desde 2026");
    /* 70.000 de aportación al 70 %: 49.000 a la base general en el régimen de 2026. */
    expect(texto()).toContain(importeTitular(49000));
    /* El IRPF del mes no es todo el del año: el cobro de una vez se dice aparte, bajo la cifra, con su bruto, su impuesto y su neto. */
    expect(document.querySelector(".jubilacion-respuesta > .cmp-note")?.textContent).toMatch(/^Aparte, el cobro de la EPSV de una vez: 100\.000\s€ brutos, −[\d.]+\s€ de IRPF y [\d.]+\s€ netos, que se suman a\s+los ahorros\.$/);
  });

  test("con la jubilación en el futuro, la nota del cobro dice en qué euros va, porque la tabla va en otros (JUB-7)", async () => {
    await montar();
    await escribir("Edad actual", "65");
    await pulsar("Cargar el caso de la Hacienda Foral");
    /* El caso se jubila hoy; se adelanta la edad actual a los 60 para que el cobro quede en el futuro. */
    await escribir("Edad actual", "60");
    await pulsar("Aún no");
    await escribir("Edad de jubilación", "65");
    /* Con el caso cargado a los 60, el cobro es dentro de unos años: arriba en euros de hoy, en la tabla en los del año del cobro. */
    const nota = document.querySelector(".jubilacion-respuesta > .cmp-note")?.textContent ?? "";
    expect(nota).toMatch(/^Aparte, el cobro de la EPSV de una vez: /);
    expect(nota).toContain("Van en euros de hoy; en la tabla del cobro en capital, en euros del año del cobro.");
    expect(nota).not.toContain("100.000 € brutos");
  });

  test("los saldos de la propuesta en curso llegan a su casilla, sin coste y diciendo lo que no se ha traído", async () => {
    fuente.getComparableAssets.mockResolvedValue([
      { asset_id: "F1", instrument_type: "FUND" },
      { asset_id: "S1", instrument_type: "STOCK" }
    ]);
    await montar({
      portfolioName: "Cartera de prueba",
      totalCapital: 200000,
      positions: [
        { asset_id: "F1", weight_percent: 60, label: "Un fondo" },
        { asset_id: "S1", weight_percent: 25, label: "Una acción" },
        { asset_id: "X9", weight_percent: 5, label: "Desconocido" }
      ]
    });
    await pulsar("Tomar de la propuesta en curso");
    expect(fuente.getComparableAssets).toHaveBeenCalledWith(["F1", "S1", "X9"]);
    expect(importe("Fondos de inversión: valor de hoy")().value).toBe("120.000");
    expect(importe("Acciones y ETF: valor de hoy")().value).toBe("50.000");
    expect(importe("Lo aportado a los fondos de inversión")().value).toBe("");
    const aviso = texto();
    expect(aviso).toContain("De «Cartera de prueba»");
    /* El porcentaje lleva el espacio duro del módulo de formato: «5\u00a0%» (antes, un espacio normal). */
    expect(aviso).toContain("El 5\u00a0% de la cartera no se ha podido clasificar y no se ha traído.");
    expect(aviso).toContain("Sus pesos suman 90\u00a0%: el resto del capital no se reparte.");
    expect(aviso).toContain("El coste de adquisición no viene con la propuesta: hay que escribirlo.");
    /* Sin capital fijado no hay saldos que traer, y el botón lo dice. */
    await act(async () => root.unmount());
    document.body.innerHTML = "";
    const contenedor = document.createElement("div");
    document.body.appendChild(contenedor);
    root = createRoot(contenedor);
    await montar({ portfolioName: "Sin capital", positions: [{ asset_id: "F1", weight_percent: 100, label: "Un fondo" }] });
    expect(boton("Tomar de la propuesta en curso").disabled).toBe(true);
  });

  test("junto a la edad del plan se dice cuántos llegan a ella, con su fuente, y el sexo solo cambia la tabla", async () => {
    await montar();
    /* Sin datos no hay edad de la que hablar. */
    expect(texto()).not.toContain("llegan a cumplir");
    await pulsar("Cargar un ejemplo");
    /* INE 2024, ambos sexos: 16.070 de 91.851 supervivientes a los 65 llegan a los 95. */
    expect(texto()).toContain("De cada 100 personas de 65 años, 17 llegan a cumplir los 95.");
    expect(texto()).toContain("A esa edad este plan ya ha gastado los ahorros.");
    expect(texto()).toContain("INE, tablas de mortalidad de 2024 · consultadas el 13-11-2026");
    expect(texto()).toContain("no es una previsión ni un dato del cliente");
    const netoAntes = neto();
    await escribir("Sexo", "mujer");
    /* Mujeres: 21.324 de 94.384. Y las cifras del plan no se mueven. */
    expect(texto()).toContain("De cada 100 mujeres de 65 años, 23 llegan a cumplir los 95.");
    expect(neto()).toBe(netoAntes);
    await escribir("Sexo", "hombre");
    expect(texto()).toContain("De cada 100 hombres de 65 años, 12 llegan a cumplir los 95.");
    await escribir("Sexo", "");
    expect(texto()).toContain("De cada 100 personas de 65 años, 17 llegan a cumplir los 95.");
    await escribir("Planificar hasta los", "104");
    expect(texto()).toContain("La tabla de mortalidad acaba a los 100 años: no dice cuántas personas llegan a cumplir los 104.");
  });

  test("el informe se pide con las cifras y las unidades de la pantalla, y sabiendo si es un ejemplo", async () => {
    papel.downloadJubilacionPdf.mockResolvedValue(undefined);
    await montar();
    await pulsar("Cargar un ejemplo");
    await pulsar("Euros de cada año");
    await pulsar("Informe para el cliente");
    const dialogo = document.querySelector(".ui-dialog")!;
    expect(dialogo.textContent).toContain("Informe de jubilación para el cliente");
    expect(dialogo.textContent).toContain("euros de cada año");
    expect(dialogo.textContent).toContain("Los datos son de un ejemplo");
    await act(async () => {
      const cliente = dialogo.querySelector<HTMLInputElement>('input[placeholder="Vacío, sin nombre de cliente"]')!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(cliente, "Cliente de prueba");
      cliente.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => [...dialogo.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === "Descargar el informe")!.click());
    expect(papel.downloadJubilacionPdf).toHaveBeenCalledTimes(1);
    const pedido = papel.downloadJubilacionPdf.mock.calls[0][0];
    expect(pedido).toMatchObject({ unidades: "nominal", ejemplo: true, clientName: "Cliente de prueba", formas: null, supuestos: [] });
    expect(pedido.resultado.resumen.netoMensual).toBeCloseTo(2575.58228, 4);
    /* Y con la misma lectura de la tabla de mortalidad que tiene delante el asesor. */
    expect(pedido.supervivencia.frase).toBe("De cada 100 personas de 65 años, 17 llegan a cumplir los 95.");
    /* Descargado, el diálogo se cierra, y el nombre del cliente muere con él. */
    expect(document.querySelector(".ui-dialog")).toBeNull();
    await pulsar("Informe para el cliente");
    expect(document.querySelector<HTMLInputElement>('.ui-dialog input[placeholder="Vacío, sin nombre de cliente"]')!.value).toBe("");
  });

  test("un IRPF de cero se escribe «0 €», sin signo, en la respuesta y en las cuentas (PLA-03)", async () => {
    await montar();
    await escribir("Edad actual", "66");
    /* 600 × 14 = 8.400 al año: no llega a pagar impuesto. */
    await confirmarImporte(() => campo("Pensión pública bruta, por paga") as HTMLInputElement, "600");
    expect(linea("IRPF · 0,0\u00a0% del bruto")).toBe(importeTitular(0));
    expect(texto()).not.toMatch(/[−-]0\s€/);
  });

  test("vaciar un importe lo devuelve a «sin escribir», y el cálculo lo trata como tal (PLA-04)", async () => {
    await montar();
    await escribir("Edad actual", "65");
    await confirmarImporte(importe("Fondos de inversión: valor de hoy"), "100.000");
    await confirmarImporte(importe("Lo aportado a los fondos de inversión"), "60.000");
    expect(texto()).not.toContain("Falta el coste de adquisición");
    /* Borrar el coste no es escribir un cero: vuelve el supuesto del coste igual al valor, y se dice. */
    await confirmarImporte(importe("Lo aportado a los fondos de inversión"), "");
    expect(importe("Lo aportado a los fondos de inversión")().value).toBe("");
    expect(texto()).toContain("Falta el coste de adquisición de los fondos de inversión: se calcula con el coste igual al valor de hoy.");
    /* La pensión, igual: vaciada, falta. */
    await confirmarImporte(() => campo("Pensión pública bruta, por paga") as HTMLInputElement, "1.800");
    await confirmarImporte(() => campo("Pensión pública bruta, por paga") as HTMLInputElement, "");
    expect((campo("Pensión pública bruta, por paga") as HTMLInputElement).value).toBe("");
  });

  test("«Tomar de la propuesta en curso» pregunta antes de sustituir lo escrito, y si no hay nada escrito no pregunta (PLA-05)", async () => {
    fuente.getComparableAssets.mockResolvedValue([{ asset_id: "F1", instrument_type: "FUND" }]);
    await montar({ portfolioName: "Cartera de prueba", totalCapital: 200000, positions: [{ asset_id: "F1", weight_percent: 50, label: "Un fondo" }] });
    await confirmarImporte(importe("Fondos de inversión: valor de hoy"), "80.000");
    await confirmarImporte(importe("Lo aportado a los fondos de inversión"), "50.000");
    await pulsar("Tomar de la propuesta en curso");
    const dialogo = document.querySelector(".ui-dialog");
    expect(dialogo?.textContent).toContain("¿Sustituir lo escrito por los saldos de la propuesta?");
    expect(dialogo?.textContent).toContain("fondos de inversión");
    expect(dialogo?.textContent).toContain("coste de adquisición");
    /* Cancelar no toca nada ni pide nada a la base. */
    await act(async () => [...dialogo!.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === "Cancelar")!.click());
    expect(fuente.getComparableAssets).not.toHaveBeenCalled();
    expect(importe("Fondos de inversión: valor de hoy")().value).toBe("80.000");
    expect(importe("Lo aportado a los fondos de inversión")().value).toBe("50.000");
    /* Confirmar sustituye: el 50 % de 200.000. */
    await pulsar("Tomar de la propuesta en curso");
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>(".ui-dialog button")].find((b) => b.textContent?.trim() === "Sustituir")!.click());
    expect(importe("Fondos de inversión: valor de hoy")().value).toBe("100.000");
    expect(importe("Lo aportado a los fondos de inversión")().value).toBe("");
  });

  test("las rentabilidades aceptan coma decimal, y lo que no vale se dice junto al campo (PLA-06)", async () => {
    await montar();
    await pulsar("Cargar un ejemplo");
    await escribir("Rentabilidad anual, en %", "2,5");
    expect(texto()).toContain("Con la hipótesis, un 2,5\u00a0% al año");
    await escribir("Inflación (IPC) anual, en %", "1,5");
    expect(texto()).toContain("con un IPC del 1,5\u00a0%");
    /* Una cifra que no se lee no vuelve en silencio a la anterior: lo dice, y dice con qué se sigue calculando. */
    await escribir("Rentabilidad anual, en %", "dos");
    expect(errorDe("Rentabilidad anual, en %")).toBe("Cifra no válida: escríbela con números, por ejemplo 2,5. Se sigue calculando con 2,5.");
    expect(campo("Rentabilidad anual, en %").getAttribute("aria-invalid")).toBe("true");
    await act(async () => campo("Rentabilidad anual, en %").blur());
    expect((campo("Rentabilidad anual, en %") as HTMLInputElement).value).toBe("dos");
    expect(texto()).toContain("Con la hipótesis, un 2,5\u00a0% al año");
    /* Una edad es un número entero: con decimales no se redondea en silencio. */
    await escribir("Edad actual", "65,5");
    expect(errorDe("Edad actual")).toBe("Escribe un número entero, sin decimales. Se sigue calculando con 65.");
  });

  test("la edad de jubilación de un cliente de más de 75 años avisa con los límites con que calcula el motor (PLA-14)", async () => {
    await montar();
    await pulsar("Cargar un ejemplo");
    await escribir("Edad actual", "80");
    await pulsar("Aún no");
    /* El motor acota la jubilación entre la edad de hoy y max(edad, 75): con 80 años, a los 80. */
    await escribir("Edad de jubilación", "75");
    expect(errorDe("Edad de jubilación")).toBe("Entre 80 y 80: se calcula con 80.");
  });

  test("la cifra principal se anuncia al cambiar, y el informe dice por qué no se puede pedir (PLA-20, PLA-24)", async () => {
    await montar();
    expect(boton("Informe para el cliente").title).toBe("Faltan datos del cliente: sin un resultado no hay informe que pedir.");
    await pulsar("Cargar un ejemplo");
    expect(boton("Informe para el cliente").title).toBe("");
    expect(document.querySelector(".jubilacion-respuesta__cifra")?.getAttribute("aria-live")).toBe("polite");
    expect(document.querySelector(".jubilacion-respuesta__momento")?.getAttribute("role")).toBeNull();
  });

  test("lo escrito sobrevive a salir de la pantalla y volver, y no a la sesión", async () => {
    await montar();
    await escribir("Edad actual", "70");
    await confirmarImporte(() => campo("Pensión pública bruta, por paga") as HTMLInputElement, "2.000");
    const antes = neto();
    await act(async () => root.unmount());
    document.body.innerHTML = "";
    const contenedor = document.createElement("div");
    document.body.appendChild(contenedor);
    root = createRoot(contenedor);
    await montar();
    expect(neto()).toBe(antes);
    expect(window.localStorage.length + window.sessionStorage.length, "Nada del cliente va al almacenamiento del navegador").toBe(0);
    await act(async () => root.unmount());
    clearSessionCaches();
    document.body.innerHTML = "";
    const otro = document.createElement("div");
    document.body.appendChild(otro);
    root = createRoot(otro);
    await montar();
    expect(document.querySelector(".jubilacion-respuesta")).toBeNull();
  });
});

describe("Jubilación, rediseñada (14-11-2026)", () => {
  test("la cabecera lleva su contexto, una acción principal y dos secundarias que dicen por qué no se pueden usar", async () => {
    await montar();
    expect(document.querySelector(".ui-page-header .ui-eyebrow")?.textContent).toBe("Planificación");
    const acciones = [...document.querySelectorAll<HTMLButtonElement>(".ui-page-header button")].map((b) => b.textContent?.trim());
    expect(acciones).toEqual(["Cargar un ejemplo", "Vaciar", "Informe para el cliente"]);
    expect(boton("Vaciar").disabled).toBe(true);
    expect(boton("Vaciar").title).toBe("No hay nada escrito que vaciar.");
    expect(boton("Cargar un ejemplo").disabled).toBe(false);
    await pulsar("Cargar un ejemplo");
    /* Con datos escritos, cargar el ejemplo no los pisa en silencio: hay que vaciar antes, como hasta ahora. */
    expect(boton("Cargar un ejemplo").disabled).toBe(true);
    expect(boton("Cargar un ejemplo").title).toBe("Hay datos escritos: vacía la simulación para cargar un ejemplo.");
    expect(boton("Vaciar").disabled).toBe(false);
    expect(document.querySelector(".ui-page-header .distintivo")?.textContent).toBe("Ejemplo");
  });

  test("la respuesta es una sola cifra, junto a la frase que dice que es una simulación", async () => {
    await montar();
    await pulsar("Cargar un ejemplo");
    const respuesta = document.querySelector(".jubilacion-respuesta");
    expect(respuesta?.querySelectorAll(".jubilacion-respuesta__valor")).toHaveLength(1);
    expect(respuesta?.querySelector(".jubilacion-respuesta__momento")?.textContent).toMatch(/^Simulación · /);
    /* El selector de unidades va junto a la cifra, y gobierna todo lo que se enseña en esas unidades. */
    expect(respuesta?.querySelector('[role="group"][aria-label="Unidades de los importes"]')).not.toBeNull();
  });

  test("el método y las fuentes empiezan plegados, y se abren con su título", async () => {
    await montar();
    await pulsar("Cargar un ejemplo");
    const plegador = [...document.querySelectorAll<HTMLButtonElement>("button.panel__plegador")].find((b) => b.textContent === "El método y las fuentes");
    expect(plegador?.getAttribute("aria-expanded")).toBe("false");
    const cuerpo = document.getElementById(plegador!.getAttribute("aria-controls")!);
    expect(cuerpo?.hidden).toBe(true);
    /* Plegado, sigue en la página: no se quita nada de las cuentas. */
    expect(cuerpo?.textContent).toContain("Normativa aplicada");
    await act(async () => plegador!.click());
    expect(plegador?.getAttribute("aria-expanded")).toBe("true");
    expect(cuerpo?.hidden).toBe(false);
    /* Las cuentas que sí van a la vista no se pliegan. */
    expect(document.querySelectorAll("button.panel__plegador")).toHaveLength(1);
  });

  test("«Tomar de la propuesta en curso» está a la vista en el bloque de ahorros, con la propuesta que toma", async () => {
    await montar({ portfolioName: "Cartera de prueba", totalCapital: 200000, positions: [{ asset_id: "F1", weight_percent: 100, label: "Un fondo" }] });
    const atajo = document.querySelector(".jubilacion-atajo");
    expect(atajo?.closest(".panel__body")).not.toBeNull();
    expect(atajo?.querySelector("button")?.textContent?.trim()).toBe("Tomar de la propuesta en curso");
    expect(atajo?.textContent).toContain("«Cartera de prueba» · 1 posición");
    /* Sin propuesta en curso, no se ofrece. */
    await act(async () => root.unmount());
    const contenedor = document.createElement("div");
    document.body.appendChild(contenedor);
    root = createRoot(contenedor);
    await montar();
    expect(document.querySelector(".jubilacion-atajo")).toBeNull();
  });

  test("los campos numéricos se leen a la derecha y cada uno lleva su rótulo enlazado (MAR-10)", async () => {
    await montar();
    expect(campo("Edad actual").classList.contains("jubilacion-numero")).toBe(true);
    expect(campo("Pensión pública bruta, por paga").classList.contains("jubilacion-importe")).toBe(true);
    /* La pista va enlazada a su control. */
    const sexo = campo("Sexo");
    const pista = document.getElementById(sexo.getAttribute("aria-describedby") ?? "");
    expect(pista?.textContent).toContain("Solo elige la tabla de mortalidad");
  });

  test("el diálogo del informe dice quién firma y deja cambiarlo; sin nombre, lo avisa", async () => {
    await montar();
    await pulsar("Cargar un ejemplo");
    await pulsar("Informe para el cliente");
    const dialogo = () => document.querySelector(".ui-dialog")!;
    /* Ya no se escribe aquí quién lo elabora: es la firma de todos los informes. */
    expect(dialogo().textContent).not.toContain("Elaborado por");
    expect(dialogo().querySelector(".jubilacion-firma")?.textContent).toContain("Firma de los informes");
    expect(dialogo().querySelector(".jubilacion-firma__linea")?.textContent).toBe("Sin datos del asesor");
    expect(dialogo().querySelector(".aviso")?.textContent).toContain("Falta tu nombre.");
    await act(async () => dialogo().querySelector<HTMLButtonElement>('button[aria-label="Cambiar la firma de los informes"]')!.click());
    const dialogos = [...document.querySelectorAll(".ui-dialog")];
    expect(dialogos).toHaveLength(2);
    expect(dialogos[1].textContent).toContain("Tus datos en los informes");
  });

  test("con la firma escrita, se lee en una línea y va al informe", async () => {
    guardarIdentidad({ nombre: "Asesora de prueba", entidad: "Despacho de prueba", contacto: "asesora@ejemplo.test" });
    papel.downloadJubilacionPdf.mockResolvedValue(undefined);
    await montar();
    await pulsar("Cargar un ejemplo");
    await pulsar("Informe para el cliente");
    const dialogo = document.querySelector(".ui-dialog")!;
    expect(dialogo.querySelector(".jubilacion-firma__linea")?.textContent).toBe("Asesora de prueba · Despacho de prueba · asesora@ejemplo.test");
    expect(dialogo.querySelector(".aviso")).toBeNull();
    await act(async () => [...dialogo.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === "Descargar el informe")!.click());
    expect(papel.downloadJubilacionPdf.mock.calls[0][0].banker).toEqual({ name: "Asesora de prueba", email: "asesora@ejemplo.test" });
  });
});
