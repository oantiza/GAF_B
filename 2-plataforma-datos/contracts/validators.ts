/**
 * contracts/validators.ts — validadores ajv compilados desde los esquemas JSON de contracts/.
 *
 * Fuente unica de verdad: los *.schema.json de este directorio. Este modulo SOLO los compila;
 * no duplica reglas. El cargador valida contra `master/*` antes de escribir; los consumidores
 * validan lo que leen.
 *
 * Requisitos (Codex, una vez):  npm i ajv ajv-formats
 * tsconfig: "resolveJsonModule": true, "esModuleInterop": true.
 *
 * Uso:
 *   import { validators, assertValid } from '../contracts/validators';
 *   const r = validators.masterAsset(doc);
 *   if (!r.ok) console.error(r.errors);
 *   // o, para abortar la escritura:
 *   assertValid('masterAsset', doc);
 */
import Ajv2020, { ErrorObject } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';

import canonicalFund from './canonical/fondosdb-fund.v1.schema.json';
import canonicalStock from './canonical/fondosdb-stock.v1.schema.json';
import canonicalHoldings from './canonical/fondosdb-holdings.v1.schema.json';
import masterAsset from './master/asset.v1.schema.json';
import masterAssetV11 from './master/asset.v1.1.schema.json';
import masterAssetV12 from './master/asset.v1.2.schema.json';
import masterAssetV13 from './master/asset.v1.3.schema.json';
import masterAssetStock from './master/asset-stock.v1.schema.json';
import masterAssetStockV11 from './master/asset-stock.v1.1.schema.json';
import masterAssetMarket from './master/asset-market.v1.schema.json';
import masterHoldings from './master/holdings.v1.schema.json';
import masterHoldingsV11 from './master/holdings.v1.1.schema.json';
import masterHoldingsV12 from './master/holdings.v1.2.schema.json';
import masterPriceSeries from './master/price-series.v1.schema.json';
import masterPriceSeriesV11 from './master/price-series.v1.1.schema.json';
import masterPriceSeriesV12 from './master/price-series.v1.2.schema.json';
import masterMetrics from './master/metrics.v1.schema.json';
import masterMetricsV11 from './master/metrics.v1.1.schema.json';
import masterMetricsV12 from './master/metrics.v1.2.schema.json';
import masterMetricsV13 from './master/metrics.v1.3.schema.json';
import masterListing from './master/listing.v1.schema.json';
import masterSearchIndex from './master/search-index.v1.schema.json';

const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);

export interface ValidationResult {
  ok: boolean;
  errors: ErrorObject[];
}

function build(schema: object): (data: unknown) => ValidationResult {
  const validate = ajv.compile(schema);
  return (data: unknown): ValidationResult => {
    const ok = validate(data) as boolean;
    return { ok, errors: ok ? [] : (validate.errors ?? []) };
  };
}

export const validators = {
  canonicalFund: build(canonicalFund),
  canonicalStock: build(canonicalStock),
  canonicalHoldings: build(canonicalHoldings),
  masterAsset: build(masterAsset),
  masterAssetV11: build(masterAssetV11),
  masterAssetV12: build(masterAssetV12),
  masterAssetV13: build(masterAssetV13),
  masterAssetStock: build(masterAssetStock),
  masterAssetStockV11: build(masterAssetStockV11),
  masterAssetMarket: build(masterAssetMarket),
  masterHoldings: build(masterHoldings),
  masterHoldingsV11: build(masterHoldingsV11),
  masterHoldingsV12: build(masterHoldingsV12),
  masterPriceSeries: build(masterPriceSeries),
  masterPriceSeriesV11: build(masterPriceSeriesV11),
  masterPriceSeriesV12: build(masterPriceSeriesV12),
  masterMetrics: build(masterMetrics),
  masterMetricsV11: build(masterMetricsV11),
  masterMetricsV12: build(masterMetricsV12),
  masterMetricsV13: build(masterMetricsV13),
  masterListing: build(masterListing),
  masterSearchIndex: build(masterSearchIndex),
} as const;

export type ContractName = keyof typeof validators;

/** Lanza si `data` no valida contra el contrato `name`. Usar en el writer antes de escribir. */
export function assertValid(name: ContractName, data: unknown): void {
  const r = validators[name](data);
  if (!r.ok) {
    const msg = r.errors
      .map((e) => `${e.instancePath || '/'} ${e.message ?? ''}`.trim())
      .join('; ');
    throw new Error(`[contract ${name}] validacion fallida: ${msg}`);
  }
}
