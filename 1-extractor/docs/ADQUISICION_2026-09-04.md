# Capa de adquisición — diseño vigente (4 de septiembre de 2026)

Rediseño de la adquisición de datos del extractor para **reducir, no eliminar**
la dependencia de Morningstar. Parte del
[descubrimiento del 04-09](../../DESCUBRIMIENTO_ADQUISICION_DATOS_2026-09-04.md):
una sola fuente no licenciada aportaba el 99,1 % de los campos, con un TTL
único de 7 días (9,4 h y 29 peticiones por fondo en cada pasada) y sin saber,
campo a campo, quién había escrito qué.

## Las cuatro piezas

### 1. Familias de dato y TTL (`core/familias.py`)

Cada petición HTTP declara la familia que sirve y la caché se lee con el TTL de
esa familia. El TTL se aplica **al leer**, así que cambiarlo no invalida nada de
los 1,4 GB ya descargados. Ajustable en `config/settings.json`
(`ttl_dias_por_familia`).

| Familia | TTL | Qué cubre |
|---|---:|---|
| precio | 1 d | VL, precio, fecha (screener de Morningstar: 1 petición) |
| rendimiento | 1 d | rentabilidad, volatilidad y Sharpe diarios |
| analitica | 30 d | estrellas, medalist, matriz de riesgo mensual, drawdown |
| cartera | 30 d | posiciones, sectores, regiones, asignación, renta fija |
| esg | 30 d | globos, carbono, SFDR |
| costes | 90 d | TER, comisiones, MiFID/EMT |
| regulatorio | 90 d | KID, registros oficiales, informes periódicos |
| identidad | 365 d | nombre legal, domicilio, UCITS, gestora, lanzamiento, LEI |

El screener de Morningstar (33 datapoints en una llamada) es el único endpoint
de familia diaria: un refresco diario son **1 petición por fondo** en vez de 29.

Modos de `update`:

- `--familias precio,rendimiento`: refresca solo esas familias; el resto se sirve
  de caché aunque haya caducado.
- `--sin-caducidad`: cualquier entrada cacheada vale (regenerar sin gastar red).
- `--sin-red`: además, lo que no esté en caché se da por ausente.

Al final de cada `update` se imprimen las peticiones a red y a caché por familia.

### 2. Adaptadores con capacidades declaradas (`core/adquisicion/`)

Cada proveedor es un `Adaptador` (`registro.py`) que declara qué rutas del
esquema v2 sabe dar y a qué familia pertenece cada una, qué descargas hace, para
qué activos aplica (`aplica(isin, tipo)`), si es **oficial** (regulador o
registro público) o comercial, y de qué otros adaptadores usa pistas. Una
prueba (`tests/test_capacidades.py`) contrasta la declaración con las rutas que
de verdad escriben los fetchers.

```
python main.py capacidades                    # familias, TTL y adaptadores
python main.py capacidades --sin morningstar  # «si cae X, ¿qué me queda?»
python main.py capacidades --ruta riesgo.sri_kid_1a7
```

Los fetchers de siempre (`fetchers/*.py`) no cambian cómo piden: Morningstar
mantiene URL y parámetros para que la caché siga sirviendo.

### 3. Planificador y núcleo (`planificador.py`, `nucleo.py`)

El planificador elige los adaptadores por activo (aplican, y están en
`prioridad_fuentes` o son oficiales/implícitos) y los ordena. Las familias
pedidas con `--familias` no recortan esa lista: todos los adaptadores se
ejecutan y la caché sirve, sin salir a red, lo que no toca refrescar; así un
refresco de «precio» conserva el SRI del KID o la gestora legal. El núcleo los
ejecuta —una fuente caída no tumba la ficha—,
atribuye cada hoja a su `fuente:endpoint`, fusiona por prioridad y aplica el
saneado de siempre (limpieza, derivados, FIGI, calidad) atribuyendo lo que
crean a `derivado:<paso>`. Es la **única vía** de recolección: CLI, interfaz web
y cualquier cliente pasan por `core.update.ejecuta_pipeline` → `nucleo.adquiere`.

Fusión (`core/schema.py`): hoja a hoja, primer valor no vacío gana, con dos
excepciones deliberadas:

- **frescura**: el valor liquidativo lo pone la fuente con la fecha más
  reciente (la CNMV publica el VL de fin de mes con retraso y pisaba el diario);
- **oficial primero** en `riesgo.sri_kid_1a7`, `identificacion.ucits` e
  `identificacion.domicilio` (`registro.RUTAS_OFICIAL_PRIMERO`).

En el resto de rutas comunes Morningstar sigue ganando y lo oficial rellena
huecos. Lo oficial nuevo va a rutas propias (`costes.kid.*`, `costes.cnmv.*`,
`cartera.cnmv.*`, `identificacion.*_legal`, `documentos_oficiales.*`) para no
cambiar la semántica del bloque `ms.*` del canónico.

### 4. Procedencia por campo (`procedencia.py`)

`core.schema.set_path` es el único punto por el que las fuentes escriben; si hay
un registro activo, anota la ruta con la etapa en curso. El v2 lleva
`meta.procedencia` (ruta → `fuente:endpoint`) y `meta.adquisicion` (plan,
endpoints con su `fetched_at`). El canónico lleva `provenance` (campo del
canónico → etiqueta, endpoints, dependencia por fuente) y `regulatory`
(`core/canonico_regulatorio.py`).

## Fuentes

| Adaptador | Oficial | Activos | Qué da | Coste por fondo |
|---|---|---|---|---|
| morningstar_lt | no | fondos, ETF | analítica propietaria y ficha completa (73 rutas) | 1 diaria + resto por familia |
| cnmv | sí | ES | registro, VL fin de mes, patrimonio, partícipes; trimestral: comisiones devengadas, TER, vocación, rentabilidad/volatilidad, rotación, **cartera completa** | 0 (ZIP mensual y trimestral compartidos) |
| cnmv_ficha | sí | ES | armonizado/UCITS, nº y fecha de registro, gestora y depositaria legales, **KID de la clase** (SRI, costes, fecha, productor), fecha de emisión del ISIN | 3-4 |
| cssf | sí | LU | UCITS, paraguas, compartimento, clase, divisa, autorización (481/482 fondos LU) | 0 (fichero mensual) |
| esma | sí | LU, IE, FR, BE, FI, DE… | marco UCITS/AIF, **gestora legal**, domicilio, estado, países de comercialización | 1 |
| amf_geco | sí | FR | gestora y LEI, OPCVM/FIA, depositario, fechas, clasificación AMF, clase, **DIC/KID** | 4 |
| kid_gestora | sí (documento del productor) | no ES | **KID de la clase**: SRI, composición de costes, fecha, productor, SFDR. Patrón de URL por ISIN o por nombre legal de la clase (DWS, Amundi, JPMorgan, Invesco, Nordea, Candriam, Goldman Sachs, Schroders, M&G) y espejo de último recurso (documentación de fondos de Deutsche Bank España) | 1-3 la primera vez; 0 después (PDF en `cache/kid/gestoras/`, 90 días; los fallos se recuerdan 30 días) |
| gleif | sí | ES, FR | LEI, nombre legal, jurisdicción, gestora legal | 1-2 |
| eodhd | no (de pago) | acciones, ETF | identidad de cotización, precio, métricas, fundamentales | según plan |
| justetf | no | ETF | cotización y ficha | 1-2 |

`core/kid.py` lee el KID/PRIIPs en español, inglés y francés. Los costes se leen
por celdas (coordenadas de los bloques de texto) porque en los KID a dos columnas
la cifra de una fila puede ir antes o después de su etiqueta en el texto plano.
El SRI se lee de la prosa («clasificado este producto en la clase/categoría N de
7») y, si el documento no lo dice con palabras (Nordea, Schroders, BlackRock,
DWS…), del gráfico de la escala 1-7: el dígito resaltado es el de color distinto
o el que falta bajo la casilla rellena; solo se acepta una fila inequívoca.

### El KID fuera de España (`fetchers/kid_gestora.py`)

No hay repositorio oficial de KID para fondos LU/IE: la CNMV solo publica los de
los fondos españoles y su registro de IIC extranjeras va por NIF, sin documentos.
El Reglamento PRIIPs obliga al productor a publicarlo en su web, así que el
adaptador va a buscarlo allí, por ISIN, en dos pasos:

1. **Patrón de la gestora**, elegido por las pistas disponibles (marca y nombre
   de Morningstar, nombre legal de la CSSF, productor del KID anterior): DWS,
   Amundi (y First Eagle Amundi), JPMorgan (servicio de documentos Fundsquare),
   Invesco, Nordea (FundConnect), Candriam (su ficha por ISIN), Goldman Sachs,
   y Schroders y M&G, cuya URL se construye con el compartimento y la clase
   legales (CSSF) o el nombre de Morningstar.
2. **Espejo de último recurso**: la documentación de fondos de Deutsche Bank
   España, indexada por ISIN, que sirve el PDF del productor tal cual (mismos
   bytes que el original en todas las comparaciones hechas).

Guardas: el PDF se rechaza si habla de otro ISIN (Franklin Templeton sirve el
mismo documento sea cual sea el ISIN del nombre del fichero) y si no trae ni SRI
ni costes legibles; una respuesta que no es PDF (Goldman Sachs devuelve HTML
cuando el documento no existe) cuenta como fallo. Cada PDF vive en
`cache/kid/gestoras/<fuente>/` con el TTL de la familia regulatorio; si al
renovarlo la red falla, el PDF viejo sigue valiendo. Un patrón que no existe para
un ISIN se apunta (`.miss`) y no se vuelve a pedir en 30 días. El adaptador no
pide nada cuando la CNMV o la AMF ya han dado el KID en la misma pasada.

El adaptador cuenta como **oficial** porque el KID es el documento regulatorio
del productor, lo aloje quien lo aloje; `regulatory.kid.source` dice de qué
fuente salió y la procedencia lleva `kid_gestora:<fuente>`.

## Correcciones manuales en origen (`core/correcciones.py`, 05-09-2026)

Cuando una fuente trae un dato mal y no hay otra que lo corrija (un SRI de un
KID viejo, un domicilio equivocado, una gestora legal con el nombre del
comercializador), se corrige **ese campo** en `config/correcciones.json`
(ISIN → ruta v2 → `{valor, motivo, autor, fecha}`), no en el canónico ni en la
maestra: así la corrección sobrevive a la siguiente pasada y llega a la maestra
por el mismo camino que todo lo demás (ficha → canónico → pasada en seco →
escritura).

El núcleo la aplica después de fusionar las fuentes y **antes** del saneado
(limpieza, derivados, calidad), de modo que lo derivado se calcula ya con el
dato corregido. La procedencia del campo pasa a `manual:<autor>` (visible en
`meta.procedencia` y en `provenance.fields` del canónico) y `meta.correcciones`
guarda qué había (`valor_fuente`, `fuente`) y si la corrección resultó
`redundante` (la fuente ya coincide: se puede retirar). `manual` **no** cuenta
como fuente oficial.

Reglas: solo valores escalares o `null` (borra el campo); la ruta tiene que
estar declarada por algún adaptador y, si solo la ampara un comodín y la ficha
no tiene el campo, hay que decir explícitamente que es nuevo; `motivo`
obligatorio; el tipo se acomoda al del dato existente (un SRI es entero, un
UCITS booleano) y un texto donde hay número es un error.

```
python main.py corrige LU0616856935 riesgo.sri_kid_1a7 4 --motivo "KID 2026-02 del productor"
python main.py update LU0616856935 --sin-caducidad && python main.py bdb && python main.py export
python main.py corrige --listar
python main.py corrige LU0616856935 riesgo.sri_kid_1a7 --quitar
```

La app lo hace por el servicio de operaciones (`GET/POST/DELETE
/api/ops/correcciones`), que además lista los campos corregibles de la ficha
con su valor y su fuente.

## Comportamiento que se conserva

Recorte por cobertura FX, deduplicación por fecha, combinaciones (id, asset) en
sal-service (ahora con memoria negativa de 30 días), escritura atómica, la
comisión de gestión nunca se imputa desde el TER, los buckets de
`classification_v2` a null, validación real en `calidad`, guarda de calidad
(`quality_regression_reason`) antes de sobrescribir una ficha.

## Verificación

```
python tools/sync_contratos.py --check
python -m ruff check .
python -m pytest
python tools/diff_canonicos.py ANTES DESPUES --salida reports/diff   # oráculo campo a campo
```

Los canónicos validan contra `fondosdb-fund.v1` / `fondosdb-stock.v1` en el
adaptador (`additionalProperties: true`: `regulatory` y `provenance` entran sin
tocar el contrato).
