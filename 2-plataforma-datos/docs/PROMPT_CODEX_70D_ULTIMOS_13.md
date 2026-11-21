# Encargo a Codex — 70D · Cargar los últimos 13 (completa el canónico 573/573)

**Repo:** `C:\Users\oanti\Documents\BBDD-ACTIVOS-FINANCIEROS` · **Autorizado por el usuario.**

Diagnóstico hecho (Claude): los 13 retenidos NO tienen dato corrupto — 3 son falsos positivos (asignación suma 100; Carmignac Patrimoine, Carmignac Emerging, Invesco S&P 500) y 10 son multiactivo/apalancados cuya asignación suma <100 legítimamente (cash negativo = derivados/apalancamiento). Se cargan.

```bash
BDB_DATA_PLATFORM_ENABLE_MASTER_WRITES=YES_I_UNDERSTAND_MASTER_DB_WRITES \
  npm run load:fondosdb -- --input "C:\Users\oanti\Proyectos\DATOS FONDOS\fondosdb" \
  --ids loader_lists/retener_13_investigar.txt --include-review --targets root,holdings --write
```

- `--include-review` los convierte en CREATE (todos están en REVIEW). Los 13 están todos ausentes en la maestra → 13 CREATE.
- **Esperado:** ~26 docs (13 root + 13 holdings), `postverify_ok` **13/13**, `errors` 0. Si alguna cartera grande da `CHUNK_REQUIRED`, el root se crea igual (repórtalo).
- **Confirmación final** (read-only): `npm run load:fondosdb -- --input "<dir>" --ids all` → debe dar `SKIP_EXISTS: 573`, `CREATE: 0`, `REVIEW_HOLD: 0`. La maestra pasa de **560 → 573**.

## Reglas
Gate solo en esta orden. Create-only. Sin deletes/deploy. No imprimir secretos.

## Devolver
`runs/<id>/write_summary.json`: `writes_executed / postverify_ok / errors`, y el `counts` del `--ids all` final.
