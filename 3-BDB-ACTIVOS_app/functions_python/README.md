# Backend de BDB-ACTIVOS

Estado del código revisado el 21-11-2026. Este documento describe el repositorio;
el estado de producción se verifica por separado antes de desplegar.

El proyecto de la maestra sale de `master_project.py`, y solo la base nueva, `bdb-gestor-de-activos`, se sabe leer:
en la web y en local (emulador 8092). `gestor-activos-local` sigue en la lista de permitidos como defecto seguro del
`.env` (decisión 32): con él, las Functions paran al abrir la maestra, nombrándolo (`master_project.exigir_base_nueva`),
y un guion lanzado a mano falla al conectar. Cualquier otro se rechaza. Región `europe-west1`, con Python 3.12.
`readmodel/` publica el contrato de activos; las callables de lectura y cálculo requieren autenticación. Las carteras
se separan por UID. `contracts_cache/` lleva el contrato de lectura (`asset-for-bdb.v1`) y, hasta la tanda de la
plataforma (decisión 36), los de escritura de la maestra vieja, que ya no lee nadie.

Las tareas programadas se definen en `main.py` y son tres, las de informes: informe semanal (lunes, 07:15), informe
diario (lunes a viernes, 07:00) y la recuperación de los pendientes (lunes a viernes, 07:35 y 07:50), hora de Madrid. No
se despliegan: la automatización de informes está apagada.

## Base nueva y despliegue (21-11-2026)

- **Una base.** Las callables de lectura y cálculo leen la base nueva por `readmodel/lector_base_nueva.py`, que
  reconstruye la forma antigua desde `read/card`, y `main.py` no arranca si algo de su entorno nombra el proyecto de BDB.
- **El código de la base vieja se borró el 21-11-2026** (decisiones 30 a 39 del censo `CENSO_BASE_VIEJA_2026-11-21.md`;
  el estado anterior, en la etiqueta de Git `referencia-base-vieja-2026-11-21`): sus 20 Functions (`get_system_status`,
  once `admin_*` y ocho programadas de precios, métricas, integridad, índice y VL revisados), sus módulos (refresco de
  precios y de métricas, ingesta, índice de búsqueda, integridad, panel, gates de escritura, VL revisados), el lector
  `FirestoreReader`, el almacén de carteras `FirestorePortfolioStore`, el estimador semanal `GEOMETRIC_CAGR` / `WEEKLY`
  y los guiones de `scripts/` que trabajaban sobre `assets`. Se quedan la cuarentena de series (`price_history_sync.py`
  con `adjustment_problem`, y `price_repair_release.py`; decisión 38).
- **`main.py` tiene 26 funciones:** 23 callables y 3 programadas (eran 46 hasta el 21-11-2026, y 51 hasta el 17-11).
  **Se despliegan las 23 callables**, con `node scripts/desplegarFunciones.mjs --despliega` desde la carpeta de la app
  (sin `--despliega` solo enseña qué haría).
- Un `firebase deploy --config firebase.funciones.json` a mano aborta en su `predeploy`
  (`scripts/puertaFunciones.mjs`): solo pasa si lo lanza el guion.
- Quedan dos guiones en `scripts/`: `appcheck_report.py` (lee los registros de App Check) y `medir_tope_simulacion.py`
  (mide la simulación sobre la base nueva).

## Dependencias y pruebas

Desde la raíz de la aplicación, en un entorno aislado Python 3.12:

```text
python -m pip install -r functions_python/requirements.txt pytest
python -m pytest functions_python/tests -q -p no:cacheprovider
npm run check:contracts
```

En la práctica de este repositorio las pruebas se pasan con el `python` del sistema: el `venv` de la carpeta no tiene `pytest`.

`requirements.txt` fija las dependencias directas e incorpora `constraints.txt`
para fijar también las transitivas. El bloqueo se generó con uv 0.11.23, resolución
universal Python >=3.12 y las versiones del entorno local validado. Se conserva
`google-api-core==2.34.0` por el incidente documentado en requirements.txt.

Para revisar una actualización, regenerar con `uv pip compile` usando una copia de
las dependencias directas sin la línea `-c`; emplear el bloqueo anterior como
restricciones salvo en los paquetes que se decida actualizar. Revisar la diferencia,
resolver avisos de seguridad y pasar las pruebas en Python 3.12 antes de sustituir
el bloqueo. No levantar el pin de google-api-core sin verificar la regresión.

## Reglas de consumo y despliegue

INDEX es benchmark no invertible. Los costes se normalizan a decimal; STOCK e
INDEX no necesitan costes de fondo. El payload público incluye resúmenes de
holdings y métricas, y excluye historia cruda y credenciales.

Ningún despliegue está autorizado por ejecutar pruebas. Funciones, Hosting y reglas
Firestore comprueban el permiso de despliegue como primer paso. Las Functions se
despliegan con `scripts/desplegarFunciones.mjs` después de obtener autorización explícita.
