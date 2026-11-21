# Descubrimiento — adquisición de datos BDB

*4 de septiembre de 2026. Medido sobre código, caché y logs reales, no sobre documentación.*

Briefing para quien vaya a rediseñar la capa de adquisición del extractor. Todas las cifras
salen de contar, no de estimar; el método está al final.

---

## 1. El hallazgo central: una fuente, no cuatro

El sistema declara cuatro proveedores y una prioridad configurable
(`prioridad_fuentes: ["cnmv", "morningstar_lt", "justetf"]`) más EODHD. Medido sobre la última
pasada real (`1-extractor/logs/update9.log`, 9 fondos):

| Fuente | Estado | Campos aportados | % |
|---|---|---:|---:|
| `morningstar_lt` | OK 9/9 | 5.408 | **99,1 %** |
| `eodhd` | OK 8/9 | 48 | 0,9 % |
| `cnmv` | sin datos 9/9 | 0 | 0,0 % |
| `justetf` | sin datos 9/9 | 0 | 0,0 % |

CNMV solo responde a ISIN españoles; justETF solo a ETF. En una cartera mayoritariamente de
fondos internacionales no aportan nada. EODHD aporta seis campos: valor liquidativo, fecha,
divisa y trazabilidad técnica.

## 2. Mapa de procedencia

133 rutas de campo extraídas de los `set_path` de los seis *fetchers*:

- **98 campos con fuente única** (sin respaldo)
- **35 campos con dos o más fuentes** (ahí sí hay respaldo)

Campos exclusivos por fuente, y cuántos están poblados en más del 50 % de los 763 fondos:

| Fuente | Exclusivos | Poblados en la mayoría |
|---|---:|---:|
| `morningstar_lt` | 35 | **28** |
| `morningstar` | 19 | 3 |
| `justetf` | 3 | 2 |
| `cnmv` | 11 | 0 |
| `eodhd` | 30 | 0 |

Los exclusivos de Morningstar más poblados:

| Campo | Cobertura | Naturaleza |
|---|---:|---|
| `riesgo.sharpe.3a.fondo` | 98,3 % | **calculable** desde la serie |
| `riesgo.sri_kid_1a7` | 90,2 % | **regulatorio** (KID/PRIIPs) |
| `identificacion.ucits` | 90,2 % | **regulatorio** (folleto/KID) |
| `identificacion.fecha_lanzamiento_clase` | 90,2 % | **regulatorio** |
| `identificacion.clase_activo` | 90,2 % | regulatorio / derivable |
| `identificacion.gestora` | 90,0 % | **regulatorio** (folleto, CNMV en ES) |
| `cartera.top10_posiciones` | 89,5 % | **regulatorio** (informes periódicos) |
| `esg.carbono.*` (6) | 89,1 % | *propietario* (Sustainalytics) |
| `costes.mifid_emt_exante.fecha` | 88,6 % | **regulatorio** (EMT, MiFID II) |
| `cartera.renta_fija.*` (9) | 88,5 % | regulatorio (informes) / difícil de parsear |

`1-extractor/` no versiona el mapa completo; se regenera recorriendo los `set_path`.

## 3. Naturaleza de cada proveedor

| Fuente | Acceso | Naturaleza | Continuidad |
|---|---|---|---|
| Morningstar | `apikey` pública en la ruta + `Referer`/`Origin` suplantados | API interna del sitio web, **no licenciada** | **Puede cortarse sin aviso; ya ocurrió** |
| EODHD | Token propio | De pago, legítima; licencia *personal y no comercial* | Estable con suscripción |
| CNMV | Descarga pública XML/ZIP | Dato oficial de regulador | Permanente (obligación legal) |
| justETF | Librería de *scraping* de GitHub | *Scraping* de terceros | Frágil |

**Ya se cayó.** `1-extractor/logs/fondosdb_20260903.log` recoge el fallo en directo:
`NameResolutionError: Failed to resolve 'tools.morningstar.es'`, tres reintentos, 28 s perdidos
por fondo. Morningstar retiró los hosts `tools.*`. La misma clave seguía en
`lt.morningstar.com`, así que la migración fue de una línea — esta vez.

**A verificar (no es un dictamen):** el informe de integración de EODHD (18-07) declara uso
«personal y no comercial», con datos que «no deben mostrarse a terceros» y purga un mes tras la
baja. BDB-ACTIVOS se usa delante de clientes. Merece consulta con EODHD; condiciona costes.

## 4. Dos vías de adquisición con disciplina opuesta

Las mismas fuentes se atacan desde dos sitios con criterios contrarios:

| | Extractor (local) | Backend de la app (nube) |
|---|---|---|
| Endpoints Morningstar | 18 + screener | 13 + screener |
| Ritmo | 1,2 s + jitter, secuencial | **7 hilos, sin límite** |
| Caché HTTP | disco, 7 días | **ninguna** |
| Reintentos | 3, con retroceso | **ninguno** |
| Altas | 74 acciones · 668 fondos | 240 acciones |

La vía agresiva es la que corre en la nube contra la API no oficial. Y trae cinco endpoints
menos: sin calidad crediticia, vencimientos, nivel de comisiones, comisiones de
suscripción/reembolso ni distribuciones. Un fondo dado de alta por el panel nace con ficha más
pobre y nada lo advierte.

## 5. Eficiencia

| Medida | Valor | Origen |
|---|---:|---|
| Peticiones por fondo | 29 | 22.455 entradas de caché / 763 fondos |
| Coste por petición | 1,5 s | `rate_limit 1,2 s` + jitter medio |
| Pasada completa | **9,4 h** | secuencial, 763 fondos |
| Caché en disco | 1,4 GB | `cache/http`, TTL único de 7 días |
| Tráfico a Morningstar | 92 % | por dominio, muestra de 4.001 |

El problema no es el ritmo —correcto frente a una API no oficial— sino **qué se pide**. El TTL
es único: cada pasada refresca los 29 endpoints aunque solo haya cambiado el valor liquidativo.

TTL razonable por familia de dato:

| Dato | Cambia | Hoy | Razonable |
|---|---|---:|---:|
| VL, precio | a diario | 7 d | 1 d |
| Rentabilidad, volatilidad, Sharpe | a diario (derivable) | 7 d | 1 d |
| Cartera, sectores, regiones | mensual/trimestral | 7 d | 30 d |
| Costes, TER, MiFID | anual | 7 d | 90 d |
| ESG, carbono, medalist, SFDR | mensual/trimestral | 7 d | 30 d |
| UCITS, domicilio, lanzamiento | casi nunca | 7 d | 365 d |

El screener ya devuelve ~33 datapoints en **una** llamada (precio, rentabilidades,
desviaciones, Sharpe). Con TTL por familia, el refresco diario baja de 29 peticiones a 1-2:
**de 9,4 h a menos de 20 min**.

## 6. La distinción que hace «libre» alcanzable

Todo lo que hoy llega por el mismo grifo frágil es de dos naturalezas:

| | Dato regulatorio | Analítica propietaria |
|---|---|---|
| Qué | SRI del KID, costes ex-ante MiFID/EMT, UCITS, SFDR, domicilio, lanzamiento, gestora, cartera de informes periódicos | Categoría Morningstar, estrellas, medalist, globos ESG, carbono, TER vs categoría, risk_score |
| Quién lo publica | La gestora, **por obligación legal** (PRIIPs, MiFID II, SFDR) | Morningstar, como producto propio |
| Sustituible | **Sí** — público y obligatorio | No — se licencia o se prescinde |
| Coste | Cero | Licencia institucional |

**Decisión de Óscar (04-09): reducir, no eliminar.** Se conserva la analítica propietaria de
Morningstar; lo que se lleva a fuentes oficiales es el bloque regulatorio, de modo que una caída
de Morningstar cueste la analítica pero **no la ficha**.

## 7. Arquitectura objetivo

Un **núcleo de adquisición** independiente, con:

1. **Adaptadores que declaran capacidades** — cada proveedor dice qué campos sabe dar, para
   poder responder «si cae X, ¿qué me queda?» antes de que caiga.
2. **Procedencia por campo** en el canónico — hace auditable el respaldo, permite saber qué se
   degradó, y es lo que hace verificable el rediseño.
3. **TTL por familia de dato** y planificador incremental que pide solo lo caducado.
4. **Una sola vía**: el panel de la app invoca el mismo núcleo en vez de reimplementarlo.

**La adquisición se queda fuera de la app:** una recolección educada no cabe en Cloud Functions
(por eso la versión de la nube va a 7 hilos sin ritmo), la caché necesita disco persistente, y
un corte de proveedor no debe degradar la app que el asesor tiene abierta.

## 8. Comportamiento no escrito que hay que conservar

- **Recorte por cobertura de FX**: el EUR no existe antes de 1999; las fechas previas a la
  primera cotización EUR/divisa rompen la conversión y se filtran.
- **Deduplicación por fecha** en las series, último valor gana.
- **Combinaciones (id, asset) en Morningstar**: para ETF el `SecId 0P…` suele fallar y hay que
  caer al `FundId FS…`.
- **Escritura atómica** de cada canónico y del resumen del paquete.
- **La comisión de gestión no se imputa nunca desde el TER**; si solo hay máximo declarado, se
  usa con aviso (`management_fee_uses_declared_maximum`).
- **Los buckets de `classification_v2` se dejan a null a propósito**: son enums del motor de BDB
  y no se inventan.
- **Validación y calidad reales** (desde el 04-09): `validation.ok` sale del bucket de
  `core/calidad.py` y de los campos estructurales; las flags `info_*` no penalizan.

## 9. Trampas conocidas

- El `source` de las métricas **no distingue quién las escribió**, salvo en acciones desde el
  04-09 (`FONDOSDB_STOCK_ROOT_ES` para el relleno del cargador).
- La caché de 1,4 GB **no debe invalidarse** al introducir TTL por familia: ahorra horas.
- El extractor tiene que **seguir funcionando sin la plataforma delante**; para eso está
  `contracts_cache/` con manifiesto SHA-256.
- Las métricas de acción **las posee la app** (decisión del 04-09). El canónico solo aporta
  relleno etiquetado `TRAILING_PROVIDER`.

## 10. Puertas de verificación existentes

```
python tools/sync_contratos.py --check    contratos al día (con o sin SSOT delante)
python -m ruff check .                    E9 + F, limpio
python -m pytest                          36 pruebas
```

Y el canónico valida contra `fondosdb-fund.v1` / `fondosdb-stock.v1` en el propio adaptador.

**El oráculo del rediseño:** regenerar los 763 canónicos y comparar campo a campo contra
`export_bdb/` actual. Campos idénticos, esperado. Campos que aparecen, justificar como mejora.
**Campos que desaparecen, regresión** salvo justificación explícita.

---

### Método

Mapa de procedencia extraído de los 133 `set_path` de los seis *fetchers*; relleno real medido
sobre los 763 ficheros de `data/funds/`; reparto de tráfico sobre 22.455 entradas de
`cache/http` (muestra de 4.001 para el desglose por dominio); aportación por fuente leída de
`logs/update9.log`; disciplina de cada vía leída del código. No se ejecutó ninguna recolección
nueva ni se escribió en la maestra para preparar este descubrimiento.
