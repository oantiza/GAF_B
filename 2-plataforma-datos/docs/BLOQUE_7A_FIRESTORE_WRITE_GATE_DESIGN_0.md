# Bloque 7A: Firestore Write Gate Design (Mock)

## Objetivo
El objetivo de este bloque es planificar, diseñar y simular el embudo final de escritura (Write Gate) hacia Firestore, **sin ejecutar una sola escritura real**. Esto permite auditar los esquemas, reglas de seguridad y manifiestos de aprobación antes de inyectar dependencias críticas como `firebase-admin`.

## Contexto del Pipeline
Actualmente contamos con un pipeline robusto totalmente en memoria:
- Modelos 1:N Asset-Listings.
- Ingestión desde CSV y EODHD.
- Precios mapeados por `listing_id`.
- Métricas calculadas.
- Enriquecimiento y deduplicación a través de OpenFIGI.
- Todas las validaciones previas garantizan que los objetos que llegan al *Write Gate* cumplen nuestro tipado estricto.

## Estructura Firestore Propuesta y Justificada

1. **`assets/{asset_id}`**: Documento raíz del instrumento económico. Almacena metadatos globales, identidad e ISIN.
2. **`assets/{asset_id}/listings/{listing_id}`**: Subcolección. Separa las distintas cotizaciones (bolsa, divisa, ticker) del activo raíz. Es vital porque un mismo ISIN puede cotizar en euros en Frankfurt y en dólares en Nasdaq.
3. **`assets/{asset_id}/price_series/{source_price_id}`**: Subcolección para los precios históricos, asociados explícitamente a su listing correspondiente. (En caso de fondos mutuos sin listados bursátiles, pueden pender del `asset_id`).
4. **`assets/{asset_id}/metrics/{metrics_id}`**: Subcolección de riesgo y rentabilidad, derivada de una serie de precios particular.
5. **`ingestion_runs/{run_id}`**: Colección histórica de las pasadas de la tubería ETL.
6. **`write_gates/{gate_id}`**: Manifiesto firmado sobre quién y qué aprobó la escritura.

## Resumen de la Selección Piloto
El dry-run recolecta automáticamente 5 activos del paso anterior (EODHD Dry Run y OpenFIGI Dry Run). Como parte del requerimiento, esta selección incluye stocks, etfs y casos marcados para revisión (`REVIEW`) o bloqueados (`BLOCKED`) si el fixture los detectó. 

## Mock Write Plan
En el archivo `mock_write_plan.json` se simulan operaciones `CREATE`, `UPDATE` o `SKIP`. 
Cualquier activo marcado con status `BLOCKED` por la deduplicación de OpenFIGI provoca un `SKIP` en todos sus documentos anidados. Los que quedan en `REVIEW` se simulan como `CREATE` pero su status de revisión queda embebido, alertando de que en un caso real podrían ser paralizados.

## Riesgos Pendientes Antes del Write Real
1. **Inicialización de Firebase Admin**: Requiere manejar de forma segura el `serviceAccountKey.json`.
2. **Batching**: Firestore limita a 500 operaciones por Batch. Si nuestro *selection* futuro es masivo, el Write Gate real deberá implementar particionado de arrays.

## Checklist Previa a Bloque 7B (Real Write)
- [x] Firestore mapping diseñado.
- [x] Manifiestos de rollback y post-write definidos.
- [x] MockWriter testeado para rechazar llamadas si `authorized !== true`.
- [ ] Conectar `firebase-admin` (Objetivo de 7B).

## Confirmación Explícita de Restricciones
- Firestore writes = **0**
- serviceAccountKey = **NO**
- Firebase credentials = **NO**
- Firebase Admin real = **NO**
- Deploy = **NO**
- Commit = **NO**
- Push = **NO**
- BDB-FONDOS = **NO**
- BDB-FONDOS-CORE = **NO**
- EODHD Fundamentals = **NO**
- OpenFIGI live = **NO**
- API key impresa = **NO**
