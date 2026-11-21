import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Aviso } from "./ui/Aviso";
import { Button } from "./ui/Button";
import { Campo } from "./ui/Campo";
import { FileUploadField } from "./ui/FileUploadField";
import { KpiStrip } from "./ui/KpiStrip";
import { DialogBody, DialogFooter, DialogHeader, ModalDialog } from "./ui/ModalDialog";
import { useConfirm } from "./ui/useConfirm";
import { getAssetDataSource } from "../adapters/assetDataSource";
import {
  applyCommercialRetroImport,
  deleteCommercialRetro,
  getCommercialRetroList,
  getLastCommercialRetroImport,
  saveCommercialRetro,
  undoCommercialRetroImport
} from "../adapters/commercialRetroStore";
import {
  buildCommercialRetroPreview,
  countCommercialRetroWrites,
  diaDeHoyLocal,
  exportCommercialRetroCsv,
  exportCommercialRetroPreviewCsv,
  interpretCommercialRetroSheet,
  normalizeCommercialIsin,
  parseCommercialRetroNumber,
  readCommercialRetroFile,
  readCommercialRetroText,
  summarizeCommercialRetroPreview
} from "../core/commercialRetroCsv";
import { loQueCobraElFondo, retrocesionesQueSuperanLoQueCobra, type LoQueCobraElFondo } from "../core/commercialRetroEffective";
import { buildCommercialRetroXlsx, COMMERCIAL_RETRO_TEMPLATE_ROWS } from "../core/commercialRetroXlsx";
import { descargar, hoy, nombreDelFichero } from "../core/descargaDeFicheros";
import { FIREBASE_CONFIGURED } from "../firebaseEnv";
import { fecha, fechaYHora, porcentaje } from "../core/formato";
import { textoDeAusencia } from "../core/textoDeAusencia";
import { normalizeSearchValue } from "../core/assetMapping";
import type {
  CommercialRetroImportAction,
  CommercialRetroImportPreviewRow,
  CommercialRetroImportRun,
  CommercialRetroRecord,
  CommercialRetroScale,
  CommercialRetroSheet
} from "../types/commercialRetro";
import { Panel } from "./ui/Panel";

/* PLA-12: fechas y recuentos con el formato común de la aplicación («13/11/2026», «13/11/2026 10:30», «1.097»), y lo
   que no llega se dice con su palabra: nunca una raya ni «N/D», que se leen como un dato. */
const FALTA = textoDeAusencia("falta");
const diaDe = (iso?: string | null) => (iso ? (fecha(iso) ?? iso) : FALTA);
const momentoDe = (iso?: string | null) => (iso ? (fechaYHora(iso) ?? iso) : FALTA);

interface Draft {
  isin: string;
  retro_pct: string;
  as_of_date: string;
  note: string;
}

const SOURCE_KIND = FIREBASE_CONFIGURED ? "BBDD_LIVE_API" : "LOCAL_MOCK";

/** Etiquetas de origen del dato: el usuario no lee constantes del backend. */
const SOURCE_LABELS: Record<string, string> = {
  ADMIN_UI: "Alta manual",
  CSV_IMPORT: "Importación CSV",
  FILE_IMPORT: "Importación de fichero",
  UNDO_IMPORT: "Importación deshecha",
  COSTS_MODAL: "Ficha de costes"
};

const ACTION_LABELS: Record<CommercialRetroImportAction, string> = {
  CREATE: "Crear",
  UPDATE: "Actualizar",
  UNCHANGED: "Sin cambios",
  DELETE: "Eliminar",
  OUT_OF_MASTER: "Fuera del catálogo"
};

const SCALE_LABELS: Record<CommercialRetroScale, string> = {
  fraccion: "Fracción con formato % de Excel (0,008 = 0,80 %)",
  porcentaje: "Porcentaje (0,80 = 0,80 %)"
};

const MAX_LISTED = 8;

/** U-11: siempre tres decimales («0,375 %»), la precisión con que se dan de alta las retrocesiones. */
function fmtRetro(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? (porcentaje(value / 100, { decimales: 3 }) ?? FALTA) : FALTA;
}

const fmtDay = (value?: string) => diaDe(value);

/* El día del calendario del asesor, no el de Greenwich (PLA-09). */
function todayIso(): string {
  return diaDeHoyLocal();
}

function fileDateIso(file: File): string {
  const date = new Date(file.lastModified);
  return Number.isNaN(date.getTime()) ? todayIso() : diaDeHoyLocal(date);
}

function toDraft(record: CommercialRetroRecord): Draft {
  return {
    isin: record.isin,
    /* Con coma, como el campo pide y como lee `parseCommercialRetroNumber`: junto a un «0,45» de
       ejemplo, un «0.7881» parecía otro formato. */
    retro_pct: record.status === "PENDING_CONFIRMATION" ? "" : String(record.retro_pct).replace(".", ","),
    as_of_date: record.as_of_date,
    note: record.note ?? ""
  };
}

/** Lo que no vale de un borrador, y en qué campo: el error de una fila se dice junto a su campo (PLA-13). */
function validateDraft(draft: Draft): { campo: keyof Draft; mensaje: string } | null {
  const retro = parseCommercialRetroNumber(draft.retro_pct);
  if (!/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(normalizeCommercialIsin(draft.isin))) {
    return { campo: "isin", mensaje: "ISIN no válido." };
  }
  if (!Number.isFinite(retro) || retro < 0 || retro > 100) {
    return { campo: "retro_pct", mensaje: "Retrocesión fuera de rango 0-100." };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.as_of_date)) {
    return { campo: "as_of_date", mensaje: "Fecha de vigencia no válida; usa AAAA-MM-DD." };
  }
  return null;
}

/** Lo tecleado en una fila coincide con lo guardado: no hay nada que perder. */
function mismoBorrador(a: Draft, b: Draft): boolean {
  return a.retro_pct === b.retro_pct && a.as_of_date === b.as_of_date && a.note === b.note;
}

function listSome(values: string[]): string {
  if (values.length <= MAX_LISTED) return values.join(", ");
  return `${values.slice(0, MAX_LISTED).join(", ")} y ${values.length - MAX_LISTED} más`;
}

function columnLetter(index: number): string {
  let out = "";
  let n = index;
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

interface MasterCheck {
  existingIds: Set<string> | null;
  names: Map<string, string>;
}

export function AdminRetrocessions() {
  const [records, setRecords] = useState<CommercialRetroRecord[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [newDraft, setNewDraft] = useState<Draft>({ isin: "", retro_pct: "", as_of_date: "", note: "" });
  const [names, setNames] = useState<Record<string, string>>({});
  /* Lo que cobra cada fondo según su ficha, para la lista de la decisión A-167. Llega con los nombres. */
  const [loQueCobra, setLoQueCobra] = useState<ReadonlyMap<string, LoQueCobraElFondo>>(new Map());
  const [soloLasQueSuperan, setSoloLasQueSuperan] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [namesLoading, setNamesLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [namesError, setNamesError] = useState<string | null>(null);
  /* El error de guardar una fila, para decirlo junto a ella y no solo arriba del todo (PLA-13). */
  const [errorDeFila, setErrorDeFila] = useState<{ isin: string; campo: keyof Draft | null; mensaje: string } | null>(null);
  const { confirm, confirmDialog } = useConfirm();

  // Importación por pasos: fichero → interpretación → contraste → aplicar.
  const fileRef = useRef<File | null>(null);
  const [importText, setImportText] = useState("");
  const [sheet, setSheet] = useState<CommercialRetroSheet | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [scale, setScale] = useState<CommercialRetroScale>("porcentaje");
  const [asOfDate, setAsOfDate] = useState(todayIso);
  const [replaceAll, setReplaceAll] = useState(false);
  const [resolvedConflicts, setResolvedConflicts] = useState<Record<string, number>>({});
  const [masterCheck, setMasterCheck] = useState<MasterCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmCount, setConfirmCount] = useState("");
  const [applyProgress, setApplyProgress] = useState<{ done: number; total: number } | null>(null);
  const [lastRun, setLastRun] = useState<CommercialRetroImportRun | null>(null);
  const [undoOpen, setUndoOpen] = useState(false);

  const existingByIsin = useMemo(() => new Map(records.map((record) => [record.isin, record])), [records]);
  /* Lo guardado tal como lo vio la última carga: con ello se sabe qué filas tienen cambios sin guardar al recargar. */
  const registrosVistos = useRef(existingByIsin);
  useEffect(() => {
    registrosVistos.current = existingByIsin;
  }, [existingByIsin]);
  /* Las filas con algo tecleado y sin guardar: recargar desde la base lo tiraría (PLA-08). */
  const filasSinGuardar = useMemo(
    () => records.filter((record) => drafts[record.isin] && !mismoBorrador(drafts[record.isin], toDraft(record))).map((record) => record.isin),
    [drafts, records]
  );
  /* Decisión A-167 (16-11-2026): la retrocesión que supera lo que cobra su fondo se corrige aquí, y esta es la lista. */
  const superan = useMemo(
    () => new Map(retrocesionesQueSuperanLoQueCobra(records, loQueCobra).map((item) => [item.isin, item])),
    [loQueCobra, records]
  );
  const filtraLasQueSuperan = soloLasQueSuperan && superan.size > 0;
  const filteredRecords = useMemo(() => {
    const base = filtraLasQueSuperan ? records.filter((record) => superan.has(record.isin)) : records;
    const query = normalizeSearchValue(searchTerm).trim();
    if (!query) return base;
    const terms = query.split(/\s+/);
    return base.filter((record) => {
      const name = normalizeSearchValue(names[record.isin] ?? "");
      return record.isin.toLowerCase().includes(query.replace(/\s+/g, ""))
        || terms.every((term) => name.includes(term));
    });
  }, [filtraLasQueSuperan, names, records, searchTerm, superan]);
  /* Los valores cargados conviven en escalas distintas (0,338 junto a 46). No
     se corrige el dato — eso es decisión de negocio — pero se marca lo que se
     sale un orden de magnitud de la mediana para poder revisarlo. */
  const outlierIsins = useMemo(() => {
    const values = records
      .filter((record) => record.status !== "PENDING_CONFIRMATION")
      .map((record) => record.retro_pct)
      .filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0)
      .sort((a, b) => a - b);
    if (values.length < 5) return new Set<string>();
    const median = values[Math.floor(values.length / 2)];
    if (!median) return new Set<string>();
    return new Set(
      records
        .filter((record) => typeof record.retro_pct === "number" && record.retro_pct >= median * 10)
        .map((record) => record.isin)
    );
  }, [records]);

  const interpretation = useMemo(
    () => (sheet ? interpretCommercialRetroSheet(sheet, { scale, as_of_date: asOfDate, resolved_conflicts: resolvedConflicts }) : null),
    [sheet, scale, asOfDate, resolvedConflicts]
  );

  const preview: CommercialRetroImportPreviewRow[] | null = useMemo(() => {
    if (!interpretation || !masterCheck) return null;
    return buildCommercialRetroPreview(interpretation.entries, existingByIsin, {
      existingAssetIds: masterCheck.existingIds,
      masterNames: masterCheck.names,
      replaceAll
    });
  }, [interpretation, masterCheck, existingByIsin, replaceAll]);

  const previewCounts = useMemo(() => (preview ? summarizeCommercialRetroPreview(preview) : null), [preview]);
  const writeCount = preview ? countCommercialRetroWrites(preview) : 0;

  const resolveNames = useCallback(async (nextRecords: CommercialRetroRecord[]) => {
    const source = getAssetDataSource(SOURCE_KIND);
    setNamesLoading(true);
    try {
      const details = await source.getComparableAssets(nextRecords.map((record) => record.isin));
      // La maestra puede indexar por id interno o por ISIN: se registran ambos
      // para que la tabla encuentre el nombre en cualquiera de los dos casos.
      const resolvedNames: Record<string, string> = {};
      const cobran = new Map<string, LoQueCobraElFondo>();
      details.forEach((detail) => {
        const cobra = loQueCobraElFondo(detail);
        if (cobra) {
          cobran.set(detail.asset_id, cobra);
          if (detail.isin) cobran.set(detail.isin, cobra);
        }
        if (!detail.display_name) return;
        resolvedNames[detail.asset_id] = detail.display_name;
        if (detail.isin) resolvedNames[detail.isin] = detail.display_name;
      });
      setNames((current) => ({ ...current, ...resolvedNames }));
      setLoQueCobra((current) => new Map([...current, ...cobran]));
      setNamesError(null);
    } catch (e) {
      // Los nombres son auxiliares, pero el fallo no puede quedar mudo: si
      // toda la columna sale vacía hay que poder saber por qué.
      setNamesError(e instanceof Error ? e.message : "No se pudieron resolver los nombres de los activos.");
    } finally {
      setNamesLoading(false);
    }
  }, []);

  const loadLastRun = useCallback(async () => {
    if (!FIREBASE_CONFIGURED) return;
    try {
      setLastRun(await getLastCommercialRetroImport());
    } catch {
      // Sin historial no se ofrece «Deshacer»; el resto de la pestaña sigue.
      setLastRun(null);
    }
  }, []);

  /**
   * Lee la tabla de la base. Con `conservarEdiciones`, lo tecleado y sin guardar en una fila se queda: es lo que pasa
   * tras aplicar o deshacer una importación. Sin él, se tira; quien llama ya ha preguntado (PLA-08).
   */
  const load = useCallback(async (opciones: { conservarEdiciones?: boolean } = {}) => {
    setLoading(true);
    setError(null);
    try {
      const list = await getCommercialRetroList(true);
      setRecords(list);
      setDrafts((actuales) =>
        Object.fromEntries(
          list.map((record) => {
            const actual = actuales[record.isin];
            const antes = registrosVistos.current.get(record.isin);
            const sinGuardar = opciones.conservarEdiciones && actual && antes && !mismoBorrador(actual, toDraft(antes));
            return [record.isin, sinGuardar ? actual : toDraft(record)];
          })
        )
      );
      setErrorDeFila(null);
      setNames({});
      setLoQueCobra(new Map());
      void resolveNames(list);
      void loadLastRun();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron cargar las retrocesiones.");
    } finally {
      setLoading(false);
    }
  }, [resolveNames, loadLastRun]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Antes de tirar lo tecleado en las filas, se avisa y se pregunta. Sin nada sin guardar, no se pregunta. */
  async function descartarEdiciones(): Promise<boolean> {
    if (filasSinGuardar.length === 0) return true;
    const cuantas = filasSinGuardar.length;
    return confirm({
      title: "¿Descartar los cambios sin guardar?",
      message: `${cuantas} ${cuantas === 1 ? "fila" : "filas"} con cambios sin guardar: ${listSome(filasSinGuardar)}. Si sigues, la tabla se vuelve a leer de la base y lo tecleado se pierde.`,
      confirmLabel: "Descartar los cambios",
      cancelLabel: "Seguir editando",
      tone: "danger"
    });
  }

  async function refrescar() {
    if (!(await descartarEdiciones())) return;
    await load();
  }

  /** Guarda una fila de la tabla o, con `desdeElAlta`, el formulario «Añadir»: solo ese se vacía al guardar (PLA-08). */
  async function saveDraft(
    isin: string,
    draft: Draft,
    { desdeElAlta = false, source = "ADMIN_UI" }: { desdeElAlta?: boolean; source?: "ADMIN_UI" | "COSTS_MODAL" } = {}
  ) {
    const validation = validateDraft(draft);
    if (validation) {
      if (desdeElAlta) {
        setError(validation.mensaje);
      } else {
        setError(`${isin}: ${validation.mensaje}`);
        setErrorDeFila({ isin, campo: validation.campo, mensaje: validation.mensaje });
      }
      return;
    }
    setSavingKey(isin);
    setError(null);
    setErrorDeFila(null);
    setNotice(null);
    try {
      const saved = await saveCommercialRetro({
        isin: draft.isin,
        retro_pct: parseCommercialRetroNumber(draft.retro_pct),
        as_of_date: draft.as_of_date,
        source,
        note: draft.note
      });
      setRecords((current) => [saved, ...current.filter((record) => record.isin !== saved.isin)].sort((a, b) => a.isin.localeCompare(b.isin)));
      setDrafts((current) => ({ ...current, [saved.isin]: toDraft(saved) }));
      if (desdeElAlta) setNewDraft({ isin: "", retro_pct: "", as_of_date: "", note: "" });
      setNotice(`Retrocesión guardada para ${saved.isin}.`);
      void resolveNames([saved]);
    } catch (e) {
      const mensaje = e instanceof Error ? e.message : "No se pudo guardar la retrocesión.";
      setError(desdeElAlta ? mensaje : `${isin}: ${mensaje}`);
      if (!desdeElAlta) setErrorDeFila({ isin, campo: null, mensaje });
    } finally {
      setSavingKey(null);
    }
  }

  async function removeRecord(isin: string) {
    setPendingDelete(null);
    setSavingKey(isin);
    setError(null);
    setNotice(null);
    try {
      await deleteCommercialRetro(isin);
      setRecords((current) => current.filter((record) => record.isin !== isin));
      setDrafts((current) => {
        const next = { ...current };
        delete next[isin];
        return next;
      });
      setNames((current) => {
        const next = { ...current };
        delete next[isin];
        return next;
      });
      setNotice(`Retrocesión borrada para ${isin}.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo borrar la retrocesión.");
    } finally {
      setSavingKey(null);
    }
  }

  /* ------------------------------------------------------------- paso 1 */
  function resetImport() {
    setMasterCheck(null);
    setResolvedConflicts({});
    setConfirmOpen(false);
    setConfirmCount("");
  }

  function adoptSheet(next: CommercialRetroSheet, name: string | null, date: string) {
    setSheet(next);
    setFileName(name);
    setScale(next.suggested_scale);
    setAsOfDate(date);
    resetImport();
    setError(null);
    if (!next.columns) {
      setNotice(null);
      setError(
        next.rows.length === 0
          ? "El fichero no contiene filas de datos (o el .xls antiguo no está soportado: expórtalo a .xlsx o CSV)."
          : "No encuentro una columna con ISIN válidos ni una columna numérica de retrocesión."
      );
      return;
    }
    setNotice(`Fichero leído: ${next.rows.length - (next.columns.header_row ? 1 : 0)} fila(s).`);
  }

  async function readFile(file: File, sheetIndex = 0) {
    setError(null);
    setNotice(null);
    fileRef.current = file;
    try {
      const next = await readCommercialRetroFile(file, sheetIndex);
      setImportText("");
      adoptSheet(next, file.name, fileDateIso(file));
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo leer el archivo.");
    }
  }

  function readText() {
    adoptSheet(readCommercialRetroText(importText), null, todayIso());
  }

  /* ------------------------------------------------------------- paso 2 */
  async function checkAgainstMaster() {
    if (!interpretation) return;
    /* La pasada en seco vuelve a leer la tabla: lo tecleado y sin guardar en una fila se perdería. */
    if (!(await descartarEdiciones())) return;
    setChecking(true);
    setError(null);
    setNotice(null);
    try {
      const list = await getCommercialRetroList(true);
      setRecords(list);
      setDrafts(Object.fromEntries(list.map((record) => [record.isin, toDraft(record)])));
      // También los ISIN en conflicto: al resolverlos entran en la vista previa
      // sin repetir la consulta, y necesitan saber si están en la maestra.
      const isins = [...new Set([
        ...interpretation.entries.map((entry) => entry.isin),
        ...interpretation.conflicts.map((conflict) => conflict.isin),
        ...list.map((record) => record.isin)
      ])];
      const details = await getAssetDataSource(SOURCE_KIND).getComparableAssets(isins);
      const masterNames = new Map<string, string>();
      const existing = new Set<string>();
      details.forEach((detail) => {
        existing.add(detail.asset_id);
        if (detail.isin) existing.add(normalizeCommercialIsin(detail.isin));
        if (detail.display_name) {
          masterNames.set(detail.asset_id, detail.display_name);
          if (detail.isin) masterNames.set(normalizeCommercialIsin(detail.isin), detail.display_name);
        }
      });
      setNames((current) => ({ ...current, ...Object.fromEntries(masterNames) }));
      // Sin Firebase no hay maestra que consultar: se enseña la vista previa
      // completa sin marcar nada como fuera de la maestra (tampoco se podrá guardar).
      setMasterCheck({ existingIds: FIREBASE_CONFIGURED ? existing : null, names: masterNames });
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo contrastar el fichero con el catálogo.");
    } finally {
      setChecking(false);
    }
  }

  /* ------------------------------------------------------------- paso 3 */
  async function applyImport() {
    if (!preview || writeCount === 0) return;
    setConfirmOpen(false);
    setSavingKey("import");
    setError(null);
    setNotice(null);
    setApplyProgress({ done: 0, total: writeCount });
    try {
      const result = await applyCommercialRetroImport(
        preview,
        { as_of_date: asOfDate, scale, replace_all: replaceAll, file_name: fileName ?? undefined, source: "FILE_IMPORT" },
        (done, total) => setApplyProgress({ done, total })
      );
      setNotice(
        `Importación aplicada: ${result.written} alta(s)/actualización(es)${result.deleted ? `, ${result.deleted} borrado(s)` : ""} en ${result.batches} lote(s). Referencia ${result.import_id}.`
      );
      setSheet(null);
      setFileName(null);
      fileRef.current = null;
      resetImport();
      await load({ conservarEdiciones: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo aplicar la importación.");
      await load({ conservarEdiciones: true });
    } finally {
      setSavingKey(null);
      setApplyProgress(null);
    }
  }

  async function undoLastImport() {
    if (!lastRun) return;
    setUndoOpen(false);
    setSavingKey("undo");
    setError(null);
    setNotice(null);
    try {
      const result = await undoCommercialRetroImport(lastRun, (done, total) => setApplyProgress({ done, total }));
      setNotice(`Importación ${lastRun.import_id} deshecha: ${result.restored} restaurada(s), ${result.deleted} borrada(s).`);
      await load({ conservarEdiciones: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo deshacer la importación.");
    } finally {
      setSavingKey(null);
      setApplyProgress(null);
    }
  }

  /* --------------------------------------------------------- descargas */
  function downloadCsv() {
    /* Con la función común (INF-26) y con el nombre de todos los ficheros: qué es y de qué día (INF-25). */
    descargar(new Blob([exportCommercialRetroCsv(records)], { type: "text/csv;charset=utf-8" }), nombreDelFichero({ documento: "Retrocesiones", fecha: hoy(), extension: "csv" }));
  }

  async function downloadXlsx(template = false) {
    setError(null);
    try {
      const rows = template
        ? COMMERCIAL_RETRO_TEMPLATE_ROWS
        : records.filter((record) => record.status !== "PENDING_CONFIRMATION").map((record) => ({ nombre: names[record.isin] ?? "", isin: record.isin, retro_pct: record.retro_pct }));
      const bytes = await buildCommercialRetroXlsx(rows);
      const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      descargar(
        new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
        template ? nombreDelFichero({ documento: "Plantilla de retrocesiones", extension: "xlsx" }) : nombreDelFichero({ documento: "Retrocesiones", fecha: hoy(), extension: "xlsx" })
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo generar el Excel.");
    }
  }

  function downloadPreview() {
    if (!preview) return;
    descargar(new Blob([exportCommercialRetroPreviewCsv(preview)], { type: "text/csv;charset=utf-8" }), nombreDelFichero({ documento: "Retrocesiones, pasada en seco", fecha: hoy(), extension: "csv" }));
  }

  const columns = sheet?.columns ?? null;
  const columnSummary = columns
    ? [
      `ISIN → ${columnLetter(columns.isin)}`,
      `Retrocesión → ${columnLetter(columns.retro)}`,
      columns.nombre != null ? `Nombre → ${columnLetter(columns.nombre)}` : null,
      columns.fecha != null ? `Fecha → ${columnLetter(columns.fecha)}` : null,
      columns.nota != null ? `Nota → ${columnLetter(columns.nota)}` : null,
      columns.header_row ? `cabecera en la fila ${columns.header_row}` : "sin cabecera"
    ].filter(Boolean).join(" · ")
    : null;
  const canUndo = Boolean(lastRun && lastRun.status !== "undone" && Object.keys(lastRun.previous).length > 0);
  const busy = savingKey != null;

  return (
    <div className="retro-admin">
      <Panel
        acciones={<>
          <Button size="sm" onClick={() => void refrescar()} busy={loading}>
            {loading ? "Cargando…" : "Refrescar"}
          </Button>
          <Button size="sm" onClick={() => void downloadXlsx(false)} disabled={records.length === 0}>
            Descargar en Excel
          </Button>
          <Button size="sm" onClick={downloadCsv} disabled={records.length === 0}>
            Descargar en CSV
          </Button>
          {canUndo ? (
            <Button size="sm" variant="danger" onClick={() => setUndoOpen(true)} disabled={busy}>
              Deshacer última importación
            </Button>
          ) : null}
        </>}
        subtitulo="Dato comercial: no modifica el catálogo de activos."
        titulo="Retrocesiones comerciales"
      >
        {!FIREBASE_CONFIGURED ? (
          <Aviso>Firebase no está configurado en esta sesión; podrás previsualizar cargas, pero no guardar.</Aviso>
        ) : null}
        {error ? (
          <Aviso tono="error">{error}</Aviso>
        ) : null}
        {notice ? (
          <Aviso anunciar tono="nota">{notice}</Aviso>
        ) : null}
        {namesError ? (
          <Aviso>La columna «Nombre» no se ha podido resolver contra el catálogo: {namesError}</Aviso>
        ) : null}
        {applyProgress ? (
          <Aviso anunciar tono="nota">Escribiendo {applyProgress.done} de {applyProgress.total} cambios…</Aviso>
        ) : null}

        <div className="retro-new-row">
          <Campo rotulo="ISIN">
            <input
              value={newDraft.isin}
              onChange={(event) => setNewDraft((current) => ({ ...current, isin: event.target.value.toUpperCase() }))}
              placeholder="ES0000000000"
              className="retro-mono-input"
            />
          </Campo>
          <Campo rotulo="Retrocesión %">
            <input
              value={newDraft.retro_pct}
              onChange={(event) => setNewDraft((current) => ({ ...current, retro_pct: event.target.value }))}
              placeholder="0,45"
              inputMode="decimal"
              className="retro-num-input"
            />
          </Campo>
          <Campo rotulo="Vigente desde">
            <input
              type="date"
              value={newDraft.as_of_date}
              onChange={(event) => setNewDraft((current) => ({ ...current, as_of_date: event.target.value }))}
            />
          </Campo>
          <Campo rotulo="Nota">
            <input
              value={newDraft.note}
              onChange={(event) => setNewDraft((current) => ({ ...current, note: event.target.value }))}
              placeholder="Opcional"
            />
          </Campo>
          <Button variant="primary" onClick={() => saveDraft(newDraft.isin || "new", newDraft, { desdeElAlta: true })} disabled={busy}>
            Añadir
          </Button>
        </div>

        <div className="retro-search-row" role="search" aria-label="Buscar retrocesiones">
          <Campo rotulo="Buscar fondo por ISIN o nombre">
            <input
              type="search"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Escribe un ISIN o parte del nombre del fondo"
              aria-controls="retro-records-table"
            />
          </Campo>
          {searchTerm ? <Button onClick={() => setSearchTerm("")} variant="quiet">Limpiar búsqueda</Button> : null}
          {superan.size > 0 ? (
            <Button onClick={() => setSoloLasQueSuperan((actual) => !actual)} variant="quiet" aria-pressed={filtraLasQueSuperan}>
              {filtraLasQueSuperan
                ? "Ver todas"
                : superan.size === 1 ? "Ver la que supera lo que cobra su fondo" : `Ver las ${superan.size} que superan lo que cobra su fondo`}
            </Button>
          ) : null}
          <p className="field__hint" role="status">
            {loading ? "Cargando retrocesiones…" : `${filteredRecords.length} de ${records.length} fondos`}
            {filtraLasQueSuperan ? " · Solo las que superan lo que cobra su fondo." : ""}
            {namesLoading ? " · Cargando nombres; ya puedes buscar por ISIN." : ""}
          </p>
        </div>

        <div aria-label="Retrocesiones registradas (tabla desplazable)" className="report-table-wrapper retro-table-wrapper" role="group" tabIndex={0}>
          <table className="report-table retro-table" id="retro-records-table" aria-label="Retrocesiones registradas">
            <thead>
              <tr>
                <th scope="col">ISIN</th>
                <th scope="col">Nombre</th>
                <th scope="col" className="num">Retro %</th>
                <th scope="col">Vigente desde</th>
                <th scope="col">Nota</th>
                <th scope="col">Fuente</th>
                <th scope="col">Actualizado</th>
                <th scope="col"><span className="ui-visually-hidden">Acciones</span></th>
              </tr>
            </thead>
            <tbody>
              {filteredRecords.length === 0 ? (
                <tr>
                  <td colSpan={8} className="retro-empty">
                    {loading ? "Cargando retrocesiones…" : searchTerm.trim()
                      ? "No hay coincidencias entre las retrocesiones cargadas. Prueba con el ISIN completo; si no tiene retrocesión registrada, puedes añadirla en el formulario superior."
                      : "Sin retrocesiones cargadas."}
                  </td>
                </tr>
              ) : (
                filteredRecords.map((record) => {
                  const draft = drafts[record.isin] ?? toDraft(record);
                  const errorAqui = errorDeFila?.isin === record.isin ? errorDeFila : null;
                  return (
                    <tr key={record.isin}>
                      <td className="retro-isin">{record.isin}</td>
                      {/* La clase va dentro: con `display: flex` en el propio `<td>`, la celda deja de ser
                          celda y el filete de la fila se corta en esa columna. */}
                      <td title={names[record.isin] || undefined}>
                        <div className="cell-entity">
                          {names[record.isin] || FALTA}
                          {/* A-167. La frase va aquí y no junto a la cifra: en la columna «Retro %» no cabe y se montaba sobre el nombre. */}
                          {superan.has(record.isin) ? (
                            <span className="cell-entity__code cell-entity__code--text retro-outlier" title="Una retrocesión es parte de lo que cobra el fondo y no puede superarlo: comprueba la cifra, su escala o los costes de la ficha.">
                              Su retrocesión supera el {porcentaje(superan.get(record.isin)?.tope)} de {superan.get(record.isin)?.frenteA} del fondo
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="num">
                        <div className="retro-value-cell">
                          <input
                            aria-label={`Retrocesión de ${record.isin}`}
                            aria-invalid={errorAqui?.campo === "retro_pct" || undefined}
                            aria-describedby={errorAqui && (errorAqui.campo === "retro_pct" || errorAqui.campo === null) ? `retro-error-${record.isin}` : undefined}
                            value={draft.retro_pct}
                            inputMode="decimal"
                            onChange={(event) => setDrafts((current) => ({ ...current, [record.isin]: { ...draft, retro_pct: event.target.value } }))}
                            className="retro-num-input"
                          />
                          {record.status === "PENDING_CONFIRMATION" ? <span className="retro-outlier">Pendiente de confirmar</span> : null}
                          {/* La que supera lo que cobra su fondo ya lo dice bajo el nombre: aquí otra marca estrecha la cifra. */}
                          {!superan.has(record.isin) && outlierIsins.has(record.isin) ? (
                            <span className="retro-outlier" title="Se aparta más de un orden de magnitud de la mediana de la tabla: comprueba la escala.">
                              revisar
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td>
                        <input
                          type="date"
                          aria-label={`Vigente desde para ${record.isin}`}
                          aria-invalid={errorAqui?.campo === "as_of_date" || undefined}
                          aria-describedby={errorAqui?.campo === "as_of_date" ? `retro-error-${record.isin}` : undefined}
                          value={draft.as_of_date}
                          onChange={(event) => setDrafts((current) => ({ ...current, [record.isin]: { ...draft, as_of_date: event.target.value } }))}
                          className="retro-date-input"
                        />
                      </td>
                      <td>
                        <input
                          aria-label={`Nota de ${record.isin}`}
                          value={draft.note}
                          onChange={(event) => setDrafts((current) => ({ ...current, [record.isin]: { ...draft, note: event.target.value } }))}
                        />
                      </td>
                      <td>{SOURCE_LABELS[record.source] ?? record.source}</td>
                      <td>
                        <div className="retro-updated">
                          <span>{momentoDe(record.updated_at)}</span>
                          <span>{record.updated_by ?? FALTA}</span>
                        </div>
                      </td>
                      <td>
                        <div className="retro-row-actions">
                          <Button size="sm" disabled={busy} busy={savingKey === record.isin} onClick={() => saveDraft(record.isin, draft)}>
                            Guardar
                          </Button>
                          <Button size="sm" variant="danger" disabled={busy} onClick={() => setPendingDelete(record.isin)}>
                            Eliminar
                          </Button>
                        </div>
                        {errorAqui ? <span className="field__error" id={`retro-error-${record.isin}`}>{errorAqui.mensaje}</span> : null}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* Paso 1 · fichero -------------------------------------------------- */}
      <Panel
        acciones={<>
          <Button size="sm" onClick={() => void downloadXlsx(true)}>
            Plantilla Excel
          </Button>
        </>}
        subtitulo="Columnas por cabecera: isin y retro obligatorias; nombre, fecha y nota opcionales, en cualquier orden. Sin cabecera vale el formato compacto isin;retro."
        titulo="Importar desde Excel o CSV"
      >
        <label className="field">
          <span className="ui-visually-hidden">Contenido CSV</span>
          <textarea
            value={importText}
            onChange={(event) => setImportText(event.target.value)}
            rows={5}
            placeholder={"nombre;isin;retro\nFondo Ejemplo A Acc EUR;IE00B4L5Y983;0,45"}
            className="retro-import-text"
          />
        </label>
        <div className="retro-import-actions">
          <FileUploadField
            label="Archivo"
            accept=".csv,.txt,.tsv,.xlsx"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void readFile(file);
            }}
          />
          <div className="retro-import-buttons">
            <Button onClick={readText} disabled={importText.trim().length === 0}>
              Leer el texto pegado
            </Button>
          </div>
        </div>

        {sheet && columns ? (
          <div className="retro-import-config">
            <p className="retro-import-columns">
              {fileName ? <span className="retro-import-file">{fileName}</span> : <span className="retro-import-file">Texto pegado</span>}
              <span>{columnSummary}</span>
            </p>
            {sheet.sheet_names && sheet.sheet_names.length > 1 ? (
              <Campo rotulo="Hoja">
                <select
                  value={sheet.sheet_index ?? 0}
                  onChange={(event) => {
                    if (fileRef.current) void readFile(fileRef.current, Number(event.target.value));
                  }}
                >
                  {sheet.sheet_names.map((name, index) => (
                    <option key={name} value={index}>{name}</option>
                  ))}
                </select>
              </Campo>
            ) : null}
            <Campo rotulo="Escala de la columna de retrocesión">
              <select
                value={scale}
                onChange={(event) => {
                  setScale(event.target.value as CommercialRetroScale);
                  setResolvedConflicts({});
                }}
              >
                {(Object.keys(SCALE_LABELS) as CommercialRetroScale[]).map((option) => (
                  <option key={option} value={option}>
                    {SCALE_LABELS[option]}{option === sheet.suggested_scale ? " · sugerida" : ""}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo rotulo="Vigente desde (filas sin fecha)">
              <input type="date" value={asOfDate} onChange={(event) => setAsOfDate(event.target.value)} className="retro-date-input" />
            </Campo>
            <label className="retro-check">
              <input type="checkbox" checked={replaceAll} onChange={(event) => setReplaceAll(event.target.checked)} />
              <span>El fichero es la lista completa: proponer borrar las retrocesiones que no aparezcan</span>
            </label>
            <div className="retro-import-buttons">
              <Button variant="primary" onClick={() => void checkAgainstMaster()} busy={checking} disabled={busy || !interpretation || interpretation.entries.length === 0}>
                Pasada en seco
              </Button>
            </div>
          </div>
        ) : null}
      </Panel>

      {interpretation && interpretation.issues.length > 0 ? (
        <Aviso titulo={`${interpretation.issues.length} fila(s) no válidas (no se importan).`} tono="error">
          <ul>
            {interpretation.issues.slice(0, MAX_LISTED).map((issue) => (
              <li key={`${issue.line_number}-${issue.message}`}>
                Línea {issue.line_number}: {issue.message}
              </li>
            ))}
            {interpretation.issues.length > MAX_LISTED ? <li>y {interpretation.issues.length - MAX_LISTED} más</li> : null}
          </ul>
        </Aviso>
      ) : null}

      {interpretation && interpretation.conflicts.length > 0 ? (
        <Aviso titulo={`${interpretation.conflicts.length} ISIN repetido(s) con valores distintos: elige uno o quedan fuera.`}>
          <ul className="retro-conflicts">
            {interpretation.conflicts.map((conflict) => (
              <li key={conflict.isin}>
                <span className="retro-isin">{conflict.isin}</span>
                {conflict.name ? <span className="retro-conflict-name">{conflict.name}</span> : null}
                <select
                  aria-label={`Valor a importar para ${conflict.isin}`}
                  value=""
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    if (Number.isFinite(value)) setResolvedConflicts((current) => ({ ...current, [conflict.isin]: value }));
                  }}
                >
                  <option value="">Elegir…</option>
                  {conflict.values.map((value) => (
                    <option key={`${value.line_number}`} value={value.retro_pct}>
                      {fmtRetro(value.retro_pct)} (línea {value.line_number})
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        </Aviso>
      ) : null}

      {interpretation && interpretation.zero_isins.length > 0 ? (
        <Aviso>{interpretation.zero_isins.length} fondo(s) con retrocesión 0 (se guardan como 0, clase sin retrocesión): {listSome(interpretation.zero_isins)}.</Aviso>
      ) : null}

      {/* Paso 2 · pasada en seco ------------------------------------------- */}
      {preview && previewCounts ? (
        <Panel
          acciones={<>
            <Button size="sm" onClick={downloadPreview}>Descargar pasada en seco</Button>
            <Button variant="primary" size="sm" onClick={() => { setConfirmCount(""); setConfirmOpen(true); }} disabled={busy || writeCount === 0 || !FIREBASE_CONFIGURED}>
              Aplicar {writeCount} cambio(s)
            </Button>
          </>}
          subtitulo={
            <>
              Nada se ha escrito. {writeCount} cambio(s) pendientes de aplicar
              {previewCounts.OUT_OF_MASTER ? `; ${previewCounts.OUT_OF_MASTER} ISIN no están en el catálogo y no se pueden guardar hasta darlos de alta` : ""}.
            </>
          }
          titulo="Pasada en seco"
        >
          <KpiStrip
            ariaLabel="Resumen de la pasada en seco"
            items={[
              { label: "Crear", value: previewCounts.CREATE },
              { label: "Actualizar", value: previewCounts.UPDATE },
              { label: "Sin cambios", value: previewCounts.UNCHANGED },
              { label: "Eliminar", value: previewCounts.DELETE },
              { label: "Fuera del catálogo", value: previewCounts.OUT_OF_MASTER },
              { label: "No válidas", value: interpretation?.issues.length ?? 0 }
            ]}
          />
          <div aria-label="Vista previa de la importación de retrocesiones (tabla desplazable)" className="report-table-wrapper retro-preview-wrapper" role="group" tabIndex={0}>
            <table className="report-table retro-preview-table" aria-label="Vista previa de la importación de retrocesiones">
              <thead>
                <tr>
                  <th scope="col">Acción</th>
                  <th scope="col">ISIN</th>
                  <th scope="col">Nombre (fichero / catálogo)</th>
                  <th scope="col" className="num">Retro nueva</th>
                  <th scope="col" className="num">Retro actual</th>
                  <th scope="col">Vigente desde</th>
                  <th scope="col">Cambios y avisos</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((row) => (
                  <tr key={row.entry.isin} className={row.action === "OUT_OF_MASTER" || row.action === "DELETE" ? "retro-preview-row--flag" : undefined}>
                    <td>{ACTION_LABELS[row.action]}</td>
                    <td className="retro-isin">{row.entry.isin}</td>
                    <td>
                      <div className="cell-entity">
                        <span>{row.entry.name ?? FALTA}</span>
                        <span>{row.master_name ?? FALTA}</span>
                      </div>
                    </td>
                    <td className="num">{row.action === "DELETE" ? textoDeAusencia("no-aplica") : fmtRetro(row.entry.retro_pct)}</td>
                    <td className="num">{row.existing ? fmtRetro(row.existing.retro_pct) : FALTA}</td>
                    <td>{fmtDay(row.entry.as_of_date)}</td>
                    <td>{[...row.changes, ...(row.warnings ?? [])].join(" · ") || FALTA}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      ) : null}

      {confirmOpen && previewCounts ? (
        <ModalDialog labelledBy="retro-apply-title" size="sm" onClose={() => setConfirmOpen(false)}>
          <DialogHeader
            titleId="retro-apply-title"
            eyebrow="Confirmar escritura"
            title={`Aplicar ${writeCount} cambio(s) en las retrocesiones`}
            onClose={() => setConfirmOpen(false)}
          />
          <DialogBody>
            <p>
              Se crearán {previewCounts.CREATE}, se actualizarán {previewCounts.UPDATE} y se borrarán {previewCounts.DELETE} retrocesiones
              {fileName ? ` a partir de ${fileName}` : ""}, con vigencia {fmtDay(asOfDate)}. El catálogo de activos no se modifica y la importación se podrá deshacer.
            </p>
            <Campo rotulo="Escribe el número de cambios para confirmar">
              <input
                value={confirmCount}
                inputMode="numeric"
                autoFocus
                onChange={(event) => setConfirmCount(event.target.value.trim())}
                className="retro-num-input"
              />
            </Campo>
          </DialogBody>
          <DialogFooter>
            <Button onClick={() => setConfirmOpen(false)}>Cancelar</Button>
            <Button variant="primary" onClick={() => void applyImport()} disabled={Number(confirmCount) !== writeCount}>
              Aplicar
            </Button>
          </DialogFooter>
        </ModalDialog>
      ) : null}

      {undoOpen && lastRun ? (
        <ModalDialog labelledBy="retro-undo-title" size="sm" onClose={() => setUndoOpen(false)}>
          <DialogHeader
            titleId="retro-undo-title"
            eyebrow="Deshacer importación"
            title={`Restaurar el estado anterior a ${lastRun.import_id}`}
            onClose={() => setUndoOpen(false)}
          />
          <DialogBody>
            <p>
              Importación del {momentoDe(lastRun.created_at)}{lastRun.created_by ? ` por ${lastRun.created_by}` : ""}
              {lastRun.file_name ? ` (${lastRun.file_name})` : ""}: se devolverán {Object.keys(lastRun.previous).length} retrocesiones a su valor anterior,
              borrando las que no existían{lastRun.status === "partial" ? ". La importación quedó marcada como parcial: se restaura lo que guardó" : ""}.
            </p>
          </DialogBody>
          <DialogFooter>
            <Button autoFocus onClick={() => setUndoOpen(false)}>Cancelar</Button>
            <Button variant="danger" onClick={() => void undoLastImport()} busy={savingKey === "undo"}>
              Deshacer
            </Button>
          </DialogFooter>
        </ModalDialog>
      ) : null}

      {pendingDelete ? (
        <ModalDialog labelledBy="retro-delete-title" size="sm" onClose={() => setPendingDelete(null)}>
          <DialogHeader
            titleId="retro-delete-title"
            eyebrow="Confirmar borrado"
            title="Eliminar retrocesión comercial"
            onClose={() => setPendingDelete(null)}
          />
          <DialogBody>
            <p>
              Se borrará el dato editable de <code>{pendingDelete}</code>. El catálogo de activos no se modifica.
            </p>
          </DialogBody>
          <DialogFooter>
            <Button autoFocus onClick={() => setPendingDelete(null)} disabled={busy}>
              Cancelar
            </Button>
            <Button variant="danger" onClick={() => removeRecord(pendingDelete)} busy={savingKey === pendingDelete}>
              Eliminar
            </Button>
          </DialogFooter>
        </ModalDialog>
      ) : null}
      {confirmDialog}
    </div>
  );
}
