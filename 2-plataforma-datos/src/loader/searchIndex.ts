import { mapFondosDbFund } from '../ingestion/fondosdb/fondosDbMapper';
import { canonicalIssuesForAsset, CanonicalPackage } from './packageReader';
import { StockRowLite } from './planner';

export const SEARCH_INDEX_PATH = 'meta/search_index';
export const SEARCH_INDEX_SCHEMA_VERSION = 'master.search-index.v1';

export interface SearchIndexEntry {
    id: string;
    name: string;
    name_folded: string;
    ticker?: string;
    type: string;
    class?: string;
    currency?: string;
}

export interface SearchIndexDocument {
    schema_version: string;
    updated_at: string;
    count: number;
    entries: SearchIndexEntry[];
}

export function foldForSearch(value: unknown): string {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
}

function firstString(...values: unknown[]): string | undefined {
    for (const value of values) {
        if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return undefined;
}

/** Tipos de filtro usados por el reconciliador Python de BDB-ACTIVOS.
 * ETC/ETN/ETP se agrupan bajo ETF; el tipo maestro original se conserva.
 * Sin señal suficiente no se inventa un tipo a partir de fund_profile,
 * que el reconciliador nocturno excluye de su proyección.
 */
function searchInstrumentType(root: Record<string, any>): string | undefined {
    const raw = firstString(root.asset_type)?.toUpperCase() || '';
    if (['FUND', 'ETF', 'STOCK', 'INDEX'].includes(raw)) return raw;
    const product = root.product || {};
    const pt = String(product.product_type || '').toLowerCase();
    const signals = [raw.toLowerCase(), pt, product.commercial_type, product.vehicle_complexity]
        .map(value => String(value || '').toLowerCase()).join(' ');
    if (['etf', 'etc', 'etn', 'etp', 'exchange traded'].some(token => signals.includes(token))) return 'ETF';
    if (pt.includes('fund') || pt.includes('fondo')) return 'FUND';
    return firstString(root.asset_type, root.type);
}

export function entryFromRoot(id: string, root: Record<string, any>): SearchIndexEntry | null {
    const identity = root.identity || {};
    const identifiers = root.identifiers || {};
    const classification = root.classification || {};
    const name = firstString(identity.name, root.name, id);
    const type = searchInstrumentType(root);
    if (!name || !type) return null;

    const entry: SearchIndexEntry = {
        id,
        name,
        name_folded: foldForSearch(name),
        type
    };
    const ticker = firstString(identifiers.ticker, identifiers.eodhd_code, identifiers.openfigi_ticker);
    const assetClass = firstString(classification.asset_class, classification.economic_asset_class, classification.fondosdb_asset_type, root.economic_asset_class);
    const currency = firstString(identity.currency, root.currency);
    if (ticker) entry.ticker = ticker;
    if (assetClass) entry.class = assetClass;
    if (currency) entry.currency = currency;
    return entry;
}

export function buildSearchIndexDocument(
    pkg: CanonicalPackage,
    stockRowByIsin: Map<string, StockRowLite>,
    updatedAt: string
): SearchIndexDocument {
    const entriesById = new Map<string, SearchIndexEntry>();
    const ids = new Set<string>([...pkg.rawByIsin.keys(), ...stockRowByIsin.keys()]);

    for (const id of [...ids].sort()) {
        if (canonicalIssuesForAsset(pkg, id).length > 0) continue;
        const stockRow = stockRowByIsin.get(id);
        if (stockRow) {
            const entry = entryFromRoot(id, stockRow.root);
            if (entry) entriesById.set(id, entry);
            continue;
        }

        const raw = pkg.rawByIsin.get(id);
        if (!raw) continue;
        const mapped = mapFondosDbFund(raw.file, raw.data, pkg.universalByIsin.get(id), {
            duplicateIsin: pkg.duplicateIsins.has(id),
            problematicFlags: pkg.problematicByIsin.get(id)?.flags,
            qualityFlags: pkg.qualityByIsin.get(id)?.flags
        });
        if (!mapped.asset) continue;
        const entry = entryFromRoot(id, mapped.asset as unknown as Record<string, any>);
        if (entry) entriesById.set(id, entry);
    }

    const entries = [...entriesById.values()].sort((a, b) => a.id.localeCompare(b.id));
    return {
        schema_version: SEARCH_INDEX_SCHEMA_VERSION,
        updated_at: updatedAt,
        count: entries.length,
        entries
    };
}

function normalizeEntry(value: unknown): SearchIndexEntry | null {
    if (!value || typeof value !== 'object') return null;
    const row = value as Record<string, unknown>;
    const id = firstString(row.id);
    const name = firstString(row.name);
    const type = firstString(row.type);
    if (!id || !name || !type) return null;

    const entry: SearchIndexEntry = {
        id,
        name,
        name_folded: firstString(row.name_folded) || foldForSearch(name),
        type
    };
    const ticker = firstString(row.ticker);
    const assetClass = firstString(row.class);
    const currency = firstString(row.currency);
    if (ticker) entry.ticker = ticker;
    if (assetClass) entry.class = assetClass;
    if (currency) entry.currency = currency;
    return entry;
}

/**
 * Upsert por id: el paquete refresca sus entradas y conserva las creadas por
 * otras tuberias. reconcileSearchIndexLive sigue siendo quien elimina huerfanas.
 */
export function mergeSearchIndexDocument(
    existing: unknown,
    incoming: SearchIndexDocument,
    updatedAt: string = incoming.updated_at
): SearchIndexDocument {
    const entriesById = new Map<string, SearchIndexEntry>();
    const existingEntries = (existing as { entries?: unknown } | null)?.entries;

    for (const value of Array.isArray(existingEntries) ? existingEntries : []) {
        const entry = normalizeEntry(value);
        if (entry) entriesById.set(entry.id, entry);
    }
    for (const value of incoming.entries) {
        const entry = normalizeEntry(value);
        if (entry) entriesById.set(entry.id, entry);
    }

    const entries = [...entriesById.values()].sort((left, right) => left.id.localeCompare(right.id));
    return {
        schema_version: SEARCH_INDEX_SCHEMA_VERSION,
        updated_at: updatedAt,
        count: entries.length,
        entries
    };
}
