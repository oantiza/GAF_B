# BLOQUE 7I-FONDOSDB-5 - Root Assets Field Diff

## Resumen ejecutivo

Se ejecuto diff field-by-field para el unico root existente detectado en el snapshot readonly:

- Asset existente: `assets/IE00B4L5Y983`
- Diff ejecutado: `true`
- Conflict status: `BLOCKING_CONFLICT`
- Recommended resolution: `BLOCK_UPDATE`
- Write gate real ready: `false`

El bloqueo viene de un campo propuesto `listings` dentro del root. Aunque el array propuesto esta vacio, la regla del bloque es no crear listings en root assets. El write real sigue bloqueado hasta resolver/ignorar ese campo y revisar manualmente el resto de diferencias sensibles.

## Inputs utilizados

Desde `artifacts/fondosdb_root_assets_write_gate_preview_0/`:

- `selected_assets_manifest.json`
- `write_plan_preview.json`
- `approval_manifest.json`
- `safety_check_summary.json`

Desde `artifacts/fondosdb_root_assets_readonly_snapshot_0/`:

- `readonly_snapshot_summary.json`
- `readonly_snapshot_records.ndjson`
- `existing_assets_manifest.json`
- `conflict_detection_report.json`
- `diff_readiness_report.json`
- `rollback_readiness_report.json`
- `safety_check_summary.json`

Payload propuesto:

- `artifacts/fondosdb_import_dryrun_0/normalized_assets.ndjson`
- Asset: `IE00B4L5Y983`

Payload existente:

- Lectura readonly segura y unica de `assets/IE00B4L5Y983`.
- No se leyeron otros paths para el diff.

## Precondiciones validadas

- Existing assets: `1`
- Existing asset: `assets/IE00B4L5Y983`
- Missing assets: `404`
- Read errors: `0`
- Invalid paths: `0`
- Duplicate paths: `0`
- `approval_manifest.can_write = false`
- `approval_manifest.authorized = false`
- `approval_manifest.preview_only = true`
- `holdings_included = false`
- `proposed_paths_count = 405`

## Diff field-by-field

Resumen cuantitativo:

- Same fields count: `5`
- Proposed additions count: `184`
- Existing only count: `10`
- Changed fields count: `1`
- Blocking conflicts count: `1`
- Manual review fields count: `14`
- Safe enrichment fields count: `170`

Hashes:

- Existing payload hash: `1901cf574775cd5cf0813f3044c45579d7bcf388b4a099197564567260b09a07`
- Snapshot hash: `1901cf574775cd5cf0813f3044c45579d7bcf388b4a099197564567260b09a07`
- Proposed payload hash: `823049a9805b119a140b1f4a9488206a85e98798bf05db5903d19ad5044c0229`

## Campo bloqueante

- `listings`
- Diff type: `PROPOSED_ADDITION`
- Existing: `undefined`
- Proposed: `array(length=0)`
- Risk: `BLOCKING`
- Recommended action: `BLOCK_WRITE`

Motivo: las reglas del bloque impiden crear `listings` dentro del root asset. Debe eliminarse/ignorarse del payload root antes de cualquier write futuro.

## Campos que requieren revision manual

Campos principales:

- `classification.asset_class`
- `classification.asset_subtype`
- `classification.confidence`
- `classification.fondosdb_asset_class`
- `classification.fondosdb_asset_type`
- `classification.region_primary`
- `classification.strategy_tags`
- `product.fund_name`
- `source_metadata.firestore_preview_only`
- `source_metadata.generated_at`
- `source_metadata.report_date`
- `source_metadata.source`
- `source_metadata.source_file`
- `source_metadata.universal_export_present`

El unico cambio directo de valor es:

- `classification.asset_class`: `null` -> `"RV"`

## Campos existentes protegidos

Hay 10 campos presentes solo en Firestore que no deben perderse:

- `currency.base_currency`
- `eodhd_fundamentals_used`
- `eodhd_live_used_in_this_block`
- `identifiers.eodhd_code`
- `openfigi_live_used`
- `source_artifact`
- `source_mode`
- `sources.primary_source`
- `write_gate_id`
- `write_gate_status`

Tambien se protegen campos iguales/criticos como `asset_id`, `asset_type`, `identifiers.isin`, `identity.currency` e `identity.name`.

## Enriquecimiento seguro

Se detectan `170` campos de enriquecimiento seguro, principalmente en:

- `costs`
- `fixed_income_profile`
- `performance`
- `portfolio_exposure`
- `quality`
- `risk`
- `sustainability`

Estos campos pueden considerarse candidatos de merge futuro, pero no habilitan write real mientras exista el bloqueo por `listings` y revision manual pendiente.

## Propuesta de resolucion

- `recommended_resolution`: `BLOCK_UPDATE`
- `can_auto_merge`: `false`
- `can_write_without_manual_review`: `false`
- `requires_manual_review`: `true`
- `requires_user_authorization_before_write`: `true`

Para desbloquear un bloque posterior:

1. Excluir `listings` del root payload de FondosDB.
2. Mantener los campos existentes protegidos.
3. Revisar manualmente `classification`, `product.fund_name` y `source_metadata`.
4. Decidir si los 170 campos seguros se aceptan como enriquecimiento.
5. Crear un nuevo approval manifest en un bloque posterior, con autorizacion explicita.

## Readiness global 405 roots

- `total_proposed_paths`: `405`
- `create_candidates`: `404`
- `existing_candidates`: `1`
- `existing_safe_to_update_count`: `0`
- `existing_review_required_count`: `0`
- `existing_blocking_conflict_count`: `1`
- `write_gate_real_ready`: `false`
- `reason`: `BLOCKING_CONFLICT`

## Rollback readiness

Para `assets/IE00B4L5Y983`:

- `operation_if_written`: `blocked`
- `rollback_action`: `restore_previous_payload_if_updated`
- `previous_payload_hash`: `1901cf574775cd5cf0813f3044c45579d7bcf388b4a099197564567260b09a07`
- `previous_payload_available`: `true`
- `requires_pre_write_snapshot`: `true`
- `pre_write_snapshot_available`: `true`

Para los 404 missing:

- `operation_if_written`: `create`
- `rollback_action`: `delete_if_created`
- `requires_pre_write_snapshot`: `true`
- `pre_write_snapshot_available`: `true`

## Artefactos generados

Carpeta: `artifacts/fondosdb_root_assets_field_diff_0/`

- `field_diff_summary.json`
- `existing_asset_diff_IE00B4L5Y983.json`
- `existing_asset_diff_IE00B4L5Y983.md`
- `conflict_resolution_preview.json`
- `global_write_readiness_after_diff.json`
- `rollback_readiness_after_diff.json`
- `blocked_fields_manifest.json`
- `manual_review_fields_manifest.json`
- `safe_enrichment_fields_manifest.json`
- `safety_check_summary.json`
- `next_step_recommendation.json`
- `field_diff_summary.md`

## Riesgos

- `listings` debe salir del root payload antes de cualquier write.
- Hay source metadata nuevo que debe revisarse para no borrar trazabilidad previa.
- Hay campos existentes procedentes del piloto IWDA que deben conservarse.
- El snapshot representa el estado leido en este bloque; si Firestore cambia, debe refrescarse antes de escribir.

## Confirmacion de seguridad

- Firestore writes: `0`
- Firestore deletes: `0`
- Base real writes: `0`
- BDB-FONDOS tocado: `NO`
- BDB-FONDOS-CORE tocado: `NO`
- Deploy: `NO`
- Push: `NO`
- Commit: `NO`
- Credenciales nuevas usadas: `NO`
- Paquete input modificado: `NO`
- Holdings incluidos: `NO`
