# Bloque 23B — Cobertura Semantics Refinement

Este documento detalla la refinación de las semánticas de cobertura de activos en la base de datos de activos financieros.

## 1. Problema Original
La auditoría de cobertura anterior clasificaba de forma genérica a todos los activos en base a las reglas de los activos cotizados en bolsa (mercado). Bajo estas reglas, un activo se consideraba `COMPLETE` si tenía un documento raíz (root), listings, series de precios (price_series) y métricas calculadas (`metrics/latest`). 

Sin embargo, para los fondos de inversión (tipo `FUND`), esta semántica era incorrecta. Los fondos no tienen cotizaciones de mercado en tiempo real y, por lo tanto, no tienen listings ni series de precios de mercado. No obstante, están completamente resueltos si tienen su perfil raíz enriquecido y holdings (cartera de posiciones) válidos en Firestore (ya sea en formato `SINGLE_DOCUMENT` o `CHUNKED_DOCUMENTS`). Clasificarlos como `ROOT_ONLY` u otros estados parciales ensuciaba el reporte de cobertura real del proyecto.

## 2. Nueva Semántica de Cobertura
Se introdujo una clasificación refinada distinguiendo explícitamente entre activos de mercado (STOCK, ETF, INDEX) y fondos (FUND):

- **`COMPLETE_MARKET_ASSET`**: Activo de mercado con root, listing(s), price_series y `metrics/latest`. No marcado como `COMPLETE_LATER`.
- **`COMPLETE_FUND`**: Fondo con root enriquecido y holdings completos (ya sea un único documento `latest` o manifest con todos sus chunks requeridos). También incluye excepciones justificadas (como `IE00B4ND3602`, que no tiene cartera en el origen).
- **`PARTIAL_MARKET_ASSET`**: Activo de mercado esperado en el alcance pero que carece de algún componente (listings, precios o métricas).
- **`PARTIAL_FUND`**: Fondo esperado en el alcance pero que no cuenta con holdings válidos o cuyos chunks son inconsistentes.
- **`TRUE_ROOT_ONLY`**: Activo que solo posee documento raíz, pero que no está sujeto a ningún contrato de completitud en la fase actual del proyecto (por ejemplo, activos muestreados aleatoriamente).
- **`MISSING`**: Activo esperado en el alcance cuyo documento raíz ni siquiera existe.
- **`COMPLETE_LATER`**: Activos marcados intencionalmente para resolverse en fases posteriores (por ejemplo, `AAPU` y `GSPC`), evitando ensuciar el conteo de `PARTIAL`.

## 3. Resultado del Preview
El script de previsualización local `scripts/runCoverageSemanticsRefinementPreview.ts` arrojó los siguientes resultados en modo simulación/local:

```
total_assets_checked: 414
complete_market_assets_count: 8
complete_funds_count: 404
partial_market_assets_count: 0
partial_funds_count: 0
true_root_only_count: 0
missing_count: 0
complete_later_count: 2
legacy_root_only_reclassified_count: 404
fondosdb_complete_fund_count: 404
holdings_single_count: 387
holdings_chunked_count: 17
root_without_holdings_expected_count: 0
root_without_holdings_justified_count: 1
[SAFETY] firestore_writes=0 firestore_deletes=0
```

- Los **404 fondos** FondosDB se clasifican ahora correctamente como **`COMPLETE_FUND`** (387 en modo `SINGLE_DOCUMENT`, 17 en modo `CHUNKED_DOCUMENTS`).
- El fondo **`IE00B4ND3602`** (que no posee cartera en origen) queda justificado como **`COMPLETE_FUND`**.
- Los activos especializados `AAPU` y `GSPC` se reportan debidamente como **`COMPLETE_LATER`**.

## 4. Comandos Ejecutados
- `npm run typecheck` - Verificación de tipos TypeScript.
- `npm test tests/coverageSemanticsRefinement.test.ts` - Ejecución de pruebas unitarias específicas de la refinación de semánticas.
- `npm run preview:coverage-semantics` - Visualización del reporte de cobertura ajustado a las nuevas semánticas.

## 5. Pruebas Unitarias y Typecheck
Se implementó un conjunto completo de pruebas en [coverageSemanticsRefinement.test.ts](file:///C:/Users/oanti/Documents/BBDD-ACTIVOS-FINANCIEROS/tests/coverageSemanticsRefinement.test.ts), validando todos los escenarios de clasificación:
- `COMPLETE_FUND` con almacenamiento simple.
- `COMPLETE_FUND` con almacenamiento en fragmentos (chunked).
- `COMPLETE_FUND` justificado para `IE00B4ND3602`.
- `PARTIAL_FUND` para fondos sin holdings.
- `COMPLETE_MARKET_ASSET` para activos de mercado con datos completos.
- `PARTIAL_MARKET_ASSET` para activos de mercado incompletos.
- `COMPLETE_LATER` para AAPU y GSPC.
- `TRUE_ROOT_ONLY` para activos sin contrato específico.
- `MISSING` para activos sin raíz.

Tanto `npm run typecheck` como `npm test` finalizan de forma exitosa (PASS).

## 6. Seguridad y Restricciones
- **Escrituras en Firestore:** 0.
- **Borrados en Firestore:** 0.
- **FIRESTORE_REAL_WRITE_ENABLED:** NO activo.

## 7. Próximo Paso Recomendado
**23C — Query Layer**: Diseñar e implementar la capa de consultas unificadas (`getFundOverview`, etc.) para servir las vistas agregadas y optimizadas de fondos y activos de mercado de forma consolidada.
