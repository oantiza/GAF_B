# BLOQUE 9A: OPENFIGI LIVE IDENTITY VALIDATION DRY-RUN 0

## Objetivo
Ejecutar una validación en modo "live dry-run" con la API de OpenFIGI para resolver ambigüedades e identidades provisionales generadas tras la inyección del Batch Vanilla (Bloque 7O) y de activos previos. 
El objetivo es proponer actualizaciones en Firestore sin ejecutar ninguna escritura destructiva (Writes: 0). Se busca confirmar el `ISIN` cruzándolo con OpenFIGI y enriquecer el activo con `FIGI`, `compositeFIGI` y `shareClassFIGI`.

## Variables Requeridas para Ejecución Live
- `OPENFIGI_API_KEY`: Requerido.
- `OPENFIGI_LIVE_DRYRUN`: `true`.

## Activos Seleccionados (Límite Máximo: 10)
Se han seleccionado 9 activos para su validación:
1. AAPL (US0378331005) - CONFIRMED
2. SPY (US78462F1030) - CONFIRMED
3. QQQ (US46090E1038) - CONFIRMED
4. IWDA (IE00B4L5Y983) - CONFIRMED
5. MSFT (EODHD_MSFT.US) - PROVISIONAL_EODHD
6. GOOGL (EODHD_GOOGL.US) - PROVISIONAL_EODHD
7. AMZN (EODHD_AMZN.US) - PROVISIONAL_EODHD
8. EFA (EODHD_EFA.US) - PROVISIONAL_EODHD
9. EEM (EODHD_EEM.US) - PROVISIONAL_EODHD

## Activos Excluidos (Skipped)
- **GSPC.INDX**: Índice provisional sin FIGI definido claramente aplicable como instrumento invertible estándar.
- **AAPU.US**: ETF apalancado excluido de validación masiva temporalmente por políticas de seguridad.

## Resultados de Validación (Dry-Run Safety Fallback)
- **Estado Actual del Run**: `BLOCKED_SAFE`
- **Motivo**: Faltan las variables `OPENFIGI_API_KEY` y `OPENFIGI_LIVE_DRYRUN=true` en el entorno. Se bloquea de forma preventiva y **NO se llama a la API externa**.
- **OpenFIGI Live Ejecutado**: `NO`

### Desglose de Validaciones
- **CONFIRMED_MATCH**: 0
- **AMBIGUOUS**: 0
- **UNMATCHED**: 0
- **CONFLICT_REVIEW**: 0
- **SKIPPED**: 2 explícitos + 9 bloqueados.

## Duplicate Groups y Conflictos
Debido al bloqueo preventivo (Safe Fallback), no se ha evaluado la respuesta y no existen duplicados o conflictos que auditar en esta iteración.

## Propuesta Dry-Run de Actualizaciones Futuras
El artefacto propuesto (`recommended_firestore_updates_dryrun.json`) se ha generado vacío (0 elementos). En un escenario live exitoso, este archivo contendrá las mutaciones propuestas para:
- `identifiers.figi`
- `identifiers.composite_figi`
- `identifiers.share_class_figi`
- `identity_status: 'VERIFIED'`
- `openfigi_validation_status`

## Confirmación de Seguridad
- **Firestore Writes**: 0
- **Firestore Deletes**: 0
- **FIRESTORE_REAL_WRITE_ENABLED**: NO (Ni se solicitó ni se activó).
- **Push / Commit / Deploy**: NO
- **BDB-FONDOS y BDB-FONDOS-CORE**: NO tocados.

## Siguiente Paso Recomendado
**Estado: `BLOCKED_SAFE`**
Configurar las credenciales (`OPENFIGI_API_KEY` y `OPENFIGI_LIVE_DRYRUN=true`) de forma local u orquestada y volver a ejecutar el comando:
```bash
npm run openfigi:live-identity-validation
```
