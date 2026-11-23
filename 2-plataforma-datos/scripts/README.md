# Scripts operativos

Los scripts bajo `scripts/` son dry-runs, previews, auditorias de solo lectura o runners parametrizados vigentes.

Los one-shot historicos con escrituras reales y gate antiguo `FIRESTORE_REAL_WRITE_ENABLED` se apartaron en
`_legacy/scripts/` el 17-10-2026 y **se borraron el 17-11-2026** (decision A-160, censo
`CENSO_CODIGO_HEREDADO_2026-11-16.md`), con el cerrojo `FirestoreRealWriteGate` del bloque 7B y su test. De `_legacy/`
solo quedan los documentos `BLOQUE_7B0`/`7B1A` (`_legacy/docs/`), que son registro. La puerta real de escritura de la
plataforma es `BDB_DATA_PLATFORM_ENABLE_MASTER_WRITES`. La suite no recoge `_legacy/**` (`vitest.config.ts`).

## Las reparaciones de la base vieja, borradas

Hasta el 21-11-2026 vivian aqui las reparaciones con escritura sobre la maestra vieja
(`restoreSriKidEvidence.ts`, `reconcileSearchIndexLive.ts`, `runCompactPriceSeries.ts`), la copia diaria
(`runBackupExport.ts`, `maintainLocalBackups.ts`, `backup_export_daily.bat`) y la pasada en seco de carteras que
leia la vieja (`runCarterasDryRun.ts`). Se borraron con la base vieja (decisiones 30 a 39, censo
`CENSO_BASE_VIEJA_2026-11-21.md`); quedan en la etiqueta de Git `referencia-base-vieja-2026-11-21`.

Se conserva `restoreBackupToEmulator.ts` (`npm run backup:restore-drill`, decision 33): siembra una copia de la
maestra de `data/backups/` en el emulador de la base de siempre (8082) y se niega a sembrar en el de la base nueva.
Es la unica via para abrir esas copias en un Firestore. Todo lo demas de esta carpeta es de la base nueva.
