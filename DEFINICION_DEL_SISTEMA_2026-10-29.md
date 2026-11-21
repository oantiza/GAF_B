# Definición del sistema

*Escrita el 29-10-2026. Todas las cifras de este documento están medidas sobre la
base de datos de este proyecto, no copiadas de documentación anterior.*

*Este documento fija **lo que el sistema hace hoy**, en presente. Modificar y mejorar
lo que hace y cómo lo hace es uno de los objetivos del proyecto: se definirá paso a
paso y fuera de aquí. Esta hoja es la línea base contra la que se medirá ese objetivo.*

---

## 1. Qué es

Un sistema de tres partes que convierte datos públicos y comerciales de productos
financieros en material con el que un asesor de inversión trabaja y responde ante
un cliente.

No es una base de datos con una interfaz encima. Es una cadena con tres eslabones
que hacen cosas distintas y que pueden fallar de maneras distintas:

> **adquirir** un dato de una fuente externa →
> **gobernarlo** hasta que sea fiable y trazable →
> **usarlo** para analizar, construir y documentar

El sistema es monousuario de hecho (un asesor, Oscar), aunque la base de datos
guarda el trabajo separado por identidad de usuario.

## 2. La regla que gobierna el sistema

Todo lo demás se deriva de esto: **un número que ve un cliente no se inventa
nunca.** Si un dato no está, el sistema dice que no está.

Esa regla no es un principio decorativo, está construida en el código de las tres
partes:

- El extractor tiene un comando dedicado a medir su propia calidad (`calidad`) y
  otro a contrastar sus métricas contra las de un tercero (`contraste`).
- La plataforma de datos distingue *crear* de *actualizar* y exige una variable de
  entorno explícita para escribir en la maestra. La auditoría de consistencia se
  **niega** a ejecutarse si esa puerta está abierta.
- El programa etiqueta como `PREVIEW_ONLY` toda cifra que haya calculado él mismo
  con aproximaciones, y enumera por escrito sus limitaciones en lugar de
  presentarla como oficial. Un informe sin capital declarado imprime «N/D» y base
  100, no una valoración de 100.000 € que nadie ha dado.

## 3. Las tres partes

### 3.1 El extractor — `1-extractor` (Python)

**Qué es:** la boca del sistema. Lo único que habla con el mundo exterior.

**Qué hace:** descarga, normaliza y deja en disco un conjunto de ficheros
canónicos por activo, más un paquete de exportación listo para cargar.

Fuentes que sabe leer (`fetchers/`):

| Fuente | Qué aporta |
|---|---|
| CNMV (XML oficiales y ficha) | registro y datos regulatorios españoles |
| Morningstar (y su variante *lt*) | clasificación, rentabilidades, cartera |
| EODHD | series de precios y datos de mercado |
| AMF GECO | registro francés |
| CSSF | registro luxemburgués |
| ESMA | registro europeo |
| GLEIF | identificación de entidades (LEI) |
| JustETF | datos de ETF |
| OpenFIGI (`core/figi.py`) | identificador global de instrumento |
| Gestoras y KID de gestora | ficha y documento de datos fundamentales |
| `vl_fondos` | valor liquidativo |

**Su pipeline, que es manual y tiene un orden obligatorio:**

```
update → calidad → export → bdb → (loader/republish) → audit:consistency
```

No se mezclan artefactos de fechas distintas. Los informes de calidad hay que
re-ejecutarlos tras cada `update` masivo, porque el cargador los consume.

**Comandos** (`main.py`): `add`, `update`, `cnmv`, `calidad`, `figi`, `export`,
`bdb`, `report`, `cobertura`, `contraste`, `capacidades`, `reclasifica`,
`corrige`, `visor`, `ops`, `ops-token`.

**Una pieza que no es obvia:** `ops_server.py` levanta un servicio HTTP local en
`127.0.0.1:8766`, protegido por token, que el programa consume desde
*Sistema › Operaciones*. Permite lanzar alta, extracción y correcciones desde la
interfaz en lugar de la consola. Solo escucha en loopback y solo existe en
desarrollo: la versión publicada no puede alcanzarlo.

### 3.2 La base de datos — `2-plataforma-datos` (TypeScript) + Firestore

Aquí conviven dos cosas que conviene no confundir: **el almacén** (Firestore) y
**su gobierno** (la plataforma de datos en TypeScript). La segunda es la única que
tiene permiso para escribir en el primero.

**El almacén.** En este proyecto es `gestor-activos-local`, un emulador de
Firestore sembrado desde una copia verificada. 15 colecciones raíz y 25.394
documentos, más un artefacto aparte con 18 usuarios de autenticación.

El corazón es `assets`, con 1.097 activos y sus subcolecciones:

```
assets/{isin}                        1.097   el activo: identificadores,
                                             clasificación, producto, cotizaciones,
                                             fundamentales, calidad, procedencia
  ├─ price_series/{id}              19.278   serie histórica de precios
  ├─ metrics/{id}                    2.145   métricas calculadas (incl. latest)
  ├─ holdings/{id}                     775   cartera del fondo
  │    └─ chunks/{id}                   96   cartera troceada cuando es grande
  ├─ fund_profile/{id}                 752   ficha del fondo
  └─ listings/{id}                       9   cotizaciones alternativas
                                    ───────
                                     24.152
```

El resto de colecciones son gobierno, no contenido: `meta` (10 documentos, entre
ellos los semáforos de integridad y de copia de seguridad), `ingestion_runs` (31,
trazabilidad de cada carga), `commercial_retro` y `commercial_retro_imports` (380,
retrocesión comercial), `bdb_activos_reports` (40, informes publicados),
`_archived` y `_archived_assets` (429, archivo), seis colecciones de auditoría de
reparaciones (321) y `bdb_activos` (31), que es el trabajo del asesor y se explica
en §4.

**El gobierno.** La plataforma de datos valida contra contratos y esquemas
declarados, normaliza, mapea, carga y audita. Sus reglas duras:

- El cargador es **create-only**: para actualizar un activo existente hay que pasar
  por `republish`. No hay sobrescritura accidental.
- Escribir en la maestra exige una **variable de entorno explícita** con un valor
  que hay que teclear entero. La auditoría de consistencia se niega a correr si
  está puesta.
- `metrics/latest` tiene **propiedad compartida y declarada**: el refresco del
  programa posee `max_drawdown_hist`, `last_date` y `updated_at`; el cargador posee
  el resto y está obligado a preservar los tres primeros. Romper esto reabre un
  ping-pong entre escritores.
- Tras cada escritura, el índice de búsqueda se reconcilia solo.
- Copia de seguridad, retención y **ensayo de restauración** son comandos de primera
  clase (`backup:export`, `backup:retention`, `backup:restore-drill`). El ensayo
  restaura y verifica documento a documento, y da `PASS` solo con cero
  discrepancias.

**Cobertura real de los 1.097 activos** (765 fondos, 312 acciones, 19 ETF, 1 otro):

| | activos | cobertura |
|---|---|---|
| serie de precios | 1.091 | 99,5 % |
| métricas | 1.093 | 99,6 % |
| holdings (cartera del fondo) | 775 | 70,6 % |
| perfil de fondo | 752 | 68,6 % |

Las dos primeras filas son casi completas. Las dos últimas lo son prácticamente
del todo **si se cuentan solo fondos**: 775 y 752 sobre 765 fondos más 19 ETF. Las
acciones no tienen cartera subyacente ni ficha de fondo porque no les corresponde.

### 3.3 El programa — `3-BDB-ACTIVOS_app` (React 19 + Vite + Cloud Functions)

**Qué es:** la herramienta de trabajo del asesor. Dos mitades:

- **Interfaz**, React 19 sobre Vite. Escritorio y tablet, ancho mínimo 768 px. No
  hay versión de móvil, y es una decisión de producto, no un defecto.
- **Backend**, Cloud Functions en Python (992 líneas en `main.py`): 39 funciones
  invocables y 9 tareas programadas.

Lo que hace está en §4.

### 3.4 Cómo encajan

```
  FUENTES EXTERNAS
  CNMV · Morningstar · EODHD · AMF · CSSF · ESMA · GLEIF · JustETF · OpenFIGI
        │
        │  1-extractor (Python, manual, con orden obligatorio)
        │  update → calidad → export → bdb
        ▼
  export_bdb/  (paquete de ficheros canónicos)
        │
        │  2-plataforma-datos (TypeScript)
        │  contratos → validación → normalización → carga/republicación → auditoría
        ▼
  FIRESTORE  ·  la maestra  ·  15 colecciones  ·  25.394 documentos
        │                                    ▲
        │  Cloud Functions (Python)          │  tareas programadas:
        │  leen la maestra y calculan        │  precios, métricas, integridad,
        ▼                                    │  índice, informes
  INTERFAZ (React)  ──── escribe su propio trabajo en bdb_activos/{uid} ──┘
```

Tres cosas que este dibujo deja ver y que son fáciles de olvidar:

1. **El extractor no toca Firestore.** Deja ficheros. Quien escribe es la
   plataforma de datos, y solo con la puerta abierta a mano.
2. **La interfaz no lee la maestra directamente.** Pasa siempre por Cloud
   Functions, que la leen como proyecto *cruzado*. De ahí que `MASTER_PROJECT_ID`
   sea la barrera de aislamiento más delicada de este clon.
3. **El sistema se vigila a sí mismo.** Las tareas programadas refrescan precios y
   métricas, comprueban integridad, reconcilian el índice y publican informes. El
   resultado queda en semáforos dentro de `meta`, visibles en
   *Sistema › Estado del sistema*.

## 4. Qué hace el programa

Diez destinos en cinco secciones. La regla de organización es que **un destino
pertenece al grupo de la entidad sobre la que trabaja**, no al de la herramienta
que usa.

### Mercado
Calendario económico, dividendos, resultados y estrategia, en un solo nivel. Más
referencia macro: tipos del BCE y curva de tipos del euro.

### Activos
- **Buscador** — busca sobre el universo de 1.097 activos y abre la ficha de uno:
  identificación, clasificación, producto, métricas, cartera subyacente, serie.
- **Comparador** — enfrenta varios activos campo a campo, con catálogo de
  columnas elegible y exportación a PDF.

### Cartera
El grupo con más maquinaria del sistema.

- **Diseño de cartera**, en cuatro pasos: *Componer* (posiciones y pesos),
  *Comprobar* (concentración, solapamiento, correlación, salud), *Optimizar*
  (frontera eficiente robusta v2 — Ledoit-Wolf/OAS, encogimiento, CLA/QP y riesgo
  objetivo por percentil) y *Simular* (backtest y Monte Carlo). La optimización
  tiene **una sola puerta**: paso Optimizar → revisión → aplicar.
- **Informe de cliente** — no es un módulo suelto, es una vista del diseño de
  cartera: la previsualización del documento que recibe el cliente, con su
  portada. Lo interno del asesor va plegado bajo «Solo asesor» y no existe en modo
  cliente.
- **Análisis (X-Ray)** — la radiografía de trabajo: visión general y analítica
  avanzada, con *look-through* de las posiciones subyacentes, solapamiento entre
  fondos, exposición por región y sector, costes y comparación contra benchmark.
- **Posiciones globales** — importes acumulados por fondo, agrupados por ISIN.

### Cartera real
- **Rendimiento** — la cartera que existe de verdad: XIRR, caída máxima histórica,
  evolución y análisis guardados.
- **Extracto externo** — importación de extractos de bróker. Conoce los formatos
  de Andbank con sus rarezas: los `.xls` que en realidad son HTML, los importes
  con céntimos implícitos sin coma, los conceptos truncados a 30 caracteres.

### Sistema *(solo administradores, anclado al pie: no forma parte del flujo de asesoramiento)*
Estado de la maestra, semáforo de integridad, calidad por fondo, inventario de
activos, backfill de histórico, recálculo de métricas, reconciliación del índice y
—en desarrollo— las operaciones del extractor.

### Transversal a todo
- **Modo cliente**: un interruptor que oculta lo interno del asesor para poder
  enseñar la pantalla. Es presentación, no permisos.
- **Benchmark**: se elige donde gobierna (pestañas del Análisis y portada del
  Informe), nunca escondido en una subvista.
- **Doce generadores de PDF**: informe de cartera Andbank, informe interno,
  comparación de activos, costes, propuesta de mejora, cartera real, X-Ray,
  informe semanal y variantes.
- **Retrocesión comercial**: importación y consulta. Es lo único que la interfaz
  escribe directamente en Firestore, sin pasar por las Functions.

## 5. Dónde está la frontera

Esto es lo que el programa **no** hace hoy, dicho con precisión, porque es donde
empieza cualquier decisión sobre el futuro.

**No hay cliente.** Hoy «cliente» son dos cosas y ninguna es un registro: un campo
de texto en la portada del informe (cliente, responsable, correo) y el interruptor
de presentación del modo cliente. No existe perfil, ni horizonte, ni objetivos, ni
histórico.

**La unidad de trabajo guardado es la cartera, no el cliente.** El trabajo del
asesor sí persiste en servidor —`bdb_activos/{uid}/portfolios/{id}`, 23 carteras de
8 usuarios— pero un documento guardado contiene exactamente esto:

```
portfolio_id · owner_uid · name · positions · base_currency
source_kind · created_at · updated_at
```

Un nombre y unas posiciones. No hay a quién pertenece, ni por qué se propuso, ni
qué se propuso antes. Las versiones no se guardan: guardar sustituye.

Aparte de eso, el navegador mantiene una capa local de borradores
(`localStorage`), que el propio código marca como «guardado local en este
navegador/dispositivo» y sin datos maestros.

**El programa no emite un consejo.** `PREVIEW_ONLY` marca las cifras que la
interfaz calcula ella misma, y sus limitaciones están escritas:

> No son métricas oficiales de la base maestra · Volatilidad y Sharpe usan
> correlaciones asumidas por clase si no hay simulación histórica real · La máxima
> caída es la media ponderada de las caídas de los activos, no la caída histórica
> conjunta de la cartera · **No sustituyen a una evaluación de idoneidad** · **No
> constituyen recomendación personalizada** · No son aptas para la optimización en
> producción

Los diez perfiles de riesgo `RISK_1`…`RISK_10` ya están modelados como contratos,
cada uno con su horizonte indicativo y su tolerancia, y los diez están en
`PREVIEW_ONLY`. Y la lectura de idoneidad de las restricciones de cartera emite el
código `SUITABILITY_PREVIEW_ONLY`.

Conviene no malinterpretar esta frontera: **no es falta de datos.** La cobertura de
series y métricas es del 99,5 %, y los avisos de vista previa desaparecen cuando el
origen es la maestra oficial en vivo. La frontera es *dónde se calcula y con qué
compromiso*: una aproximación hecha en el navegador no puede sostener una
evaluación de idoneidad, y el sistema prefiere decirlo antes que disimularlo.

## 6. Resumen en una página

| | |
|---|---|
| **Qué es** | Tres partes: adquisición, gobierno del dato, herramienta del asesor |
| **A quién sirve** | Un asesor de inversión, ante un cliente |
| **La regla** | Un número que ve un cliente no se inventa nunca |
| **1 · Extractor** | Python · 11 fuentes externas · pipeline manual con orden obligatorio · deja ficheros, no escribe en la base |
| **2 · Base de datos** | Firestore + gobierno en TypeScript · 15 colecciones · 25.394 documentos · 1.097 activos · create-only, puerta explícita, auditoría que se niega a mentir |
| **3 · Programa** | React 19 + 39 funciones y 9 tareas programadas · 10 destinos en 5 secciones · busca, compara, construye, optimiza, simula, radiografía e informa |
| **Lo que sí guarda** | Carteras por usuario: nombre y posiciones |
| **Lo que no existe** | El cliente como entidad, el histórico de propuestas, y el consejo: la idoneidad está declarada como vista previa |

---

*Qué se hace a partir de aquí lo decide Oscar. Este documento solo fija qué hay.*
