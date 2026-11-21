# Plan de independencia

> **Estado a 04-11-2026:** la aplicación está en producción sobre la base nueva. Este documento es registro de cómo se planificó y varias cifras y pendientes están superados. Lo que queda está en [el informe de cierre](https://claude.ai/artifact/VHoLhhQE7SNhzMPe4S4kwv).

**Decidido el 01-11-2026 por Oscar:** un proyecto nuevo y **completamente** independiente del
anterior. No solo la base de datos: también el extractor y el frontend. Nada se queda en el
proyecto porque BDB existiera.

Este documento es el plan. Las cifras están medidas hoy, no estimadas. Lo que queda abierto
está al final, separado de lo que ya está decidido.

Manda sobre lo que se hizo el 01-11 **antes** de esta decisión, que construía la base nueva *al
lado* de la vieja con la app leyendo la vieja. Ese camino se abandona.

## Las ocho dependencias de BDB, medidas

### 1. El proyecto de Firebase y la lectura cruzada

Hoy las Cloud Functions leen la maestra como proyecto **cruzado**, y el valor por defecto en el
código es el proyecto real de BDB; lo corrige `MASTER_PROJECT_ID`. `AGENTS.md` la señala como la
barrera más fácil de romper sin darse cuenta.

Con proyecto propio no hay maestra ajena que leer: **`MASTER_PROJECT_ID` desaparece en vez de
vigilarse**. La decisión no añade el riesgo del tercer proyecto, elimina el que ya había.

Comprobado hoy: el emulador crea una base con nombre propio a demanda —escribí, leí y borré un
documento en `databases/prueba-base-nueva` sin tocar las 18 colecciones de `(default)`— y el SDK
(`@google-cloud/firestore` 7.11.6) acepta `databaseId`. Hay camino técnico para las dos formas,
proyecto aparte o base con nombre; se elige proyecto aparte porque la app también es nueva.

### 2. El segundo canónico, con la forma de BDB

El extractor produce **dos** salidas. `export_bdb/*.json` —843 ficheros, claves en inglés— existe
para alimentar el loader de BDB. El universal `export/fondos.ndjson` —30,1 MB, claves en
español— es el que de verdad consumimos: de él sale `riesgo.volatilidad_pct.3a.fondo`, y **ningún
fichero de `export_bdb/` contiene la palabra «volatilidad»**.

Después: un solo canónico. `export_bdb/` se retira.

### 3. El camino de escritura a la maestra

`load:fondosdb`, `republish:fondosdb`, `audit:consistency`, el gate
`BDB_DATA_PLATFORM_ENABLE_MASTER_WRITES`, la regla de los dos dueños de `metrics/latest` y la
allowlist que importan dieciséis comprobaciones. Todo existe para escribir con seguridad en la
base de BDB.

Después: solo el escritor de la base nueva. **Con un cuidado que no es negociable:** la allowlist
es una barrera, no un trámite. Se retira cuando el escritor nuevo tenga la suya, nunca antes.

### 4. El origen del dato: la siembra

La base se siembra desde una copia verificada de la maestra de BDB: 25.394 documentos. Es la
dependencia más profunda, porque el dato mismo viene de BDB.

Medido: los **772 instrumentos ya se construyen del canónico** (`source: canonical:fondosdb`), no
de la copia. **Las 23 carteras, no**: salen de `bdb_activos/{usuario}/portfolios` de la copia
restaurada, y ahí siguen colgando.

Después: todo lo que entre tiene que poder reconstruirse de fuentes nuestras.

### 5. El universo: 312 acciones sin sitio

Medido en la base vieja, los 1.097 activos son:

| tipo | activos |
|---|---:|
| FUND | 765 |
| STOCK | **312** |
| ETF | 19 |
| OTHER | 1 |

La base nueva tiene 772 instrumentos. La diferencia de 325 es **312 acciones, 1 «otro» y 12
fondos o ETF** que no llegaron.

Las acciones no están en el universo del extractor —846 fichas, fondos y ETF— y su programa,
`ESPECIFICACION_PROGRAMA_FUNDAMENTALES.md`, **no está construido**. Hoy no hay de dónde
reconstruir esas 312.

Es la decisión que más cosas mueve, y por eso va primera.

### 6. El camino de lectura de la app

Hoy: `assets/{id}` con `metrics` y `price_series`, a través de Functions cruzadas.

Después: `instruments/{ISIN}/read/card` leído del proyecto propio. La tarjeta ya existe para los
772, y desde hoy dice contra qué se midió cada cifra: 145 con índice nombrado y el ISIN de su
proxy, 588 diciendo que la cifra es del índice de categoría del proveedor, 39 sin nada que
nombrar.

### 7. Las colecciones que son historia de BDB

| colección | documentos | qué es |
|---|---:|---|
| las nueve `_*` | 336 | auditorías y reparaciones de BDB |
| `commercial_retro` | 376 | retrocesiones; dato de negocio |
| `bdb_activos_reports` | 40 | notas de estrategia de mercado |
| `ingestion_runs` | 37 | historia de cargas |
| `meta` | 10 | metadatos |
| `bdb_activos` | 8 | usuarios y sus carteras |

Cada una necesita una decisión: se rehace, se traslada o se cae.

### 8. La persistencia

Ni `exportOnExit` ni `--import`: lo comprobé en `firebase.json` y no hay fichero de volcado en
ninguna parte. Al parar el emulador desaparecen los 11.854 documentos de la base nueva.

**Separar no es persistir.** Son dos trabajos distintos, y este es el que responde a «no se ha
quedado nada en Firestore».

## El orden

| | paso | por qué va aquí |
|---|---|---|
| **A** | Decidir el universo: acciones sí o no | mueve el alcance del extractor, las pantallas de la app y los contratos que hacen falta — **sin contestar, es de Oscar** |
| **B** | Proyecto propio y persistencia | barato, y es donde aterriza todo lo demás — **hecho el 01-11-2026** |
| **C** | Re-originar lo que aún viene de la copia de BDB | hoy, las carteras |
| **D** | El camino de lectura de la app sobre el proyecto propio | necesita B y C hechos |
| **E** | Retirar las salidas con forma de BDB | **la última**: son la red hasta que el camino nuevo aguante |

El orden de E importa. Retirar `export_bdb/` y el loader antes de que la app lea del proyecto
nuevo deja el sistema sin ninguno de los dos caminos.

## El paso B, hecho el 01-11-2026

Lo que hay, medido leyendo el resultado y no el código:

- **Proyecto propio**, `bdb-gestor-de-activos`, en su propia instancia del emulador
  (Firestore 8092, hub 4402), con su casa en `4-base-nueva/`. Las dos bases no se ven: el 8092
  tiene los 771 `instruments` y **ningún** `assets`, y el 8082 al revés, con sus `assets` y
  ningún `instruments`. La base de siempre, intacta y viva.
- **Lo que separa las dos bases es el puerto, no el id de proyecto**, y conviene no
  confundirse. Medido: los dos emuladores arrancan con `singleProjectMode`, y el 8092, después
  de importar su volcado, sirve `instruments` **con cualquier id de proyecto**, el de BDB
  incluido. El aislamiento es real porque son dos procesos con dos almacenamientos, y porque el
  escritor solo puede hablar con el 8092; pero un id de proyecto en una URL no prueba en qué
  base estás.
- **Persiste, y las dos vías están probadas por separado.** Con **Ctrl-C** —la salida
  ordenada— se envió un Ctrl-C real a la consola del emulador habiendo escrito un documento
  testigo *después* de importar, que el volcado no tenía: al arrancar de nuevo, el testigo
  estaba, y el plan dio `crear: 0 / reemplazar: 10.036`, o sea que no faltaba ni un documento.
  Con un **kill a la fuerza**, los 11.566 documentos también volvieron, pero porque antes se
  había ejecutado `guardar.mjs`: el cierre a la fuerza no guarda nada. El volcado son 24 MB en
  `4-base-nueva/datos/`, fuera del repositorio.
- **El escritor escribe ahí, y solo ahí.** El destino ya no sale del entorno: lo pone
  `projectAllowlist.ts`. Si una variable pide otro proyecto u otro puerto, aborta nombrando el
  conflicto en vez de ignorarla.
- **La allowlist sigue siendo barrera.** Los dos proyectos están en la misma constante pero
  **separados por papel**, no en un conjunto compartido: el escritor de la base nueva rechaza
  el proyecto de la vieja y al revés. Si estuvieran juntos, un `FIREBASE_PROJECT_ID`
  equivocado escribiría la base nueva en la vieja y la comprobación lo autorizaría, con cada
  documento perfectamente válido. `tests/projectAllowlist.test.ts` falla si los papeles se
  solapan.

Tres cosas que el paso B dejó a la vista y que no son suyas:

1. **Doce documentos huérfanos.** `LU2504555777` tiene once `declared/*` y un
   `computed/metrics` colgando de una raíz que el contrato bloqueó por no traer
   `classification.category`. La auditoría cuenta andando desde las raíces, así que dice que
   la base «valida entera» y esos doce no los ve nadie. Es el defecto de siempre: válido, y
   afirmando otra cosa.
2. **`carteras:write` no tiene fuente.** Leía `bdb_activos` de la misma base en la que
   escribe, y eso se quedó en la vieja. Ahora **aborta diciéndolo** en vez de dar por buena
   una pasada en vacío. Lo arregla el paso C.
3. **El chequeo de puertos no sirve en esta máquina.** Ni el 8082 ni el 8092 aparecen como
   `LISTEN`, porque los abre la JVM del emulador, y el 5174 tampoco porque Vite escucha en
   `::1`. Dar el entorno por caído leyendo los puertos ya pasó hoy. Se pregunta a cada
   servicio; está en la habilidad.
4. **Y preguntar también se puede hacer mal.** En PowerShell, `"$coleccion?pageSize=1"` dentro
   de una URL no interpola `$coleccion`: el `?` cuenta como letra del nombre de variable, así
   que vale vacío, la URL sale `.../documents/=1` y el emulador contesta **200 con cero
   documentos**. Una base con 11.566 documentos dentro, informada como vacía, con el código de
   estado diciendo que todo bien. Van llaves: `${coleccion}`.

## Lo que este plan no incluye

- **No toca BDB.** Ni un fichero, ni un commit, ni su proyecto `bbdd-activos-financieros`.
- **No carga nada en ninguna maestra.** Las órdenes de escritura real siguen cerradas por el gate
  y por credenciales de servicio que aquí no existen.
- **No es el diseño de la base nueva.** Ese vive en sus 30 contratos y en
  `DECISIONES_BASE_NUEVA_2026-11-01.md`.

## Lo que queda abierto, y es de Oscar

| decisión | bloquea | recomendación |
|---|---|---|
| ¿Acciones en el universo nuevo? | el paso A, y con él todo | **Nacer con fondos y ETF.** Las 312 acciones no tienen de dónde reconstruirse hasta que exista el programa de fundamentales; entran en una segunda fase, no se migran de la copia |
| ¿Qué pasa con las 23 carteras? | el paso C | **DECIDIDO el 02-11-2026: se traen 18 de las 23.** La recomendación de aquí era que nacieran de cero «porque son Prueba 30 y similares», y al medirlas eso era cierto de 4 y falso de las otras 19. Ver abajo |
| ¿Se conserva `commercial_retro`? | el paso C | **Sí.** 376 documentos de retrocesiones son dato de negocio, no historia técnica. El resto de colecciones de la tabla 7, no |
| ¿Repositorios nuevos o estos modificados? | cómo se organiza el trabajo | **Estos**, que es lo que dijo Oscar: se modifican el extractor y el frontend donde están |
| ¿Cuándo se retira `export_bdb/`? | el paso E | **Cuando la app lea del proyecto nuevo**, verificado, no antes |
| ¿Se guarda la composición completa de los fondos? | si hay radiografía de cartera | **Sí**, y es el momento: hoy solo se guardan diez posiciones y sin la lista completa no hay análisis de transparencia |

## El paso C, hecho el 02-11-2026: las carteras

La recomendación escrita arriba era que las 23 carteras **nacieran de cero**, con este
argumento: «son "Prueba 30" y similares, una de ellas con los pesos al 181,25 %; no merecen
migración». Antes de aplicarla se midió lo que contenían, y el argumento solo se sostiene en
parte:

- **Acierta en los dos ejemplos que nombra.** Hay 4 pruebas —`P30` y tres `Prueba 30`, de una o
  dos posiciones y sin capital— y hay exactamente una con los pesos al 181,25 %: `cp`, de 8
  posiciones y 100.000 €.
- **Falla en el resto.** Las otras 19 son trabajo de cliente: de 8 a 27 posiciones, capitales
  de 112.851 € a 1.130.987 € y actualizadas entre el 7 de septiembre y el 21 de octubre de
  2026. La mayor, `AAXPE TOTAL`, tiene 27 posiciones y 512.661 €. **22 de las 23 tienen los
  pesos cuadrados al 100 %.** Varias llevan el nombre de un cliente, y por eso sus nombres no
  se copian aquí ni el fichero re-originado va al repositorio: es la misma razón por la que el
  contrato de operaciones deja fuera los nombres de terceras personas.

Dos cosas más, medidas, que quitan los dos miedos razonables de migrar:

- **Los 69 activos que referencian existen todos en la base nueva.** Cero posiciones apuntando
  al vacío.
- **Las creó la aplicación** (`source_kind: BDB_APP_OWNED`): son los registros del asesor, no
  dato de proveedor. Traerlas no es re-originar dato licenciado.

**Lo decidido y hecho:** se traen **18**. Quedan fuera las 4 pruebas y la del 181,25 %, que no
se normaliza —un reparto que suma 181,25 % no está mal escalado, es una cartera a medias, y
normalizarla inventaría los pesos que el asesor no puso—. Esa una queda pendiente de que Óscar
decida: corregirla en la app y volver a traerla, o dejarla.

**Cómo se hizo, y por qué en dos pasos.** `npm run carteras:reoriginar -- --escribe-fichero`
lee la base vieja y deja un NDJSON con las 18 y un informe al lado diciendo qué entró, qué no y
por qué; después `npm run carteras:write -- --write --fuente <fichero>` las escribe. El paso
intermedio es un fichero a propósito: es lo que deja **por escrito** qué se trajo exactamente de
la copia de BDB, que es la pregunta que la tarea F3.4 hace sobre todo lo que vive en la base
nueva. La regla de qué entra vive en `motivoParaNoReoriginar`, con pruebas.

**Verificado, no afirmado:** 18 carteras y 220 objetivos escritos, comparados contra el fichero
uno por uno —nombre, capital, número de posiciones y el peso de cada ISIN— con **0
discrepancias**; 4.243.333,71 € de capital nocional en total. La auditoría los ve: `portfolios`
18 y `portfolios/*/targets/*` 220, todos validando.
