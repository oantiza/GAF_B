# Catálogo de datos de fondos y ETF, y hasta dónde se consiguen solos

*30 de octubre de 2026. Primer paso del programa, según el rumbo de
`DECISIONES_ADQUISICION_2026-10-30.md` §1: antes de construir nada, saber qué datos exactos
necesita el programa y hasta qué punto se pueden conseguir de forma independiente.*

No se ha ejecutado ninguna recolección ni se ha escrito en la maestra para hacer este catálogo.

## Método, y qué significa cada cifra

- **La lista de campos no es una opinión.** Sale del contrato que la app lee de verdad,
  `2-plataforma-datos/contracts/read/asset-for-bdb.v1.schema.json`. Lo que no está ahí, la app
  no lo consume.
- **La cobertura está medida** sobre la copia verificada
  `2-plataforma-datos/data/backups/2026-10-29T09-08-21-424Z`, contando cuántos de los **785**
  fondos, ETF y ETC tienen cada campo con valor (no nulo, no vacío).
- **La procedencia está medida** leyendo `provenance.fields` de cada documento de la maestra,
  que registra qué fuente llenó cada campo.
- **La fuente independiente candidata es análisis**, apoyado en la investigación de
  `FUENTES_PUBLICAS_FONDOS_2026-09-28.md`, que verificó patrones con fondos reales. Va marcada
  como criterio, no como medida.
- **Una advertencia de método.** `provenance` dice qué fuente llenó un bloque, no si el bloque
  está completo. Por eso la cobertura se ha medido campo a campo por separado. Donde las dos
  cosas se confunden salen cifras falsas: el bloque de renta fija aparece atribuido a
  Morningstar en el 97,5 % de los fondos, pero la duración solo está en el 24,1 %.

Las cifras por campo que salen aquí **coinciden de forma independiente** con las medidas el
28-09 por otra vía (duración 24,1 % frente a 25 %; TIR 27,4 % frente a 26,5 %; rating medio
46,5 % frente a 45,4 %). Dos medidas distintas que concuerdan dan confianza en ambas.

---

## 1. El universo: «comercializable en España» no es gratis de definir

El ámbito que fijaste simplifica mucho, pero la llave no está donde parecía.

**Verificado el 30-10, abriendo el fichero.** Se descargó y se inspeccionó
`Estadisticas_IIC_2026_2T_Anexo.xlsx` (1,4 MB, segundo trimestre de 2026, el último publicado).
Tiene once hojas, y entre ellas la **A7.1, «Información individual de las instituciones de
inversión colectiva extranjeras comercializadas en España»**, con 805 filas.

**La respuesta es no: A7.1 no trae ISIN.** Sus columnas son `Denominación`, `Tipo`
(SICAV o FONDO) y luego patrimonio y partícipes con sus porcentajes. Las filas son sociedades:
`2XIDEAS UCITS`, `AB FCP I`, `AB SICAV I`, `A&G FLOTA`… Descontando las nueve filas de cabecera,
del orden de **795 denominaciones**, todas a nivel de paraguas.

**Y el ISIN sí está en el mismo libro, pero en las hojas de IIC nacionales.** Se buscó la cadena
«Código ISIN» y se comprobó en qué hojas se usa:

| Hoja | Filas | ¿Columna ISIN? |
|---|---:|---|
| A1.1, A2.1, A2.2 (IIC nacionales) | 3.138 · 3.118 · 3.201 | **Sí** |
| A4.1 | 243 | **Sí** |
| **A7.1 (IIC extranjeras)** | **805** | **No** |

**Consecuencia para el programa, y es una buena y una mala:**

- **La parte española del universo se resuelve por vía oficial y por ISIN.** La CNMV lo da
  directamente, en unas 3.100 filas, trimestralmente.
- **La parte extranjera no.** La CNMV da el **filtro de autorización** —qué sociedades están
  admitidas a comercialización en España— pero no las clases. Entre «esta sociedad se
  comercializa en España» y «este ISIN es esta clase» falta un paso que la CNMV no cubre, y lo
  tendrían que dar el KID de la clase, la ficha de la gestora o el proveedor de documentación
  del distribuidor.
- **Casar A7.1 con el universo será por nombre**, no por identificador, con todo lo que eso
  trae: nombres comerciales frente a legales, acentos, sufijos de gama. Es un coste real que hay
  que presupuestar, no un detalle.

**Corrección de lo que se dijo antes en este mismo documento.** Se afirmó que los enlaces de
descarga eran tokenizados e inestables. Eso era cierto de los enlaces que se habían cogido de la
página del anexo, pero **eran de otro anexo y de 2009**: el código `200903` de aquella URL es un
periodo, no un identificador de tabla. El anexo vigente **sí tiene ruta estable y predecible**:
`cnmv.es/DocPortal/Estadisticas/IIC/Estadisticas_IIC_{año}_{trimestre}T_Anexo.xlsx`. Un adaptador
puede construirla sin leer la página.

---

## 2. El catálogo

Un bloque por cada grupo del contrato de lectura. «Hoy» es la fuente medida; «independiente» es
la candidata pública u oficial.

### 2.1 Identidad

| Campo | Cobertura | Hoy | Independiente |
|---|---:|---|---|
| `identity.name` | 100 % | Morningstar 674, CNMV 96 | KID, registros (CNMV/CSSF/ESMA/AMF), GLEIF |
| `identity.currency` | 100 % | Morningstar 769 | KID, CSSF |
| `classification.region_primary` | 98,9 % | Derivado y Morningstar | Derivable de la composición |
| `identifiers.ticker` / `eodhd_code` | 1,4 % / 1,3 % | Morningstar, EODHD | Solo hace falta para cotizados |

**Veredicto: sustituible, y casi hecho.** El domicilio, el marco UCITS y la gestora legal ya
vienen de registros oficiales en el 98 % (CSSF 547, CNMV 95, ESMA 55, AMF 21). Lo que sigue
colgando de Morningstar es el nombre y la divisa, que están en el KID y en los registros.

### 2.2 Regulatorio

| Campo | Cobertura | Hoy | Independiente |
|---|---:|---|---|
| `regulatory.domicile` | 98,3 % | CSSF 547, CNMV 95, ESMA 44, GLEIF 39 | **Ya independiente** |
| `regulatory.ucits` | 98,2 % | CSSF 547, CNMV 95, ESMA 55, Morningstar 51 | **Ya casi independiente** |
| `regulatory.management_company_legal` | 88,2 % | ESMA 576, CNMV 95, AMF 21 | **Ya independiente** |
| `regulatory.sri` | 98,2 % | **KID 547**, Morningstar 210 | KID: cerrar los que faltan |
| `regulatory.kid` | 72,0 % | KID 556, CNMV 95 | Patrones de 7 gestoras |
| `regulatory.sfdr_article` | 36,7 % | KID 288 | KID y plantilla EET |
| `regulatory.srri` | 93,2 % | **Morningstar 730** | KID antiguo; en desuso frente al SRI |
| `regulatory.management_company` (comercial) | 98,2 % | **Morningstar 771** | KID (productor), ficha |
| `regulatory.launch_date_class` | 98,2 % | **Morningstar 771** | KID, folleto |
| `regulatory.mifid_ex_ante_costs` | 95,7 % | **Morningstar 751** | KID (gastos corrientes), plantilla EMT |

**Veredicto: sustituible, y es lo más barato que hay.** Media docena de campos con cobertura del
95-98 % cuelgan íntegramente de Morningstar siendo datos que la gestora publica por obligación.

### 2.3 Costes

| Campo | Cobertura | Hoy | Independiente |
|---|---:|---|---|
| `costs.ter_pct` | 98,3 % | **Morningstar 765** | KID: gastos corrientes |
| `costs.mifid_ongoing_pct` | 98,3 % | **Morningstar 748** | KID y EMT |
| `costs.management_fee_pct` | 98,9 % | **Morningstar 769** | Ficha, folleto; CNMV FONDTRIM en ES |

**Veredicto: el TER sí, la comisión de gestión a medias.** El KID da gastos corrientes de forma
homogénea; la comisión de gestión no siempre viene separada. Y aquí rige una convención que no
se puede romper: **la comisión de gestión no se imputa nunca desde el TER**
(`LEGADO_CONOCIMIENTO_SISTEMA_2026-07-12.md` §2).

### 2.4 Exposición y cartera

| Campo | Cobertura | Hoy | Independiente |
|---|---:|---|---|
| `portfolio_exposure.asset_mix` | 98,9 % | **Morningstar 768** | Ficha mensual; FONDCART en ES; estructurados en ETF |
| `portfolio_exposure.sectors` | 76,8 % | **Morningstar 599** | Ficha, con tabla de equivalencias a 11 GICS |
| `portfolio_exposure.equity_regions` | 78,3 % | **Morningstar 612** | Ficha; países a ISO3 y a macro-zona |
| `portfolio_exposure.market_caps` | 76,1 % | **Morningstar 594** | Solo algunas fichas |
| `portfolio_exposure.equity_styles` | 75,9 % | **Morningstar 594** | **Sin sustituto homogéneo** |
| `holdings_summary.positions_count` | 97,1 % | Morningstar 571+ | Ficha, informe periódico, estructurados |
| `holdings_summary.top10_weight` | 87,4 % | Morningstar 721, justETF 10 | Ficha (top 10), estructurados |

**Veredicto: sustituible, y es el trabajo grande.** Es el bloque que el optimizador usa como
restricción, y el que no tiene respaldo hoy para los fondos no españoles. Tres caminos de
dificultad muy distinta: estructurados del emisor (ETF: cartera completa a diario, resuelve casi
todo), ficha mensual en PDF (≈7 de cada 10 gestoras, con lector por plantilla) y FONDCART de la
CNMV para los españoles, que da la cartera valor a valor pero **sin sector ni país**, así que
agregarla exige un maestro de emisores que hoy no existe.

### 2.5 Perfil de renta fija: aquí lo público gana

| Campo | Cobertura | Hoy | Independiente |
|---|---:|---|---|
| `fixed_income_profile.maturity_allocation` | 98,6 % | Morningstar | Ficha (parcial) |
| `fixed_income_profile.avg_credit_quality` | **46,5 %** | Morningstar | Ficha mensual |
| `fixed_income_profile.yield_to_maturity` | **27,4 %** | Morningstar | Ficha mensual |
| `fixed_income_profile.investment_grade_pct` | **27,4 %** | Morningstar | Ficha mensual |
| `fixed_income_profile.modified_duration` | **25,6 %** | Morningstar | Ficha mensual |
| `fixed_income_profile.effective_duration` | **24,1 %** | Morningstar | Ficha mensual |

**Veredicto: el único bloque donde lo independiente es mejor que lo actual.** Tres de cada cuatro
fondos no tienen duración ni TIR, y más de la mitad no tienen rating medio. Las fichas mensuales
de DWS, Amundi, PIMCO, UBS y Schroders publican los tres. Y sale como subproducto del mismo PDF
que da la composición: no es un frente aparte.

### 2.6 Métricas, rentabilidad y serie

| Campo | Hoy | Independiente |
|---|---|---|
| `metrics`, `performance_preview`, `history_available_years` | Cálculo propio desde la serie | **Ya independiente**, si hay serie |
| Serie diaria de VL | EODHD | **Sin sustituto gratuito** |

La serie es la materia prima de la volatilidad, el Sharpe, el drawdown, las correlaciones y la
frontera. Medido el 30-10: EODHD la sirve por ISIN en LU, IE, FR, DE y ES con un día de desfase.
La vía pública y redistribuible es la CNMV, y solo cubre los españoles con ~4 meses de retraso.
**Es el único bloque del sistema sin salida gratuita**, y está decidido pagarlo.

### 2.7 Lo propietario que se conserva por decisión

| Campo | Cobertura | Nota |
|---|---:|---|
| `classification.morningstar_rating` | 90,7 % | **Requerido por el contrato de lectura de la app** |
| `ms.category_morningstar` | 98,0 % | Entra en la excepción decidida el 30-10 |

Un hallazgo que conviene tener presente: la estrella **no es opcional en el contrato** que la app
lee (`classification.morningstar_rating` está en `required`). Retirarla habría sido un cambio de
contrato, no un cambio de criterio. La decisión de conservarla deja al sistema con **una
dependencia propietaria permanente y asumida**: Morningstar nunca llega a cero.

---

## 3. El reparto, en una cifra

Sobre los pares (activo, campo) con procedencia registrada en los 785 fondos y ETF:

| Familia de fuente | Pares | % |
|---|---:|---:|
| Morningstar | 20.876 | **76,3 %** |
| ESMA | 1.845 | 6,7 % |
| CSSF | 1.641 | 6,0 % |
| KID de gestora | 1.396 | 5,1 % |
| CNMV | 863 | 3,2 % |
| GLEIF | 305 | 1,1 % |
| Cálculo propio | 222 | 0,8 % |
| AMF GECO | 128 | 0,5 % |
| Manual, EODHD, justETF | 80 | 0,3 % |

Lo independiente ya es el **22,6 %**, y no es poco: es el bloque de identidad legal y regulatorio
casi entero. Lo que falta es, sobre todo, composición y costes.

---

## 4. Orden por rentabilidad del esfuerzo

No por tamaño del bloque, sino por cuántos campos deja de pedirle a Morningstar cada día de
trabajo.

1. **Cerrar los 221 fondos sin KID.** Patrones de URL para siete gestoras (BlackRock, Fidelity,
   BNP, Allianz, PIMCO, Carmignac, Groupama). El KID está estandarizado por PRIIPs, así que no
   tiene la fragilidad de maquetación de las fichas comerciales. Mueve de golpe el SRI de 210
   fondos, el SFDR, los gastos corrientes y el periodo recomendado.
2. ~~Repescar del KID lo que ya se descarga, cambiando la prioridad por campo.~~
   **Corregido el 30-10 al abrir el código: esto no existe como cambio de prioridad.** Ver §4.b.
3. **ETF por estructurados del emisor.** Cartera completa diaria, sin leer PDF. Son pocos
   activos (19 hoy, 300 objetivo) y se resuelve casi entero.
4. **Ficha mensual por gestora**, empezando por las de más peso. Da composición y, de paso,
   el perfil de renta fija. Es el trabajo grande y el que tiene mantenimiento permanente.
5. **Comisión de gestión** desde ficha, folleto y FONDTRIM.
6. **FONDCART para los españoles**, cuando exista maestro de emisores que permita agregar por
   sector y país.

---

## 4.b Corrección: el «cambio de prioridad por campo» no era lo que parecía

Este catálogo afirmó en su primera versión que el mejor cambio por esfuerzo del programa era
cambiar la prioridad por campo para preferir el KID ya descargado frente a Morningstar, porque
hay KID de 565 fondos y el TER se toma de Morningstar en 765 casos. **Al abrir el código, esa
conclusión no se sostiene.** El error de razonamiento fue comparar la cobertura de un
*documento* con la procedencia de un *campo*, sin comprobar que el canónico tuviera una ruta
alternativa para el mismo concepto.

**Lo que hay de verdad, medido sobre `core/adquisicion/registro.py`:**

- El lector de KID **no escribe en los campos de Morningstar**. Escribe en su propio espacio:
  `riesgo.sri_kid_1a7`, `costes.kid.*`, `identificacion.productor_kid`,
  `identificacion.fecha_lanzamiento_kid`, `esg.sfdr_articulo`.
- El mecanismo de prioridad **ya existe**: `RUTAS_OFICIAL_PRIMERO` en `registro.py`, aplicado en
  `core/adquisicion/nucleo.py`. Hoy contiene tres rutas: `riesgo.sri_kid_1a7`,
  `identificacion.ucits` e `identificacion.domicilio`.
- De las 133 rutas del canónico, **solo 16 están declaradas a la vez por una fuente oficial y
  por una no oficial**. Son las únicas donde una regla de prioridad cambia algo. Tres ya tienen
  la regla puesta.

**Y las trece restantes no se deben voltear, cada una por su motivo:**

| Rutas | Por qué no |
|---|---|
| `valoracion.vl`, `vl_fecha`, `vl_divisa`, `patrimonio_fondo_meur` | La oficial es la CNMV, con ~4 meses de retraso. Voltearlas pondría un valor liquidativo de hace cuatro meses delante de un cliente. Sería un daño, no una mejora |
| `costes.ter_pct`, `costes.comision_gestion_aplicada_pct` | Igual: la CNMV los da, pero trimestrales y atrasados. Hoy manda el dato, no la procedencia |
| `identificacion.nombre` | La oficial da el **nombre legal**, no el comercial. Son conceptos distintos y lo ve el cliente. Decisión de producto, no técnica (ver abajo) |
| `identificacion.fecha_lanzamiento_clase` | La fecha del registro de la AMF no es necesariamente la de lanzamiento de la clase. Solo 21 fondos |
| `cartera.posiciones`, `cartera.peso_top10_pct` | Parte del trabajo de composición, con la pega de que FONDCART no trae sector ni país |
| `esg.sfdr_articulo`, `identificacion.divisa_base`, `identificacion.politica_distribucion` | Serían seguras, pero no mueven nada: el SFDR ya viene solo del KID, y las otras dos solo las tiene la AMF, para 21 fondos franceses |

**Conclusión: no hay un cambio de prioridad material y seguro que hacer.** Donde Morningstar
sigue llenando un campo regulatorio es porque (a) no se leyó KID de ese fondo —es cobertura, no
prioridad—, (b) el KID no trae ese concepto exacto, o (c) el campo de destino está definido como
campo de Morningstar (`ms.costs.ter` se llama así a propósito).

**Lo que sí queda en pie, y sube al primer puesto:** cerrar la cobertura de KID. Es lo que mueve
de verdad el SRI de los ~210 fondos que hoy lo toman de Morningstar, porque el mapa
`regulatory.sri` ya apunta **solo** a la ruta del KID y la regla oficial-primero ya está puesta.
No hace falta tocar prioridad: hace falta tener el documento.

**Y una decisión de producto que esto saca a la luz,** para Óscar: el nombre que se muestra sale
de Morningstar en 674 de 770 fondos, y el **nombre legal de ESMA ya está guardado** para 592
(`identificacion.nombre_legal_esma`). Se podría mostrar el legal y quitar de Morningstar el campo
con más cobertura de todos. Pero el nombre legal es más largo y menos reconocible para un
cliente. No lo cambio por iniciativa propia.

## 4.c Cerrar el KID: el diagnóstico medido, y por qué siete patrones no bastan

Medido el 30-10 sobre las 770 fichas canónicas, con la herramienta nueva
`1-extractor/tools/test_kid.py`, que usa el código de producción y no sale a la red.

**214 fondos no tienen KID oficial leído.** Y lo primero que aparece no estaba en ningún informe
anterior: **el espejo de Deutsche Bank aporta 255 KID, más que todos los patrones de gestora
juntos.**

| Quién aporta el KID hoy | Fondos |
|---|---:|
| Espejo de Deutsche Bank (universal, por ISIN) | **255** |
| Morningstar (es decir, **sin** KID oficial) | 213 |
| Ficha de la CNMV (fondos ES) | 93 |
| Patrones de gestora: Schroders 34, JPMorgan 32, Amundi 31, DWS 27, Invesco 22, M&G 14, Goldman 9, Nordea 8, Candriam 6 | 183 |
| AMF GECO | 14 |
| Correcciones manuales | 11 |

**Y los 214 que faltan son dos problemas distintos, no uno:**

| Situación | Fondos | Qué trabajo es |
|---|---:|---|
| Ninguna fuente casa con su gestora | **196** | Investigar la URL del KID de esa gestora |
| Hay fuente candidata y aun así no hay KID | **17** | Depurar un patrón que ya existe |
| Fondo ES (su KID va por la ficha de la CNMV) | 1 | Nada |

Los 17 son Goldman Sachs 6, Nordea 6, Candriam 2, Schroders 2, Andbank 1: el patrón ya está
escrito y no cubre esas clases, o la descarga falla. Escribí aquí que eran **lo más barato del
programa**; la pasada con red del 30-10 lo desmiente y está en §4.d.

**Lo que corrige el plan de septiembre.** La lista de siete gestoras (BlackRock, Fidelity, BNP,
Allianz, PIMCO, Carmignac, Groupama) estaba incompleta y mal dimensionada:

- **Andbank es la mayor, con 16 fondos, y no estaba en la lista.**
- Carmignac son 12, no 6. iShares (6) es un patrón distinto del de BlackRock (14).
- Las nueve gestoras mayores suman **91 de los 196**. El resto, unos **105 fondos, se reparte
  entre casi cuarenta gestoras con uno a cuatro fondos cada una.**

**Conclusión, y es un cambio de plan:** añadir patrones de gestora cubre como mucho el 46 % del
problema, y para la cola larga el coste por fondo es prohibitivo —un patrón nuevo, con su
mantenimiento permanente, para dos o tres fondos—. Para esa cola, **la respuesta económica es un
segundo espejo universal**, no cuarenta patrones. Que el de Deutsche Bank aporte 255 por sí solo
es la prueba de que ese camino funciona.

**Por eso el primer puesto del orden de esfuerzo pasa a ser:** comprobar si el proveedor de
documentación de Andbank (Allfunds o Inversis) sirve KID por ISIN sin identificarse, como hace el
espejo de Deutsche Bank. Un solo patrón podría cubrir a la vez la cola larga y los 16 fondos de
Andbank. Lo había apuntado la segunda opinión del 28-09 y ahora hay una cifra que lo justifica.

**Lo que no se ha podido hacer desde aquí, y hay que hacer en tu PC.** Las webs de las gestoras
responden `403` a este entorno: lo probé con el patrón de ficha de Fidelity que el 28-09 se había
verificado con un fondo real, y también falla. Así que un 403 aquí no prueba que el patrón esté
mal, solo que el entorno está bloqueado. Intenté repetirlo con un agente de navegador —que es lo
que ya hace `tools/test_gestoras.py`— y la comprobación de seguridad lo bloqueó por tratarse de
sortear una protección antibot. No insistí: no voy a escribir patrones que no puedo verificar, ni
a falsear cabeceras para comprobarlos. La verificación es `--red`, en tu PC.

## 4.d El KID contra la red: qué está vivo, y dos correcciones mías

Cinco pasadas en el PC de Oscar el 30-10. **Resultado:** las diez fuentes del KID sirven su
documento pidiendo como pide producción. **Ninguna está caída y ningún patrón está roto.** Los 438
KID de gestora, los 255 del espejo incluidos, están vivos a día de hoy.

| Fuente | Sostiene | Como producción |
|---|---:|---|
| Espejo de Deutsche Bank | 255 | `200`, PDF de 98 KB |
| Schroders | 34 | `200`, PDF de 166 KB |
| JPMorgan | 32 | `200`, PDF de 174 KB |
| Amundi | 31 | `200`, PDF de 216 KB |
| DWS | 27 | `200`, PDF de 95 KB |
| Invesco | 22 | `200`, PDF de 119 KB (por su ruta de ETF) |
| M&G | 14 | `200`, PDF de 52 KB |
| Goldman Sachs | 9 | `200`, PDF de 102 KB |
| Nordea | 8 | `200`, PDF de 153 KB |
| Candriam | 6 | `200`, ficha de 504 KB |

Es la mejor de las tres salidas posibles y la que menos trabajo deja: **el único problema real
sigue siendo el hueco de 214 fondos sin KID**, y la estrategia de §4.c no cambia.

### Las dos correcciones, que son la parte útil de esto

**La primera: llamé «lo más barato del programa» a los 17 fondos con patrón y sin KID.** No lo
eran. De ahí salió, eso sí, un error de código real: la URL de Schroders lleva la cobertura de
divisa dentro del nombre del compartimento (`SISF_Global-Gold-EUR-Hedged_A-Acc-…`), y el código
reconocía `EUR HEDGED`, como lo escribe la CSSF, pero no `EUR-HEDG` ni `EUR HEDG`, como lo trunca
Morningstar. **Afecta a 15 fondos de 7 gestoras** —Schroders 4, UBS 4, Fidelity 2, Goldman 1,
Columbia 1, Edmond de Rothschild 1, abrdn 1— y está corregido con prueba de regresión. El arreglo
vale por sí mismo: la URL que construíamos no existía. Pero **le atribuí el `403`**, y escribí que
«eso explica exactamente los 309 bytes». No los explicaba.

**La segunda, y la que más caro ha salido: dije que cuatro fuentes habían dejado de servirnos y
que 81 KID estaban caídos esperando a que caducase la caché.** Lo di por urgente y era falso.
`core/http.py` manda en su sesión el agente de `config/settings.json` —uno de Chrome— más `Accept`
y `Accept-Language`; la herramienta de diagnóstico pedía con `requests` a secas, **sin cabecera
ninguna**. Aquellos `403` y aquellos tiempos de espera agotados eran la respuesta a una petición
que el sistema nunca hace. **Medí mi herramienta, no el sistema.**

De aquí sale la regla que vale para cualquier prueba futura, y está escrita en el módulo:

> Una herramienta de diagnóstico que no reproduce la petición de producción no mide el sistema,
> mide la herramienta.

Y la segunda, sobre la tentación: con las cuatro fuentes «caídas» y el PDF entrando al declarar el
agente de herramienta, lo fácil era declararlo en esas cuatro y cantar 81 KID recuperados. **No se
tocó ninguna cabecera**, porque la medición no lo justificaba — y la pasada siguiente demostró que
habría sido un cambio sobre un problema inexistente. En este mismo repositorio está el
contraejemplo: Invesco lleva su propio agente porque su Akamai responde `406` a un agente de
navegador que no trae el resto de cabeceras de navegador. Un agente de navegador puede ir **peor**
que uno de herramienta; se decide fuente por fuente y con la medición delante.

### Los 17, cerrados: 3 se recuperan y 13 no existen

Medido con las cabeceras de producción. La primera pasada de `--red`, sin cabeceras, no valía.

| Fondo | Qué devuelve | Qué es |
|---|---|---|
| **Schroders** LU0189895229 | `200`, PDF de 165 KB | **El arreglo funciona** |
| **Schroders** LU0795636256 | `200`, PDF de 162 KB | **El arreglo funciona** |
| **Candriam** LU0165520114 | Ficha `200`, enlace encontrado, PDF de 273 KB | **Recuperable** |
| Candriam LU0170293632 | Ficha `403` | Intermitente: su gemelo funcionó 1,5 s antes |
| Goldman ×6 | `200` **text/html** de 98.418 B, idéntico en los seis | No existe |
| Nordea ×6 | `404` | No existe |
| Andbank LU1697018494 | `404` | No existe |

**El arreglo de la cobertura queda verificado contra el servidor real.** Las dos URL con `-Hedged`
entregan su PDF; antes apuntaban a un documento inexistente. Y recupera dos más de rebote:
LU0236738190 y LU0943301571, que hoy vienen del espejo, pasarán al productor. El `.miss` negativo
va por hash de la URL, así que la URL nueva se reintenta sola, sin `--force`.

**Los 13 de Goldman, Nordea y Andbank no son huecos: son ausencias.** Las seis de Goldman devuelven
el mismo HTML de 98.418 bytes, que es su página de «no está» —el adaptador ya lo trata como tal, y
son clases X, P e institucionales—. Nordea da `404` en las seis. El de Andbank es *Sigma Investment
House FCP - Best JP Morgan*, que casa con la marca de JPMorgan por el nombre comercial del fondo y
no por el productor: JPMorgan responde y no tiene ese documento.

Escribí aquí que para esos 13 **no había ruta pública**, porque ni el productor ni el espejo de
Deutsche Bank los tenían. **Era falso, y lo desmiente §4.f: diez de los trece pasan por Renta 4.**
Solo tres son ausencias de verdad (`LU0398684661`, `LU1061675168`, `LU0772958525`). El error:
concluir «no existe» a partir de «las fuentes que probé no lo tienen».

### Recuperados: cinco de seis, y el dato no cambia

Pasada del extractor sobre los seis el 30-10 a las 19:44. **Cinco cambian de procedencia:**

| Fondo | Antes | Ahora | SRI |
|---|---|---|:-:|
| LU0189895229 | Morningstar | `kid_gestora:schroders` | 2 |
| LU0795636256 | Morningstar | `kid_gestora:schroders` | 3 |
| LU0236738190 | Espejo DB | `kid_gestora:schroders` | 4 |
| LU0943301571 | Espejo DB | `kid_gestora:schroders` | 4 |
| LU0165520114 | Morningstar | `kid_gestora:candriam` | 2 |
| LU0170293632 | Morningstar | sigue en Morningstar | 2 |

El sexto es el del `403` intermitente de Candriam. Con el patrón ya demostrado en su gemelo, se
resolverá en una pasada futura sin tocar nada.

**Y lo que más importa de todo esto: ninguna cifra que vea un cliente ha cambiado.** El SRI del
documento oficial coincide **exactamente** con el que daba Morningstar en los cinco casos —2, 3,
4, 4 y 2—, comprobado contra su respuesta cruda en `cache/raw_morningstar_lt/*/Mifid.json`, cuyo
campo `KID.SRI` es el que alimentaba la ficha antes.

Eso tiene una consecuencia para cómo se defiende el programa, y conviene decirla sin adornos:
**sustituir Morningstar por el documento oficial compra independencia, no exactitud.** Que es
justo el objetivo —un sistema propio, sin licencias— pero no se puede vender como una mejora del
dato. Con una salvedad honesta: solo hay seis fondos con las dos cifras disponibles, porque la
caché de respuestas crudas únicamente guarda los refrescados en esta pasada. **De cinco
coincidencias no se puede concluir que Morningstar acierte siempre**, y medirlo en serio exigiría
re-descargar Morningstar para los 548 fondos, que no se paga por esta pregunta.

### Lo que esto cambia en el plan

**La vigilancia deja de ser opcional.** Que hoy no haya ninguna fuente caída no quita el riesgo que
destapó el susto: la caché de 90 días taparía una fuente caída durante tres meses sin que nada
avise. `tools/test_kid.py --controles` es ese control —diez fuentes, el espejo incluido, pidiendo
como producción— y tiene que correr sola, no cuando a alguien se le ocurra.

## 4.e El segundo espejo: Inversis publica por ISIN, pero no sirve

La pregunta que quedaba en primer puesto del orden de esfuerzo era si el proveedor de
documentación de un distribuidor español sirve el KID por ISIN sin identificarse, como hace el
espejo de Deutsche Bank. **Respuesta: Inversis lo hace, y aun así no vale.** Medido el 30-10 sobre
los 211 fondos del hueco.

### Allfunds no; Inversis sí, y con una URL construible

Allfunds es B2B y no se encontró ruta pública. Inversis sí:

```
https://www.inversis.com/fondos/contenidos/kiid/{ISIN}_kiid_es_ES.pdf
```

Solo el ISIN, sin registro, en castellano, y un `404` limpio cuando no lo tiene. Una muestra de
diez entregó siete PDF, incluidos Fidelity, PIMCO, **Andbank**, abrdn y Degroof: cola larga pura.
Por cobertura parecía la respuesta.

### Por qué no vale: es un archivo de antes de PRIIPs

Pasados por el parser del repositorio, con el mismo criterio de aceptación que aplica
`kid_gestora._lee`:

| Veredicto | Fondos |
|---|---:|
| No lo tiene | 111 |
| **KIID de UCITS, no KID de PRIIPs** | **88** |
| KID de PRIIPs pero caducado (más de 456 días) | 8 |
| El PDF habla de otro ISIN | 3 |
| **Sirve** | **1** |

**Uno de 211.** El reparto por año del documento lo explica solo: 46 de los que sirve son de 2012
a 2017, es decir del régimen anterior. Inversis guarda lo último que cada fondo le entregó, y para
casi todos los de nuestro hueco eso fue antes de 2018.

Y hay un detalle que no es menor: **tres PDF hablaban de un ISIN distinto del pedido**
(`IE00B8CL0730`, `LU0061476155`, `ES0141116030`). Sin la comprobación del ISIN dentro del
documento, el perfil de riesgo de otro fondo habría acabado atribuido a estos. Esa guarda ya
estaba escrita; es la que ha hecho el trabajo.

### Lo que esto enseña sobre cómo evaluar un espejo

**La cobertura no es la medida; la cobertura utilizable lo es.** Un 70 % de aciertos en la muestra
se convirtió en un 0,5 % al mirar qué documento era. Si se hubiera escrito el patrón con la
primera cifra, el extractor habría pedido 100 documentos para tirarlos todos —o, sin las guardas
de PRIIPs y de caducidad, habría metido indicadores de riesgo de 2012 en un sistema que produce
informes de cliente—. **El criterio para el siguiente candidato está fijado:** descargar, parsear
y contar solo lo que pasa las cuatro guardas.

### Descartado por otra razón: la clave de API de otro

El buscador de MyInvestor enlaza los KID a través de `api.fundinfo.com` con **una clave de API
suya incrustada en la página pública**. Funcionaría y cubriría mucho, pero es la credencial de un
tercero para un servicio de pago: usarla sería aprovecharse de su contrato. Queda descartado, y
queda escrito aquí porque la tentación reaparecerá en cuanto alguien mire esas URL.

### Lo que queda, y una pregunta de fondo

Quedan sin probar los espejos de otros distribuidores españoles —Renta 4, Bankinter, Ibercaja,
Openbank, Singular Bank, Tressis, Abante, Andbank— y el camino público de fundinfo sin clave. Cada
uno es una prueba barata, y el de Deutsche Bank demuestra que la jugada puede salir: 255 KID.

Pero conviene plantear la pregunta de fondo antes de encadenar intentos. Los 105 fondos de la cola
larga son el **14 %** del universo, y lo medido hoy en §4.d dice que **el SRI oficial coincide con
el de Morningstar**. Así que lo que se compra cerrando la cola larga es independencia, no
exactitud, sobre una séptima parte del universo. Eso puede valer la pena —es el objetivo del
proyecto— pero no es urgente ni mejora ningún informe, y hay partidas del catálogo (composición,
costes) donde el mismo esfuerzo cambia datos que hoy están vacíos.

## 4.f El segundo espejo existe: Renta 4, y es Allfunds por la puerta pública

**144 de los 201 fondos sin KID, con un solo patrón.** Medido el 30-10 sobre el hueco completo,
descargando y parseando cada documento con las cuatro guardas de `kid_gestora._lee`.

### El patrón, y de quién es

Dos pasos, la forma que el adaptador ya soporta (`pagina` + `enlace`), la misma de Candriam:

```
1. ficha   https://www.r4.com/productos-inversion/fondos/fichas/{ISIN}
2. enlace  https://www.r4.com/R4DocFondos/0001.mar?d=afb_kiid/{lote}/1_{ISIN}.pdf
```

El lote (`20261023_084108`) va por fondo y **no se puede construir**: adivinarlo da `400`. Se lee
de la ficha, que sí es por ISIN. Y el `afb_` del parámetro es **Allfunds Bank**: la respuesta a la
pregunta que estaba en primer puesto del orden de esfuerzo es que sí, el proveedor de
documentación de un distribuidor sirve el KID sin identificarse — no por Allfunds directamente,
que es B2B y no tiene ruta pública, sino por la puerta de Renta 4.

### El resultado

| Veredicto | Fondos |
|---|---:|
| **Pasa las cuatro guardas** | **144** |
| — de ellos, con SRI legible | **135** |
| La ficha de Renta 4 no lo enlaza | 61 |
| KIID de UCITS, no PRIIPs | 5 |
| Caducado | 1 |

Y los documentos están **vigentes**, que es lo que hundió a Inversis: 107 de 2026, 15 de 2025.

| Cobertura de KID en fondos | Fondos | % |
|---|---:|---:|
| Hoy | 551 de 752 | 73,3 % |
| Con este patrón | 686 de 752 | **91,2 %** |

Dieciocho puntos con un patrón, contra los cuarenta patrones de gestora que haría falta escribir y
mantener para cubrir lo mismo. Las gestoras que entran son exactamente la cola larga que no tenía
ninguna: Fidelity 12, BlackRock 10, **Andbank 10**, Carmignac 9, BNP 6, PIMCO 6, Nordea 5, y una
treintena más con uno a cuatro fondos cada una.

### Tercera corrección del día, y la misma de fondo

Escribí en §4.d que para 13 fondos «no hay ruta pública», porque ni el productor ni el espejo de
Deutsche Bank los tenían. **Diez de los trece pasan por Renta 4:** cuatro de Goldman Sachs (SRI 3
y 4, documentos del 03-03-2026), cinco de Nordea (SRI 2, 4 y 5, de mayo y del 30-10-2026) y el de
Andbank. Solo tres son ausencias de verdad: `LU0398684661`, `LU1061675168` y `LU0772958525`.

El error es el mismo que el de la mañana con las cabeceras y el de Inversis con la cobertura:
**concluir «no existe» a partir de «las fuentes que probé no lo tienen».** Vale la pena dejarlo
escrito tres veces, porque las tres veces me ha parecido una conclusión y era un límite de la
prueba.

### Construido y probado de extremo a extremo

El patrón está escrito en `fetchers/kid_gestora.py` como fuente `renta4_allfunds`, declarado como
endpoint en el registro de capacidades y con pruebas propias. Va **después** de Deutsche Bank en el
orden de espejos, para no cambiar la procedencia de ninguno de los 255 KID que ese ya sostiene.

Probado con el código de producción —no con un script aparte— sobre tres fondos:

| Fondo | SRI | Costes del KID | Documento |
|---|:-:|---|---|
| Fidelity LU0114723033 | 4 | 0,0 / 0,0 / 2,70 / 0,30 / 0,0 | 16-10-2026 |
| Andbank LU0447425785 | 2 | 2,0 / 0,0 / 0,59 / 0,07 / 0,0 | 27-12-2025 |
| Andbank LU1697018494 | 3 | 2,0 / 2,0 / 2,46 / 0,01 / 0,20 | 27-12-2025 |

**Trae el bloque de costes completo, no solo el SRI**, que era una de las partidas flojas del
catálogo: entrada, salida, gestión y otros, transacción y rendimiento. Y un extra que no se
buscaba: en el fondo de Fidelity el espejo de Deutsche Bank tenía un documento del 28-03-2025 ya
caducado, la guarda de antigüedad lo rechazó y Renta 4 puso uno vigente. **El espejo nuevo no solo
rellena huecos: también refresca lo rancio.**

461 pruebas del extractor pasan. Lo que queda es una pasada del extractor sobre los 201 fondos para
cobrarlo, y después el pipeline hacia la maestra.

### Lo que hay que mirar antes de darlo por bueno

- **28 de los 144 documentos no traen fecha legible.** La guarda de caducidad solo actúa cuando
  hay fecha, así que esos 28 entrarían sin comprobar su antigüedad. Los lotes de la ficha son de
  2026, lo que hace pensar que están vigentes, pero **es una inferencia, no una medición**: si se
  escribe el patrón, conviene registrar la fecha del lote como respaldo.
- **61 fondos quedan fuera** porque Renta 4 no los comercializa. Ahí están los ETF —que no
  aparecerán nunca en una plataforma de fondos— y clases de participación concretas de gestoras
  que sí están, Carmignac entre ellas.
- **Un espejo más es otra dependencia.** Pasaríamos a tener 255 KID en Deutsche Bank y 135 en
  Renta 4: dos distribuidores que no nos deben nada. El repaso de `--controles` tendría que
  cubrirlo desde el primer día.

## 5. Lo que no se puede conseguir de forma independiente

Dicho sin rodeos, porque es lo que define el techo del programa:

| Qué | Por qué | Qué se hace |
|---|---|---|
| Serie diaria de VL de fondos no españoles | No hay fuente pública a esa escala; 2-3 de cada 10 gestoras publican histórico | Se paga: EODHD u otro proveedor |
| Estrella y categoría Morningstar | Producto propietario | Se conserva, por decisión del 30-10 |
| Style box de renta variable homogéneo | Solo algunas fichas lo traen, y con criterios distintos | Queda vacío donde no haya |
| Percentil frente a categoría, medalist, ESG, carbono | Propietario | Se prescinde |
| Sector y país de cada posición de FONDCART | La CNMV da el valor, no su clasificación | Exige maestro de emisores |

---

## 6. Lo que hay que verificar antes de diseñar sobre esto

1. ~~Si la tabla A7.1 trae ISIN de clase.~~ **Resuelto el 30-10: no lo trae.** La CNMV es el
   filtro del universo extranjero, no su llave. Para los fondos españoles sí es la llave.
2. **El paso de paraguas a clase** para los extranjeros, y con qué coste de casado por nombre.
   Es ahora la primera incógnita del programa.
3. **Si el proveedor de documentación de Andbank sirve KID por ISIN sin identificarse**, como
   hace el espejo de Deutsche Bank. Lo apuntó la segunda opinión del 28-09 y abreviaría el
   punto 1 del orden de esfuerzo.
4. **Una sola definición de cobertura**, por ISIN y sobre el mismo universo, antes de medir
   cualquier avance. Hoy el extractor y la maestra cuentan «sin KID» de forma distinta.

---

## 7. Lo siguiente

Con el catálogo cerrado, las tres decisiones que quedaban aparcadas (D4, D5 y D6) ya tienen
sobre qué decidirse. El dato que más las condiciona está medido aquí: **la mayor parte de lo
sustituible sale de registros oficiales y de KID, no de leer PDF comerciales.** El lector con IA
hace falta para la cola larga de fichas mensuales, no para el grueso del catálogo.
