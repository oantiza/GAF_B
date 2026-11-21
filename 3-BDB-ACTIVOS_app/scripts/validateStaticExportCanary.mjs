import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  runStaticExportSampleIntake,
  validateStaticExportGeneratedModule
} from "./buildStaticExportSample.mjs";

const DEFAULT_CANARY_INPUT_PATH = "intake/static-export-sample/bdb-assets-for-bdb.preview.json";
const DEFAULT_GENERATED_PATH = "src/data/bbddActivosStaticExportSample.generated.ts";
const EXPECTED_ENVELOPE_ASSETS = [
  { asset_id: "IE00B1XNHC34", instrument_type: "ETF" },
  { asset_id: "LU0996182563", instrument_type: "FUND" },
  { asset_id: "US0378331005", instrument_type: "STOCK" }
];
const ALLOWED_POLICIES = [
  "BBDD_ACTIVOS_OFFICIAL_METRICS_CANARY_V1",
  "BBDD_ACTIVOS_OFFICIAL_METRICS_CONTROLLED_SAMPLE_V1"
];
const blockedGeneratedFragments = [
  '"holdings"',
  '"holdings_summary"',
  '"history"',
  '"points"',
  '"positions"',
  '"suitability_inputs"',
  '"recommendation_input"',
  '"recommendation_inputs"',
  '"optimization_input"',
  '"optimization_allowed":true',
  '"optimization_allowed": true',
  '"suitability_allowed":true',
  '"suitability_allowed": true',
  '"recommendation_allowed":true',
  '"recommendation_allowed": true',
  "Firestore",
  "Firebase",
  "credential",
  "private_key",
  "apiKey",
  "setDoc",
  "deleteDoc",
  "writeBatch"
];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function validateCanaryGeneratedModule(moduleText) {
  const validation = validateStaticExportGeneratedModule(moduleText);
  const canaryAssets = validation.sample.filter((asset) => asset.official_metrics_envelope);
  const expectedAssetIds = EXPECTED_ENVELOPE_ASSETS.map((asset) => asset.asset_id).sort();
  const actualAssetIds = canaryAssets.map((asset) => asset.asset_id).sort();
  const actualInstrumentTypes = canaryAssets.map((asset) => asset.instrument_type).sort();
  const expectedInstrumentTypes = EXPECTED_ENVELOPE_ASSETS.map((asset) => asset.instrument_type).sort();

  assert(validation.source.schema_version === "asset-for-bdb.v1", "Canary intake must keep schema_version asset-for-bdb.v1.");
  assert(validation.sample.length === 16, `Canary intake must contain 16 assets, got ${validation.sample.length}.`);
  assert(canaryAssets.length === 3, `Canary intake must contain exactly 3 official_metrics_envelope entries, got ${canaryAssets.length}.`);
  assert(JSON.stringify(actualAssetIds) === JSON.stringify(expectedAssetIds), `Canary envelopes must belong to ${expectedAssetIds.join(", ")}.`);
  assert(
    JSON.stringify(actualInstrumentTypes) === JSON.stringify(expectedInstrumentTypes),
    `Canary envelopes must cover ${expectedInstrumentTypes.join(", ")}.`
  );
  assert(
    validation.sample.filter((asset) => asset.instrument_type === "INDEX").every((asset) => !asset.official_metrics_envelope),
    "INDEX assets must not carry official_metrics_envelope."
  );

  for (const asset of canaryAssets) {
    const expectedAsset = EXPECTED_ENVELOPE_ASSETS.find((candidate) => candidate.asset_id === asset.asset_id);
    const envelope = asset.official_metrics_envelope;

    assert(asset.instrument_type === expectedAsset?.instrument_type, `${asset.asset_id} must keep expected instrument type.`);
    assert(envelope.mode === "OFFICIAL_READ_MODEL", "Canary envelope mode must be OFFICIAL_READ_MODEL.");
    assert(envelope.source === "BBDD_ACTIVOS", "Canary envelope source must be BBDD_ACTIVOS.");
    assert(ALLOWED_POLICIES.includes(envelope.calculation_policy), "Canary envelope calculation_policy is not allowed.");
    assert(envelope.suitability_allowed === false, "Canary envelope must keep suitability_allowed false.");
    assert(envelope.optimization_allowed === false, "Canary envelope must keep optimization_allowed false.");
    assert(envelope.recommendation_allowed === false, "Canary envelope must keep recommendation_allowed false.");
  }

  for (const blocked of blockedGeneratedFragments) {
    assert(!moduleText.includes(blocked), `Canary generated sample contains blocked fragment: ${blocked}.`);
  }

  return validation;
}

export function runStaticExportCanaryValidation(options = {}) {
  const cwd = options.cwd ?? process.cwd();
  const inputPath = options.inputPath ?? DEFAULT_CANARY_INPUT_PATH;
  const outputPath = options.outputPath ?? DEFAULT_GENERATED_PATH;
  const generatedPath = path.resolve(cwd, outputPath);
  let dryRun;
  let writeRun;

  try {
    dryRun = runStaticExportSampleIntake({ cwd, inputPath, outputPath });
    writeRun = runStaticExportSampleIntake({ cwd, inputPath, outputPath, write: true });
    const generatedText = fs.readFileSync(generatedPath, "utf8");
    const validation = validateCanaryGeneratedModule(generatedText);

    return {
      mode: "CANARY_VALIDATION",
      input_path: dryRun.input_path,
      output_path: dryRun.output_path,
      dry_run_wrote: dryRun.wrote,
      write_wrote: writeRun.wrote,
      schema_version: validation.source.schema_version,
      asset_count: validation.sample.length,
      envelope_count: EXPECTED_ENVELOPE_ASSETS.length,
      canary_asset_ids: EXPECTED_ENVELOPE_ASSETS.map((asset) => asset.asset_id),
      generated_removed: true
    };
  } finally {
    fs.rmSync(generatedPath, { force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(JSON.stringify(runStaticExportCanaryValidation(), null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
