# Decisiones de la ola 1 del rediseño · dirección B″ (3 sept 2026)

Registro de la Fase 4 del encargo: **toda decisión tomada durante la ola sobre
algo que la guía no cubría o cubría de otro modo**, con su motivo. Al cerrar la
ola, cada línea se ha volcado a `GUIA_DE_DISENO_OAA.md`, a
`.claude/skills/diseno-oaa/SKILL.md` o a `src/styles/README.md` (columna
«Volcado a»). Este fichero es la trazabilidad, no el contrato.

Rama: `rediseno/interfaz-oaa` (avanzada por fast-forward hasta `master @ 7884b13`).
Dirección elegida por Oscar sobre el prototipo de la Fase 2 (variante B″).

## Estética

| # | Decisión | Motivo | Volcado a |
|---|---|---|---|
| D1 | **Fuera el serif en pantalla.** Newsreader, Instrument Sans y Spline Sans Mono se sustituyen por **IBM Plex Sans** (300/400/500/600) e **IBM Plex Mono**. `--font-serif` se retira del sistema con sus 18 usos. | El serif aparecía en el H1 y en 4-6 cifras por pantalla: una plantilla con la fuente del título cambiada, no una identidad. El énfasis lo dan ahora el tamaño y el peso 300. | Guía §8, SKILL §6 |
| D2 | **El PDF conserva su voz**: Fraunces + Roboto Flex, papel crema, filetes bronce y acento granate (`src/reports/pdfTheme.ts`). | La divergencia pantalla/papel deja de ser un accidente y pasa a ser deliberada: la herramienta es Prusia, el documento del cliente es papel. Se revisa al cerrar la ola 2 con un informe generado desde la app rediseñada. | Guía §14, SKILL §6 |
| D3 | **Ocre `#B9862F` sustituye al cobre `#B66A3C`** como serie 2, benchmark y aviso. Los tokens pasan de `--copper-*` a `--ochre-*`. | El cobre convivía mal con el Prusia (dos cálidos compitiendo); el ocre separa mejor y valida CVD contra la serie 1 y la 3. Para texto se usa `--ochre-55 #8F6A22` (5,0:1); `#B9862F` (3,4:1) solo en trazos, rellenos y filetes. | Guía §5 y §7, SKILL §4 |
| D4 | **Ángulos rectos**: `--radius-*` a 0 (salvo `--radius-pill`, que sigue en los interruptores). | El radio 4 era el único gesto «producto SaaS» que quedaba en una interfaz por lo demás editorial. Los tokens siguen existiendo: un solo cambio los recupera. | Guía §3, SKILL §1 |
| D5 | **Rótulos sin versalitas.** Se retiran las 49 declaraciones `text-transform: uppercase` y su `letter-spacing`; los rótulos pasan a 12/500 en tinta secundaria. Tres literales en mayúsculas del JSX se reescriben en caja normal. | Antetítulo, rótulo de KPI, cabecera de tabla, título de columna y pestaña usaban el mismo recurso: cuando todo grita, nada destaca (diagnóstico de la Fase 1, eje estética §5.3). | Guía §3 y §8, SKILL §6 |
| D6 | **Se borra la capa 7 `oaa-bands.css`.** Las 21 cabeceras de módulo y `.panel__head` pasan a: título 15/600 en Prusia, filete de 1 px y **marcador de 36×2 px en acero**. Desaparecen los 7 acentos por familia y el mapa de `--band-inset`. | Ocho bandas pizarra por pantalla leían como ocho mini-rails de igual peso, y el color del filete codificaba una familia que nadie podía decodificar. El sistema vuelve a 6 hojas. | Guía §4 (reescrita), README de estilos |
| D7 | **Panel y KPI dejan de ser cajas.** `.panel`, las 30 superficies de `modules.css` y `.ui-kpi` pierden borde, fondo y radio; separan por espacio, título y filete. El borde queda para campos, tablas (filetes horizontales) y diálogos. | 19 cajas con borde en Análisis y más de 25 en Riesgo: caja dentro de caja dentro de caja, sin sitio donde descansar la vista. | Guía §3, SKILL §3 |
| D8 | **Shell en L oscura**: rail y barra superior en Prusia oscuro `#0F2D4A`; el ítem activo del rail es un bloque blanco a sangre con tinta Prusia y marcador de 3 px en acero. | Da temperatura y enmarca el lienzo blanco sin añadir masas de color dentro del contenido. | Guía §5, SKILL §2 |
| D9 | **La cifra grande lleva color**: `.ui-kpi__value` en Prusia 28/300. Verde y rojo quedan para rentabilidad y caída, donde el signo significa algo. | Con todas las cifras en tinta neutra, la pantalla se leía «floja» (observación de Oscar sobre el prototipo). | Guía §6 y §8 |
| D10 | **Mapa geográfico por macro-zona con la paleta B″**: América Prusia, Europa/O. Medio/África ocre, Asia teal; intensidad por peso (mezcla a blanco 75/50/25/0 %). | Coherencia con el reparto por clase; el mapa y sus barras hablan el mismo color. | Guía §7 |
| D11 | **Barra de peso en la fila de la tabla** (72×6 px, acero, escalada al mayor peso de la cartera; oculta por debajo de 1180 px). | El reparto se lee en la propia tabla sin saltar al aro. | Guía §9 |
| D12 | Los **distintivos sobre la barra oscura conservan su relleno claro**; solo se refuerza el borde. | El primer intento (tinta clara sobre relleno translúcido) cayó a 1,45:1 y lo cazó `audit:ui`: el contraste se mide contra el relleno del propio distintivo, no contra la barra. | SKILL §9 |

## Estructura

| # | Decisión | Motivo | Volcado a |
|---|---|---|---|
| E1 | **La cartera activa tiene nombre.** Campo `name` opcional y retrocompatible en `current-portfolio.v1`; se edita en la fila de capital del Constructor, titula la página y lo muestra el chip de la barra superior en todas las pantallas. Al cargar una cartera guardada se hereda su nombre. | En ninguna pantalla se veía de quién era la cartera cargada: raíz de la sensación de «¿dónde estoy?» (Fase 1, eje estructura §1.6). | Guía §2, SKILL §3 |
| E2 | **Una sola puerta de optimización.** Se retira `SharpeMaximizerModal` (cálculo local con correlaciones supuestas) y su entrada «Maximizar Sharpe»; `BacktestComparison` conserva la comparación pero ya no aplica pesos; el vocabulario queda en «Optimizar» + «Máx. Sharpe» como nombre de la cartera de referencia. | Cinco maneras de optimizar con cinco nombres distintos, tres de ellas aplicando pesos por caminos distintos. **Pérdida dicha en voz alta:** desaparece el maximizador local (su «Sharpe proyectado» no era comparable con la frontera histórica que se veía al lado). | Guía §2, SKILL §2 |
| E3 | **Frontera eficiente y métricas clave encima de la cartera** (8+4), en el Constructor. `FrontierPanel` sale de `XrayAdvanced` y se monta una sola vez, en modo `compact` (solo el gráfico y su nota; sin tarjetas de propuesta, que pertenecen al optimizador). La tira «Resumen» de la pestaña Composición desaparece: la absorben las métricas clave. | La frontera es el gráfico protagonista de la mesa de trabajo, y las cifras deben verse sin abrir una pestaña. **Pérdida dicha en voz alta:** Análisis · Analítica avanzada se queda sin la frontera de solo lectura; vuelve en la ola 2 si se echa en falta. | Guía §3 |
| E4 | En modo `compact` la frontera **no pide la histórica**: se queda en la aproximada. | La histórica trae su propio flujo de propuesta y aplicación; en el Constructor eso es el optimizador (E2). | — |

## Herramienta

| # | Decisión | Motivo |
|---|---|---|
| H1 | **`audit:ui` restaurado** (`scripts/auditInterfaz.mjs`, 11 rutas × 3 anchos): desbordamiento, contraste medido en ejecución contra el fondo pintado real, tamaño mínimo, nombre accesible, etiquetas de campo, un solo h1 y errores de consola. **Sale con código 1 con un solo hallazgo.** | El cambio de paleta no se puede validar leyendo tokens. Cazó D12 el mismo día. |
| H2 | `scripts/deadCssD3.mjs` deja de apuntar a `/root/audit/app` y usa el directorio del proyecto (`CSS_AUDIT_ROOT` para apuntar a otro árbol). | La ruta absoluta era del entorno de auditoría del 25-08: el censo no corría en ninguna otra máquina. |
| H3 | El smoke del informe localiza el capital **por etiqueta accesible**, no por `.portfolio-capital-input input`. | Con el campo de nombre en la misma fila, el selector de clase resolvía a dos elementos. |

## Pendiente para la ola 2

Lo que este encargo dejó identificado y esta ola no toca: fusión (o distinción
clara) de Análisis e Informe de cliente, que hoy comparten título literal;
pestañas del Constructor por paso de trabajo (Componer · Comprobar · Optimizar ·
Simular) en vez de por componente; el mapa geográfico en un solo sitio; el
selector de benchmark fuera de Analítica avanzada, donde gobierna dos pantallas
que no lo ven; los títulos de página alineados con las etiquetas del rail; y las
secciones internas del asesor («Control interno», «Trazabilidad») fuera de lo que
se presenta como documento del cliente.
