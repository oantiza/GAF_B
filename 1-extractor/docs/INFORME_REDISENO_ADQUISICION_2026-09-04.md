# Informe del rediseño de la adquisición de datos — 1-extractor

*4-5 de septiembre de 2026. Todas las cifras salen de ejecutar y contar; el
método está en §4 y los ficheros de apoyo en `reports/` (no versionado) y en
`docs/DIFF_CANONICOS_2026-09-04_*.md` y `docs/DIFF_CANONICOS_2026-09-05_kid.md`
(versionados). La segunda entrega (KID de la gestora, 05-09) se describe en
§1.5, §2, §7, §9 y §10.*

## 1. Qué se ha hecho

Punto de partida ([descubrimiento del 04-09](../../DESCUBRIMIENTO_ADQUISICION_DATOS_2026-09-04.md)):
Morningstar, por su API interna con apikey pública, aportaba el 99,1 % de los
campos; un único TTL de 7 días hacía que cada pasada costara 9,4 h y 29
peticiones por fondo; nada decía quién había escrito cada campo; y si el grifo
se cortaba (ocurrió el 03-09) la ficha se quedaba sin el indicador de riesgo del
KID ni los costes ex-ante.

Entregado, en once commits sobre `1-extractor` (nada tocado en
`2-plataforma-datos` ni en `3-BDB-ACTIVOS_app`):

1. **TTL por familia de dato** (`core/familias.py`, `core/http.py`): ocho
   familias con su plazo; la caché se lee con el TTL de la familia y no se
   invalidó ni un byte de los 1,4 GB. Modos `--familias`, `--sin-caducidad`,
   `--sin-red`. Alias de lectura para el host retirado `tools.morningstar.es`.
2. **Procedencia por campo** (`core/adquisicion/procedencia.py`, `core/schema.py`):
   `meta.procedencia` en cada ficha (ruta → `fuente:endpoint`), `provenance` en
   el canónico; fusión hoja a hoja con la misma semántica de siempre.
3. **Adaptadores con capacidades declaradas, planificador y núcleo único**
   (`core/adquisicion/`): `python main.py capacidades --sin morningstar`
   responde «si cae X, ¿qué me queda?».
4. **Bloque regulatorio fuera de Morningstar**: cinco adaptadores oficiales
   (CNMV ficha+KID, CSSF, ESMA, AMF GECO, GLEIF) y la ampliación de la CNMV a
   los ficheros trimestrales (costes, TER, vocación, cartera completa). Parser
   de KID/PRIIPs en español, inglés y francés. Bloque `regulatory` en el canónico.
5. **El KID de la gestora para los fondos no españoles** (05-09,
   `fetchers/kid_gestora.py`): el documento se va a buscar a la web del
   productor por ISIN (DWS, Amundi, JPMorgan, Invesco, Nordea, Candriam,
   Goldman Sachs; Schroders y M&G construyendo la URL desde el nombre legal de
   la clase) y, de último recurso, al espejo de documentación de fondos de
   Deutsche Bank España. 388 fondos LU/IE/DE/FI/BE ganan SRI, costes y
   fecha del KID oficiales; el SRI oficial pasa del 14 % al 70 % del universo.

Puertas: `python tools/sync_contratos.py --check` ✔ · `python -m ruff check .` ✔ ·
`python -m pytest` 101 pruebas ✔ · los 763 canónicos validan contra
`fondosdb-fund.v1` / `fondosdb-stock.v1` (0 incumplimientos).

## 2. Fuentes oficiales: lo que se verificó y lo que se descartó

Todo se probó desde esta máquina el 04-09; las cifras de cobertura son sobre el
universo real (689 fondos y ETF: 481 LU, 83 ES, 74 IE, 38 FR, 5 FI, 4 BE, 4 DE).

| Fuente | Naturaleza | Da | Cobertura medida |
|---|---|---|---|
| **CNMV, ficha oficial** `consultas/iic/fondo.aspx?isin=` | regulador | armonizado (UCITS), nº y fecha de registro, gestora y depositaria legales, **KID de la clase** (también en fondos con compartimentos/clases), fecha de emisión del ISIN (ANCV) | 82/83 ES (el ISIN restante no existe en ningún registro) |
| **CNMV, ZIP trimestral** (FONDTRIM/FONDCART/FONDPATRIMDISVAR) | regulador | comisiones devengadas, TER por trimestre, vocación, rentabilidad y volatilidad trimestral, rotación, **cartera completa** del informe periódico | 83/83 ES |
| **CSSF**, fichero de identificadores UCITS | regulador | UCITS, paraguas, compartimento, clase, divisa, autorización | 481/482 LU |
| **ESMA**, registro de comercialización transfronteriza | regulador (índice Solr JSON) | marco UCITS/AIF, **gestora legal**, domicilio, estado, países de comercialización | 517/606 no-ES (LU 100 % por nombre exacto CSSF; IE/BE/FI/DE por tokens, solo coincidencias claras) |
| **AMF GECO**, API interna de la base oficial | regulador | gestora y LEI, OPCVM/FIA, depositario, fechas, clasificación AMF, clase, **DIC/KID en PDF** | 21/38 FR con ficha; 15 con KID |
| **GLEIF**, API de LEI | registro global sin clave | LEI, nombre legal, jurisdicción, gestora legal | 118/121 ES+FR; 0 LU/IE (esas clases no declaran el ISIN a GLEIF) |
| **KID de la gestora** (05-09): DWS `download.dws.com/product-documents/{ISIN}`, Amundi `amundi.es/retail/dl/doc/kid-priips/{ISIN}`, JPMorgan (Fundsquare `wl.fundsquare.net/serv/down-doc`), Invesco `content/dam/.../kid/{ISIN}_kid_ES-ES.pdf`, Nordea (FundConnect), Candriam (ficha por ISIN), Goldman Sachs `kiids/{ISIN}_ES_PRIIPSVEU.pdf`, Schroders `api.schroders.com/document-store/SISF_{compartimento}-{divisa}_{clase}-PRIIPEU-ESES.pdf`, M&G `funds-literature/prp/(lux)-{fondo}_{divisa}_{clase}_{acc}_es_kiid_spa_pe_{isin}.pdf` | documento del productor (PRIIPs, art. 5) | **KID de la clase**: SRI, composición de costes, periodo de mantenimiento, fecha, productor, artículo SFDR | 168 fondos por patrón propio (DWS 27/27, Amundi 31/31, JPMorgan 25/25, Invesco 20/20, Schroders 30/34, M&G 14/17, Nordea 8/17, Goldman Sachs 8/17, Candriam 5/11) |
| **Espejo de documentación de fondos de Deutsche Bank España** `servicios.deutsche-bank.es/documentacionfondos/getDocumento?codDoc={ISIN}&codSus=KIID` | distribuidor obligado a entregar el KID vigente; sirve el PDF del productor byte a byte (comprobado con Schroders, M&G, JPMorgan e Invesco) | el mismo KID, para las gestoras sin patrón (BlackRock, Fidelity, Morgan Stanley, Robeco, Pictet, UBS, MFS…) | 220 fondos más; 17 documentos rechazados por antiguos (14 KID de 2022-2025 y 3 KIID UCITS) |

Descartadas, con motivo:

- **Fundsquare / FE fundinfo**: es hoy una empresa comercial y su buscador
  público no devolvió resultados por ISIN ni por nombre.
- **CNMV, registro de IIC extranjeras**: solo nivel paraguas (nº y fecha de
  registro, país, UCITS); sin ISIN ni documentos. ESMA da lo mismo y más.
- **Banco Central de Irlanda**: registros en PDF, por nombre, sin ISIN.
- **ESMA FIRDS**: solo instrumentos admitidos a negociación (12 ETF); no aporta
  nada regulatorio que no tengamos.
- **ESAP** (punto de acceso único europeo): no arranca hasta julio de 2027 y su
  primera fase no incluye los KID.
- **Repositorio de KID de DWS** (`download.dws.com`): solo productos propios;
  el 05-09 pasó a ser el patrón propio de DWS.
- **CNMV, IIC extranjeras por ISIN**: la ficha `iicextranjera?isin=` no
  resuelve nada; la consulta va por NIF del vehículo y no publica documentos.
- **Fidelity** (`fidelityinternational.com/FILPS`): 403 a cualquier cliente que
  no sea un navegador real; sus KID llegan por el espejo. **BlackRock/iShares**
  exigen el slug del nombre en la URL del KID (no construible con seguridad):
  25 de 43 llegan por el espejo. **Franklin Templeton** sirve el mismo PDF sea
  cual sea el ISIN del nombre del fichero: el parser comprueba el ISIN dentro
  del documento y lo rechaza. **Andbank Luxembourg** fecha los ficheros con un
  sello de tiempo y su web no respondió.
- **Fundsquare público, FundConnect, fundinfo**: sin búsqueda pública por ISIN
  (FundConnect y Fundsquare sí sirven a las gestoras que los usan: Nordea y
  JPMorgan, con su identificador de cliente público).

Lo que **no existe** en abierto: un repositorio oficial de KID para fondos
luxemburgueses e irlandeses. La ley obliga a publicarlo en la web de la
gestora, que es heterogénea (unas 90 gestoras para 555 fondos LU/IE). Desde el
05-09 el adaptador `kid_gestora` lo resuelve para 388 de ellos (§7).

## 3. Arquitectura

Descrita en [`ADQUISICION_2026-09-04.md`](ADQUISICION_2026-09-04.md). Reglas
que conviene tener presentes:

- Morningstar **no cambia cómo pide**: mismas URL y parámetros, así la caché sigue
  sirviendo. Declara la familia de cada endpoint (screener → precio 1 d; snapshot y
  sal de cartera → 30 d; Mifid y fees → 90 d; people/parent → 365 d).
- Lo oficial gana a lo comercial solo en `riesgo.sri_kid_1a7`,
  `identificacion.ucits` e `identificacion.domicilio`. En el resto de rutas
  comunes Morningstar sigue ganando y lo oficial rellena huecos; lo oficial nuevo
  va a rutas propias (`costes.kid.*`, `costes.cnmv.*`, `cartera.cnmv.*`,
  `identificacion.*_legal`). Por eso el bloque `ms.*` del canónico conserva su
  semántica y sus valores.
- `ms.costs.mifid_ongoing` cae al «gestión y otros costes» del KID oficial solo
  si falta el EMT de Morningstar, y lo dice (`mifid_ongoing_from_kid`).
- El VL lo pone la fuente con la fecha más reciente (la CNMV publica el fin de
  mes con retraso y, por ir primera en la prioridad, pisaba el diario).
- Un ISIN sin ninguna fuente real no genera ficha ni canónico.
- La guarda de calidad de siempre (`quality_regression_reason`) sigue impidiendo
  que una pasada peor pise una ficha mejor: protegió a los dos fondos que
  Morningstar ya no resuelve (§6).

## 4. Método de verificación (el oráculo)

Tres regeneraciones de los 763 canónicos, comparadas campo a campo con
`tools/diff_canonicos.py` (cada hoja: idéntico / cambia / aparece / desaparece):

| Paso | Código | Datos Morningstar | Resultado |
|---|---|---|---|
| **B0** | HEAD del 04-09 antes del rediseño, en un worktree aislado | caché (`--sin-caducidad`), estado CNMV de julio | línea base: aísla la **deriva previa** al rediseño (§6) |
| **R1** | núcleo nuevo (adaptadores, procedencia, fusión hoja a hoja, sal por bloques) | idéntica a B0 | **126.567 hojas, 100,00 % idénticas** a B0: el refactor no cambia ni un valor |
| **Final** | todo lo anterior + fuentes oficiales + `regulatory`/`provenance` | caché para Morningstar; **fuentes oficiales en vivo** | §5 |

Morningstar se leyó de caché a propósito: usar las mismas respuestas que
produjeron los canónicos vigentes es lo que hace limpio el diff (un refresco en
vivo cambia VL, rentabilidades y carteras y esconde regresiones bajo ruido).
Las fuentes nuevas fueron en vivo, con ritmo educado y caché desde la primera
petición: 925 peticiones a red (712 regulatorio, 189 identidad, 24 analítica)
frente a 18.568 servidas de caché, 0 errores, 2 fichas protegidas por la guarda.

Las 74 acciones no se han regenerado con el extractor (§6.1); sus canónicos se
reescriben desde la ficha de julio y salen idénticos salvo los bloques nuevos.

## 5. Diff campo a campo: final frente a `export_bdb/` del 03-09

763 canónicos comunes, ninguno desaparece, ninguno nuevo.

| Categoría | Hojas | Detalle |
|---|---:|---|
| idéntico | **125.309** | 94,9 % de las hojas preexistentes |
| cambia | 3.092 | 16 rutas, todas justificadas abajo |
| aparece | 85.492 | 54.697 en `provenance.*`, 27.170 en `regulatory.*`, 3.625 en rutas preexistentes |
| **desaparece** | **2** | una ruta, sin pérdida de dato (abajo) |

Detalle completo, ruta a ruta, en `DIFF_CANONICOS_2026-09-04_completo.md`.

### 5.1 Desaparecen (2 hojas)

`classification_v2.sources_used[]` en IE00B4M6YD48 e IE00BDFD9C92: la lista de
fuentes pasa de `[config_csv, eodhd, morningstar_lt]` a `[config_csv,
morningstar_lt]`. En julio EODHD corría también para fondos; el código vigente
antes del rediseño ya no lo hace (la misma diferencia aparece en B0). EODHD no
había aportado ningún campo del canónico a estos dos fondos. **No es pérdida de
dato**; es la lista de fuentes diciendo la verdad.

### 5.2 Cambian (3.092 hojas en 16 rutas)

| Ruta | Hojas | Justificación |
|---|---:|---|
| `classification_v2.sources_used[]` | 1.306 | entran las fuentes oficiales (cssf, esma, cnmv_ficha, gleif, amf_geco) y sale `eodhd` de los fondos (deriva previa, también en B0) |
| `derived.ruleset_version`, `quality.parser_version` | 763 + 763 | adaptador `fondosdb_adapter_1.1` (bloques nuevos) |
| `ms.holdings_top10[].weight/name`, `ms.holdings_stats.top10_weight` | 90 + 63 + 9 | 9 ETF cuyas posiciones vienen de **justETF**, que la librería `justetf-scraping` descarga en vivo fuera de nuestra caché: cambian en cada pasada (también en B0). Oportunidad en §8 |
| `validation/classification_v2/quality.warnings[]` | 38 + 23 + 23 | 8 fondos ES ganan el aviso `mifid_ongoing_from_kid` (§5.3) y otros el `rf_sin_calidad_crediticia`; el índice de la lista se desplaza |
| `ms.report_date`, `report_date` | 3 + 3 | ES0127097030, LU0704154706, LU0835722488 no tienen `rentabilidad.fecha_dato` y el canónico cae a la fecha de la pasada (comportamiento previo) |
| `quality.ok`, `routing.status`, `validation.ok` | 2 + 2 + 2 | ES0105394003 y ES0127097030 salen bloqueados (2/10 esenciales). El paquete del 03-09 se generó **antes** del commit 30271a2 del 04-09 que hizo real la validación; B0 los bloquea igual |
| `ms.costs.ter` | 1 | LU0835722488: 2,38 → 2,49. El screener de ese fondo no estaba en caché bajo ninguno de los dos hosts y se pidió en vivo (también en B0) |
| `ms.fixed_income.avg_credit_quality` | 1 | LU1697018064: BB → BBB. Fondo de la muestra de 23 cuyo screener se refrescó en vivo el 04-09 en la demostración del refresco diario; Morningstar había actualizado el dato |

### 5.3 Aparecen en rutas preexistentes (3.625 hojas)

| Ruta | Hojas | Justificación |
|---|---:|---|
| `classification_v2.sources_used[]` | 1.242 | fuentes oficiales nuevas en la lista |
| `validation.diagnostics.calidad_score/esenciales/alertas` | 763 × 3 | los añadió el commit 30271a2 del 04-09 (validación real), anterior al rediseño; el paquete del 03-09 no los tenía |
| `ms.costs.mifid_ongoing` | 8 | fondos ES sin EMT en Morningstar: ahora la cifra sale del KID oficial (aviso `mifid_ongoing_from_kid`) |
| `ms.holdings_top10[]` (LU0251119078, LU0251131362) | 49 | en julio la cartera venía degradada (solo top del snapshot); la caché guarda ahora `sal_position` completo y el snapshot deja de marcarlas degradadas (también en B0) |
| `ms.sectors.*`, `portfolio_exposure_v2.sectors.*`, `holdings_stats.top10_weight` | 7 | justETF en vivo (IE0002PG6CA6, IE00B3YCGJ38) |
| `validation/quality/classification_v2.warnings[]`, `routing.reason`, `validation.errors[]` | 30 | avisos y motivos nuevos coherentes con lo anterior |

### 5.4 Aparecen: bloques nuevos (81.867 hojas)

- `provenance` (54.697): `fields` (campo del canónico → `fuente:endpoint`),
  `endpoints` con `fetched_at`, `sources`, `plan`, `dependency`.
- `regulatory` (27.170): SRI, SRRI, KID (fecha, idioma, periodo recomendado,
  costes, URL, sha256, productor), costes ex-ante MiFID, UCITS, marco legal,
  SFDR, domicilio, gestora comercial y legal, LEI, depositario, fechas de
  lanzamiento/emisión, registros (CNMV, CSSF, ESMA, AMF, GLEIF) e informe
  periódico (top-10 oficial, TER 12 m, comisiones devengadas, rotación).

Ambos entran en el contrato (`additionalProperties: true`) sin tocar el SSOT.

## 6. La deriva previa, separada del rediseño

B0 frente al paquete del 03-09 (`DIFF_CANONICOS_2026-09-04_deriva_previa.md`):
122.366 idénticas, 1.725 cambian, 2.476 aparecen, **4.312 desaparecen**. Nada de
eso es del rediseño; conviene saberlo:

### 6.1 `ms.stock.fundamentals.*` de las 74 acciones (≈ 45 hojas por acción)

La ficha de julio de cada acción lleva un bloque `fundamentales` con esquema
`bdb.fundamentals-summary.v1` (analistas, capital, dividendos, GICS, valoración,
técnicos, sha256 del payload). **Ningún código del repositorio, en ninguna
versión del historial, produce ese esquema**; el `fetchers/eodhd.py` vigente
mapea una docena de campos planos. Regenerar una acción con el extractor
actual pierde ese bloque. Decisión: las acciones no se han regenerado en esta
entrega (sus canónicos salen de la ficha de julio) y queda anotado como
pendiente: o se recupera el productor de ese bloque o se acepta el esquema plano.
(Una acción, LU1598757687, entró por error en la muestra de 26 y se restauró
desde la copia de julio antes de generar el paquete final.)

### 6.2 Dos fondos que Morningstar ya no resuelve

IE00B03HCZ61 e IE00B18GC888 (Vanguard): el screener no los encuentra desde el
03-09. B0 los escribió vacíos; en la entrega la guarda de calidad bloqueó la
sobrescritura y conservan la ficha de julio. Hay que decidir si se sustituyen
por la clase vigente o se retiran.

### 6.3 Otros

`sources_used` con `eodhd` en fondos (código de julio), 9 ETF con posiciones de
justETF en vivo, LU0835722488 con screener fuera de caché, y `ES0138371004`, un
ISIN de `config/fondos.csv` que no existe en CNMV, GLEIF ni Morningstar (ANCV:
«no ha sido encontrado o está dado de baja»). Conviene retirarlo del universo.

## 7. Qué ha dejado de depender de Morningstar y qué sigue dependiendo

Medido sobre los 689 canónicos de fondos y ETF con `provenance.fields`
(«oficial» = todas las fuentes del campo son reguladores/registros).

### 7.1 Campos que ya salen de fuentes oficiales

| Campo del canónico | Con dato | De fuente oficial | Fuentes |
|---|---:|---:|---|
| `regulatory.ucits` | 688 | **631 (92 %)** | CSSF 481, CNMV 82, ESMA 47 (+ Morningstar en 55) |
| `regulatory.domicile` | 688 | **637 (93 %)** | CSSF 481, CNMV 82, GLEIF 37 (+ Morningstar en 49) |
| `regulatory.management_company_legal` | 607 | **607 (100 %)** | ESMA 503, CNMV 83, AMF 21 — campo nuevo |
| `regulatory.registers.esma` (estado, países, comercializado en España) | 518 | 518 | ESMA |
| `regulatory.registers.cssf` (paraguas, compartimento, clase, autorización) | 481 | 481 | CSSF |
| `regulatory.registers.gleif`, `regulatory.lei` | 118 / 119 | 118 / 119 | GLEIF, AMF |
| `regulatory.registers.cnmv`, `regulatory.isin_issue_date` | 83 / 82 | 83 / 82 | CNMV |
| `regulatory.periodic_report` (top-10 oficial, TER 12 m, comisiones, rotación) | 83 | 83 | CNMV trimestral |
| `regulatory.depositary` | 104 | 104 | CNMV 83, AMF 21 |
| **`regulatory.sri`** | 686 | **480 (70 %)** | KID de la gestora 383, CNMV KID 82, AMF KID 15; Morningstar en 206 (el 04-09 eran 94 oficiales y 592 Morningstar) |
| **`regulatory.kid`** (fecha, idioma, periodo de mantenimiento, costes de entrada, salida, gestión y otros, operación, rendimiento; URL, fuente y hash del PDF) | 485 | 485 | KID de la gestora 388 (patrón propio 168, espejo 220), CNMV 82, AMF 15 — campo nuevo |
| `regulatory.sfdr_article` | 252 | 252 | KID (gestora 222, CNMV 17, AMF 13); Morningstar no lo daba para este universo |
| `ms.costs.mifid_ongoing` | 684 | 8 (respaldo) | KID cuando falta el EMT |
| `name` | 689 | 83 | CNMV; y respaldo CSSF/AMF/ESMA si Morningstar falta |

Para los **83 fondos españoles**, la ficha completa regulatoria (SRI, costes del
KID, UCITS, gestora legal, registro, cartera oficial) sale íntegra de la CNMV:
simulando la caída de Morningstar, la ficha se genera con `validation.ok`,
calidad BAJO (sin analítica) y las dos cifras del asesor presentes. Para
Francia, SRI y costes salen del DIC de la AMF (15 de 38 con documento) y del
espejo (11 más).

Cobertura del KID por gestora tras la pasada del 05-09 (fondos no españoles,
606): DWS 27/27, Amundi 26/26 (+ First Eagle 4/4), JPMorgan 25/25, Invesco
20/20, Schroders 32/34, M&G 16/17, Fidelity 29/40, BlackRock 25/43, Allianz GI
12/20, Nordea 12/17, Goldman Sachs 11/17, Morgan Stanley 12/14, Robeco 11/14,
Edmond de Rothschild 11/14, Candriam 9/11, Pictet 8/8, BNP Paribas 8/16,
Carmignac 7/12, Franklin Templeton 6/10, MFS 5/5, UBS 5/7, Natixis 5/10,
Polar Capital 5/8; sin ninguno: Andbank 0/17, iShares 0/6, abrdn 0/4, ODDO BHF
0/3. Por domicilio: LU 338/481, IE 29/74, FR 26/38, DE 4/4, FI 3/5, BE 3/4.

### 7.2 Campos que siguen dependiendo de Morningstar, y por qué

| Campo | Fondos solo Morningstar | Por qué |
|---|---:|---|
| `regulatory.sri`, costes del KID | 206 / 201 | los 203 fondos no españoles sin KID (de 606): gestoras sin patrón propio y ausentes del espejo (BlackRock 18 —la mayoría irlandeses—, Andbank 17, Fidelity 11, BNP Paribas 8, Allianz GI 8, PIMCO 7, iShares 6, Groupama 6, Goldman Sachs 6, Carmignac 5, Nordea 5, Natixis 5, y 40 gestoras con 1-4 fondos), más 17 documentos rechazados por antiguos (14 KID de 2022-2025 y 3 KIID UCITS) y 1 PDF con el texto vectorizado |
| `regulatory.mifid_ex_ante_costs` (EMT) | 675 | el EMT es un fichero B2B entre gestora y distribuidor; no se publica |
| `regulatory.launch_date_class/fund` | 686 | la CNMV da la fecha de emisión del ISIN (82) y la AMF la de creación de la clase; ambas van en rutas propias para no cambiar el valor vigente; CSSF solo da la autorización del paraguas |
| `regulatory.management_company` (marca) | 685 | es la marca comercial; la legal (`_legal`) ya es oficial |
| `regulatory.sfdr_article` fuera de ES/FR | — | se publica en el folleto/web de la gestora y en el EET (B2B); no hay registro |
| `ms.holdings_top10` fuera de ES | 675 | los informes periódicos LU/IE son PDF de paraguas de cientos de páginas; la CNMV lo da en XML solo para España |
| categoría, estrellas, medalist, globos ESG, carbono, matriz de riesgo | 686 | **analítica propietaria**: se conserva a propósito (decisión del 04-09) |

## 8. Coste de una pasada

| Medida | Antes | Ahora |
|---|---|---|
| Regeneración completa (689 fondos/ETF) | 29 peticiones/fondo, 9,4 h (todo a red) | 925 a red + 18.568 de caché; las oficiales 712 |
| Primera pasada del KID de la gestora (606 fondos no ES, 05-09) | — | 616 a red (592 KID: patrón propio, espejo y fallos recordados 30 días) + 16.994 de caché, 41 min; repetirla desde caché: 28 a red, **1 min 53 s** |
| Refresco diario (`--familias precio`) | 29 peticiones/fondo | **1,26 peticiones/fondo** (29 en 23 fondos: el screener, más los reintentos de universo) |
| Tiempo del refresco diario, muestra de 23 | — | 1 min 15 s → ≈ 35-40 min para 763 al ritmo actual (1,2 s + jitter) |
| Peticiones que fallan en sal-service y se repetían en cada pasada | siempre | memoria negativa de 30 días |

## 9. Hallazgos de datos que merecen una decisión

- **5 discrepancias de SRI entre el KID oficial y la copia de Morningstar** (de
  94 comparables): ES0114633003 (3 vs 4), ES0116567035 (2 vs 3), ES0140986011
  (2 vs 3), ES0159259011 (4 vs 5), FR0010286013 (3 vs 2). El KID lleva fecha
  y manda; la app debería mostrar el oficial.
- **9 más con el KID de la gestora** (de 383 comparables; las nueve verificadas
  a mano en la prosa y en el gráfico del PDF): DWS Deutschland LC
  (DE0008490962, KID 5 vs 4), BGF Sustainable Energy A2 y E2 (LU0171289902,
  LU0171290074, 4 vs 5, KID del 24-06-2026), Schroder ISF Emerging Asia A1
  (LU0181496216, 5 vs 4), EdR US Value A (LU1103303167, 4 vs 5), M&G (Lux)
  Global Listed Infrastructure A (LU1665237704, 4 vs 3, KID del 14-08-2026),
  Cartesio Income R (LU1966822956, 2 vs 3), BGF China Bond A2 (LU2267099674, 4
  vs 3) y GS Global Equity Income E (LU0133264522, 4 vs 3). Además, el DIC de
  la AMF de FR0010041822 dice 2 y Morningstar 3 (el gráfico de la escala lo
  confirma). En la mayoría el KID es más reciente que la copia.
- **El espejo conserva documentos antiguos**: 14 KID de 2022-2025 (BlackRock,
  Carmignac, BNP Paribas, Robeco, Goldman Sachs, Fidelity, Polar Capital) y 3
  KIID UCITS anteriores a 2023 (BNY Mellon 2018, Groupama, Azvalor). Un KID se
  revisa al menos una vez al año: el adaptador rechaza los de más de 15 meses y
  cualquier documento sin las marcas PRIIPs, y deja la copia de Morningstar.
  En uno de ellos (LU0769137737, BGF Continental European Flexible) el KID de
  2023 decía SRI 5 y Morningstar 4: sin la regla, un dato viejo habría pisado
  uno vigente.
- **Franklin Templeton sirve el mismo PDF sea cual sea el ISIN** del nombre del
  fichero (`PRIIPSEU_{ISIN}_es_ES.pdf` bajo un mismo identificador): la
  comprobación del ISIN dentro del documento es imprescindible. La URL de
  Schroders construida desde el nombre dio en 4 casos el KID de otra clase
  (misma comprobación, mismo rechazo; el espejo dio el bueno).
- **El SRI no siempre está en la prosa**: Nordea, Schroders, BlackRock, DWS y
  otros lo dibujan; el lector geométrico (dígito de color distinto o casilla
  sin dígito) lo resolvió en todos los casos de la muestra (68/68). Acatis
  pega el dígito de la escala a la frase («clase de riesgo 1 en una escala de
  7, en la que 3 significa…»): manda la repetición.
- TER oficial CNMV (suma de cuatro trimestres) frente a Morningstar: p. ej.
  1,47 vs 1,49 (ES0110407006), 0,55 vs 0,53 (ES0165142003). Va en
  `regulatory.periodic_report.ter_12m_pct`, sin pisar `ms.costs.ter`.
- El parser CNMV anterior al rediseño casaba FONDCART por el texto del ISIN y
  guardaba en la ficha de 32 acciones y 14 fondos la cartera **del fondo que
  los tenía en cartera**. Corregido (casado por registro y compartimento, y se
  descarta cualquier bloque de otra IIC).
- `justetf-scraping` hace sus propias descargas, sin nuestra caché ni ritmo:
  las posiciones de 9 ETF cambian en cada pasada. Conviene pasarlas por `Http`
  o por la fuente `gestoras` (CSV del emisor).
- El KID de Renta 4 expresa la comisión de rendimiento como «9 % sobre
  resultados»: `regulatory.kid.costs.performance_fee_pct` guarda la cifra tal
  como la imprime el documento; es una tasa sobre resultados, no un % anual
  del patrimonio.

## 10. Siguientes pasos que este rediseño deja preparados

1. **KID de LU/IE**: hecho el 05-09 para 388 fondos (§7). Quedan 203 sin
   KID oficial; los patrones que faltan y merecen la pena: BlackRock/iShares
   (24: la URL del KID lleva el slug del nombre; la página de producto lo
   expone, pero exige el identificador numérico del producto), Andbank (17: su
   web `andbank.com/funds/luxemburg/pdf/lu{isin}_kiid_es_{sello}.pdf` lleva un
   sello de tiempo; habría que leer el índice de su página de fondos),
   Fidelity IE (11: solo desde navegador real), PIMCO (7: publica vía fundinfo),
   AllianzGI (8: `regulatory.allianzgi.com`, rutas con fecha), BNP Paribas (8:
   `docfinder.bnpparibas-am.com` sin búsqueda por ISIN). Un segundo espejo de
   distribuidor cubriría la cola larga. Añadir una fuente son diez líneas en
   `kid_gestora.FUENTES` y una prueba.
2. **Una sola vía**: el backend de la app (7 hilos, sin caché, contra la API
   interna) debería invocar `core.adquisicion.nucleo` en vez de reimplementarlo.
   Es cambio en `3-BDB-ACTIVOS_app`, fuera de este encargo.
3. Retirar `ES0138371004` del universo y decidir qué hacer con los dos Vanguard.
4. Recuperar (o dar por perdido) el productor del bloque `fundamentales` rico de
   las acciones (§6.1).
5. Bajar el ritmo a las fuentes oficiales (hoy comparten `rate_limit_segundos`
   con Morningstar) si el refresco diario debe bajar de 20 min.
6. CNMV: el detalle trimestral del primer trimestre de 2026 aún no está en los
   ZIP publicados; el adaptador lo incorporará solo cuando aparezca.

## 11. Cómo operar

```
python main.py update --all --familias precio        # refresco diario barato
python main.py update --all                          # pasada normal, cada familia a su ritmo
python main.py update ISIN... --sin-caducidad        # regenerar sin gastar red (Morningstar)
python main.py capacidades --ruta riesgo.sri_kid_1a7 # quién da el SRI (cnmv_ficha, amf_geco, kid_gestora, Morningstar)
python main.py capacidades --sin morningstar         # qué queda si cae
python main.py bdb                                   # canónicos con regulatory y provenance
python tools/diff_canonicos.py ANTES DESPUES --salida reports/diff
```
