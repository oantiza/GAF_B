/**
 * src/loader/republish.ts — REPUBLISH/UPDATE controlado de la maestra (cierra el ciclo create+update).
 *
 * El cargador (cli.ts) es create-only: nunca refresca. Cuando fondosdb re-exporta, la poblacion ya
 * cargada queda obsoleta. Este modo REPUBLICA: por cada activo existente que DERIVA (mismo criterio
 * que el audit), reescribe SOLO los campos data-platform-owned desde el canonico actual, y PRESERVA
 * lo que poseen otras tuberias (listings de fondos, price_series, performance.valuation del refresh
 * diario, y las METRICAS DE ACCION, que escribe la ingesta de la app desde la serie EODHD).
 * Enrutado por poblacion (fondo -> mapFondosDbFund, accion -> buildStockRow). Las metricas de FONDO
 * solo son de esta tuberia como PUENTE: mientras el documento vivo falte o sea el trailing de
 * Morningstar del canonico. Si ya es calculo propio de la app, no se toca (ver ownsMetrics).
 * Las CARTERAS (holdings): por defecto gana la mas reciente; la mas antigua solo gana si la reciente
 * es parcial (declarada, o por recuento cuando la antigua es la viva), le saca como mucho 183 dias y
 * ninguna cobertura declarada lo impide. El recuento nunca hace retroceder una viva (ver
 * holdingsRepublish.decideHoldingsRepublish, holdings_kept.json y holdings_replaced.json).
 *
 *   # dry-run (no escribe): que se republicaria y que campos
 *   npm run republish:fondosdb -- --input "<dir>" --ids all --dry-run
 *   # aplicar (gate de plataforma):
 *   BDB_DATA_PLATFORM_ENABLE_MASTER_WRITES=YES_I_UNDERSTAND_MASTER_DB_WRITES \
 *     npm run republish:fondosdb -- --input "<dir>" --ids all --write
 *   # solo docs raiz (sin metrics, search_index ni ingestion_runs):
 *   npm run republish:fondosdb -- --input "<dir>" --ids A,B --root-only --write
 *   # solo carteras (sin raiz, metrics ni search_index; deja el registro en ingestion_runs):
 *   npm run republish:fondosdb -- --input "<dir>" --ids A,B --holdings-only --write
 *   # solo el indice de busqueda: en seco compara el del paquete con el vivo; con --write (que tambien
 *   # exige --input y la poblacion stock) solo escribe reconcileSearchIndexLive, desde las raices vivas:
 *   npm run republish:fondosdb -- --input "<dir>" --only-search-index --write
 *
 * Codigo de salida 1 si falla una escritura, un postverify o la reconciliacion del indice (como cli.ts), y
 * con --write si hay canonicos de accion sin fila stock (stock_without_row: con --write la poblacion stock es
 * obligatoria, asi que solo pasa con un --export-bdb distinto de <input>/export_bdb, un error de configuracion
 * que deja sin publicar un activo del paquete). Son esperados y no cuentan: los conflictos de dueno, los
 * canonicos en REVIEW, los que no validan su contrato (skipped_invalid: problema del canonico, como REVIEW),
 * las reclasificadas y las acciones retenidas. Todos salen en el resumen y en sus artefactos.
 *
 * Read-modify-write por documento: newDoc = { ...live, ...ownedOverrides }; set(newDoc) (sin merge,
 * pero construido desde el vivo => nada se pierde). Dry-run por defecto. Postverify (re-diff = 0).
 *
 * Guarda de vaciado (14-10-2026): si la maestra tiene un bloque o sub-bloque de la plataforma con datos y
 * el canonico lo vacia sin una retirada legitima, la raiz no se reescribe y sale en ownership_conflicts
 * (codigo REPUBLISH_EMPTIED_BLOCKS) salvo --accept-canonical. Ver emptiedPlatformPaths.
 *
 * Poblacion de acciones (CRIT-09, 16-10-2026): --write exige --input (sin el no se valida el manifiesto del
 * paquete ni se lee la poblacion stock) y aborta antes de tocar la maestra si la poblacion stock no se puede
 * leer o evaluar, igual que el cargador (cli.ts). La poblacion pasa por evaluateStockRows: una accion
 * NOT_READY o EXCLUDED no se republica (sale en stock_not_ready y stock_held.json), y un canonico de accion
 * sin fila stock es un error, nunca un fondo (ver loadStockPopulation). READY_WITH_WARNING SI se republica:
 * el republish no tiene --include-review y la accion ya esta en la maestra (decision del 16-10-2026; la alta
 * y la reclasificacion, en cambio, la retienen como REVIEW_HOLD).
 */
import * as fs from 'fs';
import * as path from 'path';
import * as admin from 'firebase-admin';
import { mapFondosDbFund } from '../ingestion/fondosdb/fondosDbMapper';
import { evaluateStockRows, isStockCanonical, readStockRows } from '../ingestion/fondosdbStockAssets';
import { StockRowLite } from './planner';
import { validators } from '../../contracts/validators';
import { canonicalIssuesForAsset, CanonicalPackagePaths, readCanonicalPackage } from './packageReader';
import { writeIngestionRun } from './ingestionRun';
import { diffPaths, ownedDrift } from './driftCriteria';
import { buildFundMetricsLatest } from './metricsLatest';
import { buildSearchIndexDocument, mergeSearchIndexDocument, SEARCH_INDEX_PATH } from './searchIndex';
import {
    executeHoldingsRepublish,
    HoldingsDecision,
    HoldingsRepublishPlan,
    isShortHoldings,
    planHoldingsRepublish
} from './holdingsRepublish';
import { reconcileSearchIndexLive } from '../../scripts/reconcileSearchIndexLive';
import { declaredBlockKeys, ownership, rootSchemaVersion, validateCurrentRoot } from './ownership';
import { ALLOWED_PROJECT_IDS } from '../config/projectAllowlist';

const PLATFORM_WRITE_GATE = 'BDB_DATA_PLATFORM_ENABLE_MASTER_WRITES';
const PLATFORM_WRITE_GATE_VALUE = 'YES_I_UNDERSTAND_MASTER_DB_WRITES';

// Que bloques reescribe el republish lo dice el contrato (x-owner), no una lista local: ver ownership.ts.

function getPath(doc: any, dotted: string): unknown {
    return dotted.split('.').reduce<any>((node, key) => (isObject(node) ? node[key] : undefined), doc);
}

/**
 * Escribe `value` en `dotted` clonando cada nivel por el camino. El clonado no es cosmetico:
 * `newDoc` comparte los bloques del canonico por referencia, y mutarlos in situ contaminaria el
 * paquete para los demas activos de la pasada.
 */
function setPath(doc: any, dotted: string, value: unknown): void {
    const keys = dotted.split('.');
    let node = doc;
    for (let i = 0; i < keys.length - 1; i++) {
        const key = keys[i];
        node[key] = isObject(node[key]) ? { ...node[key] } : {};
        node = node[key];
    }
    node[keys[keys.length - 1]] = value;
}

function getFlag(argv: string[], n: string): string | undefined {
    const i = argv.indexOf(n);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
}
function hasFlag(argv: string[], n: string): boolean { return argv.includes(n); }

function resolvePaths(argv: string[], env: NodeJS.ProcessEnv = process.env): CanonicalPackagePaths {
    const input = getFlag(argv, '--input') || env.FONDOSDB_INPUT_DIR || '';
    const exportBdbDir = getFlag(argv, '--export-bdb') || (input ? path.join(input, 'export_bdb') : '');
    if (!exportBdbDir || !fs.existsSync(exportBdbDir)) throw new Error(`No encuentro export_bdb. Usa --input <dir>. (recibido: '${exportBdbDir}')`);
    return {
        exportBdbDir,
        fondosNdjsonPath: input ? path.join(input, 'export', 'fondos.ndjson') : '',
        posicionesNdjsonPath: input ? path.join(input, 'export', 'posiciones.ndjson') : '',
        manifestPath: input ? path.join(input, 'export', 'manifest.json') : undefined,
        problematicReportPath: input ? path.join(input, 'reports', 'fondos_problematicos.md') : undefined,
        qualityCsvPath: input ? path.join(input, 'reports', 'calidad_resumen.csv') : undefined
    };
}

function isWriteAuthorized(env: NodeJS.ProcessEnv = process.env): boolean {
    return env[PLATFORM_WRITE_GATE] === PLATFORM_WRITE_GATE_VALUE;
}

function getDb(env: NodeJS.ProcessEnv = process.env): admin.firestore.Firestore {
    const projectId = env.FIREBASE_PROJECT_ID;
    if (!projectId) throw new Error('FIREBASE_PROJECT_ID ausente.');
    if (!ALLOWED_PROJECT_IDS.has(projectId)) throw new Error(`Project id fuera de allowlist: ${projectId}`);
    if (!admin.apps.length) admin.initializeApp({ projectId });
    return admin.firestore();
}

// ------------------------------------------------------------------ poblacion de acciones (CRIT-09)
/** Estados de evaluateStockRows que no se republican (los mismos que bloquean la alta y la reclasificacion). */
export const STOCK_HOLD_STATUSES: ReadonlySet<string> = new Set(['NOT_READY', 'EXCLUDED']);

/**
 * Poblacion de acciones del canonico, evaluada como en la alta (evaluateStockRows) e indexada por ISIN.
 *
 * Entran TODAS las filas, tambien las NOT_READY y EXCLUDED, con su `status`: si se quitaran del mapa, la
 * accion volveria a caer por la ruta de fondos (mapFondosDbFund), que es justo lo que hay que evitar.
 *
 * `required` (con --write, y siempre en el audit): sin --input, o si la poblacion no se puede leer o evaluar,
 * se lanza el error antes de tocar la maestra, como cli.ts. Sin `required` (pasada en seco) se avisa y se
 * sigue sin acciones: las del canonico salen como error REPUBLISH_STOCK_WITHOUT_ROW, no como fondo.
 */
export function loadStockPopulation(
    inputDir: string,
    required: boolean,
    warn: (message: string) => void = (message) => console.warn(message)
): Map<string, StockRowLite> {
    const unavailable = (reason: string): Map<string, StockRowLite> => {
        const message = `no se pudo leer/evaluar la poblacion stock (${reason})`;
        if (required) {
            throw new Error(`STOCK_POPULATION_UNAVAILABLE: ${message}; abortado antes de tocar la maestra para no tratar acciones con el mapper de fondos.`);
        }
        warn(`[republish] aviso: ${message}; pasada en seco sin poblacion stock (las acciones del canonico salen como error, no como fondo).`);
        return new Map();
    };
    if (!inputDir) return unavailable('falta --input <dir>');
    let evaluated: ReturnType<typeof evaluateStockRows>;
    try {
        evaluated = evaluateStockRows(readStockRows(inputDir), {});
    } catch (e: any) {
        return unavailable(String(e?.message || e));
    }
    const out = new Map<string, StockRowLite>();
    for (const row of [...evaluated.candidates, ...evaluated.excluded]) {
        out.set(row.asset_id, { root: row.root, metrics: row.metrics, status: row.status, status_reasons: row.status_reasons });
    }
    return out;
}

/** Un documento que el republish no puede reescribir sin perder algo que no es suyo. */
export class OwnershipConflictError extends Error {
    /** Codigo del conflicto (prefijo del mensaje: REPUBLISH_EMPTIED_BLOCKS, REPUBLISH_LEGACY_CONFLICT...). */
    readonly code: string;
    constructor(
        readonly paths: string[],
        message: string,
        /** Rutas de la plataforma que el canonico vaciaria (vacio si el conflicto es solo de otro tipo). */
        readonly emptied: string[] = []
    ) {
        super(message);
        this.name = 'OwnershipConflictError';
        this.code = message.split(':')[0];
    }
}

export interface MergeOwnedOptions {
    /** Resolver un conflicto a favor del canonico (decision explicita, por ISIN). */
    acceptCanonical?: boolean;
}

/** Una ruta donde se conserva el valor vivo porque el del canonico es peor, y por que. */
export interface PreservedPath {
    path: string;
    reason: 'fuente_retirada';
    live: unknown;
    canonical: unknown;
}

export interface MergeOwnedResult {
    doc: any;
    /** Datos que escribio la app dentro de bloques de la plataforma y que se conservan (transitorio). */
    legacyKept: string[];
    /**
     * Rutas donde el canonico ha retrocedido respecto a la maestra y se conserva lo vivo en vez de
     * abortar el documento entero (31-10-2026). Van a `preserved_withdrawn.json`: conservar en
     * silencio seria peor que vaciar.
     */
    preserved: PreservedPath[];
}

const NUMERIC_EPS = 1e-9;
/** El dato documentado a mano suele venir redondeado a 2 decimales (7.37 frente a 7.3681). */
function sameNumber(a: number, b: number): boolean {
    return Math.abs(a - b) <= NUMERIC_EPS || Math.round(a * 100) === Math.round(b * 100);
}
/** Igualdad profunda sin depender del orden de las claves. */
function sameValue(a: unknown, b: unknown): boolean {
    if (typeof a === 'number' && typeof b === 'number') return sameNumber(a, b);
    if (Array.isArray(a) || Array.isArray(b)) {
        return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => sameValue(v, b[i]));
    }
    if (a && b && typeof a === 'object' && typeof b === 'object') {
        const ka = Object.keys(a as object);
        const kb = Object.keys(b as object);
        return ka.length === kb.length && ka.every((k) => k in (b as object) && sameValue((a as any)[k], (b as any)[k]));
    }
    return a === b;
}

/**
 * TRANSITORIO. La pasada de calidad del 28-09 (output/calidad-fondos-fase2, fuera de git) escribio
 * en bloques de la plataforma datos verificados a mano: risk.sri_kid_evidence (481 fondos) y cifras
 * de renta fija con fixed_income_profile.field_provenance (23). Su sitio definitivo es
 * config/correcciones.json del extractor; hasta entonces el republish:
 *   - los conserva si el canonico no los contradice (o no trae el dato), y
 *   - se niega a reescribir el documento si el canonico dice otra cosa (conflicto que decide Oscar).
 */
function keepLegacyAppData(live: any, newDoc: any, expected: any): { kept: string[]; conflicts: string[] } {
    const kept: string[] = [];
    const conflicts: string[] = [];
    const liveEvidence = live?.risk?.sri_kid_evidence;
    if (liveEvidence && typeof liveEvidence === 'object' && 'risk' in expected) {
        const risk = newDoc.risk && typeof newDoc.risk === 'object' ? newDoc.risk : null;
        const canonicalSri = risk?.sri_kid_1a7;
        if (canonicalSri !== liveEvidence.sri) {
            conflicts.push(`risk.sri_kid_1a7 (canonico ${canonicalSri ?? 'sin dato'}, KID verificado ${liveEvidence.sri})`);
        } else if (!risk.sri_kid_evidence) {
            newDoc.risk = { ...risk, sri_kid_evidence: liveEvidence };
            kept.push('risk.sri_kid_evidence');
        }
    }
    const liveFi = live?.fixed_income_profile;
    const documented = liveFi?.field_provenance;
    if (documented && typeof documented === 'object' && 'fixed_income_profile' in expected) {
        const fi: Record<string, any> = newDoc.fixed_income_profile && typeof newDoc.fixed_income_profile === 'object'
            ? { ...newDoc.fixed_income_profile }
            : {};
        for (const field of Object.keys(documented)) {
            const canonical = fi[field];
            if (canonical === undefined || canonical === null) {
                if (liveFi[field] !== undefined) fi[field] = liveFi[field];
            } else if (!sameValue(canonical, liveFi[field])) {
                conflicts.push(`fixed_income_profile.${field} (canonico ${JSON.stringify(canonical)}, documentado ${JSON.stringify(liveFi[field])})`);
            }
        }
        fi.field_provenance = documented;
        newDoc.fixed_income_profile = fi;
        kept.push('fixed_income_profile.field_provenance');
    }
    return { kept, conflicts };
}

// ------------------------------------------------------------------ guarda de vaciado
/**
 * El 14-10-2026, tras refrescar carteras de Morningstar, el canonico del extractor perdio datos de 24 fondos
 * porque la fuente ya no los traia (renta fija sin vencimiento ni TIR, calidad crediticia o asignacion todo
 * null, la gestora, registros CSSF). El extractor ya retiene lo que puede
 * (core/adquisicion/retencion.py); esta guarda es la segunda capa: el republish no vacia en la maestra un
 * bloque o sub-bloque de la plataforma que tiene datos salvo que el vaciado sea una retirada legitima.
 *
 * Se vigilan los bloques raiz de la plataforma (menos los de identidad, diagnostico y espejo) y sus hijos
 * directos; en regulatory.registers, cada registro oficial. Un objeto sin ningun valor distinto de cero
 * cuenta como vacio: el canonico rellena con ceros la calidad crediticia o los tramos que no tiene.
 * Un hijo que el canonico trae a null (o a cero) esta vaciado; uno que no trae, solo si es una clave
 * conocida del bloque (declarada en el contrato o en EMPTY_GUARD_KNOWN_KEYS): las demas son claves obsoletas
 * que el merge limpia a proposito (MEDIA-9).
 */
const EMPTY_GUARD_SKIPPED_BLOCKS: ReadonlySet<string> = new Set([
    'asset_type', 'identity', 'identifiers', 'listings', 'quality', 'source_metadata', 'provenance'
]);
/** Claves de diagnostico o de version dentro de los bloques: no son dato. */
const EMPTY_GUARD_SKIPPED_KEYS: ReadonlySet<string> = new Set(['version', 'warnings', 'field_provenance', 'exposure_confidence']);
/** Contenedores cuyos hijos se vigilan uno a uno (cada registro oficial es un sub-bloque). */
const EMPTY_GUARD_CONTAINERS: ReadonlySet<string> = new Set(['regulatory.registers']);
/** Claves conocidas de bloques passthrough que el canonico omite (en vez de poner null) cuando no hay dato. */
const EMPTY_GUARD_KNOWN_KEYS: Readonly<Record<string, readonly string[]>> = {
    // core/canonico_regulatorio.py: `_limpia` quita el registro que no aparece.
    'regulatory.registers': ['cnmv', 'cssf', 'esma', 'amf', 'gleif']
};
/** Ratings: un rating retirado debe desaparecer (el extractor nunca los retiene). */
const RATING_PATHS: ReadonlySet<string> = new Set([
    'classification.morningstar_rating',
    'sustainability.morningstar_sustainability_rating'
]);
const FIXED_INCOME_PATHS = ['fixed_income_profile', 'portfolio_exposure.credit', 'portfolio_exposure.duration', 'portfolio_exposure.bond_types'];
const EQUITY_PATHS = ['portfolio_exposure.sectors', 'portfolio_exposure.equity_regions', 'portfolio_exposure.equity_styles', 'portfolio_exposure.market_caps'];
/**
 * Peso de la clase (fraccion de portfolio_exposure.asset_mix) por debajo del cual vaciar sus bloques es una
 * retirada legitima. El caso tipico es la clase a 0 % en la cartera nueva; el umbral es el 5 % que usa la
 * retencion del extractor (core/adquisicion/retencion.py, UMBRAL_CLASE_PCT): por debajo, el extractor no
 * retiene a proposito y esta guarda no debe pedir decision. Con 0 % estricto, la pasada en seco del 14-10
 * daba 33 raices mas, todas con renta fija entre el 0,001 % y el 4,4 %.
 */
export const LEGITIMATE_RETIREMENT_CLASS_WEIGHT = 0.05;
const ALLOCATION_UNAVAILABLE = 'asset_allocation_unavailable';

function isObject(value: unknown): value is Record<string, any> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Lleva dato: un escalar no nulo (0 incluido) o un objeto/lista con algun valor no nulo y distinto de cero. */
export function carriesData(value: unknown, nested = false): boolean {
    if (value === null || value === undefined) return false;
    if (typeof value === 'number') return Number.isFinite(value) && (!nested || value !== 0);
    if (typeof value === 'string') return value.trim() !== '';
    if (typeof value === 'boolean') return true;
    if (Array.isArray(value)) return value.some((item) => carriesData(item, true));
    if (isObject(value)) {
        return Object.entries(value).some(([key, child]) => !EMPTY_GUARD_SKIPPED_KEYS.has(key) && carriesData(child, true));
    }
    return false;
}

function allocationUnavailable(doc: any): boolean {
    const warnings = doc?.quality?.warnings;
    return Array.isArray(warnings) && warnings.includes(ALLOCATION_UNAVAILABLE);
}

function classWeight(doc: any, assetClass: 'bond' | 'equity'): number | null {
    if (allocationUnavailable(doc)) return null;
    const value = doc?.portfolio_exposure?.asset_mix?.[assetClass];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function underPrefixes(path: string, prefixes: readonly string[]): boolean {
    return prefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}.`));
}

/**
 * Lo que una fuente escribe cuando NO hay dato. Espejo de `_SIN_INDICE` en el
 * `adaptador_bdb.py` del extractor, que es quien los filtra al construir el canonico.
 */
const ABSENCE_MARKERS: ReadonlySet<string> = new Set([
    '', '-', '--', 'n/a', 'na', 'n.a.', 'n.d.', 'nd', 'none', 'null',
    'sin indice', 'sin índice', 'no disponible', 'not available',
    'not benchmarked', 'not benchmark', 'no benchmark', 'no benchmarked', 'no index'
]);

/**
 * Rutas donde un marcador de ausencia en la maestra NO cuenta como dato, asi que quitarlo es
 * corregir y no vaciar. Va por rutas declaradas a proposito y no para cualquier cadena: hay campos
 * cuyo valor legitimo puede ser literalmente "none", y la guarda tiene que seguir protegiendolos.
 *
 * 31-10-2026: 88 fondos de la maestra llevaban "Not Benchmarked" —el centinela de Morningstar para
 * «no se compara con ningun indice»— en classification.official_benchmark, y la ficha lo habria
 * impreso como el nombre de un indice. Al filtrarlo en el extractor, la guarda bloqueo los 89
 * republish porque desde donde mira no se distingue corregir de perder un dato.
 */
const ABSENCE_MARKER_PATHS: ReadonlySet<string> = new Set(['classification.official_benchmark']);

/** `true` si el valor es uno de los marcadores de ausencia, sin importar mayusculas ni espacios. */
export function isAbsenceMarker(value: unknown): boolean {
    return typeof value === 'string' && ABSENCE_MARKERS.has(value.trim().toLowerCase());
}

/**
 * Retirada legitima: un marcador de ausencia en una ruta que los declara, un rating, o los bloques
 * de una clase de activo que ya no esta en la cartera nueva.
 */
export function isLegitimateRetirement(path: string, merged: any, liveValue?: unknown): boolean {
    if (ABSENCE_MARKER_PATHS.has(path) && isAbsenceMarker(liveValue)) return true;
    if (RATING_PATHS.has(path)) return true;
    const assetClass = underPrefixes(path, FIXED_INCOME_PATHS) ? 'bond' : underPrefixes(path, EQUITY_PATHS) ? 'equity' : null;
    if (!assetClass) return false;
    const weight = classWeight(merged, assetClass);
    return weight !== null && weight < LEGITIMATE_RETIREMENT_CLASS_WEIGHT;
}

function describeEmptied(path: string, value: unknown, merged: any): string {
    const how = value === undefined ? 'ausente' : value === null ? 'null' : 'sin valores';
    const weights = underPrefixes(path, FIXED_INCOME_PATHS) ? `; renta fija ${classWeight(merged, 'bond') ?? 'sin dato'}`
        : underPrefixes(path, EQUITY_PATHS) ? `; renta variable ${classWeight(merged, 'equity') ?? 'sin dato'}` : '';
    return `${path} (maestra con datos, canonico ${how}${weights})`;
}

/**
 * Rutas de la plataforma que tienen datos en la maestra (`live`) y que el documento fusionado (`merged`, lo
 * que se escribiria) dejaria vacias sin una retirada legitima.
 */
export function emptiedPlatformPaths(live: any, merged: any, isStock: boolean): string[] {
    const { owners, exceptions } = ownership(isStock);
    const foreign = new Set(exceptions.filter((exception) => exception.owner !== 'plataforma').map((exception) => exception.path));
    const out: string[] = [];
    const check = (path: string, liveValue: unknown, mergedValue: unknown): boolean => {
        if (!carriesData(liveValue)) return false;
        if (carriesData(mergedValue)) return false;
        if (!isLegitimateRetirement(path, merged, liveValue)) out.push(path);
        return true;
    };
    // Una clave que el canonico no trae y que el bloque no declara es obsoleta (el merge la limpia), no un vaciado.
    const obsolete = (container: unknown, key: string, known: readonly string[]): boolean =>
        !(isObject(container) && key in container) && !known.includes(key);
    for (const [block, owner] of Object.entries(owners)) {
        if (owner !== 'plataforma' || EMPTY_GUARD_SKIPPED_BLOCKS.has(block)) continue;
        const liveBlock = live?.[block];
        const mergedBlock = merged?.[block];
        if (check(block, liveBlock, mergedBlock) || !isObject(liveBlock)) continue;
        const knownChildren = [...declaredBlockKeys(isStock, block), ...(EMPTY_GUARD_KNOWN_KEYS[block] || [])];
        for (const [child, liveChild] of Object.entries(liveBlock)) {
            const path = `${block}.${child}`;
            if (EMPTY_GUARD_SKIPPED_KEYS.has(child) || foreign.has(path) || obsolete(mergedBlock, child, knownChildren)) continue;
            const mergedChild = isObject(mergedBlock) ? mergedBlock[child] : undefined;
            if (check(path, liveChild, mergedChild) || !EMPTY_GUARD_CONTAINERS.has(path) || !isObject(liveChild)) continue;
            for (const [grandchild, liveValue] of Object.entries(liveChild)) {
                if (obsolete(mergedChild, grandchild, EMPTY_GUARD_KNOWN_KEYS[path] || [])) continue;
                check(`${path}.${grandchild}`, liveValue, isObject(mergedChild) ? mergedChild[grandchild] : undefined);
            }
        }
    }
    // La asignacion de activos que el canonico no tiene llega imputada a `other` (normalizePortfolioExposure):
    // no esta vacia, pero el aviso del extractor dice que no hay dato.
    if (allocationUnavailable(merged) && !allocationUnavailable(live)
        && carriesData(live?.portfolio_exposure?.asset_mix) && !out.includes('portfolio_exposure')) {
        out.push('portfolio_exposure.asset_mix');
    }
    return out;
}

/**
 * newDoc = vivo con los bloques `plataforma` del contrato reemplazados por el canonico.
 * Conserva todo lo demas (app, legado, sub-rutas de otro dueno como performance.valuation).
 * Solo borra las claves raiz que el contrato declara obsoletas (x-obsolete-root-keys). Si el vivo
 * trae otra clave que el contrato no declara, no reescribe el documento (antes la eliminaba en
 * silencio, asi se habria perdido un is_investable) y lo reporta para migrarla.
 */
export function mergeOwnedDetailed(live: any, expected: any, isStock: boolean, nowIso: string, options: MergeOwnedOptions = {}): MergeOwnedResult {
    const { owners, exceptions, obsolete } = ownership(isStock);
    const unknown = Object.keys(live || {}).filter((key) => !(key in owners) && !obsolete.includes(key));
    if (unknown.length > 0) {
        throw new OwnershipConflictError(unknown, `REPUBLISH_UNKNOWN_ROOT_KEYS: ${unknown.join(', ')} no estan en el contrato; migrarlas antes de republicar.`);
    }
    if (live?.source_metadata?.source === 'MANUAL_DOCUMENTARY' && !options.acceptCanonical) {
        throw new OwnershipConflictError(['source_metadata.source'], 'REPUBLISH_MANUAL_DOCUMENTARY: alta documental de la app; el traspaso al canonico se decide por ISIN (--accept-canonical).');
    }
    const newDoc: any = { ...live };
    for (const key of obsolete) delete newDoc[key];
    for (const [key, owner] of Object.entries(owners)) {
        if (owner === 'plataforma' && key in expected) newDoc[key] = expected[key];
    }
    for (const { path: subPath, owner } of exceptions) {
        if (owner === 'plataforma') continue;
        const [parent, child] = subPath.split('.');
        const liveValue = live?.[parent]?.[child];
        if (liveValue !== undefined && parent in expected) {
            newDoc[parent] = { ...(newDoc[parent] || {}), [child]: liveValue };
        }
    }
    let legacyKept: string[] = [];
    let legacyConflicts: string[] = [];
    const preserved: PreservedPath[] = [];
    if (!isStock && !options.acceptCanonical) {
        const legacy = keepLegacyAppData(live, newDoc, expected);
        legacyConflicts = legacy.conflicts;
        legacyKept = legacy.kept;
    }
    // Despues del legado: lo que el merge conserva (renta fija documentada, evidencia del KID) no se vacia.
    const emptied = options.acceptCanonical ? [] : emptiedPlatformPaths(live, newDoc, isStock);
    // Un vaciado que la fuente ya no sirve no es motivo para no reescribir el documento: se conserva el
    // valor vivo en esa ruta y se sigue. Antes se abortaba la raiz entera, y con ella se perdian las
    // rutas donde el canonico SI mejora -- el 31-10-2026, el indice de referencia de doce fondos.
    // Lo que no se puede restaurar porque la maestra tampoco lo tiene: ahi se aborta como antes.
    const unresolved: string[] = [];
    const unresolvedText: string[] = [];
    for (const path of emptied) {
        const liveValue = getPath(live, path);
        if (liveValue === undefined) {
            unresolved.push(path);
            unresolvedText.push(describeEmptied(path, getPath(newDoc, path), newDoc));
            continue;
        }
        const canonicalValue = getPath(newDoc, path) ?? null;
        setPath(newDoc, path, liveValue);
        preserved.push({ path, reason: 'fuente_retirada', live: liveValue, canonical: canonicalValue });
    }
    if (legacyConflicts.length > 0) {
        throw new OwnershipConflictError([...legacyConflicts, ...unresolvedText], `REPUBLISH_LEGACY_CONFLICT: ${legacyConflicts.join('; ')}`, unresolved);
    }
    if (unresolved.length > 0) {
        throw new OwnershipConflictError(unresolvedText, `REPUBLISH_EMPTIED_BLOCKS: el canonico vaciaria ${unresolvedText.join('; ')}; decidir por ISIN (--accept-canonical).`, unresolved);
    }
    newDoc.schema_version = rootSchemaVersion(isStock);
    newDoc.updated_at = nowIso;
    return { doc: newDoc, legacyKept, preserved };
}

/**
 * Lo que de verdad cambiaria al reescribir `target` con `mergedDoc`: los bloques del canonico tal como
 * quedan tras el merge (no el canonico crudo) y las claves obsoletas que se borrarian. Sin esto, las 16
 * raices de renta fija con field_provenance salian «a republicar» en cada pasada y fallaban el
 * postverify aunque el merge las dejara igual (14-10-2026).
 */
export function rewriteDrift(target: any, expected: any, mergedDoc: any, isStock: boolean): string[] {
    const view = Object.fromEntries(Object.keys(expected).map((key) => [key, mergedDoc?.[key]]));
    const out = ownedDrift(view, target || {}, isStock);
    for (const key of ownership(isStock).obsolete) {
        if (target && key in target && !(key in (mergedDoc || {}))) out.push(key);
    }
    return out;
}

/** Compatibilidad: solo el documento final. */
export function mergeOwned(live: any, expected: any, isStock: boolean, nowIso: string, options: MergeOwnedOptions = {}): any {
    return mergeOwnedDetailed(live, expected, isStock, nowIso, options).doc;
}

/**
 * Deriva de una accion retenida (NOT_READY/EXCLUDED) con el mismo criterio que la ruta normal: las rutas de
 * ownedDrift, y ninguna si lo fusionado queda igual que lo vivo (rewriteDrift). Si el merge daria un conflicto
 * de dueno, la deriva se informa con el codigo del conflicto. No escribe nada.
 */
export function heldStockDrift(
    live: any,
    expected: any,
    nowIso: string,
    options: MergeOwnedOptions = {}
): { drift: string[]; conflict: string | null; unchangedAfterMerge: boolean } {
    const drift = [...new Set(ownedDrift(expected, live, true))].sort();
    if (drift.length === 0) return { drift, conflict: null, unchangedAfterMerge: false };
    try {
        const merged = mergeOwnedDetailed(live, expected, true, nowIso, options);
        // Como root_unchanged_after_merge en la ruta normal: difiere del canonico, pero lo fusionado queda igual.
        if (rewriteDrift(live, expected, merged.doc, true).length === 0) return { drift: [], conflict: null, unchangedAfterMerge: true };
        return { drift, conflict: null, unchangedAfterMerge: false };
    } catch (e: any) {
        if (!(e instanceof OwnershipConflictError)) throw e;
        return { drift, conflict: e.code, unchangedAfterMerge: false };
    }
}

export function buildRootUpdatePayload(live: any, finalDoc: Record<string, unknown>): admin.firestore.UpdateData<Record<string, unknown>> {
    const payload: Record<string, unknown> = { ...finalDoc };
    for (const key of Object.keys(live || {})) {
        if (!(key in finalDoc)) payload[key] = admin.firestore.FieldValue.delete();
    }
    return payload as admin.firestore.UpdateData<Record<string, unknown>>;
}

function validationErrorsToText(errors: Array<{ instancePath?: string; message?: string }>): string {
    return errors.map((e) => `${e.instancePath || '/'} ${e.message || ''}`.trim()).join('; ');
}

export function validateMergedRootDocument(finalDoc: any, isStock: boolean): void {
    const contract = validateCurrentRoot(finalDoc, isStock);
    if (!contract.ok) {
        throw new Error(`final merged root no valida contrato: ${validationErrorsToText(contract.errors)}`);
    }
}

/**
 * Fuentes de `metrics/latest` que calcula la app sobre la serie de la propia
 * maestra (functions_python: ingest_asset, fund_ingest y la politica de
 * historico R-04). Es la misma lista que `metrics_refresh.SELF_COMPUTED_SOURCES`,
 * que las recalcula a diario.
 */
export const APP_COMPUTED_METRICS_SOURCES: ReadonlySet<string> = new Set([
    'FONDOSDB_EODHD_DAILY_HISTORY',
    'FONDOSDB_FUND_NAV_EUR',
    'FUND_QUALITY_REVIEW_V1'
]);

/**
 * Si esta tuberia es duena de `metrics/latest` para este activo.
 *
 * ACCIONES: nunca. Las escribe la ingesta de la app desde la serie EODHD de la
 * propia maestra; republicarlas desde el canonico las pisaba (04-09).
 *
 * FONDOS: solo como puente. Desde la migracion del 10-09 la app calcula las
 * metricas de los fondos con serie propia (reconciliadas ventana a ventana
 * contra el trailing de Morningstar, metrics_reconciliation) y el refresco
 * diario las mantiene. Si el republish siguiera siendo dueno, la pasada en seco
 * sobre la copia del 13-10 habria devuelto al trailing del proveedor 714 de los
 * 752 fondos del canonico: dos escritores para el mismo documento, el mismo
 * fallo que se cerro para acciones. Esta tuberia conserva los que no tienen
 * documento o siguen con su trailing (FONDOSDB_ROOT_ES: 35 el 13-10).
 */
export function ownsMetrics(isStock: boolean, rootOnly: boolean, liveMetrics?: { source?: unknown } | null): boolean {
    if (rootOnly || isStock) return false;
    return !liveMetrics || !APP_COMPUTED_METRICS_SOURCES.has(String(liveMetrics.source ?? ''));
}

function isPreconditionFailure(e: any): boolean {
    const message = String(e?.message || e || '');
    return e?.code === 9 || e?.code === 'failed-precondition' || /FAILED_PRECONDITION|precondition|last.?update/i.test(message);
}

export async function writeMergedRootWithPrecondition(
    ref: { update: (data: admin.firestore.UpdateData<Record<string, unknown>>, precondition: admin.firestore.Precondition) => Promise<unknown> },
    snap: Pick<admin.firestore.DocumentSnapshot, 'updateTime'>,
    finalDoc: Record<string, unknown>,
    isStock: boolean,
    live: Record<string, unknown> = {}
): Promise<void> {
    validateMergedRootDocument(finalDoc, isStock);
    if (!snap.updateTime) throw new Error('REPUBLISH_CONCURRENT_PRECONDITION_MISSING: snapshot sin updateTime.');
    try {
        await ref.update(buildRootUpdatePayload(live, finalDoc), { lastUpdateTime: snap.updateTime });
    } catch (e: any) {
        if (isPreconditionFailure(e)) {
            throw new Error(`REPUBLISH_CONCURRENT_MODIFICATION: ${String(e?.message || e)}`);
        }
        throw e;
    }
}

export async function writeMetricsWithPrecondition(
    ref: {
        update: (data: admin.firestore.UpdateData<Record<string, unknown>>, precondition: admin.firestore.Precondition) => Promise<unknown>;
        create: (data: Record<string, unknown>) => Promise<unknown>;
    },
    snap: Pick<admin.firestore.DocumentSnapshot, 'exists' | 'updateTime'>,
    finalDoc: Record<string, unknown>,
    live: Record<string, unknown> = {}
): Promise<void> {
    const contract = validators.masterMetricsV13(finalDoc);
    if (!contract.ok) {
        throw new Error(`metrics final no valida contrato: ${validationErrorsToText(contract.errors)}`);
    }
    try {
        if (!snap.exists) {
            await ref.create(finalDoc);
            return;
        }
        if (!snap.updateTime) throw new Error('REPUBLISH_CONCURRENT_PRECONDITION_MISSING: metrics sin updateTime.');
        await ref.update(buildRootUpdatePayload(live, finalDoc), { lastUpdateTime: snap.updateTime });
    } catch (e: any) {
        if (isPreconditionFailure(e) || e?.code === 6 || /ALREADY_EXISTS/i.test(String(e?.message))) {
            throw new Error(`REPUBLISH_CONCURRENT_MODIFICATION: ${String(e?.message || e)}`);
        }
        throw e;
    }
}

function fullDiffPaths(expected: any, live: any): string[] {
    if (!live || typeof live !== 'object') return [''];
    const out: string[] = [];
    diffPaths(expected, live, '', out);
    for (const key of Object.keys(live)) {
        if (!(key in expected)) out.push(key);
    }
    return [...new Set(out.map((p) => p || '<doc>'))].sort();
}

function searchIndexDrift(expected: any, live: any): string[] {
    if (!live || typeof live !== 'object') return ['<doc>'];
    const expectedComparable = { ...expected, updated_at: '<ignored>' };
    const liveComparable = { ...live, updated_at: '<ignored>' };
    return fullDiffPaths(expectedComparable, liveComparable);
}

// Campos de metrics/latest PROPIEDAD DEL REFRESH de la app (metrics_refresh.py
// los escribe con merge: max_drawdown_hist calculado sobre la serie completa,
// last_date y updated_at). El loader NO los posee: se excluyen del diff y se
// preservan al escribir. Sin esto, cada republish los borraba y el refresh los
// recalculaba después, en un ping-pong perpetuo entre escritores (A11, 2026-07-11).
export const METRICS_REFRESH_OWNED_FIELDS = ['max_drawdown_hist', 'last_date', 'updated_at'] as const;

export function metricsOwnedDiff(expected: any, live: any): string[] {
    if (!live || typeof live !== 'object') return [''];
    const strip = (doc: any) => {
        const out: any = { ...doc };
        for (const key of METRICS_REFRESH_OWNED_FIELDS) delete out[key];
        return out;
    };
    return fullDiffPaths(strip(expected), strip(live));
}

export function mergeMetricsPreservingRefreshOwned(expected: any, live: any): any {
    const out: any = { ...expected };
    if (live && typeof live === 'object') {
        for (const key of METRICS_REFRESH_OWNED_FIELDS) {
            if (live[key] !== undefined) out[key] = live[key];
        }
    }
    return out;
}

export interface HoldingsDecisionRow {
    asset_id: string;
    decision: HoldingsDecision;
    replace: boolean;
    live_as_of_date: string | null;
    expected_as_of_date: string | null;
    live_count: number;
    expected_count: number;
    reasons: string[];
    warning: string | null;
    /** Motivo de la decision: fechas, posiciones, cobertura y la condicion que decide. */
    motive: string;
    expected_coverage: string;
    live_coverage: string;
    /** provenance, holdings_review (fund_profile/latest) o none. */
    live_coverage_source: string;
}

export function holdingsDecisionRow(plan: HoldingsRepublishPlan): HoldingsDecisionRow {
    return {
        asset_id: plan.asset_id,
        decision: plan.decision,
        replace: plan.replace,
        live_as_of_date: plan.live_as_of_date,
        expected_as_of_date: plan.expected_as_of_date,
        live_count: plan.live_count,
        expected_count: plan.expected_count,
        reasons: plan.reasons,
        warning: plan.warning,
        motive: plan.motive,
        expected_coverage: plan.expected_coverage,
        live_coverage: plan.live_coverage,
        live_coverage_source: plan.live_coverage_source
    };
}

/** Contadores del resumen para una cartera que difiere del canonico. */
export function countHoldingsDecision(
    summary: {
        holdings_to_replace: number;
        holdings_to_set: number;
        holdings_to_delete: number;
        holdings_kept_newer_live: number;
        holdings_kept_complete_older_live: number;
        holdings_kept_more_complete: number;
        holdings_kept_same_date_tie: number;
        holdings_kept_undated: number;
        holdings_by_decision: Record<string, number>;
        holdings_replace_complete_older: number;
        holdings_replace_newer_but_shorter: number;
        holdings_replace_newer_short: number;
    },
    plan: HoldingsRepublishPlan
): void {
    summary.holdings_by_decision[plan.decision] = (summary.holdings_by_decision[plan.decision] || 0) + 1;
    if (plan.replace) {
        summary.holdings_to_replace++;
        summary.holdings_to_set += plan.set_operations.length;
        summary.holdings_to_delete += plan.delete_paths.length;
        if (plan.decision === 'REPLACE_COMPLETE_OLDER') summary.holdings_replace_complete_older++;
        if (plan.decision === 'REPLACE_NEWER' && plan.expected_count < plan.live_count) {
            summary.holdings_replace_newer_but_shorter++;
            // Menos del 80 % de la viva y aun asi sustituye (mas de 183 dias, COMPLETE declarado o viva parcial): ver motive.
            if (isShortHoldings(plan.expected_count, plan.live_count)) summary.holdings_replace_newer_short++;
        }
        return;
    }
    if (plan.decision === 'KEEP_NEWER_LIVE') summary.holdings_kept_newer_live++;
    else if (plan.decision === 'KEEP_COMPLETE_OLDER_LIVE') summary.holdings_kept_complete_older_live++;
    else if (plan.decision === 'KEEP_MORE_COMPLETE') summary.holdings_kept_more_complete++;
    else if (plan.decision === 'KEEP_SAME_DATE_TIE') summary.holdings_kept_same_date_tie++;
    else if (plan.decision === 'KEEP_UNDATED') summary.holdings_kept_undated++;
}

export interface RepublishDeps {
    /** Maestra a usar (los tests pasan una falsa); por defecto, la de FIREBASE_PROJECT_ID con su allowlist. */
    db?: admin.firestore.Firestore;
    env?: NodeJS.ProcessEnv;
}

export interface RepublishResult {
    /** El resumen que tambien queda en --out (republish_summary.json). */
    summary: Record<string, any>;
    /** 1 si fallo una escritura, un postverify o la reconciliacion del indice; lo fija main en process.exitCode. */
    exitCode: 0 | 1;
}

/** El republish entero sobre unos argumentos. No toca process.exitCode: devuelve el codigo. */
export async function runRepublish(argv: string[], deps: RepublishDeps = {}): Promise<RepublishResult> {
    const env = deps.env || process.env;
    const write = hasFlag(argv, '--write');
    const inputDir = getFlag(argv, '--input') || env.FONDOSDB_INPUT_DIR || '';
    // Con --export-bdb y sin --input no hay manifiesto que validar ni poblacion stock: las acciones caerian
    // por la ruta de fondos y --accept-canonical all las reescribiria como fondo (CRIT-09).
    if (write && !inputDir) {
        throw new Error('REPUBLISH_INPUT_REQUIRED: --write exige --input <dir> (o FONDOSDB_INPUT_DIR): sin el no se valida el manifiesto del paquete ni se lee la poblacion stock.');
    }
    const paths = resolvePaths(argv, env);
    const onlySearchIndex = hasFlag(argv, '--only-search-index');
    const rootOnly = hasFlag(argv, '--root-only');
    // Solo carteras: escribe exactamente lo que lista holdings_replaced.json, sin raices, metricas ni search_index.
    const holdingsOnly = hasFlag(argv, '--holdings-only');
    if (rootOnly && holdingsOnly) throw new Error('--root-only y --holdings-only son incompatibles.');
    // Conflictos de dueno resueltos a favor del canonico: lista de ISIN o 'all' (decision explicita).
    const acceptCanonicalArg = (getFlag(argv, '--accept-canonical') || '').trim();
    const acceptCanonical = (isin: string) => acceptCanonicalArg === 'all'
        || acceptCanonicalArg.split(',').map((s) => s.trim().toUpperCase()).includes(isin);
    const idsArg = getFlag(argv, '--ids') || 'all';
    const limit = getFlag(argv, '--limit') ? Number(getFlag(argv, '--limit')) : undefined;
    const runId = new Date().toISOString().replace(/[:.]/g, '-');
    const outDir = path.join(getFlag(argv, '--out') || path.join(process.cwd(), 'runs'), `republish_${runId}`);
    fs.mkdirSync(outDir, { recursive: true });

    if (write && !isWriteAuthorized(env)) {
        throw new Error(`SECURITY FAULT: ${PLATFORM_WRITE_GATE} debe valer '${PLATFORM_WRITE_GATE_VALUE}' para republicar.`);
    }

    const pkg = readCanonicalPackage(paths);
    // Con --write, un fallo aqui aborta antes de leer o escribir la maestra.
    let stockPopulationUnavailable = false;
    const stockRowByIsin = loadStockPopulation(inputDir, write, (message) => {
        stockPopulationUnavailable = true;
        console.warn(message);
    });

    const db = deps.db || getDb(env);

    let candidates: string[];
    if (idsArg === 'all') candidates = [...new Set([
        ...pkg.rawByIsin.keys(),
        ...pkg.canonicalValidationIssues.map((issue) => issue.asset_id).filter((id): id is string => Boolean(id))
    ])];
    else if (fs.existsSync(idsArg)) candidates = fs.readFileSync(idsArg, 'utf-8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    else candidates = idsArg.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
    if (limit) candidates = candidates.slice(0, limit);

    const summary = {
        run_id: runId,
        write,
        root_only: rootOnly,
        holdings_only: holdingsOnly,
        checked: 0,
        matched: 0,
        to_republish: 0,
        root_to_republish: 0,
        metrics_to_set: 0,
        // Fondos cuyo metrics/latest ya es calculo propio de la app: no se tocan.
        metrics_app_owned: 0,
        holdings_checked: 0,
        // Carteras que difieren del canonico; de ellas, solo se escriben las de holdings_to_replace.
        holdings_stale: 0,
        holdings_to_replace: 0,
        holdings_to_set: 0,
        holdings_to_delete: 0,
        // Regla «gana la mas reciente» (holdingsRepublish.decideHoldingsRepublish): carteras vivas
        // que se conservan aunque difieran. Lista en holdings_kept.json, con el motivo.
        holdings_kept_newer_live: 0,
        // Cobertura: el canonico es mas reciente pero parcial y la viva, mas completa, le saca como mucho
        // 183 dias (incluye la antigua KEEP_COMPLETE_OVER_PARTIAL).
        holdings_kept_complete_older_live: 0,
        holdings_kept_more_complete: 0,
        holdings_kept_same_date_tie: 0,
        holdings_kept_undated: 0,
        holdings_by_decision: {} as Record<string, number>,
        // Cobertura: la viva es mas reciente pero declarada parcial (provenance o holdings_review) y el
        // canonico, mas completo, no le saca mas de 183 dias. Lista en holdings_replaced.json, con el motivo.
        holdings_replace_complete_older: 0,
        // Sustituciones en las que el canonico es mas reciente pero trae menos posiciones (informativo).
        holdings_replace_newer_but_shorter: 0,
        // De ellas, con menos del 80 % de las posiciones de la viva (el motivo, en holdings_replaced.json).
        holdings_replace_newer_short: 0,
        republished: 0,
        metrics_set: 0,
        holdings_refreshed: 0,
        holdings_set: 0,
        holdings_deleted: 0,
        search_index_to_set: 0,
        search_index_set: 0,
        // La reconciliacion del indice (unico escritor de meta/search_index) fallo: la ejecucion sale con codigo 1.
        search_index_reconcile_failed: false,
        // Escrituras de raiz, metricas o cartera que fallaron (no los conflictos de dueno): codigo 1.
        write_errors: 0,
        // Codigo de salida de la ejecucion (ver RepublishResult).
        exit_code: 0 as 0 | 1,
        canonical_invalid: 0,
        skipped_invalid: 0,
        reclassified: 0,
        live_missing: 0,
        postverify_ok: 0,
        postverify_failed: 0,
        by_population: { fund: 0, stock: 0 },
        root_by_population: { fund: 0, stock: 0 },
        metrics_by_population: { fund: 0, stock: 0 },
        // Raices que el republish no reescribe porque perderia algo que no es suyo (ver mergeOwnedDetailed).
        ownership_conflicts: 0,
        // De ellas, las que vaciarian un bloque de la plataforma con datos (guarda de vaciado), y por codigo.
        ownership_conflicts_emptied: 0,
        ownership_conflicts_by_code: {} as Record<string, number>,
        // Raices que difieren del canonico pero que, una vez fusionadas, quedarian igual (ver rewriteDrift).
        root_unchanged_after_merge: 0,
        legacy_kept: {} as Record<string, number>,
        preserved_by_reason: {} as Record<string, number>,
        // Poblacion de acciones leida (0 en una pasada en seco sin --input) y si falto (CRIT-09).
        stock_population: stockRowByIsin.size,
        stock_population_unavailable: stockPopulationUnavailable,
        // Acciones NOT_READY/EXCLUDED que difieren de la maestra y no se republican (stock_held.json).
        stock_not_ready: 0,
        // Canonicos de accion sin fila stock: error, nunca se mapean como fondo.
        stock_without_row: 0,
        warnings: [] as Array<{ asset_id: string; warning: string }>,
        errors: [] as Array<{ asset_id: string; error: string }>
    };
    const plan: Array<{
        asset_id: string;
        population: string;
        operations: string[];
        drift_fields: string[];
        drift_paths: string[];
        root_drift_paths: string[];
        metrics_drift_paths: string[];
        holdings_drift_paths: string[];
        holdings_set_paths: string[];
        holdings_delete_paths: string[];
    }> = [];
    // Reclasificados (live.asset_type != expected.asset_type, p.ej. fund->stock): NO se auto-republican
    // (mergeOwned dejaria restos de la poblacion vieja); se apartan para tratamiento manual/dedicado.
    const reclassified: Array<{ asset_id: string; from: string; to: string }> = [];
    const ownershipConflicts: Array<{ asset_id: string; population: string; code: string; paths: string[]; emptied: string[]; drift: string[] }> = [];
    // Acciones NOT_READY/EXCLUDED que difieren de la maestra: no se republican (CRIT-09).
    const stockHeld: Array<{ asset_id: string; status: string; reasons: string[]; drift: string[]; conflict?: string }> = [];
    /** Rutas donde se conservo lo vivo porque el canonico habia retrocedido: preserved_withdrawn.json. */
    const preservedPaths: Array<{ asset_id: string; population: string } & PreservedPath> = [];
    // Una fila por cartera que difiere del canonico: las que se escriben y las que se conservan.
    const holdingsDecisions: HoldingsDecisionRow[] = [];

    if (!onlySearchIndex) for (let i = 0; i < candidates.length; i += 250) {
        const chunk = candidates.slice(i, i + 250);
        const rootRefs = chunk.map((id) => db.doc(`assets/${id}`));
        const metricsRefs = chunk.map((id) => db.doc(`assets/${id}/metrics/latest`));
        const rootSnaps = await db.getAll(...rootRefs);
        const metricsSnaps = await db.getAll(...metricsRefs);
        for (let j = 0; j < chunk.length; j++) {
            const isin = chunk[j];
            const snap = rootSnaps[j];
            const canonicalIssues = canonicalIssuesForAsset(pkg, isin);
            if (canonicalIssues.length > 0) {
                summary.canonical_invalid++;
                summary.skipped_invalid++;
                summary.errors.push({
                    asset_id: isin,
                    error: `canonico en REVIEW: ${canonicalIssues.flatMap((issue) => issue.errors).join('; ')}`
                });
                plan.push({
                    asset_id: isin,
                    population: 'review',
                    operations: ['review:canonical_invalid'],
                    drift_fields: ['canonical_validation'],
                    drift_paths: canonicalIssues.flatMap((issue) => issue.errors),
                    root_drift_paths: [],
                    metrics_drift_paths: [],
                    holdings_drift_paths: [],
                    holdings_set_paths: [],
                    holdings_delete_paths: []
                });
                continue;
            }
            if (!snap.exists) { summary.live_missing++; continue; }
            summary.checked++;
            const stockRow = stockRowByIsin.get(isin);
            const isStock = !!stockRow;
            let expected: any;
            let expectedMetrics: any;
            if (!isStock) {
                const entry = pkg.rawByIsin.get(isin);
                if (!entry) continue;
                // Defensa en profundidad: una accion sin fila stock nunca se mapea con mapFondosDbFund. El mapper
                // la tipa STOCK y el contrato de fondos lo admite, asi que nada mas lo pararia (CRIT-09).
                const stockWithoutRow = (): void => {
                    summary.stock_without_row++;
                    summary.errors.push({ asset_id: isin, error: 'REPUBLISH_STOCK_WITHOUT_ROW: el canonico es una accion y no hay fila de la poblacion stock; no se trata como fondo.' });
                };
                if (isStockCanonical(entry.data)) { stockWithoutRow(); continue; }
                const mapped = mapFondosDbFund(entry.file, entry.data, pkg.universalByIsin.get(isin), {
                    duplicateIsin: pkg.duplicateIsins.has(isin),
                    problematicFlags: pkg.problematicByIsin.get(isin)?.flags,
                    qualityFlags: pkg.qualityByIsin.get(isin)?.flags
                });
                if (!mapped.asset) continue;
                if (mapped.asset.asset_type === 'STOCK') { stockWithoutRow(); continue; }
                expected = mapped.asset;
            }
            if (isStock) expected = stockRow.root;
            // Las metricas de accion NO son de esta tuberia. Las escribe la
            // ingesta de la app (ingest_asset -> source FONDOSDB_EODHD_DAILY_HISTORY)
            // desde la serie EODHD que vive en la propia maestra. Republicarlas
            // desde el canonico del extractor las pisaba: la pasada en seco del
            // 04-09 iba a revertir 73 de los 320 activos recien recalculados con
            // la formula correcta (auditoria 03-09, hallazgo 03: dos escritores
            // para un mismo documento). El docstring de este modulo ya decia que
            // las metricas se preservan; ahora el codigo lo cumple.
            //
            // Comprobado sobre la maestra el 04-09: las 74 acciones del canonico
            // ya tenian metricas de la app, asi que esta tuberia no era la unica
            // fuente de ninguna. Los fondos siguen igual: sus metricas SI son
            // suyas, copiadas de Morningstar.
            const metricsLive = !rootOnly && metricsSnaps[j].exists ? (metricsSnaps[j].data() || {}) : null;
            const metricsOwned = !holdingsOnly && ownsMetrics(isStock, rootOnly, metricsLive);
            if (!isStock && !rootOnly && !holdingsOnly && !metricsOwned) summary.metrics_app_owned++;
            expectedMetrics = metricsOwned ? buildFundMetricsLatest(expected) : null;
            // El payload owned debe validar su contrato (seguridad).
            const contract = validateCurrentRoot(expected, isStock);
            if (!contract.ok) { summary.skipped_invalid++; summary.errors.push({ asset_id: isin, error: 'expected no valida contrato: ' + contract.errors.map((e) => e.message).join('; ') }); continue; }
            if (metricsOwned) {
                const metricsContract = validators.masterMetricsV13(expectedMetrics);
                if (!metricsContract.ok) { summary.skipped_invalid++; summary.errors.push({ asset_id: isin, error: 'metrics/latest no valida contrato: ' + metricsContract.errors.map((e) => e.message).join('; ') }); continue; }
            }

            const live = snap.data() || {};
            // Guarda de reclasificacion: si el tipo cambio (fund<->stock), apartar (no mezclar poblaciones).
            if (live.asset_type && expected.asset_type && live.asset_type !== expected.asset_type) {
                summary.reclassified++;
                reclassified.push({ asset_id: isin, from: String(live.asset_type), to: String(expected.asset_type) });
                continue;
            }
            // Mismos bloqueos que la alta y la reclasificacion: una accion NOT_READY/EXCLUDED no se republica.
            // Va despues de la guarda de reclasificacion (una NOT_READY que la maestra tiene como fondo sale en
            // reclassified.json) y su deriva se mide como en la ruta normal: solo lo que el merge cambiaria.
            if (stockRow && STOCK_HOLD_STATUSES.has(stockRow.status)) {
                const held = holdingsOnly
                    ? { drift: [] as string[], conflict: null, unchangedAfterMerge: false }
                    : heldStockDrift(live, expected, new Date().toISOString(), { acceptCanonical: acceptCanonical(isin) });
                if (held.unchangedAfterMerge) summary.root_unchanged_after_merge++;
                if (held.drift.length === 0) { summary.matched++; continue; }
                summary.stock_not_ready++;
                const reasons = stockRow.status_reasons || [];
                stockHeld.push({ asset_id: isin, status: stockRow.status, reasons, drift: held.drift, ...(held.conflict ? { conflict: held.conflict } : {}) });
                summary.warnings.push({ asset_id: isin, warning: `REPUBLISH_STOCK_NOT_READY: accion ${stockRow.status} (${reasons.join(', ') || 'sin motivo'}); difiere de la maestra y no se republica.` });
                plan.push({
                    asset_id: isin,
                    population: 'stock',
                    operations: ['hold:stock_not_ready'],
                    drift_fields: [...new Set(held.drift.map((p) => p.split('.')[0]))],
                    drift_paths: held.drift,
                    root_drift_paths: held.drift,
                    metrics_drift_paths: [],
                    holdings_drift_paths: [],
                    holdings_set_paths: [],
                    holdings_delete_paths: []
                });
                continue;
            }
            let rootDrift = holdingsOnly ? [] : ownedDrift(expected, live, isStock);
            let merged: MergeOwnedResult | null = null;
            if (rootDrift.length > 0) {
                try {
                    merged = mergeOwnedDetailed(live, expected, isStock, new Date().toISOString(), { acceptCanonical: acceptCanonical(isin) });
                    // El canonico difiere, pero lo que se escribiria es igual a lo vivo (p. ej. renta fija
                    // con field_provenance que el merge conserva): no hay nada que reescribir.
                    if (rewriteDrift(live, expected, merged.doc, isStock).length === 0) {
                        summary.root_unchanged_after_merge++;
                        rootDrift = [];
                        merged = null;
                    } else {
                        // Legado conservado en una raiz que SI se reescribe (si no se reescribe, no se «conserva» nada).
                        for (const kept of merged.legacyKept) summary.legacy_kept[kept] = (summary.legacy_kept[kept] || 0) + 1;
                        for (const row of merged.preserved) {
                            summary.preserved_by_reason[row.reason] = (summary.preserved_by_reason[row.reason] || 0) + 1;
                            preservedPaths.push({ asset_id: isin, population: isStock ? 'stock' : 'fund', ...row });
                        }
                    }
                } catch (e: any) {
                    if (!(e instanceof OwnershipConflictError)) throw e;
                    summary.ownership_conflicts++;
                    summary.ownership_conflicts_by_code[e.code] = (summary.ownership_conflicts_by_code[e.code] || 0) + 1;
                    if (e.emptied.length > 0) summary.ownership_conflicts_emptied++;
                    ownershipConflicts.push({ asset_id: isin, population: isStock ? 'stock' : 'fund', code: e.code, paths: e.paths, emptied: e.emptied, drift: rootDrift });
                    summary.errors.push({ asset_id: isin, error: e.message });
                    rootDrift = [];
                }
            }
            const metricsDrift = metricsOwned ? metricsOwnedDiff(expectedMetrics, metricsLive) : [];
            let holdingsPlan: HoldingsRepublishPlan | null = null;
            if (!rootOnly && !isStock) {
                const records = pkg.holdingsByFundIsin.get(isin) || [];
                if (records.length > 0) {
                    summary.holdings_checked++;
                    holdingsPlan = await planHoldingsRepublish(db, isin, records, new Date().toISOString());
                    if (holdingsPlan.stale) {
                        summary.holdings_stale++;
                        countHoldingsDecision(summary, holdingsPlan);
                        holdingsDecisions.push(holdingsDecisionRow(holdingsPlan));
                        if (holdingsPlan.warning) summary.warnings.push({ asset_id: isin, warning: holdingsPlan.warning });
                    }
                }
            }
            // Solo cuenta como deriva lo que se va a escribir: una cartera viva conservada no se toca.
            const holdingsDrift = holdingsPlan?.replace
                ? holdingsPlan.reasons.map((reason) => `holdings.${reason}`)
                : [];
            if (rootDrift.length === 0 && metricsDrift.length === 0 && holdingsDrift.length === 0) {
                summary.matched++;
                continue;
            }

            summary.to_republish++;
            const population = isStock ? 'stock' : 'fund';
            summary.by_population[population]++;
            if (rootDrift.length > 0) {
                summary.root_to_republish++;
                summary.root_by_population[population]++;
            }
            if (metricsDrift.length > 0) {
                summary.metrics_to_set++;
                summary.metrics_by_population[population]++;
            }
            plan.push({
                asset_id: isin,
                population,
                operations: [
                    ...(rootDrift.length > 0 ? ['root:set_owned'] : []),
                    ...(metricsDrift.length > 0 ? ['metrics:set_complete'] : []),
                    ...(holdingsPlan?.replace ? ['holdings:set_complete'] : []),
                    ...(holdingsPlan?.delete_paths.length ? ['holdings:delete_obsolete'] : [])
                ],
                drift_fields: [...new Set([
                    ...rootDrift,
                    ...metricsDrift.map((p) => `metrics.${p}`),
                    ...holdingsDrift
                ].map((p) => p.split('.')[0]))],
                drift_paths: [...new Set([
                    ...rootDrift,
                    ...metricsDrift.map((p) => `metrics.${p}`),
                    ...holdingsDrift
                ])].sort(),
                root_drift_paths: [...new Set(rootDrift)].sort(),
                metrics_drift_paths: [...new Set(metricsDrift)].sort(),
                holdings_drift_paths: holdingsDrift,
                holdings_set_paths: holdingsPlan?.set_operations.map((operation) => operation.path) || [],
                holdings_delete_paths: holdingsPlan?.delete_paths || []
            });

            if (write) {
                try {
                    if (rootDrift.length > 0) {
                        const newDoc = merged!.doc;
                        await writeMergedRootWithPrecondition(db.doc(`assets/${isin}`), snap, newDoc, isStock, live);
                        summary.republished++;
                        const after = (await db.doc(`assets/${isin}`).get()).data() || {};
                        // Se verifica contra lo escrito, no contra el canonico: lo conservado (legado) no es fallo.
                        if (rewriteDrift(after, expected, newDoc, isStock).length === 0) summary.postverify_ok++; else summary.postverify_failed++;
                    }
                    if (metricsDrift.length > 0) {
                        // SET de los campos owned del loader + preservación de los refresh-owned vivos (A11).
                        const metricsPayload = mergeMetricsPreservingRefreshOwned(expectedMetrics, metricsLive);
                        await writeMetricsWithPrecondition(
                            db.doc(`assets/${isin}/metrics/latest`),
                            metricsSnaps[j],
                            metricsPayload,
                            metricsLive || {}
                        );
                        summary.metrics_set++;
                        const afterMetrics = (await db.doc(`assets/${isin}/metrics/latest`).get()).data() || {};
                        if (metricsOwnedDiff(expectedMetrics, afterMetrics).length === 0) summary.postverify_ok++; else summary.postverify_failed++;
                    }
                    if (holdingsPlan?.replace) {
                        const result = await executeHoldingsRepublish(db, holdingsPlan);
                        summary.holdings_refreshed++;
                        summary.holdings_set += result.sets_executed;
                        summary.holdings_deleted += result.deletes_executed;
                        if (result.postverify_ok) summary.postverify_ok++; else summary.postverify_failed++;
                    }
                } catch (e: any) {
                    // Escritura fallida (p. ej. REPUBLISH_CONCURRENT_MODIFICATION): la ejecucion sale con codigo 1.
                    summary.write_errors++;
                    summary.errors.push({ asset_id: isin, error: String(e?.message || e) });
                }
            }
        }
    }

    // Indice de busqueda. La deriva del paquete frente al indice vivo es informativa (pasada en seco); quien
    // escribe `meta/search_index` es solo reconcileSearchIndexLive, desde las raices vivas tras las escrituras
    // (ALTA-18, auditoria del 16-10-2026). Antes se escribia primero el indice del paquete sin filtrar (acciones
    // NOT_READY, ids que no existen en la maestra) y si la reconciliacion fallaba se quedaba asi.
    let searchIndexDiff: string[] = [];
    const searchIndexPlanRow = (driftPaths: string[]) => ({
        asset_id: SEARCH_INDEX_PATH,
        population: 'meta',
        operations: ['search_index:set'],
        drift_fields: driftPaths.length > 0 ? ['search_index'] : [],
        drift_paths: driftPaths,
        root_drift_paths: [],
        metrics_drift_paths: [],
        holdings_drift_paths: [],
        holdings_set_paths: [],
        holdings_delete_paths: []
    });
    if (!rootOnly && !holdingsOnly) {
        const searchIndexUpdatedAt = new Date().toISOString();
        const searchIndexIncoming = buildSearchIndexDocument(pkg, stockRowByIsin, searchIndexUpdatedAt);
        const searchIndexSnap = await db.doc(SEARCH_INDEX_PATH).get();
        const searchIndexLive = searchIndexSnap.exists ? (searchIndexSnap.data() || {}) : null;
        const searchIndexExpected = mergeSearchIndexDocument(
            searchIndexLive,
            searchIndexIncoming,
            searchIndexUpdatedAt
        );
        const searchIndexContract = validators.masterSearchIndex(searchIndexExpected);
        if (!searchIndexContract.ok) {
            summary.skipped_invalid++;
            summary.errors.push({ asset_id: SEARCH_INDEX_PATH, error: 'search_index no valida contrato: ' + searchIndexContract.errors.map((e) => e.message).join('; ') });
        } else {
            searchIndexDiff = searchIndexDrift(searchIndexExpected, searchIndexLive);
            // En seco, search_index:set solo si hay deriva; con --write, solo si la reconciliacion escribe (abajo).
            if (!write && searchIndexDiff.length > 0) {
                summary.search_index_to_set = 1;
                plan.push(searchIndexPlanRow(searchIndexDiff));
            }
        }
    }

    if (write && !rootOnly && !holdingsOnly) {
        try {
            // Con precondicion y reintento (H06); valida el contrato antes de escribir.
            if (await reconcileSearchIndexLive(db, true, env)) {
                summary.search_index_to_set = 1;
                summary.search_index_set = 1;
                plan.push(searchIndexPlanRow(searchIndexDiff));
                const after = await db.doc(SEARCH_INDEX_PATH).get();
                if (after.exists && Object.keys(after.data() || {}).length > 0) summary.postverify_ok++; else summary.postverify_failed++;
            }
        } catch (e: any) {
            // El indice puede haber quedado sin las altas de esta pasada: la ejecucion falla (codigo 1).
            summary.search_index_reconcile_failed = true;
            summary.errors.push({ asset_id: SEARCH_INDEX_PATH, error: `reconciliation: ${String(e?.message || e)}` });
        }
    }

    // Codigo de salida, como cli.ts: 1 si fallo una escritura, un postverify o la reconciliacion del indice, o si
    // con --write quedo una accion sin fila stock (configuracion). Los conflictos de dueno, REVIEW, skipped_invalid,
    // las reclasificadas y las retenidas son esperados y no cuentan (ver cabecera). Lo fija main, no esta funcion.
    const failed = summary.search_index_reconcile_failed
        || summary.write_errors > 0
        || summary.postverify_failed > 0
        || (write && summary.stock_without_row > 0);
    const exitCode: 0 | 1 = failed ? 1 : 0;
    summary.exit_code = exitCode;

    if (write && !rootOnly) {
        try { await writeIngestionRun(db, { run_id: runId, kind: 'republish', summary: summary as unknown as Record<string, unknown> }); }
        catch (e: any) { console.warn('[republish] aviso: no pude escribir ingestion_runs:', e?.message || e); }
    }
    fs.writeFileSync(path.join(outDir, 'republish_summary.json'), JSON.stringify(summary, null, 2) + '\n', 'utf-8');
    fs.writeFileSync(path.join(outDir, 'republish_plan.json'), JSON.stringify(plan, null, 2) + '\n', 'utf-8');
    fs.writeFileSync(path.join(outDir, 'reclassified.json'), JSON.stringify(reclassified, null, 2) + '\n', 'utf-8');
    fs.writeFileSync(path.join(outDir, 'ownership_conflicts.json'), JSON.stringify(ownershipConflicts, null, 2) + '\n', 'utf-8');
    fs.writeFileSync(path.join(outDir, 'holdings_replaced.json'), JSON.stringify(holdingsDecisions.filter((row) => row.replace), null, 2) + '\n', 'utf-8');
    fs.writeFileSync(path.join(outDir, 'holdings_kept.json'), JSON.stringify(holdingsDecisions.filter((row) => !row.replace), null, 2) + '\n', 'utf-8');
    fs.writeFileSync(path.join(outDir, 'stock_held.json'), JSON.stringify(stockHeld, null, 2) + '\n', 'utf-8');
    fs.writeFileSync(path.join(outDir, 'preserved_withdrawn.json'), JSON.stringify(preservedPaths, null, 2) + '\n', 'utf-8');
    console.log(`[republish] write=${write} checked=${summary.checked} matched=${summary.matched} conflictos_dueno=${summary.ownership_conflicts} (vaciado ${summary.ownership_conflicts_emptied}) a_republicar=${summary.to_republish} root=${summary.root_to_republish} metrics=${summary.metrics_to_set} metricas_app=${summary.metrics_app_owned} holdings_stale=${summary.holdings_stale}/${summary.holdings_checked} search_index=${summary.search_index_to_set} (fund ${summary.by_population.fund} / stock ${summary.by_population.stock}) reclasificados=${summary.reclassified}`);
    console.log(`[republish] carteras: se sustituyen ${summary.holdings_to_replace} de ${summary.holdings_stale} distintas (${summary.holdings_replace_complete_older} por cobertura, holdings_replaced.json); se conservan ${summary.holdings_kept_newer_live} por mas recientes, ${summary.holdings_kept_complete_older_live} por cobertura, ${summary.holdings_kept_more_complete} por mas completas, ${summary.holdings_kept_same_date_tie} por empate y ${summary.holdings_kept_undated} sin fecha (holdings_kept.json)`);
    console.log(`[republish] acciones: poblacion ${summary.stock_population}${summary.stock_population_unavailable ? ' (NO DISPONIBLE: falta --input o no se pudo leer)' : ''}, no republicadas por NOT_READY/EXCLUDED ${summary.stock_not_ready} (stock_held.json), canonicos de accion sin fila stock ${summary.stock_without_row}`);
    if (summary.holdings_kept_undated > 0) console.warn(`[republish] aviso: ${summary.holdings_kept_undated} carteras sin fecha comparable; se conservan las vivas (ver warnings en republish_summary.json).`);
    if (write) console.log(`[republish] roots=${summary.republished} metrics=${summary.metrics_set} holdings=${summary.holdings_refreshed} sets=${summary.holdings_set} deletes=${summary.holdings_deleted} search_index=${summary.search_index_set} postverify ${summary.postverify_ok}/${summary.postverify_ok + summary.postverify_failed} errores=${summary.errors.length}`);
    else console.log('[republish] DRY-RUN: 0 escrituras. Revisa republish_plan.json.');
    if (exitCode) console.error(`[republish] ERROR: ${summary.write_errors} escrituras fallidas, ${summary.postverify_failed} postverify fallidos${summary.search_index_reconcile_failed ? ', reconciliacion del indice fallida' : ''}${write && summary.stock_without_row > 0 ? `, ${summary.stock_without_row} acciones sin fila stock (¿--export-bdb distinto de <input>/export_bdb?)` : ''}; codigo de salida 1.`);
    console.log(`[republish] artefactos en ${outDir}`);
    return { summary, exitCode };
}

async function main(): Promise<void> {
    const { exitCode } = await runRepublish(process.argv.slice(2));
    if (exitCode) process.exitCode = exitCode;
}

if (require.main === module) {
    main().catch((e) => { console.error('[republish] ERROR:', e?.message || e); process.exit(1); });
}
