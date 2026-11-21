import { spawnSync } from "node:child_process";

for (const args of [
  ["scripts/smokeCommercialRetroRules.mjs"],
  ["node_modules/vitest/vitest.mjs", "run", "tests/commercialRetroEmulator.test.ts"]
]) {
  const result = spawnSync(process.execPath, args, {
    stdio: "inherit", cwd: new URL("../", import.meta.url), env: { ...process.env, BDB_TEST_EMULATORS: "1" }
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
