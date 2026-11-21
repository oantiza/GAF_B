# Análisis común de 3 y 5 años

## Contrato y alcance

`backtest_portfolio` acepta la opción aditiva `analysis_bundle: true` y devuelve
`portfolio-horizon.v1`. Las peticiones existentes conservan su contrato. No hay
escrituras en la maestra ni cambios en los precios, cuarentenas o contratos de
cartera real. La lectura conserva los controles del repositorio vigente.

Constructor, simulación, comparativa, analítica avanzada e informe Andbank comparten
la selección de sesión 3Y/5Y y la misma respuesta cacheada por posiciones, pesos y
periodo. Al cambiar la selección se oculta inmediatamente la respuesta anterior.
El periodo se cierra en la última semana completa disponible. El inicio se lleva
al viernes anterior o igual al aniversario para cubrir todo el periodo solicitado.
Se muestran siempre las fechas efectivas. Se exige precio válido, en EUR y con
antigüedad máxima de catorce días para cada fecha de la cuadrícula
(`MAX_BRIDGED_WEEK_GAP_DAYS` en `functions_python/weekly_sampling.py`; este documento decía siete hasta el 17-11-2026).

La cartera histórica conserva las proporciones iniciales de las posiciones
cubiertas (buy-and-hold). CAGR se anualiza por días reales/365,2425; volatilidad usa
la desviación muestral de los rendimientos semanales por raíz de 52. Sharpe usa
CAGR menos €STR de la ventana, dividido por volatilidad. Drawdown se mide sobre el
recorrido diario. La frontera reutiliza la regularización de retorno y covarianza
del motor robusto vigente; sus coordenadas esperadas no son el CAGR observado.
La proyección lognormal usa la misma serie semanal y el horizonte seleccionado;
pantalla y PDF llaman al mismo cálculo de percentiles. Las comparaciones de pesos
óptimos son retrospectivas dentro de la muestra, no resultados fuera de muestra.

El optimizador avanzado con restricciones conserva su circuito específico; no se
han cambiado sus reglas de elegibilidad ni sus propuestas de pesos. Los episodios
de estrés conservan exclusivamente precios observados y las fechas de cada crisis.

## Referencias analíticas

Versión inicial: `eur-proxy-2026-09-06.1`, en `analytical_references.json`.
Es un recurso analítico separado de las series maestras y de su caché. Contiene
datos de referencia, coeficientes y evidencia de validación; no datos de clientes.

| Activo | Referencia | Semanas comunes | Correlación fuera de muestra | Riesgo residual anual |
| --- | --- | ---: | ---: | ---: |
| IE000M7V94E1 | VanEck Uranium and Nuclear ETF, NLR.US, convertido a EUR | 186 | 0,8909 | 13,85 % |
| IE000DR59CI3 | STOXX Global Energy Storage and Hydrogen, retorno neto EUR, STXEGSTR | 80 | 0,9750 | 8,17 % |

Fuentes: [VanEck NLR](https://www.vaneck.com/us/en/investments/uranium-nuclear-energy-etf-nlr/),
[STOXX STXEGSTR](https://stoxx.com/index/stxegstr/), cotizaciones ajustadas EODHD y
EURUSD del mismo proveedor. NUKL.XETRA ya cotiza en EUR; STOR.AS y NLR.US se convierten
desde USD. Las fechas de cotización comunes se alinean antes del muestreo semanal;
se descarta la última semana incompleta de la referencia.

Validación cronológica: primer 70 % para calibración y 30 % para contraste. El
coeficiente no negativo se ajusta sin intercepto sobre rendimientos semanales.
Umbral operativo: al menos 52 variaciones, correlación de contraste >= 0,75 y
error cuadrático inferior al de la predicción nula. Son criterios de aceptación
del modelo, no garantía de equivalencia entre el ETF y su referencia.

La reconstrucción aplica el coeficiente a los retornos logarítmicos de la
referencia y añade residuos semanales centrados, remuestreados en bloques de cuatro
semanas. La semilla deriva del ISIN y versión, y se calcula sobre toda la referencia
antes de recortar la ventana: los tramos comunes son idénticos a 3Y y 5Y. Cada
residuo semanal se distribuye entre los días disponibles de esa semana.
El enlace se ancla al primer precio real. No sustituye ningún precio observado,
no rellena huecos posteriores a la constitución y no levanta bloqueos de calidad.

La calibración es retrospectiva: utiliza información posterior al periodo que se
reconstruye. El índice STOXX también contiene historia retrospectiva anterior a su
lanzamiento. Ambos hechos se explican en el anexo. Los datos reconstruidos no son
rentabilidad histórica realizable del ETF. Las referencias congeladas completan
solo el tramo anterior al lanzamiento; las nuevas cotizaciones reales siguen
llegando por el circuito ordinario. Una actualización del modelo requiere nueva
validación, versión y despliegue, no una escritura en precios.

## Cobertura y comprobaciones

Si otros activos carecen de cobertura o están bloqueados, se excluyen con motivo.
Los pesos se normalizan sobre el subconjunto y los euros proyectados se limitan
al capital cubierto. No se simula efectivo ficticio para compensar exclusiones.

Pruebas de aceptación: ventanas completas 3Y/5Y, conservación de precios y caché,
rechazo de huecos y referencias deficientes, mismo universo en comparativa y
frontera, mismos valores y etiquetas en pantalla/PDF, horizonte de percentiles y
lectura de numeración y metodología del PDF generado. La comprobación privada con
la cartera real se guarda fuera de Git; las dos referencias funcionan y los
bloqueos de calidad siguen vigentes.

Despliegue: publicar primero la función `backtest_portfolio`, después Hosting.
Seguir las verificaciones de `historico-bdb/RUNBOOK_DEPLOY.md`, que era el de BDB y no se ejecuta: aquí se despliega con `scripts/desplegarFunciones.mjs` y `4-base-nueva`. El backup completo y restore drill
del 06-09-2026 son anteriores al cambio y terminaron sin diferencias. Los siete
archivos protegidos de la última entrega de Claude conservan su SHA-256.

## Cierre de verificación · 06-09-2026

- Batería completa: 759 pruebas TypeScript aprobadas (2 omitidas) y 478 Python.
  Lint, TypeScript, compilación y presupuesto de recursos correctos. Las 18
  pruebas de PDF afectadas se repitieron tras ordenar los anexos.
- Verificación con lecturas de la cartera real: periodos completos a 3Y y 5Y,
  los dos ETF incluidos, pesos y fechas coincidentes. PDF de diez páginas para
  cada periodo, comprobados por texto y por representación visual. La interfaz
  local, alimentada con esas mismas lecturas, cambia conjuntamente gráficos,
  métricas, comparativa y rótulos anuales; oculta el resultado anterior mientras
  calcula. Los percentiles de pantalla e informe comparten el mismo motor.
- Producción: primero `backtest_portfolio`, después Hosting; 42 funciones ACTIVE
  con cuentas dedicadas, seis tareas habilitadas con cuenta escritora, web 200,
  rutas sin caché, recursos inmutables, preflight local 200 y callable sin sesión
  401. Reglas publicadas iguales a las del repositorio.
- La tarea de métricas completó el universo en dos invocaciones (800 + 212),
  ambas HTTP 200, sin errores ni escrituras de métricas; final
  `scheduled_refresh_metrics_ok` y `cycle_completed: true`.
- Reconcile de índice: `needs_write: false`. Contratos: 18.180 series v1.2,
  cero actualizaciones elegibles y cero inválidas; ambas comprobaciones DRY_RUN.
- La sesión de Chrome dejó de estar disponible antes de la comprobación final.
  La descarga autenticada desde la web queda pendiente de recuperar esa sesión;
  no se confunde con la generación local verificada ni con los checks públicos
  de producción. No se han cambiado credenciales ni permisos para suplirla.

Los artefactos privados de aceptación quedan fuera de Git. La base maestra no
contiene las series estimadas: siguen siendo un recurso exclusivo del análisis.
