# Auditoría del Refactor 1:N (Asset / Listings)

## 1. Decisión Recomendada: AJUSTAR Refactor

Se auditaron los cambios de arquitectura introducidos en el refactor 1:N. Si bien la idea subyacente de separar la entidad global (ISIN) de sus puntos de cotización individuales (listings) era conceptualmente sólida para la fase de ingestión, se detectó una gran deficiencia: **El refactor no alcanzó el nivel de precios y métricas.** 
Los endpoints de EODHD y los cálculos seguían vinculando el histórico de precios puramente al `asset_id` global. Si Apple cotizara en US y Frankfurt, los precios de ambas bolsas se habrían mezclado bajo el mismo `asset_id`.

Por tanto, se procedió a **AJUSTAR** el refactor para propagar el `listing_id` al ecosistema de precios y métricas.

---

## 2. Contrato Final Recomendado (Asset/Listing)

Tras el ajuste, el contrato de identidad queda de la siguiente forma:

1. **`asset_id` (Nivel Global)**
   - Es el ISIN si el activo posee uno válido.
   - Es el `FIGI` si no hay ISIN.
   - En última instancia (fallback provisional), se conforma con `EODHD:<Code>.<Exchange>`.

2. **`listing_id` (Nivel de Mercado)**
   - Corresponde a un único punto de negociación o ticker de un proveedor.
   - En el caso de EODHD, se genera internamente como `EODHD_<Code.Exchange>`.
   - Permite que un `asset_id` (ej. ISIN US0378331005) posea múltiples `listing_id` (ej. `EODHD_AAPL.US`, `EODHD_APC.F`).

---

## 3. Impacto en Precios y Métricas

- **Precios (Prices)**: Las estructuras `AssetPriceYearCandidate` y `PriceMappingIssue` ahora requieren un `listing_id` obligatorio. Un precio ya no pertenece genéricamente a la "empresa", sino a una vía de cotización particular de esa empresa. Si un fondo no cotiza, su "NAV" se considerará su único `listing_id` virtual o referenciará su único ticker.
- **Métricas (Metrics)**: Las estructuras `PriceMetricInput`, `PriceMetricsIssue`, y `AssetMetricsLatestCandidate` han sido ampliadas para incluir el `listing_id`. Ahora los rendimientos, el CAGR y el riesgo se calculan *por listing*, lo cual tiene sentido, puesto que el riesgo de liquidez y divisa puede variar entre bolsas, incluso para el mismo activo.

---

## 4. Riesgos Antes de Firestore

1. **Gestión de la Moneda**: Al agrupar precios, si no se filtran estrictamente por `listing_id` y en cambio se intentan calcular métricas a nivel de `asset_id`, se podrían mezclar precios en USD con precios en EUR. El ajuste realizado asegura que agrupemos los candidatos de métricas por `listing_id`.
2. **Volumetría**: Firestore recibirá más escrituras (subcolecciones de métricas y precios multiplicadas por los múltiples listings de una misma empresa) si llegamos a descargar un universo muy diversificado. Mantener control en el número de listings que permitimos es vital.

---

## 5. Tests Añadidos / Corregidos

Se corrigieron varios archivos de test para reflejar el nuevo parámetro `listing_id` y el paso de parámetros en funciones clave:
- `tests/priceMetricsCalculator.test.ts`: Actualizados todos los escenarios inyectando `listing_id`.
- `tests/eodhdPricesMapper.test.ts`: Se corrigió la llamada a `mapEodhdPrices` (que cambió su firma de parámetros) para incluir `listing_id`.
- Ambos test suites vuelven a ejecutarse en verde (**16 pasados, 59 tests exitosos**).

---

## 6. Confirmación de Restricciones

Se confirman los siguientes estatutos según la directiva inicial:
- Firestore writes = **0**
- API key impresa = **NO**
- Fundamentals usado = **NO**
- OpenFIGI live = **NO**
- BDB-FONDOS = **NO**
- BDB-FONDOS-CORE = **NO**
- Deploy = **NO**
- Commit = **NO**
- Push = **NO**

El pipeline en memoria, a nivel estático y lógico, funciona correctamente.
