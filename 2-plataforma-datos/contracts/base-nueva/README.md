# `contracts/base-nueva/` — los contratos de la base nueva

*Escrito el 01-11-2026, el día que Óscar aprobó el diseño. Es el paso 2 de los ocho.*

El diseño está en el documento «Diseño de la base de datos nueva»
(https://claude.ai/artifact/YBKFEFCMPLosYEsniTkAgq). Esto es su traducción a esquemas, y no
añade decisiones: donde el diseño no decide, esto no inventa, lo dice.

**Nada de esto está conectado todavía.** No hay escritor, no hay siembra y la maestra de hoy
sigue intacta. Lo único que corre son las siete comprobaciones.

## Los tres dominios

| Dominio | Clave | Qué es |
|---|---|---|
| `instruments/{instrument_id}` | ISIN (12) o divisa ISO 4217 (3) | El producto. La raíz es fina —identidad, identificadores, clasificación, producto— y todo lo demás cuelga en subdocumentos |
| `issuers/{issuer_id}` | `ISS_nnnnnn`, interno | La entidad, una sola vez, con sus roles. El LEI no es la clave: lo traen 2 de 771 fondos |
| `clients/{client_id}` | `CLI_xxxxxxxx` | Cliente → cartera → posición / operación / valoración. Es la parte que hoy no existe |

Más tres colecciones que no son dominios sino plomería: `instrument_issuer` (el vínculo con
fechas de validez), `instrument_aliases` (ISIN retirados) y `custodian_dictionaries` (la
traducción de literales de extracto).

## El catálogo

| Fichero | Documento | Capa | Dueño |
|---|---|---|---|
| `instrument.v2` | `instruments/{id}` | declared | platform |
| `instrument-declared-profile.v2` | `…/declared/profile` | declared | platform |
| `instrument-declared-costs.v2` | `…/declared/costs` | declared | platform |
| `instrument-declared-regulatory.v2` | `…/declared/regulatory` | declared | platform |
| `instrument-declared-exposure.v2` | `…/declared/exposure` | declared | platform |
| `instrument-declared-fixed-income.v2` | `…/declared/fixed_income` | declared | platform |
| `instrument-declared-provider-risk.v2` | `…/declared/provider_risk` | declared | platform |
| `instrument-declared-provider-returns.v2` | `…/declared/provider_returns` | declared | platform |
| `instrument-declared-sustainability.v2` | `…/declared/sustainability` | declared | platform |
| `instrument-declared-size.v2` | `…/declared/size` | declared | platform |
| `instrument-declared-holdings.v2` | `…/declared/holdings` | declared | platform |
| `instrument-declared-provenance.v2` | `…/declared/provenance` | declared | platform |
| `instrument-declared-quote.v2` | `…/declared/quote` | declared | platform |
| `instrument-declared-equity.v2` | `…/declared/equity` | declared | platform |
| `instrument-declared-dividends.v2` | `…/declared/dividends` | declared | platform |
| `instrument-declared-issuer-data.v2` | `…/declared/issuer_data` | declared | platform |
| `instrument-declared-target-market.v2` | `…/declared/target_market` (mercado objetivo del EMT, decisión 58; no cuenta en la cobertura) | declared | platform |
| `instrument-issuer-nav.v2` | `…/issuer_nav/{año}` | declared | platform |
| `instrument-declared-issuer-holdings.v2` | `…/declared/issuer_holdings` (cartera completa del emisor de un ETF, decisión B-79: **solo para el asesor**, ningún camino de cliente la lee; no cuenta en la cobertura) | declared | platform |
| `instrument-issuer-holdings-chunk.v2` | `…/issuer_holdings_chunks/{nnn}` (sus posiciones, 500 por trozo; aparte de `holdings_chunks`) | declared | platform |
| `instrument-computed-metrics.v2` | `…/computed/metrics` | computed | batch |
| `instrument-computed-premium-discount.v2` | `…/computed/premium_discount` | computed | batch |
| `instrument-quality.v2` | `…/quality/latest` | computed | batch |
| `instrument-read-card.v2` | `…/read/card` | **projection** | batch |
| `instrument-alias.v2` | `instrument_aliases/{isin}` | human | human |
| `issuer.v2` | `issuers/{id}` | declared | platform |
| `issuer-fundamentals.v2` | `…/fundamentals/latest` | declared | platform |
| `instrument-issuer.v2` | `instrument_issuer/{isin}_{role}` | human | human |
| `search-shard.v2` | `search_shards/{nnn}` | projection | batch |
| `quality-rollup.v2` | `quality_rollup/{fecha}` | computed | batch |
| `client.v2` | `clients/{id}` | ledger | app |
| `portfolio.v2` | `…/portfolios/{id}` | ledger | app |
| `portfolio-target.v2` | `…/targets/{instrument_id}` | human | app |
| `portfolio-position.v2` | `…/positions/{instrument_id}` | computed | batch |
| `portfolio-transaction.v2` | `…/transactions/{tx_id}` | **ledger** | app |
| `portfolio-valuation.v2` | `…/valuations/{periodo}` | computed | batch |
| `portfolio-report.v2` | `…/reports/{id}` | human | app |
| `custodian-dictionary.v2` | `custodian_dictionaries/{cust}_{doc}` | human | human |

## Las anotaciones

Cada ruta declara, además de su `type` (**uno solo**, nunca dos):

- **`x-unit`** — `fraction`, `ratio`, `multiple`, `currency_amount`, `count`, `date`, `code`,
  `text`, `years`. La unidad va aquí, no en un sufijo `_pct` que nadie comprueba.
- **`x-layer`** — `declared` (lo afirma un tercero), `computed` (lo calculamos nosotros),
  `ledger` (el libro, solo crece), `human` (lo decidió una persona), `metadata` (sello de
  escritura), `projection` (copia derivada, no es fuente de nada).
- **`x-owner`** — `platform`, `app`, `batch`, `human`. Extiende el mecanismo que ya existe en
  `asset.v1.3` y que lee `src/loader/ownership.ts`; no lo sustituye.
- **`x-absence`** — `NOT_APPLICABLE`, `NOT_PROVIDED`, `NOT_YET_FETCHED`. Es lo que sustituye a
  los 22 centinelas: la ausencia dice por qué, en vez de cifrarla en un `'NA'` o un `0`.
- **`x-counts-when`** — cuándo cuenta en la cobertura una ruta que aplica a más población. Sin declararlo,
  cuenta cuando aplica. Lo lleva `relative`, que desde el 04-11-2026 se rellena también en una acción sin
  mover su cobertura.
- **`maxItems`** en toda lista y **`maxProperties`** en todo mapa de claves libres.
- **`x-applies-to`** y **`x-coverage-target`** — a qué población aplica la ruta y hasta dónde
  se espera cubrirla. Sin esto, «duración efectiva al 57 %» parece cobertura mala cuando es el
  57 % de los 314 fondos que tienen renta fija.
- **`x-reference: true`** en un subárbol que identifica a **otra** entidad (el índice de
  referencia). Sus campos no son datos de este documento, así que la quinta comprobación no
  los cuenta como duplicado.

## La acción como instrumento, y el porqué de cada exclusión

*Añadido el 01-11-2026 con la fase F1. Los doce bloques de arriba tienen forma de fondo, y
una acción no tiene diez de ellos.*

El patrón no es nuevo: `declared/fixed_income` ya era un contrato específico por tipo, con su
`x-applies-when`, y solo lo llevan 337 de los 772. Una acción usa el mismo mecanismo, con dos
contratos propios y una regla de cobertura que hace que su denominador signifique algo.

**Lo que una acción SÍ tiene:**

| Bloque | Qué lleva |
|---|---|
| la raíz | identidad, ticker y `asset_class: EQUITY`. Sin `category` ni `official_benchmark` ni `product`, que están condicionados al tipo en el propio esquema |
| `declared/equity` | el listado (mercado y país del mercado), sector, industria y a qué se dedica la empresa |
| `declared/dividends` | el dividendo real: rendimiento a doce meses, lo pagado y lo anunciado por acción, y la fecha sin derecho |
| `declared/quote` | el precio y su día. **Es de todos los tipos**: la base no guardaba el precio de nada |
| `declared/provenance` | genérico. Hoy no se escribe en ninguna acción: el canónico trae sus doce claves a `null` |
| `computed/metrics` | **nuestras** métricas, con `method: EXTRACTOR_DAILY_V1` |

**Lo que NO tiene, y por qué.** Esto es lo que contesta la pregunta que se va a hacer muchas
veces —*¿por qué esta acción no tiene coste corriente?*—, y la respuesta vive además en la
base: `quality/latest.absences`, con razón `NOT_APPLICABLE` y el motivo escrito. La tabla
canónica está en `src/ingestion/baseNueva/mapper.ts`, en
`BLOQUES_QUE_NO_APLICAN_A_UNA_ACCION`, y una prueba comprueba que ninguna se queda sin motivo.

| Bloque | Por qué no aplica |
|---|---|
| `declared/profile` | es el perfil de una **clase** de fondo: su campo obligatorio es la política de reparto. Y su `objective` es el objetivo del folleto; en una acción el texto equivalente es la descripción del negocio, que no es el objetivo de inversión de nadie. El canónico la mete en `ms.objective` en las 73, así que reutilizar el campo habría escrito una cosa en el nombre de otra |
| `declared/costs` | no hay TER. Lo que paga un inversor por comprarla es el corretaje de **su** intermediario: un coste suyo, no del instrumento, y no comparable entre productos |
| `declared/regulatory` | el SRI sale de un KID de PRIIPs y el SRRI de un DFI de UCITS, y una acción no tiene ninguno de los dos documentos |
| `declared/exposure` | una acción es renta variable al 100 % **por ser** una acción, no porque un tercero lo haya medido a una fecha. Escribir una tautología en la capa de lo que afirma un tercero sería mentir sobre quién lo afirma. La **tarjeta** sí lo lleva, marcado `BY_INSTRUMENT_TYPE`, porque una proyección es el único sitio donde una copia derivada está en su sitio |
| `declared/fixed_income` | no tiene renta fija. Ya lo decía `CON_RENTA_FIJA` |
| `declared/provider_risk` | **no hay cifra de proveedor que guardar.** Es el hallazgo que condicionó F1: medido el 01-11-2026, las métricas de las 73 acciones las calcula el extractor sobre la serie de EODHD. Ver abajo |
| `declared/provider_returns` | lo mismo: la rentabilidad es nuestra |
| `declared/sustainability` | los globos de sostenibilidad son una calificación de **fondos**; la de una empresa sería otra cosa y tendría otro contrato |
| `declared/size` | el patrimonio de un fondo es el dinero que le han confiado. El «tamaño» de una acción es la capitalización, que es lo que vale la empresa en bolsa: ni es la misma magnitud ni la declara la misma persona. Ponerla en `aum` sería la versión de libro del defecto que motiva esta base |
| `declared/holdings` | una acción no tiene cartera |
| `declared/distributions` | ese bloque es la política y el historial de reparto de una **clase**, y existe para **arreglar** la serie. Una acción paga dividendos de verdad, que van a `declared/dividends`, y su serie ya está ajustada por ellos: no hay nada que arreglar |
| `computed/metrics.relative` | una acción no declara benchmark en ningún folleto. Elegirle uno es una decisión y tendría que quedar registrada como tal, no colarse en un lote |

**Y los fundamentales no faltan: están en otro sitio.** 71 de las 73 traen el resumen
`bdb.fundamentals-summary.v1` entero, y no entran aquí porque son de la **empresa** y no de la
acción: su contrato es `issuers/{issuer_id}/fundamentals/latest`, escrito desde el 01-11 y
vacío, porque emparejar cada nombre con su entidad es una decisión humana por instrumento. El
mapper los cuenta como pérdida en vez de tirarlos callados. La línea que separa los dos sitios
es la misma en todo: cuentas de la compañía → emisor; pagos y listado → instrumento. Por eso el
`payout_ratio` (dividendo entre beneficio) es del emisor y el rendimiento (dividendo entre
precio) es del instrumento.

### Las tres cosas que esto impide, cada una medida

1. **Nuestras métricas archivadas como del proveedor.** El filtro que separa las nuestras de
   las suyas es `meta.procedencia`, y **las acciones no la traen: 0 de 73**. Con la procedencia
   vacía, el mapper de fondos habría metido las 72 volatilidades, los Sharpe y las caídas
   máximas en un bloque llamado `declared/provider_risk`. Eso es el segundo de los cinco
   defectos que motivan esta base, reproducido el primer día que entra un tipo nuevo. El mapper
   de acciones no tiene filtro que pueda fallar: para una acción, la cifra es nuestra porque no
   existe otra.
2. **Un método mezclado con otro.** `EXTRACTOR_MONTHLY_V1` es mensual —rentabilidades de cierre
   de mes por √12, ventanas de 12, 36 y 60 meses cerrados—. El de una acción muestrea **diario**
   (√252), cuenta la ventana desde el último día de la serie, usa otro estimador del Sharpe y
   mide la caída máxima sobre 5 años en vez de 3. Cuatro parámetros, leídos del código que las
   produce. `METODO_PROPIO_METRICAS` dice que cambiar uno cambia la versión, así que el nombre
   es otro: `EXTRACTOR_DAILY_V1`. La consecuencia es de lectura y la tarjeta la lleva encima:
   una tabla que ordene fondos y acciones por volatilidad está mezclando dos escalas.
3. **El 1-7 inventado.** `VOL_BUCKET` se retiró del enum de `risk_score_source`, en el bloque
   calculado y en la tarjeta. Era un cubo de volatilidad que la base vieja archiva como si
   fuera un indicador regulatorio en sus 312 acciones. Estaba declarado y sin usar, y así
   bastaba una línea de mapper para reproducirlo.

### Y el derecho a calcular, que en una acción se declara distinto

`computed/metrics.inputs` exigía `distribution_policy_resolution`, que es el grado de evidencia
de la política de reparto de una clase. Una acción no tiene ninguno de sus cuatro valores:
`PROVIDER_NO_RECORDS` sería el que encaja de forma y es **falso**, porque 68 de las 73 reparten
dividendo.

Así que el campo tiene un gemelo, `series_adjustment`, y el bloque exige **uno de los dos** con
un `anyOf`. La barrera no se relaja, se traduce: un documento sin ninguno de los dos sigue sin
validar. En una acción el derecho viene del ajuste de la serie —el cierre ajustado reparte hacia
atrás desdoblamientos y dividendos, comprobado en el código que la construye— y de ahí sale
`return_basis: TOTAL_RETURN` por derivación y no por suposición. Es la buena noticia del tipo:
de las 469 métricas propias de fondos, 449 se retiraron el 01-11-2026 por no tener evidencia de
la política, y una acción no hereda ese problema.

## El vocabulario vive en un solo sitio

`src/config/baseNueva/vocabulario.ts`, con el mismo patrón —y por la misma razón— que
`src/config/projectAllowlist.ts`: las unidades, las capas, los dueños, las ausencias, los
periodos, los centinelas prohibidos, los grupos de sinónimos, la divisa base, la fuente de
tipo de cambio y el mapa `transaction_type → flow_class`. Las pruebas lo leen de ahí, no de
copias. Si una lista cambia, cambia en un sitio.

El sobre común de los bloques `declared/*` (`source`, `as_of`, `document_url`, `sha256`) sí
está escrito en cada fichero, porque un esquema es JSON y no puede importar una constante. Lo
que garantiza que no divergen no es la disciplina: es la comprobación.

## Las siete comprobaciones

`tests/baseNuevaContratos.test.ts`, con `vitest`, sin emuladores y sin red. 36 pruebas. Las de
las acciones viven aparte, en `tests/baseNuevaAcciones.test.ts`, 36 más: cada una nombra lo que
dejaría pasar si no existiera.

| # | Prueba | Falla cuando | El defecto de hoy que habría parado |
|---|---|---|---|
| 1 | Cobertura | Un objeto con propiedades no está cerrado, o un documento lleva una clave no declarada | Las 986 rutas no declaradas de 1.088 |
| 2 | Sin centinelas | Un vocabulario admite un centinela, un campo admite `null`, una fecha no lleva patrón ISO, o un campo opcional no dice por qué puede faltar | `Not Benchmarked`; `inception_date: '0000-00-00'` |
| 3 | Unidad coherente | Una hoja no declara `x-unit`, dos rutas de la misma magnitud declaran unidades distintas, un nombre lleva la unidad dentro, o una fracción no declara rango | Las dos volatilidades a 3 años, una en % y otra en decimal |
| 4 | Sin agregado abierto | Una lista no declara `maxItems` o pasa de 500; un mapa no declara `maxProperties` | Los cuatro techos: `fund_data_quality`, `admin_asset_inventory`, `search_index` y `holdings/latest` |
| 5 | Un dato, un sitio | Un documento declara dos nombres que significan lo mismo, o repite su propia clave | `asset_id` = `identifiers.isin`; la TIR con nombre español e inglés en el mismo bloque |
| 6 | Capa y dueño | Una ruta no declara las dos, o el dueño no encaja con la capa | Un 1-7 declarado por el emisor escrito en un campo calculado llamado `srri` |
| 7 | Base de rentabilidad | Un esquema con rentabilidades no exige `return_basis` | Las 540 clases de 844 que no dicen si reparten o acumulan |

Más seis invariantes que el contrato sostiene y las pruebas comprueban: la divisa base es una
constante, el euro entra como divisa y no como ISIN ficticio, el libro admite exactamente los
tipos del vocabulario y ninguno más, el diccionario de un depositario traduce a esos mismos
tipos, el depositario entra por id opaco, y el texto libre del extracto **no tiene dónde
guardarse**.

Las tres que fallaron la primera vez que se ejecutaron eran defectos de verdad de estos
contratos —once campos opcionales sin `x-absence`, dos nombres con la divisa dentro
(`cash_amount_eur`, `cash_eur`) y dos fracciones sin rango—, y están arregladas. Eso es lo que
tienen que hacer.

## Lo que esto NO resuelve todavía

Dicho sin adornos, porque la mitad del valor de este paso es saber qué falta:

- **El escritor existe pero no escribe.** Desde el 01-11 hay mapper, dos puertas y un
  dry-run (`npm run dryrun:base-nueva`, paso 4): pasa el canónico entero y cuenta lo que
  saldría, sin tocar Firestore. Medido: 769 instrumentos, 8.591 documentos, los 8.591 pasan
  las dos puertas, 5,9 MB en total y 3.679 bytes el documento mayor. Lo que falta es la
  etapa que sí escribe, con su puerta de entorno y la allowlist de proyecto delante.
- **Las nueve rutas de cada bloque `declared/*` no están completas al nivel de campo.** Están
  los campos que el diseño nombra y los que `CAMPOS_NECESARIOS_2026-10-30.md` mide; los que
  hoy existen en la maestra y no aparecen en ninguno de los dos **no se han inventado**: se
  añaden cuando la migración los encuentre, con su unidad y su dueño declarados.
- **El almacén analítico no tiene contrato.** Parquet no valida contra JSON Schema, así que
  las cinco tablas (`price_series`, `portfolio_valuations`, `instrument_holdings`,
  `issuer_fundamentals`, `fx_rates`) necesitan su propia forma de declararse y de comprobarse.
  Es trabajo aparte.
- **La comprobación de cobertura de verdad es de ejecución**, no de contrato: la de aquí
  garantiza que los documentos están cerrados, que es lo que hace imposible escribir una ruta
  no declarada. La que compara lo escrito con lo declarado vive con el escritor.
- **De F1, lo que queda abierto con las acciones dentro:**
  - **El rendimiento del dividendo está declarado en dos contratos.** `declared/dividends.yield_12m`
    (dividendo entre precio, del instrumento) e `issuers/{id}/fundamentals/latest.dividends.dividend_yield`
    (del resumen de fundamentales, de la empresa). Hoy no choca porque `issuers` está vacío, y la
    quinta prueba no lo caza porque son documentos distintos. **Lo decide F6**, con esto escrito
    delante: si el resumen de fundamentales se puebla tal cual, habrá la misma magnitud en dos
    rutas. La línea que ya usa este diseño dice que gana el instrumento, porque un rendimiento
    se calcula sobre el precio de un listado.
  - **El sitio de los fundamentales es agnóstico a la fuente, y eso basta; lo que no tiene sitio
    es que la fuente no sea oficial.** `issuer-fundamentals.v2.source` es texto libre, así que
    acepta `yahoo` igual que aceptaría un proveedor con licencia: por ese lado no hay nada que
    cambiar, y la decisión de que los fundamentales de una acción salgan de **Yahoo** y que
    EODHD quede para el símbolo y las cotizaciones entra sin tocar el contrato.
    Lo que el contrato **no** puede decir es que esa fuente no es oficial. El extractor sí lo
    dice de sí mismo: `_resumen_fundamentales_yahoo` escribe
    `fundamentales.quality.warnings = ["unofficial_source:yahoo"]` en cada pasada, y ninguna de
    las diez rutas de `issuer-fundamentals.v2` tiene dónde recogerlo. Medido el 01-11-2026 sobre
    las 73: **71 traen `source: eodhd` y ningún aviso**, y 2 traen `source: yahoo` con
    `fallback_source:yahoo` —que es otra marca y otra afirmación: «hubo que recurrir a la
    suplente», no «la fuente no está licenciada»—. Así que hoy el aviso que importa está en
    **cero** registros y aparecerá en los 73 en cuanto se refresquen.
    No se añade el campo ahora, por la regla de arriba: un campo que nada escribe no se inventa,
    se añade cuando la migración lo encuentre. Queda escrito para que **F6** lo decida con esto
    delante, porque es la forma de los cinco defectos que motivan esta base —un PER de una
    fuente no licenciada archivado junto a uno que sí lo está, sin que el dato diga cuál es
    cuál— y porque son dos marcas con dos significados, no una. No está en `declared/size` —que es de fondos y mide
    otra cosa— ni en `issuer-fundamentals.v2.valuation`, que declara PER, PB, PS y EV/EBITDA
    pero no la capitalización. El dato existe en las 73.
  - **Nada afirma dónde está constituida una empresa.** `declared/equity.listing.country` es el
    país del **mercado**, medido. El domicilio haría falta para fiscalidad y para distinguir
    casos como Ferrovial, que cotiza en Madrid y está constituida en Países Bajos.
  - **Una acción no tiene con qué medirse.** `computed/metrics.relative` no aplica porque no hay
    benchmark de folleto. Elegir un índice por sector o por mercado es una decisión de Óscar y
    tendría que quedar registrada como tal; mientras no exista, no hay beta ni alpha de acciones.
  - **El `risk_free_source` de 70 acciones viaja ausente.** El valor del tipo sí está en el
    canónico; la etiqueta no, porque la pasada que produjo esas cifras es del 18-07-2026 y el
    extractor empezó a sellarla el 14-10. Lo cierra la siguiente pasada sola.

- **Una desviación del documento, dicha:** el diseño dejaba `holdings_summary` en la raíz de
  `instruments`. Aquí no está: vive en `declared/holdings`, y la raíz se queda en identidad,
  identificadores, clasificación y producto. Es el mismo argumento que retiró los punteros —la
  tarjeta de lectura los hace innecesarios— y dejarlo en los dos sitios habría sido el mismo
  dato en dos rutas, que es justo lo que caza la quinta prueba.

## Versionado

`v2` porque es un cambio incompatible con `master/*`, que se queda donde está y sigue siendo
la forma de la maestra de hoy. No se edita un contrato vigente en silencio: `v2.1` añadiría
campos compatibles, y un cambio incompatible pediría `v3`.
