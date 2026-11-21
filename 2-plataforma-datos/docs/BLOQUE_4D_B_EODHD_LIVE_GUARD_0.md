# BLOQUE 4D-B: EODHD Live Guard (Hardening)

## Problema Detectado
En la primera ejecución del Live Dry-Run (Bloque 4D), el conector realizó exitosamente 1 petición al endpoint `/exchange-symbol-list/US`. Sin embargo, dado que este endpoint devuelve todos los activos listados en EE.UU., la API devolvió **51,683 activos** en una sola llamada.
Aunque nuestra capa de lógica inmediatamente truncó la respuesta a 3 elementos por seguridad, descargar ~52k registros en cada prueba "mínima" consume ancho de banda innecesario, retrasa los tests y no cumple con el espíritu de una prueba "acotada" y "controlada".

## Cambio Aplicado
Se ha reescrito la función principal del dry-run (`fetchEodhdData` en `eodhdDryRun.ts`) para modificar el comportamiento por defecto al conectarnos a la API Live:
1. **Cambio de Endpoint Base**: Por defecto, ahora se utiliza el endpoint de búsqueda acotado (`/search/{query}`) en lugar del listado masivo por exchange.
2. **Límites Estrictos**:
   - Máximo 3 requests.
   - Máximo 10 items procesados de manera global.
3. **Live Guard (Protección de Respuesta)**: Si cualquier respuesta Live devuelve accidentalmente más de 100 elementos durante el dry-run mínimo, el `live_guard` se activará (`live_guard_triggered = true`), registrará el warning `LIVE_RESPONSE_TOO_LARGE`, y truncará inmediatamente la carga útil.
4. **Métricas (Stats)**: El script de dry-run y el `run_summary.json` ahora guardan trazas completas de: peticiones hechas, items recibidos del proveedor, items truncados y warnings.

## Endpoints en Modo Live Mínimo
- **Permitidos por defecto**: `/search/{query}` (con queries manuales predefinidas: `AAPL`, `IWDA`, `LU`).
- **Bloqueados por defecto**: `/exchange-symbol-list/{exchange}` y similares endpoints masivos. Para utilizarlos temporalmente en dry-run, es obligatorio inyectar la variable de entorno explícita `EODHD_ALLOW_EXCHANGE_LIST_DRYRUN=true`.

## Resultado de Tests
Se añadieron 2 nuevos tests en `tests/eodhdDryRun.test.ts` que validan esta nueva lógica usando mocks de Vitest (sin consumir API real).
Los **40 tests** pasan correctamente:
```text
 ✓ tests/eodhdDryRun.test.ts (3 tests)
 Test Files  11 passed (11)
      Tests  40 passed (40)
```

## Resultado del Dry-Run (Live Real)
Ejecutando `npm run dryrun:eodhd` con `EODHD_LIVE_DRYRUN=true`:
- El modo detectado fue **ACTIVADO**.
- Envió 1 request (para la primera query `AAPL`), de la cual obtuvo 15 resultados reales.
- El script procesó un máximo de 10 resultados, truncando 5.
- La ejecución finalizó en 0ms sin disparar el warning de volumen excesivo (15 < 100).
- Todos los 10 items cayeron en estado REVIEW para análisis.

## Confirmación de Seguridad
- **Writes en Firestore**: 0
- **Exposición de Keys**: Ninguna (Token oculto y no impreso en logs ni guardado en artifacts).
- **Entorno Aislado**: Operó sin alterar BDB-FONDOS y sin conectar con OpenFIGI.
