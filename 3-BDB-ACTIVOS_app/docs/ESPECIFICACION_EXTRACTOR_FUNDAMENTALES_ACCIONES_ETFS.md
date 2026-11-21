# Especificación del extractor de fundamentales de acciones y ETFs

Fecha: 17 de octubre de 2026. Proyecto: BDB-ACTIVOS.

## 1. Objetivo y límites

Construir un programa independiente que obtenga, normalice y entregue los datos fundamentales que necesita BDB-ACTIVOS para acciones y ETFs.

- EODHD se mantiene para precios e históricos. Este extractor no sustituye ni modifica esa integración.
- Los fondos de inversión quedan fuera: tendrán un programa separado.
- No recalcular aquí rentabilidades, volatilidades, Sharpe, drawdown ni analíticas de cartera ya calculadas con los históricos.
- La especificación se basa en el código local revisado en esta fecha. No constituye un inventario de cobertura de la base de producción ni una lista de sus ISIN actuales.
- Este documento define la implementación; no se ha implementado ni desplegado el extractor.

## 2. Arquitectura de salida

Separar la salida del extractor de los documentos maestros de la aplicación. No escribir directamente una exportación completa sobre `assets/{asset_id}`.

Estructura de archivos propuesta para cada ejecución:

```text
export/<run_id>/
  manifest.json
  assets.ndjson
  holdings.ndjson
  provenance.ndjson
  errors.ndjson
```

| Archivo | Contenido |
|---|---|
| `manifest.json` | Versión del contrato del extractor, fecha UTC, identificador de ejecución y recuentos |
| `assets.ndjson` | Una línea JSON por acción o ETF; estructura del apartado 3 |
| `holdings.ndjson` | Una línea JSON por cartera de ETF; estructura del apartado 8 |
| `provenance.ndjson` | Una línea por campo o bloque con fuente, periodo, unidad y metodología |
| `errors.ndjson` | Errores por activo/campo y motivo; sin claves ni credenciales |

Estos archivos y su envoltorio son un **contrato nuevo propuesto**, no una importación que ya exista. Se necesita un adaptador de publicación que traduzca esta salida al maestro, valide el resultado y actualice únicamente los campos autorizados.

Flujo: universo actual de acciones/ETFs → extracción → normalización → validación → exportación → adaptador de publicación → maestro → readmodel → interfaz.

## 3. Estructura exacta de cada registro de activo

```json
{
  "export_schema_version": "bdb.fundamentals-extractor.v1",
  "run_id": "20261017T120000Z",
  "asset_id": "ISIN_O_ID_EXISTENTE",
  "asset_type": "STOCK",
  "identity": {
    "name": "Nombre del activo",
    "isin": "ISIN_EXISTENTE",
    "currency": "EUR"
  },
  "classification": {
    "asset_class": "EQUITY",
    "region_primary": null,
    "category": null,
    "sector": null,
    "industry": null,
    "gics_sector": null,
    "strategy": null
  },
  "product_profile": null,
  "official_benchmark": null,
  "sustainability_profile": null,
  "fundamentals": {},
  "costs": null,
  "portfolio_exposure": null,
  "fixed_income_profile": null
}
```

El ejemplo es una plantilla, no un activo real ni un documento maestro completo. Los identificadores de ejemplo deben sustituirse antes de validar.

Reglas:

- `asset_id` debe ser el identificador existente en BDB; no recrear activos ni cambiarlo por un ticker.
- `asset_type`: únicamente `STOCK` o `ETF`.
- `identity.currency`: divisa de identidad/base ya conciliada con la ficha. No sobrescribirla con la divisa de presentación de las cuentas.
- `fundamentals.currency`: divisa común de los importes financieros publicados en ese bloque.
- `classification.asset_class`: `EQUITY`, `FIXED_INCOME`, `MIXED`, `MONEY_MARKET`, `ALTERNATIVE`, `REAL_ASSET`, `OTHER` o `UNKNOWN`.
- Conservar intactos los identificadores EODHD, aliases y listings existentes. La exportación no necesita repetirlos para actualizar fundamentales.
- Para incorporar nuevos activos, usar un flujo de alta independiente que complete y valide identidad, ISIN, ticker, bolsa y divisa de cotización.
- Todos los números deben ser JSON numérico finito. No cadenas con `%`, separadores de miles, `NaN` ni infinito.
- `null` significa no disponible en esta extracción, no orden de borrado del dato anterior.

## 4. Metadatos comunes de fundamentales

El objeto `fundamentals` tendrá esta cabecera y los bloques aplicables:

```json
{
  "schema_version": "bdb.fundamentals-summary.v1",
  "source": "extractor_propio",
  "as_of_date": "2026-09-30",
  "fetched_at": "2026-10-17T12:00:00Z",
  "currency": "EUR",
  "quality": {
    "coverage_status": "PARTIAL"
  }
}
```

`schema_version` identifica la forma del bloque que se entrega al mapeador; el código actual acepta texto y no impone por sí solo una validación exhaustiva de sus campos. El contrato detallado de este documento debe validarse en el nuevo programa.

`as_of_date` es la fecha de referencia del bloque, no la de descarga. Si los campos tienen fechas distintas, conservarlas por campo en `provenance.ndjson`; nunca atribuir a todas las cifras una misma fecha ficticia.

Estados propuestos para el extractor: `COMPLETE`, `PARTIAL`, `MISSING`, evaluados respecto a los campos aplicables de esta especificación. No declarar `COMPLETE` porque se haya obtenido algún dato. Diferenciar internamente ausente, no aplicable, no significativo y error de extracción.

## 5. Acciones: diccionario completo

Todas las rutas de esta tabla son relativas a `fundamentals`.

Prioridad A: indicador mostrado en la pestaña actual. Prioridad B: admitido y proyectado por el backend, aunque no necesariamente mostrado. Un campo aplicable debe intentarse obtener; no se debe inventar si falta.

| Ruta | Tipo / unidad | Definición | Prioridad |
|---|---|---|---|
| `profile.sector` | texto | Sector de actividad | B |
| `profile.industry` | texto | Industria de actividad | B |
| `profile.country` | texto | País de la empresa; normalizar a código ISO cuando sea posible | B |
| `profile.gics_sector` | texto | Sector GICS, solo si la clasificación está identificada | B |
| `valuation.market_cap` | número, moneda | Capitalización a fecha de valoración | A |
| `valuation.enterprise_value` | número, moneda | Valor de empresa, con metodología documentada | A |
| `valuation.pe_trailing` | número, veces | PER histórico; fijar base TTM | A |
| `valuation.pe_forward` | número, veces | PER sobre beneficio esperado; documentar horizonte | A |
| `valuation.peg` | número, veces | PER dividido por crecimiento esperado; documentar horizonte y convención | A |
| `valuation.price_sales_ttm` | número, veces | Capitalización / ingresos TTM | A |
| `valuation.price_book_mrq` | número, veces | Capitalización / patrimonio atribuible del último trimestre | A |
| `valuation.ev_ebitda` | número, veces | EV / EBITDA; documentar periodo y ajustes | A |
| `profitability.profit_margin` | número, fracción | Margen neto; definir TTM en el extractor | A |
| `profitability.operating_margin_ttm` | número, fracción | Resultado operativo / ingresos TTM | A |
| `profitability.return_on_assets_ttm` | número, fracción | ROA TTM, con definición de resultado y activos promedio | A |
| `profitability.return_on_equity_ttm` | número, fracción | ROE TTM, con patrimonio promedio y atribución consistente | A |
| `growth.quarterly_revenue_yoy` | número, fracción | Variación de ingresos del trimestre frente al mismo trimestre anterior | A |
| `growth.quarterly_earnings_yoy` | número, fracción | Variación del beneficio trimestral interanual, con base definida | A |
| `per_share.eps` | número, moneda/acción | BPA TTM; propuesta: diluido | B |
| `per_share.book_value` | número, moneda/acción | Patrimonio atribuible por acción, último balance | B |
| `per_share.revenue_ttm` | número, moneda/acción | Ingresos TTM por acción: definición propuesta por pertenecer al bloque `per_share` | B |
| `per_share.dividend` | número, moneda/acción | Dividendo por acción; propuesta: últimos 12 meses | B |
| `dividends.yield_ratio` | número, fracción | Dividendo por acción / precio; documentar si es histórico o indicado | B |
| `dividends.payout_ratio` | número, fracción | Tasa de distribución; fijar denominador y periodo | B |
| `dividends.ex_dividend_date` | fecha o null | Fecha exdividendo identificada, sin confundir con pago | B |

El mapeador actual no documenta todas las bases contables: las definiciones propuestas aquí deben fijarse como política del extractor. No mezclar ratios de distintos proveedores sin conservar sus metodologías.

No es necesario obtener beta para este bloque: la ingesta antigua la guarda, pero `map_fundamentals_summary` no la proyecta. La beta de cartera procede de cálculos separados.

### 5.1 Plantilla de fundamentales de acción

```json
{
  "schema_version": "bdb.fundamentals-summary.v1",
  "source": "extractor_propio",
  "as_of_date": null,
  "fetched_at": "2026-10-17T12:00:00Z",
  "currency": "EUR",
  "quality": {"coverage_status": "MISSING"},
  "profile": {"sector": null, "industry": null, "country": null, "gics_sector": null},
  "valuation": {
    "market_cap": null, "enterprise_value": null,
    "pe_trailing": null, "pe_forward": null, "peg": null,
    "price_sales_ttm": null, "price_book_mrq": null, "ev_ebitda": null
  },
  "profitability": {
    "profit_margin": null, "operating_margin_ttm": null,
    "return_on_assets_ttm": null, "return_on_equity_ttm": null
  },
  "growth": {"quarterly_revenue_yoy": null, "quarterly_earnings_yoy": null},
  "per_share": {"eps": null, "book_value": null, "revenue_ttm": null, "dividend": null},
  "dividends": {"yield_ratio": null, "payout_ratio": null, "ex_dividend_date": null}
}
```

### 5.2 Si se calculan los ratios desde cuentas

Guardar en el almacenamiento interno del extractor las cuentas originales, sin añadirlas arbitrariamente al maestro. Obtener ingresos, beneficio neto y atribuible, resultado operativo, EBITDA o sus componentes, activos, patrimonio atribuible, deuda, efectivo, componentes adicionales de EV, acciones en circulación, acciones medias básicas/diluidas, BPA y dividendos por acción.

Cada observación necesita inicio y fin del periodo, fecha de publicación, moneda, escala (unidades/miles/millones), norma contable, carácter trimestral/anual/acumulado y condición de reexpresada. Construir TTM sin sumar cuatro cifras acumuladas anuales. Obtener suficientes periodos para el trimestre comparable y los saldos promedio.

Los precios necesarios para valorar se leen de la integración existente de EODHD. Usar precio y número de acciones coherentes con la fecha, splits y clase de acción; no usar mecánicamente un cierre ajustado por dividendos para calcular una capitalización puntual.

PER adelantado y PEG requieren estimaciones identificadas o un modelo propio explícito. Si no existen, dejar `null`. No sustituirlos por cifras históricas con otro nombre. En pérdidas, patrimonio negativo o bases de crecimiento no significativas, guardar motivo y evitar publicar ratios engañosos. Las métricas no aplicables a determinados sectores, como EV/EBITDA en ciertas entidades financieras, pueden quedar sin dato con justificación.

## 6. ETFs: fundamentales, perfil y costes

### 6.1 Fundamentales específicos

Rutas relativas a `fundamentals`:

| Ruta | Unidad | Uso |
|---|---|---|
| `fund_metrics.total_assets` | moneda | Patrimonio mostrado; aclarar si corresponde al fondo o a la clase |
| `fund_metrics.yield_pct` | porcentaje | Rentabilidad por distribución mostrada; conservar periodo/metodología |
| `fund_metrics.ongoing_charge_pct` | porcentaje | Gastos corrientes mostrados |
| `fund_metrics.net_expense_ratio_pct` | porcentaje | Alternativa de gastos en pantalla, sin asumir equivalencia universal |
| `fund_metrics.turnover_pct` | porcentaje | Rotación mostrada, con periodo |
| `fund_metrics.average_market_cap_mln` | millones de moneda | Admitido por backend; capitalización media de participadas |
| `holdings_summary.positions_count` | entero | Número declarado de posiciones |
| `holdings_summary.top10_weight_pct` | porcentaje | Concentración de las diez principales |
| `holdings_summary.full_holdings_loaded` | booleano | Indica si se ha obtenido toda la cartera |
| `holdings_summary.coverage_status` | texto | Cobertura del bloque de cartera |

No exigir márgenes, ROA, ROE o beneficios empresariales al vehículo ETF. Los múltiplos de una cartera solo se incorporarán si la fuente los publica y se documenta su agregación; no confundirlos con múltiplos de la gestora.

### 6.2 Plantilla de fundamentales de ETF

```json
{
  "schema_version": "bdb.fundamentals-summary.v1",
  "source": "extractor_propio",
  "as_of_date": null,
  "fetched_at": "2026-10-17T12:00:00Z",
  "currency": "EUR",
  "quality": {"coverage_status": "MISSING"},
  "fund_metrics": {
    "total_assets": null,
    "yield_pct": null,
    "ongoing_charge_pct": null,
    "net_expense_ratio_pct": null,
    "turnover_pct": null,
    "average_market_cap_mln": null
  },
  "holdings_summary": {
    "positions_count": null,
    "top10_weight_pct": null,
    "full_holdings_loaded": false,
    "coverage_status": "MISSING"
  }
}
```

### 6.3 Perfil de producto de la exportación

```json
{
  "provider": null,
  "product_type": "ETF",
  "domicile": null,
  "share_class": null,
  "distribution_policy": null,
  "inception_date": null,
  "ucits": null,
  "replication": null,
  "legal_structure": null
}
```

`domicile`: país legal; `share_class`: clase concreta; `distribution_policy`: acumulación/distribución; `replication`: física completa, muestreo, sintética u otra clasificación documentada; `inception_date`: fecha ISO. No inferir exposición geográfica del domicilio.

`official_benchmark` será un objeto con `name` obligatorio cuando exista y `asset_id`, `isin`, `ticker`, `source` opcionales. No asignar el índice por similitud del nombre sin evidencia.

`sustainability_profile` puede contener `sfdr`, `esg_rating`, `sustainability_rating`, todos opcionales. No son requisitos mínimos ni deben generarse artificialmente.

**Integración pendiente:** estos perfiles se definen en la exportación para no perder la información. La interfaz tiene tipos y normalizadores para ellos, pero el mapeador Python revisado no los publica en `map_asset`. Los contratos maestros también restringen `product`. Se requiere ampliar contratos y mapeo antes de su publicación; no basta con añadir estas claves al documento maestro.

### 6.4 Costes separados de fundamentales

```json
{
  "ter_pct": null,
  "mifid_ongoing_pct": null,
  "management_fee_pct": null
}
```

Guardar este bloque en `costs`. El backend usa `ter_pct` y, si falta, `mifid_ongoing_pct` para calcular `ongoing_charge`; publica `management_fee_pct` como `management_fee`. No sumar comisión de gestión al TER si ya está incluida. No rellenar ambos conceptos con el mismo valor sin evidencia de equivalencia.

Mantener coherencia con `fundamentals.fund_metrics`, pero respetar la naturaleza de cada medida. Un TER de 0,20 % se almacena como `0.20`, no como `0.002`, en la ficha maestra.

## 7. Exposiciones y ETFs de renta fija

### 7.1 Exposiciones

```json
{
  "asset_mix": {"equity": 0.98, "bond": 0.0, "cash": 0.02, "other": 0.0},
  "sectors": null,
  "equity_regions": null,
  "equity_styles": null,
  "market_caps": null,
  "bond_types": null,
  "exposure_confidence": null
}
```

Ejemplo sintético, no una cartera real. Todos los mapas usan fracciones: `0.25` = 25 %. Cada mapa disponible es un diccionario de categoría a peso numérico. Normalizar las etiquetas a una taxonomía estable y conservar el nombre original en la procedencia. No inventar un mapa vacío o una confianza numérica para aparentar cobertura.

Los desgloses corresponden a sectores, regiones, estilos de renta variable, tamaños de capitalización y tipos de bonos. Fijar si el denominador es el patrimonio total o la parte de renta variable: no mezclar bases entre proveedores. Si se convierte la base, guardar el cálculo y la cobertura.

No renormalizar una cartera parcial al 100 %. Para productos con derivados, apalancamiento o cortos, conservar la metodología de exposición y no forzar límites propios de una cartera larga; el mapeador actual filtra valores no positivos en varios desgloses y necesita ampliación para representarlos íntegramente.

### 7.2 Perfil de renta fija

```json
{
  "effective_duration": null,
  "modified_duration": null,
  "effective_maturity": null,
  "yield_to_maturity": null,
  "avg_credit_quality": null,
  "investment_grade_pct": null,
  "high_yield_pct": null
}
```

Duraciones y vencimiento en años. TIR, grado de inversión y alto rendimiento en porcentaje en el maestro: `4.5` = 4,5 %. El backend convierte a fracción para el consumidor. `avg_credit_quality` es texto, por ejemplo `BBB`; conservar metodología/agencia. No sustituir TIR por yield de distribución.

El reparto por deuda pública, corporativa, titulizada y efectivo se entrega en `portfolio_exposure.bond_types`, en fracciones.

## 8. Cartera de ETF: archivo y almacenamiento

Cada registro de `holdings.ndjson` tendrá este envoltorio nuevo:

```json
{
  "asset_id": "ID_EXISTENTE_DEL_ETF",
  "document": {
    "storage_mode": "SINGLE_DOCUMENT",
    "holdings_count": 1,
    "top10_weight": null,
    "as_of_date": "2026-09-30",
    "holdings": [
      {
        "holding_id": "IDENTIFICADOR_EN_LA_FUENTE",
        "name": "Participada de ejemplo",
        "isin": null,
        "ticker": null,
        "weight_pct": 2.5,
        "holding_type": "STOCK",
        "currency": "EUR",
        "sector": null,
        "country": null
      }
    ],
    "provenance": {
      "source": "extractor_propio",
      "coverage": "PARTIAL",
      "retrieved_at": "2026-10-17T12:00:00Z",
      "as_of_date_basis": "document",
      "declared_holdings_count": 100,
      "extractor_run_id": "20261017T120000Z"
    }
  }
}
```

Ejemplo sintético: una posición obtenida de cien declaradas. `holdings_count` cuenta las posiciones incluidas; `declared_holdings_count` conserva el total declarado por la fuente. `fundamentals.holdings_summary.positions_count` puede usar ese total declarado, sin presentarlo como total descargado.

El adaptador escribe **solo `document`** en `assets/{asset_id}/holdings/latest`. El envoltorio `asset_id` no pertenece al documento según el esquema cacheado.

Requisitos de cada posición: nombre o identificador utilizable y peso numérico finito. Obtener ISIN siempre que exista; ticker solo no garantiza identidad global. País, sector, divisa y tipo deben obtenerse cuando estén disponibles. No inventar identificadores para efectivo o derivados.

`weight_pct` está en porcentaje: `2.5` = 2,5 %. Para `top10_weight`, establecer en el adaptador la convención porcentual y verificarla contra los consumidores existentes: el esquema no declara unidad y el mapeador copia el número sin conversión. No depender de heurísticas de tamaño para decidir la escala.

Cobertura de procedencia admitida por `holdings.v1.2`: `COMPLETE`, `TOP_N`, `PARTIAL`, `UNKNOWN`. Estos valores son distintos del estado general de fundamentales. `COMPLETE` significa todas las posiciones declaradas por la fuente, no una suma forzada a 100.

Si la cartera no cabe en un documento, usar manifest `CHUNKED` y fragmentos conforme al contrato y al lector existentes. No diseñar un segundo mecanismo de fragmentación incompatible. Evitar publicar un manifest antes de tener todos sus fragmentos disponibles.

## 9. Procedencia por campo

Estructura propuesta de `provenance.ndjson`, almacenada fuera de la raíz maestra salvo adaptación expresa del contrato:

```json
{
  "asset_id": "ID_EXISTENTE",
  "field": "fundamentals.valuation.pe_trailing",
  "source": "adaptador_de_fuente",
  "document_url": null,
  "source_id": null,
  "as_of_date": "2026-09-30",
  "published_at": null,
  "fetched_at": "2026-10-17T12:00:00Z",
  "period_start": null,
  "period_end": null,
  "period_type": "TTM",
  "currency": null,
  "unit": "multiple",
  "method": "reported",
  "status": "AVAILABLE",
  "missing_reason": null,
  "response_sha256": null,
  "run_id": "20261017T120000Z"
}
```

`method`: `reported` o `calculated`. Estados propuestos: `AVAILABLE`, `MISSING`, `NOT_APPLICABLE`, `NOT_MEANINGFUL`, `ERROR`. Para cálculos, añadir en el almacenamiento interno las referencias a entradas y versión de fórmula. Las URLs nunca deben contener tokens ni credenciales.

## 10. Reglas de unidades y validación

| Grupo | Unidad persistida |
|---|---|
| Márgenes, ROA, ROE, crecimiento, yield y payout de acciones | Fracción: 15 % → `0.15` |
| Múltiplos de valoración | Veces: PER 15 → `15` |
| Capitalización, EV, patrimonio | Unidades de la divisa declarada, no millones implícitos |
| Datos por acción | Unidades monetarias por acción |
| `average_market_cap_mln` | Millones de la divisa declarada |
| Métricas ETF terminadas en `_pct` y costes maestros | Porcentaje: 0,20 % → `0.20` |
| Posiciones `weight_pct` | Porcentaje: 5 % → `5` |
| Mapas `portfolio_exposure` | Fracción: 5 % → `0.05` |
| TIR, IG, HY en perfil maestro de renta fija | Porcentaje: 5 % → `5` |
| Duración y vencimiento | Años |
| Fechas de referencia | `YYYY-MM-DD` |
| Instantes de descarga | ISO 8601 UTC con `Z` |

No limitar todos los ratios a 0..1: crecimiento, payout y rentabilidad contable pueden exceder el 100 % o ser negativos. Los controles deben ser específicos del campo.

Si las cuentas están en una divisa y la cotización en otra, convertir coherentemente los importes utilizados en cada ratio y registrar tipo de cambio/fecha. El bloque consumidor solo tiene una divisa general; no publicar importes monetarios mezclados dentro de él.

Un cero publicado es válido; una ausencia no es cero. No sobrescribir un dato válido con `null` por un error transitorio. Para retirar expresamente un dato erróneo, implementar una operación de invalidación diferenciada y auditable.

## 11. Integración real con BDB-ACTIVOS

### 11.1 Lo que ya está conectado

- `assets/{id}.fundamentals` → `map_fundamentals_summary` → `fundamentals_summary` → pestaña Fundamentales.
- `costs` → `map_costs` → costes del consumidor.
- `portfolio_exposure` → exposición PMS y desgloses.
- `fixed_income_profile` → perfil de renta fija del consumidor, sujeto a que el contrato de la raíz admita el bloque.
- `holdings/latest` → consulta de posiciones y resumen de cartera.

### 11.2 Cambios necesarios antes de publicar

1. Implementar lector/validador de la exportación y publicación por campos. No existe aquí un importador listo para este envoltorio nuevo.
2. Elegir el esquema según la raíz existente. No cambiar automáticamente todos los ETFs a una versión de ficha distinta.
3. El contrato provisional `asset-market.v1` admite `fundamentals` como objeto abierto, pero limita otros bloques; ampliar/migrar explícitamente lo necesario para perfil, clasificaciones enriquecidas y renta fija.
4. Los contratos cacheados de `product` son más estrechos que los tipos del frontend. Elegir una ubicación canónica y ampliar esquema, mapeador y contrato de API para domicilio, clase, réplica, UCITS, proveedor y benchmark.
5. El `map_asset` revisado no publica el perfil de producto, sostenibilidad ni toda la clasificación. Añadir ese paso para que los datos obtenidos lleguen realmente a la pantalla. Guardar sector solo en `fundamentals.profile` no garantiza que aparezca en el resumen principal ni en filtros.
6. El resumen general de holdings del mapeador pone `full_holdings_loaded` a `false` de forma fija. La cobertura del bloque de fundamentales y la procedencia de la cartera deben conservarse; ajustar la proyección si se quiere representar carga completa en el resumen general.
7. Validar la raíz final contra el contrato efectivo y regenerar/invalidatear las vistas o cachés que corresponda mediante el flujo existente.
8. Coordinar propiedad de campos con la plataforma/republish: una publicación posterior no debe borrar los datos del nuevo extractor. Conservar `source_metadata` y la identidad de origen existentes; no marcar toda la raíz como propia solo por enriquecer fundamentales.

La publicación no debe tocar `price_series`, `metrics`, listings EODHD, identidad sin conciliación, controles de selección, operaciones de cartera ni bloques de otros escritores. Actualizar `fundamentals.source` no equivale a cambiar el propietario de toda la ficha.

### 11.3 Pruebas de aceptación para implementar

- Acción con 14 indicadores: el resumen proyecta las cifras y sus unidades correctamente.
- Acción con pérdidas: ausencias justificadas y sin ratios inventados.
- ETF de renta variable: gastos visibles, cartera parcial declarada y pesos correctos.
- ETF de renta fija: años y porcentajes convertidos correctamente.
- Coste cero: se conserva como cero, sin activar un fallback por falsedad booleana.
- Extractor fallido: conserva los datos previos y registra error/antigüedad.
- Monedas distintas: no combina importes incompatibles.
- Cartera completa y parcial: no confunde posiciones declaradas con descargadas.
- Idempotencia: repetir la misma ejecución no duplica posiciones ni modifica precios.
- Compatibilidad: validar esquemas, proyección backend y presentación de una muestra antes de ampliar la publicación.

## 12. Orden de implementación y actualización

1. Universo e identidad: leer únicamente acciones/ETFs existentes y conservar su correspondencia con EODHD.
2. Fundamentales de acciones: los 14 visibles, perfil y campos adicionales del diccionario.
3. ETFs: patrimonio, costes, perfil y cobertura.
4. Carteras, exposiciones y perfil de renta fija.
5. Adaptador, contratos y mapeos pendientes; validar con muestras antes de publicar por lotes.

Cadencia propuesta: cuentas al publicarse resultados; valoración cuando cambien precio/acciones o se refresque el bloque; estimaciones según disponibilidad; ETF patrimonio y posiciones según frecuencia de la fuente; costes y perfil ante nueva documentación. La frecuencia de descarga nunca sustituye la fecha de referencia del dato.

No se prescribe aquí un proveedor ni se ha verificado disponibilidad o condiciones actuales de APIs externas. Las fuentes se deben resolver por campo y cobertura geográfica durante la implementación, conservando siempre evidencia y metodología.

## 13. Código y contratos revisados

- `functions_python/ingest_asset.py`: fundamentales actuales de acciones desde Finnhub/Yahoo; alta provisional de ETF.
- `functions_python/readmodel/mappers.py`: `map_fundamentals_summary`, `map_costs`, `map_pms_exposure`, `map_exposure_detail`, `map_fixed_income_profile`, `map_holdings_summary`, `map_asset`.
- `functions_python/readmodel/firestore_client.py`: lectura de holdings y fragmentos.
- `src/components/AssetDetail.tsx`: indicadores visibles y perfiles admitidos por pantalla.
- `src/types/bdbAssets.ts`: tipos del consumidor.
- `src/adapters/bdbLiveApiAdapter.ts`: adaptación de perfiles y campos al frontend.
- `src/adapters/bdbLiveApiContracts.ts`: validación del resumen de fundamentales.
- `src/adapters/assetHoldingsAdapter.ts`: normalización de posiciones y pesos.
- `functions_python/contracts_cache/asset-stock.v1.1.schema.json`.
- `functions_python/contracts_cache/asset-market.v1.schema.json`.
- `functions_python/contracts_cache/asset.v1.2.schema.json`.
- `functions_python/contracts_cache/holdings.v1.2.schema.json`.

La distinción entre exportación propuesta, contrato maestro y contrato consumidor es obligatoria: compartir nombres de campos no convierte los tres documentos en intercambiables.
