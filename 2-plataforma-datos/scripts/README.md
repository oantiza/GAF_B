# Scripts operativos

Los scripts bajo `scripts/` son dry-runs, previews, auditorias de solo lectura o runners parametrizados vigentes.

Los one-shot historicos con escrituras reales y gate antiguo `FIRESTORE_REAL_WRITE_ENABLED` se apartaron en
`_legacy/scripts/` el 17-10-2026 y **se borraron el 17-11-2026** (decision A-160, censo
`CENSO_CODIGO_HEREDADO_2026-11-16.md`), con el cerrojo `FirestoreRealWriteGate` del bloque 7B y su test. De `_legacy/`
solo quedan los documentos `BLOQUE_7B0`/`7B1A` (`_legacy/docs/`), que son registro. La puerta real de escritura de la
plataforma es `BDB_DATA_PLATFORM_ENABLE_MASTER_WRITES`. La suite no recoge `_legacy/**` (`vitest.config.ts`).

## Reparaciones con escritura, vigentes

Un script de aqui puede escribir si pasa por `BDB_DATA_PLATFORM_ENABLE_MASTER_WRITES`, por la
allowlist de `src/config/projectAllowlist.ts` y por un postverify real, y si es **repetible**: no
un one-shot que se agote con su propia ejecucion.

- `restoreSriKidEvidence.ts` (`npm run repair:sri-evidence`): devuelve `risk.sri_kid_evidence` a un
  activo que publica un SRI sin la evidencia del KID que lo sostiene, tomandola de la copia mas
  nueva que todavia la tenga. Solo escribe si la evidencia dice el mismo SRI que esta publicado, no
  sobrescribe una evidencia presente y deja rastro en `_sri_evidence_repair_audit`. En seco por
  defecto; con `--write` detras del gate. Nacio el 31-10-2026 porque `--accept-canonical` del
  republish silencia tambien la conservacion de datos de la app y retiro dos evidencias.
