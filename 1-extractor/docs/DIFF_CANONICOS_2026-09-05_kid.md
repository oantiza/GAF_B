# Diff campo a campo: KID de la gestora (05-09-2026) frente a los canónicos de la mañana

Oráculo: `python tools/diff_canonicos.py reports/baseline/export_bdb_20260905_pre_kid export_bdb`.
Antes, los 763 canónicos regenerados el 04-09 con el rediseño; después, los
mismos 763 tras la pasada de `kid_gestora` sobre los 606 fondos y ETF no
españoles (las 74 acciones no se tocaron y salen idénticas; las 83 fichas ES
solo ganan `regulatory.kid.source`).

Resultado: idénticas 209.492 hojas · cambian 4.382 · aparecen 8.226 · desaparecen 19.

## Lectura

- **Desaparecen 19 hojas, todas de un ISIN** (IE00B0M62Q58, iShares MSCI World
  USD Dist): el registro ESMA que tenía era el de **otra clase** (iShares MSCI
  World *EUR Hedged (Acc)*), casado por tokens antes de la regla de
  contención exacta del 04-09 por la noche. Perder un dato erróneo no es una
  regresión; la clase correcta no está en el registro de ESMA por nombre.
  Dos fondos irlandeses (IE00B4Z6MP99, IE00B5BMR087) ganan a cambio su registro
  ESMA correcto (aparecen 27 hojas).
- **Cambian 4.382 hojas en 21 rutas**: casi todas son la contabilidad de la
  procedencia (`provenance.plan` incorpora `kid_gestora`; `dependency.*`,
  `sources.*` y `classification_v2.sources_used` recuentan) y el sello
  `acquired_at`. Con dato de negocio cambian:
  - `regulatory.sri` en 10 fondos: 9 en los que el KID de la gestora dice otra
    cosa que la copia de Morningstar (verificados a mano en la prosa y en el
    gráfico del PDF; ver informe §9) y FR0010041822, cuyo DIC de la AMF dice 2
    frente al 3 de Morningstar (el gráfico lo confirma; el parser ahora lo lee).
  - `regulatory.kid.manufacturer` en 2 fondos de Carmignac: el nombre sin la
    dirección postal.
  - `provenance.fields.regulatory.launch_date_class` en 4 fondos: el KID aporta
    la fecha de lanzamiento además de Morningstar (mismo valor).
  - `validation/quality/classification_v2.warnings[]` de LU2504555777:
    desplazamiento de lista por un aviso nuevo (`mifid_ongoing_from_kid`,
    porque ahora hay KID); nada se pierde.
- **Aparecen 8.226 hojas en 65 rutas**: el bloque `regulatory.kid` (costes,
  fecha, idioma, periodo, URL, fuente, hash, productor) y `regulatory.sfdr_article`
  para los 388 fondos con KID nuevo, su procedencia (`kid_gestora:<fuente>`) y
  `regulatory.kid.source` también en los 97 KID de la CNMV y de la AMF.
  `ms.costs.mifid_ongoing` aparece en LU2504555777 por el respaldo del KID.

Puertas: `sync_contratos --check` ✔ · `ruff` ✔ · `pytest` 101 ✔ · 763 canónicos
válidos contra `fondosdb-fund.v1` / `fondosdb-stock.v1` (0 incumplimientos; 2
bloqueados por la guarda de calidad, los dos Vanguard que Morningstar ya no
resuelve, sin cambios respecto al 04-09).


Antes: `reports/baseline/export_bdb_20260905_pre_kid` (763 canónicos) · Después: `export_bdb` (763 canónicos) · comunes: 763

| Categoría | Hojas | % |
|---|---:|---:|
| identico | 209492 | 94.32 % |
| cambia | 4382 | 1.97 % |
| aparece | 8226 | 3.70 % |
| desaparece | 19 | 0.01 % |

## Campos que desaparecen (regresión salvo justificación): 19 hojas en 14 rutas

| Ruta | Hojas | ISINs | Ejemplo (antes → después) |
|---|---:|---|---|
| `regulatory.registers.esma.host_countries[]` | 6 | IE00B0M62Q58 | IE00B0M62Q58: "CZ" → null |
| `classification_v2.sources_used[]` | 1 | IE00B0M62Q58 | IE00B0M62Q58: "fondosdb:morningstar_lt" → null |
| `provenance.endpoints.esma:cbdif.fetched_at` | 1 | IE00B0M62Q58 | IE00B0M62Q58: "2026-09-04T21:43:49+00:00" → null |
| `provenance.endpoints.esma:cbdif.modo` | 1 | IE00B0M62Q58 | IE00B0M62Q58: "tokens" → null |
| `provenance.fields.regulatory.legal_framework` | 1 | IE00B0M62Q58 | IE00B0M62Q58: "esma:cbdif" → null |
| `provenance.fields.regulatory.management_company_legal` | 1 | IE00B0M62Q58 | IE00B0M62Q58: "esma:cbdif" → null |
| `provenance.fields.regulatory.registers.esma` | 1 | IE00B0M62Q58 | IE00B0M62Q58: "esma:cbdif" → null |
| `provenance.sources.esma.canonical_fields` | 1 | IE00B0M62Q58 | IE00B0M62Q58: 5 → null |
| `provenance.sources.esma.v2_fields` | 1 | IE00B0M62Q58 | IE00B0M62Q58: 8 → null |
| `regulatory.legal_framework` | 1 | IE00B0M62Q58 | IE00B0M62Q58: "UCITS" → null |
| `regulatory.management_company_legal` | 1 | IE00B0M62Q58 | IE00B0M62Q58: "BlackRock Asset Management Ireland Limited" → null |
| `regulatory.registers.esma.legal_name` | 1 | IE00B0M62Q58 | IE00B0M62Q58: "iShares MSCI World EUR Hedged UCITS ETF (Acc)" → null |
| `regulatory.registers.esma.marketed_in_spain` | 1 | IE00B0M62Q58 | IE00B0M62Q58: false → null |
| `regulatory.registers.esma.status` | 1 | IE00B0M62Q58 | IE00B0M62Q58: "Active" → null |

## Campos que cambian de valor: 4382 hojas en 21 rutas

| Ruta | Hojas | ISINs | Ejemplo (antes → después) |
|---|---:|---|---|
| `provenance.plan[]` | 616 | BE0943877671, BE0946564383, BE0947853660, BE6213829094, DE0005318406, DE0008490962 (+598) | BE0943877671: "esma" → "kid_gestora" |
| `provenance.acquired_at` | 604 | BE0943877671, BE0946564383, BE0947853660, BE6213829094, DE0005318406, DE0008490962 (+598) | BE0943877671: "2026-09-04T22:01:17+00:00" → "2026-09-05T04:05:13+00:00" |
| `provenance.dependency.regulatory_from_official_sources` | 394 | BE0946564383, BE0947853660, BE6213829094, DE0005318406, DE0008490962, DE000A0X7541 (+388) | BE0946564383: 5 → 8 |
| `classification_v2.sources_used[]` | 393 | BE0946564383, BE0947853660, BE6213829094, DE0005318406, DE0008490962, DE000A0X7541 (+385) | BE0946564383: "fondosdb:morningstar_lt" → "fondosdb:kid_gestora" |
| `provenance.dependency.from_morningstar_only` | 392 | BE0946564383, BE0947853660, BE6213829094, DE0005318406, DE0008490962, DE000A0X7541 (+386) | BE0946564383: 28 → 27 |
| `provenance.dependency.canonical_fields_mapped` | 391 | BE0946564383, BE0947853660, BE6213829094, DE0005318406, DE0008490962, DE000A0X7541 (+385) | BE0946564383: 34 → 36 |
| `provenance.dependency.regulatory_fields` | 391 | BE0946564383, BE0947853660, BE6213829094, DE0005318406, DE0008490962, DE000A0X7541 (+385) | BE0946564383: 11 → 13 |
| `provenance.sources.morningstar_lt.canonical_fields` | 389 | BE0946564383, BE0947853660, BE6213829094, DE0005318406, DE0008490962, DE000A0X7541 (+383) | BE0946564383: 31 → 30 |
| `provenance.sources.morningstar_lt.v2_fields` | 389 | BE0946564383, BE0947853660, BE6213829094, DE0005318406, DE0008490962, DE000A0X7541 (+383) | BE0946564383: 245 → 244 |
| `provenance.fields.regulatory.sri` | 386 | BE0946564383, BE0947853660, BE6213829094, DE0005318406, DE0008490962, DE000A0X7541 (+380) | BE0946564383: "morningstar_lt:Mifid" → "kid_gestora:deutsche_bank_es" |
| `regulatory.sri` | 10 | DE0008490962, FR0010041822, LU0133264522, LU0171289902, LU0171290074, LU0181496216 (+4) | DE0008490962: 4 → 5 |
| `provenance.fields.regulatory.launch_date_class` | 4 | LU0336084032, LU0592699093, LU0995386439, LU1623762843 | LU0336084032: "morningstar_lt:screener" → "kid_gestora:deutsche_bank_es+morningstar_lt:screener" |
| `validation.warnings[]` | 4 | LU2504555777 | LU2504555777: "coupon_allocation_unavailable" → "mifid_ongoing_from_kid" |
| `provenance.fields.regulatory.domicile` | 3 | IE00B0M62Q58, IE00B4Z6MP99, IE00B5BMR087 | IE00B0M62Q58: "esma:cbdif" → "morningstar_lt:ETFsnapshot" |
| `provenance.fields.regulatory.ucits` | 3 | IE00B0M62Q58, IE00B4Z6MP99, IE00B5BMR087 | IE00B0M62Q58: "esma:cbdif" → "morningstar_lt:ETFsnapshot" |
| `provenance.sources.amf_geco.canonical_fields` | 3 | FR0010041822, FR0010172767, FR001400JGB5 | FR0010041822: 8 → 9 |
| `provenance.sources.amf_geco.v2_fields` | 3 | FR0010041822, FR0010172767, FR001400JGB5 | FR0010041822: 26 → 27 |
| `classification_v2.warnings[]` | 2 | LU2504555777 | LU2504555777: "coupon_allocation_unavailable" → "mifid_ongoing_from_kid" |
| `quality.warnings[]` | 2 | LU2504555777 | LU2504555777: "coupon_allocation_unavailable" → "mifid_ongoing_from_kid" |
| `regulatory.kid.manufacturer` | 2 | FR0010148981, FR0010149120 | FR0010148981: "Carmignac Gestion S.A, 24 Place Vendôme, 75001 Paris, Fr... → "Carmignac Gestion S.A" |
| `provenance.endpoints.esma:cbdif.fetched_at` | 1 | LU0583242994 | LU0583242994: "2026-09-04T21:55:17+00:00" → "2026-09-04T21:55:16+00:00" |

## Campos que aparecen (mejora a justificar): 8226 hojas en 65 rutas

| Ruta | Hojas | ISINs | Ejemplo (antes → después) |
|---|---:|---|---|
| `provenance.plan[]` | 604 | BE0943877671, BE0946564383, BE0947853660, BE6213829094, DE0005318406, DE0008490962 (+598) | BE0943877671: null → "esma" |
| `regulatory.kid.source` | 485 | BE0946564383, BE0947853660, BE6213829094, DE0005318406, DE0008490962, DE000A0X7541 (+479) | BE0946564383: null → "deutsche_bank_es" |
| `classification_v2.sources_used[]` | 390 | BE0946564383, BE0947853660, BE6213829094, DE0005318406, DE0008490962, DE000A0X7541 (+384) | BE0946564383: null → "fondosdb:morningstar_lt" |
| `provenance.fields.regulatory.kid` | 388 | BE0946564383, BE0947853660, BE6213829094, DE0005318406, DE0008490962, DE000A0X7541 (+382) | BE0946564383: null → "kid_gestora:deutsche_bank_es" |
| `provenance.sources.kid_gestora.canonical_fields` | 388 | BE0946564383, BE0947853660, BE6213829094, DE0005318406, DE0008490962, DE000A0X7541 (+382) | BE0946564383: null → 3 |
| `provenance.sources.kid_gestora.v2_fields` | 388 | BE0946564383, BE0947853660, BE6213829094, DE0005318406, DE0008490962, DE000A0X7541 (+382) | BE0946564383: null → 14 |
| `regulatory.kid.costs.management_and_other_pct` | 388 | BE0946564383, BE0947853660, BE6213829094, DE0005318406, DE0008490962, DE000A0X7541 (+382) | BE0946564383: null → 1.73 |
| `regulatory.kid.language` | 388 | BE0946564383, BE0947853660, BE6213829094, DE0005318406, DE0008490962, DE000A0X7541 (+382) | BE0946564383: null → "es" |
| `regulatory.kid.sha256` | 388 | BE0946564383, BE0947853660, BE6213829094, DE0005318406, DE0008490962, DE000A0X7541 (+382) | BE0946564383: null → "24f35816b635d0f4fe6272e536d22f20e4553b5051535f61c350f292... |
| `regulatory.kid.url` | 388 | BE0946564383, BE0947853660, BE6213829094, DE0005318406, DE0008490962, DE000A0X7541 (+382) | BE0946564383: null → "https://www.servicios.deutsche-bank.es/documentacionfond... |
| `regulatory.kid.costs.entry_pct` | 383 | BE0946564383, BE0947853660, BE6213829094, DE0005318406, DE0008490962, DE000A0X7541 (+377) | BE0946564383: null → 2.0 |
| `regulatory.kid.costs.transaction_pct` | 382 | BE0946564383, BE0947853660, BE6213829094, DE0005318406, DE0008490962, DE000A0X7541 (+376) | BE0946564383: null → 0.7 |
| `regulatory.kid.costs.exit_pct` | 376 | BE0946564383, BE0947853660, BE6213829094, DE0005318406, DE0008490962, DE000DWS17J0 (+370) | BE0946564383: null → 0.0 |
| `regulatory.kid.date` | 354 | BE0946564383, BE0947853660, BE6213829094, DE000A0X7541, FI0008800511, FI0008801097 (+348) | BE0946564383: null → "2026-02-19" |
| `regulatory.kid.recommended_holding_years` | 348 | BE0946564383, BE0947853660, BE6213829094, DE0005318406, DE0008490962, DE000A0X7541 (+342) | BE0946564383: null → 6 |
| `regulatory.kid.costs.performance_fee_pct` | 327 | BE0946564383, BE0947853660, BE6213829094, DE0005318406, DE0008490962, DE000DWS17J0 (+321) | BE0946564383: null → 0.0 |
| `regulatory.kid.manufacturer` | 245 | DE000A0X7541, FR0010230490, FR0010306142, FR0010312660, FR0011261197, IE0003867441 (+239) | DE000A0X7541: null → "ACATIS Investment Kapitalverwaltungsgesellschaft mbH" |
| `provenance.fields.regulatory.sfdr_article` | 222 | BE0946564383, BE0947853660, BE6213829094, DE0005318406, DE0008490962, DE000A0X7541 (+216) | BE0946564383: null → "kid_gestora:deutsche_bank_es" |
| `regulatory.sfdr_article` | 222 | BE0946564383, BE0947853660, BE6213829094, DE0005318406, DE0008490962, DE000A0X7541 (+216) | BE0946564383: null → "8" |
| `provenance.endpoints.kid_gestora:deutsche_bank_es.fetched_at` | 220 | BE0946564383, BE0947853660, BE6213829094, DE000A0X7541, FI0008800511, FI0008801097 (+214) | BE0946564383: null → "2026-09-05T03:39:46+00:00" |
| `provenance.endpoints.kid_gestora:deutsche_bank_es.url` | 220 | BE0946564383, BE0947853660, BE6213829094, DE000A0X7541, FI0008800511, FI0008801097 (+214) | BE0946564383: null → "https://www.servicios.deutsche-bank.es/documentacionfond... |
| `provenance.endpoints.kid_gestora:deutsche_bank_es.documento` | 197 | BE0946564383, BE0947853660, BE6213829094, DE000A0X7541, FI0008800511, FI0008801097 (+191) | BE0946564383: null → "2026-02-19" |
| `provenance.endpoints.kid_gestora:amundi.fetched_at` | 31 | FR0010829697, FR0011365212, FR0050000860, LU0181962126, LU0552029406, LU0552029661 (+25) | FR0010829697: null → "2026-09-05T03:49:55+00:00" |
| `provenance.endpoints.kid_gestora:amundi.url` | 31 | FR0010829697, FR0011365212, FR0050000860, LU0181962126, LU0552029406, LU0552029661 (+25) | FR0010829697: null → "https://www.amundi.es/retail/dl/doc/kid-priips/FR0010829... |
| `provenance.endpoints.kid_gestora:schroders.documento` | 30 | LU0113257694, LU0133717503, LU0161304786, LU0161305163, LU0161305593, LU0181496216 (+24) | LU0113257694: null → "2026-07-28" |
| `provenance.endpoints.kid_gestora:schroders.fetched_at` | 30 | LU0113257694, LU0133717503, LU0161304786, LU0161305163, LU0161305593, LU0181496216 (+24) | LU0113257694: null → "2026-09-05T03:37:49+00:00" |
| `provenance.endpoints.kid_gestora:schroders.url` | 30 | LU0113257694, LU0133717503, LU0161304786, LU0161305163, LU0161305593, LU0181496216 (+24) | LU0113257694: null → "https://api.schroders.com/document-store/SISF_Euro-Corpo... |
| `provenance.endpoints.kid_gestora:amundi.documento` | 28 | LU0181962126, LU0552029406, LU0552029661, LU0565135745, LU0565136552, LU0568583420 (+22) | LU0181962126: null → "2026-04-29" |
| `provenance.endpoints.kid_gestora:dws.fetched_at` | 27 | DE0005318406, DE0008490962, DE000DWS17J0, LU0034353002, LU0080237943, LU0087412390 (+21) | DE0005318406: null → "2026-09-05T03:51:07+00:00" |
| `provenance.endpoints.kid_gestora:dws.url` | 27 | DE0005318406, DE0008490962, DE000DWS17J0, LU0034353002, LU0080237943, LU0087412390 (+21) | DE0005318406: null → "https://download.dws.com/product-documents/DE0005318406/... |
| `provenance.endpoints.kid_gestora:jpmorgan.documento` | 25 | LU0117843481, LU0117843721, LU0117858166, LU0117858596, LU0117858679, LU0117858752 (+19) | LU0117843481: null → "2026-04-27" |
| `provenance.endpoints.kid_gestora:jpmorgan.fetched_at` | 25 | LU0117843481, LU0117843721, LU0117858166, LU0117858596, LU0117858679, LU0117858752 (+19) | LU0117843481: null → "2026-09-05T03:41:53+00:00" |
| `provenance.endpoints.kid_gestora:jpmorgan.url` | 25 | LU0117843481, LU0117843721, LU0117858166, LU0117858596, LU0117858679, LU0117858752 (+19) | LU0117843481: null → "https://wl.fundsquare.net/serv/down-doc/request?cdClient... |
| `provenance.endpoints.kid_gestora:dws.documento` | 24 | LU0034353002, LU0080237943, LU0087412390, LU0145656715, LU0273148055, LU0273159177 (+18) | LU0034353002: null → "2026-02-16" |
| `provenance.endpoints.kid_gestora:invesco.documento` | 20 | IE00B3Q19T94, IE00B3YCGJ38, LU0028119013, LU0102737730, LU0102737904, LU0115139569 (+14) | IE00B3Q19T94: null → "2026-06-26" |
| `provenance.endpoints.kid_gestora:invesco.fetched_at` | 20 | IE00B3Q19T94, IE00B3YCGJ38, LU0028119013, LU0102737730, LU0102737904, LU0115139569 (+14) | IE00B3Q19T94: null → "2026-09-05T03:32:11+00:00" |
| `provenance.endpoints.kid_gestora:invesco.url` | 20 | IE00B3Q19T94, IE00B3YCGJ38, LU0028119013, LU0102737730, LU0102737904, LU0115139569 (+14) | IE00B3Q19T94: null → "https://www.invesco.com/content/dam/invesco/es/es/produc... |
| `regulatory.registers.esma.host_countries[]` | 14 | IE00B4Z6MP99, IE00B5BMR087 | IE00B4Z6MP99: null → "FI" |
| `provenance.endpoints.kid_gestora:mandg.documento` | 14 | LU1582984149, LU1582988306, LU1665237704, LU1670618187, LU1670618690, LU1670626446 (+8) | LU1582984149: null → "2026-02-16" |
| `provenance.endpoints.kid_gestora:mandg.fetched_at` | 14 | LU1582984149, LU1582988306, LU1665237704, LU1670618187, LU1670618690, LU1670626446 (+8) | LU1582984149: null → "2026-09-05T03:37:57+00:00" |
| `provenance.endpoints.kid_gestora:mandg.url` | 14 | LU1582984149, LU1582988306, LU1665237704, LU1670618187, LU1670618690, LU1670626446 (+8) | LU1582984149: null → "https://www.mandg.com/dam/investments/common/es/es/docum... |
| `provenance.endpoints.kid_gestora:goldman_sachs.documento` | 8 | LU0102219945, LU0133264522, LU0133267202, LU0333810850, LU0910636546, LU0910636892 (+2) | LU0102219945: null → "2026-02-03" |
| `provenance.endpoints.kid_gestora:goldman_sachs.fetched_at` | 8 | LU0102219945, LU0133264522, LU0133267202, LU0333810850, LU0910636546, LU0910636892 (+2) | LU0102219945: null → "2026-09-05T03:51:54+00:00" |
| `provenance.endpoints.kid_gestora:goldman_sachs.url` | 8 | LU0102219945, LU0133264522, LU0133267202, LU0333810850, LU0910636546, LU0910636892 (+2) | LU0102219945: null → "https://www.gsam.com/content/dam/gsam/pdfs/international... |
| `provenance.endpoints.kid_gestora:nordea.documento` | 8 | LU0112467450, LU0173782102, LU0348926287, LU0602539867, LU0607983896, LU0637302547 (+2) | LU0112467450: null → "2026-05-20" |
| `provenance.endpoints.kid_gestora:nordea.fetched_at` | 8 | LU0112467450, LU0173782102, LU0348926287, LU0602539867, LU0607983896, LU0637302547 (+2) | LU0112467450: null → "2026-09-05T03:41:46+00:00" |
| `provenance.endpoints.kid_gestora:nordea.url` | 8 | LU0112467450, LU0173782102, LU0348926287, LU0602539867, LU0607983896, LU0637302547 (+2) | LU0112467450: null → "https://docs.fundconnect.com/GetDocument.aspx?clientid=i... |
| `provenance.endpoints.kid_gestora:candriam.fetched_at` | 5 | LU0077500055, LU0093583077, LU0594539719, LU1838941372, LU2098772366 | LU0077500055: null → "2026-09-05T03:32:27+00:00" |
| `provenance.endpoints.kid_gestora:candriam.url` | 5 | LU0077500055, LU0093583077, LU0594539719, LU1838941372, LU2098772366 | LU0077500055: null → "https://www.candriam.com/FundDocumentDownload/GetApiDocu... |
| `provenance.endpoints.esma:cbdif.fetched_at` | 2 | IE00B4Z6MP99, IE00B5BMR087 | IE00B4Z6MP99: null → "2026-09-04T21:50:46+00:00" |
| `provenance.endpoints.esma:cbdif.modo` | 2 | IE00B4Z6MP99, IE00B5BMR087 | IE00B4Z6MP99: null → "tokens" |
| `provenance.fields.regulatory.legal_framework` | 2 | IE00B4Z6MP99, IE00B5BMR087 | IE00B4Z6MP99: null → "esma:cbdif" |
| `provenance.fields.regulatory.management_company_legal` | 2 | IE00B4Z6MP99, IE00B5BMR087 | IE00B4Z6MP99: null → "esma:cbdif" |
| `provenance.fields.regulatory.registers.esma` | 2 | IE00B4Z6MP99, IE00B5BMR087 | IE00B4Z6MP99: null → "esma:cbdif" |
| `provenance.sources.esma.canonical_fields` | 2 | IE00B4Z6MP99, IE00B5BMR087 | IE00B4Z6MP99: null → 5 |
| `provenance.sources.esma.v2_fields` | 2 | IE00B4Z6MP99, IE00B5BMR087 | IE00B4Z6MP99: null → 8 |
| `regulatory.legal_framework` | 2 | IE00B4Z6MP99, IE00B5BMR087 | IE00B4Z6MP99: null → "UCITS" |
| `regulatory.management_company_legal` | 2 | IE00B4Z6MP99, IE00B5BMR087 | IE00B4Z6MP99: null → "BNY Mellon Fund Management (Luxembourg) S.A" |
| `regulatory.registers.esma.legal_name` | 2 | IE00B4Z6MP99, IE00B5BMR087 | IE00B4Z6MP99: null → "BNY Mellon Global Real Return Fund (EUR)" |
| `regulatory.registers.esma.marketed_in_spain` | 2 | IE00B4Z6MP99, IE00B5BMR087 | IE00B4Z6MP99: null → false |
| `regulatory.registers.esma.status` | 2 | IE00B4Z6MP99, IE00B5BMR087 | IE00B4Z6MP99: null → "Active" |
| `classification_v2.warnings[]` | 1 | LU2504555777 | LU2504555777: null → "region_primary_inferred_from_equity_regions" |
| `ms.costs.mifid_ongoing` | 1 | LU2504555777 | LU2504555777: null → 1.9 |
| `quality.warnings[]` | 1 | LU2504555777 | LU2504555777: null → "region_primary_inferred_from_equity_regions" |
| `validation.warnings[]` | 1 | LU2504555777 | LU2504555777: null → "info_pesos_negativos" |

## ISINs con más desapariciones/cambios

| ISIN | idéntico | cambia | aparece | desaparece |
|---|---:|---:|---:|---:|
| IE00B0M62Q58 | 252 | 13 | 1 | 19 |
| LU2504555777 | 279 | 18 | 24 | 0 |
| IE00B5BMR087 | 246 | 13 | 27 | 0 |
| DE0008490962 | 238 | 11 | 19 | 0 |
| IE00B3Q19T94 | 192 | 11 | 20 | 0 |
| IE00B3YCGJ38 | 246 | 11 | 20 | 0 |
| IE00B4Z6MP99 | 274 | 11 | 15 | 0 |
| LU0133264522 | 291 | 11 | 19 | 0 |
| LU0171289902 | 291 | 11 | 18 | 0 |
| LU0171290074 | 291 | 11 | 18 | 0 |
| LU0181496216 | 292 | 11 | 19 | 0 |
| LU0583242994 | 316 | 11 | 22 | 0 |
| LU0995386439 | 271 | 11 | 22 | 0 |
| LU1103303167 | 283 | 11 | 21 | 0 |
| LU1665237704 | 287 | 11 | 19 | 0 |
