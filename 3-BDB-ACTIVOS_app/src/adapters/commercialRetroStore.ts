import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  runTransaction
} from "firebase/firestore";
import { auth, firestore } from "../firebase";
import { registerSessionCache } from "../core/sessionCaches";
import type {
  CommercialRetroApplyMeta,
  CommercialRetroApplyResult,
  CommercialRetroImportPreviewRow,
  CommercialRetroImportRun,
  CommercialRetroImportRunStatus,
  CommercialRetroInput,
  CommercialRetroRecord,
  CommercialRetroScale,
  CommercialRetroSnapshot
} from "../types/commercialRetro";
import { COMMERCIAL_RETRO_WRITE_ACTIONS, isCommercialIsin, normalizeCommercialIsin, summarizeCommercialRetroPreview } from "../core/commercialRetroCsv";

const COLLECTION = "commercial_retro";
/** Foto de cada importación masiva: lo que había y lo que se escribió. */
const IMPORTS_COLLECTION = "commercial_retro_imports";
/** Each asset write checks assets/{isin}; rules allow 20 document accesses per transaction. */
export const COMMERCIAL_RETRO_BATCH_SIZE = 20;

/** A3.5: las cachés caducan — antes vivían toda la sesión y una retro editada
 *  en otra pestaña o dispositivo no se veía nunca sin recargar. */
export const COMMERCIAL_RETRO_CACHE_TTL_MS = 5 * 60_000;

let listCache: CommercialRetroRecord[] | null = null;
const byIsinCache = new Map<string, CommercialRetroRecord>();
const missingIsinCache = new Set<string>();
let cacheStamp = 0;
let cacheUid: string | null = null;
let cacheGeneration = 0;

function syncCacheSession(): string | null {
  const uid = auth?.currentUser?.uid ?? null;
  if (uid !== cacheUid) {
    invalidateCommercialRetroCache();
    cacheUid = uid;
  }
  return uid;
}

function isCurrentRead(uid: string, generation: number): boolean {
  return syncCacheSession() === uid && cacheGeneration === generation;
}

function touchCache() {
  // El sello marca el inicio de la GENERACIÓN de caché, no el último acceso:
  // así la generación entera se renueva como muy tarde cada TTL, aunque se
  // sigan añadiendo entradas nuevas continuamente.
  if (cacheStamp === 0) cacheStamp = Date.now();
}

function expireStaleCache() {
  if (cacheStamp !== 0 && Date.now() - cacheStamp >= COMMERCIAL_RETRO_CACHE_TTL_MS) {
    invalidateCommercialRetroCache();
  }
}

/** Tras una importación masiva o un deshacer, lo cacheado ya no vale. */
export function invalidateCommercialRetroCache(): void {
  cacheGeneration += 1;
  listCache = null;
  byIsinCache.clear();
  missingIsinCache.clear();
  cacheStamp = 0;
}
registerSessionCache(invalidateCommercialRetroCache);

function requireFirestore() {
  if (!firestore) {
    throw new Error("Firebase no está configurado en esta sesión.");
  }
  return firestore;
}

function requireUserLabel(): string {
  const user = auth?.currentUser;
  if (!user) {
    throw new Error("Debes iniciar sesión para guardar retrocesiones.");
  }
  return user.email ?? user.uid;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function timestampToIso(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || !("toDate" in value)) {
    return readString(value);
  }
  const timestamp = value as { toDate?: () => Date };
  if (typeof timestamp.toDate !== "function") return undefined;
  const date = timestamp.toDate();
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function normalizeRecord(id: string, data: Record<string, unknown>): CommercialRetroRecord | null {
  const isin = normalizeCommercialIsin(readString(data.isin) ?? id);
  const retro_pct = readNumber(data.retro_pct);
  const as_of_date = readString(data.as_of_date);
  const source = readString(data.source);
  if (!isCommercialIsin(isin) || retro_pct == null || !as_of_date || !source) {
    return null;
  }
  return {
    isin,
    retro_pct,
    status: data.status === "PENDING_CONFIRMATION" ? "PENDING_CONFIRMATION" : "CONFIRMED",
    as_of_date,
    source,
    note: readString(data.note),
    updated_at: timestampToIso(data.updated_at),
    updated_by: readString(data.updated_by),
    revision: timestampRevision(data.updated_at)
  };
}

function remember(record: CommercialRetroRecord) {
  byIsinCache.set(record.isin, record);
  missingIsinCache.delete(record.isin);
  if (listCache) {
    listCache = [record, ...listCache.filter((item) => item.isin !== record.isin)].sort((a, b) =>
      a.isin.localeCompare(b.isin)
    );
  }
  touchCache();
}

interface CommercialRetroAssetKey {
  asset_id: string;
  isin?: string;
}

export function assetCommercialRetroKey(asset?: CommercialRetroAssetKey | null): string | null {
  if (!asset) return null;
  if (asset.isin && isCommercialIsin(asset.isin)) return normalizeCommercialIsin(asset.isin);
  if (isCommercialIsin(asset.asset_id)) return normalizeCommercialIsin(asset.asset_id);
  return null;
}

export async function getCommercialRetroList(force = false): Promise<CommercialRetroRecord[]> {
  const uid = syncCacheSession();
  if (!firestore || !uid) return [];
  expireStaleCache();
  if (force) invalidateCommercialRetroCache();
  if (listCache && !force) return listCache;
  const generation = cacheGeneration;
  const snap = await getDocs(collection(firestore, COLLECTION));
  if (!isCurrentRead(uid, generation)) return [];
  byIsinCache.clear();
  missingIsinCache.clear();
  const records: CommercialRetroRecord[] = [];
  snap.forEach((item) => {
    const record = normalizeRecord(item.id, item.data());
    if (record) {
      records.push(record);
      byIsinCache.set(record.isin, record);
    }
  });
  listCache = records.sort((a, b) => a.isin.localeCompare(b.isin));
  touchCache();
  return listCache;
}

export async function getCommercialRetroByIsin(isinRaw: string): Promise<CommercialRetroRecord | null> {
  const uid = syncCacheSession();
  const isin = normalizeCommercialIsin(isinRaw);
  if (!isCommercialIsin(isin) || !firestore || !uid) return null;
  expireStaleCache();
  const cached = byIsinCache.get(isin);
  if (cached) return cached;
  if (missingIsinCache.has(isin)) return null;
  const generation = cacheGeneration;
  const snap = await getDoc(doc(firestore, COLLECTION, isin));
  if (!isCurrentRead(uid, generation)) return null;
  if (!snap.exists()) {
    missingIsinCache.add(isin);
    touchCache();
    return null;
  }
  const record = normalizeRecord(snap.id, snap.data());
  if (record) remember(record);
  return record;
}

export async function getCommercialRetroForAssets(assets: CommercialRetroAssetKey[]): Promise<Map<string, CommercialRetroRecord>> {
  const pairs = await Promise.all(
    assets.map(async (asset) => {
      const key = assetCommercialRetroKey(asset);
      return [asset.asset_id, key ? await getCommercialRetroByIsin(key) : null] as const;
    })
  );
  return new Map(pairs.filter((pair): pair is readonly [string, CommercialRetroRecord] => pair[1] != null));
}

function validateInput(input: CommercialRetroInput): string {
  const isin = normalizeCommercialIsin(input.isin);
  if (!isCommercialIsin(isin)) {
    throw new Error("ISIN no válido.");
  }
  if (!Number.isFinite(input.retro_pct) || input.retro_pct < 0 || input.retro_pct > 100) {
    throw new Error("La retrocesión debe estar entre 0 y 100.");
  }
  return isin;
}

function writePayload(isin: string, input: CommercialRetroInput, updated_by: string) {
  const note = input.note?.trim();
  return {
    isin,
    retro_pct: input.retro_pct,
    status: input.status ?? "CONFIRMED",
    as_of_date: input.as_of_date,
    source: input.source,
    ...(note ? { note } : {}),
    updated_at: serverTimestamp(),
    updated_by
  };
}

export async function saveCommercialRetro(input: CommercialRetroInput): Promise<CommercialRetroRecord> {
  const db = requireFirestore();
  const updated_by = requireUserLabel();
  const isin = validateInput(input);
  // Sin merge: el documento se escribe entero, y así una nota que se vacía desaparece.
  await setDoc(doc(db, COLLECTION, isin), writePayload(isin, input, updated_by));
  const record: CommercialRetroRecord = {
    isin,
    retro_pct: input.retro_pct,
    status: input.status ?? "CONFIRMED",
    as_of_date: input.as_of_date,
    source: input.source,
    note: input.note?.trim() || undefined,
    updated_at: new Date().toISOString(),
    updated_by
  };
  // Read the server timestamp on the next lookup instead of caching a local estimate.
  invalidateCommercialRetroCache();
  return record;
}

export async function deleteCommercialRetro(isinRaw: string): Promise<void> {
  const db = requireFirestore();
  requireUserLabel();
  const isin = normalizeCommercialIsin(isinRaw);
  if (!isCommercialIsin(isin)) {
    throw new Error("ISIN no válido.");
  }
  await deleteDoc(doc(db, COLLECTION, isin));
  invalidateCommercialRetroCache();
}

/* ------------------------------------------------------------------------ */
/* Importación masiva: lotes, foto previa y deshacer                          */
/* ------------------------------------------------------------------------ */

function snapshotOf(record: CommercialRetroRecord): CommercialRetroSnapshot {
  return {
    retro_pct: record.retro_pct,
    status: record.status ?? "CONFIRMED",
    as_of_date: record.as_of_date,
    source: record.source,
    ...(record.note ? { note: record.note } : {})
  };
}

function timestampRevision(value: unknown): string | undefined {
  if (value && typeof value === "object" && "seconds" in value && "nanoseconds" in value) {
    return `${value.seconds}:${value.nanoseconds}`;
  }
  return timestampToIso(value);
}

function sameValues(actual: CommercialRetroRecord | null, expected: CommercialRetroSnapshot | null): boolean {
  return actual === null || expected === null
    ? actual === expected
    : actual.retro_pct === expected.retro_pct && (actual.status ?? "CONFIRMED") === (expected.status ?? "CONFIRMED") && actual.as_of_date === expected.as_of_date
      && actual.source === expected.source && (actual.note ?? "") === (expected.note ?? "").trim();
}

function requireSameUser(uid: string | undefined): void {
  if (!uid || auth?.currentUser?.uid !== uid) throw new Error("La sesión ha cambiado. Vuelve a abrir la importación.");
}

function readIsins(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((isin): isin is string => typeof isin === "string" && isCommercialIsin(isin)))] : [];
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    out.push(items.slice(index, index + size));
  }
  return out;
}

function newImportId(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const random = Math.random().toString(36).slice(2, 8);
  return `${stamp}-${random}`;
}

/**
 * Aplica una vista previa: crea y actualiza (`set`) y, en modo lista completa,
 * borra. Antes de tocar nada guarda la foto previa en
 * `commercial_retro_imports/{import_id}`; si un lote falla, la foto queda con
 * estado `partial` y el error, y la caché se invalida para que la tabla
 * enseñe la realidad.
 */
export async function applyCommercialRetroImport(
  rows: CommercialRetroImportPreviewRow[],
  meta: CommercialRetroApplyMeta,
  onProgress?: (done: number, total: number) => void
): Promise<CommercialRetroApplyResult> {
  const db = requireFirestore();
  const updated_by = requireUserLabel();
  const uid = auth?.currentUser?.uid;
  const actionable = rows.filter((row) => COMMERCIAL_RETRO_WRITE_ACTIONS.has(row.action));
  if (actionable.length === 0) {
    throw new Error("No hay cambios que aplicar.");
  }
  const source = meta.source ?? "FILE_IMPORT";
  const unique = new Set<string>();
  actionable.forEach((row) => {
    const isin = validateInput({ ...row.entry, source });
    if (isin !== row.entry.isin || unique.has(isin)) throw new Error("La vista previa contiene ISIN duplicados o sin normalizar.");
    unique.add(isin);
  });
  const import_id = newImportId();
  const previous: Record<string, CommercialRetroSnapshot | null> = {};
  const applied: Record<string, CommercialRetroSnapshot | "DELETE"> = {};
  actionable.forEach((row) => {
    previous[row.entry.isin] = row.existing ? snapshotOf(row.existing) : null;
    applied[row.entry.isin] = row.action === "DELETE"
      ? "DELETE"
      : {
        retro_pct: row.entry.retro_pct,
        // ALTA-09 (auditoría 16-10-2026): el recibo guarda el estado que se
        // escribe (writePayload: status ?? "CONFIRMED"). Sin él, el deshacer
        // leía CONFIRMED y rechazaba como «cambió después» una fila importada
        // como PENDING_CONFIRMATION.
        status: row.entry.status ?? "CONFIRMED",
        as_of_date: row.entry.as_of_date,
        source,
        ...(row.entry.note ? { note: row.entry.note } : {})
      };
  });

  const runRef = doc(db, IMPORTS_COLLECTION, import_id);
  await setDoc(runRef, {
    import_id,
    created_at: serverTimestamp(),
    created_by: updated_by,
    as_of_date: meta.as_of_date,
    ...(meta.file_name ? { file_name: meta.file_name } : {}),
    scale: meta.scale,
    replace_all: meta.replace_all,
    counts: summarizeCommercialRetroPreview(rows),
    previous,
    applied,
    schema_version: 2,
    applied_isins: [],
    undone_isins: [],
    applied_versions: {},
    status: "partial" satisfies CommercialRetroImportRunStatus
  });

  let done = 0;
  let written = 0;
  let deleted = 0;
  let batches = 0;
  onProgress?.(0, actionable.length);
  for (const chunk of chunks(actionable, COMMERCIAL_RETRO_BATCH_SIZE)) {
    try {
      await runTransaction(db, async (tx) => {
        requireSameUser(uid);
        const receipt = await tx.get(runRef);
        const data = receipt.data();
        if (!data || data.status !== "partial" || readIsins(data.undone_isins).length) {
          throw new Error("La importación ya no está disponible para continuar.");
        }
        const current = await Promise.all(chunk.map((row) => tx.get(doc(db, COLLECTION, row.entry.isin))));
        requireSameUser(uid);
        chunk.forEach((row, index) => {
          const snap = current[index];
          const actual = snap.exists() ? normalizeRecord(snap.id, snap.data()) : null;
          const before = row.existing ?? null;
          if ((snap.exists() && !actual) || !sameValues(actual, before)
            || (before?.revision && actual?.revision !== before.revision)
            || (before?.updated_at && actual?.updated_at !== before.updated_at)) {
            throw new Error(`${row.entry.isin} cambió después de la vista previa. Recarga la lista y revisa los cambios.`);
          }
        });
        const appliedIsins = [...readIsins(data.applied_isins), ...chunk.map((row) => row.entry.isin)];
        const versions: Record<string, unknown> = { ...(data.applied_versions ?? {}) };
        chunk.forEach((row) => {
          const ref = doc(db, COLLECTION, row.entry.isin);
          if (row.action === "DELETE") tx.delete(ref);
          else tx.set(ref, writePayload(row.entry.isin, { ...row.entry, source }, updated_by));
          versions[row.entry.isin] = serverTimestamp();
        });
        // The receipt and the affected assets commit together, including the final status.
        tx.update(runRef, {
          applied_isins: appliedIsins,
          applied_versions: versions,
          applied_batches: batches + 1,
          status: appliedIsins.length === actionable.length ? "applied" : "partial"
        });
      });
    } catch (error) {
      invalidateCommercialRetroCache();
      const message = error instanceof Error ? error.message : String(error);
      // Do not overwrite the atomic receipt after an ambiguous network outcome.
      if (auth?.currentUser?.uid === uid) await updateDoc(runRef, { error: message }).catch(() => undefined);
      throw new Error(
        `Se confirmaron ${done} de ${actionable.length} cambios antes del fallo (${message}). Consulta el registro ${import_id} para comprobar lo aplicado.`,
        { cause: error }
      );
    }
    batches += 1;
    chunk.forEach((row) => {
      if (row.action === "DELETE") deleted += 1;
      else written += 1;
    });
    done += chunk.length;
    onProgress?.(done, actionable.length);
  }
  invalidateCommercialRetroCache();
  return { import_id, written, deleted, batches };
}

function readScale(value: unknown): CommercialRetroScale {
  return value === "fraccion" ? "fraccion" : "porcentaje";
}

function readSnapshot(value: unknown): CommercialRetroSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  const retro_pct = readNumber(data.retro_pct);
  const as_of_date = readString(data.as_of_date);
  if (retro_pct == null || !as_of_date) return null;
  return {
    retro_pct,
    status: data.status === "PENDING_CONFIRMATION" ? "PENDING_CONFIRMATION" : "CONFIRMED",
    as_of_date,
    source: readString(data.source) ?? "FILE_IMPORT",
    ...(readString(data.note) ? { note: readString(data.note) } : {})
  };
}

export function parseCommercialRetroImportRun(id: string, data: Record<string, unknown>): CommercialRetroImportRun | null {
  const as_of_date = readString(data.as_of_date);
  if (!as_of_date) return null;
  const previous: Record<string, CommercialRetroSnapshot | null> = {};
  Object.entries((data.previous as Record<string, unknown>) ?? {}).forEach(([isin, value]) => {
    previous[isin] = readSnapshot(value);
  });
  const applied: Record<string, CommercialRetroSnapshot | "DELETE"> = {};
  Object.entries((data.applied as Record<string, unknown>) ?? {}).forEach(([isin, value]) => {
    if (value === "DELETE") applied[isin] = "DELETE";
    else {
      const snapshot = readSnapshot(value);
      if (snapshot) applied[isin] = snapshot;
    }
  });
  const status = data.status === "applied" || data.status === "undone" ? data.status : "partial";
  return {
    import_id: readString(data.import_id) ?? id,
    created_at: timestampToIso(data.created_at),
    created_by: readString(data.created_by),
    as_of_date,
    file_name: readString(data.file_name),
    scale: readScale(data.scale),
    replace_all: data.replace_all === true,
    counts: (data.counts as CommercialRetroImportRun["counts"]) ?? {},
    previous,
    applied,
    status,
    applied_batches: readNumber(data.applied_batches),
    schema_version: data.schema_version === 2 ? 2 : undefined,
    applied_isins: data.schema_version === 2 ? readIsins(data.applied_isins) : undefined,
    undone_isins: data.schema_version === 2 ? readIsins(data.undone_isins) : undefined,
    undone_at: timestampToIso(data.undone_at),
    undone_by: readString(data.undone_by),
    error: readString(data.error)
  };
}

/** La última importación (aplicada, parcial o ya deshecha), para ofrecer «Deshacer». */
export async function getLastCommercialRetroImport(): Promise<CommercialRetroImportRun | null> {
  const uid = syncCacheSession();
  if (!firestore || !uid) return null;
  const generation = cacheGeneration;
  const snap = await getDocs(query(collection(firestore, IMPORTS_COLLECTION), orderBy("created_at", "desc"), limit(1)));
  if (!isCurrentRead(uid, generation)) return null;
  let run: CommercialRetroImportRun | null = null;
  snap.forEach((item) => {
    if (!run) run = parseCommercialRetroImportRun(item.id, item.data());
  });
  return run;
}

/** Devuelve cada ISIN de la importación a su estado anterior (o lo borra si no existía). */
export async function undoCommercialRetroImport(
  run: CommercialRetroImportRun,
  onProgress?: (done: number, total: number) => void
): Promise<{ restored: number; deleted: number }> {
  const db = requireFirestore();
  const updated_by = requireUserLabel();
  const uid = auth?.currentUser?.uid;
  const runRef = doc(db, IMPORTS_COLLECTION, run.import_id);
  let restored = 0;
  let deleted = 0;
  try {
    // Always read the authoritative receipt; the dialog may be old or another undo may be running.
    let remaining = true;
    while (remaining) {
      const result = await runTransaction(db, async (tx) => {
        requireSameUser(uid);
        const receipt = await tx.get(runRef);
        const data = receipt.data();
        if (!data || data.schema_version !== 2 || !Array.isArray(data.applied_isins)) {
          throw new Error("Esta importación antigua no identifica los cambios confirmados. Necesita revisión manual antes de restaurar datos.");
        }
        if (data.status === "undone") throw new Error("Esta importación ya se deshizo.");
        const canonical = parseCommercialRetroImportRun(run.import_id, data);
        if (!canonical) throw new Error("El registro de importación está incompleto.");
        const applied = readIsins(data.applied_isins);
        const undone = readIsins(data.undone_isins);
        const pending = applied.filter((isin) => !undone.includes(isin));
        if (!pending.length) throw new Error("La importación no tiene cambios confirmados pendientes de deshacer.");
        const chunk = pending.slice(0, COMMERCIAL_RETRO_BATCH_SIZE);
        const current = await Promise.all(chunk.map((isin) => tx.get(doc(db, COLLECTION, isin))));
        requireSameUser(uid);
        chunk.forEach((isin, index) => {
          const expected = canonical.applied[isin];
          const snap = current[index];
          const actual = snap.exists() ? normalizeRecord(snap.id, snap.data()) : null;
          const version = timestampRevision(data.applied_versions?.[isin]);
          const matches = expected === "DELETE" ? !snap.exists()
            : expected && actual && sameValues(actual, expected) && version && actual.revision === version;
          if (!matches || !(isin in canonical.previous)) {
            throw new Error(`${isin} cambió después de la importación o no tiene una versión verificable. Se conserva el cambio posterior; revisa este ISIN antes de deshacer.`);
          }
        });
        let batchRestored = 0;
        let batchDeleted = 0;
        chunk.forEach((isin) => {
          const before = canonical.previous[isin];
          const ref = doc(db, COLLECTION, isin);
          if (before) {
            tx.set(ref, writePayload(isin, { isin, ...before }, updated_by));
            batchRestored += 1;
          } else {
            tx.delete(ref);
            batchDeleted += 1;
          }
        });
        const complete = chunk.length === pending.length;
        tx.update(runRef, {
          undone_isins: [...undone, ...chunk],
          ...(complete ? { status: "undone", undone_at: serverTimestamp(), undone_by: updated_by } : {})
        });
        return { restored: batchRestored, deleted: batchDeleted, remaining: !complete, done: undone.length + chunk.length, total: applied.length };
      });
      restored += result.restored;
      deleted += result.deleted;
      remaining = result.remaining;
      onProgress?.(result.done, result.total);
    }
    return { restored, deleted };
  } finally {
    invalidateCommercialRetroCache();
  }
}
