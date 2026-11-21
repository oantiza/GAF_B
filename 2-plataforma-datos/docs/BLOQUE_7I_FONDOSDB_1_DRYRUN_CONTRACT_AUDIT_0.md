# BLOQUE 7I FONDOSDB 1 - DRY-RUN CONTRACT AUDIT 0

Fecha: 2026-06-12

## Resumen ejecutivo

Se audito contractualmente el dry-run local FondosDB -> BBDD-ACTIVOS generado en `artifacts/fondosdb_import_dryrun_0`.

Resultado: el dry-run es valido como contrato de normalizacion y revision previa. No esta listo todavia para un write real directo, pero si esta listo para disenar el siguiente bloque de write gate con snapshot previo, schema extension formal y reglas explicitas de inclusion/exclusion.

No se detectaron falsos `ACCEPTED` por minimos de root. Los `ACCEPTED` cumplen asset_id por ISIN, identificador ISIN, nombre, tipo soportado por el schema actual y ausencia de listings inventados. Tampoco se detectaron `price_series`, `metrics_latest` ni holdings masivos dentro del root del asset.

## Artefactos revisados

- `manifest_validation.json`
- `normalized_assets.ndjson`
- `normalized_holdings.ndjson`
- `rejected_assets.ndjson`
- `warnings.ndjson`
- `field_mapping_report.md`
- `import_summary.md`
- `quality_summary.json`
- `duplicate_report.json`
- `firestore_paths_preview.json`
- `safety_check_summary.json`

## Conteos auditados

- Assets normalizados: 496
- `ACCEPTED`: 405
- `REVIEW`: 91
- `REJECTED`: 0
- Holdings separados: 94,993
- Fondos con holdings: 495
- Max holdings en un fondo: 10,000 (`IE00B18GC888`)
- Fondos RF: 120
- Con YTW distribution: 185
- Con maturity buckets: 298
- SFDR null/blanco: 496
- Sin listing: 496
- Duplicados por ISIN: 0
- Warnings emitidos: 148

Tipos normalizados en el schema actual:

- `FUND`: 490
- `ETF`: 5
- `OTHER`: 1

Tipos de producto enriquecidos:

- `fund`: 484
- `money_market_fund`: 6
- `ETF`: 5
- `ETC`: 1

Nota contractual: el schema actual de `Asset.asset_type` solo admite `FUND`, `ETF`, `STOCK`, `INDEX`, `OTHER`, `UNKNOWN`. Por eso RF y monetarios quedan como `FUND` en el root y se distinguen en `product.product_type`, `classification.fondosdb_asset_type` y `fixed_income_profile`. El ETC queda como `OTHER` en root y `product.product_type = ETC`.

## Auditoria de ACCEPTED

Se auditaron los 405 `ACCEPTED`.

Checks:

- Fallos de minimos de root: 0
- Fallos `asset_id !== identifiers.isin`: 0
- Assets con listings inventados: 0
- Assets con `price_series`: 0
- Assets con `metrics_latest`: 0
- Assets con holdings dentro del root: 0
- Falsos `ACCEPTED` detectados: 0

Conclusion: los `ACCEPTED` son aptos para pasar a una fase de write-gate design, siempre que el write gate no escriba todavia y valide snapshot/diff antes de cualquier persistencia real.

## Auditoria de REVIEW

Se auditaron los 91 `REVIEW`.

Clasificacion:

- REVIEW leve: 22
- REVIEW alto: 69

Causas principales:

- RF critica sin duracion, yield o calidad crediticia completa: 52
- Fondos problematicos con `rf_sin_duracion`, `rf_sin_yield`, `rf_sin_calidad_crediticia` e `info_pesos_negativos`: 40
- Fondos problematicos con `rf_sin_duracion`, `rf_sin_yield`, `rf_sin_calidad_crediticia`: 22
- Calidad BAJO: 10
- Fondos con combinaciones de `asignacion_activos_sospechosa`, `posiciones_sin_identificador_alto` e `info_pesos_negativos`: casos minoritarios

Interpretacion:

- Los 22 REVIEW leves podrian pasar a `ACCEPTED` tras ajustar reglas si se decide que ciertos flags informativos no deben bloquear escritura inicial.
- Los 69 REVIEW altos deben mantenerse en `REVIEW` antes de cualquier write real.
- No se recomienda modificar estados en este bloque: las reglas son conservadoras y no hay bug evidente.

## Auditoria de holdings

Los 94,993 holdings estan fuera del root de los assets en `normalized_holdings.ndjson`.

Checks:

- Holdings dentro del root: 0
- Max bytes aproximados por asset root: 6,324
- Bytes promedio por asset root: 5,515
- Max bytes aproximados por holding document: 517
- Bytes promedio por holding document: 417

Riesgo de documentos grandes:

- Bajo para el root del asset, porque no contiene posiciones masivas.
- Bajo por documento de holding individual.
- Alto a nivel operativo si se hiciera un write masivo sin batch controlado, porque 94,993 documentos requieren paginacion, throttling, idempotencia y recovery.

Contrato recomendado para holdings:

```text
assets/{asset_id}/holdings/{holding_id}
```

Campos recomendados por holding:

- `asset_id`
- `source_fund_isin`
- `holding_id`
- `as_of_date`
- `name`
- `identifiers.isin`
- `identifiers.ticker`
- `holding_type`
- `weight_pct`
- `currency`
- `sector`
- `country`
- `source_metadata.source`
- `source_metadata.file`
- `source_metadata.part`
- `source_metadata.total_parts`

Recomendacion: para el primer write real, considerar escribir solo assets root y dejar holdings para un segundo gate, o escribir holdings solo para un subset piloto.

## Campos parcialmente mapeados

### `derived.style_bias`

Destino recomendado: subdocumento enriquecido dentro de `fund_profile.style_bias` o `provider_payload.fondosdb.derived.style_bias`.

Requiere schema extension: si.

Puede esperar al write gate: si. No debe bloquear el primer write.

### `ms.holdings_top10`

Destino recomendado: no root. Debe ir a `assets/{asset_id}/holdings` como subset marcado `source_scope = top10`, o quedar en `provider_payload.fondosdb.ms.holdings_top10` hasta reconciliarlo con `normalized_holdings.ndjson`.

Requiere schema extension: si.

Puede esperar al write gate: si. No debe mezclarse con holdings completos sin regla de deduplicacion.

### `ms.objective`

Destino recomendado: `fund_profile.objective` o `provider_payload.fondosdb.ms.objective`.

Requiere schema extension: si.

Puede esperar al write gate: si. Es texto descriptivo, no dato clave de identidad.

### `universal.cartera`

Destino recomendado: dividir en subdocumentos contractuales:

- `portfolio_exposure`
- `fixed_income_profile`
- `style_profile`
- `holdings_metadata`

El payload completo puede conservarse temporalmente en `provider_payload.fondosdb.universal.cartera`.

Requiere schema extension: si.

Puede esperar al write gate: parcialmente. Los campos ya normalizados pueden entrar cuando exista schema; el payload completo no deberia escribirse al root.

## Auditoria de bloques enriquecidos

### Encaja con schema actual

- `asset_id`
- `asset_type`
- `identity`
- `identifiers`
- `listings`
- `classification.asset_class`

### Requiere extension formal

- `product`
- `classification` extendida
- `costs`
- `performance`
- `risk`
- `sustainability`
- `portfolio_exposure`
- `fixed_income_profile`
- `quality`
- `source_metadata`

### Debe quedar temporalmente en `provider_payload`

- Campos FondosDB sin destino canonico.
- Payloads extensos o parcialmente transformados.
- Objetivos/textos largos.
- Bloques completos de cartera no normalizados.

### Debe excluirse del primer write real

- Holdings masivos, salvo que el write gate incluya batch especifico.
- `ms.holdings_top10` si no se reconcilia con holdings completos.
- Cualquier campo no documentado en schema extension.
- Cualquier campo que pueda pisar datos existentes sin snapshot/diff.

## Auditoria de `firestore_paths_preview.json`

Checks:

- `preview_only = true`
- `firestore_writes_executed = 0`
- `firestore_deletes_executed = 0`
- `requires_explicit_write_gate = true`
- Paths preview de assets: 496
- Ejemplo: `assets/BE0946564383`
- Holdings preview: `assets/{asset_id}/holdings`

Riesgo:

- El preview propone paths bajo `assets/{asset_id}`, que es correcto para un futuro gate, pero no prueba si esos docs ya existen.
- No debe ejecutarse ningun write sin snapshot readonly previo de esos 496 paths y diff campo a campo.
- El archivo no crea write gate real.

## Propuesta de schema formal para fondos

Root recomendado:

```ts
Asset {
  asset_id: string;          // ISIN validado
  asset_type: 'FUND' | 'ETF' | 'OTHER';
  identity: {
    name: string;
    currency?: string | null;
  };
  identifiers: {
    isin: string;
  };
  listings: [];              // vacio si no hay listing real
  classification: {
    asset_class?: string | null;
  };
}
```

Extension recomendada:

```ts
fund_profile {
  product_type: 'fund' | 'money_market_fund' | 'ETF' | 'ETC';
  commercial_type?: string | null;
  objective?: string | null;
  vehicle_complexity?: string | null;
}

fund_metrics {
  costs?: object;
  performance?: object;
  risk?: object;
  sustainability?: object;
  portfolio_exposure?: object;
  fixed_income_profile?: object;
}

quality {
  provider: 'FondosDB';
  bucket: 'ALTO' | 'MEDIO' | 'BAJO' | 'BLOQUEADO';
  review_flags: string[];
  status: 'ACCEPTED' | 'REVIEW' | 'REJECTED';
}

source_metadata {
  provider: 'FondosDB';
  source_file: string;
  generated_at?: string;
  report_date?: string;
}
```

Provider payload temporal:

```ts
provider_payload {
  fondosdb?: {
    version: string;
    raw_refs: string[];
    unmapped?: object;
  }
}
```

## Propuesta de schema formal para holdings

Ruta recomendada:

```text
assets/{asset_id}/holdings/{holding_id}
```

Contrato:

```ts
Holding {
  asset_id: string;
  source_fund_isin: string;
  holding_id: string;
  as_of_date?: string | null;
  name?: string | null;
  identifiers: {
    isin?: string | null;
    ticker?: string | null;
  };
  holding_type?: string | null;
  weight_pct?: number | null;
  currency?: string | null;
  sector?: string | null;
  country?: string | null;
  source_metadata: {
    source: 'FondosDB';
    file: string;
    part?: number;
    total_parts?: number;
  };
}
```

Reglas:

- No insertar holdings dentro del root.
- No deduplicar holdings automaticamente sin regla estable.
- Usar `holding_id` determinista.
- Escribir en batches paginados, con resumen y recovery.
- Separar write gate de assets root y write gate de holdings.

## Riesgos detectados

- El schema actual no contempla formalmente todos los bloques enriquecidos de fondos.
- 91 assets estan en REVIEW; 69 son REVIEW alto y deben revisarse antes de write real.
- 94,993 holdings hacen necesario un gate especifico de batch y recovery.
- Los paths preview no prueban existencia en Firestore; falta snapshot readonly antes de cualquier plan real.
- `provider_payload` debe tener limites para no convertir el root en un vertedero de datos no modelados.

## Recomendacion para siguiente bloque

Siguiente bloque recomendado: disenar un write gate sin escritura real.

Alcance sugerido:

1. Snapshot readonly de `assets/{asset_id}` para los 496 ISIN.
2. Diff field-level para root minimo.
3. Separar plan de assets root de plan de holdings.
4. Definir schema extension versionada para `fund_profile`, `fund_metrics`, `quality` y `source_metadata`.
5. Preparar un piloto con 5-10 assets `ACCEPTED` representativos: RV, RF, ETF, ETC, monetario.
6. Mantener los 91 REVIEW fuera del primer write plan.

Estado: listo para disenar write gate. No listo para ejecutar write real.

## Confirmacion de seguridad

- Firestore writes = 0
- Firestore deletes = 0
- Base real writes = 0
- BDB-FONDOS tocado = NO
- BDB-FONDOS-CORE tocado = NO
- Deploy = NO
- Push = NO
- Commit = NO
- Internet = NO
- Credenciales usadas = NO
- Paquete input modificado = NO
