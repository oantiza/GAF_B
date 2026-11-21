# EMT y EET: medición y propuesta (paso 4)

9 de noviembre de 2026. Solo lectura: no se ha cambiado código, ni escrito en la base ni en la nube.
Datos del emisor, **uso interno para el desarrollo** (decisión 53): nada de esto entra en un informe de cliente.

## 0. Lo esencial

1. **Cobertura real de los 32 con bloque del emisor: EMT en 23 (72 %), EET en 2 (6 %).** iShares, Vanguard e Invesco
   publican el EMT en un fichero único sin navegador y sin aceptar nada. De Amundi, Xtrackers y SPDR no hay EMT público
   localizado; el portal de DWS exige pasar una puerta de aceptación, que no se ha pasado.
2. **El mercado objetivo casi no distingue entre estos 23.** Son UCITS sencillos: los 23 dicen minorista, profesional y
   contraparte; conocimiento básico, informado y avanzado; capital 100 % en riesgo. Como filtro, en este universo no
   aporta nada. **Sí distingue en el resto de la gama de los emisores** (productos complejos, no minoristas).
3. **Lo que aporta de verdad en los 23 es el horizonte.** El periodo mínimo recomendado existe en los 23, coincide con el
   KID en 8 de 8 y **rellena 15 donde hoy no se sabe**. La base nueva no tiene hoy ningún campo para ese dato.
4. **Hallazgo aparte, sobre costes:** el coste de operación que hoy trae el proveedor no cuadra con el del emisor en 20 de
   23, con la misma fecha declarada. El del emisor sí cuadra con el KID, redondeado, en 8 de 8.
5. **Requisito previo que no es de datos:** las carteras modelo **no tienen perfil ni horizonte guardados**. Sin eso no
   hay nada contra lo que cruzar.
6. **Recomendación:** un documento nuevo y pequeño, `declared/target_market`, solo EMT; aplazar el EET hasta tener más
   cobertura; y que el cruce con la cartera sea un aviso informativo, nunca un bloqueo. Las decisiones están en el §6.

## 1. Qué pregunta profesional responde

*Escrito antes de mirar los ficheros.*

**EMT (European MiFID Template).** Es el canal por el que el fabricante le dice al distribuidor para quién está pensado su
producto. La gobernanza de producto de MiFID II obliga al distribuidor a conocer ese mercado objetivo y a no vender fuera
de él sin justificarlo. La decisión que apoya al asesor:

> *«¿Puedo proponer este instrumento a este tipo de cliente, con este horizonte y esta capacidad de asumir pérdidas? Y si
> lo propongo fuera de lo que dice el fabricante, ¿lo sé y lo justifico?»*

| Bloque | Pregunta del asesor |
|---|---|
| Tipo de cliente | ¿Es para minoristas, o solo profesionales? |
| Conocimiento y experiencia | ¿Lo admite un inversor básico, o requiere experiencia? |
| Capacidad de pérdidas | ¿Cuánto capital puede perder el cliente? ¿Hay garantía? |
| Tolerancia al riesgo | ¿Qué SRI declara el fabricante? |
| Objetivos | ¿Preservar, crecer, renta? |
| Horizonte | ¿Cuántos años mínimos recomienda? |
| Canal | ¿Solo ejecución, con test de conveniencia, asesoramiento, gestión discrecional? |
| Costes ex ante | ¿Qué pagará, con el desglose MiFID? |

**EET (European ESG Template).** Responde a las preferencias de sostenibilidad que el asesor debe recoger al evaluar la
idoneidad: *«este cliente pidió inversión sostenible: ¿qué artículo SFDR tiene el producto, considera incidencias
adversas (PAI), cuánto se alinea con la taxonomía?»*

**Lo importante de ambos:** el EMT describe un *instrumento* y su fabricante; la idoneidad se juzga sobre el *cliente* y la
*cartera*. Un aviso por componente confunde las dos cosas si no se cuida (regla de riesgo de cartera frente a riesgo de
componente, ver §5).

### Qué hay hoy en la app (medido en el código)

- **El perfil existe en diez niveles** (`RISK_PROFILE_CONTRACTS`, `src/core/riskProfilePreview.ts`), con `level` de 1 a 10,
  `indicative_time_horizon` **en texto** («Medio plazo orientativo»), tolerancia en texto y `status: "PREVIEW_ONLY"`. El propio
  contrato dice que no implica idoneidad ni filtro regulatorio.
- **El generador** une cada nivel a un porcentaje de renta variable (`RENTA_VARIABLE_POR_NIVEL`: 0, 10, 20, 30, 40, 50, 60, 70, 85 y 100).
- **Las carteras modelo no guardan ni perfil ni horizonte.** El documento `portfolios/{id}` (`kind: "MODEL"`, en
  `almacen_base_nueva.py`) lleva nombre, estado, divisa, capital nocional y fechas; `targets/{isin}` lleva peso e importes.
  El perfil elegido vive solo en la sesión (`perfilEnSesion`), y el informe fija `RISK_5` (`REPORT_RISK_PROFILE_ID`).
- **Los 3Y y 5Y de `portfolio_horizon` son ventanas de análisis**, no el horizonte del cliente. No se pueden usar para esto.
- Las cinco carteras de referencia (Conservador a Agresivo) son otra escala, de comparación, ajena a los diez niveles.

## 2. Cobertura medida por emisor y plantilla

Una descarga por emisor y plantilla, unas 25 peticiones en total, sin peticiones por ISIN. Copia en la carpeta de notas de la
sesión (`emt-eet-medicion-09-11-2026`), fuera del repositorio.

| Emisor | Plantilla | Versión | Vía | ISIN de los 32 | Columnas con dato / total | Fechas de los nuestros | Sin navegador y sin aceptar |
|---|---|---|---|---:|---|---|---|
| iShares | EMT | V4 (hay V4.2, para Reino Unido) | XLSX único, `blackrock.com/fund-regulatory`, 6.545 filas | **14 de 14** | 66 / 95 | Fichero 30-10; mercado objetivo 30-09; costes 30-06 | Sí |
| iShares | EET | — | No aparece en la página reguladora (EMT, EPT y DCPT); la URL análoga da 404 | 0 | — | — | No localizado |
| Vanguard | EMT | V4.2 | XLSX único, `fund-docs.vanguard.com`, 528 filas | **7 de 7** | 81 / 111 | Fichero 01-10; mercado objetivo **31-01**; costes 31-08 | Sí, con aviso «solo profesionales» |
| Vanguard | EET | — | La página de MiFID lista EMT y EPT, no EET | 0 | — | — | No localizado |
| Invesco | EMT | V4.2 | CSV único, 1.981 filas | **2 de 2** | 78 / 111 | Fichero 30-09; mercado objetivo y costes 31-12-2025 y 12-08-2026 | Sí |
| Invesco | EET | V1.1.3 | CSV único, 1.666 filas | **2 de 2** | 99 / 616 (331 en la gama) | 29-10; PAI 30-09 | Sí |
| Amundi | EMT y EET | — | No localizado en páginas públicas ni en búsqueda | 0 de 4 | — | — | **Sin medir** |
| Xtrackers (DWS) | EMT | V4.2, según la propia página | Portal `deutsche-am.com/mifid_emt` tras una **puerta de aceptación** | 0 de 2 | — | — | **No: exige aceptar** |
| Xtrackers | EET | — | Sin localizar | 0 de 2 | — | — | Sin medir |
| SPDR | EMT y EET | — | La ficha de producto publica decenas de documentos y ninguno es EMT ni EET | 0 de 3 | — | — | No localizado |

**Total de los 32: EMT 23, EET 2.** Los 9 sin EMT: 4 Amundi, 2 Xtrackers y 3 SPDR. Uno de los SPDR es el SPY estadounidense
(`US78462F1030`), donde lo esperable es que no exista EMT (supuesto, no medido).

El oro físico (`IE00B4ND3602`) es la ficha 33: tiene bloque en el extractor y EMT, y no entra en la base por ser OTHER. Queda
fuera de todas las cifras de este informe; solo cuenta dentro de los 66 / 95 de iShares.

### Lo que no se pudo descargar y por qué

- **DWS:** la página da un enlace `EntryGate/Accept`. Aceptarlo es una decisión tuya, no se ha hecho (§6).
- **Amundi y SPDR:** ausencia de hallazgo, **no prueba de que no exista**. Puede estar en un portal de distribuidores o
  venir por agregadores de pago (fundinfo, Kneip, etc.).
- **EET de iShares y Vanguard:** igual. BlackRock remite a un formulario para distribuidores.
- **Definiciones oficiales:** se han leído de las hojas de FinDatEx copiadas en la web de la asociación alemana BVI (EMT V4.2
  y EET V1.1.3). FinDatEx también tiene publicada una EMT V4.3, no leída.

### Condiciones de uso que afectan

La página y el propio fichero de Vanguard dicen «solo para inversores profesionales» y que no se distribuya al público. Encaja con
la decisión 53, y es un motivo más para que no salga nunca en papel de cliente. El aviso de BlackRock (hoja «Notes and Disclaimer») sale
vacío al leerlo con la herramienta, así que **no se ha podido leer**: conviene abrirlo antes de construir.

## 3. Qué campos sirven

Definiciones resumidas de FinDatEx; distribución sobre los **23 de los 32 con EMT**.

### Responden a la pregunta

| Campo | Definición | Valores en los 23 | ¿Distingue? |
|---|---|---|---|
| `05080` Periodo mínimo recomendado | Años, o códigos V / S / M / L / H | **5 años: 21; 3 años: 2** (los dos de renta fija) | **Sí** |
| `04010` SRI | Indicador PRIIPs, 1-7 | 4: 16; 5: 5; 2: 2 | Sí, pero ya lo tenemos |
| `05030` Busca renta | Y / N / Neutral | Y: 15; Neutral: 8 | Poco: es la costumbre del emisor (iShares todo Y, Vanguard casi todo Neutral) |
| `00047` Reparte en efectivo | Y / N | N: 19; Y: 4 | Sí, ya lo tenemos |
| `05105` Considera preferencias ESG | Y / Neutral | Y: 2 (`IE000DR59CI3`, `IE000X59ZHE2`); Neutral: 21 | Sí, ver EET |
| `01010` Minorista | Y / N / Neutral | Y: 23 | No, aquí |
| `02010` Conocimiento básico | Y / N / Neutral | Y: 23 | No, aquí |
| `03010` Sin capacidad de pérdidas | Y / N / Neutral | N: 23 | No, aquí |
| `03040` Sin garantía, 100 % en riesgo | Y / N / Neutral | Y: 23 | No, aquí |
| `06010`-`06040` Canal | R / P / B / N | B en los cuatro: 23 | No, aquí |

Fuera de nuestros 23 esas columnas **sí se mueven**: en la gama completa, `01010` tiene N en 54 de 6.545 en iShares, 12 de 528 en Vanguard y 17 de 1.981 en
Invesco; `02010` tiene N en 83, 0 y 135. Es decir, **sirven de filtro negativo** para productos complejos, y en un catálogo de
ETF sencillos nunca saltan.

**Trampas de lectura medidas:**

- **`03050` (pérdida más allá del capital) dice Y en el 100 % de los tres ficheros, incluidos todos los UCITS.** Significa que
  el producto es compatible con un cliente que soporte esa pérdida, **no** que el producto pueda perder más que el capital. Mostrarlo
  tal cual sería un error grave en la ficha.
- `05080` mezcla formatos: `5`, `5.00000000000000`, `L`, `0.92`, `0.00` (monetarios). Hay que normalizarlo.
- `Neutral` / `NEUTRAL` / `neutral` aparecen según emisor. **Neutral no es sí**: quiere decir que el fabricante no se pronuncia.
- Las fechas de mercado objetivo van de 31-12-2025 a 30-09-2026. Cada dato debe llevar la suya.

### Del EET, en los 2 de Invesco

| Campo | Definición | Valor en los 2 | Nota |
|---|---|---|---|
| `20040` Tipo SFDR | Artículo 0, 6, 8 o 9 | Artículo 6 en ambos | En la gama: 8 (1.299), 6 (307), 9 (60) |
| `20100` Considera PAI | Y / N | N en ambos | En la gama: Y 1.279 |
| `20590` Considera preferencias | Y / Neutral | Neutral en ambos | Es el mismo dato que `05105` del EMT |
| `20630` Método de taxonomía | Ingresos, capex u opex | R en ambos | Dice cómo se calcula un porcentaje que aquí no existe |

**Campos presentes donde no aplican** (la regla del proyecto lo trata como error): `20070` y `20080` valen `0.00` y `0`, y su definición los
reserva a fondos de fondos; `20630` declara método sin alineación que medir. Si entrase el EET, estos no entran.

### Se solapan con lo que la base ya tiene

| Campo EMT | En la base | Medido en los 23 | Si difieren |
|---|---|---|---|
| `04010` SRI | `declared/regulatory.sri` (KID, con evidencia) | **Igual 23 de 23** | Manda el KID; el EMT no se guarda como segunda cifra, salvo como comprobación |
| `04020` SRRI | `declared/regulatory.srri` | Igual 23 de 23 | Fuera: indicador antiguo, ya en la base |
| `05080` Periodo | **No existe en la base**. El canónico lo trae del KID en 11 de 33 (`riesgo.kid_periodo_mantenimiento_anos`) | Igual 8 de 8 donde ambos lo dan; **el EMT rellena 15** | Hoy no hay nada con qué chocar. Propuesta: KID primero, EMT donde no haya |
| `00047` Reparto | `declared/profile.distribution_policy` y `issuer_data.distribution_policy` | Coincide con la política del emisor 23 de 23 (no comparado con la del proveedor) | Sin valor nuevo: no se añade |
| `07100` Costes corrientes | `declared/costs.ongoing_charge` | ±0,005 pp en 23 de 23 frente al TER; exacto en 18, el resto es redondeo de Vanguard a dos decimales | Manda lo decidido (KID, luego proveedor) |
| `07130` Costes de operación | `declared/costs.transaction_costs` (KID, luego proveedor) | **Solo 3 de 23 coinciden con el proveedor**; ver abajo | **Decisión tuya** (§6) |
| `20040` SFDR | `declared/profile.sfdr_article` (no `declared/sustainability`, que solo lleva globos ESG, puntuación e intensidad de carbono) | **0 de 33 con SFDR** en el canónico (338 de 1.316 en toda la base); el EET daría 2 | No hay conflicto, hay hueco |
| `00110` Clase sin retrocesión | La colección `commercial_retro` de la app | Y en los 23 | Sin cruzar: habría que leer esa colección de la nube |

**El coste de operación merece atención.** El proveedor da una cifra bajo la etiqueta `mifid_emt_exante`, con la misma fecha que
el emisor, y son números distintos: en los 23, diferencia media 0,023 pp, mediana 0,009 pp, máximo 0,148 pp (`IE000DR59CI3`: 0,078 % en el
EMT, 0,226 % en el proveedor). Dos son negativos en el proveedor y el contrato no los admite.

En cambio, **en los 8 con KID, la cifra del KID es exactamente la del EMT redondeada a dos decimales.** Lo razonable es sospechar del proveedor, y no se ha
comprobado por qué difiere. **Afecta a los 15 de los 23 sin KID**, donde la base publica la cifra del proveedor. En términos absolutos son céntimos sobre un
TER pequeño; no cambian una decisión, pero es una cifra publicada con la etiqueta equivocada de precisión.

### Se dejan fuera

- Todo lo específico de país: Alemania (`02040`, `04050`, `05070`), Italia (`07030`, `07060`), España (`04040`).
- Reino Unido (`09xxx`, UK de costes): no es nuestro mercado.
- Productos estructurados (`00085`-`00096`, `05040`, `07025`, `07090`, `07150`, `07155`) y `03020`, `03030`, `04030`: **no aplican** a un UCITS y vienen vacíos o Neutral.
- `05010` (preservación), `05050`, `05115`: Neutral o N uniformes.
- Comisiones máximas de entrada y salida (`07020`, `07050`): en un ETF, el inversor compra en bolsa y no las paga.
- Costes ex post (`08xxx`): útiles para el extracto anual al cliente, no para esta pregunta.
- Los cientos de columnas PAI del EET (`30xxx`): solo tienen sentido con un flujo de preferencias ESG que hoy no existe.

## 4. Propuesta: dónde iría

### Opciones

| | **A. Documento `declared/target_market`** | **B. Dentro de `issuer_data`** | **C. Solo el horizonte en `declared/regulatory`** |
|---|---|---|---|
| Qué es | Documento nuevo, con su contrato | Sección nueva del bloque del emisor | Un campo más junto al SRI |
| A favor | Vale para cualquier fuente (también fondos activos o un proveedor). Separa «para quién es» de «qué publica el emisor» | Sin colección nueva; la ficha ya lee ese bloque | Mínimo trabajo; da lo que de verdad aporta hoy |
| En contra | Colección nueva: mapper, comprobaciones, lectura | Ata el dato a los 32 y a su `x-applies-to`. `issuer_data` queda como cajón. Si mañana llega de otra fuente no cabe | Pierde el filtro negativo. Si el catálogo crece, se rehace |
| Efecto en la calidad | `x-counts-when: NUNCA`, como `issuer_data`, para no remover los 800 documentos de calidad | Ninguno | Hay que decidir si cuenta |
| Ficha | Fila propia | Dentro de «Del emisor» | Junto al SRI |

**Recomiendo la A**, en versión mínima y sin el EET, porque el mercado objetivo no es propiedad del emisor de un ETF: es un dato del instrumento, y el
sitio donde va a dar valor son los fondos y los productos complejos, que no tienen `issuer_data`. La C sería mi segunda opción si prefieres no abrir colección hoy.

### Contrato mínimo (borrador de A)

```
instruments/{id}/declared/target_market  (v2)  x-counts-when: NUNCA · x-applies-when: FONDO_O_ETF
source                       issuer:ishares | issuer:vanguard | issuer:invesco
source_url, sha256           el fichero del que sale
template_version             V4 | V4.2
file_generated_at            00005
target_market_as_of          01000   obligatorio
investor_type   { retail, professional, eligible_counterparty }   YES | NO | NEUTRAL
knowledge       { basic, informed, advanced }                     YES | NO | NEUTRAL
loss_capacity   { no_loss, no_guarantee }                         YES | NO | NEUTRAL   (03010, 03040; 03050 fuera)
objectives      { capital_growth, income }                        YES | NO | NEUTRAL
min_holding_period { years: number } | { code: V|S|M|L|H }        05080 normalizado
esg_preferences_considered   YES | NEUTRAL                        05105
distribution    { execution_only, appropriateness, advice, portfolio_management }  R | P | B | N
```

Cada campo con `x-absence`: lo que el emisor deja vacío queda ausente, **no** `NEUTRAL`. No lleva SRI, SRRI, costes ni política de reparto: están en la base, con su fuente. La
trazabilidad a la fila de origen es por `source_url`, `sha256` y la fecha de generación. Propuesta del horizonte para la app: KID, si lo hay; si no, EMT, con su fuente al lado.

### Qué enseñaría la ficha

Una sección corta, **«Para quién está pensado (según el fabricante)»**, con la fecha:

- Horizonte mínimo recomendado: 5 años (KID / EMT, con fecha).
- Tipo de cliente y conocimiento: una línea («Minorista y profesional; sin experiencia previa»), y un aviso destacado solo si dice NO en minorista o en básico.
- Neutral se escribe «El fabricante no se pronuncia».
- `03050` no se muestra.

Solo pantalla de asesor. Nunca en informes de cliente.

### Qué comprobaría la app

Todas son **avisos informativos**, en coherencia con lo que ya dice el perfil (`PREVIEW_ONLY`). El peso de cada posición va al lado.

| Regla | Aviso | Valoración |
|---|---|---|
| R1. Horizonte de la cartera menor que el del instrumento | «La cartera se ha definido a 3 años y este fondo recomienda 5» | **La más útil. Requiere horizonte numérico (§6)** |
| R2. El emisor dice NO a minorista o a conocimiento básico | Aviso destacado | Barata. En los 23 no salta nunca; protege cuando entre algo complejo |
| R3. Datos caducados | Mercado objetivo con más de 12 meses | Barata |
| R4. Capacidad de pérdidas frente a nivel 1 («Preservación») | Una sola nota a nivel de cartera, no una por posición | Los 23 dicen `03010 = N`: por posición avisaría de todo. **Solo como nota** |
| R5. SRI frente a nivel de perfil | **No la construiría.** | No hay tabla oficial entre SRI 1-7 y niveles 1-10, y confunde componente con cartera: un SRI 5 al 5 % en una cartera prudente es razonable. Si se quiere, un dato de cartera: «% del peso con SRI ≥ 5» |

Si el perfil se usa para cruzar con el EMT, hay que elegir **una** de las dos escalas de perfil y documentarlo.

### Esfuerzo (estimación)

| Tramo | Qué | Estimación |
|---|---|---|
| T1 | Lector en el extractor de los tres ficheros, normalización y pruebas | Media sesión |
| T2 | Contrato, mapper, comprobación, base local y subida del catálogo con su aprobación | Una sesión |
| T3 | Ficha | Media sesión |
| T4 | Perfil y horizonte guardados en la cartera, y avisos R1-R4 | Una sesión, más tu decisión |
| T5 | Cobertura de Amundi, Xtrackers y SPDR | Depende de la decisión sobre DWS y de que exista vía |
| T6 | Corregir el coste de operación | Pequeña, si decides que entre |
| — | EET | Aplazado |

**Para el resto del catálogo:** este trabajo cubre 3 emisores de ETF. Para los fondos activos habría que ver gestora a gestora o un proveedor (fundinfo y similares), y no está medido.

## 5. Limitaciones y lo medido frente a lo supuesto

**Medido:** los ficheros, columnas, fechas y distribuciones descritos; que coincidan o no con el canónico del extractor (1-extractor/export, leído sin escribir); los campos de la app y
de los contratos.

**Supuesto, sin comprobar:**
- Que no haya EMT de Amundi y SPDR accesible: no lo he encontrado, que no es lo mismo.
- El SPY sin EMT.
- La causa de que el proveedor difiera en coste de operación.
- Las referencias legales (gobernanza de producto de MiFID II, preferencias de sostenibilidad) son de memoria, salvo la del propio EET.
- Las estimaciones de esfuerzo.

**Limitaciones:**
- Medido sobre el canónico, no sobre documentos de la base. El contrato de la base se ha leído, y `declared/costs.transaction_costs` se ha deducido del orden KID, luego proveedor.
- No se ha leído `portfolios` en la nube: la ausencia de perfil viene del código de escritura y de lectura. Si algún documento antiguo trae campos de más, no consta aquí.
- No sé cuántos de los 32 están en las 18 carteras modelo.
- Un mercado objetivo de ETF sencillos dice poco; las conclusiones sobre el filtro negativo salen de la gama completa, no de nuestros 23.

**Sobre el encargo:** decía SFDR en `declared/sustainability`, y vive en `declared/profile.sfdr_article`.

## 6. Decisiones que necesito de ti

1. **Dónde va:** A, B o C (recomiendo A, sin EET).
2. **Perfil y horizonte de la cartera:** hoy no se guardan. ¿Se añade a la cartera modelo un nivel y un horizonte en años, editables por ti? Sin esto solo hay ficha, no cruce. Recomiendo que sí.
3. **La escala años por nivel**, si la quieres por defecto. La propuesta sería tuya: hoy el texto solo dice «medio plazo», y cualquier número sería inventarlo.
4. **Coste de operación:** ¿el EMT del emisor sustituye al proveedor en los 15 sin KID? La decisión 52 dice que el emisor rellena y no sustituye, así que esto es una excepción. Recomiendo que sí, porque el emisor es la fuente primaria y cuadra con el KID, con su `*_source` al lado.
5. **DWS:** ¿se acepta la puerta de su portal para medir Xtrackers? Son 2 de los 32. Mi recomendación es no, hasta que el resto esté hecho.
