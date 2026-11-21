> **Histórico de BDB: no se ejecuta.** Las órdenes contra BDB que cita esta auditoría son la evidencia de lo que se cerró, y no se siguen. Se conserva como registro (decisión 106, 05-11-2026).

# Auditoría del programa y del proyecto

*3 de noviembre de 2026. Escrita por Claude Opus 5 con el papel que fija `AGENTS.md`:
gestor de carteras, analista cuantitativo y arquitecto de software. **Es un informe: no se
ha arreglado nada.***

Antes de concluir se leyeron enteros `AGENTS.md`, las diecisiete decisiones de
`DECISIONES_BASE_NUEVA_2026-11-01.md`, `METODO_PROPIO_METRICAS_2026-11-01.md` con sus §9 y
§10 del 03-11, `LEGADO_CONOCIMIENTO_SISTEMA_2026-07-12.md` y
`DEFINICION_DEL_SISTEMA_2026-10-29.md`.

**Cómo leer las marcas.** **Medido** = contado sobre el código o sobre una de las dos bases,
con el comando o el fragmento al lado. **Leído del código** = deducido de leer el código, sin
ejecutarlo. **Hipótesis** = no se pudo comprobar en esta sesión, y se dice qué haría falta.
Lo que ya estaba medido en los documentos del proyecto no se repite salvo para contradecirlo.

Lo medido se obtuvo por REST de solo lectura contra los dos emuladores —`127.0.0.1:8082`
(`gestor-activos-local`) y `127.0.0.1:8092` (`bdb-gestor-de-activos`)—, con
`npm run audit:base-nueva`, `npm run baseNueva:plan`, `npm test` y `npm run typecheck` en las
dos partes. **No se escribió en ninguna base, no se abrió ninguna puerta, no se commiteó
nada.**

---

## 0. Lo crítico, al principio

### C-1 · La barrera que el `README.md` llama «la más importante de todas» es la única que no está en código, y su valor por defecto es el proyecto de producción de BDB — en el cliente de ESCRITURA

**Medido.** Ocho módulos de las Cloud Functions resuelven el proyecto de la maestra así:

```
functions_python/admin_panel.py:26
functions_python/integrity_check.py:40
functions_python/master_write_client.py:20     <-- el cliente de ESCRITURA
functions_python/metrics_refresh.py:75
functions_python/price_refresh.py:51
functions_python/search_index.py:18
functions_python/system_status.py:11
functions_python/readmodel/firestore_client.py:22

MASTER_PROJECT_ID = os.environ.get("MASTER_PROJECT_ID", "bbdd-activos-financieros")
```

`bbdd-activos-financieros` es el proyecto Firebase **real y en uso** de BDB, el que `AGENTS.md`
prohíbe tocar sin excepción. **No hay ni una línea de código que lo rechace**: ni una
comprobación al importar, ni una guarda en `get_master_write_db()`, ni una prueba. Lo único que
lo corrige es `MASTER_PROJECT_ID=gestor-activos-local` en `functions_python/.env`.

Y aquí está lo que lo convierte en hallazgo y no en la nota que ya lleva `AGENTS.md`:

1. **Nada en Python carga ese `.env`.** Medido: `grep -rn "dotenv\|load_dotenv" --include="*.py"`
   sobre `functions_python/` (sin `venv/`) no devuelve **ninguna** línea. El `.env` lo lee la
   **CLI de Firebase** al arrancar los emuladores o al desplegar. Un punto de entrada de Python
   ejecutado directamente —un script de `functions_python/scripts/`, un `pytest`, una prueba
   suelta— recibe el entorno del shell, y si la variable no está puesta a mano, **el valor por
   defecto es el de BDB**.
2. **`scripts/migrate_metrics_latest.py:72`** hace
   `from price_refresh import MASTER_PROJECT_ID` —o sea, hereda el defecto de BDB— y en la
   **línea 544** hace `db = gcf.Client(project=MASTER_PROJECT_ID)` y escribe.
3. **El mismo repositorio tiene dos valores por defecto opuestos para la misma variable.**
   Medido: **8** ficheros ponen `bbdd-activos-financieros` y **3** ponen
   `gestor-activos-local` (`scripts/appcheck_report.py:31`,
   `scripts/migrate_ownership_v12.py:47`, `scripts/migrate_portfolios_uid.py:37`). Alguien ya
   corrigió tres y dejó los ocho de producción.

**Lo que NO es, y conviene decirlo para no exagerar.** `functions_python/.env.example` **sí
está en el repositorio** (`git ls-files` lo confirma), lleva las dos líneas buenas
—`MASTER_PROJECT_ID=gestor-activos-local` en la 43 y `FIRESTORE_EMULATOR_HOST=127.0.0.1:8082`
en la 46— con el motivo escrito, y hay una prueba (`functions_python/tests/test_env_example.py`).
Así que un clon nuevo puede reconstruir la barrera. El defecto no es que se pierda: es **de qué
clase es**.

**Impacto.** Compárese con la barrera 8, `2-plataforma-datos/src/config/projectAllowlist.ts`,
cuya cabecera dice literalmente: «Esta barrera **NO** depende de variables de entorno: está en
el código, así que una variable mal puesta no la abre». La barrera 7, que el `README.md` declara
más importante, es exactamente lo contrario, y protege un camino de **escritura** contra la base
de producción de un cliente real.

**Qué haría.** Una guarda en código, del mismo tipo que la del lado TypeScript: en
`master_write_client.py` y en `readmodel/firestore_client.py`, `raise` si
`MASTER_PROJECT_ID == "bbdd-activos-financieros"`, salvo que esté puesta una puerta de entorno
con su frase entera. Y cambiar los ocho valores por defecto a `gestor-activos-local`: un defecto
que nombra la producción de otro proyecto no es un defecto seguro. Las dos cosas son de una
línea cada una y no cambian ninguna cifra.

### C-2 · Tres `firebase deploy` preaprobados en el clon, dos de ellos contra el proyecto de producción de BDB, con la frase de la puerta ya escrita

**Medido.** `3-BDB-ACTIVOS_app/.claude/settings.local.json` contiene en su lista `allow`:

```
"Bash(BDB_ACTIVOS_ALLOW_FIREBASE_DEPLOY=YES_I_UNDERSTAND_SHARED_PROJECT timeout 900 npx firebase deploy --only hosting --project bbdd-activos-financieros)"
"Bash(BDB_ACTIVOS_ALLOW_FIREBASE_DEPLOY=YES_I_UNDERSTAND_SHARED_PROJECT npx firebase deploy --only hosting)"
"Bash(BDB_ACTIVOS_ALLOW_FIREBASE_DEPLOY=YES_I_UNDERSTAND_SHARED_PROJECT npx firebase deploy --only hosting --project bbdd-activos-financieros)"
```

Son permisos heredados del clon que nadie limpió, y **llevan dentro el valor de la puerta**, así
que la puerta ya no es una puerta. La misma lista lleva además `Read(//c/Users/oanti/.claude/**)`.

`AGENTS.md` dice que `firebase deploy` está denegado, y es verdad en
`.claude/settings.json` de la raíz. **Hipótesis, no comprobada:** creo que la denegación de la
raíz no cubre una sesión cuya carpeta de trabajo sea `3-BDB-ACTIVOS_app`, porque ese
`settings.local.json` es el del proyecto en ese caso. No puedo verificar el orden de precedencia
desde dentro de la sesión; lo que **sí** está medido es que las tres entradas existen con esa
forma y ese valor.

**Qué haría.** Borrar las tres entradas, hoy, sin esperar a resolver la hipótesis. Un permiso
preaprobado hacia la producción de BDB no tiene ningún uso legítimo en este clon, y el coste de
quitarlo es cero.

### C-3 · Herramientas MCP de escritura en Firestore preaprobadas, sin ámbito de proyecto

**Medido.** `.claude/settings.json` de la raíz tiene en `allow`:
`mcp__firebase__firestore_add_document`, `firestore_update_document`,
`firestore_delete_document`, `firestore_create_index`, `firestore_delete_index`.

Ninguna lleva restricción de proyecto. Es un camino de escritura a Firestore que **no pasa por
`projectAllowlist.ts`, ni por `obtenerDb`, ni por las puertas de entorno, ni por la validación
de contratos**. Toda la arquitectura de barreras de `2-plataforma-datos` está construida sobre
la premisa de que la única forma de escribir es a través de sus escritores, y esto es una
segunda puerta al lado.

**Hipótesis:** a qué proyecto apuntaría depende de la resolución del servidor MCP de Firebase.
Hay dos `.firebaserc` en el árbol —`3-BDB-ACTIVOS_app/.firebaserc` dice `gestor-activos-local`
(falso, inofensivo) y `4-base-nueva/.firebaserc` dice `bdb-gestor-de-activos` (**real, en la
nube**)—, así que el destino depende de la carpeta. No lo he comprobado y no lo voy a
comprobar: comprobarlo sería escribir.

**Qué haría.** Quitar las cinco de `allow`. Las de lectura (`query_collection`, `get_document`,
`list_*`, `get_security_rules`) pueden quedarse.

---

## 1. Incoherencias: documento contra código contra base

### A-1 · El Sharpe y el Sortino a diez años son imposibles de calcular, y el método los declara «ausentes por serie corta»

**Impacto: cifra publicada (una ausencia que afirma un motivo falso).**

La §7 del método dice del 10 años: «exige sus 121 cierres de mes consecutivos y por eso quedará
ausente en la mayoría. **Ausente por serie corta, que es una ausencia honesta**».

**Medido sobre la base nueva** (1.091 instrumentos, 645 documentos `EXTRACTOR_MONTHLY_V1`):

| magnitud | 1 año | 3 años | 5 años | **10 años** |
|---|---:|---:|---:|---:|
| volatilidad | 644 | 627 | 609 | **496** |
| caída máxima | 644 | 628 | 613 | **505** |
| rent. anualizada | 644 | 627 | 609 | **504** |
| Sharpe | 620 | 603 | 585 | **0** |
| Sortino | 619 | 603 | 585 | **0** |

496 fondos tienen volatilidad a diez años, o sea que **tienen sus 121 cierres de mes
consecutivos**. Ninguno tiene Sharpe. La serie no es el motivo.

**La causa, leída del código.** El tipo libre de riesgo se pide al BCE desde una fecha fija:
`1-extractor/fetchers/vl_fondos.py:59` → `ESTR_DESDE = "2019-10-01"`, y
`fetchers/eodhd.py:336` → `params={"startPeriod": "2019-10-01", ...}`. Y
`core/metricas.py:306-307` exige el €STR de **todos** los meses de la ventana:

```python
rfs = [rf_mensual(estr, f.year, f.month) for f, _p in tramo[1:]]
if all(x is not None for x in rfs):
```

Una ventana de 120 meses que acaba en septiembre de 2026 empieza en octubre de 2016, tres años
antes de que exista la serie que se pide. **El Sharpe y el Sortino a diez años no podrán salir
hasta octubre de 2029**, hagamos lo que hagamos con las series de precios.

**Y cuesta cobertura.** El contrato declara `sharpe.10y` y `sortino.10y` con
`x-absence: NOT_PROVIDED` (vía `$defs/cifra_ratio` en
`contracts/base-nueva/instrument-computed-metrics.v2.schema.json`), o sea «falta», no «no
aplica». **Medido:** las dos rutas aparecen como ausencia `NOT_PROVIDED` en **los 1.091
instrumentos**, y sacarlas del denominador subiría la cobertura de un fondo **0,474 puntos de
media y 0,617 como máximo**. Es poco: lo que está mal no es la cifra, es que el motivo miente.

**Qué haría.** Dos cosas, y la primera es de documento, no de código:

1. Corregir la §7 del método: la ausencia del 10 años en Sharpe y Sortino **no** es por serie
   corta, es porque el €STR no llega. Es la clase de frase que en marzo manda a alguien a
   buscar series de diez años que ya tenemos.
2. Decidir el motivo de la ausencia. Hay dos caminos defendibles y recomiendo el primero: (a)
   declarar esas dos rutas con un motivo propio —«el tipo libre de riesgo no cubre la
   ventana»—, que es cierto hoy y deja de serlo solo cuando deje de serlo; o (b) traer la serie
   **pre-€STR** del BCE (EONIA empalmado, que el propio BCE publica desde 1999 precisamente
   para esto) y entonces sí calcularlos. (b) es trabajo de verdad y cambia el tipo libre de
   riesgo de una ventana, luego por la §4 **no** es gratis: habría que decidir si esa ventana
   lleva otro identificador de método.

### A-2 · Hay un TERCER estimador en producción, y es el que ve el asesor hoy. Ningún documento lo declara

**Impacto: cifra publicada. Es la más importante de las incoherencias.**

La §3 del método, revisada el 03-11, dice que la identidad comparable de una cifra es el par
`(method, window)` y que nada se ordena contra una cifra de **otro estimador**; y añade: «Lo que
esto arregla de la §4: ... un tercer camino de cálculo quedaría cubierto **el día que exista**
sin que nadie lo recuerde».

**Ese día ya pasó. El tercer camino existe, lleva meses en producción y es el único que la
aplicación lee hoy.**

**Medido sobre la base vieja** (`gestor-activos-local`, 1.097 activos, la que lee la app):

```
activos con algún Sharpe en metrics/latest : 1.090 de 1.097
method declarado en windows.*              : { GEOMETRIC_CAGR: 3.928, TRAILING_PROVIDER: 156 }
frequency declarado en windows.*           : { WEEKLY: 4.162, PROVIDER: 156, DAILY: 8 }
```

`EXTRACTOR_MONTHLY_V1` es mensual ×√12. `EXTRACTOR_DAILY_V1` es diario ×√252. Y esto es
**semanal ×√52 con rentabilidad geométrica**, calculado por las Cloud Functions, no por el
extractor: `3-BDB-ACTIVOS_app/functions_python/ingest_asset.py:465-519`
(`_window_metrics`, con `weekly_sampling.window_volatility` y
`weekly_sampling.ex_post_sharpe`), refrescado por `metrics_refresh.py`. El `METODO_PROPIO`
describe dos métodos y dice que `core/metricas.py` «contiene hoy **dos**». El sistema tiene
**tres**, y el tercero es el único publicado hoy.

Contando las implementaciones de volatilidad anualizada que hay en el árbol: **cinco**, con
**tres** factores distintos —`core/metricas.py:301` (√12), `core/metricas.py:455` (√252),
`optimization/improvement_engine.py:202` (√52), `portfolio_horizon.py:159` (√52),
`portfolio_real/engine.py:662` (`ANNUALIZATION_FACTOR`, que es 52)—.

**Qué haría.** Darle nombre y versión al tercero en el propio `METODO_PROPIO`
—`APP_WEEKLY_V1` o como se decida— con su tabla de parámetros al lado de los otros dos, y
decir en una línea cuál se publica en cada base. No es trabajo de código: es que el documento
que define «el método es nuestro» describa el método que de verdad está publicado. Mientras no
tenga nombre, la regla de la §3 no se puede hacer cumplir contra él, porque no se le puede
nombrar en una comprobación.

### A-3 · La clave de comparabilidad del comparador no incluye la divisa

**Impacto: cifra publicada. Es una comprobación que no puede fallar donde más duele.**

Esto es lo bueno: la aplicación **sí** implementa la regla de la §3, y antes de que la §3 se
escribiera. `3-BDB-ACTIVOS_app/src/core/metricsMethodology.ts` avisa cuando las cifras de una
columna no salen del mismo cálculo, y `AssetComparison.tsx:327` lo llama con el Sharpe a 3
años. (De paso: la §3 dice que la regla está «escrita y **no hecha cumplir en código**». Para
el camino de la base nueva es cierto; para el camino que la app usa hoy, **no**.)

Lo que está mal es la clave. Medido en `metricsMethodology.ts:37` y `:39`:

```typescript
const methods = [...new Set(withValue.map((row) => row.method ?? ""))];
const frequencies = [...new Set(withValue.map((row) => row.frequency))];
```

El par es `(method, frequency)`. **La divisa no entra.** Y la §3 exige «misma divisa, mismo tipo
libre de riesgo, misma ventana, misma fecha de cierre y mismo estimador». El modelo de lectura
tampoco la proyecta: `functions_python/readmodel/mappers.py:231-241` saca `metrics_method` y
`metrics_frequency` de las ventanas y **no saca la divisa de la métrica**.

Consecuencia concreta: dos cifras medidas en divisas distintas llevan el mismo `GEOMETRIC_CAGR`
+ `WEEKLY`, el aviso sale `mixed: false`, y el comparador las declara comparables. **La guarda
contesta «son comparables» sin haber comprobado la condición que la §3 pone primero.**

**Atenuante medido, y es importante:** hoy esto no produce una cifra mala, porque la serie de la
base vieja **ya está en euros** (ver A-4). Pero la guarda no lo sabe: no comprueba la divisa, así
que si mañana entra una cifra sin convertir —y la base nueva está llena de ellas, ver A-5— la
guarda seguirá diciendo que todo es comparable.

**Qué haría.** Añadir la divisa de la métrica al modelo de lectura y a la clave de
`describeMetricsMethodology`. Son dos campos y una línea, y convierten una guarda que no puede
fallar en una que sí.

### A-4 · La base vieja ya hace lo que la decisión 10 declara «decidido y no construido» — pero con otra fuente de tipos de cambio

**Impacto: una decisión tomada que el sistema ya incumple por otro lado.**

La decisión 10 y la §5 del método dicen: las métricas se calculan en euros, convirtiendo la serie
con los **tipos de referencia del BCE**, y hay que declarar `fx_source: ECB_REFERENCE`. La §5
añade: «`core/metricas.py::a_eur` ya existe y está probado... Hoy **no lo llama nadie** en
producción».

Las dos frases son ciertas del extractor. Y las dos juntas dan a entender que el sistema no
convierte a euros. **Lo hace, y lleva meses haciéndolo.**

**Medido**, serie de AT&T (`US00206R1023`) en la base vieja, documento
`EODHD_T.US_REFRESH_2026`:

```
currency: "EUR"   source_currency: "USD"   fx_pair: "EURUSD.FOREX"
fx_policy: "price_EUR = (price_source * scale) / EURMAJOR.FOREX"
punto: { date: 2026-08-21, source_value: 25.0073, fx_rate: 1.16764, value: 21.416961 }
```

Y está **bien hecho**: comprobado a mano con HSBC (`GB0005405286`),
`1518.4 GBX × 0,01 / 0,8562 = 17,734` y el documento dice `value: 17.734174`. El submúltiplo
—`minor_scale: 0.01` para GBX— está tratado correctamente, que es donde suele romperse.

El problema es la **fuente**: `functions_python/price_refresh.py:198-199`,
`_fetch_fx` → `fetch_eod(_fx_pair(ccy))`, o sea **EODHD** (`EURUSD.FOREX`), no el BCE. Así que:

- Hay **dos implementaciones** de la conversión a euros: `core/metricas.py:148` (`a_eur`, tipos
  del BCE `EXR D.X.EUR.SP00.A`, tolerancia de 7 días, **nadie la llama**) y
  `price_refresh.py:222` (`_convert_eur`, tipos de EODHD, **en producción**).
- Construir la §5 tal como está escrita produciría un **segundo juego de cifras en euros medidas
  con otra fuente de cambio** que, por la regla de la escala única de la §3, no serían
  comparables con las que ya están publicadas.

**Qué haría.** Decidir la fuente de cambio **antes** de construir la §5, y escribir la decisión:
o (a) el BCE, y entonces las series de la base vieja hay que reconvertir, o (b) EODHD, y
entonces la §5 y la decisión 10 cambian `ECB_REFERENCE` por lo que de verdad se usa y `a_eur` se
retira. Recomiendo (a) —el BCE es la fuente de referencia oficial, es gratis, ya la usamos para
el €STR y una cifra de cliente se defiende mejor contra un tipo oficial que contra el de un
proveedor comercial— **pero con la vista puesta en A-7**: el efecto es mucho menor de lo que la
§5 sugiere, así que no es urgente.

### A-5 · La base nueva es, en esto, una regresión sobre la vieja

**Impacto: cifra publicada, el día que la app lea la base nueva.**

**Medido** en la base nueva, `computed/metrics.inputs.currency` frente a
`instrument.identity.currency` (0 descuadres, las dos dicen lo mismo):

| tipo | inputs.currency | n |
|---|---|---:|
| FUND | EUR | 621 |
| STOCK | EUR | 198 |
| **STOCK** | **USD** | **87** |
| **FUND** | **USD** | **24** |
| **STOCK** | **GBX** | **5** |
| **STOCK** | **CHF** | **4** |
| **STOCK** | **CAD** | **3** |

**123 instrumentos tienen sus métricas en la divisa de la clase en la base nueva**, mientras los
mismos instrumentos las tienen **en euros** en la base vieja. La migración, tal como está, pierde
la normalización a euros que el sistema de hoy ya tiene. Y la decisión 10 existe justamente para
que eso no pase: `base_currency` de una cartera es `const EUR`.

**Qué haría.** Que la decisión 10 suba de prioridad **en el orden de la migración**, no en
abstracto: no hace falta antes de que la app lea la base nueva, pero sí antes de que la lea para
construir carteras. Y escribirlo así en `PLAN_EJECUCION`: hoy la decisión 10 figura como una
mejora y es, en realidad, un requisito de la migración.

### A-6 · La puerta de la divisa del Sharpe vive en capas distintas en los dos caminos, y en uno de ellos el número malo sí se escribe

**Impacto: deuda interna con efecto en dos puertas de calidad. Leído del código y medido en la base.**

En el camino de **fondos** la puerta está en el extractor,
`1-extractor/fetchers/vl_fondos.py:333`:

```python
_escribe_riesgo(out, s, estr(http) if div == "EUR" else [])
```

Sin €STR no se calcula nada: el número que mezcla divisas **nunca existe**. Y hay un aviso
explícito al lado (`aviso_sharpe`, línea 335).

En el camino de **acciones** la puerta está en la plataforma,
`2-plataforma-datos/src/ingestion/baseNueva/mapper.ts:1883-1884`:

```typescript
const enEuros = divisa === 'EUR';
const sharpe = enEuros ? porVentanaDelFondo(riesgo['sharpe'], num) : undefined;
```

Y el extractor, en `1-extractor/fetchers/eodhd.py:443`, pasa el €STR **sin mirar la divisa**:

```python
m = metricas_diarias(puntos, anos, estr_puntos)
```

O sea: para una acción en dólares el extractor **sí calcula y sí escribe en el canónico** un
Sharpe cuyo numerador resta un tipo en euros a una rentabilidad en dólares, y es la plataforma
la que lo tira en la puerta. Medido en la base nueva: 0 de 87 acciones USD tienen Sharpe, luego
la puerta funciona. Pero el número existe antes de la puerta, y lo leen:

- `1-extractor/core/exporta.py:348` → `"sharpe_3a"`, que va al paquete de exportación.
- `1-extractor/core/visor.py:134` → la columna «Sharpe 3a» del visor.
- `1-extractor/core/informe.py:214`.
- **Dos puertas de calidad que condicionan con él**: `core/adaptador_bdb.py:986` y
  `core/update.py:50`, las dos exigen `riesgo.sharpe.3a.fondo` para declarar
  `history_quality_status = COMPLETE`. (La §9 del método ya nombra estas dos; lo que añado es que
  para una acción no-EUR el `COMPLETE` se apoya hoy en una cifra que la plataforma se niega a
  publicar.)

Y hay un residuo medible del mismo asunto: **99 documentos `computed/metrics` de acciones
declaran `inputs.risk_free_source: "ESTR_EUR"` sin tener ningún Sharpe**. Medido: los 99 son
STOCK, y son exactamente las 87 USD + 5 GBX + 4 CHF + 3 CAD. Se declara el ingrediente de una
cifra que no existe.

De paso, un comentario que ha quedado atrás: el bloque de `mapper.ts:1866-1881` habla de «las
73» acciones y «las 2 que cotizan en dólares». Hoy son **305 y 87**. Es un comentario que
cuantifica y está desviado cuatro veces; en este proyecto los comentarios con cifras se usan
como medición, así que conviene fecharlos o quitarles el número.

**Qué haría.** Mover la puerta al extractor, igual que en los fondos: en `eodhd.py:443`, pasar
`estr_puntos if divisa == "EUR" else None`, y escribir el `aviso_sharpe` que el camino mensual
ya escribe. Es una línea, no cambia ninguna cifra publicada (la plataforma ya las tira) y quita
el número incoherente de los seis sitios que hoy lo leen. **Pero no antes de la §9**: la §9 va a
retirar el Sharpe de las acciones entero, y las dos puertas de calidad cambiarían dos veces. Se
hace una vez, con la §9, y en la misma pasada se quita `risk_free_source` de los 99.

### A-7 · Medir en euros SÍ sube la volatilidad, y sube mucho menos de lo que el método sugiere. Medido

**Impacto: cambia la prioridad de la decisión 10. Es la medición que más me ha sorprendido.**

La §5 del método dice: «La volatilidad de una clase en dólares medida en euros **incluye la del
EUR/USD —del orden del 7-9 % anualizado**». Es verdad, y se lee como si la volatilidad subiera
en ese orden. No sube.

Lo medí de la forma que no confunde dos cosas. Cada punto de las series de la base vieja lleva
**las dos columnas**: `source_value` (divisa del listado) y `value` (euros). Así que calculé
**la misma** volatilidad —retornos semanales ISO, ×√52, ventana de 3 años— sobre las dos
columnas de la **misma** serie. El estimador es idéntico por construcción; lo único que cambia es
la divisa.

| divisa | n | vol en su divisa | vol en EUR | **mediana(EUR − divisa)** | mín | máx |
|---|---:|---:|---:|---:|---:|---:|
| USD | 83 | 28,15 | 28,36 | **+0,26** | −0,76 | +1,87 |
| **EUR (control)** | **22** | **25,60** | **25,60** | **0,00** | **0,00** | **0,00** |
| CHF | 4 | 24,31 | 24,59 | +0,28 | −0,58 | +0,48 |
| GBX | 4 | 24,79 | 25,14 | +0,50 | +0,24 | +0,52 |
| CAD | 3 | 16,86 | 17,65 | +1,05 | +0,80 | +1,06 |
| AUD | 2 | 24,05 | 26,26 | +2,21 | +1,56 | +2,21 |

El control de 22 acciones en euros da **0,00 exacto** en los 22, que es la prueba de que la
medición está bien: convertir una serie que ya está en euros no mueve nada.

**Dos lecturas, y las dos importan.**

1. **El signo del supuesto del proyecto es correcto**: medir en euros sube la volatilidad. Lo
   escribo porque hoy se discutió lo contrario en otra sesión y es falso: la conversión no deja
   de importar.
2. **La magnitud es pequeña, y el 7-9 % no se traslada.** La razón es aritmética y conviene
   dejarla escrita: la varianza en euros es `var(activo) + var(fx) + 2·cov(activo, fx)`. Con una
   volatilidad de 28 % y un EUR/USD al 8 %, si fueran independientes saldría
   `√(28² + 8²) = 29,1`, o sea **+1,1 puntos**. Medido salen **+0,26**, luego la covarianza es
   **negativa**: cuando la bolsa americana cae, el dólar se fortalece, y en euros la caída se
   amortigua. Es el comportamiento conocido del dólar como activo refugio, y aquí está medido.

**Qué haría con esto.** No bajar la decisión 10 —sigue siendo la única escala coherente para
agregar una cartera, que es su argumento y es correcto— pero **sí** dejar de tratarla como una
corrección de riesgo mal medido. Para 87 acciones en dólares, el efecto a tres años es un cuarto
de punto. Y corregir la frase de la §5: el 7-9 % es la volatilidad del cruce, no lo que se añade
a la cifra. Tal como está, invita a esperar un cambio diez veces mayor del que hay.

**Límite de esta medición, declarado:** es la ventana de 3 años y la muestra son las acciones de
la base vieja con las dos columnas y al menos 400 puntos en la ventana. A un año el efecto puede
ser mayor, porque la correlación con el cruce no es estable. No lo he medido.

### A-8 · La decisión 12 no está sin construir: el contrato la prohíbe

**Impacto: cifra que un asesor espera y no existe, con el campo de tres estados que la propia decisión pide ausente.**

La decisión 12 (02-11) dice que una acción se mide contra el índice ancho de su mercado, que
**215** acciones llevan índice de área y **87** van sin referencia, y que **la etiqueta tiene
que ser un campo y no una ausencia, porque los estados son tres y no dos**.

**Medido:** **0 de 305** acciones tienen `metrics.relative` en su tarjeta. Y no es que falte:
el contrato lo **excluye**. En
`contracts/base-nueva/instrument-computed-metrics.v2.schema.json`, el bloque `relative` lleva
`x-applies-when: "FONDO_O_ETF"`, y `src/ingestion/baseNueva/aplicabilidad.ts:30` lo define como
`instrument_type === 'FUND' || instrument_type === 'ETF'`. Para una acción el predicado es falso,
la ruta sale del denominador y el bloque no se puede escribir.

O sea que las 305 acciones están hoy en el estado 2 de la decisión 12 —«sin referencia porque
sabemos que no tenemos la suya»— incluidas las **215** que deberían estar en el 1. Es
exactamente el defecto que la decisión 12 existe para evitar, escrito en el contrato.

**Qué haría.** Cuando se aborde la decisión 12: cambiar `relative` a un predicado que admita
acciones y añadir el campo de los tres estados que la decisión pide. Y mientras no se aborde,
anotarlo en la decisión 12 como «bloqueado por el contrato», no como «pendiente de construir»:
son dos cosas distintas y la segunda se lee como más fácil de lo que es.

### A-9 · La decisión 3 afirma que el emisor de acciones está poblado. Está vacío

**Medido** (`npm run audit:base-nueva`): `declaradas y aun vacias : 6 (clients,
custodian_dictionaries, instrument_aliases, instrument_issuer, issuers, quality_rollup)`. Cero
documentos en las dos colecciones de entidad, con 305 acciones y 300 documentos
`declared/equity` en la base.

La decisión 3 dice: «`issuers` admite los tres [papeles], pero **solo `EQUITY_ISSUER` tiene
fuente**. Los otros dos quedan declarados y vacíos». Se lee como que uno de los tres está
poblado. Los tres están vacíos. El código es honesto —`scripts/runBaseNuevaDryRun.ts:217`
imprime literalmente «El alfa no puebla issuers»—; es la decisión la que se adelanta.

**Qué haría.** Una línea en la decisión 3: a 03-11-2026, ninguno de los tres papeles está
escrito. Coste cero y evita que alguien construya encima.

### A-10 · `series_adjustment` excluye a los 18 ETF, que son justo los que lo necesitan igual que una acción

**Leído del código.** `inputs.series_adjustment` lleva `x-applies-when: "ACCION"`, y
`aplicabilidad.ts:46` define `ACCION` como `instrument_type === 'STOCK'`. Así que para un ETF el
campo «no aplica».

Pero el ETF es un instrumento **cotizado**: su serie es una serie de mercado y necesita la misma
declaración de ajuste por desdoblamientos y dividendos que la de una acción. Y lo dice el propio
`mapper.ts:1925-1931`: «Una fuente que no esté en la tabla no escribe métricas, porque una serie
sin ajustar da rentabilidad de solo precio y **publicarla como retorno total es el defecto de
siempre con otra cara**». El día que los 18 ETF tengan métricas —la §4 del método dice que
`EXTRACTOR_DAILY_V1` es «acciones **y ETF**»— el campo que da derecho a llamarla retorno total
estará declarado como no aplicable para ellos.

De paso, otra desviación del documento: **medido, los 297 documentos `EXTRACTOR_DAILY_V1` son
todos STOCK. Ningún ETF usa el camino diario.** La §4 dice que es de «acciones y ETF»; hoy es
solo de acciones, y los 18 ETF no tienen ninguna métrica propia (hueco ya conocido).

**Qué haría.** Cambiar el predicado de `series_adjustment` a uno que cubra lo cotizado —`ACCION`
u `ETF`—, antes de calcular las métricas de los ETF y no después.

---

## 2. Comprobaciones que no pueden fallar

### B-1 · La auditoría comprueba que la maestra sigue en su sitio leyendo la base equivocada, y dice 0

**Medido. Es el hallazgo más claro de esta categoría.**

`2-plataforma-datos/scripts/runBaseNuevaAudit.ts:329-332`:

```typescript
/* Y que la maestra de hoy sigue donde estaba: la base nueva vive al lado, no encima. */
const assets = await db.collection('assets').get();
console.log(`assets (la maestra de hoy, sin tocar)  : ${assets.size}`);
```

`db` es `obtenerDb()`, que impone el emulador de la **base nueva**, `127.0.0.1:8092`. La
colección `assets` está en la **base vieja**, `127.0.0.1:8082`. Salida real de
`npm run audit:base-nueva`, ejecutado hoy:

```
assets (la maestra de hoy, sin tocar)  : 0

La base nueva valida entera contra su contrato.
```

La base vieja tiene **1.097** `assets`, medidos en la misma sesión. La línea que dice comprobar
que la maestra está intacta **no puede dar otra cosa que 0**, no entra en el veredicto
`todoBien`, y quien la lea de pasada concluye que la maestra está vacía. Es el mismo defecto que
el chequeo de PowerShell sin las llaves de `${coleccion}`: una respuesta normal afirmando lo
contrario de lo que pasa.

Y hay una pista de que el autor creía que la consulta encontraría algo: en la línea **192** hay
una excepción escrita a propósito para esa colección —
`if (coleccion.id !== 'assets') sinContrato.push(...)`, con el comentario «`assets` es la
maestra de hoy y se cuenta aparte, al final»—. Es código muerto para una colección que en esa
base no puede estar.

**Qué haría.** O la cuenta contra `HOST_EMULADOR_BASE_DE_SIEMPRE` (la constante ya existe en
`projectAllowlist.ts:100`, y su comentario dice que es «para **leer**»), con un número esperado
distinto de cero y entrando en `todoBien`; o se quita la línea y la excepción. Lo que no puede
quedarse es una comprobación cuyo resultado correcto y cuyo resultado roto son el mismo.

### B-2 · Un fallo del BCE deja a TODAS las acciones sin Sharpe para siempre, en silencio. La misma avería ya se corrigió en los otros dos sitios

**Leído del código. Es la duplicidad con peor consecuencia.**

El €STR se trae en **tres** implementaciones independientes, y las tres aprendieron la misma
lección menos una:

| dónde | caché | ante un fallo del BCE |
|---|---|---|
| `1-extractor/fetchers/vl_fondos.py:146` | en el objeto HTTP de la pasada | **reintenta**: `return []` *sin guardar*, con el motivo escrito («auditoría 28-10, H13») |
| `3-BDB-ACTIVOS_app/functions_python/ecb_rates.py:53` | global con TTL de 6 h | **reintenta a los 5 min**: `_ESTR_NEGATIVE_TTL_SECONDS`, con el motivo escrito («un unico fallo dejaba sin rf toda la maestra») |
| **`1-extractor/fetchers/eodhd.py:329`** | **global de módulo** | **nunca reintenta**: `_ESTR_CACHE = []` en las líneas 340 y 344, y la 332 devuelve la lista vacía para siempre |

El tercero es el camino de **todas las acciones**. Con `_ESTR_CACHE = []`,
`metricas_diarias` recibe `estr=[]`, `rf_medio_pct` devuelve `None`, y `core/metricas.py:460`
—`sharpe = ... if vol and rf_pct is not None else None`— deja el Sharpe en `None`. La
plataforma lo recibe vacío y **no se queja**: la ausencia es idéntica a la legítima, la de una
acción fuera del euro. Una caída de la API del BCE durante la pasada y 198 Sharpe desaparecen
sin un solo aviso.

Y es un proceso de vida larga: `1-extractor/ops_server.py` levanta un servicio en
`127.0.0.1:8766` que la app consume desde *Sistema › Operaciones*, o sea el escenario exacto que
el comentario de `vl_fondos.py` dice que se arregló.

**Qué haría.** Dos líneas: no guardar `[]` en `_ESTR_CACHE` (igual que `vl_fondos`), y escribir
un aviso en el canónico cuando el €STR no se pudo traer, para que la ausencia del Sharpe diga de
qué clase es. Lo segundo es lo que convierte el fallo en visible, que es lo que falta.

### B-3 · El procedimiento de arranque existe dos veces, y la copia obsoleta no sabe que hay una segunda base

**Medido.** `.agents/skills/` y `.claude/skills/` tienen las **dos** habilidades que `AGENTS.md`
manda usar, con contenidos distintos:

```
 99 .agents/skills/arrancar-entorno/SKILL.md     288 .claude/skills/arrancar-entorno/SKILL.md
147 .agents/skills/pipeline-extractor/SKILL.md   299 .claude/skills/pipeline-extractor/SKILL.md
```

`.agents/` está sin seguimiento en Git (`git status` → `?? .agents/`). Y lo que le falta a su
copia de `arrancar-entorno` no es relleno: **no menciona el 8092, ni el 4402, ni
`bdb-gestor-de-activos`**. Su chequeo de puertos (línea 23) comprueba `5174, 8082, 9097, 5005`:
la mitad del sistema no existe para ella. Quien lea esa copia da el entorno por bueno con la
base nueva apagada.

**Qué haría.** Borrar `.agents/`, o dejar un fichero de una línea que apunte a `.claude/skills/`.
Dos procedimientos operativos divergentes para el mismo arranque es la clase de duplicidad que
este proyecto ya pagó con el literal del proyecto en dieciséis ficheros.

### B-4 · La afirmación medida del chequeo de puertos no se reproduce

**Medido.** `.claude/skills/arrancar-entorno/SKILL.md:37-38` dice: «`Get-NetTCPConnection -State
Listen` **no lista** ni el 8082 ni el 8092... porque los abre la JVM del emulador». Ejecutado hoy,
con los dos emuladores vivos:

```
Test-NetConnection 8082 = True     listen 8082 = True
Test-NetConnection 8092 = True     listen 8092 = False
Test-NetConnection 9097 = True     listen 9097 = False
```

La trampa es real —`Get-NetTCPConnection` da el 8092 y el 9097 por caídos cuando contestan— pero
**el 8082 sí aparece**, al contrario de lo que dice la habilidad. La dirección del consejo es
buena y el detalle medido no se sostiene. En un proyecto cuyo estándar es que lo medido se pueda
reproducir, una medición de la propia habilidad operativa merece el mismo rigor que una del
dato.

Dicho lo bueno: `Test-NetConnection` acierta en los cuatro, y es el que usa la copia
**obsoleta**. El criterio correcto es el de la copia nueva —preguntar por HTTP a cada base y
comprobar que trae su colección, que es lo que hace en las líneas 52-53— y ese sí es
infalsificable: un puerto equivocado devuelve otra colección.

### B-5 · Lo que SÍ está bien diseñado en esta categoría, y conviene no tocarlo

Tres piezas que resisten la pregunta «qué tendría que pasar para que fallara»:

- **`4-base-nueva/probar-reglas.mjs`.** Razona en su cabecera por qué `Bearer owner` no prueba
  ninguna regla —«con él todo funciona igual de bien con las reglas abiertas que cerradas»—,
  forja un token sin firma para probarlas de verdad, y **declara lo que no puede comprobar**:
  «el emulador no exige índices. Una consulta filtrada que aquí contesta 200 puede fallar en la
  nube pidiendo un índice». Eso es exactamente la lente de esta auditoría, aplicada por el autor
  antes de que nadie se la pidiera.
- **La guarda `NO_RATE`.** `metrics_refresh.py:232-239` detecta un Sharpe con tasa 0 y **no
  escribe el documento**; está aplicada en cinco sitios (`metrics_refresh`, `history_backfill`,
  `migrate_metrics_latest`, `improve_fund_data`, el dry-run). Es la misma clase de defecto que
  B-2 y aquí sí está cerrada.
- **`scripts/subirALaNube.ts`.** Puerta con frase entera, **rechaza una clave de servicio de
  BDB** (línea 249), borra `FIRESTORE_EMULATOR_HOST` a propósito y con el motivo escrito (264),
  no sube nada que no valide (306), y verifica **por recuento** y no por muestra, con el
  argumento escrito: «una muestra de uno de cada siete habría dado la pasada por buena».

---

## 3. Errores de software y de modelado de datos

### E-1 · `declared/holdings` se pierde entero por un rango que el mapper comprueba a medias

**Impacto: dos fondos sin cartera subyacente, y es la regla del propio proyecto la que se rompe.**

**Medido** (`npm run baseNueva:plan`, ejecutado hoy):

```
bloqueados                : 2
  instruments/LU0171283459/declared/holdings: /coverage: must be >= 0
  instruments/LU0849399786/declared/holdings: /coverage: must be >= 0
```

El contrato declara `coverage` con `minimum: 0, maximum: 1`. Y `validadores.ts:105-112` existe
precisamente para eso, con la regla escrita: «**un mapper no emite nunca un valor que el
contrato rechaza**; si el canónico trae uno, lo deja fuera y lo cuenta... Si el rango estuviera
escrito en los dos sitios, el día que cambiara uno el otro se quedaría atrás».

Pero `coverage` **no pasa por ahí**. `mapper.ts:1160-1161`:

```typescript
const sumaDelTop = num(ms['holdings_top_weight_sum']);
const cobertura = sumaDelTop !== undefined && sumaDelTop <= 100 ? frac(sumaDelTop) : undefined;
```

La guarda está escrita a mano, duplica el límite superior como el literal `100` —el contrato
dice `maximum: 1`, en otra unidad— y **se deja el límite inferior**. Una suma negativa pasa la
guarda, `frac()` da una cobertura negativa, y el escritor tira **el documento entero**. Que es lo
contrario de lo que el comentario de `mapper.ts:507-509` promete: «se queda fuera y se cuenta
como aviso, **en vez de tirar el documento entero por un campo**».

En el mismo fichero, `siCabe(...)` ya hace lo correcto y se usa en dos sitios (`:513` y `:1642`).

**Qué haría.** Pasar `coverage` por `siCabe('instrument-declared-holdings.v2.schema.json',
'coverage', ...)` y quitar el `<= 100` escrito a mano. Una línea, y los dos fondos recuperan su
cartera.

### E-2 · Un instrumento que la app muestra hoy desaparece de la base nueva sin marca, por un motivo que la decisión 14 no contempla

**Medido.** `npm run baseNueva:plan` dice:

```
instrumentos mapeados : 1091
parados por error     : 1
  ES0132526031: sin divisa utilizable: undefined
```

`ES0132526031` es **OPORTUNIDAD BURSATIL, S.A., SICAV**. Está en la base vieja con
`identity.currency: null`, y **no está en la base nueva**: comprobado, `instruments/ES0132526031`
no existe, ni su `quality/latest`, ni su `read/card`.

La decisión 14 dice que un instrumento que deja de cotizar **se marca, no desaparece**, y define
tres estados: cotiza / fuera de alcance / dejó de cotizar. Aquí hay un cuarto —**no se produce
porque el mapeo falla**— que no está en la lista y que produce exactamente el síntoma que la
decisión 14 persigue: un activo que un asesor ve hoy en el Buscador y que mañana no estará, con
el motivo solo en la salida de consola de un plan.

**Qué haría.** Añadir el cuarto estado al vocabulario de disponibilidad y escribir el
instrumento con él, aunque sea sin métricas. Es una SICAV con nombre y con ISIN: afirmar «está,
y no pudimos resolver su divisa» es información; no estar, no lo es.

### E-3 · Las reglas protegen los objetivos de una cartera por quién los puso, no por de quién es la cartera

**Riesgo latente, no activo. Medido.**

`4-base-nueva/firestore.rules:127-129` protege `portfolios/{cartera}/targets/{instrumento}`
dentro del `match` de la cartera. Pero las líneas **94-96** declaran también una regla con
comodín de ruta, necesaria para las consultas de grupo de colección:

```
match /{ruta=**}/targets/{instrumento} {
  allow read: if esAsesor() && resource.data.set_by == request.auth.uid;
```

En Firestore las reglas se combinan con **O**: si alguna coincide y permite, se permite. Así que
un objetivo se puede leer por su `set_by`, **sin comprobar el `advisor_id` de la cartera de la
que cuelga**. La garantía real es más débil que la que sugiere la regla anidada.

**Hoy no hay fuga**: medido, las 18 carteras son del mismo asesor y los **220 objetivos tienen
`set_by` igual al `advisor_id` de su cartera, 0 descuadres**. El día que haya dos asesores, o que
alguien escriba un `set_by` distinto, la protección no es la que parece. El mismo patrón afecta a
`/{ruta=**}/declared/{bloque}`, `/computed/{bloque}`, `/read/{tarjeta}` y `/quality/{calidad}`,
que anularían el `clients/{resto=**} → false` si alguna vez colgara algo con esos nombres de un
cliente.

**Qué haría.** Nada urgente. Cuando exista el segundo asesor o el primer cliente: comprobar el
dueño del padre con `get()` en la regla del comodín, y añadir el caso a `probar-reglas.mjs` —hoy
cubre 17 casos y ninguno es «el objetivo de la cartera de otro»—.

---

## 4. Duplicidades

Ordenadas por lo que pueden costar.

| # | qué está duplicado | dónde | consecuencia medida o leída |
|---|---|---|---|
| D-1 | **La serie del €STR**, tres implementaciones | `vl_fondos.py:146` · `eodhd.py:329` · `ecb_rates.py` | la corrección del fallo silencioso está en dos de las tres: **B-2** |
| D-2 | **El literal de la URL del €STR** | `vl_fondos.py:58` y `eodhd.py:34`, idénticos | y la fecha de inicio está una vez como constante (`ESTR_DESDE`) y otra como literal suelto en `eodhd.py:336` |
| D-3 | **La conversión a euros**, dos implementaciones con **fuentes distintas** | `core/metricas.py:148` (BCE, sin usar) · `price_refresh.py:222` (EODHD, en producción) | **A-4**: construir la §5 crearía un segundo juego de cifras no comparable |
| D-4 | **La volatilidad anualizada**, cinco implementaciones, tres factores | √12, √252, √52 ×3 | **A-2**: un tercer estimador sin nombre en producción |
| D-5 | **El rango de `coverage`** | contrato (`maximum: 1`) y `mapper.ts:1161` (`<= 100`) | **E-1**: dos fondos pierden su cartera |
| D-6 | **La longitud del año** | `core/metricas.py:457` usa `365.25`; `weekly_sampling.DAYS_PER_YEAR` usa `365.2425` | inmaterial en magnitud (~2·10⁻⁵ relativo en el exponente), pero son dos convenciones para lo mismo |
| D-7 | **Las habilidades operativas** | `.agents/skills/` y `.claude/skills/` | **B-3** |
| D-8 | **La cuenta «dieciséis comprobaciones»** | `README.md:122`, `AGENTS.md`, `projectAllowlist.ts:46` («dieciséis») y `:73` («catorce»), `.claude/skills/pipeline-extractor` | **son 21.** Medido: 22 ficheros de `src/` y `scripts/` nombran `ALLOWED_PROJECT_ID(S)`/`isAllowedProjectId`, uno de ellos la propia constante |

D-8 merece una frase, porque es la decisión 16 aplicada a la documentación. Esa decisión dice:
«toda cifra cuyo valor dependa de un conjunto y no solo de una fórmula publica la identidad de
ese conjunto», y su motivo es «una cifra que se movió **porque nadie se acordó de nada**». Aquí
la cifra es «dieciséis», el conjunto es «los ficheros que importan la constante», el conjunto
creció a 21 y la cifra sigue repetida en cuatro documentos. El remedio es el mismo que la propia
decisión recomienda: que no sea un número escrito a mano. `tests/projectAllowlist.test.ts` ya
recorre esos ficheros; puede contarlos y fallar si la cifra del `README` no cuadra — o, más
simple, quitar el número de los cuatro documentos y dejar «todas las comprobaciones de `src/` y
`scripts/`», que es lo que se quiere decir y no caduca.

### Documentos que se solapan

- **`PLAN_EJECUCION_2026-11-01.md` y `PLAN_INDEPENDENCIA_2026-11-01.md` no están en el
  inventario de `AGENTS.md`.** Medido: son los dos únicos `.md` de la raíz que la sección
  «Documentos de la raíz» no cita, ni por nombre ni por patrón. Y describen trabajo **por
  hacer**, que es exactamente lo que esa sección dice que conserva.
- **`DECISIONES_BASE_NUEVA` §9/§10 y `METODO_PROPIO` §9/§5 se solapan a propósito**, y el
  solapamiento está bien gestionado: cada uno dice quién manda. No lo cuento como duplicidad.
- **La §2 del método y la decisión 8** repiten los parámetros del Sharpe. Aquí sí hay riesgo:
  si se cambia un parámetro habrá que tocar dos documentos, y la regla de la §4 (cambiar un
  parámetro cambia la versión) solo está escrita en uno.

---

## 5. Mejoras, por lo que mueven

Priorizadas por si cambian una cifra que ve un cliente o la fiabilidad del sistema, no por si
son fáciles.

### Mueven una cifra que un cliente puede ver

1. **Dar nombre y versión al tercer estimador** (A-2). Sin nombre, la regla de la §3 no se puede
   hacer cumplir contra el único método que hoy está publicado. Es trabajo de documento.
2. **Meter la divisa en la clave de comparabilidad** (A-3). Dos campos y una línea. Convierte
   una guarda que no puede fallar en una que sí, antes de que entren cifras sin convertir.
3. **Corregir el motivo de la ausencia del Sharpe y el Sortino a diez años** (A-1). Hoy la base
   afirma «falta» 2.182 veces donde la verdad es «no se puede calcular hasta 2029».
4. **Decidir la fuente de los tipos de cambio antes de construir la §5** (A-4). Si se construye
   sin decidirlo, salen dos juegos de cifras en euros que no se pueden ordenar juntas.
5. **Corregir la frase del 7-9 % de la §5** con lo medido en A-7. La magnitud real es de un
   cuarto de punto en el dólar; la frase actual hace esperar un cambio diez veces mayor y
   deforma la prioridad de la decisión 10.

### Mueven la fiabilidad

6. **Cerrar la barrera 7 en código** (C-1) y **borrar los tres `deploy` preaprobados** (C-2) y
   **las cinco herramientas MCP de escritura** (C-3). Lo más barato de todo el informe y lo
   único que protege contra un daño irreversible en una base de producción ajena.
7. **Arreglar el `_ESTR_CACHE` permanente** (B-2) y hacer visible la ausencia que provoca.
8. **Arreglar o quitar la línea de `assets` de la auditoría** (B-1).
9. **Pasar `coverage` por `siCabe`** (E-1).
10. **Borrar `.agents/`** (B-3).

### Deuda interna, cuando toque

11. Mover la puerta de la divisa del Sharpe de acciones al extractor, **junto con la §9** (A-6).
12. Cambiar el predicado de `series_adjustment` antes de calcular métricas de ETF (A-10).
13. Anotar en la decisión 12 que el contrato la bloquea (A-8), y en la 3 que los tres papeles
    están vacíos (A-9).
14. Marcar `ES0132526031` con el cuarto estado (E-2).
15. Añadir el caso del objetivo ajeno a `probar-reglas.mjs` cuando haya un segundo asesor (E-3).

---

## 6. Mi opinión, que Óscar pide

### Lo que está bien hecho de verdad

**La forma de gobernar con documentos funciona, y lo digo con la prueba de que funciona: esta
auditoría ha encontrado más por comparar los documentos con la base que por leer código.** Un
proyecto sin `DECISIONES_BASE_NUEVA` ni `METODO_PROPIO` no me habría dejado decir que la
ausencia del Sharpe a diez años miente, porque no habría habido nada que contradecir. La mayoría
de los hallazgos de este informe existen **porque** el proyecto se compromete por escrito.

**Los contratos están mejor construidos de lo que es normal.** Lo comprobé en vez de suponerlo:
cero palabras clave no estándar en los 36 esquemas —ninguna `maxium` por `maximum` que ajv con
`strict: false` se tragaría en silencio—, y `additionalProperties: false` en todos los objetos
donde procede: los 14 que no lo llevan son subesquemas `if`/`then` dentro de un `allOf`, donde
ponerlo sería un error. Y `validarForma` devuelve `ok: false` cuando el tipo no existe, así que
un nombre de esquema mal escrito **falla** en vez de pasar.

**`projectAllowlist.ts` es el mejor fichero del proyecto.** No por el código, que son cuatro
constantes, sino porque su cabecera explica el daño que previene, dice por qué ensanchar la
barrera no es ampliarla, y **declara su propio límite**: «lo que de verdad decide a qué base va
una escritura es el puerto, no el id». Eso último es lo que separa una barrera de un amuleto.
Comprobado: ni un literal de proyecto suelto en `src/` ni en `scripts/`.

**El informe de re-originación de carteras es el modelo de cómo se informa de una pérdida.** 23
leídas, 18 entran, y las 5 que no entran **con su nombre y su motivo** —tres «es una prueba, no
una cartera», una «los pesos suman 181.25 % y no 100 %»—. Me hizo sospechar que una cartera
excluida estaba en la base; lo comprobé y había **dos** carteras llamadas «cp», el informe tenía
razón y yo no. Un informe que resiste que lo audite alguien de fuera es un informe bueno.

**La conversión de divisa que ya existe está bien hecha.** Lo verifiqué con números, no leyendo:
HSBC a 1.518,4 GBX con `minor_scale: 0,01` y cambio 0,8562 da 17,734 €, y el documento dice
`17.734174`. El submúltiplo es donde esto se rompe siempre y aquí no se rompe.

**Y el software está sano.** 1.112 pruebas en la plataforma y 1.807 en la app, todas en verde,
`typecheck` limpio en las dos. 16.118 documentos en la base nueva, 0 que no validan, 0
huérfanos. Eso no es poco y no se consigue por accidente.

### Lo que no está bien

**El proyecto mide con más rigor el dato que sus propias herramientas.** Es el patrón que une
B-1, B-2, B-4 y D-8. Una cifra del catálogo se mide, se fecha, se declara su método y se publica
su ventana; y al lado hay una auditoría que lee la base equivocada y dice 0, una caché que
entierra 198 Sharpe en silencio, una medición de puertos que no se reproduce y un «dieciséis»
que son 21. El rigor está aplicado a la mitad del sistema que produce las cifras y no a la mitad
que las comprueba — y la segunda es la que te dice si la primera funciona.

**La asimetría de las dos barreras es el defecto estructural más grande.** El lado TypeScript
tiene una barrera en código que presume, con razón, de no depender del entorno. El lado Python
tiene ocho valores por defecto que nombran la producción de otro proyecto, ninguna guarda, y
**dos valores por defecto opuestos para la misma variable en el mismo paquete**. El `README`
sabe cuál es la más importante y es justo la débil.

**Y hay una tendencia a declarar hecho lo que está escrito.** No en los estados —esos están bien
puestos, «decidido y no construido» aparece donde toca— sino en los verbos de las decisiones: la
3 dice que el emisor de acciones «tiene fuente» y está vacío; la 12 se lee como pendiente de
construir cuando el contrato la prohíbe; la §5 dice que nadie convierte a euros cuando el
sistema lleva meses convirtiendo. Son tres frases, pero las tres mandan a alguien a trabajar en
la dirección equivocada.

### Qué haría distinto si empezara hoy

**Una sola cosa, y lo demás se sigue de ella: el método de cálculo sería un módulo, con un
nombre, y nadie más calcularía una métrica.** Hoy hay cinco implementaciones de la volatilidad
anualizada en tres repositorios con tres factores de anualización, y la que está publicada es la
que ningún documento describe. No pasó por descuido: pasó porque cada capa necesitó una métrica
antes de que la capa de abajo la tuviera, y el camino corto siempre fue calcularla ahí. El
proyecto ya diagnosticó la versión pequeña de esto —«un umbral del método metido en el lector de
un proveedor significa que cambiar de proveedor cambiaría la cifra publicada», y por eso movió
`metricas_diarias`— y el movimiento fue correcto y se quedó a mitad: quedaron fuera las Cloud
Functions, que son las que publican.

Lo segundo, y es la lección de B-1 y B-2: **toda comprobación nace con su prueba de que puede
fallar**. No una prueba de que pasa: una que la rompa a propósito. La línea de `assets` habría
muerto el día que se escribió si alguien hubiera preguntado «¿y si la maestra estuviera vacía,
qué saldría distinto?». El proyecto ya tiene el ejemplo de cómo se hace bien, en
`probar-reglas.mjs`, que declara por escrito lo que **no** puede comprobar. Ese párrafo debería
ser obligatorio en cada auditoría, cada gate y cada `--dry-run`.

Y lo tercero, más pequeño: **ninguna cifra escrita a mano en un documento**. El «dieciséis» de
cuatro documentos, «las 73 acciones» de un comentario del mapper, los 31 fondos marcados de la
decisión 8 (hoy son 30). Son correctas el día que se escriben y después son ruido con aspecto de
medición. La decisión 16 ya resolvió este problema para los datos, con huella derivada y no
versión declarada, y por el mismo motivo: «una versión a mano depende de que alguien se acuerde
de subirla». La prosa del proyecto merece su propia decisión 16.

---

## 7. Cómo reproducir lo medido

| qué | cómo |
|---|---|
| 1.091 instrumentos, 16.118 documentos, 0 que no validan, `assets: 0` | `cd 2-plataforma-datos && npm run audit:base-nueva` |
| 2 `declared/holdings` bloqueados, `ES0132526031` parado | `cd 2-plataforma-datos && npm run baseNueva:plan` |
| Pruebas y tipos en verde | `npm test` y `npm run typecheck` en `2-plataforma-datos` y en `3-BDB-ACTIVOS_app` |
| Las dos bases vivas y distinguidas por puerto | `POST .../documents:listCollectionIds` con `Authorization: Bearer owner` al 8082 (da `assets`) y al 8092 (da `instruments`) |
| Conteos por método, ventana y divisa; cobertura; ausencias; tarjetas | lecturas REST de solo lectura sobre `instruments/*/computed/metrics`, `quality/latest` y `read/card`; los guiones quedaron en el bloc de notas de la sesión |
| El efecto de la divisa de A-7 | misma volatilidad semanal ×√52 sobre `source_value` y sobre `value` de `assets/*/price_series/*` en el 8082, ventana de 3 años; el control son las 22 acciones en euros, que dan 0,00 exacto |
| Los dos chequeos de puertos de B-4 | `Test-NetConnection` y `Get-NetTCPConnection -State Listen` sobre 8082, 8092, 5174 y 9097 |

**Lo que no pude comprobar, y queda como hipótesis:** el orden de precedencia entre
`.claude/settings.json` de la raíz y `3-BDB-ACTIVOS_app/.claude/settings.local.json` (C-2), y a
qué proyecto apuntarían las herramientas MCP de escritura de Firestore (C-3). Las dos se
comprobarían ejecutando algo que no se debe ejecutar.

---

## Cierre 03-11-2026

Óscar autorizó cerrar las tres críticas, y solo esas. Lo medido arriba **no se reescribe**:
es la línea base del 03-11. Esta sección dice qué se cerró y con qué prueba.

### C-1 · La barrera 7 ya está en código

`3-BDB-ACTIVOS_app/functions_python/master_project.py`, nuevo. `master_project_id()` **no
tiene defecto**: si `MASTER_PROJECT_ID` falta, aborta nombrando la variable y la ruta donde
declararla. `cargar_dotenv()` lee el `.env` de al lado, sin dependencia nueva.

Las **doce** resoluciones con defecto desaparecen, y con ellas los dos reexportes: catorce
sitios pasan ahora por una función. Eso corrige una cifra del §0 de este informe —eran doce
ficheros con defecto, ocho de ellos con el de BDB, más dos scripts que lo recibían importado
de `price_refresh`, no trece resoluciones—. Y aparece algo que el informe no vio: **cinco de
los ocho módulos declaraban la constante y no la usaban nunca**. Configuración decorativa que
aun así nombraba un destino.

La resolución ocurre donde se **usa** el id —al construir el cliente—, no al importar:
`functions_python/.env` está en `.gitignore:16` y no está en `HEAD`, así que abortar al
importar dejaría a cualquier copia nueva sin poder correr un test que no habla con ninguna
base. Pasar por ahí no se puede esquivar: no queda otro sitio donde se resuelva el id.

**Demostración** (`python`, sin emuladores, sin red, sin construir ningún cliente real):

| escenario | resultado |
|---|---|
| Sin la variable y sin `.env` — **antes** | `os.environ.get(...)` devolvía `'bbdd-activos-financieros'` |
| Sin la variable y sin `.env` — **ahora** | `RuntimeError: MASTER_PROJECT_ID no esta declarado...` y nombra el fichero |
| Sin la variable, con el `.env` de al lado | `'gestor-activos-local'` — el clon |
| Con la variable en el entorno | manda el entorno |
| `get_master_write_db()` y `get_master_db()` sin la variable | **abortan antes de construir cliente** |
| las dos fábricas con la variable puesta | el proyecto que llega al cliente es `gestor-activos-local` |

**Prueba que puede fallar:** `functions_python/tests/test_master_project.py`, diez casos. Los
dos últimos barren todos los `*.py` del paquete buscando un defecto para esta variable y el
proyecto de BDB como valor por defecto. Corridos **contra el árbol de `HEAD`**, fallan y
nombran a los doce y a los ocho. Antes, la pregunta «qué tendría que pasar para que esto
fallara» no tenía respuesta; ahora la tiene.

**Sin regresiones:** suite de Python en `HEAD` → 1.152 pasados, 5 saltados. Con el cambio →
**1.162 pasados, 5 saltados**. La diferencia son exactamente los diez casos nuevos.
`2-plataforma-datos`: 134 ficheros, 1.112 tests, `typecheck` limpio en `src` y en `tests`.

**La decisión que hubo que tomar:** el lector carga **solo** `MASTER_PROJECT_ID`, no el `.env`
entero. Medido antes de decidir: `PRICES_WRITE_ENABLED` es el gate del *scheduler*, y la
escritura en la maestra la gobierna `BDB_ACTIVOS_ENABLE_MASTER_WRITES`, que no está en el
fichero —así que cargarlo todo no abriría ninguna escritura—. Aun así, un lector que inyectara
el fichero completo haría que el comportamiento de cualquier script dependiera de claves que
nadie revisa con ese criterio, incluidas las que alguien añada mañana para el despliegue: la
misma clase de defecto que C-1 elimina. Consecuencia dicha entera: `FIRESTORE_EMULATOR_HOST`
**no** se carga, así que un script a mano resuelve `gestor-activos-local` —un proyecto que no
existe en la nube— y falla al conectar en vez de escribir en ningún sitio. Para llegar al
emulador, el entorno del operador sigue poniéndolo. Un test fija esta decisión, para que
cambiarla sea deliberado.

### C-2 · Las tres entradas de despliegue, fuera

`3-BDB-ACTIVOS_app/.claude/settings.local.json`: `allow` 30 → 27. Las tres llevaban
`BDB_ACTIVOS_ALLOW_FIREBASE_DEPLOY=YES_I_UNDERSTAND_SHARED_PROJECT` escrito dentro, y se fue
con ellas: ninguna de las tres cadenas sobrevive en el fichero.

Y se resuelve media hipótesis del §7: el `deny` de la raíz dice `Bash(firebase deploy:*)`,
mientras las tres entradas decían `npx firebase deploy`, que es otro comando. Razonado sobre
los patrones, **no ejecutado**: comprobarlo exigía desplegar.

### C-3 · Las cinco de escritura, fuera; las de lectura se quedan

No estaban donde este informe las situó: viven en `.claude/settings.json` de la **raíz**.
`allow` 73 → 68, `deny` 6 → 6 intacto. Retiradas `firestore_add_document`,
`firestore_update_document`, `firestore_delete_document`, `firestore_create_index` y
`firestore_delete_index`. Quedan trece de lectura, que son las que usa el trabajo de auditoría.

Segunda corrección al informe: lo que tomé por una segunda lista de aprobaciones en
`.claude/settings.local.json` de la raíz es una lista de **`deny`** de 482 entradas —la poda de
TokenEconomizer—. Ahí `firebase_deploy` está denegado, no aprobado.

### Los dos seguimientos, cerrados el mismo día

Óscar los autorizó después de leer lo anterior. En los dos, lo medido cambió el arreglo.

**El comodín `Bash(firebase firestore:*)`**, fuera de la `allow` de la raíz. Medido antes de
decidir: **ese comando no se usa en ningún sitio del proyecto** —las únicas apariciones eran la
propia entrada de permiso y el texto de este informe—, así que el comodín concedía una capacidad
destructiva (`firestore:delete`, y `firestore:databases:delete`, que borra una base entera) que
nada aprovechaba. Siguen permitidos `firebase emulators:*` y `firebase setup:*`, que son los que
usan el README y la habilidad `arrancar-entorno`.

Y se añadió `deny` de las dos órdenes destructivas **en sus dos escrituras**, `firebase …` y
`npx firebase …`, porque la lección de C-2 es justo que un `deny` que dice `firebase deploy` no
tapa `npx firebase deploy`. `deny` 6 → 10, `allow` 68 → 67. No se ejecutó ninguna orden de
Firebase para probar el emparejamiento de patrones: mismo límite que en C-2.

**`validate_live.py`** ya no se redirige a sí mismo. Cargaba `MASTER_PROJECT_ID` y la credencial
desde el `.env.local` de un repositorio hermano, así que su destino lo decidía un fichero de
**otro** proyecto: el mismo defecto que C-1 en otra forma. Medido: ese fichero **no existe** en
esta copia y `BDB_MASTER_ENV_FILE` no está definida, así que el redirigido estaba inerte y, tras
C-1, el script ya apuntaba al clon; pero bastaba con que el fichero apareciera. Ahora el destino
sale de `master_project_id()` como el de todo lo demás, y el script lo imprime. Ejecutado contra
el emulador de la base de siempre, de solo lectura:

```
== Validacion LIVE read-only del read model ==
  proyecto: gestor-activos-local
  emulador: 127.0.0.1:8082
=== FUND: 2 encontrados ===   BE0943877671 … BE0946564383
```

De paso corrobora A-2 sin buscarlo: el detalle que devuelve el camino que lee el asesor trae
`metrics_method: GEOMETRIC_CAGR` y `metrics_frequency: WEEKLY` —el tercer estimador, el que
ningún documento declara—.

### Los tres `deny` que se esquivaban, cerrados

`deny` 10 → 13, `allow` intacta en 67. Cada uno con la escritura que de verdad lo esquiva **en
esta máquina**, no con un `npx` mecánico:

| denegado | se añade |
|---|---|
| `firebase deploy` | `npx firebase deploy` |
| `firebase projects:delete` | `npx firebase projects:delete` |
| `gcloud` | `gcloud.cmd` |

El tercero no es `npx`: `npx gcloud` no es un camino real, y en Windows el ejecutable se llama
`gcloud.cmd`. Medido, no supuesto — `scripts/appcheck_report.py` lo invoca con
`shutil.which("gcloud")` y su test afirma que eso resuelve a `C:\gcloud\gcloud.cmd`.

**Lo que estos `deny` no cierran**, para que no valgan más de lo que valen: un patrón de prefijo
no tapa la clase entera. Un prefijo de variable de entorno, `sh -c` o
`./node_modules/.bin/firebase` siguen siendo otras cadenas. Cierran las escrituras que de verdad
ocurren en este repositorio. No se ejecutó ninguna orden de Firebase ni `gcloud` para probar el
emparejamiento: mismo límite que en C-2.

Y al comprobarlo aparece algo que **mejora** el cuadro de C-2: el despliegue **sí tiene puerta en
código**. `3-BDB-ACTIVOS_app/firebase.json` declara el hook `predeploy`
`scripts/requireFirebaseDeployApproval.mjs` en los tres objetivos, y sale con 1 salvo que
`BDB_ACTIVOS_ALLOW_FIREBASE_DEPLOY` valga la frase exacta. Por eso C-2 era grave: las entradas
preaprobadas llevaban esa frase **escrita dentro**, que es lo único capaz de neutralizar la
puerta. Borrarlas le devolvió el sentido.

---

## La puerta del despliegue: medida y diseñada, sin tocar un fichero

> **Corregido el 03-11-2026.** Tres cosas de esta sección dejaron de valer. `firebase-tools` sí está
> instalado, y que `GCLOUD_PROJECT` no se puede falsear se midió ejecutándolo. El frontend del clon no
> autentica contra BDB. Y comprobar el IAM no era requisito previo. El detalle está en la última
> sección de este informe. El texto queda como se escribió.

Óscar autorizó que la puerta mire **a qué proyecto** se despliega. No se implementa todavía, por
dos razones operativas y una de diseño. Las operativas: va a desplegar reglas de Firestore en las
próximas horas, y meter una puerta nueva en el camino del despliegue justo cuando ese camino hace
falta es la forma clásica de romper lo que estás a punto de necesitar; y `3-BDB-ACTIVOS_app` lo
está editando la sesión de diseño ahora mismo. La de diseño es más importante: **la condición que
iba a escribir era falsa**, y esto explica por qué.

### Dónde está y qué comprueba hoy

`3-BDB-ACTIVOS_app/scripts/requireFirebaseDeployApproval.mjs`, doce líneas, declarado como
`predeploy[0]` de `functions`, `firestore` y `hosting`. Comprueba **una** cosa:
`BDB_ACTIVOS_ALLOW_FIREBASE_DEPLOY === "YES_I_UNDERSTAND_SHARED_PROJECT"`, o `exit 1`. Está fijado
por `tests/firebaseHostingSecurity.test.ts:12-22`, que afirma el hook en los tres objetivos y lo
ejecuta sin aprobación esperando código 1. Su mensaje de error está **viejo**: dice que esta app
apunta al proyecto compartido, cuando `.firebaserc` dice `gestor-activos-local`.

### El mapa de destinos, que no es uno

| se despliega desde | destino por defecto | ¿existe en la nube? | ¿tiene puerta? |
|---|---|---|---|
| `3-BDB-ACTIVOS_app` | `gestor-activos-local` | **no** | sí, en los tres objetivos |
| `4-base-nueva` | `bdb-gestor-de-activos` | **sí, y es el bueno** | **ninguna** |

`4-base-nueva/firebase.json` declara `firestore` con `rules` e `indexes` y **sin `predeploy`**. Así
que **la prioridad se invierte**: la puerta vigila la carpeta cuyo destino no existe en la nube, y
la carpeta que despliega a un proyecto real —la del despliegue que toca ahora— no tiene puerta
ninguna. Y «cualquier proyecto que no sea el clon» no es una condición: hay **dos** destinos
legítimos y dependen de la carpeta, así que el destino permitido va **al lado de cada
`firebase.json`**, no en una lista global. Una lista global mal puesta bloquea a Óscar o no
bloquea nada.

El `firebase.json` de la app **no** apunta al proyecto de BDB: su única mención a
`bbdd-activos-financieros` es el `frame-src` de la CSP, el dominio del iframe de acceso. Cosa
aparte, anotada y no perseguida: eso implica que el frontend del clon **autentica** contra el
proyecto de BDB. Es runtime, no despliegue, y necesita su propia decisión.

### De dónde puede salir el destino sin que el operador pueda mentirle

**Desde dentro de un hook `predeploy`, de ningún sitio fiable.** Todo lo que el hook puede leer
—`GCLOUD_PROJECT`, `GOOGLE_CLOUD_PROJECT`, el directorio, los argumentos— lo pone el mismo árbol
de procesos que controla quien ejecuta. El fallo, escrito entero:

```
GCLOUD_PROJECT=gestor-activos-local npx firebase deploy --project bbdd-activos-financieros
```

El hook ve el clon, autoriza, y la CLI despliega a BDB. Que eso funcione o no depende de **un solo
hecho**: si la CLI sobrescribe `GCLOUD_PROJECT` con el proyecto resuelto antes de lanzar los hooks.
Y ese hecho **no se puede medir aquí**: `firebase-tools` no está instalado en ninguno de los cinco
repositorios, llega por `npx` y se descarga. Así que una puerta construida sobre esa variable
hereda el defecto de C-1 —un valor que alguien pone— y su validez entera descansa en algo sin
comprobar.

**El experimento que lo resuelve y no despliega nunca.** Sustituir el cuerpo del hook por uno que
solo imprima y aborte, y lanzar un despliegue con la discrepancia puesta a propósito:

```
node -e "console.error('HOOK VE:', process.env.GCLOUD_PROJECT); process.exit(1)"
```

como único `predeploy`, y entonces:

```
GCLOUD_PROJECT=mentira npx firebase deploy --only firestore --project gestor-activos-local
```

El `exit 1` aborta siempre, así que no se despliega nada; lo que imprima contesta la pregunta de
forma definitiva. **Lo tiene que correr Óscar**: aquí los despliegues están prohibidos.

**Y la barrera que no admite mentira: IAM.** Si la credencial con la que esta máquina despliega no
tiene rol de despliegue sobre `bbdd-activos-financieros`, no hace falta ningún script. Una puerta
en un hook es cortesía de quien la ejecuta; un permiso que la cuenta no tiene es una barrera.
**Comprobar eso antes de escribir más código de puerta**: si el permiso no está, toda esta sección
es defensa en profundidad sobre algo ya cerrado; y si está, ningún hook lo compensa.

### Qué tendría que pasar para que ese gate fallara

1. **Que la CLI no sobrescriba `GCLOUD_PROJECT`.** Un `--project` discrepante pasa limpio. Sin
   comprobar, y es la pieza que sostiene todo lo demás.
2. **Que el despliegue salga de una carpeta sin hook.** Hoy es `4-base-nueva`, que es justo la que
   alcanza un proyecto real.
3. **Que no pase por `firebase.json`.** La herramienta MCP `firebase_deploy` —verificado: está en
   la lista de `deny` de 482 entradas de la raíz—, la consola web, o un CI.
4. **Que alguien añada un objetivo nuevo.** El hook está en tres; nada obliga a que un `storage` o
   un `dataconnect` futuros lo lleven. Y el test actual **no lo cazaría**: itera sobre una lista
   escrita a mano `["functions", "firestore", "hosting"]` en vez de sobre las claves del propio
   `firebase.json`. Es una línea, y es otra comprobación que no puede fallar.

### Lo que sigue abierto

- **La puerta del despliegue.** El IAM ya está comprobado (abajo) y no nos salva, así que el
  código hace falta. Queda el experimento del `GCLOUD_PROJECT`, que solo puede correr Óscar, y la
  puerta que falta en `4-base-nueva`, que es la carpeta que alcanza un proyecto real.
- **El mensaje viejo del hook**, que manda a quien lo lea en la dirección equivocada.
- **El objetivo que nadie obliga a proteger**, el punto 4 de la lista anterior.
- Dos `import os` sin uso en `scripts/audit_cobertura_equivalencia.py` y
  `tests/test_portfolio_horizon.py`: ya estaban así antes de todo esto.
---

## IAM primero: medido, y la respuesta es que no nos salva

> **Corregido el 03-11-2026: la fila de la CLI de Firebase y la conclusión 1 son falsas.** Miré la
> sesión en la ruta equivocada: existe, con la cuenta de Óscar y un token, y la «barrera más fuerte»
> no existe. El detalle está en la última sección de este informe. El texto queda como se escribió.

Óscar eligió comprobar IAM antes de escribir más puerta. La pregunta era: si la credencial con
la que esta máquina despliega no puede escribir en `bbdd-activos-financieros`, la puerta del hook
es defensa en profundidad sobre algo ya cerrado. **Medido: no lo está.**

Inventario de credenciales de esta máquina, solo existencia, tipo e identidad —ni un token ni una
clave se leyeron ni se imprimieron—:

| credencial | existe | tipo | señal |
|---|---|---|---|
| Firebase CLI, `%APPDATA%\configstore\firebase-tools.json` | **no** | — | la CLI **no tiene sesión** en esta máquina |
| gcloud ADC, `%APPDATA%\gcloud\application_default_credentials.json` | **sí** | `authorized_user` | credencial de **usuario**, no de servicio; `quota_project = bbdd-activos-financieros` |
| `GOOGLE_APPLICATION_CREDENTIALS` | sin definir | — | — |
| gcloud, proyecto activo | — | — | `nuvia-market-data`, un **tercer** proyecto |

**Tres conclusiones.**

1. **El camino de la CLI de Firebase no tiene credencial hoy.** Sin configstore, `npx firebase
   deploy` no se autentica. Es la barrera más fuerte de todas las encontradas en esta auditoría
   —y no está escrita como barrera en ningún sitio, no sobrevive a un `firebase login`, y nadie
   se enteraría del día en que desapareciera.

2. **El camino de ADC sí tiene credencial, y es de usuario.** Lleva los roles de Óscar, no los
   recortados de una cuenta de servicio. Que su `quota_project` sea el de BDB es evidencia de que
   esa cuenta tuvo al menos `serviceusage.services.use` sobre ese proyecto. Y es exactamente el
   fichero que carga `scripts/improve_fund_data.py`. Así que **IAM no es barrera en el camino de
   Python**, que es justo donde vivía C-1: aquel defecto tenía detrás una credencial con derechos.

3. Por tanto **la puerta del hook sigue haciendo falta**. Mi recomendación anterior —comprobar
   IAM porque podría hacer el script innecesario— se resuelve en que no lo hace.

**Lo que no se pudo medir, y por qué:** la lista de roles sobre `bbdd-activos-financieros`.
Necesita `gcloud projects get-iam-policy` —denegado aquí— o la consola web. Y **no** se hizo
ninguna llamada autenticada contra ese proyecto para sondear el acceso: eso sería leer producción
para comprobar si se puede escribir en ella.

## La hipótesis de precedencia, resuelta por medición

El §7 dejaba sin comprobar el orden entre `.claude/settings.json` de la raíz y el fichero local.
Ya está medido, y por el camino más limpio: una llamada refusada.

`mcp__firebase__firebase_get_environment` está en la `allow` del proyecto —es una de las trece de
lectura que C-3 conservó— y la llamada **se denegó**. Esa herramienta está también en el `deny` del
fichero local. **El `deny` gana.** No es razonamiento sobre patrones: es el resultado de intentarlo.

Y entonces las dos consecuencias se miden solas:

- **Las trece de lectura que conservé están tapadas. Las trece.** Las entradas de la `allow` para
  herramientas de Firebase son decorativas en esta máquina: la misma forma de defecto que las cinco
  constantes `MASTER_PROJECT_ID` que se declaraban y no se usaban nunca.
- **Las cinco de escritura de C-3 ya estaban en ese `deny`** antes de que yo tocara nada.

**Esto corrige la severidad que puse a C-3, y conviene decirlo sin adornos.** Califiqué de crítico
«un camino de escritura que no pasa por la allowlist ni por las puertas». En la práctica, **hoy** ese
camino ya estaba cerrado por la poda de TokenEconomizer, así que la severidad era demasiado alta
para el presente.

Lo que la mantiene como hallazgo real es **qué fichero viaja**: el `deny` de 482 entradas está
excluido por `.git/info/exclude` —ni siquiera por `.gitignore`—, es generado por una herramienta y
es local a esta máquina, así que **no existe en una copia nueva, en otro ordenador, ni después de
reiniciar la poda**. El único fichero que viaja es la `allow` versionada, y hasta hoy declaraba las
cinco de escritura. De modo que la protección vigente estaba en lo que no se conserva, y el riesgo
estaba en lo que sí. Retirarlas de la `allow` es el arreglo durable; el `deny` local era la
protección del día.

Dicho de otra forma, que es la lección de toda esta auditoría otra vez: la barrera que funcionaba
no era la que el proyecto creía tener, y la que el proyecto publica era la que no protegía.
---

## La puerta que faltaba, puesta: `4-base-nueva/puerta-despliegue.mjs`

Hook `predeploy` de `firestore` en `4-base-nueva/firebase.json`. La carpeta que alcanza un
proyecto real ya tiene puerta, y está escrita **para que el despliegue legítimo pase**: una que
bloquease el despliegue bueno es peor que ninguna, porque el siguiente que se la encuentre la
borra y entonces no hay puerta y además nadie se fía de las que queden.

### De dónde saca el proyecto, medido sobre el código y no sobre la documentación

La pregunta que decidía si esto sirve: si el destino sale de algo que el operador escribe, la
puerta hereda el defecto de C-1 y no vale. **No se puede medir ejecutando un despliegue** —está
prohibido aquí—, así que se midió leyendo el paquete, descargado sin ejecutarlo
(`npm pack firebase-tools`). En `lib/deploy/lifecycleHooks.js`, `getChildEnvironment`:

```js
const projectId = needProjectId(overallOptions);
...
return Object.assign({}, process.env, {
    GCLOUD_PROJECT: projectId,
    PROJECT_DIR: projectDir,
    RESOURCE_DIR: resourceDir,
});
```

`projectId` es `needProjectId(options)` —el proyecto que la CLI **ha resuelto de verdad**, venga
de `--project`, de un alias o del `.firebaserc`— y se asigna **después** de volcar `process.env`,
así que **sobrescribe** cualquier valor del operador. El fallo que yo había postulado como la
pieza que lo sostenía todo —`GCLOUD_PROJECT=clon npx firebase deploy --project bbdd-…`— **no
funciona**: el hook ve el destino real. Condición satisfecha, y por medición.

De paso queda resuelto el `cwd`: el hook corre en `config.projectDir`, que
`detectProjectRoot` fija en el directorio del `firebase.json`. Como no hay ningún
`firebase.json` por encima de `4-base-nueva`, el despliegue sale de dentro de esa carpeta y
`node puerta-despliegue.mjs` resuelve. Queda documentado en su README.

### Lo que comprueba

1. **El `.firebaserc` no se ha movido por debajo de la barrera.** El id vive en la puerta, no se
   toma del `.firebaserc` —si saliera de ahí, editar la configuración movería la barrera, que es
   el defecto de C-1—, pero dos copias del mismo id son dos sitios donde cambiar uno y olvidar el
   otro, así que la puerta **compara las dos y aborta si discrepan**.
2. **Lista de permitidos de uno**, `bdb-gestor-de-activos`, no una prohibición del proyecto de
   BDB: una prohibición dejaría pasar cualquier tercer proyecto que apareciera mañana.
3. **Falla cerrada**: sin destino determinable, rechaza.

### Las tres salidas, sin desplegar

```
$ GCLOUD_PROJECT=bdb-gestor-de-activos node puerta-despliegue.mjs
  base nueva: destino bdb-gestor-de-activos, permitido. Adelante.
  -> codigo de salida: 0

$ GCLOUD_PROJECT=bbdd-activos-financieros node puerta-despliegue.mjs
  DESPLIEGUE BLOQUEADO - base nueva
  Destino: bbdd-activos-financieros
  Ese es el proyecto de BDB, que esta EN USO. Esta carpeta no despliega ahi.
  Permitido: bdb-gestor-de-activos
  -> codigo de salida: 1

$ node puerta-despliegue.mjs          (sin GCLOUD_PROJECT)
  DESPLIEGUE BLOQUEADO - base nueva
  No se pudo determinar el proyecto destino: GCLOUD_PROJECT viene vacio.
  Esta puerta falla cerrada a proposito: sin saber a donde, no se despliega.
  -> codigo de salida: 1
```

`4-base-nueva/probar-puerta.mjs` las deja repetibles, con dos comprobaciones más: un **tercer**
proyecto también se rechaza —lo que prueba que es lista de permitidos y no prohibición—, y
**todos los objetivos de despliegue del propio `firebase.json` llevan la puerta**, iterando sobre
sus claves en vez de sobre una lista escrita a mano. Las cinco pasan. Esa última es justo la que
le falta al equivalente de la app, que afirma tres objetivos a mano y por tanto no cazaría un
objetivo nuevo sin proteger.

### Por qué faltaba: una frase falsa en el README

`4-base-nueva/README.md` decía «**Nada que desplegar**: `firebase deploy` sigue denegado… y **este
id de proyecto no existe en la nube**». Falsa en las dos mitades: `firebase.json` declara
`firestore` con reglas e índices, y `AGENTS.md` —que manda sobre ese README— dice que
`bdb-gestor-de-activos` es el proyecto **real** que Óscar creó en Firebase. Quien leyera esa frase
concluía que aquí no hacía falta puerta, y es exactamente lo que pasó. Corregida, con la
corrección fechada y dicha, y con el modo de desplegar documentado.

Es el mismo patrón que las tres frases del §1 de este informe: una afirmación que manda a quien la
lee en la dirección equivocada cuesta más que un error de código, porque el código lo contradice
una prueba y a la frase no la contradice nadie.

### Lo que esta puerta no cierra

- **No comprueba aprobación**, solo destino. La de la app exige una frase; esta no, a propósito:
  exigirla hoy bloquearía el despliegue de reglas que toca ahora. Si se quiere, se añade después.
- **No cubre lo que no pasa por `firebase.json`**: la consola web, un CI, o la herramienta MCP
  `firebase_deploy` —que está en el `deny` local, el fichero que no viaja—.
- **Y no se ha ejecutado un despliegue real contra ella.** Las tres salidas son invocaciones
  directas del hook. Que la CLI lo lance y aborte con el código 1 está medido en el código del
  paquete, no observado: el primer despliegue de verdad es también la primera vez que se ve.
---

## La puerta de la app, y lo que había que corregir

### Desde la app no se despliega a ningún proyecto

Óscar pidió que la puerta de `3-BDB-ACTIVOS_app` mirase el destino. Medido, la lista de permitidos
correcta está **vacía**: `PERMITIDOS = []` en `scripts/requireFirebaseDeployApproval.mjs`.

| objetivo | qué pasaría si se desplegase al proyecto nuevo |
|---|---|
| `firestore` | Sustituiría las reglas buenas. Las de la app no tienen ninguna línea con `instruments`, `search_shards` ni `advisor_id`; las de `4-base-nueva`, 3, 2 y 7 |
| `hosting` | Pisaría el sitio publicado, que desde `b2eb364` sale de `4-base-nueva/sitio/` y no del `dist/` de aquí |
| `functions` | Viajaría al runtime un `.env` con `FIRESTORE_EMULATOR_HOST=127.0.0.1:8082`, y no hay decisión de desplegarlas |

`gestor-activos-local` tampoco entra: no existe en la nube.

La versión de hace unos minutos permitía `hosting` al proyecto nuevo, porque era el paso 4 del
README. `b2eb364` movió la publicación a `4-base-nueva` mientras la escribía. Esa versión habría
dejado pisar la web.

**La frase `BDB_ACTIVOS_ALLOW_FIREBASE_DEPLOY` se retira.** Con ella la puerta autorizaba cualquier
destino, BDB incluido. Ahora la aprobación es añadir un id a la lista, y queda en el historial.

### Lo que lo demuestra

Las dos puertas se ejecutaron con **el código de hooks de la CLI instalada**, `firebase-tools`
15.33.0, y con un valor mentido en `GCLOUD_PROJECT`. Corre el hook y nada más: no hay `prepare`, ni
`deploy`, ni `release`, ni red, ni credenciales.

| carpeta | objetivo | resuelto por la CLI | exportado a mano | resultado |
|---|---|---|---|---|
| `4-base-nueva` | `firestore`, `hosting` | `bdb-gestor-de-activos` | `mentira` | pasa |
| `4-base-nueva` | `firestore` | `bbdd-activos-financieros` | `bdb-gestor-de-activos` | aborta |
| app | `hosting` | `bdb-gestor-de-activos` | `mentira` | aborta |
| app | `firestore` | `bdb-gestor-de-activos` | `mentira` | aborta |
| app | `hosting`, con la frase antigua | `bbdd-activos-financieros` | `bdb-gestor-de-activos` | aborta |

Para reproducirlo, con `dir` la carpeta, `fb` su `firebase.json` y `GCLOUD_PROJECT` exportado con
otro valor:

```js
const { lifecycleHooks } = require(`${npmRootG}/firebase-tools/lib/deploy/lifecycleHooks.js`);
await lifecycleHooks("hosting", "predeploy")({}, { project, projectId: project, rc: {}, projectRoot: dir,
  config: { projectDir: dir, get: (k) => fb[k], path: (p) => path.resolve(dir, p) } });
```

Pruebas: `tests/firebaseHostingSecurity.test.ts` tiene 10 casos, y contra la puerta anterior fallan
4. Itera las claves del propio `firebase.json`, así que un objetivo nuevo sin puerta la rompe.
La suite entera de la app da 1.834 pasados y 5 saltados, y `typecheck` limpio. `node 4-base-nueva/probar-puerta.mjs` pasa sus cinco.

**Ejecutarlo sacó un defecto que leyendo no se veía.** En Windows, `cross-spawn` toma cualquier
salida 1 en modo shell por «comando no encontrado», así que tras el mensaje de bloqueo salía un
volcado `spawn node puerta-despliegue.mjs ENOENT`. El aborto era correcto, pero la puerta parecía
rota, y una puerta que parece rota es la que el siguiente borra. Las dos salen ahora con 2: la CLI
aborta igual y el ENOENT desaparece.

### Correcciones a lo que dije antes

| lo que dije | lo medido | qué cambia |
|---|---|---|
| La CLI de Firebase no tiene sesión y esa es «la barrera más fuerte de la auditoría» | **Falso.** Miré en `%APPDATA%\configstore`; la sesión está en `%USERPROFILE%\.config\configstore\firebase-tools.json`, con la cuenta de Óscar y un token | **Esa barrera no existe.** C-2 era peor de lo que dije: un despliegue se habría autenticado. El despliegue de reglas de las 00:51 ya debió avisarme. No se comprobó que el token siga vigente ni sus roles |
| El frontend del clon autentica contra BDB | **Falso.** `.env.local` dice `AUTH_DOMAIN=localhost` y `PROJECT_ID=gestor-activos-local` | La mención a BDB en la CSP es un resto, no un destino |
| `firebase-tools` no está instalado y su comportamiento no se puede medir aquí | **Engañoso.** Está instalado globalmente, 15.33.0. Yo leí la 15.34.2; `lifecycleHooks.js` es idéntico en las dos | Medido ejecutándolo, arriba |
| Lo de `gcloud.cmd` está medido porque lo afirma un test | **Mala prueba.** Ese test lo simula con un `monkeypatch` | La conclusión se sostiene: `where.exe gcloud` encuentra `bin\gcloud.cmd` |
| El proyecto viene de `--project`, de un alias o del `.firebaserc` | **Incompleto.** También de `firebase use`, que manda sobre el `.firebaserc` (`applyRC`) | Ninguno en la puerta, que mira lo ya resuelto. Sí en lo que puede creerse quien lea el `.firebaserc` |
| El primer despliegue real será la primera vez que se vea la puerta | **Superado** por la tabla de arriba | Sin ejecutar sigue solo el `chain` de `firebase deploy`, que corre los `predeploy` antes de `prepare`: está leído (`lib/deploy/index.js`, líneas 191-199) |

También queda superada la conclusión de que el destino «no sale de ningún sitio fiable» desde un
hook, de la sección de diseño, y la recomendación de esperar al IAM. Las secciones anteriores
conservan su texto, con un aviso al principio.

### Lo que sigue abierto

- **Las cabeceras del sitio publicado: cerrado el 03-11-2026.** `4-base-nueva/firebase.json` lleva
  ahora las 7 de la app, con un solo cambio: en `frame-src`, el dominio de acceso de BDB pasa a ser
  el de `bdb-gestor-de-activos`. La puerta rechaza el despliegue si faltan, o si la CSP no nombra ese
  dominio, y `probar-puerta.mjs` lo comprueba con un `firebase.json` estropeado a propósito. Si la
  política de la app cambia, esa prueba avisa de que hay que revisar esta.
  Comprobado sirviendo `sitio/` en local con esas cabeceras: el acceso carga sin errores en consola;
  el iframe del dominio nuevo y el script de `apis.google.com` pasan; el iframe de BDB y los orígenes
  ajenos se bloquean. **Sin comprobar:** las pantallas tras iniciar sesión, porque requieren la
  contraseña de Óscar, y las cabeceras servidas por Firebase Hosting de verdad, porque no se ha
  desplegado. Se conservan los orígenes de reCAPTCHA aunque este sitio compila sin App Check: no se
  pudo probar si el acceso con contraseña los necesita.
- **Las Functions.** La puerta las rechaza. Si se decide desplegarlas, hay que resolver antes su
  `.env` y añadir el id a la lista. Hasta entonces, según el README, las pantallas que dependen de
  ellas no funcionan en la web.
- **Cinco documentos de `3-BDB-ACTIVOS_app/docs/` mandan a desplegar a BDB**, y varios con la frase
  retirada: `DEPLOY_BDB_ACTIVOS`, `PROMPT_GEMINI_DEPLOY`, `PROPIEDAD_CAMPOS_MAESTRA_2026-10-14`,
  `RUNBOOK_DEPLOY` y `RUNBOOK_INGESTA_CARTERA_REAL_7_ISINS_2026-07-11`. La puerta los para. Siguen
  sin corregir.
- **Las puertas dependen de un detalle interno de la CLI.** Si una actualización cambiase el orden
  de `Object.assign`, `GCLOUD_PROJECT` volvería a poder mentirse y ninguna prueba del repositorio lo
  notaría. Se comprueba con el fragmento de arriba al actualizarla.
