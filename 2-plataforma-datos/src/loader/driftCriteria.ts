import { ownership } from './ownership';

const EPS = 1e-9;

// Mismo criterio de "drift" que audit/republish: lo que NO se compara
// porque lo poseen otras tuberias o son aditivos de plataforma.
export const IGNORE_TOP = new Set<string>([
    'listings',
    'metrics',
    'price_series',
    'schema_version',
    'updated_at',
    'source_metadata'
]);

export const IGNORE_PATH_PREFIXES = ['performance.valuation.'];

export interface DiffPathsOptions {
    /**
     * Cuenta tambien como deriva una clave del vivo que el esperado no tiene (con valor no nulo),
     * dentro de los subobjetos que ambos tienen. Sin esto, una clave obsoleta en un bloque del vivo
     * no se ve nunca (MEDIA-9).
     */
    staleKeys?: boolean;
    /** Rutas que no se comparan ni se recorren (de otro dueno). */
    skip?: (path: string) => boolean;
}

function isAbsent(value: unknown): boolean {
    return value === null || value === undefined;
}

/** Acumula las rutas (a.b.c) donde `expected` y `live` difieren. */
export function diffPaths(expected: any, live: any, base: string, out: string[], options: DiffPathsOptions = {}): void {
    if (options.skip?.(base)) return;
    if (expected === live) return;
    if (typeof expected === 'number' && typeof live === 'number') {
        if (Math.abs(expected - live) > EPS) out.push(base);
        return;
    }
    if (expected === null || live === null || typeof expected !== 'object' || typeof live !== 'object') {
        if (isAbsent(expected) && isAbsent(live)) return;
        out.push(base);
        return;
    }
    if (Array.isArray(expected) || Array.isArray(live)) {
        if (JSON.stringify(expected) !== JSON.stringify(live)) out.push(base);
        return;
    }
    const join = (key: string) => (base ? `${base}.${key}` : key);
    for (const k of Object.keys(expected)) diffPaths(expected[k], live[k], join(k), out, options);
    if (!options.staleKeys) return;
    for (const k of Object.keys(live)) {
        if (k in expected || isAbsent(live[k]) || options.skip?.(join(k))) continue;
        out.push(join(k));
    }
}

/**
 * Rutas owned que difieren: solo los bloques raiz que el contrato (`x-owner`) da a la plataforma,
 * sin las sub-rutas de otro dueno (`x-owner-exceptions`, p. ej. performance.valuation de la app).
 * Dentro de esos bloques, una clave del vivo que el esperado no trae tambien es deriva: el merge la
 * borraria. Las claves raiz que el esperado no trae no lo son: el merge las conserva.
 */
export function ownedDrift(expected: any, live: any, isStock: boolean = expected?.asset_type === 'STOCK'): string[] {
    const { owners, exceptions } = ownership(isStock);
    const foreign = exceptions.filter((exception) => exception.owner !== 'plataforma').map((exception) => exception.path);
    const skip = (path: string) => IGNORE_PATH_PREFIXES.some((pre) => path.startsWith(pre))
        || foreign.some((foreignPath) => path === foreignPath || path.startsWith(`${foreignPath}.`));
    const out: string[] = [];
    for (const key of Object.keys(expected)) {
        if (IGNORE_TOP.has(key)) continue;
        // De la app, legado o metadatos: el republish no lo escribe, asi que no es deriva suya.
        if (key in owners && owners[key] !== 'plataforma') continue;
        diffPaths(expected[key], live?.[key], key, out, { staleKeys: true, skip });
    }
    return out;
}
