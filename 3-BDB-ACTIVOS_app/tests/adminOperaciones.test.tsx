// @vitest-environment happy-dom

/**
 * Sistema › Operaciones: el proceso completo (alta → extraer → canónico →
 * copia y pasada en seco → escribir → comprobar) y la corrección de un campo,
 * montando la pestaña contra un servicio local de mentira.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { AppError } from "../src/core/appError";
import type { OpsEstado, OpsTarea } from "../src/types/opsLocal";
import { controlesSinNombre, enlacesRotos } from "./support/rotulosDeAdmin";
import type { OpsTareaListener } from "../src/adapters/opsLocalBackend";

const ops = vi.hoisted(() => ({
  OPS_MODOS: ["alta", "republish"] as const,
  OPS_TIPOS: ["fondo", "etf", "accion"] as const,
  OPS_UNAVAILABLE_MESSAGE: "El servicio local de operaciones no responde en http://127.0.0.1:8766. Arráncalo con iniciar-operaciones.bat.",
  getOpsEstado: vi.fn(),
  lastOpsTaskId: vi.fn(),
  waitForOpsTarea: vi.fn(),
  runOpsAlta: vi.fn(),
  runOpsExtraer: vi.fn(),
  runOpsCanonico: vi.fn(),
  runOpsBackup: vi.fn(),
  runOpsPasadaEnSeco: vi.fn(),
  runOpsEscribir: vi.fn(),
  runOpsAuditar: vi.fn(),
  runOpsArchivarSeco: vi.fn(),
  runOpsArchivar: vi.fn(),
  runOpsReclasificarSeco: vi.fn(),
  runOpsReclasificar: vi.fn(),
  reclasificaOpsActivo: vi.fn(),
  getOpsCorrecciones: vi.fn(),
  saveOpsCorreccion: vi.fn(),
  deleteOpsCorreccion: vi.fn()
}));
vi.mock("../src/adapters/opsLocalBackend", () => ops);

import { AdminOperaciones } from "../src/components/AdminOperaciones";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function estado(extra: Partial<OpsEstado> = {}): OpsEstado {
  return {
    servicio: "fondosdb-ops", version: 1, base: "C:\\extractor",
    universo: { total: 763, por_tipo: { fondo: 670 } }, fichas: 763, indice_actualizado: null,
    canonicos: { generado: null, ok: 763, errores: 0, bloqueados: 0, package_id: "8fd560" },
    export: { generado: null, package_id: "8fd560" }, paquete_coherente: true, tarea_en_curso: null,
    plataforma: {
      ruta: "C:\\plataforma", existe: true, scripts_ok: true, scripts_faltan: [], node_modules: true, npm: true, env_local: true,
      proyecto: "bbdd", credenciales: true,
      ultimo_backup: { ruta: "x", exportado: "2026-09-05T08:00:00Z", edad_horas: 2, registros: 782, verificacion: "PASS", vigente: true },
      backup_max_horas: 24, corridas: []
    },
    ...extra
  };
}

function button(container: ParentNode, text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find((b) => (b.textContent || "").trim().startsWith(text));
  if (!found) throw new Error(`No aparece el botón «${text}»`);
  return found as HTMLButtonElement;
}

function click(element: HTMLElement) {
  return act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function type(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string, eventName = "input") {
  return act(async () => {
    const proto = Object.getPrototypeOf(element) as object;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    setter?.call(element, value);
    element.dispatchEvent(new Event(eventName, { bubbles: true }));
  });
}

/** La sección de un paso, por su título («7 · Archivar»). */
function panel(container: ParentNode, title: string): HTMLElement {
  const found = [...container.querySelectorAll("section")].find((s) => (s.querySelector(".panel__title")?.textContent || "").trim() === title);
  if (!found) throw new Error(`No aparece el paso «${title}»`);
  return found as HTMLElement;
}

function text(container: HTMLElement): string {
  return (container.textContent || "").replace(/\s+/g, " ");
}

/** El botón de la pregunta abierta, por su rótulo. */
function dialogo(rotulo: string): HTMLButtonElement {
  const found = [...document.body.querySelectorAll(".ui-dialog button")].find((b) => (b.textContent || "").trim() === rotulo);
  if (!found) throw new Error(`No aparece la pregunta con «${rotulo}»`);
  return found as HTMLButtonElement;
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("Sistema · Operaciones", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    for (const fn of Object.values(ops)) if (typeof fn === "function" && "mockReset" in fn) fn.mockReset();
    ops.getOpsEstado.mockResolvedValue(estado());
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  async function mount() {
    await act(async () => {
      root.render(createElement(AdminOperaciones, { onOpenIngesta: () => undefined }));
    });
    await flush();
  }

  test("sin servicio en marcha, la pestaña explica cómo arrancarlo y ofrece reintentar", async () => {
    ops.getOpsEstado.mockRejectedValue(new AppError("NETWORK", ops.OPS_UNAVAILABLE_MESSAGE));
    await mount();
    expect(text(container)).toContain("El servicio local de operaciones no está en marcha");
    expect(text(container)).toContain("iniciar-operaciones.bat");
    ops.getOpsEstado.mockResolvedValue(estado());
    await click(button(container, "Reintentar"));
    await flush();
    expect(text(container)).toContain("Activos");
    expect(text(container)).toContain("Coherente");
  });

  test("recupera una tarea conocida sin iniciar otra operación", async () => {
    ops.lastOpsTaskId.mockReturnValue("saved-task");
    const finished = { id: "saved-task", nombre: "plataforma_escribir", estado: "hecha", log: ["Escritura confirmada"], progreso: {}, segundos: 1 } as OpsTarea;
    ops.waitForOpsTarea.mockImplementation(async (_id: string, onUpdate: OpsTareaListener) => { onUpdate(finished); return finished; });
    await mount();
    await click(button(container, "Consultar o reanudar seguimiento"));
    expect(ops.waitForOpsTarea).toHaveBeenCalledWith("saved-task", expect.any(Function));
    expect(ops.runOpsEscribir).not.toHaveBeenCalled();
    expect(text(container)).toContain("Escritura confirmada");
  });

  test("salir de la pantalla aborta el seguimiento en curso", async () => {
    ops.lastOpsTaskId.mockReturnValue("running-task");
    let signal: AbortSignal | undefined;
    ops.waitForOpsTarea.mockImplementation((_id: string, onUpdate: OpsTareaListener) => {
      signal = onUpdate.signal;
      return new Promise((_resolve, reject) => signal?.addEventListener("abort", () => reject(new Error("Seguimiento detenido")), { once: true }));
    });
    await mount();
    await click(button(container, "Consultar o reanudar seguimiento"));
    expect(signal?.aborted).toBe(false);
    await act(async () => { root.render(null); });
    expect(signal?.aborted).toBe(true);
  });

  test("el proceso completo: alta, extraer, canónico, pasada en seco y escribir con el recuento tecleado", async () => {
    ops.runOpsAlta.mockResolvedValue([
      { isin: "LU0113257694", situacion: "nuevo", nombre: "Schroder ISF", tipo: "fondo", identificado: true },
      { isin: "IE00B4L5Y983", situacion: "ya_estaba", nombre: "iShares Core", tipo: "etf" },
      { isin: "US0378331005", situacion: "nuevo", nombre: "Apple", tipo: "accion", identificado: true }
    ]);
    ops.runOpsExtraer.mockResolvedValue([
      {
        isin: "LU0113257694", nombre: "Schroder ISF", tipo: "fondo", gestora: "Schroders", actualizado: "2026-09-05T10:00:00",
        campos_con_dato: 120, campos_total: 200, calidad: { score: 82, bucket: "ALTO", flags: [] }, fuentes: ["cssf", "kid_gestora"],
        sri: { valor: 4, fuente: "kid_gestora:schroders", oficial: true }, kid: { fuente: "schroders", fecha: "2026-02-10" }, errores: [],
        correcciones: { aplicadas: 1, redundantes: [] }
      },
      {
        isin: "IE00B4L5Y983", nombre: "iShares Core", tipo: "etf", gestora: null, actualizado: null, campos_con_dato: 90, campos_total: 200,
        calidad: { score: 70, bucket: "MEDIO", flags: [] }, fuentes: ["morningstar_lt"], sri: { valor: 6, fuente: "morningstar_lt:screener", oficial: false },
        kid: { fuente: null, fecha: null }, errores: ["esma: timeout"], correcciones: { aplicadas: 0, redundantes: [] }
      }
    ]);
    ops.runOpsCanonico.mockResolvedValue({
      package_id: "8fd560df29", ok: 763, errores: 0, export_package_id: "8fd560df29", paquete_coherente: true,
      fondos: [
        { isin: "LU0113257694", generado: true, validation_ok: true, errors: [], kid_source: "schroders", warnings: 1 },
        { isin: "IE00B4L5Y983", generado: true, validation_ok: true, errors: [], kid_source: null, warnings: 0 }
      ]
    });
    ops.runOpsPasadaEnSeco.mockResolvedValue({
      modo: "alta", escribir: false, codigo: 0, isins: ["LU0113257694", "IE00B4L5Y983"], carpeta: "x", run_id: "r1",
      recuento: { CREATE: 1, SKIP_EXISTS: 1 }, escrituras: 1, validacion_paquete: "OK", incidencias_paquete: 0,
      documentos: 3, crear: ["LU0113257694"],
      filas: [
        { isin: "LU0113257694", accion: "CREATE", motivos: [],
          documentos: ["assets/LU0113257694", "assets/LU0113257694/holdings/latest", "assets/LU0113257694/metrics/latest"] },
        { isin: "IE00B4L5Y983", accion: "SKIP_EXISTS", motivos: [], documentos: [] }
      ],
      salida: []
    });
    ops.runOpsEscribir.mockResolvedValue({
      seco: { modo: "alta", escribir: false, codigo: 0, isins: ["LU0113257694", "IE00B4L5Y983"], carpeta: "x", run_id: "r2", recuento: {}, escrituras: 1, filas: [], salida: [] },
      escritura: {
        modo: "alta", escribir: true, codigo: 0, isins: ["LU0113257694", "IE00B4L5Y983"], carpeta: "y", run_id: "r3", recuento: { CREATE: 1 }, escrituras: 1, filas: [],
        escritura: { escritos: 1, ya_existian: 1, postverify_ok: 1, postverify_fallidos: 0, errores: [] }, salida: []
      },
      auditoria: { codigo: 0, run_id: "a1", resumen: {}, desvios: 0, detalle: [], holdings_desviados: 0, en_cero: true }
    });
    await mount();

    await type(container.querySelector("textarea") as HTMLTextAreaElement, "LU0113257694 IE00B4L5Y983 US0378331005");
    expect(text(container)).toContain("3 ISIN reconocidos");
    await click(button(container, "Dar de alta"));
    await flush();
    expect(ops.runOpsAlta).toHaveBeenCalledWith(["LU0113257694", "IE00B4L5Y983", "US0378331005"], "", expect.any(Function));
    expect(text(container)).toContain("Nuevo en el universo");
    expect(text(container)).toContain("Ya estaba");
    // La acción queda fuera del proceso del extractor y se manda a Ingesta.
    expect(text(container)).toContain("1 acción(es) (US0378331005) no siguen este proceso");
    expect(text(container)).toContain("2 siguen el proceso");

    await click(button(container, "Extraer 2 activo(s)"));
    await flush();
    expect(ops.runOpsExtraer).toHaveBeenCalledWith(["LU0113257694", "IE00B4L5Y983"], { force: false }, expect.any(Function));
    expect(text(container)).toContain("KID de la gestora · schroders");
    expect(text(container)).toContain("Morningstar · screener · no oficial");
    expect(text(container)).toContain("1 corrección(es)");
    expect(text(container)).toContain("1 error(es) de fuente");

    await click(button(container, "Regenerar canónico"));
    await flush();
    // Las cifras del KpiStrip van pegadas a su rótulo en el texto plano.
    expect(text(container)).toContain("Generados763");
    expect(text(container)).toContain("válido · KID schroders · 1 aviso(s)");

    // Con algo nuevo en el universo, el modo sugerido es «alta».
    const modo = [...container.querySelectorAll("select")].find((s) => s.value === "alta" || s.value === "republish") as HTMLSelectElement;
    expect(modo.value).toBe("alta");
    expect(button(container, "Escribir").disabled).toBe(true);
    await click(button(container, "Pasada en seco"));
    await flush();
    expect(ops.runOpsPasadaEnSeco).toHaveBeenCalledWith(["LU0113257694", "IE00B4L5Y983"], "alta", expect.any(Function));
    expect(text(container)).toContain("Escrituras previstas1");
    expect(text(container)).toContain("Documentos a crear3");
    expect(text(container)).toContain("Ficha · Cartera · Métricas iniciales");
    expect(text(container)).toContain("el refresco diario de la app solo le actualiza la caída máxima");
    expect(text(container)).toContain("Ya existe");

    const escribir = button(container, "Escribir 1 cambio(s)");
    expect(escribir.disabled).toBe(false);
    await click(escribir);
    const confirm = document.body.querySelector<HTMLInputElement>('input[inputmode="numeric"]');
    expect(confirm).not.toBeNull();
    const aplicar = [...document.body.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "Escribir") as HTMLButtonElement;
    expect(aplicar.disabled).toBe(true);
    await type(confirm as HTMLInputElement, "1");
    expect(aplicar.disabled).toBe(false);
    await click(aplicar);
    await flush();
    expect(ops.runOpsEscribir).toHaveBeenCalledWith(["LU0113257694", "IE00B4L5Y983"], "alta", 1, expect.any(Function));
    expect(text(container)).toContain("Creados1");
    expect(text(container)).toContain("Postverificados1");
    expect(text(container)).toContain("ComprobaciónEn cero");
  });

  test("archivar: pasada en seco, recuento tecleado, y el activo sale de la maestra, del universo y del proceso", async () => {
    ops.runOpsArchivarSeco.mockResolvedValue({
      escribir: false, codigo: 0, isins: ["LU0000000001", "XX0000000009"], carpeta: "x", run_id: "a1", motivo: "alta errónea",
      recuento: { requested: 2, found: 1, subdocs_total: 3, in_search_index: 1 }, no_existen: ["XX0000000009"], archivables: 1,
      filas: [
        { isin: "LU0000000001", accion: "ARCHIVE", existe: true, nombre: "Fondo Uno", tipo: "FUND", subdocs: 3, en_indice: true, copia_previa: false, postverify: null },
        { isin: "XX0000000009", accion: "MISSING", existe: false, nombre: null, tipo: null, subdocs: 0, en_indice: false, copia_previa: false, postverify: null }
      ]
    });
    ops.runOpsArchivar.mockResolvedValue({
      archivo: {
        escribir: true, codigo: 0, isins: ["LU0000000001", "XX0000000009"], carpeta: "y", run_id: "a2", motivo: "alta errónea",
        recuento: { requested: 2, found: 1, subdocs_total: 3, in_search_index: 1 }, no_existen: ["XX0000000009"], archivables: 1,
        filas: [{ isin: "LU0000000001", accion: "ARCHIVE", existe: true, nombre: "Fondo Uno", tipo: "FUND", subdocs: 3, en_indice: true, copia_previa: false,
          postverify: { archived_root: true, archived_subdocs: 3, original_gone: true, index_entry_gone: true, ok: true } }],
        escritura: { archivados: 1, subdocs_copiados: 3, borrados: 4, indice_retirados: 1, postverify_ok: 1, postverify_fallidos: 0,
          copias: ["C:\\runs\\archive_a2\\backup_LU0000000001.json"], errores: [] }
      },
      baja: [{ isin: "LU0000000001", estaba: true, ficheros_movidos: ["data/funds/LU0000000001.json"] }],
      canonico: { package_id: "abc", ok: 762, errores: 0, export_package_id: "abc", paquete_coherente: true, fondos: [] }
    });
    await mount();

    // el activo también estaba en el proceso de carga: al archivarlo debe salir de allí
    await type(container.querySelector("textarea") as HTMLTextAreaElement, "LU0000000001 IE00B4L5Y983");
    await type(panel(container, "7 · Archivar").querySelector("textarea") as HTMLTextAreaElement, "LU0000000001, XX0000000009");
    const motivo = [...container.querySelectorAll<HTMLInputElement>("input")].find((i) => i.placeholder.startsWith("alta errónea")) as HTMLInputElement;
    await type(motivo, "alta errónea");
    expect(button(container, "Archivar 0 activo(s)").disabled).toBe(true);

    await click(button(panel(container, "7 · Archivar"), "Pasada en seco"));
    await flush();
    expect(ops.runOpsArchivarSeco).toHaveBeenCalledWith(["LU0000000001", "XX0000000009"], "alta errónea", expect.any(Function));
    expect(text(container)).toContain("En la maestra1");
    expect(text(container)).toContain("No están1");
    expect(text(container)).toContain("No está en la maestra");

    const archivar = button(container, "Archivar 1 activo(s)");
    expect(archivar.disabled).toBe(false);
    await click(archivar);
    const confirm = document.body.querySelector<HTMLInputElement>('input[inputmode="numeric"]');
    expect(confirm).not.toBeNull();
    const aplicar = [...document.body.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "Archivar") as HTMLButtonElement;
    expect(aplicar.disabled).toBe(true);
    await type(confirm as HTMLInputElement, "1");
    expect(aplicar.disabled).toBe(false);
    await click(aplicar);
    await flush();
    expect(ops.runOpsArchivar).toHaveBeenCalledWith(["LU0000000001", "XX0000000009"], 1, "alta errónea", expect.any(Function));
    expect(text(container)).toContain("Archivados1");
    expect(text(container)).toContain("Fuera del buscador1");
    expect(text(container)).toContain("Copia restaurable: C:\\runs\\archive_a2\\backup_LU0000000001.json");
    expect(text(container)).toContain("Canónico regenerado sin los activos archivados: 762 generados, paquete coherente.");
    expect((container.querySelector("textarea") as HTMLTextAreaElement).value).toBe("IE00B4L5Y983");
  });

  test("reclasificar en la maestra: el cambio a acción lo lleva al paso 8, pasada en seco y recuento tecleado", async () => {
    ops.runOpsAlta.mockResolvedValue([
      { isin: "ES0105046009", situacion: "ya_estaba", nombre: "Aena", tipo: "fondo" }
    ]);
    ops.reclasificaOpsActivo.mockResolvedValue({
      isin: "ES0105046009", tipo_anterior: "fondo", tipo: "accion", siguiente: "reclasificar en la maestra: pasada en seco de la reclasificación"
    });
    const filaSeco = { isin: "ES0105046009", accion: "RECLASSIFY", razon: null, motivo: "", error: null, de: "FUND", a: "STOCK",
      quita: ["costs", "fixed_income_profile"], metricas: "MARK", indice: "UPDATE", reparaciones: [], avisos: ["HOLDINGS_LEFT"],
      cartera_colgando: ["assets/ES0105046009/holdings/latest"], postverify: null };
    const filaError = { isin: "IE0000000002", accion: "ERROR", razon: null, motivo: "la ficha de acción no cumple el contrato de la maestra",
      error: "el documento nuevo no valida master.asset-stock.v1.1: /identity name", de: "FUND", a: "STOCK", quita: [], metricas: null, indice: null,
      reparaciones: [], avisos: [], cartera_colgando: [], postverify: null };
    ops.runOpsReclasificarSeco.mockResolvedValue({
      escribir: false, codigo: 0, isins: ["ES0105046009"], carpeta: "x", run_id: "c1",
      recuento: { pedidos: 1, a_reclasificar: 1, a_reparar: 0, omitidos: 0, errores: 1 }, reclasificables: 1, filas: [filaSeco, filaError],
      carteras_colgando: [{ isin: "ES0105046009", rutas: ["assets/ES0105046009/holdings/latest"] }], metricas_de_fondo: []
    });
    ops.runOpsReclasificar.mockResolvedValue({
      escribir: true, codigo: 0, isins: ["ES0105046009"], carpeta: "y", run_id: "c2",
      recuento: { pedidos: 1, a_reclasificar: 1, omitidos: 0, errores: 0 }, reclasificables: 1, carteras_colgando: [], metricas_de_fondo: [],
      filas: [{ ...filaSeco, postverify: { root: true, metrics: true, search_index: true, ok: true } }],
      escritura: { escritos: 1, reparados: 0, metricas_invalidadas: 1, indice_escrito: true, postverify_ok: 1, postverify_fallidos: 0,
        errores: [{ asset_id: "meta/search_index", error: "SEARCH_INDEX_CONCURRENT_MODIFICATION: tras 3 intentos" }] },
      auditoria: { codigo: 0, run_id: "a1", resumen: {}, desvios: 0, detalle: [], holdings_desviados: 0, en_cero: true }
    });
    await mount();

    await type(container.querySelector("textarea") as HTMLTextAreaElement, "ES0105046009");
    await click(button(container, "Dar de alta"));
    await flush();
    const tipo = container.querySelector<HTMLSelectElement>('select[aria-label="Producto de ES0105046009"]') as HTMLSelectElement;
    await type(tipo, "accion", "change");
    /* Cambiar el tipo escribe en el universo: se confirma antes (PLA-10). */
    await click(dialogo("Cambiar el producto"));
    await flush();
    expect(ops.reclasificaOpsActivo).toHaveBeenCalledWith("ES0105046009", "accion");
    expect(text(container)).toContain("reclasifícalo(s) en el paso 8");
    const reclas = panel(container, "8 · Reclasificar en la maestra").querySelector("textarea") as HTMLTextAreaElement;
    expect(reclas.value).toBe("ES0105046009");
    expect(button(container, "Reclasificar 0 activo(s)").disabled).toBe(true);

    await click(button(panel(container, "8 · Reclasificar en la maestra"), "Pasada en seco"));
    await flush();
    expect(ops.runOpsReclasificarSeco).toHaveBeenCalledWith(["ES0105046009"], true, expect.any(Function));
    expect(text(container)).toContain("A reclasificar1");
    expect(text(container)).toContain("Fondo → Acción");
    expect(text(container)).toContain("Se quitan costes, perfil de renta fija");
    // el error de la plataforma, en español y con el original plegado
    expect(text(container)).toContain("la ficha de acción no cumple el contrato de la maestra");
    expect(text(container)).toContain("Detalle técnico");
    expect(text(container)).toContain("conserva(n) la cartera de cuando era(n) fondo");

    const reclasificar = button(container, "Reclasificar 1 activo(s)");
    expect(reclasificar.disabled).toBe(false);
    await click(reclasificar);
    const confirm = document.body.querySelector<HTMLInputElement>('input[inputmode="numeric"]');
    expect(confirm).not.toBeNull();
    const aplicar = [...document.body.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "Reclasificar") as HTMLButtonElement;
    expect(aplicar.disabled).toBe(true);
    await type(confirm as HTMLInputElement, "1");
    expect(aplicar.disabled).toBe(false);
    await click(aplicar);
    await flush();
    expect(ops.runOpsReclasificar).toHaveBeenCalledWith(["ES0105046009"], 1, expect.any(Function));
    expect(text(container)).toContain("Reclasificados1");
    expect(text(container)).toContain("Métricas invalidadas1");
    expect(text(container)).toContain("ComprobaciónEn cero");
    expect(text(container)).toContain("El documento cambió mientras se escribía: no se escribió nada.");
    expect(text(container)).not.toContain('{"asset_id"');
    expect(text(container)).not.toContain("reclasifícalo(s) en el paso 8");
  });

  test("el tipo de una fila no se escribe en el universo sin confirmarlo, y cancelar lo deja como estaba (PLA-10)", async () => {
    ops.runOpsAlta.mockResolvedValue([{ isin: "ES0105046009", situacion: "ya_estaba", nombre: "Aena", tipo: "fondo" }]);
    ops.reclasificaOpsActivo.mockResolvedValue({ isin: "ES0105046009", tipo_anterior: "fondo", tipo: "etf", siguiente: null });
    await mount();
    await type(container.querySelector("textarea") as HTMLTextAreaElement, "ES0105046009");
    await click(button(container, "Dar de alta"));
    await flush();
    const tipo = () => container.querySelector<HTMLSelectElement>('select[aria-label="Producto de ES0105046009"]') as HTMLSelectElement;
    await type(tipo(), "etf", "change");
    expect(text(document.body.querySelector(".ui-dialog") as HTMLElement)).toContain("ES0105046009");
    await click(dialogo("Cancelar"));
    await flush();
    expect(ops.reclasificaOpsActivo).not.toHaveBeenCalled();
    expect(tipo().value).toBe("fondo");
    await type(tipo(), "etf", "change");
    await click(dialogo("Cambiar el producto"));
    await flush();
    expect(ops.reclasificaOpsActivo).toHaveBeenCalledTimes(1);
    expect(tipo().value).toBe("etf");
  });

  test("guardar una corrección añade el ISIN y vuelve a sugerir extraer (PLA-16)", async () => {
    ops.runOpsAlta.mockResolvedValue([{ isin: "LU0113257694", situacion: "ya_estaba", nombre: "Schroder ISF", tipo: "fondo" }]);
    ops.runOpsExtraer.mockResolvedValue([]);
    ops.getOpsCorrecciones.mockResolvedValue({
      isin: "IE00B4L5Y983", con_ficha: true, correcciones: [],
      campos: [{ ruta: "riesgo.sri_kid_1a7", valor: 5, fuente: "kid_gestora:ishares", tipo: "numero", correccion: null, aplicada: null }]
    });
    ops.saveOpsCorreccion.mockResolvedValue({
      correccion: { isin: "IE00B4L5Y983", ruta: "riesgo.sri_kid_1a7", valor: 4, motivo: "KID", autor: "oscar", fecha: "2026-09-05T10:00:00Z" },
      valor_actual: 5, siguiente: "extraer…"
    });
    await mount();
    await type(container.querySelector("textarea") as HTMLTextAreaElement, "LU0113257694");
    await click(button(container, "Dar de alta"));
    await flush();
    await click(button(container, "Extraer 1 activo(s)"));
    await flush();
    expect(button(container, "Extraer 1 activo(s)").className).toContain("ui-button--secondary");

    await type(container.querySelector<HTMLInputElement>(".ops-isin-input") as HTMLInputElement, "IE00B4L5Y983");
    await click(button(container, "Ver campos"));
    await flush();
    await click([...container.querySelectorAll(".ops-campos-table button")].find((b) => (b.textContent || "").trim() === "Corregir") as HTMLButtonElement);
    const inputs = [...container.querySelectorAll<HTMLInputElement>(".ops-correccion-form input")];
    await type(inputs.find((i) => i.placeholder.startsWith("4 ·")) as HTMLInputElement, "4");
    await type(inputs.find((i) => i.placeholder.startsWith("KID del productor")) as HTMLInputElement, "KID");
    await click(button(container, "Guardar corrección"));
    await flush();
    /* El ISIN nuevo no se ha extraído: lo hecho para los anteriores ya no vale, y el paso que toca es extraer. */
    expect((container.querySelector("textarea") as HTMLTextAreaElement).value).toBe("LU0113257694\nIE00B4L5Y983");
    expect(button(container, "Extraer 2 activo(s)").className).toContain("ui-button--primary");
  });

  test("corregir un campo: ver los campos de la ficha, guardar con motivo y retirar", async () => {
    ops.getOpsCorrecciones.mockResolvedValue({
      isin: "LU0113257694", con_ficha: true, correcciones: [],
      campos: [
        { ruta: "riesgo.sri_kid_1a7", valor: 5, fuente: "kid_gestora:schroders", tipo: "numero", correccion: null, aplicada: null },
        { ruta: "identificacion.domicilio", valor: "IRL", fuente: "esma:registro", tipo: "texto", correccion: null, aplicada: null }
      ]
    });
    ops.saveOpsCorreccion.mockResolvedValue({
      correccion: { isin: "LU0113257694", ruta: "riesgo.sri_kid_1a7", valor: 4, motivo: "KID 2026-02", autor: "oscar", fecha: "2026-09-05T10:00:00Z" },
      valor_actual: 5, siguiente: "extraer…"
    });
    await mount();

    const isinInput = container.querySelector<HTMLInputElement>(".ops-isin-input") as HTMLInputElement;
    await type(isinInput, "lu0113257694");
    await click(button(container, "Ver campos"));
    await flush();
    expect(text(container)).toContain("riesgo.sri_kid_1a7");
    expect(text(container)).toContain("KID de la gestora · schroders");

    const corregir = [...container.querySelectorAll(".ops-campos-table button")].find((b) => (b.textContent || "").trim() === "Corregir") as HTMLButtonElement;
    await click(corregir);
    const ruta = container.querySelector<HTMLInputElement>(".ops-correccion-form .ops-mono-input") as HTMLInputElement;
    expect(ruta.value).toBe("riesgo.sri_kid_1a7");
    const inputs = [...container.querySelectorAll<HTMLInputElement>(".ops-correccion-form input")];
    const valor = inputs.find((i) => i.placeholder.startsWith("4 ·")) as HTMLInputElement;
    const motivo = inputs.find((i) => i.placeholder.startsWith("KID del productor")) as HTMLInputElement;
    expect(button(container, "Guardar corrección").disabled).toBe(true);
    await type(valor, "4");
    await type(motivo, "KID 2026-02 del productor");
    expect(button(container, "Guardar corrección").disabled).toBe(false);
    await click(button(container, "Guardar corrección"));
    await flush();
    expect(ops.saveOpsCorreccion).toHaveBeenCalledWith({ isin: "LU0113257694", ruta: "riesgo.sri_kid_1a7", valor: 4, motivo: "KID 2026-02 del productor", nueva: false });
    expect(text(container)).toContain("Corrección guardada: riesgo.sri_kid_1a7 = 4 (la fuente trae 5)");
    // El ISIN corregido entra en el proceso con el modo «republicar».
    expect((container.querySelector("textarea") as HTMLTextAreaElement).value).toContain("LU0113257694");
    const modo = [...container.querySelectorAll("select")].find((s) => s.value === "alta" || s.value === "republish") as HTMLSelectElement;
    expect(modo.value).toBe("republish");

    ops.getOpsCorrecciones.mockResolvedValue({
      isin: "LU0113257694", con_ficha: true,
      correcciones: [{ isin: "LU0113257694", ruta: "riesgo.sri_kid_1a7", valor: 4, motivo: "KID 2026-02", autor: "oscar", fecha: "2026-09-05T10:00:00Z" }],
      campos: [{ ruta: "riesgo.sri_kid_1a7", valor: 5, fuente: "kid_gestora:schroders", tipo: "numero", correccion: { valor: 4, motivo: "KID 2026-02", autor: "oscar", fecha: "2026-09-05T10:00:00Z" }, aplicada: null }]
    });
    await click(button(container, "Ver campos"));
    await flush();
    expect(text(container)).toContain("Pendiente de extraer");
    ops.deleteOpsCorreccion.mockResolvedValue(undefined);
    await click(button(container, "Retirar"));
    /* Retirar borra la corrección y su motivo: se confirma antes, diciendo cuál (PLA-10). */
    expect(text(document.body.querySelector(".ui-dialog") as HTMLElement)).toContain("riesgo.sri_kid_1a7");
    expect(text(document.body.querySelector(".ui-dialog") as HTMLElement)).toContain("KID 2026-02");
    await click(dialogo("Retirar"));
    await flush();
    expect(ops.deleteOpsCorreccion).toHaveBeenCalledWith("LU0113257694", "riesgo.sri_kid_1a7");
    expect(text(container)).toContain("Corrección retirada");
  });

  test("todo control tiene su rótulo enlazado y la pista del ISIN lo describe; «Tipo» es «Producto» (MAR-10, FMT-15)", async () => {
    ops.runOpsAlta.mockResolvedValue([{ isin: "LU0113257694", situacion: "nuevo", nombre: "Schroder ISF", tipo: "fondo", identificado: true }]);
    ops.getOpsCorrecciones.mockResolvedValue({
      isin: "IE00B4L5Y983", con_ficha: true, correcciones: [],
      campos: [{ ruta: "riesgo.sri_kid_1a7", valor: 5, fuente: "kid_gestora:ishares", tipo: "numero", correccion: null, aplicada: null }]
    });
    await mount();
    const isin = container.querySelector("textarea") as HTMLTextAreaElement;
    await type(isin, "LU0113257694\nIE00B4L5Y983");
    const pista = container.querySelector(".ops-isin-field .field__hint") as HTMLElement;
    expect(pista.textContent).toBe("2 ISIN reconocidos");
    expect((isin.getAttribute("aria-describedby") ?? "").split(" ")).toContain(pista.id);
    expect(container.querySelector(`label[for="${isin.id}"]`)?.textContent).toBe("ISIN");
    /* El campo que fuerza el producto del alta se rotula «Producto»: fondo, ETF o acción. */
    const producto = [...container.querySelectorAll("label.field__label")].find((l) => l.textContent === "Producto");
    expect(producto).toBeDefined();
    await click(button(container, "Dar de alta"));
    await flush();
    expect([...container.querySelectorAll("th")].some((th) => th.textContent === "Tipo")).toBe(false);
    expect(container.querySelector('select[aria-label="Producto de LU0113257694"]')).not.toBeNull();
    /* Y con el formulario de corrección abierto, ningún control queda sin nombre. */
    await type(container.querySelector<HTMLInputElement>(".ops-isin-input") as HTMLInputElement, "IE00B4L5Y983");
    await click(button(container, "Ver campos"));
    await flush();
    await click([...container.querySelectorAll(".ops-campos-table button")].find((b) => (b.textContent || "").trim() === "Corregir") as HTMLButtonElement);
    expect(controlesSinNombre(container)).toEqual([]);
    expect(enlacesRotos(container, document)).toEqual([]);
  });

  test("los campos de archivar y reclasificar tienen su rótulo enlazado", async () => {
    ops.getOpsEstado.mockResolvedValue(estado());
    await mount();
    await type(container.querySelectorAll("textarea")[1] as HTMLTextAreaElement, "LU0000000001");
    expect(controlesSinNombre(container)).toEqual([]);
    expect(enlacesRotos(container, document)).toEqual([]);
  });
});
