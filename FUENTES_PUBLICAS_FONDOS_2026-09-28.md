# Datos de fondos desde documentación pública: diagnóstico y propuesta

*28 de septiembre de 2026. Las cifras se han medido sobre `1-extractor/data/funds/` (840 fichas: 766 fondos y ETF, 74 acciones), sobre los contratos de `2-plataforma-datos/contracts` y sobre webs reales. No se ha tocado código ni la maestra.*

---

## 1. Respuesta corta

**Sí, con una excepción.** La documentación pública y gratuita alcanza para casi todo lo que la app necesita. Las fuentes son los KID, las fichas mensuales de la gestora, los informes periódicos y los registros oficiales. **No alcanza para la serie diaria de valor liquidativo de los fondos no españoles.** Esa serie es la materia prima de la frontera eficiente, la volatilidad, el Sharpe, las correlaciones y el drawdown.

| Bloque | ¿Basta lo público? | Fuente pública |
|---|---|---|
| Identidad y datos regulatorios (UCITS, gestora legal, domicilio, SRI, periodo recomendado, SFDR) | **Sí**, ya está hecho | CNMV, CSSF, ESMA, AMF GECO, GLEIF, KID |
| Costes (gastos corrientes, costes de operación, comisión de éxito) | **Sí** | KID; en España, además, el XML trimestral de la CNMV |
| Comisión de gestión | **Parcial** | Ficha mensual o folleto; no siempre viene separada |
| Composición (activo, región, sector, top 10) | **Sí, trabajando por gestora** | Ficha mensual en PDF (~70 % verificado); cartera completa en la CNMV para fondos españoles |
| Perfil de RF (duración, rating medio, vencimientos) | **Parcial** | Ficha mensual, solo algunas gestoras |
| Estilo y capitalización RV (style box) | **No** de forma homogénea | Solo algunas fichas |
| **Serie diaria de VL** | **ES: sí, con 4 meses de retraso · Resto: no** | CNMV FONDMENS; gestoras sueltas (BlackRock en Excel) |
| Rentabilidades, volatilidad, Sharpe, drawdown, beta | **Sí, si hay serie** | Se calculan; la app ya lo hace |
| Categoría Morningstar, estrellas, medalist, ESG y carbono | **No** (propietario) | Sustituible por la clasificación propia (`classification_v2`) |

---

## 2. Lo que hay hoy

**Universo:** 766 fondos y ETF. Por domicilio: LU 547 · ES 89 · IE 77 · FR 40 · otros 13. Son 119 gestoras, y las 25 primeras suman el 69 %.

**Procedencia de los campos** (`meta.procedencia`, contando todas las hojas):

| Fuente | Hojas | Naturaleza |
|---|---:|---|
| morningstar_lt | 175.935 (84 %) | API interna de su web, no licenciada |
| derivado | 10.243 | Cálculo propio |
| kid_gestora | 6.066 | KID del productor (oficial) |
| esma / cssf / cnmv / cnmv_ficha / gleif / amf_geco | 18.114 | Registros oficiales |
| eodhd | 55 | De pago, con licencia personal |

**El trabajo del 4 y 5 de septiembre ya cubre el bloque regulatorio.** Hay adaptadores oficiales y un lector de KID en español, inglés y francés. Todo lo demás sigue saliendo de Morningstar. Las series de VL (`price_series`) salen de EODHD.

**Lo que consume la app** (`read/asset-for-bdb.v1` + `metrics` + `price_series`):

- Identidad.
- Clase de activo y región.
- Costes: gastos corrientes, comisión de gestión y MiFID.
- Exposición `pms_exposure`: RV, RF, liquidez, alternativos, real y otros.
- Detalle de exposición: sectores, estilos, regiones RV y capitalizaciones.
- Perfil de RF.
- Resumen de cartera.
- SRRI/SRI.
- Serie de VL. De ella la app calcula sus propias métricas.

La categoría y las estrellas de Morningstar solo aparecen como dato informativo.

---

## 3. Qué da cada fuente pública (verificado con fondos de la base)

### 3.1 Fondos españoles: la CNMV lo da casi todo

La CNMV publica en XML, gratis y como información pública, [ficheros por IIC](https://www.cnmv.es/portal/publicaciones/descarga-informacion-individual?lang=es):

- **FONDMENS** (mensual): VL, patrimonio y partícipes **diarios** por clase.
- **FONDTRIM**: comisiones, gastos y rentabilidades.
- **FONDCART** / **FONDDERI**: cartera contado y derivados **valor a valor**, trimestral.
- **FONDREGISTRO** / **SOCREGISTRO**: identificación.

Hay dos pegas:

- **El último periodo publicado es mayo de 2026**, unos 4 meses de retraso. Sirve para el histórico, no para el dato reciente.
- **La cartera trae los valores, no su sector ni su región.** Para agregarla hay que clasificar cada posición.

El extractor ya lee estos ficheros (adaptador `cnmv`). Hoy aporta la serie diaria de 82 fondos.

### 3.2 Fondos extranjeros (LU/IE/FR/DE): muestra de 10 gestoras

| Gestora (ISIN probado) | Ficha mensual con composición | VL histórico descargable | Informe anual/semestral |
|---|---|---|---|
| Fidelity (IE00BYX5NX33) | **Sí**, URL por ISIN | No verificado | Sí |
| Pictet (LU0104885248) | **Sí**, URL por ISIN | No | Parcial |
| Carmignac (FR0010148981) | **Sí**, URL por ISIN + código | No (exige registro) | Sí |
| BlackRock (IE00BDFD9C92) | **Sí**, URL por ISIN + nombre | **Probable** (Excel por id de producto) | Sí |
| JPMorgan (LU0117843481) | **Sí**, y además JSON por ISIN con desgloses y posiciones | Parcial (endpoint da error) | Sí |
| DWS (DE0005318406) | **Sí, la más completa** (con duración y rating) | No verificado | Sí |
| Robeco (LU0084617165) | Sí (URL por código de fondo) | No | Sí |
| Schroders (LU0106261885) | **No** (JavaScript, nombres arbitrarios) | No | Sí |
| Invesco (LU0028119013) | **No** (perfil obligatorio, patrón da 404) | No | Sí |
| Andbank ES (ES0110407006) | No hay ficha mensual; CNMV | **Sí, vía CNMV** (retraso) | Sí (CNMV) |

**Lectura:**

- La composición pública existe en ~7 de cada 10 gestoras.
- Los informes con cartera completa, en 9 de cada 10.
- El VL histórico descargable, solo en 2 o 3.

**Patrones por ISIN que funcionan:**

- Fidelity: `fidelityinternational.com/FILPS/Documents/en/current/ret.en.xx.{ISIN}.pdf`
- Pictet: `documents.am.pictet/?cat=marketing-permalink&isin={ISIN}&dtyp=FCL_RME&dla=en&dcty=FR&audience=INSTITUTIONAL`
- JPMorgan: `am.jpmorgan.com/FundsMarketingHandler/product-data?cusip={ISIN}&country=lu&role=per&language=en`

### 3.3 Plantillas estándar (FinDatEx)

La **EMT** (MiFID), la **EPT** (PRIIPs) y la **EET** (ESG) son ficheros estructurados, en Excel o CSV. Traen costes ex ante, SRI, mercado objetivo, escenarios y el artículo SFDR. Algunas gestoras las publican en abierto: Schroders, Columbia Threadneedle y M&G. La mayoría solo las entrega a distribuidores. Cuando existen, son la mejor fuente de costes. **No traen composición.**

### 3.4 Portales (Morningstar, FT, Investing, Quefondos, onvista)

Tienen todo, pero:

- Los términos de Morningstar prohíben expresamente el uso "on behalf of… financial services… or their clients".
- Investing exige permiso escrito.
- onvista pide autorización para el rastreo.
- Quefondos bloquea en su robots.txt `/quefondos/` y `/vdos-quefondos/` (sus fichas van en `/es/fondos/`).
- FT, Morningstar y fondsweb devuelven 403 a los clientes automáticos.

**No sirven como base de un programa que se usa delante de clientes.**

---

## 4. Tres cosas que conviene saber del extractor actual

1. **`capacidades --sin morningstar_lt` da una falsa tranquilidad.** Dice «0 rutas se quedan sin fuente», pero el respaldo que cuenta es `morningstar` (mstarpy), que es el mismo proveedor. Con `--sin morningstar_lt,morningstar,eodhd` se quedan **63 rutas sin fuente**. Entre ellas están toda la rentabilidad, el riesgo, la valoración, la comisión de gestión máxima, MiFID y la gestora comercial.
2. **El respaldo de `cartera.*` es `gestoras`, pero solo cubre los ETF de iShares** configurados en `config/gestoras.csv`. Para los ~660 fondos no españoles, la composición no tiene respaldo: si cae Morningstar, la app se queda sin exposición por activo, región y sector, y el optimizador sin sus restricciones.
3. **221 de 766 fondos (29 %) siguen sin KID.** Los más afectados son BlackRock (18), Andbank (18), Fidelity (13), BNP (8), Allianz (8) y PIMCO (7).

---

## 5. Propuesta de programa

Es una ampliación de `core/adquisicion/`, con la misma arquitectura: adaptadores con capacidades declaradas, procedencia por campo y TTL por familia. No hace falta un programa nuevo aparte.

### Módulo A: completar el KID (familia regulatorio, 90 días)

Añadir patrones de gestora para BlackRock, Fidelity, BNP, Allianz, PIMCO, Carmignac y Groupama. Objetivo: bajar de 221 a menos de 60 fondos sin KID. Da SRI, gastos corrientes, costes de operación, comisión de éxito y periodo recomendado.

### Módulo B: fichas mensuales (familia cartera, 30 días) — **el nuevo de verdad**

1. **Localizador por gestora.** Un patrón de URL por ISIN donde exista (Fidelity, Pictet, Carmignac, BlackRock, JPM). Donde no, una tabla ISIN → URL fija rellenada una vez (DWS, Robeco).
2. **Extracción PDF → JSON con esquema fijo:**
   - Activo, región/país, sector, top 10, TER, comisión de gestión, fecha, y duración y rating si vienen.
   - Con LLM (Claude o Gemini) y validación dura: los repartos suman 100 ± 2 %, la fecha tiene menos de 90 días y el ISIN coincide.
   - Para JPM se lee el JSON directamente.
3. **Normalización a la taxonomía de la app:** 11 sectores GICS, las macro-zonas de la app (América, Europa, Asia…) y las clases de `pms_exposure`. Lo que no mapee va a «otros», con aviso.
4. **Prioridad por gestora según el peso en la base:** las 25 primeras cubren el 69 % de los fondos.

### Módulo C: serie de VL (familia precio, 1 día)

- **Fondos españoles:** backfill histórico desde CNMV FONDMENS (oficial, desde 2012). Los últimos meses, desde EODHD.
- **Gestoras con descarga** (BlackRock y las que aparezcan): adaptador propio.
- **Resto: mantener EODHD.** Es el único hueco sin alternativa pública limpia. Conviene aclarar con EODHD la licencia para uso profesional ante clientes: el informe del 18-07 habla de uso «personal y no comercial».

### Módulo D: cálculo propio (ya existe en la app)

Rentabilidades, volatilidad, Sharpe, drawdown, beta y correlaciones, calculados desde la serie. Así desaparecen los bloques `rentabilidad.*` y `riesgo.*` de Morningstar sin perder nada.

### Módulo E: clasificación propia en lugar de la categoría Morningstar

`classification_v2` ya existe. Se alimentaría del objetivo del KID, de la composición de la ficha y de la vocación CNMV. Estrellas, medalist, globos ESG y carbono: se prescinde de ellos o se mantienen como dato informativo mientras Morningstar siga respondiendo, según la decisión del 04-09 («reducir, no eliminar»).

---

## 6. Riesgos

- **Mantenimiento:** 119 gestoras con formatos distintos, que cambian la maquetación sin avisar. La extracción con LLM y validación lo amortigua, pero hay que vigilar las tasas de fallo por gestora (panel de calidad).
- **Frescura:** las fichas mensuales salen entre 2 y 6 semanas después del cierre de mes. La CNMV va con ~4 meses de retraso.
- **Heterogeneidad:** cada gestora usa sus propios sectores y regiones. Sin normalización, los repartos no son comparables entre fondos.
- **Legal:** es lo más favorable del plan. Todo lo que añade es documentación que la gestora publica por obligación o con fines comerciales abiertos. Lo frágil sigue siendo Morningstar, que conviene ir dejando en informativo.

---

## 7. Decisiones que necesito de ti

1. **VL de fondos extranjeros:** ¿mantenemos EODHD para esto (y le preguntamos por la licencia profesional) o exploramos gestora por gestora sabiendo que la cobertura será baja?
2. **Alcance del módulo B:** ¿empezamos por las 10 gestoras con más fondos (~45 % del universo) como piloto?
3. **Categoría y estrellas Morningstar:** ¿las sustituye la clasificación propia o se mantienen como dato informativo mientras funcionen?

---

### Fuentes principales

- [CNMV — descarga de información individual de IIC](https://www.cnmv.es/portal/publicaciones/descarga-informacion-individual?lang=es) · [descripción de ficheros](https://www.cnmv.es/DocPortal/Estadisticas/Descarga-Informacion-Individual/Periodicidad-Descripcion.pdf)
- [CSSF — identificadores UCITS](https://www.cssf.lu/wp-content/uploads/OPC_COMP_TP_TOUS_OUVERTS.zip)
- Fichas verificadas:
  - [Pictet](https://documents.am.pictet/?cat=marketing-permalink&isin=LU0104885248&dtyp=FCL_RME&dla=en&dcty=FR&audience=INSTITUTIONAL)
  - [Fidelity](https://www.fidelityinternational.com/FILPS/Documents/en/current/ret.en.xx.IE00BYX5NX33.pdf)
  - [BlackRock](https://www.blackrock.com/lu/individual/literature/fact-sheet/blackrock-advantage-europe-equity-fund-class-d-acc-eur-factsheet-ie00bdfd9c92-lu-en-individual.pdf)
  - [Carmignac](https://www.carmignac.com/assets/yoda/FLF_CI_FR0010148981_INT_en/Monthly-Factsheet_Carmignac-Investissement-A-EUR-Acc_FR0010148981_INT_en.pdf)
  - [DWS](https://download.dws.com/download/asset/b7c30710-5620-4a37-8b88-20503602deb9)
  - [JPMorgan](https://am.jpmorgan.com/lu/en/asset-management/per/products/jpm-taiwan-a-dist-usd-lu0117843481)
- Plantillas EMT/EPT/EET en abierto:
  - [Schroders](https://www.schroders.com/en-lu/lu/professional/literature/european-esg-template-european-priips-template-european-mifid-template-data/)
  - [Columbia Threadneedle](https://www.columbiathreadneedle.com/en/gb/intermediary/regulatory-templates/)
  - [M&G](https://www.mandg.com/priips-and-mifid-ii)
- [Condiciones de uso de Morningstar](https://www.morningstar.com/mm/user-agreement) · [Condiciones de Investing.com](https://www.investing.com/about-us/terms-and-conditions)
