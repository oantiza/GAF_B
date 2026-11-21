# BLOQUE 9C-C: OpenFIGI Enrichment Schema Shape Correction Gate

## 1. Objetivo
Preparar un *write gate* controlado (sin ejecución en vivo) para corregir la forma del esquema de los identificadores inyectados durante el bloque 9C. El objetivo es migrar los campos de nivel raíz que tienen dot-notation literal (ej. `"identifiers.figi": "BBG000..."`) a su forma nativa anidada (`identifiers: { figi: "BBG000..." }`), para restablecer el contrato de tipado en Firestore.

## 2. Roots Afectados
La corrección se ha pre-procesado exclusivamente para los 5 activos líderes enrutados previamente:
- `assets/EODHD_MSFT.US`
- `assets/EODHD_GOOGL.US`
- `assets/EODHD_AMZN.US`
- `assets/EODHD_EFA.US`
- `assets/EODHD_EEM.US`

## 3. Identificación de Campos (Flat -> Nested)
Durante la preparación, el script detectó y mapeó con éxito las claves planas y validó su inexistencia de conflictos con las anidadas.

**Campos a anidar:**
- `identifiers.figi`
- `identifiers.composite_figi`
- `identifiers.share_class_figi`
- `identifiers.openfigi_ticker`
- `identifiers.openfigi_exch_code`
- `identifiers.openfigi_mic_code`

**Claves planas a eliminar:**
Todas las anteriores, designadas con el marker interno `__DELETE__` (que la ejecución real de Firestore sustituirá por `FieldValue.delete()`).

## 4. Confirmaciones Estructurales
- **Nested Conflict Check:** Seguro. Los valores de `identifiers.*` existentes eran nulos, por lo que no existió conflicto destructivo al preparar el payload.
- **OpenFIGI Metadata:** `openfigi.validation_status`, `openfigi.source`, `identity_status` y demás no sufrieron modificaciones y permanecerán intactos en la ejecución.
- **Subcollections Untouched:** El *real write plan* y *forbidden paths* mantienen el rigor absoluto. Las `listings`, `price_series`, y `metrics` están excluidas de la operación y el gate operará sólo sobre el document reference root en modo `UPDATE_ONLY`.

## 5. Pruebas y Auditorías
El entorno de pruebas responde en `PASS` absoluto:
- **npm test:** 309 tests exitosos en 63 suites.
- **Validación del Gate:** `READY_LOCKED_FOR_USER_AUTHORIZATION` tras `npm run firestore:openfigi-schema-shape-correction-gate`.

## 6. Artifacts de Cierre Generados
Disponibles en `artifacts/openfigi_schema_shape_correction_gate_0/`:
- `pre_correction_snapshot.json`
- `flat_fields_detected.json`
- `nested_conflict_check.json`
- `correction_payload_candidates.json`
- `field_level_diff_preview.json`
- `rollback_manifest.json` (Captura el estado plano inicial).
- `real_write_plan.json` (Gate ID: `firestore_openfigi_schema_shape_correction_0`).

## 7. Estado Final
**READY_LOCKED_FOR_USER_AUTHORIZATION**. El plan de migración in-place de la estructura plana a anidada de OpenFIGI está preparado y bloqueado por seguridad.

## Siguiente Paso Recomendado
**Ejecutar el Bloque 9C-D** (OpenFIGI Enrichment Schema Shape Correction Real Write). Activar localmente `FIRESTORE_REAL_WRITE_ENABLED=true` y correr el script ejecutor, para finalmente asentar este cambio estructural en Firestore.
