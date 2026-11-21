# Encargo a Codex — 70G · Audit de consistencia maestra vs canónico (READ-ONLY)

**Repo:** `C:\Users\oanti\Documents\BBDD-ACTIVOS-FINANCIEROS`. Verificación de integridad (F3). **No escribe nada, no usa gate.**

```bash
npm run audit:consistency -- --input "C:\Users\oanti\Proyectos\DATOS FONDOS\fondosdb" --ids all
```

- Requiere `FIREBASE_PROJECT_ID` + credenciales de **solo lectura**. **NO** definas `BDB_DATA_PLATFORM_ENABLE_MASTER_WRITES` (el script aborta si está activo).
- Para cada activo de la maestra, re-mapea su canónico con el mismo mapper V1 y compara **solo los campos del mapper** (ignora listings/metrics/price_series y los aditivos schema_version/updated_at). 0 escrituras.

## Qué devolver
De `runs/audit_<id>/audit_summary.json`: `checked / matched / drifted / live_missing / no_canonical` y `drift_by_top_field`. Y 4-5 ejemplos de `drifts.json`.

## Cómo lo interpreto yo (Claude) — contexto
- Los **265 recién cargados** deberían dar `matched` (los escribimos desde este mismo mapper).
- Los **~479 antiguos** pueden mostrar **drift esperado**: el `python main.py bdb` del 70E regeneró el canónico con fecha 2026-06-28, mientras esos docs se cargaron desde el canónico del 22-jun. Por tanto:
  - drift en `source_metadata.generated_at/report_date` = normal (la maestra se cargó antes).
  - drift en campos sustantivos (`classification`, `product`, `costs`, `portfolio_exposure`, `fixed_income_profile`, `identity`) = la maestra está **desactualizada** respecto a Morningstar actual (señal de "a refrescar"), NO corrupción.
- O sea, el audit es a la vez **prueba de integridad** (de los nuevos) y **informe de obsolescencia** (de los viejos). Tú solo corre y trae los números; la lectura la hago yo.
