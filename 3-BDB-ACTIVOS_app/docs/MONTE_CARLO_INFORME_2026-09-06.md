# Monte Carlo en el informe de cliente — 2026-09-06

## Problema y corrección

La selección «Cubren la ventana» del simulador no alimentaba el informe de cliente. El PDF pedía su propio backtest y la historia común, limitada por una posición reciente, no cubría las 156 variaciones semanales exigidas para proyectar tres años.

El informe usa ahora una calibración específica para Monte Carlo: reutiliza el histórico principal o el de cinco años si bastan; de lo contrario, solicita cinco años con `min_history=ENFORCE`. No rebaja el mínimo estadístico ni sustituye las series que alimentan las métricas principales del informe. Si tampoco hay histórico suficiente, conserva N/D con explicación; un fallo del servicio permite reintentar.

La cobertura se obtiene de los pesos originales y de los identificadores realmente incluidos. Si hay exclusiones, los euros proyectados se limitan al capital cubierto. El PDF declara periodo, porcentaje, número de posiciones y un anexo paginado con las exclusiones. Sin valoración, utiliza base 100.

## Verificación del PDF de producción

Generado desde la sesión autenticada ya abierta en Informe de cliente, después de recargar la versión publicada. Se conservan el nombre de cliente, responsable, benchmark y todas las posiciones de GORKA.

- PDF: 105.843 bytes, 9 páginas.
- SHA-256: `fd8abfd057a815188f878d3db924c3452bfb54c89f72e4661aece7a837e3f267`.
- Composición íntegra: 39 identificadores únicos, 20 posiciones en la primera hoja y 19 en la segunda.
- Página 6: frontera y Monte Carlo completos, comprobados en texto y renderizado.
- Calibración de Monte Carlo: 31/08/2021–03/09/2026, medición semanal.
- Cobertura: 36/39 posiciones, 97,5 % del peso; capital cubierto 985.296 €.
- P50: 1.307.942 €; P5: 1.013.547 €; P95: 1.687.848 €. Son resultados hipotéticos de esa parte de la cartera, no una previsión del patrimonio completo.
- Página 9: TSK (`ES0105394003`, calidad del dato), VanEck (`IE000M7V94E1`, histórico insuficiente) e iShares (`IE000DR59CI3`, histórico insuficiente).
- La frontera mantiene su cobertura propia, 37/39 y 98,5 %, indicada por separado.

## Pruebas

- TypeScript: 753 pruebas pasan, 2 omitidas (111 archivos pasan, 1 omitido).
- Python 3.12: 469 pruebas pasan.
- Lint y compilación de producción correctos.
- Once pruebas nuevas cubren selección y reutilización del histórico, umbral semanal, errores y reintentos, cobertura, capital conocido/desconocido, composición grande y paginación del anexo.
- Los siete archivos del último trabajo de Claude conservan exactamente su SHA-256 anterior. Ninguno figura en el cambio.

## Publicación y runbook

- Código: commit `986b9a743f1d61388f131a1fb8a8ee74d9659360`.
- Despliegue exclusivo de Hosting conforme a `docs/historico-bdb/RUNBOOK_DEPLOY.md`.
- Publicado: 2026-09-06 17:25:00.398 UTC.
- Versión: `f8a246a52d5a7256`; rollback de Hosting: `33a994c4d33733f7`.
- Gate limitado al proceso de despliegue y retirado en `finally`.
- Comprobada la existencia de los tres secretos requeridos, sin leer sus valores.
- 42 funciones ACTIVE, Python 3.12 y cuentas dedicadas; configuración de las nueve reparaciones de precios preservada.
- Seis tareas ENABLED con cuenta escritora.
- Web y ruta `/cartera`: 200 y `no-store`; assets inmutables; bundle publicado idéntico al compilado local.
- CORS local: 200; callable sin sesión: 401; reglas publicadas idénticas a las locales.
- Métricas: dos lotes (800 + 212), ambos HTTP 200, ciclo completo, cero errores y cero escrituras de métricas. No se lanzó precios.
- Índice: DRY_RUN, 1.012 entradas, `needs_write: false`, sin diferencias.
- Contratos de precios: DRY_RUN, 18.180 series ya en v1.2, cero actualizaciones elegibles, cero documentos inválidos y cero escrituras.

No se modificaron datos de precios, contratos de almacenamiento, reglas, funciones ni la configuración de reparaciones. Las comprobaciones del runbook se conservan fuera de Git en `tmp/report-monte-deployment` del espacio de trabajo de Codex.
