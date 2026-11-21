# Auditoría del Dry-Run Sintético (Bloque 2)

## 1. Resumen del Dry-Run
El pipeline de ingesta local se ha ejecutado exitosamente sin acceso a dependencias externas, bases de datos o red. Se procesó un *fixture* estático de 9 activos sintéticos (`sample_assets_raw.json`) a través de las etapas de normalización, validación y control de calidad (contract-first). 

**Conteo de resultados:**
- **Procesados:** 9
- **OK:** 4
- **REVIEW:** 2
- **BLOCKED:** 3

## 2. Explicación de cada BLOCKED
Los activos clasificados como `BLOCKED` no cumplen con la estructura crítica mínima para existir en el sistema.
- **`etf-blk-1`**: Solo poseía `ticker`. Se requiere obligatoriamente un identificador fuerte (`isin`, `figi` o `eodhd_code`). El ticker por sí solo no es un identificador fuerte.
- **`eq-blk-1`**: El `asset_type` era `INVALID_TYPE`. Un activo sin un tipo conocido (FUND, ETF, EQUITY) corrompe la estructura de la base de datos y es bloqueado por la validación.
- **`eq-blk-2`**: El formato del `ISIN` era inválido (`US123`). Un fallo en la validación básica del ISIN indica datos corruptos y el activo debe ser bloqueado inmediatamente.

## 3. Explicación de cada REVIEW
Los activos clasificados como `REVIEW` son estructuralmente sólidos y guardables, pero carecen de información secundaria crítica para analítica o reporting.
- **`fund-rev-1`**: Carece de `category`. Se guarda, pero levanta un flag de revisión para que un proceso secundario (o equipo de datos) categorice el activo.
- **`etf-rev-1`**: La flag de `hasPriceHistory` retornó `false`. El activo está correctamente identificado, pero sin historial de precios no se puede usar para reportes de rentabilidad.

*Nota técnica:* El activo `fund-ok-2` (que poseía `retrocession: 0`) fue correctamente validado como `OK`, verificando que el valor `0` numérico se preserva y no lanza una alerta de "falta de costes".

## 4. Confirmación de Aislamiento
- **Dependencia de Firebase:** Nula. El proceso se ejecuta en memoria y usa Node.js file system.
- **Writes Reales:** Ninguno. Se generaron *artifacts* JSON locales.
- **Credenciales:** Inexistentes en este flujo.

## 5. Riesgos Detectados
- **Gestión de Resoluciones (Merges):** Actualmente el *dry-run* evalúa un activo único por objeto. Cuando comencemos a importar desde dos fuentes (ej. EODHD vs OpenFIGI), necesitaremos un paso previo de "Merge" o "Resolución" de conflictos si ambas fuentes proveen el mismo ISIN pero con metadatos divergentes.

## 6. Recomendaciones antes del Bloque 3
- **Crear capa de Merge:** Antes de hacer ingestas masivas de APIs reales (EODHD / OpenFIGI), diseñar una entidad `AssetResolver` que sepa combinar (merge) `NormalizedAssetRecord` de diferentes fuentes y decida con quién se queda en caso de conflicto.
- **Preparar infraestructura EODHD Mock:** El Bloque 3 requerirá traer datos, sugiero crear un script mock o client-wrapper abstracto para que siga siendo 100% aislable en entorno de tests.
