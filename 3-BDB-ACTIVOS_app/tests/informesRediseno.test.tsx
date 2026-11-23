// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

/**
 * Informes rediseñado (14-11-2026): «¿qué documentos puedo entregar de esta propuesta, y qué les falta?». Arriba, los datos de los
 * documentos y la firma de los informes (la identidad del asesor, con «Cambiar»); debajo, los documentos, uno por fila: su nombre,
 * qué contiene, qué le falta y su botón. Desde el 21-11-2026 (I1 · I2 · I3, aprobadas por Óscar): cada fila dice si está lista, si le
 * falta algo o si está bloqueada, con la acción que lo arregla; van en dos grupos con título, «Para el cliente» e «Internos»; y las
 * seis dicen «Preparar».
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
  const grupos = () => [...host.querySelectorAll(".panel")].filter((panel) => panel.querySelector(".informes-lista"));
  const tituloDe = (panel: Element) => panel.querySelector("h2")?.textContent;
  const estadoDe = (fila: Element) => fila.querySelector(".informes-lista__nombre .distintivo");

  test("dos grupos con título, primero los del cliente y después los internos, con «Interno» en el grupo", async () => {
    await montarInformes();
    expect(grupos().map(tituloDe)).toEqual(["Para el cliente", "Internos"]);
    const [delCliente, internos] = grupos();
    expect([...delCliente.querySelectorAll(".informes-lista__documento")].map(nombreDe)).toEqual([
      "Informe de la propuesta",
      "Costes de la propuesta",
      "Comparativa de propuestas",
      "Propuesta de cambio"
    ]);
    expect([...internos.querySelectorAll(".informes-lista__documento")].map(nombreDe)).toEqual(["Informe interno del asesor", "Propuesta de mejora"]);
    /* Lo que solo ve el asesor lleva su marca, una vez, en el grupo; ninguna fila repite para quién es. */
    expect(internos.querySelector(".panel__head .distintivo--interno")?.textContent).toBe("Interno");
    expect(host.querySelectorAll(".informes-lista__documento .distintivo--interno")).toHaveLength(0);
    expect(filas().some((fila) => fila.textContent?.includes("Para el cliente"))).toBe(false);
  });

  test("cada documento dice si está listo, si le falta algo o si está bloqueado, y la palabra va con su tono", async () => {
    /* Sin capital y con los datos de muestra: al de cliente y al de costes les falta el capital, la comparativa y la propuesta de
       cambio no tienen histórico, el interno sale con lo que hay y la propuesta de mejora no se ha calculado. */
    await montarInformes();
    expect(filas().map((fila) => [nombreDe(fila), estadoDe(fila)?.textContent])).toEqual([
      ["Informe de la propuesta", "Falta algo"],
      ["Costes de la propuesta", "Falta algo"],
      ["Comparativa de propuestas", "Bloqueado"],
      ["Propuesta de cambio", "Bloqueado"],
      ["Informe interno del asesor", "Listo"],
      ["Propuesta de mejora", "Bloqueado"]
    ]);
    /* A-200 (21-11-2026): «Bloqueado» va en ocre, como «Falta algo»; el rojo queda para pérdidas y «en contra». */
    const tono = { "Listo": "distintivo--marca", "Falta algo": "distintivo--aviso", "Bloqueado": "distintivo--aviso" } as const;
    for (const fila of filas()) {
      const distintivo = estadoDe(fila)!;
      expect(distintivo.classList.contains(tono[distintivo.textContent as keyof typeof tono])).toBe(true);
    }
    /* Bloqueado es que su botón no se pulsa; lo demás se prepara. */
    for (const fila of filas()) {
      const boton = fila.querySelector(".informes-lista__boton button") as HTMLButtonElement;
      expect(boton.disabled).toBe(estadoDe(fila)?.textContent === "Bloqueado");
    }
    /* Con capital, el de cliente y el de costes están listos. */
    await act(async () => root.unmount());
    root = createRoot(host);
    await montarInformes({ capital: 250000 });
    expect(filas().slice(0, 2).map((fila) => estadoDe(fila)?.textContent)).toEqual(["Listo", "Listo"]);
    expect(filas()[0].querySelector(".aviso")).toBeNull();
    expect(host.querySelector(".informes-lista .distintivo--desfavorable")).toBeNull();
  });

  test("lo que solo se pide en el diálogo al preparar no es un dato que falte: «Listo», y la fila dice qué se pedirá (A-201)", async () => {
    const report = { ...(await buildManualPortfolioReport(POSICIONES, "Familia García")), mode: "BBDD_LIVE_API" as const };
    const assets = await getComparableAssets(POSICIONES.map((p) => p.asset_id));
    const feasibility = checkPortfolioFeasibility({ positions: POSICIONES, assets });
    const dos = [
      { portfolio_id: "a", sourceKind: "BBDD_LIVE_API" },
      { portfolio_id: "b", sourceKind: "BBDD_LIVE_API" }
    ] as never[];
    await act(async () => {
      root.render(
        createElement(ClientModeProvider, {
          initialValue: false,
          children: createElement(PortfolioReport, {
            report,
            originalPositions: POSICIONES,
            assets,
            feasibility,
            totalCapital: 250000,
            portfolioName: "Familia García",
            savedPortfolios: dos
          })
        })
      );
    });
    const fila = (nombre: string) => filas().find((f) => nombreDe(f) === nombre)!;
    for (const [nombre, pide] of [
      ["Comparativa de propuestas", "Al preparar, se eligen las dos carteras."],
      ["Propuesta de cambio", "Al preparar, se eligen Actual y Propuesta y se escribe el motivo."]
    ] as const) {
      expect(estadoDe(fila(nombre))?.textContent).toBe("Listo");
      expect(fila(nombre).querySelector(".aviso")).toBeNull();
      expect(plano(fila(nombre).textContent)).toContain(pide);
      expect((fila(nombre).querySelector(".informes-lista__boton button") as HTMLButtonElement).disabled).toBe(false);
    }
  });

  test("en Modo cliente, los internos no existen", async () => {
    await montarInformes({ modoCliente: true });
    expect(filas().map(nombreDe)).toEqual(["Informe de la propuesta", "Costes de la propuesta", "Comparativa de propuestas", "Propuesta de cambio"]);
    expect(grupos().map(tituloDe)).toEqual(["Para el cliente"]);
    expect(host.querySelector(".distintivo--interno")).toBeNull();
  });

  test("«Preparar» en las seis filas, también en la que descarga sin diálogo; cada botón dice de qué documento es", async () => {
    await montarInformes();
    const botones = filas().map((fila) => fila.querySelector(".informes-lista__boton button") as HTMLButtonElement);
    expect(botones.map((boton) => boton.textContent)).toEqual(["Preparar", "Preparar", "Preparar", "Preparar", "Preparar", "Preparar"]);
    expect(botones.map((boton) => boton.getAttribute("aria-label"))).toEqual([
      "Preparar: Informe de la propuesta",
      "Preparar: Costes de la propuesta",
      "Preparar: Comparativa de propuestas",
      "Preparar: Propuesta de cambio",
      "Preparar: Informe interno del asesor",
      "Preparar: Propuesta de mejora"
    ]);
    /* Nunca dos «Descargar…» seguidos: el de la lista prepara, el del diálogo descarga. */
    await pulsar(botones[0]);
    const enElDialogo = [...dialogo()!.querySelectorAll("button")].map((boton) => boton.textContent);
    expect(enElDialogo).toContain("Descargar el informe");
  });

  test("lo que se arregla fuera de Informes lleva su acción en el aviso, y en Modo cliente no", async () => {
    const montar = async (modoCliente: boolean) => {
      const report = await buildManualPortfolioReport(POSICIONES, "Familia García");
      const assets = await getComparableAssets(POSICIONES.map((p) => p.asset_id));
      const feasibility = checkPortfolioFeasibility({ positions: POSICIONES, assets });
      await act(async () => {
        root.render(
          createElement(ClientModeProvider, {
            initialValue: modoCliente,
            children: createElement(PortfolioReport, { report, originalPositions: POSICIONES, assets, feasibility, portfolioName: "Familia García", onIrADiseno: () => undefined })
          })
        );
      });
    };
    await montar(false);
    const accionDe = (fila: Element) => fila.querySelector(".aviso__accion button")?.textContent;
    expect(filas().map((fila) => [nombreDe(fila), accionDe(fila)])).toEqual([
      ["Informe de la propuesta", "Fijar en Diseño"],
      ["Costes de la propuesta", "Fijar en Diseño"],
      /* Con los datos de muestra no hay histórico: guardar otra cartera no lo arregla. */
      ["Comparativa de propuestas", undefined],
      ["Propuesta de cambio", undefined],
      ["Informe interno del asesor", undefined],
      ["Propuesta de mejora", "Ir a Optimizar"]
    ]);
    await act(async () => root.unmount());
    root = createRoot(host);
    await montar(true);
    expect(host.querySelectorAll(".aviso__accion")).toHaveLength(0);
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
    expect(dialogo()?.querySelector("h2")?.textContent).toBe("Informe de la propuesta");
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
    expect(dialogo()?.querySelector("h2")?.textContent).toBe("Informe de la propuesta");
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
