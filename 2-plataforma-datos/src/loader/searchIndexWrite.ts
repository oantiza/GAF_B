/**
 * src/loader/searchIndexWrite.ts — escritura de `meta/search_index` con precondicion (H06).
 *
 * Reescriben el documento entero reconcileSearchIndexLive (desde las raices vivas; desde el 16-10-2026 es el
 * unico escritor del indice en el cargador, writer.executePlan, y en el republish: ALTA-18), la reclasificacion
 * de acciones (reclassifyStock) y la retirada de archive:assets. Antes hacian `set()` sin precondicion de lo
 * que habian leido, asi que una actualizacion concurrente entre la lectura y la escritura se perdia: una entrada
 * que la app anade al dar de alta un activo (ingest_asset / fund_ingest -> upsert_search_index_entry), la
 * reconciliacion programada de la app o la retirada de archive:assets.
 *
 * Ahora:
 *   - se lee el documento (y su updateTime) ANTES de construir el nuevo;
 *   - se escribe con `update(..., { lastUpdateTime })`, o `create()` si no existia, con la
 *     semantica de `set()`: las claves del vivo que el nuevo no trae se borran;
 *   - si otro escritor lo ha cambiado, creado o borrado entretanto, se vuelve a leer y a construir, como mucho
 *     SEARCH_INDEX_WRITE_MAX_ATTEMPTS veces; despues, SEARCH_INDEX_CONCURRENT_MODIFICATION.
 */
import * as admin from 'firebase-admin';

export const SEARCH_INDEX_WRITE_MAX_ATTEMPTS = 3;

export interface SearchIndexSnapshot {
    exists: boolean;
    updateTime?: admin.firestore.Timestamp;
    data(): Record<string, any> | undefined;
}

export interface SearchIndexRef {
    get(): Promise<SearchIndexSnapshot>;
    update(data: admin.firestore.UpdateData<Record<string, unknown>>, precondition: admin.firestore.Precondition): Promise<unknown>;
    create(data: Record<string, unknown>): Promise<unknown>;
}

/** Otro escritor cambio (o creo) el indice entre la lectura y la escritura. */
export class SearchIndexConcurrentModificationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'SearchIndexConcurrentModificationError';
    }
}

// update() interpreta los puntos de una clave como ruta: solo se borran claves simples.
const SIMPLE_FIELD = /^[A-Za-z_][A-Za-z0-9_]*$/;

// FAILED_PRECONDITION (9): cambio desde la lectura. ALREADY_EXISTS (6): alguien lo creo. NOT_FOUND (5): alguien
// lo borro entre la lectura y update(); al reintentar se vuelve a leer y se crea.
function isConcurrencyFailure(error: any): boolean {
    const code = error?.code;
    return code === 9 || code === 6 || code === 5 || code === 'failed-precondition' || code === 'already-exists' || code === 'not-found'
        || /FAILED_PRECONDITION|ALREADY_EXISTS|NOT_FOUND/.test(String(error?.message || error || ''));
}

/**
 * Escribe `payload` como documento completo si `meta/search_index` sigue como en `snap`.
 * Lanza SearchIndexConcurrentModificationError si no.
 */
export async function writeSearchIndexWithPrecondition(
    ref: SearchIndexRef,
    snap: SearchIndexSnapshot,
    payload: Record<string, unknown>
): Promise<void> {
    try {
        if (!snap.exists) {
            await ref.create(payload);
            return;
        }
        if (!snap.updateTime) throw new Error('SEARCH_INDEX_PRECONDITION_MISSING: la lectura de meta/search_index no trae updateTime.');
        const update: Record<string, unknown> = { ...payload };
        for (const key of Object.keys(snap.data() || {})) {
            if (key in payload) continue;
            if (!SIMPLE_FIELD.test(key)) throw new Error(`SEARCH_INDEX_UNSAFE_FIELD: no se puede borrar la clave '${key}' con update().`);
            update[key] = admin.firestore.FieldValue.delete();
        }
        await ref.update(update as admin.firestore.UpdateData<Record<string, unknown>>, { lastUpdateTime: snap.updateTime });
    } catch (error: any) {
        if (isConcurrencyFailure(error)) {
            throw new SearchIndexConcurrentModificationError(`SEARCH_INDEX_CONCURRENT_MODIFICATION: ${String(error?.message || error)}`);
        }
        throw error;
    }
}

export interface SearchIndexRebuildResult<T> {
    written: boolean;
    attempts: number;
    payload: T | null;
}

/**
 * Lee el indice, construye el documento con `build` (a partir del vivo, o de null si no existe) y lo
 * escribe con precondicion. Si otro escritor lo cambia entretanto, vuelve a empezar, hasta
 * `maxAttempts` veces. `build` devuelve null si no hay nada que escribir.
 */
export async function rebuildSearchIndexWithRetry<T extends Record<string, unknown>>(
    ref: SearchIndexRef,
    build: (current: Record<string, any> | null) => T | null | Promise<T | null>,
    maxAttempts: number = SEARCH_INDEX_WRITE_MAX_ATTEMPTS
): Promise<SearchIndexRebuildResult<T>> {
    for (let attempt = 1; ; attempt++) {
        const snap = await ref.get();
        const payload = await build(snap.exists ? (snap.data() || {}) : null);
        if (!payload) return { written: false, attempts: attempt, payload: null };
        try {
            await writeSearchIndexWithPrecondition(ref, snap, payload);
            return { written: true, attempts: attempt, payload };
        } catch (error) {
            if (!(error instanceof SearchIndexConcurrentModificationError)) throw error;
            if (attempt >= maxAttempts) {
                throw new SearchIndexConcurrentModificationError(`${error.message} (tras ${attempt} intentos)`);
            }
        }
    }
}
