import { normalizeIsoUtcDateTime } from '../utils/utcDates';

/** metrics.v1.2: `method` y `frequency` declaran con que se calculo la ventana.
 *  Sin ellos, dos cifras de la misma columna pueden no ser comparables y nadie
 *  aguas abajo tiene forma de saberlo (auditoria 03-09, hallazgo 02). */
export type MetricMethod = 'GEOMETRIC_CAGR' | 'TRAILING_PROVIDER';
export type MetricFrequency = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'PROVIDER';

type MetricWindow = {
    annualized_return?: number;
    annualized_volatility?: number;
    sharpe_ratio?: number;
    risk_free_rate?: number;
    method?: MetricMethod;
    frequency?: MetricFrequency;
};

export type MetricsLatestV11 = {
    asset_id: string;
    population: 'fund' | 'stock';
    source: string;
    updated_at: string;
    windows: Record<string, MetricWindow>;
    ytd_return?: number;
    max_drawdown_hist?: { value: number; date?: string };
    max_drawdown_5y?: number;
    srri?: number;
    risk_score_source: 'SRRI' | 'SRI_KID' | 'VOL_BUCKET';
    observations_count?: number;
    first_date?: string;
    last_date?: string;
};

function get(obj: any, pathExpr: string): any {
    return pathExpr.split('.').reduce((cur, key) => cur && cur[key], obj);
}

function finite(value: any): number | undefined {
    return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function integerInRange(value: any, min: number, max: number): number | undefined {
    const n = finite(value);
    if (n === undefined || !Number.isInteger(n) || n < min || n > max) return undefined;
    return n;
}

function round(value: number): number {
    return Math.round(value * 1e8) / 1e8;
}

function pctToDecimal(value: any): number | undefined {
    const n = finite(value);
    return n === undefined ? undefined : round(n / 100);
}

function negativePctToDecimal(value: any): number | undefined {
    const n = pctToDecimal(value);
    if (n === undefined) return undefined;
    return n > 0 ? -n : n;
}

function assignIfNumber(target: Record<string, any>, key: string, value: number | undefined): void {
    if (value !== undefined) target[key] = value;
}

const METHODS: MetricMethod[] = ['GEOMETRIC_CAGR', 'TRAILING_PROVIDER'];
const FREQUENCIES: MetricFrequency[] = ['DAILY', 'WEEKLY', 'MONTHLY', 'PROVIDER'];

function cleanWindow(window: MetricWindow): MetricWindow | undefined {
    const out: MetricWindow = {};
    assignIfNumber(out, 'annualized_return', window.annualized_return);
    assignIfNumber(out, 'annualized_volatility', window.annualized_volatility);
    assignIfNumber(out, 'sharpe_ratio', window.sharpe_ratio);
    assignIfNumber(out, 'risk_free_rate', window.risk_free_rate);
    // Solo se declara lo que se sabe: una etiqueta inventada seria peor que
    // ninguna, porque el consumidor la creeria.
    if (Object.keys(out).length === 0) return undefined;
    if (window.method && METHODS.includes(window.method)) out.method = window.method;
    if (window.frequency && FREQUENCIES.includes(window.frequency)) out.frequency = window.frequency;
    return out;
}

function addWindow(metrics: MetricsLatestV11, key: string, window: MetricWindow): void {
    const clean = cleanWindow(window);
    if (clean) metrics.windows[key] = clean;
}

function fundWindow(root: any, period: '1a' | '3a' | '5a', returnKey: string): MetricWindow {
    return {
        // Cifras trailing de Morningstar tal cual: ni las calculamos nosotros ni
        // sabemos sobre que frecuencia las midio el proveedor.
        method: 'TRAILING_PROVIDER',
        frequency: 'PROVIDER',
        annualized_return: pctToDecimal(get(root, `performance.returns.trailing_pct.${returnKey}.fondo`)),
        annualized_volatility: pctToDecimal(get(root, `risk.volatilidad_pct.${period}.fondo`)),
        sharpe_ratio: finite(get(root, `risk.sharpe.${period}.fondo`)),
        risk_free_rate: pctToDecimal(get(root, `risk.rf_pct.${period}.fondo`))
    };
}

export function buildFundMetricsLatest(root: any, nowIso?: string): MetricsLatestV11 {
    const metrics: MetricsLatestV11 = {
        asset_id: String(root.asset_id),
        population: 'fund',
        source: 'FONDOSDB_ROOT_ES',
        updated_at: normalizeIsoUtcDateTime(root.source_metadata?.generated_at)
            || normalizeIsoUtcDateTime(root.source_metadata?.report_date)
            || normalizeIsoUtcDateTime(nowIso)
            || normalizeIsoUtcDateTime(root.updated_at)
            || new Date().toISOString(),
        windows: {},
        risk_score_source: 'SRRI'
    };

    addWindow(metrics, '1y', fundWindow(root, '1a', '1a'));
    addWindow(metrics, '3y', fundWindow(root, '3a', '3a_anualizada'));
    addWindow(metrics, '5y', fundWindow(root, '5a', '5a_anualizada'));
    addWindow(metrics, '10y', {
        annualized_return: pctToDecimal(get(root, 'performance.returns.trailing_pct.10a_anualizada.fondo')),
        method: 'TRAILING_PROVIDER',
        frequency: 'PROVIDER'
    });

    assignIfNumber(metrics, 'ytd_return', pctToDecimal(get(root, 'performance.returns.trailing_pct.ytd.fondo')));

    const mdd = root.risk?.max_drawdown;
    if (mdd && typeof mdd === 'object' && mdd.periodo === '5a') {
        assignIfNumber(metrics, 'max_drawdown_5y', negativePctToDecimal(mdd.pct));
    }
    const hist = root.risk?.max_drawdown_hist;
    if (hist && typeof hist === 'object') {
        const value = negativePctToDecimal(hist.pct);
        if (value !== undefined) {
            metrics.max_drawdown_hist = { value };
            if (hist.fecha) metrics.max_drawdown_hist.date = String(hist.fecha);
        }
    }

    // metrics.v1.3: el SRRI UCITS y el SRI PRIIPs del KID son escalas distintas; se etiqueta cual es.
    const ucitsSrri = integerInRange(root.risk?.srri_1a7, 1, 7);
    const kidSri = integerInRange(root.risk?.sri_kid_1a7, 1, 7);
    if (ucitsSrri !== undefined) metrics.srri = ucitsSrri;
    else if (kidSri !== undefined) {
        metrics.srri = kidSri;
        metrics.risk_score_source = 'SRI_KID';
    }

    return metrics;
}

export function buildStockMetricsLatest(stockMetrics: any, assetId: string, nowIso?: string): MetricsLatestV11 {
    const metrics: MetricsLatestV11 = {
        asset_id: assetId,
        population: 'stock',
        source: stockMetrics.source || 'FONDOSDB_EODHD_DAILY_HISTORY',
        updated_at: normalizeIsoUtcDateTime(stockMetrics.updated_at)
            || normalizeIsoUtcDateTime(nowIso)
            || new Date().toISOString(),
        windows: {},
        risk_score_source: 'VOL_BUCKET'
    };

    for (const key of ['1y', '3y', '5y', '10y']) {
        if (stockMetrics.windows?.[key]) addWindow(metrics, key, stockMetrics.windows[key]);
    }

    const histValue = finite(stockMetrics.max_drawdown_hist?.value ?? stockMetrics.max_drawdown);
    if (histValue !== undefined) {
        metrics.max_drawdown_hist = { value: histValue > 0 ? -histValue : histValue };
        if (stockMetrics.max_drawdown_hist?.date) metrics.max_drawdown_hist.date = String(stockMetrics.max_drawdown_hist.date);
    }
    assignIfNumber(metrics, 'observations_count', finite(stockMetrics.observations_count));
    if (stockMetrics.first_date) metrics.first_date = String(stockMetrics.first_date);
    if (stockMetrics.last_date) metrics.last_date = String(stockMetrics.last_date);

    return metrics;
}
