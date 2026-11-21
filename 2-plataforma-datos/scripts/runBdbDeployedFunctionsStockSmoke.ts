/**
 * Sonda de solo lectura a cuatro Functions desplegadas, con el token de una sesion. Hasta el
 * 05-11-2026 llevaba fijo el proyecto de BDB; desde la decision 106 mira el de este proyecto, que
 * despliega las cuatro (`3-BDB-ACTIVOS_app/scripts/desplegarFunciones.mjs`).
 */
import { PROYECTO_BASE_NUEVA } from '../src/config/projectAllowlist';

const REGION = 'europe-west1';
const PROJECT = PROYECTO_BASE_NUEVA;
const BASE_URL = `https://${REGION}-${PROJECT}.cloudfunctions.net`;
const PILOTS = [
    { asset_id: 'DE0007164600', query: 'SAP', listing_id: 'EODHD:SAP.XETRA' },
    { asset_id: 'ES0113900J37', query: 'Santander', listing_id: 'EODHD:SAN.MC' },
    { asset_id: 'NL0011585146', query: 'Ferrari', listing_id: 'EODHD:RACE.US' },
];

function idToken(): string | null {
    return process.env.BDB_FIREBASE_AUTH_ID_TOKEN
        || process.env.FIREBASE_AUTH_ID_TOKEN
        || process.env.FIREBASE_ID_TOKEN
        || process.env.BDB_TEST_ID_TOKEN
        || null;
}

async function callable(name: string, data: any, token: string | null) {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (token) headers.authorization = `Bearer ${token}`;
    const response = await fetch(`${BASE_URL}/${name}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ data }),
    });
    const body = await response.json().catch(async () => ({ raw: await response.text() }));
    return { status: response.status, body };
}

function unwrap(response: any) {
    return response.body?.result ?? response.body?.data ?? response.body;
}

function collectPublicFieldLeaks(value: any, prefix = ''): string[] {
    if (value === null || typeof value !== 'object') return [];
    const leaks: string[] = [];
    for (const key of Object.keys(value)) {
        const field = prefix ? `${prefix}.${key}` : key;
        const lower = field.toLowerCase();
        if (/(private_key|credential|secret|api_key|token|firebase_admin|service_account)/.test(lower)) leaks.push(field);
        leaks.push(...collectPublicFieldLeaks(value[key], field));
    }
    return leaks;
}

function findAsset(payload: any, assetId: string): any {
    const arrays = [payload?.results, payload?.assets, payload?.items, Array.isArray(payload) ? payload : []].filter(Array.isArray);
    for (const arr of arrays) {
        const found = arr.find((item: any) => item?.asset_id === assetId || item?.identifiers?.isin === assetId || item?.isin === assetId);
        if (found) return found;
    }
    return null;
}

function metricsOf(payload: any): any {
    return payload?.metrics || payload?.risk_performance || payload?.summary?.metrics || {};
}

function listingsOf(payload: any): any[] {
    return Array.isArray(payload?.listings) ? payload.listings : Array.isArray(payload?.root?.listings) ? payload.root.listings : [];
}

function has3yMetrics(payload: any) {
    const metrics = metricsOf(payload);
    return typeof metrics.annualized_return_3y === 'number' && typeof metrics.volatility_3y === 'number';
}

async function main() {
    const token = idToken();
    const output: any = {
        status: 'NOT_READY',
        token_present: Boolean(token),
        functions: ['search_assets', 'get_asset_detail', 'compare_assets', 'resolve_portfolio'],
        pilots: [],
        compare_assets: null,
        resolve_portfolio: null,
        firestore_writes: 0,
        firestore_deletes: 0,
        external_market_apis_called: 0,
        credentials_printed: false,
    };

    for (const pilot of PILOTS) {
        const search = await callable('search_assets', { query: pilot.query, limit: 10 }, token);
        const detail = await callable('get_asset_detail', { asset_id: pilot.asset_id }, token);
        const searchPayload = unwrap(search);
        const detailPayload = unwrap(detail);
        const searchAsset = findAsset(searchPayload, pilot.asset_id);
        const detailAsset = detailPayload?.asset || detailPayload;
        output.pilots.push({
            asset_id: pilot.asset_id,
            search_status: search.status,
            detail_status: detail.status,
            auth_error: search.body?.error?.status === 'UNAUTHENTICATED' || detail.body?.error?.status === 'UNAUTHENTICATED',
            appears_in_search: Boolean(searchAsset),
            search_asset_type: searchAsset?.asset_type ?? null,
            detail_asset_type: detailAsset?.asset_type ?? null,
            detail_same_isin: detailAsset?.asset_id === pilot.asset_id || detailAsset?.identifiers?.isin === pilot.asset_id,
            economic_asset_class_present: Boolean(searchAsset?.economic_asset_class || detailAsset?.economic_asset_class || detailAsset?.classification?.asset_class),
            metrics_3y_present: has3yMetrics(detailAsset),
            listings_keep_canonical_id: listingsOf(detailAsset).some((listing: any) => listing?.listing_id === pilot.listing_id),
            public_field_leaks: collectPublicFieldLeaks(detailAsset),
        });
    }

    const compare = await callable('compare_assets', { asset_ids: PILOTS.map(p => p.asset_id) }, token);
    const resolve = await callable('resolve_portfolio', {
        positions: PILOTS.map((p, index) => ({ asset_id: p.asset_id, weight: index === 0 ? 0.34 : 0.33 })),
    }, token);
    output.compare_assets = {
        status: compare.status,
        auth_error: compare.body?.error?.status === 'UNAUTHENTICATED',
        count: Array.isArray(unwrap(compare)) ? unwrap(compare).length : Array.isArray(unwrap(compare)?.assets) ? unwrap(compare).assets.length : null,
        public_field_leaks: collectPublicFieldLeaks(unwrap(compare)),
    };
    output.resolve_portfolio = {
        status: resolve.status,
        auth_error: resolve.body?.error?.status === 'UNAUTHENTICATED',
        returned: !resolve.body?.error,
        public_field_leaks: collectPublicFieldLeaks(unwrap(resolve)),
    };

    const allPilotOk = output.pilots.every((pilot: any) =>
        pilot.appears_in_search &&
        pilot.search_asset_type === 'STOCK' &&
        pilot.detail_asset_type === 'STOCK' &&
        pilot.detail_same_isin &&
        pilot.economic_asset_class_present &&
        pilot.metrics_3y_present &&
        pilot.listings_keep_canonical_id &&
        pilot.public_field_leaks.length === 0
    );
    const compareOk = output.compare_assets.status === 200 && output.compare_assets.count === 3 && output.compare_assets.public_field_leaks.length === 0;
    const resolveOk = [200, 204].includes(output.resolve_portfolio.status) && output.resolve_portfolio.public_field_leaks.length === 0;
    output.status = allPilotOk && compareOk && resolveOk ? 'PASS' : 'NOT_READY';

    console.log(JSON.stringify(output, null, 2));
    if (output.status !== 'PASS') process.exit(1);
}

main().catch(error => {
    console.error(JSON.stringify({ status: 'NOT_READY', error: error instanceof Error ? error.message : 'UNKNOWN_ERROR' }, null, 2));
    process.exit(1);
});
