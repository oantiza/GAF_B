# Unificar los cuatro repositorios en uno

**Hecho el 10-11-2026 por la tarde.** Óscar lo decidió ese día a las 00:00 («Sí, tras la subida») y dio la orden por la tarde
(«Sí, unifica»), con la undécima subida cerrada y los cuatro subidos a GitHub. Lo que sigue es el encargo tal como
se escribió antes de hacerlo; cómo quedó de verdad está al final, en «Cómo quedó». No lleva número de serie: no es de pantalla, de datos, de base nueva ni de
adquisición, y se cita por este documento.

Este documento es el encargo para quien lo haga. Distingue lo **medido** (09 y 10-11-2026, con el estado de esos días) de
lo **propuesto**, que se prueba en el ensayo antes de tocar nada.

## Por qué

Los cuatro repositorios se heredaron de BDB; no se eligieron para este proyecto. Medido el 09-11:

- **Cambian juntos.** En 11 de los 11 días con actividad desde el 29-10 hubo commits en la plataforma y en la app.
- **Se leen por ruta.** La plataforma lee las exportaciones del extractor; los contratos se copian de la plataforma al
  extractor y a la app, cada copia con su comprobación de desvío.
- **La raíz cose a mano.** 138 de sus 337 commits desde el 29-10 son líneas de coordinación, que citan unos 133 hashes
  de los otros tres.
- **Una cifra publicada depende de tres hashes** (extractor, plataforma, app) más el documento del método. Con un
  repositorio, un hash dice el estado de todo lo que la produjo.

## Qué no cambia

Las carpetas no se mueven. `1-extractor`, `2-plataforma-datos` y `3-BDB-ACTIVOS_app` ya están dentro de la raíz, así que
**el repositorio de la raíz los absorbe donde están**. Las rutas relativas entre capas siguen valiendo, y lo que Git ignora
(`secrets.json`, los `.env`, `node_modules`, los entornos de Python, `4-base-nueva/datos/`) no se toca porque no se mueve.
Tampoco cambian las bases, Firebase ni la barrera contra BDB: esto es solo control de versiones.

## Condiciones para empezar

1. La undécima subida, cerrada.
2. **Los cuatro subidos a GitHub.** Es la copia de antes. El 10-11 a las 00:00 hay 316 commits sin subir (raíz 190,
   extractor 49, plataforma 35, app 42; los últimos subidos son del 06-11). Subir lo pide Óscar.
3. Los cuatro árboles limpios, y ninguna sesión ni agente escribiendo.
4. Un `git bundle create … --all` de cada uno, verificado con `git bundle verify`, **fuera** de la carpeta del proyecto.
   Las ramas que no son `gestor-activos-financieros` (raíz 2, extractor 12, plataforma 13, app 32 ramas locales, casi
   todas de BDB) y las 5 etiquetas no pasan al repositorio único: viven en esos bundles y en los remotos archivados.

## Método (propuesto)

**Se conserva la historia y se conservan los hashes.** Cada repositorio entra como una fusión de historias sin relación
(`--allow-unrelated-histories`) con su árbol colocado bajo su carpeta (`read-tree --prefix`). Los commits antiguos no se
reescriben, así que los hashes que citan la coordinación, las decisiones y las evidencias **siguen resolviendo**. Quedarían
1.907 commits (357 + 226 + 308 + 1.016) más tres de fusión.

La alternativa es reescribir las rutas (`git filter-repo --to-subdirectory-filter`): la historia de cada fichero se lee
seguida, pero **todos los hashes cambian**. Se descarta por eso.

Lo que el método elegido empeora: `git log -- 3-BDB-ACTIVOS_app/src/x` solo ve lo posterior a la fusión; lo anterior hay
que pedirlo con la ruta de entonces (`src/x`). Que `git blame` atraviese la fusión es lo esperado y se comprueba en el
ensayo. Va escrito en `AGENTS.md` el día que se haga.

**Primero, ensayo en una copia** (los cuatro clonados en otra carpeta, con la misma disposición): el procedimiento entero
y la lista de «Cómo se da por bueno» de abajo. Solo después, en el sitio. El orden en el sitio tiene una trampa: mientras
exista `3-BDB-ACTIVOS_app/.git`, Git trata la carpeta como otro repositorio; hay que apartar cada `.git` (apartar, no
borrar) antes de leer su árbol en el índice, quitar las tres líneas de `.gitignore` (9 a 11) y leer el árbol **sin** `-u`,
porque los ficheros ya están en disco.

## Lo que hay que tocar (medido el 10-11)

No hay más invocaciones de Git en el código vivo que estas; `nube:subir` y `refrescar.mjs` no usan Git. En
`2-plataforma-datos/_legacy/` y en cuatro scripts de ensayo y validación de la plataforma hay otras que solo anotan
`git status` y `git log` como evidencia.

| Dónde | Qué hace hoy | Qué pasa con un repositorio |
|---|---|---|
| `3-BDB-ACTIVOS_app/tests/barreraDeBdb.test.ts` | Barre cuatro repositorios con `git -C`; decide cuáles existen mirando si tienen `.git` (`PRESENTES`, línea 50) | **La trampa mayor.** Sin `.git` en las subcarpetas, `PRESENTES` queda vacío y las pruebas que lo recorren pasan sin mirar nada. Solo falla «están los cuatro repositorios», y esa se salta en CI. Se reescribe para barrer carpetas, con una prueba de que cada barrido ve más de cero ficheros |
| `4-base-nueva/compilar-sitio.mjs` (64 y 86) | `git worktree add --detach` de la app en `HEAD` y compila desde ahí | La copia trae el repositorio entero: la app queda en `copia/3-BDB-ACTIVOS_app`. Se ajusta la ruta y se compila una vez para comprobarlo |
| `2-plataforma-datos/src/ingestion/vanillaBatch{WriteGate,WritePlanValidation,CompletePayloads}.ts` | `git status --short` guardado como evidencia de la escritura; no he visto que bloquee | La evidencia pasa a incluir ficheros de las otras capas. Decidir si se acota con `-- .` |
| `2-plataforma-datos/scripts/runPriceSeriesNavSmallBatchWriteGate.ts:155` | `git rev-parse --short HEAD` en la evidencia | Mejora: el hash pasa a ser el de todo |
| `3-BDB-ACTIVOS_app/scripts/desplegarFunciones.mjs:101` | `git status --porcelain -- functions_python` | Sigue igual (la ruta es relativa a la carpeta) |
| `1-extractor/tests/test_ops_token.py:194` | `git check-ignore` de un temporal | Sigue igual si el `.gitignore` del extractor se queda en su carpeta |
| `.github/workflows/ci.yml` de los tres | Solo se disparan en `master`: no corren nunca en esta rama | En subcarpetas GitHub no los lee. O se suben a la raíz con `working-directory`, o se retiran |
| `.gitignore` de la raíz, líneas 9 a 11 | Excluye las tres carpetas | Se quitan. Los `.gitignore` de cada carpeta se quedan donde están |
| `AGENTS.md`, `README.md`, habilidades, `COORDINACION_SESIONES.md` | Hablan de cuatro repositorios y de «un agente escritor por repositorio» | Se reescriben el mismo día |

Medido también: ninguno de los cuatro tiene stashes, copias de trabajo de más, submódulos ni LFS.

## Los fines de línea, que es lo que no se ve

Hoy cada repositorio los trata distinto: el sistema tiene `core.autocrlf=true`, la app lo fija en `input` en su
configuración local, la plataforma lleva `* text=auto eol=lf` en `.gitattributes`, el extractor solo fija LF en
`contracts_cache/*.json` (los SHA-256 del manifiesto se calcularon sobre LF) y la raíz no declara nada. En un repositorio
manda **una** configuración. Si no se resuelve antes, Git puede dar por modificados cientos de ficheros de la app, o
cambiar los bytes de un contrato y con ellos su SHA. Se resuelve con un `.gitattributes` por carpeta que deje escrito lo
que hoy vive en configuración local, y se comprueba en el ensayo: `git status` limpio y las comprobaciones de contratos
en verde.

## Lo que se pierde

- **El aislamiento entre agentes.** Hoy dos agentes en repositorios distintos no pueden pisarse el índice. En uno, la regla
  pasa a ser «un agente escritor por carpeta» y los commits se hacen nombrando rutas (`git commit … -- <rutas>`), nunca
  con `git add -A`.
- **Alrededor de un día** de trabajo cuidadoso sin nada visible para el asesor.
- **Leer la historia antigua por ruta**, como se dice arriba.

## Cómo se da por bueno

- `git status` limpio justo después de la fusión, sin tocar un fichero.
- Cada uno de los cuatro `HEAD` de antes es antecesor del `HEAD` nuevo (`git merge-base --is-ancestor`).
- Una muestra de los hashes citados en `COORDINACION_SESIONES.md` resuelve con `git cat-file -e`.
- El árbol de cada carpeta en el commit nuevo es idéntico al árbol del `HEAD` de su repositorio de antes
  (`git rev-parse HEAD:3-BDB-ACTIVOS_app` igual al árbol anotado antes de empezar).
- Las pruebas de los tres, con sus cifras de antes; `barreraDeBdb` en verde **y** viendo ficheros; `check:contracts` de la
  app y `sync_contratos.py --check` del extractor en verde.
- `node 4-base-nueva/compilar-sitio.mjs` compila (sin desplegar).
- Una escritura local con su gate y un plan en seco de `nube:subir --parte catalogo`, sin `--escribe`.

## Lo que hace Óscar, y lo que queda por decidir ese día

- **Subir** (condición 2) y, al acabar, **archivar en GitHub** los tres remotos que dejan de usarse. El repositorio único
  sigue en el remoto de la raíz.
- Si la rama principal sigue llamándose `gestor-activos-financieros`.
- Si el CI se activa en esta rama o se retira: hoy no corre.
- Si la evidencia de los gates se acota a la plataforma o recoge todo.

## Cómo quedó (10-11-2026)

**Las condiciones.** Las cuatro se cumplían: undécima subida cerrada (04:00), los cuatro subidos y comprobados contra el
remoto esa misma tarde, árboles limpios y ninguna otra sesión escribiendo. Los `bundle` de cada repositorio, con todas
sus ramas y etiquetas, están en `C:\Users\oanti\Proyectos\Gestor-Activos-Financieros-copias\unificacion-2026-11-10`, y de ellos
se clonó el ensayo, que es la prueba de que sirven.

**El ensayo**, en una copia clonada de los bundles con la misma disposición: procedimiento entero, árbol limpio,
los cuatro `HEAD` antecesores del nuevo, árboles idénticos, `git blame` atravesando la fusión y los 160 hashes de siete
cifras citados en `COORDINACION_SESIONES.md` resolviendo. Borrado después.

**En el sitio.** Se trajeron los objetos de cada carpeta (`git fetch ./<carpeta>`), se apartó cada `.git` con un
renombrado —no con una copia: si algo lo tuviera abierto, falla entero en vez de quedarse a medias— a
`git-apartados/` de esa misma carpeta de copias, y se hicieron tres fusiones de historias sin relación con el árbol de
cada una bajo su carpeta (`merge -s ours --no-commit --allow-unrelated-histories` y `read-tree --prefix`, sin `-u`):
`ad888dee` (extractor), `811cdc6f` (plataforma) y `f712eef0` (app). La primera lleva además el cambio de `.gitignore`.

| | Antes | En el repositorio único |
|---|---|---|
| raíz | `fa9b9b2d`, 381 commits | antecesor del nuevo `HEAD` |
| `1-extractor` | `e51a6857`, 229 commits, árbol `a16bb472` | antecesor; `HEAD:1-extractor` es `a16bb472` |
| `2-plataforma-datos` | `53f9763b`, 308 commits, árbol `65e59acf` | antecesor; `HEAD:2-plataforma-datos` es `65e59acf` |
| `3-BDB-ACTIVOS_app` | `9ecaa916`, 1.028 commits, árbol `240df5d0` | antecesor; `HEAD:3-BDB-ACTIVOS_app` es `240df5d0` |

Son 1.949 commits (381 + 229 + 308 + 1.028 + 3), no los 1.907 que estimaba el plan: desde que se escribió hubo 42 más.
Git ve 2.325 ficheros: 61 de la raíz, 320 del extractor, 687 de la plataforma y 1.257 de la app.

**Lo que el plan no decía y hubo que hacer.**

- **Lo que cada repositorio ignoraba en local** (`.git/info/exclude`) se pierde al apartar su `.git`. Se llevó al de la
  raíz con su carpeta delante: los `.claude/worktrees/` del extractor y de la app, y los `.docx` de la plataforma, que
  es `2-plataforma-datos/**/*.docx` y no `2-plataforma-datos/*.docx` —con el segundo aparecieron dos informes sin
  seguir en `docs/`—. No va al repositorio: es de esta máquina.
- **`core.longpaths`**, que solo tenía la app, pasa a la configuración local de la raíz.
- **Los fines de línea de la app** vivían en su `core.autocrlf=input` local. Ahora los fija `3-BDB-ACTIVOS_app/.gitattributes`
  (`* text=auto eol=lf`). Medido antes de añadirlo: los 1.180 ficheros de texto de la app tienen LF en el índice y en
  disco, así que no cambia ni un byte. El extractor (289 ficheros con LF en el índice y CRLF en disco, y LF en
  `contracts_cache`) y la plataforma (su `.gitattributes`) quedan como estaban.

**Lo que se tocó en el código.**

- `3-BDB-ACTIVOS_app/tests/barreraDeBdb.test.ts`. Tal cual, tras la fusión **fallaba en cuatro de once**, que es mejor
  que pasar sin mirar: barría la raíz entera con las rutas de las carpetas delante. Ahora barre cuatro partes —la raíz
  sin las tres carpetas, y cada carpeta con rutas relativas a ella, que es como declaran las listas—, cuenta los
  ficheros que Git ve en cada una y exige un mínimo, y comprueba que ninguna carpeta vuelve a tener su `.git`. Doce
  pruebas. Con el id de BDB plantado a propósito en la raíz y en el extractor, falla y nombra los dos ficheros.
- `4-base-nueva/compilar-sitio.mjs`: la copia de trabajo trae el repositorio entero y compila en su carpeta de la app.
- **Sin tocar**, porque siguen valiendo: `desplegarFunciones.mjs` (solo mira si hay cambios en `functions_python`) y
  `test_ops_token.py`. Los gates de la plataforma que guardan `git status --short` como evidencia recogen ahora las
  cuatro partes: queda a decisión de Óscar, abajo.

**Cómo se dio por bueno**, punto por punto de la lista de arriba.

- `git status` limpio tras la fusión, sin tocar un fichero. Sí.
- Los cuatro `HEAD` de antes, antecesores del nuevo. Sí.
- Los hashes citados en la coordinación resuelven: 160 de 160.
- El árbol de cada carpeta, idéntico al de su repositorio de antes. Sí, los tres.
- Las pruebas, con sus cifras de antes: app 4.554 (eran 4.553; la de más es de la barrera), con `tsc -b`, compilación,
  censo de CSS y lint limpios; plataforma 1.446 de 1.446 y typecheck limpio; extractor 1.370. `check:contracts` de la
  app (20 esquemas) y `sync_contratos.py --check` del extractor (3), en verde.
- `node 4-base-nueva/compilar-sitio.mjs` compila desde el último commit, deja `sitio/` y no deja copia de trabajo. Sin
  desplegar.
- Una escritura local con su gate: `baseNueva:write -- --write --verify` contra el emulador 8092, 0 creados, 17.027
  reemplazados, 0 ausentes, 0 distintos, 0 inválidos; guardado con `guardar.mjs`. Antes, `audit:base-nueva`: 49.750
  documentos, 0 que no validan. Y el plan en seco de `nube:plan -- --parte catalogo`: 49.132 documentos, el recuento
  igual al de la nube en los 13 grupos, 394 tandas, nada escrito.

**Lo que queda, y es de Óscar.**

- **Subir.** El repositorio único está solo en este ordenador hasta que se suba al remoto de la raíz. No se pierde
  nada mientras tanto: las tres historias siguen en sus remotos y en los bundles.
- **Archivar en GitHub** los tres remotos que dejan de usarse (`-extractor`, `-datos`, `-app`), después de subir.
- **Los `.git` apartados y los bundles**: cuándo se borran. Mientras estén, se puede volver atrás.
- **El nombre de la rama** sigue siendo `gestor-activos-financieros`: no se ha cambiado.
- **El CI** sigue sin correr. Los `ci.yml` siguen en las tres carpetas, donde GitHub ya no los lee: o se suben a la raíz
  con `working-directory`, o se retiran.
- **La evidencia de los gates** de la plataforma recoge ahora el `git status` de todo el repositorio: o se acota a su
  carpeta, o se deja así.
- **Las ramas que no pasaron** (casi todas de BDB) y las 5 etiquetas viven en los bundles y en los remotos antiguos.
