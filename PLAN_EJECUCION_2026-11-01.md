# Plan de ejecución

> **Estado a 04-11-2026:** la aplicación está en producción sobre la base nueva. Este documento es registro de cómo se planificó y varias cifras y pendientes están superados. Lo que queda está en [el informe de cierre](https://claude.ai/artifact/VHoLhhQE7SNhzMPe4S4kwv).

Plan detallado de la fase de independencia: todas las tareas, el tiempo estimado y el reparto.
Pedido por Oscar el 01-11-2026 **antes de ejecutar nada**. Se apoya en
`PLAN_INDEPENDENCIA_2026-11-01.md`, que dice *qué* hay que cortar; esto dice *cómo, en qué orden
y en cuánto*.

## Lo primero: la decisión de las acciones es mucho más barata de lo que avisé

Oscar decidió meter acciones desde el principio, contra mi recomendación. Lo medí antes de
planificar y **mi aviso era demasiado pesimista**. Las 73 acciones que ya están en el universo
del extractor llevan hoy:

| qué llevan | ejemplo medido (`DE0005140008`, Deutsche Bank) |
|---|---|
| Identidad completa | ticker `DBK`, mercado XETRA, país, divisa, símbolo EODHD, **sector e industria** |
| Precio | 30,835 EUR al 17-07-2026 |
| **Nuestras métricas** | volatilidad 1a/3a/5a, Sharpe, tipo libre de riesgo, caída máxima −46,36 % |
| **Historia de precios** | **8.209 observaciones desde el 01-02-1994** |

La consecuencia cambia el plan: **una acción no necesita fundamentales para servir** al análisis
de riesgo, a la comparación ni a la construcción de carteras. Los fundamentales hacen falta para
las pantallas de análisis fundamental, que son otra cosa. Así que el programa de fundamentales
—lo que yo puse como bloqueante— pasa a ser **separable y último**.

Lo que de verdad falta para las acciones:

- Un contrato `declared` con forma de acción. Los doce documentos de hoy tienen forma de fondo:
  `costs` (TER), `holdings`, `distributions`, `exposure`. Ninguna acción ha entrado en la base
  nueva: los 772 instrumentos son fondos y ETF.
- **239 ISIN por registrar**: la base vieja tiene 312 acciones y el universo del extractor, 73.
- Un refresco: los datos de las 73 son del **17-07-2026**, tres meses y medio viejos.

## Las fases

### F0 · Cimientos: el proyecto propio

| | tarea |
|---|---|
| F0.1 | Decidir id y puertos del proyecto nuevo |
| F0.2 | Persistencia: `exportOnExit` y arranque con `--import`, **verificada parando y arrancando el emulador** |
| F0.3 | Ampliar la allowlist de proyecto sin perder la barrera, con su test |
| F0.4 | Apuntar el escritor de la base nueva al proyecto nuevo |
| F0.5 | `arrancar-entorno` al día: puertos, siembra y criterios de verificación |

**3–4 h** · una sesión · riesgo bajo · toca `2-plataforma-datos` y `firebase.json`

### F1 · La acción como instrumento

| | tarea |
|---|---|
| F1.1 | Diseñar qué `declared` tiene una acción |
| F1.2 | Escribir el contrato y sus comprobaciones |
| F1.3 | Mapear las 73 que ya tienen ficha |
| F1.4 | El `read/card` de una acción |
| F1.5 | Decidir el `risk_score` de las acciones |

**5–7 h** · una sesión · riesgo medio: F1.1 y F1.5 necesitan decisión de Oscar · `2-plataforma-datos`

### F2 · Las 239 que faltan, y el refresco

| | tarea |
|---|---|
| F2.1 | Sacar la lista de ISIN de las 312 de la base vieja — **la lista, no el dato** |
| F2.2 | Registrar en el universo las 239 que faltan |
| F2.3 | Pasada de acciones: serie y métricas |
| F2.4 | Mapear las 312 a la base nueva |

**3 h de trabajo más una pasada desatendida de 2–4 h** · una sesión · riesgo bajo · `1-extractor`

### F3 · El dato re-originado

| | tarea |
|---|---|
| F3.1 | Las carteras nacen de cero |
| F3.2 | `commercial_retro`: decidir y trasladar |
| F3.3 | **La composición completa de los fondos** |
| F3.4 | Verificar que nada del proyecto nuevo viene de la copia de BDB |

**6–8 h** · una sesión · riesgo medio-alto · `2-plataforma-datos`

F3.3 es la mayor parte y la más delicada: hay que decidir dónde viven hasta 1.818 posiciones por
fondo sin volver al techo del megabyte que ya tuvo la base vieja, donde un documento de carteras
llegó a 629 KB.

### F4 · El frontend sobre su propio proyecto

| | tarea |
|---|---|
| F4.1 | El camino de lectura: `read/card` directo, sin Functions cruzadas |
| F4.2 | Eliminar `MASTER_PROJECT_ID` |
| F4.3 | Las pantallas de acción frente a las de fondo |
| F4.4 | Resolver lo que la app muestra y la base nueva no tiene |
| F4.5 | La limpieza del SRI, ya medida y sin empezar |

**10–14 h** · una o dos sesiones · **riesgo alto, y la estimación más débil del plan** · `3-BDB-ACTIVOS_app`

Es la más débil porque el 01-11 **no se tocó ni una línea de la app**: cero commits ahí. No tengo
velocidad medida.

### F5 · Retirar la red

| | tarea |
|---|---|
| F5.1 | `export_bdb/` |
| F5.2 | loader, republish y audit hacia la maestra |
| F5.3 | El gate `BDB_DATA_PLATFORM_ENABLE_MASTER_WRITES` |
| F5.4 | La siembra desde la copia de BDB |
| F5.5 | Las colecciones `_*` y lo que no se conserva |

**3–4 h** · una sesión · riesgo bajo pero **irreversible en la práctica**: va la última y solo con
F4 verificado · los tres repositorios

### F6 · Fundamentales (separable, y por eso al final)

| | tarea |
|---|---|
| F6.1 | Decidir de qué documentos primarios sale cada campo de la **fuente propia** |
| F6.2 | Adaptador de fundamentales en el registro del extractor |
| F6.3 | Contrato y mapeo |
| F6.4 | Las pantallas de análisis fundamental |

**8–12 h, con la incertidumbre más alta del plan** · una sesión · `1-extractor` y la app

**F6.1 son treinta minutos y es la primera medición que hay que hacer de todo el plan.** Hoy
ningún adaptador del extractor aplica a acciones: los dos positivos son `tipo == "etf"` y
`tipo == "fondo"`, y cuatro las excluyen con `tipo != "accion"`.

**Rehecha dos veces el 01 y el 02-11-2026, y la segunda la cierra.** Aquí ponía «medir la
cobertura de EODHD para acciones europeas». Esa pregunta no era la buena por dos motivos que
aparecieron después, en este orden:

1. La decisión de la fuente ya se había tomado una vez en BDB —fundamentales **solo de Yahoo**,
   EODHD solo para símbolo y cotizaciones—, así que F6.1 pasó a medir Yahoo.
2. **Óscar decidió el 02-11 construir una fuente propia desde el extractor**, y eso retira las
   dos. No se mide la cobertura de un proveedor: se decide de qué documento primario sale cada
   campo y se construye.

Y hay una medición que explica por qué ninguna de las dos servía: **71 de las 73 acciones ya
traen la ficha de fundamentales entera** —PER, capitalización, márgenes, ROE—, pero son de
EODHD, de julio, y esos fundamentales se dieron de baja el 17-10. Había cobertura; lo que no
había era una fuente vigente.

**Decisión de interinidad, tomada el 02-11:** hasta que exista la fuente propia **no se mapea
ningún fundamental**, ni de EODHD ni de Yahoo. El hueco del contrato se queda declarado y vacío,
y la ficha dice que el dato no está, que es la regla de la casa. El motivo es de coste, no de
pureza: mapear ahora significaría escribir cientos de documentos con la procedencia de una
fuente que ya está decidido sustituir, y decidir campo a campo qué se pisa cuando llegue la
buena.

**Y la interinidad no protege tanto como su nombre sugiere, que es lo que hay que saber antes
de construir la fuente.** «No se mapea ningún fundamental» se refiere al **bloque de destino**,
y es cierto: no existe. Pero el bloque de **dividendos**, que sí se mapea y que la interinidad
mantiene, sale de esa misma sección de la ficha — `mapper.ts:1423` lee
`universal['fundamentales']`, y de ahí salen `dividends`, `per_share`, `dividend_yield_pct` y
`currency`.

La consecuencia, medida en la base: los dividendos que un asesor ve hoy para una acción llevan
`as_of` de **17-07-2026** y vienen de los fundamentales de EODHD que se dieron de baja el 17-10.
Dos ejemplos leídos: Deutsche Bank con rendimiento 3,16 % y Total con 2,58 %, los dos fechados
en julio. Son 72 de 73 acciones con dividendos publicados.

Así que **la fuente propia no entra en un hueco vacío: entra en uno lleno y ya publicado**. El
día que sustituya esa sección, el bloque de dividendos cambia de origen aunque nadie toque el
mapeo de dividendos. Eso no se descubre leyendo el contrato de dividendos, porque el contrato no
dice de qué sección de la ficha se llena.

Un detalle que conviene mirar entonces y no antes: el `source` de ese bloque dice
`canonical:fondosdb`, que nombra **nuestra tubería**, no a quién afirma la cifra. Es coherente
con el resto de bloques y no es una mentira —el proveedor original vive en `meta.procedencia`
del canónico—, pero en un bloque `declared` la pregunta es quién lo declara, y eso no lo
contesta.

**Lo que la fuente propia necesita del contrato, y conviene escribirlo antes que el código:** el
agujero que F1 dejó anotado —que nada puede declarar que una fuente **no** es oficial— deja de
ser el problema, porque una fuente nuestra no es «no oficial», es de otra clase: calculada por
nosotros desde documentos primarios, igual que las métricas. Es la misma distinción que ya
sostiene `COMPUTED` frente a `PROVIDER` en las métricas, y el contrato de fundamentales debería
nacer con ella en vez de heredar la de un proveedor.

## Totales

| | trabajo de sesión | días reales |
|---|---|---|
| Todo, F6 incluido | **38–52 h** + 2–4 h desatendidas | **4 a 6 días** |
| Sin F6 | **30–40 h** | **3 a 4 días** |

Qué está calibrado y qué no: los tiempos de plataforma y extractor salen de lo medido el 01-11
—36 commits en tres repositorios, 31 contratos, el mapeador, el escritor, el registro de proxies
y 11.854 documentos escritos y verificados, en unas diez horas—. El de la app no está calibrado.

## La forma más eficiente

**El reparto no lo decide lo que se puede paralelizar: lo decide quién escribe en qué fichero.**
Dos sesiones nunca tocan los mismos. Los tres repositorios son conjuntos disjuntos, y esa es la
línea natural de corte.

| ola | en paralelo | repositorios |
|---|---|---|
| 1 | F0 cimientos · **F6.1** la medición de fundamentales | plataforma · extractor |
| 2 | F1 la acción como instrumento · F2 las 239 y el refresco | plataforma · extractor |
| 3 | F3 el dato re-originado · F4 el frontend | plataforma · app |
| 4 | F5 retirar la red | los tres, en una sola sesión |
| 5 | F6 fundamentales, si F6.1 lo avala | extractor y app |

**Cada herramienta para lo suyo:**

- **Subagentes** para lo que solo lee: medir cobertura, auditar, buscar por los tres
  repositorios. Devuelven el resultado dentro del turno y no commitean nada. Ahí sí conviene
  lanzar varios a la vez.
- **Sesiones** para lo que acaba en commits: una por repositorio y ola.
- **Bifurcaciones** solo cuando una sesión necesita esta conversación entera. Si el trabajo es
  autocontenido, sale más barata una sesión nueva con un encargo escrito.

**Y el cuello de botella medido hoy no es el cómputo: es la decisión.** El día se paró
repetidamente esperando una respuesta de Oscar, que decide desde el móvil. Cuatro sesiones en
paralelo producen cuatro preguntas simultáneas, y eso es más lento, no más rápido. De ahí la
recomendación de **dos sesiones a la vez como máximo**, con las decisiones agrupadas por
adelantado.

## Las seis decisiones que, contestadas antes, ahorran el día

| decisión | sin ella se para | recomendación |
|---|---|---|
| ¿Qué enseña la ficha de una acción? | F1.1 | Identidad, sector, mercado, precio y nuestras métricas. Los fundamentales, cuando existan |
| ¿El `risk_score` 1–7 de las acciones entra? | F1.5 | **No.** No viene de ningún KID: se calculó con un cubo de volatilidad y se archivó como si fuera regulatorio |
| ¿Dónde vive la composición completa de un fondo? | F3.3 | Subcolección `positions`, un documento por posición, no una lista dentro del documento |
| ¿Se conserva `commercial_retro`? | F3.2 | **Sí**: 376 documentos de retrocesiones son dato de negocio |
| ¿Las carteras nacen de cero? | F3.1 | **Sí.** Son «Prueba 30» y similares, una con los pesos al 181,25 % |
| ¿F6 entra en esta fase o en la siguiente? | la ola 5 | La siguiente. Deja de ser «medir un proveedor» y pasa a ser construir la **fuente propia** que decidió Óscar el 02-11 |

## Lo que no hace falta decidir, porque ya está medido

- Proyecto propio funciona; una base con nombre dentro del mismo proyecto, también (probado
  escribiendo, leyendo y borrando en `databases/prueba-base-nueva` sin tocar `(default)`).
- La persistencia **no viene gratis** con la separación: es trabajo aparte (F0.2).
- La allowlist se **amplía**, nunca se vacía ni se retira antes que F5.
- `export_bdb/` y el loader son la red: se retiran los últimos.
