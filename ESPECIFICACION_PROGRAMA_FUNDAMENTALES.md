# Especificación: programa de fundamentales de acciones para BDB

Versión 1, 17-10-2026. Escrita a partir de cómo lee y enseña hoy la app los fundamentales. El programa es independiente; esta hoja dice qué tiene que entregar para que BDB lo use sin retoques.

**Alcance:** acciones cotizadas, básicamente europeas y americanas. La lista de compañías la decide BDB en cada momento: el programa recibe una lista de ISIN y devuelve una ficha por compañía.

---

## 1. Qué recibe y qué devuelve

- **Entrada:** lista de ISIN (y, si BDB lo conoce, el símbolo de cotización; ver §3).
- **Salida:** un JSON por compañía (`<ISIN>.json`) o un único NDJSON con una línea por compañía. Codificación UTF-8, fechas ISO 8601, decimales con punto.
- **Si una compañía no se encuentra:** se devuelve igualmente su línea con `status: "NOT_FOUND"` y el motivo. Nunca se omite en silencio.

## 2. Forma de cada ficha

```json
{
  "isin": "ES0105046009",
  "identification": { ... },          // §3
  "fundamentals": {                    // §4: es lo que BDB guarda tal cual
    "schema_version": "bdb.fundamentals-summary.v1",
    "instrument_type": "STOCK",
    "symbol": "AENA.MC",
    "currency": "EUR",
    "as_of_date": "2026-06-30",
    "fetched_at": "2026-10-17T16:00:00Z",
    "source": "<nombre de tu programa>",
    "quality": { "coverage_ratio": 0.83, "coverage_status": "PARTIAL", "warnings": [] },
    "profile": { ... }, "valuation": { ... }, "profitability": { ... }, "growth": { ... },
    "per_share": { ... }, "dividends": { ... }, "capital": { ... }, "technicals": { ... }, "analyst": { ... }
  },
  "provenance": { "valuation.pe_trailing": "fuente:endpoint", ... }   // §5
}
```

Un campo que no se conoce **no se pone** (o va a `null`). Nunca un 0 inventado.

## 3. Identificación

| Campo | Obligatorio | Notas |
|---|---|---|
| `isin` | sí | Patrón `^[A-Z]{2}[A-Z0-9]{9}[0-9]$`. Es la clave en BDB. |
| `identification.name` | sí | Nombre legal. |
| `identification.ticker` | sí | Código de la cotización principal (p. ej. `AENA`, `SAN`, `AAPL`). |
| `identification.exchange` | sí | Sufijo de bolsa **en notación EODHD**: `MC` Madrid, `XETRA` Fráncfort, `PA` París, `AS` Ámsterdam, `MI` Milán, `LSE` Londres, `HE` Helsinki, `SW` Suiza, `US` EE. UU. Es la notación de las series de precios de BDB. |
| `identification.eodhd_symbol` | sí | `ticker.exchange` (p. ej. `AENA.MC`). Debe ser la **cotización principal en la bolsa local**. |
| `identification.yahoo_symbol` | recomendable | Si lo usas como fuente (`AENA.MC`, `SAP.DE`, `AAPL`). |
| `identification.country` | sí | ISO 3166-1 alfa-2 del domicilio (`ES`, `DE`, `US`). |
| `identification.currency` | sí | ISO 4217 de la cotización (`EUR`, `USD`, `GBP`; peniques como `GBX`). |

**Trampas que hoy existen y conviene evitar:**
- Italianas resueltas a cotizaciones de Londres en EUR (`0HBC.LSE` para Intesa) en lugar de `.MI`.
- Holandesas con cotización principal en EE. UU. (Ferrari `RACE.US`, Stellantis `STLA.US`): debe quedar claro cuál es la cotización de referencia y en qué divisa.
- ISIN antiguos tras un cambio de domicilio (Ferrovial: `ES0118900010` ya retirado; la vigente es `NL0015001FS8`). Si el programa detecta que un ISIN está dado de baja o sustituido, que lo diga.

## 4. Campos de fundamentales

**Unidades — lo más importante.** *Fracción* = 0,0865 significa 8,65 %. *Múltiplo* = número de veces (PER 15,2). Los importes van en la divisa de `fundamentals.currency`.

### 4.1 Los que la app enseña hoy (prioridad alta)

Pestaña «Fundamentales» de la ficha de una acción.

| Ruta bajo `fundamentals.` | Unidad | Se ve como |
|---|---|---|
| `valuation.market_cap` | importe | Capitalización |
| `valuation.enterprise_value` | importe | Valor de empresa |
| `valuation.pe_trailing` | múltiplo | PER |
| `valuation.pe_forward` | múltiplo | PER adelantado |
| `valuation.peg` | múltiplo | PEG |
| `valuation.price_sales_ttm` | múltiplo | Precio / ventas |
| `valuation.price_book_mrq` | múltiplo | Precio / valor contable |
| `valuation.ev_ebitda` | múltiplo | EV / EBITDA |
| `profitability.profit_margin` | fracción | Margen neto |
| `profitability.operating_margin_ttm` | fracción | Margen operativo |
| `profitability.return_on_assets_ttm` | fracción | ROA |
| `profitability.return_on_equity_ttm` | fracción | ROE |
| `growth.quarterly_revenue_yoy` | fracción | Crecimiento de ingresos |
| `growth.quarterly_earnings_yoy` | fracción | Crecimiento de beneficios |
| `source`, `as_of_date`, `quality.coverage_status`, `currency` | — | Fuente, Fecha de referencia, Cobertura, Divisa |

### 4.2 Los que la app ya lee aunque hoy no los enseñe (prioridad media)

| Ruta | Unidad |
|---|---|
| `profile.sector`, `profile.industry` | texto |
| `profile.country` | ISO alfa-2 |
| `profile.gics_sector` | texto (GICS si lo tienes) |
| `per_share.eps` | importe por acción |
| `per_share.book_value` | importe por acción |
| `per_share.revenue_ttm` | importe por acción |
| `per_share.dividend` | importe por acción (últimos 12 meses) |
| `dividends.yield_ratio` | **fracción** (0,0238 = 2,38 %) |
| `dividends.payout_ratio` | fracción |
| `dividends.ex_dividend_date` | fecha ISO |

### 4.3 Útiles para el futuro (opcionales)

`profile.employees` (entero), `profile.gics_group|gics_industry|gics_sub_industry`, `profile.fiscal_year_end` (mes), `valuation.ev_revenue` (múltiplo), `capital.shares_outstanding`, `capital.shares_float` (número), `capital.insiders_ratio` y `capital.institutions_ratio` (**fracción**; hoy el extractor los guarda en % por error histórico: en el programa nuevo, fracción), `dividends.forward_annual_rate` (importe), `dividends.forward_yield_ratio` (fracción), `analyst.target_price` (precio), `analyst.eps_current_year|eps_next_year|eps_next_quarter` (importe), `technicals.beta`, `technicals.high_52w|low_52w|moving_average_50d|moving_average_200d` (precio).

## 5. Procedencia y calidad (obligatorio)

- `fundamentals.source`: nombre de tu programa (se ve en la app como «Fuente»).
- `fundamentals.fetched_at`: cuándo se obtuvo, ISO UTC.
- `fundamentals.as_of_date`: fecha a la que se refieren los datos (normalmente el último trimestre o ejercicio publicado). **No** la fecha de descarga.
- `fundamentals.quality.coverage_ratio`: campos de §4.1 + §4.2 rellenos / total (0–1). `coverage_status`: `COMPLETE` si es 1, `PARTIAL` si no, `EMPTY` si 0.
- `fundamentals.quality.warnings`: lista de avisos, p. ej. `unofficial_source:<fuente>`, `stale_data` (as_of_date de más de 15 meses), `currency_mismatch`.
- `provenance`: por cada campo, de qué fuente y endpoint salió (`"valuation.pe_trailing": "sec_edgar:10-Q"`, `"…": "yahoo:info"`). BDB lo guarda para auditar.

## 6. Reglas de validación (que el programa debe aplicar antes de entregar)

1. Porcentajes siempre como **fracción** en los campos de §4 (nunca 8,65 donde va 0,0865). Comprobar: un margen o un ROE fuera de [-5, 5] es casi seguro un error de unidad.
2. Divisa coherente: `market_cap` y los importes por acción en la divisa declarada; peniques (`GBX`) declarados como tales.
3. Nada de ceros por defecto: si una fuente devuelve 0 o vacío para un dato que no puede ser 0 (capitalización, acciones en circulación), se omite y se avisa.
4. `as_of_date` no puede ser posterior a `fetched_at`.
5. Una sola cotización de referencia por ISIN (§3).

## 7. Cómo lo usará BDB

El extractor tendrá un adaptador nuevo que lee la salida del programa y la escribe en `fundamentales` de cada ficha de acción; de ahí viaja sin transformación al canónico (`ms.stock.fundamentals`), a la maestra (`assets/<ISIN>.fundamentals`) y a la app. Cuando esté listo:
- se compara con lo que da hoy Yahoo sobre unas cuantas compañías (mismas unidades, mismos valores aproximados);
- Yahoo queda como respaldo o se retira;
- las fichas antiguas con datos de EODHD de julio de 2026 se sustituyen.

## 8. Referencias en el código

- Lector de la app: `3-BDB-ACTIVOS_app/functions_python/readmodel/mappers.py` (`map_fundamentals_summary`).
- Ficha: `3-BDB-ACTIVOS_app/src/components/AssetDetail.tsx` (pestaña Fundamentales).
- Contrato de lectura: `2-plataforma-datos/contracts/read/asset-for-bdb.v1.schema.json` (`fundamentals_summary`).
- Productor actual (Yahoo): `1-extractor/fetchers/eodhd.py` (`RESUMEN_YAHOO`, `_resumen_fundamentales_yahoo`).
