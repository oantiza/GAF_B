// @vitest-environment happy-dom

/**
 * Sistema › Retrocesiones: importar desde texto o Excel en tres pasos
 * (fichero → pasada en seco → aplicar). La pestaña solo se abre con el claim
 * admin, así que el recorrido se comprueba aquí montando el componente con la
 * base y la maestra de mentira.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { CommercialRetroRecord } from "../src/types/commercialRetro";
import { controlesSinNombre, enlacesRotos } from "./support/rotulosDeAdmin";

const EXISTING: CommercialRetroRecord[] = [
  { isin: "IE00B4L5Y983", retro_pct: 0.45, as_of_date: "2026-06-30", source: "ADMIN_UI" },
  { isin: "IE00B18GC888", retro_pct: 0.5, as_of_date: "2026-06-30", source: "ADMIN_UI" }
];
const MASTER = new Map([
  ["IE00B4L5Y983", "Fondo A Acc EUR"],
  ["IE00B18GC888", "Fondo B Acc EUR"],
  ["LU0404220724", "Fondo Nuevo Acc EUR"],
  ["LU0000000011", "Fondo Repetido"]
]);

const store = vi.hoisted(() => ({
  getCommercialRetroList: vi.fn(),
  getLastCommercialRetroImport: vi.fn(),
  applyCommercialRetroImport: vi.fn(),
  undoCommercialRetroImport: vi.fn(),
  saveCommercialRetro: vi.fn(),
  deleteCommercialRetro: vi.fn()
}));
vi.mock("../src/adapters/commercialRetroStore", () => store);
vi.mock("../src/firebaseEnv", () => ({ FIREBASE_CONFIGURED: true,
  PRODUCCION_SIN_CONFIGURAR: false,
  APUNTA_A_BDB: false }));
vi.mock("../src/adapters/assetDataSource", () => ({
  getAssetDataSource: () => ({
    getComparableAssets: async (ids: string[]) =>
      ids.filter((id) => MASTER.has(id)).map((id) => ({ asset_id: id, isin: id, display_name: MASTER.get(id) }))
  })
}));

import { AdminRetrocessions } from "../src/components/AdminRetrocessions";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TEXTO = [
  "nombre;isin;retro",
  "Fondo A Acc EUR;IE00B4L5Y983;0,0045",
  "Fondo B;IE00B18GC888;0,0055",
  "Fondo Nuevo;LU0404220724;0,0125",
  "Fuera de la maestra;LU0000000099;0,003",
  "Repetido uno;LU0000000011;0,005",
  "Repetido dos;LU0000000011;0,006"
].join("\n");

function button(container: HTMLElement, text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find((b) => (b.textContent || "").trim().startsWith(text));
  if (!found) throw new Error(`No aparece el botón «${text}»`);
  return found as HTMLButtonElement;
}

function click(element: HTMLElement) {
  return act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

/** Escribe en un control controlado por React: fija el valor por el setter del prototipo y avisa con `input`. */
function type(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string, eventName = "input") {
  return act(async () => {
    const proto = Object.getPrototypeOf(element) as object;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    setter?.call(element, value);
    element.dispatchEvent(new Event(eventName, { bubbles: true }));
  });
}

function text(container: HTMLElement): string {
  return (container.textContent || "").replace(/\s+/g, " ");
}

describe("Sistema · Retrocesiones · importación en tres pasos", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    store.getCommercialRetroList.mockReset().mockResolvedValue(EXISTING);
    store.getLastCommercialRetroImport.mockReset().mockResolvedValue(null);
    store.applyCommercialRetroImport.mockReset().mockResolvedValue({ import_id: "run-1", written: 3, deleted: 0, batches: 1 });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(createElement(AdminRetrocessions));
    });
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  test("busca por ISIN parcial, con espacios, y por palabras del nombre; limpiar recupera la tabla", async () => {
    const search = container.querySelector<HTMLInputElement>('input[type="search"]')!;
    await type(search, " ie00 b4l5y983 ");
    expect(container.querySelectorAll(".retro-table tbody tr")).toHaveLength(1);
    expect(text(container.querySelector(".retro-table") as HTMLElement)).toContain("IE00B4L5Y983");
    expect(text(container)).toContain("1 de 2 fondos");
    await type(search, "fondo B eur");
    expect(text(container.querySelector(".retro-table") as HTMLElement)).toContain("IE00B18GC888");
    expect(text(container.querySelector(".retro-table") as HTMLElement)).not.toContain("IE00B4L5Y983");
    await type(search, "no existe");
    expect(text(container)).toContain("No hay coincidencias entre las retrocesiones cargadas");
    await click(button(container, "Limpiar búsqueda"));
    expect(container.querySelectorAll(".retro-table tbody tr")).toHaveLength(2);
  });

  test("editar desde los resultados guarda únicamente el fondo seleccionado", async () => {
    store.saveCommercialRetro.mockReset().mockResolvedValue({ ...EXISTING[1], retro_pct: 0.75 });
    await type(container.querySelector<HTMLInputElement>('input[type="search"]')!, "18gc");
    const row = container.querySelector(".retro-table tbody tr") as HTMLElement;
    await type(row.querySelector<HTMLInputElement>('input[aria-label="Retrocesión de IE00B18GC888"]')!, "0,75");
    await click(button(row, "Guardar"));
    expect(store.saveCommercialRetro).toHaveBeenCalledTimes(1);
    expect(store.saveCommercialRetro).toHaveBeenCalledWith(expect.objectContaining({ isin: "IE00B18GC888", retro_pct: 0.75 }));
    await click(button(container, "Limpiar búsqueda"));
    /* Con coma, como el campo pide: es lo que se lee y lo que se vuelve a guardar. */
    expect(container.querySelector<HTMLInputElement>('input[aria-label="Retrocesión de IE00B4L5Y983"]')!.value).toBe("0,45");
    expect(text(container)).not.toContain("<code>");
  });

  test("lee el texto pegado, detecta las columnas y sugiere la escala de fracción", async () => {
    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    await type(textarea, TEXTO);
    await click(button(container, "Leer el texto pegado"));

    expect(text(container)).toContain("ISIN → B · Retrocesión → C · Nombre → A · cabecera en la fila 1");
    const scale = container.querySelector<HTMLSelectElement>(".retro-import-config select");
    expect(scale?.value).toBe("fraccion");
    expect(scale?.selectedOptions[0]?.textContent).toContain("sugerida");
    // El conflicto se anuncia antes de tocar la maestra, y no frena al resto.
    expect(text(container)).toContain("1 ISIN repetido(s) con valores distintos");
    expect(text(container)).toContain("LU0000000011");
  });

  test("la pasada en seco contrasta con la base y la maestra, y aplicar exige teclear el recuento", async () => {
    await type(container.querySelector("textarea") as HTMLTextAreaElement, TEXTO);
    await click(button(container, "Leer el texto pegado"));
    await click(button(container, "Pasada en seco"));

    const body = text(container);
    expect(body).toContain("Pasada en seco");
    expect(body).toContain("2 cambio(s) pendientes de aplicar");
    expect(body).toContain("1 ISIN no están en el catálogo");
    const rows = [...container.querySelectorAll(".retro-preview-table tbody tr")].map((tr) =>
      [...tr.querySelectorAll("td")].slice(0, 2).map((td) => (td.textContent || "").trim())
    );
    expect(rows).toEqual([
      ["Sin cambios", "IE00B4L5Y983"],
      ["Actualizar", "IE00B18GC888"],
      ["Crear", "LU0404220724"],
      ["Fuera del catálogo", "LU0000000099"]
    ]);
    // La fila actualizada enseña el valor convertido (0,0055 -> 0,55 %) y el actual.
    const updated = container.querySelectorAll(".retro-preview-table tbody tr")[1];
    expect(text(updated as HTMLElement)).toContain("0,550 %");
    expect(text(updated as HTMLElement)).toContain("0,500 %");

    // Resolver el conflicto lo incorpora a la pasada en seco sin repetirla.
    const conflictSelect = container.querySelector<HTMLSelectElement>(".retro-conflicts select");
    expect(conflictSelect).not.toBeNull();
    await type(conflictSelect as HTMLSelectElement, "0.6", "change");
    expect(text(container)).toContain("3 cambio(s) pendientes de aplicar");
    expect(text(container)).toContain("Fondo Repetido");

    await click(button(container, "Aplicar 3 cambio(s)"));
    const confirm = document.body.querySelector<HTMLInputElement>('input[inputmode="numeric"]');
    expect(confirm).not.toBeNull();
    const apply = [...document.body.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "Aplicar") as HTMLButtonElement;
    expect(apply.disabled).toBe(true);
    await type(confirm as HTMLInputElement, "2");
    expect(apply.disabled).toBe(true);
    await type(confirm as HTMLInputElement, "3");
    expect(apply.disabled).toBe(false);
    await click(apply);

    expect(store.applyCommercialRetroImport).toHaveBeenCalledTimes(1);
    const [rowsArg, meta] = store.applyCommercialRetroImport.mock.calls[0] as [Array<{ action: string; entry: { isin: string; retro_pct: number } }>, Record<string, unknown>];
    expect(rowsArg.filter((row) => row.action !== "UNCHANGED" && row.action !== "OUT_OF_MASTER").map((row) => [row.entry.isin, row.entry.retro_pct])).toEqual([
      ["IE00B18GC888", 0.55],
      ["LU0404220724", 1.25],
      ["LU0000000011", 0.6]
    ]);
    expect(meta).toMatchObject({ scale: "fraccion", replace_all: false, source: "FILE_IMPORT" });
    expect(text(container)).toContain("Importación aplicada: 3 alta(s)/actualización(es)");
  });

  test("«Refrescar» con una fila editada y sin guardar avisa y pregunta, y cancelar no tira lo tecleado (PLA-08)", async () => {
    const retro = () => container.querySelector<HTMLInputElement>('input[aria-label="Retrocesión de IE00B4L5Y983"]')!;
    await type(retro(), "0,9");
    await click(button(container, "Refrescar"));
    const dialogo = document.body.querySelector(".ui-dialog");
    expect(text(dialogo as HTMLElement)).toContain("1 fila con cambios sin guardar: IE00B4L5Y983");
    await click([...dialogo!.querySelectorAll("button")].find((b) => b.textContent?.trim() === "Seguir editando") as HTMLButtonElement);
    expect(store.getCommercialRetroList).toHaveBeenCalledTimes(1);
    expect(retro().value).toBe("0,9");
    /* Descartar recarga y deja lo de la base. */
    await click(button(container, "Refrescar"));
    await click([...document.body.querySelectorAll(".ui-dialog button")].find((b) => b.textContent?.trim() === "Descartar los cambios") as HTMLButtonElement);
    expect(store.getCommercialRetroList).toHaveBeenCalledTimes(2);
    expect(retro().value).toBe("0,45");
    /* Sin ediciones, no pregunta. */
    await click(button(container, "Refrescar"));
    expect(document.body.querySelector(".ui-dialog")).toBeNull();
    expect(store.getCommercialRetroList).toHaveBeenCalledTimes(3);
  });

  test("la pasada en seco también pregunta antes de tirar una fila editada (PLA-08)", async () => {
    await type(container.querySelector<HTMLInputElement>('input[aria-label="Nota de IE00B18GC888"]')!, "revisar con el banco");
    await type(container.querySelector("textarea") as HTMLTextAreaElement, TEXTO);
    await click(button(container, "Leer el texto pegado"));
    await click(button(container, "Pasada en seco"));
    expect(text(document.body.querySelector(".ui-dialog") as HTMLElement)).toContain("IE00B18GC888");
    await click([...document.body.querySelectorAll(".ui-dialog button")].find((b) => b.textContent?.trim() === "Seguir editando") as HTMLButtonElement);
    expect(container.querySelector(".retro-preview-table")).toBeNull();
    expect(container.querySelector<HTMLInputElement>('input[aria-label="Nota de IE00B18GC888"]')!.value).toBe("revisar con el banco");
  });

  test("guardar una fila de la tabla no vacía lo que se está escribiendo en «Añadir» (PLA-08)", async () => {
    store.saveCommercialRetro.mockReset().mockResolvedValue({ ...EXISTING[1], retro_pct: 0.75 });
    const alta = container.querySelector<HTMLInputElement>('input[placeholder="ES0000000000"]')!;
    await type(alta, "LU0404220724");
    await type(container.querySelector<HTMLInputElement>('input[aria-label="Retrocesión de IE00B18GC888"]')!, "0,75");
    await click(button(container.querySelector('input[aria-label="Retrocesión de IE00B18GC888"]')!.closest("tr") as HTMLElement, "Guardar"));
    expect(store.saveCommercialRetro).toHaveBeenCalledTimes(1);
    expect(alta.value).toBe("LU0404220724");
  });

  test("el error de una fila sale junto a su fila, y el aviso general dice de qué ISIN es (PLA-13)", async () => {
    store.saveCommercialRetro.mockReset();
    const retro = () => container.querySelector<HTMLInputElement>('input[aria-label="Retrocesión de IE00B18GC888"]')!;
    await type(retro(), "abc");
    const fila = retro().closest("tr") as HTMLElement;
    await click(button(fila, "Guardar"));
    expect(store.saveCommercialRetro).not.toHaveBeenCalled();
    expect(fila.querySelector(".field__error")?.textContent).toBe("Retrocesión fuera de rango 0-100.");
    expect(retro().getAttribute("aria-invalid")).toBe("true");
    /* Rediseño: el aviso general es un `Aviso` de error; su texto, sin la palabra que oye el lector de pantalla. */
    expect(container.querySelector(".aviso--error .aviso__texto")?.textContent?.replace(/^Error\. /, "")).toBe("IE00B18GC888: Retrocesión fuera de rango 0-100.");
    /* La otra fila no se marca. */
    expect(container.querySelector<HTMLInputElement>('input[aria-label="Retrocesión de IE00B4L5Y983"]')!.getAttribute("aria-invalid")).toBeNull();
  });

  test("en modo lista completa propone borrar lo que no está en el fichero", async () => {
    await type(container.querySelector("textarea") as HTMLTextAreaElement, "isin;retro\nIE00B4L5Y983;0,45");
    await click(button(container, "Leer el texto pegado"));
    const replaceAll = container.querySelector<HTMLInputElement>(".retro-check input");
    await act(async () => {
      (replaceAll as HTMLInputElement).click();
    });
    await click(button(container, "Pasada en seco"));
    const actions = [...container.querySelectorAll(".retro-preview-table tbody tr td:first-child")].map((td) => (td.textContent || "").trim());
    expect(actions).toEqual(["Sin cambios", "Eliminar"]);
    expect(text(container)).toContain("1 cambio(s) pendientes de aplicar");
  });

  test("todo control tiene su rótulo enlazado y el error de una fila queda enlazado a su campo (MAR-10)", async () => {
    const vacio = () => ({ sin: controlesSinNombre(container), rotos: enlacesRotos(container, document) });
    expect(vacio()).toEqual({ sin: [], rotos: [] });
    const retro = () => container.querySelector<HTMLInputElement>('input[aria-label="Retrocesión de IE00B18GC888"]')!;
    await type(retro(), "abc");
    await click(button(retro().closest("tr") as HTMLElement, "Guardar"));
    const error = container.querySelector<HTMLElement>(".retro-table .field__error")!;
    expect(error.id).toBeTruthy();
    expect((retro().getAttribute("aria-describedby") ?? "").split(" ")).toContain(error.id);
    expect(vacio()).toEqual({ sin: [], rotos: [] });
    /* También los del paso de importación y el diálogo de confirmación. */
    await type(container.querySelector("textarea") as HTMLTextAreaElement, TEXTO);
    await click(button(container, "Leer el texto pegado"));
    expect(container.querySelector("select")).not.toBeNull();
    expect(vacio()).toEqual({ sin: [], rotos: [] });
  });

  test("destruir un dato se dice «Eliminar» y bajar un fichero, «Descargar» (FMT-21)", async () => {
    const botones = [...container.querySelectorAll("button")].map((b) => (b.textContent || "").trim());
    expect(botones).toContain("Descargar en Excel");
    expect(botones).toContain("Descargar en CSV");
    expect(botones.filter((b) => b === "Eliminar")).toHaveLength(EXISTING.length);
    expect(botones.some((b) => /^(Borrar|Exportar)/.test(b))).toBe(false);
    await click(button(container.querySelector(".retro-table tbody tr") as HTMLElement, "Eliminar"));
    const dialogo = document.querySelector("[role=dialog]") as HTMLElement;
    expect(dialogo.textContent).toContain("Eliminar retrocesión comercial");
    expect([...dialogo.querySelectorAll("button")].map((b) => (b.textContent || "").trim())).toContain("Eliminar");
  });
});
