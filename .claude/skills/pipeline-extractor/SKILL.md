---
name: pipeline-extractor
description: Ejecuta el pipeline de datos de fondos — del extractor a la base nueva — en el orden obligatorio, con los gates, las reglas de propiedad y las barreras de proyecto que lo rompen si se saltan. Úsalo cuando haya que refrescar datos de fondos, regenerar el export canónico, o escribir y auditar la base nueva.
---

# Ejecutar el pipeline del extractor

Es la única secuencia del sistema que escribe el catálogo de la base nueva, y es **manual a
propósito**. No hay orquestador: cada etapa se lanza a mano y en orden.

```
update → calidad → export → bdb (→ series, cambios) → baseNueva:write → baseNueva:batch → baseNueva:series → audit:base-nueva
```

**La maestra vieja ya no tiene pipeline.** Su cargador y su republish (`load:fondosdb`,
`republish:fondosdb`, `audit:consistency`, `reclassify:stock`, `archive:assets`), sus reparaciones
y su copia diaria se borraron el 21-11-2026 (decisiones 30 a 39 de Óscar, sobre
`CENSO_BASE_VIEJA_2026-11-21.md`); el estado anterior está en la etiqueta de Git
`referencia-base-vieja-2026-11-21`. Si un documento o un recuerdo te pide uno de esos comandos, ya no existe.

**No mezclar artefactos de fechas distintas.** El escritor de la base nueva consume `export_bdb/` y
`export/fondos.ndjson` de la misma pasada; cruzarlos produce documentos incoherentes que la
auditoría no siempre detecta.

## Los proyectos: el destino lo pone el código, no el entorno

**Los dos proyectos viven en un solo sitio:** `2-plataforma-datos/src/config/projectAllowlist.ts`, y
**separados por papel**. La base nueva tiene `PROYECTO_BASE_NUEVA` y `HOST_EMULADOR_BASE_NUEVA`, y el
escritor (`src/loader/baseNuevaWriter.ts`) los toma de ahí y no del entorno: si una variable pide otro
proyecto u otro puerto, se para nombrando el conflicto. El proyecto real de BDB queda rechazado por
construcción, no por configuración.

`ALLOWED_PROJECT_ID(S)` es el de la base vieja, `gestor-activos-local`. Desde el 21-11-2026 **no lo importa
ningún programa** —sus seis consumidores se borraron con ella—, y se queda a propósito: es la pareja del
defecto seguro de `functions_python/master_project.py` (un id que no existe en la nube) y
`barreraDeBdb.test.ts` compara los dos. La regla sigue: **el id real de la base nueva no entra en ese
conjunto.** Quien lo usara para autorizar una conexión sin exigir emulador escribiría en la nube en cuanto
exista una clave de servicio. `tests/projectAllowlist.test.ts` falla si se juntan.

`tests/projectAllowlist.test.ts` falla también si alguien vuelve a escribir el literal del
proyecto de BDB en cualquier `.ts` de `src/` o `scripts/`, con cinco excepciones declaradas:
las tres guardas que lo prohíben, `asesores.ts` y la cabecera del propio
`projectAllowlist.ts`, que lo nombran en un comentario.

**La prueba que barre el repositorio es `3-BDB-ACTIVOS_app/tests/barreraDeBdb.test.ts`**
(decisión 106, 05-11-2026), y corre con `npm test` de la app: el id y el número de proyecto de
BDB solo en su lista declarada, todo cliente de base con el proyecto de la constante, las
órdenes contra BDB solo en `docs/historico-bdb/`. Si la hace fallar algo tuyo, no lo añadas a
la lista sin mirar qué hace. Los dos programas de `_legacy/scripts/` que abrían el proyecto de
la clave que encontrasen ya no se ejecutan.

Por qué está en un solo sitio: hasta el 30-10-2026 el literal estaba copiado en dieciséis ficheros, con dos
ortografías distintas (`ALLOWED_PROJECT_IDS` con un `Set` y `const PROJECT_ID` con un
`!==`), y al corregirlo un grep de la primera forma se dejó cinco sin cambiar.

### Lo que nunca se hace

Si una etapa se niega por el proyecto, la salida intuitiva es poner
`FIREBASE_PROJECT_ID=bbdd-activos-financieros`. **Nunca.** Es apuntar el clon al proyecto
real de BDB, y si además falta o se cae `FIRESTORE_EMULATOR_HOST`, la etapa escribe en la
maestra de producción. Rompe la regla que no se rompe. El error no es un obstáculo: es la
barrera funcionando.

### Las guardas que van al revés y se dejan como están

`scripts/restoreBackupToEmulator.ts` **prohíbe** explícitamente el proyecto de BDB, y desde el
03-11-2026 también `subirALaNube.ts` y `verReglasDesplegadas.ts`, que niegan su clave. Siguen
nombrándolo a propósito. No los «uniformes». (La cuarta, `runBackupExport.ts`, se borró con la base
vieja el 21-11-2026.)

## Primera mitad: el extractor

Desde `1-extractor`. Produce solo ficheros locales; no toca Firestore ni red de BDB.

```bash
python main.py update --all              # refresca; con caché válida apenas descarga
python main.py calidad                   # recalcula score y flags
python main.py export                    # NDJSON + CSV en export/
python main.py bdb                       # canónicos en export_bdb/
```

Banderas de `update` que importan: `--force` ignora la caché, `--sin-red` trabaja sin
salir a internet, `--fuentes` y `--familias` limitan lo que se refresca, `--sin-historico`
se salta las series. Hay más subcomandos (`add`, `cnmv`, `figi`, `report`, `contraste`,
`cobertura`, `capacidades`, `visor`); `python main.py -h` los lista.

**`calidad` se re-ejecuta tras cada `update` masivo.** El cargador de la maestra vieja seleccionaba
con sus informes (`--ids quality-ok`); se borró el 21-11-2026, y la cadena `calidad` → `export` → `bdb`
sigue como estaba.

`export_bdb/` es **entrada para dry-run y gate**, nunca carga directa.

### Dos `update` a la vez se pisan el índice

Los dos escriben `data/funds/` y `data/index.json`. Si hay una pasada larga en marcha, no se
lanza otra: se espera. No hay cerrojo que lo impida.

### Refrescar unos pocos ISIN sin mover a los demás

Nombrar un ISIN no limita lo que se refresca a ese ISIN. Una acción pide también la serie de su
referencia (`IE0007987708.EUFUND` para Madrid, por `_aplica_referencia`) con el plazo de la familia
`precio`, un día. Si ha caducado, la reescribe en la caché, y el siguiente `python main.py series`
exporta ese instrumento con puntos que su ficha no conoce. Por eso, medido el 05-11-2026:

```bash
python main.py update <ETF> --familias precio             # un ETF pide su serie con esa familia
python main.py update <acciones> --familias identidad     # la serie de la acción sale a red igual; la referencia, no
```

Y una acción pregunta **siempre** a Yahoo por sus fundamentales (`_fundamentals_yahoo`), con `--familias` o sin ellas, y por `yfinance`,
que no pasa por `core/http.py`. Si la orden solo autoriza EODHD, hay que impedirlo a mano: DIGI se trajo el 05-11-2026 con una guarda
en `requests`, sin importar `yfinance` y conservando los fundamentales que ya tenía su ficha, con su fecha.

Con eso `export_series/` salió idéntico byte a byte en los 1.080 que ya estaban, y el canónico solo cambió
en los cuatro pedidos. **Copia antes `export_bdb/`, `export/fondos.ndjson` y `export_series/`**: es la
única forma de medir después qué se ha movido. Lo que sí cambia en todos es el sello de la pasada:
`updated_at` en la raíz, `package_id` en `declared/provenance` y `computed_at` en parte de `computed/metrics`.

### Un símbolo que el buscador de EODHD no encuentra por ISIN

EODHD cotiza valores que `/api/search` no encuentra por ISIN, porque el listado figura sin ISIN o con
otro. Le pasa a Prisa, a Desa, a Árima, a DIGI y a iShares Energy Storage. Sin nada más, una acción cae
a Yahoo, cuya serie **no se exporta** (`fuente_no_exportable`), y un ETF se queda sin serie y sin métricas.
Se arregla en origen, con motivo y autor:

```bash
python main.py corrige <ISIN> identificacion.simbolo_eodhd <SIMBOLO> --motivo "..." --autor "..."
python main.py corrige <ISIN> identificacion.mercado <BOLSA> --motivo "..." --autor "..."
```

Vale para acciones y, desde el 05-11-2026, para ETF (`eodhd.listado_de_etf`). En un ETF solo cuenta la
corrección y nunca el símbolo de la ficha anterior: su cotización la elige el buscador, que prefiere la de euros.

Antes de escribirla, la llamada real: nombre, divisa y nivel contra el `vl` de la ficha y contra la serie de
la base vieja. Tres cosas que se confunden:

- **La divisa de la base vieja puede ser la convertida.** `STOR.AS` cotiza en dólares, y la base vieja lo
  guarda en euros. Lo que casa con EODHD es su `source_value` (439 de 439), no su `value`.
- **El precio de la ficha puede cambiar de divisa.** La tupla `valoracion.vl` sale de la fuente con la fecha
  más reciente. Ese ETF pasó de 8,73 EUR, que era el valor liquidativo de justETF, a 9,765 USD, su cierre en Ámsterdam.
- **El nombre también cambia de fuente.** EODHD escribe «Arima Real Estate SOCIMI SA». Si no se quiere ese
  cambio de rebote, otra corrección en `identificacion.nombre`.

Y traer la serie no basta si el instrumento está en la cuarentena de divisa: `FX_QUARANTINE_ASSET_IDS`, en
`functions_python/optimization/repository.py`, es una lista fija de siete. Sin
`BDB_VERIFIED_PRICE_REPAIR_RELEASES` en el entorno de Functions salen de la simulación y de la gráfica de su
ficha con `FX_SERIES_MISSING`, aunque su serie esté bien.

### Después de arreglar un MAPEO, se re-mapea desde caché y es gratis

Un arreglo en el mapeo no cambia ningún dato por sí solo: las fichas se escribieron con el
mapeo viejo y siguen igual hasta que el extractor vuelva a mapear. Y volver a mapear **no
cuesta red**:

```bash
python main.py update --all --sin-red --sin-caducidad
```

`--sin-caducidad` acepta cualquier entrada de caché tenga la edad que tenga, y `--sin-red`
convierte un fallo de caché en `SinCache`, que el núcleo recoge sin tumbar la ficha
(`core/adquisicion/nucleo.py`). Así que cada bloque se vuelve a mapear con el código nuevo
sobre la respuesta que ya está guardada.

Comprobado el 01-11-2026, porque es fácil suponerlo y equivocarse: lo que sirve `--sin-red`
es la **caché HTTP** (`cache/http`, 16.731 entradas indexadas por SHA-1 de la URL), no el
volcado de `cache/raw_morningstar_lt/`, que es para inspección y nadie lo lee de vuelta. Para
el endpoint de asignación de activos hay 536 respuestas en la caché HTTP, más que los 379
volcados, así que el re-mapeo las alcanza todas.

Y después del re-mapeo hay que encadenar `calidad` → `export` → `bdb`, porque el canónico que
consume la plataforma se genera en el último paso.

**Lo que un re-mapeo no alcanza, medido el 05-11-2026.** Un fondo que la guarda de calidad no deja
reescribir (`QUALITY_REGRESSION_BLOCKED`) se queda con su ficha: 12 se quedaron sin el campo nuevo, y
solo una pasada con red los arregla. Una acción que solo cubre Yahoo no se puede preguntar sin red: no
recibe marca de disponibilidad y conserva la que tenía; desde el 05-11-2026 no le pasa a ninguna: la última, DIGI, ya
tiene su corrección de símbolo, y `export_series/_resumen.txt` no da ni una `fuente_no_exportable`. Y `baseNueva:plan` llama `reemplazar` a todo lo
que ya existe, cambie o no: lo que cambia de verdad lo cuenta `npm run baseNueva:plan -- --verify`, en
`distintos`, y hay que saber explicarlo antes de abrir el gate.

**Una acción que se trajo con una corrección de símbolo sale «retenida» de un re-mapeo.** Medido el 05-11-2026: Árima,
Desa y Prisa se quedan con sus datos, pero con la marca `dato_retenido` y la procedencia `retenido:eodhd`, porque sin red
no se puede volver a preguntar. Si el re-mapeo no va con ellas, se devuelve su ficha de antes, de `data/funds/`, y luego
`calidad` → `export` → `bdb`. Por eso, antes de un re-mapeo se copia también `data/funds/`, y después se compara el canónico
ruta a ruta: lo que no sea tuyo y no sean marcas de tiempo tiene que tener explicación.

**Lo que el re-mapeo sin red del 09-11-2026 movió sin que fuera suyo, ya arreglado** (`251c0ba`, `174a140`, `9af27df`):
el `rf_pct` de 504 acciones cambiaba porque el €STR se pedía con dos caducidades distintas (ahora una sola
petición, `fetchers/estr_bce.pide`, y la ficha lleva `rf_hasta`); 494 acciones ganaban la marca «retenido» porque
sin red se saltaba Yahoo y la retención copiaba el bloque vacío (ahora el bloque de fundamentales se arrastra tal
cual con su procedencia, `arrastra_sin_red`, y `meta.adquisicion.sin_servir` lo dice); y cuatro italianas pasaban de
sector `""` a nulo (ahora el vacío es nulo también con red). Un re-mapeo sin red debería ser neutro salvo en lo que
se le pida; si no lo es, sigue valiendo la regla de arriba: copia antes, compara después, y lo que no se explique
se devuelve. Las acciones que solo cubre Yahoo siguen saliendo «retenidas» sin red.

**La serie de un fondo es su valor liquidativo: `close`, y lo que cotiza es `adjusted_close`** (`vl_fondos.serie_de_simbolo`, decisión
72). De 758 fondos solo uno se separaba, medido el 05-11-2026, y `export_series/` comparado byte a byte es como se comprueba que no se mueve otro.

**La política de una clase se anota leyendo su KID, en `config/politica_kid.json`,** con la frase tal cual y la huella de la ficha
(`documentos_oficiales.kid_sha256`, el hash de `kid.texto_pdf`), y no en `correcciones.json`, que le daría el grado de registro oficial. Sin KID
citable en la ficha no se puede anotar: un KIID antiguo no vale, y es lo que le pasa a BNY Global Real Return. Se aplica con
`python main.py update <ISIN> --sin-red --sin-caducidad`. Tres cosas que trae: la clase gana métricas propias, y en las ventanas a las que su serie
no llega sigue la del proveedor, con su nombre (decisión 110: Allianz AT2 lleva nuestro 1 año y sus 3, 5 y 10); las cifras del proveedor siguen en
`declared/provider_returns`, que es lo que lee la excepción de la decisión 55; y con la serie parada se escribe igual lo del KID, sin cifras.

**Lo que nuestras métricas desplazan no se tira** (decisión 110). El extractor lo guarda en `meta.contraste`, y el mapeo lo recupera por bloques
—rentabilidad, volatilidad y Sharpe— en `declared/provider_returns` y `declared/provider_risk` (`conLoDesplazado`). Medido el 05-11-2026: sin
esto, el Sharpe a 10 años del proveedor se perdía en 549 fondos, y 31 perdían alguna cifra que su tarjeta enseña.

**Una ventana con hueco no se publica** (decisión 111, `metricas.HUECO_MAXIMO_DIAS`): más de 31 días seguidos sin un punto dentro de la ventana.
El hueco queda escrito en `computed/metrics.inputs.series_gaps`, y `update` deja pasar las dos guardas de las acciones cuando la ficha nueva
trae algún hueco escrito. Sin hueco, una acción que pierde métricas se sigue parando; con hueco, la guarda no distingue si además se perdió otra cosa.

**Lo que se negocia sale al exportar, no al actualizar** (decisión 108, `core/negociacion.py`): `export` lo calcula de la respuesta de EODHD
que ya está en `cache/http`, sin red, para ETF y acciones, y no obliga a re-mapear. El cierre de EODHD no está ajustado y el volumen casi siempre sí:
la mediana es solo de lo posterior al último salto del cierre, y `sesiones_de_la_mediana` dice de cuántas.

**El KID: lo que se escribe «KID» tiene que salir de ese documento.** Es la decisión 43, y `core/kid.py` lee su tabla por
filas sobre líneas visuales. Un cambio ahí se comprueba releyendo los PDF de `cache/kid/` contra el canónico, cifra a cifra, y no
solo con las pruebas: es como salió que PIMCO, con un «0 % en el KID», dice «492 EUR». `regulatory.kid.costs` trae el rendimiento
como el tipo contractual y no como su impacto anual: ese sigue sin llegar a la base.

## Segunda mitad: la plataforma, que escribe la base nueva

Desde `2-plataforma-datos`. Los guiones de la base nueva **no leen `.env.local`**: ese fichero era el
destino de la base vieja, y el de la nueva lo pone el escritor, de la constante (ver arriba).

La base nueva tiene sus propios contratos (`contracts/base-nueva/`) y su propio escritor. Desde el
01-11-2026 **no está en el emulador de la vieja**: tiene proyecto propio (`bdb-gestor-de-activos`), su emulador en el **8092** y
persistencia en disco. Se levanta con `node 4-base-nueva/arrancar.mjs`; lo lleva la habilidad
`arrancar-entorno`.

Estado medido el 01-11-2026: **11.566** documentos, todos validando contra su contrato. Son
dos pasadas, y la segunda se olvida: `baseNueva:write` escribe 10.036 documentos y
`baseNueva:batch` los 1.542 de `quality/latest` y `read/card`. Sin la segunda la base tiene
bloques y **cero tarjetas**, que es lo que leerá la app.

Las series van en una tercera, y esa tampoco la hacen las otras dos: `baseNueva:series -- --write` sube lo
que dejan `python main.py series` (`export_series/`) y `python main.py cambios` (`export_fx/` y `export_rf/`).
Sin ella un instrumento tiene cifras y no tiene serie, y en la simulación sale `PRICE_SERIES_MISSING`.

```bash
# INSTRUMENTOS. Pasada en seco sobre el canónico, sin emulador y sin gate:
npm run dryrun:base-nueva

# plan contra el emulador (lee, no escribe)
# Para tocar solo unos instrumentos (D-9, 11-11-2026): --ids en write, batch y series. Sin el filtro,
# cada pasada reescribe los sellos de todos y recompone el índice de búsqueda. Pedir a la red solo
# esos instrumentos y hacer el resto sin red (update --sin-red --sin-caducidad).
npm run baseNueva:plan

# escribir, con las cinco barreras delante
npm run baseNueva:write -- --write --verify
npm run baseNueva:batch -- --write
npm run baseNueva:series -- --write

# auditar lo escrito
npm run audit:base-nueva
```

**`audit:series` no audita estas series.** Lee la colección vieja `assets/*/price_series`, que en esta base
está vacía, así que da 0 instrumentos con serie aunque haya más de mil. Comprobado el 05-11-2026, con 5.487.279
puntos en la base. Quien las comprueba es `baseNueva:series -- --write`, que relee los puntos y los compara con la fuente.

```bash
# CARTERAS del asesor (el dominio de clientes). Leen bdb_activos de la base nueva, o un NDJSON con --fuente.
# La pasada en seco que leía la base vieja (dryrun:carteras) se borró el 21-11-2026: la migración ya estaba hecha.
npm run carteras:plan
npm run carteras:write -- --write --verify
```

Para los dos `--write`, el gate va **delante de la orden concreta**, nunca exportado. En
PowerShell, que es donde Oscar trabaja:

```powershell
$env:BDB_DATA_PLATFORM_ENABLE_MASTER_WRITES = "YES_I_UNDERSTAND_MASTER_DB_WRITES"
npm run baseNueva:write -- --write --verify
$env:BDB_DATA_PLATFORM_ENABLE_MASTER_WRITES = $null
```

### Lo que hay que saber antes de abrir ese gate

- **`baseNueva:plan` dice cuántos documentos CREA y cuántos REEMPLAZA.** Un número alto de
  creaciones después de añadir un bloque es lo normal; uno alto de reemplazos después de
  tocar un mapeo significa que vas a reescribir datos que ya estaban, y conviene saber por
  qué antes de hacerlo.
- **Los SOBRANTES.** El plan marca lo que está en la base, está en las rutas posibles y ya no
  se produce. En carteras eso es imprescindible y no decorativo: una cartera se guarda
  sustituyendo, así que una posición que el asesor retira deja su objetivo huérfano. Por eso
  las rutas posibles se construyen con la unión de lo que trae la fuente y lo que ya hay en
  la base (`rutasPosiblesDeCartera`).
- **El escritor no borra: los nombra y decide Óscar.** Lo que él aprueba borrar va ruta a ruta en
  `BORRADOS_APROBADOS` (`src/ingestion/baseNueva/borradosAprobados.ts`), y sin aprobación no entra
  ninguna. En el emulador lo hace `npm run baseNueva:borrar -- --write`, con el gate delante, y
  después hay que recomponer calidad y tarjeta con `baseNueva:batch -- --write`. En la nube lo hace
  la subida del catálogo: `nube:plan` lo enseña, y solo borra con `--escribe` y su puerta. Lo demás
  que sobre allí se cuenta, «N de mas en la nube», y se queda. **Hoy la lista tiene 149 rutas:** tres
  instrumentos retirados enteros (Honeywell when-issued y Prysmian, decisión B-45; el Xtrackers monetario
  `LU0290358497` con sus 56 documentos, decisión B-70 del 09-11-2026), un año de serie que el
  proveedor recortó (`instruments/IE00B6R52259/price_series/2011`, decisión B-64 del 09-11-2026) y las métricas
  viejas de un fondo con la serie parada (`instruments/LU0171283459/computed/metrics`, decisión B-67 del 09-11-2026).
  Los tres instrumentos enteros llevan la marca `instrumento_retirado`, porque sin ella un origen que no tiene el
  instrumento se lee como un fallo de lectura y no se borra nada; con ella se exige que el origen sea un catálogo
  entero. Las rutas sueltas no la llevan. Se borra entre
  `baseNueva:write` y `baseNueva:batch`, para que el batch no recomponga tarjetas de lo que se va.
- **El reparto por clase es neto, y una clase puede salirse de 0-1 hasta un punto** (decisión A-63,
  `peso_de_clase` en el contrato). La cifra pasa tal cual: un negativo no se escribe a cero. Más allá de
  ese punto no hay reparto aunque lo demás sume 1, y `dryrun:base-nueva` lo cuenta en sus avisos,
  «asset_mix con una clase fuera de rango». Quien lea `asset_mix` tiene que aceptar un negativo pequeño.
- **Y `declared/exposure` puede no traer `asset_mix`** (decisión 109): si el reparto por clases no pasa, se
  conservan regiones, sectores y caja de estilo, y nada más. Quien lea una región sin reparto no sabe qué
  parte es bolsa: el servidor la pone por la clase del fondo. Repartir su peso entero es hacerlo a ciegas.
- **`baseNueva:batch` lee `functions_python/fund_history_policies.json` de la app** (decisión 112): de ahí
  sale la fecha desde la que vale la serie, y la tarjeta no enseña una cifra cuyo periodo empiece antes, sea
  nuestra o del proveedor. Si ese fichero cambia, hay que repetir el batch.
- **Escribir antes de que el canónico esté al día no sirve de nada.** El escritor lee
  `export_bdb/` y `export/fondos.ndjson`. Si la pasada del extractor no ha terminado, o no se
  han encadenado `calidad` → `export` → `bdb`, estarás escribiendo la foto anterior y habrá
  que repetirlo entero.
- **Un documento puede escribirse con un dueño distinto al de la pasada.** `computed/metrics`
  lo calcula un lote dentro del extractor, así que viaja con `comoDueno: 'batch'` aunque lo
  transporte la plataforma. La barrera de dueño lo comprueba contra el dueño del dato, no
  contra el del proceso. Si alguna vez una de estas escrituras falla con «es de batch y
  escribe platform», la salida NO es cambiar el `x-owner` del contrato: eso es mentir sobre
  quién calculó la cifra para que pase la puerta.

## Los planes de pensiones y las EPSV: una pasada aparte, que no es el pipeline

Decisión D-11 (13-11-2026). Es un catálogo **aparte** de los instrumentos, para `Planificación → Planes y EPSV`: no pasa por
`update`, no toca `data/funds/` ni `export_bdb/`, y sus documentos viven en `pension_plans`, no en `instruments`. Tres órdenes,
y la tercera se olvida:

```bash
# 1-extractor: la lista del buscador de planes del banco y la serie de cada uno (unas 223 peticiones con la caché fría)
python main.py planes                                 # --sin-red / --sin-caducidad / --sin-series / --force

# 2-plataforma-datos: plan en seco, y escribir en el emulador de la base nueva con las barreras de siempre
npm run planes:plan
BDB_DATA_PLATFORM_ENABLE_MASTER_WRITES=YES_I_UNDERSTAND_MASTER_DB_WRITES npm run planes:write -- --write --verify

# raíz: guardar el volcado, o un cierre a la fuerza del emulador se lleva lo escrito
node 4-base-nueva/guardar.mjs
```

Lo que conviene saber antes:

- **Si la lista no llega entera no se escribe nada**, ni en el fichero ni en la base. Una serie que no llega no tumba la
  pasada: el plan entra sin gráfico y se nombra.
- **Plan o EPSV lo decide el extractor** con dos señales que tienen que coincidir (código de la DGSFP, y «EPSV» en el
  nombre). Lo que no coincide sale en `sin_clasificar` y no entra: no se arregla relajando la regla sin mirar el caso.
- **La escala cambia en la plataforma, no en el extractor.** `export_planes/planes.json` va en tanto por ciento, como lo
  da la fuente; la base, en fracción. Una cifra que el contrato rechaza por su rango se aparta y se cuenta.
- **No se borra.** Un plan que el banco retire de su buscador se queda en la base con su fecha de consulta vieja, y
  `planes:plan` lo nombra en «en la base y ya no en la fuente».
- **A la nube sube aparte:** `npm run nube:plan -- --parte planes` y, con la aprobación de Óscar, `nube:subir -- --parte
  planes --escribe`. `--parte catalogo` no lo arrastra, y `refrescar.mjs` tampoco. Las reglas de `pension_plans` tienen
  que estar desplegadas antes, o la app publicada recibe un 403.
- **`export_planes/` no va al repositorio**: son datos de Morningstar. Qué se pide y qué se dejó fuera, con su medición,
  está en la cabecera de `fetchers/morningstar_planes.py` y en D-11.

## La regla que sigue rompiendo cosas

**El gate se abre por comando, no por sesión.** Ponlo delante de la orden concreta que escribe,
nunca con `export`. Una variable exportada convierte cualquier otra etapa en una escritura no
vigilada. Las otras cuatro reglas que había aquí eran del cargador de la maestra vieja (create-only,
los dos dueños de `metrics/latest`, `audit:consistency` sin gate y `--accept-canonical`) y se fueron
con su código el 21-11-2026.

## La evidencia del SRI no se guarda: se deriva

`declared/regulatory.kid_evidence` —lo que sostiene ante un cliente el SRI de un fondo— **no lo escribe
nadie a mano**. Lo deriva el mapper de la base nueva (`src/ingestion/baseNueva/mapper.ts`, bloque
`declared/regulatory`) a partir de `regulatory.kid` del canónico: **sin URL, huella y fecha del KID no hay
`sri` ni `kid_evidence`**, e `isin_evidence` dice si la URL del documento nombra el ISIN (`DOCUMENT_URL`) o
no (`NONE`). El contrato (`instrument-declared-regulatory.v2`, `kid_evidence`) explica por qué las ocho
puertas del mapper de la maestra vieja (`withSriKidEvidence`, borrado el 21-11-2026) se redujeron a eso.

**La trampa al medir esto:** un análisis de puertas encuentra la **primera** que falla, no todas.
El 31-10-2026 conté los que se caían en la 4 como si arreglar la fecha los fuera a salvar todos, y
al arreglarla nueve de dieciocho avanzaron hasta la 6 y se cayeron ahí. Para estimar cuántos gana
un arreglo hay que simular las puertas que vienen **después**, no contar la que falla ahora.

La cadena entera, de punta a punta, es: el KID en PDF → `core/kid.py` lo parsea
(`fecha_documento`, `sri`) → la ficha en `documentos_oficiales.kid_*` → el canónico en
`regulatory.kid` → la base nueva en `declared/regulatory`. Un fondo que publica SRI sin evidencia
está roto en alguno de esos cinco saltos, y casi nunca en el último.

**Y la regla que no se toca al tocar esa cadena:** `es_priips()` en `core/kid.py` es lo único que
separa el SRI del **SRRI**. Un KIID de UCITS —titulado «Documento de datos fundamentales **para el
inversor**», y los hay sirviéndose hoy desde Renta 4— redacta su clase de riesgo casi igual que un
KID de PRIIPs, así que los patrones del SRI leen su dígito sin inmutarse. Pero ese dígito es un
SRRI, de otra escala. Si se afloja ese guardia, o se añade un camino que no lo consulte, entra un
SRRI en el campo del SRI y **ningún audit lo detecta**, porque el valor es un entero perfectamente
válido entre 1 y 7. `tests/test_kid_sri_redacciones.py` lo fija: comprueba que el patrón lee el
dígito y que el guardia marca el documento para que el fetcher lo tire.

## Antes de dar una pasada por buena

- `baseNueva:plan -- --verify` antes de abrir el gate: lo que cambia de verdad está en `distintos`, y hay
  que saber explicarlo.
- `audit:base-nueva` al final: todo lo escrito valida contra su contrato.
- Tras una pasada que importe, `node 4-base-nueva/guardar.mjs`: el emulador solo persiste en una salida
  ordenada.

## Contexto que no está en el código

`LEGADO_CONOCIMIENTO_SISTEMA_2026-07-12.md` recoge estas convenciones y varias más del
extractor y la plataforma. Léelo antes de cambiar cualquiera de las dos.
