# Corrección de ajustes históricos — 6 de septiembre de 2026

## Estado

**Completado en producción el 06/09/2026, con autorización del titular para terminar los pasos pendientes.** Código, correcciones previas de Claude (incluidos los PDF), reparación de los nueve activos y verificaciones del runbook aplicados.

Commit de código: `4980264336839026fedab2da863be26de3ffe1a9`, enviado a `origin/master`. El cierre documental se registra en un commit posterior, sin cambios adicionales de aplicación.

Web publicada: https://bbdd-activos-financieros.web.app — versión de Hosting `441a3db587feb864`, publicada a las 13:53:07 UTC (15:53:07 de Madrid). Functions Python 3.12 se desplegó antes de Hosting. La función ajena del codebase `analisis` quedó fuera de la intervención.

## Problema y solución

El refresco leía un solapamiento de siete días, pero descartaba cualquier fecha anterior o igual a la última guardada. Si el proveedor revisaba los precios ajustados tras un desdoblamiento o dividendo, se concatenaban precios de dos versiones distintas. Ampliar el solapamiento no corrige los años anteriores.

La actualización diaria y la individual contrastan ahora los precios nativos coincidentes, incluso sin fechas nuevas. Ante una revisión, una divisa distinta o la falta de un anclaje comparable, reconstruyen todos los documentos de ese listado desde la primera fecha almacenada. La recarga mediante ingesta de un activo existente usa la misma reparación, incluyendo sus documentos REFRESH.

- Cada fecha antigua debe seguir presente. Si falta cotización, conversión, identidad inequívoca del listado o capacidad para una operación atómica, no se publica una serie parcial.
- Todos los documentos del activo reciben precios de la misma consulta completa. Las fechas duplicadas entre documentos reciben el mismo valor.
- Precios, métricas completas y eliminación del estado anterior de drawdown se escriben en un único lote, con condiciones sobre las versiones leídas. Un cambio concurrente invalida la operación.
- El refresco de métricas también escribe sus cifras y su estado en un único lote. Una tarea que leyó las métricas antes de la reparación no puede sobrescribir las nuevas ni recrear el estado antiguo.
- Una reparación fallida del refresco deja una marca de histórico pendiente. Se conservan los bloqueos de calidad impuestos por otras causas.
- Amphenol y Naturgy tienen cuarentena específica por ajuste histórico. Se mantiene la cuarentena anterior de los siete casos de divisa. La cartera real conserva los hechos del extracto y publica N/D en las métricas dependientes del histórico, explicando el activo y el motivo.
- Las cuarentenas conocidas deben retirarse después de la reparación y de su verificación, no por el mero despliegue. Una serie ya reconstruida no se vuelve a descargar completa en cada refresco solo por seguir en la lista de cuarentena.
- La caché de precios se invalida en la instancia escritora y su vencimiento de 15 minutos ya no se prolonga con cada consulta. Otras instancias pueden conservar su lectura hasta ese vencimiento.

El verificador admite `--full-prices`, comprueba realmente el número solicitado de puntos y no pierde las fechas sin cotización o FX. Un resultado OK de muestreo se identifica como tal. La tolerancia para certificar un precio se limita al redondeo, en vez de tolerar un error del 2 %. Coincidir con cierres sin ajustar sigue requiriendo revisar la continuidad temporal; no certifica la rentabilidad.

## Preparación y aplicación de los datos reales

`scripts/plan_price_history_repair.py` solo lee Firestore y el proveedor. Requiere una lista explícita de activos, admite como máximo 50 y no tiene opción de escritura en la maestra. Conserva localmente el estado previo, las propuestas, las versiones de los documentos, las métricas y sus huellas SHA-256. Rechaza reutilizar una carpeta de salida existente.

Evidencia de esta ejecución:

`C:\Users\oanti\.codex\.chatgpt-projects\g-p-6a36d163df3c8191a61cd682b6ce0a9d\tmp\price-history-repair-preview`

| Activo | Documentos propuestos | Valores diferentes | Fechas antes y después |
|---|---:|---:|---:|
| Amphenol — APH.US | 26 | 6.123 | 6.124 |
| Naturgy — NTGY.MC | 17 | 3.980 | 4.010 |
| VanEck Uranium — NUKL.XETRA | 5 | 908 | 908 |
| iShares Core S&P 500 — SXR8.XETRA | 18 | 4.022 | 4.022 |
| Invesco S&P 500 — P500.XETRA | 17 | 3.711 | 3.711 |
| VanEck Rare Earth — VVMX.XETRA | 7 | 1.258 | 1.258 |
| iShares AI Infrastructure — AIFS.XETRA | 4 | 439 | 439 |
| iShares Energy Storage — STOR.AS | 3 | 400 | 401 |
| HSBC — HSBA.LSE | 36 | 8.628 | 8.628 |
| **Total** | **133** | **29.469** | **29.501** |

Los nueve planes se han podido preparar, sin perder ninguna fecha. Un segundo cálculo con aritmética decimal comprobó las 29.501 observaciones propuestas: precio nativo ajustado × escala de subunidad / cambio del día. Cero diferencias por encima de 0,0000011 EUR. El mayor documento JSON ocupa 52.303 bytes; el mayor conjunto por activo, 1.761.104 bytes.

Ejemplos calculados sobre los planes revisados, cuyos precios se aplicaron y se comprobaron posteriormente documento a documento:

- Amphenol, 28/08/2026–04/09/2026: el rendimiento calculado con la serie almacenada es −47,6523 %; con la propuesta es +4,6954 %. No basta revisar su máxima caída histórica: el mínimo de 2008 continúa siendo más profundo y puede ocultar el salto falso de 2026.
- Naturgy, 23/06/2026–04/09/2026: +6,0628 % almacenado frente a +8,2246 % con una base ajustada coherente.
- SXR8: máxima caída histórica −38,7701 % almacenada frente a −33,7839 % recalculada en la simulación.

Este inventario corresponde a la lectura actual de estos nueve activos. No certifica todo el universo ni cierra las otras discrepancias de base de precio, incluido Endesa. No se ha extrapolado desde documentos muestreados.

## Verificación local

- Python 3.12: **436 pruebas aprobadas** (404 antes de esta intervención).
- TypeScript/Vitest: **728 aprobadas y 2 omitidas**; repetidas también las dos pruebas de fuentes tras corregir sus tipos.
- Compilación completa: correcta, incluido TypeScript y el presupuesto de tamaño inicial.
- ESLint: correcto. Se corrigieron cuatro usos de `any` de la prueba previa de fuentes PDF, manteniendo el comportamiento de esa prueba.
- Regresiones específicas: corrección de años antiguos y fechas duplicadas, falta de cotización/FX, idempotencia, vista previa sin escrituras, actualización diaria/individual/reingesta, conflicto concurrente, bloqueo de otra causa, vencimiento de caché y conservación de los importes del extracto con las métricas bloqueadas.

## Producción: pasos completados

1. **Copia completa y restauración de prueba.** 22.411 documentos de Firestore y artefacto de 17 cuentas de Firebase Auth. Los 22.411 documentos se restauraron en un emulador local aislado y se compararon: **cero diferencias**. El artefacto de cuentas se comprobó por hash; no se restauraron usuarios sobre producción. El emulador se cerró al terminar. No se escribió el marcador de backup en la maestra.
2. **Primer despliegue de Functions.** Se publicaron las protecciones conservando la cuarentena de los nueve activos. Operación terminada correctamente para las 42 funciones; ejecución fuera del horario de las tareas programadas.
3. **Reparación acotada.** Nueve lotes atómicos: 133 documentos de precios, nueve documentos de métricas y eliminación de nueve estados anteriores de drawdown (**151 operaciones**). Cero modificaciones de fichas raíz. Se conservaron las **29.501 observaciones** del conjunto, sin perder ninguna fecha de ningún activo, y se corrigieron 29.469 valores distintos. Cada lote se contrastó con el plan revisado, sus versiones de lectura y su estado guardado.
4. **Verificación íntegra.** El verificador se ejecutó con `--full-prices`, sin muestreo de documentos: **133 OK; cero errores de divisa, escala, base de precio o discrepancia; cero documentos sin verificar**. Se verificaron también las métricas con respuestas satisfactorias del BCE.
5. **Retirada de cuarentena y publicación final.** Solo después del punto anterior se configuró `BDB_VERIFIED_PRICE_REPAIR_RELEASES` para los nueve ISIN verificados y se volvieron a publicar las funciones. A continuación se desplegaron reglas y Hosting. El archivo de entorno permanece fuera de Git; no contiene cambios en los otros controles. Los bloqueos de calidad y las futuras marcas `REPAIR_REQUIRED` siguen siendo efectivos.
6. **Comprobaciones del runbook.** Las 42 funciones están ACTIVE, con Python 3.12 y cuentas dedicadas; las seis tareas están ENABLED y usan la escritora. Web y rutas: HTTP 200 y `no-store`; recursos: caché inmutable y contenido idéntico a la compilación local. Preflight desde `127.0.0.1:5173`: 200. Callable sin sesión: 401. Reglas publicadas idénticas al archivo local.
7. **Tarea de métricas.** Se ejecutó un ciclo completo respetando el límite de 800 activos por lote: 800 + 212. Ambas peticiones terminaron con HTTP 200; el segundo lote publicó `scheduled_refresh_metrics_ok`, borró el cursor de continuación y declaró `cycle_completed: true`. Cero errores, cero escrituras de métricas (solo los marcadores de avance de la tarea). No se lanzó el refresco global de precios.
8. **Plataforma de datos.** Reconciliación del índice en DRY_RUN: 1.012 activos, sin diferencias, `needs_write: false`. Contratos en DRY_RUN: **18.180 series v1.2**, `eligible_updates: 0`, `invalid: 0`, ninguna escritura.

### Incidencia operativa resuelta

La primera comprobación de AIFS recibió un timeout del BCE y construyó una expectativa con tipo cero para una ventana. El cálculo escrito en el lote había recibido el tipo correcto. El control detuvo la continuación; se revalidaron los siete lotes aplicados con respuestas satisfactorias del BCE, sin reescribirlos, y se completaron STOR y HSBC. Se conservan la expectativa original fallida y la verificación posterior en la evidencia. Los nueve documentos de métricas coinciden con el cálculo verificado.

### Pruebas funcionales con la maestra reparada

Los servicios se ejecutaron localmente en modo de solo lectura contra los datos de producción y con la misma liberación de cuarentena verificada en las funciones publicadas:

- Backtest a un año: **9/9 activos incluidos**, 246 observaciones diarias comunes, ninguna exclusión.
- Frontera a tres años: **7/7 activos con ventana suficiente**, 156 variaciones semanales comunes, puntos calculados en los motores clásico y robusto; selector de riesgo 5/10 comprobado.
- Cartera real con los extractos de regresión privados: `ready_for_engine`, 1.465 observaciones; hechos del extracto (importe, caja, patrimonio, dividendos, comisiones y flujos) idénticos al control. Ninguno de los nueve activos se excluye por divisa o cuarentena.
- STOR y AIFS tienen menos de tres años de historia: reparar su divisa o ajuste no amplía esa cobertura ni habilita una proyección que requiera tres años completos.

El navegador cargó la web publicada sin errores de consola, pero permaneció en la pantalla de acceso. La interacción autenticada y la descarga de un PDF desde producción no se verificaron en esta sesión; las pruebas funcionales anteriores y las pruebas de PDF sí se ejecutaron.

### Evidencias y recuperación

- Copia completa, manifiesto y restauración: `C:\Users\oanti\Proyectos\BDB\2-plataforma-datos\data\backups\2026-09-06T13-27-01-684Z`.
- Estado previo, planes aplicados, métricas y hashes por activo: `C:\Users\oanti\.codex\.chatgpt-projects\g-p-6a36d163df3c8191a61cd682b6ce0a9d\tmp\price-repair-applied`.
- Contraste completo: `tmp/price-repair-full-verification.json`, dentro de esa carpeta de trabajo de Codex.
- Servicios, publicación, ejecución de métricas y pruebas de cartera: `tmp/price-repair-deployment`, en la misma carpeta de trabajo.
- Logs de despliegue: `tmp/deploy-price-guards.log`, `tmp/deploy-price-release-functions.log` y `tmp/deploy-price-release-hosting.log`.
- Código anterior: `0dea2b4`; Hosting anterior: `ae64fed713152d61`. Para una reversión seguir el runbook, detener primero las escrituras y validar la restauración; no reactivar el escritor antiguo sobre históricos reparados.

La configuración de liberación que debe conservarse en futuros despliegues es:

```text
BDB_VERIFIED_PRICE_REPAIR_RELEASES=ES0116870314,GB0005405286,IE0002PG6CA6,IE000DR59CI3,IE000M7V94E1,IE000X59ZHE2,IE00B3YCGJ38,IE00B5BMR087,US0320951017
```

La reparación y su despliegue quedan cerrados para estos nueve activos. La investigación de otras discrepancias de base de precio, incluido Endesa, y el resto de la auditoría son trabajos distintos; este cierre no los da por resueltos.
