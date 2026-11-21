# Encargo a Codex — 70C · Primera escritura real: piloto de 3 → luego los 78 de RF

**Modelo:** Codex GPT-5.5 alto · **Repo:** `C:\Users\oanti\Documents\BBDD-ACTIVOS-FINANCIEROS`
**Autorizado por el usuario:** piloto de 3 ETF limpios, y carga de los 78 de RF (con `--include-review`), reteniendo 13.

El cargador ya compila y los dry-runs salieron limpios (`INVALID_CONTRACT=0`). Estas son **escrituras reales create-only** (nunca sobrescriben; los 479 existentes están protegidos). Gate de plataforma obligatorio.

## Paso 1 — PILOTO de 3 (iShares Core S&P 500 + 2 VanEck)

```bash
BDB_DATA_PLATFORM_ENABLE_MASTER_WRITES=YES_I_UNDERSTAND_MASTER_DB_WRITES \
  npm run load:fondosdb -- --input "C:\Users\oanti\Proyectos\DATOS FONDOS\fondosdb" \
  --ids missing --targets root,holdings --write
```

- Crea **solo los 3** que faltan y están limpios (los 91 REVIEW quedan fuera sin `--include-review`).
- Revisa `runs/loader_<id>/write_summary.json`. **Esperado:** `writes_executed` ≈ 6 (3 root + 3 holdings/latest de 10 posiciones), `skipped_existing` 0, `postverify_ok` **3/3**, `errors` 0.
- **REGLA DE PARADA:** si `postverify_ok != 3` o hay `errors`, **PARA y reporta**. No sigas al Paso 2.

## Paso 2 — los 78 de RF (solo si el Paso 1 salió 3/3 limpio)

```bash
BDB_DATA_PLATFORM_ENABLE_MASTER_WRITES=YES_I_UNDERSTAND_MASTER_DB_WRITES \
  npm run load:fondosdb -- --input "C:\Users\oanti\Proyectos\DATOS FONDOS\fondosdb" \
  --ids loader_lists/cargar_78_rf.txt --include-review --targets root,holdings --write
```

- `loader_lists/cargar_78_rf.txt` (78 ISIN de RF incompleta) ya está en el repo. `--include-review` los convierte en CREATE.
- Los **13 retenidos** (`loader_lists/retener_13_investigar.txt`: asignación sospechosa + 1 sintético) NO se cargan: no están en la lista.
- **Esperado:** ~78 root creados + sus holdings. Algunos fondos de RF tienen carteras grandes; si una cartera supera el límite de documento único, el writer la marca `CHUNK_REQUIRED` y **omite solo ese holdings** (el root sí se crea) — eso es correcto, repórtalo pero no es un fallo.
- Revisa `write_summary.json`: `writes_executed`, `skipped_existing`, `postverify_ok`, `errors` (lista los `CHUNK_REQUIRED` aparte).

## Reglas
- Gate `BDB_DATA_PLATFORM_ENABLE_MASTER_WRITES` SOLO en estas dos órdenes. Create-only. **Sin deletes. Sin deploy.** No tocar los 13 retenidos ni los scripts legacy.
- No imprimir secretos/credenciales.

## Qué devolver
- De cada paso: la ruta `runs/<id>/`, y de `write_summary.json` los campos `writes_executed / skipped_existing / postverify_ok / postverify_failed / errors`.
- Confirmar que la maestra pasa de **479** a **482** (tras piloto) y luego a **~560** (tras los 78).

## Después (no en este encargo)
- Smoke en la app: que los 3 ETF y algunos de los 78 aparezcan y se abran.
- Investigar los 13 retenidos (asignación que no cuadra) — Claude lo dirige.
- Re-export de fondosdb para los ~184 sin canónico (los "183").
