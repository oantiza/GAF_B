# Bloque 23A — Firestore Partial Assets Review

## Objetivo
Identificar, clasificar y decidir el tratamiento seguro para los 2 activos clasificados como `PARTIAL` en la cobertura real de Firestore, sin realizar escrituras.

---

## 1. Contexto de Cobertura de Firestore
Tras el bloque 22A, la cobertura de activos en la base de datos es:
- **Target Assets**: 425
- **Complete**: 19
- **Root Only**: 404
- **Partial**: 2
- **Missing**: 0

---

## 2. Identificación de los 2 PARTIAL Assets
La ejecución live read-only devolvió `BLOCKED_SAFE_READONLY_UNAVAILABLE` para proteger el entorno y prevenir accesos sin credenciales explícitas en el CI/entorno de ejecución actual.
Sin embargo, gracias al historial del proyecto (artifacts del bloque 12C), se pudo inferir y confirmar la identidad de los 2 activos parciales restantes:

| Asset ID | Ticker / Identity | Tipo | Causa | Faltante |
|---|---|---|---|---|
| **`US25461A8743`** | AAPU (Direxion AAPL Bull 1.5X) | Leveraged ETF | `LEGACY_PILOT_PARTIAL` | `price_series`, `metrics/latest` |
| **`EODHD:GSPC.INDX`** | GSPC (S&P 500 Index) | Benchmark Index | `LEGACY_PILOT_PARTIAL` | `price_series`, `metrics/latest` |

---

## 3. Justificación y Análisis de Riesgos

### AAPU (Leveraged ETF)
* **¿Por qué es Partial?** Se cargaron sus metadatos (root y listing) como piloto, pero carece de un modelo de riesgo validado para ETFs apalancados.
* **Riesgo de forzar completado**: Alto. Aplicar el pipeline estándar de Equity a un ETF apalancado generaría métricas distorsionadas.
* **Decisión**: **COMPLETE_LATER**.

### GSPC (Benchmark Index)
* **¿Por qué es Partial?** Se cargaron sus metadatos (root y listing), pero los índices carecen de fundamentales estándar como capitalización bursátil accionarial o dividendos regulares.
* **Riesgo de forzar completado**: Alto. Requeriría bypasear validaciones de esquema estrictas que hoy protegen los tipos numéricos.
* **Decisión**: **COMPLETE_LATER**.

Ambos activos están actualmente aislados y no bloquean el flujo de FondosDB ni los read models.

---

## 4. Confirmación de Reglas de Seguridad
- **Firestore Writes**: 0
- **Firestore Deletes**: 0
- **FIRESTORE_REAL_WRITE_ENABLED**: NO
- **Commits / Push / Deploy**: NO
- **Credentials**: NO impresas ni expuestas (Safe Blocked exitoso).

---

## 5. Siguiente Bloque Recomendado
El sistema se encuentra en un estado limpio, seguro y auditado.
Se recomienda proceder al siguiente bloque lógico del roadmap para continuar la ingestión o validación de los modelos funcionales, dejando estos 2 activos catalogados para un bloque futuro ("Specialized Asset Contracts").
