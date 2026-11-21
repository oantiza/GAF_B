# Gobierno de datos activos y artefactos heredados

Fecha de entrada en vigor: 2026-07-10.

## Poblacion activa

Un activo pertenece a la poblacion activa cuando su identificador de documento es un ISIN canonico y `quality.status` no es `ARCHIVED_LEGACY`.

Para cada activo activo son contractuales y forman parte del SLA:

- el documento raiz, validado por el contrato de fondo, accion o activo de mercado EODHD que corresponda;
- todos los documentos `price_series`, actualmente en `asset-price-series.v1.2`;
- `metrics/latest`, validado por `metrics.v1.1`;
- su entrada unica en `meta/search_index`.

La aplicacion consume el bloque de listings embebido en la raiz y `metrics/latest`. No consume documentos de metricas con otro id ni listings auxiliares de antiguos pilotos.

## Artefactos heredados

Se consideran artefactos heredados, fuera del SLA activo pero sujetos a copia y trazabilidad:

- raices sin ISIN archivadas en `_archived_assets`;
- documentos `metrics/{id}` donde `id != latest` procedentes de pilotos o copias anteriores;
- listings auxiliares con campos `write_gate_*`, `_metadata` o forma de pilotos anteriores;
- holdings o chunks con `quality.status == ORPHANED_LEGACY`.

Estos documentos son de solo lectura. No deben alimentar busqueda, informes, optimizacion ni calculos actuales. No se borran automaticamente. Su retirada requiere inventario, copia restaurable, plan de borrado separado y aprobacion explicita.

## Retrocesiones sin referencia

Los registros de `commercial_retro` cuyo ISIN no existe ni en `assets` ni en `_archived_assets` se conservan como historial comercial inerte. No se aplican a ninguna cartera porque la resolucion parte siempre de un activo existente.

Politica:

1. no crear nuevas retrocesiones para ISIN inexistentes;
2. mostrar y revisar los huerfanos en la conciliacion periodica;
3. reactivar su efecto automaticamente si el mismo ISIN vuelve a darse de alta;
4. no borrarlos ni modificar su porcentaje sin decision comercial documentada.

## Controles operativos

- `meta/search_index` se actualiza en cada alta administrativa y se reconstruye a diario.
- El refresco de drawdown usa cursor persistente por activo y declara si completa el ciclo.
- Las migraciones de contrato son dry-run por defecto, validan el payload completo y requieren aprobacion explicita para escribir.
- Firestore mantiene PITR, proteccion de borrado, backup diario y backup semanal.
- La copia local integral incluye todas las colecciones, subcolecciones y usuarios de Auth, con SHA-256 y restauracion en emulador.

## Criterio de cierre

Una auditoria se considera conforme cuando la poblacion activa valida al 100%. Los artefactos heredados se reportan por separado como excepciones formales y nunca se mezclan con incidencias activas.
