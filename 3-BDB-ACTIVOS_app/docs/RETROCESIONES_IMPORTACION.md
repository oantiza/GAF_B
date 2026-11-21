# Retrocesiones comerciales: alta manual e importación desde Excel

*05-09-2026. Sistema › Retrocesiones. Dato propio de la app (colección
`commercial_retro`), separado de la maestra de activos: no pasa por el extractor
ni por la plataforma de datos y funciona desde la app desplegada.*

## Qué es el dato

`retro_pct` es la retrocesión **en porcentaje sobre el patrimonio** de la
posición (0,80 = 0,80 % anual). El análisis de posiciones y el Constructor la
leen como `retro_pct / 100`. Solo la ve el admin; el modo cliente la oculta
en pantalla, en el CSV y en el PDF.

Cada fondo tiene un único registro, indexado por ISIN, con `as_of_date`
(vigencia), `source` (alta manual, importación de fichero, ficha de costes),
`note`, `updated_at` y `updated_by`. Las reglas de Firestore solo dejan
escribir a un admin, exigen que el ISIN exista en la maestra y acotan el valor
a 0-100.

## El fichero

Excel `.xlsx` o CSV/TSV/texto pegado. Las columnas se reconocen **por la
cabecera**, en cualquier orden:

| Columna | Obligatoria | Cabeceras reconocidas |
|---|---|---|
| ISIN | sí | `isin` |
| Retrocesión | sí | cualquier cabecera con `retro`, `rebate`, `comisión`, `incentivo` o `cesión`; si no hay ninguna, la columna numérica |
| Nombre | no | `nombre`, `name`, `fondo`, `denominación`, `activo` (no se guarda; sirve para avisar si no se parece al nombre de la maestra) |
| Fecha | no | `fecha`, `vigencia`, `as_of`, `date`, en `AAAA-MM-DD`; sin ella se aplica la vigencia elegida en pantalla |
| Nota | no | `nota`, `note`, `comentario`, `observaciones` |

Sin cabecera vale el formato compacto de siempre: `isin;retro;[fecha];[nota]`.
Si el libro tiene varias hojas se elige la hoja. «Plantilla Excel» descarga un
fichero con las tres columnas `nombre · isin · retro`.

### La escala

Excel guarda una celda con formato de porcentaje como **fracción**: la celda
que muestra 0,80 % contiene 0,008. Las librerías de lectura devuelven ese
0,008 sin el formato, y una importación que lo tome tal cual guarda una
retrocesión cien veces menor. Por eso la importación pide la escala:

- **Fracción con formato % de Excel** (0,008 = 0,80 %): se multiplica por 100.
- **Porcentaje** (0,80 = 0,80 %): se guarda tal cual.

Se sugiere «fracción» cuando todos los valores del fichero quedan por debajo
de 0,2 (una retrocesión del 20 % sobre patrimonio no existe). La vista previa
enseña siempre el valor final. Los valores se redondean a cuatro decimales de
porcentaje para que los restos de fórmula no produzcan actualizaciones falsas.

## Los tres pasos

1. **Fichero**: se lee, se muestran las columnas detectadas, la escala
   sugerida, la fecha de vigencia (por defecto la del fichero) y la opción
   «el fichero es la lista completa» (propone borrar lo que no aparezca).
   Las filas no válidas (ISIN mal formado, valor no numérico o fuera de
   rango) se listan y no se importan. Un ISIN repetido con el mismo valor se
   colapsa; con valores distintos queda fuera hasta elegir uno en pantalla.
   Los fondos con retrocesión 0 se listan aparte: se guardan como 0 real.
2. **Pasada en seco**: contrasta con la base actual y con la maestra. Cada
   fila lleva su acción: crear, actualizar, sin cambios, borrar (solo en modo
   lista completa) o **fuera de la maestra** (el ISIN no existe como activo y
   la regla de Firestore lo rechazaría; hay que darlo de alta antes). Solo el
   valor y la nota deciden si hay cambio: una fila con el mismo valor es «sin
   cambios» aunque la fecha de vigencia del fichero sea otra, así la carga
   mensual del mismo Excel no reescribe la tabla entera. Se puede descargar
   como CSV.
3. **Aplicar**: el diálogo repite el reparto y exige teclear el número de
   cambios. La escritura utiliza transacciones de hasta **20 activos**: las
   reglas consultan la maestra por cada activo y admiten 20 accesos por petición.
   La vista previa se vuelve a contrastar con los registros actuales. Cada lote
   guarda, en la misma transacción, sus ISIN confirmados y sus versiones exactas.
   Un fallo conserva un registro verificable de lo aplicado; ante una respuesta
   de red ambigua se consulta ese registro.

**Deshacer última importación** restaura únicamente los ISIN confirmados y
pendientes de deshacer. Comprueba la versión actual antes de escribir y conserva
cualquier edición posterior. Si se interrumpe, una nueva consulta continúa desde
el último lote confirmado. Las importaciones anteriores al formato 2 requieren
revisión manual: sus fotos antiguas no prueban qué filas llegaron a guardarse.

La caché comercial pertenece a la sesión autenticada, caduca a los cinco minutos
y se vacía al cambiar de usuario. Una recarga forzada sustituye tanto la lista
como los registros individuales y los resultados «no existe».

## Verificación

```
npm run lint · npm run typecheck · npm test · npm run build · node scripts/auditoriaFrontend.mjs <etiqueta> d,tp
```

El recorrido (`auditoriaFrontend.mjs`) sustituye a `npm run audit:ui` desde el 19-11-2026. Es un informe que
hay que leer, no una puerta, y con `d,tp` mide el Modo cliente en esos dos anchos y la accesibilidad solo a
1.440 px: para un cierre, los seis anchos (`xl,l,d,p,t,tp`) con `AUDIT_AXE=todos`.

Pruebas: `tests/commercialRetroCsv.test.ts` (detección de columnas, escala,
duplicados, conflictos, ceros, vista previa), `tests/commercialRetroXlsx.test.ts`
(escritor y lectura de ida y vuelta), `tests/commercialRetroStore.test.ts`
(lotes, foto previa, parcial, deshacer) y `tests/firestoreCommercialRetroRules.test.ts`.

Integración real de reglas, solo con emuladores y proyecto `demo-`:

```text
npx firebase-tools@15.29.0 emulators:exec --only auth,firestore --project demo-bdb-audit "node scripts/testCommercialRetroEmulators.mjs"
```
