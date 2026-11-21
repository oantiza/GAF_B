# BLOQUE 7O-0A: Vanilla Assets Batch Candidate Selection Dry-Run

## 1. Objetivo
Preparar una selección inicial de un pequeño "batch" (lote) de nuevos activos vanilla y representativos para escalar la base de datos de manera controlada, evitando activos complejos que introduzcan riesgos no previstos.

## 2. Contexto Estratégico
El objetivo es salir del ciclo individual o piloto de 1 solo activo, hacia un "batch" que permita probar la escalabilidad horizontal. 

### Activos en Review y Pospuestos:
- **GSPC.INDX (S&P 500 Index):** Posponiendo el write real por tratarse de un índice o proxy provisional, lo cual requiere una resolución final sobre cómo modelar índices puramente informativos vs sus representaciones invertibles (ETFs).
- **AAPU (Direxion Daily AAPL Bull 2X Shares):** Posponiendo debido a que es un ETF *single-stock* apalancado, lo cual es complejo y podría requerir flags especiales en el schema que todavía no están implementados.

## 3. Universo Candidato
El universo propuesto consiste en:
- `MSFT.US` (Stock, Mega-cap)
- `GOOGL.US` (Stock, Mega-cap)
- `AMZN.US` (Stock, Mega-cap)
- `EFA.US` (ETF Internacional Desarrollado)
- `EEM.US` (ETF Internacional Emergente)
- `VTI.US` (ETF USA Broad)
- `AGG.US` (ETF Renta Fija)
- `BND.US` (ETF Renta Fija)
- `GLD.US` (ETF Commodity Vanilla)
- `ACWI.US` (ETF Global)
- `GSPC.INDX` (Índice, incluido a propósito para validar exclusión)
- `AAPU.US` (ETF Apalancado Single-stock, incluido a propósito para validar exclusión)

## 4. Resultados de la Selección

### Candidatos Seleccionados (Límite: 5)
1. `MSFT.US`
2. `GOOGL.US`
3. `AMZN.US`
4. `EFA.US`
5. `EEM.US`

**Motivo:** Todos cumplen con ser de tipo STOCK o ETF clásico, sin apalancamiento, con identificadores fuertes y gran representatividad en el mercado.

### Candidatos Rechazados
1. `GSPC.INDX` - **Motivo:** Índice/Proxy provisional.
2. `AAPU.US` - **Motivo:** ETF complejo (apalancado, inverso o single-stock).

### Candidatos en Review (Por exceder límite)
- `VTI.US`, `AGG.US`, `BND.US`, `GLD.US`, `ACWI.US` 

## 5. Criterios de Exclusión (Risk Exclusions)
- `NO_LEVERAGED_ETF`
- `NO_INVERSE_ETF`
- `NO_SINGLE_STOCK_ETF`
- `NO_PROVISIONAL_INDEX`
- `MAX_5_CANDIDATES`

## 6. Confirmaciones de Seguridad
- **Firestore writes:** 0
- **Firestore deletes:** 0
- **FIRESTORE_REAL_WRITE_ENABLED:** FALSE
- **EODHD fundamentals usado:** NO (No se ha llamado al endpoint /fundamentals)
- **OpenFIGI live usado:** NO (Completamente offline para esta selección)
- **Modificación en BDB-FONDOS / BDB-FONDOS-CORE:** NO
- **Commit, Push, Deploy:** NO realizados, según las restricciones dadas.

## 7. Siguiente Bloque Recomendado
El siguiente bloque lógico tras aislar con éxito los candidatos es:
**`7O-0B — Vanilla Batch Prices/Identity Live Dry-Run`**

Este bloque continuará evaluando estos 5 candidatos en las APIs reales (EODHD, precios, sin openfigi live) para prepararlos hacia el write de listados e identidades, de nuevo sin writes en la BBDD.
