# Cierre de incidencias del runbook — 5 de septiembre de 2026

La web de BDB-ACTIVOS se publicó correctamente en https://bbdd-activos-financieros.web.app. Se verificó HTTP 200 y coincidencia exacta del HTML publicado con la compilación local. El despliegue fue exclusivamente de Hosting, con autenticación de producción.

## Correcciones

- **Comparador del índice:** sustituida la comparación mediante serialización por comparación estructural, que ignora el orden de las propiedades. Eliminados 1.011 falsos positivos.
- **Clasificación del ETC de oro:** el dato publicado era correcto según la regla de filtros existente de BDB-ACTIVOS, que agrupa ETC/ETN/ETP bajo ETF. El comprobador TypeScript no aplicaba esa regla. Se alineó con el reconciliador Python, incluidos los campos de respaldo de clase y divisa. No se modificaron ni la ficha maestra ni el índice en Firebase.
- **Función `api`:** pertenece al codebase `analisis` de Análisis de Empresas, ajeno al despliegue de BDB-ACTIVOS. El diagnóstico inicial aplicaba el runbook a un ámbito demasiado amplio. Se aclaró el documento y su filtro de consulta. No se cambiaron cuentas ni permisos de la otra aplicación. Las 42 funciones propias están ACTIVE con identidad lectora o escritora dedicada.
- **Python 3.12:** creado un entorno aislado con las dependencias fijadas. Las 365 pruebas pasaron con CPython 3.12.13. El runbook ahora exige comprobar la versión efectiva antes de probar.
- **TOTP:** inscripción, reto de acceso y retirada del factor completados; verificación de cero factores restantes y borrado confirmado de la cuenta temporal. No se modificaron cuentas de asesores.

## Verificaciones

| Comprobación | Resultado |
|---|---|
| Pruebas web previas a publicación | 629 superadas, 2 omitidas |
| Calidad y compilación web previas | Correctas |
| Tipos y pruebas de plataforma tras las correcciones | Correctos; 543 pruebas superadas |
| Regresiones específicas del índice | 10 pruebas superadas (incluidas en las 543) |
| Contratos | 15 coinciden con la fuente oficial |
| Índice real, comprobador corregido | 1.012 entradas; ninguna ausente, ajena o diferente; DRY_RUN, sin escrituras |
| Series de precios | 18.180 válidas en v1.2; cero migraciones o errores; DRY_RUN |
| Tareas programadas | Seis habilitadas con la cuenta escritora |
| Secretos necesarios | EODHD_API_KEY, FINNHUB_API_KEY y GEMINI_API_KEY presentes; no se leyeron sus valores |
| Cabeceras web | HTML con no-store; recursos con caché inmutable |
| CORS | Acepta http://127.0.0.1:5173 |
| Callable sin sesión | HTTP 401 |
| Ejecución manual de métricas | HTTP 200; finalizada 17:57:20 UTC; 201 activos actualizados; cero errores y contratos rechazados |

La tarea de métricas utilizó 1.224 de sus 6.000 lecturas permitidas. Informó ocho casos sin series y tres omitidos por no tener datos más recientes. No se lanzó la tarea de precios.

## Evidencia local

- Índice: `C:/Users/oanti/Proyectos/BDB/2-plataforma-datos/runs/search_index_reconcile_2026-09-05T17-56-25-093Z/summary.json`.
- Series: `C:/Users/oanti/Proyectos/BDB/2-plataforma-datos/runs/price_series_v12_2026-09-05T17-43-25-315Z/summary.json`.
- TOTP: `C:/Users/oanti/.codex/.chatgpt-projects/g-p-6a36d163df3c8191a61cd682b6ce0a9d/incident-results/totp.json`.
- SHA-256 del HTML desplegado: `BDB7558B0A288A5C374F5FF9049F3D9BAE5EDEBE61D4283B5C4B8630453B4AEB`.

Las correcciones de esta fase son herramientas locales, pruebas y documentación; no requieren otro despliegue web. Quedan en el árbol de trabajo, sin crear commits.
