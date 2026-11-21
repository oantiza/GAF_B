# BBDD Activos Financieros

## Objetivo del Proyecto
El objetivo principal de este proyecto es establecer una base de datos maestra de activos financieros (Fondos, ETFs, Acciones, etc.) que servirá como fuente de la verdad para diversas aplicaciones e integraciones.

## Independencia Total
Este proyecto mantiene una **independencia total** de los repositorios `BDB-FONDOS` y `BDB-FONDOS-CORE`. No debe existir acoplamiento directo entre este repositorio y esos proyectos.

## Enfoque Contract-First
El desarrollo de esta base de datos sigue una metodología **contract-first**. Esto significa que primero definimos explícitamente los esquemas, validaciones, reglas de normalización y métricas de calidad de los datos (los "contratos") antes de proceder con implementaciones de persistencia o ingesta masiva.

## Estado Actual del Proyecto
Para conocer los activos actualmente importados, la arquitectura de Firestore, métricas acumuladas y próximos pasos, por favor consulta el documento de estado en vivo:
**[Ver Estado Actual del Proyecto](docs/PROJECT_STATUS_CURRENT.md)**

## Comandos Principales
```bash
# Ejecutar toda la batería de tests unitarios y de regresión
npm test

# Backup local diario read-only (assets/ + meta/)
npm run backup:export

# Compactación dry-run de price_series REFRESH -> bucket canónico
npm run compact:price-series
```

`npm test` es la suite reproducible usada por CI y comprueba también los tipos
de código y tests. `npm run test:artifact-fixtures` lanza solo la prueba del
lector del paquete de FondosDB; las demás verificaciones históricas que tenía
se borraron con su código el 17-11-2026 (decisión A-160).

Para programar el backup diario en Windows, apunta el Programador de tareas a
`scripts\backup_export_daily.bat`. El export queda en
`data/backups/<marca-temporal>/*.ndjson.gz`. Un bloqueo exclusivo evita que dos
copias se solapen; tras una verificación `PASS`, la tarea aplica la retención y
solo elimina copias completas de más de 30 días. Las ejecuciones incompletas se
conservan para diagnóstico.

## Política de Seguridad y Escrituras
- Las escrituras reales en la base de datos de producción están cerradas por defecto y protegidas por una variable de entorno estricta (`FIRESTORE_REAL_WRITE_ENABLED`).
- Ningún proceso automatizado escribirá datos reales sin pasar por un Gatekeeper validado exhaustivamente.
- Nunca se almacenarán credenciales (`serviceAccountKey.json`, `.env`) en el código fuente.
