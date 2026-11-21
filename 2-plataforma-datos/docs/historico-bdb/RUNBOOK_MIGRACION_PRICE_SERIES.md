> **Histórico de BDB: no se ejecuta.** Las órdenes de este documento son contra el proyecto o la carpeta de BDB, que está en uso y desde aquí no se toca. Se conserva como registro (decisión 106, 05-11-2026).

# Migracion de price_series a v1.2

## Alcance

Este procedimiento cambia exclusivamente `schema_version` en documentos
`assets/{asset_id}/price_series/{document_id}` que ya validan integramente contra
`contracts/master/price-series.v1.2.schema.json`. No transforma puntos ni completa
campos. Un documento incompatible queda en `invalid` y no se escribe.

La ejecucion contra produccion queda pendiente de aprobacion expresa de Oscar.

## Gates

1. Trabajar desde `2-plataforma-datos` con dependencias instaladas y arbol revisado.
2. Crear y verificar un backup completo inmediatamente antes de la migracion.
3. Ejecutar primero el dry-run y exigir `invalid=0`.
4. Revisar `runs/price_series_v12_*/migration_plan.json`: rutas, recuento y
   `from_schema` deben corresponder solo a v1/v1.1 esperados.
5. Para `--write`, abrir explicitamente
   `BDB_DATA_PLATFORM_ENABLE_MASTER_WRITES=YES_I_UNDERSTAND_MASTER_DB_WRITES`.
6. No desplegar funciones ni hosting como parte de esta operacion.

## Ensayo en emulador

Iniciar Firestore Emulator desde `3-BDB-ACTIVOS_app`:

```powershell
firebase emulators:start --only firestore --project bbdd-activos-financieros
```

En otra consola, desde `2-plataforma-datos`:

```powershell
$env:FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080"
$env:FIREBASE_PROJECT_ID = "bbdd-activos-financieros"
npx tsx scripts/seedPriceSeriesV12Emulator.ts
npm run contracts:migrate-price-series-v12 -- --ids ZZ0000000001,ZZ0000000002,ZZ0000000003
npx tsx scripts/seedPriceSeriesV12Emulator.ts --verify-only
```

Resultado esperado: tres series leidas, dos `eligible_updates`, una `already_v12`,
cero `updated`, cero `invalid`. Una segunda lectura debe confirmar que el dry-run
no cambio las versiones sembradas.

## Dry-run de produccion

Con credenciales de solo lectura o las credenciales operativas habituales, sin
definir el gate de escritura:

```powershell
Remove-Item Env:BDB_DATA_PLATFORM_ENABLE_MASTER_WRITES -ErrorAction SilentlyContinue
Remove-Item Env:FIRESTORE_EMULATOR_HOST -ErrorAction SilentlyContinue
npm run contracts:migrate-price-series-v12
```

Conservar `summary.json` y `migration_plan.json`. Verificar:

- `mode=DRY_RUN`, `updated=0` y `postverify_failed=0`.
- `invalid=0`; cualquier invalido detiene el procedimiento.
- `eligible_updates` coincide con el numero de documentos v1/v1.1 del plan.
- No aparecen raices archivadas salvo que Oscar apruebe `--include-legacy`.

## Ejecucion aprobada

Solo tras la revision personal de Oscar:

```powershell
$env:BDB_DATA_PLATFORM_ENABLE_MASTER_WRITES = "YES_I_UNDERSTAND_MASTER_DB_WRITES"
npm run contracts:migrate-price-series-v12 -- --write
Remove-Item Env:BDB_DATA_PLATFORM_ENABLE_MASTER_WRITES
```

El resultado es aceptable unicamente si `updated=eligible_updates`,
`postverify_ok=updated`, `postverify_failed=0` e `invalid=0`.

## Verificacion

1. Repetir el comando sin `--write`: todo documento migrado debe contar como
   `already_v12` y `eligible_updates` debe ser cero.
2. Ejecutar `npm run test:ci` y `npm run typecheck`.
3. Ejecutar la auditoria de consistencia de solo lectura y comprobar que no hay
   cambios en puntos, fechas, recuentos ni calidad historica.
4. Archivar juntos backup, plan previo, resumen de escritura y dry-run posterior.

## Rollback

`migration_plan.json` es el inventario de rollback: conserva para cada ruta su
`from_schema`. Como la migracion no altera ningun otro campo, el rollback consiste
en restaurar exclusivamente ese valor para las rutas del plan, con el mismo gate,
lotes de hasta 400 y postverify. No usar un listado reconstruido despues del hecho.

Si se detecta cualquier cambio fuera de `schema_version`, detener el rollback
selectivo y restaurar desde el backup verificado en un entorno aislado antes de
decidir la recuperacion de produccion. Toda ejecucion o rollback requiere una nueva
aprobacion expresa de Oscar.

---

# Segunda etapa: recorte de los puntos

Decidida por Oscar el 30-10-2026 ("todo lo que no sea necesario va fuera"). Medida y
justificada en `DECISIONES_ADQUISICION_2026-10-30.md` §4.

## Alcance

Reescribe el campo `points` de `assets/{asset_id}/price_series/{document_id}` para
quitar de cada punto lo que ninguna consulta lee y lo que es copia exacta de un campo
del propio documento. **No cambia `schema_version`**, que sigue siendo
`asset-price-series.v1.2`: la version esta escrita a mano en ocho sitios de produccion
y moverla por una dieta de payload traeria mas riesgo del que arregla.

Se conserva en el punto: `date`, `value`, `source_value` y `fx_rate`. Los dos primeros
son los unicos que el contrato exige; los otros dos son el rastro que permite
reproducir la cifra ante un cliente.

Se quita: `open`, `high`, `low`, `close`, `adjusted_close`, `volume`, `source_open`,
`source_high`, `source_low`, `fx`, `source_currency`, `native_currency` y `fx_pair`.
Y se unifica en `source_value` el valor de origen, que hasta ahora viajaba tambien
como `source_adjusted_close` y `source_close`.

Medida sobre la copia del 29-10: 160 MiB de 344,8, el 46 % del peso de los puntos.

## Por que es seguro, documento a documento

El script rechaza el documento completo, sin tocarlo, si cualquiera de estas
comprobaciones falla:

1. Un campo que se quita por ser copia del documento no esta en el documento, o no
   coincide con el valor del punto.
2. `adjusted_close` no es exactamente igual a `value`.
3. Un punto tiene `fx_rate` y se queda sin valor de origen.
4. El recorte cambia el numero de puntos, alguna fecha o algun `value`.
5. El resultado no valida contra `price-series.v1.2` o rompe sus invariantes
   (`observations_count`, `first_date`, `last_date`, fechas crecientes).

## Irreversibilidad: leer antes de ejecutar

`migration_plan.json` **no permite reconstruir** los campos quitados que no son copia
de otro campo: OHLCV y el cierre sin ajustar. Su recuperacion es el backup verificado
o una reingesta desde el proveedor, que los vuelve a servir. Lo que si es
reconstruible sin nada mas son los duplicados, porque su valor sigue en el documento o
en `value`.

Por eso el paso 2 de los gates generales (backup completo verificado inmediatamente
antes) no es opcional en esta etapa.

## Ensayo en emulador con datos reales

A diferencia de la primera etapa, aqui el ensayo con datos sembrados no prueba nada:
los documentos de prueba no llevan los campos redundantes. Hay que ensayar sobre la
copia verificada restaurada en el emulador.

```powershell
npm run backup:restore-drill
$env:FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080"
$env:FIREBASE_PROJECT_ID = "bbdd-activos-financieros"
npm run contracts:trim-price-series
```

Resultado esperado: `invalid=0` y `bytes_saved` del orden de 160 MiB sobre el universo
completo. Si `bytes_saved` se desvia mucho de esa cifra, parar: significa que la
poblacion no es la medida.

## Dry-run de produccion

```powershell
Remove-Item Env:BDB_DATA_PLATFORM_ENABLE_MASTER_WRITES -ErrorAction SilentlyContinue
Remove-Item Env:FIRESTORE_EMULATOR_HOST -ErrorAction SilentlyContinue
npm run contracts:trim-price-series
```

Verificar en `runs/price_series_trim_*/summary.json`:

- `mode=DRY_RUN`, `updated=0`, `invalid=0`. Cualquier invalido detiene el
  procedimiento: hay que leer `invalid_samples` y entender el motivo antes de seguir.
- `removed_key_counts` solo contiene claves de la lista de arriba.
- `bytes_saved` coincide con lo visto en el ensayo.

## Ejecucion aprobada

Solo tras la revision personal de Oscar y con el backup del dia verificado:

```powershell
$env:BDB_DATA_PLATFORM_ENABLE_MASTER_WRITES = "YES_I_UNDERSTAND_MASTER_DB_WRITES"
npm run contracts:trim-price-series -- --write
Remove-Item Env:BDB_DATA_PLATFORM_ENABLE_MASTER_WRITES
```

Son unas 19.300 escrituras, justo al borde de la cuota diaria gratuita de 20.000. O se
parte en dos dias con `--limit`, o se acepta el coste de unos centimos. **No lanzarlo
el mismo dia que otra operacion de escritura masiva.**

Aceptable solo si `updated=eligible_updates`, `postverify_ok=updated`,
`postverify_failed=0` e `invalid=0`.

## Verificacion

1. Repetir sin `--write`: todo documento debe contar como `already_trimmed` y
   `eligible_updates` debe ser cero.
2. `npm run test:ci` en `2-plataforma-datos` y `python -m pytest` en
   `3-BDB-ACTIVOS_app/functions_python`.
3. Auditoria de consistencia de solo lectura, con la puerta de escrituras cerrada.
4. En la app: abrir una ficha de fondo y una de accion y comprobar que la serie, las
   metricas y el grafico siguen igual. El recorte no toca `value`, asi que cualquier
   diferencia visible es un fallo y obliga a restaurar.
5. Comprobar el almacenamiento en la consola de Firebase, en Firestore -> Uso, antes
   y despues. Es la unica medida real del ahorro.

## Despues

Una vez que ningun documento lleve los campos quitados, endurecer
`contracts/master/price-series.v1.2.schema.json`: retirar esas claves de
`properties` del punto. Con `additionalProperties: false` ya declarado, eso impide que
vuelvan a entrar. **No hacerlo antes del recorte**: mientras queden documentos
antiguos, la validacion de escritura los rechazaria.
