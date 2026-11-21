# Sistema › Operaciones — el proceso completo desde la app (05-09-2026)

Alta, extracción, canónico, corrección de campos y la plataforma de datos
(copia, pasada en seco, escritura y comprobación) sin abrir tres programas.
La app no ejecuta nada de esto: habla con un **servicio local** del extractor
que corre en la misma máquina, y ese servicio lanza los trabajos y devuelve su
registro en vivo.

```
Sistema › Operaciones  ──HTTP loopback──▶  1-extractor  python main.py ops  (127.0.0.1:8766)
                                              │  alta · extraer · canónico · correcciones
                                              └─ subprocesos ─▶ 2-plataforma-datos  npm run …
                                                                 backup · load · republish · audit
```

## Arrancar

1. `iniciar-operaciones.bat` (raíz de este repo) o, a mano, `python main.py ops`
   en `1-extractor`. El servicio solo escucha en loopback y solo admite los
   orígenes de desarrollo de la app (`localhost:5173/5178/4173`); en
   `config/settings.json` del extractor se pueden ajustar (`ops_origenes`).
   Desde el 17-10-2026 el servicio exige siempre un token en `X-Ops-Token`
   (decisión 6.7b): `ops_token` de `settings.json` o, si no lo hay,
   `config/ops_token.txt`, que el extractor crea la primera vez. La app lo
   manda con `VITE_BDB_OPS_TOKEN`.
2. `iniciar-dev.bat` (la app) y entrar como administrador. El `.bat` pide el
   token con `python main.py ops-token` y se lo pasa a Vite; si arrancas Vite a
   mano, pon `VITE_BDB_OPS_TOKEN` en `.env.local`.
3. Sistema › Operaciones. Si el servicio no está en marcha, la pestaña lo dice
   y explica cómo arrancarlo.

La pestaña se ofrece solo en desarrollo. `VITE_BDB_OPS_ENABLED=false` la oculta y
`VITE_BDB_OPS_URL` cambia la dirección local. En producción permanece deshabilitada:
la política del navegador y los orígenes aceptados por el servicio no permiten
este flujo local. Un token `VITE_` forma parte del cliente y no debe publicarse.

## Los siete pasos

| Paso | Qué hace | Dónde ocurre |
|---|---|---|
| 1 · Activos | Pega ISIN. «Dar de alta» resuelve nombre y tipo y los añade al universo (`config/fondos.csv`). El tipo se puede corregir en la tabla. | extractor |
| 2 · Extraer | Una pasada por la única vía de recolección (fuentes oficiales primero, caché por familia, correcciones aplicadas). Registro en vivo. | extractor |
| 3 · Canónico | Regenera `export_bdb/` y `export/` completos: comparten `package_id`, y la plataforma rechaza el paquete si no. | extractor |
| 4 · Copia y pasada en seco | `backup:export` si la copia tiene más de 24 h; después `load:fondosdb --dry-run` (alta) o `republish:fondosdb --dry-run` (republicar) y su plan por ISIN. | plataforma |
| 5 · Escribir | Se teclea el número de escrituras de la pasada en seco. El servicio **repite la pasada en seco justo antes** y, si el recuento cambió, no escribe. El gate `BDB_DATA_PLATFORM_ENABLE_MASTER_WRITES` solo existe en el entorno del subproceso que escribe. Después audita. | plataforma |
| 6 · Comprobar | `audit:consistency` de esos ISIN: desvíos entre canónico y maestra. | plataforma |
| 7 · Archivar | Pasada en seco (qué hay en la maestra: raíz, subdocumentos, buscador) y, con el recuento tecleado y copia vigente, `archive:assets`: copia restaurable en local (`backup_<id>.json` en la corrida) y en `_archived_assets`, retirada de `assets` y de `meta/search_index`, postverificación. Después, baja del universo del extractor (`fondos.csv`, ficha, históricos y canónico a `data/_papelera/`) y canónico regenerado. **Sin borrado físico.** | plataforma + extractor |

Las **acciones** no siguen este proceso: sus datos entran por la pestaña
Ingesta (EODHD). La pestaña las aparta sola y lo dice.

## Borrar o editar un activo

Nunca a mano en Firestore: la siguiente republicación lo pisaría y la auditoría
lo marcaría como desvío.

- **Editar un dato**: «Corregir un campo» (abajo) y, después, extraer → canónico →
  pasada en seco «republicar» → escribir. El tipo se cambia en la tabla del paso 1.
  Las retrocesiones, en su pestaña.
- **Retirar un activo**: paso 7. Lo archivado queda en `_archived_assets` y en la
  copia local; la nightly reconstruye el índice y los trabajos programados ya
  ignoran los archivados. Para volver a darlo de alta basta con el paso 1: la
  plataforma lo crea de nuevo desde el canónico.
- Fuera de la interfaz sigue existiendo `scripts/delete_asset.py` (dry-run por
  defecto, `--hard` borra físicamente): solo para casos que la pestaña no cubre.

## Corregir un campo

Cuando una fuente trae un dato mal y no hay otra que lo corrija, se corrige
**ese campo** en el extractor (`config/correcciones.json`), con motivo y autor.
La corrección se aplica en la siguiente extracción, antes del saneado, con
procedencia `manual:<autor>`; llega al canónico y a la maestra por el camino de
siempre (extraer → canónico → pasada en seco «republicar» → escribir). La
pestaña enseña los campos de la ficha con su valor y su fuente, deja guardar y
retirar correcciones y dice si una corrección está pendiente, aplicada o
redundante (la fuente ya coincide).

Solo campos que alguna fuente declara; `null` borra el campo; un campo que la
ficha no tiene todavía hay que marcarlo como nuevo (protege de erratas). El
detalle vive en `1-extractor/docs/ADQUISICION_2026-09-04.md`.

## Lo que no hace

- No escribe en la maestra desde el navegador ni guarda el gate en la app.
- No borra físicamente: archivar siempre deja copia local y en `_archived_assets`.
- No sustituye a la pestaña Retrocesiones (dato comercial, colección propia).
- No regenera acciones con el extractor.

## Verificación

App: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` y el
recorrido de la interfaz (`node scripts/auditoriaFrontend.mjs <etiqueta> d,tp`;
`npm run audit:ui` se retiró el 19-11-2026). El recorrido es un informe que hay
que leer, no una puerta, y con `d,tp` mide el Modo cliente en esos dos anchos y
la accesibilidad solo a 1.440 px: para un cierre, los seis anchos
(`xl,l,d,p,t,tp`) con `AUDIT_AXE=todos`. Extractor: `python -m ruff check .`, `python -m pytest`
(`tests/test_ops.py`, `tests/test_ops_plataforma.py`, `tests/test_correcciones.py`).
Pasada en seco real verificada el 05-09-2026 con dos ISIN (republicar).

## Seguimiento, interrupciones y recuperación

Cada petición espera como máximo 30 segundos, incluida la lectura de la respuesta.
La observación de una tarea se detiene a los cinco minutos; también puede detenerse
con el botón correspondiente o al salir de la pantalla. Esto no cancela el trabajo
del servicio. El identificador queda disponible en la sesión del navegador y permite
consultar o reanudar el seguimiento con peticiones de lectura, sin repetir la operación.
Se muestran las últimas 400 líneas del registro manteniendo el cursor total.

Si se pierde la respuesta de una escritura antes de conocer el identificador, el
resultado es desconocido: actualizar el estado y consultar la tarea del servicio
antes de ejecutarla otra vez. No hay reintentos automáticos de escrituras.
