# Cierre — Plan Interfaz v2 (F1–F6)

Fecha de cierre: 2026-07-12

Estado: **DESPLEGADO Y VERIFICADO**

## Alcance cerrado

| Fase | Entrega | Estado |
| --- | --- | --- |
| F1 | Menú en seis secciones, Inicio/Mapa del programa, deep-links del Constructor y chip de cartera activa. | Desplegado |
| F2 | Estado del sistema para administradores, con semáforo, frescura y estado de backup. | Desplegado |
| F3 | Comparador patrimonial: Letras, depósito, rentabilidad real por flujo e impuesto progresivo Bizkaia. | Desplegado |
| F4 | Auto-completar cartera y «Ver todos» en el comparador. | Desplegado |
| F5a | Contribución al riesgo por posición y escenarios de estrés histórico. | Desplegado |
| F5c | Salud de cartera, comparación antes/después, modo cliente e historial de Cartera Real. | Desplegado |
| F5d | Curva spot Svensson del euro (AAA y todos los bonos de gobierno) en Agenda de mercado. | Desplegado |
| F6 | Deploy conjunto, comprobación de rutas, backup final y este acta de cierre. | Completado |

## Verificación final

Realizada el 2026-07-12 sobre el árbol final desplegado:

| Suite | Resultado |
| --- | --- |
| `python -m pytest functions_python/tests` | **248 passed** |
| `npm run test` | **65 archivos, 405 tests passed** |
| `npm run typecheck` | **Correcto** |
| `npm run build` | **Correcto**; presupuesto inicial: JS 106,9 KiB gzip y CSS 37,3 KiB gzip |
| Rutas de producción | **HTTP 200**: `/`, `/inicio`, `/sistema`, `/xray`, `/cartera`, `/agenda` |

## Funciones desplegadas y ampliadas

Las siguientes funciones relevantes aparecen en estado `ACTIVE` en `europe-west1` con runtime `python312`:

- Nuevas: `get_system_status`, `get_euro_yield_curve`, `save_real_analysis`, `list_real_analyses`, `delete_real_analysis`.
- Ampliadas: `get_macro_reference`, `optimize_portfolio` y `backtest_portfolio`.

## Backup final

- Directorio verificado: `C:\Users\oanti\Proyectos\BDB\2-plataforma-datos\data\backups\2026-07-12T08-49-47-251Z`.
- Resultado: `verification: PASS`.
- Firestore: 15.072 documentos; Firebase Auth: 1 usuario.
- Se actualizó `meta/backup_status` mediante `BDB_BACKUP_WRITE_STATUS_DOC=true` solo tras la verificación PASS.

## Pendientes

- No quedan pendientes funcionales de F1–F5d.
- Existe un directorio de backup incompleto, `2026-07-12T08-50-56-883Z`, generado por una ejecución interrumpida antes de `manifest.json` y `summary.json`; no se considera backup válido. Se conserva para diagnóstico.
