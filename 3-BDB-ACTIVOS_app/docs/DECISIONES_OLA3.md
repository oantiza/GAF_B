# Decisiones de la ola 3 del rediseño · estructura (4 sept 2026)

Registro de la Fase 4 para la tercera ola: los puntos de estructura que el
diagnóstico de la Fase 1 dejó identificados y las olas 1 y 2 no tocaron. Cada
línea está volcada a `GUIA_DE_DISENO_OAA.md`, `.claude/skills/diseno-oaa/SKILL.md`
o `src/styles/README.md` (columna «Volcado a»). Trazabilidad, no contrato.

Rama: `master`.

## Estructura

| # | Decisión | Motivo | Volcado a |
|---|---|---|---|
| E9 | **El título de la página es la etiqueta del rail.** Constructor (o el nombre de la cartera activa, con antetítulo «Cartera · Constructor»), Informe de cliente, Análisis, Extracto externo, Mercado. Se retiran «Construye tu cartera», «Análisis de cartera» ×2, «Análisis de posiciones» y «Calendario y agenda de mercado». | Diagnóstico §3: los nombres del rail no coincidían con los títulos, y había tres títulos con «Análisis» para cosas distintas. Lo que se pulsa arriba es lo que se lee debajo. | Guía §2 y §3, SKILL §2 |
| E10 | **Mercado tiene un solo nivel de pestañas**: Calendario económico · Dividendos · Resultados · Estrategia, bajo el H1. Desaparece el contenedor «Agenda» (pestañas → H1 → pestañas). `/agenda` abre Calendario. | Diagnóstico §2: dos niveles de pestañas con el título entre ambos. Las tres vistas de la agenda son hermanas de la estrategia, no hijas. | Guía §2, SKILL §2 |
| E11 | `PageHeader` admite `level="section"` (título 15/600 en Prusia con marcador) para una subvista bajo las pestañas de una página con H1 propio. Lo usa Estrategia (semanal/mensual con sus acciones). | Una subvista con acciones propias necesita cabecera, pero no un segundo H1. | Guía §3, SKILL §3 |
| E12 | **El benchmark se elige a la vista, donde gobierna**: `BenchmarkSelect` en la fila de pestañas del Análisis y entre los campos de portada del Informe. Sale de Analítica avanzada. Un solo estado (`BenchmarkContext`). | Diagnóstico §1.5: un control que gobierna dos pantallas vivía escondido en una tercera; quien generaba el PDF no sabía contra qué benchmark salía. | Guía §2, SKILL §2 |
| E13 | **El Informe de cliente separa documento y cocina.** Cabecera de página + fila de portada (cliente, responsable, correo, benchmark, «Generar informe») + `.report-document` (lo que recibe el cliente) + `<details class="report-internal">` «Solo asesor» plegado con Diagnóstico de datos y Trazabilidad, inexistente en modo cliente. Fuera el «Volver a cartera». | Diagnóstico §1.3: secciones internas del asesor dentro de lo que se presenta como documento del cliente; el rail ya navega. **Pendiente dicho en voz alta:** las columnas «Límites» y «Calidad del dato» de la tabla de posiciones siguen dentro del documento (solo asesor, no salen en el PDF); se mueven al bloque interno cuando se revise el PDF con la app rediseñada. | Guía §3 |
| E14 | Análisis e Informe quedan **distintos por título y por propósito** (Análisis = radiografía de trabajo con pestañas; Informe = vista previa del documento con su portada), no fusionados. | La fusión habría mezclado la herramienta con el documento; la distinción clara resuelve la confusión del diagnóstico sin perder la vista previa fiel. | Guía §2 |

## Estética

| # | Decisión | Motivo | Volcado a |
|---|---|---|---|
| D20 | **La frontera eficiente se traza continua** también cuando es aproximada (revisa D16). Que es estimada lo dicen el distintivo de calidad del dato («Aproximada») y el subtítulo; el punteado queda para proyecciones y escenarios. | Decisión de Oscar («frontera continua») al ver la ola 2: el trazo punteado leía como dato incompleto, no como método. | Guía §7 |

## Herramienta

| # | Decisión | Motivo |
|---|---|---|
| H6 | Las constantes de pestañas de Mercado viven en `src/pages/mercadoTabs.ts` (módulo sin componentes). | `react-refresh/only-export-components`: un fichero de página no exporta constantes. |
| H7 | Censo `deadCssD3`: purgado `.xray-benchmark-select`. Los huérfanos `ui-dialog--*` y `ui-menu__list--*` son dinámicos y preexistentes. | El censo se corre al cerrar cada ola. |

## Pendiente (no tocado en esta ola)

Revisión del PDF de cliente con un informe generado desde la app rediseñada
(D2, ola 1) y, con ella, mover Límites/Calidad del dato al bloque interno;
nada más: la frontera queda continua (D20).
