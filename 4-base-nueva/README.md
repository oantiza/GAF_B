# La casa del proyecto nuevo

Aquí vive el **proyecto Firebase propio** de la base nueva, `bdb-gestor-de-activos`, con su
emulador, sus puertos y su persistencia en disco. No es una carpeta de código: es la
infraestructura que `2-plataforma-datos` escribe y que la aplicación lee: la publicada en
`bdb-gestor-de-activos.web.app` la lee en la nube desde el 03-11-2026, y su sitio sale de `compilar-sitio.mjs`.

Nació el 01-11-2026 con la fase F0 del `PLAN_EJECUCION_2026-11-01.md`.

## El id es de un proyecto REAL, y eso cambia qué es la barrera

`bdb-gestor-de-activos` no es un nombre de laboratorio: es el proyecto que Óscar creó en
Firebase (número 155784236677). Se usa tal cual en el emulador a propósito —el emulador no
comprueba credenciales y acepta cualquier id—, así que el ensayo local es idéntico al destino
de verdad y no queda un renombrado pendiente para el día que llegue la clave de servicio.

**Lo que hay que entender de eso:** hasta hoy, media barrera era que el nombre fuese falso.
`gestor-activos-local` no existe en la nube, así que una credencial de más no podía hacer
daño, porque no había a dónde escribir. Con un proyecto real eso desaparece, y lo único que
separa este código de una escritura en la nube es que la conexión vaya al emulador.

Por eso **esa parte no es una variable de entorno**: `obtenerDb` impone
`HOST_EMULADOR_BASE_NUEVA` en código antes de conectar. Y por eso el id real **no está** en
`ALLOWED_PROJECT_IDS`, el conjunto heredado: lo consultan seis comprobaciones (contadas el 20-11-2026; eran más hasta el borrado del código heredado, el 17-11-2026) que luego
conectan sin exigir emulador. Hay una prueba que falla si alguien los junta.

## Por qué es una instancia aparte y no un segundo proyecto en la de siempre

El emulador de `3-BDB-ACTIVOS_app` arranca con `singleProjectMode: true`, que choca con un
segundo id de proyecto en la misma instancia. Se podría haber desactivado, pero una instancia
propia resuelve además tres cosas que el modo compartido no resuelve:

- **La persistencia se enciende aquí sin encenderla en la base vieja.** En la vieja, guardar el
  estado al salir congelaría una copia rancia que pelea con `backup:restore-drill`, que es como
  se repuebla.
- **El proyecto nuevo no hereda el `firebase.json` de la app vieja**, con su hosting, sus
  Functions y su CSP, que nombran cosas de BDB.
- **El entorno de siempre sigue funcionando igual**, sin un cambio de modo que lo toque.

## Puertos

| Servicio | Puerto |
|---|---|
| Firestore (base nueva) | **8092** |
| Hub del emulador | **4402** |

Elegidos para convivir con los de la base vieja (Firestore 8082, Auth 9097, Functions 5005,
Vite 5174) y con los auxiliares que firebase-tools abre al lado.

## Arrancar

```bash
node 4-base-nueva/arrancar.mjs
```

Déjalo en segundo plano. El script hace tres cosas que a mano se olvidan:

1. Pone el **JDK 21** delante del PATH. El `java` del sistema es un JRE 1.8 y firebase-tools
   exige 21 o superior.
2. Pasa `--import datos` **solo si hay algo que importar**. Con la carpeta vacía, `--import`
   aborta el arranque.
3. Pasa `--export-on-exit datos`, que es la persistencia.

## La persistencia, y su límite

`--export-on-exit` guarda al **salir ordenadamente** (Ctrl-C, o un `SIGINT`). Si el proceso
muere de golpe —un `taskkill /F`, un corte de luz— lo de ese arranque se pierde: lo que hay en
`datos/` es lo del último cierre ordenado.

Para guardar sin parar el emulador, en cualquier momento:

```bash
node 4-base-nueva/guardar.mjs
```

`guardar.mjs` acaba imprimiendo `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)`.
**No es un fallo del volcado**: es ruido de cierre del propio firebase-tools, y sale
*después* de `Export complete`. Lo que dice si el volcado salió bien es la fecha del fichero
`datos/firebase-export-metadata.json`, no el código de salida.

`datos/` **no va al repositorio**: son decenas de miles de documentos (50.517 el 20-11-2026, contados con `npm run audit:base-nueva`; eran 11.566 el 01-11-2026) reconstruibles del canónico del
extractor en segundos, y un volcado binario en Git no se puede revisar. Lo que va al
repositorio es cómo se reconstruye.

## Las copias de la base en la nube

Desde el 15-11-2026 (auditoría del backend, aprobado por Óscar) la base `(default)` del proyecto en la nube tiene:

- **Recuperación a un momento anterior**, con siete días de versiones.
- **Protección contra el borrado** de la base entera.
- **Una copia diaria**, que se conserva 14 días.

Hasta ese día no tenía ninguna de las tres, y la nube es el único sitio donde viven las carteras, las retrocesiones y
los informes de estrategia: el catálogo se reconstruye desde aquí, eso no. Se mira con
`npx firebase firestore:databases:get "(default)" --project bdb-gestor-de-activos` y
`npx firebase firestore:backups:schedules:list --project bdb-gestor-de-activos`, desde `3-BDB-ACTIVOS_app`.

**Lo que no está hecho:** nadie ha restaurado todavía una copia. Una copia que no se ha probado a restaurar no está
comprobada.

## El refresco dice quién entra en el cálculo

`refrescar.mjs` acaba listando quién entra por igualar al proveedor (decisiones 55 y 91 de la
auditoría): un fondo con rendimiento cuya serie ya da la rentabilidad total entra en simulación y
frontera sin que nadie lo decida, y las cifras de las carteras que lo lleven cambian. Lo pregunta a
la regla de verdad, con `quien_entra.py`, que solo lee del emulador, y lo compara con la última
subida, guardada en `refrescos/`, que no va al repositorio ni a la nube. Con `--sube`, si alguien
entra o sale, se para antes de subir hasta que se le diga `--admite-cambios-en-el-calculo`. La lista
solo se guarda al subir desde `refrescar.mjs` (desde el 16-11-2026): un refresco que no sube ya no
gasta esa puerta.

## El refresco dice qué no se ha vuelto a escribir

El escritor no borra nunca, así que un recuento de documentos no puede bajar y no dice si la fuente
ha fallado. Lo que lo dice es la raíz de cada instrumento, que lleva el momento de la pasada que la
escribió: `refrescar.mjs` nombra los instrumentos cuya raíz es anterior a esta pasada —lo que hay de
ellos es de antes, y subiría como vigente—, y si pasan del 1 % `--sube` se para hasta que se le diga
`--admite-instrumentos-sin-reescribir`. Y la base se guarda en disco **después** de comprobar que
valida entera, no antes: si no valida, el volcado sigue siendo el último bueno. Las dos cosas están
escritas el 16-11-2026 y probadas en `probar-refresco.mjs` con casos simulados, y **pasaron en el primer refresco de verdad, ese mismo 16-11-2026**: ningún instrumento quedó sin reescribir y la base se auditó antes de guardarse (PLA-1 y PLA-3 en `AUDITORIA_INTEGRAL_2026-11-16.md`).

`node 4-base-nueva/refrescar.mjs --solo-listado` lo enseña sin escribir nada, y
`node 4-base-nueva/probar-refresco.mjs` lo prueba con cambios simulados.

## Lo que aquí no hay

- **No hay emulador de Auth en este `firebase.json`.** El frontend nuevo ya está en producción desde el 03-11-2026
  y lee esta base en la nube; en local el desarrollo sigue usando el Auth de la base de siempre (9097, `arrancar-entorno`),
  así que este fichero no ha necesitado puerto de Auth. En la **nube** sí hay Auth, con un usuario desde el
  03-11-2026 —el del asesor, y es el uid que las 18 carteras nombran en su `advisor_id`—; la
  frase de antes decía que la base nueva «no tiene usuarios todavía» y dejó de ser verdad ese
  día. `probar-reglas.mjs` no necesita el emulador de Auth porque forja un token sin firma,
  que es lo que el de Firestore acepta como sesión.
- **Las Functions se despliegan desde la app**, con `3-BDB-ACTIVOS_app/scripts/desplegarFunciones.mjs`, y no desde aquí. Lo que se despliega desde aquí son las **reglas**, los **índices** y,
  desde el 03-11-2026, el **sitio**: lo que `compilar-sitio.mjs` deja en `sitio/`. Las pantallas
  que dependen de Cloud Functions no funcionan en esa web hasta que se resuelva su lectura.

  Esta frase decía antes «nada que desplegar… y este id de proyecto no existe en la nube»,
  y era **falsa en las dos mitades** (corregido el 03-11-2026). `bdb-gestor-de-activos` es
  el proyecto **real** que Óscar creó en Firebase —lo dice `AGENTS.md`, que manda sobre este
  documento— y se usa tal cual en el emulador para que el ensayo local sea idéntico al
  destino. Esa frase es la razón por la que esta carpeta estuvo sin puerta de despliegue
  hasta el 03-11: quien la leyera concluía que aquí no hacía falta ninguna.

## La puerta del despliegue

`puerta-despliegue.mjs` es el hook `predeploy` de `firestore`. Esta carpeta despliega a
**un** proyecto, `bdb-gestor-de-activos`, y a ninguno otro: es una lista de permitidos de
uno, no una prohibición del proyecto de BDB —una prohibición dejaría pasar cualquier tercer
proyecto que apareciera mañana—. El id vive en la barrera, no se toma del `.firebaserc`, y
la puerta compara los dos y aborta si discrepan. Si no puede determinar el destino, rechaza.

Se despliega **desde dentro de esta carpeta**, porque es donde está el `firebase.json` y de
ahí sale el directorio de trabajo del hook:

```
cd 4-base-nueva
node compilar-sitio.mjs
npx firebase deploy --only firestore,hosting
```

La puerta también rechaza el despliegue si el sitio saldría sin sus cabeceras de seguridad, o si la
CSP no nombra el dominio de acceso de este proyecto. Son las de la app, cambiando solo ese dominio.
Desde el 21-11-2026 (P2-08 de la auditoría integral del 20-11) son ocho, con `Strict-Transport-Security` —el
mismo valor que Hosting ya servía por su cuenta—, y `connect-src` nombra un origen por servicio en vez de
comodines; de dónde sale cada uno está en `3-BDB-ACTIVOS_app/tests/firebaseHostingSecurity.test.ts`.

`node probar-puerta.mjs` comprueba todo esto sin desplegar nada. Y `firebase
deploy` sigue denegado en `.claude/settings.json` para los agentes: la puerta es para cuando
lo ejecuta Óscar.

### Qué commit está en producción

Desde el 16-11-2026 (auditoría integral, SEG-3) queda escrito:

- **El sitio.** `compilar-sitio.mjs` deja un `version.json` junto al índice, con el commit del que
  salió y la hora de la compilación, y se publica con él. `node version.mjs` lo lee de la web
  publicada y lo compara con el commit de aquí.
- **Las funciones.** `scripts/desplegarFunciones.mjs` dice qué commit sube y, si el despliegue acaba
  bien, añade una línea a `despliegues.jsonl`. Ese fichero es local y no va al repositorio.

Antes había que comparar la huella del índice publicado con una compilación hecha a mano.

## La nube: lo que ya está allí, y en qué orden se conecta

Desde el 03-11-2026 la nube tiene la base entera: **16.118 documentos**, de los que 238 son de
cartera. Verificado leyendo la nube y no por la salida del script que acababa de escribir: 18
carteras, 220 objetivos, y los 220 con el `advisor_id` de su cartera.

Lo escribe `2-plataforma-datos/scripts/subirALaNube.ts`, que es **lo único de todo el
repositorio que habla con Firestore de verdad**. Lleva tres cierres: `--escribe`, la puerta de
entorno `BDB_SUBIDA_A_LA_NUBE` —su frase entera vive en la cabecera del script, no aquí— y que
el `project_id` de la clave de servicio sea este proyecto; la de BDB se rechaza por su nombre.
`--parte carteras` sube solo lo que es de alguien y `--parte catalogo` solo lo que no es de
nadie, porque las carteras tienen un riesgo propio: si su dueño no existe en el Auth del
destino, los documentos se escriben y **nadie puede leerlos**.

**Desde el 03-11-2026 la web publicada lee la nube.** El desarrollo local no, y eso no es una decisión pendiente de tomar: es una
variable. El adaptador usa el camino del SDK solo cuando
`firebaseConfig.projectId === 'bdb-gestor-de-activos'`, y `3-BDB-ACTIVOS_app/.env.local` dice
`VITE_FIREBASE_PROJECT_ID=gestor-activos-local`. Por eso la compilación publicada sale de `compilar-sitio.mjs`, que además toma el último commit: lo que no esté en commit no llega a la web.

### El orden son cuatro pasos, no dos

1. **El dato.** `npm run nube:subir` desde `2-plataforma-datos`, con sus tres cierres.
2. **La regla.** El despliegue de arriba, desde dentro de esta carpeta para que la puerta
   corra. Antes, `node 4-base-nueva/probar-reglas.mjs` en verde contra el emulador; después,
   `npx tsx scripts/verReglasDesplegadas.ts` en `2-plataforma-datos`, que dice qué está
   **activo** y no qué se subió —un `firebase deploy` puede imprimir «uploading rules» y
   fallar en un paso posterior, y pasó el 02-11-2026—.
3. **La variable.** `VITE_FIREBASE_PROJECT_ID=bdb-gestor-de-activos`.
4. **Compilar y desplegar la aplicación.**

Las Functions salen de otra carpeta, con `node scripts/desplegarFunciones.mjs` desde
`3-BDB-ACTIVOS_app`: despliega una lista acotada, comprueba antes el `.env` y no puede tocar reglas ni
sitio. Necesitan plan Blaze y las cuentas `bdb-functions-reader` y `bdb-functions-writer`.

Y un requisito aparte para ver retrocesiones y Sistema: la cuenta tiene que llevar el claim `admin`.
Medido el 03-11-2026: la de Óscar en este proyecto no lo lleva. Sin él no hay error, solo «sin dato».

Y el porqué del orden, que es lo que no se deduce leyendo los pasos:

- **1 antes de 2.** Si la regla pide un campo que el dato no lleva, el asesor entra y no ve
  ninguna cartera. Los documentos están, y nadie puede leerlos.
  Con las carteras ya subidas (comprobado el 03-11-2026: 220 objetivos, ninguno sin `advisor_id`),
  en la subida de las series va antes el despliegue de `firestore`: si no, se indexarían al subir.
- **2 antes de 3 y 4.** La regla concede los objetivos por `advisor_id`, y una compilación
  anterior al 03-11-2026 filtra por `set_by`. Con los dos en desacuerdo Firestore contesta
  **403** y la lista de carteras sale vacía; al revés, un asesor lee objetivos de carteras que
  no son suyas.
- Y **el desacuerdo no se ve donde se programa.** En desarrollo el adaptador habla con el
  emulador usando `Bearer owner`, que **salta las reglas**, así que los dos lados pueden estar
  en desacuerdo meses sin que nada se queje. Estuvieron. Lo caza el último caso de
  `probar-reglas.mjs`, que lee el filtro del adaptador y lo compara con el campo de la regla
  sin tocar el emulador.
