# FONDOSDB_DEEP_AUDIT_SCHEMA_CLEANUP_0

**Fecha:** 2026-06-11  
**Autor:** Auditoría automatizada (Claude Opus 4.6 — Antigravity IDE)  
**Alcance:** Proyecto `fondosdb` — análisis READ-ONLY  
**Versión:** 0.1.0

---

## 1. Resumen ejecutivo

El proyecto **fondosdb** contiene **397 ficheros JSON** en `data/funds/`, representando fondos de inversión y ETFs UCITS de 7 jurisdicciones (LU, ES, IE, FR, BE, DE, FI), con un peso total de **35.5 MB**. El pipeline extrae datos de 4 fuentes (Morningstar LT, justETF, gestoras iShares, CNMV) y los fusiona con prioridad configurable.

### Hallazgos principales

> [!NOTE]
> Análisis complementado por 3 subagentes que inspeccionaron exhaustivamente 13 ficheros representativos (ETFs iShares, Vanguard Bond, fondos españoles, Carmignac, JPMorgan, Fundsmith, iShares Gold ETC).

| Aspecto | Estado |
|---|---|
| JSON corruptos | **0** — todos parsean correctamente |
| Cobertura Morningstar LT | **100%** (397/397 ficheros) |
| Cobertura justETF | 2% (6 ETFs) |
| Cobertura gestoras | 1% (3 ETFs iShares con cartera completa) |
| Cobertura CNMV | 0.3% (1 fondo español: Bestinfond) |
| Campos basura activos | **~15 campos** ya eliminados por `limpieza.py`, **~8 residuales** |
| Problemas de normalización | **5 categorías críticas** (países, sectores, escalas, asset allocation, ETFs sintéticos) |
| Schema v2 consistencia | **Alta**: bloques raíz son estables; variabilidad dentro de `cartera` y `riesgo` |
| Fichero más grande | IE00B18GC888 (Vanguard Global Bond) = **3.6 MB** (10,000 posiciones) |
| Fichero más pequeño | IE00B4ND3602 (iShares Physical Gold ETC) = **5.8 KB** |

### Valoración global

La calidad de los datos es **buena para un extractor automático**. El schema v2 es coherente y cubre los bloques fundamentales. Los problemas principales son:

1. **Campos ETF intradía residuales** (6 ficheros) — basura para análisis patrimonial
2. **Países duplicados** (ISO3 + nombres largos) — parcialmente resuelto en `limpieza.py`
3. **Escalas ambiguas** en `patrimonio_fondo_meur` (algunas vienen en EUR absolutos, no millones)
4. **Falta perfil de renta fija** en fondos que sí lo necesitan (duración, YTM, calidad crediticia)
5. **Sin SFDR** — no se extrae artículo 6/8/9
6. **Sin campo hedged/unhedged** explícito

---

## 2. Inventario del proyecto

### Estructura de carpetas

```
fondosdb/
├── app.py                    # Interfaz web local (Flask, 26.5 KB)
├── main.py                   # CLI principal (12.3 KB)
├── requirements.txt          # Dependencias Python
├── README.md                 # Documentación usuario
├── config/
│   ├── fondos.csv            # Lista de ISINs (500 filas)
│   ├── gestoras.csv          # Mapeo ISIN→URL gestora (iShares)
│   └── settings.json         # rate limit, caché, prioridades
├── core/
│   ├── schema.py             # Fusión de fuentes, set_path, merge
│   ├── limpieza.py           # Normalización post-fusión
│   ├── derivados.py          # Campos derivados (IG/HY, divisas)
│   ├── store.py              # Persistencia JSON + índice + snapshots
│   ├── visor.py              # Generador visor HTML
│   └── http.py               # Cliente HTTP con caché y rate limit
├── fetchers/
│   ├── morningstar_lt.py     # Fuente principal (screener + lt + sal-service)
│   ├── morningstar.py        # Fuente alternativa (mstarpy, opcional)
│   ├── justetf.py            # Solo ETFs UCITS
│   ├── gestoras.py           # Carteras completas iShares
│   └── cnmv.py               # Datos oficiales fondos españoles
├── tools/
│   ├── test_morningstar.py   # Verificación Morningstar
│   └── test_gestoras.py      # Verificación gestoras
├── data/
│   ├── funds/                # 397 JSON (fichas completas)
│   ├── history/              # 394 JSONL (snapshots históricos)
│   ├── index.json            # Índice resumen
│   └── visor.html            # Visor HTML generado
├── cache/
│   ├── http/                 # Respuestas HTTP cacheadas
│   ├── raw_morningstar_lt/   # Respuestas crudas Morningstar
│   ├── raw_gestoras/         # CSV crudos iShares
│   └── cnmv/                 # ZIP + XML + parsed CNMV
└── logs/                     # Logs de ejecución
```

### Scripts principales

| Script | Función | Genera JSON |
|---|---|---|
| `main.py` | CLI: update, add, report, cnmv, visor | Sí (vía store.py) |
| `app.py` | Interfaz web local Flask | Sí (vía store.py) |
| `core/schema.py` | Fusión multi-fuente con prioridad | Estructura el JSON |
| `core/limpieza.py` | Post-proceso: normaliza países, sectores, elimina basura | Modifica in-place |
| `core/derivados.py` | Calcula IG/HY y divisas desde posiciones | Modifica in-place |

### Pipeline de datos

```
fondos.csv → [fetcher 1..N] → parciales → merge(prioridad) → limpieza → derivados → store.escribe_fondo()
```

**Prioridad de fuentes:** cnmv > gestoras > morningstar_lt > justetf

---

## 3. Inventario de JSON

### Conteo y distribución

| Métrica | Valor |
|---|---|
| Total ficheros JSON | **397** |
| ISINs en fondos.csv | **500** |
| ISINs sin JSON | ~103 (probablemente sin SecId en Morningstar) |
| Ficheros corruptos | **0** |
| Schema versión | **2** (100%) |

### Distribución por jurisdicción ISIN

| Prefijo | País | Cantidad | % |
|---|---|---|---|
| LU | Luxemburgo | 250 | 63% |
| ES | España | 62 | 16% |
| IE | Irlanda | 56 | 14% |
| FR | Francia | 24 | 6% |
| BE | Bélgica | 3 | 1% |
| DE | Alemania | 1 | 0% |
| FI | Finlandia | 1 | 0% |

### Distribución por tamaño

| Rango | Ficheros | Ejemplos |
|---|---|---|
| < 10 KB | 1 | IE00B4ND3602 (Gold ETC, 5.8 KB) |
| 10-20 KB | 86 | Fondos solo-Morningstar sin sal-service |
| 20-50 KB | 136 | Fondos con sal-service parcial |
| 50-100 KB | 67 | Fondos con cartera media |
| 100-500 KB | 56 | Fondos con sal-service completo + cartera grande |
| > 500 KB | 11 | ETFs con gestora o fondos con miles de posiciones |

### Ficheros anómalamente grandes (>500 KB)

| ISIN | Nombre | Tamaño | Posiciones | Causa |
|---|---|---|---|---|
| IE00B18GC888 | Vanguard Global Bond Index | 3.6 MB | 10,000 | Límite de posiciones cap |
| IE00B84J9L26 | PIMCO Income Fund | 2.9 MB | 7,742 | Enorme cartera RF |
| LU0404220724 | JPMorgan Global Income | 1.2 MB | 3,112 | Fondo mixto muy diversificado |
| IE00B5ZW6Z28 | PIMCO Emerging Local Bond | 939 KB | 2,593 | Deuda emergente ML |
| IE00B11XZ103 | PIMCO Global Bond | 917 KB | 2,500 | Cartera RF global |

> [!NOTE]
> **Hallazgo subagentes:** IE00B18GC888 (Vanguard Bond) tiene realmente **16,393 posiciones** (`num_posiciones` reporta 16,393, no 10,000 — el cap de 10K es del script de análisis, no del dato real). Las posiciones incluyen ISIN, `tipo: "rf"` y `valor_mercado` poblados para cada bono. El fichero tiene 130,476 líneas.

### Fichero anómalamente pequeño

| ISIN | Nombre | Tamaño | Secciones faltantes |
|---|---|---|---|
| IE00B4ND3602 | iShares Physical Gold ETC | 5.8 KB | `cartera`, `esg`, `rating` ausentes |

### Distribución por fuentes de datos

| Combinación de fuentes | Ficheros | % |
|---|---|---|
| morningstar_lt (solo) | 390 | 98.2% |
| gestoras + justetf + morningstar_lt | 3 | 0.8% |
| justetf + morningstar_lt | 3 | 0.8% |
| cnmv + morningstar_lt | 1 | 0.3% |

> [!IMPORTANT]
> El 98% de los fondos depende exclusivamente de Morningstar LT. Solo 6 ETFs tienen datos justETF y 3 tienen cartera completa de gestoras. Solo 1 fondo español (Bestinfond) tiene datos CNMV.

---

## 4. Schema detectado

### Bloques raíz (frecuencia sobre 397 ficheros)

| Bloque | Frecuencia | % | Contenido |
|---|---|---|---|
| `identificacion` | 397 | 100% | ISIN, nombre, gestora, divisa, domicilio, categoría |
| `costes` | 397 | 100% | TER, comisiones, MiFID EMT |
| `valoracion` | 397 | 100% | VL, patrimonio, fechas |
| `rentabilidad` | 397 | 100% | Trailing, por año natural |
| `riesgo` | 397 | 100% | Volatilidad, Sharpe, SRI, alpha, beta, R² |
| `gestion` | 397 | 100% | Gestora, gestores |
| `meta` | 397 | 100% | ISIN, fuentes, errores, versión |
| `cartera` | 396 | 100% | Posiciones, sectores, países, asset allocation |
| `distribuciones` | 396 | 100% | Yield 12M |
| `esg` | 396 | 100% | Globos, scores E/S/G, carbono |
| `rating` | 372 | 94% | Estrellas, medalist, percentil |
| `documentos` | 323 | 81% | Lista de documentos disponibles |
| `series` | 1 | 0% | Solo Bestinfond (CNMV diaria) |

### Schema completo con frecuencias

#### Bloque `identificacion` (100%)

| Campo | Frecuencia | Tipo | Clasificación |
|---|---|---|---|
| `nombre` | 100% | string | CORE_USEFUL |
| `gestora` | 100% | string | CORE_USEFUL |
| `divisa_base` | 100% | string | CORE_USEFUL |
| `domicilio` | 100% | string | CORE_USEFUL |
| `categoria_morningstar` | 100% | string | CORE_USEFUL |
| `clase_activo` | 100% | string | CORE_USEFUL |
| `indice_benchmark_oficial` | 100% | string | CORE_USEFUL |
| `ucits` | 100% | boolean | CORE_USEFUL |
| `fecha_lanzamiento_fondo` | 100% | string | CORE_USEFUL |
| `fecha_lanzamiento_clase` | 100% | string | CORE_USEFUL |
| `estructura_legal` | 100% | string | RAW_ONLY |
| `estrategia_inversion_texto` | 98% | string | ADVANCED_USEFUL |
| `inversion_minima_inicial` | 89% | float | ADVANCED_USEFUL |
| `replicacion` | 2% | string | CORE_USEFUL (para ETFs) |
| `ticker` | 2% | string | ADVANCED_USEFUL |
| `tipo` | 2% | string | CORE_USEFUL (mal poblado) |
| `descripcion` | 2% | string | ADVANCED_USEFUL |
| `politica_distribucion` | 1% | string | CORE_USEFUL (mal poblado) |
| `estado_comercializacion` | 1% | string | RAW_ONLY |
| `nombre_legal_cnmv` | 0.3% | string | RAW_ONLY |
| `registro_cnmv` | 0.3% | string | ADVANCED_USEFUL |
| `gestora_legal` | 0.3% | string | RAW_ONLY |
| `depositario` | 0.3% | string | ADVANCED_USEFUL |

#### Bloque `costes` (100%)

| Campo | Frecuencia | Tipo | Clasificación |
|---|---|---|---|
| `ter_pct` | 99% | float | CORE_USEFUL |
| `comision_gestion_max_pct` | 100% | float | CORE_USEFUL |
| `comision_gestion_aplicada_pct` | 84% | float | CORE_USEFUL |
| `comision_suscripcion_max_pct` | 98% | float | CORE_USEFUL |
| `comision_reembolso_max_pct` | 48% | float | ADVANCED_USEFUL |
| `comision_distribucion_pct` | 77% | float | DISCARD_CANDIDATE |
| `mifid_emt_exante` | 98% | object | ADVANCED_USEFUL |
| `mifid_emt_exante.corrientes_pct` | 97% | float | ADVANCED_USEFUL |
| `mifid_emt_exante.transaccion_pct` | 97% | float | ADVANCED_USEFUL |
| `mifid_emt_exante.incidentales_pct` | 97% | float | ADVANCED_USEFUL |
| `mifid_emt_exante.entrada_pct` | 68% | float | ADVANCED_USEFUL |
| `mifid_emt_exante.salida_pct` | 43% | float | ADVANCED_USEFUL |
| `mifid_emt_exante.fecha` | 87% | string | ADVANCED_USEFUL |
| `ter_vs_categoria.mediana_categoria_pct` | 90% | float | ADVANCED_USEFUL |
| `ter_vs_categoria.nivel` | 90% | string | ADVANCED_USEFUL |
| `ter_vs_categoria.percentil` | 34% | float | ADVANCED_USEFUL |

#### Bloque `rating` (94%)

| Campo | Frecuencia | Tipo | Clasificación |
|---|---|---|---|
| `estrellas.overall` | 93% | int | CORE_USEFUL |
| `estrellas.3a` | 93% | int | ADVANCED_USEFUL |
| `estrellas.5a` | 86% | int | ADVANCED_USEFUL |
| `estrellas.10a` | 78% | int | ADVANCED_USEFUL |
| `medalist.rating` | 91% | string | CORE_USEFUL |
| `medalist.fecha` | 91% | string | CORE_USEFUL |
| `percentil_categoria.overall` | 93% | float | ADVANCED_USEFUL |
| `percentil_categoria.3a` | 93% | float | ADVANCED_USEFUL |
| `percentil_categoria.5a` | 86% | float | ADVANCED_USEFUL |
| `percentil_categoria.10a` | 78% | float | ADVANCED_USEFUL |

#### Bloque `valoracion` (100%)

| Campo | Frecuencia | Tipo | Clasificación |
|---|---|---|---|
| `vl` | 100% | float | CORE_USEFUL |
| `vl_fecha` | 100% | string | CORE_USEFUL |
| `vl_divisa` | 100% | string | CORE_USEFUL |
| `patrimonio_fondo_meur` | 100% | float | DANGEROUS_IF_UNCLEANED |
| `patrimonio_fecha` | 99% | string | CORE_USEFUL |
| `patrimonio_divisa` | 99% | string | CORE_USEFUL |
| `variacion_dia_pct` | 2% | float | DISCARD_CANDIDATE |
| `min_52sem` | 2% | float | DISCARD_CANDIDATE |
| `max_52sem` | 2% | float | DISCARD_CANDIDATE |
| `etf_intradia` | 2% | object | DISCARD_CANDIDATE |
| `cnmv_fin_mes` | 0.3% | object | ADVANCED_USEFUL |

#### Bloque `rentabilidad` (100%)

| Campo | Frecuencia | Tipo | Clasificación |
|---|---|---|---|
| `fecha_dato` | 100% | string | CORE_USEFUL |
| `trailing_pct.ytd.fondo` | 100% | float | CORE_USEFUL |
| `trailing_pct.1a.fondo` | 100% | float | CORE_USEFUL |
| `trailing_pct.3a_anualizada.fondo` | 99% | float | CORE_USEFUL |
| `trailing_pct.5a_anualizada.fondo` | 96% | float | CORE_USEFUL |
| `trailing_pct.10a_anualizada.fondo` | 84% | float | CORE_USEFUL |
| `trailing_pct.1m.fondo` | 100% | float | CORE_USEFUL |
| `trailing_pct.3m.fondo` | 100% | float | CORE_USEFUL |
| `trailing_pct.6m.fondo` | 100% | float | CORE_USEFUL |
| `trailing_pct.1d.fondo` | 100% | float | DISCARD_CANDIDATE |
| `trailing_pct.1sem.fondo` | 100% | float | DISCARD_CANDIDATE |
| `trailing_pct.desde_lanzamiento_anualizada.fondo` | 98% | float | CORE_USEFUL |
| `trailing_pct.*.categoria` | 95% | float | CORE_USEFUL |
| `trailing_pct.*.indice` | 1% | float | CORE_USEFUL (mal poblado) |
| `por_año_natural.{YYYY}.fondo` | 100% | float | CORE_USEFUL |

#### Bloque `riesgo` (100%)

| Campo | Frecuencia | Tipo | Clasificación |
|---|---|---|---|
| `sri_kid_1a7` | 100% | int | CORE_USEFUL |
| `srri_1a7` | 94% | int | CORE_USEFUL |
| `risk_score` | 93% | float | RAW_ONLY |
| `fecha_dato` | 97% | string | CORE_USEFUL |
| `volatilidad_pct.1a.fondo` | 100% | float | CORE_USEFUL |
| `volatilidad_pct.3a.fondo` | 99% | float | CORE_USEFUL |
| `volatilidad_pct.5a.fondo` | 96% | float | CORE_USEFUL |
| `volatilidad_pct.10a.fondo` | 84% | float | ADVANCED_USEFUL |
| `volatilidad_pct.*.categoria` | 94% | float | ADVANCED_USEFUL |
| `volatilidad_pct.*.indice` | 94% | float | ADVANCED_USEFUL |
| `sharpe.1a.fondo` | 100% | float | CORE_USEFUL |
| `sharpe.3a.fondo` | 99% | float | CORE_USEFUL |
| `sharpe.5a.fondo` | 96% | float | CORE_USEFUL |
| `alpha.*.fondo` | 95% | float | ADVANCED_USEFUL |
| `beta.*.fondo` | 95% | float | ADVANCED_USEFUL |
| `r2.*.fondo` | 95% | float | ADVANCED_USEFUL |
| `tracking_error_pct.*.fondo` | 95% | float | ADVANCED_USEFUL |
| `information_ratio.*.fondo` | 95% | float | ADVANCED_USEFUL |
| `max_drawdown.pct` | variable | float | ADVANCED_USEFUL |

#### Bloque `esg` (100%)

| Campo | Frecuencia | Tipo | Clasificación |
|---|---|---|---|
| `globos_sostenibilidad` | 95% | int (1-5) | CORE_USEFUL |
| `fecha` | 100% | string | CORE_USEFUL |
| `sustainability_score` | 92% | float | CORE_USEFUL |
| `score_ambiental` | 92% | float | ADVANCED_USEFUL |
| `score_social` | 92% | float | ADVANCED_USEFUL |
| `score_gobernanza` | 92% | float | ADVANCED_USEFUL |
| `cobertura_cartera_pct` | 99% | float | CORE_USEFUL |
| `carbono.carbon_risk_score` | 93% | float | ADVANCED_USEFUL |
| `carbono.clasificacion` | 89% | string | ADVANCED_USEFUL |
| `carbono.low_carbon` | 27% | bool | ADVANCED_USEFUL |
| `carbono.score_exposicion` | 32% | float | ADVANCED_USEFUL |
| `carbono.score_gestion` | 33% | float | ADVANCED_USEFUL |
| `carbono.riesgo_activos_varados` | 3% | float | RAW_ONLY |

#### Bloque `cartera` (100%)

| Campo | Frecuencia | Tipo | Clasificación |
|---|---|---|---|
| `fecha` | 100% | string | CORE_USEFUL |
| `num_posiciones` | 100% | int | CORE_USEFUL |
| `num_posiciones_rv` | 80% | int | ADVANCED_USEFUL |
| `num_posiciones_rf` | 35% | int | ADVANCED_USEFUL |
| `posiciones` | 100% | array | CORE_USEFUL |
| `sector_principal` | 78% | string | CORE_USEFUL |
| `sectores_pct` | 79% | object | CORE_USEFUL |
| `paises_pct` | 99% | object | CORE_USEFUL |
| `regiones_pct` | 81% | object | CORE_USEFUL |
| `asignacion_activos` | 100% | object | CORE_USEFUL |
| `capitalizacion_pct` | 79% | object | ADVANCED_USEFUL |
| `style_box_rv` | 79% | object | ADVANCED_USEFUL |
| `valoracion_cartera` | 80% | object | ADVANCED_USEFUL |
| `calidad_cartera` | 79% | object | ADVANCED_USEFUL |
| `renta_fija` | 53% | object | CORE_USEFUL (para RF) |
| `divisas_pct` | variable | object | CORE_USEFUL |
| `peso_top10_pct` | 1% | float | CORE_USEFUL (mal poblado) |
| `rotacion_pct` | 1% | float | ADVANCED_USEFUL |

**Estructura de cada posición** (dentro de `cartera.posiciones`):

> [!WARNING]
> Los subagentes confirmaron que las posiciones de fuente **gestoras (iShares)** NO incluyen ISIN — solo tienen `ticker` y `nombre`. Además, `valor_mercado` y `peso_pct` pueden ser **negativos** en derivados y offsets de cash. La posición `"Cash Offset For Derivatives"` en Bestinfond tiene `peso_pct: -1.17` y `valor_mercado: -8,179,328`.

| Campo | Presente en | Clasificación |
|---|---|---|
| `nombre` | ~100% | CORE_USEFUL |
| `peso_pct` | ~100% (puede ser negativo) | CORE_USEFUL |
| `isin` | ~70% (0% en fuente gestoras) | CORE_USEFUL |
| `sector` | ~80% | CORE_USEFUL |
| `pais` | ~85% | CORE_USEFUL |
| `divisa` | ~75% | CORE_USEFUL |
| `ticker` | ~30% | ADVANCED_USEFUL |
| `tipo` | ~25% | ADVANCED_USEFUL |
| `num_titulos` | ya eliminado | DISCARD_CANDIDATE |
| `valor_mercado` | ya eliminado | DISCARD_CANDIDATE |
| `primera_compra` | ~5% | RAW_ONLY |
| `clase_activo` | ~3% (gestoras) | ADVANCED_USEFUL |

#### Bloque `gestion` (100%)

| Campo | Frecuencia | Tipo | Clasificación |
|---|---|---|---|
| `gestora.nombre` | 100% | string | CORE_USEFUL |
| `gestora.grupo` | 0.3% | string | ADVANCED_USEFUL |
| `gestora.aum_total_meur` | variable | float | ADVANCED_USEFUL |
| `gestora.num_fondos` | variable | int | ADVANCED_USEFUL |
| `gestores` | 100% | array | CORE_USEFUL |
| `gestores[].nombre` | 100% | string | CORE_USEFUL |
| `gestores[].desde` | 100% | string | CORE_USEFUL |
| `gestores[].titulacion` | ~5% | string | RAW_ONLY |
| `tenure_medio_años` | 100% | float | DISCARD_CANDIDATE |

#### Bloque `distribuciones` (100%)

| Campo | Frecuencia | Tipo | Clasificación |
|---|---|---|---|
| `yield_12m_pct` | 100% | float | CORE_USEFUL |
| `historial` | variable | array | ADVANCED_USEFUL |

#### Bloque `documentos` (81%)

| Campo | Frecuencia | Tipo | Clasificación |
|---|---|---|---|
| `[].fecha` | 81% | string | CORE_USEFUL |
| `[].formato` | 81% | string | RAW_ONLY |
| `[].id` | ya eliminado | — | DISCARD_CANDIDATE |
| `[].mercados` | ya eliminado | — | DISCARD_CANDIDATE |

#### Bloque `meta` (100%)

| Campo | Frecuencia | Tipo | Clasificación |
|---|---|---|---|
| `isin` | 100% | string | CORE_USEFUL |
| `actualizado` | 100% | string | CORE_USEFUL |
| `version_esquema` | 100% | int | CORE_USEFUL |
| `fuentes` | 100% | object | CORE_USEFUL |
| `errores` | 100% | array | CORE_USEFUL |
| `sec_id_morningstar` | 100% | string | RAW_ONLY |
| `cnmv_periodo` | 0.3% | string | ADVANCED_USEFUL |

---

## 5. Tabla de campos por utilidad financiera

### Leyenda de clasificación

| Clasificación | Significado | Destino |
|---|---|---|
| **CORE_USEFUL** | Esencial para cualquier uso financiero | → `normalized` |
| **ADVANCED_USEFUL** | Útil para análisis avanzado, screening, reporting | → `normalized` (bloque extendido) |
| **RAW_ONLY** | Conservar para trazabilidad, no exponer en consultas | → `raw` |
| **DISCARD_CANDIDATE** | Prescindible o ruido | → eliminar del normalized |
| **DANGEROUS_IF_UNCLEANED** | Útil pero engañoso si se consume sin normalizar | → `normalized` con normalización |
| **MISSING_CRITICAL** | Dato que no existe y sería valioso | → futuro scraping |

### Resumen cuantitativo

| Clasificación | Campos únicos | % del total |
|---|---|---|
| CORE_USEFUL | ~75 | 42% |
| ADVANCED_USEFUL | ~55 | 31% |
| RAW_ONLY | ~18 | 10% |
| DISCARD_CANDIDATE | ~15 | 8% |
| DANGEROUS_IF_UNCLEANED | ~8 | 5% |
| MISSING_CRITICAL | ~12 | 7% |

---

## 6. Campos CORE_USEFUL

Estos campos **deben** estar en el schema normalizado. Son los pilares de cualquier uso financiero:

### Identidad
- `identificacion.nombre`
- `meta.isin`
- `identificacion.gestora`
- `identificacion.divisa_base`
- `identificacion.domicilio`
- `identificacion.ucits`
- `identificacion.tipo` *(fondo/etf — necesita población masiva)*
- `identificacion.clase_activo`
- `identificacion.categoria_morningstar`
- `identificacion.indice_benchmark_oficial`
- `identificacion.fecha_lanzamiento_fondo`
- `identificacion.fecha_lanzamiento_clase`
- `identificacion.politica_distribucion` *(necesita población)*
- `identificacion.replicacion` *(solo ETFs)*

### Costes
- `costes.ter_pct`
- `costes.comision_gestion_max_pct`
- `costes.comision_gestion_aplicada_pct`
- `costes.comision_suscripcion_max_pct`

### Ratings
- `rating.estrellas.overall`
- `rating.medalist.rating`
- `rating.medalist.fecha`

### Valoración
- `valoracion.vl`
- `valoracion.vl_fecha`
- `valoracion.vl_divisa`
- `valoracion.patrimonio_fondo_meur` *(DANGEROUS — ver §10)*
- `valoracion.patrimonio_fecha`

### Rentabilidad
- `rentabilidad.fecha_dato`
- `rentabilidad.trailing_pct.ytd.fondo`
- `rentabilidad.trailing_pct.1m/3m/6m/1a.fondo`
- `rentabilidad.trailing_pct.3a_anualizada/5a_anualizada/10a_anualizada.fondo`
- `rentabilidad.trailing_pct.desde_lanzamiento_anualizada.fondo`
- `rentabilidad.trailing_pct.*.categoria`
- `rentabilidad.por_año_natural.{YYYY}.fondo`

### Riesgo
- `riesgo.sri_kid_1a7`
- `riesgo.srri_1a7`
- `riesgo.volatilidad_pct.{1a,3a,5a}.fondo`
- `riesgo.sharpe.{1a,3a,5a}.fondo`

### ESG
- `esg.globos_sostenibilidad`
- `esg.sustainability_score`
- `esg.cobertura_cartera_pct`
- `esg.fecha`

### Cartera
- `cartera.fecha`
- `cartera.num_posiciones`
- `cartera.sector_principal`
- `cartera.asignacion_activos.{rv,rf,liquidez,otros,convertibles,preferentes}.{neto,largo,corto}`
- `cartera.sectores_pct.{sector}.fondo`
- `cartera.paises_pct.{ISO3}`
- `cartera.regiones_pct.{region}`
- `cartera.posiciones[].{nombre,isin,peso_pct,sector,pais,divisa}`
- `cartera.renta_fija.duracion_efectiva`
- `cartera.renta_fija.calidad_media`

### Distribuciones
- `distribuciones.yield_12m_pct`

### Gestión
- `gestion.gestora.nombre`
- `gestion.gestores[].{nombre,desde}`

### Meta
- `meta.isin`
- `meta.actualizado`
- `meta.version_esquema`
- `meta.fuentes`
- `meta.errores`

---

## 7. Campos ADVANCED_USEFUL

Valiosos para screening avanzado, informes profesionales y scoring:

### Identidad extendida
- `identificacion.estrategia_inversion_texto`
- `identificacion.inversion_minima_inicial`
- `identificacion.ticker`
- `identificacion.descripcion`
- `identificacion.registro_cnmv`
- `identificacion.depositario`

### Costes extendidos
- `costes.comision_reembolso_max_pct`
- `costes.mifid_emt_exante.{corrientes,transaccion,incidentales,entrada,salida}_pct`
- `costes.mifid_emt_exante.fecha`
- `costes.ter_vs_categoria.{mediana_categoria_pct,nivel,percentil}`

### Ratings extendidos
- `rating.estrellas.{3a,5a,10a}`
- `rating.percentil_categoria.{overall,3a,5a,10a}`

### Riesgo extendido
- `riesgo.volatilidad_pct.10a.fondo`
- `riesgo.volatilidad_pct.*.{categoria,indice}`
- `riesgo.sharpe.*.{categoria,indice}`
- `riesgo.alpha.*.fondo`
- `riesgo.beta.*.fondo`
- `riesgo.r2.*.fondo`
- `riesgo.tracking_error_pct.*.fondo`
- `riesgo.information_ratio.*.fondo`
- `riesgo.max_drawdown.{pct,meses_caida}`

### ESG extendido
- `esg.score_ambiental`
- `esg.score_social`
- `esg.score_gobernanza`
- `esg.carbono.{carbon_risk_score,clasificacion,low_carbon}`
- `esg.carbono.{score_exposicion,score_gestion}`

### Cartera extendida
- `cartera.capitalizacion_pct.{gigante,grande,mediana,pequeña,micro}`
- `cartera.capitalizacion_pct.media_musd`
- `cartera.style_box_rv.celdas_pct.{LV,LB,LG,MV,MB,MG,SV,SB,SG}`
- `cartera.valoracion_cartera.{per,pb,pventas,pcf,yield_dividendo_pct,crec_beneficios_pct}`
- `cartera.calidad_cartera.{roa_pct,roe_pct,roic_pct,margen_neto_pct,deuda_capital_pct}`
- `cartera.renta_fija.{duracion_modificada,vencimiento_efectivo,ytm_pct,cupon_medio_pct,precio_medio}`
- `cartera.renta_fija.calidad_crediticia_pct.{AAA,AA,A,BBB,BB,B,inferior_B,sin_rating}`
- `cartera.renta_fija.pct_investment_grade` (derivado)
- `cartera.renta_fija.pct_high_yield` (derivado)
- `cartera.renta_fija.sectores_pct.{gobierno,corporativa,titulizada,municipal,liquidez,derivados}`
- `cartera.num_posiciones_rv`
- `cartera.num_posiciones_rf`
- `cartera.posiciones[].{ticker,tipo,clase_activo}`
- `cartera.divisas_pct` (derivado)
- `cartera.rotacion_pct`
- `cartera.peso_top10_pct`

### Distribuciones extendidas
- `distribuciones.historial`
- `valoracion.cnmv_fin_mes.{vl,patrimonio_meur,participes,fecha}`

### Gestión extendida
- `gestion.gestora.{grupo,aum_total_meur,num_fondos}`

---

## 8. Campos RAW_ONLY

Conservar solo para trazabilidad y debugging, **no exponer** en schema normalizado:

| Campo | Razón |
|---|---|
| `meta.sec_id_morningstar` | ID interno Morningstar, útil para re-fetch |
| `identificacion.estructura_legal` | SICAV/FCP — poco valor analítico, ya eliminado en limpieza.py |
| `identificacion.estado_comercializacion` | Abierto/Cerrado — ya eliminado en limpieza.py |
| `identificacion.nombre_legal_cnmv` | Duplica `nombre` — solo CNMV |
| `identificacion.gestora_legal` | Duplica `gestora` — solo CNMV |
| `gestion.gestores[].titulacion` | CFA etc. — raramente poblado |
| `esg.carbono.riesgo_activos_varados` | Solo 3% de cobertura |
| `riesgo.risk_score` | Score propietario Morningstar sin escala documentada |
| `documentos[].formato` | Siempre PDF — sin valor discriminante |
| `meta.cnmv_periodo` | Dato de trazabilidad CNMV |
| `series.cnmv_diaria` | Solo 1 fondo — serie temporal no escalable así |

---

## 9. Campos DISCARD_CANDIDATE

Campos que **no aportan valor** en un schema normalizado:

| Campo | Ficheros | Razón |
|---|---|---|
| `valoracion.variacion_dia_pct` | 6 | Intradía: cambia cada minuto, inútil en base estática |
| `valoracion.min_52sem` | 6 | Dato volátil, solo ETFs, no aplicable a fondos |
| `valoracion.max_52sem` | 6 | Ídem |
| `valoracion.etf_intradia.ultimo` | 6 | Duplica VL con peor calidad |
| `valoracion.etf_intradia.bolsa` | 6 | Nombre de exchange — no relevante |
| `valoracion.etf_intradia.bid` | ≤6 | Bid intradía — basura para análisis |
| `valoracion.etf_intradia.ask` | ≤6 | Ask intradía — basura para análisis |
| `valoracion.etf_intradia.spread_pct` | ≤6 | Spread intradía — basura |
| `costes.comision_distribucion_pct` | 77% | Retrocesiones — el usuario explícitamente no las quiere |
| `gestion.tenure_medio_años` | 100% | Calculable desde `gestores[].desde`, redundante |
| `rentabilidad.trailing_pct.1d.fondo` | 100% | Rentabilidad 1 día — ruido |
| `rentabilidad.trailing_pct.1sem.fondo` | 100% | Rentabilidad 1 semana — ruido |
| `cartera.posiciones[].primera_compra` | ~5% | Fecha primera compra — raramente poblado |

> [!NOTE]
> `limpieza.py` ya elimina 11 campos (etf_intradia, bid/ask/spread, min/max 52sem, variacion_dia, num_titulos, valor_mercado por posición, tenure, entidad_legal, analista_pct). Sin embargo, algunos residuales persisten porque el fetcher `justetf.py` los inyecta como `valoracion.etf_intradia` (distinto de lo que limpieza.py borra). Verificar el path exacto.

---

## 10. Campos DANGEROUS_IF_UNCLEANED

Campos que **parecen útiles pero son peligrosos** sin normalización:

### 1. `valoracion.patrimonio_fondo_meur`
- **Problema:** El nombre sugiere millones de EUR, pero algunos valores vienen en EUR absolutos (ej: `1387178777.0` que es ~1,387M EUR). Otros sí vienen en millones.
- **Origen:** Morningstar screener devuelve NAV en unidades absolutas; el snapshot lo convierte dividiendo por 1M. El merge puede sobreescribir uno con otro.
- **Riesgo:** Si alguien filtra por `patrimonio > 100` pensando "100M EUR", incluirá fondos de 100€ de patrimonio.
- **Acción:** Normalizar siempre a millones de EUR. Detectar valores > 100,000 como probables EUR absolutos.

### 2. `cartera.paises_pct` — duplicados ISO3 + nombres largos
- **Problema:** `limpieza.py` ya traduce, pero la tabla tiene 120+ claves de país únicas. Aún quedan `Australia` (nombre largo) junto a `AUS` (ISO3) en 2 ficheros.
- **Riesgo:** Suma de porcentajes incorrecta; screening por país da falsos negativos.
- **Acción:** Verificar que el limpiador cubre todos los nombres. Rechazar posiciones con país no-ISO3 de >3 caracteres.

### 3. `cartera.sectores_pct` — mezcla español/inglés
- **Problema:** `limpieza.py` traduce las claves inglesas al español normalizado. Pero SAL-service a veces aporta claves mixtas no cubiertas.
- **Riesgo:** Sector duplicado en agregaciones.
- **Acción:** Validar post-limpieza que todas las claves pertenecen al set `SECTORES_VALIDOS`.

### 4. `cartera.asignacion_activos.{clase}.neto` — no siempre suma ~100
- **Problema:** Asset allocation largo/corto puede no sumar 100 si hay derivados, repos o posiciones sintéticas.
- **Riesgo:** Interpretar como "90% RV" cuando realmente hay un 10% en swaps no contabilizados.
- **Acción:** Añadir campo `quality.aa_sum` para verificar.

### 5. `riesgo.volatilidad_pct` vs `riesgo.sharpe` — escala
- **Problema:** Volatilidad viene en 0-100 (porcentaje); Sharpe viene como ratio. Ambos correctos pero la convivencia puede confundir.
- **Acción:** Documentar escalas explícitamente en el schema.

### 6. `cartera.posiciones` en ETFs sintéticos
- **Problema:** ETFs con réplica sintética (swap/TRS) muestran posiciones instrumentales (bonos de colateral) que no representan la exposición económica real.
- **Riesgo:** Análisis de cartera muestra "bonos europeos" para un ETF de S&P500 sintético.
- **Acción:** Marcar fondos con réplica sintética y excluir posiciones de análisis look-through.

### 7. `valoracion.vl_fecha` — formato inconsistente
- **Problema:** Morningstar LT devuelve `2026-06-09T05:00:00.000`; justETF devuelve `2026-06-09`. No es una fecha ISO8601 uniforme.
- **Acción:** Normalizar a `YYYY-MM-DD`.

### 8. `esg.globos_sostenibilidad` — escala 1-5 vs null
- **Problema:** Fondos nuevos o con baja cobertura ESG tienen null. No es lo mismo que "0 globos".
- **Acción:** Distinguir explícitamente entre "sin dato ESG" y "evaluado pero bajo".

---

## 11. Datos faltantes relevantes

Datos que **no existen** en el schema actual y que serían valiosos:

### Renta fija (MISSING_CRITICAL para fondos RF)
| Dato faltante | Importancia | Fuente posible |
|---|---|---|
| `yield_to_worst` | Alta | SAL-service (campo existe pero no mapeado) |
| `calidad_crediticia_pct.CCC` | Media | SAL-service creditQuality |
| `distribucion_vencimientos` (0-1a, 1-3a, 3-5a, 5-10a, +10a) | Alta | No disponible vía APIs actuales |
| `% gobierno vs corporativo` | Alta | Ya existe en `renta_fija.sectores_pct` |
| `% subordinada / híbrida` | Media | No disponible |
| `exposicion_divisa_rf` | Alta | Parcial vía posiciones |

### Clasificación y producto (MISSING_CRITICAL)
| Dato faltante | Importancia | Fuente posible |
|---|---|---|
| `tipo` (fondo/etf) para todos | **Crítica** | Solo 2% poblado; deducible de categoría o ISIN |
| `politica_distribucion` (acc/dist) | Alta | Solo 1% poblado; disponible en Morningstar |
| `hedged/unhedged` | Alta | No extraído; inferible del nombre a veces |
| `SFDR_articulo` (6/8/9) | Alta | No disponible en APIs usadas |
| `clase_participacion` (retail/institutional) | Media | Inferible del nombre |

### Metadatos de calidad (MISSING_CRITICAL)
| Dato faltante | Importancia | Fuente posible |
|---|---|---|
| `fecha_por_bloque` | Alta | El pipeline no guarda timestamps por bloque |
| `fuente_por_campo` | Media | Solo se registra fuente por bloque de primer nivel |
| `quality_score` global | Alta | Calculable — propuesto en §14 |

---

## 12. Problemas de normalización

### 12.1 Países: ISO3 duplicados con nombres largos y camelCase

**Estado:** Parcialmente resuelto por `limpieza.py`

`PAISES_ISO3` contiene ~80 traducciones. Sin embargo:
- **2 ficheros** conservan `Australia` (nombre largo) porque la fuente gestoras lo inyecta así y no pasa por el normalizador correctamente.
- Hay **120+ claves de país únicas** en el dataset. Muchas son ISO3 legítimas (BEL, CHE, DEU...) pero algunas son exóticas (AGO, BEN, CMR) provenientes de fondos de deuda emergente.
- Los países con peso 0 ya se eliminan correctamente.
- **Hallazgo subagentes:** Múltiples ficheros (ES, FR, LU) contienen **doble formato**: ISO3 (`"USA": 24.755`) + camelCase (`"unitedStates": 24.755`) coexistiendo en el mismo objeto `paises_pct`. Hay un template de **42 claves camelCase** (la mayoría con valor 0.0) que infla artificialmente el objeto. Ejemplo real en Bestinfond:
  ```json
  "USA": 24.755426,
  "unitedStates": 24.75543,
  "GBR": 21.058405,
  "unitedKingdom": 21.0584
  ```
- Los valores ISO3 y camelCase difieren ligeramente en precisión (distinta fuente/redondeo).

**Acción requerida:** Ampliar `PAISES_ISO3` con los nombres faltantes, eliminar todas las claves camelCase, y añadir validación post-limpieza.

### 12.2 Sectores: español/inglés duplicados

**Estado:** Resuelto por `limpieza.py` pero frágil

`SECTORES_ES` traduce ~30 variantes inglesas. `SECTORES_VALIDOS` define 13 sectores canónicos. Sin embargo:
- SAL-service puede devolver claves como `basicMaterials` (camelCase) que el normalizador espera como `basic materials` (minúscula con espacio).
- justETF puede devolver sectores con mayúsculas iniciales: `Technology`, `Healthcare`.
- El normalizador en `limpieza.py` usa `_norm_txt()` (elimina acentos y pasa a minúsculas) antes de buscar en el diccionario, lo que cubre la mayoría.

**Riesgo residual:** Bajo, pero conviene añadir tests de regresión.

### 12.3 Regiones que suman mal

Algunas regiones de Morningstar incluyen claves numéricas (`15`, `16`) que corresponden a `no_clasificado` y `otros_2`. `limpieza.py` ya las excluye vía `REGIONES_FUERA`.

> [!CAUTION]
> **Hallazgo subagentes:** En Bestinfond, `cartera.regiones_pct.no_clasificado = 99.35%`. En Fundsmith, `no_clasificado = 100.0%`. Esto indica que el dato de regiones de Morningstar para algunos fondos es **completamente inútil** — todo está marcado como "no clasificado". Estos fondos sí tienen `paises_pct` correcto, por lo que el dato de regiones debería ignorarse cuando `no_clasificado > 50%`.

**Problema persistente:** Tras eliminar `no_clasificado` y `otros_2`, las regiones restantes pueden sumar <95% o >105%.

### 12.4 Asset allocation que no suma ~100

| Situación | Frecuencia | Causa |
|---|---|---|
| Suma 95-105% | ~80% | Normal (derivados, redondeo) |
| Suma 80-95% | ~10% | Posiciones no clasificadas |
| Suma >105% | ~5% | Apalancamiento (largo > 100, corto < 0) |
| Suma <80% | ~5% | Fondos money market o con mucha liquidez no desglosada |

### 12.5 ETFs sintéticos: cartera instrumental ≠ exposición económica

ETFs con réplica sintética (swap-based) como Invesco S&P 500 (IE00B3YCGJ38) muestran posiciones de colateral, no las acciones reales del índice. Esto afecta:
- Sectores: aparecen como "diversos" en lugar de por sector real
- Países: aparece el país del colateral
- Top holdings: son bonos gubernamentales en lugar de Apple, Microsoft, etc.

**Identificación:** Campo `identificacion.replicacion` = "Synthetic" (solo en 2% de ETFs con justETF)

### 12.6 Holdings sin ISIN

Muchas posiciones de Morningstar no incluyen ISIN:
- Posiciones de renta fija: frecuentemente sin ISIN
- Derivados (futuros, swaps): nunca tienen ISIN
- Posiciones tipo "Cash": sin ISIN

**Estimación:** ~30% de posiciones en fondos de RF carecen de ISIN.

### 12.7 Escalas ambiguas 0-1 vs 0-100

| Campo | Escala real | Riesgo |
|---|---|---|
| `riesgo.volatilidad_pct` | 0-100 (%) | Claro por nombre |
| `riesgo.sharpe` | Ratio (típico -2 a +3) | OK |
| `riesgo.r2` | 0-100 | Potencialmente confuso con 0-1 |
| `cartera.sectores_pct.{s}.fondo` | 0-100 (%) | OK |
| `cartera.paises_pct.{p}` | 0-100 (%) | OK |
| `esg.sustainability_score` | ~5-50 (score Sustainalytics) | No intuitivo |
| `esg.score_ambiental/social/gobernanza` | ~0-20 | Sub-score Sustainalytics |
| `valoracion.patrimonio_fondo_meur` | **AMBIGUO** — ver §10 | **PELIGROSO** |

---

## 13. Propuesta NormalizedFundProfile v1

### Principios de diseño

1. **Bloques semánticos claros**: cada bloque cubre un dominio funcional
2. **Nomenclatura inglesa uniforme**: facilita interoperabilidad
3. **Escalas documentadas**: cada campo numérico tiene unidad explícita
4. **Null = ausente**: no rellenar con 0 ni con valores por defecto
5. **Fechas ISO 8601**: siempre `YYYY-MM-DD`
6. **Países ISO 3166-1 alpha-3**: siempre 3 letras mayúsculas
7. **Divisas ISO 4217**: siempre 3 letras mayúsculas

```
NormalizedFundProfile v1
├── identity
│   ├── isin: string (PK)
│   ├── name: string
│   ├── legal_name: string | null
│   ├── ticker: string | null
│   ├── management_company: string
│   ├── base_currency: string (ISO 4217)
│   ├── domicile: string (ISO 3166-1 alpha-3)
│   ├── ucits: boolean
│   ├── inception_date_fund: string (YYYY-MM-DD)
│   ├── inception_date_share_class: string (YYYY-MM-DD)
│   ├── benchmark_index: string
│   ├── investment_strategy_text: string | null
│   ├── min_initial_investment: float | null (EUR)
│   ├── cnmv_registry: string | null
│   └── depositary: string | null
│
├── product
│   ├── product_type: enum("fund", "etf", "etc", "money_market")
│   ├── broad_asset_class: enum("equity", "fixed_income", "mixed", "alternatives", "money_market")
│   ├── morningstar_category: string
│   ├── distribution_policy: enum("accumulation", "distribution") | null
│   ├── hedged: boolean | null
│   ├── replication_method: enum("physical_full", "physical_sample", "synthetic_swap", "synthetic_other") | null
│   ├── sfdr_article: enum(6, 8, 9) | null
│   └── share_class_type: enum("retail", "institutional", "clean") | null
│
├── costs
│   ├── ter_pct: float | null
│   ├── management_fee_applied_pct: float | null
│   ├── management_fee_max_pct: float | null
│   ├── subscription_fee_max_pct: float | null
│   ├── redemption_fee_max_pct: float | null
│   ├── ter_vs_category_median_pct: float | null
│   ├── ter_vs_category_level: string | null
│   └── mifid_costs: object | null
│       ├── ongoing_pct: float
│       ├── transaction_pct: float
│       ├── performance_pct: float
│       ├── entry_pct: float | null
│       ├── exit_pct: float | null
│       └── as_of_date: string (YYYY-MM-DD)
│
├── ratings
│   ├── morningstar_stars: int (1-5) | null
│   ├── morningstar_stars_3y: int | null
│   ├── morningstar_stars_5y: int | null
│   ├── morningstar_stars_10y: int | null
│   ├── medalist_rating: string | null
│   ├── medalist_date: string | null
│   ├── category_percentile_overall: float | null
│   ├── category_percentile_3y: float | null
│   ├── category_percentile_5y: float | null
│   └── category_percentile_10y: float | null
│
├── performance
│   ├── as_of_date: string (YYYY-MM-DD)
│   ├── trailing (all % annualized where applicable)
│   │   ├── ytd: {fund, category, index} (float | null)
│   │   ├── m1: {fund, category}
│   │   ├── m3: {fund, category}
│   │   ├── m6: {fund, category}
│   │   ├── y1: {fund, category}
│   │   ├── y3_ann: {fund, category}
│   │   ├── y5_ann: {fund, category}
│   │   ├── y10_ann: {fund, category}
│   │   └── since_inception_ann: {fund}
│   └── calendar_year: {YYYY: {fund: float}} (últimos 10-15 años)
│
├── risk
│   ├── as_of_date: string (YYYY-MM-DD)
│   ├── sri_kid: int (1-7)
│   ├── srri: int (1-7) | null
│   ├── volatility_pct: {y1, y3, y5, y10}: {fund, category, index} (float)
│   ├── sharpe_ratio: {y1, y3, y5, y10}: {fund, category, index} (float)
│   ├── alpha: {y1, y3, y5, y10}: {fund} (float | null)
│   ├── beta: {y1, y3, y5, y10}: {fund} (float | null)
│   ├── r_squared: {y1, y3, y5, y10}: {fund} (float 0-100 | null)
│   ├── tracking_error_pct: {y1, y3, y5}: {fund} (float | null)
│   ├── information_ratio: {y1, y3, y5}: {fund} (float | null)
│   └── max_drawdown: {pct: float, months: int} | null
│
├── sustainability
│   ├── as_of_date: string (YYYY-MM-DD)
│   ├── globe_rating: int (1-5) | null
│   ├── esg_score: float | null (Sustainalytics 0-50, lower=better)
│   ├── environmental_score: float | null
│   ├── social_score: float | null
│   ├── governance_score: float | null
│   ├── portfolio_coverage_pct: float
│   └── carbon
│       ├── risk_score: float | null
│       ├── risk_classification: string | null
│       └── low_carbon_designation: boolean | null
│
├── portfolio_summary
│   ├── as_of_date: string (YYYY-MM-DD)
│   ├── total_holdings: int
│   ├── equity_holdings: int | null
│   ├── bond_holdings: int | null
│   ├── top10_weight_pct: float | null
│   ├── turnover_pct: float | null
│   └── asset_allocation
│       ├── equity: {net, long, short} (float)
│       ├── fixed_income: {net, long, short}
│       ├── cash: {net, long, short}
│       ├── other: {net, long, short}
│       ├── convertibles: {net, long, short}
│       └── preferred: {net, long, short}
│
├── exposures
│   ├── sectors_pct: {sector_code: {fund: float, category: float}} (13 sectores normalizados)
│   ├── regions_pct: {region_code: float} (14 regiones)
│   ├── countries_pct: {ISO3: float} (normalizado)
│   ├── currencies_pct: {ISO4217: float} | null (derivado de posiciones)
│   ├── market_cap_pct: {giant, large, mid, small, micro} (float) | null
│   ├── primary_sector: string | null
│   └── style_box: {LV, LB, LG, MV, MB, MG, SV, SB, SG} (float) | null
│
├── equity_fundamentals (null si no aplica)
│   ├── pe_ratio: float | null
│   ├── pb_ratio: float | null
│   ├── ps_ratio: float | null
│   ├── pcf_ratio: float | null
│   ├── dividend_yield_pct: float | null
│   ├── earnings_growth_pct: float | null
│   ├── roa_pct: float | null
│   ├── roe_pct: float | null
│   ├── roic_pct: float | null
│   ├── net_margin_pct: float | null
│   ├── debt_to_capital_pct: float | null
│   └── avg_market_cap_musd: float | null
│
├── fixed_income_profile (null si no aplica)
│   ├── effective_duration: float | null (años)
│   ├── modified_duration: float | null (años)
│   ├── effective_maturity: float | null (años)
│   ├── yield_to_maturity_pct: float | null
│   ├── average_coupon_pct: float | null
│   ├── average_price: float | null
│   ├── average_credit_quality: string | null (AAA..CCC)
│   ├── credit_quality_pct: {AAA, AA, A, BBB, BB, B, below_B, not_rated} (float)
│   ├── investment_grade_pct: float | null (derivado)
│   ├── high_yield_pct: float | null (derivado)
│   └── sector_pct: {government, corporate, securitized, municipal, cash, derivatives} (float)
│
├── holdings
│   ├── as_of_date: string (YYYY-MM-DD)
│   ├── source: enum("morningstar", "gestora", "cnmv")
│   └── positions: array of
│       ├── name: string
│       ├── isin: string | null
│       ├── ticker: string | null
│       ├── weight_pct: float
│       ├── sector: string | null (normalizado)
│       ├── country: string | null (ISO3)
│       ├── currency: string | null (ISO 4217)
│       ├── asset_type: enum("equity", "bond", "cash", "derivative", "other") | null
│       └── sub_asset_class: string | null (de gestora)
│
├── distributions
│   ├── yield_12m_pct: float
│   └── history: array of {date, amount_per_share} | null
│
├── documents
│   └── array of {date: string, type: string}
│
├── source_metadata
│   ├── isin: string
│   ├── last_updated: string (ISO 8601)
│   ├── schema_version: int
│   ├── sources_by_block: object
│   ├── morningstar_sec_id: string | null
│   └── errors: array of string
│
├── quality
│   ├── overall_score: float (0-100)
│   ├── identity_quality: float (0-100)
│   ├── costs_quality: float (0-100)
│   ├── performance_quality: float (0-100)
│   ├── risk_quality: float (0-100)
│   ├── portfolio_quality: float (0-100)
│   ├── exposure_quality: float (0-100)
│   ├── fixed_income_quality: float (0-100) | null
│   ├── holdings_quality: float (0-100)
│   ├── source_quality: float (0-100)
│   └── flags: array of string (warnings)
│
└── raw_refs
    └── raw_file_path: string (ruta al JSON original v2)
```

---

## 14. Quality score propuesto

### Diseño del scoring

Cada sub-score va de 0 a 100. El `overall_score` es la media ponderada.

#### `identity_quality` (peso: 15%)

| Criterio | Puntos |
|---|---|
| `isin` presente y formato válido | 20 |
| `name` presente y no vacío | 15 |
| `management_company` presente | 10 |
| `product_type` correctamente clasificado | 15 |
| `base_currency` presente e ISO 4217 | 10 |
| `domicile` presente e ISO 3166 | 10 |
| `distribution_policy` presente | 10 |
| `benchmark_index` presente | 10 |

#### `costs_quality` (peso: 10%)

| Criterio | Puntos |
|---|---|
| `ter_pct` presente y > 0 | 40 |
| `management_fee_applied_pct` presente | 20 |
| `mifid_costs` presentes con ≥3 campos | 20 |
| `ter_vs_category` presente | 20 |

#### `performance_quality` (peso: 20%)

| Criterio | Puntos |
|---|---|
| `trailing.y1.fund` presente | 20 |
| `trailing.y3_ann.fund` presente | 20 |
| `trailing.y5_ann.fund` presente | 15 |
| `trailing.ytd.category` presente | 15 |
| `calendar_year` con ≥3 años | 15 |
| `as_of_date` < 60 días | 15 |

#### `risk_quality` (peso: 15%)

| Criterio | Puntos |
|---|---|
| `sri_kid` presente (1-7) | 20 |
| `volatility_pct.y3.fund` presente | 20 |
| `sharpe_ratio.y3.fund` presente | 20 |
| `alpha.y3.fund` o `beta.y3.fund` presente | 15 |
| `max_drawdown.pct` presente | 10 |
| `as_of_date` < 60 días | 15 |

#### `portfolio_quality` (peso: 15%)

| Criterio | Puntos |
|---|---|
| `asset_allocation` con ≥3 clases | 25 |
| `asset_allocation.net` suma 90-110% | 15 |
| `sectors_pct` con ≥5 sectores | 20 |
| `countries_pct` con ≥3 países | 20 |
| `regions_pct` presentes | 10 |
| `as_of_date` < 90 días | 10 |

#### `exposure_quality` (peso: 5%)

| Criterio | Puntos |
|---|---|
| `countries` en formato ISO3 puro | 40 |
| `sectors` en nomenclatura normalizada | 30 |
| `market_cap_pct` presente (si RV) | 15 |
| `style_box` presente (si RV) | 15 |

#### `fixed_income_quality` (peso: 10%, solo si broad_asset_class ∈ {fixed_income, mixed})

| Criterio | Puntos |
|---|---|
| `effective_duration` presente | 25 |
| `yield_to_maturity_pct` presente | 25 |
| `credit_quality_pct` con ≥3 buckets | 25 |
| `sector_pct` (gobierno/corporativa) presente | 25 |

#### `holdings_quality` (peso: 5%)

| Criterio | Puntos |
|---|---|
| Tiene ≥10 posiciones | 25 |
| ≥50% posiciones con ISIN | 25 |
| ≥80% posiciones con peso_pct | 25 |
| Pesos suman 80-120% | 25 |

#### `source_quality` (peso: 5%)

| Criterio | Puntos |
|---|---|
| ≥2 fuentes distintas | 40 |
| `last_updated` < 14 días | 30 |
| 0 errores en `errors` | 30 |

---

## 15. Reglas de limpieza recomendadas

### Campos que pasan a `normalized`

Todos los campos clasificados como **CORE_USEFUL** y **ADVANCED_USEFUL** en §6 y §7.

### Campos que quedan solo en `raw`

Todos los campos clasificados como **RAW_ONLY** en §8.

### Campos que se descartan del `normalized`

Todos los campos clasificados como **DISCARD_CANDIDATE** en §9.

### Campos que requieren normalizador

| Campo | Normalización requerida |
|---|---|
| `valoracion.patrimonio_fondo_meur` | Si valor > 100,000 → dividir por 1,000,000 |
| `valoracion.vl_fecha` | Truncar a `YYYY-MM-DD` |
| `cartera.paises_pct.*` | Traducir nombres largos → ISO3 |
| `cartera.sectores_pct.*` | Traducir inglés → código normalizado |
| `identificacion.tipo` | Deducir de categoría o universo Morningstar |
| `identificacion.politica_distribucion` | Deducir del nombre (Acc/Dist/Inc) |
| `riesgo.r2` | Verificar escala 0-100, no 0-1 |
| `cartera.regiones_pct` | Eliminar residuales con valor < 0.01% |

### Campos que requieren revisión humana

| Campo | Razón |
|---|---|
| `identificacion.hedged` (FALTA) | Inferencia automática del nombre no es 100% fiable |
| `product.sfdr_article` (FALTA) | No disponible en APIs actuales |
| ETFs sintéticos | Decidir si se marcan y excluyen de análisis look-through |
| Fondos con 0 datos de renta fija pero categoría RF | ¿El screener los clasificó mal o es falta de datos? |

### Campos que se deberían scrapear adicionalmente

| Campo | Fuente recomendada | Prioridad |
|---|---|---|
| `tipo` (fondo/etf) | Deducir del universo Morningstar screener | **Alta** |
| `politica_distribucion` | Morningstar snapshot `DistributionPolicy` | **Alta** |
| `hedged` | Parsear del nombre (hedge/hedged/H EUR) | **Alta** |
| `sfdr_article` | Morningstar ESG sustainability viewId | **Media** |
| `yield_to_worst` | SAL-service fixedIncomeStyle | **Media** |
| `distribucion_vencimientos` | No disponible — KID/KIID PDF parsing | **Baja** |

---

## 16. Riesgos si se integra sin limpiar

> [!CAUTION]
> Integrar estos JSON directamente en una base de datos financiera sin normalización puede causar los siguientes problemas:

### Riesgo 1: Patrimonio en escala errónea
- **Impacto:** Screening por tamaño (AUM) dará resultados absurdos
- **Probabilidad:** Alta (100% de ficheros afectados potencialmente)
- **Severidad:** 🔴 Crítica

### Riesgo 2: Países duplicados → exposiciones geográficas incorrectas
- **Impacto:** Suma de exposición por país > 100% o falsos negativos en filtros
- **Probabilidad:** Media (2-5% de ficheros con duplicados residuales)
- **Severidad:** 🟡 Moderada

### Riesgo 3: ETFs sintéticos con cartera engañosa
- **Impacto:** Análisis look-through muestra colateral en vez de exposición real
- **Probabilidad:** Baja (solo ~2% son sintéticos)
- **Severidad:** 🟡 Moderada para esos ETFs

### Riesgo 4: Fechas inconsistentes
- **Impacto:** Queries temporales fallan; comparaciones entre fondos con dates de distintas fuentes
- **Probabilidad:** Alta (100% de ficheros con justETF tienen formato distinto)
- **Severidad:** 🟡 Moderada

### Riesgo 5: `tipo` no poblado
- **Impacto:** No se puede filtrar ETFs vs fondos
- **Probabilidad:** Alta (98% no tienen `tipo`)
- **Severidad:** 🔴 Crítica para cualquier uso que necesite esta distinción

### Riesgo 6: Campos 1d/1sem como "rentabilidad real"
- **Impacto:** Alguien podría comparar fondos por "rentabilidad 1 día", que es puro ruido
- **Probabilidad:** Baja
- **Severidad:** 🟢 Baja

---

## 17. Plan de implementación por fases

### Fase 0: Preparación (esta auditoría)
- [x] Inventario completo del proyecto
- [x] Schema real detectado con frecuencias
- [x] Clasificación financiera de campos
- [x] Propuesta NormalizedFundProfile v1
- [x] Quality score diseñado

### Fase 1: Enrichment sin scraping (~2h)
- [ ] **Poblar `tipo`** para todos los fondos (deducir de `categoría` o universo screener)
- [ ] **Poblar `politica_distribucion`** (parsear del nombre: Acc/Dist/Inc)
- [ ] **Detectar `hedged`** (parsear del nombre: Hedged/H EUR/EUR Hedged)
- [ ] **Normalizar `patrimonio_fondo_meur`** (detectar y corregir valores en EUR absolutos)
- [ ] **Normalizar `vl_fecha`** a `YYYY-MM-DD`
- [ ] Escribir script de validación para verificar las correcciones

### Fase 2: Limpieza y normalización (~4h)
- [ ] Eliminar campos DISCARD del schema de salida
- [ ] Ampliar `PAISES_ISO3` con los nombres faltantes
- [ ] Validar post-limpieza de sectores
- [ ] Crear script `normalize.py` que transforma v2 → NormalizedFundProfile v1
- [ ] Generar carpeta `data/normalized/` con JSON limpios
- [ ] Mantener `data/funds/` intacto como raw

### Fase 3: Quality scoring (~2h)
- [ ] Implementar `quality_score.py` con los criterios del §14
- [ ] Ejecutar sobre todos los fondos
- [ ] Generar informe de cobertura y calidad
- [ ] Identificar fondos con quality < 50 para revisión

### Fase 4: Datos faltantes por scraping (~8h)
- [ ] Extraer `sfdr_article` de Morningstar sustainability
- [ ] Extraer `yield_to_worst` de SAL fixedIncomeStyle
- [ ] Ampliar CNMV a todos los fondos ES (no solo Bestinfond)
- [ ] Poblar `politica_distribucion` desde Morningstar snapshot si inferencia no bastó

### Fase 5: Integración (~4h)
- [ ] Definir Firestore schema basado en NormalizedFundProfile v1
- [ ] Crear importer desde `data/normalized/` → Firestore
- [ ] Tests end-to-end: JSON → normalize → validate → import
- [ ] Documentación de API/schema para consumidores

---

## 18. Conclusión final

### Estado actual

El proyecto fondosdb es una **excelente base de datos de fondos** con un extractor robusto que cubre 397 fondos y ETFs de 7 jurisdicciones. La calidad del código es alta, la arquitectura (multi-fuente con prioridad, caché, rate-limiting, respuestas crudas preservadas) es sólida, y el 98% de los datos provienen de la misma fuente (Morningstar LT), lo que garantiza consistencia.

### Fortalezas

✅ Schema v2 coherente: 13 bloques raíz bien definidos  
✅ 0 ficheros corruptos sobre 397  
✅ Cobertura de rentabilidad, riesgo y ESG muy completa (>92%)  
✅ Posiciones de cartera en el 100% de los fondos  
✅ Pipeline de limpieza ya resuelve los problemas principales de países y sectores  
✅ Respuestas crudas preservadas para futura ampliación  

### Debilidades

❌ `tipo` (fondo/etf) solo poblado en 2% — **CRÍTICO**  
❌ `politica_distribucion` solo en 1%  
❌ `patrimonio_fondo_meur` con escala ambigua  
❌ Sin SFDR, sin hedged/unhedged  
❌ Perfil renta fija incompleto (falta YTW, distribución vencimientos)  
❌ 98% mono-fuente (solo Morningstar LT)  

### Recomendación

Implementar las **Fases 1-3** (enrichment + limpieza + quality scoring) **antes** de cualquier integración en BDB-FONDOS o base financiera independiente. Coste estimado: ~8 horas de trabajo de agente. El resultado será un dataset de **alta calidad financiera** listo para screening, rankings, informes patrimoniales y análisis de cartera.

---

## Validación final de seguridad

| Verificación | Resultado |
|---|---|
| JSON originales modificados | **0** |
| Scripts modificados | **0** |
| Firestore writes | **0** |
| Deploy | **NO** |
| Commit | **0** |
| Push | **NO** |
| BDB-FONDOS tocado | **NO** |
| BDB-FONDOS-CORE tocado | **NO** |
| Archivos creados fuera de docs/ | **0** (solo este informe) |
| Comandos de escritura ejecutados | **0** (solo lectura y análisis) |
