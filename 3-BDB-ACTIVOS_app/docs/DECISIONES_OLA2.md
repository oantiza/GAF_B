# Decisiones de la ola 2 del rediseño · fidelidad al prototipo B″ (3 sept 2026)

Registro de la Fase 4 del encargo para la segunda ola. Motivo de la ola: lo
desplegado tras la ola 1 no era lo acordado (prototipo B″ de la Fase 2 + Plan
Ola 1). Esta ola cierra los cinco huecos identificados y vuelca cada decisión a
`GUIA_DE_DISENO_OAA.md`, `.claude/skills/diseno-oaa/SKILL.md` o
`src/styles/README.md` (columna «Volcado a»). Trazabilidad, no contrato.

Rama: `master` (las sesiones paralelas ya habían fusionado `rediseno/interfaz-oaa`).

## Huecos que cierra (acordado → implementado)

| # | Acordado (prototipo B″ / Plan Ola 1) | Lo que había en `master @ 1557046` | Ahora |
|---|---|---|---|
| G1 | Pasos **Componer · Comprobar · Optimizar · Simular** como navegación del Constructor | Pestañas «Composición / Riesgo y optimización / Simulación y análisis» (diferidas a la ola 2 en el plan y no retomadas) | Pasos implementados (`BUILDER_STEPS`), texto sobre filete con marcador acero de 3 px |
| G2 | Tabla (8) + **columna lateral (4)** con aro de reparto, renta variable por región y bloque **Estado** | Aro y mapa debajo, dentro de la pestaña Composición; sin bloque Estado | `.builder-compose` 8+4; `PortfolioSummary variant="side"`, `RegionAllocation variant="side"`, `PortfolioStatusPanel` nuevo |
| G3 | Métricas clave: Rent. 3A · Vol. 3A · Sharpe · Máx. caída · **TER medio · Rent. 5A** | Las dos últimas sustituidas por «Posiciones» y «Peso total» (ya en la cabecera) | Las seis del prototipo; TER ponderado por peso vía `evaluatePortfolioHealth` |
| G4 | Frontera: cartera actual en **ocre con etiqueta directa**, activos en acero claro, una sola línea Prusia | Gráfico reutilizado de Análisis: cartera en Prusia, marcas de Máx. Sharpe y Mín. vol., leyenda genérica | `OaaFrontierMark.labelled`, `frontierLabel`/`assetsLabel`/`assetsColor`; en `compact` solo la cartera actual |
| G5 | Composición B″ en **las nueve pantallas** | Solo el Constructor rematado; cajas en Buscador, Análisis (tarjeta verde de salud), Informe, Comprobar/Optimizar, avisos con banda | Bloques «Ola 2» al final de `modules.css`: salud sin tarjeta, avisos sin banda, secciones del informe, Buscador, rejillas, estados vacíos |

## Estética

| # | Decisión | Motivo | Volcado a |
|---|---|---|---|
| D13 | **Los avisos no llevan banda.** Todo aviso (`.notice` y los 25 alias heredados) es un filete de 3 px a la izquierda y texto en tinta secundaria. El color del filete dice el tipo: acero informa, ocre avisa, rojo bloquea, verde confirma. | Los rellenos tintados (info-soft, warning-soft, positive-soft) eran las últimas «cajas» que quedaban en pantallas por lo demás blancas; la tarjeta verde de salud del Análisis era el ejemplo más visible. | Guía §3 y §5, SKILL §3 |
| D14 | **La salud de la cartera es una sección, no una tarjeta**: título con marcador, punto de 10 px en el color del estado, titular 22/300 en Prusia, distintivo debajo y hallazgos bajo un filete. | La tarjeta de 300 px de alto con fondo verde competía con la frontera y el monitor por ser protagonista. | Guía §3 |
| D15 | **El estado vacío no es una caja punteada**: texto centrado entre dos filetes. | Coherencia con «nada de cajas». El punteado queda solo en el control de subida de fichero, donde sí señala una zona de soltar. | Guía §3 |
| D16 | En el Constructor la frontera aproximada **sigue trazada punteada** aunque el prototipo la dibujara continua. | Regla de honestidad del dato (§7: punteado = estimado); el prototipo se dibujó con datos ficticios. Está dicho en el subtítulo: «frontera aproximada». | Guía §7 |
| D17 | **Cartera actual en ocre** en la frontera del Constructor (no en Prusia como en Análisis). | La frontera es Prusia; la cartera necesita contrastar con ella y es el «dato de referencia» de la vista, papel que el ocre ya tiene como benchmark. En Análisis · avanzada se conserva la versión completa (Prusia, Máx. Sharpe, Mín. vol.). | Guía §7 |
| D18 | **Aro con cifra en el hueco** (`OaaDonutChart center`): capital en Prusia 22/300 y «N posiciones · K clases». Leyenda debajo (`layout="stack"`) cuando el aro va en columna. | Es la firma del prototipo B″ desde la Fase 2 («me gusta el aro»). | Guía §7 |
| D19 | **Mapa apilado** (`GeoDistributionMap layout="stacked"`): mapa y, debajo, tres barras por macro-zona en el color de la zona. El desglose por regiones completo se queda en Análisis. | En 4 columnas no cabe la tabla al lado del mapa; las tres barras cuentan lo que el mapa pinta. El mapa sigue viviendo en un solo componente. | Guía §7 |

## Estructura

| # | Decisión | Motivo | Volcado a |
|---|---|---|---|
| E5 | **Pasos por tarea, no por componente.** Componer (capital, frontera + métricas, tabla + lateral, aportación de capital) · Comprobar (validación, perfil, factibilidad, súper-sectores, análisis) · Optimizar (universo elegible, optimizador) · Simular (asignación táctica, backtest, comparativa). Sin posiciones solo está activo Componer. | Es lo aprobado en el prototipo; el deep-link `/cartera/optimizacion` cae en Optimizar. | Guía §2, SKILL §2 |
| E6 | **Tabla de posiciones compacta**: vehículo y clase apilados en una columna; la retrocesión (solo asesor) como segunda línea bajo el importe; candado, sustituir y quitar en una sola celda; nombre en dos líneas como máximo; barra de peso solo a partir de 1600 px cuando convive con la lateral. | En 8 columnas junto a la lateral la tabla anterior desbordaba 60 px y ocultaba las acciones. **Pérdida dicha en voz alta:** la fuente de la retrocesión pasa a texto de 11 px bajo el importe. | Guía §9 |
| E7 | **Bloque Estado** (`PortfolioStatusPanel`): pesos (solo si no cuadran), perfil (señales de riesgo del contrato), concentración (mayor posición, umbrales de `PORTFOLIO_HEALTH_RULES`) y datos (invertibles y cobertura de métricas). Remite a Comprobar; no lo sustituye. | El semáforo de la mesa de trabajo del prototipo. Reutiliza las reglas de salud existentes: no hay una tercera fuente de verdad. | Guía §3 |
| E8 | «Métricas clave» pierde «Posiciones» y «Peso total». | Ya están en la descripción de la cabecera y en la fila de capital. | — |

## Herramienta

| # | Decisión | Motivo |
|---|---|---|
| H4 | `audit:ui` cazó el desbordamiento móvil de `.builder-compose` (12 columnas × 40 px de hueco > 390 px). El hueco ancho solo se aplica desde 1181 px. | Segunda vez que la auditoría en ejecución evita un fallo que los tokens no muestran. |
| H5 | Censo `deadCssD3`: se purgan `.builder-workspace-tabs` y `.cell-entity--num` (huérfanos tras esta ola). | El censo se corre al cerrar cada ola. |

## Pendiente (no tocado en esta ola)

Fusión o distinción clara de Análisis e Informe de cliente; selector de
benchmark fuera de Analítica avanzada; títulos de página alineados con las
etiquetas del rail; secciones internas del asesor fuera del documento del
cliente; revisión del PDF con un informe generado desde la app rediseñada (D2).
