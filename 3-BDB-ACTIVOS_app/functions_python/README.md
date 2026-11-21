# Backend de BDB-ACTIVOS

Estado del código revisado el 15-11-2026. Este documento describe el repositorio;
el estado de producción se verifica por separado antes de desplegar.

El proyecto de la maestra sale de `master_project.py`: `gestor-activos-local` en local y
`bdb-gestor-de-activos` en la web, y cualquier otro se rechaza. Región `europe-west1`, con
Python 3.12. `readmodel/` publica el contrato de activos de la
maestra; las callables de lectura y cálculo requieren autenticación. Las carteras
se separan por UID. Las escrituras sobre la maestra utilizan identidad escritora
y gates específicos. Los contratos se validan contra `contracts_cache/` y su SSOT.

Las tareas programadas se definen en `main.py`: precios (martes a sábado, 07:30),
métricas (diario, 08:30, 09:00, 09:30 y 10:00), integridad (diario, 10:30), índice (diario, 03:45), informe
semanal (lunes, 07:15) e informe diario (lunes a viernes, 07:00), hora de Madrid. Que una tarea
esté declarada aquí no demuestra que esté activa en el proyecto desplegado.

## Base nueva y despliegue (15-11-2026)

- **Dos bases.** `gestor-activos-local` (emulador, la de siempre) y `bdb-gestor-de-activos` (la base nueva, también en
  producción). Las callables de lectura y cálculo leen la base nueva por `readmodel/lector_base_nueva.py`, que
  reconstruye la forma antigua desde `read/card`, y `main.py` no arranca si algo de su entorno nombra el proyecto de BDB.
- **`main.py` tiene 46 funciones:** 35 callables y 11 programadas (eran 51 hasta el 17-11-2026, cuando se borraron las
  cinco sin llamador, decisión A-188). **Solo 23 se despliegan**, con
  `node scripts/desplegarFunciones.mjs --despliega` desde la carpeta de la app (sin `--despliega` solo enseña qué haría).
  Las programadas y las de administración que escriben trabajan con la forma antigua (`assets`, `metrics`).
- **Seis de administración solo entienden la forma antigua** y sobre la base nueva contestarían «0 activos» o «no
  encontrado»: `get_system_status`, `admin_db_status`, `admin_list_assets`, `admin_asset_detail`, `admin_fund_quality` y
  `admin_backfill_candidates`. Siguen en `main.py` y en el emulador local, pero no se despliegan.
- Un `firebase deploy --config firebase.funciones.json` a mano aborta en su `predeploy`
  (`scripts/puertaFunciones.mjs`): solo pasa si lo lanza el guion.
- Los guiones de `scripts/` que escriben piden `--write`, su frase de aprobación y además el cerrojo general
  (`require_master_writes_enabled`); en seco no piden nada.

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
