import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const contractsRoot = process.env.BDB_CONTRACTS_ROOT
  ? resolve(process.env.BDB_CONTRACTS_ROOT)
  : resolve(repoRoot, "..", "2-plataforma-datos", "contracts");
const targetDir = resolve(repoRoot, "functions_python", "contracts_cache");
const manifestPath = join(targetDir, "manifest.json");
const checkOnly = process.argv.includes("--check");
/** Las carpetas de `contracts/` que se copian a la caché de las Functions. */
const GRUPOS = ["read"];

// Git can convert CRLF to LF during checkout; hashes must be portable.
function normalizedContract(content) {
  return content.toString("utf8").replace(/\r\n/g, "\n");
}

function sha256(buffer) {
  return createHash("sha256").update(normalizedContract(buffer)).digest("hex");
}

function schemaNames(directory) {
  return readdirSync(directory).filter((name) => name.endsWith(".schema.json")).sort();
}

function validateCachedManifest() {
  if (!existsSync(manifestPath)) {
    throw new Error(`Falta el manifiesto del cache: ${manifestPath}`);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest.schema_version !== "bdb-contract-cache.v1" || !manifest.files) {
    throw new Error("Manifest de contratos no valido.");
  }
  const cachedNames = schemaNames(targetDir);
  const declaredNames = Object.keys(manifest.files).sort();
  if (JSON.stringify(cachedNames) !== JSON.stringify(declaredNames)) {
    throw new Error("El contenido del cache no coincide con su manifiesto.");
  }
  for (const name of cachedNames) {
    const content = readFileSync(join(targetDir, name));
    JSON.parse(content.toString("utf8"));
    if (sha256(content) !== manifest.files[name]) {
      throw new Error(`Hash de contrato no coincide: ${name}`);
    }
  }
  return cachedNames.length;
}

function syncSchemasFrom(sourceDir, expectedNames, hashes) {
  if (!existsSync(sourceDir)) {
    throw new Error(`No existe el directorio de contratos: ${sourceDir}`);
  }
  const schemas = schemaNames(sourceDir);
  if (schemas.length === 0) {
    throw new Error(`No hay schemas .schema.json en ${sourceDir}`);
  }
  for (const schemaName of schemas) {
    if (expectedNames.has(schemaName)) throw new Error(`Schema duplicado en SSOT: ${schemaName}`);
    expectedNames.add(schemaName);
    const source = join(sourceDir, schemaName);
    const target = join(targetDir, schemaName);
    const content = readFileSync(source);
    hashes[schemaName] = sha256(content);
    if (checkOnly) {
      if (!existsSync(target) || normalizedContract(content) !== normalizedContract(readFileSync(target))) {
        throw new Error(`Cache de contrato desactualizada: ${schemaName}`);
      }
    } else {
      writeFileSync(target, normalizedContract(content), "utf8");
    }
  }
  return schemas.length;
}

function main() {
  if (!existsSync(contractsRoot)) {
    if (!checkOnly) throw new Error(`No existe el directorio SSOT de contratos: ${contractsRoot}`);
    const verified = validateCachedManifest();
    console.log(`Contratos verificados por manifiesto: ${verified} schemas en ${targetDir}`);
    return;
  }

  if (!checkOnly) mkdirSync(targetDir, { recursive: true });
  const expectedNames = new Set();
  const hashes = {};
  // Solo `read` (asset-for-bdb.v1, la forma que el servidor da a la app). Hasta el 21-11-2026 se copiaba también
  // `master`, los contratos de la maestra vieja contra los que validaban sus escritores; se borraron con ella
  // (decisión 36, CENSO_BASE_VIEJA_2026-11-21.md).
  const count = GRUPOS.reduce((total, grupo) => total + syncSchemasFrom(join(contractsRoot, grupo), expectedNames, hashes), 0);

  const extras = schemaNames(targetDir).filter((name) => !expectedNames.has(name));
  if (extras.length) throw new Error(`Cache contiene schemas ajenos al SSOT: ${extras.join(", ")}`);

  const manifest = {
    schema_version: "bdb-contract-cache.v1",
    source: "2-plataforma-datos/contracts",
    files: Object.fromEntries(Object.entries(hashes).sort(([left], [right]) => left.localeCompare(right))),
  };
  if (checkOnly) {
    const cachedManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    if (JSON.stringify(cachedManifest) !== JSON.stringify(manifest)) {
      throw new Error("El manifiesto del cache no coincide con el SSOT.");
    }
    validateCachedManifest();
    console.log(`Contratos comparados con SSOT: ${count} schemas en ${targetDir}`);
  } else {
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    console.log(`Contratos sincronizados: ${count} schemas -> ${targetDir}`);
  }
}

main();
