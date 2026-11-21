# Bloque 3: Importador Dry-Run desde CSV Manual

## 1. Objetivo
El objetivo de este bloque es dotar al sistema de la capacidad de ingerir archivos CSV tabulares generados manualmente o exportados desde otros sistemas, transformarlos en la estructura `RawAssetInput` y pasarlos a través del pipeline *contract-first* ya existente, todo de forma segura (dry-run) sin afectar la base de datos Firestore.

## 2. Columnas Soportadas
El parser (`csvManualReader.ts`) y el mapeador (`manualCsvMapper.ts`) soportan las siguientes columnas planas:
- `asset_id`: Identificador principal para la inyección de datos.
- `asset_type`: Tipo de activo (FUND, ETF, EQUITY, etc.).
- `name`: Nombre del activo.
- `isin`, `ticker`, `exchange`, `figi`, `eodhd_code`: Identificadores fuertes y débiles.
- `currency`: Moneda base.
- `category`, `region`: Clasificación geográfica y de estrategia.
- `ter`, `management_fee`, `retrocession`: Costes en formato porcentaje numérico.
- `price`, `price_date`: Datos del último precio disponible.
- `source`: Origen del dato.

## 3. Reglas de Mapeo
1. El delimitador se detecta automáticamente (`,` o `;`).
2. Se limpian los BOM (`\uFEFF`) del inicio del archivo (frecuente en exportaciones de Excel).
3. Los números (costes y precios) se parsean a `float`. Si están vacíos, se omiten para que el normalizador profundo los convierta a `null`.
4. El valor `0` literal (ej. `retrocession: 0`) se parsea correctamente a un número `0` y no a un valor vacío o nulo.
5. El mapeador genera un esquema mixto que contiene la nueva estructura anidada (`identifiers.isin`, `classification.category`) y al mismo tiempo preserva las rutas planas legacy requeridas por el validador actual (`identity.isin`, `category`), asegurando retrocompatibilidad total sin reescribir toda la suite de tests del Bloque 1 y 2.

## 4. Reglas de Calidad (Heredadas y Verificadas)
- `fund-blk-1`: Carece de ISIN/FIGI/EODHD -> **BLOCKED**.
- `eq-blk-1`: Posee un ISIN con formato inválido -> **BLOCKED**.
- `eq-blk-2`: Posee un `asset_type` inválido -> **BLOCKED**.
- `etf-blk-1`: Posee solo un Ticker (identificador débil) -> **BLOCKED**.
- `fund-rev-1`: Carece de categoría -> **REVIEW**.
- `etf-rev-1`: Carece de precio/historial (`has_price_history = false`) -> **REVIEW**.

## 5. Artifacts Generados
La ejecución del script `npm run dryrun:manual-csv` genera automáticamente una traza completa de la ejecución en la carpeta `artifacts/manual_csv_dryrun_0/`, que incluye:
- `input_summary.json`: Metadatos de la carga.
- `normalized_assets.json`: Activos unificados tras la conversión profunda de strings vacíos a null.
- `validation_report.json`: Reporte de schema (Zod/Custom).
- `quality_report.json`: Estado de completitud y usabilidad analítica.
- `ok_assets.json`, `review_assets.json`, `blocked_assets.json`: Activos segregados por acción.
- `run_summary.json`: Desglose del tiempo de ejecución (1ms) y conteo general (6 OK, 2 REVIEW, 4 BLOCKED).

## 6. Confirmación Estricta de Aislamiento
Se certifica que:
- **No hubo escrituras en Firestore**. (El SDK de Firebase no ha sido invocado).
- **No se utilizaron APIs Externas**. (Todo el procesamiento ha sido 100% in-memory y local).
- **Los repositorios BDB-FONDOS no fueron tocados**.

## 7. Riesgos y Puntos Pendientes
- **Evolución del Schema:** La capa de calidad `assetQuality.ts` actualmente consulta rutas legacy como `asset.identity.isin`. Si en el futuro se decide migrar definitivamente a `asset.identifiers.isin`, habrá que hacer una refactorización masiva y actualizar los tests de los bloques 1, 2 y 3 para evitar romper la lógica de calidad. La solución híbrida adoptada en el mapper previene bloqueos ahora, pero requiere gobernanza.
- **Tipos de Moneda:** Actualmente no se verifica que `currency` sea un ISO válido de 3 letras. Esto debería reforzarse en el Bloque 4.
