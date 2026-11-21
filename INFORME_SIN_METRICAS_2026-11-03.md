# Los 149 instrumentos sin métricas propias
**3 de noviembre de 2026 · Base nueva local · Documento investigado `instruments/{ISIN}/computed/metrics`**

| Tipo en la raíz | Raíces | Con documento | NOT_APPLICABLE | NOT_PROVIDED | NOT_YET_FETCHED | Sin documento |
|---|---:|---:|---:|---:|---:|---:|
| FUND | 767 | 645 | 12 | 0 | 110 | 122 |
| ETF | 18 | 0 | 0 | 0 | 18 | 18 |
| STOCK | 305 | 297 | 0 | 0 | 8 | 8 |
| OTHER | 1 | 0 | 0 | 0 | 1 | 1 |
| **Total** | **1.091** | **942** | **12** | **0** | **137** | **149** |

Las tres columnas centrales recogen **la razón que devuelve el mapeador** con los dos canónicos actuales. El recuento de documentos se hizo por separado en Firestore. Los 149 casos cuadran por ambos caminos. **En ninguno de los 149 el mapeador produce hoy un documento pendiente de escritura.** Una nueva pasada del escritor con esas entradas daría la misma cobertura.

### Qué significan realmente esas ausencias

| Tipo | Método actual inaplicable¹ | Insumo no proporcionado o insuficiente en la fuente consultada² | Petición pendiente a una fuente cuya cobertura está demostrada³ | Bloqueo interno, decisión o evidencia por conciliar | Total |
|---|---:|---:|---:|---:|---:|
| FUND | 48 | 33 | 0 | 41 | 122 |
| ETF | 0 | 1 | 0 | 17 | 18 |
| STOCK | 0 | 8 | 0 | 0 | 8 |
| OTHER | 1 | 0 | 0 | 0 | 1 |
| **Total** | **49** | **42** | **0** | **58** | **149** |

¹ **`NOT_APPLICABLE`** al método disponible. En 48 clases que reparten, el método mensual presupone un VL de retorno total. El otro instrumento es un ETC, para el que no hay una vía de publicación definida. Estos productos sí pueden tener riesgo medible.

² **`NOT_PROVIDED`** para el dato, la vía y el corte indicados en cada grupo. Incluye una política de clase que las fuentes consultadas no acreditan y series insuficientes para la ventana más corta. Un histórico de otro proveedor o una fecha futura podrían cambiar la clasificación.

³ **`NOT_YET_FETCHED`** en el sentido estricto del encargo. No he podido demostrar ningún caso en el que baste pedir por primera vez un insumo que la fuente esté acreditada para entregar. **Los otros 58 están identificados**, pero clasificarlos así exigiría afirmar una petición omitida cuando hay datos ya recibidos, evidencia contradictoria o una decisión de publicación pendiente. En casos con dos impedimentos cuento una vez el primero que hay que resolver para ese instrumento. La cuarta columna explica la discrepancia semántica con las tres etiquetas, sin crear un valor nuevo en el contrato.

## Los 18 ETF

**La causa común está en el extractor.** Para `tipo == "etf"`, `1-extractor/fetchers/eodhd.py:908–909` devuelve directamente el resultado de `_fetch_etf_listing`. Esta función puede pedir la serie, escribe cotización, fechas, número de observaciones, identificador y clase de serie, y termina en la línea 899. En las líneas 856–862 deja expresamente pendiente la publicación de riesgo calculado sobre el precio de mercado. La llamada que produce las métricas diarias en la rama de acciones está en las líneas 956–966. La vía mensual de VL solo admite `tipo == "fondo"` (`1-extractor/fetchers/vl_fondos.py:282–295`).

| ETF | Serie de mercado comprobada | Consecuencia |
|---|---|---|
| 14 | El canónico lleva listing EODHD, ambas fechas, de 480 a 8.498 observaciones y `PRECIO_DE_MERCADO`. | La serie llegó hasta el extractor. Falta la vía de cálculo y publicación acordada para el producto. |
| 3 | El canónico conserva el símbolo, sin historial. La caché sí contiene 4.064 filas de SXR8.XETRA (`IE00B5BMR087`), 2.288 de VUSA.XETRA (`IE00B3XXRP09`) y 5.240 de IQQW.XETRA (`IE00B0M62Q58`), hasta el 02-11. | Hubo primero una pasada sin red y después una descarga con HTTP 200. La actualización completa fue bloqueada por retroceso de calidad. Tampoco tienen el parche parcial de serie. |
| 1 | `IE000DR59CI3` carece de serie y EODHD dejó registrado que no resolvió el listing. | Se necesita identificar una cotización utilizable antes de decidir qué ventana publicar. La marca local `dejo_de_cotizar` no acredita por sí sola la retirada del producto en todos los mercados. |

Las descargas y rechazos de los tres ETF se emparejan en `1-extractor/logs/fondosdb_20261102.log`, líneas 87632/87663, 87666/87705 y 87742/87773. El cuarto figura en la línea 105893. En los **17 con precios comprobados**, decidir sobre el producto sigue siendo necesario aunque se repita la descarga. La raíz existe en los 18.

**También falta una salida adecuada en la plataforma.** Solo `STOCK` entra en el mapeador diario. La otra rama reconoce la procedencia propia de VL y publica el método mensual de fondos (`2-plataforma-datos/src/ingestion/baseNueva/mapper.ts:484–485, 880–891, 1363–1413`). El método escrito menciona acciones y ETF en su §4, pero la rama ejecutada y la descripción del contrato diario limitan la publicación efectiva. Aplicar a un ETF la etiqueta mensual de un fondo mezclaría el precio de mercado del listing con el VL de la clase, posiblemente en otra divisa y a otra hora de cierre. La decisión 11 se refiere a elegir proxies de índices.

## Los 122 fondos

Estos grupos son excluyentes. Una serie parada se cuenta en la etapa de frescura, aunque la clase además reparta. La cifra corresponde siempre a la ausencia del **documento completo**.

| N.º | Primera causa comprobada | Razón del diagnóstico y efecto |
|---:|---|---|
| **46** | `sin_metricas_historial_repartos`, con al menos un pago positivo, fechado y con VL en el pago en los 46. | Método actual inaplicable al VL sin ajuste. El mapeador emite «pendiente» pese a que la fuente ya entregó precios y pagos. |
| **30** | `sin_metricas_nombre_reparto`. El nombre detiene el cálculo antes de evaluar el historial vacío. En los 30 la plataforma resuelve `ACCUMULATING`. | El KID acredita acumulación en **26** y distribución en **2**. En **2** la política real queda sin confirmar. Los dos de distribución completan las 48 clases de la tabla inicial. |
| **12** | Hay cifras propias, serie, divisa y motivo `sin_repartos_del_proveedor`. En caché constan doce respuestas con `distribution: []`. A ninguna ficha exportada llegó `historial_consultado`. | Bloqueo interno. El mapeador rechaza los doce por `UNKNOWN` y los llama `NOT_APPLICABLE`. La evidencia que exige el proyecto ya existe con grado `PROVIDER_NO_RECORDS`. |
| **17** | `aviso_vl = serie_parada(…d)` en el canónico, entre 34 y 1.711 días. | `NOT_PROVIDED` para la serie actualizada. El extractor guarda la traza y sale antes del cálculo. La causa económica del parón no se deduce de las fechas. |
| **8** | HTTP 404 al solicitar `/api/eod/{ISIN}.EUFUND`. | `NOT_PROVIDED` por ese endpoint. Se comprobó la petición para cada ISIN. |
| **5** | El mismo endpoint devolvió HTTP 200 y el cuerpo JSON literal `[]` en la caché. | `NOT_PROVIDED`. Verificar solo el código HTTP habría convertido cinco respuestas sin precios en cinco historiales disponibles. |
| **1** | `LU0251661590`. El canónico no lleva serie, pero la caché contiene 5.151 filas, del 17-04-2006 al 15-10-2026. La descarga del 02-11 tuvo éxito y la actualización quedó bloqueada. | `NOT_PROVIDED` para una serie vigente. La distancia al último precio supera el límite de diez días. La ficha anterior se conservó sin parche. Llevar a la ficha la traza explicaría el hueco, sin dar actualidad al precio. |
| **1** | `LU1899018870`. El extractor declara 144 observaciones del 07-04 al 29-10-2026. Produjo rentabilidades propias de 1 y 3 meses. | `NOT_PROVIDED` para las ventanas publicables. Esas dos claves quedan fuera del documento y la serie tampoco cubre el comienzo del año para un YTD. La clase figura como lanzada en 2019. El límite probado es la historia entregada. |
| **1** | `LU2002383896`. Hay 365 observaciones, `politica_desconocida`, sin respuesta de reparto utilizable ni política declarada. La búsqueda de Morningstar no encontró la clase en la última pasada y el buscador de KID tampoco consiguió el documento. | `NOT_PROVIDED` para la evidencia de política en esas vías. Una traza antigua del endpoint no contiene la respuesta. Se desconoce qué contestaría hoy la gestora. |
| **1** | `LU0290358497`, Xtrackers II EUR Overnight Rate Swap UCITS ETF 1C. La adquisición dice `etf`, el producto dice `monetario` y la raíz resulta `FUND`. Hay 4.910 observaciones de XEON.XETRA. | Es el mismo bloqueo de publicación de los ETF. Se mantiene entre los fondos para cuadrar con Firestore. «Monetario» desplazó la forma cotizada en la clasificación. |
| **122** | **46 + 30 + 12 + 17 + 8 + 5 + 1 + 1 + 1 + 1** | **48 por método, 33 por insumo y 41 por decisión o tratamiento interno.** |

### Cómo se demuestran los grupos de fondos

**Distribución.** La prueba son los pagos positivos de `distribuciones.historial` y el motivo que dejó el extractor. De los 46, seis traen un pago, cinco traen dos, cuatro traen tres, seis traen cuatro y 25 traen cinco. El código detiene el cálculo de reparto en `vl_fondos.py:315–325`. El VL cae mecánicamente al pagar. Para publicar retorno total harían falta todos los pagos que afectan a la ventana, sus fechas, importes y divisa, además de los precios correspondientes. La decisión sobre el límite del historial está en `DECISIONES_BASE_NUEVA_2026-11-01.md:461–465`. Aquí no se ha dado por completa ninguna ventana por el mero número de pagos.

**Los 30 nombres.** La expresión incluye `Income`, `Inc` y `Div` y examina el nombre del producto y de la clase antes que un historial consultado sin pagos (`vl_fondos.py:63–68, 252–277`). Un fondo puede invertir en empresas que pagan dividendos y tener una clase que los reinvierte. En sentido inverso, un historial vacío puede corresponder a una clase con facultad de distribuir. El resolvedor de la plataforma reconoce esa ausencia de pagos como su grado más débil (`2-plataforma-datos/src/ingestion/baseNueva/distribucion.ts:96–127`).

Se contrastó la primera página del KID de la clase por su ISIN. En los 28 documentos usados también coincide el SHA-256 del **texto** del PDF con `documentos_oficiales.kid_sha256`, siguiendo `1-extractor/core/kid.py:239–250,576`. Las copias se localizan en `1-extractor/cache/kid/gestoras/**/{ISIN}_*.pdf`. El contraste da:

- **26 de acumulación.** En 25 la política de reinversión, capitalización o ausencia de distribuciones está expresada en el documento. En `IE00BD2ZKT29` la evidencia es la denominación oficial «Clase A EUR-H Acc» junto al ISIN. Un ejemplo del error es `IE0031333341`: *Income* pertenece al nombre del fondo Jupiter Asia Pacific y la clase C USD capitaliza. La lista exacta es el grupo de 30 con motivo `nombre_reparto`, excluidos los cuatro ISIN siguientes.
- **2 de distribución.** El KID de `IE00B3VXGD32` identifica la clase R EUR de distribución y permite dividendo anual discrecional. El de `LU1877633989` declara clase de distribución con facultad de pagar. Su historial vacío no acredita acumulación. Esta comprobación afecta también a la política que publica la plataforma.
- **2 sin confirmación documental.** Para `LU1697013008` y `LU2050411763` se comprobaron la coincidencia de nombre, la respuesta sin pagos y la falta de una política declarada en el canónico. No se localizó KID verificable en la caché examinada. La contradicción está demostrada. La política de las dos clases sigue abierta.

**Los 12 rechazos por política desconocida.** Los doce llevan `meta.actualizacion_parcial` de 02-11 por caída de campos esenciales. El parche conserva la ficha anterior e incorpora solo rutas de serie, incluidas métricas y traza. La evidencia de distribución queda fuera (`1-extractor/core/update.py:109–160, 215–230`). El extractor sí puede leer la lista vacía de la caché (`vl_fondos.py:194–217`). El mapeador exige evidencia en el canónico (`mapper.ts:1371–1401`). El atasco está localizado entre ambos. ISIN: ES0155598008, ES0165142003, FR0000174310, FR0011387299, FR0013231453, IE000MI53C66, IE00BDTYYP61, LU0137009238, LU0153585137, LU0469270010, LU0926439992, LU1127969597.

**Las series paradas o no servidas.** Los 17 avisos se reproducen filtrando `riesgo.historial_precios.aviso_vl` por `serie_parada` entre las raíces ausentes. La regla compara la última fecha con la fecha de descarga, en días naturales (`vl_fondos.py:297–308,439–454`). Para los 8 HTTP 404, las líneas de `1-extractor/logs/fondosdb_20261102.log` son 117473, 117620, 131692, 92397, 115840, 100831, 103692 y 103725, respectivamente para ES0137397008, ES0139113007, ES0162296000, IE00BKSBDB61, LU1088703118, LU1223084051, LU2278574558 y LU2278574715. Para los 5 HTTP 200 vacíos se leyó el cuerpo en `1-extractor/cache/http/*.json`, seleccionando la URL exacta de ES0142046038, IE00B28YJQ65, LU1298174530, LU1378997107 y LU2267099674. El lector trata por separado el estado HTTP y los puntos válidos (`vl_fondos.py:104–126`).

**Los cuatro casos individuales de fondos.** Las filas de `1-extractor/export/fondos.ndjson` son 593 (AXA), 937 (Sigma), 956 (Allianz) y 626 (Xtrackers). Para AXA se cotejó también el cuerpo de caché `7247ca0f93469f264b4a50313bc213a84c404f0f.json` y las líneas 109509–109516 del log. Para Allianz, las líneas 103247–103255 y su parche parcial. Para Sigma, la procedencia propia de los dos periodos y el descarte explícito en `traducciones.ts:178–192` y `mapper.ts:974–994,1363–1371`. Para Xtrackers, la traducción de `monetario` a `FUND` en `traducciones.ts:36–43`.

## Las ocho acciones

Las ventanas diarias de 1, 3 y 5 años exigen 180, 540 y 900 observaciones dentro de la ventana (`1-extractor/core/metricas.py:375–384,437–445`). Las tres primeras series de la tabla ni siquiera alcanzan 180 en total. En las cinco restantes, el mapeador presenta «0 observaciones» cuando falta el campo y aplica la misma etiqueta `NOT_YET_FETCHED` a ambos casos (`mapper.ts:1936–1943`). La decisión de retirar Sharpe y Sortino en acciones es independiente de la ausencia del documento completo. Volatilidad, rentabilidad y caída siguen teniendo sentido con historia suficiente.

| Acción e ISIN | Evidencia en el canónico y el log | Diagnóstico al corte |
|---|---|---|
| TSK Electrónica y Electricidad · ES0105394003 | EODHD TSK.MC, 124 observaciones, 13-05 a 02-11-2026. | Historia insuficiente. |
| DIGI Spain Telecom · ES0106043005 | Yahoo DIGIS.MC, 78 observaciones, 16-07 a 02-11-2026. | Historia insuficiente. |
| Space Exploration Technologies · US84615Q1031 | EODHD SPCX.US, 99 observaciones, 11-06 a 30-10-2026. | Historia insuficiente. La divisa USD no explica que falte todo el documento. |
| CAM, Cuotas Participativas · ES0114400007 | Sin traza, estado local `nunca_resuelto`. CAM.MC no entregó serie y la búsqueda por ISIN y el intento de Yahoo quedaron sin resolución (log 121386–121390). | Sin histórico en las vías consultadas. La marca expresa el conocimiento local. |
| Ercros · ES0125140A14 | Sin traza, `dejo_de_cotizar` desde 21-09-2026. ECR.MC sin serie, Yahoo sin resolución (87088, 25053). | Falta el histórico recuperable del listing. |
| Siemens Gamesa Renewable Energy · ES0143416115 | Sin traza, misma marca desde 08-02-2023. SGRE.MC sin serie, Yahoo sin resolución (87129, 25854). | Mismo límite de fuente. |
| Levantina de Edificación, CLEOP · ES0158300410 | Sin traza, misma marca desde 15-05-2017. CLEO.MC sin serie, Yahoo sin resolución (87149, 26099). | Mismo límite de fuente. |
| NH Hoteles · ES0161560018 | Sin traza, misma marca desde 04-09-2026. NHH.MC sin serie, Yahoo sin resolución (87157, 26148). | Mismo límite de fuente. |

Fechas y marcas son las de `meta.disponibilidad` de cada ISIN. **No se ha verificado una fecha oficial de exclusión bursátil.** Para las cuatro marcadas, una medida histórica fechada requeriría una fuente que conserve sus precios ajustados. Una métrica presentada como actual después del último precio respondería a otra pregunta.

## El único OTHER

**IE00B4ND3602 es iShares Physical Gold ETC.** Su descripción canónica lo identifica como título de deuda garantizado por metal físico, con referencia LBMA Gold Price PM USD. El canal de adquisición dice `etf`, el producto dice `etc` y la plataforma traduce explícitamente `etc → OTHER`. El canónico contiene 1.352 observaciones de PPFB.XETRA, del 16-07-2021 al 02-11-2026. Se comprobó en `fondos.ndjson:393`, en `traducciones.ts:36–43` y en el retorno de la rama ETF. La categoría amplia es coherente con el vocabulario disponible. Documentar métricas propias para un ETC exigiría definir su método y la base de retorno. Reclasificarlo como ETF para que pase un filtro falsearía la identidad del instrumento.

## Cómo reproducir el recuento sin calcular métricas

1. Enviar `GET /v1/projects/bdb-gestor-de-activos/databases/(default)/documents/instruments?pageSize=500` a **127.0.0.1:8092** con `Authorization: Bearer owner`. Seguir cada `nextPageToken`. Verificar que cada ruta termina en el `instrument_id` de sus campos y que no hay duplicados.
2. Para las 1.091 raíces, consultar por lotes de 100 la ruta exacta `instruments/{ISIN}/computed/metrics` mediante `documents:batchGet`, con máscara `method`. Exigir un resultado `found` o `missing` por cada nombre pedido. Dio 942 y 149. Como control independiente, `documents:runQuery` sobre el grupo `computed` con `allDescendants: true` y selección de `method`, conservando solo las rutas acabadas en `/metrics`, devolvió 942. Se cotejaron los nombres completos. No aparecieron métricas huérfanas.
3. Para cada ausente, unir por ISIN `1-extractor/export_bdb/{ISIN}.json` y la fila con `_id == ISIN` de `1-extractor/export/fondos.ndjson`. Son las dos entradas que usa el escritor en `2-plataforma-datos/scripts/runBaseNuevaWrite.ts:33–35,77–108`. Se ejecutó en memoria únicamente `mapearInstrumento(ficha, universal, fecha)`. Los 149 devolvieron cero errores, una ausencia para la ruta y ningún documento de métricas. El mapeador separa y transforma cifras ya existentes. No se ejecutó el calculador.
4. Separar las razones del mapeador de las de los **campos** del esquema. `contracts/base-nueva/instrument-computed-metrics.v2.schema.json:42–52,86–105,158–177` declara insumos, aplicabilidad y ausencia por campo. `quality/latest` usa predicados y herencia para contar rutas (`calidadYTarjeta.ts:66–85,301–338`). Ninguna de esas dos operaciones averigua si un proveedor sirvió o no un histórico. El falso positivo se reproduce en `mapper.ts:1447–1451,1936–1943`: la simple ausencia de una cifra propia activa «pendiente», aunque haya una petición, una respuesta y un impedimento financiero comprobable.

Las referencias abreviadas al mapeador, traducciones y calidad corresponden a `2-plataforma-datos/src/ingestion/baseNueva/`; las del lector de VL, a `1-extractor/fetchers/`. La comparación de política documental se hizo sobre copias locales. Los techos de fuente se refieren al material recibido y a las búsquedas registradas hasta este corte.

## Lo que se puede cerrar

- **26 clases de acumulación bloqueadas por el nombre y 12 fichas parciales.** Incorporar por ISIN la evidencia de clase ya localizada, con su procedencia. En los doce llevar la respuesta de distribución por el canal canónico junto con las cifras. Verificar después las ventanas publicables de cada una. En los dos KID que sí declaran distribución, corregir el diagnóstico de política y exigir historia de pagos.
- **Dos políticas en conflicto y Allianz.** Obtener una declaración vigente de la clase por ISIN. En los dos conflictos, el criterio que decide es la política del producto. Para Allianz se necesita otra vía documental. Queda condicionada la publicación a lo que diga esa fuente.
- **17 ETF con precios y Xtrackers registrado como fondo.** Óscar debe decidir si el asesor verá medidas de precio de mercado y bajo qué etiqueta y comparabilidad. Si se aprueba, declarar listing, divisa, ajuste y frecuencia, comprobar el ajuste efectivo de los precios y dar salida al método en el mapeador. Tres ETF necesitan además conservar su traza al pasar la guarda de calidad. Para `IE000DR59CI3`, resolver por separado un listing con historia.
- **Clases de reparto.** La parte recuperable son solo las ventanas para las que se demuestre exhaustividad de pagos y precios, o para las que se obtenga una serie fiable de retorno total de la clase. Para el ETC hace falta una decisión específica sobre su método si se quiere cubrirlo.
- **Explicación en la ficha.** Distinguir el intento de adquisición, la respuesta, la vigencia, el derecho a calcular y la salida del mapeador. Así una serie corta, un 404 y una política perdida tendrían explicaciones diferentes sin publicar cifra alguna.

## El techo con las fuentes y ventanas observadas

- **13 fondos sin precios en EUFUND**: ocho 404 y cinco cuerpos vacíos. **18 fondos sin precio reciente**: los 17 marcados y AXA, cuyo histórico sí está en caché. Para dar una cifra vigente se necesita que la fuente reanude la serie o una alternativa reconciliada para la misma clase.
- **Tres acciones y Sigma** no alcanzan las ventanas documentadas con la historia entregada. El tiempo futuro o un histórico anterior comprobado pueden ampliar cobertura. Los dos retornos cortos de Sigma carecen de destino en el esquema actual.
- **Cinco acciones sin histórico resuelto y un ETF sin listing resuelto.** Las fuentes intentadas no aportaron la serie utilizable en este corte. No se ha establecido que no exista histórico en otro mercado o archivo.
- **Repartos anteriores al historial servido.** Uno a cinco pagos por clase no acreditan todos los pagos de una década. Una ventana con algún pago desconocido sigue sin retorno total reproducible. El precio crudo, el nombre de clase y una cifra de proveedor no completan esa historia.
