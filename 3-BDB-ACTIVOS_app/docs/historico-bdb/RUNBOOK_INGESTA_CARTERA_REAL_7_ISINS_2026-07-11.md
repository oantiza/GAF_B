> **Histórico de BDB: no se ejecuta.** Las órdenes de este documento son contra el proyecto o la carpeta de BDB, que está en uso y desde aquí no se toca. Se conserva como registro (decisión 106, 05-11-2026).

# Ingesta controlada de 7 ISIN de Cartera Real

> **Registro histórico, no se sigue.** Este documento es de BDB y manda a desplegar en su proyecto, y desde este repositorio **no se escribe nunca allí**. Para desplegar aquí: `scripts/desplegarFunciones.mjs` y `4-base-nueva/compilar-sitio.mjs`.

Fecha: 2026-07-11  
Responsable de la ejecución real: Oscar  
Proyecto: `bbdd-activos-financieros`

## Objetivo y límites

Dar de alta por el panel Admin los activos que EODHD pueda identificar y cargar sus
`price_series` diarias en EUR. La ingesta usa `admin_ingest_asset`, crea raíces con
`quality.status=PROVISIONAL_ADMIN`, valida los contratos y carga todo el histórico
disponible desde 1990; por tanto, una previsualización aceptable debe comenzar el
2020-11-01 o antes.

Este documento no autoriza escrituras. El panel continúa en dry-run mientras el gate
`BDB_ACTIVOS_ENABLE_MASTER_WRITES` esté cerrado. No se debe pulsar **Aplicar** para un
activo cuya previsualización no tenga `ok=true` y `history.loaded=true`.

## Resultado de las previsualizaciones sin escritura

Previsualizaciones realizadas el 2026-07-11 contra la función desplegada, con el gate
de escritura cerrado:

| ISIN | Activo | Resultado |
|---|---|---|
| `ES0132945017` | Tubacex | `TUB.MC`, STOCK, 8.744 puntos, 1991-12-02 a 2026-07-10, CREATE |
| `ES0143416115` | Siemens Gamesa | La búsqueda activa no resuelve el ISIN. Reintentar con `SGRE.MC` después de publicar el soporte de deslistados. |
| `ES00000127Z9` | SPGB 30/04/26 | No resuelto. El alta actual no admite raíces BOND. No aplicar. |
| `DE0005933956` | iShares Core EURO STOXX 50 | `EXW1.XETRA`, ETF, 6.329 puntos, 2001-08-06 a 2026-07-10, CREATE |
| `DE000A0F5UJ7` | iShares STOXX Europe 600 Banks | `EXV1.XETRA`, ETF, 6.109 puntos, 2001-11-22 a 2026-07-10, CREATE |
| `FR0013514619` | Millesima 2026 | No resuelto por EODHD. No aplicar. |
| `FR0010493957` | Oddo Generation/Banks | No resuelto por EODHD. No aplicar. |

La API Search de EODHD solo busca instrumentos activos. Para Siemens Gamesa, el
resolvedor preparado en esta rama consulta de forma condicionada la lista de
deslistados del mercado indicado cuando se facilita `SGRE.MC`, y rechaza el resultado
si su ISIN no coincide. Referencias del proveedor:

- https://eodhd.com/financial-apis/delisted-stock-companies-data
- https://eodhd.com/financial-apis/exchanges-api-list-of-tickers-and-trading-hours

## 1. Validar y publicar el soporte, sin abrir escrituras

Ejecutar en PowerShell:

```powershell
Set-Location C:\Users\oanti\Proyectos\BDB\3-BDB-ACTIVOS_app
python -m pytest functions_python\tests\test_ingest_asset.py -q
npm run test:ci
npm run typecheck
npm run build

$env:BDB_ACTIVOS_ALLOW_FIREBASE_DEPLOY="YES_I_UNDERSTAND_SHARED_PROJECT"
npx firebase deploy --only functions:admin_ingest_asset,hosting --project bbdd-activos-financieros
Remove-Item Env:\BDB_ACTIVOS_ALLOW_FIREBASE_DEPLOY
```

Este despliegue debe hacerse con el valor actual, cerrado, de
`functions_python/.env.bbdd-activos-financieros`. No modificar todavía el gate de
escritura.

## 2. Previsualizar los siete activos en Admin

En **BBDD maestra > Ingesta**, marcar siempre **Incluir histórico** y usar esta tabla:

| Orden | ISIN | Símbolo EODHD opcional |
|---:|---|---|
| 1 | `ES0132945017` | vacío |
| 2 | `ES0143416115` | `SGRE.MC` |
| 3 | `DE0005933956` | vacío |
| 4 | `DE000A0F5UJ7` | vacío |
| 5 | `ES00000127Z9` | vacío |
| 6 | `FR0013514619` | vacío |
| 7 | `FR0010493957` | vacío |

Gate de aceptación por activo:

- `ok=true`, `preview=true`, `applied=false` y `resolved=true`.
- `root_action=CREATE` o, si ya se hubiese creado, `SKIP_EXISTS`.
- `root_preview.identity.currency=EUR`.
- `root_preview.quality.status=PROVISIONAL_ADMIN`.
- `history.loaded=true`, `history.first_date <= 2020-11-01` y suficientes observaciones.
- El símbolo y el nombre deben corresponder inequívocamente al ISIN.

Si `SGRE.MC` no aparece en la lista de deslistados con el mismo ISIN, no forzar otra
acción ni otro ticker por parecido de nombre.

## 3. Backup local inmediatamente anterior

La exportación es de solo lectura en Firestore mientras no se active el marcador
opcional de estado:

```powershell
Set-Location C:\Users\oanti\Proyectos\BDB\2-plataforma-datos
Remove-Item Env:\BDB_BACKUP_WRITE_STATUS_DOC -ErrorAction SilentlyContinue
npm run backup:export
```

Continuar solo si el backup termina `PASS` y conserva manifiesto y hashes.

## 4. Abrir el gate durante la ventana de ingesta

Mantener la misma sesión de PowerShell hasta completar el cierre del gate:

```powershell
Set-Location C:\Users\oanti\Proyectos\BDB\3-BDB-ACTIVOS_app
$envFile = (Resolve-Path .\functions_python\.env.bbdd-activos-financieros).Path
$originalEnv = [IO.File]::ReadAllText($envFile)
if ($originalEnv -notmatch '(?m)^BDB_ACTIVOS_ENABLE_MASTER_WRITES=') {
  throw 'Falta BDB_ACTIVOS_ENABLE_MASTER_WRITES en el fichero de entorno.'
}
$enabledEnv = [regex]::Replace(
  $originalEnv,
  '(?m)^BDB_ACTIVOS_ENABLE_MASTER_WRITES=.*$',
  'BDB_ACTIVOS_ENABLE_MASTER_WRITES=YES_I_UNDERSTAND_MASTER_DB_WRITES'
)
[IO.File]::WriteAllText($envFile, $enabledEnv, [Text.UTF8Encoding]::new($false))

$env:BDB_ACTIVOS_ALLOW_FIREBASE_DEPLOY="YES_I_UNDERSTAND_SHARED_PROJECT"
npx firebase deploy --only functions:admin_ingest_asset,functions:admin_db_status --project bbdd-activos-financieros
```

Comprobar en Admin que el estado muestra escrituras habilitadas. Aplicar de uno en uno,
repitiendo antes la previsualización exacta del paso 2. Prioridad:

1. `ES0132945017` Tubacex.
2. `ES0143416115` Siemens Gamesa, solo si `SGRE.MC` supera todos los gates.
3. `DE0005933956`.
4. `DE000A0F5UJ7`.

No aplicar los otros tres mientras no exista una fuente de serie aceptada.

## 5. Cerrar el gate obligatoriamente

En la misma terminal, aunque una ingesta haya fallado:

```powershell
[IO.File]::WriteAllText($envFile, $originalEnv, [Text.UTF8Encoding]::new($false))
npx firebase deploy --only functions:admin_ingest_asset,functions:admin_db_status --project bbdd-activos-financieros
Remove-Item Env:\BDB_ACTIVOS_ALLOW_FIREBASE_DEPLOY
```

Comprobar en Admin que **Aplicar** vuelve a quedar bloqueado. Si la sesión se cerrase
antes de restaurar `$originalEnv`, editar el fichero para retirar el valor de aprobación
y desplegar inmediatamente las dos funciones anteriores.

## 6. Alternativa para bono y fondos sin serie EODHD

Hoy no existe en la app un importador manual de `price_series` que cumpla todos los
gates. No escribir documentos a mano desde la consola de Firebase.

La alternativa preferida es preparar un importador CSV controlado con:

- columnas mínimas `date` (ISO `YYYY-MM-DD`) y `adjusted_close_eur` (positivo);
- fechas únicas, ordenadas y cobertura desde 2020-11-01;
- fuente, fecha de extracción y evidencia de que son precios/NAV en EUR;
- dry-run por defecto, validación `price-series.v1.2`, documentos anuales y métricas;
- `quality.status=PROVISIONAL_ADMIN`, gate maestro, backup, plan y postverificación.

Para el bono debe decidirse además si la serie representa precio limpio, precio sucio o
valor total. Mezclar precio con cupón rompe la interpretación de la rentabilidad.

La segunda alternativa es una exclusión declarada. Cartera Real no tiene todavía un
registro formal de exclusiones de precio: por tanto, una exclusión requiere antes un
cambio de contrato que publique ISIN, motivo, fecha y aprobación, y que la muestre en
`coverage.ingestion_plan`. Hasta entonces estos casos deben seguir visibles como
pendientes, no desaparecer del diagnóstico.

## 7. Verificación funcional posterior

1. Cargar de nuevo los dos XLS de Cartera Real.
2. Ejecutar `analyze_real_portfolio`.
3. Confirmar que cada activo cargado aparece una sola vez en
   `coverage.assets_with_prices`, con `first_date <= 2020-11-01`.
4. Confirmar que los activos cargados desaparecen de `coverage.excluded_assets` y
   `coverage.ingestion_plan`.
5. El estado temporal debe dejar de ser `blocked_by_coverage` cuando no queden activos
   de cartera pendientes. Si se aprueban exclusiones, `ingestion_plan` solo puede
   contener esas exclusiones explícitas; los benchmarks se diagnostican aparte.
6. Confirmar que TIR/TWR no se publican si el periodo común no alcanza la apertura o si
   queda cualquier activo de cartera sin precio.

Conservar el JSON de la previsualización, el resultado aplicado, el backup y el resultado
final de Cartera Real como evidencia de la intervención.
