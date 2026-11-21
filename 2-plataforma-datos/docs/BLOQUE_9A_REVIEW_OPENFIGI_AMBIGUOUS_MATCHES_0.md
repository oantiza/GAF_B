# BLOQUE 9A-REVIEW: Análisis de Coincidencias Ambiguas en OpenFIGI

## Objetivo
Revisar los resultados de la validación en vivo de OpenFIGI (`openfigi_live_identity_validation_0`), clasificar los 4 activos devueltos como `AMBIGUOUS` y dictaminar si se puede proceder a un enriquecimiento parcial seguro sin modificar los activos dudosos.

## Resumen de la Validación (Input)
- **Total de activos validados:** 9
- **CONFIRMED_MATCH:** 5
- **AMBIGUOUS:** 4
- **UNMATCHED:** 0
- **CONFLICT_REVIEW:** 0

### Activos Confirmados (Seguros para enriquecimiento futuro)
Los siguientes activos devolvieron exactamente una coincidencia consistente o se resolvieron con seguridad:
1. `MSFT.US` (Provisional EODHD resuelto a FIGI `BBG000BPH459`)
2. `GOOGL.US` (Provisional EODHD resuelto a FIGI `BBG009S39JX6`)
3. `AMZN.US` (Provisional EODHD resuelto a FIGI `BBG000BVPV84`)
4. `EFA.US` (Provisional EODHD resuelto a FIGI `BBG000D2KQ55`)
5. `EEM.US` (Provisional EODHD resuelto a FIGI `BBG000M0P5L2`)

### Activos Ambiguos (Bajo Revisión)
1. **`AAPL.US`** (US0378331005)
   - **Múltiples tickers/exchanges/composites** reportados por OpenFIGI para este ISIN.
   - **Recomendación:** `REQUIRES_ADDITIONAL_IDENTIFIER` o `AMBIGUOUS_KEEP_PROVISIONAL`. (Revisión manual requerida antes de forzar asignación por ISIN).

2. **`SPY.US`** (US78462F1030)
   - Alta cantidad de resultados devueltos; múltiples variaciones en `compositeFIGI` y listados regionales.
   - **Recomendación:** `AMBIGUOUS_KEEP_PROVISIONAL`.

3. **`QQQ.US`** (US46090E1038)
   - Ambigüedad por la presencia de múltiples listados internacionales atados al mismo ISIN.
   - **Recomendación:** `AMBIGUOUS_KEEP_PROVISIONAL`.

4. **`IWDA.LSE`** (IE00B4L5Y983)
   - El ISIN devuelve +180 coincidencias (SWDA, IWDA, etc. en LSE, XETRA, Borsa Italiana, etc.) con diferentes composites.
   - **Recomendación:** `AMBIGUOUS_KEEP_PROVISIONAL`. (El activo UCITS ETF suele presentar masiva multiplicidad de cruces, lo cual es de alto riesgo para un match ciego).

## Decisión y Veredicto
- Estado: `READY_FOR_PARTIAL_ENRICHMENT_WRITE_PREP`
- **Motivo:** Los 5 activos provisionales (MSFT, GOOGL, AMZN, EFA, EEM) que presentaban mayor deuda técnica se han resuelto de forma unívoca y pueden avanzar al Write Prep Gate de enriquecimiento. Los 4 activos que entraron como ambiguos (AAPL, SPY, QQQ, IWDA) ya cuentan con un `asset_id` firme (ISIN o CUSIP-based) en Firestore y por lo tanto mantenerlos temporalmente sin FIGI no corrompe la base de datos. Se apartan de este lote de enriquecimiento.

## Confirmación de Seguridad
- **Firestore Writes en este bloque:** 0
- **Firestore Deletes en este bloque:** 0
- **Nuevas llamadas a OpenFIGI:** 0 (Se trabajó 100% off-line procesando artifacts).
- **API Key impresa:** NO
- **Commit:** NO
- **Push:** NO
- **Deploy:** NO
