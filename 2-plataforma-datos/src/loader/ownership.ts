/**
 * src/loader/ownership.ts — dueno de cada bloque de assets/{id}, leido del contrato maestro.
 *
 * Fuente unica: la anotacion `x-owner` de contracts/master/asset.v1.3 (fondos/ETF) y
 * asset-stock.v1.1 (acciones). Antes el republish llevaba dos listas a mano (OWNED_* y
 * ALLOWED_*_ROOT_KEYS) que se desalinearon del contrato: borraba `fundamentals` de los ETF y
 * `currency`/`economic_asset_class` de las acciones aunque el contrato los admitia.
 *
 *   plataforma  el republish lo reescribe desde el canonico
 *   app         lo escribe 3-BDB-ACTIVOS_app; el republish lo conserva tal cual
 *   legado      sin escritor vigente; se conserva y solo cambia por migracion
 *   metadatos   asset_id, schema_version, updated_at
 *
 * `x-owner-exceptions` declara sub-rutas de otro dueno dentro de un bloque (performance.valuation
 * es de price_refresh, en la app).
 */
import fundSchema from '../../contracts/master/asset.v1.3.schema.json';
import stockSchema from '../../contracts/master/asset-stock.v1.1.schema.json';
import { validators } from '../../contracts/validators';

export type Owner = 'plataforma' | 'app' | 'legado' | 'metadatos';
const OWNERS: ReadonlySet<string> = new Set(['plataforma', 'app', 'legado', 'metadatos']);

export const FUND_ROOT_SCHEMA_VERSION = 'master.asset.v1.3';
export const STOCK_ROOT_SCHEMA_VERSION = 'master.asset-stock.v1.1';

export interface RootOwnership {
    owners: Readonly<Record<string, Owner>>;
    exceptions: ReadonlyArray<{ path: string; owner: Owner }>;
    /** Claves raiz retiradas que el republish puede borrar (x-obsolete-root-keys). Cualquier otra clave desconocida bloquea. */
    obsolete: ReadonlyArray<string>;
}

type OwnedSchema = {
    $id?: string;
    'x-obsolete-root-keys'?: string[];
    properties: Record<string, { 'x-owner'?: string; 'x-owner-exceptions'?: Record<string, string> }>;
};

export function readOwnership(schema: OwnedSchema): RootOwnership {
    const owners: Record<string, Owner> = {};
    const exceptions: Array<{ path: string; owner: Owner }> = [];
    for (const [key, property] of Object.entries(schema.properties)) {
        const owner = property['x-owner'];
        if (!owner || !OWNERS.has(owner)) {
            throw new Error(`CONTRACT_OWNER_MISSING: ${schema.$id || 'schema'} no declara x-owner valido para '${key}'.`);
        }
        owners[key] = owner as Owner;
        for (const [child, childOwner] of Object.entries(property['x-owner-exceptions'] || {})) {
            if (!OWNERS.has(childOwner)) throw new Error(`CONTRACT_OWNER_MISSING: ${key}.${child}`);
            exceptions.push({ path: `${key}.${child}`, owner: childOwner as Owner });
        }
    }
    return { owners, exceptions, obsolete: [...(schema['x-obsolete-root-keys'] || [])] };
}

export const FUND_OWNERSHIP = readOwnership(fundSchema as unknown as OwnedSchema);
export const STOCK_OWNERSHIP = readOwnership(stockSchema as unknown as OwnedSchema);

export function ownership(isStock: boolean): RootOwnership {
    return isStock ? STOCK_OWNERSHIP : FUND_OWNERSHIP;
}

/** Bloques raiz que reescribe el republish. */
export function platformOwnedKeys(isStock: boolean): string[] {
    return Object.entries(ownership(isStock).owners).filter(([, owner]) => owner === 'plataforma').map(([key]) => key);
}

/** Claves que el contrato declara dentro de un bloque raiz (vacio si el bloque es passthrough). */
export function declaredBlockKeys(isStock: boolean, block: string): string[] {
    const schema = (isStock ? stockSchema : fundSchema) as unknown as { properties: Record<string, { properties?: Record<string, unknown> }> };
    return Object.keys(schema.properties[block]?.properties || {});
}

export function rootSchemaVersion(isStock: boolean): string {
    return isStock ? STOCK_ROOT_SCHEMA_VERSION : FUND_ROOT_SCHEMA_VERSION;
}

/** Valida una raiz contra el contrato vigente de su poblacion. */
export function validateCurrentRoot(doc: unknown, isStock: boolean) {
    return isStock ? validators.masterAssetStockV11(doc) : validators.masterAssetV13(doc);
}
