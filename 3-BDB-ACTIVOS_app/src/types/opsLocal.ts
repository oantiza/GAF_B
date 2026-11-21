// Tipos del servicio local de operaciones (1-extractor/ops_server.py).
// Mapean las respuestas JSON tal cual las emite el servicio; el adaptador las
// valida antes de entregarlas a la interfaz.

export type OpsTipoActivo = "fondo" | "etf" | "accion";

export type OpsTareaEstado = "en_curso" | "hecha" | "error";

export interface OpsTarea {
  id: string;
  nombre: string;
  parametros: Record<string, unknown>;
  estado: OpsTareaEstado;
  inicio: string | null;
  fin: string | null;
  segundos: number;
  progreso: { actual?: number; total?: number; isin?: string };
  log_total: number;
  log: string[];
  resultado: unknown;
  error: string | null;
}

export interface OpsBackup {
  ruta: string;
  exportado: string | null;
  edad_horas: number | null;
  registros: number | null;
  verificacion: string | null;
  vigente: boolean;
}

export interface OpsPlataformaEstado {
  ruta: string;
  existe: boolean;
  scripts_ok: boolean;
  scripts_faltan: string[];
  node_modules: boolean;
  npm: boolean;
  env_local: boolean;
  proyecto: string | null;
  credenciales: boolean;
  ultimo_backup: OpsBackup | null;
  backup_max_horas: number;
  corridas: OpsCorrida[];
}

export interface OpsCorrida {
  carpeta: string;
  tipo: string;
  resumen: Record<string, unknown> | null;
}

export interface OpsEstado {
  servicio: string;
  version: number;
  base: string;
  universo: { total: number; por_tipo: Record<string, number> };
  fichas: number;
  indice_actualizado: string | null;
  canonicos: { generado: string | null; ok: number | null; errores: number | null; bloqueados: number | null; package_id: string | null };
  export: { generado: string | null; package_id: string | null };
  paquete_coherente: boolean;
  tarea_en_curso: OpsTarea | null;
  plataforma: OpsPlataformaEstado;
}

export interface OpsUniversoFila {
  isin: string;
  nombre: string;
  tipo: string;
  pendiente: boolean;
  actualizado: string;
  campos: number | null;
  fuentes: string[];
}

export type OpsAltaSituacion = "nuevo" | "ya_estaba" | "invalido";

export interface OpsAltaFila {
  isin: string;
  situacion: OpsAltaSituacion;
  nombre?: string;
  tipo?: string;
  identificado?: boolean;
}

export interface OpsFichaResumen {
  isin: string;
  nombre: string | null;
  tipo: string | null;
  gestora: string | null;
  actualizado: string | null;
  campos_con_dato: number;
  campos_total: number;
  calidad: { score: number | null; bucket: string | null; flags: string[] };
  fuentes: string[];
  sri: { valor: number | null; fuente: string | null; oficial: boolean };
  kid: { fuente: string | null; fecha: string | null };
  errores: string[];
  correcciones: { aplicadas: number; redundantes: string[] };
  sin_ficha?: boolean;
}

export interface OpsCanonicoFila {
  isin: string;
  generado: boolean;
  validation_ok: boolean | null;
  errors: string[];
  kid_source?: string | null;
  warnings?: number | null;
  bucket?: string | null;
}

export interface OpsCanonicoResultado {
  package_id: string | null;
  ok: number;
  errores: number;
  export_package_id: string | null;
  paquete_coherente: boolean;
  fondos: OpsCanonicoFila[];
}

export type OpsModoPlataforma = "alta" | "republish";

export interface OpsPlanFila {
  isin: string;
  accion: string;
  motivos?: string[];
  operaciones?: string[];
  campos?: string[];
  rutas?: string[];
  /** Alta: documentos que crea en la maestra (raíz, cartera, metrics/latest puente). */
  documentos?: string[];
}

export interface OpsEscrituraResumen {
  escritos?: number | null;
  ya_existian?: number | null;
  republicados?: number | null;
  postverify_ok: number | null;
  postverify_fallidos: number | null;
  errores: unknown[];
}

export interface OpsPasadaEnSeco {
  modo: OpsModoPlataforma;
  escribir: boolean;
  codigo: number;
  isins: string[];
  carpeta: string | null;
  run_id: string | null;
  recuento: Record<string, number | null>;
  escrituras: number;
  /** Alta: total de documentos que crean los activos aprobados. */
  documentos?: number;
  /** Alta: los ISIN que se crean; la escritura solo manda estos. */
  crear?: string[];
  validacion_paquete?: string | null;
  incidencias_paquete?: number;
  otros_en_plan?: string[];
  filas: OpsPlanFila[];
  escritura?: OpsEscrituraResumen;
  error?: string;
  salida: string[];
}

export interface OpsAuditoria {
  codigo: number;
  run_id: string | null;
  resumen: Record<string, unknown>;
  desvios: number;
  detalle: Array<Record<string, unknown>>;
  holdings_desviados: number;
  en_cero: boolean;
}

export interface OpsEscrituraResultado {
  seco: OpsPasadaEnSeco;
  escritura: OpsPasadaEnSeco | null;
  auditoria: OpsAuditoria | null;
  mensaje?: string;
}

export interface OpsBackupResultado {
  codigo: number;
  copia: OpsBackup;
}

export interface OpsArchivoFila {
  isin: string;
  accion: string; // ARCHIVE | MISSING | SIN_PLAN
  existe: boolean;
  nombre: string | null;
  tipo: string | null;
  subdocs: number;
  en_indice: boolean;
  copia_previa: boolean;
  postverify: { archived_root?: boolean; archived_subdocs?: number; original_gone?: boolean; index_entry_gone?: boolean; ok?: boolean } | null;
}

export interface OpsArchivoEscritura {
  archivados: number | null;
  subdocs_copiados: number | null;
  borrados: number | null;
  indice_retirados: number | null;
  postverify_ok: number | null;
  postverify_fallidos: number | null;
  copias: string[];
  errores: unknown[];
}

/** Pasada en seco o archivo real de `archive:assets` (plataforma). */
export interface OpsArchivo {
  escribir: boolean;
  codigo: number;
  isins: string[];
  carpeta: string | null;
  run_id: string | null;
  motivo: string;
  recuento: Record<string, number | null>;
  no_existen: string[];
  archivables: number;
  filas: OpsArchivoFila[];
  escritura?: OpsArchivoEscritura;
  error?: string;
  mensaje?: string;
}

export interface OpsBajaFila {
  isin: string;
  estaba: boolean;
  ficheros_movidos: string[];
}

/** Resultado del archivo completo: maestra, baja del universo del extractor y canónico regenerado. */
export interface OpsArchivarResultado {
  archivo: OpsArchivo;
  baja: OpsBajaFila[] | null;
  canonico: OpsCanonicoResultado | null;
}

export interface OpsReclasificacionFila {
  isin: string;
  accion: string; // RECLASSIFY | REPAIR | SKIP | ERROR
  /** Código de la plataforma (NO_STOCK_CANONICAL, NOT_READY…); solo para lógica, no para pantalla. */
  razon: string | null;
  /** Motivo en español, ya redactado por el servicio. */
  motivo: string;
  /** Texto original de la plataforma cuando la fila es un error: va plegado como detalle técnico. */
  error: string | null;
  /** REPAIR: lo que se repara de una acción que ya lo es (search_index, metrics_latest). */
  reparaciones: string[];
  /** Avisos: HOLDINGS_LEFT (cartera de fondo colgando), METRICS_LATEST_FUND. */
  avisos: string[];
  cartera_colgando: string[];
  de: string | null;
  a: string | null;
  /** Bloques de la ficha que desaparecen al pasar a acción (costes, renta fija…). */
  quita: string[];
  /** MARK: se invalidan hasta el recálculo · CREATE_MARKER: no había y se crean para recalcular. */
  metricas: string | null;
  /** ADD | UPDATE | SAME */
  indice: string | null;
  postverify: { root?: boolean; metrics?: boolean; search_index?: boolean; ok?: boolean } | null;
}

export interface OpsReclasificacionEscritura {
  escritos: number | null;
  reparados: number | null;
  metricas_invalidadas: number | null;
  indice_escrito: boolean | null;
  postverify_ok: number | null;
  postverify_fallidos: number | null;
  errores: unknown[];
}

/** Pasada en seco o escritura de `reclassify:stock` (plataforma), ALTA-13. */
export interface OpsReclasificacion {
  escribir: boolean;
  codigo: number;
  isins: string[];
  carpeta: string | null;
  run_id: string | null;
  recuento: Record<string, number | null>;
  reclasificables: number;
  /** Carteras de fondo que siguen colgando de una acción: se listan, no se borran. */
  carteras_colgando: Array<{ isin: string; rutas: string[] }>;
  /** Acciones que conservan métricas de fondo sin reparar. */
  metricas_de_fondo: string[];
  filas: OpsReclasificacionFila[];
  escritura?: OpsReclasificacionEscritura;
  auditoria?: OpsAuditoria | null;
  error?: string;
  mensaje?: string;
}

export interface OpsCorreccion {
  isin: string;
  ruta: string;
  valor: string | number | boolean | null;
  motivo: string;
  autor: string;
  fecha: string;
}

export interface OpsCampoCorregible {
  ruta: string;
  valor: string | number | boolean | null;
  fuente: string | null;
  tipo: "texto" | "numero" | "booleano" | "vacio";
  correccion: Omit<OpsCorreccion, "isin" | "ruta"> | null;
  aplicada: { valor?: unknown; redundante?: boolean; valor_fuente?: unknown; fuente?: string | null } | null;
}

export interface OpsCorreccionesActivo {
  isin: string;
  con_ficha: boolean;
  correcciones: OpsCorreccion[];
  campos: OpsCampoCorregible[];
}
