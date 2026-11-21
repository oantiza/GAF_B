# BLOQUE 7O-0B: Vanilla Batch Prices/Identity Live Dry-Run

## 1. Objetivo
Ejecutar un dry-run real (live) acotado para los 5 candidatos del lote inicial (batch), obteniendo identidad básica y precios históricos para validar que están listos para la ingesta real (write gate), sin mutar el entorno de Firestore.

## 2. Input
Candidatos seleccionados procedentes del bloque 7O-0A:
- `MSFT.US`
- `GOOGL.US`
- `AMZN.US`
- `EFA.US`
- `EEM.US`

## 3. Endpoints Usados
- **EODHD Prices:** `/eod/{ticker}` con rango `2026-01-01` a `2026-06-06`.

## 4. Confirmaciones de Seguridad
- **EODHD Fundamentals:** NO usado (sin llamadas a `/fundamentals`).
- **OpenFIGI Live:** NO usado.
- **Firestore Writes:** 0
- **Firestore Deletes:** 0

## 5. Resultado por Candidato

### 1. `MSFT.US` (Stock)
- **Estado:** `READY_FOR_WRITE_PREP`
- **Precios:** 107 observaciones, sin inválidos ni duplicados.
- **Métricas:** Calculadas con éxito.
- **Identidad:** `PROVISIONAL` (`EODHD_MSFT.US`). Aceptada provisionalmente para escalar.

### 2. `GOOGL.US` (Stock)
- **Estado:** `READY_FOR_WRITE_PREP`
- **Precios:** 107 observaciones.
- **Métricas:** Calculadas con éxito.
- **Identidad:** `PROVISIONAL` (`EODHD_GOOGL.US`).

### 3. `AMZN.US` (Stock)
- **Estado:** `READY_FOR_WRITE_PREP`
- **Precios:** 107 observaciones.
- **Métricas:** Calculadas con éxito.
- **Identidad:** `PROVISIONAL` (`EODHD_AMZN.US`).

### 4. `EFA.US` (ETF)
- **Estado:** `REVIEW_FOR_WRITE_PREP`
- **Precios:** 107 observaciones.
- **Métricas:** Calculadas con éxito.
- **Problemas:** Al ser un ETF y carecer de una resolución segura de ISIN (OpenFIGI/Fundamentals no disponibles), queda en revisión para confirmar su clasificación.

### 5. `EEM.US` (ETF)
- **Estado:** `REVIEW_FOR_WRITE_PREP`
- **Precios:** 107 observaciones.
- **Métricas:** Calculadas con éxito.
- **Problemas:** Ídem (requiere revisión de clasificación al ser ETF sin identidad fuerte validada).

## 6. Resumen de Métricas
Para los 5 activos, se capturaron correctamente los precios históricos y se calcularon internamente:
- Retornos diarios.
- Volatilidad anualizada.
- Drawdown máximo.
- Ratio Sharpe.
- Rentabilidad acumulada.
*(Nota: CAGR no se reporta como OK al ser un periodo < 365 días, pero esto no bloqueó los candidatos tras el ajuste de reglas).*

## 7. Recomendación y Próximo Bloque
El lote de acciones (`MSFT`, `GOOGL`, `AMZN`) está completamente listo para proceder, habiéndose validado precios de calidad y métricas. Los ETFs (`EFA`, `EEM`) tienen precios de calidad pero requieren un vistazo rápido de identidad antes del write.

**Siguiente Bloque Recomendado:**
`7O-1 — Vanilla Batch Root/Listings Write Gate Preparation`
