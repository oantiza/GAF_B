# Bloque 3B: Auditoría de Consistencia del Schema Canónico

## 1. Resumen de la Auditoría
Se ha realizado una revisión exhaustiva del schema interno de activos en el codebase para garantizar que el modelo de datos respeta la jerarquía estructurada `identifiers.*` y erradica los *aliases* provisorios o legacy que mezclaban la identidad del activo con sus códigos de mercado.

## 2. Aliases Legacy Detectados y Eliminados
Se detectaron los siguientes *aliases* que existían dentro del bloque `identity` en la interfaz `AssetIdentity` (`src/types/assets.ts`):
- `identity.isin`
- `identity.ticker`
- `identity.figi`
- `identity.eodhd_code`
- `identity.exchange`

**Acción tomada:**
Se han **eliminado de forma definitiva** como dependencia lógica en todo el sistema. Se modificó el schema base, segregando estas propiedades en un bloque estrictamente dedicado a identificadores (`AssetIdentifiers`).

## 3. Decisión Canónica Final
El sistema ahora asume la siguiente estructura como su verdad absoluta (Canonical Schema):
- **`identity.name`**: Nombre comercial o legal del activo.
- **`identifiers.isin`**: ISIN.
- **`identifiers.ticker`**: Ticker.
- **`identifiers.exchange`**: Código de la bolsa.
- **`identifiers.figi`**: Financial Instrument Global Identifier.
- **`identifiers.eodhd_code`**: Identificador compuesto para EODHD (ej. `AAPL.US`).

Cualquier validador (`assetValidator.ts`), regla de calidad (`assetQuality.ts`), normalizador (`assetNormalizer.ts`) o test unitario ha sido refactorizado para depender exclusivamente de `identifiers.*`.

## 4. Riesgos mitigados antes de EODHD
- **Falsos Positivos de Calidad:** Al erradicar los *aliases*, garantizamos que el importador EODHD (Bloque 4) no inyecte IDs en campos obsoletos que el validador pudiera ignorar, previniendo la corrupción de la base de datos de producción.
- **Cohesión Estructural:** Evita el problema de "dos fuentes de verdad" para un mismo identificador.

## 5. Resultados de Pruebas y Validación
Se ejecutó la suite completa de tests automatizados tras la refactorización profunda:
- **`npm test`**: 31/31 PASSED (incluyendo 6 archivos de tests refactorizados).
- Se validó explícitamente que:
  - Ticker solo no basta como identificador fuerte.
  - `identifiers.eodhd_code` sí cuenta como identificador fuerte provisional.
  - `identifiers.isin` inválido bloquea al activo (status `BLOCKED`).
  - La lógica financiera paralela (costes, missing category/price) opera independientemente y con éxito.
- **`npm run dryrun:manual-csv`** y **`npm run dryrun:synthetic`** se ejecutaron exitosamente utilizando la nueva arquitectura estricta sin presentar regresiones.

## 6. Aislamiento Garantizado
- No ha habido escrituras en Firestore.
- No se han conectado servicios externos (EODHD / OpenFIGI).
- El sistema de BDB-FONDOS no ha sido tocado.
