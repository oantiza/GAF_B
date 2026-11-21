# Bloque 5B: OpenFIGI Deduplication & Enrichment Dry Run

## Objetivo
El objetivo principal de este bloque es integrar un pipeline capaz de enrutar los activos ingestados previamente (ya sea de EODHD o manuales) hacia la base de datos de OpenFIGI para **validar su identidad, obtener su identificador global FIGI y deduplicar registros** que representen el mismo activo financiero en distintos mercados. Este proceso asegura la integridad de los datos **antes** de enviar nada al Firestore Write Gate.

## Archivos Creados / Modificados
- **Tipos**: `src/providers/openfigi/openfigiTypes.ts`
- **Lógica**: `src/providers/openfigi/openfigiMapper.ts`, `src/providers/openfigi/openfigiDedup.ts`, `src/providers/openfigi/openfigiDryRun.ts`
- **Script Terminal**: `scripts/runOpenFigiDryRun.ts`
- **Configuración**: `package.json` (`dryrun:openfigi`)
- **Tests**: `tests/openfigiMapper.test.ts`, `tests/openfigiDedup.test.ts`, `tests/openfigiDryRun.test.ts`
- **Fixtures**: `tests/fixtures/openfigi_sample_response.json`

## Reglas de Mapping OpenFIGI
1. **ISIN Prioritario**: Si existe, se busca por `idType: 'ID_ISIN'`.
2. **Ticker + Exchange**: Si no hay ISIN, se utiliza `idType: 'TICKER'` junto a `exchCode`.
3. **Restricción ExchCode vs MicCode**: Nunca se envían simultáneamente. Si aparecen juntos, el mapper utiliza `exchCode` y registra un aviso de conflicto explícito `OPENFIGI_EXCH_MIC_CONFLICT` marcando el activo para `REVIEW`.
4. **Ticker sin Exchange**: Queda marcado con issue `INSUFFICIENT_IDENTIFIER_FOR_OPENFIGI` y clasificado en `REVIEW`.

## Reglas de Deduplicación
- **Match Único**: 1 listing devuelve exactamente 1 FIGI. Se clasifica como OK.
- **Sin Match**: Se clasifica en `review_candidates.json` con status `REVIEW` (issue `OPENFIGI_NO_MATCH`).
- **Múltiples Matches (Decisión Explícita)**: Se arrojan a `ambiguous_matches.json`. El sistema **NO los resuelve automáticamente**. Quedan en `REVIEW` con issue `OPENFIGI_AMBIGUOUS_MATCH`.
- **Deduplicación de Listings**: Varios listings que devuelven el mismo FIGI se reportan en `duplicate_groups.json` como propuesta de unificación sin realizar fusión automática destructiva.
- **Conflicto Fuerte ISIN/FIGI**: Si un mismo ISIN interno recibe FIGIs distintos, o varios ISINs reciben un mismo FIGI, los activos se marcan en `blocked_candidates.json` bajo el estado `BLOCKED` (issue `ISIN_FIGI_CONFLICT`).

## Resultados de Ejecución
- **Test Unitarios**: `npm test` -> **69/69 PASS**.
- **Dry Run (Fixture Local)**: `npm run dryrun:openfigi` analizó los 10 registros de la fase previa.
  - Generó los reportes solicitados (`openfigi_requests.json`, `enrichment_candidates.json`, `duplicate_groups.json`, `ambiguous_matches.json`, `review_candidates.json`, `blocked_candidates.json`, `dedup_report.json`, `dryrun_summary.json`).
  - Total Procesado: 10
  - OK Matches: 4
  - Ambiguos: 0
  - Blocked: 0
  - Review: 6
  - Grupos duplicados: 1

## Riesgos Pendientes antes del Firestore Write Gate
- **Volumetría Live**: Si conectamos el entorno productivo con bases de miles de CSV, superaremos fácilmente el límite de cuota sin un mecanismo de *batching* e intervalos (throttling). Por ello, el modo Live permanece limitado a 5 identificadores a modo de cortafuegos.

## Confirmación Explícita de Restricciones
- Firestore writes = **0**
- serviceAccountKey = **NO**
- Firebase credentials = **NO**
- Deploy = **NO**
- Commit = **NO**
- Push = **NO**
- BDB-FONDOS = **NO**
- BDB-FONDOS-CORE = **NO**
- EODHD Fundamentals = **NO**
- OpenFIGI live = **NO (salvo variable explícita OPENFIGI_LIVE_DRYRUN)**
- API key impresa = **NO**
