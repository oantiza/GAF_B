# `contracts/` - Fuente de verdad del esquema

*Creado 2026-06-28. Actualizado 2026-11-21, al borrar los contratos de la maestra vieja.*

Este directorio es la **fuente de verdad** de la forma de los datos. La plataforma escribe la base nueva validando
contra `base-nueva/`; el extractor guarda una copia de `canonical/` en `1-extractor/contracts_cache/`, y las Functions,
una de `read/` en `3-BDB-ACTIVOS_app/functions_python/contracts_cache/`.

## Capas

```text
contracts/
├── canonical/   salida del extractor = entrada de la plataforma
├── base-nueva/  forma persistida en la base nueva (bdb-gestor-de-activos); su README la explica
└── read/        la forma de lectura que el servidor da a la app
```

## Catálogo vigente

| Contrato | Ruta / uso | Quién lo lee |
|---|---|---|
| `canonical/fondosdb-fund.v1` | `export_bdb/{ISIN}.json` para fondos | el extractor (`core/contratos.py`, copia en `contracts_cache`) |
| `canonical/fondosdb-stock.v1` | `export_bdb/{ISIN}.json` para acciones | ídem |
| `canonical/fondosdb-holdings.v1` | holdings del extractor (`procedencia` opcional por línea desde el 14-10-2026) | ídem |
| `base-nueva/*.v2` | `instruments/…`, `computed/…`, carteras, planes y el resto de la base nueva | la plataforma (`src/config/baseNueva/validadores.ts`, `src/loader/baseNuevaWriter.ts`) |
| `read/asset-for-bdb.v1` | payload de lectura que las Functions dan a la app (decisión A-203) | las Functions, por su `contracts_cache` (`npm run check:contracts` de la app) |

**`master/` ya no existe.** Eran los contratos de la maestra vieja (`assets/…`, `metrics/latest`, `meta/search_index`)
contra los que validaba el cargador heredado; se borraron con él el 21-11-2026 (decisión 36, censo
`CENSO_BASE_VIEJA_2026-11-21.md` de la raíz), y la caché de las Functions dejó de copiarlos. El estado anterior está en
la etiqueta de Git `referencia-base-vieja-2026-11-21`.

## Dos artefactos de export del extractor

El extractor produce dos familias de salida, y el mapper de la base nueva (`src/ingestion/baseNueva/mapper.ts`) lee
las dos para cada activo. Importa no mezclarlas:

- **Canónico BDB:** `export_bdb/{ISIN}.json`. La forma normalizada, campos `ms.*` y señales de calidad; valida contra
  `canonical/`.
- **Universal ES:** `export/*.ndjson`, especialmente `export/fondos.ndjson`. La salida universal en español con
  bloques como `riesgo`, `rentabilidad` y otros passthroughs. La app no la consume directamente.

## Política de versionado

- `v1` describe forma existente; `v1.1` añade campos compatibles.
- Un cambio incompatible exige versión nueva, nunca editar silenciosamente un contrato vigente.
- `schema_version` y `updated_at` son metadata de contrato cuando el schema los define.
- Fechas/hora persistidas como string: ISO-8601 UTC con sufijo `Z`.
- Fechas puras: `YYYY-MM-DD`.

## Gate de escritura

El escritor de la base nueva (`src/loader/baseNuevaWriter.ts`) solo escribe con:

```text
BDB_DATA_PLATFORM_ENABLE_MASTER_WRITES=YES_I_UNDERSTAND_MASTER_DB_WRITES
```

Sin ese gate, cualquier `--write` aborta. El resto de sus barreras (destino fijo, emulador impuesto, forma y dueño)
están en la cabecera de ese fichero.
