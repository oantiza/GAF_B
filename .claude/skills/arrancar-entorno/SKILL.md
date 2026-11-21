---
name: arrancar-entorno
description: Comprueba o levanta el entorno local completo de Gestor Activos Financieros — los dos emuladores (base vieja y base nueva), la base sembrada, el usuario local y la app en Vite — y verifica que las bases responden. Úsalo al empezar cualquier sesión que vaya a tocar la app o los datos, cuando el Buscador salga vacío, o cuando haya que saber si el entorno sigue en pie.
---

# Arrancar el entorno

Desde el 01-11-2026 hay **dos entornos**, cada uno en su proyecto y su emulador. No se
mezclan y no hace falta levantar los dos: levanta el que vayas a tocar.

**La base de siempre** — el clon sembrado de la copia de la maestra de BDB, proyecto
`gestor-activos-local`, en `3-BDB-ACTIVOS_app`. Es la que lee la app de hoy.

| Servicio | Puerto |
|---|---|
| Vite | 5174 |
| Firestore | 8082 |
| Auth | 9097 |
| Functions | 5005 |

**La base nueva** — proyecto `bdb-gestor-de-activos`, en `4-base-nueva`. La escribe
`2-plataforma-datos` y **persiste en disco**. La app todavía no la lee.

| Servicio | Puerto |
|---|---|
| Firestore | 8092 |
| Hub del emulador | 4402 |

Reserva además 4501 y 9151 sin avisar antes: son suyos, no huérfanos.

## 1. Comprobar antes de levantar

Los emuladores **sobreviven entre sesiones de Claude**. Comprueba antes de arrancar: lo
normal es que siga todo en pie.

**No lo compruebes con los puertos.** Verificado el 01-11-2026 con los dos emuladores
corriendo y sirviendo peticiones: `Get-NetTCPConnection -State Listen` **no lista** ni el 8082
ni el 8092, y `netstat` tampoco los da como `LISTENING`, porque los abre la JVM del emulador
de Firestore. Y para el 5174, `Test-NetConnection -Port 5174` da `False` aunque Vite esté
perfectamente levantado, porque **Vite escucha solo en `::1`** (IPv6). Tres servicios de cinco
mienten en el chequeo de puertos, así que **el chequeo de puertos no vale aquí**: dar el
entorno por caído leyéndolo es un error que ya se ha cometido.

Pregúntale a cada servicio, que es lo que no miente:

```powershell
$h = @{ Authorization = 'Bearer owner' }
function Viva($puerto, $proyecto, $coleccion) {
  $u = "http://127.0.0.1:${puerto}/v1/projects/${proyecto}/databases/(default)/documents/${coleccion}?pageSize=1"
  try { $r = Invoke-RestMethod -Uri $u -Headers $h -TimeoutSec 15; if ($r.documents) { "$puerto viva y con datos" } else { "$puerto viva pero VACIA" } } catch { "$puerto no responde" }
}
Viva 8082 'gestor-activos-local' 'assets'
Viva 8092 'bdb-gestor-de-activos' 'instruments'
try { (Invoke-WebRequest -Uri "http://localhost:5174/" -UseBasicParsing -TimeoutSec 10).StatusCode } catch { "vite caido" }
```

**Las llaves de `${coleccion}` no son estilo.** Sin ellas, `$coleccion?pageSize` es un nombre
de variable válido en PowerShell —el `?` cuenta como letra—, así que vale vacío y la URL sale
`.../documents/=1`, que contesta **200 con cero documentos**. Pasó el 01-11-2026: una base con
11.566 documentos dentro, informada como vacía, con el código de estado diciendo que todo bien.
Es el mismo defecto que el resto del proyecto: una respuesta válida afirmando otra cosa.

La cabecera `Bearer owner` hace falta: salta las reglas de seguridad, que en el proyecto
nuevo están **cerradas del todo**. Sin ella, una base perfectamente viva contesta 403 y
parece caída.

**Y el id de proyecto de la URL no distingue nada.** Medido el 01-11-2026: los dos emuladores
arrancan con `singleProjectMode`, y el 8092, después de importar su volcado, sirve
`instruments` **con cualquier id de proyecto**, el de BDB incluido. Lo que separa las dos
bases es **el puerto**, no el id: el 8082 tiene `assets` y ningún `instruments`, y el 8092 al
revés. Para saber en qué base estás, mira el puerto; un id de proyecto en una URL no prueba
nada.

Las otras señales de vida: Auth devuelve `authEmulator.ready: true` en
`http://127.0.0.1:9097/`, Functions responde 404 en la raíz pero sirve sus llamadas en
**`europe-west1`** (no `us-central1`), y el hub de la base nueva enseña lo que tiene
levantado en `http://127.0.0.1:4402/emulators`.

## 2. Levantar, en este orden

**Oscar trabaja en PowerShell**, así que los comandos con variables de entorno van en dos
versiones: la de PowerShell es la que él puede pegar, y la de bash la que usa la herramienta
Bash de una sesión. No son intercambiables, y confundirlas es un error que ya se ha cometido:
`VAR=valor comando` **no existe en PowerShell**, y falla con «no se reconoce como nombre de un
cmdlet». Los comandos que no llevan variables (`npm run ...`) son iguales en los dos.

### Emuladores — desde `3-BDB-ACTIVOS_app`

PowerShell:

```powershell
cd C:\Users\oanti\Proyectos\Gestor-Activos-Financieros\3-BDB-ACTIVOS_app; $env:PATH = "C:\Program Files\Microsoft\jdk-21.0.11.10-hotspot\bin;$env:PATH"; firebase emulators:start --only firestore,auth,functions --project gestor-activos-local
```

bash:

```bash
PATH="/c/Program Files/Microsoft/jdk-21.0.11.10-hotspot/bin:$PATH" firebase emulators:start --only firestore,auth,functions --project gestor-activos-local
```

El JDK 21 va delante del PATH **a propósito**: el `java` del sistema es un JRE 1.8
y firebase-tools exige 21 o superior. Déjalo en segundo plano.

**En segundo plano, mejor desde PowerShell** (la orden de arriba, con `*> emuladores.log` y
`$env:FUNCTIONS_DISCOVERY_TIMEOUT = "120"`). Desde Bash en segundo plano, el 11-11-2026 salió cuatro veces con código 127
nada más empezar las Functions, con la salida redirigida y sin redirigir, y otras cuatro arrancó; la causa no está
confirmada. Desde PowerShell arrancó a la primera. Si falla, queda vivo el Firestore del 8082: para ese proceso antes de
reintentar.

### Repoblar la base — desde `2-plataforma-datos`

```bash
npm run backup:restore-drill -- --emulator-host 127.0.0.1:8082 --project gestor-activos-local
```

Tarda segundos y es idempotente: repoblar con el emulador ya corriendo es inofensivo.

**No le pases `--backup`.** Sin ese parámetro el script elige la copia más nueva que haya
verificado `PASS` y te dice cuál, en una línea:

```
[restore] copia mas nueva con PASS: 2026-10-31T07-51-41-046Z
```

Así no hay ninguna fecha escrita en este documento que pueda caducar. Las copias viejas siguen en
disco y **son peores por definición**: les falta lo que se escribió después. Para usar una a
propósito, `--backup <directorio>`.

Una trampa que se lee al revés de como suena: **más índices no es mejor.** La copia del 31-10 a
las 06:15 tiene 725 y la de las 07:51 tiene 645, y la buena es la segunda, porque 88 de aquellos
725 eran el centinela `Not Benchmarked` colado en el campo del índice.

### Usuario local — desde `3-BDB-ACTIVOS_app`

```bash
npm run seed:emulator-user
```

Hace falta porque la copia de seguridad guarda los usuarios **sin correo, sin hash y
sin claims** (una copia no debe llevar credenciales). Con los 18 usuarios de la copia
no se puede entrar. El script crea uno local con el claim `admin`, válido solo contra
este emulador, e **imprime las credenciales**: úsalas tal cual, no las inventes.

**Y hay que repetirlo en cada arranque del emulador de Auth.** No persiste: arranca **sin ningún usuario**, aunque la
base siga sembrada o se levanten solo `auth` y `functions` porque Firestore ya estaba en pie. Sin sembrar, entrar falla y
la batería de capturas fotografía la pantalla de acceso en todas las rutas. Pasó el 10-11-2026: una pasada entera de
capturas perdida por esto. Si vas a pegar la salida en un mensaje, no la pegues: lleva las credenciales.

### La app — desde `3-BDB-ACTIVOS_app`

```bash
npm run dev
```

## 2bis. La base nueva, que es otro entorno

Desde el 01-11-2026 la base nueva tiene **proyecto propio y emulador propio**, y
**persiste en disco**. La app todavía no la lee, así que si no vas a tocarla, sáltate todo
esto: la base de siempre no lo necesita.

### Levantar su emulador — desde la raíz

```bash
node 4-base-nueva/arrancar.mjs
```

Déjalo en segundo plano. Pone el JDK 21 delante del PATH, importa el volcado anterior si lo
hay y pide guardar al salir. Tarda unos 20 segundos.

### Lo que ya no hay que hacer: sembrarla en cada arranque

**Persiste.** Si hay volcado en `4-base-nueva/datos/`, el arranque dice
`al arrancar: IMPORTA el volcado anterior` y la base vuelve entera. Compruébalo leyéndola,
no por el mensaje:

```bash
cd 2-plataforma-datos && npm run audit:base-nueva
```

Para guardar **sin parar el emulador** —antes de un reinicio, o después de una pasada que ha
costado—:

```bash
node 4-base-nueva/guardar.mjs
```

Las dos vías de la persistencia están **verificadas el 01-11-2026**, cada una con su prueba, y
no hay que confundirlas:

- **Ctrl-C guarda de verdad.** Probado enviando un Ctrl-C real a la consola del emulador, con
  un documento testigo escrito *después* de importar y que el volcado no tenía: al arrancar de
  nuevo, el testigo estaba. Así que `--export-on-exit` no es una promesa leída en la
  documentación, es un comportamiento comprobado. (El volcado se reescribió, de las 21:17 a las
  21:25.)
- **Un kill a la fuerza no guarda nada.** `Stop-Process -Force` o `taskkill /F` se saltan el
  cierre, y lo que vuelve al arrancar es lo del **último volcado**. Probado también: 11.566
  documentos volvieron intactos, pero porque antes se había ejecutado `guardar.mjs`.

De ahí la costumbre: **Ctrl-C para parar**, y `guardar.mjs` después de una pasada que ha
costado, por si el cierre no llega a ser ordenado. Y el criterio para dar la vuelta por buena
no es que el mensaje diga que importó: es `npm run audit:base-nueva` con `que NO validan` a 0, o
`npm run baseNueva:plan` con `crear` a 0 y `reemplazar` igual a lo escrito, que es lo que dice
que no falta ningún documento.

### Escribirla de cero — desde `2-plataforma-datos`

Solo si está vacía, o si el canónico del extractor ha cambiado. **No hace falta en cada
arranque.**

PowerShell:

```powershell
$env:BDB_DATA_PLATFORM_ENABLE_MASTER_WRITES = "YES_I_UNDERSTAND_MASTER_DB_WRITES"; npm run baseNueva:write -- --write; $env:BDB_DATA_PLATFORM_ENABLE_MASTER_WRITES = $null
```

bash:

```bash
BDB_DATA_PLATFORM_ENABLE_MASTER_WRITES=YES_I_UNDERSTAND_MASTER_DB_WRITES npm run baseNueva:write -- --write
```

La versión de PowerShell **borra la variable al acabar**, y eso no es cosmético: en bash el
prefijo vale solo para ese comando, pero en PowerShell `$env:` se queda puesto en esa ventana,
así que la puerta de escritura quedaría armada para todo lo que se ejecutara después. La
puerta existe para que escribir sea una decisión, no un estado.

Y después, la segunda pasada, que es la que compone la calidad y la tarjeta de lectura:

```bash
BDB_DATA_PLATFORM_ENABLE_MASTER_WRITES=YES_I_UNDERSTAND_MASTER_DB_WRITES npm run baseNueva:batch -- --write
```

Sin ella la base tiene los bloques pero **cero tarjetas**, que es justo lo que la app leerá.
Medido el 01-11-2026: la primera pasada escribe 10.036 documentos y la segunda 1.542 (771
`quality/latest` y 771 `read/card`). El criterio, igual que el de la copia, **es una igualdad
y no un número**: `ausentes`, `distintos` e `invalidos` los tres a 0.

Dos cosas que conviene saber antes de ejecutarlo:

- **Sin la variable del principio no escribe.** El proyecto y el puerto, en cambio, ya no se
  pasan: el escritor los toma de `src/config/projectAllowlist.ts`, y si el entorno pide otros
  **aborta nombrando el conflicto** en vez de ignorarlos.
- **No borra nada.** Si una pasada deja de producir un bloque que la anterior sí producía, ese
  bloque se queda en la base y el script lo nombra como **sobrante**. Con la base recién
  escrita no puede haber ninguno.

Para mirar lo escrito sin tocarlo, `npm run audit:base-nueva`: lee la base, revalida cada
documento contra su contrato y comprueba dos cosas de contenido que ya han fallado una vez
—centinelas en el nombre del índice, que tienen que ser **0**, y repartos de activos que no
suman 1, que tienen que ser **0**—. Y `npm run baseNueva:plan` enseña qué haría sin escribir.

**Lo que la auditoría NO ve, medido el 01-11-2026.** Cuenta andando desde las raíces de
`instruments`, así que los documentos cuya raíz no se escribió **no existen para ella**.
`LU2504555777` tiene 12 (once `declared/*` y un `computed/metrics`) colgando de una raíz que
el contrato bloqueó por no traer `classification.category`: la auditoría dice que la base
«valida entera» y esos doce no los mira nadie. El plan sí los ve, como `reemplazar`. Si las
dos cifras no cuadran, la diferencia son huérfanos.

## 3. Verificar

**El criterio no es un número, es una igualdad**, y por eso no caduca:

```
status: PASS   restored: N   verified: N   mismatches: 0
```

`N` lo dice la propia copia en su `summary.json` (`firestore_records`), y **sube con cada pasada**:
cada `republish` deja su registro en `ingestion_runs`. Lo que tiene que cuadrar es que
`restored == verified == firestore_records` y que `mismatches` sea 0. Si no cuadra, **no sigas**.

```bash
python -c "import json;d=json.load(open('data/backups/<copia>/summary.json'));print(d['firestore_records'],d['auth_users'],d['verification'])"
```

- **`auth_users_artifact_verified` no es un fallo valga lo que valga.** Una copia exportada de este
  emulador recoge los usuarios que hubiera, y los guarda **sin correo, sin hash y sin claims**, así
  que con ellos no se puede entrar: `seed:emulator-user` es obligatorio en cada arranque. Las copias
  del 31-10 dan 0 o 1 según si el usuario local estaba creado al exportar; la del 29-10 da 18, que
  es un artefacto informativo.
- **Centinelas en el campo del índice: siempre cero.** Es la única comprobación de contenido que
  conviene hacer a mano tras sembrar. Si `classification.official_benchmark` trae algún
  `Not Benchmarked`, `N/A` o `None`, la copia es anterior al 31-10-2026 y la ficha imprimiría el
  centinela como si fuera el nombre de un índice.

## 4. Si un puerto sale «port taken»

Pueden quedar procesos huérfanos reteniendo 8081, 9098, 5003 y 5004, y también los
cuatro propios si algo murió a medias. **No mates procesos sin permiso de Oscar:**
dile que un reinicio los limpia, o pídeselo.

## 5. La barrera que no se puede romper

`3-BDB-ACTIVOS_app/functions_python/.env` debe tener
`MASTER_PROJECT_ID=gestor-activos-local`. Las Cloud Functions leen la maestra como
proyecto **cruzado**, así que ese id decide con qué base hablan.

Desde el 03-11-2026 **ya no hay valor por defecto**, y eso cambia qué pasa si la línea
falta. `master_project.master_project_id()` es el único sitio donde se resuelve el id, y
sin la variable **aborta nombrándola**. Antes el defecto era `bbdd-activos-financieros`,
el proyecto real de BDB, en ocho ficheros —uno de ellos el cliente de **escritura**—, y
nada en Python leía el `.env`: lo cargaba solo la CLI de Firebase, así que un script
ejecutado a mano se quedaba sin la variable y recibía el defecto. Ahora lo lee
`cargar_dotenv()`, solo esa clave.

Sigue comprobándolo si el Buscador sale vacío: falta esa variable, o el emulador de Firestore no
está levantado junto al de Functions, que es quien pone `FIRESTORE_EMULATOR_HOST`. Lo que ya no puede pasar es que la falta de la variable se
resuelva en silencio hacia BDB; que el código de arriba se trague la excepción sin
decir nada **no está comprobado de nuevo**, así que trátalo como antes.
