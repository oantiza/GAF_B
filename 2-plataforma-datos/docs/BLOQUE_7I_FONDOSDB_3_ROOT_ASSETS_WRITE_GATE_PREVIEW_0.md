# BLOQUE 7I-FONDOSDB-3: Root Assets Write Gate Preview 0

## Resumen Ejecutivo
Este documento certifica la preparación del *Write Gate Preview* para los *Root Assets* provenientes de la importación inicial de FondosDB. Se han generado los artefactos necesarios para la ejecución futura de una escritura real en Firestore, asegurando un entorno pre-evaluado y controlado.

## Selección y Filtrado
Se ha procesado el paquete `fondosdb_import_dryrun_0` obteniendo la siguiente distribución:
* **Seleccionados (ACCEPTED):** 405 activos.
* **Excluidos (REVIEW):** 91 activos.
* **Excluidos (REJECTED):** 0 activos.
* **Holdings (Excluidos totalmente):** 94.993 posiciones. No se incluyen en los root assets.

## Rutas Propuestas (Paths Preview)
Se escribirá en `assets/{asset_id}`.
* **Total de paths previstos:** 405.
Los documentos raíz han sido verificados para no contener `holdings` masivos, ni `price_series` ni métricas de precio de listing que no correspondan con su esquema original.

## Estrategia de Snapshot Readonly
Antes de la ejecución real, es obligatorio lanzar un snapshot readonly:
* **Estado actual:** `PENDING`.
* **Acción:** `PRE_WRITE_READONLY_SNAPSHOT`.
* **Estrategia:** Recuperar el documento existente de Firestore o verificar su ausencia para generar un hash base y detectar conflictos concurrentes en la futura escritura. 

## Diff Preview
El Diff preview indica:
* **Snapshot requerido:** Sí.
* **Current Firestore State:** `NOT_READ` (No se ha accedido a la DB real).
* **Proposed Create Count:** 405 (Asumiendo que no existen previamente; este número puede variar cuando el snapshot se ejecute).
* **Proposed Update Count:** `UNKNOWN_WITHOUT_SNAPSHOT`.
* **Política de conflictos:** `BLOCKED_UNTIL_READONLY_SNAPSHOT`.

## Plan de Rollback
Para cada documento, el plan de contingencia detalla:
* **Operación:** `pending_snapshot_diff`.
* **Acción de Rollback:** 
  * Si se creó nuevo -> `delete_if_created`.
  * Si ya existía -> `restore_previous_payload_if_updated`.

## Post-Write Verification Plan
Tras la futura escritura, el validador ejecutará:
1. `verify_document_exists`: Asegurar que el path se escribió correctamente.
2. `verify_schema_compliance`: Asegurar la compatibilidad estricta con la extensión del schema de FondosDB.
3. `verify_no_holdings_embedded`: Comprobar que no hay arreglos pesados de holdings ensuciando el nodo principal.

## Riesgos y Condiciones Necesarias para Write Real
* **Riesgos:** La falta de un snapshot en tiempo de escritura real podría sobrescribir modificaciones concurrentes de otros procesos. Los holdings han sido extraídos, si alguno de ellos fallara durante su futura inserción, el root asset no estaría alineado temporalmente.
* **Condiciones Necesarias:**
  * Credenciales activas con permisos de Firestore.
  * Bandera de seguridad global `FIRESTORE_REAL_WRITE_ENABLED` activada.
  * Ejecución exitosa del Snapshot Readonly previo a la transacción.
  * Aprobación explícita del usuario revisando `approval_manifest.json`.

## Confirmación de Seguridad
En la ejecución de este ciclo se certifica:
- Firestore Writes: 0
- Firestore Deletes: 0
- Base real writes: 0
- Colecciones/Bases externas tocadas: NO
- Deploy/Push/Commit/Internet: NO
- Paquete input modificado: NO
