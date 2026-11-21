# Programa de datos públicos de fondos: informe detallado

| | |
|---|---|
| **Fecha** | 28 de septiembre de 2026 |
| **Estado** | Diseño. No se ha escrito ni ejecutado código. |
| **Alcance** | Fondos y ETF (fase 1). Acciones en una fase posterior. |
| **Documentos relacionados** | `FUENTES_PUBLICAS_FONDOS_2026-09-28.md` (investigación de fuentes) · `PROGRAMA_DATOS_PUBLICOS_FONDOS_2026-09-28.md` (resumen del diseño) · `DESCUBRIMIENTO_ADQUISICION_DATOS_2026-09-04.md` · `1-extractor/docs/ADQUISICION_2026-09-04.md` |

---

## Índice

1. Resumen ejecutivo
2. Situación actual
3. Objetivos, alcance y criterios de éxito
4. Catálogo de datos
5. Fuentes: ficha técnica de cada una
6. Inventario por gestora y olas
7. Arquitectura del programa
8. Lectura de fichas mensuales
9. Normalización
10. Exposición calculada desde cartera completa (fondos españoles)
11. Fusión y procedencia
12. Validación y calidad
13. Contrato de salida
14. Integración con la plataforma y la app
15. Operación
16. Pruebas y verificación
17. Transición y baja de proveedores
18. Qué se pierde y cómo se sustituye
19. Riesgos y mitigaciones
20. Plan por fases
21. Decisiones pendientes
22. Anexos

---

## 1. Resumen ejecutivo

**Qué se propone.** Un programa independiente, en Python, que obtiene **todos los datos fundamentales de los fondos y ETF solo de documentación pública y gratuita**. Esa documentación la publica la gestora (KID, ficha mensual, informes periódicos, plantillas FinDatEx) o un organismo oficial (CNMV, CSSF, ESMA, AMF, GLEIF). El programa entrega una ficha por ISIN que la plataforma de datos carga en la maestra sin cambios en la app.

**Reparto final de fuentes:**

| Dato | Fuente |
|---|---|
| Serie diaria de valor liquidativo (todos los domicilios) | **EODHD**, plan «EOD All World» |
| Rentabilidades, volatilidad, Sharpe, drawdown, correlaciones, frontera | **Cálculo propio** desde la serie (ya lo hace la app) |
| Identidad, datos regulatorios, costes, composición, perfil de renta fija, clasificación | **Este programa** |

**Qué se consigue:**

- Se elimina la dependencia de la API interna de Morningstar, que no está licenciada, ya se cayó una vez y hoy aporta el 84 % de los campos.
- Se puede prescindir del plan de fundamentales de EODHD para fondos.
- Cada dato lleva su documento de origen y su fecha, así que es verificable ante un cliente.

**Lo que no se puede sustituir:**

- La categoría, las estrellas y el medalist de Morningstar, los globos ESG y la huella de carbono. Son productos propietarios.
- La serie diaria de VL de los fondos extranjeros. Por eso se queda EODHD.

**Viabilidad.** Verificada con 10 fondos reales de la base:

- La **composición** es pública en ~7 de cada 10 gestoras.
- Los **informes con cartera completa**, en ~9 de cada 10.
- Los **datos regulatorios y de costes** ya se obtienen hoy de fuentes oficiales para el 71 % de los fondos.

El trabajo principal es leer las fichas mensuales, cuyo formato es distinto en cada gestora, y **normalizar** sus clasificaciones.

---

## 2. Situación actual

### 2.1 Universo

Hay 840 fichas en `1-extractor/data/funds/`: **766 fondos y ETF** y 74 acciones.

| Domicilio | Fondos y ETF |
|---|---:|
| Luxemburgo (LU) | 547 |
| España (ES) | 89 |
| Irlanda (IE) | 77 |
| Francia (FR) | 40 |
| Otros (FI, BE, DE) | 13 |

Son **119 gestoras**. Las 10 primeras reúnen el 42,6 % de los fondos y las 25 primeras, el 69 %.

### 2.2 Procedencia actual de los datos

Medida sobre `meta.procedencia`, contando todas las hojas del esquema v2:

| Fuente | Hojas | % | Naturaleza |
|---|---:|---:|---|
| morningstar_lt | 175.935 | 84 % | API interna de la web de Morningstar, no licenciada |
| derivado | 10.243 | 5 % | Cálculo propio (calidad, divisas de cartera, cobertura) |
| kid_gestora | 6.066 | 3 % | KID del productor (oficial) |
| esma | 5.910 | 3 % | Registro oficial |
| cssf | 4.920 | 2 % | Registro oficial |
| cnmv + cnmv_ficha | 6.224 | 3 % | Regulador |
| gleif, amf_geco | 1.060 | 0,5 % | Registros oficiales |
| eodhd | 55 | < 0,1 % | Identidad de cotización de ETF |

Las **series de VL** van por otro camino: EODHD → `assets/{id}/price_series` en Firestore (backfill del 11-09).

### 2.3 Lo que ya está resuelto (extractor, 4 y 5 de septiembre)

- Adaptadores oficiales con capacidades declaradas: `cnmv`, `cnmv_ficha`, `cssf`, `esma`, `amf_geco`, `gleif` y `kid_gestora`.
- Lector de KID (`core/kid.py`) en español, inglés y francés. Lee los costes por coordenadas y el SRI de la prosa o del gráfico 1-7.
- Localizador de KID por gestora: DWS, Amundi, JPMorgan (Fundsquare), Invesco, Nordea, Candriam, Goldman Sachs, Schroders y M&G, más el espejo de Deutsche Bank España.
- Procedencia por campo, TTL por familia de dato, correcciones manuales en origen y comparación campo a campo de canónicos.

### 2.4 Lo que sigue dependiendo de Morningstar (lo que la app usa)

| Bloque de la app | Campos hoy de Morningstar |
|---|---|
| `pms_exposure` | Reparto RV, RF, liquidez y otros |
| `exposure_detail` | Sectores, regiones RV, estilo, capitalización |
| `fixed_income_profile` | Duración, rating medio, calidad crediticia, vencimientos, TIR, sectores de RF |
| `holdings_summary` | Top 10, nº de posiciones, peso del top 10, fecha de cartera |
| `costs` | TER, comisión de gestión, MiFID ex ante |
| `classification` | Categoría Morningstar (base de `commercial_type`), estrellas |
| Identidad | Gestora comercial, nombre, índice de referencia, fechas de lanzamiento |

### 2.5 Hallazgos que condicionan el diseño

1. **`capacidades --sin morningstar_lt` da una falsa tranquilidad.** Dice «0 rutas sin fuente» porque cuenta como respaldo a `morningstar` (mstarpy), que es el mismo proveedor. Con `--sin morningstar_lt,morningstar,eodhd` se quedan **63 rutas sin fuente**.
2. **La composición no tiene respaldo real.** El respaldo declarado de `cartera.*` es `gestoras`, que solo cubre los ETF de iShares configurados en `config/gestoras.csv`. Para unos 660 fondos no españoles, si cae Morningstar, la app se queda sin exposición y el optimizador sin sus restricciones.
3. **221 de 766 fondos (29 %) no tienen KID.** Los más afectados son BlackRock (18), Andbank (18), Fidelity (13), BNP Paribas (8), Allianz GI (8), PIMCO (7), Groupama, iShares, Goldman Sachs, Nordea y Carmignac (6 cada una).
4. **La CNMV publica sus ficheros XML con unos 4 meses de retraso.** A 28-09-2026, el último mes disponible es mayo de 2026.

---

## 3. Objetivos, alcance y criterios de éxito

### 3.1 Objetivos

1. Obtener, de fuentes públicas y gratuitas, todos los campos fundamentales de fondos y ETF que consume la app.
2. Que cada dato sea trazable: fuente, URL del documento, huella SHA-256 y fecha del dato.
3. Que un fallo de una gestora o de una fuente no deje fichas vacías: fuente de respaldo, datos del mes anterior marcados como tales y cola de revisión.
4. No tocar la app. El programa entrega el mismo contrato que hoy alimenta la maestra.

### 3.2 Fuera de alcance (fase 1)

- Precios y series (EODHD).
- Acciones: fase 2, con SEC EDGAR y ESEF/XBRL.
- Métricas de riesgo y rentabilidad (las calcula la app).
- Analítica propietaria de Morningstar.

### 3.3 Criterios de éxito (medibles)

| Indicador | Objetivo |
|---|---|
| Fondos con SRI y gastos corrientes de fuente oficial | ≥ 95 % (hoy 71 %) |
| Fondos con reparto por clase de activo de fuente pública | ≥ 90 % |
| Fondos RV con regiones y sectores normalizados | ≥ 85 % |
| Fondos RF con duración y rating medio | ≥ 70 % |
| Antigüedad media de la composición | ≤ 60 días |
| Concordancia con Morningstar durante la transición | ≥ 90 % de fondos dentro de tolerancia (ver 16.3) |
| Campos que entran en la maestra sin validar | 0 |

---

## 4. Catálogo de datos

Destino = bloque de `master/asset.v1.1` y de `read/asset-for-bdb.v1`. **F** = familia de dato y TTL: identidad 365 d · regulatorio 90 d · costes 90 d · cartera 30 d.

### 4.1 Identidad y datos regulatorios

| Campo | Destino | Fuente principal | Respaldo | F | Obligatorio |
|---|---|---|---|---|---|
| ISIN | `identifiers.isin` | Universo | – | – | Sí |
| Nombre legal de la clase | `identity.name` | CSSF / CNMV / AMF / ESMA | KID | identidad | Sí |
| Gestora comercial | `product.fund_name` / marca | KID (productor) | Ficha mensual | identidad | Sí |
| Gestora legal y LEI | `regulatory.management_company_legal` | ESMA / CNMV / AMF | GLEIF | identidad | Sí |
| Divisa de la clase | `identity.currency` | CSSF / CNMV | KID, ficha | identidad | Sí |
| Clase cubierta | `classification` (derivado) | Nombre legal (regla «Hedged», «H») | Ficha | identidad | Sí |
| Acumulación o distribución | identidad | Nombre legal / AMF | KID, ficha | identidad | Sí |
| Domicilio | `regulatory.domicile` | Prefijo del ISIN + registro | GLEIF | identidad | Sí |
| UCITS / AIF | `regulatory.ucits`, `legal_framework` | CSSF / ESMA / CNMV | KID | identidad | Sí |
| Fecha de lanzamiento de la clase | `regulatory.launch_date_class` | AMF / CNMV / ficha | KID | identidad | No |
| Índice de referencia | identidad | Ficha mensual | KID (objetivo) | identidad | No |
| SRI 1-7 | `regulatory.sri` | KID | EPT | regulatorio | Sí |
| Periodo de mantenimiento recomendado | regulatorio | KID | EPT | regulatorio | Sí |
| Artículo SFDR (6/8/9) | `regulatory.sfdr_article` | KID / EET | Ficha | regulatorio | Sí |
| Objetivo y política (texto) | regulatorio | KID | Ficha | regulatorio | Sí (entra en la clasificación) |

### 4.2 Costes

| Campo | Destino | Fuente principal | Respaldo | F | Obligatorio |
|---|---|---|---|---|---|
| Gastos corrientes (≈ TER) | `costs.ter_pct` | KID («comisiones de gestión y otros costes administrativos o de funcionamiento») | Ficha, EMT, CNMV FONDTRIM | costes | Sí |
| Costes de operación | `regulatory.mifid_ex_ante_costs.transaction_pct` | KID | EMT | costes | Sí |
| Comisión de éxito | costes | KID | Folleto | costes | Sí |
| Comisión de gestión | `costs.management_fee_pct` | Ficha mensual | Folleto, CNMV (fondos ES), EMT | costes | Sí |
| Comisiones de entrada y salida máximas | costes | KID | Ficha | costes | No |
| Costes corrientes MiFID ex ante | `costs.mifid_ongoing_pct` | EMT | KID (gastos corrientes) | costes | No |

**Regla que se mantiene del extractor:** la comisión de gestión **nunca se imputa desde el TER**. Si solo hay un máximo declarado, se usa con un aviso.

### 4.3 Composición y cartera

| Campo | Destino | Fuente principal | Respaldo | F | Obligatorio |
|---|---|---|---|---|---|
| Reparto por clase de activo | `pms_exposure` / `portfolio_exposure_v2.asset_mix` | Ficha mensual | CNMV (fondos ES, calculado), informe semestral | cartera | Sí |
| Regiones RV | `exposure_detail.equity_regions` | Ficha (países o regiones) | Cartera completa | cartera | Sí (fondos con RV) |
| Sectores RV (11 GICS) | `exposure_detail.sectors` | Ficha | Cartera completa + clasificación de emisores | cartera | Sí (fondos con RV) |
| Países principales | detalle | Ficha | – | cartera | No |
| Capitalización y estilo | `market_caps`, `equity_styles` | Ficha (si lo trae) | – | cartera | No |
| Top 10 posiciones con peso | `holdings_top10` | Ficha | Cartera completa | cartera | Sí |
| Nº de posiciones, peso del top 10 | `holdings_summary` | Ficha | Cartera completa | cartera | Sí |
| Fecha de la cartera | `holdings_summary.as_of_date` | Ficha | – | cartera | Sí |

### 4.4 Perfil de renta fija

| Campo | Destino | Fuente principal | Respaldo | Obligatorio |
|---|---|---|---|---|
| Duración efectiva o modificada | `fixed_income_profile` | Ficha mensual | Informe semestral | Sí (fondos RF) |
| Rating medio | ídem | Ficha | – | Sí (fondos RF) |
| Reparto por rating | ídem / `credit` | Ficha | – | Importante |
| Reparto por tipo (gobierno, corporativo, HY, EM, titulizado) | `bond_types` | Ficha | Cartera completa | Importante |
| Tramos de vencimiento o duración | `duration` | Ficha | – | Importante |
| TIR / yield to worst | ídem | Ficha | – | No |

### 4.5 Clasificación propia

Sustituye a la categoría Morningstar. Se calcula dentro del programa (ver 9.6).

| Campo | Destino | Se calcula desde |
|---|---|---|
| Tipo de activo | `classification_v2.asset_type` | Reparto por clase + objetivo del KID + vocación CNMV |
| Región principal | `region_primary` | Regiones RV o RF |
| Tipo de RF | `fixed_income_type` | Reparto por tipo + nombre + objetivo |
| Tramos de crédito y duración | `credit_bucket`, `duration_bucket` | Perfil RF |
| Etiquetas de estrategia | `strategy_tags` | Nombre, objetivo, índice de referencia (sectorial, temático, índice, mixto…) |
| Complejidad del vehículo | `vehicle_complexity` | UCITS/AIF, uso de derivados (KID) |

---

## 5. Fuentes: ficha técnica de cada una

### 5.1 CNMV: ficheros XML de información individual

- **Dónde:** <https://www.cnmv.es/portal/publicaciones/descarga-informacion-individual?lang=es> ([descripción de los ficheros](https://www.cnmv.es/DocPortal/Estadisticas/Descarga-Informacion-Individual/Periodicidad-Descripcion.pdf))
- **Formato:** ZIP con XML y esquema XSD. Enlaces `webservices/verdocumento/ver?e=<token>`: no se pueden deducir, hay que leer la página índice.
- **Cobertura:** fondos y SICAV españoles, con compartimentos y clases, desde 2012.
- **Retraso:** unos 4 meses (último disponible: mayo de 2026).

| Fichero | Periodicidad | Uso en el programa |
|---|---|---|
| FONDREGISTRO | Mensual | Identidad, clases, gestora y depositaria |
| FONDMENS | Mensual | VL diario, patrimonio y partícipes (histórico y respaldo de EODHD) |
| FONDTRIM | Trimestral | Comisiones de gestión y depósito, gastos, rentabilidades |
| FONDPATRIMDISVAR | Trimestral | Distribución del patrimonio |
| FONDCART | Trimestral | **Cartera contado valor a valor** |
| FONDDERI | Trimestral | Cartera de derivados |
| SOC* | Trimestral | Equivalentes para SICAV |

**Estado:** adaptador `cnmv` existente. Hay que migrarlo y ampliar el cálculo de exposición desde FONDCART (sección 10).

### 5.2 CNMV: ficha del fondo y KID

- **Dónde:** `cnmv.es/Portal/Consultas/IIC/Fondo.aspx?isin={ISIN}`, que redirige al NIF del fondo. `vista=1` lleva a los informes periódicos (PDF y XBRL) y `vista=2` a los compartimentos y el KID.
- **Da:** nº y fecha de registro, gestora y depositaria, folleto, KID por clase e informes semestrales o trimestrales.
- **Estado:** adaptador `cnmv_ficha` existente (migrar).

### 5.3 CSSF (Luxemburgo)

- **Dónde:** [OPC_COMP_TP_TOUS_OUVERTS.zip](https://www.cssf.lu/wp-content/uploads/OPC_COMP_TP_TOUS_OUVERTS.zip), fichero mensual.
- **Da:** paraguas, compartimento, clase, divisa, UCITS y fecha de autorización. Hoy cubre 547 fondos.
- **Estado:** existente (migrar). Además es la **llave para construir URLs** de gestoras que usan el nombre legal (Schroders, M&G).

### 5.4 ESMA

- **Da:** marco UCITS/AIF, gestora legal, estado del registro y países de comercialización (585 fondos).
- **Estado:** existente (migrar).

### 5.5 AMF GECO (Francia)

- **Da:** gestora y LEI, OPCVM/FIA, depositario, clasificación AMF, forma jurídica, KID y, según su documentación, histórico de VL exportable.
- **Estado:** existente (migrar).

### 5.6 GLEIF

- **Da:** LEI, nombre legal, jurisdicción y gestora. Es una API pública y abierta.
- **Estado:** existente (migrar).

### 5.7 KID PRIIPs de la gestora

- **Da:** SRI, periodo recomendado, costes de entrada y salida, gastos corrientes, costes de operación, comisión de éxito, objetivo y escenarios. Enlaza a la rentabilidad pasada (hasta 10 años) en un documento aparte.
- **Localización:** patrón de la gestora por ISIN o por nombre legal. Espejo de último recurso: `servicios.deutsche-bank.es/documentacionfondos/getDocumento?codDoc={ISIN}&idioma=ES&codSus=KIID&codCont=NA`.
- **Guardas existentes:** se rechaza el PDF si habla de otro ISIN (Franklin sirve el mismo documento sea cual sea el ISIN) o si no trae SRI ni costes, y se rechaza la respuesta si no es un PDF. Los fallos se recuerdan 30 días.
- **Ampliación necesaria:** patrones para BlackRock/iShares, Fidelity, BNP Paribas, Allianz GI, PIMCO, Groupama y Carmignac (ver sección 6).

### 5.8 Ficha mensual de la gestora (factsheet), **nueva**

- **Da:** composición, top 10, perfil de RF, gastos corrientes, comisión de gestión, patrimonio e índice de referencia.
- **Formato:** PDF de 2-4 páginas, a menudo a dos columnas, con gráficos cuyas cifras suelen ir también en texto o tabla.
- **Publicación:** entre 2 y 6 semanas después del cierre de mes.
- **Patrones verificados:**

| Gestora | URL | Por ISIN |
|---|---|---|
| Fidelity | `https://www.fidelityinternational.com/FILPS/Documents/en/current/ret.en.xx.{ISIN}.pdf` (profesional: `pro.en.xx.{ISIN}.pdf`) | Sí |
| Pictet | `https://documents.am.pictet/?cat=marketing-permalink&isin={ISIN}&dtyp=FCL_RME&dla=en&dcty=FR&audience=INSTITUTIONAL` | Sí |
| Carmignac | `https://www.carmignac.com/assets/yoda/FLF_{COD}_{ISIN}_INT_en/Monthly-Factsheet_{nombre}_{ISIN}_INT_en.pdf` | ISIN + código de fondo + nombre |
| BlackRock | `https://www.blackrock.com/lu/individual/literature/fact-sheet/{nombre}-factsheet-{isin}-lu-en-individual.pdf` | ISIN + nombre |
| DWS | `https://download.dws.com/download/asset/{uuid}` (siempre la última) | No: tabla de enlaces fijos |
| Robeco | `https://www.robeco.com/doca/{COD}-fact-{AAAAMM}-profgloben.pdf` | No: código de fondo |

### 5.9 Datos estructurados de la gestora, **nuevo**

| Gestora | Recurso | Da |
|---|---|---|
| JPMorgan | `am.jpmorgan.com/FundsMarketingHandler/product-data?cusip={ISIN}&country=lu&role=per&language=en` (JSON) | Desgloses, posiciones, comisión de gestión, URL de ficha y KID |
| BlackRock / iShares | `blackrock.com/.../{id_producto}/fund/{id}.ajax?fileType=xls&dataType=fund` (Excel) | Posiciones y, probablemente, histórico de VL |
| iShares (ETF) | CSV diario de posiciones | Ya integrado en `gestoras` |

Cuando existen, **tienen prioridad sobre el PDF**: son más fiables y no hace falta extraer texto.

### 5.10 Plantillas FinDatEx (EMT, EPT, EET), **nuevo**

- **Da:**
  - **EMT:** costes ex ante y ex post, mercado objetivo y SRI.
  - **EPT:** escenarios PRIIPs y costes.
  - **EET:** artículo SFDR, % sostenible, PAI.
- **Formato:** Excel o CSV con columnas normalizadas por el estándar, idénticas entre gestoras.
- **Publicación abierta verificada:** [Schroders](https://www.schroders.com/en-lu/lu/professional/literature/european-esg-template-european-priips-template-european-mifid-template-data/), [Columbia Threadneedle](https://www.columbiathreadneedle.com/en/gb/intermediary/regulatory-templates/) y [M&G](https://www.mandg.com/priips-and-mifid-ii).
- **Valor:** una sola descarga cubre todos los fondos de la gestora. Es la mejor fuente de costes cuando existe. **No trae composición.**

### 5.11 Informe anual y semestral, respaldo

- **Da:** inventario completo de cartera por compartimento.
- **Formato:** PDF del paraguas, de cientos de páginas. La cartera va en tablas.
- **Uso:** respaldo de composición cuando no hay ficha (Schroders, Invesco) y verificación de concentraciones. Se descarga dos veces al año. Es lectura costosa y se deja para la ola 4.

### 5.12 Fuentes descartadas

| Fuente | Motivo |
|---|---|
| Morningstar (web y API interna) | Sus condiciones prohíben el uso «on behalf of… financial services… or their clients»; no licenciada |
| Investing.com | Sus condiciones exigen permiso escrito |
| onvista | Exige autorización para el rastreo |
| Quefondos / VDOS | Su robots.txt bloquea `/quefondos/` y `/vdos-quefondos/` |
| FT markets | Endpoints no oficiales; bloquea a clientes automáticos |
| Fundsquare | Exige login para precios y documentos (salvo el servicio de KID de JPMorgan) |

---

## 6. Inventario por gestora y olas

Situación del KID tomada de la base actual. La ficha mensual está verificada con un fondo o pendiente de verificar.

| # | Gestora | Fondos | % acum. | KID hoy | Ficha mensual | Estructurado | Dificultad | Ola |
|---|---|---:|---:|---|---|---|---|---|
| 1 | Andbank | 47 | 6,1 | Parcial (18 sin KID) | ES: CNMV; LU: por verificar | CNMV XML (ES) | Media | 1-2 |
| 2 | BlackRock | 47 | 12,3 | Parcial (18 sin KID) | **Verificada** (ISIN + nombre) | Excel por producto | Media | 2 |
| 3 | Fidelity International | 47 | 18,4 | Parcial (13 sin KID) | **Verificada** (ISIN) | – | Baja | 2 |
| 4 | Schroders | 39 | 23,5 | Sí (patrón propio) | **No localizada** (JavaScript) | EMT/EET abiertas | Alta | 2 (costes) / 4 (composición) |
| 5 | JPMorgan | 31 | 27,5 | Sí (Fundsquare) | **Verificada** | **JSON por ISIN** | Baja | 2 |
| 6 | Amundi | 28 | 31,2 | Sí | Por verificar | – | Media | 2 |
| 7 | DWS | 27 | 34,7 | Sí | **Verificada** (enlace fijo) | – | Media | 2 |
| 8 | Invesco | 22 | 37,6 | Sí | **No** (perfil obligatorio, 404) | – | Alta | 2 (reintento) / 4 |
| 9 | Allianz GI | 20 | 40,2 | Parcial (8 sin KID) | Por verificar | – | Media | 2 |
| 10 | BNP Paribas | 18 | 42,6 | Parcial (8 sin KID) | Por verificar | – | Media | 2 |
| 11 | Robeco | 18 | 44,9 | Espejo | Existe (código de fondo) | – | Media | 3 |
| 12 | Goldman Sachs | 18 | 47,3 | Sí | Por verificar | – | Media | 3 |
| 13 | Nordea | 18 | 49,6 | Sí | Por verificar | – | Media | 3 |
| 14 | M&G | 17 | 51,8 | Sí | Por verificar | EMT/EET abiertas | Media | 3 |
| 15 | Morgan Stanley | 15 | 53,8 | Espejo | Por verificar | – | Media | 3 |
| 16 | UBS | 14 | 55,6 | Espejo | Por verificar | – | Media | 3 |
| 17 | Edmond de Rothschild | 14 | 57,4 | Espejo | Por verificar | – | Media | 3 |
| 18 | Carmignac | 14 | 59,3 | Parcial (6 sin KID) | **Verificada** (ISIN) | – | Baja | 3 |
| 19 | Candriam | 14 | 61,1 | Sí | Por verificar (ficha por ISIN) | – | Media | 3 |
| 20 | Pictet | 12 | 62,7 | Espejo | **Verificada** (ISIN) | – | Baja | 3 |
| 21 | Franklin Templeton | 11 | 64,1 | Espejo (guarda de ISIN) | Por verificar | – | Media | 3 |
| 22 | Natixis | 10 | 65,4 | Parcial | Por verificar | – | Media | 3 |
| 23 | Groupama | 9 | 66,6 | Parcial (6 sin KID) | Por verificar (AMF) | – | Media | 3 |
| 24 | BNY Mellon | 9 | 67,8 | Espejo | Por verificar | – | Media | 3 |
| 25 | PIMCO | 9 | 68,9 | Parcial (7 sin KID) | Por verificar | – | Media | 3 |
| – | Resto (94 gestoras) | 238 | 100 | Variable | Lector con IA + enlaces fijos | CNMV para gestoras españolas | – | 4 |

**Olas:**

- **Ola 1:** fuentes oficiales migradas y fondos españoles completos vía CNMV.
- **Ola 2:** las 10 primeras gestoras (~43 %).
- **Ola 3:** gestoras 11 a 25 (hasta ~69 %) y cierre de los KID que faltan.
- **Ola 4:** cola larga con IA, informes semestrales y casos difíciles (Schroders, Invesco).

---

## 7. Arquitectura del programa

### 7.1 Principios

1. **Una sola casa para lo público.** Los adaptadores oficiales del extractor se **trasladan** aquí, no se copian.
2. **Adaptadores con capacidades declaradas.** Cada fuente dice qué campos sabe dar y para qué activos. Se mantiene el patrón del extractor.
3. **Procedencia por campo.** Cada hoja lleva fuente, URL, hash del documento, fecha del dato y fecha de descarga.
4. **Nada entra sin validar.** Lo que no pasa las reglas va a la cola de revisión, nunca a la salida.
5. **Recolección educada.** Ritmo lento, caché en disco, respeto a robots.txt, una descarga por documento y periodo.
6. **Sin red, sigue funcionando.** Todo documento descargado se guarda y el programa puede regenerar las fichas solo desde caché.
7. **Separado de la app.** Corre en tu PC, igual que el extractor. La app nunca llama a las webs de las gestoras.

### 7.2 Estructura de carpetas (propuesta)

```
BDB/0-datos-publicos/
├─ README.md
├─ config/
│  ├─ ajustes.yaml            ritmo, TTL por familia, rutas, umbrales de validación
│  ├─ universo.csv            ISIN, tipo, gestora (se sincroniza con 1-extractor/config/fondos.csv)
│  ├─ gestoras.yaml           ficha técnica por gestora (ver 7.5)
│  ├─ enlaces_fijos.csv       ISIN → URL fija de ficha o KID (DWS, Robeco…)
│  ├─ correcciones.yaml       correcciones manuales en origen (mismo modelo que el extractor)
│  └─ taxonomia/
│     ├─ clases_activo.yaml   sinónimos → clase normalizada
│     ├─ regiones.yaml        país ISO3 → macro-zona; etiquetas regionales → macro-zona
│     ├─ sectores.yaml        GICS 11 + equivalencias ICB y etiquetas de gestoras
│     └─ renta_fija.yaml      tipos, ratings, tramos
├─ fuentes/                   un adaptador por fuente
│  ├─ base.py                 clase Adaptador: aplica(), capacidades, descarga(), lee()
│  ├─ cnmv_xml.py  cnmv_ficha.py  cssf.py  esma.py  amf_geco.py  gleif.py   (migrados)
│  ├─ kid.py                  localizador + lector de KID (migrado y ampliado)
│  ├─ ficha_mensual.py        localizador de ficha y despacho al lector
│  ├─ estructurados.py        JSON de JPMorgan, Excel de BlackRock/iShares
│  ├─ findatex.py             EMT, EPT, EET
│  └─ informe_periodico.py    anual y semestral (ola 4)
├─ lectores_ficha/            un lector por plantilla de gestora
│  ├─ fidelity.py  pictet.py  carmignac.py  blackrock.py  dws.py  jpmorgan.py  …
│  └─ generico_ia.py          respaldo con IA (esquema JSON cerrado)
├─ nucleo/
│  ├─ descarga.py             HTTP con ritmo, reintentos, caché y robots.txt
│  ├─ cache.py                documentos por fuente/ISIN/periodo + índice con SHA-256
│  ├─ pdf.py                  texto y tablas con coordenadas (pdfplumber)
│  ├─ normaliza.py            aplica la taxonomía
│  ├─ fusiona.py              prioridad por campo + frescura
│  ├─ valida.py               reglas duras (sección 12)
│  ├─ clasifica.py            classification_v2 propia
│  ├─ procedencia.py          registro de quién escribe cada campo
│  └─ planificador.py         qué pedir según TTL y calendario
├─ salida/
│  ├─ fichas/{ISIN}.json      contrato de salida (sección 13)
│  └─ _resumen.json           recuentos, hashes, package_id
├─ revision/                  cola: documentos o bloques rechazados con motivo
├─ informes/                  cobertura por campo, gestora y ola; fallos; comparación con Morningstar
├─ cache/                     PDF, XML, JSON y Excel descargados (fuera de git)
├─ logs/
└─ tests/
   ├─ fixtures/               PDF reales de muestra por gestora (golden set)
   └─ test_*.py
```

### 7.3 Flujo de una pasada

```
universo.csv
   │
   ▼
planificador ── decide por ISIN y familia qué está caducado (TTL / calendario)
   │
   ▼
adaptadores aplicables ── en orden: oficiales → estructurados → KID → FinDatEx → ficha → informe
   │   cada adaptador: localizar URL → descargar (o caché) → verificar ISIN → leer → datos crudos
   ▼
normaliza ── taxonomía común (clases, regiones, sectores, RF)
   │
   ▼
fusiona ── por campo: prioridad de fuente + frescura; registra procedencia
   │
   ▼
correcciones manuales en origen
   │
   ▼
valida ── reglas duras; lo que falla → revision/ (se conserva la ficha anterior)
   │
   ▼
clasifica ── classification_v2
   │
   ▼
salida/fichas/{ISIN}.json + _resumen.json + informes/cobertura
```

### 7.4 Componentes

| Componente | Responsabilidad | Notas |
|---|---|---|
| `descarga` | Petición HTTP con ritmo de 1,5 s ± 0,6 s, 3 reintentos con retroceso y robots.txt comprobado por dominio | User-Agent descriptivo y fijo, sin datos personales |
| `cache` | Guarda cada documento por `fuente/ISIN/periodo`, con SHA-256, URL, fecha y tipo MIME | Si la red falla, vale el último documento válido, marcado como antiguo |
| `pdf` | Texto por página, palabras con coordenadas y tablas | pdfplumber (ya instalado en tu PC) |
| Localizadores | ISIN → URL por patrón, enlace fijo o página índice | Los fallos se recuerdan 30 días para no insistir |
| Lectores | Documento → datos crudos con etiquetas originales | Uno por plantilla; IA como respaldo |
| `normaliza` | Etiquetas originales → taxonomía común | Lo no mapeado va a «otros» con aviso |
| `fusiona` | Varias fuentes → un valor por campo | Sección 11 |
| `valida` | Reglas duras | Sección 12 |
| `clasifica` | classification_v2 | Sección 9.6 |
| `planificador` | Qué pedir hoy | TTL por familia + calendario mensual de fichas |

### 7.5 Configuración por gestora (ejemplo de `gestoras.yaml`)

```yaml
fidelity:
  nombres: ["Fidelity International", "Fidelity Funds", "FIL"]
  ficha:
    patron: "https://www.fidelityinternational.com/FILPS/Documents/en/current/ret.en.xx.{isin}.pdf"
    lector: fidelity
    idioma: en
    publica_dia: 15          # día del mes siguiente en que suele estar disponible
  kid:
    patron: null             # pendiente: añadir patrón propio (13 fondos sin KID)

jpmorgan:
  nombres: ["JPMorgan", "JPM"]
  estructurado:
    tipo: json
    patron: "https://am.jpmorgan.com/FundsMarketingHandler/product-data?cusip={isin}&country=lu&role=per&language=en"
  kid:
    patron: "https://wl.fundsquare.net/serv/down-doc/request?cdClient=jpmorgan&isin={isin}&docTypeCode=KIDD&docLang=ES&docCountry=ES"

dws:
  ficha:
    enlace_fijo: true        # URL en enlaces_fijos.csv
    lector: dws
    idioma: de|en
```

### 7.6 Órdenes previstas (línea de comandos)

| Orden | Qué hace |
|---|---|
| `python dp.py actualiza --todos` | Pasada completa según TTL |
| `python dp.py actualiza ISIN1 ISIN2` | Solo esos fondos |
| `python dp.py actualiza --familia cartera` | Solo composición (pasada mensual) |
| `python dp.py actualiza --sin-red` | Regenera desde caché |
| `python dp.py cobertura` | Informe de cobertura por campo, gestora y ola |
| `python dp.py revision` | Lista la cola de revisión con motivo y documento |
| `python dp.py compara-morningstar` | Comparación con la ficha actual del extractor (transición) |
| `python dp.py localiza ISIN` | Prueba en seco: qué URL encontraría cada adaptador, sin leer |
| `python dp.py corrige ISIN ruta valor --motivo "…"` | Corrección manual en origen |
| `python dp.py exporta` | Paquete de salida con hashes para la plataforma |

---

## 8. Lectura de fichas mensuales

### 8.1 Lector por plantilla (primera opción)

Cada gestora mantiene una maquetación estable durante años. Un lector por plantilla:

1. **Localiza las secciones por su título**, con variantes de idioma: «Asset allocation», «Répartition par classe d'actifs», «Distribución por activos», «Sector breakdown», «Top 10 holdings», «Geographical breakdown», «Duration», «Average credit quality»…
2. **Lee las filas etiqueta-porcentaje** por coordenadas: misma línea base y columna a la derecha del título. Así se evita el problema de las fichas a dos columnas, en las que el texto plano mezcla filas.
3. **Recoge los valores tal cual** (etiqueta original + número), sin normalizar. La normalización es una etapa aparte.
4. **Recoge la fecha de la cartera** («as at 31/08/2026», «au 31.08.2026») y el ISIN de la clase.
5. **Se prueba con un conjunto de referencia** de 3 a 5 fichas reales por gestora, guardadas en `tests/fixtures/`.

**Ventajas:** gratuito, determinista, rápido y verificable.
**Coste:** una pieza por gestora (~25 lectores para cubrir el 69 %).

### 8.2 Lector con IA (respaldo y cola larga)

Para gestoras sin lector propio o cuando un lector falla porque la maquetación ha cambiado:

1. Se extrae el texto de la ficha con sus tablas (pdfplumber). No se envía la imagen, solo el texto.
2. Se envía a un modelo (Claude o Gemini) con un **esquema JSON cerrado** (anexo C) y reglas estrictas:
   - Copiar cifras literalmente y no calcular.
   - Si un dato no aparece, `null`.
   - Etiquetas en su idioma original.
   - Devolver el ISIN y la fecha tal como aparecen.
3. La salida pasa **las mismas validaciones** que la de un lector propio.
4. Además, **comprobación cruzada**: cada cifra devuelta debe aparecer literalmente en el texto del PDF. Si no aparece, el bloque se rechaza. Esto evita cifras inventadas.
5. La procedencia lleva `ia:<modelo>` y la fecha. Lo que no valida va a la cola de revisión.

**Volumen y coste orientativo:**

- Una ficha tiene unas 3.000-6.000 palabras de texto. Para 500 fichas al mes con IA, son varios millones de tokens de entrada al mes.
- Con un modelo ligero, del orden de unos pocos euros al mes. Hay que confirmar tarifas vigentes antes de decidir.
- El coste baja a medida que se escriben lectores propios.

### 8.3 Casuística que hay que tratar

| Caso | Tratamiento |
|---|---|
| Ficha por fondo (no por clase) | La composición es del fondo y vale para todas sus clases. Los costes y la divisa se toman del KID de cada clase. |
| Ficha en varios idiomas | Preferencia: inglés, luego español, francés y alemán. El lector acepta los cuatro. |
| Fondo con derivados (exposición neta > 100 % o liquidez negativa) | Se guarda la exposición bruta y la neta si vienen. Para `pms_exposure` se usa la neta, renormalizada a 100 %, con aviso. |
| Fondos mixtos o multiactivo | El reparto por clase es obligatorio. Regiones y sectores se refieren solo a la parte de RV, y así se etiquetan. |
| Fondos de fondos | Se toma lo que publique la ficha (normalmente el reparto consolidado). Si solo lista fondos subyacentes, se marca `look_through: false`. |
| ETF | Prioridad al CSV o Excel de posiciones de la gestora (iShares ya integrado) y, después, a la ficha. |
| Ficha antigua (> 120 días) | Se acepta con el aviso `composicion_antigua`, sin sobrescribir una más reciente. |
| Ficha que sirve otro ISIN | Se rechaza (guarda del ISIN). |

---

## 9. Normalización

Es la pieza que convierte datos de 119 gestoras en datos comparables.

### 9.1 Clases de activo

Destino: `pms_exposure` (equity, fixed_income, cash, alternative, real_asset, other).

| Normalizada | Sinónimos (ejemplos) |
|---|---|
| equity | Equities, Equity, Shares, Stocks, Actions, Aktien, Renta variable, Acciones |
| fixed_income | Bonds, Fixed income, Obligations, Renten, Anleihen, Renta fija, Bonos |
| cash | Cash, Cash & equivalents, Liquidités, Money market, Liquidez, Monetario, Tesorería |
| alternative | Alternatives, Hedge funds, Absolute return, Commodities, Matières premières, Materias primas |
| real_asset | Real estate, REITs, Immobilier, Infrastructure, Inmobiliario |
| other | Other, Autres, Otros, Derivatives (solo si no hay neta), no clasificado |

**Reglas:**

- Si la ficha da convertibles, se asignan a fixed_income con la etiqueta `convertibles`.
- Si la suma difiere de 100 en más de 2 puntos, no se reparte la diferencia: el bloque se rechaza. Entre 0,5 y 2 puntos, se renormaliza con aviso.

### 9.2 Regiones

Hay dos entradas posibles:

1. **Países** («United States 62,1 %»): nombre → ISO3 (tabla con variantes en 4 idiomas) → macro-zona.
2. **Regiones de la gestora** («North America», «Europe ex UK», «Pacific ex Japan», «Emerging Markets»): tabla directa a macro-zona.

**Macro-zonas.** Deben coincidir exactamente con los enums que ya usa la app (`derived.primary_region`, `regions.macro` del canónico y el mapa del Constructor por macro-zona). Se tomarán del código de la app al construir. No se inventan zonas nuevas.

**Casos ambiguos:**

- «Emerging Markets» sin desglose va a la zona de emergentes que defina la app. Si no existe, va a «otros», con aviso.
- «Global» o «Other» va a «otros».

### 9.3 Sectores (11 GICS)

| GICS | Ejemplos de etiquetas que se mapean |
|---|---|
| Tecnología de la información | Information Technology, Technology, Technologie, Software, Semiconductors |
| Servicios de comunicación | Communication Services, Telecommunications, Media |
| Consumo discrecional | Consumer Discretionary, Consumer Cyclical, Consommation discrétionnaire |
| Consumo básico | Consumer Staples, Consumer Defensive, Consommation de base |
| Salud | Health Care, Healthcare, Santé, Pharma |
| Financiero | Financials, Financial Services, Banks, Insurance, Finance |
| Industria | Industrials, Capital Goods, Industrie |
| Materiales | Materials, Basic Materials, Matériaux |
| Energía | Energy, Énergie, Oil & Gas |
| Servicios públicos | Utilities, Services aux collectivités |
| Inmobiliario | Real Estate, Immobilier |

**Clasificaciones distintas:**

- **ICB y Morningstar** («Consumer Cyclical», «Basic Materials»): tabla de equivalencias.
- **Temáticos de la gestora** («Water supply», «Environmental services», típico de Pictet): se mapean al GICS más cercano **solo si la tabla lo define explícitamente**. Si no, van a «otros» con aviso.

### 9.4 Renta fija

| Dimensión | Grupos normalizados |
|---|---|
| Tipo de emisor | government, corporate_ig, corporate_hy, emerging, securitized, convertible, cash, other (alineado con `bond_types` del canónico) |
| Rating | AAA, AA, A, BBB, BB, B, ≤CCC, NR. Rating medio: letra y valor numérico para agregar |
| Tramos de duración o vencimiento | 1_3, 3_5, 5_7, 7_10, over_10 (claves del canónico actual; se añade `0_1` si la app lo admite) |
| Duración | Efectiva si existe; si no, modificada, anotando cuál es |

### 9.5 Divisas de cartera

Si la ficha da un reparto por divisa, se guarda. Además, el extractor ya deriva `divisas_pct` de la cartera, y se mantiene.

### 9.6 Clasificación propia (`classification_v2`)

Reglas en cascada, cada una con confianza y motivo:

1. **Tipo de activo:**
   - RV ≥ 80 % → equity.
   - RF + liquidez ≥ 80 % → fixed_income; liquidez ≥ 80 % y duración < 1 → money_market.
   - Resto → mixed, con su perfil de riesgo según el porcentaje de RV.
   - Si no hay composición: objetivo del KID + vocación CNMV + nombre.
2. **Región principal:** macro-zona con ≥ 60 % de la RV (o de la RF); si no, global.
3. **Tipo de RF:** grupo dominante (≥ 50 %) de 9.4.
4. **Etiquetas de estrategia:**
   - Sectorial: un sector ≥ 40 %.
   - Temático: palabras clave en nombre u objetivo.
   - Índice: «index», «tracker» o ETF con índice de referencia.
   - Retorno absoluto, multiactivo, etc.
5. **Complejidad:** AIF, uso de derivados declarado en el KID o estrategia long/short → complex; si no, standard.

---

## 10. Exposición calculada desde cartera completa (fondos españoles)

La CNMV da la cartera valor a valor (FONDCART) de los 89 fondos españoles. Convertirla en exposición:

| Dimensión | Cómo | Calidad esperada |
|---|---|---|
| Clase de activo | Tipo de instrumento del propio fichero (renta variable, renta fija, IIC, liquidez, derivados) | Alta |
| Divisa | Campo de divisa del fichero | Alta |
| País | País del emisor si viene en el fichero; si no, prefijo del ISIN (aproximación: no es lo mismo país de emisión que de riesgo) | Media |
| Sector | **No viene en el fichero.** Se necesita un maestro de emisores: las 74 acciones de la base, las posiciones ya clasificadas en otras fichas y, como último recurso, la ficha mensual de la gestora española | Baja-media |
| IIC dentro de la cartera | Si la posición es un fondo de la base, se aplica su exposición (transparencia de un nivel) | Media |

**Limitaciones:**

- El retraso de la CNMV (~4 meses) hace que esta exposición sea trimestral y antigua.
- Para fondos españoles con ficha mensual pública (la mayoría de gestoras españolas la publican), la ficha tiene prioridad y la CNMV queda como verificación.
- Queda por comprobar con un fondo real qué campos exactos trae FONDCART (país, sector, rating); el XSD lo dirá.

---

## 11. Fusión y procedencia

### 11.1 Reglas de prioridad por bloque

| Bloque | Orden de prioridad |
|---|---|
| Identidad legal | Registro oficial (CSSF, CNMV, AMF, ESMA) → GLEIF → KID → ficha |
| SRI, periodo recomendado | KID de la clase (el más reciente) → EPT |
| Costes KID | KID → EMT/EPT → ficha |
| Comisión de gestión | Estructurado (JSON) → ficha → folleto → CNMV FONDTRIM (fondos ES) → EMT |
| Composición | Estructurado (JSON/Excel/CSV) → ficha (lector propio) → ficha (IA) → CNMV FONDCART calculado → informe semestral |
| Perfil RF | Estructurado → ficha → informe semestral |
| SFDR | EET → KID → ficha |

### 11.2 Frescura

- Dentro de una misma prioridad gana el documento con **fecha de dato más reciente**.
- Una fuente de menor prioridad **no pisa** a una de mayor salvo que esta tenga más de 120 días (composición) o más de 18 meses (KID). En ese caso gana la más reciente, con aviso.

### 11.3 Procedencia registrada por campo

```json
"procedencia": {
  "exposicion.asset_mix.equity": {
    "fuente": "ficha_mensual:fidelity",
    "lector": "plantilla:fidelity@1.0",
    "url": "https://www.fidelityinternational.com/FILPS/Documents/en/current/ret.en.xx.IE00BYX5NX33.pdf",
    "sha256": "…",
    "fecha_dato": "2026-08-31",
    "descargado": "2026-09-16T08:12:03Z"
  }
}
```

---

## 12. Validación y calidad

### 12.1 Reglas duras (un bloque que falla no entra)

| Regla | Aplica a |
|---|---|
| El ISIN del documento coincide con el pedido (o la ficha es del fondo y el ISIN pertenece a una de sus clases según el registro) | Todos los documentos |
| El reparto suma 100 ± 2 puntos (± 0,5 sin aviso) | Clase de activo, regiones, sectores, rating, vencimientos |
| Pesos entre −50 % y 150 % (derivados) y ningún peso de top 10 > 100 % | Composición |
| Fecha del dato ≤ 120 días (composición), ≤ 18 meses (KID), ≤ 13 meses (EMT) | Todas |
| Gastos corrientes 0-5 %; comisión de gestión 0-4 %; costes de operación 0-3 %; comisiones de entrada y salida 0-10 % | Costes |
| SRI entero 1-7; periodo recomendado 1-20 años | Regulatorio |
| Duración 0-30 años; rating dentro de la escala | RF |
| Cifras del lector con IA presentes literalmente en el texto | Lector con IA |
| No empeora: una ficha nueva con menos campos o fecha más antigua que la vigente no la sustituye | Salida |

### 12.2 Avisos (entran, marcados)

- Composición renormalizada.
- «Otros» > 10 % en sectores o regiones.
- Composición de fondo aplicada a una clase cubierta.
- Composición antigua.
- Dato de fuente de respaldo.
- Ficha leída con IA.

### 12.3 Puntuación y grupos

Se mantiene el modelo de `core/calidad.py` (ALTO/MEDIO/BAJO/BLOQUEADO):

- **Esenciales:** identidad, SRI, gastos corrientes, reparto por clase y, según el tipo, regiones y sectores o duración y rating.
- La puntuación y los avisos se envían al canónico, como hoy (`quality`, `validation`).

### 12.4 Cola de revisión

Cada bloque rechazado deja en `revision/` el ISIN, la fuente, el documento, la regla que falló y lo que se leyó. `dp.py revision` los lista por gestora. Tres rechazos seguidos de la misma gestora indican que ha cambiado la plantilla y hay que actualizar el lector.

---

## 13. Contrato de salida

Una ficha JSON por ISIN. Los bloques de negocio usan **los mismos nombres y enums que el canónico actual** (`portfolio_exposure_v2`, `classification_v2`, `regulatory`), para que el cargador de la plataforma no tenga que reinterpretar nada.

```json
{
  "schema_version": "datos-publicos-fondo.v1",
  "isin": "IE00BYX5NX33",
  "generado": "2026-09-16T08:15:00Z",
  "identidad": {
    "nombre_legal": "Fidelity MSCI World Index Fund P-ACC-EUR",
    "gestora": "Fidelity International",
    "gestora_legal": "FIL Investment Management (Luxembourg) S.à r.l.",
    "divisa": "EUR", "cubierta": false, "politica_distribucion": "acumulacion",
    "domicilio": "IRL", "marco_legal": "UCITS",
    "fecha_lanzamiento_clase": "…", "indice_referencia": "MSCI World (Net)"
  },
  "regulatory": {
    "sri": 4, "periodo_recomendado_anos": 5, "sfdr_article": 6,
    "kid": { "fecha": "…", "url": "…", "sha256": "…", "fuente": "…" }
  },
  "costes": {
    "gastos_corrientes_pct": 0.12, "comision_gestion_pct": null,
    "costes_operacion_pct": 0.01, "comision_exito_pct": 0.0,
    "entrada_max_pct": 0.0, "salida_max_pct": 0.0
  },
  "portfolio_exposure_v2": {
    "version": "v2",
    "asset_mix": { "equity": 0.99, "bond": 0.0, "cash": 0.01, "other": 0.0 },
    "equity_regions": { "…": 0.0 },
    "sectors": { "information_technology": 0.0 },
    "bond_types": null, "credit": null, "duration": null,
    "exposure_confidence": 0.9, "warnings": []
  },
  "fixed_income_profile": null,
  "holdings": {
    "as_of": "2026-08-31", "top10": [ { "nombre": "…", "peso_pct": 0.0 } ],
    "num_posiciones": 1300, "peso_top10_pct": 0.0
  },
  "classification_v2": { "version": "v2", "asset_type": "equity", "region_primary": "…", "strategy_tags": ["index"] },
  "calidad": { "bucket": "ALTO", "score": 0, "avisos": [] },
  "procedencia": { "…": {} }
}
```

*Las cifras son ilustrativas del formato, no datos reales.*

---

## 14. Integración con la plataforma y la app

1. **La app no cambia.** Sigue leyendo `assets/{id}` (`asset.v1.1`) y `read/asset-for-bdb.v1`.
2. **Plataforma (`2-plataforma-datos`):** nuevo lector del paquete `0-datos-publicos/salida/` en el cargador (`src/loader`). Aplica la misma secuencia de siempre: pasada en seco, comparación, escritura con la puerta `BDB_DATA_PLATFORM_ENABLE_MASTER_WRITES` y comprobación posterior.
3. **Convivencia durante la transición:**
   - **Opción A (recomendada):** el extractor consume la salida del programa como una fuente oficial más (`datos_publicos`). Así se reutilizan su fusión, su canónico y todo el circuito hacia la maestra sin tocar el cargador. Cuando Morningstar se retire, el extractor queda como puente o se jubila.
   - **Opción B:** el cargador lee directamente las dos salidas (extractor para EODHD y Morningstar residual; programa nuevo para lo público). Requiere más cambios en la plataforma.
4. **Series de VL:** no cambian (EODHD → `price_series`). Para fondos españoles sin serie en EODHD, FONDMENS de la CNMV sirve como histórico de respaldo por el mismo camino del backfill (create-only).
5. **Nada se escribe en la maestra sin tu OK explícito**, como hoy.

---

## 15. Operación

### 15.1 Calendario

| Qué | Cuándo | Volumen aproximado |
|---|---|---|
| Fichas mensuales | Del día 10 al 20 de cada mes, reintentando lo que falte cada 2 días | 1 documento por fondo (o por fondo paraguas): ~600-700 |
| Datos estructurados (JSON, Excel, CSV) | Mensual, junto con las fichas | ~80-130 |
| KID | Cada 90 días o si cambia la fecha del documento | ~766, repartidos |
| FinDatEx (EMT/EPT/EET) | Mensual o trimestral | 1 fichero por gestora que lo publique |
| CNMV XML | Mensual (FONDMENS, FONDREGISTRO) y trimestral (resto) | 2-6 ZIP compartidos |
| Registros (CSSF, ESMA, AMF, GLEIF) | Mensual | Ficheros compartidos y pocas consultas |
| Informes semestrales | Marzo-abril y septiembre-octubre | 1 por paraguas |

### 15.2 Tiempo y almacenamiento

- **Tiempo:** unas 1.500 descargas al mes a ~1,5-2 s cada una son ~40-50 minutos de pasada mensual. Las siguientes pasadas del mes solo piden lo que falte.
- **Almacenamiento:** entre 300 KB y 1 MB por ficha, lo que da unos 0,5-1 GB al año de caché de documentos. Conviene conservar el último año y archivar el resto.

### 15.3 Operativa del día a día

- **Pasada mensual:** `dp.py actualiza --familia cartera`, luego `dp.py cobertura` y `dp.py revision`.
- **Alta de un fondo nuevo:** se añade al universo, `dp.py actualiza ISIN` y, si su gestora no tiene patrón, se añade su enlace a `enlaces_fijos.csv`.
- **Integración futura:** el panel Sistema › Operaciones de la app podría lanzar estas órdenes a través del servicio local de operaciones, como ya hace con el extractor.

---

## 16. Pruebas y verificación

### 16.1 Pruebas automáticas

- **Por lector:** 3 a 5 fichas reales de la gestora en `tests/fixtures/`, con el resultado esperado escrito a mano. La prueba falla si cambia una sola cifra.
- **Por normalización:** tablas de ida y vuelta. Toda etiqueta vista en los fixtures debe estar mapeada o marcada explícitamente como «otros».
- **Por validación:** casos límite (suma 97 %, fecha antigua, ISIN de otra clase, derivados con exposición > 100 %).
- **Contrato:** cada ficha de salida valida contra el esquema JSON del programa y contra `master/asset.v1.1` tras el mapeo.

### 16.2 Conjunto de referencia (golden set)

30 fondos elegidos para cubrir: las 10 gestoras de la ola 2, fondos RV, RF y mixtos, un fondo de fondos, un ETF, una clase cubierta y 3 fondos españoles. Sus fichas se verifican a mano una vez y sirven de patrón para cada cambio.

### 16.3 Comparación con Morningstar (oráculo de la transición)

Durante 2-3 pasadas mensuales se compara, fondo a fondo, la salida pública con la ficha actual del extractor:

| Dato | Tolerancia | Si se supera |
|---|---|---|
| Reparto por clase de activo | ± 3 puntos por clase | Revisar: puede ser la fecha de cartera, la neta frente a la bruta o un error del lector |
| Regiones y sectores RV | ± 5 puntos por grupo | Revisar el mapeo de la taxonomía |
| Gastos corrientes | ± 0,05 puntos | Revisar la fecha del KID |
| Comisión de gestión | Exacta | Revisar la fuente |
| SRI | Exacto | Prevalece el KID más reciente |
| Duración | ± 0,5 años | Revisar si es efectiva o modificada |
| Rating medio | ± 1 escalón | Revisar la metodología de la media |

Las discrepancias no siempre son errores del programa: Morningstar también tiene retrasos y errores. Cada discrepancia se clasifica como error del lector, diferencia de fecha, diferencia de metodología o error de Morningstar.

---

## 17. Transición y baja de proveedores

| Paso | Condición para avanzar |
|---|---|
| 1. El programa corre en paralelo sin escribir | Ola 1 terminada y pruebas en verde |
| 2. Bloque regulatorio y de costes desde el programa | Concordancia ≥ 95 % en SRI y gastos corrientes |
| 3. Composición desde el programa, gestora a gestora | Concordancia ≥ 90 % de los fondos de esa gestora dentro de tolerancia |
| 4. Morningstar pasa a dato informativo (categoría, estrellas) | Cobertura de composición ≥ umbral que fijes (propuesta: 90 %) |
| 5. Baja del plan de fundamentales de EODHD para fondos | Paso 4 cumplido. **Antes, resolver las acciones** (fase 2), que hoy dependen de ese plan |
| 6. Retirada total de Morningstar | Decisión tuya sobre categoría y estrellas (sección 18) |

---

## 18. Qué se pierde y cómo se sustituye

| Hoy (Morningstar) | Sustituto | Valoración |
|---|---|---|
| Categoría Morningstar (base de `commercial_type`) | `classification_v2` propia + vocación CNMV (ES) + clasificación AMF (FR) | Equivalente para filtrar y agrupar; no es un estándar de mercado reconocido por el cliente |
| Estrellas | Ranking propio: percentil de rentabilidad ajustada al riesgo a 3 y 5 años dentro de la clasificación propia, calculado con las series de EODHD | Opcional. Conviene no llamarlo «estrellas» para no confundirlo con Morningstar |
| Medalist, percentil en categoría | No se sustituye | Se pierde |
| Globos ESG, puntuaciones ESG, carbono | Artículo SFDR + % de inversión sostenible y PAI de la EET donde se publique | Parcial |
| Style box RV homogéneo | Solo si la ficha lo trae | Parcial; se pierde en muchos fondos |
| Composición mensual del 100 % | 70-90 % mensual; el resto trimestral o semestral | Aceptable para asignación de activos |
| TER frente a categoría | Se puede calcular frente a la clasificación propia | Equivalente |

---

## 19. Riesgos y mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| Cambio de maquetación de una ficha | Alta (varias al año) | Medio: la gestora queda sin composición nueva | Validación dura, ficha anterior conservada, alerta tras 3 rechazos, lector con IA de respaldo |
| Cambio de URL o web con JavaScript | Media | Medio | Enlaces fijos, espejo de documentación, página índice, aviso en el informe de cobertura |
| Heterogeneidad de taxonomías | Segura | Alto si no se trata | Normalización explícita con tablas versionadas y «otros» con aviso |
| Cifras inventadas por la IA | Baja con controles | Alto | Comprobación literal en el texto + validación + procedencia `ia` |
| Retraso de publicación (fichas y CNMV) | Segura | Bajo | Calendario del 10 al 20; fechas visibles en la app |
| Condiciones de uso de webs de gestoras | Baja | Medio | Solo documentos públicos para inversores, robots.txt, ritmo lento, sin redistribuir los PDF |
| Bloqueo por volumen | Baja | Bajo | ~1 descarga por documento y mes, caché, ritmo ≥ 1,5 s |
| Dependencia de EODHD para VL | Segura | Alto | Consultar la licencia para uso profesional; CNMV como histórico de respaldo para fondos españoles |
| Esfuerzo de mantenimiento | Media | Medio | Priorizar por peso en la base; lectores pequeños y probados; IA para la cola larga |
| Entorno de pruebas | Segura | Bajo | Las pruebas con red se hacen en tu PC (este entorno no llega a las webs de las gestoras) |

---

## 20. Plan por fases

| Fase | Contenido | Entregable | Criterio de aceptación |
|---|---|---|---|
| **0. Cimientos** | Estructura, `descarga` con caché y robots.txt, `pdf`, contrato de salida, taxonomías iniciales, CLI mínima | Programa que corre en seco (`localiza`, `--sin-red`) | Pruebas en verde; esquema de salida validado contra `asset.v1.1` tras el mapeo |
| **1. Oficiales y CNMV** | Traslado de `cnmv`, `cnmv_ficha`, `cssf`, `esma`, `amf_geco`, `gleif` y `kid`; exposición desde FONDCART para fondos ES | Fichas con identidad, regulatorio y costes para todo el universo; composición de fondos ES | Salida idéntica al extractor en los campos migrados (comparación campo a campo); 0 regresiones |
| **2. Diez gestoras** | Lectores de BlackRock, Fidelity, JPMorgan (JSON), Amundi, DWS, Allianz, BNP y Andbank; EMT/EET de Schroders; nuevo intento con Invesco; patrones de KID nuevos | Composición para ~40 % del universo; menos fondos sin KID | Golden set correcto; ≥ 90 % dentro de tolerancia frente a Morningstar en esas gestoras |
| **3. Quince gestoras** | Gestoras 11-25; resto de KID sin localizar | Composición hasta ~69 %; fondos sin KID < 60 | Ídem |
| **4. Cola larga** | Lector con IA, cola de revisión, informes semestrales, casos difíciles | Cobertura ≥ 90 % en clase de activo | Informe de cobertura; revisión de una muestra de 30 fichas leídas con IA |
| **5. Integración** | Adaptador en el extractor (opción A) o en el cargador (opción B); pasada en seco contra la maestra | Paquete cargable | Pasada en seco limpia; escritura solo con tu OK |
| **6. Retirada** | Morningstar a informativo; decisión sobre el plan de fundamentales | Configuración final | Criterios de la sección 17 |

Cada fase se cierra con un informe (qué se hizo, pruebas, comparación, pendientes) y tu aprobación antes de pasar a la siguiente.

---

## 21. Decisiones pendientes

| # | Decisión | Opciones | Recomendación |
|---|---|---|---|
| 1 | Nombre y ubicación | `0-datos-publicos` u otro | `BDB/0-datos-publicos` |
| 2 | Adaptadores oficiales existentes | Trasladar o duplicar | Trasladar (una sola casa para lo público) |
| 3 | Integración | A: el extractor lo consume como fuente · B: el cargador lee las dos salidas | A, durante la transición |
| 4 | Motor del lector con IA | Claude o Gemini | Probar ambos con el golden set y decidir por precisión y coste |
| 5 | Umbral para retirar Morningstar | 80 / 90 / 95 % de cobertura en composición | 90 % |
| 6 | Sustituto de las estrellas | Ranking propio o prescindir | Ranking propio opcional, con otro nombre |
| 7 | Licencia de EODHD para uso profesional | Consultar ahora o más adelante | Ahora, aprovechando la negociación |
| 8 | Acciones (fase 2) | Cuándo abordarla | Antes de dar de baja el plan de fundamentales |

---

## 22. Anexos

### Anexo A. Direcciones verificadas (28-09-2026)

| Recurso | URL |
|---|---|
| CNMV, descarga individual | https://www.cnmv.es/portal/publicaciones/descarga-informacion-individual?lang=es |
| CNMV, descripción de ficheros | https://www.cnmv.es/DocPortal/Estadisticas/Descarga-Informacion-Individual/Periodicidad-Descripcion.pdf |
| CNMV, ficha por ISIN | https://www.cnmv.es/Portal/Consultas/IIC/Fondo.aspx?isin=ES0110407006 |
| CSSF, UCITS | https://www.cssf.lu/wp-content/uploads/OPC_COMP_TP_TOUS_OUVERTS.zip |
| Ficha Pictet | https://documents.am.pictet/?cat=marketing-permalink&isin=LU0104885248&dtyp=FCL_RME&dla=en&dcty=FR&audience=INSTITUTIONAL |
| Ficha Fidelity | https://www.fidelityinternational.com/FILPS/Documents/en/current/ret.en.xx.IE00BYX5NX33.pdf |
| Ficha BlackRock | https://www.blackrock.com/lu/individual/literature/fact-sheet/blackrock-advantage-europe-equity-fund-class-d-acc-eur-factsheet-ie00bdfd9c92-lu-en-individual.pdf |
| Ficha Carmignac | https://www.carmignac.com/assets/yoda/FLF_CI_FR0010148981_INT_en/Monthly-Factsheet_Carmignac-Investissement-A-EUR-Acc_FR0010148981_INT_en.pdf |
| Ficha DWS | https://download.dws.com/download/asset/b7c30710-5620-4a37-8b88-20503602deb9 |
| JPMorgan, página del fondo | https://am.jpmorgan.com/lu/en/asset-management/per/products/jpm-taiwan-a-dist-usd-lu0117843481 |
| Robeco, página por ISIN | https://www.robeco.com/en-int/products/funds/isin-lu0084617165/robeco-asia-pacific-equities-d-eur |
| Schroders, semestral | https://api.schroders.com/document-store/SISF-SAR-LUEN.pdf |
| Invesco, anual | https://www.invesco.com/content/dam/invesco/emea/de/product-documents/gpr/umbrella/annual-financial-report/invesco-funds_annual-financial-report_en.pdf |
| FinDatEx Schroders | https://www.schroders.com/en-lu/lu/professional/literature/european-esg-template-european-priips-template-european-mifid-template-data/ |
| FinDatEx Columbia Threadneedle | https://www.columbiathreadneedle.com/en/gb/intermediary/regulatory-templates/ |
| FinDatEx M&G | https://www.mandg.com/priips-and-mifid-ii |

### Anexo B. Qué da cada documento

| Campo | KID | Ficha mensual | EMT | EPT | EET | CNMV XML | Informe semestral |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| SRI | ● | ◐ | ● | ● | | | |
| Periodo recomendado | ● | ◐ | ● | ● | | | |
| Gastos corrientes | ● | ● | ● | ● | | ● (ES) | ◐ |
| Costes de operación | ● | | ● | ● | | | |
| Comisión de gestión | ◐ | ● | | | | ● (ES) | ● |
| Comisión de éxito | ● | ◐ | ● | ● | | ● (ES) | ● |
| SFDR | ◐ | ◐ | | | ● | | |
| Clase de activo | | ● | | | | ● (ES, calculado) | ● (calculado) |
| Regiones y países | | ● | | | | ◐ (ES) | ● (calculado) |
| Sectores | | ● | | | | | ◐ |
| Top 10 | | ● | | | | ● (ES) | ● |
| Duración y rating | | ◐ | | | | ◐ | ◐ |
| Objetivo (texto) | ● | ● | | | | | |

● completo · ◐ parcial o según gestora

### Anexo C. Esquema JSON del lector con IA (borrador)

```json
{
  "isin_en_documento": "string|null",
  "nombre_en_documento": "string|null",
  "fecha_cartera": "YYYY-MM-DD|null",
  "idioma": "en|es|fr|de",
  "divisa_referencia": "string|null",
  "clase_activo": [ { "etiqueta": "string", "pct": "number" } ],
  "regiones_o_paises": [ { "etiqueta": "string", "pct": "number", "tipo": "pais|region" } ],
  "sectores": [ { "etiqueta": "string", "pct": "number" } ],
  "top10": [ { "nombre": "string", "pct": "number" } ],
  "num_posiciones": "integer|null",
  "renta_fija": {
    "duracion": "number|null", "tipo_duracion": "efectiva|modificada|null",
    "rating_medio": "string|null",
    "por_rating": [ { "etiqueta": "string", "pct": "number" } ],
    "por_tipo": [ { "etiqueta": "string", "pct": "number" } ],
    "por_vencimiento": [ { "etiqueta": "string", "pct": "number" } ],
    "tir_pct": "number|null"
  },
  "costes": {
    "gastos_corrientes_pct": "number|null",
    "comision_gestion_pct": "number|null",
    "comision_exito": "string|null"
  },
  "indice_referencia": "string|null",
  "patrimonio": { "valor": "number|null", "divisa": "string|null", "fecha": "YYYY-MM-DD|null" }
}
```

**Reglas del lector con IA:**

- Copiar las cifras literalmente y no calcular ni completar.
- `null` si no aparece.
- Etiquetas en el idioma del documento.
- Cada cifra debe estar en el texto (comprobación posterior).

### Anexo D. Glosario

| Término | Qué es |
|---|---|
| **KID** (PRIIPs) | Documento de datos fundamentales. Obligatorio desde el 1-1-2023; sustituye al KIID UCITS. |
| **Ficha mensual** (factsheet) | Documento comercial mensual de la gestora con composición y datos del fondo. |
| **EMT / EPT / EET** | Plantillas estándar FinDatEx para MiFID, PRIIPs y ESG que las gestoras entregan a los distribuidores. |
| **SRI** | Indicador resumido de riesgo del KID (1-7). |
| **Gastos corrientes** | Costes recurrentes anuales de la clase según el KID; equivalente práctico del TER. |
| **Look-through** | Transparencia: ver la cartera de los fondos subyacentes de un fondo de fondos. |
| **Golden set** | Conjunto de referencia verificado a mano para detectar regresiones. |
