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

# Tipos de código y pruebas
npm run typecheck
```

`npm test` es la suite reproducible usada por CI. Las órdenes de la base nueva
(`baseNueva:*`, `audit:*`, `nube:*`, `planes:*`, `carteras:*`) están en
`package.json` y, con su orden y sus puertas, en la habilidad `pipeline-extractor`.

**La base vieja ya no tiene código aquí** (21-11-2026, decisiones 30 a 39 de Óscar
sobre `CENSO_BASE_VIEJA_2026-11-21.md` de la raíz): se borraron el cargador y el
republish de la maestra (`load:fondosdb`, `republish:fondosdb`,
`audit:consistency`, `reclassify:stock`, `archive:assets`), sus reparaciones
(`compact:price-series`, `repair:sri-evidence`, `search-index:reconcile`), la copia
diaria y su retención (`backup:export`, `backup:retention` y
`scripts\backup_export_daily.bat`: si la tarea del Programador de tareas de Windows
sigue dada de alta, hay que quitarla a mano), `dryrun:carteras` y los contratos de
`contracts/master/`. Queda `backup:restore-drill`, la única vía para abrir en un
Firestore las copias de la maestra que siguen en `data/backups/` (decisión 33). El
estado anterior está en la etiqueta de Git `referencia-base-vieja-2026-11-21`.

## Política de Seguridad y Escrituras
- Las escrituras reales en la base de datos de producción están cerradas por defecto y protegidas por una variable de entorno estricta (`FIRESTORE_REAL_WRITE_ENABLED`).
- Ningún proceso automatizado escribirá datos reales sin pasar por un Gatekeeper validado exhaustivamente.
- Nunca se almacenarán credenciales (`serviceAccountKey.json`, `.env`) en el código fuente.
