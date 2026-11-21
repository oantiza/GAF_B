/**
 * Servicio local de operaciones del extractor (1-extractor/ops_server.py).
 *
 * La app no ejecuta nada de la ingesta: pide al servicio, que corre en la
 * misma máquina, que lance los trabajos (alta, extracción, canónico, copia,
 * pasada en seco, escritura, auditoría) y sigue su registro en vivo. El gate de
 * escritura de la maestra vive en el proceso que escribe, nunca aquí.
 *
 * Todo lo que llega se valida contra el contrato antes de entregarlo a la
 * interfaz: un cambio en el servicio se ve como error de contrato, no como
 * una pantalla rara.
 */
import { OPS_LOCAL_TOKEN, OPS_LOCAL_URL } from "../config/runtimeConfig";
import { AppError } from "../core/appError";
import type {
  OpsAltaFila,
  OpsArchivarResultado,
  OpsArchivo,
  OpsArchivoFila,
  OpsAuditoria,
  OpsBackup,
  OpsBackupResultado,
  OpsCampoCorregible,
  OpsCanonicoFila,
  OpsCanonicoResultado,
  OpsCorreccion,
  OpsCorreccionesActivo,
  OpsCorrida,
  OpsEscrituraResultado,
  OpsEscrituraResumen,
  OpsEstado,
  OpsFichaResumen,
  OpsModoPlataforma,
  OpsPasadaEnSeco,
  OpsPlanFila,
  OpsPlataformaEstado,
  OpsReclasificacion,
  OpsReclasificacionFila,
  OpsTarea,
  OpsTipoActivo,
  OpsUniversoFila
} from "../types/opsLocal";
import {
  isObject,
  requireArray,
  requireBoolean,
  requireNumber,
  requireObject,
  requireOneOf,
  requireString,
  requireStringArray
} from "./contractGuards";

export const OPS_MODOS: readonly OpsModoPlataforma[] = ["alta", "republish"];
export const OPS_TIPOS: readonly OpsTipoActivo[] = ["fondo", "etf", "accion"];
const POLL_MS = 700;

export const OPS_UNAVAILABLE_MESSAGE =
  `El servicio local de operaciones no responde en ${OPS_LOCAL_URL}. ` +
  "Arráncalo en 1-extractor con iniciar-operaciones.bat (python main.py ops) y vuelve a intentarlo.";

// ------------------------------------------------------------------ helpers
function optStr(value: unknown, field: string): string | null {
  return value === undefined || value === null ? null : requireString(value, field);
}

function optNum(value: unknown, field: string): number | null {
  return value === undefined || value === null ? null : requireNumber(value, field);
}

function optBool(value: unknown, field: string): boolean {
  return value === undefined || value === null ? false : requireBoolean(value, field);
}

function strList(value: unknown, field: string): string[] {
  return value === undefined || value === null ? [] : requireStringArray(value, field);
}

function scalar(value: unknown, field: string): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  throw new AppError("BACKEND", `Contrato de backend inválido en ${field}: se esperaba un escalar.`);
}

function numberRecord(value: unknown, field: string): Record<string, number | null> {
  const raw = requireObject(value, field);
  const out: Record<string, number | null> = {};
  for (const [key, item] of Object.entries(raw)) out[key] = optNum(item, `${field}.${key}`);
  return out;
}

// ------------------------------------------------------------------ parsers
export function parseOpsTarea(raw: unknown, field = "tarea"): OpsTarea {
  const t = requireObject(raw, field);
  const progreso = isObject(t.progreso) ? t.progreso : {};
  return {
    id: requireString(t.id, `${field}.id`),
    nombre: requireString(t.nombre, `${field}.nombre`),
    parametros: isObject(t.parametros) ? t.parametros : {},
    estado: requireOneOf(t.estado, ["en_curso", "hecha", "error"] as const, `${field}.estado`),
    inicio: optStr(t.inicio, `${field}.inicio`),
    fin: optStr(t.fin, `${field}.fin`),
    segundos: typeof t.segundos === "number" ? t.segundos : 0,
    progreso: {
      actual: optNum(progreso.actual, `${field}.progreso.actual`) ?? undefined,
      total: optNum(progreso.total, `${field}.progreso.total`) ?? undefined,
      isin: optStr(progreso.isin, `${field}.progreso.isin`) ?? undefined
    },
    log_total: typeof t.log_total === "number" ? t.log_total : 0,
    log: strList(t.log, `${field}.log`),
    resultado: t.resultado,
    error: optStr(t.error, `${field}.error`)
  };
}

export function parseOpsBackup(raw: unknown, field = "ultimo_backup"): OpsBackup | null {
  if (raw === null || raw === undefined) return null;
  const b = requireObject(raw, field);
  return {
    ruta: requireString(b.ruta, `${field}.ruta`),
    exportado: optStr(b.exportado, `${field}.exportado`),
    edad_horas: optNum(b.edad_horas, `${field}.edad_horas`),
    registros: optNum(b.registros, `${field}.registros`),
    verificacion: optStr(b.verificacion, `${field}.verificacion`),
    vigente: requireBoolean(b.vigente, `${field}.vigente`)
  };
}

function parseCorrida(raw: unknown, field: string): OpsCorrida {
  const c = requireObject(raw, field);
  return {
    carpeta: requireString(c.carpeta, `${field}.carpeta`),
    tipo: requireString(c.tipo, `${field}.tipo`),
    resumen: isObject(c.resumen) ? c.resumen : null
  };
}

export function parseOpsPlataformaEstado(raw: unknown, field = "plataforma"): OpsPlataformaEstado {
  const p = requireObject(raw, field);
  return {
    ruta: requireString(p.ruta, `${field}.ruta`),
    existe: requireBoolean(p.existe, `${field}.existe`),
    scripts_ok: requireBoolean(p.scripts_ok, `${field}.scripts_ok`),
    scripts_faltan: strList(p.scripts_faltan, `${field}.scripts_faltan`),
    node_modules: requireBoolean(p.node_modules, `${field}.node_modules`),
    npm: requireBoolean(p.npm, `${field}.npm`),
    env_local: requireBoolean(p.env_local, `${field}.env_local`),
    proyecto: optStr(p.proyecto, `${field}.proyecto`),
    credenciales: requireBoolean(p.credenciales, `${field}.credenciales`),
    ultimo_backup: parseOpsBackup(p.ultimo_backup, `${field}.ultimo_backup`),
    backup_max_horas: typeof p.backup_max_horas === "number" ? p.backup_max_horas : 24,
    corridas: Array.isArray(p.corridas) ? p.corridas.map((c, i) => parseCorrida(c, `${field}.corridas[${i}]`)) : []
  };
}

export function parseOpsEstado(raw: unknown): OpsEstado {
  const e = requireObject(raw, "estado");
  const universo = requireObject(e.universo, "estado.universo");
  const canonicos = isObject(e.canonicos) ? e.canonicos : {};
  const exportacion = isObject(e.export) ? e.export : {};
  return {
    servicio: requireString(e.servicio, "estado.servicio"),
    version: typeof e.version === "number" ? e.version : 0,
    base: requireString(e.base, "estado.base"),
    universo: {
      total: requireNumber(universo.total, "estado.universo.total"),
      por_tipo: Object.fromEntries(
        Object.entries(isObject(universo.por_tipo) ? universo.por_tipo : {}).map(([k, v]) => [k, requireNumber(v, `estado.universo.por_tipo.${k}`)])
      )
    },
    fichas: requireNumber(e.fichas, "estado.fichas"),
    indice_actualizado: optStr(e.indice_actualizado, "estado.indice_actualizado"),
    canonicos: {
      generado: optStr(canonicos.generado, "estado.canonicos.generado"),
      ok: optNum(canonicos.ok, "estado.canonicos.ok"),
      errores: optNum(canonicos.errores, "estado.canonicos.errores"),
      bloqueados: optNum(canonicos.bloqueados, "estado.canonicos.bloqueados"),
      package_id: optStr(canonicos.package_id, "estado.canonicos.package_id")
    },
    export: {
      generado: optStr(exportacion.generado, "estado.export.generado"),
      package_id: optStr(exportacion.package_id, "estado.export.package_id")
    },
    paquete_coherente: requireBoolean(e.paquete_coherente, "estado.paquete_coherente"),
    tarea_en_curso: e.tarea_en_curso ? parseOpsTarea(e.tarea_en_curso, "estado.tarea_en_curso") : null,
    plataforma: parseOpsPlataformaEstado(e.plataforma, "estado.plataforma")
  };
}

export function parseOpsUniverso(raw: unknown): OpsUniversoFila[] {
  return requireArray(raw, "universo").map((item, i) => {
    const f = requireObject(item, `universo[${i}]`);
    return {
      isin: requireString(f.isin, `universo[${i}].isin`),
      nombre: typeof f.nombre === "string" ? f.nombre : "",
      tipo: typeof f.tipo === "string" ? f.tipo : "",
      pendiente: optBool(f.pendiente, `universo[${i}].pendiente`),
      actualizado: typeof f.actualizado === "string" ? f.actualizado : "",
      campos: optNum(f.campos, `universo[${i}].campos`),
      fuentes: strList(f.fuentes, `universo[${i}].fuentes`)
    };
  });
}

export function parseOpsAltaFilas(raw: unknown): OpsAltaFila[] {
  return requireArray(raw, "alta").map((item, i) => {
    const f = requireObject(item, `alta[${i}]`);
    return {
      isin: requireString(f.isin, `alta[${i}].isin`),
      situacion: requireOneOf(f.situacion, ["nuevo", "ya_estaba", "invalido"] as const, `alta[${i}].situacion`),
      nombre: typeof f.nombre === "string" ? f.nombre : undefined,
      tipo: typeof f.tipo === "string" ? f.tipo : undefined,
      identificado: typeof f.identificado === "boolean" ? f.identificado : undefined
    };
  });
}

export function parseOpsFichaResumen(raw: unknown, field = "ficha"): OpsFichaResumen {
  const f = requireObject(raw, field);
  const isin = requireString(f.isin, `${field}.isin`);
  if (f.sin_ficha === true) {
    return {
      isin, nombre: null, tipo: null, gestora: null, actualizado: null, campos_con_dato: 0, campos_total: 0,
      calidad: { score: null, bucket: null, flags: [] }, fuentes: [], sri: { valor: null, fuente: null, oficial: false },
      kid: { fuente: null, fecha: null }, errores: [], correcciones: { aplicadas: 0, redundantes: [] }, sin_ficha: true
    };
  }
  const calidad = isObject(f.calidad) ? f.calidad : {};
  const sri = isObject(f.sri) ? f.sri : {};
  const kid = isObject(f.kid) ? f.kid : {};
  const correcciones = isObject(f.correcciones) ? f.correcciones : {};
  return {
    isin,
    nombre: optStr(f.nombre, `${field}.nombre`),
    tipo: optStr(f.tipo, `${field}.tipo`),
    gestora: optStr(f.gestora, `${field}.gestora`),
    actualizado: optStr(f.actualizado, `${field}.actualizado`),
    campos_con_dato: requireNumber(f.campos_con_dato, `${field}.campos_con_dato`),
    campos_total: requireNumber(f.campos_total, `${field}.campos_total`),
    calidad: {
      score: optNum(calidad.score, `${field}.calidad.score`),
      bucket: optStr(calidad.bucket, `${field}.calidad.bucket`),
      flags: strList(calidad.flags, `${field}.calidad.flags`)
    },
    fuentes: strList(f.fuentes, `${field}.fuentes`),
    sri: {
      valor: optNum(sri.valor, `${field}.sri.valor`),
      fuente: optStr(sri.fuente, `${field}.sri.fuente`),
      oficial: optBool(sri.oficial, `${field}.sri.oficial`)
    },
    kid: { fuente: optStr(kid.fuente, `${field}.kid.fuente`), fecha: optStr(kid.fecha, `${field}.kid.fecha`) },
    errores: strList(f.errores, `${field}.errores`),
    correcciones: {
      aplicadas: optNum(correcciones.aplicadas, `${field}.correcciones.aplicadas`) ?? 0,
      redundantes: strList(correcciones.redundantes, `${field}.correcciones.redundantes`)
    }
  };
}

export function parseOpsFichas(raw: unknown): OpsFichaResumen[] {
  return requireArray(raw, "fichas").map((item, i) => parseOpsFichaResumen(item, `fichas[${i}]`));
}

export function parseOpsCanonico(raw: unknown): OpsCanonicoResultado {
  const c = requireObject(raw, "canonico");
  const fondos: OpsCanonicoFila[] = requireArray(c.fondos, "canonico.fondos").map((item, i) => {
    const f = requireObject(item, `canonico.fondos[${i}]`);
    return {
      isin: requireString(f.isin, `canonico.fondos[${i}].isin`),
      generado: requireBoolean(f.generado, `canonico.fondos[${i}].generado`),
      validation_ok: typeof f.validation_ok === "boolean" ? f.validation_ok : null,
      errors: Array.isArray(f.errors) ? f.errors.map((e) => (typeof e === "string" ? e : JSON.stringify(e))) : [],
      kid_source: optStr(f.kid_source, `canonico.fondos[${i}].kid_source`),
      warnings: optNum(f.warnings, `canonico.fondos[${i}].warnings`),
      bucket: optStr(f.bucket, `canonico.fondos[${i}].bucket`)
    };
  });
  return {
    package_id: optStr(c.package_id, "canonico.package_id"),
    ok: requireNumber(c.ok, "canonico.ok"),
    errores: requireNumber(c.errores, "canonico.errores"),
    export_package_id: optStr(c.export_package_id, "canonico.export_package_id"),
    paquete_coherente: requireBoolean(c.paquete_coherente, "canonico.paquete_coherente"),
    fondos
  };
}

function parseEscrituraResumen(raw: unknown, field: string): OpsEscrituraResumen | undefined {
  if (raw === undefined || raw === null) return undefined;
  const e = requireObject(raw, field);
  return {
    escritos: optNum(e.escritos, `${field}.escritos`),
    ya_existian: optNum(e.ya_existian, `${field}.ya_existian`),
    republicados: optNum(e.republicados, `${field}.republicados`),
    postverify_ok: optNum(e.postverify_ok, `${field}.postverify_ok`),
    postverify_fallidos: optNum(e.postverify_fallidos, `${field}.postverify_fallidos`),
    errores: Array.isArray(e.errores) ? e.errores : []
  };
}

export function parseOpsPasadaEnSeco(raw: unknown, field = "seco"): OpsPasadaEnSeco {
  const s = requireObject(raw, field);
  const filas: OpsPlanFila[] = requireArray(s.filas, `${field}.filas`).map((item, i) => {
    const f = requireObject(item, `${field}.filas[${i}]`);
    return {
      isin: requireString(f.isin, `${field}.filas[${i}].isin`),
      accion: requireString(f.accion, `${field}.filas[${i}].accion`),
      motivos: f.motivos === undefined ? undefined : strList(f.motivos, `${field}.filas[${i}].motivos`),
      operaciones: f.operaciones === undefined ? undefined : strList(f.operaciones, `${field}.filas[${i}].operaciones`),
      campos: f.campos === undefined ? undefined : strList(f.campos, `${field}.filas[${i}].campos`),
      rutas: f.rutas === undefined ? undefined : strList(f.rutas, `${field}.filas[${i}].rutas`),
      documentos: f.documentos === undefined ? undefined : strList(f.documentos, `${field}.filas[${i}].documentos`)
    };
  });
  return {
    modo: requireOneOf(s.modo, OPS_MODOS, `${field}.modo`),
    escribir: requireBoolean(s.escribir, `${field}.escribir`),
    codigo: requireNumber(s.codigo, `${field}.codigo`),
    isins: requireStringArray(s.isins, `${field}.isins`),
    carpeta: optStr(s.carpeta, `${field}.carpeta`),
    run_id: optStr(s.run_id, `${field}.run_id`),
    recuento: isObject(s.recuento) ? numberRecord(s.recuento, `${field}.recuento`) : {},
    escrituras: requireNumber(s.escrituras, `${field}.escrituras`),
    documentos: optNum(s.documentos, `${field}.documentos`) ?? undefined,
    crear: s.crear === undefined ? undefined : strList(s.crear, `${field}.crear`),
    validacion_paquete: optStr(s.validacion_paquete, `${field}.validacion_paquete`),
    incidencias_paquete: optNum(s.incidencias_paquete, `${field}.incidencias_paquete`) ?? undefined,
    otros_en_plan: s.otros_en_plan === undefined ? undefined : strList(s.otros_en_plan, `${field}.otros_en_plan`),
    filas,
    escritura: parseEscrituraResumen(s.escritura, `${field}.escritura`),
    error: optStr(s.error, `${field}.error`) ?? undefined,
    salida: strList(s.salida, `${field}.salida`)
  };
}

export function parseOpsAuditoria(raw: unknown, field = "auditoria"): OpsAuditoria {
  const a = requireObject(raw, field);
  return {
    codigo: requireNumber(a.codigo, `${field}.codigo`),
    run_id: optStr(a.run_id, `${field}.run_id`),
    resumen: isObject(a.resumen) ? a.resumen : {},
    desvios: requireNumber(a.desvios, `${field}.desvios`),
    detalle: Array.isArray(a.detalle) ? a.detalle.filter(isObject) : [],
    holdings_desviados: requireNumber(a.holdings_desviados, `${field}.holdings_desviados`),
    en_cero: requireBoolean(a.en_cero, `${field}.en_cero`)
  };
}

export function parseOpsEscritura(raw: unknown): OpsEscrituraResultado {
  const r = requireObject(raw, "escritura");
  return {
    seco: parseOpsPasadaEnSeco(r.seco, "escritura.seco"),
    escritura: r.escritura ? parseOpsPasadaEnSeco(r.escritura, "escritura.escritura") : null,
    auditoria: r.auditoria ? parseOpsAuditoria(r.auditoria, "escritura.auditoria") : null,
    mensaje: optStr(r.mensaje, "escritura.mensaje") ?? undefined
  };
}

export function parseOpsArchivo(raw: unknown, field = "archivo"): OpsArchivo {
  const a = requireObject(raw, field);
  const filas: OpsArchivoFila[] = requireArray(a.filas, `${field}.filas`).map((item, i) => {
    const f = requireObject(item, `${field}.filas[${i}]`);
    return {
      isin: requireString(f.isin, `${field}.filas[${i}].isin`),
      accion: requireString(f.accion, `${field}.filas[${i}].accion`),
      existe: requireBoolean(f.existe, `${field}.filas[${i}].existe`),
      nombre: optStr(f.nombre, `${field}.filas[${i}].nombre`),
      tipo: optStr(f.tipo, `${field}.filas[${i}].tipo`),
      subdocs: requireNumber(f.subdocs, `${field}.filas[${i}].subdocs`),
      en_indice: optBool(f.en_indice, `${field}.filas[${i}].en_indice`),
      copia_previa: optBool(f.copia_previa, `${field}.filas[${i}].copia_previa`),
      postverify: isObject(f.postverify) ? f.postverify : null
    };
  });
  const escritura = isObject(a.escritura) ? a.escritura : null;
  return {
    escribir: requireBoolean(a.escribir, `${field}.escribir`),
    codigo: requireNumber(a.codigo, `${field}.codigo`),
    isins: requireStringArray(a.isins, `${field}.isins`),
    carpeta: optStr(a.carpeta, `${field}.carpeta`),
    run_id: optStr(a.run_id, `${field}.run_id`),
    motivo: typeof a.motivo === "string" ? a.motivo : "",
    recuento: isObject(a.recuento) ? numberRecord(a.recuento, `${field}.recuento`) : {},
    no_existen: strList(a.no_existen, `${field}.no_existen`),
    archivables: requireNumber(a.archivables, `${field}.archivables`),
    filas,
    escritura: escritura
      ? {
          archivados: optNum(escritura.archivados, `${field}.escritura.archivados`),
          subdocs_copiados: optNum(escritura.subdocs_copiados, `${field}.escritura.subdocs_copiados`),
          borrados: optNum(escritura.borrados, `${field}.escritura.borrados`),
          indice_retirados: optNum(escritura.indice_retirados, `${field}.escritura.indice_retirados`),
          postverify_ok: optNum(escritura.postverify_ok, `${field}.escritura.postverify_ok`),
          postverify_fallidos: optNum(escritura.postverify_fallidos, `${field}.escritura.postverify_fallidos`),
          copias: strList(escritura.copias, `${field}.escritura.copias`),
          errores: Array.isArray(escritura.errores) ? escritura.errores : []
        }
      : undefined,
    error: optStr(a.error, `${field}.error`) ?? undefined,
    mensaje: optStr(a.mensaje, `${field}.mensaje`) ?? undefined
  };
}

export function parseOpsReclasificacion(raw: unknown, field = "reclasificacion"): OpsReclasificacion {
  const r = requireObject(raw, field);
  const filas: OpsReclasificacionFila[] = requireArray(r.filas, `${field}.filas`).map((item, i) => {
    const f = requireObject(item, `${field}.filas[${i}]`);
    return {
      isin: requireString(f.isin, `${field}.filas[${i}].isin`),
      accion: requireString(f.accion, `${field}.filas[${i}].accion`),
      razon: optStr(f.razon, `${field}.filas[${i}].razon`),
      motivo: typeof f.motivo === "string" ? f.motivo : "",
      error: optStr(f.error, `${field}.filas[${i}].error`),
      reparaciones: strList(f.reparaciones, `${field}.filas[${i}].reparaciones`),
      avisos: strList(f.avisos, `${field}.filas[${i}].avisos`),
      cartera_colgando: strList(f.cartera_colgando, `${field}.filas[${i}].cartera_colgando`),
      de: optStr(f.de, `${field}.filas[${i}].de`),
      a: optStr(f.a, `${field}.filas[${i}].a`),
      quita: strList(f.quita, `${field}.filas[${i}].quita`),
      metricas: optStr(f.metricas, `${field}.filas[${i}].metricas`),
      indice: optStr(f.indice, `${field}.filas[${i}].indice`),
      postverify: isObject(f.postverify) ? f.postverify : null
    };
  });
  const escritura = isObject(r.escritura) ? r.escritura : null;
  return {
    escribir: requireBoolean(r.escribir, `${field}.escribir`),
    codigo: requireNumber(r.codigo, `${field}.codigo`),
    isins: requireStringArray(r.isins, `${field}.isins`),
    carpeta: optStr(r.carpeta, `${field}.carpeta`),
    run_id: optStr(r.run_id, `${field}.run_id`),
    recuento: isObject(r.recuento) ? numberRecord(r.recuento, `${field}.recuento`) : {},
    reclasificables: requireNumber(r.reclasificables, `${field}.reclasificables`),
    carteras_colgando: (Array.isArray(r.carteras_colgando) ? r.carteras_colgando : []).map((item, i) => {
      const c = requireObject(item, `${field}.carteras_colgando[${i}]`);
      return { isin: requireString(c.isin, `${field}.carteras_colgando[${i}].isin`), rutas: strList(c.rutas, `${field}.carteras_colgando[${i}].rutas`) };
    }),
    metricas_de_fondo: strList(r.metricas_de_fondo, `${field}.metricas_de_fondo`),
    filas,
    escritura: escritura
      ? {
          escritos: optNum(escritura.escritos, `${field}.escritura.escritos`),
          reparados: optNum(escritura.reparados, `${field}.escritura.reparados`),
          metricas_invalidadas: optNum(escritura.metricas_invalidadas, `${field}.escritura.metricas_invalidadas`),
          indice_escrito: escritura.indice_escrito === undefined || escritura.indice_escrito === null
            ? null
            : requireBoolean(escritura.indice_escrito, `${field}.escritura.indice_escrito`),
          postverify_ok: optNum(escritura.postverify_ok, `${field}.escritura.postverify_ok`),
          postverify_fallidos: optNum(escritura.postverify_fallidos, `${field}.escritura.postverify_fallidos`),
          errores: Array.isArray(escritura.errores) ? escritura.errores : []
        }
      : undefined,
    auditoria: r.auditoria ? parseOpsAuditoria(r.auditoria, `${field}.auditoria`) : r.auditoria === null ? null : undefined,
    error: optStr(r.error, `${field}.error`) ?? undefined,
    mensaje: optStr(r.mensaje, `${field}.mensaje`) ?? undefined
  };
}

export function parseOpsArchivarResultado(raw: unknown): OpsArchivarResultado {
  const r = requireObject(raw, "archivar");
  return {
    archivo: parseOpsArchivo(r.archivo, "archivar.archivo"),
    baja: Array.isArray(r.baja)
      ? r.baja.map((item, i) => {
          const b = requireObject(item, `archivar.baja[${i}]`);
          return {
            isin: requireString(b.isin, `archivar.baja[${i}].isin`),
            estaba: requireBoolean(b.estaba, `archivar.baja[${i}].estaba`),
            ficheros_movidos: strList(b.ficheros_movidos, `archivar.baja[${i}].ficheros_movidos`)
          };
        })
      : null,
    canonico: r.canonico ? parseOpsCanonico(r.canonico) : null
  };
}

export function parseOpsBackupResultado(raw: unknown): OpsBackupResultado {
  const b = requireObject(raw, "backup");
  const copia = parseOpsBackup(b.copia, "backup.copia");
  if (!copia) throw new AppError("BACKEND", "Contrato de backend inválido en backup.copia: falta la copia.");
  return { codigo: requireNumber(b.codigo, "backup.codigo"), copia };
}

function parseCorreccion(raw: unknown, field: string, conIsin: true): OpsCorreccion;
function parseCorreccion(raw: unknown, field: string, conIsin: false): Omit<OpsCorreccion, "isin" | "ruta">;
function parseCorreccion(raw: unknown, field: string, conIsin: boolean) {
  const c = requireObject(raw, field);
  const base = {
    valor: scalar(c.valor, `${field}.valor`),
    motivo: typeof c.motivo === "string" ? c.motivo : "",
    autor: typeof c.autor === "string" ? c.autor : "",
    fecha: typeof c.fecha === "string" ? c.fecha : ""
  };
  if (!conIsin) return base;
  return { isin: requireString(c.isin, `${field}.isin`), ruta: requireString(c.ruta, `${field}.ruta`), ...base };
}

export function parseOpsCorreccionesActivo(raw: unknown): OpsCorreccionesActivo {
  const r = requireObject(raw, "correcciones");
  const campos: OpsCampoCorregible[] = requireArray(r.campos, "correcciones.campos").map((item, i) => {
    const f = requireObject(item, `correcciones.campos[${i}]`);
    return {
      ruta: requireString(f.ruta, `correcciones.campos[${i}].ruta`),
      valor: scalar(f.valor, `correcciones.campos[${i}].valor`),
      fuente: optStr(f.fuente, `correcciones.campos[${i}].fuente`),
      tipo: requireOneOf(f.tipo, ["texto", "numero", "booleano", "vacio"] as const, `correcciones.campos[${i}].tipo`),
      correccion: f.correccion ? parseCorreccion(f.correccion, `correcciones.campos[${i}].correccion`, false) : null,
      aplicada: isObject(f.aplicada) ? f.aplicada : null
    };
  });
  return {
    isin: requireString(r.isin, "correcciones.isin"),
    con_ficha: requireBoolean(r.con_ficha, "correcciones.con_ficha"),
    correcciones: requireArray(r.correcciones, "correcciones.correcciones").map((c, i) => parseCorreccion(c, `correcciones.correcciones[${i}]`, true)),
    campos
  };
}

// ------------------------------------------------------------------ transporte
export const OPS_REQUEST_TIMEOUT_MS = 30_000;
export const OPS_OBSERVATION_TIMEOUT_MS = 5 * 60_000;
const LAST_TASK_KEY = "bdb.ops.last-task";

export function lastOpsTaskId(): string | null {
  try { return sessionStorage.getItem(LAST_TASK_KEY); } catch { return null; }
}

async function opsRequest(method: "GET" | "POST" | "DELETE", path: string, body?: unknown, signal?: AbortSignal): Promise<unknown> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (OPS_LOCAL_TOKEN) headers["X-Ops-Token"] = OPS_LOCAL_TOKEN;
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timer = setTimeout(abort, OPS_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${OPS_LOCAL_URL}${path}`, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: controller.signal
    });
    const text = await response.text();
    let payload: unknown = null;
    if (text) {
      try { payload = JSON.parse(text); }
      catch (cause) { throw new AppError("BACKEND", `El servicio de operaciones devolvió una respuesta que no es JSON (${response.status}).`, { cause }); }
    }
    if (!response.ok) {
      const detalle = isObject(payload) && typeof payload.error === "string" ? payload.error : `respuesta ${response.status}`;
      if (response.status === 401) {
        // Decisión 6.7b (17-10-2026): el servicio exige siempre su token. El servicio nuevo ya
        // explica cómo pasarlo; si la respuesta no lo dice, lo añade la app.
        const comoArrancar = detalle.includes("iniciar-dev.bat")
          ? ""
          : " Arranca la app con iniciar-dev.bat, que le pasa el token del servicio (python main.py ops-token en 1-extractor).";
        const causa = detalle.endsWith(".") ? detalle : `${detalle}.`;
        throw new AppError("AUTH", `El servicio de operaciones rechazó la petición: ${causa}${comoArrancar}`, { cause: payload });
      }
      if (response.status === 403) {
        throw new AppError("AUTH", `El servicio de operaciones rechazó la petición: ${detalle}.`, { cause: payload });
      }
      throw new AppError("BACKEND", detalle.endsWith(".") ? detalle : `${detalle}.`, { cause: payload });
    }
    return payload;
  } catch (cause) {
    if (cause instanceof AppError) throw cause;
    const message = controller.signal.aborted ? "Se interrumpió la espera de la respuesta del servicio local." : OPS_UNAVAILABLE_MESSAGE;
    throw new AppError("NETWORK", message + (method !== "GET" ? " El resultado de la operación es desconocido: consulta su estado antes de volver a ejecutarla." : ""), { cause });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
  }
}

function tareaDe(payload: unknown): OpsTarea {
  const r = requireObject(payload, "respuesta");
  return parseOpsTarea(r.tarea, "respuesta.tarea");
}

export type OpsTareaListener = ((tarea: OpsTarea) => void) & { signal?: AbortSignal };

function observationError(id: string): AppError {
  return new AppError("NETWORK", `Se ha detenido el seguimiento de la tarea ${id}. El trabajo puede seguir en el servicio; reanuda el seguimiento para consultar el resultado sin volver a ejecutarlo.`);
}

function waitInterval(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const finish = () => { clearTimeout(timer); signal.removeEventListener("abort", finish); resolve(); };
    const timer = setTimeout(finish, ms);
    signal.addEventListener("abort", finish, { once: true });
    if (signal.aborted) finish();
  });
}

/** Stops observing after a deadline or navigation. Never cancels/restarts the server job. */
export async function waitForOpsTarea(id: string, onUpdate?: OpsTareaListener, options: { intervalMs?: number; maxWaitMs?: number; signal?: AbortSignal } = {}): Promise<OpsTarea> {
  const signal = options.signal ?? onUpdate?.signal;
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) controller.abort();
  const deadline = setTimeout(abort, options.maxWaitMs ?? OPS_OBSERVATION_TIMEOUT_MS);
  const intervalMs = Math.max(1, options.intervalMs ?? POLL_MS);
  let offset = 0;
  let log: string[] = [];
  try {
    for (;;) {
      if (controller.signal.aborted) throw observationError(id);
      const snapshot = parseOpsTarea(await opsRequest("GET", `/api/ops/tareas/${encodeURIComponent(id)}?desde=${offset}`, undefined, controller.signal));
      if (controller.signal.aborted) throw observationError(id);
      offset += snapshot.log.length;
      log = [...log, ...snapshot.log].slice(-400);
      const tarea: OpsTarea = { ...snapshot, log };
      onUpdate?.(tarea);
      if (tarea.estado !== "en_curso") return tarea;
      await waitInterval(intervalMs, controller.signal);
    }
  } catch (cause) {
    if (controller.signal.aborted) throw observationError(id);
    throw cause;
  } finally {
    clearTimeout(deadline);
    signal?.removeEventListener("abort", abort);
  }
}

async function runTarea<T>(start: () => Promise<unknown>, parse: (resultado: unknown) => T, onUpdate?: OpsTareaListener): Promise<T> {
  if (onUpdate?.signal?.aborted) throw new AppError("NETWORK", "Se cerró el seguimiento antes de iniciar la operación.");
  const inicial = tareaDe(await start());
  try { sessionStorage.setItem(LAST_TASK_KEY, inicial.id); } catch { /* Storage may be unavailable. */ }
  onUpdate?.(inicial);
  const final = await waitForOpsTarea(inicial.id, onUpdate);
  if (final.estado === "error") {
    throw new AppError("BACKEND", final.error || "La tarea terminó con error.", { cause: final });
  }
  return parse(final.resultado);
}

// ------------------------------------------------------------------ API
export function getOpsEstado(): Promise<OpsEstado> {
  return opsRequest("GET", "/api/ops/estado").then(parseOpsEstado);
}

export function getOpsPlataformaEstado(): Promise<OpsPlataformaEstado> {
  return opsRequest("GET", "/api/ops/plataforma/estado").then((raw) => parseOpsPlataformaEstado(raw, "plataforma"));
}

export function searchOpsUniverso(q: string): Promise<OpsUniversoFila[]> {
  return opsRequest("GET", `/api/ops/universo?q=${encodeURIComponent(q)}`).then(parseOpsUniverso);
}

export function runOpsAlta(isins: string[], tipo: OpsTipoActivo | "", onUpdate?: OpsTareaListener): Promise<OpsAltaFila[]> {
  return runTarea(() => opsRequest("POST", "/api/ops/alta", { isins, tipo }), parseOpsAltaFilas, onUpdate);
}

export function runOpsExtraer(isins: string[], options: { force?: boolean } = {}, onUpdate?: OpsTareaListener): Promise<OpsFichaResumen[]> {
  return runTarea(() => opsRequest("POST", "/api/ops/extraer", { isins, force: options.force === true }), parseOpsFichas, onUpdate);
}

export function runOpsCanonico(isins: string[], onUpdate?: OpsTareaListener): Promise<OpsCanonicoResultado> {
  return runTarea(() => opsRequest("POST", "/api/ops/canonico", { isins }), parseOpsCanonico, onUpdate);
}

export function runOpsBackup(onUpdate?: OpsTareaListener): Promise<OpsBackupResultado> {
  return runTarea(() => opsRequest("POST", "/api/ops/plataforma/backup", {}), parseOpsBackupResultado, onUpdate);
}

export function runOpsPasadaEnSeco(isins: string[], modo: OpsModoPlataforma, onUpdate?: OpsTareaListener): Promise<OpsPasadaEnSeco> {
  return runTarea(() => opsRequest("POST", "/api/ops/plataforma/seco", { isins, modo }), (r) => parseOpsPasadaEnSeco(r), onUpdate);
}

export function runOpsEscribir(isins: string[], modo: OpsModoPlataforma, aprobacion: number, onUpdate?: OpsTareaListener): Promise<OpsEscrituraResultado> {
  return runTarea(() => opsRequest("POST", "/api/ops/plataforma/escribir", { isins, modo, aprobacion }), parseOpsEscritura, onUpdate);
}

export function runOpsAuditar(isins: string[], onUpdate?: OpsTareaListener): Promise<OpsAuditoria> {
  return runTarea(() => opsRequest("POST", "/api/ops/plataforma/auditar", { isins }), (r) => parseOpsAuditoria(r), onUpdate);
}

/** Qué hay en la maestra para esos ISIN (raíz, subdocumentos, índice); no toca nada. */
export function runOpsArchivarSeco(isins: string[], motivo: string, onUpdate?: OpsTareaListener): Promise<OpsArchivo> {
  return runTarea(() => opsRequest("POST", "/api/ops/plataforma/archivar-seco", { isins, motivo }), (r) => parseOpsArchivo(r), onUpdate);
}

/** Archiva de verdad: copia local + `_archived_assets`, retirada de `assets` y del índice, baja del universo y canónico. */
export function runOpsArchivar(isins: string[], aprobacion: number, motivo: string, onUpdate?: OpsTareaListener): Promise<OpsArchivarResultado> {
  return runTarea(() => opsRequest("POST", "/api/ops/plataforma/archivar", { isins, aprobacion, motivo }), parseOpsArchivarResultado, onUpdate);
}

/**
 * Reclasificación en la maestra, pasada en seco (ALTA-13). Con `preparar`, el servicio extrae como acción solo
 * los ISIN que aún no tienen canónico de acción y regenera el canónico; sin él, solo pregunta a la plataforma.
 * No escribe.
 */
export function runOpsReclasificarSeco(isins: string[], preparar: boolean, onUpdate?: OpsTareaListener): Promise<OpsReclasificacion> {
  return runTarea(() => opsRequest("POST", "/api/ops/plataforma/reclasificar-seco", { isins, preparar }), (r) => parseOpsReclasificacion(r), onUpdate);
}

/** Reclasifica de verdad: ficha de acción, métricas invalidadas hasta el recálculo y buscador; después, auditoría. */
export function runOpsReclasificar(isins: string[], aprobacion: number, onUpdate?: OpsTareaListener): Promise<OpsReclasificacion> {
  return runTarea(() => opsRequest("POST", "/api/ops/plataforma/reclasificar", { isins, aprobacion }), (r) => parseOpsReclasificacion(r), onUpdate);
}

export function getOpsCorrecciones(isin: string): Promise<OpsCorreccionesActivo> {
  return opsRequest("GET", `/api/ops/correcciones/${encodeURIComponent(isin)}`).then(parseOpsCorreccionesActivo);
}

export interface OpsCorreccionInput {
  isin: string;
  ruta: string;
  valor: string | number | boolean | null;
  motivo: string;
  autor?: string;
  nueva?: boolean;
}

export async function saveOpsCorreccion(input: OpsCorreccionInput): Promise<{ correccion: OpsCorreccion; valor_actual: unknown; siguiente: string }> {
  const r = requireObject(await opsRequest("POST", "/api/ops/correcciones", input), "correccion");
  return {
    correccion: parseCorreccion(r.correccion, "correccion.correccion", true),
    valor_actual: r.valor_actual,
    siguiente: typeof r.siguiente === "string" ? r.siguiente : ""
  };
}

export async function deleteOpsCorreccion(isin: string, ruta: string): Promise<void> {
  await opsRequest("DELETE", `/api/ops/correcciones/${encodeURIComponent(isin)}/${encodeURIComponent(ruta)}`);
}

/**
 * Cambia el tipo en el universo del extractor (fondos.csv). `siguiente` llega cuando eso no basta: un activo
 * que pasa a acción y ya está en la maestra como fondo hay que reclasificarlo también allí.
 */
export async function reclasificaOpsActivo(
  isin: string,
  tipo: OpsTipoActivo
): Promise<{ isin: string; tipo_anterior: string; tipo: string; siguiente: string | null }> {
  const r = requireObject(await opsRequest("POST", "/api/ops/reclasificar", { isin, tipo }), "reclasificar");
  return {
    isin: requireString(r.isin, "reclasificar.isin"),
    tipo_anterior: typeof r.tipo_anterior === "string" ? r.tipo_anterior : "",
    tipo: requireString(r.tipo, "reclasificar.tipo"),
    siguiente: typeof r.siguiente === "string" && r.siguiente ? r.siguiente : null
  };
}

