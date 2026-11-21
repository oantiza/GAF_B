# Bloque 7D-1 - Diversified ETF + Index Asset/Listing Pilot Write

## Objetivo

Validar el schema Firestore con dos tipos de activo adicionales, limitando el piloto a
dos asset roots y sus listings. Este bloque no incluye `price_series`, `metrics`,
borrados, rollback ejecutado ni fuentes live.

## Seleccion piloto

Estado final: `PASS`.

| Tipo | Asset ID | Listing ID | Estado | Motivo |
| --- | --- | --- | --- | --- |
| ETF | `US25461A8743` | `EODHD_AAPU.US` | `REVIEW` | ISIN fuerte local; OpenFIGI dry-run sin match |
| INDEX | `EODHD:GSPC.INDX` | `EODHD_GSPC.INDX` | `REVIEW` | Fallback EODHD provisional documentado |

El ETF y el indice/proxy prueban dos variantes del contrato sin ampliar el alcance a
historicos o metricas. Ambos conservan `write_gate_status: REVIEW`; ningun candidato
se convierte silenciosamente en `OK`.

## Paths previstos

1. `assets/US25461A8743`
2. `assets/US25461A8743/listings/EODHD_AAPU.US`
3. `assets/EODHD:GSPC.INDX`
4. `assets/EODHD:GSPC.INDX/listings/EODHD_GSPC.INDX`

Operaciones previstas: `4 CREATE`, `merge=false`.

## Pre-write snapshot

- Selected paths missing: `4/4`
- Existing docs inesperados: `0`
- Read errors: `0`
- Snapshot coincide con estado esperado: `SI`
- AAPL paths verificados exactamente: `7/7`
- AAPL payload mismatches: `0`
- AAPL modified: `NO`

## Write approval manifest previo

- Gate: `firestore_diversified_pilot_write_0`
- `authorized`: `false` en prepare-only; `true` durante el proceso real autorizado
- `can_write`: `true`
- `firestore_writes_allowed`: `false` en prepare-only; `true` durante el proceso real autorizado
- Operator confirmation required: `true`
- Operator confirmation received para la ejecucion: `true`
- Asset roots: `2/2`
- Operations: `4/6`
- BLOCKED selected: `0`
- Price series selected: `0`
- Metrics selected: `0`

Todas las validaciones estructurales y read-only pasaron. El write solo se desbloqueo
en el proceso que recibio la confirmacion exacta para este gate y cuatro operaciones.

## Rollback manifest

`rollback_manifest_real_0.json` fue generado antes del write. No se ha ejecutado.
El orden documentado elimina primero listings y despues asset roots, solo si existe una
autorizacion posterior explicita.

## Resultado del write real

- Real write attempted: `SI`
- Real write executed: `SI`
- Firestore writes en este bloque: `4`
- Firestore deletes en este bloque: `0`
- Batch count: `1`
- Post-write verification: `PASS`
- Existing selected paths: `4/4`
- Missing selected paths: `0`
- Payload mismatches: `0`
- Type or identifier mismatches: `0`
- Paths fuera de seleccion: `0`
- Price series written: `0`
- Metrics written: `0`
- AAPL modified: `NO`
- Rollback executed: `NO`

Paths escritos:

1. `assets/US25461A8743`
2. `assets/US25461A8743/listings/EODHD_AAPU.US`
3. `assets/EODHD:GSPC.INDX`
4. `assets/EODHD:GSPC.INDX/listings/EODHD_GSPC.INDX`

## Auditorias previas

- `npm test`: `152/152 PASS`
- Firestore post-write closeout audit: `PASS`
- AAPL enriched closeout audit: `PASS`
- Credenciales impresas: `NO`
- serviceAccountKey en repo: `NO`
- `.env.local` conserva `FIRESTORE_LIVE_READONLY=true`
- Variables reales de write persistidas: `NO`

## Riesgos pendientes

- `GSPC.INDX` usa un identificador provisional `EODHD:<code.exchange>` y debe seguir
  en `REVIEW` hasta disponer de un identificador fuerte validado.
- `AAPU.US` tiene ISIN fuerte, pero el dry-run local de OpenFIGI no produjo match.
- Los dos nuevos assets siguen en `REVIEW`; no deben promocionarse a `OK` sin resolver
  sus identificadores pendientes.

## Siguiente paso recomendado

Ejecutar un closeout read-only dedicado al piloto diversificado que vuelva a comprobar
los cuatro paths, mantenga ambos candidatos en `REVIEW`, confirme AAPL intacto y
verifique que el entorno sigue sin flags de escritura activos.
