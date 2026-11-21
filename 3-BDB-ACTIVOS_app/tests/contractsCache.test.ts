import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

const scriptSource = fileURLToPath(new URL("../scripts/syncContractsCache.mjs", import.meta.url));
const schema = '{\n  "type": "object"\n}\n';
let root: string;
let contracts: string;
let cache: string;
let script: string;

function run(check = false, source = contracts) {
  return spawnSync(process.execPath, [script, ...(check ? ["--check"] : [])], {
    env: { ...process.env, BDB_CONTRACTS_ROOT: source },
    encoding: "utf8",
    timeout: 10000,
  });
}

function setLineEndings(path: string, ending: "\n" | "\r\n") {
  const content = readFileSync(path, "utf8").replace(/\r\n/g, "\n");
  writeFileSync(path, content.replace(/\n/g, ending));
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "bdb-contract-cache-"));
  contracts = join(root, "contracts");
  cache = join(root, "functions_python", "contracts_cache");
  script = join(root, "scripts", "syncContractsCache.mjs");
  mkdirSync(dirname(script), { recursive: true });
  copyFileSync(scriptSource, script);
  for (const group of ["master", "read"]) {
    mkdirSync(join(contracts, group), { recursive: true });
    writeFileSync(join(contracts, group, `${group}.schema.json`), schema.replace(/\n/g, "\r\n"));
  }
});

afterEach(() => {
  if (dirname(root) !== tmpdir()) throw new Error("Unexpected temporary directory");
  rmSync(root, { recursive: true, force: true });
});

describe("portable contract cache verification", () => {
  test("sync and source parity tolerate checkout line endings with identical manifests", () => {
    expect(run().status).toBe(0);
    const manifest = readFileSync(join(cache, "manifest.json"), "utf8");
    expect(readFileSync(join(cache, "master.schema.json"), "utf8")).toBe(schema);
    expect(run(true).status).toBe(0);
    for (const group of ["master", "read"]) {
      setLineEndings(join(contracts, group, `${group}.schema.json`), "\n");
      setLineEndings(join(cache, `${group}.schema.json`), "\r\n");
    }
    expect(run(true).status).toBe(0);
    expect(run().status).toBe(0);
    expect(readFileSync(join(cache, "manifest.json"), "utf8")).toBe(manifest);
  });

  test("manifest-only CI check accepts both LF and CRLF but rejects changed content", () => {
    expect(run().status).toBe(0);
    const missingSource = join(root, "absent-source");
    expect(run(true, missingSource).status).toBe(0);
    const cachedSchema = join(cache, "master.schema.json");
    setLineEndings(cachedSchema, "\r\n");
    expect(run(true, missingSource).status).toBe(0);
    writeFileSync(cachedSchema, schema.replace("object", "string"));
    const result = run(true, missingSource);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Hash de contrato no coincide: master.schema.json");
  });

  test("source parity rejects a changed contract even with a valid local manifest", () => {
    expect(run().status).toBe(0);
    writeFileSync(join(contracts, "master", "master.schema.json"), schema.replace("object", "string"));
    const result = run(true);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Cache de contrato desactualizada: master.schema.json");
  });
});
