> **Histórico de BDB: no se ejecuta.** Las órdenes de este documento son contra el proyecto o la carpeta de BDB, que está en uso y desde aquí no se toca. Se conserva como registro (decisión 106, 05-11-2026).

# Plan de consolidación física — un solo hogar para BDB

*2026-06-29. Capstone estructural del plan reconciliado. Se hace AHORA porque ya tocaba: el frente de datos+consistencia (F1–F3) está cerrado (maestra 744/758, 0 drift). El plan siempre dijo "mover carpetas al final".*

## Objetivo

Hoy el sistema está disperso en **dos carpetas padre**: `Documents\` y `Proyectos\`. Juntar todo bajo **un solo padre** para que sea fácil de encontrar, abrir y operar.

## Estructura objetivo (simple, recomendada)

Repos como **hermanos** bajo un padre. Son repos git independientes; no los anido en `data-platform/acquire` etc. (eso partiría su identidad). La cohesión "plataforma de datos" ya vive en el **contrato** (`bbdd-activos-financieros/contracts/`), no hace falta forzarla en el árbol de carpetas.

```
C:\Users\oanti\Proyectos\BDB\
├── fondosdb\                    ← (era  Proyectos\DATOS FONDOS\fondosdb)   ADQUIRIR
├── bbdd-activos-financieros\    ← (era  Documents\BBDD-ACTIVOS-FINANCIEROS) INGERIR (loader, contratos, audit)
├── bdb-activos\                 ← (era  Documents\BDB-ACTIVOS)              APP (consume la maestra)
└── _legacy\
    ├── bdb-fondos\              ← (era  Documents\BDB-FONDOS)
    └── bdb-fondos-core\         ← (era  Documents\BDB-FONDOS-CORE)
```

> Alternativa más elaborada (la del informe maestro: `data-platform\{acquire,ingest,contracts}`): mejor sobre el papel, pero implica reestructurar dos repos en uno. **Recomiendo la simple**: mismo beneficio ("un sitio"), una fracción del riesgo.

## Pasos (los ejecutas tú; son movimientos de carpeta, git no se rompe)

1. **Backup / commit.** En cada repo: `git add -A && git commit` (o stash) lo pendiente. Opcional: ZIP de los 4 repos.
   - Atención: en `bbdd-activos-financieros` hay cambios sin commitear no relacionados (los del árbol) — decide si commitearlos o stashearlos antes de mover.
2. **Crear el padre:** `mkdir C:\Users\oanti\Proyectos\BDB`
3. **Mover cada carpeta** (Explorador o `Move-Item`), con TODO cerrado (IDE, terminales, esta app sobre esas carpetas):
   ```powershell
   Move-Item "C:\Users\oanti\Proyectos\DATOS FONDOS\fondosdb"        "C:\Users\oanti\Proyectos\BDB\fondosdb"
   Move-Item "C:\Users\oanti\Documents\BBDD-ACTIVOS-FINANCIEROS"     "C:\Users\oanti\Proyectos\BDB\bbdd-activos-financieros"
   Move-Item "C:\Users\oanti\Documents\BDB-ACTIVOS"                  "C:\Users\oanti\Proyectos\BDB\bdb-activos"
   New-Item -ItemType Directory "C:\Users\oanti\Proyectos\BDB\_legacy"
   Move-Item "C:\Users\oanti\Documents\BDB-FONDOS"                   "C:\Users\oanti\Proyectos\BDB\_legacy\bdb-fondos"
   Move-Item "C:\Users\oanti\Documents\BDB-FONDOS-CORE"              "C:\Users\oanti\Proyectos\BDB\_legacy\bdb-fondos-core"
   ```
4. **Verificar git intacto** en cada repo movido: `cd <nuevo path> ; git status` (debe verse igual que antes; mover la carpeta no afecta a git, que es relativo a la raíz del repo).

## Qué actualizar DESPUÉS (referencias a rutas absolutas)

| Referencia | Acción |
|---|---|
| **Mounts de esta app (Cowork)** | Re-seleccionar las carpetas nuevas bajo `Proyectos\BDB\`. |
| **Prompts a Codex** (`docs/PROMPT_CODEX_70*.md`) | Las rutas `C:\Users\oanti\Documents\BBDD-ACTIVOS-FINANCIEROS` y `C:\Users\oanti\Proyectos\DATOS FONDOS\fondosdb` cambian. En la práctica el loader/audit/republish toman `--input <dir>` en runtime → solo cambia el valor que pasas. |
| **IDE / workspace** | Reabrir desde el nuevo padre. |
| **`.bat` / accesos directos** (p.ej. `fondosdb\FondosDB.bat`) | Revisar rutas absolutas internas. |
| **Cloud Functions programadas** (refresco diario / métricas) | **Sin cambios**: corren en GCP, no dependen de rutas locales. |
| **Deploy de la app (Firebase hosting)** | `firebase.json` usa rutas relativas → sin cambios; solo deploya desde el nuevo path. |

## Riesgo y momento

- **Riesgo técnico bajo**: son movimientos de carpeta; git sobrevive. Lo único real es actualizar referencias de rutas absolutas (tabla de arriba).
- **Momento**: hazlo cuando **no haya carga/refresco en marcha** y con todo cerrado. Es de una sola vez.
- **No urgente**: nada de esto bloquea el uso ni los datos. Es comodidad/orden.

## Después de mover (opcional, mejora)

- Un `README.md` en `Proyectos\BDB\` que explique las 3 capas (adquirir → maestra → app) y los comandos clave (`load:fondosdb`, `republish:fondosdb`, `reclassify:stock`, `audit:consistency`).
- Mover los prompts `PROMPT_CODEX_70*` y los informes a un `docs/` común si quieres.
