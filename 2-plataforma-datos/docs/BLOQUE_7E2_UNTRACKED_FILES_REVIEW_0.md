# Bloque 7E-2: Untracked Files Review & Safe Exclusions

## Objetivo
Revisar los archivos que quedaron fuera del primer commit seguro (`.env.example` y el subdirectorio `EODHD-MCP-Server/`), evaluar su riesgo, sanitizarlos si procede, y añadirlos a los manifiestos de exclusión (`.gitignore`) o incorporarlos al repositorio según corresponda.

## Estado Inicial de Untracked Files
Antes de la ejecución de este bloque, `git status --short` mostraba:
```
?? .env.example
?? EODHD-MCP-Server/
```

## Decisiones y Acciones Tomadas

### 1. `.env.example`
- **Estado Original:** Contenía `EODHD_API_TOKEN=replace_me` (sin secretos reales).
- **Acción:** Fue **sanitizado** y alineado a la estructura completa de configuración local recomendada.
- **Resultado:** **Añadido al repositorio**. Es una plantilla 100% segura que servirá para inicializar el proyecto en nuevas máquinas.

### 2. `EODHD-MCP-Server/`
- **Estado Original:** Un directorio que contiene un repositorio externo en Python con su propio `.git`, ficheros Docker, y `requirements.txt`.
- **Acción:** Dado que representa un componente ajeno a la aplicación Node.js de la BBDD, e incluye su propio ecosistema git, fue catalogado como vendor/externo.
- **Resultado:** **Excluido mediante `.gitignore`**. No se rastreará como parte del proyecto BBDD principal.

## Ejecución de Tests y Safety Check
Tras las exclusiones, se verificó la indemnidad del pipeline:
- **`npm test`**: 164 / 164 PASS. Ninguna validación se vio comprometida al excluir el servidor MCP o añadir la plantilla ENV.
- **Seguridad en Staging:** 
  - `.env.local`: **NO** está en staging.
  - `serviceAccountKey.json`: **NO** está en staging.
  - `node_modules/`: **NO** está en staging.

## Resultado de Producción
- **Firestore Writes / Deletes:** 0. Se cumple estrictamente la política de no modificar la BBDD en este bloque.
- **Commit:** Creado bajo el mensaje `chore(repo): document local env template and exclusions`.
- **Push:** NO realizado.
