# BLOQUE 26A — Master Status Snapshot & Consumer Platform Closeout

**Fecha:** 18 de junio de 2026
**Estado:** COMPLETO (Snapshot Documental)

## 1. Resumen de Fase Cerrada
El proyecto BBDD-ACTIVOS-FINANCIEROS ha consolidado su transición de un pipeline de ingesta a una **Plataforma de Datos Financieros con capa pública de consumo**.

Los siguientes hitos han sido cerrados e integrados en `master`:
- **FondosDB Roots & Holdings:** Ingesta inicial cerrada y verificada sin phantom parents.
- **Coverage Semantics Refinement (23B):** Distinción formal de estados de hidratación (`COMPLETE_FUND`, `PARTIAL_MARKET_ASSET`, etc.).
- **Unified Query Layer Preview (23C):** Lógica consolidada de lectura y abstracción de fragmentación de holdings.
- **Firestore-Friendly Search Layer Preview (23D):** Búsqueda de activos controlada (sin motores externos) con discriminación de coste.
- **Public Contracts v1 (24B):** Contratos estables para consumidores (e.g., `PublicFundOverview`, `PublicMarketAssetOverview`).
- **Cost & Performance Guardrails (25A):** Políticas de control de lecturas y baseline de capacidad (1,250 activos como escenario direccional conservador).

## 2. Estado del Repositorio
- **Rama actual:** `master` (alineada con `origin/master` en el commit de Guardrails de Coste).
- **Working Tree:** Limpio.
- **Artifacts:** Excluidos del tracking de git permanentemente.
- **Sanidad:** `npm run typecheck` y `npm test` limpios (cobertura total de test unitarios para modelos de lectura y contratos).
- **Seguridad Firestore:** Escrituras y borrados a 0. `FIRESTORE_REAL_WRITE_ENABLED` inactivo.
- **Aislamiento:** Cero impacto en repositorios de consumidores (BDB-FONDOS, NUVIA).

## 3. Arquitectura Establecida
La base de datos opera ahora bajo un paradigma de **lectura protegida**:
- **Consumidores:** No pueden acceder directamente a las colecciones crudas de Firestore. Deben usar los `Public Contracts v1` a través de la Query Layer.
- **Guardrails de Coste:** Se aplican clasificaciones de riesgo (`LOW RISK`, `MEDIUM RISK`, `HIGH RISK`, `BLOCKED`) que operan como controles direccionales.
- **Estrategia de Almacenamiento:** Consolidada a `price_series/yearly/{YYYY}`. Documentos diarios quedan prohibidos.
- **Visión:** La infraestructura actual en Firestore se considera el baseline operativo. Los guardrails previenen la facturación excesiva sin introducir sobreingeniería. Si los requisitos superan este baseline en el futuro, se contempla migrar la capa de consultas intensivas hacia otra tecnología (como PostgreSQL o motores de búsqueda), pero se evita esta complejidad en la fase de hoy.

## 4. Próximos Pasos Recomendados

A continuación se delinean los siguientes bloques lógicos de evolución técnica de la plataforma:

- **26B — Consumer Integration Mock Preview:**
  - *Objetivo:* Simular cómo aplicaciones consumidoras (NUVIA, BDB-FONDOS) utilizarían los `Public Contracts` de BBDD-ACTIVOS-FINANCIEROS en sus workflows sin tocar esos repositorios reales, validando la ergonomía de la API interna.
- **26C — Public API / Package Boundary Review:**
  - *Objetivo:* Definir si las capas de lectura/búsqueda se deben empaquetar como una librería interna compartida (e.g., paquete npm privado) u otro tipo de frontera (REST/Gateway).
- **27A — Next Data Expansion Plan:**
  - *Objetivo:* Planificar la cobertura de nuevos tipos de activos (ETFs, índices, stocks) e historificación, garantizando que entran dentro del presupuesto definido por los guardrails de coste.
- **27B — Historical Price Series Storage Preview:**
  - *Objetivo:* Diseñar el flujo de escritura que agrupará de manera eficiente las observaciones de precios en el formato recomendado `price_series/yearly/{YYYY}` desde el proveedor (EODHD), realizando una preview en dry-run.
