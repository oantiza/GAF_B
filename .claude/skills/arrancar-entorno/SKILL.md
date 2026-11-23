---
name: arrancar-entorno
description: Comprueba o levanta el entorno local de Gestor Activos Financieros — el emulador de la base nueva, Auth y Functions contra él, el usuario local y la app en Vite — y verifica que la base responde. Úsalo al empezar cualquier sesión que vaya a tocar la app o los datos, cuando el Buscador salga vacío, o cuando haya que saber si el entorno sigue en pie.
---

# Arrancar el entorno

**Desde el 21-11-2026 hay un solo entorno local: el de la base nueva**, proyecto
`bdb-gestor-de-activos`, el mismo que lee producción (decisión de Óscar, «A, a la base nueva»).
La web local y las Functions locales leen lo mismo y por el mismo camino que la nube: el SDK con
la sesión del usuario y las reglas de la nube, y en las Functions el lector de la base nueva.

| Servicio | Puerto | Se arranca desde |
|---|---|---|
| Firestore de la base nueva | 8092 | `4-base-nueva` (persiste en disco) |
| Hub de ese emulador | 4402 | (el mismo) |
| Auth | 9097 | `3-BDB-ACTIVOS_app` |
| Functions | 5005, región `europe-west1` | `3-BDB-ACTIVOS_app` |
| Vite | 5174 | `3-BDB-ACTIVOS_app` |

Reserva además 4501 y 9151 sin avisar antes: son del emulador de la base nueva, no huérfanos.

**Ese id es el del proyecto REAL.** Lo único que separa una escritura local de la nube es que el
cliente hable con un emulador. Por eso hay tres barreras en código, y no se esquivan:

- Las Functions **no arrancan** en el emulador sin `FIRESTORE_EMULATOR_HOST`
  (`master_project.exigir_emulador_en_local`, llamada desde `main.py`). El emulador de
  Functions no la pone solo, porque el Firestore de la base nueva corre en otro proceso.
- La web solo usa el SDK en desarrollo si está conectada a los emuladores
  (`VITE_FIREBASE_USE_EMULATORS=true`); si no, lee por REST contra el 8092
  (`src/adapters/baseNuevaLectura.ts`).
- La siembra del usuario se niega si el Auth no es un emulador de esta máquina.

La base vieja (`gestor-activos-local`, Firestore 8082) **ya no se arranca**: ver el apartado 5.

## 1. Comprobar antes de levantar

Los emuladores **sobreviven entre sesiones de Claude**. Comprueba antes de arrancar: lo
normal es que siga todo en pie.

**No lo compruebes con los puertos.** `Get-NetTCPConnection -State Listen` y `netstat` no listan
el 8092, porque lo abre la JVM del emulador de Firestore; y `Test-NetConnection -Port 5174` da
`False` aunque Vite esté levantado, porque **Vite escucha solo en `::1`**. Dar el entorno por
caído leyendo puertos es un error que ya se ha cometido. Pregúntale a cada servicio:

```powershell
$h = @{ Authorization = 'Bearer owner' }
$u = "http://127.0.0.1:8092/v1/projects/bdb-gestor-de-activos/databases/(default)/documents/instruments?pageSize=1"
try { $r = Invoke-RestMethod -Uri $u -Headers $h -TimeoutSec 15; if ($r.documents) { "8092 viva y con datos" } else { "8092 viva pero VACIA" } } catch { "8092 no responde" }
try { (Invoke-RestMethod -Uri "http://127.0.0.1:9097/" -TimeoutSec 10).authEmulator.ready } catch { "auth caido" }
try { (Invoke-WebRequest -Uri "http://localhost:5174/" -UseBasicParsing -TimeoutSec 10).StatusCode } catch { "vite caido" }
```

`Bearer owner` salta las reglas: sin ella, la base contesta 403 y parece caída. Functions
responde 404 en la raíz pero sirve sus llamadas en `europe-west1`. El hub enseña lo que tiene
levantado en `http://127.0.0.1:4402/emulators`.

## 2. Levantar, en este orden

**Óscar trabaja en PowerShell**: los comandos con variables de entorno van en PowerShell, que
es lo que él puede pegar. `VAR=valor comando` no existe en PowerShell.

### 1) La base nueva — desde la raíz

```powershell
cd C:\Users\oanti\Proyectos\Gestor-Activos-Financieros && node 4-base-nueva/arrancar.mjs
```

Déjalo en segundo plano. Pone el JDK 21 delante del PATH, importa el volcado anterior si lo hay
y pide guardar al salir. Tarda unos 20 segundos.

### 2) Auth y Functions contra ella — desde `3-BDB-ACTIVOS_app`

```powershell
cd C:\Users\oanti\Proyectos\Gestor-Activos-Financieros\3-BDB-ACTIVOS_app; $env:PATH = "C:\Program Files\Microsoft\jdk-21.0.11.10-hotspot\bin;$env:PATH"; $env:FUNCTIONS_DISCOVERY_TIMEOUT = "120"; $env:FIRESTORE_EMULATOR_HOST = "127.0.0.1:8092"; firebase emulators:start --only auth,functions --project bdb-gestor-de-activos
```

En segundo plano, mejor desde PowerShell, con `*> emuladores.log` al final: desde Bash en segundo
plano salió varias veces con código 127 el 11-11-2026, sin causa confirmada. Con
`--project bdb-gestor-de-activos` la CLI carga `functions_python/.env` y encima
`.env.bdb-gestor-de-activos`, que pone `MASTER_PROJECT_ID=bdb-gestor-de-activos` y las
escrituras programadas apagadas. Listo cuando el registro dice «All emulators ready» con 35
funciones de llamada; las 11 programadas salen como «ignored» porque no hay Pub/Sub, y está bien.

**Se ha caído alguna vez con varias sesiones fotografiando a la vez** (salen 429 y luego nada
escucha en el 9097 ni en el 5005). Si pasa, se vuelve a levantar con la misma orden y se
**resiembra el usuario**.

### 3) El usuario local — desde `3-BDB-ACTIVOS_app`

```powershell
npm run seed:emulator-user
```

El emulador de Auth arranca **sin ningún usuario** en cada arranque, así que hay que repetirlo
siempre que se levante Auth. Crea un usuario local con el claim `admin` y el correo verificado
(las reglas de la base nueva lo exigen), válido solo contra este emulador, e **imprime las
credenciales**: no las pegues en un mensaje. Sin sembrar, entrar falla y la batería de capturas
fotografía la pantalla de acceso en todas las rutas.

### 4) La app — desde `3-BDB-ACTIVOS_app`

```powershell
npm run dev
```

Vite relee el `.env.local` solo cuando cambia («.env.local changed, restarting server»). Ese
fichero no va al repositorio; desde el 21-11-2026 sus `VITE_FIREBASE_*` son los del proyecto de
la base nueva y `VITE_FIREBASE_FIRESTORE_EMULATOR_HOST=127.0.0.1:8092`. La copia de cómo
estaba antes está en `Gestor-Activos-Financieros-copias\desarrollo-local-base-nueva-21-11`.

## 3. La base nueva persiste: no se siembra en cada arranque

Si hay volcado en `4-base-nueva/datos/`, el arranque dice `al arrancar: IMPORTA el volcado
anterior` y la base vuelve entera. Compruébalo leyéndola, no por el mensaje:

```powershell
cd C:\Users\oanti\Proyectos\Gestor-Activos-Financieros\2-plataforma-datos && npm run audit:base-nueva
```

Para guardar **sin parar el emulador** —antes de un reinicio, o después de una pasada que ha
costado—: `node 4-base-nueva/guardar.mjs` desde la raíz.

- **Ctrl-C guarda de verdad** (`--export-on-exit`, comprobado el 01-11-2026 con un documento
  testigo escrito después de importar).
- **Un kill a la fuerza no guarda nada**: vuelve lo del último volcado.

**Lo que escribe la app en local también persiste** (carteras guardadas, retrocesiones,
informes publicados): va a esta base, no a la nube. Subir esas partes a la nube exige
`--piso-lo-de-la-app`, porque en la nube manda lo que Óscar edita allí.

### Escribirla de cero — desde `2-plataforma-datos`

Solo si está vacía, o si el canónico del extractor ha cambiado. El orden y las puertas están en
la habilidad `pipeline-extractor`; en corto:

```powershell
$env:BDB_DATA_PLATFORM_ENABLE_MASTER_WRITES = "YES_I_UNDERSTAND_MASTER_DB_WRITES"; npm run baseNueva:write -- --write; npm run baseNueva:batch -- --write; $env:BDB_DATA_PLATFORM_ENABLE_MASTER_WRITES = $null
```

La versión de PowerShell **borra la variable al acabar**: en PowerShell `$env:` se queda puesto en
esa ventana, y la puerta de escritura quedaría armada. Sin la segunda pasada (`baseNueva:batch`)
la base tiene los bloques pero **cero tarjetas**, que es lo que la app lee. El criterio es una
igualdad, no un número: `audit:base-nueva` con `que NO validan` a 0, o `baseNueva:plan` con
`crear` a 0. El escritor toma proyecto y puerto de `src/config/projectAllowlist.ts` e impone el
emulador en código.

## 4. Si un puerto sale «port taken»

Pueden quedar procesos huérfanos reteniendo puertos si algo murió a medias. **No mates
procesos sin permiso de Óscar:** dile que un reinicio los limpia, o pídeselo.

## 5. La base vieja, retirada del desarrollo (21-11-2026)

`gestor-activos-local` es el clon sembrado de la copia de la maestra de BDB (Firestore 8082). La
app y las Functions ya no la usan, y el código que la leía se borró el 21-11-2026 (C-32): el estado
anterior está en la etiqueta de Git `referencia-base-vieja-2026-11-21`.

Si alguna vez hace falta levantarla para mirar los datos de entonces (el `firebase.json` de la app ya no
lleva reglas de Firestore, así que arranca **abierta**, solo en esta máquina):

```powershell
cd C:\Users\oanti\Proyectos\Gestor-Activos-Financieros\3-BDB-ACTIVOS_app; $env:PATH = "C:\Program Files\Microsoft\jdk-21.0.11.10-hotspot\bin;$env:PATH"; firebase emulators:start --only firestore --project gestor-activos-local
```

Y repoblarla, desde `2-plataforma-datos`: `npm run backup:restore-drill -- --emulator-host
127.0.0.1:8082 --project gestor-activos-local` (sin `--backup` elige la copia más nueva con
`PASS`; el criterio es `restored == verified == firestore_records` y `mismatches: 0`). La app y las
Functions de hoy ya no saben leerla: para eso habría que volver a la etiqueta de arriba.

## 6. La barrera que no se puede romper

`master_project.py` resuelve en un solo sitio con qué base hablan las Functions, sin valor por
defecto, y solo deja pasar `gestor-activos-local` y `bdb-gestor-de-activos`: el id de BDB se
rechaza aunque se declare (decisión 106). `functions_python/.env` sigue diciendo
`MASTER_PROJECT_ID=gestor-activos-local`, y es a propósito: un script de Python ejecutado a mano
resuelve ese proyecto, que no existe en la nube, y falla al conectar en vez de escribir en ningún
sitio. El emulador de Functions, arrancado con `--project bdb-gestor-de-activos`, toma el de
`.env.bdb-gestor-de-activos`.
