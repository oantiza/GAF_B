# Gestor Activos Financieros

Proyecto independiente para asesoramiento de inversión, nacido el 29-10-2026 como clon
aislado de BDB. **No comparte nada con BDB**: ni repositorios, ni base de datos, ni puertos.

BDB (`C:\Users\oanti\Proyectos\BDB`) no se toca desde aquí bajo ningún concepto.

## Estructura

| Carpeta | Qué es | Stack |
|---|---|---|
| `1-extractor` | Extractor de datos de fondos | Python |
| `2-plataforma-datos` | Carga y validación hacia Firestore | TypeScript |
| `3-BDB-ACTIVOS_app` | La aplicación | React 19 + Vite + Firebase |

Las tres carpetas y la raíz son **un solo repositorio Git** desde el 10-11-2026. Hasta entonces eran cuatro, con
historia heredada de BDB, y se unieron conservándola entera, con sus hashes.

## Repositorio

Uno, **privado**, en la rama `gestor-activos-financieros`: `oantiza/gestor-activos-financieros`.

Los tres que tenían las carpetas (`oantiza/gestor-activos-financieros-extractor`, `-datos` y `-app`) dejaron de
usarse el 10-11-2026 y siguen en GitHub, sin tocar, hasta que se archiven. Su historia está entera en este.

No apunta a los repositorios de BDB (`fondosdb`, `BBDD-ACTIVOS-FINANCIEROS`,
`BDB-ACTIVOS`), que siguen siendo suyos y no se tocan desde aquí.

**Fuera de este proyecto (decisión 107):** la web de estudio, que lee BDB y guarda en BDB sus carteras,
vive en `C:\Users\oanti\Proyectos\bdb-estudio-fuera-de-gestor`, con su `.git` y su remoto
(`oantiza/gestor-activos-financieros-estudio`), y sus paquetes en
`C:\Users\oanti\Proyectos\bdb-estudio-fuera-de-gestor-paquetes`.

## Base de datos

La base de datos de este proyecto es **`gestor-activos-local`**, un emulador de Firestore que se
siembra desde una copia de `2-plataforma-datos/data/backups`.

**Cuál copia no se escribe aquí ni en ningún documento.** La elige el propio script: la más nueva
que haya verificado `PASS`. Cada escritura en la maestra obliga a exportar una copia nueva —el
emulador no persiste—, así que una fecha escrita a mano caduca en cuanto alguien republica, y el
coste de que caduque es sembrar con datos viejos sin que nada avise. El 31-10-2026 hubo cuatro
copias en una mañana y la documentación se quedó apuntando a una vieja: de ahí viene esto.

Las copias antiguas se quedan en disco y **son peores por definición**: les falta lo que se
escribió después. Para usar una a propósito, `--backup <directorio>`.

Los criterios de verificación de la restauración están en la habilidad `arrancar-entorno`.

Arrancarla:

```bash
cd 3-BDB-ACTIVOS_app
PATH="/c/Program Files/Microsoft/jdk-21.0.11.10-hotspot/bin:$PATH" \
  firebase emulators:start --only firestore,auth,functions --project gestor-activos-local
```

El JDK 21 va delante del PATH a propósito: el `java` del sistema es un JRE 1.8 y
firebase-tools exige 21 o superior.

Repoblarla desde cero:

```bash
cd 2-plataforma-datos
npm run backup:restore-drill -- --emulator-host 127.0.0.1:8082 --project gestor-activos-local
```

El emulador no persiste al cerrarse: repoblar es el camino normal, y tarda segundos.

## Puertos propios

| Servicio | BDB | Este proyecto |
|---|---|---|
| Vite | 5173 | **5174** |
| Firestore | 8080 | **8082** |
| Auth | 9099 | **9097** |
| Functions | 5001 | **5005** |

Los dos proyectos pueden estar levantados a la vez sin pisarse.

## Arrancar la app

```bash
cd 3-BDB-ACTIVOS_app
npm run seed:emulator-user   # tras arrancar el emulador: no persiste
npm run dev
```

Entra en http://localhost:5174 con el usuario que imprime `seed:emulator-user`.

### Por qué hay que sembrar un usuario

La copia de seguridad guarda los usuarios **sin correo, sin hash y sin claims**: una copia
no debe llevar credenciales, y hace bien. Con aquellos 18 usuarios no se puede entrar.
`seed:emulator-user` crea uno local de mentira, con el claim `admin`, válido solo contra
el emulador de esta máquina. El emulador no persiste: hay que repetirlo en cada arranque.

### Entorno de las Cloud Functions

`functions_python/venv` no viaja en el repositorio. Si no existe:

```bash
cd 3-BDB-ACTIVOS_app/functions_python
py -3.12 -m venv venv
./venv/Scripts/python.exe -m pip install -r requirements.txt
```

Python 3.12 a propósito: es el runtime que declara `firebase.json`, mientras que el
intérprete por defecto de la máquina es el 3.14.

## Barreras de aislamiento

1. El repositorio tiene remoto **propio** (`oantiza/gestor-activos-financieros`)
   y no apunta a los de BDB (`fondosdb`, `BBDD-ACTIVOS-FINANCIEROS`,
   `BDB-ACTIVOS`): ningún `push` desde aquí puede alcanzar a BDB.
2. `.firebaserc` apunta a `gestor-activos-local`; el proyecto de BDB ya no figura.
3. `restoreBackupToEmulator.ts` rechaza explícitamente `bbdd-activos-financieros`. La copia
   diaria, `runBackupExport.ts`, que hacía lo mismo, se borró con la base vieja el 21-11-2026.
4. `2-plataforma-datos/.env.local` fija `FIRESTORE_EMULATOR_HOST`, mantiene
   `FIRESTORE_LIVE_READONLY=true` y añade `FIRESTORE_REAL_WRITE_ENABLED=false`.
   La ruta al service account de BDB queda comentada.
5. `.claude/settings.json` deniega lectura y escritura sobre la carpeta de BDB.
6. El cableado de emuladores en `src/firebase.ts` solo se activa con
   `import.meta.env.DEV`: una build de producción no puede apuntar a un emulador
   aunque la variable quede puesta.
7. El id del proyecto de la maestra se resuelve en **un solo sitio y sin valor por
   defecto**: `functions_python/master_project.py`. **Es la barrera más importante
   de todas** —las Cloud Functions leen la maestra como proyecto *cruzado*, así que
   ese id decide con qué base hablan— y hasta el 03-11-2026 era la única que **no
   estaba en código**: doce ficheros la resolvían con un defecto propio, ocho de
   ellos con `bbdd-activos-financieros`, y uno de esos ocho era el cliente de
   *escritura*. Ahora, sin `MASTER_PROJECT_ID`, aborta nombrándola en vez de elegir
   destino. El valor se declara en `functions_python/.env`, que desde ese día lee
   también Python y no solo la CLI de Firebase, y
   `functions_python/tests/test_master_project.py` falla si alguien vuelve a
   escribir un defecto en cualquier `.py` del paquete. Desde el 05-11-2026 (decisión
   106) es además una lista de permitidos: solo pasan `gestor-activos-local` y
   `bdb-gestor-de-activos`, el id de BDB se rechaza aunque se declare, y `main.py` no
   arranca si algo de su entorno lo nombra.
8. La **allowlist de proyecto de la plataforma** vive en un solo sitio,
   `2-plataforma-datos/src/config/projectAllowlist.ts`, y dice `gestor-activos-local`.
   Las dieciséis comprobaciones repartidas por `src/loader/` y `scripts/` la importan de
   ahí: **el valor ya no está duplicado en ningún fichero**. A diferencia de las demás,
   esta barrera no depende de variables de entorno —está en el código— así que una
   variable mal puesta no la abre.

   Desde el 01-11-2026 el mismo fichero nombra un segundo proyecto,
   `bdb-gestor-de-activos`, que es el de la base nueva. **No está en el mismo conjunto, y
   eso es la mitad de la barrera**: cada escritor conoce el suyo y rechaza el otro. Con los
   dos dentro de un conjunto compartido, un `FIREBASE_PROJECT_ID` equivocado escribiría los
   documentos de la base nueva en el proyecto de la vieja, la comprobación lo autorizaría, y
   cada documento sería perfectamente válido salvo en que está en la base que no es: ninguna
   auditoría puede ver eso. `tests/projectAllowlist.test.ts` falla si los dos papeles se
   solapan.

   Con una precisión medida el 01-11-2026, para no creer que protege más de lo que protege:
   **lo que de verdad decide a qué base va una escritura es el puerto, no el id**. Los dos
   emuladores arrancan con `singleProjectMode`, y el de la base nueva sirve sus colecciones con
   cualquier id de proyecto. Por eso el destino de la base nueva son **las dos cosas juntas**,
   id y puerto, y las dos son constantes de código: el puerto es el que separa, y el id es el
   que deja dicho a qué base cree estar escribiendo quien escribe.

   Hasta el 30-10-2026 las dieciséis llevaban el literal copiado, heredado del clon y
   nombrando el proyecto real de BDB. Eso tenía dos efectos malos a la vez: ninguna etapa
   de escritura arrancaba aquí, y el arreglo intuitivo ante el error —apuntar
   `FIREBASE_PROJECT_ID` al proyecto de BDB— habría puesto al clon a escribir en la
   maestra de producción. Estaba además con dos ortografías, `ALLOWED_PROJECT_IDS` con un
   `Set` y `const PROJECT_ID` con un `!==`, y al corregirlas un grep de la primera se dejó
   cinco. La constante única es la respuesta a eso, no al literal viejo.

   Comprobado de tres formas: llamando a `getDb()` (`gestor-activos-local` ACEPTADO,
   `bbdd-activos-financieros` RECHAZADO), ejecutando `npm run audit:app-owned`, que antes
   moría con «Project id inesperado» y ahora lee el emulador del clon, y con
   `tests/projectAllowlist.test.ts`, que falla si alguien vuelve a escribir el literal de
   BDB en cualquier `.ts` de `src/` o `scripts/`.

   La prueba exceptúa cinco rutas, y ninguna lo trata como proyecto autorizado:
   `restoreBackupToEmulator.ts`, `subirALaNube.ts` y
   `verReglasDesplegadas.ts` lo **prohíben**; `projectAllowlist.ts` y `asesores.ts` lo nombran
   en un comentario. `runBdbDeployedFunctionsStockSmoke.ts` estuvo en esa lista hasta el
   05-11-2026, porque llamaba a las Functions desplegadas de BDB: ahora mira las de este
   proyecto, y sigue sin tener script en `package.json`.
9. **La prueba que barre el repositorio**, `3-BDB-ACTIVOS_app/tests/barreraDeBdb.test.ts`
   (decisión 106, 05-11-2026), corre con `npm test` de la app. Mira lo que las dos anteriores
   no miraban: `scripts/` de la app, `sites/`, `4-base-nueva` y `1-extractor`. El id y el número
   de proyecto de BDB solo pueden aparecer en su lista declarada, con su razón y con cuántas
   líneas; todo cliente de base recibe el proyecto de la constante, o está declarado con lo que
   lo hace seguro; las órdenes contra BDB, solo en `docs/historico-bdb/`; y ninguna carpeta
   lleva un repositorio dentro. Y comprueba que los dos proyectos permitidos dicen lo mismo en Python y
   en TypeScript.

Verificado el 29-10-2026: al entrar en la app, la autenticación va a `127.0.0.1:9098`
y no sale **ni una sola petición** a ningún servidor real de Google.

Los `.env.local` originales de BDB quedaron guardados como `.env.local.bdb-original`
por si hubiera que consultarlos. **No los uses tal cual: apuntan a producción.**

## Cómo lee la app la base de datos

```
Navegador (5174)
  └─ Auth        → emulador 9097
  └─ Firestore   → emulador 8082   (carteras propias de la app)
  └─ Functions   → emulador 5005   (datos maestros)
                     └─ google-cloud-firestore, proyecto MASTER_PROJECT_ID
                          → emulador 8082
```

Las Functions necesitan `MASTER_PROJECT_ID` en `functions_python/.env` (qué proyecto leer). Dónde
está la base lo pone el emulador de Functions con `FIRESTORE_EMULATOR_HOST`, por encima de lo que
diga el fichero, y por eso desde el 03-11-2026 no se declara ahí: ese `.env` también se lee al
desplegar, y la variable dejaría a las funciones de la nube buscando un emulador.

Los nombres con prefijo `FIREBASE_`, `GCLOUD_` y `GOOGLE_` están **reservados** y la
CLI rechaza el `.env` entero si aparecen ahí.

Verificado el 29-10-2026: el Buscador devuelve 1.095 activos del universo y 192
coincidencias para «global», sin una sola petición HTTPS.
