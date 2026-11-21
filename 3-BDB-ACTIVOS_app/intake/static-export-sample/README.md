# Static export sample intake

Esta carpeta es una zona local de intake para snapshots JSON copiados de forma controlada.

- `example-input.json` es una muestra pequena versionada para ejecutar el preview sin datos externos.
- Cualquier otro archivo copiado en esta carpeta queda ignorado por Git.
- No se debe versionar el snapshot completo salvo autorizacion expresa.
- El script de intake funciona en dry-run por defecto y solo escribe si se usa `--write`.
- Tambien se acepta el export oficial `Asset*ForBdb` con `schema_version: "asset-for-bdb.v1"`, producido por BBDD-ACTIVOS-FINANCIEROS.

## Flujo seguro

1. Copiar aqui un snapshot JSON revisado y pequeno.
2. Ejecutar preview sin escritura:

```text
npm run preview:static-export-sample -- --input intake/static-export-sample/<snapshot>.json
```

3. Si el preview es correcto, generar el archivo paralelo:

```text
npm run write:static-export-sample -- --input intake/static-export-sample/<snapshot>.json
```

4. Revisar el diff contra la muestra estable consumida por la app:

```text
npm run diff:static-export-sample
```

5. Promover solo si el diff se acepta:

```text
npm run promote:static-export-sample
```

La app sigue importando `src/data/bbddActivosStaticExportSample.ts`. El archivo `.generated.ts` es solo un artefacto de revision, queda ignorado por Git y no debe commitearse. La promocion valida que el generado existe, no sale del workspace, mantiene FUND/ETF/STOCK/INDEX, conserva INDEX como benchmark y respeta los limites de tamano del intake.

## Export oficial AssetForBdb

Para probar el export oficial, copiar manualmente el JSON revisado desde el repo
maestro a esta carpeta, por ejemplo:

```text
intake/static-export-sample/bdb-assets-for-bdb.preview.json
```

Ese archivo queda ignorado por Git. El intake valida:

- manifest `asset-for-bdb.v1`
- conteos por `FUND`, `ETF`, `STOCK` e `INDEX`
- politica `SUMMARY_ONLY` para holdings y `EXCLUDED` para historicos completos
- `runtime_imports: "NONE"` y lecturas/escrituras externas a cero
- `INDEX` como `BENCHMARK` no invertible
- `STOCK` sin costes obligatorios
