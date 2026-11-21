# Datos públicos para fondos, ETF y empresas: opinión sobre el plan

**Fecha:** 28 de septiembre de 2026 · **Autor:** Claude Fable 5.1 · **Estado:** opinión y diagnóstico; no se ha tocado código ni datos.

**Documentos valorados:** `INFORME_PROGRAMA_DATOS_PUBLICOS_FONDOS_2026-09-28.md` (diseño, Opus) y `3-BDB-ACTIVOS_app/output/INFORME_TRASPASO_CLAUDE_FABLE_5_1_2026-09-28.md` (traspaso, Codex/Astra). También `FUENTES_PUBLICAS_FONDOS_2026-09-28.md` y `PROGRAMA_DATOS_PUBLICOS_FONDOS_2026-09-28.md`.

**Qué he examinado directamente:** las 840 fichas de `1-extractor/data/funds/`, el registro de adaptadores (`core/adquisicion/registro.py`), los fetchers, `config/settings.json`, los contratos de `2-plataforma-datos/contracts`, el mapeador de lectura de la app (`functions_python/readmodel/mappers.py`), la ingesta de activos de la app (`ingest_asset.py`, `fund_ingest.py`, `scripts/improve_fund_data.py`), el censo de producción de Codex (`coverage-result.json`, `collection_summary.json`) y la orden `python main.py capacidades --sin morningstar_lt,morningstar,eodhd`, ejecutada hoy en tu PC. La consulta directa a Firestore por el conector no devolvió documentos, así que las cifras de producción son las del censo del 28-09 (12:27 UTC).

---

## 1. Respuesta corta

1. **Sí, la documentación pública y gratuita alcanza para los fundamentales que la app consume de fondos y ETF**, con tres huecos que conviene aceptar desde el principio: categoría/estrellas/medalist de Morningstar (propietario, se sustituye por clasificación propia), style box y capitalización homogéneos (solo algunas fichas lo traen) y la serie diaria de VL de fondos no españoles (EODHD, ya decidido).
2. **En renta fija, lo público puede ser mejor que lo que tienes hoy.** Con Morningstar, solo el 25 % de tus fondos tiene duración, el 26,5 % TIR y el 45 % rating medio. Las fichas mensuales de DWS, Amundi, PIMCO, UBS o Schroders publican esos tres datos. Es el bloque donde el programa aporta más valor, y por eso el piloto de 58 fondos RF que propone Codex es el punto de partida correcto.
3. **"Fácil" no; "factible y sostenible" sí.** Identidad, regulatorio y costes ya están resueltos (71 % de KID leído de fuentes oficiales; el 29 % restante es un problema de localización de URL, no de disponibilidad). La composición exige un lector por gestora (unas 25 para cubrir el 69 % del universo) y una normalización cuidadosa. Eso es trabajo de semanas por ola, no de días, y tiene mantenimiento permanente.
4. **Para empresas, la parte americana es sencilla y oficial (SEC EDGAR, XBRL trimestral, gratis) y la europea es la difícil**: el XBRL europeo (ESEF) es solo anual; los datos trimestrales o semestrales salen de notas de prensa en PDF. Con 500 empresas y actualización trimestral es abordable, pero hay que redefinir "trimestral" como "último dato publicado, con su fecha".
5. **El módulo de fundamentales de EODHD (59,99 $/mes, ~600 $/año) hoy solo alimenta las 74 acciones del extractor, y esos datos están parados en marzo de 2026.** La app nunca lo llama: sus 315 acciones se dieron de alta con Finnhub y Yahoo. Darlo de baja es de bajo riesgo en cuanto el extractor tenga un adaptador sustituto para acciones.
6. **Mi discrepancia principal con el diseño de Opus:** no haría un programa aparte (`0-datos-publicos`). El extractor ya es ese programa (adaptadores con capacidades declaradas, procedencia por campo, TTL por familia, correcciones en origen, canónico, cargador con puerta). Lo que falta son cuatro adaptadores nuevos y unos lectores de PDF. Crear otra casa duplica fusión, validación y calidad, y añade una cuarta vía de escritura hacia Firestore cuando ya hay tres.

---

## 2. Lo que hay de verdad (medido hoy)

### 2.1 Dos universos que no coinciden

| | Extractor (`data/funds`) | Producción (Firestore, censo 28-09) |
|---|---:|---:|
| Fondos | 754 | 755 |
| ETF | 12 | 19 |
| Acciones | 74 | 315 |
| Otros | – | 1 |
| Total | 840 | 1.090 |

La discrepancia de Codex ("766 frente a 755", "221 sin KID frente a 6") se explica así: el extractor cuenta 754 fondos + 12 ETF = 766; producción tiene 755 fondos + 19 ETF. Y "sin KID" significa cosas distintas: en el extractor, KID **descargado y leído por su propio lector** con SRI y costes (545 de 766 = 71,1 %); en producción, **existencia de algún documento KID referenciado** (749 de 755), muchos de ellos enlaces de Morningstar. Las dos cifras son verdad. El programa debe fijar una única definición: KID PRIIPs de la clase exacta, descargado, con huella, leído y validado.

### 2.2 Procedencia real de los campos (extractor, sin contar filas de posiciones)

| Fuente | Campos | Fondos |
|---|---:|---:|
| morningstar_lt | 175.185 (83 %) | 762 |
| derivado (cálculo propio) | 10.243 | 764 |
| kid_gestora | 6.066 | 443 |
| esma | 5.910 | 585 |
| cssf | 4.920 | 547 |
| cnmv + cnmv_ficha | 6.224 | 83 / 87 |
| gleif | 544 | 126 |
| amf_geco | 516 | 21 |
| justetf / eodhd | 55 / 55 | 12 / 11 |

Codex tiene razón en que el 84 % del informe de Opus "cuenta hojas", pero he excluido las filas de posiciones y el porcentaje apenas cambia (83 %): Morningstar sigue siendo la fuente de casi todo lo que no es identidad legal ni KID.

### 2.3 Cobertura por campo y quién lo da (766 fondos y ETF)

| Campo que usa la app | Cobertura hoy | Fuente | Sustituto público |
|---|---:|---|---|
| Gestora comercial, índice de referencia | 99,7 % | Morningstar | KID (productor) + ficha |
| TER / gastos corrientes | 99,3 % | Morningstar | KID (71 % hoy; objetivo ≥ 95 %) |
| Comisión de gestión aplicada | 83,6 % | Morningstar | Ficha, folleto, CNMV FONDTRIM (ES); no siempre separada |
| MiFID ex ante (corrientes) | 98 % | Morningstar | EMT abierta (pocas gestoras) o gastos corrientes del KID |
| SRI KID 1-7 | 99,6 % | **KID oficial 70 %**, Morningstar 29 % | KID (ya resuelto) |
| Artículo SFDR | 37 % | KID / registros | KID + EET; mejorable |
| Reparto por clase de activo | 99,6 % | Morningstar | Ficha; CNMV FONDCART (ES); informe semestral |
| Sectores RV | 75,8 % | Morningstar | Ficha (11 GICS con tabla de equivalencias) |
| Regiones RV | 78,3 % | Morningstar | Ficha (países o regiones → macro-zonas de la app) |
| Capitalización / style box | 75,8 % / 0 % útil | Morningstar | **Sin sustituto homogéneo** |
| Duración (efectiva o modificada) | **24,7 % / 24,2 %** | Morningstar | Ficha mensual (mejor que hoy) |
| TIR / YTM | **26,5 %** | Morningstar | Ficha mensual |
| Rating medio | **45,4 %** | Morningstar | Ficha mensual |
| Reparto por vencimientos | 62 % | Morningstar | Ficha (parcial) |
| Top 10, nº posiciones, fecha de cartera | 99 % | Morningstar | Ficha; CSV/Excel de gestora; CNMV (ES) |
| Categoría y estrellas Morningstar | 99,7 % / 92 % | Morningstar | **No** (clasificación propia `classification_v2`) |
| Patrimonio | 100 % | Morningstar 89 %, CNMV 11 % | Ficha, CNMV |

Lectura: el bloque regulatorio está hecho; costes están a un paso (localizar los 221 KID que faltan); la composición es el trabajo grande; el perfil de renta fija es donde lo público gana a lo actual.

### 2.4 Si cayera Morningstar hoy

`capacidades --sin morningstar_lt,morningstar,eodhd` deja **63 rutas sin fuente** y 20 con respaldo. El respaldo de `cartera.*` es `gestoras`, que solo cubre los ETF de iShares configurados. Coincido con los dos informes: la composición de ~660 fondos no españoles no tiene hoy respaldo real, y el optimizador se queda sin restricciones si Morningstar corta el acceso (ya ocurrió el 03-09).

### 2.5 Acciones: el módulo de fundamentales de EODHD está casi sin uso

- El extractor tiene 74 acciones (32 españolas, 14 francesas, 13 alemanas, 5 holandesas, 4 británicas, 2 americanas…). 71 tienen `fundamentales` de EODHD y 3 de Yahoo. **La fecha del dato es marzo de 2026 en 52 de ellas** y diciembre de 2025 en 13: llevan medio año sin refrescar.
- La app tiene 315 acciones dadas de alta con `ingest_asset.py`, cuyo propio encabezado dice: "EODHD no incluye fundamentales en el plan actual (403)"; usa Finnhub por ISIN y Yahoo como respaldo. Ninguna función de la app llama a `/api/fundamentals` (comprobado con grep en `functions_python`).
- La app solo consume de las acciones unas 20 magnitudes (`map_fundamentals_summary`): sector, industria, país, capitalización, EV, PER trailing y forward, PEG, P/S, P/B, EV/EBITDA, márgenes, ROA, ROE, crecimiento trimestral de ingresos y beneficio, BPA, valor contable por acción, ingresos por acción, dividendo, yield, payout y fecha ex-dividendo.

Conclusión: el plan de fundamentales de EODHD (59,99 $/mes según su web hoy) sostiene únicamente un bloque del extractor que ya está desactualizado. Se puede dar de baja en cuanto exista el adaptador sustituto para acciones (sección 5). El plan "EOD All World" (19,99 $/mes) se mantiene para series, como ya decidiste.

### 2.6 Tres vías de escritura hacia Firestore, y una cuarta a punto de nacer

1. Extractor → `export_bdb` → cargador de `2-plataforma-datos` (con puerta y pasada en seco). Es la vía diseñada.
2. `fund_ingest.py` en Cloud Functions: alta de fondos desde el panel Admin **directamente desde Morningstar**, con histórico mensual reconstruido. Contradice el objetivo del plan.
3. `scripts/improve_fund_data.py` (Codex): lee `export/fondos.ndjson` del extractor y escribe `fund_profile/latest` y campos de renta fija en Firestore con copia previa, sin pasar por el cargador. Además, las 65 "referencias mensuales" se reconstruyeron desde gráficos de Morningstar.

El diseño de Opus, tal como está, crea una cuarta vía. Esto es lo que más me preocupa del conjunto: no la obtención de datos, sino que haya cuatro programas escribiendo fundamentales con definiciones distintas.

---

## 3. Opinión sobre los dos informes

### 3.1 Informe de diseño (Opus)

**Lo que está bien y mantendría:** el catálogo de datos derivado de lo que la app lee de verdad; procedencia por campo con URL, hash y fecha; prioridad de datos estructurados (JSON de JPMorgan, Excel de BlackRock, CSV de iShares) sobre PDF; lector por plantilla antes que IA; validación dura con cola de revisión; comparación con Morningstar como oráculo de transición (no como verdad); la tabla de olas por peso de gestora; el uso de CSSF como llave para construir URL por nombre legal; y la idea de que la app no cambia porque el contrato de salida es el mismo.

**Lo que corregiría:**

- **Arquitectura.** No hace falta `0-datos-publicos`. El propio informe de fuentes (el primero del día) lo decía: "es una ampliación de `core/adquisicion/`, no hace falta un programa nuevo aparte". Entre ese informe y el de diseño se pasó a un programa independiente con su propio `fusiona`, `valida`, `clasifica`, `procedencia` y `planificador`, que son exactamente `core/adquisicion/`, `core/calidad.py`, `core/correcciones.py` y `core/adaptador_bdb.py`. Propongo: cuatro adaptadores nuevos registrados en `registro.py` (`ficha_gestora`, `estructurados`, `findatex`, `informe_periodico`), un paquete `lectores_ficha/` y las tablas de taxonomía en `config/`. Se ejecuta con `main.py update --fuentes …` y sale por el canónico de siempre. Si quieres separarlo como repositorio, que sea un paquete que el extractor importa, no una segunda tubería.
- **Renormalizar a 100 % con derivados.** Codex tiene razón: no se debe renormalizar la exposición neta con derivados a 100 %. Se guarda bruta y neta con su base, y el optimizador decide con la neta y un aviso.
- **Contradicciones de antigüedad.** El diseño acepta fichas de más de 120 días "con aviso" y a la vez las rechaza como regla dura. Hay que separar tres estados: documento conservado, dato elegible para análisis, dato caducado para revisión.
- **Validación del lector con IA.** "La cifra aparece literalmente en el texto" es necesario pero no suficiente: 3,7 puede ser la duración del fondo o la del índice. Hay que exigir página, sección, etiqueta, unidad y a qué se refiere (fondo/clase/benchmark).
- **Rangos duros universales** (suma 100 ± 2, duración 0-30, pesos −50/150). Un fondo de deuda muy larga, un long/short o una cartera con futuros rompen esas reglas legítimamente. Mejor rangos por tipo de fondo, con excepciones documentadas.
- **Almacenamiento.** El cálculo del informe (0,5-1 GB/año) no cuadra: 700 fichas × 300 KB-1 MB × 12 meses son 2,5-8 GB/año. Con campañas trimestrales, 0,8-2,8 GB/año. No es un problema, pero conviene que la cifra sea correcta.
- **Consulta jurídica general.** "Documentos públicos + robots.txt" no equivale a permiso de uso. Cada gestora tiene sus condiciones. Lo razonable es lo que dice Codex: verificar por fuente y no redistribuir los PDF. El único punto verdaderamente sensible sigue siendo Morningstar; todo lo demás es documentación que la gestora publica por obligación o para inversores.

### 3.2 Informe de traspaso (Codex)

Es un buen contrapeso. Sus 16 correcciones son en su mayoría acertadas, y las de método (ejes de RF no excluyentes, yield sin definición no es YTM, ausencia ≠ cero, no inferir cobertura por la letra "H", no confundir vencimiento con duración) las adoptaría tal cual. Dos matices:

- **"No mover los adaptadores"** (su punto 14). Estoy de acuerdo en no mover nada, pero por la razón contraria: no hay que mover los adaptadores porque el programa nuevo debe vivir donde ya están.
- **Su prudencia con la clasificación propia** (punto 12) es correcta, pero no evita el problema: cuando Morningstar deje de responder, `commercial_type` se queda vacío. `classification_v2` ya existe y ya se calcula; lo que hace falta es medir cuántos fondos cambiarían de etiqueta y revisar esa lista antes de conmutar.

Lo que no dice Codex y me parece relevante: su propia herramienta (`improve_fund_data.py`) y el alta desde Morningstar de la app son vías paralelas que el plan tiene que absorber, y las 65 referencias mensuales reconstruidas desde gráficos de Morningstar tienen el mismo problema de licencia que el resto de Morningstar.

---

## 4. Fondos y ETF: ¿basta lo público? Fuente por fuente

| Fuente | Qué da | Estado | Mi valoración |
|---|---|---|---|
| CNMV XML (FONDREGISTRO, FONDMENS, FONDTRIM, FONDCART, FONDDERI) | Identidad, VL diario, comisiones, TER, cartera valor a valor de fondos ES | Integrada. Último mes publicado: mayo de 2026 (verificado hoy en la web) | Imprescindible para ES. El retraso de 4 meses la hace inútil para el dato reciente; sirve de histórico y de verificación. FONDCART trae ISIN, divisa, tipo CNMV y ámbito, **no sector ni país de riesgo**: para agregar sectores hace falta un maestro de emisores |
| CNMV ficha + KID, CSSF, ESMA, AMF GECO, GLEIF | Identidad legal, UCITS, gestora, LEI, KID de ES y FR | Integradas | Hecho. No tocar |
| KID PRIIPs de la gestora | SRI, periodo recomendado, costes, SFDR, objetivo | 443 fondos vía patrones + espejo de Deutsche Bank; 221 sin KID | Es el bloque más barato de completar: patrones para BlackRock/iShares, Fidelity, BNP, Allianz, PIMCO, Carmignac, Groupama. Además, como distribuidor, **Andbank está obligado a poner el KID a disposición del cliente**: conviene comprobar si el buscador de fondos de Andbank o su proveedor de documentación (Allfunds/Inversis) sirve el PDF por ISIN sin login, igual que hace Deutsche Bank |
| Ficha mensual (factsheet) | Composición, top 10, perfil RF, gastos, comisión de gestión, patrimonio | Verificada por ISIN en Fidelity, Pictet, Carmignac, BlackRock, JPMorgan, DWS, Robeco; no localizada en Schroders e Invesco | La pieza central. Hay que asumir que una gestora tiene varias plantillas (por gama, país e idioma). Cobertura realista tras las olas 2-3: 70-80 % del universo con composición mensual |
| Datos estructurados (JSON JPMorgan, Excel BlackRock/iShares, CSV iShares/Vanguard/Xtrackers) | Posiciones y desgloses sin PDF | iShares integrado | Prioridad absoluta cuando existen. Para ETF (31 en total entre extractor y producción) esto lo resuelve casi todo: los emisores publican la cartera completa a diario |
| FinDatEx EMT/EPT/EET | Costes ex ante, SRI, SFDR, PAI | Publicadas en abierto por Schroders, Columbia Threadneedle, M&G | FinDatEx solo publica el estándar vacío (verificado); no hay repositorio central de plantillas rellenadas. Útil solo en las gestoras que las cuelgan. Como distribuidor, Andbank recibe las EMT de todas las gestoras: si tienes acceso legítimo a ellas por tu trabajo, son la mejor fuente de costes, pero eso ya no es "público para todo el mundo" |
| Informe anual/semestral | Cartera completa | Sin integrar | Respaldo para Schroders/Invesco y verificación de concentraciones. Lectura costosa; ola 4 |
| Portales (Morningstar, FT, Investing, Quefondos) | Todo | Morningstar en uso | Descartados por condiciones de uso. Mantener Morningstar como dato informativo mientras responda, sin que nada crítico dependa de él |

**Qué se pierde sin sustituto:** categoría y estrellas Morningstar (percentil en categoría, medalist), globos ESG y carbono, style box homogéneo, rentabilidad "frente a categoría". Para un asesor que usa la app delante de clientes, el estándar reconocido son las estrellas; conviene decidir explícitamente que la app dejará de mostrarlas (o que se muestren solo mientras Morningstar responda, marcadas como informativas).

**Qué se gana:** trazabilidad documental (cada dato con su PDF y fecha), perfil de RF mucho más completo, independencia de una API no licenciada y ahorro del módulo de fundamentales.

---

## 5. Empresas: hasta 500, europeas y americanas, trimestral

### 5.1 Lo que la app necesita

Solo lo que proyecta `map_fundamentals_summary`: perfil (sector, industria, país), valoración (capitalización, EV, PER, P/B, P/S, EV/EBITDA, PEG, PER forward), rentabilidad (márgenes, ROA, ROE), crecimiento trimestral interanual, por acción (BPA, valor contable, ingresos, dividendo) y dividendos (yield, payout, ex-dividendo). Con la serie de precios de EODHD y los estados financieros, todo se calcula salvo PER forward, PEG y objetivo de analistas, que exigen consenso (no público). Propongo dejarlos a `null` y retirarlos de la interfaz.

### 5.2 Fuentes públicas

| Ámbito | Fuente | Qué da | Frecuencia | Valoración |
|---|---|---|---|---|
| EE. UU. | **SEC EDGAR, API XBRL** (`companyfacts`, `companyconcept`, `frames`): gratis, sin clave, JSON, actualizada en tiempo real (verificado hoy en sec.gov) | Ingresos, beneficio, BPA, patrimonio, activos, deuda, caja, acciones en circulación, dividendos, flujo de caja: cada 10-Q y 10-K | Trimestral, oficial | **Resuelve la parte americana de forma determinista.** Requiere `User-Agent` identificado y ritmo ≤ 10 peticiones/s. Sector: código SIC de EDGAR (no GICS, que es propietario); mapear SIC a los 11 sectores propios |
| Europa (anual) | **filings.xbrl.org** (XBRL International): índice de informes anuales ESEF con API JSON pública y fichero xBRL-JSON por informe, identificado por LEI (verificado hoy: 542 informes españoles indexados) | Estados financieros anuales IFRS etiquetados | Anual | Sirve para el dato anual. Dos pegas: muchas empresas usan extensiones propias ancladas a IFRS (hay que resolver el anclaje), y el ejercicio llega con 3-4 meses de retraso |
| Europa (semestral/trimestral) | Notas de prensa e informes intermedios en las webs de relaciones con inversores; registros nacionales (CNMV para España, AMF/BALO para Francia, Bundesanzeiger para Alemania, Companies House para Reino Unido, que además sirve cuentas en iXBRL con API gratuita) | Resultados intermedios | Semestral obligatorio; trimestral voluntario en muchos países | **Es la parte difícil.** Sin XBRL: lectura de PDF por plantilla o con IA, con la misma maquinaria que las fichas de fondos. Muchas empresas europeas no publican estados completos trimestrales, solo avances |
| Vínculo ISIN ↔ LEI | GLEIF, fichero ISIN-LEI (gratis) | Necesario para casar tus ISIN con los emisores de filings.xbrl.org y EDGAR (CIK vía ticker) | Diario | Ya usas GLEIF |
| API gratuitas de terceros | Finnhub (ya en la app), Alpha Vantage, FMP | Ratios listos | Variable | No son "documentación pública": son servicios con clave y condiciones. Finnhub limita el plan gratuito a uso personal (conviene releer sus términos antes de usarlo delante de clientes). Yahoo/yfinance: sus condiciones prohíben este uso; lo retiraría de la app y del extractor |

### 5.3 Qué significa "trimestral" en Europa

Para EE. UU., trimestral es literal (10-Q). Para Europa, el compromiso honesto es "último estado financiero publicado, con su fecha y su periodo": anual desde ESEF, semestral desde el informe intermedio y, donde exista, trimestral desde la nota de prensa. Los ratios TTM en Europa se calculan con el anual más el semestral (H1 actual − H1 anterior), y así hay que etiquetarlos. Con 500 empresas y cuatro campañas al año, el volumen es pequeño (unos 2.000 documentos al año) y el coste de IA, marginal.

### 5.4 Orden que propongo para acciones

1. Adaptador `sec_edgar` en el extractor (una semana de trabajo, determinista, sin IA). Cubre todas las americanas.
2. Adaptador `esef_xbrl` sobre filings.xbrl.org para el anual europeo, con resolución de extensiones y registro de las etiquetas no resueltas.
3. Lector de resultados intermedios europeos por plantilla e IA, empezando por las empresas que estén en carteras de clientes.
4. Solo entonces, baja del módulo de fundamentales de EODHD. Mientras tanto, los 74 registros del extractor están congelados en marzo y la app no lo usa: la baja no rompe nada visible, pero mejor sustituir antes que apagar.

---

## 6. Riesgos que añado a los ya listados

- **Licencia de EODHD.** Su web etiqueta los planes de 19,99 y 59,99 $ como "Personal use" y remite a planes de empresa para uso comercial. Usas los datos en informes a clientes. Conviene aclararlo con ellos ahora, aprovechando la negociación de la baja del módulo de fundamentales.
- **Alta de fondos desde Morningstar en la app** (`fund_ingest.py`). Si el plan sigue adelante, el alta debe pasar por el extractor (ya existe el servicio de operaciones `ops_server.py` y el panel Sistema › Operaciones). Si no, cada alta nueva vuelve a depender de Morningstar.
- **Datos que Codex escribió directamente** (`fund_profile/latest`, campos de RF verificados a mano, 65 referencias mensuales). Son valiosos y deben conservarse, pero hay que decidir quién es dueño de esos campos. Si el extractor pasa a dar duración y TIR desde fichas, no puede pisar sin más un dato verificado a mano, ni al revés. Propongo que las correcciones manuales se registren en `config/correcciones.json` del extractor (mecanismo que ya existe) y que `fund_profile` se alimente solo del canónico.
- **Frescura del extractor.** Las acciones llevan seis meses sin refrescar y Codex cuenta 138 composiciones antiguas y 128 recuentos pendientes. Cualquier medida de "cobertura" del programa nuevo debe compararse con el mismo universo y la misma fecha.
- **Definición de ETF.** Hay 12 ETF en el extractor y 19 en producción. Para ETF la solución pública es directa (cartera completa diaria del emisor), pero hay que reconciliar la lista primero.

---

## 7. Recomendación

1. **Construir dentro del extractor**, no aparte: cuatro adaptadores (`ficha_gestora`, `estructurados`, `findatex`, `informe_periodico`) más dos para acciones (`sec_edgar`, `esef_xbrl`), lectores en `lectores_ficha/`, taxonomías en `config/taxonomia/`, y las órdenes nuevas colgadas de `main.py` (`localiza`, `cobertura`, `revision`, `compara-morningstar`). Todo sale por el canónico y el cargador de siempre.
2. **Piloto: los 58 fondos RF de Codex + las 10 gestoras de la ola 2.** El piloto RF ataca el hueco real (duración, TIR, rating) y obliga a resolver definiciones desde el primer día; las 10 gestoras dan el 43 % del universo. Criterio de éxito del piloto: duración y rating en ≥ 70 % de los 58, con página, etiqueta y fecha por dato, y cero escrituras en la maestra.
3. **Cerrar los 221 KID** en paralelo, empezando por comprobar si el proveedor de documentación de Andbank sirve KID por ISIN sin login.
4. **Campañas trimestrales** tras los cierres de marzo, junio, septiembre y diciembre, con segunda pasada a los 15 días, más una actualización a demanda de los fondos que estén en carteras guardadas, y una ola anual de KID en febrero-abril (cuando las gestoras los renuevan). Cada dato conserva fecha efectiva, fecha del documento, fecha de descarga y próxima revisión, como pide Codex.
5. **Acciones:** EDGAR primero (barato y completo), ESEF después, intermedios europeos al final. Retirar Yahoo. Dar de baja el módulo de fundamentales de EODHD cuando `sec_edgar` esté en producción; el plan "EOD All World" se queda.
6. **Morningstar:** pasar a informativo bloque a bloque, gestora a gestora, con la comparación de tolerancias del diseño de Opus; retirar el alta desde Morningstar de la app; decidir si las estrellas desaparecen de la interfaz.
7. **Una sola definición de cobertura**, medida sobre el mismo universo (por ISIN) en extractor y producción, por campo y por familia, antes y después de cada ola.

Si te parece bien este enfoque, el siguiente paso sería un plan de la fase 0 y del piloto RF con estimación de esfuerzo por gestora, sin tocar todavía código ni datos.
