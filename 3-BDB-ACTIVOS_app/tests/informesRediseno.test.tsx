// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

/**
 * Informes rediseñado (14-11-2026): «¿qué documentos puedo entregar de esta propuesta, y qué les falta?». Arriba, los datos de los
 * documentos y la firma de los informes (la identidad del asesor, con «Cambiar»); debajo, una lista con un documento por fila: su
 * nombre, para quién es, qué contiene, qué le falta y su botón —«Preparar» si abre un diálogo, «Descargar» si descarga sin él—.
 */
import { buildManualPortfolioReport, getComparableAssets } from "../src/adapters/bdbAssetsAdapter";
import { ClientModeProvider } from "../src/app/ClientModeContext";
import { CostsModal } from "../src/components/CostsModal";
import { DialogoDelInformeDeCliente } from "../src/components/DialogoDelInformeDeCliente";
import { PortfolioReport } from "../src/components/PortfolioReport";
import { guardarIdentidad } from "../src/core/identidadDelAsesor";
import { checkPortfolioFeasibility } from "../src/core/portfolioConstraints";
import { clearSessionCaches } from "../src/core/sessionCaches";
import { costAssets, costPositions } from "./support/portfolioCostFixtures";
import { saltosDeNivel } from "./support/saltosDeNivel";

const POSICIONES = [
  { asset_id: "MOCK-FUND-MIXED", weight_percent: 60 },
  { asset_id: "MOCK-ETF-CASH", weight_percent: 40 }
];

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

async function montarInformes({ modoCliente = false, capital }: { modoCliente?: boolean; capital?: number } = {}) {
  const report = await buildManualPortfolioReport(POSICIONES, "Familia García");
  const assets = await getComparableAssets(POSICIONES.map((p) => p.asset_id));
  const feasibility = checkPortfolioFeasibility({ positions: POSICIONES, assets });
  await act(async () => {
    root.render(
      createElement(ClientModeProvider, {
        initialValue: modoCliente,
        children: createElement(PortfolioReport, { report, originalPositions: POSICIONES, assets, feasibility, totalCapital: capital, portfolioName: "Familia García" })
      })
    );
  });
}

const plano = (texto: string | null | undefined) => (texto ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
const filas = () => [...host.querySelectorAll(".informes-lista__documento")];
const nombreDe = (fila: Element) => fila.querySelector(".informes-lista__nombre")?.childNodes[0]?.textContent?.trim();
const dialogo = () => document.querySelector('[role="dialog"]') as HTMLElement | null;
const pulsar = (boton: Element | null | undefined) =>
  act(async () => {
    (boton as HTMLButtonElement).click();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

beforeEach(() => {
  sessionStorage.clear();
  clearSessionCaches();
  guardarIdentidad({});
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  guardarIdentidad({});
  clearSessionCaches();
});

describe("la lista de documentos", () => {
  test("primero los del cliente y después los internos, cada uno con su distintivo", async () => {
    await montarInformes();
    expect(filas().map(nombreDe)).toEqual([
      "Informe para el cliente",
      "Informe de costes",
      "Comparativa de propuestas",
      "Propuesta de cambio",
      "Informe interno del asesor",
      "Propuesta de mejora"
    ]);
    const distintivos = filas().map((fila) => fila.querySelector(".distintivo")?.className);
    expect(distintivos.slice(0, 4).every((clase) => clase?.includes("distintivo--marca"))).toBe(true);
    expect(distintivos.slice(4).every((clase) => clase?.includes("distintivo--interno"))).toBe(true);
    expect(filas().slice(0, 4).every((fila) => fila.textContent?.includes("Para el cliente"))).toBe(true);
  });

  test("en Modo cliente, los internos no existen", async () => {
    await montarInformes({ modoCliente: true });
    expect(filas().map(nombreDe)).toEqual(["Informe para el cliente", "Informe de costes", "Comparativa de propuestas", "Propuesta de cambio"]);
    expect(host.querySelector(".distintivo--interno")).toBeNull();
  });

  test("«Preparar» si abre un diálogo y «Descargar» si descarga sin él; cada botón dice de qué documento es", async () => {
    await montarInformes();
    const botones = filas().map((fila) => fila.querySelector(".informes-lista__boton button") as HTMLButtonElement);
    expect(botones.map((boton) => boton.textContent)).toEqual(["Preparar", "Preparar", "Preparar", "Preparar", "Preparar", "Descargar"]);
    expect(botones.map((boton) => boton.getAttribute("aria-label"))).toEqual([
      "Preparar: Informe para el cliente",
      "Preparar: Informe de costes",
      "Preparar: Comparativa de propuestas",
      "Preparar: Propuesta de cambio",
      "Preparar: Informe interno del asesor",
      "Descargar: Propuesta de mejora"
    ]);
    /* Nunca dos «Descargar…» seguidos: el de la lista prepara, el del diálogo descarga. */
    await pulsar(botones[0]);
    const enElDialogo = [...dialogo()!.querySelectorAll("button")].map((boton) => boton.textContent);
    expect(enElDialogo).toContain("Descargar el informe");
  });

  test("lo que le falta a un documento, como aviso dentro de su fila", async () => {
    await montarInformes();
    const delCliente = filas()[0];
    expect(plano(delCliente.querySelector(".aviso")?.textContent)).toContain("Capital sin fijar: el informe saldrá sin importes.");
    const comparativa = filas()[2];
    expect(plano(comparativa.querySelector(".aviso")?.textContent)).toContain("Con los datos de muestra no hay histórico que comparar.");
  });

  /* MAR-32: `h1` la pantalla, `h2` cada bloque, y cada documento de la lista, `h3` dentro del suyo. */
  test("ningún nivel de encabezado se salta: la pantalla y el diálogo del informe para el cliente", async () => {
    await montarInformes();
    expect(host.querySelector("h1")?.textContent).toBe("Informes");
    expect([...host.querySelectorAll("h3.informes-lista__nombre")]).toHaveLength(6);
    expect(saltosDeNivel(host)).toEqual([]);
    await pulsar(filas()[0].querySelector(".informes-lista__boton button"));
    expect(dialogo()?.querySelector("h2")?.textContent).toBe("Informe para el cliente");
    expect(saltosDeNivel(dialogo()!)).toEqual([]);
  });
});

describe("la firma de los informes", () => {
  test("sin nombre del asesor, un aviso dice que los informes saldrán sin firma", async () => {
    await montarInformes();
    const firma = host.querySelector(".informes-firma")!;
    expect(plano(firma.textContent)).toContain("Firma de los informes");
    expect(plano(firma.querySelector(".aviso")?.textContent)).toBe("Los informes saldrán sin firma: escribe tus datos.");
  });

  test("con datos, los enseña en una línea —nombre, entidad, contacto y si hay logotipo— y sin aviso", async () => {
    guardarIdentidad({ nombre: "Marta Ruiz", entidad: "Ruiz & Asociados", contacto: "600 000 000", logotipo: "data:image/png;base64,iVBORw==" });
    await montarInformes();
    const firma = host.querySelector(".informes-firma")!;
    expect(plano(firma.querySelector(".informes-firma__valor")?.textContent)).toBe("Marta Ruiz · Ruiz & Asociados · 600 000 000 · con logotipo");
    expect(firma.querySelector(".aviso")).toBeNull();
    /* Ni «Elaborado por» ni el correo se piden ya en la página. */
    expect(host.querySelector('input[type="email"]')).toBeNull();
  });

  test("«Cambiar» abre «Tus datos en los informes», y lo guardado sale en la línea", async () => {
    await montarInformes();
    await pulsar(host.querySelector('button[aria-label="Cambiar la firma de los informes"]'));
    expect(dialogo()?.textContent).toContain("Tus datos en los informes");
    const nombre = [...dialogo()!.querySelectorAll("label")].find((label) => label.textContent === "Nombre")!.control as HTMLInputElement;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(nombre, "Marta Ruiz");
      nombre.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await pulsar([...dialogo()!.querySelectorAll("button")].find((boton) => boton.textContent === "Guardar"));
    /* Sin cuenta en la prueba, se guarda en memoria y el diálogo lo dice antes de cerrarse; la línea ya lo enseña. */
    expect(plano(host.querySelector(".informes-firma__valor")?.textContent)).toBe("Marta Ruiz");
    expect(host.querySelector(".informes-firma .aviso")).toBeNull();
    const cerrar = [...(dialogo()?.querySelectorAll("button") ?? [])].find((boton) => boton.textContent === "Cerrar");
    if (cerrar) await pulsar(cerrar);
    expect(dialogo()).toBeNull();
  });
});

describe("el diálogo único del informe para el cliente", () => {
  const props = {
    nombre: "Familia García",
    pedirNombre: false,
    alCambiarNombre: () => undefined,
    cliente: "",
    alCambiarCliente: () => undefined,
    error: null,
    alDescargar: () => undefined
  };

  test("«Cambiar» la firma abre sus datos en lugar del diálogo, y al cerrar vuelve a él", async () => {
    await act(async () => root.render(createElement(DialogoDelInformeDeCliente, { ...props, ocupado: false, alCerrar: () => undefined })));
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    await pulsar(dialogo()!.querySelector('button[aria-label="Cambiar la firma de los informes"]'));
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    expect(dialogo()?.textContent).toContain("Tus datos en los informes");
    await pulsar([...dialogo()!.querySelectorAll("button")].find((boton) => boton.textContent === "Cancelar"));
    expect(dialogo()?.querySelector("h2")?.textContent).toBe("Informe para el cliente");
  });

  test("mientras genera no se cierra ni con Escape, ni deja cambiar la firma", async () => {
    const alCerrar = vi.fn();
    await act(async () => root.render(createElement(DialogoDelInformeDeCliente, { ...props, ocupado: true, alCerrar })));
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(alCerrar).not.toHaveBeenCalled();
    expect(dialogo()?.querySelector('[aria-label="Cerrar"]')).toBeNull();
    expect((dialogo()!.querySelector('button[aria-label="Cambiar la firma de los informes"]') as HTMLButtonElement).disabled).toBe(true);
  });

  test("el nombre de la propuesta solo se pide si no lo tiene, con su rótulo y su pista enlazados", async () => {
    await act(async () => root.render(createElement(DialogoDelInformeDeCliente, { ...props, nombre: "", pedirNombre: true, ocupado: false, alCerrar: () => undefined })));
    const etiqueta = [...dialogo()!.querySelectorAll("label")].find((label) => label.textContent === "Nombre de la propuesta")!;
    const campo = etiqueta.control as HTMLInputElement;
    expect(campo).not.toBeNull();
    expect(campo.placeholder).toBe("");
    const pista = document.getElementById(campo.getAttribute("aria-describedby")!.split(" ")[0]);
    expect(pista?.textContent).toContain("La propuesta no tiene nombre");
  });
});

describe("los costes de la propuesta", () => {
  const abrir = () =>
    act(async () => root.render(createElement(CostsModal, { positions: costPositions, assets: costAssets, totalCapital: 100000, onClose: () => undefined })));
  const casilla = () => document.querySelector('.costs-management-section input[type="checkbox"]') as HTMLInputElement;

  test("el diálogo se llama «Costes de la propuesta» y la pestaña de retrocesiones lleva «Interno»", async () => {
    await abrir();
    expect(dialogo()?.querySelector("h2")?.textContent).toBe("Costes de la propuesta");
    await act(async () => ([...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((tab) => tab.textContent === "Retrocesiones") as HTMLButtonElement).click());
    expect(document.querySelector("#costs-panel-retro .distintivo--interno")?.textContent).toBe("Interno");
  });

  test("recuerda durante la sesión la comisión de gestión y el supuesto de rentabilidad al cerrarse", async () => {
    await abrir();
    await act(async () => casilla().click());
    await act(async () => {
      const comision = document.querySelector(".costs-management-controls input") as HTMLInputElement;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(comision, "0.5");
      comision.dispatchEvent(new Event("input", { bubbles: true }));
      const supuesto = [...document.querySelectorAll("label")].find((label) => label.textContent?.startsWith("Rentabilidad supuesta"))!.control as HTMLInputElement;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(supuesto, "7");
      supuesto.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => root.render(createElement("div")));
    await abrir();
    expect(casilla().checked).toBe(true);
    expect((document.querySelector(".costs-management-controls input") as HTMLInputElement).value).toBe("0.5");
    const supuesto = [...document.querySelectorAll("label")].find((label) => label.textContent?.startsWith("Rentabilidad supuesta"))!.control as HTMLInputElement;
    expect(supuesto.value).toBe("7");
    /* Otra sesión, otra cuenta: se olvida. */
    await act(async () => root.render(createElement("div")));
    clearSessionCaches();
    await abrir();
    expect(casilla().checked).toBe(false);
  });
});

/* MAR-10: cada control de «Datos de los documentos» lleva su rótulo enlazado (`<label for>`), también el capital, que se lee
   en un `output`; y los grupos de botones se nombran. */
describe("los campos de Informes, con su rótulo enlazado (MAR-10)", () => {
  const rotuloDe = (control: Element) => {
    const id = control.getAttribute("id");
    const porId = id ? host.querySelector(`label[for="${id}"]`) : null;
    return plano((porId ?? control.closest("label"))?.textContent);
  };

  test.each([
    ["con el capital fijado", 250000],
    ["sin capital", undefined]
  ])("%s, todo control tiene su rótulo", async (_caso, capital) => {
    await montarInformes({ capital });
    const controles = [...host.querySelectorAll("input, select, textarea, output")];
    expect(controles.length).toBeGreaterThanOrEqual(4);
    for (const control of controles) expect(rotuloDe(control)).not.toBe("");
    const capitalDe = host.querySelector("output")!;
    expect(rotuloDe(capitalDe)).toBe("Capital");
    expect(plano(capitalDe.textContent)).toBe(capital ? "250.000,00 €" : "Sin fijar");
    const nombreDelGrupo = (grupo: Element) =>
      grupo.getAttribute("aria-label") ?? plano(document.getElementById(grupo.getAttribute("aria-labelledby") ?? "")?.textContent);
    expect([...host.querySelectorAll('.informes-datos [role="group"], .informes-firma[role="group"]')].map(nombreDelGrupo)).toEqual(["Periodo", "Firma de los informes"]);
    /* El único campo sin `<label>` es el periodo: un grupo de botones no se puede nombrar con `<label for>`, y su nombre
       accesible es la misma palabra que se ve encima. */
    const sinLabel = [...host.querySelectorAll(".informes-datos > div.field:not(:has(label))")];
    expect(sinLabel.map((campo) => [plano(campo.querySelector(".field__label")?.textContent), campo.querySelector('[role="group"]')?.getAttribute("aria-label")])).toEqual([
      ["Periodo", "Periodo"]
    ]);
  });
});

/* FMT-12: para bajar un fichero, «Descargar»; ni «Exportar» ni «Generar». Y el informe interno se llama igual en la lista y en
   su diálogo. */
describe("el verbo y el nombre de los documentos (FMT-12)", () => {
  test("ningún botón dice «Exportar» ni «Generar», y el interno es «Informe interno del asesor» en la lista y en el diálogo", async () => {
    await montarInformes();
    const textos = () => [...document.querySelectorAll("button")].map((boton) => `${boton.textContent ?? ""} ${boton.getAttribute("aria-label") ?? ""}`);
    expect(textos().some((texto) => /export|gener/i.test(texto))).toBe(false);
    const interno = filas().find((fila) => nombreDe(fila) === "Informe interno del asesor")!;
    await pulsar(interno.querySelector(".informes-lista__boton button"));
    expect(dialogo()?.querySelector("#report-internal-title")?.textContent).toBe("Informe interno del asesor");
    expect(textos().some((texto) => /export|gener/i.test(texto))).toBe(false);
    expect([...dialogo()!.querySelectorAll("button")].map((boton) => boton.textContent)).toContain("Descargar el informe");
  });
});
