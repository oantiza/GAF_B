export type CommercialRetroSource =
  | "ADMIN_UI"
  | "CSV_IMPORT"
  | "FILE_IMPORT"
  | "COSTS_MODAL"
  | "UNDO_IMPORT"
  | string;

export interface CommercialRetroRecord {
  isin: string;
  retro_pct: number;
  status?: "CONFIRMED" | "PENDING_CONFIRMATION";
  as_of_date: string;
  source: CommercialRetroSource;
  note?: string;
  updated_at?: string;
  updated_by?: string;
  /** Exact Firestore timestamp, used only for optimistic concurrency checks. */
  revision?: string;
}

export interface CommercialRetroInput {
  isin: string;
  retro_pct: number;
  status?: "CONFIRMED" | "PENDING_CONFIRMATION";
  as_of_date: string;
  source: CommercialRetroSource;
  note?: string;
}

/** Escala en la que vienen los valores de la columna de retrocesión.
 *  `fraccion`: la celda guarda 0,008 y Excel la muestra como 0,80 % (formato
 *  de porcentaje). `porcentaje`: la celda ya dice 0,80. */
export type CommercialRetroScale = "fraccion" | "porcentaje";

/** Fila tal cual se leyó del fichero: texto por columna y, si el origen es
 *  Excel, el valor tipado original (un número con formato % llega como 0,008
 *  y no debe pasar por el parser de texto europeo). */
export interface CommercialRetroRawRow {
  line_number: number;
  fields: string[];
  raw_line: string;
  values?: unknown[];
}

export interface CommercialRetroSheetColumns {
  /** Número de línea de la cabecera detectada; null si el fichero no la trae. */
  header_row: number | null;
  isin: number;
  retro: number;
  nombre?: number;
  fecha?: number;
  nota?: number;
}

export interface CommercialRetroSheet {
  rows: CommercialRetroRawRow[];
  columns: CommercialRetroSheetColumns | null;
  suggested_scale: CommercialRetroScale;
  sheet_names?: string[];
  sheet_index?: number;
}

export interface CommercialRetroImportEntry {
  isin: string;
  retro_pct: number;
  status?: "CONFIRMED" | "PENDING_CONFIRMATION";
  as_of_date: string;
  note?: string;
  line_number: number;
  /** Nombre que trae el fichero (no se guarda; sirve para contrastar con la maestra). */
  name?: string;
  /** Otras líneas del fichero con el mismo ISIN y el mismo valor (se colapsan). */
  duplicated_lines?: number[];
}

export interface CommercialRetroImportIssue {
  line_number: number;
  raw_line: string;
  message: string;
}

/** Un ISIN repetido con valores distintos: no entra hasta que se elige uno. */
export interface CommercialRetroImportConflict {
  isin: string;
  name?: string;
  values: { line_number: number; retro_pct: number }[];
}

export interface CommercialRetroInterpretation {
  entries: CommercialRetroImportEntry[];
  issues: CommercialRetroImportIssue[];
  conflicts: CommercialRetroImportConflict[];
  zero_isins: string[];
}

export interface CommercialRetroInterpretOptions {
  scale: CommercialRetroScale;
  /** Fecha de vigencia para las filas que no traen la suya. */
  as_of_date: string;
  /** Conflictos resueltos por el usuario: ISIN -> valor elegido (ya en %). */
  resolved_conflicts?: Record<string, number>;
}

export type CommercialRetroImportAction = "CREATE" | "UPDATE" | "UNCHANGED" | "DELETE" | "OUT_OF_MASTER";

export interface CommercialRetroImportPreviewRow {
  entry: CommercialRetroImportEntry;
  existing?: CommercialRetroRecord;
  action: CommercialRetroImportAction;
  changes: string[];
  warnings?: string[];
  master_name?: string;
}

export interface CommercialRetroPreviewOptions {
  /** ISIN que existen en la maestra; los demás no se pueden escribir (regla de Firestore). */
  existingAssetIds?: ReadonlySet<string> | null;
  masterNames?: ReadonlyMap<string, string>;
  /** El fichero es la lista completa: lo que no aparece se propone borrar. */
  replaceAll?: boolean;
}

export type CommercialRetroPreviewCounts = Record<CommercialRetroImportAction, number>;

export interface CommercialRetroSnapshot {
  retro_pct: number;
  status?: "CONFIRMED" | "PENDING_CONFIRMATION";
  as_of_date: string;
  source: CommercialRetroSource;
  note?: string;
}

export type CommercialRetroImportRunStatus = "applied" | "partial" | "undone";

/** Foto de una importación (colección `commercial_retro_imports`): lo que
 *  había antes y lo que se escribió, para poder deshacerla. */
export interface CommercialRetroImportRun {
  import_id: string;
  created_at?: string;
  created_by?: string;
  as_of_date: string;
  file_name?: string;
  scale: CommercialRetroScale;
  replace_all: boolean;
  counts: Partial<CommercialRetroPreviewCounts>;
  previous: Record<string, CommercialRetroSnapshot | null>;
  applied: Record<string, CommercialRetroSnapshot | "DELETE">;
  status: CommercialRetroImportRunStatus;
  applied_batches?: number;
  schema_version?: 2;
  applied_isins?: string[];
  undone_isins?: string[];
  undone_at?: string;
  undone_by?: string;
  error?: string;
}

export interface CommercialRetroApplyMeta {
  as_of_date: string;
  scale: CommercialRetroScale;
  replace_all: boolean;
  file_name?: string;
  source?: CommercialRetroSource;
}

export interface CommercialRetroApplyResult {
  import_id: string;
  written: number;
  deleted: number;
  batches: number;
}
