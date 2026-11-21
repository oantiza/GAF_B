# Bloque 4: Conector EODHD en Modo Dry-Run

## 1. Objetivo
El objetivo del Bloque 4 es introducir el primer proveedor real de datos externos (EODHD APIs), pero manteniéndolo estrictamente aislado bajo un entorno de *dry-run* (sin writes en Firestore) y con capacidades de mock/fixture por defecto para preservar la cuota de la API y evitar polución de datos.

## 2. Configuración Segura (.env)
La conexión requiere un token de API que NO debe ser commiteado al repositorio.
Se ha configurado `.gitignore` para ignorar archivos `.env` o credenciales.
Se provee un archivo `.env.example` con la estructura base.

Para activar el modo live (opcional):
1. Copia `.env.example` a `.env.local`.
2. Reemplaza `EODHD_API_TOKEN=replace_me` con el token real.
3. Añade `EODHD_LIVE_DRYRUN=true` a tu `.env.local` si deseas activar las llamadas reales.

**ADVERTENCIA**: El código por defecto operará en modo **Fixture (Mock)** si no se provee un token válido o si `EODHD_LIVE_DRYRUN` no es explícitamente `true`.

## 3. Arquitectura del Conector
- **`eodhdClient.ts`**: Wrapper seguro de `fetch`. Incluye timeout automático, protección contra filtrado de tokens, y parseo seguro de JSON.
- **`eodhdTypes.ts`**: Tipado estricto de las entidades de dominio de EODHD.
- **`eodhdMapper.ts`**: Traductor desde el dialecto propietario EODHD hacia nuestro `RawAssetInput` canónico (Bloque 3B). 
  - Regla Clave 1: Asigna `asset_type` determinista (`STOCK`, `ETF`, `FUND`, `INDEX`, o `OTHER`).
  - Regla Clave 2: Para activos de tipo `STOCK`, asigna automáticamente `classification.asset_class = 'EQUITY'`.
  - Regla Clave 3: Promociona ISINs válidos a `asset_id`. En su defecto, sintetiza el ID bajo la nomenclatura `EODHD:Code.Exchange`.

## 4. Límites de Seguridad en Modo Live
Si se habilita el modo Live, el script `runEodhdDryRun.ts` invocará `/exchange-symbol-list/US`. Para prevenir desbordamientos masivos de RAM durante las pruebas locales:
- Se restringe drásticamente la respuesta a un subconjunto ínfimo (ej. 3 activos) internamente mediante `maxRequests`. Esto asegura que el pipeline no procese miles de registros de golpe durante la fase de *discovery*.

## 5. Artifacts Generados
La salida se vuelca localmente a la carpeta `/artifacts/eodhd_dryrun_0/` y provee trazabilidad total:
- `provider_raw_sample.json`: Payload crudo exactamente como lo entregó EODHD.
- `mapped_assets.json`: Interfaz convertida a `RawAssetInput`.
- `input_summary.json` / `normalized_assets.json` / `validation_report.json` / `quality_report.json`
- `blocked_assets.json` / `review_assets.json` / `ok_assets.json`

## 6. Riesgos y Consideraciones Futuras
1. **Paginación y Volumetría**: Actualmente, el modo Live consume un endpoint que podría devolver >10,000 activos por Exchange de golpe. En fases posteriores (Bloque 5+) será necesario instrumentar streaming, streams NDJSON o paginación controlada.
2. **Rate Limits**: EODHD impone límites por minuto. No reintentar agresivamente.
3. **Calidad de EODHD**: Los ISINs pueden venir vacíos o malformados desde origen, lo que requerirá de nuestra capa de deduplicación cruzada con OpenFIGI (Bloque futuro).
