# Encargo: FIRDS como fuente oficial de identidad y universo de acciones y ETF

*Para una sesión de Claude Code que no conoce este proyecto. Entregable: código probado en
`1-extractor`, un informe de medición y una lista de decisiones para Óscar. **No toques
`2-plataforma-datos`, `3-BDB-ACTIVOS_app` ni `4-base-nueva`.** No despliegues nada, no
escribas en ninguna base de datos, no hagas `git push`.*

Es el **paso 1 de 8** del documento «Datos del programa y sus fuentes» (06-11-2026). Sin él no
se puede ampliar el universo de 1.091 a unos 1.800 instrumentos (1.000 fondos, 500 acciones,
300 ETF) con criterio oficial.

## Qué es este proyecto, en cuatro líneas

Gestor Activos Financieros es una aplicación profesional para asesores de inversión. Son cuatro
repositorios Git en la rama `gestor-activos-financieros`: `1-extractor` (Python, adquiere datos
y calcula métricas), `2-plataforma-datos` (TypeScript, valida contra contratos y carga en
Firestore), `3-BDB-ACTIVOS_app` (React + Cloud Functions) y la raíz con los documentos que
gobiernan. **Este encargo vive entero en `1-extractor`.**

Antes de escribir una línea, lee en este orden:

1. `AGENTS.md` de la raíz, sección «El papel con el que se trabaja aquí»: rigor, no inventar
   datos, procedencia en cada cifra, verificar antes de afirmar.
2. `LEGADO_CONOCIMIENTO_SISTEMA_2026-07-12.md`: convenciones no escritas en el código.
3. `.claude/skills/pipeline-extractor/SKILL.md`: el orden del pipeline y lo que lo rompe.
4. `1-extractor/core/adquisicion/__init__.py`, `adaptador.py`, `procedencia.py`,
   `registro.py`: cómo se declara un adaptador, sus capacidades y familias, y cómo se escribe
   la procedencia campo a campo. **Tu adaptador sigue este patrón o no entra.**
5. `1-extractor/fetchers/esma.py` y `fetchers/gleif.py`: dos fuentes oficiales ya hechas, con
   su estilo de módulo, su `FAMILIA` y su uso de `core.schema.set_path`.
6. `1-extractor/tests/test_sin_red.py` y `tests/test_fuentes_oficiales.py`: las pruebas no
   tocan la red; las fuentes se simulan con fixtures.
7. `1-extractor/config/alcance_mercados.json` y `core/adquisicion/alcance.py`: cómo se declara
   hoy el alcance de mercados.

## Qué es FIRDS y por qué es la fuente

FIRDS (Financial Instruments Reference Data System) es la base de datos de referencia de ESMA
bajo MiFIR. Los centros de negociación de la UE están obligados a reportar cada instrumento que
admiten, y ESMA publica el conjunto completo **todos los días, gratis y sin registro**, en
ficheros XML. Para cada instrumento trae, entre otros:

| Campo FIRDS (XML `auth.036`) | Qué es | Dónde va en nuestro canónico |
|---|---|---|
| `FinInstrmGnlAttrbts/Id` | ISIN | clave |
| `FinInstrmGnlAttrbts/FullNm`, `ShrtNm` | nombre completo y corto | `identidad.nombre_oficial` (nuevo, no sustituye al nombre actual) |
| `FinInstrmGnlAttrbts/ClssfctnTp` | **código CFI** (ISO 10962) | `identificadores.cfi` (nuevo) |
| `FinInstrmGnlAttrbts/NtnlCcy` | divisa nominal | control de `identidad.divisa` |
| `Issr` | **LEI del emisor** | `identificadores.lei_emisor` (nuevo) |
| `TradgVnRltdAttrbts/Id` | **MIC** del centro de negociación | `mercados[].mic` (nuevo, uno por centro) |
| `TradgVnRltdAttrbts/FrstTradDt`, `AdmssnApprvlDtByIssr` | primera negociación, admisión | `mercados[].desde` |
| `TradgVnRltdAttrbts/TermntnDt` | **fecha de baja** | `mercados[].hasta`; alimenta la disponibilidad |
| `TechAttrbts/RlvntCmptntAuthrty` | autoridad competente | `regulatorio.autoridad` (opcional) |

Lo que FIRDS **no** da: precios, fundamentales, composición, ni nada de fondos no cotizados. Y
**solo cubre instrumentos admitidos en centros de la UE/EEE**: una acción de EE. UU. aparece
únicamente si algún centro europeo (Xetra, Euronext, Tradegate, Gettex…) la negocia. El
universo de EE. UU. va por otra vía (parte B).

**Cómo se obtienen los ficheros.** ESMA publica un índice consultable (Solr) con los ficheros
disponibles por fecha, y los ficheros en sí como ZIP con un XML dentro. Hay dos tipos: `FULINS`
(conjunto completo, troceado por tipo de instrumento y en varias partes) y `DLTINS` (delta
diario). El tipo de instrumento va en el nombre: la letra `E` son acciones y asimilados, `C`
instrumentos de inversión colectiva (ahí están los ETF), `D` deuda, y hay más que no
necesitamos. **Verifica el formato actual del índice y de los nombres antes de codificar**:
empieza en las instrucciones de descarga publicadas por ESMA (la autoridad sueca las resume en
https://fi.se/en/published/news/2017/esma-publishes-reference-data-and-instructions-for-downloading-files/
y las especificaciones funcionales están en
https://www.esma.europa.eu/sites/default/files/library/esma65-8-9568_-_firds_reference_data_functional_specifications_v2.10.pdf).
Si el índice o los nombres han cambiado respecto a lo que aquí se describe, **documenta lo que
encuentras y adapta el código; no fuerces lo que dice este encargo.**

Los ficheros son grandes (cientos de MB por tipo, descomprimidos más). Dos consecuencias:
se procesan **en streaming** (`xml.etree.iterparse` o `lxml.iterparse` con limpieza de
elementos) y **se filtra al leer**, conservando solo los ISIN que están en el universo actual
o que cotizan en los MIC del alcance. Nada de cargar el XML entero en memoria ni de guardar
el conjunto completo en el repositorio. Los ZIP descargados van a `cache/firds/` (que ya está
fuera de Git) con su fecha, y se reutilizan si existen.

## Parte A: lo que hay que construir

### A.1 `fetchers/esma_firds.py`

Un adaptador con el patrón de `core/adquisicion`, familia `regulatorio` para identidad y una
capacidad nueva para mercados, que:

1. Consulta el índice de ESMA para una fecha dada (por defecto, el último `FULINS` disponible)
   y descarga los ficheros de tipo `E` y `C` que falten en `cache/firds/`.
2. Los recorre en streaming y construye un **índice local por ISIN** en
   `cache/firds/firds_<fecha>.sqlite` (o parquet si prefieres, pero sin dependencia nueva
   pesada; `sqlite3` es de la biblioteca estándar y está bien). Columnas: ISIN, nombre
   completo, nombre corto, CFI, divisa nominal, LEI del emisor, y una fila por MIC con primera
   negociación, admisión y baja.
3. Dado un ISIN del universo, escribe en el canónico los campos de la tabla anterior con
   procedencia `esma:firds` y la fecha del fichero. **Los nombres nuevos se añaden, no
   sustituyen** al `identidad.nombre` que hoy viene de otras fuentes; el CFI y el LEI son
   nuevos; `mercados[]` es una lista nueva.
4. Deriva un **tipo de instrumento según CFI** y lo escribe como `identificadores.cfi_tipo`
   con valores `ACCION`, `ETF`, `FONDO`, `DEUDA`, `OTRO`: categoría `E` → ACCION; `C` con
   segundo carácter `E` → ETF; `C` con otro segundo carácter → FONDO; `D` → DEUDA; resto →
   OTRO. **No cambies el tipo que el sistema usa hoy** (`reclasifica` existe para eso): deja el
   derivado al lado y, en el informe, lista las discrepancias entre el tipo actual y el
   derivado del CFI, que es exactamente lo que Óscar necesita para decidir.
5. Marca disponibilidad: si **todos** los MIC de un ISIN tienen `TermntnDt` pasada, el
   instrumento está dado de baja en la UE. Escribe eso donde el sistema guarda hoy la
   disponibilidad (mira `core/adquisicion/disponibilidad.py` y respeta su contrato), con
   procedencia `esma:firds`. No borres nada: en este proyecto lo que deja de cotizar se marca,
   no desaparece.

### A.2 Comando `universo` en `main.py`

`python main.py universo --fecha YYYY-MM-DD --mercados XMAD,XETR,XPAR,XAMS,XMIL,XBRU,XLIS,XSWX --tipos ACCION,ETF`

Lee el índice local (lo construye si falta) y escribe `reports/universo_firds_<fecha>.csv`
con una fila por ISIN que cotice en alguno de esos MIC y sea del tipo pedido: ISIN, nombre,
CFI, tipo derivado, divisa, LEI, lista de MIC, primera negociación, baja, y una columna
`en_universo` que dice si ya está en `config/fondos.csv` o en el universo de acciones. Es una
**lista de candidatos para que Óscar elija**, no una alta automática: el comando no añade nada
al universo. Los MIC por defecto salen de `config/alcance_mercados.json`; si ese fichero no
los lleva en una forma reutilizable, propón la extensión mínima y hazla.

### A.3 Refresco con deltas

Un segundo modo del mismo adaptador aplica el `DLTINS` de un día sobre el índice local
(altas, modificaciones, bajas) sin volver a descargar el completo. Si el formato de los deltas
hace esto más complejo de lo que vale para el previo, **constrúyelo solo si cabe en el
presupuesto de este encargo y, si no, documenta exactamente qué faltaría**; el completo
semanal es aceptable como primera versión.

### A.4 Pruebas

Sin red, como todas las del proyecto. Mínimo:

- Un fixture XML pequeño en `tests/fixtures/firds/` con 6-8 instrumentos sintéticos (dos
  acciones en dos MIC, un ETF, un fondo no cotizado, una acción con todos los MIC dados de
  baja, un ISIN con nombre con acentos) y una prueba que lo recorre en streaming y comprueba
  el índice resultante fila a fila.
- Prueba de la derivación de tipo por CFI, con los cinco casos y uno malformado.
- Prueba de que la procedencia `esma:firds` queda escrita en cada campo que el adaptador toca
  y en ninguno más (el proyecto tiene pruebas de procedencia que puedes imitar).
- Prueba de que un instrumento con todos los MIC dados de baja se marca y **no** se borra.
- Prueba del comando `universo` sobre el fixture: filtra por MIC y tipo, y marca
  `en_universo` correctamente.
- Prueba de que `main.py universo` no modifica `config/fondos.csv` ni ningún fichero del
  canónico.

`python -m pytest tests -q` tiene que pasar entero al final (hoy son 724 pruebas; con las
tuyas, más). Si alguna existente se rompe por tu cambio, es tu cambio el que se adapta.

### A.5 Una ejecución real, medida

Con red, **una vez**, para el informe: descarga los ficheros `E` y `C` del último `FULINS`,
construye el índice y ejecuta `universo` con los MIC por defecto. Anota tiempos, tamaños y
recuentos. Después comprueba estos diez ISIN y di qué devuelve FIRDS para cada uno (nombre,
CFI, LEI, MIC, baja):

`ES0113900J37` (Santander), `DE0005140008` (Deutsche Bank, ya en el universo),
`FR0000120271` (TotalEnergies), `NL0010273215` (ASML), `IE00B4L5Y983` (iShares Core MSCI
World), `LU0274208692` (Xtrackers MSCI World), `IE00B3RBWM25` (Vanguard FTSE All-World),
`US0378331005` (Apple: debería aparecer solo por centros europeos), `ES0140074008`
(un fondo español: no debería estar), y uno que elijas con fecha de baja reciente.

Para `DE0005140008`, compara lo que FIRDS dice con lo que el canónico tiene hoy y señala
cualquier discrepancia (nombre, divisa, mercado).

## Parte B: el universo de EE. UU., medido pero no construido

FIRDS no sirve para el universo de EE. UU. Mide y documenta, sin construir todavía, cuál de
estas dos vías conviene y qué da cada una, con una llamada de prueba a cada fuente:

1. La lista oficial de la SEC `https://www.sec.gov/files/company_tickers.json` (CIK, ticker,
   nombre; sin ISIN). Recuerda que EDGAR exige un `User-Agent` identificado con un correo y
   limita a 10 peticiones por segundo.
2. La lista de símbolos por bolsa de EODHD (`exchange-symbol-list`), que trae ISIN y que ya
   está pagada en el plan de Óscar. La clave está donde `fetchers/eodhd.py` la lee hoy; no la
   copies a ningún fichero nuevo ni la imprimas.

El entregable de la parte B es media página en el informe: qué da cada una, si el casado
ticker↔ISIN↔CIK cierra, y una propuesta de cómo construirlo en el siguiente encargo.

## Lo que no hay que hacer

- No añadas dependencias nuevas salvo que sea imprescindible; si lo es, dilo en el informe
  y fíjala en `requirements.txt` con versión exacta como las demás.
- No toques `export_bdb/` ni `core/adaptador_bdb.py`: ese canónico se valida contra contratos
  de la plataforma y los campos nuevos lo romperían. Los campos nuevos van al canónico
  universal (`export/`, claves en español) y al fichero por activo de `data/`, como hacen las
  demás fuentes. En el informe, lista qué contrato de `2-plataforma-datos/contracts/base-nueva/`
  habría que ampliar (`instrument.v2`: `identifiers.lei`, `identifiers.cfi`, `listings[]`) para
  que la plataforma los lleve a la base: eso es otro encargo.
- No cambies el tipo de ningún instrumento, no des de alta ningún ISIN, no borres nada.
- No ejecutes `update` masivo, ni `export`, ni `bdb`, ni nada del pipeline aguas abajo.
- Commits pequeños y con mensaje en castellano, como los del repositorio. **Sin `git push`.**

## El informe de cierre

`INFORME_FIRDS_UNIVERSO_<fecha>.md` en la raíz del proyecto, en castellano, con:

1. Qué se construyó, fichero a fichero, y cuántas pruebas nuevas hay.
2. La medición de A.5: tamaños, tiempos, recuentos por MIC y por tipo, los diez ISIN.
3. Las discrepancias entre el tipo actual y el derivado del CFI, en tabla.
4. Los ISIN del universo actual que FIRDS marca como dados de baja, si los hay.
5. La parte B.
6. **Decisiones para Óscar**, cada una con opciones y tu recomendación: qué MIC forman el
   alcance definitivo; si `cfi_tipo` debe mandar sobre el tipo actual cuando discrepan; qué
   hacer con los dados de baja; si el refresco va por deltas diarios o completo semanal.
7. Lo que no pudiste verificar, dicho como tal.

Termina diciendo qué cambió, cómo lo verificaste, qué limitaciones quedan y qué decisión
necesitas, en ese orden. Si algo de este encargo contradice lo que encuentras en el código o
en la fuente, **manda lo que encuentras**, y explícalo.
