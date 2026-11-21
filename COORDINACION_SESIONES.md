# Coordinación entre sesiones que trabajan a la vez

*06-11-2026. Regla de Óscar: dos sesiones de Claude trabajan sobre esta carpeta al mismo
tiempo y **no pueden entrar en conflicto bajo ningún concepto**. Este fichero es el reparto. Toda
sesión lo lee antes de escribir nada y lo actualiza cuando cambia su territorio.*

## Las dos sesiones y su territorio

| Sesión | Dónde escribe | Dónde NO escribe |
| --- | --- | --- |
| **Frontend** (Claude Code, escritorio) | `3-BDB-ACTIVOS_app/` entero, `4-base-nueva/sitio/` y el despliegue del sitio, `AGENTS.md`, `README.md` y los docs de `3-BDB-ACTIVOS_app/docs/` | `1-extractor/`, `2-plataforma-datos/`, contratos |
| **Datos** (Chat con carpeta enlazada) | `1-extractor/`, `2-plataforma-datos/` (incluidos los contratos), `4-base-nueva/` salvo `sitio/`, y en la raíz **solo ficheros nuevos** `ENCARGO_*`, `INFORME_*`, este fichero y el catálogo de datos | `3-BDB-ACTIVOS_app/`, `AGENTS.md`, `README.md` |

Un cambio que cruce la frontera (un campo nuevo del contrato que la app tiene que leer, una
Function que lee la base nueva) **se escribe como encargo** en la raíz y lo ejecuta la sesión
dueña del territorio; nunca se hace «de paso».

## Las reglas, por orden de lo que más daño evita

1. **Antes de escribir, `git status` del repositorio que vas a tocar.** Si hay ficheros
   modificados que no son tuyos, no los toques, no los añadas a tu commit y no los pises:
   son de la otra sesión. Trabaja en otros ficheros o espera.
2. **Commits pequeños y pronto.** Lo que está en commit no se puede perder por el trabajo de
   la otra. Nunca `git stash`, `git checkout -- <fichero>`, `git reset` ni `git clean` sobre
   algo que no hayas escrito tú en esta sesión.
3. **`git push` solo lo pide Óscar.** Y antes de un push, `git pull --rebase` para no pisar
   lo que la otra sesión haya subido.
4. **Los procesos compartidos son de quien los arrancó.** Hoy: los emuladores (Firestore
   8082 y 8092, Auth 9097, Functions 5005, Vite 5174) y el servicio `ops` del extractor
   (8766). La otra sesión **no los para ni los reinicia**. Si necesitas uno y no está, lo
   arrancas tú y lo anotas aquí.
5. **El pipeline del extractor es una sola cola.** `update --all`, `export`, `bdb`,
   `republish`, `refrescar.mjs` y `nube:subir` los lanza solo la sesión de Datos, de uno en
   uno, y respetando `config/.bloqueo`. La de Frontend no toca `cache/`, `data/`, `export*/`
   ni `config/` del extractor.
6. **Los ficheros de la raíz se añaden, no se editan a dos manos.** Los `.md` existentes los
   edita su dueño según la tabla. Un documento que las dos necesitan cambiar se cambia por
   encargo.
7. **Si una sesión encuentra algo roto en el territorio de la otra, no lo arregla:** lo
   escribe en `INCIDENCIAS_PENDIENTES.md` (lo crea si no existe, una línea con fecha, repo,
   fichero y qué pasa) y sigue con lo suyo.

## Cambio del 06-11 a las 20:50

Óscar decide seguir con **una sola sesión, la de Code**, que pasa a ser dueña de los dos
territorios. Las siete reglas siguen valiendo por si vuelve a haber dos. El traspaso completo
está en `TRASPASO_SESION_DATOS_2026-11-06.md`.

## Estado, actualizado por cada sesión

- **06-11 20:20 · Datos:** paso 1 (FIRDS) en commit `9da0507` del extractor y `29e185f` de
  la raíz. Siguiente: encargo 2 (índice de referencia) y ampliar `instrument.v2` en la
  plataforma. No tengo ningún proceso arrancado.
- **06-11 19:54 · Frontend (leído de Git, no escrito por ella):** Buscador por zona, región y
  categoría en `87289b2`. Emuladores y Vite arrancados a las 19:33; sitio desplegado a las
  19:42.
- **06-11 20:35 · Frontend:** leído y en vigor. Hecho hoy en la app: el generador de carteras
  (decisión 122, `db47782` y `79fcce7`, con la Function nueva `generate_portfolio_draft`, la 34)
  y el Buscador por zona, región de las acciones y categoría (`87289b2`); Functions y sitio
  publicados por Óscar, la web sirve la compilación de las 20:24. **Antes de este reparto** toqué
  territorio de Datos una vez: `8d21581` en `2-plataforma-datos` (tandas de 2 MiB en
  `scripts/subirALaNube.ts`) y la subida del catálogo a la nube de las 17:00, que acabó con el
  recuento igual en todas las colecciones; no lo vuelvo a hacer. Procesos míos: el emulador de la
  base nueva (8092, lanzado con `4-base-nueva/arrancar.mjs` hacia las 16:47) y dos emuladores de
  Functions de revisión contra él, 5265 y 5275 (hub 4865 y 4875). Los principales (8082, 9097,
  5005) y Vite (5174) ya estaban en marcha cuando los necesité: no los arranqué yo hoy, solo
  repoblé la base vieja y sembré el usuario local. Ahora no tengo trabajo en curso.
- **06-11 20:58 · Code (la única sesión desde las 20:50):** leído el traspaso. La revisión del plan
  de datos y del paso de FIRDS está en el documento «Revisión del plan de datos»
  (https://claude.ai/artifact/34vtBVWdewVGTf59WZcqpF), hecha en solo lectura. Dos puntos del
  traspaso que **no** se ejecutan tal cual, pendientes de Óscar: **Aena no se sustituye**, porque
  `config/fondos.csv` ya tiene los dos ISIN (líneas 544 y 884) y la base nueva también, los dos
  `TRADING`: se da de baja el viejo, marcándolo; y **el ETC de oro ya es `OTHER`** en la base nueva y
  la ficha lo reconoce así: un tipo nuevo en el contrato la rompería. La verificación de proxies de
  las 20:46 no ha dejado su `_verifica_proxies.json`. Procesos: los de la línea anterior.
- **06-11 21:01 · Code:** esta sesión se cierra a petición de Óscar, porque ya es muy larga, y sigue
  una sesión nueva de Code, que desde ahora es la única que escribe. No dejo nada sin commit ni
  trabajo a medias. Los procesos de la línea de las 20:35 siguen en marcha y pasan a la sesión
  nueva, con la misma regla: no se paran sin permiso de Óscar.
- **06-11 22:00 · Code (sesión nueva, la única que escribe):** paso 2, camino A. En `1-extractor`:
  normalización del índice declarado y columna `equivalente_de` (`0c52fd4`), tres proxies aprobados por
  Óscar —MSCI India, EURO STOXX 50, MSCI EMU Small Cap— con dos altas en el universo (`ad0471b`,
  `5372f52`) y un proxy ya no se mide contra sí mismo (`6ac9059`). Informe en
  `INFORME_PROXIES_CAMINO_A_2026-11-06.md`. Pasada local de los 2 ETF y 8 fondos, `calidad` → `export` →
  `bdb` → `series` → `cambios`, y escrita la base nueva en el emulador 8092 con las tres pasadas
  verificadas y la persistencia guardada. **Nada en la nube.** El emulador de la base vieja (8082) no
  respondía a las 21:50; no lo he arrancado ni tocado. Procesos míos: ninguno en marcha.
- **07-11 08:35 · Code:** el equipo se reinició a las 08:04 y se llevó todos los procesos: los dos
  emuladores, Auth, Functions, Vite y los dos emuladores de revisión. Con permiso de Óscar he arrancado
  la pila de la base vieja (8082, 9097, 5005), repoblada de la copia `2026-10-31T13-35-09-399Z`
  (25.404 = 25.404, 0 discrepancias) y con el usuario local sembrado. **No he arrancado** el 8092 —su
  volcado de anoche está guardado en `4-base-nueva/datos/`— ni Vite: pendientes de que lo pida.
  Procesos míos: los tres de la base vieja.
- **07-11 09:10 · Code (gestor-activos):** con permiso de Óscar he arrancado el emulador de la base nueva
  (8092, `4-base-nueva/arrancar.mjs`, que importó el volcado de anoche) y Vite (5174). `audit:base-nueva`:
  40.050 documentos, 0 que no validan, 0 huérfanos, 0 centinelas, 0 repartos que no sumen 1; las relativas
  escritas anoche están dentro. Los tres de la base vieja (8082, 9097, 5005) son de la sesión principal, de
  las 08:26. **Dos sesiones han escrito hoy en la carpeta**, sin pisarse: Óscar decide cuál sigue escribiendo.
  Procesos míos: 8092 y Vite; se paran con Ctrl-C, nunca a la fuerza, y antes de un reinicio `guardar.mjs`.

## Estructura desde el 07-11 (decisión de Óscar, 09:30)

**Una sesión dirige y las demás trabajan por encargo.** La directora es «GAF · Dirección (Fable 5.1)»:
decide, audita, revisa cifras y es la **única que escribe en la raíz** (`AGENTS.md`, este fichero, las
decisiones). No implementa. Cada tarea va a una **sesión de trabajo arrancada desde ella**, con un encargo
escrito que dice modelo y esfuerzo (Opus 5.5 medio para implementar con pruebas; alto para fórmulas,
nube y contratos; Sonnet 5.5 para lo mecánico; Haiku como subagente de lectura). La sesión de trabajo
escribe **solo en el territorio de su encargo**, termina en commit y en una línea de estado aquí, y se
archiva al acabar. Remote Control, solo en la directora. La antigua principal («GAF · Historia hasta el
07-11») deja de escribir: su contexto está en Git y en los documentos de la raíz.

Las siete reglas de arriba siguen valiendo entre la directora y las de trabajo.

**Desde el 10-11-2026 hay un solo repositorio**, y las reglas se leen así. La 1: `git status` **de la carpeta** que
vas a tocar (`git status -- <carpeta>`). **Un agente escritor por carpeta**, donde antes decía por repositorio. Los
commits **nombran rutas** (`git commit … -- <rutas>`), nunca `git add -A` ni `git commit -a`: el índice es de todos
y arrastraría lo de otra sesión. Un hash ya dice el estado de las tres capas; los anteriores al 10-11 siguen siendo de
la suya. La historia de antes de un fichero de una carpeta se pide con su ruta de entonces (`git log -- src/x`).

**Regla básica del modelo y el esfuerzo (Óscar, 08-11-2026).** Cada orden que la directora manda a una sesión
lleva el modelo adecuado y el esfuerzo adecuado a esa orden, **fijados en los parámetros** de la sesión (`model`
y `effort`), no solo escritos en el texto del encargo: el texto no cambia nada y la sesión hereda el modelo de la
directora. Antes de registrar aquí «Modelo: X, esfuerzo Y» se comprueba en los metadatos de la sesión que es
verdad. La regla nace de la corrección del 08-11 a las 07:50: cuatro sesiones del 07-11 corrieron con Fable 5.1
anunciadas como Opus 5.5. Guía: Fable 5.1 decide, audita y revisa cifras de cliente; Opus 5.5 medio implementa
con pruebas; Opus 5.5 alto para fórmulas del método, escrituras en la nube y cambios de contrato; Sonnet 5.5
para lo mecánico y la configuración; Haiku para leer. Si una sesión ya corre con el modelo equivocado, se cambia
desde su siguiente turno y se anota.
- **07-11 10:05 · Dirección:** la sesión de trabajo «tira-alfa» (Opus 5.5, medio) terminó: `3173229` en
  `3-BDB-ACTIVOS_app`, la tira dice contra qué se midió el alfa, capturas enviadas a Óscar. Revisado por la
  directora: alcance correcto (`componerFicha.ts` y su prueba). Los 7 fallos de `internalPortfolioReport.test.ts`
  son del calendario, no del cambio: anotados en `INCIDENCIAS_PENDIENTES.md`. Siguiente encargo pendiente de
  Óscar: paso 2 · camino B.
- **07-11 13:40 · Dirección:** encargo «identidad» (Opus 5.5, alto) terminado y revisado: `7d94218`, `0086e97`,
  `b694a3c` en `1-extractor` y `fbba01e` en `2-plataforma-datos`. Aena `ES0105046009` queda «dejó de cotizar»
  (ISIN sustituido, regla con prueba); la CAM sigue `NEVER_RESOLVED` porque no existe vía de baja decidida;
  `instrument.v2` añade `identifiers.cfi`, `identifiers.lei`, `listings[]` y `listings_as_of` sin tocar lo que la
  app lee. Repetido por la directora: 813 pruebas del extractor y 1.262 de la plataforma en verde; plan contra el
  8092: 14.072 documentos, 0 inválidos, 2.964 distintos (2.951 solo sello de pasada). **La base nueva no está
  escrita**: pendiente de Óscar. Sesión archivada; su nota larga está en la carpeta compartida de notas.
- **07-11 12:10 · Dirección:** encargo «pasada FIRDS de acciones y escritura en local» (Opus 5.5, medio) terminado
  y revisado: 302 de 312 acciones con CFI, LEI y mercados en la ficha (red solo a EODHD, 310 peticiones; Yahoo y
  BCE bloqueados); base nueva local escrita en las tres pasadas con 0 ausentes/distintos/inválidos, auditada
  (40.050 documentos, 0 que no validan) y guardada a las 12:07. En la base, 305 raíces con identidad FIRDS; Aena
  `017` con CFI `ESVUFB`, LEI y 46 listings; `009` `DELISTED`. Sin commits (no hizo falta código). **Nada en la
  nube.** Diez acciones no alcanzadas, sin forzar: 4 fuera de alcance (sin cambio AUD/JPY), 4 paradas por la guarda
  del nombre (Ercros, Levantina, Siemens Gamesa, NH), la CAM y Aena `009`. Corrección: la hora «13:40» de la línea
  anterior era una estimación; fue hacia las 11:50.
- **07-11 12:50 · Dirección:** encargo «baja decidida» (Opus 5.5, medio) terminado y revisado: `4818854` en
  `1-extractor` añade `config/bajas_decididas.csv` + `core/bajas_decididas.py`; la decisión gana a la evidencia,
  lleva `origen: decision` y deja `conflicto` si la fuente la contradice. La CAM pasa a «dejó de cotizar» desde el
  09-12-2011 (suspensión de la CNMV; FIRDS no trae baja) y ningún otro canónico cambia. Hallazgo: las fechas de baja
  medidas de NH (04-09-2026) y Ercros (21-09-2026) son falsas o imprecisas (excluidas el 25-09-2025 y el
  22-09-2026); Siemens Gamesa cuadra. Pendientes de Óscar: fijar esas fechas por decisión, y si `origen` entra en
  `instrument.v2` (cambio de contrato). Base nueva no escrita.
- **07-11 13:35 · Dirección:** encargo «NH y Ercros por decisión + origen al contrato» (Opus 5.5, alto) terminado
  y revisado: `269c00f` y `2415f05` en `1-extractor`, `7cde04b` en `2-plataforma-datos`. NH desde el 25-09-2025 y
  Ercros desde el 11-09-2026 por decisión; `instrument.v2` añade `availability.basis` (`SOURCE_EVIDENCE` |
  `DECISION`) y `availability.decision` (`decided_by`, `decided_at`, `reason`). Hallazgo: las fechas falsas las
  escribió `tools/rellena_difuntas.py` el 02-11 tomando el último precio de la copia de BDB, y BDB arrastró el
  precio de NH casi un año (base vieja: serie rellenada; base nueva no). Plan: 14.072 documentos, 0 inválidos,
  337 raíces con el campo nuevo. **Base nueva local no escrita** desde la pasada FIRDS de las 12:07.
- **07-11 13:40 · Dirección:** encargo «NH a la suspensión + escritura local» (Opus 5.5, medio) terminado y
  revisado: `6886fb5` en `1-extractor` (NH desde el 15-09-2025; regla en la cabecera de `bajas_decididas.py`;
  832 pruebas). Base nueva local escrita en las tres pasadas (14.072 / 2.215 / 23.145, todo a 0), auditada
  (40.050, 0 que no validan) y guardada a las 13:32. Comprobado por la directora en la base: CAM, NH y Ercros
  `DELISTED` con `basis: DECISION` y autor; Aena `009` y Siemens Gamesa por evidencia. 337 raíces con `basis`.
  Pendiente: el `since` de Aena `009` es la fecha de observación (07-11-2026), no la del hecho. **Nada en la nube.**
- **07-11 14:05 · Dirección:** encargo «la ficha enseña el origen de la baja» (Opus 5.5, medio) terminado y revisado:
  `6f6ee6c` en `3-BDB-ACTIVOS_app` (componerFicha, FichaInstrumento, modoCliente, tipos y 6 pruebas nuevas). Puertas en
  verde salvo los 7 fallos conocidos del reloj; capturas de CAM y Aena en los dos modos enviadas a Óscar. Sin batería
  de seis anchos (solo 1440): pendiente. Dos cosas que deja: la descripción de `DELISTED` en `instrument.v2` sigue
  diciendo que «el proveedor ya no resuelve», falso para una baja decidida (plataforma); y la ficha de Aena `009`,
  dada de baja, sigue ofreciendo «+31,58 % a 1 año». Las dos van al siguiente encargo o a decisión de Óscar.
- **07-11 14:50 · Dirección:** encargo «emisores por LEI + fecha del ISIN sustituido + DELISTED» (Opus 5.5, alto)
  terminado y revisado: `1be63d5`, `a740764` en `1-extractor`; `79c684b`, `2e44bd9` en `2-plataforma-datos`.
  Aena `009` desde el 19-06-2025 (primera negociación del sucesor en centros con admisión del emisor; MTAH y el
  marcador 1900-01-01 de Fráncfort excluidos). 297 LEI → 297 emisores de GLEIF (291 vigentes, 6 LAPSED),
  `config/emisores_lei.csv` en Git; 299 vínculos `EQUITY_ISSUER`; 6 acciones sin emisor (3 sin LEI en FIRDS, 3
  paradas por la guarda del nombre). Repetido por la directora: 862 + 1.279 pruebas; plan crearía 596 (297 `issuers`
  + 299 `instrument_issuer`) y reemplazaría 14.072, 0 inválidos. Cambio de contrato a aprobar por Óscar:
  `issuer.v2.issuer_id` pasa de dueño `human` a `platform` para `EQUITY_ISSUER`. **Base nueva no escrita.**
- **07-11 14:30 · Dirección:** encargo «escritura local de emisores + plan de nube» (Opus 5.5, alto) terminado y
  revisado. Base nueva local: 596 creados y 14.072 reemplazados, batch 2.215, series 23.145 (5.494.634 puntos
  cuadran), todo a 0; auditoría 40.646 documentos, 0 que no validan; guardada a las 14:23. ASML y Alphabet con un
  emisor para dos ISIN; Aena `017` → `ISS_000206`; Aena `009` `since` 19-06-2025. Hueco de la auditoría: no
  comprueba que cada vínculo apunte a emisor e instrumento existentes (comprobado a mano: 0 huérfanos). **Plan de
  nube (sin escribir):** 40.028 documentos del catálogo en 12 colecciones, ≥657 a crear (297 emisores, 299 vínculos,
  2 instrumentos nuevos —los dos ETF proxy del 06-11— con sus bloques y 27 de series), ningún `SE BORRARIA`, ningún
  sobrante; el reparto exacto crear/reemplazar no se sabe porque el plan compara recuentos por colección. Sin
  commits. **La escritura en la nube espera el sí expreso de Óscar.**
- **07-11 15:10 · Dirección:** **catálogo subido a la nube** (decisión 19) de 14:55 a 15:03 por la sesión «subida-nube»
  (Opus 5.5, alto), tras un primer intento bloqueado por el clasificador del modo automático y la aprobación de
  Óscar en la propia sesión: 313 tandas, 657 documentos creados y 39.371 reemplazados; los 40.028 iguales a los
  locales uno a uno (comparación propia, sin orden de campos); plan repetido con los 12 recuentos iguales. La
  verificación muestral del script marcó 6 «distintos» que se atribuyen al orden de campos (deducción, no
  localizados). Carteras (18, 220 objetivos) y retrocesiones (376 + 4) intactas, misma huella y última edición del
  03-11. Reglas iguales al repositorio; `issuers` e `instrument_issuer` sin regla propia (nadie las lee desde el
  navegador; hará falta cuando la pantalla enseñe el emisor). Sin commits. Pendiente de Óscar: desplegar el sitio
  (`4-base-nueva/compilar-sitio.mjs` + `firebase deploy`) para que la ficha enseñe los textos nuevos.
- **07-11 15:15 · Dirección:** Óscar despliega el sitio (`firebase deploy --only hosting` desde `4-base-nueva`,
  compilación de las 15:09 del commit `6f6ee6c` de la app). Functions sin cambios hoy. La web sirve ya los datos de
  la subida de las 15:03 y los textos nuevos de la ficha. Cierre del día: 4 repositorios limpios; sesiones de
  trabajo archivadas; pendientes: tarjeta del reloj fijo de las pruebas del informe interno, batería de seis anchos
  de la ficha, regla de lectura para `issuers`/`instrument_issuer` cuando la pantalla enseñe el emisor, y el paso 2
  de datos por el camino B.
- **07-11 15:45 · Dirección:** dos encargos en paralelo (territorios distintos), terminados y revisados. «Reloj fijo»
  (Sonnet 5.5, medio): `cb05ed2` en la app, 4.228 pruebas en verde; incidencia cerrada con la reserva de que
  `demoBackend.ts` sigue leyendo `new Date()`. «Paso 2 · camino B» (Opus 5.5, medio): `9d9d359` en el extractor, los
  679 fondos y ETF con índice llevan si su KID lo confirma (485 completo, 26 marca, 53 compuesto, 17 no confirmado,
  13 el KID dice sin índice, 85 sin KID); ningún proxy ni cifra cambió; 894 pruebas. **11 fondos de riesgo** con
  relativas publicadas contra un índice que su KID no confirma (6 compuestos, 2 sin índice, 3 menores): decisión de
  Óscar. Informe: https://claude.ai/artifact/4zoeaQsWgUj7p28dcM1Xts. La pasada sin red mostró cambios pendientes de
  una pasada autorizada (relativas de 6 fondos por normalización, 5 proxies que dejan de medirse contra sí mismos,
  identidad FIRDS en 289 fichas): la sesión restauró las fichas y escribió solo su bloque.
- **07-11 16:40 · Dirección:** encargo «regla del KID + pasada + base local» (Opus 5.5, alto) terminado y revisado:
  `b272138` (extractor, 907 pruebas), `90d0154` (plataforma, 1.291), `489755e` (app, 4.236 y puertas). Regla:
  sin relativas si el KID declara compuesto o ningún índice (retirada con fecha, §10); marcadas si no lo confirma o
  solo confirma la marca. Pasada sin red sobre 679 fondos: 6 relativas nuevas, 5 quitadas a proxies de sí mismos,
  **9 retiradas** (las 8 + DNCA Évolutif, cuyo KID de Allfunds declara 25/25/50) y **5 marcas** (3 + Sextant Grand
  Large + `ES0146309002`): las dos de más vienen de 5 fondos que el camino B tenía «sin KID». FIRDS en 289 fichas;
  `export_series/` idéntico. Base local: 14.668 / 2.215 / 23.145, todo a 0; auditoría 40.646, 0 inválidos; guardada
  a las 16:35. Comprobado por la directora: BNP sin alfa y con motivo. **Nada en la nube.** Pendiente: la retirada
  de DNCA descansa en un KID distinto del que declara su ficha (corrección manual del 14-10 a un KID de Finect no
  cacheado); 4 fichas bajan de calidad ALTO a BAJO por VL antiguo.
- **07-11 18:10 · Dirección:** encargo «segunda subida del catálogo a la nube» (Opus 5.5, alto) terminado y
  revisado. El modo automático bloqueó la escritura al primer intento; Óscar la aprobó en la ventana de la sesión.
  Subida de 17:16 a 17:25, `--parte catalogo --escribe`, sin `--piso-lo-de-la-app`: 40.028 documentos en 12
  colecciones, 0 creados, 40.028 reemplazados (5.465 cambian de contenido), 313 tandas sin fallo, 0 borrados.
  Comparación completa nube/local con claves ordenadas: 40.028 iguales, 0 distintos, 0 solo en un lado. Los 6
  «distintos» del postverify del script quedan **localizados**: 6 `declared/provider_risk` iguales salvo el orden de
  claves (lo que la primera subida solo dedujo). Comprobado por la directora a las 18:08 con lectura directa de la
  nube: BNP `LU0823414635` sin relativas, `relative_absence = KID_DECLARES_COMPOSITE` y retirada con fecha (punto
  20, contra MSCI ACWI, último dato 31-10); Bestinfond `ES0114673033` con alfa contra MSCI World (−0,070 a 1 año);
  carteras 18 / objetivos 220 / retrocesiones 376 + 4 importaciones con la misma huella que antes de la subida y que
  tras la de las 15:03, última edición del 03-11. Sin commits en la plataforma. **Pendiente de Óscar:** redesplegar
  el sitio (`node 4-base-nueva/compilar-sitio.mjs` y `firebase deploy --only hosting` desde `4-base-nueva`) para
  que la ficha publicada enseñe los textos del KID de `489755e`; la app publicada no se ha abierto con los datos
  nuevos. Nota: `side-session-notes/…/segunda-subida-catalogo-07-11-2026.md`.
- **07-11 18:25 · Dirección:** sitio redesplegado por Óscar. El primer deploy (18:14) volvió a publicar la
  compilación de las 15:09 porque el paso de compilar no corrió; la directora compiló a las 18:15 desde el commit
  `489755e` de la app y Óscar desplegó de nuevo. Comprobado desde fuera: el `index.html` publicado es idéntico al
  compilado y el paquete de la ficha servido lleva los textos del KID. La web pide acceso de asesor, así que la
  ficha renderizada (BNP sin alfa y con motivo; Bestinfond con alfa contra MSCI World) la revisa Óscar. Cierre:
  4 repositorios limpios, ninguna sesión de trabajo abierta. Pendientes sin cambio: batería de seis anchos de la
  ficha, regla de lectura de `issuers`/`instrument_issuer`, Aena 009 con aptitudes de rentabilidad tras la baja,
  trazabilidad del KID de DNCA, `demoBackend.ts` dependiente de la fecha; y el paso 2 de datos por el camino C.
- **07-11 18:50 · Dirección:** arranca el encargo «paso 2 · camino C: series de índice de EODHD» (Opus 5.5, alto),
  única sesión de trabajo abierta; territorio: `1-extractor` (`core/indices.py`, `fetchers/vl_fondos.py`,
  `config/indices.csv`), `2-plataforma-datos` (contrato de métricas, traducciones, mapper) y la ficha de la app, en
  ese orden y solo en la fase 2. Fase 1, de solo lectura: medir en EODHD las series `INDX` de IBEX 35 (TR/PR/NR),
  EURO STOXX 50 Price y S&P 500 TR para 11 fondos sin relativas, comprobar la variante por la deriva TR/PR, y
  traer a Óscar las decisiones: cómo publica el dato que es un nivel de índice y no un ETF (clase de serie nueva,
  identificación de la fuente, texto de la ficha; §3 del método, no comparable con el alfa contra proxy), la
  variante PR, y las filas propuestas. Entregable `INFORME_CAMINO_C_2026-11-07.md` más artefacto. Sin bases, sin
  push; commits solo en la fase 2.
- **07-11 19:35 · Dirección:** fase 1 del camino C entregada y revisada: `INFORME_CAMINO_C_2026-11-07.md`
  (artefacto https://claude.ai/artifact/X7V177ruvTNmDeYmjuFyaW). Comprobado por la directora: `carga` indexa
  solo por nombre plegado (la colisión de variantes es real), CaixaBank consta CONFIRMADO_COMPLETO y las dos
  clases «AH (EUR)» con `clase_cubierta = False`, y el catálogo `INDX` de EODHD con el token: 1.681 series, IBEX
  PR/TR, S&P 500 PR/TR/NTR, y **el EURO STOXX 50 NR existe** (`SX5T`, 477 meses, deriva 2,5-3,1 %/año sobre
  el precio), contra lo que decía el informe; sin IBEX NR ni EURO STOXX 50 bruto. Óscar decide 23-28 (clase
  `INDEX_LEVEL` + `source_series_id`, variante de precio sin alfa, EDM sin relativas, ETF fuera, dos detectores
  arreglados en la fase 2, las cinco filas) y la §3 del método añade `benchmark.series_class` a la identidad
  comparable de las relativas. Fase 2 autorizada a la misma sesión, con la corrección del informe. El informe se
  commitea cuando la sesión lo corrija.
- **07-11 19:55 · Dirección:** fase 2 del camino C terminada y revisada: `e99711c` + `0560125` (extractor),
  `3eef097` (plataforma), `8ba9864` (app). Repetido por la directora: 933 pruebas del extractor y 1.297 de la
  plataforma en verde; las cinco filas resuelven por (nombre, variante) y «S&P 500 NR USD» sigue en Vanguard;
  el contrato exige `source_series_id` y prohíbe `instrument_id` con `INDEX_LEVEL`. La app, 4.239 según la sesión
  (repetición de la directora en curso). Pasada sin red de la sesión sobre 13 ISIN: relativas nuevas en 4 fondos
  (Intermoney sin alfa, MyInvestor, AB ×2) y un **hallazgo arreglado en `0560125`**: la cobertura de la clase se
  derivaba después de la regla, y Morgan Stanley AH habría publicado R² 46 % en la primera pasada; fichas
  restauradas, nada publicado. **Sin verificar:** la pasada con red tras `0560125` (debe mostrar Morgan Stanley
  con `sin_relativas_clase_cubierta` y CaixaBank con `sin_relativas_kid_compuesto`), y la ficha en pantalla, que
  no tiene aún ningún `INDEX_LEVEL` local que fotografiar. Informe de la fase 1 commiteado (versión con `SX5T`).
  Pendiente de Óscar: autorizar la pasada y la escritura local.
- **07-11 20:00 · Dirección:** decisión 29: pasada con red sobre los 13 ISIN del camino C y escritura en la base
  local (8092), encargadas a la misma sesión (Opus 5.5, alto), con las comprobaciones de Morgan Stanley y
  CaixaBank como condición para escribir, lectura de tres documentos después y, si la app local llega a la base
  nueva sin tocar `.env.local`, la batería de anchos sobre «Frente a su índice». La nube no se toca.
- **07-11 20:20 · Dirección:** decisión 29 ejecutada por la sesión del camino C y comprobada por la directora
  leyendo el 8092: pasada con red sobre 13 ISIN (35 peticiones, 13 fichas cambian, ninguna fuera), las 17
  condiciones cumplidas; base local escrita (14.668 / 2.215 / 23.145, todo a 0; auditoría 40.646, 0 inválidos;
  guardada a las 19:58). En la base: Intermoney `INDEX_LEVEL` + `EODHD:SX5E.INDX`, `PRICE_RETURN`, sin alfa, beta
  1,00/0,94/0,94; AB `EODHD:SP500TR.INDX` con alfa ≈ 0; MyInvestor `EODHD:SPXEWTR.INDX`; CaixaBank sin relativas
  con `KID_DECLARES_COMPOSITE`; Morgan Stanley AH sin relativas. Capturas de la ficha en seis anchos sin desbordes;
  un texto corregido en la app (`aae3bda`: la nota interna hablaba del alfa que no hay). **Nada en la nube.**
  Pendientes de Óscar: tercera subida del catálogo + redespliegue del sitio (`8ba9864`, `aae3bda`); si la ficha
  debe decir «clase cubierta» como motivo de ausencia (valor nuevo del contrato, hoy sin vocabulario); y si los
  3 fondos del EURO STOXX 50 NR pasan de su proxy ETF a `SX5T`.
- **07-11 20:30 · Dirección:** decisiones 30-32. Encargo a la misma sesión del camino C (Opus 5.5, alto): valor nuevo
  de `relative_absence` para la clase cubierta en contrato, traducción, mapper y ficha; escritura local; y el plan de
  la nube (solo lectura) para que Óscar apruebe la escritura en su ventana. La subida es una sola, detrás de la 30.
- **07-11 20:35 · Dirección:** decisión 30 hecha por la sesión del camino C y comprobada en el 8092: `93c4b50`
  (plataforma, 1.299) y `ceab578` (app, 4.241); `relative_absence = HEDGED_SHARE_CLASS` en 5 clases cubiertas
  (Fidelity MSCI World Hedged, 2 Schroder Japanese EUR Hedged, Morgan Stanley AH, JPM Global Dividend hedged), en
  métricas y tarjeta; base local reescrita (14.668 / 2.215 / 23.145, todo a 0; auditoría 40.646) y guardada a las
  20:21. El clasificador del modo automático bloqueó a la sesión la **lectura** de la nube; la directora hizo aquí
  la foto previa (carteras 18 / 220, retrocesiones 376 + 4, misma huella que tras la segunda subida) y el plan
  (`nube:plan -- --parte catalogo`: 40.028, recuentos nube = local en los 12 grupos, 0 a crear, 0 borrados, 313
  tandas), ambos de solo lectura, a las 20:23. **La escritura la aprueba Óscar en la ventana de la sesión.**
- **07-11 20:58 · Dirección:** tercera subida del catálogo hecha por la sesión del camino C (20:39-20:50, aprobada
  por Óscar en su ventana, `--parte catalogo --escribe`, sin `--piso-lo-de-la-app`): 40.028 documentos, 313
  tandas, 0 borrados; comparación completa posterior 40.028 iguales, 0 distintos. Comprobado por la directora
  leyendo la nube a las 20:55: Intermoney `INDEX_LEVEL` + `EODHD:SX5E.INDX`, `PRICE_RETURN`, beta 1,00, sin alfa;
  AB `EODHD:SP500TR.INDX` alfa +0,06; Morgan Stanley `HEDGED_SHARE_CLASS`; CaixaBank `KID_DECLARES_COMPOSITE`;
  carteras 18 / 220 y retrocesiones 376 + 4 con la misma huella que antes. Sitio compilado a las 20:26 desde
  `ceab578`. **Pendiente de Óscar:** `firebase deploy --only hosting`; hasta entonces la web sirve `489755e`, que
  no conoce `INDEX_LEVEL` ni `HEDGED_SHARE_CLASS`.
- **07-11 21:05 · Dirección:** sitio desplegado por Óscar desde la compilación de las 20:26 (`ceab578`); comprobado
  desde fuera: `index.html` publicado idéntico al compilado y el paquete de la ficha con los textos de nivel de
  índice y de clase cubierta. Nube y web van a la par: catálogo de la tercera subida (decisiones 23-30). Cierre del
  día: 4 repositorios limpios, sesión del camino C archivada, base local guardada a las 20:21. **Pendientes:**
  criterio general nivel de índice frente a ETF cuando existen los dos (decisión 31, encargo de análisis); EDM sin
  relativas hasta tener el IBEX 35 NR; la ficha publicada con los datos nuevos no se ha abierto con sesión (pide
  acceso de asesor); batería de seis anchos de la ficha del KID (la del camino C sí se hizo); regla de lectura de
  `issuers`/`instrument_issuer`; Aena 009 con aptitudes de rentabilidad tras la baja; trazabilidad del KID de DNCA;
  `demoBackend.ts` dependiente de la fecha; el patrón `[A-Z]{1,2}H (EUR)` de cobertura casaría con una palabra de
  tres letras acabada en H (hoy ninguna en el universo).
- **07-11 21:40 · Dirección:** arranca el encargo de análisis «criterio: nivel de índice frente a ETF proxy»
  (Opus 5.5, alto, solo lectura; decisión 31): para las 19 filas de instrumento de `indices.csv`, si EODHD tiene la
  serie del índice con la misma variante; medición ETF frente a índice en los fondos afectados (EURO STOXX 50 NR,
  S&P 500 NR, STOXX Europe 600 NR si existe); opciones A/B/C con consecuencias y recomendación; también la referencia
  de las acciones. Entregable `INFORME_CRITERIO_INDICE_ETF_2026-11-07.md` más artefacto. Sin código ni bases.
- **07-11 22:10 · Dirección:** análisis «criterio nivel de índice frente a ETF» terminado y revisado:
  `INFORME_CRITERIO_INDICE_ETF_2026-11-07.md` (artefacto https://claude.ai/artifact/BWg57Wv5YDmsCnjm28KUkp).
  Comprobado por la directora: `SX5T`, `SPXNTR`, `SXXR` y `TOPXDV` en el catálogo; las filas afectadas miden hoy a
  1 (EURO STOXX 50 NR), 3 (STOXX 600 NR) y 2 fondos + 86 acciones (S&P 500 NR). Óscar decide 33: B con la vigilancia
  de C; nada cambia hoy. Decidido y no construido: la regla escrita en el extractor y el script anual. Sesión de
  análisis archivada. Límite anotado por la sesión: sus derivas SX5T/SX5E (2,2-2,4) difieren de las del camino C
  (2,5-3,1) por el método de ventana; no afecta a la decisión.
- **07-11 22:20 · Dirección:** arranca el encargo «decisión 33: regla escrita y vigilancia anual de proxies» (Opus 5.5,
  medio), territorio `1-extractor`: la regla en el docstring de `core/indices.py` y en un `config/indices.README.md`;
  `reports/vigila_proxies.py` de solo lectura que mide cada proxy contra su índice (R², deriva, meses) con la
  correspondencia explícita de las tres filas que hoy tienen serie, umbral PASA/FALLA de la 33, pruebas con series
  sintéticas y una ejecución real. Ninguna fila ni cifra cambia. Sin bases, sin push.
- **07-11 22:45 · Dirección:** encargo «decisión 33: regla escrita y vigilancia anual» terminado y revisado: `6234967`
  en `1-extractor` (regla en `core/indices.py` y `config/indices.README.md`; correspondencia explícita en
  `config/indices_vigilancia.csv`, 3 filas con serie y 16 «sin serie» con su razón; `reports/vigila_proxies.py` con
  11 pruebas). Repetido por la directora: 944 pruebas en verde y ejecución real con PASA en las tres filas (S&P 500
  NR R² 99,2-99,7 %, deriva −0,11/−0,22/−0,19; STOXX 600 NR R² 99,7-99,9 %, +0,25/+0,32/+0,24; EURO STOXX 50 NR
  igual que el informe), con caché propia y sin tocar `indices.csv` ni `data/`. La decisión 33 pasa de «decidida» a
  **construida**. Cierre del día: 4 repositorios limpios, sesiones de trabajo archivadas, nube y web a la par.
- **07-11 23:00 · Dirección:** decisiones 34-37 (las cuatro del informe FIRDS que seguían abiertas) y dos encargos a la
  vez, en territorios distintos: «alcance de mercados y User-Agent SEC» (Sonnet 5.5, medio; escribe en `1-extractor`:
  `config/alcance_mercados.json`, `esma_firds`, `config/settings.json`, pruebas) y «medición de candidatos a 500
  acciones y 300 ETF» (Opus 5.5, medio; solo lectura, presupuesto de 400 peticiones a EODHD; entregable
  `INFORME_CANDIDATOS_500_300_2026-11-07.md` más artefacto, con cortes 400/500/600 y 200/300/400). Decisión 35 (FIRDS
  completo semanal a mano) no necesita código: `firds --sin-deltas` existe; falta nombrarla en `refrescar.mjs`
  (territorio de la raíz, lo hace la directora).
- **07-11 23:20 · Dirección:** encargo «alcance de mercados y User-Agent SEC» terminado y revisado: `97f2a2d` en
  `1-extractor`; comprobado por la directora: `mic_firds` con los once MIC y sin XETB, candidatos futuros nombrados,
  `esma_firds` lee de la configuración, `sec_user_agent` con nombre y correo, 948 pruebas en verde. Decisiones 34, 35
  y 37 **construidas**. La medición de candidatos (decisión 36) sigue en marcha.
- **07-11 23:50 · Dirección:** medición de candidatos (decisión 36) terminada: `INFORME_CANDIDATOS_500_300_2026-11-07.md`
  (artefacto https://claude.ai/artifact/UWLfGEqp74K5wGLB2Wcm8T), 371 de 400 peticiones a EODHD. Acciones: 8 índices
  europeos = 238 ISIN (126 en el universo), base 338 con las 100 de fuera de los once MIC; las 82 del universo fuera
  de índice (continuo español) negocian 0,18 M€/día de mediana y el criterio puro las saca; cortes 400/500/600 y
  variante «se conserva el continuo» (500 = 420 + 80 nuevas con 5,6 M€/día). ETF: 4.089 ISIN = 2.731 fondos, 36
  marcas; cortes 200/300/400 por los ocho bloques de las carteras modelo; patrimonio solo emisor a emisor (8 de 10).
  Recomendación de la sesión: 500 conservando el continuo y 300 por bloques con patrimonio diferido (mínimo 100 M€).
  Listas copiadas a `side-session-notes/…/candidatos-500-300-listas/` (43 ficheros, sin token). **Pendiente de
  Óscar:** el corte, las 20 acciones fuera de EE. UU. y de los once MIC, las 4 bajas, Milán solo por índice, y
  lectores por emisor o licencia para el patrimonio. La pregunta se le planteó y la sesión directora se reinició
  antes de la respuesta.
- **08-11 07:40 · Dirección:** Óscar aparca las 80 nuevas por liquidez y pide una lista por índices. Encargo «Excel:
  componentes de nueve índices» (Opus 5.5, medio; solo lectura): EURO STOXX 50, IBEX 35, CAC 40, DAX 40, FTSE 100,
  Dow Jones completos; las 100 mayores del S&P 500, del Nasdaq 100 y del STOXX Europe 600 por peso en el ETF
  replicante; todo el IGBM. Hoja por índice, duplicados marcados, total único. Entregable
  `LISTADO_INDICES_2026-11-08.xlsx` en la raíz, sin commit. Reutiliza las composiciones de ayer para IBEX, DAX y CAC.
- **08-11 07:50 · Dirección · corrección:** Óscar detectó que la sesión del Excel corría con Fable 5.1. Comprobado con
  los metadatos de cada sesión: las de la mañana del 07-11 (identidad, camino B y las demás hasta las 16:40) sí
  corrieron con Opus 5.5; pero desde el camino C (17:23) la directora escribió el modelo en el encargo sin pasarlo como
  parámetro, y **camino C, criterio índice/ETF, vigilancia de proxies y medición 500/300 corrieron con Fable 5.1**,
  no con Opus 5.5 como dicen sus líneas de arriba; solo «alcance y SEC» fue Sonnet 5.5 como se anunció. El trabajo y
  sus comprobaciones no cambian; el coste sí fue mayor del decidido. La sesión del Excel pasa a Opus 5.5 desde su
  siguiente turno. Regla desde ahora: el parámetro `model` se pasa siempre y se comprueba antes de registrar el
  modelo en esta coordinación.
- **08-11 08:35 · Dirección:** encargo «Excel de nueve índices» terminado y revisado (Fable 5.1 hasta su primer turno,
  Opus 5.5 después; esfuerzo medio): `LISTADO_INDICES_2026-11-08.xlsx` en la raíz, sin commit. Comprobado por la
  directora con openpyxl: 706 filas, 491 ISIN únicos válidos, 164 en más de un índice, 287 ya en el universo;
  Iberdrola e Inditex en 4 índices, Apple y Microsoft en 3. Por índice: EURO STOXX 50 50 · IBEX 35 35 · CAC 40 40 ·
  DAX 40 40 · FTSE 100 100 · S&P 500 (100 mayores) 100 · Nasdaq 100 101 (Alphabet A y C) · Dow 30 · STOXX 600 (100
  mayores) 100 · IGBM 110. Fuentes: BME (IBEX, IGBM), Euronext (CAC), Wikipedia cotejada con Deutsche Börse (DAX),
  ficheros de posiciones de ETF (Xtrackers, SPDR) para el resto, cada uno cotejado con otro ETF. La directora
  sustituyó las fórmulas del Resumen por valores para que se lean en el móvil. Sin verificar: fecha de posiciones de
  los ficheros de Xtrackers (se supone 06-11); pesos del ETF, no oficiales. Pendiente de Óscar: el corte de la
  decisión 36 con esta lista delante.
- **08-11 08:50 · Dirección:** Óscar pide la versión 2 del listado: FTSE 100 recortado a los 50 mayores por peso, y dos
  índices más, SMI (20) y AEX (25, depurando la lista oficial de Euronext de 29 filas). Encargo «Excel de índices v2»
  con `model: opus` y `effort: medium` fijados en los parámetros; reutiliza los scripts de la sesión de la mañana.
  Sobrescribe `LISTADO_INDICES_2026-11-08.xlsx`, sin commit.
- **08-11 08:15 · Code:** los procesos que arranqué el 07-11 murieron con la sesión anterior de Code:
  lo que arranca una sesión vive lo que vive la sesión. Hoy, con permiso de Óscar: base nueva (8092)
  arrancada e importada, auditada con 0 raíces que no validan y los puertos 4501/9151 ya fijados en
  `4-base-nueva/firebase.json` (`368734b`), y Vite (5174). **La base vieja no ha arrancado**: mi
  primer intento murió por el puerto 4500 y dejó un Firestore huérfano en el 8082 (PID 27208, vacío,
  sin padre) que no puedo parar sin permiso. Procesos míos: la base nueva y Vite.
- **08-11 08:40 · Code:** entorno completo en pie. Con permiso de Óscar paré el Firestore huérfano del
  8082 (PID 27208) y arranqué la base vieja: repoblada de `2026-10-31T13-35-09-399Z` (25.404 = 25.404,
  0 discrepancias), usuario local sembrado, Auth 9097 y Functions 5005 respondiendo. Base nueva (8092)
  importada y auditada, Vite 5174. Los dos emuladores de revisión (5265, 5275) no se han vuelto a
  arrancar. Procesos míos: los cinco; mueren con esta sesión.
- **08-11 09:15 · Dirección:** versión 2 del listado entregada como `LISTADO_INDICES_2026-11-08_v2.xlsx` (la v1 seguía
  abierta en Excel y no se sobrescribe un fichero que Óscar tiene abierto); sin commit. Comprobado por la directora:
  12 hojas de índice, 705 filas, 467 ISIN únicos válidos, 180 en más de un índice, 287 en el universo, sin fórmulas.
  FTSE 100 a los 50 mayores por peso; SMI 20 desde el iShares SMI (CH) del 05-11, coincidente con Wikipedia (el
  Xtrackers SMI difiere en 3 valores y sin fecha, descartado; Roche es `CH1499059983`; Nestlé, Novartis, Roche y UBS ya
  en el universo); AEX **29** valores, no 25: Euronext (06-11) y el iShares AEX (05-11) traen los mismos 29, y los
  puestos 26-29 (SBM, Aalberts, CVC, WDP) llevan nota. Sin verificar: SIX no respondió (sin cotejo oficial del SMI);
  ISIN de Amrize por fuentes secundarias. Pendiente de Óscar: el corte de la decisión 36 con esta lista.
- **08-11 09:30 · Dirección:** decisión 38: entran las 180 acciones del listado de once índices que faltan (312 → 492),
  nada sale, los ETF esperan. Lista de ISIN a añadir en `side-session-notes/…/acciones_a_anadir_2026-11-08.csv`.
- **08-11 09:40 · Dirección:** arranca el encargo «decisión 38: 180 acciones nuevas al universo y a la base local»
  (`model: opus`, `effort: medium`, fijados y por comprobar en metadatos): alta con `main.py add`, pasada con red solo
  sobre las nuevas con copia previa, cadena del extractor, arranque del 8092 (caído desde el reinicio) importando el
  volcado de ayer, plan y escritura local con puerta, auditoría y guardado. Huecos esperados y que debe decir: CH y GB
  sin FIRDS; SE y DK fuera del alcance de MIC; bolsas sin fila en `indices_de_accion.csv` sin relativas. La nube no se
  toca.
- **08-11 10:45 · Dirección:** decisión 38 ejecutada y revisada: `0912070` en `1-extractor` (180 altas, 948 pruebas),
  180 de 180 con símbolo, 360 peticiones a EODHD, fichas anteriores idénticas; base local 47.654 documentos, 0
  inválidos, volcado de las 08:38; comprobado por la directora (492 acciones sin duplicados, 1.286 instrumentos en el
  8092). FIRDS trae CFI, LEI y cotizaciones también para CH, GB, JE, BM, SE, DK y AT (se negocian en centros de la UE):
  el hueco previsto no existe. Óscar decide 39-43: Honeywell when-issued fuera; filas MSCI Europe para Estocolmo,
  Bruselas, Copenhague y Viena más aviso por bolsa sin fila; cotización principal por mercado de origen (Generali,
  Compass e IHG corregidas); Moderna sin métricas con incidencia; FTSE MIB completo (32 que faltan). Todo encargado a
  la misma sesión, que antes refresca emisores por LEI de las 180 (no estaba en la cadena: issuers siguen en 297).
- **08-11 12:10 · Dirección:** decisiones 39-43 ejecutadas por la sesión de ampliación (ocho commits hasta `2570c9d`,
  953 pruebas) y comprobadas: 523 acciones, 516 en canónico y 7 «fuera de alcance» (pedida la lista), base local
  48.878 documentos / 0 inválidos / volcado 09:13, emisores 507 y vínculos 511 (incluye el de Honeywell when-issued,
  que el escritor no borra). Hallazgos: Milán no está en el plan de EODHD (38 italianas por Xetra, Londres o
  Fráncfort con aviso); Technoprobe corregida a Fráncfort por línea corrupta en Londres; Prysmian perdía 18 años de
  historia. Óscar decide 44-47: Prysmian fuera; borrados aprobados de Honeywell WI y Prysmian en local y nube; los dos
  avisos al contrato y a la ficha; cuarta subida detrás. La plataforma ignora hoy `cotizacion_aviso` y
  `sin_relativas_bolsa_sin_referencia`.
- **08-11 12:40 · Dirección:** decisión 44 hecha (`e2c32eb`, 522 acciones, 515 en canónico; 0 cambios fuera de Prysmian;
  base local no tocada); 86 rutas a borrar nombradas en la nota; sesión de ampliación archivada. Las 7 «fuera de
  alcance» son exclusiones de Óscar del 02-11 (AU, JP y CEVASA), no un hueco. Arranca «decisiones 45-47» (`model:
  opus`, `effort: high`, fijados): `BORRADOS_APROBADOS` con las 86 rutas; los dos avisos al contrato (`relative_absence`
  por bolsa sin referencia; cotización no principal con motivo) y a la ficha con `diseno-pantalla`; escritura local
  con borrados; plan de la nube solo lectura. La escritura en la nube la aprueba Óscar en su ventana.
- **08-11 13:20 · Dirección:** decisiones 45 y 46 hechas: `26b36b3` (plataforma: 86 borrados aprobados con la marca
  `instrumento_retirado`, `relative_absence = NO_REFERENCE_DECIDED_FOR_MARKET`, motivo de cotización en
  `declared/equity.listing.non_primary_reason`), `f144ca7` (app: las dos notas de la ficha, 48 capturas sin desbordes).
  Base local 48.792 documentos (48.878 − 86), 0 inválidos, volcado 10:32; comprobado por la directora: los dos retirados
  y el emisor de Prysmian ausentes, Honeywell vigente y su emisor intactos, Generali con relativa contra MSCI Europe.
  Plan de la nube (solo lectura, la sesión lo pudo leer): 8.146 a crear, 40.028 a reemplazar (122 con contenido: las 4
  italianas que pasan a Xetra y los 3 `search_shards`), **0 `SE BORRARIA`** porque los dos retirados nunca llegaron a la
  nube; carteras y retrocesiones con huella. **No se sube todavía:** la nota de cotización sería falsa en 5 acciones
  (Chubb, NXP, Nebius, argenx, DSM-Firmenich) porque el extractor deduce el mercado de origen del prefijo del ISIN,
  y lo mismo pasaría a Airbus y STMicro en su próxima pasada; faltan 5 países en `PAIS_DEL_MERCADO` (36 acciones sin
  país del listado); y la gráfica de Compass dice «Serie no disponible» en desarrollo con la serie en la base. Encargo
  de corrección propuesto antes de la cuarta subida.
- **08-11 13:40 · Dirección:** Óscar arranca «correcciones antes de la cuarta subida» (`model: opus`, `effort: medium`):
  mercado de origen real (tabla explícita + FIRDS antes que el prefijo del ISIN; Chubb, NXP, Nebius, argenx,
  DSM-Firmenich, Airbus y STMicro sin aviso), cinco países de `PAIS_DEL_MERCADO`, causa de la gráfica de Compass, y
  base local reescrita. El plan de la nube lo repetirá la directora después. Sesión 45-47 archivada.
- **08-11 14:35 · Dirección:** correcciones previas a la cuarta subida hechas y revisadas: `1e3e88e` (extractor: tabla
  `config/mercado_de_origen.csv` con 11 filas y fuente por fila; regla tabla → FIRDS con autoridad competente, solo para
  ISIN del EEE o domicilios de conveniencia → prefijo al final; 965 pruebas) y `88fe8f7` (plataforma: seis países del
  listado, 1.314 pruebas); la app no cambia. Avisos de cotización: 39 (37 italianas + Compass + IHG); los 5 falsos
  fuera. Base local 48.792 documentos, 0 inválidos, volcado 11:26; Chubb sin aviso y Generali con él. Gráfica de
  Compass: causa de entorno (en desarrollo la callable de series lee la base vieja del 8082), ni app ni dato; en la web
  debería pintar tras la subida. Plan de la nube repetido por la directora a las 14:30: 48.174 documentos, 0 que no
  validan, 386 tandas, nada que borrar (los retirados nunca llegaron), carteras y retrocesiones con la misma huella que
  tras la tercera subida. Pendientes de Óscar: la escritura; Ferrovial y Allianz (símbolos `FER.US` y `ALV.F` cuando
  EODHD tiene sus mercados de origen); HSBC con `FX_QUARANTINE` sin investigar.
- **08-11 15:10 · Dirección:** cuarta subida hecha por la sesión de correcciones (aprobada por Óscar en su ventana) y
  comprobada por la directora leyendo la nube a las 15:07: 1.316 instrumentos, 1.252 métricas, 506 emisores, 29.032
  series; Generali `HOME_MARKET_NOT_AVAILABLE`, Chubb sin aviso, Volvo con relativas, `US4385162056` e `IT0004176001`
  no existen; carteras 18 / 220 y retrocesiones 376 + 4 con la misma huella que antes. Comparación completa de la
  sesión: 48.174 iguales, 0 distintos (los 5 «distintos» del postverify son orden de claves, como siempre). Decisión 49
  hecha solo en local (`ecb6c4e`, `651e9a7`): Allianz a `ALV.XETRA`, Ferrovial a `FER.MC` (FIRDS: autoridad ES) con fila
  en la tabla; Ferrovial cambia de referencia (S&P 500 → MSCI Europe, beta 3a 0,43 → 1,30) y gana métricas a 5 años.
  **Pendientes:** redespliegue del sitio (compilado a las 11:32 desde `f144ca7`); 5 documentos sobrantes de Allianz
  (`price_series/1989` a `1993`, 1.241 puntos de Fráncfort, también en la nube) que exigen `BORRADOS_APROBADOS`; 17 de
  522 acciones no pintan serie en la gráfica (505 sí) sin lista. Corrección de la sesión: HSBC no tenía problema.
- **08-11 15:30 · Dirección:** decisión 50 hecha en local (`91cf2e0` plataforma, 1.315 pruebas; `BORRADOS_APROBADOS` 91
  rutas): Allianz sin 1989-1993, comprobado en el 8092; base local 48.788 documentos, 0 inválidos, guardada. En la nube
  siguen hasta la quinta subida, que llevará también Ferrovial y Allianz en sus mercados de origen. Falta la lista de
  las 17 acciones sin gráfica y el deploy de Óscar.
- **08-11 15:40 · Dirección:** las 17 acciones sin gráfica, explicadas: 4 bloqueadas por calidad (Deoleo, Duro Felguera,
  Squirrel, Soltec; control de Óscar del 30-09, saltos del 200-570 % también en EODHD), 6 que ya no cotizan (Aena viejo,
  CAM, NH, Ercros, Siemens Gamesa, Levantina) y 7 fuera de alcance por decisión (AU, JP, CEVASA). Nada que arreglar
  salvo, si Óscar quiere, otra fuente para las 4 bloqueadas. Sesión de correcciones archivada. Todo en local; en la
  nube, la cuarta subida; sitio compilado a las 11:32 pendiente de deploy.
- **08-11 15:55 · Dirección:** sitio desplegado por Óscar desde `4-base-nueva` (el primer intento desde la raíz falló
  porque su `firebase.json` no tiene hosting). Comprobado desde fuera: `index.html` publicado idéntico al compilado de
  las 11:32 (`f144ca7`) y el paquete de la ficha con la nota de cotización no principal. Nube y web a la par con la
  cuarta subida: 522 acciones. Pendiente para la quinta: Ferrovial y Allianz en sus mercados de origen, borrado de los
  5 años viejos de Allianz en la nube. Cuatro repositorios limpios; ninguna sesión de trabajo abierta.
- **08-11 16:10 · Dirección:** arranca «quinta subida del catálogo» (`model: opus`, `effort: high`, fijados): decisiones
  48-50; cambia Ferrovial (`FER.MC`, referencia MSCI Europe) y Allianz (`ALV.XETRA`) y salen de la nube los 5 años viejos
  de Allianz (`SE BORRARIA` = 5). Foto previa, plan, aprobación de Óscar en la ventana de la sesión, escritura solo del
  catálogo, verificación posterior. Sin cambios de app: no hay deploy.
- **08-11 16:40 · Dirección:** quinta subida hecha (aprobada por Óscar en la ventana de la sesión) y comprobada por la
  directora en la nube: 1.316 instrumentos, 29.028 series; Ferrovial y Allianz con referencia MSCI Europe y sin aviso de
  cotización; Allianz sin 1993 y con 1994; carteras 18 / 220 y retrocesiones 376 + 4 con la misma huella que tras la
  cuarta. Comparación completa de la sesión: 48.170 iguales, 0 distintos. Sin deploy (la app no cambió). Sesión
  archivada. Nube, local y web a la par; cuatro repositorios limpios. Decisiones 1-50 ejecutadas salvo las que
  quedan abiertas por Óscar (ETF, Aena 009, camino A segunda tanda, EDM, las 4 bloqueadas por calidad).
- **08-11 16:55 · Dirección:** arranca el paso 3 (ETF) con la medición previa «fuentes de los nueve emisores» (`model:
  opus`, `effort: medium`, solo lectura, 60 peticiones de tope a EODHD): por emisor, qué se obtiene sin navegador (NAV
  histórico, patrimonio, TER, reparto, réplica, índice, composición, documentos, EMT/EET), prima/descuento NAV frente a
  precio en 12 meses, clasificación oficial, los 18 ETF sin métricas y el orden de construcción. Entregable
  `INFORME_FUENTES_ETF_2026-11-08.md` más artefacto. Los 32 ETF del universo no cambian (decisión 38).
- **08-11 17:30 · Dirección:** medición de fuentes de ETF terminada: `INFORME_FUENTES_ETF_2026-11-08.md` (artefacto
  https://claude.ai/artifact/VauxxPYJhNX8ZeWytXmfNU), 11 de 60 peticiones a EODHD. Seis emisores sin navegador (iShares
  Excel con VL desde 2009; Amundi JSON por ISIN con VL, dividendos y composición; Xtrackers JSON; Vanguard GraphQL; SPDR
  XLSX y catálogo; Invesco JSON y EMT/EET en CSV), 257 de 300; HSBC, WisdomTree y VanEck sin histórico; UBS 403. El
  lector de iShares de `gestoras.py` está roto. Los 18 «sin métricas» del 03-11 ya las tienen sobre precio desde el
  04-11. Óscar decide 51-54. Siguientes encargos propuestos: resumen de condiciones de uso (Haiku, lectura) y el
  adaptador de iShares rehecho (Opus medio). Sesión de medición archivada.
- **08-11 18:05 · Dirección:** resumen de condiciones de uso entregado (Haiku, lectura):
  `CONDICIONES_USO_EMISORES_ETF_2026-11-08.md` (artefacto https://claude.ai/artifact/3b4SVhnoyuuxfsp9QJNL47). Cláusula de
  uso automatizado encontrada solo en Vanguard; redistribución y uso comercial en los cinco accesibles; Xtrackers/DWS no
  accesible (la página solo devuelve el título); Amundi con aviso de aceptación no pulsado. Las citas son extractos
  cortos: Óscar lee las páginas vivas (decisión 53). Sin interpretación jurídica.
- **08-11 18:40 · Dirección:** adaptador de iShares rehecho (decisión 51): `ca0c073` en `1-extractor`, 992 pruebas;
  comprobado por la directora en los 3 ETF: `emisor.*` (id, índice, TER, réplica, política, patrimonio, cartera,
  distribuciones) y `series.vl_emisor` (4.375 / 4.276 / 5.381 puntos, desde 2009, 2010 y 2005), `riesgo.*` y métricas
  idénticos. Forma del bloque fijada en la nota `adaptador-ishares-08-11-2026.md` para los cinco siguientes. Desvío
  justificado: la serie va en `series.vl_emisor` y no en `riesgo` (guarda de regresión y documento ligero) ni en
  `cartera` (fusión de fuentes); el TER, la réplica y las posiciones del emisor **no sustituyen** a Morningstar/justETF:
  que el emisor mande es otra decisión de Óscar. El adaptador se pide con `--fuentes` y no entra en la pasada general
  hasta que Óscar lea las condiciones de uso (decisión 53). Prima media 12 meses: +0,06 %, +0,11 % y −0,03 % ajustada
  por dividendos. Sin obtener: `DE0005933956`. Siguiente: Amundi (propuesto).
- **08-11 19:00 · Dirección:** Óscar arranca el adaptador de Amundi (`model: opus`, `effort: medium`): misma forma que
  iShares (`emisor.*`, `series.vl_emisor`, `--fuentes`), 3 ETF reales, sin pulsar el aviso de aceptación de la web.
- **08-11 19:45 · Dirección:** adaptador de Amundi hecho (decisión 51): `59e2094` en `1-extractor` (`fetchers/amundi.py`,
  `tests/test_amundi.py`), 1.028 pruebas; comprobado por la directora en los 3 ETF (Core STOXX Europe 600, Japan Topix,
  MSCI AC Asia ex Japan): `emisor.*` con TER y política, `series.vl_emisor` desde 2013, 2018 y 2012, `riesgo.*` intacto.
  Fuera de la pasada general hasta la decisión 53. Siguiente: Xtrackers (propuesto). Sesión archivada.
- **08-11 20:00 · Dirección:** Óscar arranca el adaptador de Xtrackers (`model: opus`, `effort: medium`): misma forma, 3
  ETF con uno sintético para distinguir cesta de sustitución y posiciones del índice.
- **08-11 20:40 · Dirección:** adaptador de Xtrackers hecho (decisión 51): `708420c` en `1-extractor`, 1.075 pruebas;
  comprobado por la directora: MSCI World Health Care (réplica física, VL desde 2010) y EUR Overnight Rate Swap
  (réplica sintética, VL desde 2007, estructura y método declarados), `riesgo.*` intacto; el tercer ETF no está en el
  universo y corrió sin ficha. Tres de seis adaptadores en la forma común. Siguiente: Vanguard (propuesto). Sesión
  archivada.
- **08-11 21:05 · Dirección:** Óscar arranca el adaptador de Vanguard (`model: opus`, `effort: medium`): GraphQL con id
  propio, VL y dividendos; misma forma; solo con `--fuentes` mientras Óscar lee la cláusula de uso automatizado de su web.
- **08-11 21:40 · Dirección:** adaptador de Vanguard hecho (decisión 51): `e5ee4f8` en `1-extractor`, 1.111 pruebas;
  comprobado por la directora: el fondo índice U.S. 500 Stock Index (proxy del S&P 500 NR) y el ETF S&P 500 Distrib con
  `emisor.*` (TER, 5 distribuciones en el que reparte) y `series.vl_emisor` desde 2014, `riesgo.*` intacto; la vía
  sirve también para los fondos índice de Vanguard sin cambiar su tratamiento. Cuatro de seis. Siguiente: SPDR
  (propuesto). Sesión archivada.
- **08-11 22:15 · Dirección:** arranca el adaptador de SPDR (`model: opus`, `effort: medium`), quinto de seis: catálogo
  `fundfinder`, XLSX de VL y de posiciones; misma forma; `IE00B3T9LM79` es proxy de 3 fondos y su `historial_precios` no
  puede moverse. Desde Remote Control no se pudo arrancar; Óscar lo pidió de nuevo desde el escritorio.
- **08-11 17:45 · Code:** la tira del alfa que el traspaso del 06-11 dejaba pendiente **ya estaba hecha** por
  Frontend el 07-11 (`3173229` en la app, prueba `tests/alfaDeLaTira.test.ts`): «contra su índice» para el nuestro,
  «del proveedor, contra el índice de su categoría» para el suyo, y la cifra sola si la pareja fuente/referencia no es
  conocida. Comprobado hoy sobre la base nueva local: de 492 tarjetas aptas, 263 son del proveedor y 228 nuestras, y las
  dos frases salen en la app (capturas a 1440 px enviadas a Óscar: `ES0137396000` y `BE0943877671`). Puertas en la
  cabeza `f144ca7` sin cambios: typecheck, build (JS 120,2 KiB, CSS 26,7 KiB), censo (0 sin regla) y lint en verde;
  `npm test` deja 3 fallos de `tests/marcoCicloDeCartera.test.tsx` que pasan solos (7/7) y la suite entera repetida está en verde (4.249): carga, no regresión.
  **Hallazgo:** `LU2504555777` (Fidelity Global Industrials) es apto para `MOSTRAR_ALPHA` y su tarjeta no lleva alfa, así
  que la tira dice «Sí» sin cifra. La regla de `2-plataforma-datos/src/config/baseNueva/aptitudes.ts` da por bueno el
  alfa del proveedor sin exigir `classification.category`, y la tarjeta (`calidadYTarjeta.ts`) no lo escribe sin
  categoría. Es el único de 492. Sin arreglar: pendiente de que Óscar diga si se alinea la regla con la tarjeta.
- **08-11 22:50 · Dirección:** adaptador de SPDR hecho (decisión 51): `7bd7a55` en `1-extractor`, 1.162 pruebas;
  comprobado por la directora en los 3 del universo: Bloomberg Euro Corporate (VL desde 2011, `historial_precios`
  intacto: sigue siendo proxy de 3 fondos), MSCI Europe Small Cap (desde 2005) y SPDR S&P 500 Trust (desde 2003, sin TER
  en la vía), `emisor.*` con patrimonio. Cinco de seis. Siguiente: Invesco (propuesto). Sesión archivada.
- **08-11 23:05 · Dirección:** Óscar arranca el adaptador de Invesco (`model: opus`, `effort: medium`), sexto y último de la
  decisión 51: VL derivado de la serie de crecimiento marcado como tal; EMT/EET solo a caché y descripción (paso 4).
- **08-11 23:40 · Dirección:** adaptador de Invesco hecho (`9c55849`, 1.217 pruebas): VL deducido de la serie de
  crecimiento en clases de acumulación (ancla + cota de redondeo), rentabilidad acumulada sin VL en las de reparto;
  comisión de swap fuera del TER guardada aparte; EMT/EET en caché con columnas descritas (paso 4). Comprobado por la
  directora: 2 fichas de Invesco con `emisor.*` y serie, `riesgo.*` intacto; en total 15 fichas con bloque del emisor
  (iShares 3, Amundi 3, SPDR 3, Vanguard 2, Xtrackers 2, Invesco 2). **Decisión 51 construida en el extractor.**
  Correcciones al informe de fuentes: la API de Invesco exige `idType=isin`, tiene posiciones reales y EET en bloque.
  Siguiente propuesto: que la base y la ficha lean el bloque del emisor (contrato, mapper, app). Sesión archivada.
- **08-11 18:20 · Code:** la aptitud del alfa exige ya lo mismo que la tarjeta (`dd2aeb9` en `2-plataforma-datos`,
  1.316 pruebas): con índice propio, nuestro alfa con su R²; sin él, el del proveedor con su R² **y su categoría**. Es
  presencia del R², no umbral; el filtro de lectura no se toca. Base nueva local reescrita con la puerta por orden
  (`baseNueva:write` 16.331 y `baseNueva:batch` 2.635, postverify 0/0/0) y guardada con `guardar.mjs`: 491 tarjetas
  aptas, todas con alfa a 1 año; `LU2504555777` pasa a no apto por `classification.category` y su ficha dice «Falta el
  dato» (captura enviada). La nube no se ha tocado: la calidad de ese fondo en producción sigue diciendo «Sí» hasta la
  próxima subida del catálogo que ordene Óscar.
- **08-11 23:55 · Dirección:** Óscar arranca «la base y la ficha leen el bloque del emisor» (`model: opus`, `effort:
  high`, contrato): diseño primero (dónde va el VL del emisor sin confundirse con la serie de las métricas, VL deducido,
  datos del emisor junto a los declarados sin sustituirlos, comisión de swap aparte, prima/descuento con su ausencia),
  contratos, mapper, ficha con `diseno-pantalla`, escritura local. La nube no.
- **09-11 00:30 · Dirección:** la base y la ficha leen el bloque del emisor: `cf291e8` (plataforma, 1.336 pruebas) y
  `05838b9` (app, 4.273, typecheck, build, censo CSS y lint). Diseño: VL del emisor en colección propia `issuer_nav/{año}`
  (fuera de `price_series`, para que las métricas no puedan leerlo); datos del emisor en un solo documento
  `declared/issuer_data`, con la comisión de swap aparte del TER, sin sustituir a ningún declarado; prima/descuento en
  `computed/premium_discount` (media y última a 12 meses, VL ajustado por dividendos en clases de reparto, ausencia
  explicada). Ficha: VL con fecha y prima con la nota de §11, comisión de swap en Coste, tabla emisor frente a otra
  fuente sin elegir. Base local: 15 `issuer_data`, 253 años de `issuer_nav`, 14 primas; auditoría válida; volcado 19:06.
  Comprobado por la directora: documentos presentes en iShares e Invesco. Guarda nueva: `subirALaNube.ts` excluye estos
  datos hasta la decisión 53. Los 15 son 13 ETF, un monetario por swap y el fondo índice de Vanguard. Para la decisión
  «si el emisor manda»: TER coincide en los 14 con cifra en ambos; política de reparto «desconocida» en 10 de 15 fichas
  donde el emisor declara acumulación; posiciones difieren en las 9 con cifra en ambos (sin mirar por qué). Sin mapear:
  posiciones completas y desgloses de exposición del emisor. **Paso 3 construido de extremo a extremo en local.** Cierre
  del 08-11: nube y web en la quinta subida; cuatro repositorios limpios; sesión archivada.
- **08-11 19:47 · Code:** Óscar elige seguir con el S&P 500 TR del paso 2 y resulta **superado**, no pendiente: la fila
  `S&P 500,TR,SP500TR.INDX` del camino C (decisión 28, `e99711c`) ya mide a los dos AB Select US Equity contra el
  propio índice en su variante exacta; Morgan Stanley AH (EUR) sale por clase cubierta (decisión 27) y el SPDR S&P 500
  por ETF (decisión 26). Comprobado en `export/fondos.ndjson`. No se construye el cambio de código que admitiría otra
  variante declarada: medir TR contra proxy NR con la serie TR disponible sería un paso atrás. El informe del 06-11
  lleva el punto tachado con la fecha. Del paso 2 queda **solo el ICE BofA** (equivalencia, contrato y ficha en el
  mismo cambio, esfuerzo alto).
- **08-11 20:06 · Code:** ICE BofA Euro Corporate activado como equivalente de la fila Bloomberg Euro Corp, con contrato y
  ficha en el mismo cambio. Mide a **5 fondos** (Evli Corporate Bond B, Schroder EURO Corporate ×2, BlackRock Euro
  Corporate A2, M&G European Credit); de los 8 que lo declaran, Invesco y Carmignac Credit siguen retirados por KID
  compuesto y BlackRock A1 reparte. Campo nuevo `benchmark.equivalent_of` en `computed/metrics` y en la tarjeta;
  `name` sigue siendo el índice medido. La tira dice «contra un índice equivalente al suyo» y «Frente a su índice»
  nombra los dos, en modo interno y de cliente. Sin serie del ICE BofA para contrastar: R² 88-97 % frente a 92-97 % de
  los que declaran Bloomberg, y alfa a 0,0-0,3 puntos del proveedor. Base nueva local escrita (16.613 + 2.635,
  postverify 0/0/0) y guardada. **La nube no se ha tocado**: los 5 fondos llegan con la próxima subida del catálogo.
  El plan sigue bloqueando `US60770K1079/computed/metrics` (Moderna, rentabilidad a 1 año por encima del límite del
  contrato), que ya estaba en la pasada anterior.
- **08-11 21:05 · Code:** preparada la subida del ICE BofA, **sin escribir nada en la nube**. Sitio compilado de `ef3d431`
  en `4-base-nueva/sitio/`; publicarlo es de Óscar (`--only hosting`: las reglas desplegadas son iguales). Plan del
  catálogo: 48.170 documentos, 0 nuevos, 0 borrados, 282 del emisor fuera. Comparación documento a documento, solo
  lectura: 41.650 iguales, 6.402 solo sello, 0 series distintas, 57 instrumentos con contenido (5 ICE BofA, 37 con la
  aptitud del alfa alineada, entre ellos Fidelity, y 15 con `issuer_data` en `available_sections`). Esas 15 tarjetas
  nombrarán una sección que no sube hasta la decisión 53: inocuo, la ficha no pinta nada. Orden: web primero, catálogo
  después, con aprobación de Óscar.
- **08-11 21:28 · Code:** sexta subida hecha, solo catálogo, aprobada por Óscar tras publicar él la web (el paquete servido
  coincide con el de `ef3d431`; a la primera «publicada» aún no lo estaba, y por eso se comprobó antes de abrir la
  puerta). 48.170 documentos, 386 tandas, 0 borrados, 282 del emisor fuera (decisión 53). Comparación completa
  posterior con claves ordenadas: 48.170 iguales, 0 distintos. Los 5 «distintos» y la salida 1 del postverify del script
  son su comparación sensible al orden de claves, como en las subidas anteriores. Carteras 18, objetivos, retrocesiones
  376 + 4 y clientes con la misma huella antes y después. Ya en producción: los 5 fondos del ICE BofA y Fidelity
  Global Industrials sin «Sí». Nube, local y web a la par. Sin comprobar: la ficha publicada abierta con sesión.
- **08-11 21:50 · Dirección:** *corrección de reloj: las líneas de Dirección del 08-11 marcadas 22:50, 23:05, 23:40 y
  «09-11 00:30» van unas cinco horas adelantadas; son de 17:50 a 19:15 (commits `82b58fb` a `8c819e6`), y el estado de
  la decisión 51 «a las 23:40» es de las 18:34.* **Sexta subida comprobada por la directora en la nube**, solo lectura:
  1.316 instrumentos, 1.252 `computed`, 11.836 `declared`, 29.028 `price_series`, 0 `issuer_nav`; en los 15 del bloque
  del emisor, 0 `issuer_data` y 0 `premium_discount` (la guarda de la decisión 53 funcionó); los 5 fondos del ICE BofA
  llevan `benchmark.name` «Bloomberg Euro Corp» y `equivalent_of` «ICE BofA Euro Corporate», R² 0,89-0,97; Fidelity
  `LU2504555777` no apto para `MOSTRAR_ALPHA` (falta `classification.category`) y su tarjeta sin alfa. Las 15 tarjetas
  nombran `issuer_data` y `premium_discount` sin documento detrás: inocuo, `baseNuevaLectura.ts` lee los dieciocho
  documentos de la ficha sin mirar `available_sections`. **Por qué difieren las posiciones**, medido sobre
  `export/fondos.ndjson` (los 15 tienen cifra en ambas fuentes, no 9): coinciden 3 (EURO STOXX 50 57/57, Stoxx Europe
  600 612/612, SPDR S&P 500 Trust 505/505) y difieren 12 por tres causas que no son errores de dato. (a) Los 5
  sintéticos: el emisor cuenta la cesta de sustitución (40 a 862 títulos) y Morningstar la exposición, un swap; la ficha
  ya lo rotula «Posiciones de la cesta». (b) Qué es una posición: el emisor cuenta líneas con liquidez, divisa y futuros;
  Vanguard da 527 y 513 frente a 505 **con la misma fecha** (30-09); donde el emisor declara además su número de títulos,
  coincide con el de renta variable del proveedor (iShares 1.248/1.247, 1.247/1.247 y 50/50; Amundi 613/610 con dos
  días de diferencia). (c) Fecha: 5 físicos con una a cinco semanas entre fuentes (iShares −26 y −6, SPDR −39 y −14,
  Xtrackers −12). El peso del top 10 coincide a ±0,5 puntos en los 10 físicos e índice: es la misma cartera. Conclusión:
  el número de posiciones no es comparable sin definición, como la §3 del método para los estimadores; la ficha compara
  hoy `holdings.positions_count` (líneas) con el total del proveedor y dice «difiere» en 12 de 15. Decisión 55
  propuesta a Óscar con tres opciones, en página publicada. Nada escrito en la base ni en la nube.
- **08-11 22:05 · Dirección:** Óscar elige la **B** (decisión 55, `61cd882`): las dos cifras de posiciones con su definición
  y su fecha, «Coincide» solo si miden lo mismo, y la política del emisor donde el proveedor dice «desconocida». Al
  prepararlo salió que no es solo pantalla: `declared/holdings` guarda del proveedor solo el total de líneas, así que el
  contrato necesita su recuento de títulos (`num_posiciones_rv`/`rf` del canónico), y el encargo pasa a Opus 5.5 con
  esfuerzo alto (contrato + base local + ficha). Encargo completo escrito en la carpeta compartida de notas de la
  directora (`encargo-posiciones-emisor-08-11-2026.md`). **Sin arrancar:** el app no abre sesiones ni tarjetas mientras
  Óscar sigue por control remoto; se arranca desde el PC o lo decide él.
- **08-11 22:05 · Dirección:** Óscar arranca «Posiciones del emisor en la ficha (decisión 55)» desde el PC. Modelo
  Opus 5.5, esfuerzo alto, **comprobados en los metadatos de la sesión** (`claude-opus-5-5`, `high`). Encargo: campo
  de recuento de títulos del proveedor en `instrument-declared-holdings.v2` y en el mapper, reescritura y guardado de
  la base local, ficha con las cuatro reglas de la 55 y pruebas sobre los casos reales, batería de seis anchos y
  capturas a Óscar. La nube no se toca y `subirALaNube.ts` conserva la exclusión de la 53.
- **08-11 22:19 · Code:** Decisión 55 construida en local. `2-plataforma-datos` `75ba1e5`: `securities_count` en
  `instrument-declared-holdings.v2` y en el mapper, 1.344 pruebas en verde. `3-BDB-ACTIVOS_app` `7402894`: las cuatro
  reglas en la ficha, 4.292 pruebas y 5 omitidas, typecheck, build, censo CSS y lint en verde; batería de seis anchos
  sin desbordes sobre `IE00B4L5Y983` y `IE00B3YCGJ38`, y además `IE00B3XXRP09` y `LU0290358497`; capturas a 1440
  enviadas. Base local reescrita y guardada: 16.613 y 2.635 documentos con postverify 0/0/0, `audit:base-nueva` valida
  entera. El campo está en las 763 carteras, y en **9 de los 15** del emisor: los 5 sintéticos no traen acciones ni
  bonos, y SPY no tiene líneas de cartera, así que no tiene `declared/holdings`. Tres cosas que el encargo no recogía:
  (a) **`positions_count` del proveedor no es el total de líneas**, sino los bonos o, si no hay, las acciones; el
  contrato ya lo dice, y el campo no se toca. (b) **`declared_positions_count` solo es un recuento de títulos en
  iShares**: Vanguard pone ahí sus líneas (513/513) y Amundi sus líneas más la de efectivo (613/612), así que la ficha
  solo lo enfrenta si queda por debajo de las líneas, y Amundi `LU0908500753` va como líneas y no como «613 frente a
  610». (c) **Pregunta para Óscar:** en los 10 con la política del emisor, la cabecera sigue diciendo «reparto sin
  confirmar», porque las aptitudes siguen con la del proveedor. **Sin comprobar:** la ficha contra la nube, donde no
  está el bloque del emisor. Nada subido, sin `git push`. Detalle en `posiciones-emisor-decision-55-08-11-2026.md`, en
  la carpeta compartida de notas.
- **08-11 22:40 · Dirección:** decisión 55 revisada por la directora: `75ba1e5` toca solo el esquema de `holdings`, el
  vocabulario, el mapper y su prueba; `7402894` solo `fichaDelEmisor.ts`, `componerFicha.ts` y la prueba;
  `subirALaNube.ts` sin cambios. Pruebas repetidas: plataforma 1.344/1.344 sola (1 fallo cuando corrió a la vez que la
  app); app 4.291 + 5 omitidas con los 3 fallos de siempre de `marcoCicloDeCartera.test.tsx`, que pasan solos (7/7), y
  `fichaDelEmisor.test.ts` en verde (45 con el otro). Base local leída en el 8092: `securities_count` en 763 carteras;
  en los 15 del emisor está en 9, y los 6 sin él no tienen `declared/holdings` (5 sintéticos sin RV ni RF, y SPY sin
  líneas de cartera). Corrección a mi medición de las 21:50: el `positions_count` del proveedor en la base **ya eran
  títulos** (bonos o, si no, acciones: 1.247 en iShares, no 1.307), no líneas; el total de líneas del canónico no está
  en la base. Y el recuento «declarado» del emisor solo son títulos en iShares (Vanguard y Amundi ponen sus líneas),
  de ahí la regla de la sesión: se enfrenta solo si queda por debajo de las líneas. Pendiente de Óscar, no decidido: la
  cabecera dice «reparto sin confirmar» en los 10 con política del emisor, porque la aptitud sigue con la del proveedor
  (la 52 dice que el emisor no sustituye). **Decisión 53 resuelta** a las 22:35, por control remoto: uso interno para
  el desarrollo (`824fb0d`). Siguiente encargo, sin arrancar: adaptadores en la pasada general, exclusión de
  `subirALaNube.ts` fuera, y séptima subida con el bloque del emisor y `securities_count`. Sesión archivada.
- **08-11 22:50 · Dirección:** Óscar decide por control remoto la **56**: la política del emisor vale para la aptitud
  donde el proveedor dice «desconocida» (10 de 15), con la fuente anotada; donde el proveedor la da, manda él. Se
  construye en `aptitudes.ts` y en la tarjeta, no en la ficha. Encargo siguiente, **sin arrancar** hasta que Óscar diga
  «Arranca» desde el PC (Opus 5.5, esfuerzo alto, contrato y escritura): los seis adaptadores en la pasada general del
  extractor (decisión 53 resuelta), exclusión de `subirALaNube.ts` fuera, la aptitud de la 56, base local reescrita y
  guardada, plan de la séptima subida comparado documento a documento, y la subida solo con la puerta y la aprobación
  de Óscar en la ventana de la sesión; web compilada de la cabeza de la app para que él la publique antes del catálogo.
- **08-11 23:00 · Dirección:** Óscar dice «Arranca» para la séptima subida, pero sigue por control remoto y el app no
  abre la sesión. Encargo completo guardado en la carpeta de notas de la directora
  (`encargo-septima-subida-08-11-2026.md`): se arranca desde el PC, con Opus 5.5 y esfuerzo alto comprobados.
- **08-11 23:27 · Code:** decisiones 53 y 56 construidas en local y séptima subida **planificada, sin escribir en la nube**.
  `1-extractor` `6600196`: los seis adaptadores en `prioridad_fuentes`, cada instrumento solo en el emisor de su marca,
  1.236 pruebas. `2-plataforma-datos` `0f9fd61`: exclusión de `subirALaNube.ts` fuera, aptitud de la 56 y campo
  `metrics.distribution_policy_source` en la tarjeta, 1.349 pruebas. App sin tocar. Emisor: de 15 a 33 fichas (32 en la
  base; el oro es OTHER, sin contrato); 50 peticiones a red, 0 errores. Base local escrita y guardada, 264 creados, 16.613
  y 2.635 reemplazados, postverify 0/0/0, auditoría válida. Aptitud de la 56 en 20 instrumentos, no 10. Cabecera de
  `IE00B4L5Y983` comprobada en local y captura enviada. Web de `7402894` compilada, sin publicar. Plan comparado con claves
  ordenadas: 48.716 documentos, 40.887 iguales, 4.920 solo sello, 546 nuevos del emisor (32 + 488 + 26), 2.363 con contenido,
  todos explicados (763 `securities_count`, 800 calidad y 800 tarjeta con la cobertura recalculada), 0 `computed/metrics`
  con contenido, 0 series, 0 borrados, 0 solo en la nube. Carteras 18, objetivos 220, retrocesiones 376 + 4 con las huellas
  de siempre. Hallazgo: un `update --all` sin red no es neutro (pierde FIRDS en 27 fichas), y por eso se devolvieron las
  1.305 fichas sin bloque nuevo. Falta: que Óscar publique la web y apruebe la subida en la ventana. Abiertas de la 53, las
  tres páginas sin leer (DWS, SPDR europea, aviso de Amundi). Detalle en `septima-subida-plan-08-11-2026.md`.
- **08-11 23:05 · Dirección:** Óscar arranca «Pasada general del emisor y séptima subida (decisiones 53 y 56)». Modelo
  Opus 5.5, esfuerzo alto, **comprobados en los metadatos** (`claude-opus-5-5`, `high`). Encargo: adaptadores en la
  pasada general, exclusión de `subirALaNube.ts` fuera, aptitud de la 56 en `aptitudes.ts` y la tarjeta, base local
  reescrita y guardada, web compilada, plan de la séptima subida comparado contra la nube en solo lectura, y la subida
  solo con la aprobación de Óscar en la ventana de la sesión tras publicar él la web.
- **08-11 23:40 · Dirección:** plan de la séptima subida revisado por la directora antes de que Óscar apruebe. Repetido:
  extractor 1.236/1.236, plataforma 1.349/1.349. Commits acotados: `6600196` toca `registro.py`, `settings.json`, README
  y pruebas; `0f9fd61` toca `subirALaNube.ts` (la exclusión fuera, con la razón escrita), `aptitudes.ts`,
  `calidadYTarjeta.ts`, `emisorDeEtf.ts`, el contrato de la tarjeta y pruebas; app sin tocar. Base local leída en el 8092:
  32 `issuer_data`, 488 `issuer_nav`, 26 `premium_discount`; 20 tarjetas con `distribution_policy_source: ISSUER`, entre
  ellas `IE00B4L5Y983` y `IE00B3YCGJ38`, con la ausencia de la política ya `NOT_APPLICABLE`. Los 2.363 documentos con
  contenido del plan están explicados: 763 `securities_count`, 800 calidad y 800 tarjeta porque la cobertura cuenta el
  campo nuevo (763 presente, 37 `NOT_PROVIDED`), 0 métricas, 0 series, 0 borrados. Lo de la app con las huellas de la
  quinta subida. **Visto bueno de la directora para que Óscar apruebe**, en este orden: publica la web desde
  `4-base-nueva`, y la sesión comprueba el `index.html` servido antes de abrir la puerta del catálogo. Hallazgo de la sesión
  anotado como incidencia (`3873e11`): el re-mapeo sin red pierde FIRDS en 27 fichas; contenido, no subió. Abiertas de la
  53: las tres páginas que Óscar tiene que leer en navegador.
- **08-11 23:52 · Code:** séptima subida hecha, solo catálogo, aprobada por Óscar en la ventana («Publicada, sube»), con la web
  de `7402894` ya servida (`index.html` igual byte a byte al compilado). 48.716 documentos, 0 borrados, de 23:35 a 23:49. Comparación
  completa posterior con claves ordenadas: 48.716 iguales, 0 distintos, 0 solo local, 0 solo nube. Los 3 «distintos» y la salida 1
  del postverify del script son orden de claves. Carteras 18, objetivos 220, retrocesiones 376 + 4 y clientes con la misma huella
  antes y después, sin ediciones nuevas. Leído en la nube: 32 `issuer_data`, 488 `issuer_nav`, 26 `premium_discount` (25 publicados);
  en los 20 de la 56, 20 aptos con la tarjeta anotada y 0 avisos; `IE00B4L5Y983` `COMPARAR_RENTABILIDAD` apta. Nube, local y web a
  la par. Sin comprobar: la ficha publicada abierta con sesión. Para Óscar: las tres páginas de condiciones sin leer de la 53, y que
  Modo cliente enseña las cifras del emisor en pantalla (los PDF no). Sin `git push`.
- **08-11 23:55 · Dirección:** **séptima subida comprobada por la directora en la nube**, solo lectura: 1.316 instrumentos,
  11.868 `declared`, 1.278 `computed`, 29.028 `price_series`, 488 `issuer_nav`; 32 `issuer_data`, 26
  `premium_discount`, 763 carteras con `securities_count`, 20 tarjetas con `distribution_policy_source: ISSUER`;
  `IE00B4L5Y983` con bloque del emisor y `COMPARAR_RENTABILIDAD` apta. Lo de la app intacto: carteras 18, objetivos 220,
  retrocesiones 376 + 4, clientes 0, y la última escritura de cada colección sigue siendo del 03-11. Web publicada por
  Óscar y comprobada por la directora antes de la aprobación (`43b5f668d399e2a8`, igual que el compilado). Nube, local y
  web a la par con `6600196`, `0f9fd61` y `7402894`. Sin comprobar: la ficha publicada abierta con sesión, que es de Óscar.
  Sesión archivada. Quedan de Óscar las tres páginas de condiciones (DWS, SPDR europea, aviso de Amundi) y, abierta, la
  incidencia del re-mapeo sin red.
- **09-11 00:15 · Dirección:** `AGENTS.md` al día con lo que gobierna tras siete subidas (bloque del emisor, decisiones 52,
  53 y 56). Del orden de pasos de la decisión 3 del 07-11 quedan hechos identidad, índice B y C, y el paso 3 del emisor;
  del A queda la segunda tanda; de ETF, Óscar deja 32 hasta que diga. **Dos encargos listos para elegir, sin arrancar:**
  (1) **Medir el re-mapeo sin red** (incidencia del 08-11): qué 27 fichas pierden FIRDS y qué campos, si la caché de FIRDS
  debe cubrirlos o si `--sin-red` debe negarse a remapear lo que depende de FIRDS; solo lectura y medición, Opus 5.5
  medio, informe. (2) **Paso 4, EMT y EET**: medición primero, no construcción: qué EMT (mercado objetivo MiFID: tipo de
  cliente, conocimiento, horizonte, tolerancia a pérdidas, costes ex ante) y qué EET (ESG) publica cada uno de los seis
  emisores y para cuántos de los 32, qué campos sirven para el perfil y el horizonte de las carteras modelo, y qué
  pregunta profesional responde cada campo; Opus 5.5 medio, solo lectura, informe con la propuesta de contrato para que
  Óscar decida. La directora recomienda la (1) primero: es corta y cierra un riesgo de `refrescar.mjs`.
- **09-11 02:35 · Dirección:** Óscar elige el re-mapeo y arranca «Medir el re-mapeo sin red que pierde FIRDS». Modelo
  Opus 5.5, esfuerzo medio, **comprobados en los metadatos** (`claude-opus-5-5`, `medium`). Solo medición: reproducir
  sobre copia con el canónico intacto (hash antes y después), fichas y campos que se pierden, causa en el código, opciones
  con recomendación, y si `refrescar.mjs` corre alguna pasada sin red. Entrega `INFORME_REMAPEO_SIN_RED_2026-11-09.md`
  en la raíz; sin cambios de código ni commits en el extractor.
- **09-11 02:45 · Dirección:** Óscar cierra la decisión 53: las tres páginas de condiciones sin verificar (DWS, SPDR europea,
  aviso de Amundi) no se leen y dejan de ser pendientes; uso interno para el desarrollo, tal como está.
- **09-11 02:40 · Dirección:** Óscar pide arrancar todo lo que pueda ir a la vez sin comprometer el resto. Con la medición del
  re-mapeo leyendo el extractor, arrancan dos más que no lo tocan, ambas **comprobadas en metadatos**: «Paso 4, EMT y EET:
  medición» (Opus 5.5, medio): pregunta profesional, cobertura por emisor y plantilla sobre descargas reales, campos útiles
  con su distribución en los 32, propuesta de contrato y de ficha; solo lectura, informe `INFORME_EMT_EET_2026-11-09.md`.
  Y «Pruebas de la app sin depender del día ni de la carga» (Sonnet 5.5, medio): reloj inyectable en `demoBackend.ts`
  con las pruebas fijadas, y la causa de los 3 fallos por tiempo de `marcoCicloDeCartera.test.tsx` bajo carga; solo
  `3-BDB-ACTIVOS_app`. Territorios separados: extractor (lectura), raíz (informe) y app. Nada en la nube.

- **Code, 09-11-2026 02:46** — «Pruebas sin depender del día ni de la carga» hecha en `3-BDB-ACTIVOS_app` (`ff7ba23`, sin push): reloj inyectable en `demoBackend.ts` fijado en la configuración de Vitest (probado en sábado y domingo); `marcoCicloDeCartera`: la causa era la precarga de la cartera activa (`backtest_portfolio` real a 127.0.0.1:5005, 401 y `AbortError` al desmontar, síntoma) más un tope de espera de 1,5 s; ahora la precarga se simula y la espera por condición topa a 15 s. `npm test` 4.292 en verde dos veces seguidas y una tercera junto a otra `vitest run`; typecheck, lint y build en verde.

- **Code, 09-11-2026 02:53** — Paso 4, EMT y EET, medido y propuesto, sin construir (`INFORME_EMT_EET_2026-11-09.md`). De los 32 con bloque del emisor, **EMT en 23** (iShares 14, Vanguard 7, Invesco 2, en fichero único y sin aceptar nada) y **EET en 2** (Invesco); Amundi y SPDR sin EMT público localizado y DWS tras una puerta de aceptación, que no se pasó. En los 23 el mercado objetivo casi no distingue (minorista, conocimiento y capital en riesgo iguales en los 23): aporta el **periodo mínimo recomendado**, igual al KID en 8 de 8 y que rellena 15, y que hoy no tiene campo en la base. SRI igual en 23 de 23. El coste de operación del proveedor no cuadra con el EMT en 20 de 23, y el EMT redondeado es el del KID en 8 de 8. Las carteras modelo no guardan perfil ni horizonte: sin eso no hay cruce. Propuesta: `declared/target_market` mínimo, EET aplazado, avisos informativos; cinco decisiones de Óscar en el §6. Sin cambios de código, sin escribir en base ni en nube; descargas en la carpeta de notas.

- **Code, 09-11-2026 02:57** — Medición del re-mapeo sin red hecha (`INFORME_REMAPEO_SIN_RED_2026-11-09.md`). **La incidencia estaba al revés:** en copia aislada, `update --all --sin-red --sin-caducidad --sin-historico` sobre 1.316 instrumentos no quita FIRDS a ninguna ficha (0 pérdidas en los diez campos) y **27 fondos lo ganan**; la cifra de 27 es la buena, la dirección no. FIRDS se lee de `cache/firds/firds.sqlite`, no de la red, y `refrescar.mjs` no corre ninguna pasada sin red. El riesgo real es otro: sin el índice, o si un ISIN sale de él, se pierde en silencio (probado en copia, 3 de 3; hoy afecta a 0 fichas y a 805 potenciales si falta el índice). Lo no neutro sí existe por otras causas: +198 acciones con `dato_retenido` y 8 fondos ALTO→BAJO por `vl_antiguo` al avanzar la fecha de la pasada. Canónico real intacto (`c088fa9b…`) y `git status` del extractor limpio. Sin comprobar: por qué la nota del 08-11 decía «pierde» (lo más probable, leída invertida) y qué hace `baseNueva:write` con una `identidad_firds` que deja de llegar. Recomendación: corregir la incidencia y añadir la parada de `update` sin índice (opción B); decide Óscar. Sin push.
- **09-11 03:10 · Dirección:** las tres sesiones de la noche, revisadas. **Re-mapeo** (`d3848d2`): la incidencia estaba al
  revés; ninguna ficha pierde FIRDS y 27 fondos lo ganan; FIRDS se lee del índice local y `--sin-red` no lo toca;
  `refrescar.mjs` no corre sin red. Riesgo real comprobado en copia: sin índice, la ficha se escribe sin identidad y sin aviso.
  Comprobado por la directora: canónico con el mismo hash (`c088fa9b…c94c5`) y extractor limpio en `6600196`. Incidencia
  reescrita con la dirección correcta; las líneas del 08-11 que dicen «pierde FIRDS» quedan como historia. **EMT y EET**
  (`3ba7670`): EMT en 23 de 32 (iShares 14, Vanguard 7, Invesco 2; Amundi y SPDR sin localizar, DWS con puerta), EET en 2;
  lo que aporta es el horizonte mínimo (23 de 23, igual al KID en 8 de 8, rellena 15); hallazgo: el coste de operación del
  proveedor no cuadra con el emisor en 20 de 23 y el emisor cuadra con el KID; las carteras modelo no guardan perfil ni
  horizonte. **Pruebas de la app** (`ff7ba23`): reloj inyectable en `demoBackend.ts` fijado en Vitest, ciclo de cartera sin
  red; repetido por la directora: 4.292 en verde y 5 omitidas, sin fallos bajo carga. Decisiones 57 a 62 propuestas a
  Óscar en página publicada. Tres sesiones archivadas. Nada en la nube.
- **09-11 05:05 · Dirección:** Óscar aprueba las seis decisiones de la página (57 a 62) desde el móvil: «Apruebo todas tus
  recomendaciones». Escritas en `DECISIONES_DATOS_2026-11-07.md` tal como estaban recomendadas: guarda del índice FIRDS
  (57 B, la C para cuando se toque la retención), `declared/target_market` mínimo y sin EET (58 A), perfil y horizonte en las
  carteras modelo con la escala de años por nivel abierta y suya (59), el coste de operación del emisor sustituye al del
  proveedor en los 15 sin KID tras medir por qué difiere (60), la puerta de DWS aplazada (61) y el orden guarda → EMT de
  extremo a extremo → carteras (62). La sesión de la guarda (Opus 5.5, medio, solo `1-extractor`) **no arranca bajo Remote
  Control**: el encargo completo queda en la carpeta de notas de Dirección (`encargo-guarda-firds-09-11-2026.md`) y
  arranca cuando Óscar lo diga desde el PC. Lo que puede ir a la vez sin tocar el extractor es el contrato
  `declared/target_market` en la plataforma (58), con encargo también preparado. Nada en la nube.
- **09-11 05:20 · Dirección:** Óscar: «Todito lo que puedas hacer en paralelo hazlo». Con Remote Control la app no arranca
  sesiones, así que lo paralelo corre como **subagentes dentro de Dirección**, uno por territorio, con modelo y esfuerzo
  fijados en los parámetros de la llamada (no comprobables con `get_session`, porque no son sesiones; se dice tal cual):
  **guarda FIRDS** (Opus 5.5, medio; escribe `main.py` y `tests/` de `1-extractor`), **contrato e ingesta de
  `declared/target_market`** (Opus 5.5, alto; solo `2-plataforma-datos`, con la forma del bloque `mercado_objetivo` fijada
  por Dirección en el encargo para que extractor y plataforma coincidan) y **medición del coste de operación** para la 60
  (Opus 5.5, medio; solo lectura, informe `INFORME_COSTE_OPERACION_2026-11-09.md`). El **lector EMT** del extractor espera a
  que la guarda confirme, porque comparte repositorio (encargo listo: `encargo-lector-emt-09-11-2026.md` en la carpeta de
  notas). La 59 (carteras) espera a que la 58 esté en la base, como dice la 62. Nada en la nube.
- **09-11 05:45 · Dirección:** la **guarda FIRDS** (decisión 57 B) hecha en `1-extractor` (`d3b2234`, sin push) por el
  subagente Opus 5.5 medio y **repetida por Dirección**: `pytest -q` 1.240 en verde (1.236 + 4 nuevas de
  `tests/test_guarda_firds.py`), canónico con el mismo hash (`c088fa9b…c94c5`), árbol limpio. `cmd_update` lee
  `meta.firds_visto` de las fichas pedidas sin tocarlas; sin `cache/firds/firds.sqlite` y con alguna que lo lleve, termina
  con 1 sin escribir nada y nombra `python main.py firds`; `--sin-firds` sigue con aviso; con índice, un aviso por ficha que
  tenía identidad y el índice ya no trae; nada en `merge`, `retencion`, adaptadores ni `settings.json`. Hueco que el agente
  señaló y Dirección decide cerrar en el mismo encargo: un índice presente pero ilegible o sin `completo` (a medio construir)
  hoy no para ni avisa, y vaciaría igual las fichas; se trata como índice ausente. La línea `Co-Authored-By` de los commits
  es la que fija el arnés de esta sesión (Fable 5.1); el modelo que trabajó cada pieza consta aquí.
- **09-11 06:00 · Dirección:** la guarda FIRDS queda cerrada del todo con `ca3dcb0` (extractor, sin push): un índice presente
  pero ilegible o sin `completo` vale lo mismo que ninguno y `update` se para nombrando `python main.py firds --force`;
  `pytest -q` 1.242 en verde (6 de `test_guarda_firds.py`, repetidas por Dirección), canónico con el mismo hash. Con el
  extractor libre arranca el **lector EMT** (subagente Opus 5.5, alto; encargo `encargo-lector-emt-09-11-2026.md`): un
  adaptador, una descarga por emisor y pasada, bloque `mercado_objetivo` con la forma fijada, `03050` fuera, sin EET, sin
  DWS, sin `update --all` y sin regenerar el canónico. Siguen en paralelo el contrato de la plataforma, la medición del
  coste de operación y el perfil y horizonte de las carteras en la app.
- **09-11 06:20 · Dirección:** la **medición del coste de operación** (subagente Opus 5.5 medio, solo lectura) da la vuelta a la
  decisión 60: el proveedor no se equivoca, **falla nuestra lectura**. Morningstar entrega `TransactionFeeEstimated` (ex ante) y
  `TransactionFeeActual` (ex post), y `fetchers/morningstar_lt.py::_mapea_mifid` toma primero la *Actual* en las cinco
  parejas de costes y la guarda como `costes.mifid_emt_exante.*`: un nombre que dice ex ante con una cifra ex post.
  **Comprobado por Dirección en el código** (línea 816-820). Medido por el agente: la cifra del proveedor es el `08070` del
  emisor (ex post) en 21 de 21; la *Estimated* es el `07130` (ex ante) en 23 de 23 a 0,05 pb; el KID es el `07130` redondeado
  en 8 de 8; las dos negativas son ex post y su ex ante es positivo. Alcance: 105 fichas publican el coste de operación y en 70
  es ex post (hasta 83 pb en fondos); el coste corriente tiene el mismo patrón en 315 de 772, aunque no llega a
  `declared/costs` de la base nueva. En los 15 sin KID el cambio va de −14,8 a +3,6 pb y solo `IE000DR59CI3` cambia de
  verdad (0,73 % → 0,58 %). Informe: `INFORME_COSTE_OPERACION_2026-11-09.md`. Recomendación de Dirección a Óscar:
  reformular la 60 como **corrección de la lectura** (*Estimated* primero en las cinco parejas, con su fecha; la *Actual* a un
  campo propio con nombre ex post, sin publicar todavía) y dejar el `07130` del EMT como comprobación con alerta a 0,5 pb, sin
  excepción a la 52 y sin cruzar la 53 con el PDF de costes. Nada construido; decide Óscar. Emulador parado y no arrancado:
  lo «publicado» se deduce del canónico con la regla del mapper.
- **09-11 06:40 · Dirección:** el **contrato e ingesta de `declared/target_market`** (decisión 58) hechos en `2-plataforma-datos`
  (`6b5d6cd`, sin push) por el subagente Opus 5.5 alto y **repetidos por Dirección**: `npm test` 1.379 en verde (1.349 + 30
  nuevas), typecheck limpio, árbol limpio. Contrato `instrument-declared-target-market.v2.schema.json` con `x-counts-when:
  NUNCA`, `x-applies-when: FONDO_O_ETF`, cinco obligatorios (`source`, `source_url`, `sha256`, `template_version`,
  `target_market_as_of`), `03050` excluido con su razón en la descripción; módulo puro `mercadoObjetivo.ts` enganchado tras
  `mapearDelEmisor` en `baseNueva:write` y en el dry-run; registrado en `BLOQUES_DE_INSTRUMENTO`; sube con el catálogo (prueba
  que lo comprueba en `subirALaNube.ts`). Dry-run de hoy: 0 bloques, porque el lector del extractor aún corre. Decisiones de
  Dirección sobre lo que el agente dejó abierto: se mantiene `source_url` (es el fichero de toda la gama, no el documento del
  instrumento; la descripción lo dice) y no hay `as_of` porque el bloque no trae fecha de descarga. Para la ficha de la app:
  añadir `target_market → declared/target_market` a `SUFIJO_DE_LA_SECCION` en `baseNuevaLectura.ts`; va con la sección «Para
  quién está pensado (según el fabricante)» cuando la app quede libre. Visto y no tocado: `runBaseNuevaBorrados.ts` no ve
  este documento (ni `issuer_data`), y 1 documento ya fallaba antes en el dry-run (`computed/metrics.annualized_return.1y` > 5),
  ajeno a esto; quedan como seguimiento.
- **09-11 07:05 · Dirección:** el **lector EMT** (decisión 58, tramo T1) hecho en `1-extractor` (`fe3a9dd`, sin push) por el
  subagente Opus 5.5 alto y **repetido por Dirección**: `pytest -q` 1.300 en verde (1.242 + 58 nuevas), canónico con el mismo
  hash (`c088fa9b…c94c5`), árbol limpio, y el bloque `mercado_objetivo` de `IE00B4L5Y983` leído de la ficha con la forma
  fijada campo a campo. Un adaptador `emt` (`fetchers/emt.py`), emisores y URL en `emt_emisores` de `settings.json`, en
  `prioridad_fuentes` detrás de los seis emisores; una descarga por emisor y pasada (`core/http`, familia `regulatorio`, 90
  días); sha256 de iShares (`95c91a2e…`) y Vanguard (`5d3981ac…`) iguales a las copias de la medición; Invesco (`416edc3b…`)
  igual a la que ya baja `invesco.py`. Prueba real sobre seis ISIN (dos por emisor) con `--sin-red --sin-caducidad
  --sin-historico` y copia previa: cero hojas perdidas, los seis con bloque (3 años solo en los dos de renta fija). El agente
  midió que `update <ISIN> --fuentes emt` no sirve como prueba porque la guarda de calidad salta al faltar Morningstar y
  justETF: bien visto. **Pendiente que Dirección propone a Óscar:** retención del bloque `mercado_objetivo` igual que la del
  bloque `emisor` (180 días), porque una pasada con `--fuentes` sin `emt` lo borraría; `05080 = 0` se guarda como
  `{anos: 0}` (no aparece hoy). Visto y no tocado: `invesco.py` baja el mismo EMT por su lado (descarga duplicada), el oro
  físico recibiría bloque aunque no entra en la base, y el aviso de BlackRock sigue sin poderse leer. **Lo que falta del EMT de
  extremo a extremo:** pasada del extractor con red sobre el catálogo (o al menos los 32), canónico nuevo, `baseNueva:write`
  en local, sección de la ficha en la app, y octava subida con aprobación delante de la puerta. La pasada espera a la
  respuesta de Óscar sobre la 60, para que el canónico nuevo salga ya con el coste de operación bien leído.
- **09-11 07:50 · Dirección:** **perfil y horizonte en las carteras modelo** (decisión 59, almacenamiento y edición, sin avisos)
  hecho en `3-BDB-ACTIVOS_app` (`1bdde78`, sin push) por el subagente Opus 5.5 alto y **repetido por Dirección**: `npm test`
  4.318 en verde y 5 omitidas (26 nuevas), `pytest` de las Functions 2.142 en verde y 5 omitidas, typecheck limpio, árbol
  limpio. Campos `risk_profile_level` (entero 1-10) y `horizon_years` (> 0) en la **raíz** de `portfolios/{id}` (no en
  `mandate`, que es texto libre en `portfolio.v2`), sin defecto y sin deducir uno del otro; se editan en Diseño › Componer
  junto al nombre y el capital, con «Sin definir» visible, y se ven en Carteras guardadas. **Las Functions cambian**
  (`save_portfolio`, `list_portfolios`, `get_portfolio`) **y las despliega Óscar**; hasta entonces la nube descarta los campos y
  la pantalla sigue marcando «sin guardar». Comprobado de extremo a extremo contra el emulador de siempre, nunca la nube.
  Batería de los seis anchos limpia en Diseño y Carteras guardadas; 12 incidencias en Buscador y Sistema por un servicio local
  sin levantar (el emulador 8092), ajenas al cambio. El commit lleva `Co-Authored-By: Claude Opus 5.5`, que es el modelo que
  trabajó. Se hizo antes de que la 58 esté en la base, por la orden de Óscar de paralelizar todo: el almacenamiento no depende
  de ella; los avisos sí, y esperan. **Tres decisiones de producto para Óscar**, con la recomendación de Dirección: (a) que el
  nivel guardado arrastre el «Perfil elegido (informativo)» de Comprobar al abrir la cartera (recomendado: sí); (b) la escala
  de años por nivel (suya); (c) que «Guardar como…» y «Guardar como propuesta» hereden perfil y horizonte (recomendado: sí).
  Visto y no tocado: `almacen_base_nueva.save` sustituye el documento entero; ya pasaba. Arrancan ahora, en paralelo y en
  repositorios libres: la **sección «Para quién está pensado (según el fabricante)» en la ficha** (Opus 5.5 alto, solo app) y los
  **dos campos en `portfolio.v2`** de la plataforma (Opus 5.5 medio, solo contrato y validación, nada que escriba carteras).
- **09-11 08:05 · Dirección:** los **dos campos de la cartera modelo en `portfolio.v2`** (decisión 59) hechos en
  `2-plataforma-datos` (`00c33eb`, sin push) por el subagente Opus 5.5 medio y **repetidos por Dirección**: `npm test` 1.386 en
  verde (1.379 + 7), typecheck limpio, árbol limpio. `risk_profile_level` entero 1-10 y `horizon_years` > 0 con tope 100,
  opcionales, `x-owner app`, `x-applies-to kind MODEL`, `x-absence NOT_PROVIDED`, como `notional_capital`. Importa para la
  octava subida: `subirALaNube.ts` valida las carteras del emulador antes de subir y con el contrato viejo una cartera con estos
  campos la habría bloqueado; ahora pasa. Visto y no tocado: `clients/{id}.profile` lleva su propio `risk_profile` (5 textos) y
  `horizon_years` (tope 60), otra escala sin tabla de traducción (decisión de Óscar si se unifican); el contrato no prohíbe
  estos campos en una cartera REAL, como `notional_capital`, porque la decisión 17 sigue sin construir.
- **09-11 08:30 · Dirección:** Óscar pregunta por la escala de años por nivel y acepta la recomendación de Dirección: **sin escala
  por defecto** (anotado bajo la 59). La tabla que se le enseñó como alternativa, por bandas de texto de los diez niveles —muy
  corto 1 año (nivel 1), corto 2 (2), corto/medio 3 (3), medio 4 (4 y 5), medio/largo 5 (6), largo 7 (7 y 8), muy largo 10 (9 y
  10)—, no se construye; consta aquí por si se quisiera como sugerencia visible que no se guarda. Nada que cambiar en la app: la
  59 ya guarda ausente como ausente. Siguen abiertas para Óscar la 60 reformulada (corregir la lectura del coste de operación) y
  las dos de producto de las carteras (arrastrar el perfil informativo; heredar en «Guardar como…»).
- **09-11 08:45 · Dirección:** Óscar acepta las recomendaciones pendientes: la **60 reformulada** (corregir la lectura del coste:
  estimada primero en las cinco parejas, real a `costes.mifid_ex_post.*` sin publicar, `07130` como comprobación a 0,5 pb), la
  retención de `mercado_objetivo` a 180 días (58, por coherencia con el bloque `emisor`) y las dos de producto de la 59 (arrastrar
  el perfil informativo; heredar en «Guardar como…»). Escritas en `DECISIONES_DATOS_2026-11-07.md`. Arranca en el extractor,
  libre, el subagente de la **corrección del coste y la retención** (Opus 5.5, alto): es una cifra publicada en 70 fichas, así
  que mide antes y después sobre copia y no toca el canónico. Las dos de producto esperan a que la ficha termine en la app.
- **09-11 09:40 · Dirección:** dos piezas más hechas y **repetidas por Dirección**. **Costes MiFID y retención** (decisiones 60 y
  58) en `1-extractor` (`178e888`, sin push; subagente Opus 5.5 alto): `pytest -q` 1.316 en verde (1.300 + 16), canónico real
  intacto (`c088fa9b…`), exportador con `NO_PUBLICADO = ("costes.mifid_ex_post",)` y sus entradas de procedencia. En las cinco
  parejas manda la estimada sin caer a la real; la real va a `costes.mifid_ex_post.*`; una estimada negativa queda ausente con
  aviso, una real negativa se conserva en el ex post (criterio del agente, aceptado por Dirección: un coste ex post puede ser
  negativo). Medido por el agente sobre copia de 1.323 fichas: cambia `transaccion_pct` en 638 fichas (mediana 4,0 pb, máximo
  197 pb) y `corrientes_pct` en 316 (315 de 772 en caché, como decía el informe); de las 105 que la base publica cambian **71**
  (55 fondos, 16 ETF), una más que el informe; las 5 negativas pasan a positivas o cero; la cifra nueva coincide con el `07130`
  del emisor en **24 de 24** a 0,05 pb. La alerta a 0,5 pb está construida (`emt.comprueba_coste_operacion`, desde
  `nucleo.adquiere`, sin tocar el bloque) y no saltaría hoy. Retención de `mercado_objetivo` a 180 días desde la descarga, con un
  ajuste: un bloque de texto con el periodo en letra ya no se da por vacío. Visto y no tocado: `incidentales_pct` (coste de
  rendimiento) cambia en 112 fichas hasta 672 pb y 7 lo pierden porque solo traen la real (lo leen la base vieja y el informe del
  extractor); `comision_distribucion_pct` tiene el mismo problema pero `limpieza.py` la borra; `EntryCost`/`ExitCost` nunca llegan
  de Morningstar; `tests/test_ops_token.py` falla desde PowerShell por la codificación de stderr (desde Bash pasa, y Dirección lo
  repitió desde Bash). **Ficha «Para quién está pensado (según el fabricante)»** (decisión 58) en `3-BDB-ACTIVOS_app`
  (`b4a4c4e`, sin push; subagente Opus 5.5 alto): `npm test` 4.365 en verde y 5 omitidas (4.318 + 47), typecheck limpio.
  Adaptador puro `fichaDelMercadoObjetivo.ts`, `target_market → declared/target_market` en `baseNuevaLectura.ts`, sección tras el
  indicador regulatorio; horizonte mínimo destacado con su fuente; códigos V/S/M/L/H en texto sin años inventados; aviso solo con
  NO en minorista o básico; NEUTRAL «el fabricante no se pronuncia»; sin documento no hay sección; una prueba vigila que nada de
  `src/reports/` lea el mercado objetivo. Estado poblado comprobado por interceptación de red sobre `IE00B4L5Y983` en los seis
  anchos (18 de 18 sin incidencias). **Decisión del agente que Dirección confirma:** la sección **no sale en Modo cliente** (53:
  uso interno; Vanguard marca su EMT como solo profesionales). **Para Óscar:** las secciones del emisor que ya existen («Lo que
  dice el emisor», «Valor liquidativo del emisor») sí salen hoy en Modo cliente; Dirección recomienda ocultarlas también por la
  53. **Para la plataforma, después de la pasada:** `declared/regulatory` v2 no tiene `recommended_holding_years` y es cerrado,
  así que el horizonte del KID (`riesgo.kid_periodo_mantenimiento_anos`, 11 de 33) no llega a la ficha y la fuente será siempre
  el fabricante; hay que llevarlo al contrato. El emulador 8092 quedó arrancado por el agente de la ficha. Arrancan ahora: la
  **pasada local del refresco** sin `--sube` (Opus 5.5 medio; encargo `encargo-pasada-local-emt-09-11-2026.md`) y las **dos
  mejoras de producto de las carteras** (Opus 5.5 medio, solo app).
- **09-11 10:05 · Dirección:** las **dos mejoras de producto de la 59** hechas en `3-BDB-ACTIVOS_app` (`06a86bb`, sin push;
  subagente Opus 5.5 medio) y **repetidas por Dirección**: `npm test` 4.376 en verde y 5 omitidas (4.365 + 11), typecheck
  limpio, árbol limpio. Abrir o cargar una cartera con nivel pone `RISK_<n>` en el perfil elegido de la sesión, también desde
  Carteras guardadas; cambiar el nivel lo mueve; elegir otro perfil en Comprobar no toca la cartera (asimetría comentada en
  `useCicloDeCartera.tsx`). «Guardar como…» ya heredaba y ahora está probado; «Guardar como propuesta» no heredaba y ahora
  hereda perfil y horizonte tal como estén, también ausentes, y en modo demo. **Desviación del agente que Dirección acepta:**
  una cartera sin nivel llega sin perfil elegido (decisión 14: al cambiar de cartera el perfil elegido se olvida), en vez de
  conservar el anterior como decía el encargo; arrastrar el anterior haría que una cartera nueva o importada heredase el perfil
  del cliente anterior. Functions sin cambios; nada visible nuevo, batería no corrida. Visto y no tocado: en demo el id de
  cartera sale del milisegundo; al recargar la página el perfil elegido arranca vacío por la 14. La app queda en `06a86bb`
  con tres commits de hoy sin desplegar (`1bdde78`, `b4a4c4e`, `06a86bb`) más las Functions de `1bdde78`. La pasada local
  sigue corriendo.
- **09-11 10:20 · Dirección:** Óscar: «Sí, ocultar». En Modo cliente no sale nada del emisor (anotado bajo la 53). Arranca en la
  app, libre en `06a86bb`, el subagente que oculta las dos secciones del emisor (Opus 5.5, medio): solo `modoCliente.ts` y
  pruebas; sin tocar el emulador 8092, donde sigue corriendo la pasada local.
- **09-11 10:45 · Dirección:** **Modo cliente sin nada del emisor** (decisión 53) hecho en `3-BDB-ACTIVOS_app` (`7c4476a`, sin
  push; subagente Opus 5.5 medio) y **repetido por Dirección**: `npm test` 4.380 en verde y 5 omitidas (4.376 + 4), typecheck
  limpio, árbol limpio. Entrada `datosDelEmisor` en `SE_OCULTA` y una sola comprobación en `componerFicha.ts`. Se ocultan «Valor
  liquidativo del emisor» (con la prima o descuento), «Lo que dice el emisor» y dos filas que venían del bloque sin ser sección:
  la **comisión de swap** dentro de Coste y la política de reparto que rellena el emisor en el Perfil (vuelve a «Falta el dato»).
  Se queda la aptitud de reparto de la cabecera (56). **Dos consecuencias que el agente señala y Dirección lleva a Óscar:** (1) en
  Modo cliente el cliente deja de ver un coste que sí paga, la comisión de swap, que en Invesco S&P 500 (0,0718 %) supera al
  coste corriente (0,05 %); va con «nada del emisor» y con las condiciones de uso que motivaron la 53, pero es un coste; (2) la
  cabecera puede dar la aptitud de reparto por buena mientras la fila del Perfil dice «Falta el dato»: coherente con la regla,
  contradictorio a la vista. Recomendación de Dirección: la fila del Perfil enseña la política también en Modo cliente, sin nombrar
  la fuente (la 56 la hizo aptitud del instrumento y la fuente ya se oculta por `fuenteDeDatos`); la comisión de swap sigue
  oculta salvo que Óscar decida otra cosa, y entonces habría que revisar las condiciones de uso del emisor para ese dato.
- **09-11 07:42 · Dirección:** la **pasada local del refresco** (sin `--sube`; subagente Opus 5.5 medio, de 06:12 a 07:33 más
  auditoría y guardado) acabó **casi entera y no limpia**, y Dirección repitió lo que decide: nada en la nube. Dos paradas. (1)
  **FIRDS no corrió**: `main.py firds --sin-deltas` descargó los tres FULINS del 07-11 y falló dos veces al reemplazar
  `cache/firds/firds.sqlite` (`PermissionError` WinError 5). Causa, comprobada por Dirección en el código: en `construye`, la
  línea 494 hace `meta(abre(indice), "completo")` y nunca cierra esa conexión; Windows no deja reemplazar un fichero abierto.
  Es defecto nuestro, no de ESMA; la identidad FIRDS de esta pasada sale del índice del 31-10 con deltas hasta el 06-11, y en
  `cache/firds/` queda un `firds.tmp` de 141 MB. Arranca ahora en el extractor, libre en `178e888`, el subagente que lo arregla
  (Opus 5.5 medio): cerrar la conexión, prueba que falle sin el arreglo, pytest entero y `main.py firds` con el completo del
  07-11. (2) La pasada siguió con `--sin-firds` y **paró en «Base local: series»** con **1 sobrante**:
  `instruments/IE00B6R52259/price_series/2011`. Medido por el agente: EODHD ha recortado la serie de IUSQ.XETRA (iShares MSCI ACWI),
  que empezaba el 21-10-2011 y ahora empieza el 02-04-2012; el documento de 2011 (50 puntos) se queda colgando y deja un hueco de
  enero a marzo de 2012. Ya estaba así en el volcado del 08-11. El escritor no borra nada por diseño (`borradosAprobados.ts`: solo
  lo que nombra `BORRADOS_APROBADOS`, ruta a ruta, con decisión), así que las series se escribieron (29.203, 0 ausentes, 0
  distintas) pero la orden salió con error y **no corrieron las tres comprobaciones del final** (pérdidas, cierres mezclados, quién
  entra en el cálculo); `entran_por_igualar.json` no se actualizó. Pérdidas medidas a mano por el agente: `instruments` 1.316 y
  `price_series` 29.028 iguales; `computed` 1.278 → 1.279. **Lo que sí entró y Dirección comprobó:** canónico `f0a599e1…` (antes
  `c088fa9b…`) con **91** fichas con `mercado_objetivo` —los 24 esperados (23 ETF + el oro) más 66 fondos activos de iShares,
  BlackRock, Invesco y Vanguard y 1 ETF—, 27 fondos que ganan identidad FIRDS y ninguno la pierde, `transaccion_pct` cambia en 629
  y `corrientes_pct` en 310, `mifid_ex_post` ausente del canónico. Las 67 de más son por diseño: el lector aplica el EMT a todo
  ISIN del fichero del emisor y el contrato admite fondo o ETF; la cifra «23 de los 32» de la descripción del contrato se queda
  vieja. Las **7 fichas que pierden `incidentales_pct`** las explicó Dirección sobre la caché: Morningstar solo trae
  `PerformanceFeeActual` (ES0114633003: 0,755 % **con fecha de 2016**; FR0013367265: 0,0), nunca la estimada, y por la 60 la cifra
  publicada es la ex ante; la real queda en `mifid_ex_post` sin publicar. Correcto, no un fallo. Calidad: ALTO/BAJO/MEDIO
  1.262/31/18 → 1.263/30/18, 7 fichas se mueven y todas por `vl_antiguo`, ninguna por EMT ni costes (`x-counts-when: NUNCA`
  cumplido). Base local: `declared/target_market` **90** (el oro no entra: es OTHER), 90 tarjetas con `target_market` en
  `available_sections`, `transaction_costs` cambia en 66, auditoría 49.426 documentos y 0 fallos (el de `annualized_return.1y > 5`
  ya no aparece), `guardar.mjs` «Export complete». Los cuatro repositorios limpios; `export/`, `export_bdb/` y `reports/`
  ignorados, sin commit de datos. **Para Óscar, tres decisiones antes de la octava subida:** (a) publicar el mercado objetivo
  de los 66 fondos activos (recomendación: sí, es el mismo documento del fabricante y la ficha ya lo oculta en Modo cliente;
  corregir la descripción del contrato); (b) el documento de 2011 que sobra (recomendación: borrarlo por `BORRADOS_APROBADOS`
  con su decisión, en local y en la nube en la subida, porque una serie con un hueco de tres meses es peor que una más corta y
  ninguna cifra publicada llega a 2011; alternativa: conservarlo y vivir con el hueco); (c) la comisión de swap en Modo cliente,
  pendiente desde las 10:45. Después del arreglo de FIRDS y de la (b) hay que **repetir la pasada entera**: la de hoy no vale
  para subir.
- **09-11 07:47 · Dirección:** **defecto de FIRDS arreglado** en `1-extractor` (`f9e73ab`, sin push; subagente Opus 5.5 medio) y
  **repetido por Dirección**: `pytest -q` desde Bash 1.317 en verde (1.316 + 1), commit acotado a `fetchers/esma_firds.py` y
  `tests/test_esma_firds.py`, árbol limpio, `cache/` ignorada. En `construye` el completo vigente se lee antes del `if` con
  `contextlib.closing`; el agente revisó el resto del módulo y las demás conexiones ya cerraban. La prueba nueva reconstruye con
  un completo de otra fecha y el agente comprobó que sin el arreglo falla con el mismo `PermissionError` de la pasada. Índice
  reconstruido con `python main.py firds`: completo **2026-11-07** (tres FULINS: 500.000 + 246.423 + 159.175 registros), deltas
  del 08-11 (4.442 guardados) y del 09-11 (144), ninguno con anulados; **210.897 instrumentos y 907.041 pares
  instrumento-centro**; `meta.ultimo_delta = 2026-11-09`; `firds.tmp` ya no existe. Dirección leyó `meta` y los recuentos
  directamente del sqlite. Sin comparar con el índice del 31-10. El extractor queda libre en `f9e73ab`. Óscar no ha respondido
  aún a las tres decisiones de la página (https://claude.ai/artifact/MADLLGXBzfC7ZseyZ7zZNp); la pasada entera espera a la (b).
- **09-11 08:06 · Dirección:** Óscar: «Sí, las tres». Escritas como **decisiones B-63, B-64 y B-65** en `DECISIONES_DATOS_2026-11-07.md`
  (`96cd1aa`): el mercado objetivo se publica para todo instrumento con EMT, fondos activos incluidos, y la descripción del
  contrato se corrige; el documento `instruments/IE00B6R52259/price_series/2011` se borra por `BORRADOS_APROBADOS` con la B-64,
  en local ahora y en la nube en la subida; la comisión de swap sigue oculta en Modo cliente y la fila del Perfil enseña la
  política de reparto sin fuente. Arrancan dos subagentes en repositorios distintos: **plataforma** (Opus 5.5 alto; libre en
  `00c33eb`): descripción del contrato (B-63), entrada en `BORRADOS_APROBADOS` y `baseNueva:borrar` en el emulador con la puerta
  local, autorizado por Dirección solo para esa ruta, y `guardar.mjs`; y `recommended_holding_years` del KID en
  `declared/regulatory` v2 con mapper, pruebas y plan en seco medido, sin escribir; **app** (Opus 5.5 medio; libre en `7c4476a`):
  la fila del Perfil enseña la política en Modo cliente sin fuente (B-65). Después de la plataforma, la **pasada entera** del refresco
  con FIRDS y sin `--sube`.
- **09-11 08:14 · Dirección:** **decisión B-65 hecha en la app** (`24899fd`, sin push; subagente Opus 5.5 medio) y **repetida por
  Dirección**: `npm test` 4.382 en verde y 5 omitidas (4.380 + 2), `tsc -b` limpio, commit acotado a `componerFicha.ts`,
  `modoCliente.ts` y `tests/fichaDelEmisorModoCliente.test.tsx`, árbol limpio. En Modo cliente la fila «Política de reparto» sale
  con «Acumulación» o «Reparto» y sin la glosa «Del emisor (…)»; fuera del Modo cliente, igual que antes con su fuente; la comisión
  de swap, el valor liquidativo del emisor y «Lo que dice el emisor» siguen ocultos. El agente comprobó que la prueba nueva falla
  sin el cambio. Sin batería de anchos: nada nuevo de diseño. **Visto por el agente y no tocado:** la cabecera de la sección Perfil
  dice «Del folleto» también cuando la política la rellenó el emisor, dentro y fuera del Modo cliente, desde la 55; procedencia
  imprecisa para esa fila, sin nombrar a nadie. Dirección lo deja anotado para Óscar como mejora menor, no como error. La app queda
  en `24899fd` con cinco commits de hoy sin desplegar (`1bdde78`, `b4a4c4e`, `06a86bb`, `7c4476a`, `24899fd`) más las Functions de
  `1bdde78`. La plataforma sigue trabajando.
- **09-11 08:25 · Dirección:** **plataforma hecha en tres commits** (`be01d5a`, `8f00b86`, `3a3c333`, sin push; subagente Opus 5.5
  alto) y **repetida por Dirección**: `npm test` 1.391 en verde (1.386 + 5), typecheck limpio, árbol limpio, commits acotados.
  (B-63) La descripción de `target_market` lleva la cifra medida (91 fichas, 90 documentos: 66 FUND y 24 ETF; 46 del fichero de
  iShares, 45 de ellos fondos BlackRock, 22 de Invesco, 7 de Vanguard) y dice que vale para todo fondo o ETF con EMT. (B-64)
  `instruments/IE00B6R52259/price_series/2011` en `BORRADOS_APROBADOS` (92 rutas) sin `instrumento_retirado`; plan en seco con un
  solo `SE BORRARIA`; ejecutado con la puerta local; Dirección comprobó en el emulador: 2011 responde 404 y 2012 sigue (empieza
  el 02-04-2012); plan de series 0 sobrantes; «Export complete». La nube conserva el documento hasta la subida, que lo borrará
  por la misma lista. `baseNueva:batch` no se corrió tras el borrado: lo hace la pasada entera. (Horizonte del KID)
  `declared/regulatory` v2 gana `recommended_holding_years` (opcional, >0 y ≤100 años, `NOT_PROVIDED`), leído de
  `export_bdb/{ISIN}.json` → `regulatory.kid.recommended_holding_years`; en seco **629 de 801** documentos lo ganan (621 fondos,
  6 ETF, 2 monetarios; 5 años en 398, 3 en 119, 4 en 39, 1 en 20, 2 en 19, 7 en 21, 6 en 11, 9 y 10 en 1), 68 de los 90 con
  mercado objetivo lo reciben y coincide con el EMT en los 68; ningún fallo nuevo en seco. **Criterio del agente que Dirección
  acepta:** solo se escribe con la evidencia completa del KID (documento, huella y fecha), como el SRI, porque la app lo rotula
  «Del KID de <fecha>»; deja fuera 15 fichas con plazo pero sin evidencia completa (644 → 629). Visto: el agente imprimió en su
  terminal dos claves de `.env.local` (EODHD y OpenFIGI) al leerlo; no han salido de ahí y no están en ningún fichero.
  Dirección corrigió la habilidad `pipeline-extractor` (`e6332c5`: la lista tiene 92 rutas, decía 86). **Aviso de numeración:**
  «decisión 63 de Óscar» ya existía con fecha 05-11-2026 en la plataforma (reparto neto, `peso_de_clase`) y «106» y «109» en la
  misma serie; la serie de `DECISIONES_DATOS_2026-11-07.md` llega hoy a 65 con otros números iguales. No son el mismo documento:
  toda cita de una decisión lleva su fecha. Arranca la **pasada entera** del refresco con FIRDS y sin `--sube` (Opus 5.5 medio;
  encargo `encargo-pasada-entera-09-11-2026.md` en la carpeta de notas): esperado 91/90 mercado objetivo, 629 horizontes del KID,
  0 sobrantes, las tres comprobaciones finales corridas.
- **09-11 08:56 · Dirección:** Óscar: «adelantando algo», «paralelo». Con la pasada entera corriendo, el extractor y la plataforma no
  se tocan (sus pasos siguientes ejecutan ese código); arrancan tres piezas en lo que está libre. En la app, dos subagentes a la
  vez sobre ficheros disjuntos: **avisos R1 a R4 del mercado objetivo en el constructor de carteras** (Opus 5.5 alto; R1 solo con
  años numéricos, los códigos de banda no disparan; R4 una sola nota de cartera en el nivel 1; R5 no se construye; oculto en Modo
  cliente y nunca en `src/reports/`; si el camino de datos exige tocar el contrato de lectura o las Functions, no lo hace y lo
  dice), y **procedencia de la sección Perfil** (Opus 5.5 medio; criterio de Dirección: fuera de Modo cliente «Del folleto y del
  emisor», dentro «Documentación del instrumento», solo cuando la fila de política viene del emisor). En la raíz, un agente de
  solo lectura (Sonnet 5.5 medio) inventaría las series de decisiones con números repetidos y propone cómo desambiguar.
- **09-11 09:02 · Dirección:** **procedencia del Perfil** hecha en la app (`916982d`, sin push; subagente Opus 5.5 medio) y **repetida
  por Dirección**: `npm test` 4.387 en verde y 5 omitidas (4.382 + 5), `tsc -b` limpio, commit acotado a `componerFicha.ts` y
  `tests/fichaDelEmisorModoCliente.test.tsx`. Solo folleto: «Del folleto · fecha»; política del emisor fuera de Modo cliente: «Del
  folleto y del emisor · fecha del folleto» con la glosa en la fila; en Modo cliente: «Documentación del instrumento · fecha del
  folleto», sin «emisor» ni «fabricante» en el HTML. Sin `declared/profile` la sección no sale aunque el emisor traiga la política
  (ya era así; fijado por prueba). **Visto por el agente:** la sección «Distribuciones» (~línea 1441) reutiliza la misma fila con
  cabecera «Registros de reparto del proveedor» y tiene el mismo problema; Dirección se lo devuelve al mismo agente con el mismo
  criterio. **Inventario de las series de decisiones** (agente de solo lectura, Sonnet 5.5 medio): hay **cuatro series numeradas
  de noviembre**, no dos: (A) `3-BDB-ACTIVOS_app/docs/rediseno-2026-11/DECISIONES_AUDITORIA_2026-11-04.md`, 122 decisiones del 04
  al 06-11 —ahí viven la «63 del 05-11» (tolerancia de un punto en el reparto, línea 618), la 106 y la 109—; (B)
  `DECISIONES_DATOS_2026-11-07.md`, **1 a 65** (no 23 a 65; la 60 figura dos veces, original y reformulada); (C)
  `DECISIONES_BASE_NUEVA_2026-11-01.md`, 1 a 24, que se cita como §N; (D) `DECISIONES_ADQUISICION_2026-10-30.md`, D1 a D8; más las
  olas de rediseño de septiembre con prefijo. A, B y C se solapan en 1–24, A y B en 25–65. Citas medidas: 1.638, de las que 279
  llevan fecha y **911 son ambiguas** (sin fecha y con número ≤ 65; 608 en la app, 105 en la raíz, 97 en el extractor, 72 en la
  plataforma). Colisión dentro de un mismo repositorio: la «65» de B (swap) y la «65» de A (textos del informe de costes) conviven
  en la app (`fichaDelEmisorModoCliente.test.tsx` frente a `costsPdf.test.ts` y `portfolioCosts.ts`). Propuesta del agente que
  Dirección hace suya y lleva a Óscar: prefijo de serie en toda cita nueva (A-63 / D-63 / B-17) con un índice de series en la raíz,
  y reescritura acotada de las ~58 citas de 63, 64 y 65, las únicas donde dos series conviven en el mismo repositorio; no reescribir
  las 911. Esperando el informe de los avisos R1–R4 y el de la pasada entera.
- **09-11 09:05 · Dirección:** **procedencia de Rentas** hecha en la app (`9e8dee5`, sin push; mismo subagente Opus 5.5 medio):
  commit acotado a `componerFicha.ts` y `tests/fichaDelEmisorModoCliente.test.tsx`, las 15 pruebas de ese fichero en verde
  repetidas por Dirección. La sección se llama «Rentas» (`id: "rentas"`, sale con `declared/distributions`), no «Distribuciones».
  Política del proveedor: «Registros de reparto del proveedor · fecha», como antes; del emisor fuera de Modo cliente: «Registros de
  reparto del proveedor y política del emisor · fecha»; en Modo cliente: «Registros de reparto y documentación del instrumento ·
  fecha». La regla «es del emisor» se calcula una vez (`politicaDelEmisor`) para Perfil y Rentas. La batería entera del
  repositorio (4.416 según el agente) corrió sobre el árbol a medias del agente de los avisos, que ya tiene dos commits
  (`498a25e` lógica pura, `ddfd82c` cableado) y la presentación sin commit; Dirección la repetirá entera cuando ese agente termine.
- **09-11 09:21 · Dirección:** **avisos R1 a R4** hechos en la app en tres commits (`498a25e` lógica, `ddfd82c` cableado, `8b9d9a0`
  presentación; sin push; subagente Opus 5.5 alto) y **repetidos por Dirección**: `npm test` 4.421 en verde y 5 omitidas (4.387 +
  37 del agente, tras las 4 de Rentas), `tsc -b` limpio, árbol limpio, commits acotados a sus ficheros. Camino de datos alcanzable
  sin tocar contratos ni Functions: `asset_id` de la posición → `instruments/{id}/read/card` y, si la tarjeta los anuncia,
  `declared/target_market` y `declared/regulatory`, por `leerDocumento` de `baseNuevaLectura.ts`. Lógica pura en
  `src/core/avisosDelMercadoObjetivo.ts` compartida con la ficha (caducidad, mercado objetivo negativo, horizonte KID primero);
  panel «La cartera frente al mercado objetivo del fabricante» en Comprobar tras «Perfil elegido (informativo)», montado con
  `Panel`, una fila por posición con su peso, R4 una sola vez con el nombre «Preservación» de `nombreDelNivel(1)`, pie con las
  posiciones sin datos, sin leer o con el horizonte en banda. Oculto en Modo cliente (`avisosDelMercadoObjetivo` en `SE_OCULTA`,
  sin lecturas) y prueba que vigila `src/reports/`. Batería en los seis anchos con las cuatro condiciones a cero, con el 8092
  interceptado y documentos simulados (168 peticiones, ninguna al emulador); `npm run build` dentro del presupuesto. **No
  comprobado:** lectura contra datos reales del 8092, el camino del SDK en producción, y que `asset_id` coincida siempre con el id
  de la base (lo hace como el comparador y la ficha). **Decisión para Óscar que Dirección recomienda aceptar:** que R1 salte
  también con el horizonte del KID solo, sin EMT (el KID es documento regulatorio público y lo traen 629 instrumentos frente a 90
  con EMT; cambio pequeño en `avisosDelMercadoObjetivo.ts` y el adaptador, y el título del panel debería dejar de decir «del
  fabricante»). La app queda en `8b9d9a0` con nueve commits de hoy sin desplegar.
- **09-11 09:23 · Dirección:** **pasada entera del refresco** hecha (08:23–09:12, 49 min, salida 0; subagente Opus 5.5 medio; encargo
  `encargo-pasada-entera-09-11-2026.md`) y **repetida por Dirección en lo que decide**: canónico **`782e2c72…`** (antes
  `f0a599e1…`), 91 fichas con `mercado_objetivo`, 0 con `mifid_ex_post`, 644 con años del KID en la ficha; en la base local
  `declared/target_market` 90, `recommended_holding_years` en 629 de 801 `declared/regulatory` (distribución igual a la del plan en
  seco), instrumentos 16.968, tarjetas 2.635, series 29.203 con **0 sobrantes** y 0 series que no cuadran, las **tres
  comprobaciones finales corridas** (sin pérdidas: 1.316 / 1.279 / 29.027; sin cierres mezclados; nadie entra ni sale del cálculo;
  `entran_por_igualar.json` del 09-11), auditoría «valida entera», «Export complete». Calidad idéntica antes y después
  (1.263/30/18, 5 sin nota). `IE00B6R52259`: series desde 2012-04-02, métricas iguales, `quality.coverage` 0,5124 → 0,5103 por el
  denominador del esquema (campo nuevo de `regulatory` que este ISIN no tiene), no por el borrado. Mismas 1.316 fichas y 48.293
  documentos. **FIRDS, medido por Dirección sobre los ficheros y el registro de ESMA:** las 832 fichas con FIRDS pasan a
  `firds_visto` 2026-11-07 sin ganar ni perder identidad; cambia `nombre_oficial_firds` en 67 y `mercados_ue` en 7. (1) **Los
  centros.** El fichero completo FULINS_E, tanto el del 31-10 como el del 07-11, lista **22** centros para Standard Chartered
  (GB0004082847), todos de la UE; el índice anterior tenía 60 porque los deltas del 01 al 06-11 añadieron 38 centros, en su mayoría
  británicos (XLON, BATE, CHIX, TRQX, AQXE), y el registro público de ESMA enseña hoy 66 MIC con 360 registros, todos republicados
  el 08-11. El campo se llama `mercados_ue` y el completo semanal trae lo que su nombre dice; el recuento depende de cómo se
  construye el índice, no del instrumento. Cinco acciones británicas bajan (60→22, 54→16, 63→23, 56→17, 29→20) y dos suben una. En la
  base esto es `listings` del instrumento, que la app no lee; pero `_valid_from` del vínculo con el emisor (`core/emisores.py`)
  toma la primera negociación más antigua y **cambia en 3 acciones** (GB0031638363 2003-10-31 → 2009-12-11; GB00B63H8491
  2008-05-27 → 2011-05-23; GB00B8C3BL03 2008-05-27 → 2013-06-10): la fecha nueva sigue probando que el ISIN existía, pero desde un
  centro de la UE y más tarde. (2) **El nombre.** `aplica` hace `INSERT OR REPLACE` del instrumento por cada registro, así que
  `nombre_oficial_firds` es el del **último centro leído**: 62 cambian solo de forma (ALCON/REGSH CHF0.04 → ALCON AG, pero
  Philips → «KONE PHIL EUR0.20»). Defecto del extractor, de orden de lectura; el nombre **no llega a la base** (el mapper solo lleva
  CFI, LEI y `listings`), así que no afecta a la subida. Recomendaciones de Dirección para Óscar: aceptar el completo como verdad de
  `mercados_ue` y las 3 fechas, anotándolas; después de la subida, arreglar en el extractor la regla del nombre (determinista: el
  centro del país de la autoridad competente, o el más repetido) y hacer que la reconstrucción semanal registre los centros que
  deja de listar por ISIN. Arranca ahora el **plan en seco de la octava subida**, solo lectura de la nube.
- **09-11 09:37 · Dirección:** la línea anterior se escribió a las 09:23 y **acabó por error en el repositorio de la plataforma**
  (`7c2dc74`, un `COORDINACION_SESIONES.md` nuevo en su raíz): el `cd` de la orden no surtió efecto. Lo vio el agente del plan en
  seco. Revertido en la plataforma (`a5d69c1`) y la línea traída aquí tal cual. **Corrección a esa línea:** el cambio de
  `_valid_from` en las 3 acciones británicas **no llega a la base**: `instrument_issuer/GB0031638363_EQUITY_ISSUER` sigue con
  `valid_from` 2003-10-31 en la nube y en local (comprobado por el agente del plan); solo cambia `listings`. **Plan en seco de la
  octava subida** (solo catálogo; subagente Opus 5.5 medio; `npm run nube:plan -- --parte catalogo`, salida 0): 48.807
  documentos, 0 sin contrato, 0 inválidos; frente a la nube **92 nuevos** (90 `target_market`, `ES0126542036/declared/fixed_income`,
  `LU1295551144/computed/metrics`), 39.615 iguales, 2.818 solo sello, 6.282 con contenido (regulatory 630, quote 756, metrics 732,
  price_series 820 de los que 752 son de 2026, card 1.034, quality 800); **1 borrado**, `instruments/IE00B6R52259/price_series/2011`
  (B-64), y 91 «ya no está» de Honeywell, Prysmian y DE0008404005; la nube no tiene nada más de sobra. Foto de lo de la app idéntica a
  la de después de la séptima (portfolios 18, targets 220, commercial_retro 376, imports 4, última edición 03-11); con `--parte
  catalogo` el plan lee 0 carteras y 0 retrocesiones. **Tres cosas inesperadas que Dirección investiga antes de pedir la
  aprobación:** (1) la cotización de tres ETF pasa de USD a EUR (`US78462F1030` SPY 735,29 → 658,70; `US46090E1038` QQQ 685,28 →
  588,04; `IE000DR59CI3` 9,765 → 7,97) con la serie y la negociación aún en USD; SPY y QQQ cuadran con EUR/USD 1,1165 y el tercero
  se desvía un 1,7 %; (2) series históricas revisadas en 8 instrumentos y 68 documentos: `ES0137998A12` toda la historia 2003–2025
  rescalada en torno a un 0,6 % y su rentabilidad a 1 año pasa de −6,5 % a −5,9 %; reajustes antiguos en `US0527691069`
  (1985–2000), `US7433151039` (1984–91) y SPY (1993–95); `IE00B4L5Y983` empieza el 2009-09-25 en vez del 2009-10-20 con 9 años de
  fechas cambiadas y métricas iguales; `CH1430134226/2025` un 0,007 % más alto; (3) `LU1295551144` gana métricas propias
  (`EXTRACTOR_MONTHLY_V2`) en vez de las del proveedor y pierde `relative` (`KID_DECLARES_NO_BENCHMARK`); dos instrumentos ganan
  `metrics_absence: SERIES_STOPPED`. La orden de escritura, no ejecutada, es `npm run nube:subir -- --parte catalogo --escribe` con
  la puerta delante. Ficheros del plan en el scratchpad de Dirección (`octava/`).
- **09-11 10:04 · Dirección:** **la octava subida se para antes de pedir aprobación.** El agente de solo lectura (Opus 5.5 alto) rastreó
  las tres cosas inesperadas y Dirección comprobó la primera en el código y la caché. (1) **Un valor liquidativo publicado como
  precio de mercado.** `fetchers/justetf.py` (líneas 54–63) pide la cotización con `currency=EUR`, escribe como divisa la que
  pide e ignora `quoteTradingVenue`; hoy justETF devuelve `"quoteTradingVenue":"NAV"` con fecha 06-11 para los ETF de fuera de
  Europa y, en domingo, para 16 más, y la regla de frescura de `core/schema.py` (fecha más reciente; a igual fecha, prioridad, donde
  `justetf` va antes que `eodhd`) le dio la victoria al empatar en fecha. Resultado en el canónico `782e2c72…`: **22 de 32 ETF**
  llevan un VL de justETF convertido a EUR como `valoracion.vl`, antes 0; en 3 (SPY, QQQ, `IE000DR59CI3`) la divisa no coincide con
  la serie ni la negociación; la base lo publica como `MARKET_PRICE` (`bloqueDeCotizacion`, mapper 580–598). Aritmética: VL del
  emisor ÷ EUR/USD del BCE del día = cifra de justETF (IE00B4L5Y983: 140,99 / 1,1165 = 126,28 cuando EUNL.XETRA cerró a 127,315);
  la «desviación del 1,7 %» del tercero es la prima de mercado que la cifra oculta. No es código nuevo (`justetf.py` sin tocar desde
  el 17-10): es el proveedor más el desempate. **Cifra incorrecta; no se sube.** (2) **Series revisadas: el proveedor.** Los cierres
  sin ajustar de EODHD son idénticos; cambia `adjusted_close`. `ES0137998A12` (Libertas 7, LIB.MC): EODHD mete un reparto con fecha
  ex 2026-11-04 (factor 0,9933 ≈ 0,02 €/acción) y escala toda la historia, y borra 9 sesiones de 2026, entre ellas el 30-09; la
  rentabilidad a 1 año −6,5 % → −5,9 % se reproduce (0,93477 / 0,9933 − 1). `IE00B4L5Y983`: EODHD añade 72 fechas, 69 históricas
  desde el 25-09-2009 (su primer día según el VL del emisor), 65 con volumen 0 y 66 planas, una el 25-12-2015 con XETRA cerrado:
  relleno que `limpieza.py` deja pasar; los «9 años con fechas cambiadas» son el diff por posición. ADSK, PGR, SPY: factores de
  ajuste antiguos recalculados; AMRZ +0,007 %. Sin intervención nuestra. (3) **Series paradas: uno sale y otro entra**, total 17.
  `LU1295551144` vuelve a tener serie hasta el 06-11 → métricas propias V2 y sin relativas por la decisión 20 (su KID no declara
  índice); `LU0171283459` (BlackRock Global Allocation A2) entra con último dato del 27-10, retraso del proveedor. **Dos matices
  para Óscar:** `instruments/LU0171283459/computed/metrics` (V2, a 30-09) sigue en local y en la nube junto al sello
  `metrics_absence`, porque el escritor no borra: es la decisión 17 sin construir; y en `LU1295551144` las propias coinciden con
  Morningstar a 1 año y YTD pero no a 3 (15,49 % frente a 14,77 %) ni a 5 (5,63 % frente a 7,41 %), reproducibles desde la serie de
  EODHD y sin explicar la diferencia. **Arrancan dos arreglos** antes de repetir el plan: extractor (Opus 5.5 alto): justETF no
  escribe `valoracion.vl` cuando el venue es NAV y escribe la divisa declarada; a igual fecha en un ETF gana la plaza de la serie;
  medición sobre copia sin red (22 → 0); plataforma (Opus 5.5 medio): `bloqueDeCotizacion` no escribe `declared/quote` si la
  divisa del precio no es la de la negociación o la serie (3 esperados; los 14 USD-en-XETRA legítimos no caen). Después, pasada sin
  red, plan en seco y aprobación.
- **09-11 10:10 · Dirección:** **guarda de divisa en la cotización** hecha en la plataforma (`3d0e85a`, sin push; subagente Opus 5.5
  medio) y **repetida por Dirección**: `npm test` 1.398 en verde (1.391 + 7), typecheck limpio, árbol limpio, commit acotado a
  `mapper.ts` y dos ficheros de pruebas, sin `COORDINACION_SESIONES.md` en su raíz. `bloqueDeCotizacion` compara
  `valoracion.vl_divisa` con la divisa de la serie (`riesgo.historial_precios.divisa_origen`, estricta, todos los tipos) y con
  `negociacion.divisa` (solo ETF y acciones), nunca con `divisa_base`; si contradice, no escribe `declared/quote`, deja aviso con
  ISIN, divisas y fuente del precio (`meta.procedencia['valoracion.vl']`) y una ausencia `NOT_PROVIDED` con ese texto. **Trampa que
  el encargo no preveía y el agente resolvió:** las 47 acciones de Londres traen el precio en GBX y la negociación en GBP; frente a la
  negociación GBX y GBP son la misma moneda, frente a la serie no (error de escala de 100). Medido en memoria sobre el canónico
  `782e2c72…`: `declared/quote` 1.310 → 1.307, caen exactamente SPY, QQQ e `IE000DR59CI3`; los 13 ETF de clase USD cotizados en EUR
  siguen (el «14.º» es el ETC `IE00B4ND3602`, sin cotización antes ni ahora); ninguna acción cae. **Para Óscar:** `declared/quote.source`
  vale `canonical:fondosdb` en todos los documentos y no dice la fuente real del precio (738 `vl_eodhd:eod`, 510 `eodhd`, 31
  `morningstar_lt:sal_quote`, 30 `justetf`…); llevarla cambiaría 1.307 documentos en la próxima subida y es decisión suya, no un arreglo
  de rebote. El extractor sigue trabajando en justETF y el desempate.
- **09-11 10:21 · Dirección:** **arreglo de justETF** hecho en el extractor (`02fab32`, sin push; subagente Opus 5.5 alto) y **repetido
  por Dirección**: `pytest -q` 1.331 en verde (1.317 + 14), árbol limpio, canónico real intacto (`782e2c72…`), commit acotado a
  `justetf.py`, `core/schema.py`, `registro.py`, `nucleo.py` y tres pruebas. **Corrección a la cifra:** eran **30 de 32** ETF con
  precio de justETF, no 22: 22 con venue NAV y 8 con plaza real (7 XETRA, 1 LSE); antes de la pasada de hoy, 0 con NAV. justETF solo
  escribe `valoracion.vl`, `vl_fecha` y `vl_divisa` con plaza real; con NAV, INAV o sin campo no escribe; la plaza queda en
  `meta.adquisicion.fuentes.justetf.endpoints["justetf:quote"]`. **La respuesta de justETF no declara divisa** (ocho claves, ninguna
  de moneda): con plaza real se sigue escribiendo la pedida, que es la de la cifra porque justETF convierte (LSE de IE00B3YCGJ38:
  13,39 «EUR», al nivel de P500.XETRA). Fusión: `desempate_frescura` en `core/schema.py` y `DESEMPATE_FRESCURA = {"etf":
  ("eodhd",)}` en `registro.py`; a igual fecha gana la plaza de la serie, una fecha más reciente sigue ganando; `prioridad_fuentes`
  no se mueve porque `justetf` está desde el 11-06 y EODHD entró el 22-06 detrás de toda la lista, y adelantarlo cambiaría nombre,
  divisa base, cartera y métricas de los ETF. Medido sobre copia sin red (4,36 GB, control con HEAD reproduce el canónico real): precio
  de justETF **30 → 0**, divisa contradictoria **3 → 0**, los 32 con el cierre de EODHD del 06-11 de la plaza de su serie, SPY 735,29
  USD, QQQ 656,10 USD, `IE000DR59CI3` 9,052 USD; solo cambian las 32 fichas ETF. **Sin determinar:** si justETF da NAV solo en fin de
  semana o antes de abrir XETRA (las 32 respuestas se bajaron el lunes 05:30–06:30 UTC). **Decisión para Óscar, con recomendación del
  agente que Dirección comparte:** con plaza real fuera del euro (LSE), justETF da un precio convertido a EUR con un cambio que no
  conocemos; hoy solo ganaría si fuese más reciente que EODHD y la guarda de la plataforma lo paran si contradice la negociación;
  dejarlo así, frente a una tabla de plazas que no existe. Arranca la **pasada sin red** sobre los datos reales (extractor
  `02fab32`, plataforma `3d0e85a`) y después el plan en seco de la octava.
- **09-11 10:58 · Dirección:** **pasada sin red, base local reescrita y plan en seco de la octava** (subagente Opus 5.5 medio) y
  **repetido por Dirección**: canónico **`182481b2…`**; frente a la copia previa cambian **exactamente 32 fichas, todas ETF, solo en
  `valoracion` y `meta`**; precio de justETF en ETF 0, divisa contradictoria 0; SPY 735,29 USD, QQQ 656,10 USD, `IE000DR59CI3`
  9,052 USD, todos del 06-11; en el emulador `US78462F1030/declared/quote` = 735,29 USD `MARKET_PRICE` 06-11; auditoría «valida
  entera» con 1.310 `declared/quote`; volcado de `4-base-nueva/datos/` de las 10:47 («Export complete», con el assert conocido de
  libuv al cerrar). Escrituras locales: 16.968 / 2.635 / 29.203 con 0 ausentes, distintos o inválidos; `cambios` ejecutado con el
  cliente HTTP forzado a no salir y `export_fx`/`export_rf` idénticos byte a byte. **Lo que el agente hizo de más y Dirección da por
  bueno:** el re-mapeo sin red de todo el catálogo **no fue neutro** en acciones (`rf_pct` 2,0696 → 2,0711 con la misma `fecha_dato` en
  504; Sharpe hasta 0,0009 en 237; 494 con la marca «retenido» sin `meta.fuentes.fundamentales`; 4 italianas con sector "" → nulo y
  calidad 91 → 82), así que, como manda la habilidad `pipeline-extractor`, devolvió las 1.291 fichas que no son ETF a su estado de la
  pasada con red y repitió calidad → export → bdb → series; guarda las dos copias (`novena/antes`, `novena/funds_remapeo`). La
  octava lleva así el catálogo de la pasada con red más los 32 precios corregidos. **Pendiente de investigar, no bloquea:** por qué un
  re-mapeo sin red mueve el tipo libre de riesgo con la misma fecha (dos lecturas del ESTR que no coinciden); hasta saberlo, los
  re-mapeos enteros no son seguros. **Sobrante que el escritor nombra:** `instruments/LU0171283459/computed/metrics` (V2 a 30-09,
  idéntico en la nube) junto al sello `metrics_absence: SERIES_STOPPED`; decisión 17 sin construir; para Óscar. Bloqueado conocido:
  `US60770K1079/computed/metrics` (Moderna, 1 año > 5). **Plan en seco** (`npm run nube:plan -- --parte catalogo`, 48.807
  documentos, 0 sin contrato, 0 inválidos, 0 avisos nuevos): 92 nuevos (90 `target_market`, `ES0126542036/declared/fixed_income`,
  `LU1295551144/computed/metrics`), 9.098 distintos (2.818 solo sello, 6.280 con contenido), 1 borrado
  (`instruments/IE00B6R52259/price_series/2011`), 91 «ya no está», 1 de más en la nube (ese mismo); carteras 18, objetivos 220,
  retrocesiones 376, importaciones 4 con huellas idénticas a las de las 08:27. Frente al plan de las 09:27 solo cambian de estado
  documentos de ETF (4 `declared/quote` igualan a la nube, 2 pasan a diferir en precio, QQQ e `IE000DR59CI3` ya solo difieren en
  fecha y precio; 8 tarjetas). **Aviso de seguridad del agente revisado por Dirección:** la única orden de escritura fue
  `baseNueva:write -- --write` con la puerta local, la autorizada; ninguna orden tocó la nube. **Lista para la aprobación de Óscar en
  esta ventana.** La orden, desde `2-plataforma-datos` y solo con la puerta delante: `npm run nube:subir -- --parte catalogo
  --escribe`.
- **09-11 12:55 · Dirección:** **octava subida del catálogo hecha**, aprobada por Óscar en esta ventana a las 12:38 («Sí, sube»)
  sobre el plan en seco de las 10:58, y ejecutada por Dirección de 12:39 a 12:52 desde `2-plataforma-datos` con la puerta solo
  delante de `npm run nube:subir -- --parte catalogo --escribe`. Antes de la orden, repetido: canónico `182481b2…`, volcado de las
  10:47, los cuatro repositorios limpios en `2aec84b` / `02fab32` / `3d0e85a` / `8b9d9a0`, emulador en pie. Escritos 48.807
  documentos en 392 tandas, **1 borrado** (`instruments/IE00B6R52259/price_series/2011`, decisión B-64), y el postverify del script
  (uno de cada siete) dio 0 ausentes, 0 que faltan y 1 «distinto» con salida 1, que es orden de claves, como los 3 de la séptima.
  **Comparación completa posterior, solo lectura, con claves ordenadas:** 48.807 iguales, 0 distintos, 0 solo local, 0 solo nube;
  32 iguales con otro orden de claves. Recuentos en la nube: 1.316 `instruments`, 11.959 `declared`, 1.279 `computed`, 29.027
  `price_series`, 912 `holdings_chunks`, 509 `instrument_issuer`, 506 `issuers`, 488 `issuer_nav`, 1.316 `quality`, 1.316 `read`.
  **Lo de la app intacto:** carteras 18, objetivos 220, retrocesiones 376 + 4 importaciones, clientes 0, con las mismas huellas
  sha256 que a las 08:27 y la última escritura de cada colección aún del 03-11. Leído en la nube después: `US78462F1030/declared/quote`
  735,29 USD a 06-11; el 2011 del ACWI no existe; `IE00B4L5Y983/declared/target_market` existe; `LU1295551144/declared/regulatory`
  lleva `recommended_holding_years: 5` con `kid_evidence`, e `IE00B4L5Y983` solo `srri`, como en local. `LU0171283459/computed/metrics`
  sigue en la nube (V2 a 30-09), a la espera de la decisión C. No se pudo contar en la nube los `recommended_holding_years` por
  falta de índice de grupo; la comparación completa lo cubre, porque `declared` es idéntico al local, donde son 629. **Nube y local
  a la par.** La web publicada sigue siendo la anterior: hasta que Óscar despliegue las Functions (`1bdde78`) y el hosting con los
  nueve commits de hoy, la nube descarta el nivel de las carteras y la ficha no enseña el mercado objetivo ni el horizonte. Sin
  `git push`. Quedan de Óscar las decisiones B, C, D y E de la página de la octava.
- **09-11 13:10 · Dirección:** Óscar resuelve las cuatro decisiones de la página de la octava con las recomendaciones («Las
  resuelvo ahora»): **B-66** R1 con el KID solo, **B-67** métricas viejas por lista nombrada, **B-68** fuente real de la cotización,
  **B-69** prefijo de series (`0244c76`). Arrancan dos subagentes Opus 5.5 en repositorios distintos: **app** (medio) para B-66 y
  **plataforma** (alto) para B-67 y B-68 con base local reescrita y plan en seco de la novena, sin nada en la nube. Dirección hace
  la B-69 en la raíz: `INDICE_DE_DECISIONES.md` (A 1–122, B 1–69, C 1–24, D 1–8, rangos medidos), entrada en `AGENTS.md` y las
  citas de 63/64/65 de `COORDINACION_SESIONES.md`, `DECISIONES_DATOS` y la habilidad `pipeline-extractor` con su prefijo
  (`94baea3`). Medidas de verdad las citas: unas 50 en la app y 16 en la plataforma, no 58; la primera cuenta con `git grep` se
  comía las «decisión» con tilde.
- **09-11 13:45 · Dirección:** **B-66 hecha en la app** (`1490e65`, subagente Opus 5.5 medio) y **repetida por Dirección**: `npm
  test` 4.429 en verde + 5 omitidas (8 pruebas nuevas); estado `solo-horizonte` en el adaptador, que lee `declared/regulatory` aunque
  la tarjeta no declare `target_market`; esas posiciones entran solo en R1, «según su KID», y no cuentan ni como sin documento ni
  como mercado objetivo comprobado; título «La cartera frente al mercado objetivo y el horizonte declarados», subtítulo con los tres
  recuentos; capturas en los seis anchos (`scratchpad/shots/B66/`, cartera de muestra nivel 3 a 3 años: 2 con EMT, 6 solo KID, 7
  avisan, el PIMCO a 3 años no), sin scroll horizontal, cabecera por `Panel`. El agente señaló un error de lint ajeno (`_perfil`
  sin uso en `tests/fichaDelEmisorModoCliente.test.tsx`, de `9e8dee5`): Dirección lo arregla en el mismo commit que **las citas de
  la app con prefijo** (`830495d`, 27 ficheros: A-63 reparto neto, A-64 «Elaborado por» y seguimiento, A-65 textos de costes;
  B-53 y B-65 en Modo cliente y el Perfil); lint limpio, 11 suites y 55 pruebas de Python en verde. Sin push; la web publicada
  sigue sin estos commits. Quedan las citas de la plataforma y `contracts_cache/asset-for-bdb` de la app, cuando la plataforma
  termine.
- **09-11 14:05 · Dirección:** **B-67 y B-68 hechas en la plataforma y en la base local** (`2ca4ad7`, `c90447c`; subagente Opus 5.5
  alto) y **repetidas por Dirección**: `npm test` 1.408 en verde (10 nuevas); en el emulador `LU0171283459/computed/metrics` da
  404 y su tarjeta ya no lista `metrics` (cobertura 0,569 → 0,455, `METRICAS_PROPIAS` no apta; la tarjeta conserva el bloque
  `metrics` del proveedor, que es lo que hace un fondo sin métricas propias); `US78462F1030/declared/quote` `source: eodhd`;
  volcado de `4-base-nueva/datos/` de las 13:38. Procedencia medida por los dos: 738 `vl_eodhd:eod`, 542 `eodhd` (510 acciones y
  32 ETF), 31 `morningstar_lt:sal_quote`, 5 sin procedencia que tampoco traen precio, así que la reserva `canonical:fondosdb` hoy
  no la usa nadie y las **1.310** cotizaciones cambian de fuente, no ~1.305. Contrato: solo la descripción de `source`, sin
  `enum` ni versión nueva (el README reserva la 2.1 para campos y la 3 para incompatibles). **Comparación completa de Dirección
  contra la nube, solo lectura** (`scratchpad/novena/comparacion-direccion.log`): 43.631 iguales, 5.793 distintos = 4.481 solo
  sello (`computed_at`, por repetir `write` y `batch`) + 1.312 con contenido (1.310 `quote` por `source`, más calidad y tarjeta de
  LU0171283459), 1 solo en la nube (las métricas a borrar), 0 solo en local; lo de la app idéntico (18 / 220 / 376 + 4, última
  escritura del 03-11). Coincide con la del agente. **Inesperado, para Óscar:** `LU0290358497` (Xtrackers II EUR Overnight Rate
  Swap, ETF monetario por swap) entra en la base como FUND porque `traducciones.ts` traduce `monetario` a FUND, así que su
  cotización dice `price_class: NAV` con `source: eodhd`, que es un cierre de XETRA (150,694 EUR, 253 sesiones); la contradicción
  ya estaba en la nube y B-68 la deja a la vista; `emisorDeEtf.ts` ya la conocía. También: el motivo de `METRICAS_PROPIAS` no
  apta es genérico y no nombra `SERIES_STOPPED`. **B-69 terminada en los tres repositorios:** plataforma `336693e` (9 ficheros:
  A-63 reparto neto en contratos, mapper y pruebas; B-63 en `target_market`; B-64 en la lista de borrados y sus pruebas, incluido
  el texto `decision` de la entrada), app `63707c7` (la copia del contrato de lectura), habilidad `pipeline-extractor` con 93
  rutas (`cd6e3d1`); tras esos commits, 1.408 y 73 pruebas de Python en verde. Ninguno de esos cambios toca un documento de la
  base, así que el plan en seco de la novena sigue valiendo. **Novena lista para la aprobación de Óscar en esta ventana**, misma
  orden que la octava, solo catálogo, solo con la puerta delante.
- **09-11 14:35 · Dirección:** **novena subida del catálogo hecha**, aprobada por Óscar en esta ventana a las 14:17 («Sí, sube»)
  y ejecutada por Dirección de 14:17 a 14:28 desde `2-plataforma-datos` con la puerta solo delante de `npm run nube:subir -- --parte
  catalogo --escribe`. Antes de la orden, repetido: canónico `182481b2…`, volcado de las 13:38, los cuatro repositorios limpios en
  `a55c305` / `02fab32` / `336693e` / `63707c7`, métricas de LU0171283459 ya ausentes en local (404). Escritos 48.806 documentos
  en 392 tandas, **1 borrado** (`instruments/LU0171283459/computed/metrics`, B-67); el postverify del script (uno de cada siete)
  dio 0 ausentes, 0 que faltan y 6 «distintos» con salida 1, que son orden de claves. **Comparación completa posterior, solo
  lectura, con claves ordenadas:** 48.806 iguales, 0 distintos, 0 solo local, 0 solo nube; 32 iguales con otro orden de claves.
  **Lo de la app intacto:** carteras 18, objetivos 220, retrocesiones 376 + 4, clientes 0, con las mismas huellas sha256 que a las
  08:27 y la última escritura del 03-11. Leído en la nube después: las métricas de LU0171283459 no existen y su tarjeta no lista
  `metrics`; `US78462F1030/declared/quote` `source: eodhd`, `LU0171283459` `morningstar_lt:sal_quote` (86,69 EUR a 30-10), `LU0290358497` `eodhd` con
  `price_class: NAV` (la contradicción que espera la decisión de Óscar). **Nube y local a la par.** La web publicada sigue siendo la
  anterior hasta que Óscar despliegue Functions y hosting con los commits de hoy de la app. Sin `git push`.
- **09-11 15:05 · Dirección:** Óscar pide **retirar entero el Xtrackers II EUR Overnight Rate Swap (`LU0290358497`)** del catálogo
  en vez de reclasificarlo (la B-70 escrita a las 14:45 queda pendiente de reescribir). Medido antes de tocar nada, solo lectura:
  56 documentos en la nube y los mismos 56 en local (raíz, 2 `computed`, 11 `declared`, 20 `issuer_nav`, 20 `price_series`,
  calidad y tarjeta), sin vínculo en `instrument_issuer`, en el fragmento 001 del buscador; ninguna cartera, objetivo ni
  retrocesión de la nube lo nombra; dos fondos DWS Kaldemorgen lo llevan en su top 10 (referencia de posición, no dependencia).
  **Lo que sí depende de él:** Rendimiento (la cartera real importada de Andbank) lo usa como **referencia monetaria «EUR overnight
  / €STR (XEON)»** y como **activo libre de riesgo** (`RISK_FREE_ASSET_ID`) en `functions_python/portfolio_real/service.py` y en
  `src/adapters/realPortfolioBackend.ts`; es el único instrumento monetario del catálogo (el canónico tiene 515 acciones, 769
  fondos y 32 ETF, ninguno de tipo `monetario`: el «6 monetarios» de `traducciones.ts` es una medición vieja). En el extractor
  vive en `config/fondos.csv` (línea 1093); `config/bajas_decididas.csv` es para instrumentos que dejaron de cotizar, no para
  retiradas decididas. La base tiene el €STR como serie propia (`reference_rates/ESTR_2019..2026`). **Parado hasta la decisión de
  Óscar**: retirarlo exige antes sacar a Rendimiento de ese ISIN (libre de riesgo y referencia monetaria desde el €STR de la
  base) y desplegar las Functions, porque la décima lo borraría de la nube que esas Functions leen.
- **09-11 15:20 · Dirección:** Óscar decide **«Retirar»** el Xtrackers con Rendimiento pasando antes al €STR de la base; la **B-70**
  queda reescrita así, en tres pasos (`69d6380`): (1) Rendimiento sustituye la referencia «EUR overnight / €STR (XEON)» y el respaldo
  del libre de riesgo por un **índice €STR capitalizado** calculado desde `reference_rates/ESTR_{año}` (base 100, tipo del día
  hábil anterior por días naturales sobre 360), sin tocar el tipo principal del Sharpe (6.3 del 17-10); (2) Óscar despliega
  Functions y hosting; (3) baja en el extractor (`core/ops.baja`), 56 rutas con `instrumento_retirado` en `BORRADOS_APROBADOS`,
  borrado local y décima subida. Arrancan dos subagentes Opus 5.5 alto: **app+Functions** para el paso 1 y **extractor+plataforma**
  (uno detrás del otro, sin red) para el paso 3 en local con plan en seco de la décima. La décima **no se sube hasta el paso 2**,
  porque las Functions leen la nube y perderían la serie antes de dejar de pedirla.
- **09-11 15:15 · Dirección:** **paso 3 de la B-70 hecho en local** (extractor `c62584a`, plataforma `98d327a`; subagente Opus 5.5
  alto, sin red y sin nube) y **repetido por Dirección**: canónico `182481b2…` → `fc84c09a…` con 1.315 líneas (sale la del ISIN;
  el agente midió el resto byte a byte en el mismo orden), `config/fondos.csv` sin el ISIN, ficha e históricos en
  `data/_papelera/` (versionados, en el commit); pytest 1.331 en verde, `npm test` de la plataforma 1.409 (una nueva), typecheck
  OK; en el emulador la raíz, la tarjeta, `price_series/2026` e `issuer_nav/2026` dan 404 y ningún `search_shards` contiene el
  ISIN; volcado de `4-base-nueva/datos/` de las 15:07. `BORRADOS_APROBADOS` pasa de 93 a **149** rutas (`RUTAS_DEL_XTRACKERS_MONETARIO`,
  56, con `instrumento_retirado`); `emisorDeEtf.ts` solo cambia el comentario, porque el adaptador lee el canónico. Escrituras
  locales: write 16.934 / 0 distintos, borrar 56 / 0 siguen, batch 2.633, auditoría 49.368 documentos con 0 inválidos (FUND 770 →
  769), Moderna como único bloqueado del write. **Comparación completa de Dirección contra la nube, solo lectura**
  (`scratchpad/decima/comparacion-direccion.log`): 42.828 iguales, 6.540 distintos = 6.538 solo sello (`computed_at` 3.404,
  `updated_at` 1.821, `package_id` 1.315: el `write` repetido resella porque `export` regenera el manifiesto) + 2 con contenido
  (fragmentos 001 y 002 del buscador: el 001 pierde el ISIN y recibe `LU1670722161` del 002), **56 solo en la nube** (los del
  Xtrackers), 0 solo en local; lo de la app idéntico (18 / 220 / 376 + 4). Coincide con la del agente. Habilidad
  `pipeline-extractor` a 149 rutas. **La décima no se sube hasta que Óscar despliegue el paso 1** (Rendimiento sobre el €STR),
  que sigue en el subagente de la app.
- **09-11 15:30 · Dirección:** **paso 1 de la B-70 hecho en la app** (`cee6393`, 19 ficheros; subagente Opus 5.5 alto) y **repetido
  por Dirección**: pytest de `functions_python` 2.157 en verde + 5 omitidas (fixtures privados de Andbank), `npm test` 4.429 + 5
  omitidas, lint y typecheck limpios. Nuevo `portfolio_real/estr_index.py`: índice €STR capitalizado, base 100 en el primer día
  hábil de la ventana (el último publicado en o antes de la primera fecha), I(d) = I(prev) × (1 + r(prev) × n/360), corta con
  huecos de más de 7 días o si la serie va más de 7 días por detrás del final; lee `reference_rates` con el lector que ya tenía la
  media de la C-20 (`_estr_guardada`, ahora en tanto por uno). Referencia `ESTR_CAPITALIZADO_BCE` («€STR capitalizado (BCE)»)
  sustituye a XEON en `BENCHMARKS`, como base del alfa y como respaldo del libre de riesgo (`ESTR_CAPITALIZED_INDEX` en vez de
  `XEON_PROXY`; el frontend nuevo sigue aceptando el viejo); el tipo principal del Sharpe no cambia (6.3). Cobertura: `kind:
  reference_rate`, `source: ECB`, con cuatro motivos de ausencia y sin pedir alta en la maestra. El agente midió que el índice
  construido desde el emulador coincide con el índice capitalizado oficial del BCE (`EST.B.EU000A2QQF08.CI`) a 5e-9 en 1.820 días;
  Dirección lo ha leído en el código y las pruebas, no repetido. **Para Óscar:** (a) antes del 01-10-2019 no hay €STR: una ventana
  anterior pierde la referencia monetaria y el alfa (XEON replicaba la EONIA); (b) el respaldo es un tipo efectivo anual y la media
  principal un simple ACT/360, unos 8 pb al 2,4 %, solo cuando falla el BCE; (c) **Functions y hosting se despliegan juntos**: el
  frontend publicado no acepta `ESTR_CAPITALIZED_INDEX`. Son 15 commits de la app tras `7402894` (de `ff7ba23` a `cee6393`). La
  **décima** (56 borrados, 2 fragmentos del buscador, 6.538 solo sello, app intacta) espera ese despliegue y la aprobación de Óscar.
- **09-11 15:55 · Dirección:** **décima subida del catálogo hecha**, aprobada por Óscar en esta ventana a las 15:37 («Desplegado,
  sube») tras desplegar él Functions y hosting, y ejecutada por Dirección de 15:38 a 15:50 desde `2-plataforma-datos` con la puerta
  solo delante de `npm run nube:subir -- --parte catalogo --escribe`. Antes de la orden, repetido: el sitio publicado es byte a byte
  el compilado de las 15:35 (`28649d0b…`, mismo `index-7BF87ZOI.js`) y ese compilado lleva `ESTR_CAPITALIZED_INDEX` en
  `RealPortfolioPage`; de las Functions solo hay señal indirecta (`contracts_cache/manifest.json` resincronizado por el script de
  despliegue, sin commit; `functions:list` no da fechas): Dirección no lo ha verificado con una fecha; canónico `fc84c09a…`,
  volcado de las 15:07, repositorios limpios en `9990826` / `c62584a` / `98d327a` / `cee6393`, Xtrackers ausente en local (404).
  Escritos 48.750 documentos en 391 tandas, **56 borrados** (todo `LU0290358497`, B-70); postverify del script 0 ausentes, 0 que
  faltan, 4 «distintos» con salida 1, orden de claves. **Comparación completa posterior, solo lectura:** 48.750 iguales, 0
  distintos, 0 solo local, 0 solo nube; 32 iguales con otro orden de claves. **Lo de la app intacto:** 18 / 220 / 376 + 4 / 0 con las
  huellas de las 08:27 y la última escritura del 03-11. Leído después: 0 documentos del Xtrackers en la nube, ningún `search_shards`
  lo contiene, ninguna cartera lo nombra. **Nube, local y web a la par** con los cuatro HEAD. Sin `git push`. **Para Óscar:** abrir
  Rendimiento y comprobar que la fila «€STR capitalizado (BCE)» sale, y si su ventana empieza antes del 01-10-2019 (pierde el
  alfa en ese tramo). Pendientes de Dirección sin bloquear: la deriva del `rf_pct` en el re-mapeo sin red, la regla del nombre
  FIRDS, el motivo genérico de `METRICAS_PROPIAS`, la traducción `monetario → FUND` que ya no usa nadie, y los zips viejos de FIRDS.
- **09-11 16:20 · Dirección:** Óscar abre Rendimiento en la web publicada: la fila **«€STR capitalizado (BCE)»** sale (el
  despliegue lleva la B-70), pero toda la pantalla está en «Falta el dato» por **«Hay activos históricos sin mapeo autoritativo»**.
  Causa, leída en el código: `portfolio_real/mapping.py` lleva una tabla fija de nombres del bróker (`_RAW_HISTORICAL_MAP`, 24
  entradas, sin cambios desde el 07-09) y los activos vendidos del extracto que no están en ella bloquean TIR, TWR, referencias y
  riesgo; independiente de la retirada del Xtrackers y del €STR. El activo es **«FONDIBAS FI»**, una suscripción de 15.000 € del
  07-04-2025; está vivo en el catálogo (`ES0138936036`, gestora Andbank, VL 14,0263 a 05-11-2026, 27 M€). Dirección añade la
  entrada confirmada con su prueba (`tests/test_historical_mapping_table.py`) y commitea de paso `contracts_cache/manifest.json`,
  que el script de despliegue de Óscar había resincronizado tras la cita A-63 de la copia del contrato: app `HEAD` nuevo, 79 pruebas
  de cartera real y 73 de contratos en verde. **Para Óscar:** volver a desplegar **solo las Functions** (el frontend no cambia) y
  recargar Rendimiento; si queda otro histórico sin identificar, el desplegable «activos históricos sin identificar» lo nombra.
- **09-11 16:50 · Dirección:** Óscar: «Vete haciendo lo tuyo sin bloquear nada, mientras en paralelo a lo que quede pendiente».
  Con la **B-71** ya en marcha en la app (subagente Opus 5.5 alto: fallback por nombre exacto único del catálogo desde
  `search_shards`, decisión `4d749d6`), arrancan tres encargos más, uno por repositorio libre: **medición de solo lectura** sobre
  la copia del extractor (Opus 5.5 alto): causa raíz de la deriva del `rf_pct` (2,0696 → 2,0711 con la misma fecha en 504
  acciones), de la marca «retenido» y del sector "" → nulo en el re-mapeo sin red, y el 3 y 5 años de `LU1295551144` frente a
  Morningstar; **extractor** (Opus 5.5 alto): nombre FIRDS por regla determinista (autoridad del país del ISIN, luego plaza más
  antigua, luego MIC) y registro de plazas perdidas al reconstruir desde el completo, más la lista de zips viejos sin borrar;
  **plataforma** (Opus 5.5 medio): motivo de `METRICAS_PROPIAS` no apta por valor de `metrics_absence`, sin escribir en el
  emulador, y diagnóstico de solo lectura del bloqueo de Moderna (`annualized_return.1y` > 5). Ninguno escribe en la nube ni en
  bases; los cambios de extractor y plataforma esperan a la próxima pasada y a la undécima subida.
- **09-11 17:05 · Dirección:** **plataforma `a450b38` verificada** (subagente Opus 5.5 medio; `npm test` 1.410, typecheck OK,
  repetidos): `aptitudes.ts` da a `METRICAS_PROPIAS` no apta un motivo por valor de `metrics_absence.code` (DISTRIBUTES y
  NO_METHOD empiezan por «no aplica», que es lo que la ficha lee; SERIES_STOPPED, NO_PRICES, SHORT_HISTORY, POLICY_UNKNOWN,
  POLICY_PENDING, NEEDS_FX, UNIDENTIFIED_SERIES con frase propia; el genérico solo sin sello). Medido en el emulador: cambian 63
  instrumentos (54 fondos/otros: 17 DISTRIBUTES, 17 SERIES_STOPPED, 14 NO_PRICES, 2+2 política, 1 NO_METHOD, 1 SHORT_HISTORY; 9
  acciones: 5 NO_PRICES y 4 SHORT_HISTORY cuyo motivo viejo «sin serie de precios» era falso). Sin fecha de la parada: el sello
  solo guarda `reason` y `code` (ampliar `metrics_absence` es decisión de Óscar). Entra en la undécima subida con su escritura
  local. **Moderna (`US60770K1079`), solo lectura:** el bloqueo es real y la cifra también: rentabilidad a 1 año **+980,95 % en
  EUR** (06-11-2025 → 06-11-2026; +944,8 % en USD, de 24,33 a 254,19 en `EODHD:MRNA.US`), salto de +177 % el 19-08-2026 y −23,5 %
  al día siguiente, `ytd_return` +762 %, volatilidad 1 año 193,7 %; capitalización 102.850 M$ coherente con el precio. **Dirección
  lo contrasta fuera de EODHD:** AP, Reuters y otros recogen el cierre de 174,38 $ el 19-08-2026 (+177 % desde 62,96) por los datos
  de fase 3 de la vacuna personalizada contra el melanoma con Keytruda de Merck. El tope ±5 (±500 %) de `computed/metrics` es un
  filtro de verosimilitud que un caso real supera y que hoy bloquea el documento entero. **Para Óscar (decisión):** que una cifra
  fuera de rango bloquee solo su ventana con el motivo a la vista, y un tope más ancho solo para STOCK; las dos cosas tocan el
  contrato. **Defecto nuevo, para Dirección:** el canónico trae para Moderna un **R² a 5 años de 2,52**, imposible (0 a 1): las
  relativas de acciones tienen un error que hay que medir en el extractor cuando el escritor de FIRDS termine.
- **09-11 17:25 · Dirección:** **medición de solo lectura terminada** (subagente Opus 5.5 alto sobre la copia del extractor; nada
  tocado) y **las cuatro afirmaciones que la sostienen comprobadas por Dirección en el código**. (1) **Deriva del `rf_pct`, causa
  raíz:** las acciones leen el €STR en `fetchers/eodhd.py::_serie_estr` con `ttl_dias=7`, y `core/export_series.py::genera_estr`
  pide la misma clave de caché con `ttl_dias=1`; la pasada con red (08:05 UTC) leyó una entrada que acababa el 05-11, el export la
  refrescó a las 08:08 con el 06-11, y el re-mapeo sin red leyó la nueva. Con el €STR cortado el 05-11 salen exactamente 2,0696 /
  2,7300 / 2,1371 y con el 06-11 2,0711 / 2,7297 / 2,1373 (`scratchpad/inv_rf/rf_trunc.txt`); cambian las 504 acciones con
  `fecha_dato` 06-11 y ninguna otra. **El valor correcto según el método es 2,0711, el del re-mapeo**, y el defecto de fondo es
  que `rf_medio_pct` no comprueba que el €STR llegue al final de la ventana. «Retenido»: sin red se salta yfinance y
  `retencion_acciones.aplica` copia el bloque vacío de la ficha anterior con etiqueta `retenido` y `meta.fuentes.fundamentales`
  nulo (494); el camino correcto es el de la pasada con red. Sector "" → nulo en 4 italianas: `set_path` escribe "" y `calidad.py`
  lo cuenta como presente (91); el re-mapeo lo deja nulo (82); **el correcto es nulo**. Tres cambios mínimos para el extractor, no
  hechos: mismo `ttl_dias=1` en `_serie_estr` más `rf_hasta` en la ficha; sin red, arrastrar bloque y procedencia originales sin
  pasar por la retención; normalizar "" a `None`. (2) **`LU1295551144`** no es de Amundi: es Capital Group New Perspective B EUR, y
  la diferencia con Morningstar es **solo la fecha de corte**: recalculado a 30-09 cuadra al cuarto decimal (3a 14,7681 vs
  14,768098; 5a 7,4146 vs 7,414607), y en general 655 de 717 fondos a 3 años y 636 de 692 a 5 años cuadran a 0,01. **Defecto de
  datos real:** el bloque de Morningstar mezcla dos fechas (1m/YTD/1a de `sal_trailingReturn` a 31-10; 3a/5a/10a del `ETFsnapshot`
  a 30-09) y `mapper.ts` (~1605) pone la del snapshot a todo `declared/provider_returns`: unos 272 de ~604 fondos llevan 1m/YTD/1a
  del 31-10 etiquetados 30-09. Para Óscar: una fecha por fuente o dos bloques. Quedan ~145 fondos cuyo 1 año de Morningstar no
  cuadra con ningún fin de mes, sin medir. (3) **El R² de Moderna no es un defecto**: `core/metricas.py:592` lo guarda en porcentaje
  (`r*r*100`, como Morningstar) y la plataforma lo divide entre 100; el 2,5217 es un 2,52 % (beta 1,03 con correlación 0,159 y
  volatilidad 104 % frente a ~16 % del S&P 500 NR vía `IE0032126645`); ningún R² fuera de [0, 100] en 960 acciones-ventana ni en
  ~8.000 de fondos. La línea de las 17:05 que lo llamaba «imposible» queda corregida por esta. **Pendiente de Dirección:** los tres
  arreglos del extractor cuando el escritor de FIRDS termine (un solo escritor por repositorio), y la decisión de las fechas de
  Morningstar para Óscar.
- **09-11 17:55 · Dirección:** **B-71 hecha en la app** (`9eba338`, 10 ficheros; subagente Opus 5.5 alto) y **repetida**: pytest
  2.190 + 5 omitidas (30 nuevas; la base eran 2.160 con las 3 de Fondibas), `npm test` 4.432 + 5 (3 nuevas), lint y typecheck
  limpios. `normalize_catalog_name` común a bróker y catálogo (NFKD, mayúsculas, «&» → AND, puntos y apóstrofos fuera, otros
  signos a espacio); tabla manual primero y después `search_shards` vía un cargador que no lanza; una coincidencia → `confirmed`
  con `catalogo:nombre-exacto`; varias → `HISTORICAL_ASSET_AMBIGUOUS_IN_CATALOG` con candidatos; índice no disponible → como antes,
  y `coverage.historical_catalog_lookup` lo dice. Hallazgo del agente: `LectorOptimizacionBaseNueva` no tenía `get_search_index`
  (añadido, delega en `LectorBaseNueva`); sin él el fallback no habría funcionado en producción. Medido en el emulador: 1.315
  nombres → 1.295 únicos, 10 colisiones con 20 instrumentos (Aena, Grifols, GESCONSULT FI, León Valores, Mutuafondo CP, Sigma
  Megatrends, UBS CP, tres BlackRock). **Problema en la tabla manual, sin tocar:** «GROUPAMA AVENIR EUROPE - NC» está mapeado a
  `FR0010288308` (Avenir Euro, francés, MSCI EMU Small Cap) desde el 09-07, y el catálogo tiene con ese nombre literal
  `LU0675297237` (Avenir Europe, luxemburgués, MSCI Europe Small Cap), alta del 13-10; Dirección lo contrasta fuera (Finect,
  abcbourse) y lo lleva a Óscar como decisión. Riesgo asumido del diseño: un nombre único en nuestro catálogo puede ser el del fondo
  y no el de la clase. Sin desplegar. **FIRDS hecho en el extractor** (`0798f9c`, Opus 5.5 alto) y **repetido**: pytest 1.345 (14
  nuevas). La regla no es la que Dirección propuso: `RlvntCmptntAuthrty` es del instrumento (ningún ISIN de 210.633 trae dos), así
  que no distingue registros; el campo que sí lo hace es `TechAttrbts/RlvntTradgVn` (el centro más relevante, presente en todos y
  entre los del propio ISIN en 210.626). **Dirección acepta la regla:** centro relevante → primera negociación más antigua (1900-01-01
  y vacío detrás) → MIC alfabético, en `elige_nombre` con docstring; tabla nueva `nombres` en el índice (~900.000 filas más), lo
  publicado no cambia. 153.178 ISIN (73 %) tienen más de un nombre; frente a «solo antigüedad» eligen distinto 16.625 (Santander
  «BANCO SANTANDER S.A.»). Registro de plazas en `data/history/firds_plazas/plazas_<nuevo>_sobre_<vigente>.csv` (isin, estado,
  mic perdidos/ganados, completos), siempre escrito, nunca pisado, con WARNING en el log; ensayo real con los zips: 3.141 ISIN
  pierden 10.669 centros (Standard Chartered 60 → 22), 977 ganan 1.739. Sin verificar sin red: que los deltas traigan
  `RlvntTradgVn`; el índice real no tiene `nombres` hasta la próxima reconstrucción (`firds --force` o el completo del sábado).
  Zips en `cache/firds/`: 25,1 MB en uso, 210,7 MB del 31-10 al 06-11 que ningún índice usa y que son lo único que rehace el
  estado anterior a la octava. **Arranca el cuarto encargo del extractor** (Opus 5.5 alto): los tres arreglos de la medición.
  **Página de decisiones de la tarde para Óscar** (A desplegar Functions, B Groupama, C tope de Moderna, D fechas de Morningstar, E
  plazas fuera de la UE, F zips).
- **09-11 18:40 · Dirección:** **los tres arreglos de la medición hechos en el extractor** (`251c0ba` €STR, `174a140` arrastre
  sin red, `9af27df` sector vacío; subagente Opus 5.5 alto, que la regla del libre de riesgo justificaba) y **repetidos**: pytest
  1.359 (14 nuevas), código leído. (1) `fetchers/estr_bce.pide` es la única petición del €STR (`TTL_DIAS = 1`) para acciones,
  fondos (`vl_fondos.estr`, que también la pedía) y export, con la misma clave de caché que antes; `core/metricas.py` añade
  `riesgo.historial_precios.rf_hasta` y, si faltan más de `RF_TOLERANCIA_DIAS_HABILES = 3` días hábiles hasta el fin de la ventana,
  `rf_incompleto` con fechas y días; el Sharpe se marca, no se suprime (§3). Compatibilidad: el esquema de acción no cierra
  propiedades y `contratos.valida` pasa; en la próxima pasada con red lo ganan 512 acciones (505 con `fecha_dato` 06-11, cifras
  esperadas 2,0711 / 2,7297 / 2,1373). (2) Sin red, `_fundamentals_yahoo` avisa `no_servido("yahoo_fundamentales")` y
  `retencion_acciones.arrastra_sin_red` copia el bloque anterior con su etiqueta, `fetched_at` y `meta.fuentes`; lo ya retenido
  sigue su retención; en el próximo re-mapeo unas 413 acciones dejan de ganar la marca. (3) `eodhd._texto` convierte `""` y
  espacios en `None` en sector, industria y descripción: solo 8 hojas de 1.322 fichas (las 4 italianas × 2) cambian. Fuera del
  encargo, anotado: el Sharpe mensual de fondos y ETF no lleva `rf_hasta`; `rf_hasta` no llega a la plataforma; `_ESTR_CACHE`
  vive en memoria del módulo. Dirección recoge `rf_hasta` y la tolerancia en la §2 del método y el re-mapeo neutro en la habilidad
  (`e3a5791`), y quita dos avisos de ruff que ya estaban en HEAD (`test_indices`, `test_metricas_relativas`). **Modelo y esfuerzo,
  recordatorio de Óscar (18:15):** ajustar cada encargo a su tipo; de los cuatro de la tarde, la medición y el motivo de las
  métricas no aptas eran de Opus medio o Sonnet, no de alto. Apuntado en la memoria de Dirección.
- **09-11 20:17 · Dirección:** **B-72, Groupama.** Óscar lee el ISIN en Andbank: la posición histórica «GROUPAMA AVENIR EUROPE - NC»
  es `LU0675297237` (Avenir Europe NC, LU, MSCI Europe Small Cap), no `FR0010288308` (Avenir Euro NC, FR, MSCI EMU Small Cap)
  al que apuntaba la tabla manual desde el 09-07. Corregida la entrada de `portfolio_real/mapping.py` con nota, dos pruebas
  nuevas en `tests/test_historical_mapping_table.py` (el nombre resuelve al luxemburgués; ninguna entrada confirmada apunta al
  francés); hecho por Dirección sin agente, cambio de una entrada. Índice de decisiones: B llega a B-72 (decía B-69 desde la
  B-69; faltaban 70 y 71). Corrección a lo dicho a Óscar: que el luxemburgués entrara en el universo «desde su extracto» era una
  deducción, no una comprobación (`d4a125b` del 13-10 trae 71 nombres en mayúsculas, no solo ese). Pendientes de él: C Moderna,
  D fechas de Morningstar, E plazas, F zips; A (desplegar Functions) en cuanto pase pytest y el commit esté hecho.
- **09-11 20:25 · Dirección:** **Óscar resuelve C, D, E y F de la página de la tarde** («widen the limit for stocks»; «el resto de
  puntos sigue tus recomendaciones»): B-73 (fuera de rango bloquea solo su ventana; acciones −100 % a +2.000 % en rentabilidad
  anualizada y YTD), B-74 (una fecha por cifra en `declared/provider_returns`; el extractor añade
  `rentabilidad.fecha_dato_por_ventana`), B-75 (FIRDS desde el completo, plazas perdidas registradas; nada que construir), B-76
  (zips viejos hasta la reconstrucción del sábado 14-11, borrado después con aviso). **Groupama comprometido en la app**
  (`cd8b81b`, pytest 2.192 + 5 omitidas, 3:54) y orden de despliegue de Functions dada a Óscar (A). **Dos encargos lanzados a la
  vez, un escritor por repositorio:** plataforma, B-73 y B-74 en los dos contratos, el mapper y sus pruebas (Opus 5.5 **alto**:
  cambia contratos); extractor, `fecha_dato_por_ventana` desde `morningstar.py` y `morningstar_lt.py` con medición sobre la caché
  (Opus 5.5 **medio**: código con pruebas, sin método ni contrato de la base). El extractor no regenera el canónico: la pasada con
  red y el re-mapeo quedan para la undécima, con la auditoría, el plan en seco y la aprobación de Óscar en ventana.
- **09-11 20:40 · Dirección:** **B-74 en el extractor, hecha y repetida** (`d1f04ef`, subagente Opus 5.5 medio): pytest 1.370 (11 nuevas),
  ruff limpio, código leído. Corrige el diagnóstico de la tarde en dos cosas: (1) en **747 de 795** fichas con cifra las ocho
  ventanas del fondo son nuestra serie (`vl_eodhd:eod`) a una sola fecha y su `fecha_dato` era correcta; las cifras de Morningstar
  con dos fechas están **desplazadas en `meta.contraste`**, que es lo que `mapper.ts` reconstruye como `declared/provider_returns`
  con una fecha: el defecto se produce en la plataforma. (2) Morningstar mezcla fechas en **437** de 795 (30-09 / 31-10), no en
  272; 206 solo a 30-09, 149 solo a 31-10, 3 a 30-11-2025 (LU1882457739, LU1883319474, LU1883342880, un año atrasadas). La fecha
  del `sal_trailingReturn` es `fundReturnDate` (el código buscaba `returnDate`/`asOfDate`/`date`, que ninguna de las 765 respuestas
  trae; comprobado en la caché de LU1295551144); la del snapshot, `TrailingPerformance[MonthEnd].Return[].Date`; el screener no da
  fecha. Construido: `pon_rentabilidad_fondo` escribe cifra y fecha juntas, `alinea_fechas_por_ventana` quita la fecha cuya cifra la
  ganó otra fuente, y `registro.CONTRASTE` lleva `rentabilidad.fecha_dato_por_ventana.*` al contraste con `{valor, fuente,
  desplazada_por}`. **Aviso enviado al encargo de la plataforma:** leer la fecha de cada ventana del contraste cuando la cifra es
  desplazada. Abierto, sin decisión: la categoría y el índice no llevan fecha propia; las 747 fichas de serie propia no llevan el
  objeto (`vl_fondos` fuera del alcance; su `fecha_dato` vale para todas). El canónico no se ha regenerado.
- **09-11 20:45 · Dirección:** **B-73 y B-74 en la plataforma, primera entrega repetida** (`ecac4e5`, `0b83cd5`; subagente Opus 5.5
  alto): npm test 1.432 de 1.433 (23 nuevas; la que falla es `backupRetention` con el PID fijo 39056, hoy un `olkexthost.exe`
  vivo: ya fallaba antes del encargo), typecheck limpio, contratos leídos. B-73: `out_of_range` con la forma del documento
  (`out_of_range.annualized_return.1y = {value, limit}`); el tipo se deduce de `inputs` con `if/then/else` (acción =
  `series_adjustment` sin `series_class` ni `distribution_policy_resolution`), acción [-1, 20] en `annualized_return` y
  `ytd_return`, fondos y ETF [-5, 5]; `apartarFueraDeRango` valida con el propio esquema, sin números copiados. Plan en memoria:
  antes 1 `computed/metrics` inválido de 1.252 (Moderna), después 0; una sola cifra apartada, el Sortino 1y de 22,44 de
  `FR0000989626` (antes se quedaba fuera sin anotar). B-74: `as_of_by_window` (`1y`, `3y`, `5y`, `10y`, `ytd`) solo cuando las
  fechas difieren; `as_of` pasa a ser la más reciente; el mapper lee la fecha del canónico o del contraste según quién ganó la
  cifra; probado con el fixture real de LU1295551144. **Faltan, y van al mismo agente:** la tarjeta (`instrument-read-card.v2`
  mantiene ±5 en `annualized_return` y la de Moderna sería inválida: bloqueante), `calidadYTarjeta.ts` fecha todo con `as_of`,
  la cifra «272 de ~604» de la descripción (son 437 de 795), y el PID de la prueba. **Después, encargo a la app:**
  `comparativaDeActivos.ts:97` y `componerFicha.ts:1151` leen un solo `as_of` del proveedor, y la ficha debe enseñar el motivo
  de una cifra apartada («con el motivo a la vista», B-73); espera a la forma final de la tarjeta. Para Óscar: la fecha es la de
  la cifra del fondo; la categoría y el índice no llevan fecha propia (en LU1295551144 la categoría de todas las ventanas viene del
  snapshot). Dirección recomienda dejarlo así y escribirlo, no otra forma de contrato.
- **09-11 20:55 · Dirección:** **B-73 y B-74 en la tarjeta, repetidas** (`c4231b9`, `f366f52`, y `b01a056` la prueba del PID; mismo
  subagente Opus 5.5 alto): npm test **1.442 de 1.442**, typecheck limpio. Tarjeta: `instrument_type` propio con `allOf` en la raíz
  (STOCK [-1, 20]; FUND y ETF [-5, 5]); `metrics.windows_out_of_range`, lista de rutas apartadas sin la cifra, por lo mismo que
  `windows_before_series_valid_from`; `metrics.provider.returns_as_of_by_window` cuando las fechas difieren y `returns_as_of` pasa a
  la más reciente. Plan en memoria de 1.315 tarjetas: antes 2 inválidas (Moderna e `IE00B18GC888`), después 1, la de
  `IE00B18GC888` por `available_sections` > 30, **que ya fallaba y no es de esto**; es aproximación (el lote real añade la fecha
  desde la que vale la serie). La prueba de retención usa ahora un PID de un hijo terminado y comprobado libre. Enviado al mismo
  agente el cierre de B-74 en los fondos cuyo titular es el proveedor (`metrics.as_of` sale del riesgo). **Para Óscar, dos cosas
  escritas en el contrato que Dirección recomienda dejar así:** si nuestra cifra se aparta y el proveedor publica esa ventana, la
  tarjeta enseña la del proveedor como suya y con su fecha (regla de la A-110); y la fecha por ventana es la de la cifra del fondo,
  no la de la categoría ni la del índice. **El encargo de la app** (`componerFicha.ts:920` y `:1151`, `comparativaDeActivos.ts:97` y
  `:382`: leer `windows_out_of_range`, `returns_as_of_by_window` y `as_of_by_window`, y enseñar «fuera de rango» donde hay hueco)
  **espera al despliegue de Óscar**: `compilar-sitio.mjs` compila el árbol de trabajo de la app y un agente editándolo a la vez
  podría colarse en lo publicado. `IE00B18GC888` queda apuntado para Dirección: medir si su tarjeta real está en la nube o no.
- **09-11 21:00 · Dirección:** **B-74 cerrada en la plataforma y repetida** (`bfe20ac`, `53f9763`; mismo subagente): npm test **1.446 de
  1.446**, typecheck limpio. `metrics.returns_as_of` y `metrics.returns_as_of_by_window` en la tarjeta para el titular del proveedor,
  con la regla de `metrics.provider`: sin el mapa, si la fecha de la rentabilidad del proveedor no es la del riesgo, sale su fecha.
  Decidido por Dirección como aplicación de la B-74 («una fecha por cifra»), no como regla nueva: un titular con la rentabilidad del
  30-09 bajo un `as_of` del 31-10 era el defecto. Medido en memoria con el canónico de hoy: **20 tarjetas de 1.315** ganan
  `returns_as_of` (todas 30-09 bajo 31-10); 445 instrumentos tienen las dos fechas distintas pero solo 54 tarjetas tienen titular
  del proveedor, y 17 ya lo llevaban en `metrics.provider`. La tarjeta «inválida» del plan en memoria (`IE00B18GC888`,
  `available_sections` > 30) **no es un defecto de la base**: la real en el emulador tiene 16 secciones y valida; era un artefacto
  del cálculo aproximado del agente. Plataforma HEAD `53f9763`, siete commits de hoy sobre `a450b38`, árbol limpio. **Página para
  Óscar:** https://claude.ai/artifact/HPWysktivUZzVMkf5bXrgh (lo construido por decisión, lo que la medición corrigió, dos cosas
  escritas en los contratos, lo que queda, las dos órdenes). Sigue pendiente su despliegue; el encargo de la app, retenido hasta
  entonces.
- **09-11 21:12 · Dirección:** **Óscar despliega Functions y hosting («hecho», 21:10).** Comprobado: el `index.html` publicado en
  `bdb-gestor-de-activos.web.app` es byte a byte el compilado de `4-base-nueva/sitio/` de las 21:08 (sha256 `3c0e64b113589a24…`,
  bundle `index-CitRyftZ.js`) y el trozo `labels-Y-jvg-6-.js` publicado lleva los rótulos de la B-71. De las Functions, como
  siempre, solo señal indirecta (el manifiesto de contratos no cambió porque no había contrato nuevo); la prueba real es abrir
  Rendimiento con el extracto y ver Groupama con el fondo luxemburgués, y eso lo hace Óscar. **Arranca el encargo de la app**
  (Opus 5.5 medio, código con pruebas y pantalla; habilidad `diseno-pantalla` con la batería de seis anchos): leer
  `windows_out_of_range`, `out_of_range`, `as_of_by_window`, `returns_as_of_by_window` y enseñar el hueco «fuera de rango» con
  el motivo a la vista (B-73), y la fecha de cada ventana del proveedor (B-74), sin tope propio que bloquee a Moderna.
- **09-11 21:15 · Dirección:** **Óscar confirma en producción («Sale bien»)**: Rendimiento con su extracto enseña Groupama como el
  fondo luxemburgués. Con eso las Functions desplegadas a las 21:10 llevan la B-71 y la B-72, y el ciclo de Groupama queda cerrado
  de punta a punta: tabla, pruebas, despliegue y comprobación del usuario.
- **09-11 21:30 · Dirección:** **B-73 y B-74 en la app, entregadas y repetidas** (`4466cee`, subagente Opus 5.5 medio): Vitest **4.451
  pasan + 5 omitidas** (19 nuevas en `tests/decisionesB73B74.test.ts`), typecheck y lint en curso al anotar esto; captura de la ficha
  a 1440 mirada por Dirección, sin regresión. Hueco de cifra apartada con la celda `FALTA_LA_VENTANA` y la frase en la nota de la
  sección (`ventanaSinMedir.fraseDeLaCifraApartada`: con valor y límite en modo interno, sin cifra en Modo cliente o con solo la
  tarjeta); fechas por ventana en la ficha (`as_of_by_window`) y en el comparador (`returns_as_of_by_window` del proveedor y del
  titular). Sin tope propio en la app: Moderna enseñaría +980,95 %. **Lo nuevo no se ve en las 12 capturas** porque ningún documento
  local trae aún esos campos: repetir la batería tras la undécima. **Tres decisiones de pantalla nuevas, de Óscar:** A-123 caja de
  estilo de nueve celdas en la ficha del fondo («Nueve celdas»), A-124 impresión de la ficha en PDF con la identidad de
  `pdfTheme.ts` desde la cabecera, imprimiendo lo que la ficha enseña en su modo, A-125 el PDF del comparador recibe las notas y
  fechas de B-73/B-74 («Sí, al PDF»). Las tres van en un solo encargo a la app (un escritor por repositorio), Opus 5.5 **alto**:
  el papel nuevo es trabajo de diseño y maqueta, y la habilidad `diseno-pantalla` gobierna la caja en pantalla.

- **09-11 22:17 · Dirección:** **A-123, A-124 y A-125 entregadas, repetidas y miradas** (subagente Opus 5.5 alto; app en `792ddf4`,
  `b2a4c24`, `53631ea`, `28fc656`, más `cf347c8` de Dirección): Vitest **4.488 pasan + 5 omitidas** (357 ficheros), lint y typecheck
  a cero, árbol limpio. **Caja de estilo** en la ficha del fondo: tabla de nueve celdas de `declared/exposure.equity_style_box`, solo
  si están las nueve y suman 1, con la mayor destacada y nombrada; batería de seis anchos sin desbordes, capturas a 1440 y 768
  miradas. **Ficha en PDF** («Descargar ficha PDF» en la cabecera): imprime el mismo modelo que pinta la pantalla en su modo; los dos
  PDF de LU1295551144 (interno 4 páginas, cliente 3) leídos página a página. Dirección corrigió el pie: decía «datos a 9 nov 2026»
  con la fecha de la tarjeta (`read/card.computed_at`), que se leía como fecha de las cifras (están a 30 sept y 31 oct); ahora «base
  de datos del». **PDF del comparador**: fecha bajo la cifra y nota de la cifra apartada sin la cifra; solo render de muestra, sin
  PDF real desde la app. **Sin desplegar**: el sitio publicado sigue en `cd8b81b`. **Defecto previo, medido por Dirección en las
  tablas de nombres y en un render**: los tres TTF de Instrument Sans llevan el mismo nombre PostScript (`InstrumentSans-Regular`)
  y los dos de Newsreader también, y el PDF incrusta una sola cara por familia: en los informes de `pdfTheme.ts` los pesos no se
  distinguen. No afecta al informe de cliente ni al comparador de carteras (Fraunces y Roboto Flex tienen nombres distintos).
  **Para Óscar:** (a) quitar del papel en Modo cliente la tira «Qué puedes hacer con él» y «Disponibilidad», que hablan al asesor;
  (b) arreglar los nombres internos de las fuentes; (c) si entra Newsreader Italic. Sin verificar: los estados B-73/B-74 con dato
  real (undécima subida).
- **09-11 22:40 · Dirección:** **A-126 decidida y construida** (Óscar: «Sí, quítalas»; arreglo directo de Dirección, app en `641be0e`):
  en Modo cliente el PDF de la ficha ya no lleva la tira «Qué puedes hacer con él» ni «Disponibilidad · Sin medir»; «Cotizando» y
  «Dejó de cotizar» se quedan en los dos papeles; la pantalla no cambia. Un solo sitio: `loQueLlevaLaCabecera` de
  `src/reports/fichaDeActivoPdf.tsx`. Vitest **4.491 pasan + 5 omitidas** (3 nuevas), lint y typecheck a cero. Los dos PDF de
  LU1295551144 regenerados desde la app local: el de cliente sigue en 3 páginas, primera hoja mirada, y el +6,33 % a 1 año que la
  tira resumía sigue en «Rentabilidad anualizada». Índice A hasta la 126. **Sin desplegar** (sitio publicado en `cd8b81b`).
  Siguen abiertas para Óscar: los nombres internos de las fuentes de `pdfTheme.ts` y si entra Newsreader Italic.
- **09-11 23:10 · Dirección:** **A-127 decidida y construida** (Óscar: «Sí, arréglalas»; arreglo directo de Dirección, app en `5f0a999`):
  las tres instancias mal nombradas de `src/assets/fonts` (media y seminegrita de Instrument Sans, seminegrita de Newsreader) llevan
  ya su nombre propio; solo cambia la tabla `name`. Lo repite `scripts/nombrarFuentesDelPapel.py` y lo vigila
  `tests/fuentesDelPapel.test.tsx` (14 pruebas; con las fuentes viejas falla). **El diagnóstico que se le dio a Óscar era
  incompleto:** no era «la seminegrita sale regular», sino que cada PDF de `pdfTheme` salía entero con el primer peso que pedía.
  Medido por contornos en los 279 PDF de esa identidad que genera la batería: 139 con todo el palo en seminegrita (comparativa de
  activos, semanal, cartera real), 70 en media (informe completo de cartera), 70 en regular (costes, ficha, propuesta), y 252 con
  anchos de varios pesos mezclados. **Antes y después sobre los 441 PDF:** mismas hojas y mismas letras hoja a hoja en los 441; los
  162 de la identidad de cliente, sin cambio de fuentes ni de tamaño; 254 de los 279 pasan a incrustar una cara por peso; anchos
  mezclados, de 252 a 0; las letras solo se mueven en horizontal (hasta 12,3 pt). **Se ve:** texto corrido en regular y énfasis solo
  donde el código lo marcaba; cuatro informes salen más ligeros y costes gana negritas. Muestras de antes y después enviadas a Óscar,
  con datos de prueba. Comentarios del remedio de las mayúsculas en la banda (decisiones 20 y 80) puestos al día: ya no hace falta,
  se queda por diseño. Vitest **4.505 pasan + 5 omitidas**, lint y `tsc -b` a cero; el typecheck de `tests/` a mano
  (`tsconfig.test.json`, fuera de `tsc -b`) da 9 errores en 4 ficheros que esto no toca, ya estaban. Índice A hasta la 127. **Sin desplegar**
  (sitio publicado en `cd8b81b`). **Para Óscar:** si la ficha en PDF usa pesos; si entra Newsreader Italic; si el sello de la banda
  vuelve a minúsculas. Visto de paso, sin mirar la causa: 162 de los 442 PDF incrustan «Helvetica», antes y después, incluidos los
  del informe de cliente y el comparador de carteras.
- **09-11 23:10 · Dirección:** la «Helvetica» de la línea anterior, medida (app en `2cb0380`): está **declarada** en 162 de los 442 PDF
  y **no dibuja ni una letra en ninguno** (tramos de texto leídos uno a uno con PyMuPDF). Es la fuente por defecto de la librería,
  la que `scripts/pdfUsedFonts.mjs` ya da por inofensiva mientras no pinte. Cerrado, sin nada que arreglar; la A-127 lo dice ya así.
- **09-11 23:32 · Dirección:** muestra de la **ficha en PDF con pesos** enviada a Óscar (él la pidió tras la A-127); **nada cambia en
  el repositorio**: la app sigue en `2cb0380`, árbol limpio, y el papel aprobado sin pesos sigue siendo el que sale. La variante son
  nueve estilos de `fichaDeActivoPdf.tsx` a los que solo se añade `fontWeight`: 600 en `bandaSello`, `titulo` y `cajaCifraMayor`;
  500 en `tipo`, `tiraRotulo`, `aptitudValor`, `th`, `cajaColumna` y `pieNombre`. Se quedan en regular, a propósito, el nombre del
  activo, las cifras de las filas y el valor liquidativo. Medido con LU1295551144 sobre la base local, interna y de cliente: mismas
  hojas (4 y 3) y mismo texto hoja a hoja; la de hoy incrusta dos caras y la muestra cinco, cada peso la suya. **Pendiente de su
  decisión.** Si dice que sí es la A-128: esas nueve líneas, la prueba de `tests/fichaDeActivoPdf.test.tsx` que hoy prohíbe
  `fontWeight` en ese fichero, y el comentario de cabecera que dice que el papel se aprobó sin pesos.
- **09-11 23:55 · Dirección:** **A-128 decidida y construida**: la ficha en PDF lleva los nueve pesos de la muestra («Sí,
  aplícalos»). App `1673202`. Pruebas 358 ficheros y 4508 (+3: los pesos, las cinco caras y el título sin guion), lint y `tsc -b`
  limpios. Ficha real de LU1295551144, ES0113900J37 e IE00B3YCGJ38, interna y de cliente, antes y después: cinco de los seis papeles
  con las mismas hojas y el mismo texto línea a línea, caras de 2 a 5. **El sexto cambia y la muestra no lo enseñó:** el interno
  del ETF lleva «Para quién está pensado (según el fabricante)», 248,5 pt en seminegrita contra 241,5 de columna; el par pasa a la
  hoja 2 y la 1 acaba 147 pt antes (líneas por hoja 94/126/76/36 → 80/109/81/63). El guion («fabri-cante») quitado con `sinPartir`
  y sujeto con prueba; el hueco se queda. **Pendiente de Óscar:** bajar los títulos de sección de 12,5 a 12 pt (medido: una línea,
  238,6 pt, y la maqueta de antes). Nada desplegado. **Corrección de la línea de la A-127:** el typecheck manual de `tests/`
  (`tsconfig.test.json`) no da «9 errores en 4 ficheros» sino **48 en 16**; la cifra anterior era la cola de la salida. Son
  anteriores (ficheros del 03, 05 y 07-11), ninguno en `src/` ni en los tres ficheros de prueba tocados hoy. Queda como pendiente
  aparte.
- **09-11 23:55 · Dirección:** Óscar pregunta si conviene **unificar los cuatro repositorios en uno**. Medido para responder, a las
  23:45: sin subir a GitHub desde el 06-11, 314 commits (raíz 189, extractor 49, plataforma 35, app 41); de los 337 commits de la
  raíz desde el 29-10, 138 son líneas de coordinación; plataforma y app tuvieron commits el mismo día en 11 de 11 días; los
  contratos se copian de la plataforma al extractor y a la app, cada copia con su comprobación; el CI heredado solo se dispara en
  `master`, y la barrera de BDB no puede exigir allí los cuatro repositorios porque solo hay uno. Opinión dada: unificar,
  conservando historia y hashes, como pieza propia y en un momento tranquilo (tras la undécima subida), no ahora. **Pendiente de
  su decisión; nada tocado.**
- **10-11 00:06 · Dirección:** **Decidido por Óscar: los cuatro repositorios pasan a ser uno, tras la undécima subida** («Sí,
  tras la subida», 10-11 00:00). **Sin hacer: no se ha tocado nada del control de versiones.** El encargo queda escrito en
  `PLAN_UNIFICAR_REPOSITORIOS_2026-11-10.md`: el repositorio de la raíz absorbe las tres carpetas donde están, conservando
  historia y hashes; las condiciones para empezar (subida cerrada, los cuatro en GitHub, árboles limpios, un bundle de cada
  uno); cada invocación de Git del código con lo que le pasa; y la lista de aceptación, con ensayo en una copia antes. Tres
  cosas medidas hoy que no estaban en la opinión de anoche: **la barrera de BDB dejaría de mirar** (decide qué repositorios
  existen por su `.git`; sin él barre cero ficheros y pasa, y la única prueba que lo delataría se salta en CI); **los fines de
  línea** se tratan distinto en cada repositorio (sistema `autocrlf=true`, app `input`, plataforma `eol=lf`, contratos del
  extractor en LF por su SHA) y en uno manda una sola configuración; y **los tres gates de la plataforma solo anotan**
  `git status` como evidencia, no bloquean, que es menos riesgo del que dije. `AGENTS.md` lo anuncia en Estructura y en la
  lista de documentos. **Sigue pendiente de Óscar:** subir los cuatro a GitHub, que es la condición 2 del plan (317 commits
  sin subir contando este), y los títulos de sección de la ficha a 12 pt.
- **10-11 00:20 · Dirección:** Óscar pide **cargar en el programa las carteras de un cliente en tres entidades** (tres carteras y
  una global) e **incorporar los activos que falten** (decisión **B-77**; ni el nombre ni los importes van a ningún repositorio:
  lo leído está en el scratchpad de la sesión). Leídos los tres extractos y cuadrados al céntimo con sus totales: 51 líneas, 47
  instrumentos distintos; 35 están en la base local (identidad contrastada con el cierre de la serie en la fecha de cada
  extracto) y **12 no** (11 acciones y 1 ETF, el 19,6 % de lo invertido). El extracto de la tercera entidad no trae ISIN: 17 salen
  del catálogo por nombre y precio y 3 de FIRDS. Lo que el programa guarda hoy es la cartera **modelo** (pesos y capital, sin
  títulos, coste, fecha ni efectivo): la **real** del contrato (`kind: REAL`, `client_id`, posiciones) no está construida, y se
  le dice a Óscar. **En marcha:** alta de los 12 en el extractor (`main.py add` y pasada con red solo sobre ellos; subagente
  `model: opus`, `effort: medium`, fijados en los parámetros), sin cadena, sin base y sin nube. **Pendiente de Óscar:** si los 12
  suben con la undécima entera o solos, y la aprobación en ventana de esa subida y de la creación de las cuatro carteras.
- **10-11 00:46 · Dirección:** **alta de la B-77 hecha y revisada** (subagente `model: opus`, `effort: medium`; tres commits en
  `1-extractor`: `9ef8e18`, `2b72fc9`, `e51a685`). Quedan **12 instrumentos nuevos** (11 acciones y 1 ETF; 533 / 32 / 769 en
  `fondos.csv`, 1.334 fichas). Repetido por Dirección: las 1.322 fichas anteriores idénticas byte a byte contra la copia previa,
  1.370 pruebas, árbol limpio; los cierres de las series cuadran con los extractos, y **la clase del ETF de China queda
  confirmada por precio** (4,7265 en Xetra el 09-11 contra 4,7295 del extracto). **Kenvue entró y salió:** EODHD solo devolvía
  su línea de Fráncfort, parada el 30-10; comprobado en el 10-Q de Kimberly-Clark que la compra se cerró el 02-11-2026 y Kenvue
  dejó de cotizar ese día. Óscar decide que la cartera lleve **Kimberly-Clark** («Ok a tus recomendaciones»): se da de alta, y
  Kenvue se retira con `core.ops.baja` sin haber salido del extractor (la ficha queda en `data/_papelera/`, como en la B-70). La
  línea de la cartera se deriva de las condiciones del canje y queda marcada como derivada, no como cifra del extracto. Diez
  fondos y ETF del catálogo siguen nombrando a Kenvue entre sus posiciones: es su cartera publicada. Confirmado por Óscar que
  la tercera entidad es Renta 4 y que **sube la undécima entera**. **Arranca la pasada entera del refresco** (subagente
  `model: opus`, `effort: medium`, fijados en los parámetros; encargo `encargo-undecima-pasada-10-11-2026.md` en las notas de
  la sesión): local, sin nube; el plan en seco lo corre Dirección. **Para la subida hará falta** que Óscar despliegue antes el
  hosting (lo publicado es `cd8b81b` y no lee B-73 ni B-74; las Functions no han cambiado desde entonces) y su aprobación en
  ventana; las cuatro carteras se crearán después con la propia aplicación, en su sesión.
- **10-11 01:55 · Dirección:** **fase local de la undécima hecha y lista para aprobar.** Pasada entera del refresco de 00:48 a
  01:44 (55 min, salida 0; subagente `model: opus`, `effort: medium`): los 13 pasos, 0 inválidos, 0 sobrantes en series, las tres
  comprobaciones del final y «Export complete». **Repetido por Dirección:** canónico `5dee8d1b…` (antes `fc84c09a…`), 1.327
  instrumentos (526 acciones, 31 ETF, 769 fondos, 1 otro), las 47 posiciones de los tres extractos presentes en el 8092 con su
  serie hasta la fecha de cada extracto, cuatro repositorios limpios (`f46acd1` / `e51a685` / `53f9763` / `1673202`). **Plan en
  seco** (`nube:plan -- --parte catalogo`): 49.132 documentos, 0 sin contrato, 0 inválidos, 394 tandas, 0 borrados pendientes
  (las 149 rutas aprobadas ya no están). **Comparación completa, solo lectura:** local 49.750, nube 49.368; 39.797 iguales, 4.749
  solo sello, **4.822 con contenido**, **382 solo en local** (los 12 instrumentos nuevos y `computed/metrics` de Moderna), 0 solo
  en la nube. Los 4.822, en ocho grupos que suman exacto: 1.069 series y cotización (cierre del 09-11), 1.470 fecha del dato de
  las acciones, 1.105 métricas y tarjetas, 440 `provider_returns` (B-74), 64 motivos de calidad, 608 fechas de comprobación, 63
  datos del emisor y 3 fragmentos del buscador. **Lo de la app, intacto:** carteras 18, objetivos 220, retrocesiones 376 + 4,
  idénticos entre local y nube, última escritura en la nube el 03-11; huellas `106d274e…`, `4e1292f6…`, `718d003a…`,
  `44b0c66a…`. **Para Óscar, en la página enviada:** Solventum publica «3 años» con 2,62 años de serie (el defecto del §4 del
  método, como Puig y GE Vernova); **18** instrumentos conservan su ficha anterior por la guarda de regresión (el agente dijo
  12; contado en el registro: 13 fondos y 5 acciones españolas); Vanguard dio 503 para la referencia del S&P 500 (serie
  idéntica); las 11 acciones nuevas no tienen documento de emisor (orden aparte, la app no lo lee); 18 tarjetas con fecha por
  ventana frente a 20 del ensayo, sin explicar. **Orden pedido:** Óscar despliega el hosting (lo publicado, `cd8b81b`, enseñaría
  el `as_of` nuevo del 31-10 sobre cifras a 3, 5 y 10 años del 30-09 en 440 fondos), aprueba en ventana, Dirección sube y
  después crea las cuatro carteras con la propia aplicación; los cuatro textos pasan el importador real (17, 14, 20 y 47 líneas,
  sumas al céntimo, 0 avisos). **Nada subido, nada desplegado.**
- **10-11 04:00 · Dirección:** **undécima subida hecha, y las cuatro carteras del cliente creadas.** Óscar desplegó el hosting y
  aprobó en ventana («Desplegado, sube»). **Antes de subir:** el sitio publicado es byte a byte el compilado de las 03:35 desde
  la app `1673202` (ya lee `as_of_by_window`), los cuatro repositorios limpios y el canónico `5dee8d1b…` con 1.327 instrumentos.
  **Subida** (`nube:subir -- --parte catalogo --escribe`, de 03:38 a 03:52): 49.132 documentos en 394 tandas, 0 borrados (las
  149 rutas aprobadas, «ya no está»). Postverify del script: recuento igualado en los 13 grupos, 0 ausentes, 0 que faltan y 2
  «distintos» de 7.019 con salida 1, **localizados**: son 30 `declared/provider_risk` iguales salvo el orden de claves, como
  siempre, y 0 con contenido. **Comparación completa posterior**, claves ordenadas y solo lectura: 49.750 en local y 49.750 en
  la nube, 49.750 iguales, 0 solo en local, 0 solo en la nube. Lo de la app, medido antes de crear nada: carteras 18, objetivos
  220, retrocesiones 376 + 4, con las mismas cuatro huellas que antes de subir. **Carteras:** Claude in Chrome respondió «turned
  off in your settings» con la extensión conectada, y no se insistió; Óscar inició sesión en el navegador integrado de la app de
  Claude y Dirección las creó **con la propia aplicación** (Posiciones → Extracto externo → confirmar euros → Llevar a Diseño de
  cartera → Guardar como…): una por entidad (17, 14 y 20 posiciones) y la global (47), todas `MODEL` en EUR, con el capital
  invertido y sin la caja. **Verificado en la nube, solo lectura:** 22 carteras y 318 objetivos; en las cuatro, capital al
  céntimo, pesos que suman 1 y ningún objetivo de más ni de menos; las 18 de antes, sin tocar (última escritura, 03-11). La
  aplicación reconoció las 47 posiciones, las 12 nuevas incluidas. **Hallazgo para Óscar:** la cartera global no tiene
  simulación ni en Diseño ni en Análisis, porque `backtest_portfolio` rechaza más de 40 posiciones (`CAP_BACKTEST_ASSETS` en
  `functions_python/main.py`, «Maximo 40 posiciones por peticion») y la pantalla dice «La petición contiene un dato no válido»
  y «se puede reintentar», que no es lo que pasa. Subir el tope pide medirlo, pruebas y un despliegue de Functions: decisión
  suya. **Dirección no ha desplegado ni empujado nada.** Con la undécima hecha queda libre la unificación de repositorios, cuya
  condición 2 es empujar los cuatro.
- **10-11 04:04 · Dirección:** Óscar aprueba subir el tope de la simulación («Sí, súbelo»). **Arranca el encargo** en `3-BDB-ACTIVOS_app` (subagente `model: opus`, `effort: medium`, fijados en los parámetros: código con pruebas y medición, sin fórmulas ni nube; encargo `encargo-tope-simulacion-10-11-2026.md` en las notas de la sesión). Lo que se pide: que toda cartera que la aplicación deja guardar tenga simulación, con el tope sacado de medir contra el emulador 8092 en solo lectura; que la frontera no se calcule por encima de 40 activos y lo diga; que la pantalla cuente el límite real en vez de «dato no válido»; y que ninguna cifra cambie con 40 o menos. Tres topes de 40 localizados: `main.py` (`CAP_BACKTEST_ASSETS`), `portfolio_horizon.py` (`analyze_horizon`) y `optimization/repository.py` (`MAX_REBASED_SERIES_ASSETS`). El despliegue de las Functions lo hará Óscar.
- **10-11 04:47 · Dirección:** **tope de la simulación: hecho y revisado; falta el despliegue, que es de Óscar.** App
  `3d0edcc` (subagente `model: opus`, `effort: medium`), más `5c0aed4` y `e95d571` de Dirección. **El tope pasa de 40 a 85
  posiciones, no a las 200 de una cartera guardada:** manda la memoria, no el tiempo. Cada activo cuesta unos 3 MB porque la
  simulación lee y guarda en caché todos los años de su serie (1.756 lecturas para 47 activos), y la función tiene 1 GB.
  Medido contra el 8092, solo lectura, pico sobre el proceso arrancado: 85 → +283 MB, 90 → +301, 120 → +407, 200 → +707 (910
  MB en total); en tiempo, 14 s con 200. Criterio aplicado: 60 s y 300 MB **sobre el proceso ya arrancado** (el proceso solo
  ya ocupa 202 MB, así que los 300 del encargo no podían ser absolutos). **Por encima de 40 activos medidos no se calcula la
  frontera con series históricas** y la respuesta dice por qué; la aportación al riesgo sigue, fuera de `frontier`, con la
  misma covarianza que usa el solver (una prueba lo ata). `get_price_series` y el backtest sin `analysis_bundle` siguen en
  40 (`CAP_SERIES_ASSETS`); las matrices de Analítica avanzada, las 40 mayores, dicho. El error de un tope se traduce una
  vez en `src/core/appError.ts`, con el límite y cuántas hay, y el banner no ofrece «Reintentar». **Premisa del encargo que
  era falsa:** Analítica avanzada no trataba bien las carteras grandes; pedía la simulación con todas y también rompía.
  **Repetido por Dirección:** `typecheck`, 4.518 pruebas de la app, 2.198 de Functions, `lint`, `build` (JS 121,2 KiB, CSS 26,8
  KiB) y censo de CSS; la medición en 47, 85, 90, 120 y 200 a 5 años, que reproduce la del agente (el script no podía repetir
  los casos por encima de su propio tope: corregido en `5c0aed4`); el antes y después con casos distintos de los suyos —las
  tres carteras reales de 40 o menos y dos de fondos, a 3 y 5 años—: **10 de 10 idénticas byte a byte**; y la cartera de 47
  real en local: 45 medidas a 3 años y 44 a 5, sin frontera y con su motivo, aportaciones que suman 100; las que quedan fuera
  lo hacen por historia insuficiente y, una, por el bloqueo de calidad del dato. El motivo decía «la frontera eficiente se
  calcula con 40» encima de una frontera estimada por composición que sí se dibuja, y «de la cartera entera» con posiciones
  fuera: corregido en `e95d571`. `desplegarFunciones.mjs` en seco: comprobaciones bien. **No visto en un navegador:** Auth y
  Functions locales están caídos (Firestore 8082 y Vite sí responden) y la cartera de muestra no pasa de 40; se mirará en
  producción tras el despliegue, con la cartera real y con una de 90 sin guardar. **Abierto para Óscar:** llegar a 200
  leyendo solo los años que hacen falta, que además abarata cada simulación; la caché de series retiene hasta 250 activos
  15 minutos (unos 675 MB), riesgo que ya existía con 40 y ahora se alcanza antes; el PDF interno lee la aportación al
  riesgo solo de dentro de la frontera y por encima de 40 va sin ella; la comparación a 10 años sigue en 40. Nada desplegado
  ni empujado.
- **10-11 05:01 · Dirección:** **relevo: la dirección vuelve a la sesión original** (Óscar, 04:33: «Dirige desde aquí»). La
  bifurcación recibió el aviso a las 04:48; sus tres commits de entre medias valen —app `5c0aed4` y `e95d571`, raíz
  `19ed291`— y desde entonces no escribe; su nota, `relevo-direccion-10-11-2026.md`, está en la carpeta de notas compartida.
  **Lo que esta sesión comprobó por su cuenta del tope y la línea de las 04:47 no dice:** (1) por encima de 40, el código de
  antes con el tope levantado contra el nuevo —`portfolio_horizon.py` de `1673202` frente a HEAD, tres universos (acciones,
  fondos y uno de cada quince instrumentos del catálogo), 41, 47 y 85 posiciones, 3 y 5 años, pesos desiguales—: **18 casos,
  0 fallos**; la medida es idéntica y la aportación al riesgo que ahora viaja aparte es la misma que daba la frontera
  anterior (diferencia 0, mismo orden, misma meta). Por encima de 40 solo cambia que no hay frontera. (2) Las suites
  **enteras sobre `e95d571`**, que nadie había repetido: 4.518 pruebas de la app, 2.198 de Functions, typecheck y lint, todas
  bien. (3) La frontera estimada por composición, que Diseño sigue dibujando por encima de 40, la calcula el navegador con un
  solver que declara «n ≤ 40» (`src/core/frontier.ts`) y no tiene tope: medido en Node con carteras sintéticas de 20 a 200
  activos, 85 tardan 35 ms y 200 medio segundo, con la rama monótona, sin pesos negativos y sin cifras no finitas. No hay
  razón de cálculo para ocultarla por encima de 40; ocultarla sería una decisión de criterio. (4) `hosting.predeploy` de
  `4-base-nueva/firebase.json` lleva la puerta: `--only hosting` pasa por ella. **Un error mío, corregido:** una pasada de
  vitest lanzada desde la raíz dejó ahí un `node_modules/` sin versionar con su caché (44 ficheros, 04:51), y una copia
  transformada de `src/firebaseEnv.ts` llevaba el id de BDB: `barreraDeBdb.test.ts` falló en la suite entera, 24 apariciones
  contra 23 declaradas. La barrera hizo lo que debe; borrada la carpeta —solo caché—, pasa, y no se añadió nada a la lista.
  Explica también un fallo suelto de `functionsSecurityConfig.test.ts` que no se reproducía: lee `main.py` con el directorio
  del proceso. Vitest se lanza desde la app. **El 85, dicho entero:** sale de aplicar el criterio de 300 MB al incremento
  sobre el proceso arrancado (202 MB); el pico absoluto con 85 ronda los 487 MB de 1 GB, medido en este PC y no en Cloud Run.
  **Sin hacer por nadie:** verlo en un navegador y la batería de seis anchos de `diseno-pantalla`. **Para Óscar:** desplegar
  Functions y después hosting; dar por bueno el 85 y encargar la pieza que llega a 200; mantener u ocultar la frontera por
  composición por encima de 40 (recomendado: mantener); y el PDF interno, sin aportación al riesgo por encima de 40. Nada
  desplegado ni empujado.
- **10-11 07:40 · Dirección:** **despliegue del tope: las Functions salieron, el hosting no.** Óscar: «Desplegado, mira».
  Leído en sus terminales y comprobado aparte: las 34 Functions se actualizaron entre las 07:33 y las 07:36 («Deploy
  complete!») desde `3-BDB-ACTIVOS_app`, que estaba limpia en `e95d571` a las 07:34 y a las 07:36. El sitio **no** se
  publicó: `node compilar-sitio.mjs` y `npx firebase deploy --only hosting` se lanzaron desde la raíz y fallaron los dos
  (módulo no encontrado; «No targets in firebase.json match»). `4-base-nueva/sitio/` sigue con fecha 03:35 y el índice
  publicado nombra los mismos once ficheros que el del disco: es la compilación de `1673202`. **Causa probable, y mía:** di
  el `cd` y las órdenes en bloques separados, y por lo que enseñan las pestañas cada bloque se abrió en un terminal nuevo, en
  la carpeta de la sesión; las Functions salieron porque esa carpeta era entonces la de la app. Desde ahora, una orden que
  dependa de carpeta va en una sola línea con su `cd`. Producción queda con Functions nuevas y sitio viejo, combinación
  leída en el código como inocua y **sin probar**. **No lo he visto en navegador:** Claude in Chrome contesta «turned off in
  your settings» y, en el navegador integrado, la sesión de Óscar se cerró por inactividad; no introduzco credenciales.
  Pendiente de Óscar: publicar el sitio con la orden única y entrar en el panel. Nada desplegado ni empujado por esta sesión.
- **10-11 07:53 · Dirección:** **el sitio ya está publicado con el tope; sigue sin verse en un navegador.** Óscar:
  «Publicado, mira». Comprobado sin entrar: `4-base-nueva/sitio/` es de las 07:47 (257 ficheros), el índice publicado es
  el del disco y su entrada pasa de `index-ClVJP9cU.js` a `index-Ccq2Hucb.js`; la app estaba limpia en `e95d571`, que es lo
  que compila `compilar-sitio.mjs`; `risk_contributions_meta` está en dos ficheros del sitio. Con las Functions de las
  07:33–07:36, producción lleva las dos mitades del cambio. **No visto en producción:** recargado a las 07:50, el navegador
  integrado sigue en «Acceso de asesor · Sesión cerrada por inactividad», y Claude in Chrome sigue apagado; no introduzco
  credenciales. Preparado para cuando haya sesión, sin datos de cliente: 90 acciones del emulador 8092 con la regla de
  `medir_tope_simulacion.py`, pasadas por `parsePositionImport` (sin cabecera no lee ninguna; con «ISIN;Nombre;Importe EUR»
  lee las 90 y pide la casilla de euros). Leído en código: «Llevar a Diseño de cartera» no escribe en la base
  (`ciclo.sustituir` deja la cartera en el almacenamiento de la pestaña, y `resolve_portfolio` recibe un lector), así que
  la de 90 se puede medir sin guardarla. Pendiente de Óscar: entrar en el panel. Nada desplegado ni empujado por esta sesión.
- **10-11 08:31 · Dirección:** **el tope, visto en producción con la sesión de Óscar: solo lectura, nada guardado.**
  Óscar: «Ya he entrado». Con el navegador integrado (Claude in Chrome sigue apagado). **Cartera global guardada (47):**
  Simular mide 46 de 47 a 3 años y 45 de 47 a 5; el cambio a 5 años tarda 3,2 s con la instancia despierta. Las cuatro
  cifras coinciden al decimal mostrado con `analyze_horizon` contra el 8092 **si el proceso lleva
  `BDB_VERIFIED_PRICE_REPAIR_RELEASES`**: la diferencia que traía el relevo (45 y 44 medidos) era del guion de medida, que
  no carga el `.env` de Functions y veía en cuarentena (`adjustment_problem`) un instrumento que la lista versionada libera
  (`verified_price_repair_releases.json`, A-58). Producción es el lado correcto. Sin frontera y con su motivo; en esta
  cartera tampoco se dibuja la estimada por composición. Análisis enseña la aportación al riesgo de los 45 medidos, suma
  100,0 %, y los dos de fuera como «Fuera de la simulación». Vista táctica: «Equiponderada» funciona por encima de 40.
  **Cartera de prueba sin guardar:** 90 acciones del catálogo pegadas en Posiciones → Extracto externo; pasan 89, y la
  pantalla lo dice (se excluye `ES0105046009` por `entraAlCargarUnaCartera`, A-44; no dice el motivo y escribe «1
  posiciones»). Simular enseña «Por encima del límite del cálculo» y «El cálculo admite 85 posiciones como máximo y esta
  cartera tiene 89. No es un fallo pasajero: reintentar no lo cambia.», sin «Calculando…» ni reintento. Sin desbordamiento
  horizontal a 1440 ni a 768 en Simular, en Análisis y con el mensaje del límite (medido en el DOM).
  **Cinco cosas de presentación, sin tocar y sin decidir:** (a) el motivo de no haber frontera es un párrafo sin estilo y
  sin separación (1.134 px de ancho a 1440, tres líneas a 768); (b) debajo sigue la nota «La frontera estima riesgo y
  rentabilidad con regularización…» aunque no hay frontera; (c) el motivo promete la aportación al riesgo y Simular no la
  enseña (está en Análisis); (d) Vista táctica abre en «Máx. Sharpe», que por encima de 40 no tiene nada que enseñar;
  (e) el mensaje del límite sale dos veces en Simular (aviso con etiqueta y párrafo suelto en Vista táctica).
  **No comprobado:** imágenes a ancho completo (el panel recorta la captura a 522 px sea cual sea el ancho emulado; quedan
  para la batería local de seis anchos, que no se ha pasado) y memoria y tiempo en frío de Cloud Run. Dejado como estaba:
  borrador descartado con «Descartar», carga de Posiciones vaciada, 22 carteras guardadas antes y después, panel en
  «Carteras guardadas». Nada escrito en la nube, desplegado ni empujado por esta sesión.
- **10-11 09:50 · Dirección:** **Simular por encima de 40 activos medidos: los cinco puntos de presentación, hechos en
  local; falta publicar el hosting.** Óscar: «Sí, arréglalos». App `d30893e` y `76e779f`, solo frontend. (a) El motivo de
  no haber frontera va en la pieza `.notice`, con su separación; (b) la nota de la regularización no sale si no hay
  frontera; (c) el aviso lleva el botón «Ver la aportación en Análisis», solo si hay aportación que enseñar; (d) Vista
  táctica abre en «Equiponderada» cuando no hay máximo Sharpe; (e) con el tope, Vista táctica no repite el mensaje: remite
  al de arriba. **Fuera de los cinco y por iniciativa mía (`76e779f`):** `HorizonFrontier` es compartida y el mismo aviso
  salía en «Riesgo y rentabilidad» de Componer, que tampoco enseña la aportación; lleva el mismo botón. En Análisis sale
  el aviso con estilo y sin botón, porque la aportación está en esa misma pantalla. Ninguna clase nueva. **Puertas sobre
  `76e779f`:** typecheck; vitest 4.530 pasan y 5 saltadas (359 ficheros + 1); build JS 121,2 KiB y CSS 26,8 KiB; censo 0
  clases sin regla y 0 excepciones caducadas; lint. **Batería de 66 rutas** (`shots:ui`) sobre `d30893e`: una incidencia,
  `xl/mercado`, un 500 de `get_euro_yield_curve` (fuente externa del BCE; anterior y ajena). No se repitió sobre
  `76e779f`. **Seis anchos sobre `76e779f`**, con carteras de prueba y ninguna de cliente (48 posiciones casi
  equiponderadas, 47 medidas; 90; y la de muestra de 8): a 2560, 1920, 1440, 1280, 1024 y 768 sin desbordamiento
  horizontal (`scrollWidth` = `clientWidth`) y nada fuera del panel; 1024 y 768 con dedo; aviso con botón en Simular y en
  Componer; sin nota de regularización; Vista táctica en «Equiponderada»; 0 errores de consola. Los dos botones llegan a
  Análisis, con «Aporta al riesgo» a la vista. Con 90, el mensaje del límite sale una sola vez (1440 y 768). Con 40 o
  menos, igual que antes: frontera, nota, «Máx. Sharpe» y sin botón. Hoja de imágenes enviada a Óscar como fichero. **No
  comprobado:** producción (nada desplegado) y la frontera estimada por composición por encima de 40, que no se reprodujo
  en local. **Visto y sin tocar:** poco aire entre bloques hermanos del cuerpo del panel (los episodios de estrés pegados
  al aviso en Simular; «Frontera eficiente» pegada al aviso «Fuera del cálculo» en Componer), anterior al cambio; y en
  Análisis de la cartera de prueba, «1 bloqueo: `IE00B03HCZ61` no está en el catálogo» con ese fondo medido. **Procesos:**
  arranqué Auth y Functions locales (9097, 5005, 4400, 4500) para las capturas; `TaskStop` solo mató el envoltorio y los
  emuladores siguieron respondiendo, así que cerré el árbol con `taskkill /T` sobre su raíz, comprobada antes por su línea
  de órdenes. A las 09:47 los cuatro puertos no responden a `curl` y siguen vivos, sin tocar, Vite 5174, Firestore 8082 y
  la base nueva 8092/4402. **Quedan 81 procesos huérfanos de Functions del 09-11** (27 `functions-framework` con sus
  `python`, 907 MB; ninguno posterior a mi arranque de hoy): no son de esta pasada, no puedo probar de quién son y no los
  he cerrado; dicho a Óscar. Nada escrito en la nube, desplegado ni empujado por esta sesión.
- **10-11 09:59 · Dirección:** **Los cinco puntos de Simular, publicados por Óscar; sin ver todavía en navegador.** El
  sitio lleva la compilación de las 09:55 (`Last-Modified` 08:55:45 GMT) y su código publicado contiene los textos nuevos
  («Ver la aportación en Análisis», «el motivo está arriba»), leído con `curl` sobre los 125 trozos, sin sesión. En el
  navegador integrado la sesión de Óscar está cerrada: es el cierre por inactividad de 30 minutos
  (`src/auth/cierrePorInactividad.ts`), no un fallo. No tecleo credenciales en producción: espero a que entre él.
  Preparada la cartera de prueba de 90 para pegarla sin guardar.
- **10-11 12:06 · Dirección:** **Los cinco puntos de Simular, vistos en producción; y dos hallazgos sobre la frontera
  «estimada por composición» que esperan decisión.** Sitio de las 09:55, navegador integrado, sesión de Óscar, solo
  lectura, nada guardado. **Cartera global de 47** (fondos y acciones; 46 medidos a 3 años), en Componer y en Simular, a
  1440 y a 768: el motivo de no haber frontera sale en la pieza de aviso con el botón «Ver la aportación en Análisis»; no
  hay gráfico ni nota de regularización; Vista táctica abre en «Equiponderada»; sin desbordamiento. Los dos botones llegan
  a `/analisis` con «Aporta al riesgo» a la vista (46 con valor, suma 100,0). **Cartera de prueba de 90 acciones sin
  guardar** (pasan 89): en Simular el mensaje del límite sale una sola vez y Vista táctica remite al de arriba, a 1440 y a
  768. **Hallazgo 1, sin tocar:** en Componer, por encima de 85, bajo el error se dibuja la frontera por composición con
  el mismo mensaje del límite como pie —sale dos veces— y un eje de rentabilidad hasta el 135 %. Es el respaldo de la rama
  de error de `PortfolioHorizonPanel` (`PendingFrontier` con `reason={error}`), que existe desde el 30-09 (`63d19738`): no
  lo trajo el tope, pero ahora el mensaje del límite pasa por él. **Hallazgo 2, sin tocar:** con **60 acciones de prueba
  sin guardar** (entre 41 y 85, de un solo tipo), ni Componer ni Simular enseñan el aviso ni el botón: se dibuja la
  frontera por composición con el motivo del tope de 40 como pie. El aviso y el botón solo salen cuando esa frontera no
  existe, y hoy eso lo decide que las frecuencias de las métricas sean compatibles (`computeApproximateFrontier` devuelve
  nulo si no lo son, que es el caso de la global, con fondos y acciones), no una decisión. Leído en código: esa frontera
  toma como rentabilidad esperada la anualizada a 3 años de cada activo, sin regularizar, y no tiene tope de activos; por
  eso su extremo es el valor que más subió, y cuantos más activos, más extremo. La A-102 dejó escrito «En Diseño la curva
  se queda»; entonces no existía el tramo de 41 a 85 con simulación y sin frontera histórica. **Propuesto a Óscar, sin
  construir:** por encima de 40 medidos no dibujarla (siempre aviso y botón; por encima de 85, solo el error);
  alternativas, dejar el gráfico y añadirle el botón quitando el mensaje repetido, o dejarlo como está. Cambia mi
  recomendación de la página publicada, que era mantenerla: no había visto el caso de acciones. **Producción queda como estaba:**
  los dos borradores descartados sin guardar, la carga de Posiciones vaciada, 22 carteras guardadas antes y después, sin
  «Extracto externo» entre ellas. **Sin comprobar:** fondos solos por encima de 40; el mensaje del límite en Comparar e
  Informes; memoria y arranque en frío de Cloud Run. Menor: a 1024 la leyenda del gráfico por composición pisa la línea
  arriba a la derecha. Nada escrito en la nube, desplegado ni empujado por esta sesión.
- **10-11 14:47 · Dirección:** **La frontera estimada por composición ya no se dibuja con más de 40 posiciones, en local
  (app `a74e600`, y la decisión A-129 en `335769f`).** Óscar respondió «Sigue» a la pregunta de las 12:06, que llevaba la
  opción A recomendada; no nombra ninguna, Dirección lo leyó como la A y se lo dijo al empezar. **Qué cambia:** en el
  panel que usan Componer, Simular y Análisis, con más de 40 posiciones sale el aviso con el botón a Análisis y, por
  encima de 85, solo el error del límite; la estimada tampoco se calcula. Hasta 40, igual. La regla cuenta posiciones, no
  activos medidos, y de ahí salen tres cosas que la pregunta no decía, escritas en la A-129. Cambia la A-102 solo en ese
  tramo. **Puertas:** `tsc -b`, 4.537 pruebas (eran 4.530), compilación con el mismo peso, censo y lint, limpios; con la
  regla quitada a propósito fallan cuatro de las siete pruebas nuevas. **Visto en local:** 60 acciones en los seis anchos,
  en Componer y en Simular, con el aviso y el botón, sin gráfico estimado y sin desbordamiento. Los otros casos (47
  fondos, 48 mezcladas, 90 fondos, la muestra de 8) salen como por la mañana: prueban que nada se rompe, no la regla. **No
  visto:** el caso de 89 acciones que en producción dibujaba el gráfico bajo el error no se monta en local (72 acciones
  con volatilidad a 3 años); lo cubre una prueba y espera a producción. **Sin tocar y a decisión de Óscar:**
  `LegacyFrontierPanel`, el panel que sale mientras ninguna posición tiene peso, sigue dibujando la estimada sin tope;
  Dirección recomienda darle la misma regla. **De paso:** en la primera captura el BCE no contestó y el Sharpe salió con
  el tipo de respaldo (1,59 frente a 1,53), que es el caso de la A-89 y no del cambio. Los emuladores de Auth y Functions
  que arranqué para las capturas están parados, y solo esos: los 81 procesos sueltos del 09-11 siguen ahí, a la espera de
  Óscar. **Falta:** que Óscar publique el sitio y verlo en producción. Nada desplegado, empujado ni escrito en la nube por
  esta sesión.
- **10-11 15:54 · Dirección:** **el panel de antes de repartir pesos tampoco dibuja la frontera estimada con más de 40
  posiciones, hecho en local** (app `f8f54e4`; decisión **A-130** en `a76661e`). Óscar respondió «Sí, dásela» a «¿Le doy
  la misma regla al panel sin pesos antes de que publiques?». Es `LegacyFrontierPanel`, lo que la A-129 dejó abierto: con
  más de 40 posiciones ni calcula ni dibuja la estimada, y en su sitio va el aviso «La frontera estimada se dibuja con 40
  posiciones como máximo y esta cartera tiene N.», con «Reparte los pesos para ver las cifras de la cartera.» solo si
  ninguna posición tiene peso. Sin botón y sin CSS nuevo. **Lo que la decisión no decía**, escrito en la A-130: el texto
  no cambia por encima de 85, porque el tope de la simulación cuenta posiciones con peso, y no se añade al sitio una
  constante con el 85; en Diseño, por encima del tope no se enseña el estado de la histórica salvo que traiga resultado;
  en Análisis el panel conserva su título «(aproximada)». **Puertas:** `tsc -b`, 4.543 pruebas (eran 4.537), compilación
  con el mismo peso, censo y lint, limpios; con la regla quitada a propósito fallan cuatro de las seis pruebas nuevas.
  **Visto en local**, todas las posiciones a 0 %: 60 acciones en Componer en los seis anchos, con el aviso, sin gráfico y
  sin desbordamiento; 40 acciones, el gráfico como antes; 90 fondos, el aviso con «tiene 90»; y en Análisis → «Analítica
  avanzada», 60 con el aviso y 40 con el gráfico. La primera pasada de capturas falló en el acceso: el emulador de Auth
  arranca sin usuarios y hay que sembrar el de pruebas antes; la habilidad `arrancar-entorno` no lo dice. **Visto y sin
  tocar:** con 40 posiciones sin peso, el pie del gráfico estimado dice «current_portfolio inválido», jerga interna y un
  motivo que no es el de verdad; su origen no está localizado. **No visto:** nada de la A-129 ni de la A-130 en
  producción. Los emuladores de Auth y Functions que arranqué para las capturas están parados, y solo esos: los 81
  procesos sueltos del 09-11 siguen ahí, a la espera de Óscar. **Falta:** que Óscar publique el sitio —las dos reglas
  entran en la misma publicación— y verlo en producción. Siguen abiertas las decisiones 2 (dar por bueno el 85 y la pieza
  de memoria) y 4 (aportación al riesgo en el PDF interno por encima de 40). Nada desplegado, empujado ni escrito en la
  nube por esta sesión.
- **10-11 17:00 · Dirección:** **El «Si a todo» de Óscar a los seis puntos de la recomendación, hecho en lo que tocaba a
  esta sesión; en local.** App `6b9eb30` (el pie), `0d217ab` (el informe) y `9ecaa91` (decisiones A-131 a A-133). **El pie
  (A-131):** con 40 posiciones o menos y ninguna con peso, el pie del gráfico estimado decía «current_portfolio inválido»;
  sin pesos el sitio pide la histórica, el servidor deja vacío el punto de la cartera a propósito y el adaptador rechaza
  la respuesta con el nombre del campo. Se arregla lo que se escribe —«asigna pesos a la cartera para calcular la
  histórica»—, no el adaptador: aceptar el punto vacío cambiaría lo que enseña el panel antes de repartir pesos y es
  decisión de producto, abierta. Visto en Componer con 40 acciones a 0 %, a 1440 y a 768. **El informe completo de cartera
  (A-132):** leía la aportación al riesgo solo de la frontera histórica, que por encima de 40 activos medidos no existe;
  ahora la lee como Análisis, y sus reglas de salud también. Hasta 40 filas el bloque sigue entero en una hoja; por encima
  sigue en la siguiente con su cabecera. Un informe de 60 posiciones de muestra, generado y mirado en imagen: las 60 filas
  en dos hojas. Solo ese informe; el de cliente no se toca. **El 85 (A-133):** dado por bueno hoy; la pieza que lee solo
  los años de la ventana, aprobada para después y sin fecha, toca Functions. **Puertas:** 4.553 pruebas (eran 4.543), `tsc
  -b`, compilación con el mismo peso, censo y lint, limpios; diez pruebas nuevas, y quitando cada cambio a propósito
  fallan las suyas. **Los 81 procesos sueltos del 09-11, cerrados** (908 MB). **El PC se reinició a las 16:34** y cayó el
  entorno local entero; levanté Firestore, Auth, Functions y Vite de la base de siempre para la captura y los cerré al
  terminar, solo esos doce procesos. El emulador de la base nueva sigue parado: su volcado es de las 01:44 de hoy. **No
  visto:** nada de esto en producción, ni el informe con una cartera real de más de 40. **Visto y sin tocar:** sin pesos,
  cada cambio de composición lanza en el servidor un cálculo de frontera cuya respuesta se descarta. **Falta:** que Óscar
  publique el sitio —las dos reglas, el pie y el informe entran en una sola publicación— y que diga si se lanza el push:
  351 commits sin subir (raíz 210, extractor 52, plataforma 35, app 54). El push no se ha lanzado: la
  recomendación lo dejaba a su petición expresa. Nada desplegado, empujado ni escrito en la nube por esta sesión.
- **10-11 17:05 · Dirección:** **Push de los cuatro repositorios, hecho a petición expresa de Óscar («Sí, lánzalo»).**
  Cada uno a su remoto propio en GitHub, rama `gestor-activos-financieros`, sin forzar: raíz 210 commits hasta `bafc224`,
  extractor 52 hasta `e51a685`, plataforma 35 hasta `53f9763` y app 54 hasta `9ecaa91`. Comprobado después con
  `ls-remote`: la cabeza remota es la local en los cuatro y no queda nada sin subir, salvo esta línea, que se sube a
  continuación. Antes de lanzar se miró que los remotos fueran los del proyecto y no los de BDB, y que ninguno fuera por
  detrás. **Sigue faltando:** que Óscar publique el sitio y verlo en producción. Nada desplegado ni escrito en la nube por
  esta sesión.
- **10-11 17:25 · Dirección:** **Visto en producción, tras publicar Óscar el sitio («publicado y entrado»): las dos reglas
  de la frontera estimada (A-129 y A-130), el pie sin jerga (A-131) y el caso por encima de 85.** En solo lectura, con su
  sesión, en el navegador de la aplicación, con acciones de prueba cargadas desde Posiciones con importes ficticios. **Lo
  servido es lo nuevo:** los textos del pie, de las dos reglas y del informe están en el código que sirve la web, y el
  texto viejo del informe («necesita una frontera calculada») ya no está. **Con pesos, 60 acciones:** en Componer y en
  Simular, el aviso del tope de 40 con el botón «Ver la aportación en Análisis» y ningún gráfico estimado. **Sin pesos,
  las mismas 60 a 0 %:** «La frontera estimada se dibuja con 40 posiciones como máximo y esta cartera tiene 60. Reparte
  los pesos para ver las cifras de la cartera.», sin gráfico y sin botón. **89 acciones:** solo «Por encima del límite del
  cálculo», una vez, sin el gráfico que esta mañana salía debajo. **40 acciones a 0 %:** el gráfico estimado con el pie
  «asigna pesos a la cartera para calcular la histórica». Sin desbordamiento a 1024 en los cuatro. Los pesos se pusieron a
  cero con el modo «Proporcional» (una posición al 100 % deja las demás a 0) y luego esa a 0 en «Libre»: no hay acción en
  bloque. **Producción como estaba:** los tres borradores descartados con «Descartar», la carga de Posiciones vaciada, 22
  carteras guardadas antes y después. **No visto:** el informe completo de una cartera de más de 40 en producción (A-132);
  el código servido lleva el cambio, pero el PDF sale como fichero descargado y con una cartera real son datos de cliente:
  se le deja a Óscar, hoja 6.1. **Para que conste:** durante la prueba de las 89 la página escribió en el portapapeles del
  ordenador; Óscar está avisado. Nada desplegado ni escrito en la nube por esta sesión; nada guardado en producción.
- **10-11 17:38 · Dirección:** **El informe completo de cartera con más de 40 posiciones, visto en producción por Óscar
  (A-132).** Lo generó él con la cartera global de 47 y envió la hoja «6.1 · Riesgo · medidas y umbrales» (15 de 47): bajo
  «Medidas y umbrales» sale el bloque «Contribución al riesgo frente al peso · 3 años», con su cabecera, las barras y las
  primeras once filas; la simulación mide 46 de las 47 posiciones, así que es el caso sin frontera, con la aportación
  aparte. La cifra de la fila «Mayor aportación al riesgo» es la de la primera barra, y su peso «de la parte medida»
  cuadra con el de «Mayor posición» dividido por el peso medido. **No visto:** la hoja siguiente, donde debe seguir la
  lista con la cabecera repetida y la nota al final; se le ha pedido. Ni el nombre, ni los importes ni la composición de
  esa cartera constan aquí (B-77). Visto de paso en la hoja 2 del mismo informe y sin tocar: en la columna «Riesgo» de la
  tabla de posiciones, «No aplica» se parte en dos líneas. Nada desplegado ni escrito en la nube por esta sesión.
- **10-11 17:39 · Dirección:** **A-132, vista entera en producción.** Óscar envió también la hoja 16 de 47 del informe
  completo de la cartera global: la lista sigue con la cabecera «# · Posición · Peso (gris) · riesgo (color) · Peso /
  riesgo» repetida arriba, las 35 filas que faltaban y la nota al final. Con las once de la hoja 15 son 46, las medidas;
  el número que falta en la lista es el de la posición que la simulación deja fuera, y no hay hueco ni fila repetida. Con
  esto no queda nada de lo de hoy sin ver en producción. **Visto y sin tocar**, porque es un informe y es anterior al
  cambio: una fila se pinta en ocre con «1,4 % / 1,4 %», porque el color sale de la cifra sin redondear y el texto, de la
  redondeada a un decimal; la nota dice «aporta más riesgo del que pesa» y a la vista pesan igual. A decisión de Óscar. Ni
  el nombre, ni los importes ni la composición de esa cartera constan aquí (B-77). Nada desplegado ni escrito en la nube
  por esta sesión.
- **10-11 18:09 · Dirección:** **Los cuatro repositorios son uno, en local; hecho a la orden de Óscar («Sí, unifica»).**
  Raíz `ad888dee`, `811cdc6f` y `f712eef0` (las tres fusiones), `c752b088` (la barrera y el compilador del sitio) y
  `8889f82d` (documentos). **Método:** el del plan, con ensayo previo en una copia clonada de los bundles: cada carpeta
  entra como fusión de su historia, con su árbol bajo su carpeta, sin reescribir un commit. **Comprobado:** árbol limpio
  tras la fusión; los cuatro `HEAD` de antes (`fa9b9b2d`, `e51a6857`, `53f9763b`, `9ecaa916`) son antecesores del nuevo;
  el árbol de cada carpeta es idéntico al de antes; 160 de 160 hashes citados aquí resuelven; `git blame` atraviesa la
  fusión; 1.949 commits y 2.325 ficheros. **Pruebas, con sus cifras de antes:** app 4.554 (4.553 más una de la barrera),
  tipos, compilación, censo y lint limpios; plataforma 1.446 de 1.446; extractor 1.370; contratos de la app y del
  extractor en verde. **La barrera de BDB**, tal cual, fallaba en cuatro de once tras la fusión; reescrita para barrer
  cuatro partes y exigir que Git vea ficheros en cada una, pasa con doce, y con el id plantado a propósito en la raíz y en
  el extractor falla y los nombra. `compilar-sitio.mjs` compila desde el repositorio único, sin desplegar. **Base nueva:**
  el emulador 8092 lo arranqué yo a las 18:01 (`arrancar.mjs`, importó el volcado) y **sigue en marcha, es mío**;
  `audit:base-nueva` 49.750 documentos y 0 que no validan; escritura local con su gate, 0 creados, 17.027 reemplazados,
  postverify limpio; guardado con `guardar.mjs` a las 18:04; plan en seco de `nube:plan --parte catalogo`, 49.132
  documentos, recuento igual al de la nube en los 13 grupos, nada escrito. **Lo que el plan no decía:** lo que cada
  repositorio ignoraba en local y `core.longpaths` de la app se llevaron a la configuración local de la raíz, y los fines
  de línea de la app, a un `.gitattributes` suyo. **Dónde está la vuelta atrás:** los tres `.git` apartados (no borrados)
  y un bundle de cada repositorio, fuera del proyecto, en `Gestor-Activos-Financieros-copias\unificacion-2026-11-10`.
  **Desde ahora:** un agente escritor por carpeta y commits nombrando rutas; está en `AGENTS.md` y arriba, en las reglas.
  **Falta, y es de Óscar:** subir —el repositorio único solo existe en este ordenador—, archivar en GitHub los tres
  remotos que dejan de usarse, y decidir el CI, la evidencia de los gates y cuándo se borran las copias. El detalle, en
  `PLAN_UNIFICAR_REPOSITORIOS_2026-11-10.md`, «Cómo quedó». Nada desplegado, empujado ni escrito en la nube por esta
  sesión.
- **10-11 18:33 · Dirección:** **El repositorio único, subido a GitHub a petición expresa de Óscar («Sí, súbelo»).** Al
  remoto de la raíz (`oantiza/gestor-activos-financieros`), rama `gestor-activos-financieros`, sin forzar: 1.571 commits,
  de `fa9b9b2d` a `081789e7`. Comprobado con `ls-remote`: la cabeza remota es la local y no queda nada sin subir, salvo
  esta línea, que se sube a continuación. Los tres remotos de antes (`-extractor`, `-datos`, `-app`) no se han tocado:
  **archivarlos en GitHub es de Óscar.** Los `.git` apartados y los bundles siguen en su carpeta de copias. El emulador de
  la base nueva (8092) sigue en marcha y es de esta sesión. Nada desplegado ni escrito en la nube por esta sesión.
- **10-11 19:28 · Dirección:** **La tanda de flecos del sitio, hecha en local («Sí, los flecos» de Óscar), y la pieza de
  memoria, aparcada.** Raíz `05d37bb0` (el sitio), `cc142349` (la habilidad) y las decisiones A-134 y A-135 en el commit
  de esta línea. **Sin pesos ya no se pide la frontera histórica:** el panel de antes de repartirlos solo la pedía sin
  pesos, así que la petición se quita entera; lo que se ve no cambia. **«Se excluye 1 posición»** en Posiciones. **Aire
  entre los bloques del panel de la simulación**, con la pila del cuerpo; la caja de procedencia no se pinta vacía. **La
  habilidad de arranque** dice que el usuario de pruebas se siembra en cada arranque del emulador de Auth. **La página
  duplicada**, borrada. **Puertas:** 4.562 pruebas (eran 4.554), `tsc -b`, compilación con el mismo peso, censo y lint,
  limpios; ocho pruebas nuevas, y con el panel de antes fallan tres. Dos pruebas antiguas dependían del `.env.local` y
  ahora no. **Visto en local:** Componer y Simular con la muestra de 8 en los seis anchos y con 60 acciones a 1440 y a
  768, sin desbordamiento. **La pieza de memoria (A-134):** Óscar dice que el programa es un prototipo y que no habrá
  carteras de 85, que lo de hoy fue una excepción y que con 40 sobra; no se hace, y el tope de 85 se queda. **Procesos:**
  levanté Firestore, Auth, Functions y Vite de la base de siempre para las capturas y los cerré, solo esos trece; el
  emulador de la base nueva (8092) sigue en marcha y es mío. **No visto:** nada de esto en producción. **Falta:** que
  Óscar publique el sitio; el push espera a que lo pida. Nada desplegado, empujado ni escrito en la nube por esta sesión.
- **10-11 20:32 · Dirección:** **Los flecos del sitio (A-135), vistos en producción tras publicar Óscar («ya»).** En solo
  lectura, con su sesión, en el navegador de la aplicación, con acciones de prueba cargadas desde Posiciones con importes
  ficticios. **Lo servido es lo nuevo:** el sitio sirve otro fichero principal y su código lleva los tres cambios. **El
  plural:** con trece líneas de prueba, una de ellas la que no pasa, Posiciones escribe «A Diseño de cartera: 12 activos ·
  120.000 €. Se excluye 1 posición (10.000 €)». **El aire:** en Simular con las 12, el cuerpo del panel es la pila
  (`panel__body stack stack--tight`), con 12 px entre sus cinco bloques, sin caja vacía y sin desbordamiento a 1440. **Sin
  pesos no se llama al servidor:** medido con los tiempos de recursos de la página; con un peso al 100 % sale una llamada
  a `backtest_portfolio`, que prueba que el contador cuenta; con los doce a 0 %, ninguna en ocho segundos, y al quitar una
  posición, ninguna en seis. El pie sigue diciendo «asigna pesos a la cartera para calcular la histórica» y el gráfico
  estimado se dibuja. **Producción como estaba:** el borrador descartado con «Descartar», la carga de Posiciones vaciada,
  22 carteras guardadas antes y después. Con esto no queda nada de hoy sin ver en producción. El emulador de la base nueva
  (8092) sigue en marcha y es de esta sesión. Nada desplegado ni escrito en la nube por esta sesión; nada guardado en
  producción.
- **10-11 21:05 · Dirección:** **El informe de cliente, revisado hoja a hoja; nada tocado.** Óscar eligió seguir por ahí
  («Informe de cliente», a la pregunta de con qué pieza se sigue). Generado en local desde la propia pantalla de Informes,
  con la cartera de muestra de 8 y con diez fondos, sobre la base de siempre: nueve hojas cada uno. **Lo que está bien:**
  dice qué mide y qué queda fuera, las cifras cuadran entre sí (el Sharpe con la rentabilidad, el tipo y la volatilidad
  que imprime; la acumulada de la hoja 4 con la anualizada de la 3) y las crisis no prometen nada. **Lo que sobra o
  falta:** la columna «Capital» con «N/D» en todas las filas sin capital fijado; ninguna mención al coste, a la divisa ni
  a que las cifras son antes de asesoramiento e impuestos (0 apariciones en `informeDeClientePdf.tsx`); «Otras categorías»
  como barra mayor; el tipo sin riesgo como una cifra más; la frontera sin cifras en los ejes y con la cartera por debajo
  de la curva; la matriz de solapamiento con 51 de 100 casillas en «N/D»; y dos anexos casi en blanco con la misma fila.
  Varias las dejó anotadas la A-34, donde Óscar eligió esperar al rediseño. **Propuesta:** de nueve hojas a seis, sin
  cambiar ninguna cifra ni ningún cálculo. **A decisión de Óscar, cinco:** la frontera fuera del papel del cliente, el
  solapamiento en frases, añadir los costes, decir cuándo la cartera de referencia no se parece en riesgo a la cartera, y
  un bloque de cambios menores. Página con las hojas y las opciones: https://claude.ai/artifact/MyPDRSCNJY3FFojcjA9TdZ.
  **No comprobado:** la base de la web, una cartera real, con capital fijado, solo acciones, una cartera de 40, y cuántos
  fondos tienen coste corriente. **Procesos:** levanté Firestore, Auth, Functions y Vite de la base de siempre para
  generar los informes y los cerré; el emulador de la base nueva (8092) sigue en marcha y es mío. Nada desplegado,
  empujado ni escrito en la nube por esta sesión.
- **10-11 21:16 · Dirección:** **Óscar aprueba el informe de cliente de seis hojas con las cinco recomendaciones («Sí, con
  las cinco»). Arranca el encargo** en `3-BDB-ACTIVOS_app` (subagente `model: opus`, `effort: medium`, fijados en los
  parámetros: código con pruebas, sin fórmulas del método). **Las cinco:** la frontera eficiente fuera del papel del
  cliente; el solapamiento en frases; los costes (coste corriente por fondo, el medio de la cartera y la línea de «antes
  de asesoramiento e impuestos»); decir junto al diferencial cuándo la cartera de referencia no se parece en riesgo a la
  composición; y el bloque de menores (sin capital, ni columna ni «N/D»; el tipo sin riesgo, a nota; todas las categorías;
  un solo anexo; la nota de Canadá y África, fuera; perfil y horizonte en la portada si están; cada hoja titulada por lo
  que lleva). **Medido antes de empezar**, en la base nueva local, que es la de la web: tienen coste corriente los 31 ETF
  y 766 de los 769 fondos, con fuente KID (694) o proveedor (103); ninguna acción, como corresponde. No es dato del emisor
  (B-53): es `declared/costs`. **Lo que la decisión 4 no decía y fijo yo:** la frase se escribe cuando la volatilidad de
  la composición y la de la referencia difieren en más de un 25 % relativo. **Límites del encargo:** no cambia ninguna
  cifra ni cálculo, solo este informe, sin emuladores ni despliegue; la revisión en imagen con datos de verdad la hace
  Dirección al acabar. Un agente escribe en la app: nadie más toca esa carpeta hasta que termine.
- **10-11 22:12 · Dirección:** **El informe de cliente sale en seis hojas, en local (A-136).** App `bc4f0029` y
  `196451c0`, del subagente (`model: opus`, `effort: medium`); la decisión, el índice y esta línea, en el commit de la
  raíz. **Lo que lleva:** sin frontera ni matriz de solapamiento, que se quedan en el informe completo; el coste corriente
  y la divisa de cada fondo, el coste medio de la cartera y la línea de «netas de los gastos de los fondos y antes de
  asesoramiento e impuestos»; el solapamiento en frases; la frase que dice cuándo la referencia no se parece en riesgo a
  la composición; sin «N/D» de capital; el tipo sin riesgo como nota; todas las categorías; perfil y horizonte en la
  portada si están. **Revisión de Dirección, generándolo desde la aplicación en local:** la primera entrega daba ocho
  hojas con diez fondos y siete con la muestra, y la hoja de evolución quedaba a 6 puntos del pie; devuelto con tres
  ajustes (reparto compacto, anexo solo cuando la nota de cifras no nombra todo lo que queda fuera, gráficos algo más
  bajos). Segunda entrega: seis hojas con las dos carteras y siete con 25 fondos, porque la tabla ocupa dos. El coste
  medio recalculado a mano coincide (1,85 %); la frase de la referencia sale con la cartera de renta variable y no con la
  equilibrada. **Puertas, repetidas por Dirección:** 4.588 pruebas (eran 4.562), `tsc -b`, compilación con el mismo peso,
  censo y lint, limpios. **No visto:** producción, una cartera real, la base de la web; con capital, con perfil y con solo
  acciones lo cubren las pruebas, no el botón. **Procesos:** levanté dos veces Firestore, Auth, Functions y Vite de la
  base de siempre para generarlo y los cerré; el emulador de la base nueva (8092) sigue en marcha y es mío. **Falta:** que
  Óscar publique el sitio y genere él el informe de una cartera suya; el push espera a que lo pida. Página con el antes y
  el después: https://claude.ai/artifact/MyPDRSCNJY3FFojcjA9TdZ. Nada desplegado, empujado ni escrito en la nube por esta
  sesión.
- **10-11 22:39 · Dirección:** **El informe de cliente de seis hojas (A-136), publicado por Óscar y dado por bueno por él
  («todo ok»).** Comprobado por Dirección, en solo lectura: el sitio sirve una compilación nueva y el trozo del informe de
  cliente lleva los textos nuevos (el coste corriente medio, la frase de la referencia, «Qué queda fuera del cálculo») y
  ya no lleva «Matriz de solapamiento» ni «Optimización y crisis pasadas», que siguen solo en la pantalla de Análisis y en
  el informe completo, como corresponde. **Lo que Dirección no ha visto:** el informe generado en producción; eso lo ha
  mirado Óscar con sus carteras y no consta aquí nada de ellas (B-77). Los commits de la app y de la raíz están subidos
  hasta `b0019406`. El emulador de la base nueva (8092) sigue en marcha y es de esta sesión. Nada desplegado ni escrito en
  la nube por esta sesión.
- **10-11 22:57 · Dirección:** **La comparativa de carteras, revisada hoja a hoja; nada tocado.** Óscar eligió seguir por
  ahí («Comparador de carteras», a la pregunta de con qué pieza se sigue). Generada en local desde Informes: como el
  usuario de pruebas no tiene carteras guardadas y el botón sale apagado, guardé tres de muestra en el emulador local con
  «Guardar como…» (la de 8, una defensiva de 4 y diez fondos de renta variable; el emulador no persiste) y descargué dos
  comparativas, de ocho y nueve hojas. **Lo que está bien:** las dos carteras en el mismo periodo, con las mismas 786
  observaciones y base 100; las rentabilidades por año encadenadas dan la acumulada que imprime (40,3 % y 73,7 %); el
  Sharpe cuadra con la rentabilidad, el tipo y la volatilidad; la tabla de qué cambia en cada posición; y no recomienda.
  **Lo que sobra o falta:** ningún coste (0 apariciones del coste corriente en `comparePdf.tsx`; el método dice «No se han
  estimado costes»); la portada da las diferencias con signo y dos decimales («−7,67 pp · Positivo: B sufrió una caída
  menor»); la región sale de la etiqueta de cada fondo («Global 61 %») y no del reparto mirando dentro, que es el del
  informe de cliente, así que dos papeles del mismo cliente darían dos geografías; «Resto de grupos» como fila mayor (70 %
  de B); el ratio de Calmar, que el informe de cliente no lleva; sin nombre de cliente ni de quien lo elabora; y cuatro
  hojas a medio llenar, con método y anexo repartidos en dos. **Propuesta:** de nueve hojas a seis, sin cambiar ninguna
  cifra. **A decisión de Óscar, cinco:** los costes, la geografía, las diferencias en frases, quitar Calmar y un bloque de
  menores. Página: https://claude.ai/artifact/8PEM9KQMkvAxsPybJN8GZi. **No comprobado:** la base de la web, carteras
  reales, con capital, a 5 y 10 años, una cartera medida por debajo del 80 %, y si la comparativa tiene datos para la
  geografía del informe de cliente. **Procesos:** levanté y cerré Firestore, Auth, Functions y Vite de la base de siempre;
  el 8092 sigue en marcha y es mío. Nada desplegado, empujado ni escrito en la nube por esta sesión.
- **10-11 22:58 · Dirección:** **Óscar aprueba la comparativa de carteras de seis hojas con las cinco recomendaciones
  («Sí, con las cinco»). Arranca el encargo** en `3-BDB-ACTIVOS_app`, al mismo subagente del informe de cliente, reanudado
  (`model: opus`, `effort: medium`, los de su arranque). **Las cinco:** el coste corriente medio de cada cartera y su
  diferencia en la portada, y el de cada fondo en la tabla de posiciones; la geografía del informe de cliente (renta
  variable por región mirando dentro de los fondos) en lugar de la etiqueta de la ficha; las diferencias de la portada en
  frases y con un decimal; fuera el ratio de Calmar; y el bloque de menores (un decimal en los puntos, todas las
  categorías, las cifras de B en tinta, cliente y responsable en la portada si llegan, las palabras del informe de cliente
  para lo que se mide, tres indicadores de concentración, método y anexo en una hoja, composición y concentración en
  otra). **Comprobado antes de encargar:** la geografía es viable, porque `entradaDeComparativa.ts` ya recibe las fichas
  de las dos carteras, que es lo que pide `computeEquityRegionAllocation`. **Límites:** no cambia ninguna cifra ni
  cálculo, solo este documento y lo justo para hacerle llegar los datos; la pantalla Comparar no se toca; sin emuladores
  ni despliegue. La revisión con datos de verdad la hace Dirección al acabar. Un agente escribe en la app: nadie más toca
  esa carpeta hasta que termine.
- **10-11 23:48 · Dirección:** **La comparativa de carteras sale en seis hojas, en local (A-137).** App `b9f869e3`,
  `9a6caaf5` y `520b2b86`, del subagente (`model: opus`, `effort: medium`); la decisión, el índice y esta línea, en el
  commit de la raíz. **Lo que lleva:** el coste corriente medio de cada cartera y su diferencia en la portada, y el de
  cada fondo en la tabla de posiciones; la renta variable por región mirando dentro de los fondos, como el informe de
  cliente; las diferencias en una frase; sin Calmar; todas las categorías; cifras de B en tinta; cliente y responsable en
  la portada desde Informes; las palabras del informe de cliente para lo que se mide; composición y concentración en una
  hoja, y el método debajo de las últimas posiciones cuando cabe. **Revisión de Dirección, generándola tres veces desde la
  aplicación en local con carteras de muestra guardadas en el emulador:** la primera entrega daba ocho hojas en el caso de
  8 contra 10 posiciones; la segunda, siete en los dos casos, porque la nota del pie de la composición saltaba sola a otra
  hoja (el cálculo de alturas se afinó con datos de prueba); la tercera, con esa nota llevada al método, da seis en los
  dos. Costes recalculados a mano: 0,95 % y 1,85 %, diferencia 0,90; la región de la cartera de diez fondos coincide con
  la del informe de cliente de esa misma cartera. **Puertas, repetidas por Dirección:** 4.606 pruebas (eran 4.588), `tsc
  -b`, compilación con el mismo peso, censo y lint, limpios. **No visto:** producción, carteras reales; con capital, a 5 o
  10 años y por debajo del 80 % lo cubren las pruebas, no el botón. **Procesos:** levanté y cerré Firestore, Auth,
  Functions y Vite de la base de siempre; el 8092 sigue en marcha y es mío. **Falta:** que Óscar publique el sitio y
  descargue él la comparativa de dos carteras suyas; el push espera a que lo pida. Página:
  https://claude.ai/artifact/8PEM9KQMkvAxsPybJN8GZi. Nada desplegado, empujado ni escrito en la nube por esta sesión.
- **11-11 05:11 · Dirección:** **La comparativa de carteras de seis hojas (A-137), publicada por Óscar.** Comprobado en
  solo lectura: el sitio sirve la compilación local de las 23:50, y su trozo de la comparativa es byte a byte el compilado
  desde `520b2b86`; lleva «Cómo se calcula», «Renta variable por región» y el coste corriente, y ya no lleva Calmar, «Peso
  representado» ni «Resto de grupos». **No visto:** el documento generado en producción con carteras reales, que es de
  Óscar. **El emulador de la base nueva (8092), que arranqué ayer a las 18:00, ya no está en marcha** (su proceso salió
  con código 4 tras exportar); no se ha perdido nada: lo último escrito fue la pasada de las 18:03, guardada a las 18:04,
  y el plan en seco contra la nube solo lee. No lo he vuelto a arrancar: nada lo necesita ahora. Nada desplegado ni
  escrito en la nube por esta sesión.
- **11-11 05:19 · Dirección:** **El informe de costes, revisado hoja a hoja; nada tocado.** Óscar eligió seguir por ahí.
  Generado en local desde Informes con cuatro carteras de muestra: las 8 de siempre sin capital, diez fondos y una mixta
  de seis fondos y cuatro acciones con 250.000 € ficticios, y cinco acciones; tres hojas cada uno. **Lo que está bien:**
  recalculada a mano la mixta, 1,00 % y 2.500 € de coste corriente, y 0,147 % y 367,50 € de operación sobre el 50 % del
  peso que tiene el dato; la muestra da 0,95 % aquí y en la comparativa; cada cifra con su fuente; solo acciones dice «No
  aplica». **No hay nada que recortar.** **A decisión de Óscar, cinco:** pasarlo a la identidad de papel de cliente; decir
  que el asesoramiento no va en la cifra («Gestión adicional: No añadida» es lenguaje de operador y el «No incluye» no lo
  nombra); una línea en la hoja 1 con la entrada máxima, sin sumarla; precisar los impuestos de la guía, que dice «ya
  incluye impuestos» y luego que no los incluye; y un bloque de menores. **Para cumplimiento, y sin escribir nada por mi
  cuenta:** el papel no menciona las retrocesiones, y MiFID II pide informar de los pagos de terceros; si aplica y cómo
  depende de la autorización de la entidad. Página: https://claude.ai/artifact/1GfzKAQnvnVWcrhH1gcwqf. **No comprobado:**
  la base de la web, comisión de gestión añadida, una cartera real o de 40 posiciones. **Procesos:** levanté y cerré
  Firestore, Auth, Functions y Vite de la base de siempre. Nada desplegado, empujado ni escrito en la nube por esta
  sesión.
- **11-11 05:36 · Dirección:** **Óscar decide el informe de costes y arranca el encargo** en `3-BDB-ACTIVOS_app`
  (subagente nuevo, `model: opus`, `effort: medium`, fijados en los parámetros). **Sí:** pasarlo a la identidad de papel
  de cliente y el bloque de menores (euros sin céntimos, pesos con un decimal, «Falta el dato», cliente y responsable,
  «Proveedor de datos»). **La fila de gestión:** Óscar explica que a veces hay asesoramiento y a veces no, y que la
  mayoría de las carteras son autogestionadas; Dirección cambia su recomendación y él aprueba («Sí, quítala»): sin
  comisión indicada la fila no sale, y con ella sale y se suma, rotulada «Asesoramiento o gestión de la cartera». **No:**
  la línea de la entrada en la hoja 1 («La entrada es algo raro en España»; el dato es el máximo del KID, no lo que se
  cobra) y la precisión de los impuestos de la guía («déjalo»). **Retrocesiones:** no se escribe nada en este papel; queda
  como pregunta para cumplimiento. Límites del encargo: no cambia ninguna cifra ni cálculo, solo este informe, sin
  emuladores ni despliegue; la revisión con datos de verdad la hace Dirección al acabar. Un agente escribe en la app:
  nadie más toca esa carpeta hasta que termine.
- **11-11 05:47 · Dirección:** publicada la página de las **decisiones abiertas de Óscar**
  (https://claude.ai/artifact/CxhcGCGGwDUbxApiAinaf3), mientras el subagente rehace el informe de costes. Cuatro, con
  opciones y recomendación: **qué es un cliente** (sin ficha por ahora; la ficha ligera solo si cumplimiento contesta que
  el perfil del cliente debe constar), **la escala de perfil** (diez niveles como única escala y referencia propuesta por
  cercanía en renta variable, a un máximo de 10 puntos; no hace falta esperar a la ficha, porque el nivel ya viaja con la
  cartera por B-59), **las dos pantallas nuevas** (retirarlas: lo que traían ya está en Cartera y Análisis, comparado
  leyendo el código, y `/analisis-nuevo` arrastra un defecto conocido) y **trece preguntas para cumplimiento** en una sola
  lista, con las retrocesiones. Nada decidido: esperan su respuesta. Ninguna norma contrastada. Nada tocado en la app ni
  en la nube.
- **11-11 05:53 · Dirección:** Óscar aprueba las cuatro («Sí, las cuatro»). Registradas **C-25** (por ahora sin ficha de
  cliente; se revisa con la pregunta 6 de cumplimiento) y **C-26** (una sola escala de diez niveles y referencia propuesta
  por cercanía en renta variable; decidida y no construida), con el índice en C-1 a C-26. La lista de trece preguntas
  queda en `PREGUNTAS_CUMPLIMIENTO_2026-11-11.md`, sin responder, y la envía Óscar. **Quedan dos piezas pequeñas en la
  app** —retirar `/cartera-nueva` y `/analisis-nuevo` con su módulo, y proponer la referencia— que esperan a que el
  subagente del informe de costes termine y se revise, porque solo escribe un agente por carpeta.
- **11-11 06:15 · Dirección:** el **informe de costes**, en el papel de cliente, hecho en local (`27b34986` del subagente
  y `d32721fc` de Dirección: la guía ya no nombra una comisión que no existe). **Decisión A-138**, con el índice en A-1 a
  A-138 y `AGENTS.md` y la habilidad de diseño al día. Generado desde la aplicación con datos de verdad: tres hojas en
  cuatro carteras y seis con 40 posiciones; con comisión del 0,50 %, 3.750 € y 1,50 %; solo acciones, «No aplica». Puertas
  repetidas: 4.625 pruebas. Un fallo intermitente que vio el subagente no se identificó y no se ha repetido. El emulador
  de Functions se cayó en el primer arranque y salió a la segunda con `FUNCTIONS_DISCOVERY_TIMEOUT=120`, con la máquina
  cargada por las pruebas del subagente; causa sin confirmar. Parado todo lo que arranqué. **Falta que Óscar publique el
  sitio.** Siguen esperando las dos piezas de la app aprobadas hoy: retirar las dos pantallas nuevas y proponer la
  referencia (C-26).
- **11-11 06:55 · Dirección:** Óscar publica el sitio con el informe de costes en papel de cliente. Comparado fichero a
  fichero con lo compilado: 255 de 255 idénticos. Falta que lo genere él con una cartera real. **Arranca el encargo de las
  dos piezas aprobadas** (`model: sonnet`, `effort: medium`, dos commits): retirar `/cartera-nueva` y `/analisis-nuevo`
  con su módulo, y en Informes una propuesta visible de la referencia más cercana al nivel de la cartera (C-26), que no
  cambia nada hasta que el asesor pulsa. La carpeta de la app queda con un solo escritor hasta que termine.
- **11-11 07:16 · Dirección:** hechas en local las dos piezas aprobadas. **`e5e5ef41`** retira `/cartera-nueva` y
  `/analisis-nuevo` con su módulo (**A-139**, índice en A-1 a A-139), y **`920406dc`** construye la propuesta de
  referencia (**C-26**): en Informes y fuera del modo cliente, una línea con botón que no cambia nada hasta pulsar.
  Comprobado desde la aplicación: con nivel 7 y «Agresivo» propone «Equilibrado» y solo cambia al pulsar; sin nivel, con
  la referencia ya elegida o en modo cliente no sale; sin desbordes en los seis anchos; las dos rutas dicen «Esta página
  no existe». Puertas repetidas sobre `920406dc`: 4.626 pruebas. La habilidad `arrancar-entorno` lleva la trampa de los
  emuladores sin redirigir, y `pipeline-extractor` ya no cita la pantalla retirada. Parado todo lo que arranqué. **Falta
  que Óscar publique el sitio** para ver la propuesta en la web.
- **11-11 07:31 · Dirección:** Óscar publica el sitio con la propuesta de referencia y sin las dos vistas previas.
  Comparado fichero a fichero con lo compilado: 252 de 252 idénticos, la propuesta dentro y ninguna mención a las rutas
  retiradas. No se ha mirado en producción con una cartera real: la propuesta solo sale con una cartera con nivel, y el
  informe de costes lo genera Óscar.
- **11-11 07:45 · Dirección:** a la pregunta de con qué informe seguir, Óscar elige el **informe completo** (el interno
  del asesor). Generado en local desde la aplicación con cuatro carteras de muestra (22, 25, 29 y 47 hojas) y revisado sin
  tocar nada: las cifras cuadran, rehechas a mano en la cartera mixta. Cinco decisiones para él: el cono de capital (a
  tres años, hasta el percentil 5 gana un 22 %; ya tratado en A-3, se le trae con el ejemplo), un aviso cuando la renta
  variable de la cartera y la de la referencia difieren más de 20 puntos, quitar el «neto frente al coste» de las
  retrocesiones, recolocar las hojas casi vacías y un bloque de menores. Parado todo lo que arranqué. Nada tocado en la
  app ni en la nube.
- **11-11 07:49 · Dirección:** Óscar aprueba las cinco del informe interno («si a tus 5 propuestas») y pide investigar en
  paralelo los tres fondos con Morningstar atrasado. Dos encargos a la vez: **informe interno** (`model: opus`, `effort:
  medium`, único escritor de la app; el cono se centra en el tipo sin riesgo, aviso por encima de 20 puntos de renta
  variable, sin «neto» en retrocesiones, sin hojas casi vacías y el bloque de menores) y **LU1882457739, LU1883319474 y
  LU1883342880** (`model: sonnet`, `effort: medium`, solo lectura, sin repositorio ni API de pago).
- **11-11 08:02 · Dirección:** los **tres fondos con Morningstar a 30-11-2025** no son un fallo nuestro: son clases C de
  Amundi convertidas en clase A el 28-11-2025 (LU1882457739 a LU1882457143, LU1883319474 a LU2070309450, LU1883342880 a
  LU2070309377). Contrastado con las series del extractor, que paran ese día, con los controles de selección y con el
  aviso de Amundi, que lleva un marcador sin rellenar. El coste en los papeles sale el de la clase C, entre 0,55 y 1,00
  puntos de más, y las rentabilidades, sin fecha. De 1.308 series, 14 llevan más de 90 días paradas. Página con opciones
  para Óscar: https://claude.ai/artifact/8TsG6K86HoZ8VC4kjE5zW4. Recomendación: avisar para cualquier serie parada más de
  90 días; las dos A2, solo si alguna cartera real las lleva. Nada tocado.
- **11-11 08:07 · Dirección:** Óscar decide «Sí, avisa»: **B-78**, un fondo con la serie parada más de 90 días se avisa
  donde se enseñan sus cifras, con el índice en B-1 a B-78. Decidida y no construida: va detrás del informe interno, que
  toca los mismos ficheros. Queda por saber si alguna cartera real lleva los tres ISIN convertidos.
- **11-11 08:30 · Dirección:** el **informe completo**, con las cinco de Óscar, hecho en local (`74d63d9f` del subagente y
  `7606fc6a` de Dirección). **Decisión A-140**, índice en A-1 a A-140 y `AGENTS.md` al día. Generado desde la aplicación
  con datos de verdad: 22, 25, 29 y 49 hojas. Cono de la cartera mixta a tres años, 180.622 €, 271.219 € y 407.259 €;
  aviso de riesgo distinto con 98 % y 100 %, y no en la muestra cercana. La longitud no bajó: de 47 a 49 hojas con 40
  posiciones, por una tabla que se pisaba y que se ha corregido. Puertas: 4.665 pruebas. Sobre los tres fondos
  convertidos, Óscar: «dejalos fuera»; descartadas las A2, sin retirarlos del catálogo, B-78 al día. Parado todo lo que
  arranqué. **Falta que Óscar publique el sitio**; después, el aviso de serie parada (B-78).
- **11-11 08:36 · Dirección:** Óscar publica el sitio con el informe interno. Comparado fichero a fichero con lo
  compilado: 252 de 252 idénticos, con el cambio dentro. Falta que lo genere él con una cartera real. **Arranca el aviso
  de serie parada, B-78** (`model: opus`, `effort: medium`, único escritor de la app): el encargo manda parar si la fecha
  no llega al cliente sin tocar Functions.
- **11-11 09:20 · Dirección:** el **aviso de serie parada (B-78)**, hecho en local (`cf763d94` y `d03d16a0`, subagente
  Opus 5.5 medio). La primera versión fallaba contra la base real en todas las posiciones con pruebas en verde, porque
  estas simulaban la respuesta: Dirección lo vio con la base nueva levantada y el arreglo lee la serie por año. Comprobado
  desde la aplicación con 40 fondos y dos clases convertidas: dos avisos en Análisis y ninguno en Modo cliente; la fecha
  en las filas del informe de cliente, el de costes y el interno, con su punto a revisar de severidad alta; nada cambia
  sin series paradas. Puertas con las dos bases levantadas: 4.697 pruebas. El sucesor no llega al cliente y se dejó fuera.
  Parado todo lo que arranqué; el volcado de la base nueva, intacto (10-11 18:04). **Falta que Óscar publique el sitio.**
- **11-11 09:35 · Dirección:** Óscar publica el sitio con el aviso de serie parada. Comparado fichero a fichero con lo
  compilado: 254 de 254 idénticos, con el aviso y la lectura por año dentro y sin la consulta ordenada al revés. Falta lo
  único que no se puede ver en local: que la lectura por el SDK con su sesión funcione en la nube, abriendo Análisis con
  una cartera que lleve uno de los fondos parados.
- **11-11 09:39 · Dirección:** **el aviso de serie parada, comprobado en la web** a petición de Óscar («compruebalo tu»),
  en el navegador integrado con su sesión y sin guardar nada. Su cartera activa estaba vacía. Con LU1883342880 (clase
  convertida) y LU1882457143 (su clase A, viva) repartidas a partes iguales, Análisis enseña «Amundi Funds - Global Equity
  C EUR (C) · Serie parada desde el 28/11/2025: sus cifras son de esa fecha o anteriores.» y nada del fondo vivo; en Modo
  cliente, nada. La lectura por el SDK funciona en la nube, que era lo único sin comprobar. Después se quitaron los dos
  fondos con «Quitar», el Modo cliente quedó desactivado y la cartera activa, vacía como estaba.
- **11-11 09:48 · Dirección:** Óscar sale y delega («te doy permiso para lo que tengas que hacer y comprobar… todo lo que
  puedas hacer en paralelo»). Dirección sigue con las barreras: nada en la nube, ningún despliegue, ninguna baja del
  catálogo y ningún push sin petición expresa; lo que se construya queda en local para que él lo publique. **Informe
  semanal y diario**, generados desde la aplicación y leídos: dos hojas cada uno, aviso de IA y sin revisión humana que se
  queda también en Modo cliente (solo se oculta el proveedor), y confirmación de lectura antes de compartir. Salen ajustes
  de forma —títulos sin tilde porque el prompt los pide así, «Japon», «3,80% YoY», «SAA/TAA» en un papel que puede ir al
  cliente— y se encargan (`model: sonnet`, `effort: medium`, único escritor de la app), con los títulos de la ficha PDF a
  12 pt, que estaban pendientes desde el 09-11. **Pregunta 14 para cumplimiento**: si ese informe de IA puede entregarse a
  un cliente y con qué requisitos; añadida a la lista y a la página. En paralelo, la investigación de las once series
  paradas (`sonnet`, solo lectura).
- **11-11 09:52 · Dirección:** **las once series paradas que quedaban sin explicar siguen vivas**: falla EODHD, no el
  fondo. Investigado en solo lectura (`sonnet`, `medium`): las once tienen valor liquidativo de Morningstar del 27 al
  30-10-2026, y EODHD responde 200 con la serie cortada; otras 744 `.EUFUND` están al día. Solo LU0133716950 (Schroder
  Emerging Europe A1) tiene una causa de producto, la suspensión del 25-02-2022 por Rusia, reabierta el 18-07-2022 con
  side pockets. Dirección preguntó a EODHD por ISIN y por nombre, con su clave y sin escribirla: diez no tienen ningún
  otro código, e IE00BF0GL212 tiene `0P0001BO8V.F` (Fráncfort, hasta el 09-11-2026), que es precio de mercado y no valor
  liquidativo; usarla sería una decisión de método, y no se ha tocado. Ninguna baja, ningún sucesor, catálogo intacto.
  Queda para Óscar: escribir a EODHD con la lista, o una fuente nueva para la serie diaria.
- **11-11 10:07 · Dirección:** a petición de Óscar («Mira a ver si encuentras otra fuente»), **Morningstar sirve la serie
  diaria de valor liquidativo de las once**, historia completa, con el servicio `timeseries_price` del mismo servidor y la
  misma clave pública que ya usa `fetchers/morningstar_lt.py`. Investigado en solo lectura (`sonnet`, `medium`), y el
  cuadre repetido por Dirección en tres fondos: miles de días idénticos con EODHD; las dos diferencias de LU1683285321 son
  errores de EODHD. EODHD con el código de Morningstar: 404 en las once. Dos alertas de método: las dos Schroder Emerging
  Europe tienen la reorganización con side pockets del 18-07-2022 (el VL cae de 25,50 a 10,29 y no es rentabilidad), y
  FR0010312660 discrepa 21 días y está en francos antes de 1999 en EODHD. Encajaría como lector nuevo en el extractor,
  solo cuando EODHD esté parado. Es decisión de adquisición (D-1 y D-3) y de método: **no se ha construido nada**; queda
  en la página de cierre para Óscar.
- **11-11 10:13 · Dirección:** **el informe de estrategia y la ficha, hechos en local** (`69d85133` y `e0a8a381`,
  subagente Sonnet 5.5 medio): **A-141**, decidida por Dirección con la delegación de Óscar; índice en A-1 a A-141 y
  `AGENTS.md` al día, con los cinco informes abordados. Regenerados desde la aplicación el semanal y el diario: sin
  «SAA/TAA», títulos con tilde, «Japón», dos hojas. Puertas: 4.709 pruebas y pytest 2.201. Parado todo lo que arranqué.
  **Falta que Óscar publique el sitio y despliegue las Functions** (`admin_publish_report`, con `desplegarFunciones.mjs
  --despliega`) para que el prompt nuevo se use.
- **11-11 10:14 · Dirección:** **página de cierre para la vuelta de Óscar**:
  https://claude.ai/artifact/9PW7EBz3PrBJZezcsTMfCj. Dos órdenes suyas (publicar el sitio y desplegar las Functions con
  `desplegarFunciones.mjs --despliega`), una decisión (Morningstar como fuente de la serie diaria de los once fondos
  parados en EODHD, con las tres reglas de empalme, sustitución y corte de 2022; recomendada, junto con el mensaje a
  EODHD) y lo que solo él puede hacer (mirar los informes con una cartera real, enviar las catorce preguntas, decidir el
  push y archivar los tres remotos viejos). Todo lo construido mientras estaba fuera queda en local, comprobado y parado;
  nada en la nube, nada desplegado, ninguna baja y ningún push.
- **11-11 11:32 · Dirección:** Óscar decide «Sí, Morningstar»: **D-9**, Morningstar como fuente de la serie diaria solo
  cuando la de EODHD se para, con empalme en nueve fondos, sustitución entera en FR0010312660 y corte en el 18-07-2022 en
  las dos Schroder Emerging Europe; índice en D-1 a D-9. Se construye en el extractor y la plataforma, se prueba en local
  y la subida a la nube se pide aparte.
- **11-11 11:52 · Dirección:** Óscar pasa un informe de ChatGPT sobre prioridades del prototipo y el CRM, y aclara que
  **el programa es un prototipo y lo regulatorio no es importante ahora**: irá con el CRM, más adelante, y lo que interesa
  es la funcionalidad. Opinión publicada (https://claude.ai/artifact/FgASTrycAkbdBiE8cU4wQo): se comparte el criterio,
  pero tres de sus cinco mejoras ya estaban hechas, porque el informe no miró el código. Las catorce preguntas de
  cumplimiento quedan apuntadas y sin enviar. Óscar aprueba «Sí, los tres»: unificar las comisiones en «entrada
  (suscripción)» y «salida (reembolso)», la advertencia legal del informe de cliente de 6,3 a 7 puntos, y **el efecto de
  los costes con el tiempo** en el cuadro de Costes, con una rentabilidad supuesta igual para todo (5 % por defecto,
  editable y escrita al lado; nunca la pasada) a 5 y 10 años, sin entrada, operación ni retrocesiones. Encargado (`model:
  opus`, `effort: medium`, único escritor de la app). En paralelo sigue D-9, reanudada tras cortarse la sesión anterior.
- **11-11 12:42 · Dirección:** dos decisiones de Óscar en la otra sesión de Dirección, relayadas por ella y **comprobadas
  en su transcripción**. **Fundamentales de acciones, aplazados** («si, dejalo asi»): no hacen falta para lo que se usa a
  diario, porque las acciones ya tienen serie, métricas, beta y R², sector, industria y dividendos; solo afectan a la
  ficha de una acción, que enseña datos de julio en 312 acciones con su fecha. La propuesta queda escrita para cuando se
  retome: https://claude.ai/artifact/4bof7pDGXSaR3AvZaKJn45. **D-9 ampliada** («Sí, añádelo»): LU0171283459 entra con
  empalme; LU1066281574 y LU2240056445, no. Escrito en D-9 y pasado al escritor de D-9, que sigue siendo el único en
  `1-extractor` y `2-plataforma-datos`.
- **11-11 12:49 · Dirección:** **A-142, hecha en local**: comisiones con un solo nombre, «entrada (suscripción)» y «salida
  (reembolso)»; la advertencia legal del informe de cliente a 7 puntos; y el efecto de los costes con el tiempo en el
  cuadro de Costes, con rentabilidad supuesta del 5 % editable, a 5 y 10 años. Comprobado en la aplicación local y en el
  papel (seis y tres hojas, cifras recalculadas a mano). Puertas: 4.744 pruebas. Índice en A-1 a A-142. Emuladores de la
  app arrancados desde PowerShell: desde Bash fallaron otra vez con código 127. Parado lo mío; la base nueva (8092) sigue
  en marcha porque es del escritor de D-9. **Falta que Óscar publique el sitio**, que ya lleva también el informe de
  estrategia y la ficha (A-141), además de desplegar las Functions.
- **11-11 12:58 · Dirección:** decisión de Óscar en la otra sesión de Dirección, relayada por ella: **LU1066281574** (SIH
  FCP Equity Spain A Classic, hoy «Iberian Equities» en Andbank, con el valor liquidativo parado el 29-09-2026) se queda
  **tal cual** («Ese fondo dejalo tal cual. Se ha creado uno nuevo.»). Ni baja, ni sustitución, ni D-9: Morningstar
  tampoco pasa del 29-09. Conserva su aviso, y desde finales de diciembre le saldrá también el de serie parada. El fondo
  nuevo no se da de alta mientras Óscar no dé su ISIN. El nombre del catálogo se queda desactualizado, a propósito.
- **11-11 13:57 · Dirección:** **D-9, lista para subir.** Las dos Schroder, repasadas en la base local con su
  `usable_from`: cambian 4 documentos, todos de ellas. **Plan en seco contra la nube** (`nube:plan -- --parte catalogo`,
  sin `--escribe`): 49.150 documentos del catálogo, todos validan; se borraría 0. Comparación documento a documento con un
  guion que solo lee: 312 con datos nuevos, todos de los doce (18 nuevos); 1.847 que solo cambian la hora, de la pasada
  local del 10-11 17:04 que no se subió; 46.991 iguales; 0 en la nube y no en local. Página para Óscar con la aprobación y
  dos decisiones (rellenar los huecos de EODHD con Morningstar en LU1683285321, y desbloquear IE00BF0GL212). Nada escrito
  en la nube.
- **11-11 14:32 · Dirección:** **duodécima subida del catálogo, con la serie de Morningstar de D-9**, aprobada por Óscar
  en esta ventana («Sí, sube»). Antes: base local auditada (ningún documento que no valide) y foto de lo de la app en la
  nube (618: 238 de carteras, 376 de retrocesiones y 4 importaciones). `nube:subir -- --parte catalogo --escribe` con su
  puerta: 49.150 documentos escritos en 395 tandas, 0 borrados. La comprobación de la propia subida dio 4 «distintos» de
  7.022 y salida 1, el orden de las claves, como en subidas anteriores. **Comparación completa posterior, solo lectura:
  49.150 iguales, 0 distintos, 0 solo en local, 0 recuentos distintos.** Lo de la app, intacto: 618 antes y después, 0
  distintos. No visto aún en la web: la sesión de Óscar en el navegador se cerró por inactividad. Queda en local la regla
  de los huecos de LU1683285321 y el desbloqueo de IE00BF0GL212 (`d8a68948`), aceptados por Óscar, para una segunda subida
  con su plan.
- **11-11 15:10 · Dirección:** **regla de huecos y cierre de D-9, hecha en local** (`a6b84dcd`): solo cambia LU1683285321,
  que recupera sus métricas propias y pierde el `SHORT_HISTORY` falso; los otros once salen idénticos. Base local: 7
  documentos de diferencia, todos suyos; auditada sin ningún documento que no valide. Plan en seco y comparación con la
  nube: 49.144 iguales, 6 distintos y 1 nuevo, todos de LU1683285321. El desbloqueo de IE00BF0GL212 no cambia nada en la
  base: sale con el despliegue de Functions. D-9 al día. Se pide a Óscar la segunda subida.
- **11-11 15:47 · Dirección:** **decimotercera subida del catálogo**, con la regla de huecos de D-9 (LU1683285321),
  aprobada por Óscar en esta ventana («Sí, sube»). Antes: foto de lo de la app (618) y base local auditada sin ningún
  documento que no valide. `nube:subir -- --parte catalogo --escribe` con su puerta: 49.151 escritos, 0 borrados; la
  comprobación de la subida dio 6 «distintos» de 7.022 y salida 1, el orden de las claves otra vez. **Comparación completa
  posterior, solo lectura: 49.151 iguales, 0 distintos.** Lo de la app, intacto: 618 antes y después. Base local guardada
  con `guardar.mjs` y emulador parado. **Queda en manos de Óscar:** publicar el sitio y desplegar las Functions (corte de
  2022 de las Schroder, desbloqueo de IE00BF0GL212 y prompt de estrategia).
- **11-11 15:53 · Dirección:** Óscar publica el sitio («Publicado, mira»). Comparado fichero a fichero con lo compilado
  (14:50 UTC, después del último commit de la app): 254 de 254 idénticos, con el efecto de los costes, «entrada
  (suscripción)», «Estratégica» y el aviso de serie parada dentro. Las Functions no se pueden comprobar desde los
  ficheros: el corte de 2022 de las Schroder, el desbloqueo de IE00BF0GL212 y el prompt de estrategia se verán en la web
  cuando estén desplegadas. Nada visto aún en la web con su sesión, que se cerró por inactividad.
- **11-11 15:54 · Dirección:** Óscar confirma que también desplegó las Functions («Sí, también»): con ellas, el corte de
  2022 de las dos Schroder en la simulación de carteras y la tarjeta, el desbloqueo de IE00BF0GL212 y el prompt de
  estrategia con tildes y cifras a la española. No comprobado en la web por Dirección: la sesión del navegador integrado
  sigue cerrada. Hoy queda todo lo construido publicado: informes de cliente, comparativa, costes, interno y estrategia;
  propuesta de referencia; aviso de serie parada; comisiones y advertencia legal; efecto de los costes; y la serie de
  Morningstar de doce fondos en la nube.
- **11-11 15:58 · Dirección:** **comprobado en la web** a petición de Óscar («compruebalo»), en el navegador integrado con
  su sesión y sin guardar nada. La ficha de LU1683285321 enseña nuestras cifras (volatilidad 19,19 %, 22,96 % y 26,60 %)
  sin aviso de serie parada; la de IE00BF0GL212, sin parada ni bloqueo. Cartera de prueba sin guardar con LU0592699093,
  IE00BF0GL212 y LU1683285321 a partes iguales: Análisis mide el 100 % del peso, hasta el 06-11-2026, sin dejar fuera
  ninguno y sin avisos de serie parada; el cuadro de Costes enseña el efecto de los costes (1,95 % al año; a 10 años,
  16.289 € sin costes y 13.373 € con costes por cada 10.000 €). Después, «Quitar» de los tres: la cartera activa, vacía
  como estaba, y el Modo cliente, desactivado.
- **11-11 16:05 · Dirección:** Óscar pide terminar lo que quedaba («termina las 3»). **Subidos a GitHub los 60 commits**
  (remoto y local en `66e62444`); **archivados los tres repositorios viejos** (`-extractor`, `-datos` y `-app`, comprobado
  `isArchived: true`), y el único sigue activo. **D-10**, decidida por Dirección por su encargo: Morningstar entra también
  para cualquier fondo con valor liquidativo y SecId cuya serie de EODHD se pare, si llega más lejos, cuadra en nivel y no
  hay ruptura; siempre con empalme, y lo que tenga ruptura queda para decidir; índice en D-1 a D-10. Se construye en el
  extractor (`opus`, `high`, único escritor de `1-extractor`) para el siguiente refresco, sin pasada ni subida. Aviso a la
  copia de Dirección [53e6c3], abierta y quieta, para que no repita nada de esto.
- **11-11 16:24 · Dirección:** **D-10 construida** en `4f2bb298`. Revisada y con las pruebas repetidas: pytest del
  extractor 1.413 y ruff limpios. Hoy no entraría ningún fondo por el automático: de 19 parados, 12 van por la lista y 7
  quedan fuera, por las salvaguardas. Dos fondos vivos, LU2002383896 (Allianz Credit Opportunities Plus, 14 días de
  retraso) y LU0251661590 (AXA WF Euro Long Duration Bonds, 25 días), se quedarán sin métricas propias en el próximo
  refresco si EODHD sigue retrasado, porque Morningstar no tiene su serie. Sin pasada ni subida. Subido a GitHub.
- **11-11 20:31 · Dirección:** a la pregunta de Óscar por las «N/D» del solapamiento: salen cuando a un fondo del par le
  falta más de la mitad de su cartera. Unos 193 fondos y ETF solo publican sus diez mayores posiciones, de 40 gestoras
  (144 de Luxemburgo). Dos encargos. (1) **La limpieza de la matriz** («Sí, empieza»): solo los fondos medibles, y debajo,
  qué no entra y por qué; ninguna cifra cambia (`opus`, `medium`, único escritor de la app). (2) **B-79** («Solo del
  asesor»): la cartera completa de los 19 ETF que publica su emisor, solo en lo que ve el asesor, guardada aparte de
  `declared/holdings` y sin ETF sintéticos; índice en B-1 a B-79. Primero el extractor y la plataforma en local (`opus`,
  `high`); la app, después de la matriz.
- **11-11 20:52 · Dirección:** **la matriz de solapamiento, limpia** en `7191d570` (subagente Opus 5.5 medio). Solo entran
  los fondos que publican al menos la mitad de su cartera, y debajo va «Fuera de la matriz:», con cuánto publica cada uno,
  las acciones en directo y lo que no se pudo leer. Ninguna cifra cambia, y las mismas palabras salen en pantalla
  (Analítica avanzada) y en el informe interno (4.2). El informe de cliente no lleva matriz. Comprobado desde la
  aplicación con la cartera mixta: en pantalla, cuatro fondos y ninguna «N/D»; en el papel, la matriz de cuatro con sus
  números de posición y la lista con DPAM al 42,1 % y Neuberger. Puertas del subagente: 4.751 pruebas. Pendiente de
  publicar. Sigue en marcha B-79 en el extractor y la plataforma.
- **11-11 21:11 · Dirección:** **B-79, la parte de datos, hecha en local** (`1259d20b` del extractor y `f97834db` de la
  plataforma, subagente Opus 5.5 alto). 18 de los 19 ETF ya tienen la cartera del emisor en la base local, en
  `declared/issuer_holdings` y `issuer_holdings_chunks`, aparte de `declared/holdings`, con `audience: ADVISOR_ONLY`: 93
  documentos nuevos y ninguno de otro instrumento; auditoría a cero. El iShares alemán DE0005933956 no se pudo leer. No
  hay ningún ETF sintético entre los 19. `nube:subir` los deja fuera salvo con `--con-cartera-del-emisor`. Dirección
  decide, por ser una convención y no un criterio, que en iShares el peso es el valor de mercado de cada línea sobre la
  suma de la lista: es lo que publica iShares, sin el redondeo que dejaba el Global Aggregate en el 75,7 %. Arranca la
  parte de la app (`opus`, `medium`, único escritor): solo en Análisis fuera del Modo cliente y en el informe interno, con
  una prueba de barrera para los papeles de cliente.
- **11-11 21:50 · Dirección:** **B-79 en la app**, hecha en local en `8d06054b` (subagente Opus 5.5 medio) y comprobada
  por Dirección con las dos bases levantadas, en una cartera de prueba con iShares Core MSCI World, Vanguard S&P 500,
  iShares MSCI World Dist y Brandes. **Como asesor**, los cuatro entran en la matriz: los dos World coinciden en al menos
  un 98,3 %, World y S&P 500 en al menos un 58,7 %, y contra Brandes entre un 5,2 y un 5,8 %; cada ETF dice «cartera del
  emisor, a 06/11/2026» y Vanguard «a 30/09/2026». **En Modo cliente**, cero lecturas del emisor, y los ETF fuera de la
  matriz con su 26-38 % publicado. **Informe de cliente**: ninguna mención al emisor. **Informe interno**: «Cartera
  completa del emisor, no la del proveedor:» con los tres ETF y su fecha. Barrera de los papeles de cliente, en prueba.
  Puertas con las bases levantadas: 4.785 pruebas. Plan en seco de la subida (`--parte catalogo
  --con-cartera-del-emisor`): 49.244 documentos; nuevos, 18 `declared/issuer_holdings` y 75 `issuer_holdings_chunks`;
  ningún borrado nuevo. Se pide a Óscar la subida.
- **11-11 22:10 · Dirección:** **subida de la decimocuarta tanda, aprobada por Óscar en esta ventana** («Si»): `npm run
  nube:subir -- --parte catalogo --con-cartera-del-emisor --escribe`, con su puerta. 49.244 documentos escritos, 93 de
  ellos nuevos (18 `declared/issuer_holdings` y 75 `issuer_holdings_chunks`); recuentos por grupo iguales en la nube y en
  local. La comprobación por muestreo de la subida dio «2 distintos»: Dirección comparó los 49.244, solo leyendo y con una
  copia temporal del script que no escribe y ya está borrada. Resultado: 49.244 iguales en contenido, 0 ausentes, y 30 que
  difieren solo en el orden de las claves dentro del documento. Sin borrados nuevos; carteras y retrocesiones fuera de la
  subida. Base nueva local parada, con el volcado intacto. **Falta que Óscar publique el sitio** (matriz de solapamiento y
  B-79 en la app).
- **11-11 23:17 · Dirección:** Óscar publica el sitio con la matriz sin N/D y B-79. Comparado fichero a fichero con lo
  compilado: 255 de 255 idénticos. **Visto en la web** con su sesión y sin guardar nada (su cartera activa estaba vacía):
  con iShares Core MSCI World y Vanguard S&P 500 al 50 %, la matriz los mide, «al menos 58,0 %», con «cartera del emisor,
  a 06/11/2026» y «a 30/09/2026». En Modo cliente no aparece nada del emisor y los dos quedan fuera de la matriz, con su
  27,8 % y 39,0 % publicados. Después, Modo cliente desactivado y cartera activa vacía, como estaba.
- **12-11 13:40 · Dirección:** **la matriz de solapamiento vuelve al informe de cliente** (A-136 actualizada, `3698e166`).
  La empezó un subagente Opus 5.5 que se quedó sin cuota antes del commit; Antigravity arregló los nombres cortados (el
  «…» de react-pdf juntaba las palabras) y Óscar terminó el resto con ChatGPT, fijando el corte: solo los cruces de más
  del 50 % antes de redondear, con las frases completas delante y «Posiciones no comparables» debajo; si no cabe bajo las
  crisis, una reducida de hasta seis fondos por los pares más altos. Solo la cartera del proveedor (B-53, B-79). Revisado
  en Antigravity: puertas en verde (typecheck, 4.803 pruebas y 5 omitidas, build, deadCssD3, lint) y la hoja 05 mirada en
  imagen con 10, 15 y 25 posiciones. Hojas: seis hasta 10 posiciones; 7 con 15 y 8 con 25. **Sin comprobar con datos
  reales desde la aplicación; sin push y sin publicar.**
- **12-11 13:59 · Dirección:** **umbral único del 40 % y lenguaje común en la matriz del informe de cliente** (decisión de
  Óscar, `a5cd6248`, A-136 actualizada). La matriz usa `SOLAPAMIENTO_ALTO` (40 % o más), igual que las frases y el informe
  interno; la nota explica qué significa el blanco («En blanco: la diagonal, y los cruces medidos por debajo del 40 %.»);
  debajo de la matriz se nombran los demás fondos comparables que no comparten el 40 % o más con ningún otro, y luego
  «Fuera de la matriz:» (`FUERA_DE_LA_MATRIZ`). Puertas en verde (typecheck, 4.803 pruebas y 5 omitidas, build, deadCssD3,
  lint) y la hoja 05 comprobada en imagen; sigue en seis hojas hasta 10 posiciones. **Sin comprobar con datos reales desde
  la aplicación; sin push y sin publicar.**
- **12-11 19:59 · Dirección (sesión original):** revisada y cerrada **la matriz de solapamiento del informe de cliente**
  que se hizo por otra vía (`3698e166` y `a5cd6248`). Generada desde la aplicación local con cuatro carteras: muestra de
  8, 10 fondos, 15 fondos y 4 ETF. Seis hojas hasta 10 posiciones y siete con 15; ninguna «N/D» ni nada del emisor (B-53,
  B-79): los ETF que solo publican sus diez mayores quedan en «Fuera de la matriz:». En estas cuatro carteras ningún par
  llega al 40 %, así que la matriz no se dibuja: solo salen las frases y la lista. Matriz dibujada, vista solo en las
  imágenes de prueba de la otra vía. Un detalle de texto: sin matriz, el rótulo «Fuera de la matriz:» se lee raro. Puertas
  repetidas: `tsc -b`, 4.803 pruebas, compilación, censo de CSS y lint, limpios. Sin publicar. Óscar pide además cambiar
  la columna de costes del informe de cliente por la rentabilidad por dividendo, en espera de que la app quede libre de la
  copia [ba2a15], que está con NH.
- **12-11 21:07 · Dirección (copia [430f83]):** revisado `28886b51` (el ETF sintético deja de figurar como «no publica») y
  vista por fin **la matriz del informe de cliente dibujada con datos reales**. **La matriz:** generada desde la app local
  con una cartera de 8 que lleva dos clases de Polar Capital y dos de Goldman Sachs Europe CORE. Seis hojas; las frases
  nombran los dos pares de más del 40 %, y la matriz, que entera no cabe bajo las crisis, sale reducida: «2 de 4 fondos
  con cruces del 40 % o más», con la nota de que se priorizan los pares mayores, los otros comparables y «Fuera de la
  matriz:». Funciona como se declaró. **El sintético: el arreglo es correcto pero no llega al caso de Óscar.** La línea de
  Invesco (IE00B3Q19T94) es «TRS EURO STOXX Optimised Banks» con código `ST` al 100 %. Hoy cae como derivado, el fondo se
  queda en 0 % medible, y con `28886b51` pasaría a «permuta». Pero en la base nueva, que es la de la web, **no hay
  `declared/holdings` para ese fondo**: el mapper solo escribe la cartera si Morningstar da un recuento de acciones o
  bonos, y un ETF por swap no tiene ninguno (`NOT_PROVIDED`). Así que en la web cuenta como «sin cartera», y la frase
  resumen lo cuenta entre los que «no publican al menos la mitad». Tampoco hay réplica del proveedor en la base:
  `identificacion.replicacion` no pasa de la extractora (`product` es cerrado en `instrument.v2`). Además, el informe de
  cliente y el interno no pasan la réplica a la matriz: solo lo hace Análisis. El «en los dos papeles» del mensaje del
  commit dice más de lo que hace. Son cinco ETF sintéticos según Morningstar, todos con una sola línea `ST` al 100 %:
  IE00B3Q19T94, IE00B3YCGJ38, LU1681037609, LU1900068161 y LU1900068328. **A decisión de Óscar:** traer la réplica de
  Morningstar a `product.replication` (contrato, mapper, app en los dos papeles y una subida del catálogo). En local, la
  base vieja trae esa línea sin código y cuenta el swap como título: es un defecto solo de desarrollo. Puertas: `tsc -b`
  limpio; 4.815 pruebas, con 3 en rojo. Dos son tiempos agotados por generar PDF a la vez, y pasan solas (59 de 59). La
  tercera es `precioCongelado`, por el `fund_history_policies.json` sin commit de otra sesión, que no he tocado. Levanté y
  cerré Firestore, Auth, Functions y Vite de la base de siempre; el 8092 no es mío y sigue en marcha. Nada escrito en la
  nube.
- **12-11 21:33 · Dirección (copia [ba2a15]):** **NH Hotel Group se queda dado de alta a 6,50 € constante, como único caso
  (B-80).** Óscar: «vamos a valorarlos a ese precio constante. Es como único caso excepcional que vamos a dejar». **La
  app**, en `d2ccfcdd` (subagente, `model: opus`): se reconoce por la marca `PRICE_FROZEN_DELISTED` con `frozen_price`, no
  por el ISIN; se puede añadir a una cartera, se mide en Análisis y en los informes, y queda fuera de Optimizar, el
  generador y Mejorar cartera (pendiente de que Óscar lo confirme). **La serie**, que en la base nueva no estaba, en
  `b3bcbeb7` (subagente, `model: opus`, `effort: high`): EODHD la daba desde el 10-11, pero sin nombre, y la guarda de
  calidad la paraba; dos correcciones declaradas en `correcciones.json` (nombre y país). 8.426 puntos de 1991 al
  24-09-2025, iguales día a día a los de la base de siempre; última sesión real el 15-09-2025 a 6,50 €.
  **`frozen_price.from` pasa de 2025-09-25 a 2025-09-15** con las tres pruebas que lo fijaban, en `77ba59c6`: con la fecha
  vieja la serie de EODHD, que acaba el 24-09, no se habría prolongado. Base nueva local: 4 documentos cambiados y 37
  nuevos, todos de NH, ninguno fuera; auditoría limpia con 49.899. Plan en seco y comparación con la nube: solo NH.
  Puertas: pytest de Functions 2.237 pasan; vitest de `precioCongelado` y la barrera de BDB, limpios. **Seguridad, fuera
  de NH:** los registros del extractor guardan la clave de EODHD en claro en la URL; están en `.gitignore` y nunca han
  entrado en Git. **A Óscar:** subir el catálogo, confirmar el optimizador y 6,50 frente a 6,51; después, Functions y
  sitio, juntos, cuando la carpeta de la app esté limpia. Nada en la nube, nada desplegado ni empujado.
- **12-11 21:30 · Dirección (sesión original):** **A-143**, el informe de cliente sin costes. Fuera la columna, la línea
  del coste medio, la frase de las rentabilidades netas y la entrada de la guía. En su lugar va «Rent. dividendo prevista»
  en las acciones, con «No aplica» en fondos y ETF. Bajo las cifras queda solo el tipo sin riesgo, y el anexo pasa a una
  línea con la parte medida. Lo pagado en doce meses no se usa porque el proveedor no lo da fiable: 45 acciones con cero
  falso y suizas en dólares. En `c846465d` (subagente) y `b508d436` (Dirección), que lleva la cifra también a la app
  publicada por el lector de la base nueva: 497 de 526 acciones. Comprobado desde la aplicación local con cuatro carteras,
  puertas limpias. Para la web hay que publicar el sitio y las Functions. También en commit, de otras copias: `5e0a9d32`
  (traspasos en divisa en Rendimiento) y `77ba59c6` (NH).
- **12-11 21:35 · Dirección (sesión original):** la ficha de la acción rotula su rentabilidad por dividendo como
  «prevista», igual que el informe de cliente (A-143, `b3d806cd`, «Sí, corrígelo» de Óscar). Las rentas de los fondos
  siguen como estaban. La fila «Pagado en 12 meses» de la ficha sigue enseñando el importe del proveedor, con los ceros
  falsos y las suizas en dólares: queda para la pieza de los dividendos pagados. Todas las pruebas pasan; sin ver en
  pantalla ni publicar.
- **12-11 21:36 · Dirección (sesión original), por la copia [dc3c94b3]:** Rendimiento admite **varios extractos de
  movimientos** de la misma cuenta, encadenados por el saldo, y bloquea las cifras si las operaciones van más de 10 días
  por detrás (`e8971270`, aprobado por Óscar en esa ventana). Necesita Functions y sitio. Lo que sigue bloqueando a ese
  cliente lo lleva esa copia: activos vendidos sin identificar, instrumentos que faltan en el catálogo (ADR, un ETC y
  varios fondos), derechos y acciones de dividendos en acciones que piden decisión, dos ETF en cuarentena de divisa y
  traspasos sin fecha. Aquí no se nombran posiciones del cliente (B-77).
- **12-11 21:41 · Dirección (copia [430f83]):** **B-81, la réplica de Morningstar llega a la base nueva y a los dos
  papeles** (Óscar: «Sí, tráelo»). Plataforma: `product.replication` en `instrument.v2` (`PHYSICAL_FULL`,
  `PHYSICAL_SAMPLING`, `SYNTHETIC`), con la tabla `REPLICA` y el mapper. «NOT Applicable» se queda ausente (C-17) y un
  literal nuevo se anota sin parar la ficha; el extractor no cambia, porque su export ya trae el dato. Servidor:
  `map_asset_detail` manda solo la réplica (`product: {replication}`). Antes el bloque de producto no viajaba, y por eso
  `product_profile.replication` no le llegaba nunca a la app, tampoco a Análisis. App: `conLaReplica` pone la réplica de
  la ficha a cada posición del informe, y la usan el de cliente y el interno. AssetDetail la escribe en español. **Base
  nueva local:** 37 instrumentos escritos con `--ids` y verificados (1.143 documentos, 0 distintos), guardado con
  `guardar.mjs`. Leído con el propio `compare_assets` del servidor contra el 8092: IE00B3Q19T94 trae `SYNTHETIC` y ninguna
  cartera, que es el caso de la web, y con eso la frase dice «replica su índice con una permuta». Pruebas nuevas: 6 casos
  del mapper y el contrato en la plataforma, 2 en Python y 3 en la app, entre ellas el caso de la web entero. Puertas:
  plataforma 1.479; app `tsc -b`, 4.821, build, censo y lint; Python 2.250; todo en verde. **Aviso a [ba2a15]:** escribí
  en el 8092 antes de que pidiera no hacerlo para su subida de NH; esos 37 ids no van con NH. **Falta, de Óscar:** la
  subida del catálogo con el campo, el despliegue de las Functions y el del sitio. Sin probar en la web. Sin push.
- **12-11 22:06 · Dirección (copia [430f83]):** **B-81 en la nube.** Subida única con NH, hecha por la copia [63470a4c]
  con las dos aprobaciones de Óscar («Sí, sube» y «Sí, súbelos»), tras comparar por contenido: solo cambian las 37 raíces
  y los 41 de NH, y en los subdocumentos de los 37 solo sellos de fecha. Leído después en la nube, solo lectura: 5
  `SYNTHETIC` (IE00B3Q19T94, IE00B3YCGJ38, LU1681037609, LU1900068161, LU1900068328), 16 `PHYSICAL_FULL`, 12
  `PHYSICAL_SAMPLING` y 4 sin código. Dos de esos cuatro son los «NOT Applicable», a propósito (C-17). Los otros dos son
  QQQ (US46090E1038) y SPY (US78462F1030), que no tienen bloque `product` porque su domicilio USA no se traduce: es
  anterior a B-81. Para que la frase de la permuta se vea en la web faltan las Functions y el sitio, que despliega Óscar.
  Sin push.
- **12-11 22:07 · Dirección (sesión original), por la copia [dc3c94b3]:** Rendimiento identifica los activos vendidos con
  el ISIN del export de operaciones del banco, por nombre o enlazando cada movimiento con su operación (tipo, fecha ±3
  días, importe al céntimo y títulos). Las acciones nuevas de una ampliación liberada van a su línea principal y los
  derechos de suscripción no se miden. Las compras y ventas enlazadas toman los títulos del banco, porque el extracto
  corta el concepto a 30 caracteres (`26c50906`, aprobado por Óscar en esa ventana, solo Functions). Con el cliente real
  quedan identificados todos los vendidos y las posiciones sin fecha bajan de 12 a 2. Lo que sigue bloqueando es del
  catálogo: 11 instrumentos que no están en la base y 2 ETF en cuarentena de divisa. Los ISIN no se escriben aquí (B-77) y
  la lista la tiene esa copia. Sin publicar.
- **12-11 22:20 · Dirección (copia [ba2a15]):** **NH subido a la nube, en una sola subida con los 37 de B-81.** Óscar, en
  esta ventana: «Sí, sube»; los 37, aprobados en la de la copia [312357b5] («Sí, súbelos», comprobado en su
  transcripción), que no escribió en la nube. Antes de subir, comparación por contenido contra la nube: los 4 cambiados y
  37 nuevos de NH; en los 37, las raíces (33 con `product.replication`, el resto solo sellos) y en sus subdocumentos solo
  `package_id` y `computed_at`; fuera de eso, nada. `nube:subir -- --parte catalogo --escribe` con la puerta: 49.188
  documentos; su postverify dio los 5 «distintos» de siempre por el orden de las claves y `declared` con los 18 de B-79 de
  más en la nube. Comparación completa después: 49.281 iguales, 0 distintos, 0 solo en local. Carteras y retrocesiones:
  694 documentos con la misma huella antes y después. El 8092 era de la copia [dc3c94b3] y sigue en marcha; no lo paré.
  Árbol limpio en `9a2e19e3`: **a Óscar, desplegar Functions y sitio**, que llevan la excepción de NH (`d2ccfcdd`,
  `77ba59c6`) y lo de B-81. Nada desplegado ni empujado.
- **12-11 23:05 · Dirección (copia [ba2a15]):** **NH comprobado en producción** tras el despliegue de Óscar («Desplegado,
  mira»). El sitio servido nombra los mismos ficheros que `4-base-nueva/sitio/` compilado a las 22:48, que lleva el precio
  congelado. En la web, con la sesión de Óscar y sin guardar nada: la ficha dice «Sin negociación desde el 15/09/2025 ·
  valorado a 6,50 € por decisión», «Añadir a cartera» funciona y el gráfico llega a noviembre de 2026, prolongado por la
  Function de series. Una cartera de prueba en Diseño, 90 % IE00B4L5Y983 y 10 % NH, sin guardar y vaciada después:
  Análisis la simula del 3-11-2023 al 6-11-2026 con el 100 % del peso, 2 invertibles y 0 excluidas, «Restricciones: se
  cumplen», y NH aporta un 1,2 % del riesgo. **Defecto:** a NH le salta el aviso de B-78, «Serie parada desde el
  24/09/2025: sus cifras son de esa fecha o anteriores» (`src/core/serieParada.ts`), que contradice la excepción; en los
  papeles de cliente saldría «Sus datos llegan hasta el 24/09/2025». A decisión de Óscar.
- **12-11 23:20 · Dirección (copia [ba2a15]):** **NH sin el aviso de serie parada** (Óscar: «Sí, cámbialo»), en
  `f7a58454`. Donde iría «Serie parada desde el 24/09/2025» (Análisis, punto del informe interno y su tabla) o «Sus datos
  llegan hasta el 24/09/2025» (informe de cliente, costes, notas de la comparativa y de la propuesta), NH lleva la frase
  de su ficha, «Sin negociación desde el 15/09/2025 · valorado a 6,50 € por decisión», con la fecha de la política. Se
  decide en `src/core/serieParada.ts` (`textoSiCongelado`, que lee `precioCongelado`), y los tres papeles pasan el
  instrumento; las demás series paradas no cambian. Pruebas nuevas en `tests/serieParada.test.ts`, también mezclando NH
  con una parada de verdad. Puertas: `tsc -b`, 4.826 pruebas, compilación, censo de CSS y lint, limpios. Solo cambia el
  sitio, no las Functions. **A Óscar: publicar el sitio.** Sin ver todavía en la web.
- **12-11 23:25 · Dirección (copia [ba2a15]):** **NH cerrado en producción.** Óscar publicó el sitio («Publicado, mira»):
  el servido nombra los mismos ficheros que `4-base-nueva/sitio/`, compilado a las 23:14, después de `f7a58454`. En la
  web, con la cartera de prueba de antes (90 % IE00B4L5Y983, 10 % NH), sin guardar y vaciada después: Análisis dice «NH
  Hoteles · Sin negociación desde el 15/09/2025 · valorado a 6,50 € por decisión.» y no queda ningún «Serie parada». Los
  papeles no se han generado en la web; su texto lo cubren las pruebas. Siguen abiertas, sin respuesta de Óscar, las dos
  de la página: NH fuera del optimizador (como está) y 6,50 frente a 6,51 (6,50).
- **12-11 23:30 · Dirección (copia [ba2a15]):** Óscar confirma las dos que quedaban de NH («Sí, así»): fuera de Optimizar,
  el generador y Mejorar cartera, y valorado a 6,50 €. Anotado en B-80. NH queda cerrado.
- **13-11 04:20 · Jubilación (sesión [20241c], encargo directo de Óscar):** módulo nuevo en la app, **Planificación →
  Jubilación** (`/jubilacion`), commit `4a92c04e`: el simulador de jubilación de NUVIA traído con su motor y sus reglas
  fiscales de 2026 a `src/core/jubilacion/` y rehecho para el asesor, con su informe en papel de cliente. Comparado con el
  original el día que se trajo —4.000 simulaciones y 20.000 liquidaciones de IRPF, sin una diferencia— y con la suite entera
  en verde (4.900; 72 del módulo). Solo ha escrito en `3-BDB-ACTIVOS_app/` y en `AGENTS.md`; **no ha tocado NUVIA**, que se
  leyó y nada más. No hay push ni despliegue: en la web no está hasta que Óscar lo pida. **Procesos que arrancó esta sesión
  y deja en pie:** emuladores de la base de siempre (Firestore 8082, repoblado desde la copia con PASS; Auth 9097, con su
  usuario local sembrado; Functions 5005) y Vite 5174. El de la base nueva (8092) no se arrancó: la batería da por eso
  `ERR_CONNECTION_REFUSED` en Buscador, Análisis y Sistema, que no son de este cambio. A Óscar: dos defectos del simulador
  de NUVIA encontrados al traerlo (jubilados de más de 75 años, y la frase de las escalas fijas), por si quiere corregirlos allí.
- **13-11 06:40 · Jubilación (sesión [20241c], que dirige ella misma por encargo de Óscar):** la rama está **subida** a
  GitHub desde que Óscar lo pidió (`3641601f`), y lo de hoy también. Commit `b5d0a35d`: junto a la edad del plan, la
  pantalla y el informe dicen **cuántas personas de la edad y el sexo del cliente llegan a ella**, con la tabla de
  mortalidad del INE de 2024 (tabla 27153, consultada el 13-11). No entra en el cálculo y no se planifica hasta la
  esperanza de vida. Con él: el límite que faltaba por decir (un solo contribuyente), y
  `tests/jubilacionParidadConNuvia.test.ts`, que compara motor y reglas con los de NUVIA y solo corre con `NUVIA_DIR`.
  «Tomar de la cartera activa», que estaba probado con una fuente simulada, probado contra la base local real: 256.000 € y
  144.000 € de 400.000 €, exacto. Suite 4.906 en verde y 18 capturas sin incidencias. **En NUVIA, por orden de Óscar
  («Sí, corrígelos»):** los dos defectos corregidos en su copia de trabajo, con prueba y acta
  (`docs/JUBILACION_CORRECCION_MAYORES_75_20261113.md`), **sin commit ni publicación**: su web sigue con ellos hasta que
  Óscar lo ordene. El defecto era mayor de lo anotado: además de la pensión y el IRPF, repartía los ahorros en más años.
  Preguntas de cumplimiento: una decimoquinta, de Jubilación, y la octava ampliada. Siguen en pie los emuladores de la
  base de siempre y Vite 5174. A Óscar: publicar el sitio del Gestor, que solo añade Jubilación, y decidir si se publica
  la corrección de NUVIA.
- **13-11 07:40 · Jubilación (sesión [20241c]):** commit `db9dd79a`. La pantalla y el informe pasan a ir **primero la
  respuesta y después las cuentas**: Óscar pidió una salida más clara que la de NUVIA y eligió sobre una propuesta visual.
  Una sola cifra —lo que le queda al cliente al mes— con las cinco líneas que la explican, los escenarios en frases, los
  gráficos junto al formulario y, debajo, «Las cuentas, para comprobarlas»: el detalle fiscal, la tabla de cada año y el
  método. En el informe, la respuesta entera en la primera hoja y las cuentas como anexo. No cambia ningún cálculo.
  `--fs-respuesta` (60 px) es un tamaño nuevo, fuera de la escala de la dirección a propósito y anotado en ella. Las
  cuentas **no** se ocultan en Modo cliente, aunque llegué a recomendarlo: la decisión A-19 deja siempre lo que hace falta
  para leer una cifra. Suite 4.910 en verde y 18 capturas sin incidencias. **NUVIA:** Óscar deja como están los cambios
  hechos allí (sin commit ni publicación) y fija la regla: es un proyecto aparte y desde aquí no se toca ni se propone
  tocarlo; lo que se vea allí se le cuenta y va a una sesión de NUVIA. A Óscar: publicar el sitio.
- **13-11 07:38 · Jubilación (sesión [20241c]):** **Óscar publica el sitio** (`node 4-base-nueva/compilar-sitio.mjs` y
  `firebase deploy --only hosting` desde `4-base-nueva`; compilación de las 07:36, con la app en `db9dd79a`). Comprobado
  desde aquí leyendo la web: el índice publicado nombra los mismos ficheros que el del disco, y
  `JubilacionPage-BHQ12tWV.js` responde 200 y lleva la pantalla nueva («Las cuentas, para comprobarlas»). Functions sin
  cambios: Jubilación calcula en el navegador. **Sin comprobar:** «Tomar de la cartera activa» contra la base de la nube;
  hace falta entrar con la cuenta de Óscar. La rama está subida hasta `4e5a49c8`; esta línea, no.
- **13-11 07:43 · Jubilación (sesión [20241c]):** Óscar prueba en la web publicada «Tomar de la cartera activa» y
  **funciona** contra la base de la nube. Era lo único de Jubilación sin ver en producción: el módulo queda publicado y
  comprobado. Pendiente, sin fecha: las reglas del IRPF de 2027, en enero, y la publicación de la corrección de NUVIA, en
  una sesión suya.
- **13-11 08:32 · Jubilación (sesión [20241c]):** dos cierres. **La batería oficial, entera y con la base nueva en
  pie:** 72 capturas (doce rutas, seis anchos), 0 incidencias. Los `ERR_CONNECTION_REFUSED` de Buscador, Análisis y
  Sistema del primer día eran, como se supuso, por tener parado el emulador del 8092. **Queda arrancado por esta sesión**
  (`node 4-base-nueva/arrancar.mjs`, con su volcado importado; no se ha escrito nada en él), junto a los de la base de
  siempre y Vite 5174. **Y la A-145, commit `86db67ad`:** Jubilación dice que es una simulación junto a la cifra, y que las
  rentabilidades se eligen para simular, no se prevén ni se prometen. Es el criterio de Óscar sobre las preguntas 8 y 15
  de cumplimiento, anotado bajo ellas como suyo y no como respuesta de cumplimiento. La web publicada lleva la pantalla
  nueva pero sin estos textos: a Óscar, publicar el sitio otra vez. Sin subir a GitHub.
- **13-11 08:36 · Jubilación (sesión [20241c]):** **Óscar publica el sitio otra vez** (compilación de las 08:35, con la
  app en `86db67ad`). Comprobado leyendo la web: el índice publicado nombra los mismos ficheros que el del disco, y los
  dos trozos de Jubilación llevan los textos de la A-145: «Rentabilidades elegidas para simular, no previstas ni
  prometidas» y «Se eligen para simular» en la pantalla, y «Simulación de jubilación» en el informe. La rama está subida
  hasta `a0b90d88`; esta línea, no. Jubilación queda publicada entera. Sigue abierto, sin fecha: las reglas del IRPF de
  2027, en enero, y la publicación de la corrección de NUVIA, en una sesión suya.
- **13-11 09:58 · Planes y EPSV (sesión [20241c], encargo directo de Óscar; decisión D-11):** catálogo **aparte** de
  planes de pensiones y EPSV, de punta a punta y en las tres carpetas, porque Óscar lo encargó a esta sesión entera; no
  había otra sesión escribiendo (`ListAgents`: todas fuera de línea o en reposo) y `git status` solo tenía lo suyo.
  Tres commits: extractor `6a6cbfb9` (`python main.py planes`: la lista del buscador de planes del banco —Morningstar,
  220 productos— y la serie de cada uno, a `export_planes/planes.json`, que no va al repositorio); plataforma y base
  nueva `008959bf` (dos contratos, `pension_plans/{id}` y su `series/monthly`; `npm run planes:plan` / `planes:write`;
  parte propia `--parte planes` en la subida; regla de lectura con sesión); y app `1a169852` (**Planificación → Planes y
  EPSV**, en `/jubilacion/planes`: buscador, ficha con la evolución del valor de la participación y comparación de hasta
  cuatro, sin cálculos ni recomendación). **Medido:** 202 planes de pensiones (9 de empleo simplificados) y 18 EPSV, los
  220 clasificados por dos señales que coinciden y los 220 con serie; escritos en el emulador de la base nueva, 440
  documentos con 0 ausentes, 0 distintos y 0 inválidos; `audit:base-nueva` entera en verde (50.526 documentos) y el
  volcado guardado. Contraste con las tres fichas en PDF de Óscar: 13 de 14 cifras iguales; la que no, la comisión de
  una EPSV (1,55 % en su ficha, 1,51 % en el buscador del banco), que es por lo que la pantalla remite al documento de
  datos fundamentales. **Puertas:** extractor 1.442 y ruff; plataforma 1.495 y typecheck; app 4.962, typecheck, lint,
  compilación con presupuesto y censo; batería oficial en 1440 y 768, 26 rutas y 0 incidencias, y la pantalla en los seis
  anchos. **Lo que NO está hecho:** nada en la nube. Faltan, y son de Óscar: desplegar las reglas, subir
  `--parte planes` (sin ensayar contra la nube) y publicar el sitio; hasta entonces la pantalla publicada no existe y,
  si se publicara solo el sitio, daría 403 al leer. Sin subir a GitHub. **Dos cosas vistas de paso, sin tocar:** un
  caso de `4-base-nueva/probar-reglas.mjs` está en rojo desde antes («el filtro de la app y la regla» busca en
  `baseNuevaLecturaSdk.ts` una consulta de `targets` que ese fichero ya no tiene); y dos productos de la lista del banco
  que conviene mirar: BSG Prometeo PP, sin valor publicado desde el 05-06-2024, y Dunas Valor Flexible I PP, con
  comisión de gestión 0,00 % en el buscador del banco.
- **13-11 10:05 · Planes y EPSV (sesión [20241c]):** **subido a GitHub** por orden de Óscar («Sí, súbelos»): la rama
  está en `a25834e1` (`19960a8f..a25834e1`, los cuatro commits de D-11), con el remoto sin moverse desde la última subida.
  Esta línea, no: irá con la siguiente. **Sigue sin estar en la nube**: la subida de `--parte planes`, las reglas y el
  sitio son de Óscar, en ese orden.
- **13-11 10:15 · Planes y EPSV (sesión [20241c]):** **Óscar sube los planes, despliega las reglas y publica el sitio**
  («desplegado»; compilación de las 10:07). Comprobado desde aquí, solo leyendo: **el sitio**, el índice publicado nombra
  los mismos ficheros que el del disco, `PlanesPage-Dgqd-RXL.js` responde 200, es idéntico al del disco y lleva la
  pantalla («Planes y EPSV», «Para comparar», la lectura de `pension_plans`), y dentro del sitio no hay ningún dato de
  planes; **las reglas**, `npm run nube:reglas` dice que la release activa (publicada a las 09:08:18Z) es igual al
  fichero local, 17.408 bytes; **los datos**, `npm run nube:plan -- --parte planes` cuenta 220 `pension_plans` y 220
  `series` en la nube, los mismos que en el emulador, y de paso prueba la parte nueva contra la nube en seco (440
  documentos leídos, todos validan). **Sin comprobar:** que la pantalla publicada los lea con sesión —hace falta entrar
  con la cuenta de Óscar— y que el contenido de la nube sea igual documento a documento (lo que mira la propia subida es
  una muestra de uno de cada siete). La rama está subida hasta `a25834e1`; `969d2c10` y esta línea, no.
- **13-11 10:20 · Planes y EPSV (sesión [20241c]):** **Óscar entra en la web publicada con su cuenta y la lista de planes
  se ve** («Sí, funciona»). Con eso queda comprobado lo que faltaba: la pantalla publicada lee `pension_plans` de la nube
  con sesión. Planes y EPSV queda publicado entero. Sigue abierto, sin fecha: las dos decisiones que Óscar puede cambiar
  (una sola comisión, la del banco; el gráfico solo en la ficha), el caso en rojo de `probar-reglas.mjs` que no es de
  este cambio, y el refresco de los planes, que es a mano como el resto.
- **13-11 11:15 · Planes y EPSV (sesión [20241c], por orden de Óscar: «Sí, añádelo»):** **la comparación de planes gana
  el gráfico de evolución, en base 100.** Es el único cálculo de la pantalla, y Óscar lo pidió sabiendo que lo es; queda
  escrito en D-11 y en `AGENTS.md`. Commit `d8984ff5`. Solo cambia la aplicación: `src/core/planes/evolucionComparada.ts` (mes a mes, solo
  meses cerrados, base en el primer mes que tienen todos; un periodo que la historia común no cubre no se ofrece; un plan
  sin valores en el periodo no se dibuja y se nombra) y `src/components/planes/EvolucionComparada.tsx`, con la pieza de
  gráfico que ya usa el comparador de activos. La ficha sigue en euros, sin base 100. **Comprobado:** tres cifras del
  gráfico recalculadas a mano contra las series de la base local; suite de la app 4.981 (19 nuevas), typecheck, lint,
  compilación con presupuesto y censo; la pantalla en los seis anchos y en Modo cliente, sin desbordes ni errores, y el
  caso del plan que dejó de publicar (su línea acaba en junio de 2024 y lo dice). Ni datos ni reglas cambian. **Falta,
  y es de Óscar:** publicar el sitio. Sin subir a GitHub.
- **13-11 11:20 · Planes y EPSV (sesión [20241c]):** el gráfico comparado, **subido a GitHub** por orden de Óscar (la
  rama, en `2dda6f7d`) y **publicado por él** (compilación de las 11:13). Comprobado leyendo la web: el índice publicado
  nombra los mismos ficheros que el del disco, y `PlanesPage-BhHSjnG_.js` responde 200, es idéntico al del disco y lleva
  el gráfico («Evolución comparada», «Base 100 en», «único cálculo de esta pantalla»); dentro del sitio sigue sin haber
  ningún dato de planes. **Sin comprobar:** verlo dibujado en la web con sesión, que es de la cuenta de Óscar. Esta
  línea, sin subir: irá con la siguiente.
- **13-11 12:15 · Rendimiento (sesión local [475845], que sigue a la de la nube «Comparación de cartera»):** Rendimiento
  usa **todo el export de operaciones del banco** (Óscar: «Sí, los cuatro»). (1) Un canje 1 a 1 —`BAJA POR CANJE` y `ALTA
  POR CANJE` el mismo día, con los mismos títulos y el mismo importe— une el ISIN viejo con el nuevo. (2) Un cargo de
  mercado que el extracto llama «compra» (mantenimiento de ADR) pasa a comisión cuando coincide con un `CARGO GASTOS
  MERCADO` del banco: antes sumaba otra vez los títulos que se tenían. (3) **Cambio de método:** todas las operaciones de
  traspaso se aplican en su fecha, emparejadas o no, si el dinero de todas cierra (`_transfer_legs_close`); antes solo las
  que explicaban una posición sin fecha, y los demás fondos recibían o perdían de golpe, en su primera o su última fecha
  de caja, títulos que se movieron años después. (4) Un activo ya vendido sin serie en el catálogo se valora con el precio
  de sus propias operaciones (`OPERATION_PRICES`), sin bloquear y dicho junto a cada cifra; su resultado total es exacto y
  su recorrido entre operaciones no se conoce. **Medido con el cliente real contra el 8092, sin escribir:** de bloqueado a
  calculado. Con el método anterior, apartando las dos posiciones sin fecha, habría salido TWR anual 5,5 %, volatilidad
  15,6 % y caída máxima −29,8 %, con un −15 % en 2021 y un +26 % en 2026 que no existieron; ahora 7,4 %, 9,6 % y −19,0 %,
  y los mayores movimientos diarios son días de mercado. Los títulos anclados pasan de 18 aperturas y 27 cierres a 2 y 7,
  todos por debajo de 180 € sobre un millón, y el tránsito cierra con 26 céntimos. **Todo análisis anterior de un cliente
  con traspasos entre fondos lleva ese defecto en sus cifras anuales.** Pruebas: 18 nuevas con datos inventados
  (`test_portfolio_real_todo_el_export.py`); Python 2.279, app 4.981, `tsc -b` y lint, limpios. Cambian las Functions y,
  por una etiqueta, el sitio. **Sin número de decisión todavía**, sin desplegar y sin subir. Los instrumentos del cliente
  no se nombran aquí (B-77). Sigue pendiente, de la copia [cc690180]: subir a la nube los 7 instrumentos dados de alta el
  12-11, sin los cuales la web seguirá diciendo que faltan series.
- **13-11 13:25 · Rendimiento (sesión local [475845]):** visto **en pantalla, en local** (Óscar: «Sí, compruébalo»), con
  los tres extractos del cliente cargados en `/cartera-real`: las cifras son las medidas (TIR 5,70 %, TWR 59,95 %), el
  gráfico comparado y la tabla frente a los cuatro índices salen, los tres vendidos sin serie aparecen como «Sin serie:
  valorado con sus propias operaciones», 23 grupos de traspaso, sin errores de consola y sin desborde a 1024 px.
  **Cómo, y qué no cubre:** el emulador de Functions del entorno local no respondía a ninguna función (tampoco a una
  ajena al cambio; `main` carga bien fuera de él), y no se reinició sin permiso. La pantalla recibió la respuesta de un
  sustituto local con el mismo servicio y el código del disco contra el 8092, así que **no ha pasado por la Function ni
  por su autenticación**, que el cambio no toca. **Dos hallazgos:** (1) contra una base sin los 7 instrumentos del 12-11,
  como la nube hoy, el cliente **sigue bloqueado** por dos vendidos con operaciones sin títulos, que no se pueden valorar
  a precio de operación: la subida del catálogo es condición para la web, no un extra; (2) la lista «Traspasos internos
  conciliados» sigue enseñando el emparejado antiguo, con grupos que casan por aproximación («diferencia entre apuntes
  59 €»); el cálculo ya no depende de él. Una tilde corregida en el texto nuevo. Sin desplegar ni subir.
- **13-11 14:05 · Rendimiento (sesión local [475845]):** **emulador de la base de siempre reiniciado** (Óscar: «Sí,
  reinícialo»): el de Functions no contestaba a ninguna función. Parado solo ese (el 8092 no se tocó y sigue con datos),
  arrancado con `--only "firestore,auth,functions"`, base restaurada (`PASS`, 25.404 = 25.404, 0 diferencias) y usuario
  sembrado; corre como proceso de fondo de esta sesión, con el registro fuera del repositorio. **Repetido por la Function
  real**, con sesión iniciada y los tres extractos: responde 200 con el código nuevo y la pantalla pinta bien los dos
  estados que da la base vieja. Primero, bloqueado por los dos vendidos fuera del catálogo, con los demás como «Sin serie:
  valorado con sus propias operaciones». Excluidos esos dos, «Traspasos pendientes de documentar» con una posición.
  **Por qué ahí no da cifras, medido:** a la base vieja le falta el cambio del BCE del traspaso en divisa (0 de 1; en el
  8092, 1 de 1), esa operación queda suelta en divisa, el dinero de los traspasos no cierra y el motor hace lo de antes,
  como está escrito. Las cifras completas en pantalla son las de la entrada anterior, contra el 8092.
- **13-11 14:20 · Rendimiento (sesión local [475845]):** **subido a GitHub** por orden de Óscar («Sí, súbelos»): la
  rama, en `4bf73a2c`, sin forzar; el remoto no se había movido desde `2dda6f7d`. Sigue **sin desplegar**: faltan, y son
  de Óscar, la subida del catálogo con los 7 instrumentos (copia [cc690180]), las Functions y el sitio. Esta línea, sin
  subir: irá con la siguiente.
- **13-11 15:20 · Rendimiento (sesión local [475845]):** **catálogo subido a la nube, con los 7 instrumentos del 12-11**
  (`a37f4383`, `e71aee44`). Óscar, en esta ventana: «Pues sube el catálogo»; la copia [cc690180], que lo tenía a medias,
  seguía parada con su comparación fallida y no escribió. **Antes:** `nube:plan -- --parte catalogo` (49.375 por subir, 0
  sin validar, ningún borrado: 148 aprobados que ya no están y uno que no se borra porque el origen vuelve a tenerlo) y
  comparación por contenido de todo el catálogo, con huella sin orden de claves: 49.278 iguales, **187 solo en local,
  todos de los 7 instrumentos**, 3 distintos (los `search_shards`) y nada solo en la nube. **Subida:**
  `nube:subir -- --parte catalogo --escribe`, con su puerta, sin `--con-cartera-del-emisor`; recuentos iguales grupo a
  grupo, y su postverify da los 6 «distintos» por el orden de las claves. **Después, releyendo la nube entera:** 49.468
  iguales, 0 distintos, 0 solo en un lado; en la nube, 187 documentos nuevos y 3 cambiados, y nada más. **Carteras y
  retrocesiones: 694 documentos con la misma huella antes y después.** Los cambios del BCE (`fx_rates`) son los mismos en
  los dos lados, que era la condición del traspaso en divisa de Rendimiento. **Falta, de Óscar:** desplegar las Functions
  y publicar el sitio (`666b4594`, `ff00678e`); sin eso la web sigue con el cálculo anterior.
- **13-11 15:45 · Rendimiento (sesión local [475845]):** Óscar despliega Functions y sitio («Desplegado, mira»).
  **Comprobado leyendo la web:** el índice publicado es idéntico al de `4-base-nueva/sitio/`, compilado a las 14:24,
  después de `ff00678e`, y `labels-qs9S1u39.js` responde 200 y lleva «Sin serie: valorado con sus propias operaciones».
  **Sin comprobar: las Functions.** La de Rendimiento contesta en la nube (401 sin sesión), pero qué código corre solo se
  ve analizando con sesión, y no la hubo: la extensión de Chrome no respondió en tres intentos y el navegador integrado
  no tiene iniciada la sesión de Óscar en la web. Queda pendiente la prueba con los extractos en la web.
- **13-11 16:10 · Rendimiento (sesión local [475845]):** **cerrado en producción.** Con Chrome conectado por Óscar y su
  sesión, en `bdb-gestor-de-activos.web.app/cartera-real`, los tres extractos del cliente cargados y analizados, sin
  guardar nada: **TIR 5,70 %, TWR 59,95 %, TWR anualizada 7,36 %**, los siete años iguales a los medidos, volatilidad
  9,63 %, Sharpe 0,61, Sortino 0,91, caída máxima −19,03 % (16-11-2021 a 12-10-2022), y las cuatro referencias con 1.730
  observaciones comunes. 73 de 73 activos con precios, los tres vendidos sin serie como «Sin serie: valorado con sus
  propias operaciones» con la tilde de `ff00678e` —que dice que las Functions desplegadas son las nuevas—, 23 grupos de
  traspaso, ninguna posición pendiente y la consola sin errores. El tipo sin riesgo sale de la media del BCE de la
  ventana, y el Sharpe no cambia. Las cifras son las del cálculo local contra el 8092. En el historial de la web queda
  un análisis guardado antes del arreglo, con las cifras en «Falta»: es de Óscar y no se ha tocado.
- **13-11 20:50 · Gestor de carteras (sesión local [2ac409]):** **fusionado en la principal por orden de Óscar («haz 1»),
  sin desplegar.** «Rendimiento» pasa a ser «Gestor de carteras» (`/cartera-real`): libro de movimientos importado o a
  mano, cuentas de efectivo y de valores a fecha, análisis entre fechas, comparación con carteras de Diseño, informes del
  cliente y del asesor y Excel; cálculo en el navegador (`src/gestor/motor/`), carteras en ficheros del disco. Plan,
  arquitectura y progreso en `docs/gestor-carteras/`; regla nueva en `AGENTS.md`. **Reglas de la base nueva:** lectura con
  sesión de `fx_rates` y `reference_rates`, aprobada por Óscar, con sus casos en `probar-reglas.mjs` y probada en un
  emulador aparte (17 comprobaciones); **no desplegada**. **Medido con los tres extractos del cliente contra Rendimiento,
  en local y sin escribir:** las 38 posiciones cuadran en títulos y en valor; patrimonio 1.015.996 € frente a 1.016.068 €
  (los 72 € son seis dividendos identificados solo por nombre, que el lector aún no enlaza), TIR anual 5,69 % frente a
  5,70 %, TWR 58,98 % frente a 59,95 %, volatilidad 9,63 % y caída máxima −18,9 %. De esa medición salieron dos arreglos
  del motor, ya dentro (`344cf248`): el precio del extracto del banco cuando es más reciente que el de la plataforma, y
  las series en otra divisa que la del activo. **En curso, sin fusionar:** el lector de extractos (identidad por nombre,
  derechos de suscripción, traspasos de varios a varios, conceptos del banco sin clasificar). **Puertas:** app 5.347 antes
  de los dos arreglos, y `tsc -b`, lint y las pruebas del gestor después. Añade la dependencia `big.js`: hace falta
  `npm install` en la app. Los instrumentos del cliente no se nombran aquí (B-77).
- **13-11 21:30 · Gestor de carteras (sesión local [2ac409]):** **el lector de extractos, cerrado con los tres extractos
  del cliente, y fusionado en la principal; sin desplegar.** Las 594 líneas entran sin decisión manual (antes 574, con 19
  por decidir y 6 errores de títulos por los derechos de suscripción), el efectivo cuadra al céntimo, las 38 posiciones
  cuadran en títulos y en valor, y contra Rendimiento sobre los mismos ficheros: patrimonio igual (7 céntimos), TIR anual
  5,70 % en los dos, volatilidad 9,63 % en los dos, caída máxima −18,9 % frente a −19,0 %, TWR 59,07 % frente a 59,95 %.
  Qué cambió en el lector: desempate por importe exacto, títulos cortados por un espacio doble, identidad por nombre
  (traslado de `resolve_operations_mapping`), dividendos del mismo día en otra divisa, devolución de prima de emisión y
  gastos de correspondencia y de ADR, derechos de suscripción, y traspasos de varios a varios por oleadas (como
  `_transfer_legs_close`). En el motor, un tipo nuevo, «Títulos ejercidos o caducados» (21 tipos): unos derechos ejercidos
  no son una retirada. **Abierto:** 2020 y 2021 salen medio punto por debajo de Rendimiento, probablemente por los
  dividendos netos frente a la serie bruta; detalle en `docs/gestor-carteras/PROGRESO.md`. **Puertas:** app 5.368,
  `tsc -b`, lint, compilación y censo de CSS. La medición se hizo con una prueba temporal, ya borrada; guiones y salidas,
  fuera del repositorio (B-77).
- **13-11 21:40 · Gestor de carteras (sesión local [2ac409]):** **principal subida a GitHub por orden de Óscar («Sí,
  súbela»)**, de `e836a74a` a `6845f446`: veintidós commits, avance directo, sin conflictos. Sin desplegar: las reglas
  de `fx_rates` y `reference_rates` y el sitio los despliega Óscar. De paso: `probar-reglas.mjs` pasa sus 47 casos de
  reglas contra el 8092, y su última comprobación —el filtro de `targets` en `baseNuevaLecturaSdk.ts`— falla porque ese
  filtro ya no está en el fichero desde antes de este trabajo; no se ha tocado.
- **13-11 22:25 · Gestor de carteras (sesión local [2ac409]):** Óscar despliega las reglas («comprueba»). **Comprobado
  con `verReglasDesplegadas.ts`:** la release activa es de las 20:20 UTC, mide 19.072 bytes y es igual al fichero del
  repositorio, que ya lleva la lectura de `fx_rates` y `reference_rates`. **El sitio no se ha publicado:** el índice de
  la web es el de las 14:24, igual al que había en `4-base-nueva/sitio/`, así que la web sigue enseñando «Rendimiento».
  Compilado de nuevo en local desde `a1b85445` (`compilar-sitio.mjs`, 21:22): lleva el gestor, y `probar-puerta.mjs`
  pasa. Falta que Óscar despliegue el sitio. **Sin comprobar:** que `fx_rates` y `reference_rates` estén en la nube
  —por el código suben con `--parte catalogo`—; se verá al abrir en la web una cartera con activos en divisa. Esta
  línea, sin subir: irá con la siguiente.
- **13-11 22:40 · Gestor de carteras (sesión local [2ac409]):** Óscar publica el sitio («ya»). **Comprobado leyendo la
  web:** el índice publicado es idéntico al compilado a las 21:22 desde `a1b85445`, y `GestorDeCarterasPage-Dr1TgWjF.js`
  responde 200 y es igual al local. **Sin comprobar: el gestor con sesión.** `/cartera-real` en la web pide entrar
  («Sesión cerrada por inactividad») y la cuenta es de Óscar; queda abierta la pestaña para que entre él. Tampoco, por
  lo mismo, que `fx_rates` y `reference_rates` se lean en la nube con sesión. Esta línea y la anterior, sin subir.
- **13-11 22:55 · Gestor de carteras (sesión local [2ac409]):** **visto en producción con la sesión de Óscar**, en
  `bdb-gestor-de-activos.web.app/cartera-real`: el menú dice «Gestor de carteras», la cartera de demostración carga
  con las cifras del local (201.298 €, +18.582 €, +10,39 % en el año), las pestañas de análisis y de comparación
  abren y la consola no da errores. Nada guardado: la demostración no se guarda. **Sin comprobar:** una cartera real
  en la web —elegir carpeta lo pide el navegador y es de Óscar—, y con ella la lectura de `fx_rates` y
  `reference_rates` con sesión. Esta línea y las dos anteriores, sin subir.
- **13-11 23:55 · Gestor de carteras (sesión local [2ac409]):** por encargo de Óscar («en el informe de cliente elimina
  los costes, crea un informe de costes aparte y añade la posibilidad de elegir un benchmark»). **Informe del cliente sin
  costes:** fuera la sección, y en el desglose del resultado la línea de comisiones y gastos se resta de la variación de
  precio, rotulada «neta de comisiones y gastos». **Informe de costes**, tercer documento del gestor, en papel de cliente y
  sin marca: resumen, cargos del servicio, operaciones, coste estimado de cada fondo, impuestos aparte y método; cada
  detalle suma el total del resumen. **Referencia a elegir de una lista**, en el análisis, los ajustes y el diálogo de
  informes: las cinco carteras de referencia (regla de la decisión 39: pesos fijados el primer día y sin reequilibrar),
  los tres índices de Rendimiento, liquidez (€STR capitalizado), otro activo o ninguna; codificada en
  `referencia.activoId` con prefijo, sin cambiar el formato del fichero. **Puertas:** app 5.403, `tsc -b`, lint,
  compilación y censo de CSS; PDF revisados página a página. Fusionado en la principal, sin subir y sin desplegar: el
  sitio hay que publicarlo otra vez.
- **14-11 00:15 · Gestor de carteras (sesión local [2ac409]):** principal subida a GitHub por orden de Óscar («Sí,
  súbela»), hasta `dfb9a3e8`, y sitio publicado por él («hecho»). **Comprobado leyendo la web:** el índice publicado es
  idéntico al compilado desde `dfb9a3e8`, y los ficheros del gestor, de los informes y del documento responden 200 y son
  iguales a los locales. Con su sesión, la entrada del gestor carga sin errores de consola y enseña su carpeta, con una
  cartera de 594 movimientos creada por él. **Sin comprobar:** esa cartera por dentro —Óscar se llevó la pestaña antes de
  que la abriera—, y con ella la lectura de `fx_rates` y `reference_rates` con sesión, el informe de costes y el
  selector de referencia en la web. Esta línea, sin subir.
- **14-11 00:25 · Gestor de carteras (sesión local [2ac409]):** **cerrado en producción, visto por Óscar** («Sí, sale
  bien»): en su cartera real de la web, de 594 movimientos, el análisis da el ratio de Sharpe y no hay aviso de tipos de
  cambio, que es lo que dice que `reference_rates` y `fx_rates` se leen en la nube con sesión. Lo ha mirado él, no esta
  sesión. Esta línea y la anterior, sin subir.
- **14-11 01:00 · Gestor de carteras (sesión local [2ac409]):** el aviso «puede faltar algún dividendo» ya no salta por la
  retención (Óscar: «sí», a hacer solo esto y aplazar la calibración de la valoración). El banco abona el dividendo neto y
  la serie lo descuenta bruto: el aviso se mide ahora suponiendo la mayor retención posible en los dividendos anotados sin
  ella (20 % en un valor español, 46 % en uno extranjero) y solo avisa de lo que ni así cuadra. No cambia ninguna cifra.
  Con los extractos del cliente, de 12 avisos a 4, y el patrimonio igual. Puertas: app, `tsc -b`, lint y compilación.
  Fusionado en la principal, sin subir y sin desplegar.
- **13-11 22:35 · Auditoría y diseño (sesión local [f13c81], Fable 5.2):** encargo de Óscar: auditoría completa y rediseño
  del frontend, con unificación de los informes. Trabaja en la rama `auditoria-frontend`, en la copia
  `.claude/worktrees/auditoria-frontend` (Vite en el **5194**, configuración `auditoria-frontend` de `.claude/launch.json`);
  la carpeta principal no cambia de rama. **Territorio: `3-BDB-ACTIVOS_app/` (pantalla, estilos, piezas comunes e informes)
  y `docs/frontend/`.** No toca Functions, reglas ni contratos sin aprobación de Óscar, y no despliega. Usa los emuladores
  en marcha (8082, 8092, 9097, 5005) sin pararlos ni reiniciarlos. **Quien vaya a escribir en `3-BDB-ACTIVOS_app/src` desde
  otra sesión, que lo anote aquí antes:** el rediseño toca estilos y piezas comunes de todas las pantallas, y un cruce
  acabaría en conflictos de fusión. Estado y hallazgos, en `docs/frontend/PROGRESO.md` y `docs/frontend/AUDITORIA.md` de
  esa rama. Esta línea, sin subir.
- **14-11 12:50 · Auditoría y diseño (sesión local [f13c81], Fable 5.2):** por orden de Óscar («vamos a subirla así de
  momento»; preguntado si también a producción, «Sí, prepáralo tú»), **la rama `auditoria-frontend` está fusionada en la
  principal y subida a GitHub**, en `2f37b213`: la rama trajo antes el apunte de arriba (`be1327c2`) y la principal avanzó
  en directo, sin conflictos. **El frontend de la principal es ya el rediseñado.** El aviso de arriba cambia: quien vaya a
  escribir en `3-BDB-ACTIVOS_app/src` desde otra rama, que parta de `2f37b213` o posterior; esta sesión sigue en su rama
  para lo que Óscar pida. **Sitio compilado** desde `2f37b213` (`compilar-sitio.mjs`, 12:42; `index-BpOlQFBT.js` e
  `index-BtjuxEbn.css`): abierto en un navegador sin ventana enseña el acceso con 0 errores de consola, y
  `probar-puerta.mjs` pasa. **Sin desplegar:** el sitio y las Functions los lanza Óscar (`desplegarFunciones.mjs` en seco:
  comprobaciones bien); de las Functions solo cambia `save_portfolio`, con el control DIS-03, que rechaza guardar sobre
  una propuesta que cambió desde que se abrió. Las reglas no cambian. La web sirve todavía la compilación del 13-11
  (`index-C9m7N-2e.js`). **Puertas sobre `ca60c589`** (de ahí a `2f37b213` solo cambia este fichero): app 6.984 pruebas,
  `tsc -b`, lint, censo de CSS, compilación y peso; servidor, 2.304 pruebas de Python y las dos de DIS-03 contra el 8082.
  Recorrido de las 68 pantallas en cuatro anchos: 0 desbordes y 0 reglas de accesibilidad; trece 429 del limitador del
  servidor local por lanzar dos recorridos a la vez, y 0 al repasarlas a solas. **Probado en local contra el emulador de
  Functions, que desde el avance sirve el código nuevo:** dos guardados seguidos, el rechazo con `PORTFOLIO_CONFLICT`
  (cambiada y eliminada) y el aviso en pantalla; la propuesta de prueba, borrada. **Para la carpeta principal:** la rama
  añade `axe-core` (desarrollo; solo lo usa `scripts/auditoriaFrontend.mjs`), y para lanzar ese guion hace falta
  `npm install` en `3-BDB-ACTIVOS_app`; pruebas y compilación no lo necesitan. **Pendiente de Dirección:** poner al día
  `AGENTS.md` y la habilidad `diseno-pantalla` —el menú, los informes y la dirección visual que describen son los de
  antes— y la decisión B-79 (Óscar, 14-11: los ETF entran en la matriz de solapamiento del informe de cliente, medidos
  con la cartera completa de su emisor y sin nombrarlo). Estado y detalle, en `docs/frontend/PROGRESO.md` e
  `INFORME_DE_CIERRE.md`.
- **14-11 13:05 · Auditoría y diseño (sesión local [f13c81], Fable 5.2):** **Óscar despliega las Functions y publica el
  sitio** («Sí, comprueba la web»). **Comprobado leyendo la web:** el índice publicado es idéntico al compilado desde
  `2f37b213` (`index-BpOlQFBT.js`, `index-BtjuxEbn.css`) y los 288 ficheros de `assets/` responden y son iguales a los
  locales; las cabeceras de seguridad salen. **Leído en su terminal:** las 34 Functions, «Successful update operation»,
  `save_portfolio` entre ellas, y «Deploy complete!» en los dos despliegues. **Sin comprobar:** la aplicación publicada
  con sesión —la cuenta es de Óscar— y, con ella, el guardado de propuestas contra el servidor de la nube.
- **14-11 13:15 · Auditoría y diseño (sesión local [f13c81], Fable 5.2):** **rediseño cerrado en producción, visto por
  Óscar** («Sí, sale bien»), con su sesión en la web. Lo ha mirado él, no esta sesión. **Sin comprobar:** el guardado de
  propuestas contra el servidor de la nube con dos equipos a la vez.
- **15-11 · Auditar y limpiar versiones del proyecto (sesión local [c95ffc], Opus 5.5):** **el diseño «Nuevo» es el único**
  (Óscar: «esta es con la que me quiero quedar»): se retira el Actual con el selector, `src/disenos/` y las letras de
  @fontsource, y el Nuevo pasa a `tokens.css`, `theme.ts` y las hojas de `src/styles/` (`ad1d7ce5`, apartado 13 de
  `docs/frontend/SISTEMA_DISENO.md`). Comprobado contra el Nuevo de antes con los estilos calculados de las 13 pantallas
  en los seis anchos. **Óscar publica el sitio**; **comprobado leyendo la web:** el índice publicado es el compilado
  (`index-C0VuSmhp.js`, `index-p7Q3rOcU.css`), con el lienzo `#f3f5f9` y sin rastro del selector. Las Functions no
  cambian. **Pendiente de Óscar:** si los PDF toman el verde, el rojo y los colores de clase de la pantalla.
- **15-11 12:15 · Auditar y limpiar versiones del proyecto (sesión local [c95ffc], Opus 5.5):** **los PDF toman de la
  pantalla el verde, el rojo, los colores de clase y el gris del resto** (Óscar: «que coincidan»; `995b50d0`). El papel
  crema, las letras y la paleta de las categorías no cambian. **Óscar publica el sitio** (el primer intento no llegó: la
  web seguía en la versión de las 11:57). **Comprobado leyendo la web:** índice `index-BmpxnPVj.js` y la plantilla de los
  informes con los colores nuevos. Las Functions no cambian.
- **15-11 · Auditoría del backend (Dirección, sesión local, Fable 5.2):** **auditoría de solo lectura de las Cloud Functions**
  y de lo desplegado: 32 hallazgos, en `AUDITORIA_BACKEND_2026-11-15.md` (informe publicado:
  https://claude.ai/artifact/BXTefcJZHJPXYNn3G3iksY). Óscar tomó ocho decisiones el mismo día, **A-146 a A-153** en
  `DECISIONES_AUDITORIA_2026-11-04.md`. Dirección hizo: la lista de despliegue de 34 a 23 funciones y el borrado de las
  once en la nube (`67906a6d`; **comprobado:** la nube coincide con la lista), las copias de la base de producción
  (`2b8d32b1`; siete días de recuperación, protección contra el borrado y copia diaria de 14 días, leído de vuelta; **falta
  el ensayo de restauración**), las cinco fusiones de abajo, la subida y la preparación del despliegue.
- **15-11 · Encargos del día, cada uno con su modelo y su esfuerzo comprobados en los metadatos de la sesión:**
  «informe-a-mano» (Opus 5.5, esfuerzo medio): `2fd14665` y `f69351fd`, fusión `d9d39918` (A-148).
  «pesos-del-modelo» (Sonnet 5.5, medio): `d14c4fff`, fusión `2e003d66` (A-149).
  «no-anualizar» (Opus 5.5, alto): `104777cc` y `fc83dca6`, fusión `65763ad0` (A-150).
  «frontera-comprable» (Opus 5.5, alto): `ef739041` y `cca13e27`, fusión `151ec2f5` (A-151).
  «medir-tres-anos» (Sonnet 5.5, medio): solo lectura, sin cambios en el repositorio (A-152).
  «mejorar-periodo» (Opus 5.5, alto): `45a0738b` y `4b49ba0c`, fusión `a9c4a6c9` (A-153).
  «comprobar-en-pantalla» (Sonnet 5.5, medio): sin cambios en el repositorio.
- **15-11 · Medición de los «3 años» (sesión «medir-tres-anos», solo lectura):** sobre las 18 carteras reales de la base
  nueva local, a 3 y a 5 años. Entre Simular y «Mejorar», la rentabilidad anual de una misma cartera difería entre 0,3 y
  1,4 puntos (mediana 0,65 a 3 años y 0,78 a 5), el Sharpe hasta 0,15, y «Mejorar» no podía calcular 15 de los 36 casos.
  Optimizar y Simular terminaban en la misma fecha en las 18. La simulación suelta difería mucho a 5 años, pero ninguna
  pantalla la usa a 3 ni a 5 años. **Después de A-153, medido otra vez:** 36 de 36 coinciden con Simular y las 18 carteras
  se calculan. Además, la frontera de Simular apartó 7 instrumentos de 1.097 en la base local (uno de precio congelado,
  NH Hotel Group, y seis bloqueados para nuevas compras).
- **15-11 · Comprobación en pantalla (sesión «comprobar-en-pantalla»):** los cinco cambios visibles, vistos en la
  aplicación local en los seis anchos, **sin defectos** (página con las imágenes: https://claude.ai/artifact/UGmsffZhUo3zDkyLnehoXk).
  **Sin ver con datos reales:** el motivo «bloqueado para nuevas compras» en el aviso de la frontera, una posición
  «completada con una referencia» en «Mejorar» y un candidato «sin historia propia»; solo los cubren pruebas.
- **15-11 16:06 · Subida a producción (Dirección):** **en producción** el sitio compilado desde `a9c4a6c9` y las 23
  Functions, sin errores. Quedan abiertos, y constan en `AUDITORIA_BACKEND_2026-11-15.md`: 21 hallazgos de los 32, el ensayo
  de restauración de las copias, y que las pruebas de Python corren en local con el 3.14 del sistema mientras la nube usa el 3.12.
- **15-11 · Segunda tanda de la auditoría del backend (Dirección, encargos con su modelo y su esfuerzo comprobados en los metadatos de la sesión):**
  «robustez-calculo» (Opus 5.5, medio): `cbc0edc9` y `85131e3d`, fusión `43665b71`. Cierra los hallazgos 11 y 15 y lo que
  quedaba del 14: una correlación o un Sharpe que no se pueden calcular salen vacíos y la pantalla escribe «Falta el
  dato»; en «Mejorar», la comprobación afectada queda «no evaluable»; un activo cuya historia no se puede completar con su
  referencia se aparta y la cartera se calcula con el resto; un fallo del optimizador llega con mensaje; la simulación
  suelta espera 300 segundos y el borrador 120.
  «lectura-y-entradas» (Opus 5.5, medio): `b5ff2e89`, `a50f5f47` y `e47272bf`, fusión `d342df71`. Cierra los hallazgos 19
  y 21: un fallo de lectura se dice como fallo y no como dato inexistente; cada lectura de la base nueva lleva su límite
  de 15 segundos; el comparador de activos dice de qué identificador viene una fila sustituida y cuáles no existen; las
  entradas mal formadas devuelven un error que nombra el campo.
  «comprobar-robustez» (Sonnet 5.5, medio): sin cambios en el repositorio.
- **15-11 · Vuelta de corrección en «lectura-y-entradas» (Dirección):** el encargo de Dirección pedía rechazar la petición
  ante un identificador no válido **sin distinguir las listas**, y eso hacía que una posición con un código como «BRK/B»,
  que Posiciones admite, tumbara el análisis del lote entero. Dirección lo vio al revisar; el tercer commit (`e47272bf`)
  lo deja en que un identificador no válido **solo marca su fila**. El defecto era del encargo, no de la sesión.
- **15-11 · Comprobación en pantalla de la segunda tanda (sesión «comprobar-robustez»):** página
  https://claude.ai/artifact/B2FnioUHM52fdamp7nv7X4. **Dos defectos:** el mensaje nuevo del optimizador no llegaba a la
  pantalla, y un «[503]» quedaba colgado detrás del aviso de fallo de lectura. Y un hecho: con los datos reales de hoy, los
  textos «Falta» y «Falta el dato» no llegan a darse; solo se vieron doblando la respuesta del servidor.
- **15-11 · Auditoría del backend, documento (Dirección):** `88b3c6bc`, el documento de la auditoría con los hallazgos 11,
  14, 15, 19 y 21 cerrados.
- **15-11 · Tercera tanda de la auditoría del backend (Dirección, encargos con su modelo y su esfuerzo comprobados):**
  «optimizar-un-ano» (Opus 5.5, alto): `ecb6ca31` y `fd246352`, fusión `76e03e15` (hallazgo 12; **decisión nueva de Óscar,
  A-154**: ante «Optimizar a un año con muchos activos», limitar los activos y conservar la ventana de un año; máximo
  40 × semanas / 157, redondeado hacia abajo y sin pasar de 40: 13 a un año, 40 a 3, 5 y 10).
  «otra-clase» (Opus 5.5, medio): `83a67417` y `54f9d4dd`, fusión `79e0c73e`. «Misma estrategia, otra clase» emparejaba por
  el nombre fondos de vencimiento distinto, porque la detección quitaba todos los números; ahora un año, un vencimiento o un
  perfil distinguen productos, y el bloque deja de decir que el servidor confirma. Medido sobre los 1.300 nombres de la
  lista de fondos: se van cuatro emparejamientos falsos (Cartera Renta Fija Horizonte 2026/2027/2028; Fidelity Target
  2030/2035; Allianz Strategy 50/75; Allianz Dynamic Multi Asset SRI 15/75) y no cambia ninguno más. Y el PDF del comparador
  de carteras, con periodo corto, enseña la fila de la anualizada en «No aplica».
  «ia-e-informe» (Sonnet 5.5, medio): `7142bbcd`, fusión `928dfc9d`. Cierra el hallazgo 24 y el resto de A-149.
  «fuentes-externas» (Sonnet 5.5, medio): `7e7b4094`, fusión `a4ca786a`. Cierra los hallazgos 25, 26 y 27.
  «limpieza-y-puerta» (Sonnet 5.5, medio): `62e54062`, `77ca3e7f` y `acc2da8b`, fusión `7f2cd85e`. Cierra los hallazgos 4 y
  31, y el 32 en parte.
  «lectura-contrato» (Opus 5.5, alto): `0208f4fb` y `236fbfd4`, fusión `ad90c388`. Cierra los hallazgos 16, 17, 18 y 20;
  cambió el contrato de respuesta en su origen, `asset-for-bdb.v1.schema.json`. Ninguna cifra cambia (comprobado en los
  1.334 instrumentos de la base nueva local).
  «mensajes-del-servidor» (Sonnet 5.5, medio): `0d4e5a4f` y `3c5e33e1`, fusión `d3744549`. Arregla los dos defectos de la
  comprobación en pantalla (el texto del servidor es el que lee el asesor; el «[503]» no se cuelga de los mensajes propios),
  pone en castellano los dos mensajes del servidor que salían en inglés y da un límite de tiempo holgado a
  `tests/barreraCarteraDelEmisor.test.ts`, que se pasaba de sus 5 segundos con la batería entera.
- **15-11 · Lo que dejan abierto las sesiones de la tercera tanda:** «otra-clase»: Cartesio X y Cartesio Y (fondos
  distintos) se siguen emparejando, la misma estrategia con otra letra y número de clase (A2 frente a E2) no se reconoce, y
  por debajo de un 2 % de volatilidad anual no se exige correlación a ningún candidato. «optimizar-un-ano»: el aviso
  `LOW_TN_OAS` ya salta a 3 años con 40 activos. «ia-e-informe»: no se sabe qué hace el modelo de verdad con la regla de no
  escribir pesos; solo se sabe publicando un informe. «fuentes-externas»: la lista del IBEX 35 sigue fija en el código.
  «limpieza-y-puerta»: la puerta no se ha visto actuar dentro de un despliegue real, y del hallazgo 32 queda lo que decide
  Óscar (el fichero de entorno del proyecto de BDB en el checkout principal y el dominio de ese proyecto en la cabecera de
  `firebase.json`). «lectura-contrato»: la interfaz de `bdbAclContracts.ts` no está al día, el informe interno de cartera y la
  ficha nueva usan el recuento parcial de posiciones, hay 3 fondos con la fecha de corte de hace un año, y la nota de
  fechas sale en toda comparación de fondo con acción (margen de 7 días). «mensajes-del-servidor»: el panel de la
  frontera repite «Frontera histórica» como título y como estado, de antes. Además, un emulador de Functions de otra sesión
  puede ocupar el puerto 4501, que es el de registro de la base nueva, y entonces `node 4-base-nueva/arrancar.mjs` falla.
- **15-11 · Prueba de las seis ramas juntas (Dirección):** antes de fusionarlas, en una copia aparte: tipos limpios, 2.513
  pruebas de Python y 7.123 del frontend (una se pasó de tiempo y sola pasaba: la de `barreraCarteraDelEmisor`), y la
  prueba del contrato en la plataforma, 13 de 13.
- **15-11 · Instrucción de Óscar sobre NH Hoteles:** está estático a propósito y no se toca; no se revisa su serie ni se
  apunta como pendiente.
- **15-11 · Estado tras la segunda y la tercera tanda:** de los 32 hallazgos, 24 cerrados, 3 cerrados en parte (1, 9 y 32)
  y 5 abiertos (5, 13, 28, 29 y 30), en `AUDITORIA_BACKEND_2026-11-15.md`. **Todo ello está en la rama principal y sin
  desplegar**: la última subida a producción sigue siendo la de las 16:06.
- **15-11 · Comprobación en pantalla de la tercera tanda y sus arreglos (Dirección):** sesión «comprobar-tanda-3» (Sonnet 5.5,
  medio), sin cambios en el repositorio: 162 capturas en los seis anchos y una pasada de humo por 16 pantallas, **sin
  roturas** (página con las imágenes: https://claude.ai/artifact/Vp4vKCZTBjercnRvQXnJwh). Un defecto: varias notas nuevas
  de la comparativa patrimonial salían sin tildes; lo corrigió «fuentes-externas» en `15641b7c` (fusión `57acdead`), con
  una prueba que falla si vuelven a salir así. **Sin ver:** la tabla de alternativas y el detalle de fila de Posiciones, que
  piden subir un extracto, y el precio en euros de un ETF con la clase en dólares. Los documentos de la auditoría quedaron
  al día en `ee37de61` (fusión `2cf5906c`), con la decisión **A-154**.
- **15-11 21:00 · Segunda subida a producción (Dirección):** baterías completas sobre el resultado final, **sin fallos**
  (2.514 pruebas de Python y 7.134 del frontend); subido a GitHub en `66623e29`; sitio compilado desde ese commit. Óscar
  lanzó los dos despliegues, primero el sitio y después las Functions: **en producción** el sitio y las 23 Functions, sin
  errores. La puerta nueva de `firebase.funciones.json` actuó por primera vez y dejó pasar al guion. **Comprobado:** la
  nube tiene las 23 funciones de la lista y la portada publicada es la compilada. Con esto está en producción todo lo
  hecho el 15-11 en la auditoría del backend: 24 hallazgos cerrados, 3 cerrados en parte y 5 abiertos.
- **16-11 · Hallazgo 5, las reglas piden el correo verificado (Dirección):** sesión «reglas-correo-verificado» (Opus 5.5,
  medio, comprobado en los datos de la sesión), commit `deba92d1`, fusión `4b3d6955`. `esAsesor()` en
  `4-base-nueva/firestore.rules` pide sesión con `email_verified == true`, como ya hacían las Functions y la app; el
  administrador lo hereda. `probar-reglas.mjs`: de 48 a 69 casos, contra un emulador aparte con una copia de los datos
  (22 fallos con las reglas de antes, 69 de 69 con las nuevas); prueba estática nueva en la app, y `nube:reglas` mira
  también esta condición. De paso se arregló un caso que ya fallaba desde el 04-11, porque la app dejó de consultar
  `targets`. Revisado por Dirección sobre una fusión de ensayo: 39 pruebas afectadas en verde y la plataforma compila.
  **En la rama principal y sin desplegar:** las reglas de la nube son las de antes hasta que Óscar lance
  `firebase deploy --only firestore:rules` desde `4-base-nueva`. Sigue sin comprobarse que el alta esté cerrada.
