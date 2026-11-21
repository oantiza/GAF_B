# Correcciones de la revisión integral — 5 de septiembre de 2026

Aplicación: BDB-ACTIVOS actual, `3-BDB-ACTIVOS_app`. Base: commit `c988249`.
Este documento registra la fase inicial de correcciones, realizada en local tras
la autorización «go», antes de sus publicaciones posteriores. Las pruebas de esa
fase utilizaron datos simulados. Los límites de 25 activos y recuentos de pruebas
que figuran abajo describen aquel momento: posteriormente se amplió la frontera
histórica a 40 activos y se reorganizaron los gráficos del backtest. El cierre
final de publicación y registro en Git se documenta por separado.

| Hallazgo | Cambio aplicado | Comprobación |
|---|---|---|
| 1. Datos comerciales compartidos entre usuarios en memoria | Caché por identidad, invalidación al cambiar/cerrar sesión, descarte de respuestas antiguas y remontaje por UID. | Usuario distinto, sesión cerrada y respuesta en vuelo. |
| 2. Lotes demasiado grandes para las reglas | Transacciones de hasta 20 activos, con recibo de importación atómico. | Emulador: 20 accesos permitidos, 21 denegados; 45 registros importados en tres transacciones. |
| 3. Deshacer sobrescribía cambios posteriores y filas no aplicadas | ISIN confirmados, versiones exactas, comprobación transaccional y seguimiento de lo ya deshecho. Se contrasta de nuevo la vista previa antes de aplicar. | Fallo parcial, edición posterior, mismo valor con nueva versión, vista previa obsoleta y reanudación. |
| 4. Estimaciones presentadas como cifras históricas | Etiquetas y explicación de metodología en Constructor, informe y Análisis, también con fuente LIVE. | Regresión de representación y recorrido en navegador. |
| 5. Cobertura falsa al faltar activos | El denominador incluye todo el peso solicitado. Los activos ausentes no producen una cartera válida aunque sus pesos sumen 100 %. | Cartera 50 % conocido / 50 % ausente: cobertura 50 %. Se conserva la tolerancia de redondeo. |
| 6. Recorte silencioso por encima de 25 activos | Se conserva la composición original, se muestran posiciones y patrimonio excluidos y se impide aplicar una optimización parcial a toda la cartera. | 40 posiciones iguales: 25 incluidas y 62,5 % del patrimonio; las exclusiones del backend reducen esa cobertura. |
| 7. Informe con frontera de otros parámetros | La clave incluye petición completa, origen, sesión y resultado visible. Cada modelo conserva su petición y solo se reutiliza si corresponde a la cartera actual. | Riesgo 3→8, cambio de fuente/sesión y rechazo de un resultado de otra petición. |
| 8. Extracto perdía el capital en el Constructor | Transferencia conjunta de posiciones, capital y nombre; agrupación de duplicados y exclusiones visibles antes de transferir. | Reconstrucción de importes con céntimos y exclusión de activos desconocidos/no invertibles. |
| 9. Reglas Firestore sin protección previa al despliegue | Functions, Firestore y Hosting ejecutan primero el guard de autorización. | Tres destinos cubiertos y rechazo de ejecución sin permiso. |
| 10. Recarga conservaba retrocesiones borradas | Se sustituye toda la generación, incluidos registros individuales y resultados negativos. | Borrado y alta posteriores a una lectura cacheada. |
| 11. PDF bloqueado por ausencia de frontera | Se genera con las secciones disponibles; la frontera muestra N/D y explica la causa. Una frontera parcial no representa toda la cartera. | Descarga desde Constructor y Análisis con un solo activo. |
| 12. Seguimiento de operaciones sin límite ni recuperación | Peticiones de 30 s, observación de cinco minutos, interrupción al salir y recuperación por identificador. Últimas 400 líneas con cursor independiente. | Petición colgada, escritura de resultado desconocido, cancelación, plazo, recuperación y salida de pantalla. |
| 13. Servicio local incompatible con la versión publicada | Operaciones solo en desarrollo; los tokens del servicio local se vacían en producción. | Compilación y documentación del entorno soportado. |

Las importaciones antiguas no prueban qué filas llegaron a guardarse: se conservan
sus registros, pero la restauración requiere revisión manual. Las nuevas usan
el formato 2. La recuperación de Operaciones consulta el registro y estado de una
tarea; no vuelve a lanzar la escritura ni cancela el trabajo del servicio.

## Dependencias y prevención

- JavaScript: `@xmldom/xmldom` 0.9.10→0.9.12 y `browserslist` 4.28.2→4.28.9,
  junto con cinco dependencias de datos de navegadores. No se cambian versiones
  principales de la aplicación. El análisis posterior de npm devuelve cero avisos.
- Python: `constraints.txt` fija las transitivas, conserva las versiones del entorno
  de referencia y el pin `google-api-core==2.34.0`. Se resolvió para Python 3.12 y
  se validó en un entorno aislado de esa versión. pip-audit no encontró vulnerabilidades
  conocidas en las versiones fijadas.
- CI incorpora Auth y Firestore emulados: comprueba permisos y ejecuta el código
  real de importación/deshacer con un proyecto `demo-` y direcciones loopback.
- README y guías de backend, despliegue, retrocesiones y operaciones actualizados.
  El README identifica los documentos antiguos de planificación como históricos.

Avisos consultados: [xmldom](https://github.com/advisories/GHSA-6gmq-8vp8-gcm6),
[Browserslist: memoria](https://github.com/advisories/GHSA-c83g-rgw3-j3cx) y
[Browserslist: estadísticas](https://github.com/advisories/GHSA-73wf-gq98-2v4g).
El bloqueo Python sigue la [documentación de uv](https://docs.astral.sh/uv/pip/compile/).

## Validación y siguiente paso

629 pruebas de la aplicación, 365 del backend Python 3.12 y dos de integración con
Firestore emulado superadas. También se verificaron permisos de acceso, recorrido
Constructor→Informe, PDF, análisis estático, compilación y paridad de 15 contratos.
La carga inicial queda dentro del presupuesto (aproximadamente 119 KiB JavaScript
y 28,5 KiB CSS comprimidos).

La validación utiliza datos simulados y emuladores. No certifica el estado actual
de IAM, servicios externos ni tareas desplegadas. El siguiente paso es revisar
este conjunto local y autorizar expresamente cualquier publicación. Para ello se
aplica el [runbook de despliegue](historico-bdb/RUNBOOK_DEPLOY.md); no se habilitan gates de
producción como parte de esta revisión.
