# Auditoría de holdings FondosDB (offline)

_Generado: 2026-06-18 · offline, coste cero, solo lectura · manifests de ejecución + fuente `posiciones.ndjson`._

> **ACTUALIZACIÓN (18-jun-2026): verificación post-write CERRADA.** Snapshot read-only en vivo
> (`snapshot:holdings-pre-write-live`, `firestore_writes=0`): **460/460 SET existen, 0 missing,
> 0 read_errors, `root_asset_touches=0`, `missing_root_violations=0`**. El gate que había quedado
> pendiente (la sección "Verificación post-write" describe el fallo original "Firebase no inicializado")
> queda resuelto por lectura independiente.

## Ejecución registrada (real_write_execution_0)
- SET: **460**, DELETE: **25**, fallidos: 0/0 — ✅ OK
- root_asset_touches: 0, missing_root_violations: 0 — ✅ OK
- batch_committed: True; REAL_WRITE activo al final: False — ✅ OK

## Forma de las operaciones
- SET por tipo: `{'latest': 387, 'manifest': 17, 'chunk': 56}` → 387 fondos SINGLE_DOCUMENT + 17 fondos CHUNKED (56 chunks). Paths inválidos: 0 ✅ OK
- DELETE por tipo: `{'chunk': 8, 'latest': 17}` (limpieza idempotente de `latest`/chunks antiguos al pasar a chunked). Inválidos: 0 ✅ OK
- Todas las ops bajo `holdings/*`; ningún root/listings/metrics/price_series — ✅ OK
- Tamaño payload SET: min=499B · max=449996B · medio=86478B (límite Firestore ~1 MiB) — ✅ OK

## Cobertura (fondos con holdings vs roots)
- Fondos con holdings: **404** · roots de fondo aceptados: **404**
- Roots aceptados CON holdings: **403/404**
- Roots aceptados SIN holdings: **1** ['IE00B4ND3602'] → de ellos 1 **no tienen cartera en origen** (correcto omitirlos) — ✅ OK
- Holders fuera de la lista de creates: ['IE00B4L5Y983'] → **IWDA** (ETF existente con cartera en origen; tener holdings es correcto) — ✅ OK
- Ningún holding bajo los 91 fondos excluidos: fondos en origen 495 − escritos 404 ≈ excluidos sin holdings — ✅ OK

## Fuente `posiciones.ndjson`
- Fondos con cartera: **495** · posiciones totales: **94993** · partes: `{1: 490, 2: 6, 5: 5, 4: 4}`
- Pesos nulos: 0 ✅ OK · posiciones sin ISIN: 28731 (cash/derivados; normal)
- Divulgación parcial (suma de pesos <80%): 171 fondos — **normal** (las fichas publican solo posiciones principales; p.ej. IWDA=26.8%). No es error.
- Suma de pesos >150% (posible doble conteo): 0 ✅ OK

## Verificación post-write (hallazgo real)
- ⚠️ La verificación post-write **no se ejecutó**: `sets_verified_exists=0`, error: ['VERIFICATION_ERROR: Error: SECURITY FAULT: Firebase Admin no está inicializado. Ejecución bloqueada.']
- El batch se confirmó (460 SET), pero **no hubo lectura independiente de confirmación**. Es el único gate de holdings que queda por cerrar.

## Veredicto
**Estructura, alcance y cobertura de holdings: correctos.** 404 fondos cubiertos (387 single + 17 chunked), todos sobre roots reales; el único root sin holdings no tiene cartera en origen; IWDA cubierto; sin escrituras bajo roots excluidos ni toques al root; tamaños bajo límite; 94.993 posiciones, 0 pesos nulos. **Único pendiente real:** ejecutar la verificación post-write read-only en tu máquina para confirmar por lectura.
