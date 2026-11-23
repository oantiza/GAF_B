/*
 * Las dos pruebas de las reglas de las retrocesiones contra los emuladores. Se lanza dentro de un emulador de Auth y
 * de Firestore con las reglas de producción, desde 3-BDB-ACTIVOS_app:
 *
 *   npx firebase-tools emulators:exec --config ../4-base-nueva/firebase.json --only auth,firestore \
 *     --project demo-bdb-audit "node scripts/testCommercialRetroEmulators.mjs"
 *
 * `--config` es lo que pone las reglas de `4-base-nueva/firestore.rules` (la app ya no tiene las suyas, 21-11-2026), y
 * `demo-` lo que impide que hable con un proyecto real. Esa configuración fija los puertos del emulador de la base nueva
 * (Firestore 8092, hub 4402): con ese emulador en marcha en el mismo equipo, este no arranca.
 */
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
