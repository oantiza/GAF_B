/**
 * Adaptador del servicio local de operaciones: contrato validado, errores con
 * causa en español y seguimiento de tareas con registro incremental.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  OPS_UNAVAILABLE_MESSAGE,
  OPS_REQUEST_TIMEOUT_MS,
  getOpsEstado,
  parseOpsArchivarResultado,
  parseOpsEstado,
  parseOpsPasadaEnSeco,
  parseOpsReclasificacion,
  reclasificaOpsActivo,
  runOpsAlta,
  runOpsEscribir,
  saveOpsCorreccion,
  waitForOpsTarea
} from "../src/adapters/opsLocalBackend";
import { AppError } from "../src/core/appError";

function estadoCrudo() {
  return {
    servicio: "fondosdb-ops",
    version: 1,
    base: "C:\\extractor",
    universo: { total: 763, por_tipo: { fondo: 670, etf: 19, accion: 74 } },
    fichas: 763,
    indice_actualizado: "2026-09-05T08:00:00",
    canonicos: { generado: "2026-09-05T04:09:59+00:00", ok: 763, errores: 0, bloqueados: 0, package_id: "8fd560df" },
    export: { generado: "2026-09-05T08:17:00", package_id: "8fd560df" },
    paquete_coherente: true,
    tarea_en_curso: null,
    plataforma: {
      ruta: "C:\\plataforma", existe: true, scripts_ok: true, scripts_faltan: [], node_modules: true, npm: true,
      env_local: true, proyecto: "gestor-activos-local", credenciales: true,
      ultimo_backup: { ruta: "C:\\plataforma\\data\\backups\\x", exportado: "2026-09-04T04:21:00Z", edad_horas: 27.9, registros: 782, verificacion: "PASS", vigente: false },
      backup_max_horas: 24, corridas: []
    }
  };
}

function tarea(estado: "en_curso" | "hecha" | "error", extra: Record<string, unknown> = {}) {
  return {
    id: "t1", nombre: "alta", parametros: {}, estado, inicio: "2026-09-05T10:00:00", fin: null, segundos: 1.2,
    progreso: {}, log_total: 0, log: [], resultado: null, error: null, ...extra
  };
}

function respuesta(status: number, body: unknown): Response {
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Sistema · Operaciones · adaptador del servicio local", () => {
  test("a stalled response times out and a write is reported as an unknown outcome", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_url, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    })));
    const result = expect(runOpsEscribir(["LU0113257694"], "alta", 1)).rejects.toThrow("resultado de la operación es desconocido");
    await vi.advanceTimersByTimeAsync(OPS_REQUEST_TIMEOUT_MS + 1);
    await result;
  });

  test("stopping observation aborts a pending read and never sends another write", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn((_url, options: RequestInit) => new Promise((_resolve, reject) => {
      options.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }));
    vi.stubGlobal("fetch", fetchMock);
    const result = expect(waitForOpsTarea("t1", undefined, { signal: controller.signal })).rejects.toThrow("reanuda el seguimiento");
    controller.abort();
    await result;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].method).toBe("GET");
  });

  test("the observation deadline releases the UI even if the job keeps running", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => respuesta(200, tarea("en_curso"))));
    const result = expect(waitForOpsTarea("t1", undefined, { maxWaitMs: 100, intervalMs: 70 })).rejects.toThrow("puede seguir en el servicio");
    await vi.advanceTimersByTimeAsync(101);
    await result;
  });

  test("resuming reads the existing job and bounds log memory while preserving the server offset", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(respuesta(200, tarea("en_curso", { log: Array.from({ length: 450 }, (_, i) => `line ${i}`), log_total: 450 })))
      .mockResolvedValueOnce(respuesta(200, tarea("hecha", { log: ["done"], log_total: 451 })));
    vi.stubGlobal("fetch", fetchMock);
    const final = await waitForOpsTarea("existing-id", undefined, { intervalMs: 1 });
    expect(final.log).toHaveLength(400);
    expect(final.log.at(-1)).toBe("done");
    expect(String(fetchMock.mock.calls[1][0])).toContain("existing-id?desde=450");
    expect(fetchMock.mock.calls.every((call) => call[1].method === "GET")).toBe(true);
  });

  test("valida el estado y detecta un contrato roto", () => {
    const estado = parseOpsEstado(estadoCrudo());
    expect(estado.universo.total).toBe(763);
    expect(estado.plataforma.ultimo_backup?.vigente).toBe(false);
    expect(estado.paquete_coherente).toBe(true);
    const roto = estadoCrudo() as Record<string, unknown>;
    roto.universo = { total: "763" };
    expect(() => parseOpsEstado(roto)).toThrow(AppError);
  });

  test("la pasada en seco conserva recuento, filas y otros elementos del plan", () => {
    const seco = parseOpsPasadaEnSeco({
      modo: "republish", escribir: false, codigo: 0, isins: ["LU0113257694"], carpeta: "x", run_id: "r1",
      recuento: { checked: 1, matched: 0, to_republish: 1, live_missing: null }, escrituras: 1,
      otros_en_plan: ["meta/search_index"],
      filas: [{ isin: "LU0113257694", accion: "REPUBLICAR", operaciones: ["root:set_owned"], campos: ["risk"], rutas: ["risk.kid_periodo_mantenimiento_anos"] }],
      salida: ["[republish] DRY-RUN: 0 escrituras."]
    });
    expect(seco.escrituras).toBe(1);
    expect(seco.recuento.live_missing).toBeNull();
    expect(seco.filas[0].rutas).toEqual(["risk.kid_periodo_mantenimiento_anos"]);
    expect(seco.otros_en_plan).toEqual(["meta/search_index"]);
  });

  test("la pasada en seco de la alta conserva los documentos de cada activo y los ISIN a crear", () => {
    const seco = parseOpsPasadaEnSeco({
      modo: "alta", escribir: false, codigo: 0, isins: ["LU0113257694", "IE00B4L5Y983"], carpeta: "x", run_id: "r1",
      recuento: { CREATE: 1, SKIP_EXISTS: 1 }, escrituras: 1, documentos: 3, crear: ["LU0113257694"], targets: "root,holdings,metrics",
      filas: [
        { isin: "LU0113257694", accion: "CREATE", motivos: [], documentos: ["assets/LU0113257694", "assets/LU0113257694/holdings/latest", "assets/LU0113257694/metrics/latest"] },
        { isin: "IE00B4L5Y983", accion: "SKIP_EXISTS", motivos: [], documentos: [] }
      ],
      salida: []
    });
    expect(seco.documentos).toBe(3);
    expect(seco.crear).toEqual(["LU0113257694"]);
    expect(seco.filas[0].documentos).toHaveLength(3);
    // un servicio anterior no los manda: siguen siendo opcionales
    const viejo = parseOpsPasadaEnSeco({ modo: "alta", escribir: false, codigo: 0, isins: [], carpeta: null, run_id: null, recuento: {}, escrituras: 0, filas: [], salida: [] });
    expect(viejo.documentos).toBeUndefined();
    expect(viejo.crear).toBeUndefined();
  });

  test("la reclasificación conserva filas, escritura y auditoría, y detecta un contrato roto", () => {
    const r = parseOpsReclasificacion({
      modo: "reclasificar", escribir: true, codigo: 0, isins: ["ES0105046009", "LU0000000001"], carpeta: "y", run_id: "c1",
      recuento: { pedidos: 2, a_reclasificar: 1, omitidos: 1, errores: 0 }, reclasificables: 1,
      filas: [
        { isin: "ES0105046009", accion: "RECLASSIFY", razon: null, motivo: "", error: null, de: "FUND", a: "STOCK", quita: ["costs"], metricas: "MARK",
          indice: "UPDATE", reparaciones: [], avisos: ["HOLDINGS_LEFT"], cartera_colgando: ["assets/ES0105046009/holdings/latest"],
          postverify: { root: true, metrics: true, search_index: true, ok: true } },
        { isin: "LU0000000001", accion: "REPAIR", razon: "ALREADY_STOCK", motivo: "ya es acción, pero el buscador aún lo da por fondo", de: "STOCK", a: "STOCK",
          quita: [], metricas: null, indice: "UPDATE", reparaciones: ["search_index"], postverify: null }
      ],
      carteras_colgando: [{ isin: "ES0105046009", rutas: ["assets/ES0105046009/holdings/latest"] }],
      metricas_de_fondo: ["US0378331005"],
      escritura: { escritos: 1, reparados: 1, metricas_invalidadas: 1, indice_escrito: true, postverify_ok: 2, postverify_fallidos: 0, errores: [] },
      auditoria: { codigo: 0, run_id: "a1", resumen: {}, desvios: 0, detalle: [], holdings_desviados: 0, en_cero: true },
      salida: []
    });
    expect(r.filas[0].cartera_colgando).toEqual(["assets/ES0105046009/holdings/latest"]);
    expect(r.filas[1]).toMatchObject({ accion: "REPAIR", razon: "ALREADY_STOCK", reparaciones: ["search_index"], avisos: [] });
    expect(r.carteras_colgando).toEqual([{ isin: "ES0105046009", rutas: ["assets/ES0105046009/holdings/latest"] }]);
    expect(r.metricas_de_fondo).toEqual(["US0378331005"]);
    expect(r.escritura?.reparados).toBe(1);
    expect(r.reclasificables).toBe(1);
    expect(r.filas[0]).toMatchObject({ de: "FUND", a: "STOCK", quita: ["costs"], metricas: "MARK" });
    expect(r.filas[1].motivo).toBe("ya es acción, pero el buscador aún lo da por fondo");
    expect(r.escritura?.metricas_invalidadas).toBe(1);
    expect(r.auditoria?.en_cero).toBe(true);
    expect(() => parseOpsReclasificacion({ escribir: false, codigo: 0, isins: [], filas: [], reclasificables: "1" })).toThrow(AppError);
  });

  test("cambiar el tipo devuelve el aviso de reclasificar en la maestra cuando hace falta", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      ok: true, isin: "ES0105046009", tipo_anterior: "fondo", tipo: "accion", nombre: "Aena",
      siguiente: "reclasificar en la maestra: pasada en seco de la reclasificación"
    }), { status: 200, headers: { "Content-Type": "application/json" } })));
    const r = await reclasificaOpsActivo("ES0105046009", "accion");
    expect(r.siguiente).toContain("reclasificar en la maestra");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true, isin: "ES0105046009", tipo_anterior: "accion", tipo: "fondo", siguiente: null }),
      { status: 200, headers: { "Content-Type": "application/json" } })));
    expect((await reclasificaOpsActivo("ES0105046009", "fondo")).siguiente).toBeNull();
  });

  test("el resultado del archivo conserva la escritura, la baja del universo y el canónico", () => {
    const r = parseOpsArchivarResultado({
      archivo: {
        modo: "archivar", escribir: true, codigo: 0, isins: ["LU0000000001"], carpeta: "y", run_id: "a2", motivo: "duplicado",
        recuento: { requested: 1, found: 1, subdocs_total: 3, in_search_index: 1 }, no_existen: [], archivables: 1,
        filas: [{ isin: "LU0000000001", accion: "ARCHIVE", existe: true, nombre: "Fondo", tipo: "FUND", subdocs: 3, en_indice: true, copia_previa: false,
          postverify: { ok: true } }],
        escritura: { archivados: 1, subdocs_copiados: 3, borrados: 4, indice_retirados: 1, postverify_ok: 1, postverify_fallidos: 0, copias: ["b.json"], errores: [] },
        salida: []
      },
      baja: [{ isin: "LU0000000001", estaba: true, ficheros_movidos: ["data/funds/LU0000000001.json"] }],
      canonico: null
    });
    expect(r.archivo.escritura?.copias).toEqual(["b.json"]);
    expect(r.archivo.filas[0].postverify).toEqual({ ok: true });
    expect(r.baja?.[0].ficheros_movidos).toEqual(["data/funds/LU0000000001.json"]);
    expect(r.canonico).toBeNull();
    expect(() => parseOpsArchivarResultado({ archivo: { escribir: true } })).toThrow(AppError);
  });

  test("sin servicio, el error dice cómo arrancarlo; con rechazo, repite la causa del servicio", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(getOpsEstado()).rejects.toMatchObject({ kind: "NETWORK", message: OPS_UNAVAILABLE_MESSAGE });
    expect(OPS_UNAVAILABLE_MESSAGE).toContain("iniciar-operaciones.bat");

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respuesta(409, { ok: false, error: "primero la pasada en seco de estos mismos ISIN y modo" })));
    await expect(runOpsEscribir(["LU0113257694"], "alta", 1)).rejects.toMatchObject({
      kind: "BACKEND",
      message: "primero la pasada en seco de estos mismos ISIN y modo."
    });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respuesta(403, { ok: false, error: "origen no permitido: https://otro" })));
    await expect(getOpsEstado()).rejects.toMatchObject({ kind: "AUTH" });

    // Decisión 6.7b (17-10-2026): el servicio exige siempre su token; el 401 dice cómo pasárselo a la app.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respuesta(401, { ok: false, error: "falta o no coincide X-Ops-Token" })));
    const sinToken = await getOpsEstado().catch((error: unknown) => error as { kind: string; message: string });
    expect(sinToken.kind).toBe("AUTH");
    expect(sinToken.message).toContain("iniciar-dev.bat");
    expect(sinToken.message).toContain("ops-token");

    // El servicio nuevo ya trae la indicación: no se repite.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respuesta(401, {
      ok: false, error: "falta o no coincide X-Ops-Token. Arranca la app con iniciar-dev.bat, que le pasa el token (python main.py ops-token)."
    })));
    const conIndicacion = await getOpsEstado().catch((error: unknown) => error as { message: string });
    expect(conIndicacion.message.split("iniciar-dev.bat").length - 1).toBe(1);
  });

  test("una tarea se sigue hasta el final acumulando el registro incremental", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(respuesta(200, { ok: true, tarea: tarea("en_curso") }))
      .mockResolvedValueOnce(respuesta(200, tarea("en_curso", { log: ["[1/2] LU0113257694"], log_total: 1, progreso: { actual: 1, total: 2, isin: "LU0113257694" } })))
      .mockResolvedValueOnce(
        respuesta(200, tarea("hecha", {
          log: ["[2/2] IE00B4L5Y983", "Alta terminada: 2 nuevos de 2."], log_total: 3,
          resultado: [
            { isin: "LU0113257694", situacion: "nuevo", nombre: "Schroder ISF", tipo: "fondo", identificado: true },
            { isin: "IE00B4L5Y983", situacion: "ya_estaba", nombre: "iShares", tipo: "etf" }
          ]
        }))
      );
    vi.stubGlobal("fetch", fetchMock);
    const vistos: string[][] = [];
    const filas = await runOpsAlta(["LU0113257694", "IE00B4L5Y983"], "", (t) => vistos.push([...t.log]));
    expect(filas.map((f) => [f.isin, f.situacion])).toEqual([["LU0113257694", "nuevo"], ["IE00B4L5Y983", "ya_estaba"]]);
    expect(vistos.at(-1)).toEqual(["[1/2] LU0113257694", "[2/2] IE00B4L5Y983", "Alta terminada: 2 nuevos de 2."]);
    // la primera consulta pide desde 0 y la segunda desde 1: el servicio sirve el registro incremental
    expect(String(fetchMock.mock.calls[1][0])).toContain("/api/ops/tareas/t1?desde=0");
    expect(String(fetchMock.mock.calls[2][0])).toContain("/api/ops/tareas/t1?desde=1");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toEqual({ isins: ["LU0113257694", "IE00B4L5Y983"], tipo: "" });
  });

  test("una tarea que termina en error se convierte en un error con su mensaje", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(respuesta(200, tarea("error", { error: "la plataforma terminó con código 1 sin dejar plan.json" }))));
    await expect(waitForOpsTarea("t1", undefined, { intervalMs: 1 })).resolves.toMatchObject({ estado: "error" });
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(respuesta(200, { ok: true, tarea: tarea("en_curso") }))
        .mockResolvedValueOnce(respuesta(200, tarea("error", { error: "se cayó" })))
    );
    await expect(runOpsAlta(["LU0113257694"], "")).rejects.toMatchObject({ kind: "BACKEND", message: "se cayó" });
  });

  test("guardar una corrección manda el valor ya interpretado y devuelve lo guardado", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      respuesta(200, {
        ok: true,
        correccion: { isin: "LU0113257694", ruta: "riesgo.sri_kid_1a7", valor: 4, motivo: "KID", autor: "oscar", fecha: "2026-09-05T10:00:00Z" },
        valor_actual: 5,
        siguiente: "extraer…"
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const r = await saveOpsCorreccion({ isin: "LU0113257694", ruta: "riesgo.sri_kid_1a7", valor: 4, motivo: "KID" });
    expect(r.correccion.valor).toBe(4);
    expect(r.valor_actual).toBe(5);
    expect(JSON.parse(String(fetchMock.mock.calls[0][1].body))).toMatchObject({ valor: 4, motivo: "KID" });
  });
});
