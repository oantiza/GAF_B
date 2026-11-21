# Decisiones de datos del 07-11-2026

*Tomadas por Óscar en la sesión directora («GAF · Dirección»), sobre la «Revisión del plan de datos»
del 06-11 y el traspaso de la sesión de Datos. Mandan sobre lo que digan de lo mismo
`TRASPASO_SESION_DATOS_2026-11-06.md` e `INFORME_FIRDS_UNIVERSO_2026-11-06.md`.*

1. **Aena no se sustituye: se da de baja el ISIN viejo.** `ES0105046009` queda marcado como dado de
   baja (decisión 14 de `DECISIONES_BASE_NUEVA_2026-11-01.md`); `ES0105046017` ya está en el universo y
   en la base nueva. Hasta que se haga, Aena sale dos veces en el Buscador.
2. **El ETC de oro `IE00B4ND3602` se queda `OTHER`.** No entra un tipo nuevo en el contrato; la ficha lo
   reconoce ya como ETC por el nombre y lo hará por su CFI cuando llegue.
3. **Orden de los pasos de datos:** identidad (CFI, cotizaciones por mercado, emisor por LEI; limpiar Aena
   y la CAM) → índice de referencia (**B, luego C, luego A**; A ya empezado el 06-11 con tres proxies) →
   ETF a 300 → EMT y EET junto al perfil y horizonte de las carteras modelo → fundamentales, composición
   de fondos extranjeros y ESEF.
4. **Esfuerzo de las sesiones de trabajo:** medio para implementar con pruebas; **alto** para fórmulas del
   método, escritura en la nube y cambios de contrato. Siempre dicho al empezar: «Modelo: X, esfuerzo Y».
5. **Del paso 2 ya decidido el 06-11:** B antes que A; A con el criterio por tipo de candidato del informe
   `INFORME_PROXIES_CAMINO_A_2026-11-06.md`; C con la variante que declara cada fondo.

Primer encargo que sale de aquí: la identidad (punto 3, primer tramo), abierto el 07-11.

## Añadidas a las 13:45, tras el encargo «identidad»

6. **Se escribe en la base nueva local** (emulador 8092) el plan del encargo de identidad, **después** de una
   pasada de identidad del extractor sobre las acciones, para que CFI, LEI y mercados lleguen de verdad y no
   solo a las 6 fichas que ya pasaron por FIRDS. La pasada sale a red solo a EODHD; Yahoo se bloquea. Nada en
   la nube.
7. **La CAM `ES0114400007` y las demás bajas sin fuente** (NH, Ercros, Siemens Gamesa) se resuelven con una
   **vía de baja decidida**: marcar «dejó de cotizar» por decisión, con fecha, motivo y autor, que hoy no
   existe. «Nunca se resolvió» es falso para la CAM: FIRDS la tiene. Encargo aparte, en cola.
8. **Emisores de las acciones (hallazgo A-9): «un LEI, un emisor».** Óscar aprueba la regla para que la
   apliquen los lotes, con nombre legal y país de GLEIF: 309 de 312 acciones tienen LEI en FIRDS, 307
   emisores distintos; ASML y Alphabet comparten emisor entre dos ISIN. El contrato decía que asignar emisor
   era decisión humana porque casar nombres no lo puede hacer un lote; con LEI no hay nombres que casar.
   Encargo aparte, esfuerzo alto porque toca `instrument-issuer.v2`, en cola tras el 7.

## Añadidas a las 12:55, tras el encargo «baja decidida»

9. **NH y Ercros se fijan por decisión** en `config/bajas_decididas.csv`: NH `ES0161560018` desde el
   25-09-2025 (exclusión tras la OPA de Minor; la fecha medida, 04-09-2026, es falsa y hay que averiguar
   de dónde salió) y Ercros `ES0125140A14` desde el 11-09-2026 (última sesión antes de la suspensión;
   exclusión el 22-09-2026 tras la OPA de Bondalti). Siemens Gamesa `ES0143416115` cuadra (08-02-2023) y
   no se toca. La CAM ya está (decisión 7, commit `4818854`).
10. **`instrument.v2` dirá el origen de la disponibilidad**: evidencia de fuente o decisión nuestra, con
    autor y fecha. Un asesor tiene que poder ver que «dejó de cotizar» es decisión y no dato del proveedor.
    Solo añadir; cambio de contrato, esfuerzo alto. Va en el mismo encargo que el 9, antes que los emisores
    por LEI (decisión 8).

## Añadidas a las 13:40, tras el encargo «NH y Ercros + origen»

11. **Regla única para la fecha de una baja decidida: el día de la suspensión**, es decir, el primer día sin
    negociación; la exclusión formal queda en el motivo. NH pasa del 25-09-2025 al 15-09-2025; CAM
    (09-12-2011) y Ercros (11-09-2026) ya la cumplen. La regla se escribe en `core/bajas_decididas.py`.
12. **Se escribe la base nueva local** (8092) con todo lo pendiente del día: bajas decididas, `availability.basis`
    y `availability.decision`. Nada en la nube.
13. **La app enseñará el origen de la baja** y corregirá el texto de ayuda de «Dejó de cotizar», que hoy dice que
    el proveedor ya no resuelve el valor y es falso para una baja decidida. Encargo a la app tras la escritura,
    Opus 5.5 medio, con `diseno-pantalla`.
14. **Hallazgo registrado, sin acción aquí:** BDB (base vieja) arrastra el último precio de NH casi un año
    (25-09-2025 → 04-09-2026) y la herramienta `tools/rellena_difuntas.py` tomó esa fecha como baja. La base
    nueva no tiene la serie rellenada. En BDB no se escribe (regla que no se rompe); conviene que Óscar lo
    tenga presente al usar carteras con NH allí.

## Añadida a las 13:45

15. **Un ISIN sustituido deja de cotizar el día de la primera negociación de su sucesor según FIRDS**, no el día
    en que lo observamos. Aena `ES0105046009` pasa del 07-11-2026 al 19-06-2025 (admisión de `ES0105046017` en
    XMAD). Regla en el código de la detección de ISIN sustituido (`7d94218`), con prueba; entra en el encargo de
    emisores por LEI.

## Añadidas a las 14:55, tras el encargo «emisores por LEI»

16. **`issuer.v2.issuer_id` pasa de dueño `human` a `platform`** para el papel `EQUITY_ISSUER` (commit `2e44bd9`):
    con LEI no hay nombres que casar. Gestoras y depositarios siguen necesitando decisión humana (`matched_by`,
    `matched_at`).
17. **Se escribe la base nueva local** con los 297 emisores, los 299 vínculos y Aena `009` al 19-06-2025.
18. **Se prepara la subida del catálogo a la nube** (`nube:subir --parte catalogo`, solo catálogo): primero el
    plan en seco para que Óscar vea qué crearía y reemplazaría; **la escritura en la nube solo con su sí expreso en
    ese momento**. Functions y sitio los despliega él.

## Añadida a las 14:35

19. **Óscar autoriza la subida del catálogo a la nube** (`nube:subir --parte catalogo`, proyecto real
    `bdb-gestor-de-activos`) con el plan en seco delante: 40.028 documentos en 12 colecciones, ≥657 nuevos, sin
    borrados ni sobrantes; carteras y retrocesiones no se tocan. Una sola subida con todo lo del día. Functions y
    sitio los despliega él después.

## Añadidas a las 15:50, tras el camino B

20. **Regla general: no se calculan relativas (beta, R², alfa, TE, IR) cuando el KID del fondo declara un índice
    compuesto o ningún índice**, aunque Morningstar le atribuya uno. Se retiran con fecha y constancia (§10 del
    método) las de los 8 que hoy las publican (6 compuestos: BNP Clean Energy ×2, Amundi Global Multi-Asset ×2,
    MFS Prudent Capital, EdR Bond Allocation; 2 sin índice: `LU0986194024`, `LU1481179858`), y la ficha dice por
    qué (`relative_absence`). Vuelven cuando haya proxy del compuesto.
21. **Los 3 de riesgo menor** (DWS Latin America ×2, Echiquier Space) **se mantienen y se marcan**: la ficha lleva
    «el KID no confirma el índice» en modo interno.
22. **Se autoriza la pasada del extractor sobre los fondos con índice** que aplica 20 y 21 y trae lo pendiente
    (relativas a 6 fondos por la normalización, retirada de los 5 proxies que se medían contra sí mismos, identidad
    FIRDS en 289 fichas), con copia previa y comparación ruta a ruta, y después la **escritura en la base local**.
    La nube, en otra decisión con el plan delante.

## Añadidas a las 19:30, tras la fase 1 del camino C

*Sobre `INFORME_CAMINO_C_2026-11-07.md`. Las series del índice se piden a la bolsa `INDX` de EODHD, en
nuestro plan; medido el 07-11: IBEX 35 en precio y total return, EURO STOXX 50 en precio y net return
(`SX5T`, que el informe dio por inexistente y la directora encontró), S&P 500 y S&P 500 Equal Weighted en
precio, TR y NTR. No hay IBEX 35 NR ni EURO STOXX 50 bruto.*

23. **Un nivel de índice es una clase de serie más, y se publica como tal.** `relative.benchmark.series_class`
    admite `INDEX_LEVEL` (`NIVEL_DE_INDICE` en el extractor); la fuente va en un campo nuevo
    `relative.benchmark.source_series_id` con la forma `EODHD:IBEXTR.INDX`, obligatorio en esa clase, y
    `instrument_id` queda ausente con `NOT_APPLICABLE`, porque el índice no es un instrumento de la base.
    Lo mismo en `relative_withdrawal`. **El alfa contra un nivel de índice no se ordena con el alfa contra un
    ETF proxy**: el ETF lleva dentro su coste y su tracking (0,1-0,6 puntos de alfa según la fila) y el
    índice nada. La §3 del método añade `benchmark.series_class` a la identidad comparable de las relativas.
    La ficha dice que se mide contra la serie del propio índice, sin coste de réplica. Descartado poner el
    ISIN del índice en `instrument_id`: sería el del precio, el del TR no se pudo verificar, y la ficha diría
    que lo replica un activo que no existe en la base.
24. **La variante de precio se mide como declara el fondo, y publica solo beta, R² y tracking error.**
    Intermoney Variable Euro contra el EURO STOXX 50 de precio (`SX5E`), base `PRICE_RETURN`: sin alfa, sin
    rentabilidad activa ni ratio de información, que saldrían infladas por el dividendo (+0,8 a +1,3 puntos
    medidos). Es el primer `PRICE_RETURN` de la base y la ficha lleva una nota nueva que lo explica en los
    dos modos. No se cambia la variante por conveniencia aunque la NR exista.
25. **EDM Spanish Equity (`LU0995386439`) se queda sin relativas**: declara el IBEX 35 NR, que EODHD no tiene.
    Medirlo contra el TR infravaloraría su alfa unos 0,7 puntos al año (estimación con el 19 % de retención).
    Una equivalencia NR→TR sería encargo propio, con contrato y ficha leyendo `equivalente_de`.
26. **Los ETF siguen fuera de las relativas (§11 intacta).** El cierre ajustado del ETF es retorno total y el
    índice que declara el ETF del IBEX es de precio: el tracking error contra el precio (1,0-1,65 %) triplica el
    real (0,34-0,95 %). Abrirlos exige decidir antes qué variante casa con un cierre ajustado, para los 25.
27. **Se arreglan en la fase 2 dos detectores que el camino C haría visibles.** El camino B dio por confirmado
    el índice de CaixaBank Small & Mid Caps España (`ES0138800034`) cuando su KID declara 30 % IBEX Small Cap +
    50 % IBEX Medium Cap + 20 % IBEX 35, con el porcentaje detrás del nombre (único caso en 679 KID); y la clase
    «AH (EUR)» de Morgan Stanley (`LU0266117927`, `LU0712123511`) es cubierta según su KID y `clase_cubierta`
    dice que no. Sin arreglo publicarían beta 0,6 con R² 66 % y beta 1,3 con R² 46 %, que no son el gestor.
28. **Entran las cinco filas** de nivel de índice en `indices.csv`: IBEX 35 TR (`IBEXTR`), IBEX 35 PR (`IBEX`),
    EURO STOXX 50 PR (`SX5E`), S&P 500 TR (`SP500TR`, dólares convertidos con el BCE) y S&P 500 Equal Weighted TR
    (`SPXEWTR`). Las dos del IBEX no miden a nadie hoy y dejan el índice listo. Antes de añadir ninguna, `carga`
    indexa por nombre **y variante**: hoy una fila del S&P 500 TR pisaría en silencio la del S&P 500 NR.
    Miden hoy a 4 fondos: AB Select US Equity ×2, MyInvestor S&P 500 Equiponderado e Intermoney (sin alfa).
    Ninguna cifra publicada cambia hasta la pasada autorizada. Queda abierto, para otra decisión, si los 3
    fondos del EURO STOXX 50 NR pasan de su proxy ETF a la serie `SX5T`.

## Añadida a las 20:00

29. **Se autoriza la pasada del extractor con red sobre los 13 fondos del camino C** (los 11 del encargo,
    MyInvestor S&P 500 Equiponderado y la segunda clase «AH (EUR)» de Morgan Stanley), después de `0560125`, con
    copia previa y comparación ruta a ruta, y después la **escritura en la base local**. Condición para escribir:
    Morgan Stanley AH sin relativas por clase cubierta, CaixaBank sin relativas por KID compuesto, relativas
    nuevas en los 4 fondos previstos con dato de octubre, y ninguna ficha fuera de las 13 cambiada. La nube, en
    otra decisión con el plan delante.

## Añadidas a las 20:25, con la base local escrita

30. **La ficha dice por qué una clase cubierta no tiene relativas.** `relative_absence` admite un valor nuevo para la
    clase con cobertura de divisa (el aviso `sin_relativas_clase_cubierta` del extractor, que hoy la plataforma
    deja sin traducir a propósito), con su texto en la ficha. Afecta a todas las clases cubiertas con índice, no
    solo a Morgan Stanley AH. Contrato, traducción, mapper y ficha; después la base local.
31. **Los 3 fondos del EURO STOXX 50 NR siguen con su proxy ETF** (iShares `IE00B53L3W79`) aunque EODHD tenga la
    serie NR del índice (`SX5T`). Un proxy en producción no se cambia caso a caso: antes se decide el criterio
    general de cuándo prevalece el nivel de índice sobre un ETF cuando existen los dos, aplicable a las 14 filas
    de precio de mercado. Queda como encargo de análisis pendiente.
32. **Tercera subida del catálogo a la nube y redespliegue del sitio**, con el plan delante y la escritura aprobada
    por Óscar en la ventana de la sesión, como las dos de hoy. Orden decidido por la directora: después de la 30,
    para subir una vez y no dos.

## Añadida a las 22:10, tras el análisis del criterio

33. **El comparador de una fila se elige al aprobarla y no se cambia porque aparezca otra serie** (sobre
    `INFORME_CRITERIO_INDICE_ETF_2026-11-07.md`). Orden: (1) si existe un instrumento aprobado y en producción,
    prevalece: es la alternativa que el cliente puede comprar y lleva la misma fiscalidad del dividendo que el
    fondo medido; condición medible R² ≥ 99 % contra su índice y deriva anual dentro de ±0,5 puntos, cuando el
    índice exista en EODHD para comprobarlo; (2) si no hay instrumento aprobado, entra el nivel de índice con la
    variante declarada, verificada por su deriva contra la de precio, sin mes vacío en cinco años y con divisa en
    el catálogo; (3) si el instrumento falla la condición en la **medición anual**, la fila cambia al nivel de
    índice si lo hay, con retirada fechada (§10) de los fondos que midiese. Hoy ninguna cifra cambia y nada se
    retira: solo 3 de las 19 filas tienen ambas series (EURO STOXX 50 NR `SX5T`, S&P 500 NR `SPXNTR`, STOXX Europe
    600 NR `SXXR`), miden a 6 fondos de 227 y a las 86 acciones de EE. UU., y las tres pasan (R² 99,2-99,96 %,
    deriva ≤ 0,46). Razón de fondo medida: los ETF europeos **ganan** a su índice net return 0,2-0,5 puntos al año
    por recuperación de retención; medir contra el índice leería esa fiscalidad como gestión. El mismo criterio
    para las acciones. **Estado: decidido, no construido.** Falta escribir la regla donde gobierna (cabecera de
    `indices.csv` y `core/indices.py`) y el script anual de lectura que mida el proxy contra su índice; son un
    encargo corto de extractor, aparte.

## Añadidas a las 22:55: las cuatro del informe FIRDS que seguían abiertas

34. **Alcance de mercados: los once centros de `MIC_POR_DEFECTO`** (XMAD, XETA, XPAR, XAMS, XMSM, MTAA, ETFP, XHEL,
    XBRU, XLIS, XLUX) y **no XETB**, que trae como alemanas las extranjeras que negocia Xetra. Se guardan en
    configuración con su motivo; nórdicos, Austria y Polonia quedan nombrados para cuando entren.
35. **La identidad FIRDS se refresca con el fichero completo semanal, a mano**, dentro del refresco manual
    (`firds --sin-deltas`); los deltas diarios quedan construidos y sin usar.
36. **Criterio para las 500 acciones y los 300 ETF:** acciones por pertenencia a los índices principales de los once
    mercados (IBEX 35, DAX 40, CAC 40, AEX, FTSE MIB, BEL 20, PSI, OMX Helsinki 25) más el S&P 500 ya cubierto, y
    corte por efectivo negociado mediano para completar; ETF UCITS por patrimonio por encima de un mínimo, cubriendo
    las clases de activo de las carteras modelo. Antes, un encargo de medición que traiga la lista con cortes
    alternativos; el corte exacto lo fija Óscar con la lista delante.
37. **Identificación ante la SEC (EDGAR):** `User-Agent` «Gestor Activos Financieros» con el correo de Óscar, en la
    configuración del extractor, no en la base. Se usa cuando empiece el paso 5 (fundamentales de EE. UU.).

## Añadida el 08-11-2026 a las 09:30, con el listado de índices delante

38. **El universo de acciones se amplía con los valores de once índices que faltan, y nada sale.** Entran los ISIN de
    `LISTADO_INDICES_2026-11-08_v2.xlsx` que no están en el universo: EURO STOXX 50, IBEX 35, CAC 40, DAX 40, los 50
    mayores del FTSE 100, los 100 mayores del S&P 500, Nasdaq 100, Dow Jones, los 100 mayores del STOXX Europe 600,
    IGBM, SMI y AEX (29 valores, como lo publica Euronext). Son **180** acciones nuevas; el universo pasa de 312 a
    492. Se quedan las 82 del continuo español fuera de índice, las 20 de fuera de los once mercados y las 4 bajas tal
    como están. Las 80 por liquidez de la medición del 07-11 quedan aparcadas. **Los ETF no se tocan**: se quedan los
    32 que hay y Óscar dirá más adelante. La decisión 36 queda así resuelta para acciones y abierta para ETF.

## Añadidas el 08-11-2026 a las 10:40, tras la ampliación de las 180

39. **Honeywell: sale la línea «when issued»** (`US4385162056`), que vino del fichero del S&P 500 y comparte símbolo y
    serie con el ISIN vigente (`US4385161066`). Cuando el ISIN nuevo cotice por sí mismo se tratará como ISIN
    sustituido con la regla que ya existe (decisión 1, Aena).
40. **Las bolsas sin fila en `indices_de_accion.csv` reciben fila:** Estocolmo, Bruselas, Copenhague y Viena con
    alcance AREA y MSCI Europe, como Madrid, París, Xetra, Ámsterdam, Londres o Zúrich. Y el extractor **avisa** cuando
    una bolsa no tiene fila, para que la ficha no calle (hoy 13 acciones estaban sin relativas y sin aviso).
41. **El alta elige la cotización principal:** la del mercado de origen del ISIN en su divisa, y avisa si no la
    encuentra. Se corrigen a mano las tres que resolvieron otra: Generali a Milán (no `0K78.LSE`), Compass e IHG a su
    línea en libras (no la de dólares en Londres). Antes de fijarlas, la sesión mide qué líneas ofrece EODHD por ISIN.
    *Medido después (08-11, 11:10): EODHD no tiene la bolsa de Milán en nuestro plan (afecta a Generali y a las 32 del
    MIB, y explica que las 5 italianas anteriores vayan por líneas de Londres), y Compass e IHG solo existen en Londres
    en dólares. Regla sustituta fijada por la directora: mercado de origen en su divisa; si no existe, una línea en la
    divisa de origen eligiendo la de más sesiones negociadas en 12 meses y, a igualdad, la de historia más larga
    (XETRA frente a `0xxx.LSE` para las italianas, con un solo criterio para las 38); si tampoco, la del mercado de
    origen en otra divisa. Siempre con aviso en la ficha cuando no es la principal. Para las métricas no cambia nada:
    toda línea se convierte a euros con el BCE. Limitación de la fuente que Óscar debe conocer: Milán.*
42. **Moderna se queda sin métricas y con incidencia abierta:** el contrato bloquea un +981 % a un año con un salto de
    +177 % el 19-08-2026. La sesión lo atribuye a los resultados de fase 3 de la vacuna contra el melanoma con Merck,
    sin contrasplit. Si otra fuente confirma la serie, la regla del contrato que la bloquea es la que hay que revisar,
    no el dato; hasta entonces, ausencia dicha en la ficha. Incidencia en `INCIDENCIAS_PENDIENTES.md`.
43. **Entra también el FTSE MIB completo** («el MIB 30», hoy 40 valores): los que faltan tras la ampliación de las 180
    se añaden con el mismo procedimiento (alta, pasada, cadena, base local). Lista en
    `side-session-notes/…/acciones_mib_a_anadir_2026-11-08.csv`.

## Añadidas el 08-11-2026 a las 12:10, con la ampliación escrita en local

44. **Prysmian (`IT0004176001`) sale del universo.** Había entrado hoy por el FTSE MIB y el STOXX 600; su cotización en
    Xetra empieza en 09-2025 y la de Londres es fina. Óscar decide no tenerla. Sus documentos en la base local se
    borran con la 45.
45. **Se autoriza el borrado en la base local y en la nube** de los documentos de Honeywell when-issued
    (`US4385162056`, 73 documentos y su vínculo de emisor) y de Prysmian: entran en `BORRADOS_APROBADOS` de la
    plataforma con las decisiones 39 y 44 como motivo; el plan de la nube los enseñará como `SE BORRARIA`.
46. **Los dos avisos nuevos del extractor llegan a la base y a la ficha:** `sin_relativas_bolsa_sin_referencia` como
    valor de `relative_absence`, y `identificacion.cotizacion_aviso` (cotización que no es la del mercado de origen:
    hoy 38 italianas, Compass e IHG) como nota de la ficha con su motivo. Contrato, traducción, mapper y app, antes
    de la subida.
47. **Cuarta subida del catálogo y redespliegue, después de la 45 y la 46**, en una sola subida: universo ampliado
    (522 acciones), borrados aprobados y avisos. Plan delante y aprobación de Óscar en la ventana de la sesión.

## Añadidas el 08-11-2026 a las 14:40, con el plan de la cuarta subida delante

48. **Cuarta subida del catálogo autorizada**, con el plan repetido por la directora (48.174 documentos, 0 que no
    validan, nada que borrar, carteras y retrocesiones intactas) y la escritura aprobada por Óscar en la ventana de la
    sesión. Lleva el universo de 522 acciones, los borrados aprobados (que en la nube no existían), los dos avisos y
    el mercado de origen real. Después, redespliegue del sitio con `f144ca7`.
49. **Ferrovial y Allianz pasan a su mercado de origen** (hoy `FER.US` y `ALV.F` cuando EODHD tiene Xetra y los mercados
    de Ferrovial): Allianz a Xetra; Ferrovial a la principal que determine la regla con fuente. Cambian su serie y
    sus métricas; entra en la pasada de la quinta subida, no en la cuarta.

## Añadida el 08-11-2026 a las 15:15

50. **Se borran los 5 documentos de serie de Allianz anteriores a 1994** (`price_series/1989` a `1993`, 1.241 puntos de la
    línea de Fráncfort que la decisión 49 sustituyó por Xetra): entran en `BORRADOS_APROBADOS` con la 49 como motivo,
    se borran en local ahora y en la nube con la quinta subida. La serie publicada queda de una sola línea.

## Añadidas el 08-11-2026 a las 17:30, tras la medición de fuentes de ETF (paso 3)

*Sobre `INFORME_FUENTES_ETF_2026-11-08.md`: seis emisores publican sin navegador lo que hace falta y cubren 257 de los
300 candidatos; el lector actual de iShares está roto (su `.ajax` devuelve 404); HSBC, WisdomTree y VanEck no dan
histórico de valor liquidativo; UBS devuelve 403 sin aceptar su aviso de inversor.*

51. **Se construyen seis adaptadores de emisor, en este orden: iShares (rehecho), Amundi, Xtrackers, Vanguard, SPDR e
    Invesco**, uno por encargo, con la misma forma y pruebas sobre tres ETF reales cada uno. HSBC, WisdomTree y VanEck
    quedan aparcados hasta tener vía con histórico.
52. **El valor liquidativo del emisor se guarda como dato declarado y las métricas de los ETF siguen sobre precio de
    mercado (§11).** La ficha podrá enseñar prima/descuento. Medido a 12 meses: 0,1-0,2 puntos de volatilidad en
    subyacente europeo, 0,6-1,3 fuera, sin signo fijo; cambiar el estimador de los ETF no se decide con un año de datos.
53. **Las condiciones de uso de las seis webs las lee Óscar**, con un resumen por emisor (cláusulas de uso automatizado
    y redistribución, con enlace) preparado por una sesión de lectura. Si alguna frena un adaptador, se decide antes de
    escribirlo.
54. **UBS queda aparcado:** sin vía limpia no se construye y sus ETF no entran al universo. Las decisiones 36 y 38
    siguen: 32 ETF hasta que Óscar diga.

*Estado de la 51 el 08-11 a las 23:40: **construida en el extractor.** Seis adaptadores en la forma común (`emisor.*`,
`series.vl_emisor`, `--fuentes`): iShares `ca0c073`, Amundi `59e2094`, Xtrackers `708420c`, Vanguard `e5ee4f8`, SPDR
`7bd7a55`, Invesco `9c55849`; 1.217 pruebas; 15 fichas del universo con bloque del emisor. Ninguno entra en la pasada
general hasta la 53. Falta que la base y la ficha lean el bloque (contrato, mapper, app) y decidir si el emisor manda
sobre Morningstar y justETF en TER, réplica y posiciones. Hallazgo de Invesco: la comisión de swap va fuera del TER y en
su S&P 500 es mayor que él (0,0718 % frente a 0,05 %); se guarda aparte.*

*Estado el 08-11 a las 21:50 (hora corregida: «23:40» arriba son las 18:34, y «00:30» las 19:15): la base y la ficha
leen el bloque (`cf291e8`, `05838b9`); sexta subida sin datos del emisor, comprobado en la nube. De «si el emisor
manda», medido en los 15: el TER coincide en los 14 con cifra en ambos; la política de reparto es «desconocida» en el
proveedor en 10 donde el emisor declara acumulación (rellena un hueco, no contradice); las posiciones difieren en 12
por tres causas que no son errores —sintéticos: cesta de sustitución frente a swap; definición: líneas con liquidez y
derivados frente a títulos; fecha: una a cinco semanas— y el peso del top 10 coincide a ±0,5 puntos en los diez
físicos. Pendiente la **decisión 55**: qué cifra de posiciones se publica, con qué se compara y si el emisor rellena la
política cuando el proveedor no la sabe.*

## Añadida el 08-11-2026 a las 21:55, con la medición de las posiciones delante

55. **Las posiciones del emisor y las del proveedor se publican las dos, cada una con su definición y su fecha, y la
    ficha solo dice «Coincide» cuando miden lo mismo y dan el mismo número.** Si el emisor declara su recuento de
    títulos (`holdings.declared_positions_count`), ese es el que se pone frente al recuento de títulos del proveedor;
    si no lo declara, su cifra se rotula como líneas de la cartera, con liquidez y derivados, y no se enfrenta a nada.
    En los sintéticos, solo la cesta de sustitución con su nota y la contraparte. La ficha no dice nunca «difiere»:
    es la regla de la §3 del método aplicada a un recuento, dos cifras solo se comparan si miden lo mismo. Y la
    política de reparto: donde el proveedor dice «desconocida» y el emisor la declara, la ficha enseña la del emisor
    con su etiqueta de fuente (10 de 15 hoy); rellena un hueco, no sustituye un dato. Toca el contrato: la base
    guarda del proveedor solo el total de líneas (`declared/holdings.positions_count`), y para enfrentarlo al recuento
    declarado del emisor hace falta también su recuento de títulos (`num_posiciones_rv` y `num_posiciones_rf` del
    canónico), que hoy no se escribe. Los datos del emisor siguen sin subir hasta la decisión 53. Medición en la coordinación (08-11, 21:50) y en la página
    publicada de la decisión.

*Estado de la 53 el 08-11 a las 22:35: **resuelta por Óscar**, por control remoto, con la página de resumen de las
condiciones delante: «Hacemos uso interno de la información para el desarrollo». Consecuencias que la directora
deduce y que él corrige si no son esas: los seis adaptadores entran en la pasada general del extractor; el bloque del
emisor puede escribirse en la base nueva y subir a la nube, porque la aplicación publicada es su herramienta interna;
la exclusión de `subirALaNube.ts` se retira; ninguna cifra del emisor entra en un informe de cliente, porque eso ya no
sería uso interno; no se escribe a los emisores pidiendo permiso. Quedan por leer en navegador las tres páginas que la
sesión de lectura no pudo verificar (DWS, SPDR europea, aviso de Amundi): si alguna prohíbe de forma clara, ese
adaptador sale de la pasada. La construcción de esto es un encargo nuevo, aún sin arrancar.*

## Añadidas el 08-11-2026 a las 22:50, con la decisión 55 construida

56. **La política de reparto del emisor vale para la aptitud cuando el proveedor no la sabe.** Donde el proveedor dice
    «desconocida» y el emisor la declara, la aptitud que hoy produce «reparto sin confirmar» en la cabecera de la
    ficha toma la del emisor, con su fuente anotada; donde el proveedor sí la da, sigue mandando la del proveedor (la
    52 no cambia: el emisor rellena, no sustituye). Son 10 de los 15 instrumentos con bloque del emisor. Se construye
    en la regla de aptitudes de la plataforma (`src/config/baseNueva/aptitudes.ts`) y en la tarjeta, no en la ficha,
    para que la cabecera, el buscador y la calidad digan lo mismo. Entra en el mismo encargo que la construcción de
    la 53: pasada general con los seis adaptadores, exclusión de `subirALaNube.ts` fuera, base local reescrita y
    séptima subida del catálogo con el bloque del emisor, `securities_count` y esta aptitud, con aprobación de Óscar
    delante de la puerta.

*La 53 queda **cerrada** el 09-11 a las 02:45 por Óscar: las tres páginas que la sesión de lectura no pudo verificar (DWS,
SPDR europea, aviso de Amundi) no se leen; la decisión vale tal como está, uso interno para el desarrollo, y los seis
adaptadores siguen en la pasada general. Dejan de figurar como pendientes.*

## Añadida el 09-11-2026 a las 04:55, tras la medición del re-mapeo sin red

57. **`update` no escribe una ficha sin su identidad FIRDS por falta del índice.** La medición del 09-11
    (`INFORME_REMAPEO_SIN_RED_2026-11-09.md`) probó en copia que, si `cache/firds/firds.sqlite` no está, el adaptador
    devuelve vacío y la ficha se reescribe sin los diez campos de FIRDS, sin error, sin aviso y con la guarda de calidad
    sin actuar (3 de 3; hoy 0 fichas afectadas y 805 potenciales). Se cierra el caso masivo con la **opción B**: `update`
    se para, nombrando la causa y la orden que la arregla (`python main.py firds`), cuando falta el índice y alguna de las
    fichas pedidas ya lleva `meta.firds_visto`; se puede seguir solo con una bandera explícita que lo diga. Donde el índice
    está pero un ISIN ya no figura en él, la ficha avisa y nada más: retener la identidad con caducidad (opción C) queda
    para cuando se toque la retención, con su plazo decidido. Óscar, 09-11-2026, 04:50 («Sigue» a la pregunta de
    construir la B). Se construye en `1-extractor`, en la entrada de `update`, con su prueba; no toca la base ni la nube.

## Añadidas el 09-11-2026 a las 05:00: Óscar aprueba las seis recomendaciones de la página de decisiones

*«Apruebo todas tus recomendaciones», 09-11-2026, 04:58. La 57 queda como está arriba; estas son las otras cinco, con la
recomendación convertida en decisión.*

58. **El mercado objetivo del emisor va a un documento propio, `declared/target_market`, solo con el EMT.** No entra en el
    bloque del emisor (que ataría el dato a los 32 ETF) ni se reduce al horizonte junto al SRI (perdería el filtro
    negativo). Versión mínima, con lo que la medición del 09-11 encontró útil: periodo mínimo de tenencia recomendado
    (campo `05080`), mercado objetivo positivo y negativo, fecha del documento y emisor; **sin EET**, que se aplaza hasta
    tener cobertura (hoy 2 de 32); **no cuenta en la calidad** (`x-counts-when: NUNCA`), y el campo `03050` (siempre «Y»)
    no se enseña. Vale para cualquier fuente, también fondos activos cuando llegue su EMT.
59. **Cada cartera modelo guarda un nivel de perfil y un horizonte en años, editables por Óscar en la app.** Es lo que
    permite el aviso útil («la cartera se ha definido a 3 años y este fondo recomienda 5»); sin ello el EMT solo puede
    enseñarse en la ficha. **Abierto y suyo:** la escala de años por defecto por nivel de perfil, si la quiere; hasta que la
    dé, el horizonte se guarda solo cuando él lo escribe y no se deduce del nivel. Se construye cuando la 58 esté en la base.
60. **El coste de operación del EMT del emisor sustituye al del proveedor en los 15 instrumentos sin KID**, con la fuente
    anotada al lado. Es una excepción explícita a la 52 (el emisor rellena, no sustituye), y se admite porque el emisor es
    la fuente primaria, cuadra con el KID en 8 de 8, y dos cifras del proveedor son negativas y el contrato no las admite.
    **Antes de sustituir se mide por qué difiere el proveedor en 20 de 23**, y la medición queda escrita.
61. **No se acepta la puerta del portal de DWS** para medir el EMT de Xtrackers (2 de 32) hasta que lo de los otros tres
    emisores esté construido. Aceptar una condición de uso es decisión de Óscar y queda aplazada, no negada.
62. **Orden de construcción:** primero la guarda del índice FIRDS (57); después el EMT de extremo a extremo (58 y 60: lector
    en el extractor, contrato en la plataforma, base local, ficha y octava subida del catálogo con aprobación delante de la
    puerta); por último perfil y horizonte en las carteras modelo con los avisos (59), con la habilidad de diseño de
    pantalla. Lo que no toque el extractor puede ir en paralelo a la guarda; la 59 solo cuando la 58 esté en la base.

*La 59 se completa el 09-11 a las 08:30 por Óscar («adelante con tu recomendación»): **no hay escala de años por nivel.** El
horizonte de la cartera modelo se guarda solo cuando el asesor lo escribe y no se deduce del nivel ni del texto del perfil; los
avisos que crucen el horizonte con el del fabricante solo corren cuando está definido. El texto orientativo que ya enseña cada
nivel («Medio plazo orientativo») se queda como está, como pista y no como cifra. Razón: el horizonte es un dato del cliente y del
mandato, no una función de su tolerancia al riesgo, y una cifra deducida se convertiría en la referencia de los avisos sin que
nadie la hubiera definido. La tabla por bandas de texto (1, 2, 3, 4, 5, 7 y 10 años) queda escrita en la coordinación del 09-11
por si algún día se quisiera como sugerencia visible, no guardada; hoy no se construye.*

## Añadidas el 09-11-2026 a las 08:40: Óscar acepta las recomendaciones pendientes («las otras recomendaciones también las acepto»)

*La 60 cambia de forma con la medición delante; la 58 y la 59 se completan.*

60. **(Reformulada.) El coste de operación se corrige en la lectura, no se sustituye por el emisor.** La medición
    (`INFORME_COSTE_OPERACION_2026-11-09.md`) probó que el proveedor no se equivoca: Morningstar entrega la cifra estimada
    (ex ante) y la real del último año (ex post), y `fetchers/morningstar_lt.py::_mapea_mifid` tomaba primero la real en las
    cinco parejas de costes MiFID y la guardaba como `costes.mifid_emt_exante.*`, un nombre ex ante con una cifra ex post. La
    estimada coincide con el `07130` del emisor en 23 de 23 a 0,05 pb y con el KID redondeado en 8 de 8. Se corrige: en las
    cinco parejas manda la **estimada**, con su propia fecha; la real pasa a un campo propio con nombre ex post
    (`costes.mifid_ex_post.*`), que se guarda en la ficha y **no se publica** hasta que haya decisión sobre si enseñarlo. Las
    negativas, si quedara alguna, no se recortan a cero: ausentes con aviso. El `07130` del EMT queda como **comprobación**,
    no como sustituto: una alerta en el log si |proveedor ex ante − 07130| > 0,5 pb. Con esto la excepción a la 52 ya no hace
    falta, y una cifra del emisor no llega al PDF de costes (53). El alcance es todo el catálogo (70 de 105 fichas con coste de
    operación, 315 de 772 en el coste corriente), no solo los 15 sin KID; el canónico nuevo sale ya con la cifra bien leída.

*La 58 se completa: el bloque `mercado_objetivo` **se retiene 180 días**, igual que el bloque `emisor`, para que una pasada
con `--fuentes` que no incluya `emt` no lo borre. Lo decide Dirección por coherencia con la regla que Óscar ya fijó para el bloque
hermano; el plazo es el mismo y por la misma razón.*

*La 59 se completa en producto: **el nivel guardado arrastra el «Perfil elegido (informativo)»** de Comprobar al abrir la cartera
(si la cartera no tiene nivel, el perfil elegido sigue siendo el de la sesión), y **«Guardar como…» y «Guardar como propuesta»
heredan perfil y horizonte** de la cartera de origen.*

*La 53 se completa en pantalla el 09-11 a las 10:20 por Óscar («Sí, ocultar»): **en Modo cliente no sale nada del emisor.** Las
secciones «Lo que dice el emisor» y «Valor liquidativo del emisor» de la ficha se ocultan igual que la nueva «Para quién está
pensado (según el fabricante)», con su motivo en `SE_OCULTA` (`src/core/modoCliente.ts`): los datos del emisor son de uso interno
para el desarrollo y no entran en lo que ve un cliente, ni en papel ni en pantalla. Lo que ya estaba fuera del Modo cliente no
cambia.*

## Añadidas el 09-11-2026 a las 08:05: Óscar aprueba las tres recomendaciones de la pasada local («Sí, las tres»)

*Salen de la pasada local del refresco del 09-11 (canónico `f0a599e1…`), medida por el subagente y repetida por Dirección.*

63. **El mercado objetivo del fabricante se publica para todo instrumento que traiga EMT, también los fondos activos.** La pasada
    lo trajo para 91 fichas, no para las 24 esperadas: los 23 ETF y el oro, más 66 fondos activos de iShares, BlackRock, Invesco y
    Vanguard y un ETF, porque el lector aplica el fichero del emisor a todo ISIN que contenga y el contrato
    `declared/target_market` ya admitía fondo o ETF. Es el mismo documento, con la misma fecha y plantilla, y ya se oculta en Modo
    cliente y no entra en informes (53). Acotarlo a los ETF sería tirar un dato que el fabricante publica igual para sus fondos. En
    la base local son 90: el oro no entra porque allí es OTHER y el contrato solo admite fondo o ETF, y así se queda. La
    descripción del contrato, que decía «23 de los 32», se corrige con la cifra medida. Sigue sin contar en la cobertura
    (`x-counts-when: NUNCA`).

64. **Cuando el proveedor recorta una serie, el documento anual que queda colgando se borra, por lista nombrada.** EODHD ha
    recortado la serie de IUSQ.XETRA (iShares MSCI ACWI, `IE00B6R52259`): empezaba el 21-10-2011 y ahora empieza el 02-04-2012,
    así que `instruments/IE00B6R52259/price_series/2011` (50 puntos) sobra y deja un hueco de enero a marzo de 2012. Una serie
    más corta sin huecos vale más que una más larga con uno; ninguna cifra publicada llega a 2011 (las ventanas van de 1 a 10
    años desde hoy), y mientras el documento siga el escritor de series para en cada refresco y `--sube` no llega. Se borra por el
    único camino que borra: la ruta entra en `BORRADOS_APROBADOS` con esta decisión, su fecha y su motivo; `baseNueva:borrar` lo
    quita del emulador y la subida del catálogo lo quitará de la nube. Queda anotado que la pérdida es del proveedor, no del
    fondo: el ETF cotiza desde octubre de 2011. La regla vale para el próximo caso igual, pero cada ruta se decide y se escribe
    una a una: no hay patrón ni borrado automático.

65. **La comisión de swap sigue oculta en Modo cliente, y la fila del Perfil enseña la política de reparto sin nombrar la fuente.**
    Al ocultar todo lo del emisor (53, 09-11 10:20) el cliente deja de ver la comisión de swap, un coste que sí paga y que solo
    publica el emisor (en Invesco S&P 500, 0,0718 % frente a 0,05 % de coste corriente). Óscar decide dejarla oculta mientras
    rijan las condiciones de uso de los emisores; enseñarla obligaría a revisarlas para ese dato. Y para que la cabecera, que da
    la aptitud de reparto por buena porque la 56 la hizo aptitud del instrumento, no contradiga a la fila del Perfil («Falta el
    dato»), esa fila enseña la política también en Modo cliente, sin fuente: la fuente ya se oculta por `fuenteDeDatos`, y la
    política de reparto es un hecho del instrumento, no una cifra del emisor.

*La **octava subida del catálogo** la aprueba Óscar el 09-11 a las 12:38 («Sí, sube»), sobre el plan en seco de las 10:58, y la
ejecuta Dirección en esta ventana de 12:39 a 12:52, solo `--parte catalogo` y solo con la puerta delante de esa orden. Con ella la
B-64 queda **construida en la nube**: `instruments/IE00B6R52259/price_series/2011` ya no existe allí. La B-63 también: 90 documentos
`declared/target_market` publicados. Las otras cuatro decisiones de la página (R1 con el KID solo, métricas viejas junto al sello de
ausencia, fuente real de la cotización, prefijo de las series) siguen abiertas.*

## Añadidas el 09-11-2026 a las 13:10: Óscar resuelve las cuatro decisiones de la página de la octava («Las resuelvo ahora»)

*Desde la B-69, cada decisión se cita con el prefijo de su serie. Las de este documento son la serie **B**; las cuatro de
aquí abajo son B-66 a B-69, y las anteriores se citan B-1 a B-65 cuando haga falta distinguirlas.*

66. **(B-66) El aviso de horizonte de Comprobar salta también con el plazo del KID solo, sin EMT.** R1 (B-59) comparaba el
    horizonte de la cartera con el del instrumento solo en las posiciones con `declared/target_market`; el horizonte del KID,
    `recommended_holding_years` de `declared/regulatory`, lo traen 629 instrumentos frente a los 90 con EMT, y es documento
    regulatorio público, no dato interno del emisor. Desde ahora una posición con horizonte del KID y sin mercado objetivo entra
    en R1 (y solo en R1: R2 y R3 siguen necesitando el EMT), cuenta como «con datos» para esa regla, y el panel deja de titularse
    «del fabricante»: compara la cartera con el mercado objetivo **y el horizonte** declarados. Sin años no hay R1, como antes.

67. **(B-67) Las métricas antiguas de un instrumento con la serie parada se borran, por lista nombrada y caso a caso.** Es la
    regla «un campo presente donde no aplica es un error» (A-17, decidida y no construida) llevada a su primer caso:
    `instruments/LU0171283459/computed/metrics` (BlackRock Global Allocation A2, V2 a 30-09-2026) convive en la nube con el sello
    `metrics_absence: SERIES_STOPPED`, y el escritor lo nombra como sobrante en cada plan. La ruta entra en `BORRADOS_APROBADOS`
    con esta decisión; `baseNueva:borrar` la quita del emulador y la novena subida la quitará de la nube. El escritor sigue sin
    borrar solo: cada caso igual se decide y se escribe uno a uno, y la tarjeta y la cobertura de calidad tienen que decir lo
    mismo que el borrado.

68. **(B-68) La cotización publica la fuente real del precio, no el canónico.** `declared/quote.source` decía
    `canonical:fondosdb` en los 1.310 documentos aunque el canónico sabe de dónde viene cada precio (`meta.procedencia`
    `valoracion.vl`): 738 `vl_eodhd:eod`, 542 `eodhd`, 31 `morningstar_lt:sal_quote`, 5 sin procedencia, medido el 09-11 sobre
    `182481b2…`. Se publica **el código de procedencia tal como lo escribe el extractor**, el mismo vocabulario que
    `declared/provenance` ya publica para los demás campos, para que una cifra y su procedencia se lean con la misma clave; donde
    falte, se mantiene `canonical:fondosdb` y se dice en el contrato. El contrato describe el vocabulario sin cerrarlo en un
    enum: una fuente nueva no debe romper la escritura. Entra en la novena subida, no sola.

69. **(B-69) Las series de decisiones llevan prefijo, y las citas de 63, 64 y 65 se reescriben.** Cuatro series numeradas de
    noviembre repiten números: **A** `3-BDB-ACTIVOS_app/docs/rediseno-2026-11/DECISIONES_AUDITORIA_2026-11-04.md` (A-1 a A-122),
    **B** este documento, **C** `DECISIONES_BASE_NUEVA_2026-11-01.md` (hasta ahora citada «§N»), **D**
    `DECISIONES_ADQUISICION_2026-10-30.md` (D1–D8). Toda cita nueva lleva el prefijo; las citas existentes de 63, 64 y 65, que
    hoy existen en A y en B, se reescriben con el suyo; las demás citas anteriores (911 medidas el 09-11) se dejan, porque el
    documento en que aparecen las desambigua y reescribirlas no compensa. El índice de series vive en `INDICE_DE_DECISIONES.md`,
    en la raíz.

*La **novena subida del catálogo** la aprueba Óscar el 09-11 a las 14:17 («Sí, sube»), sobre el plan medido a las 14:05, y la
ejecuta Dirección en esta ventana de 14:17 a 14:28, solo `--parte catalogo` y solo con la puerta delante. Con ella la **B-67**
queda construida en la nube (`instruments/LU0171283459/computed/metrics` ya no existe allí) y la **B-68** también (las 1.310
cotizaciones publican su fuente real). La B-66 espera el despliegue de la app por Óscar. Queda abierta la decisión sobre el ETF
monetario `LU0290358497`, que entra en la base como FUND.*

## Añadida el 09-11-2026 a las 15:15: Óscar retira el ETF monetario de la página de la novena («Retirar»)

70. **(B-70) El Xtrackers II EUR Overnight Rate Swap UCITS ETF 1C (`LU0290358497`) se retira entero del catálogo, y antes
    Rendimiento deja de depender de él.** Óscar dijo primero reclasificarlo («Sí, en la décima»), después retirarlo, y al saber
    que Rendimiento lo usa, retirarlo igualmente pasando esa dependencia al €STR. Lo medido antes de decidir: 56 documentos en la
    nube y en local; ninguna cartera, objetivo ni retrocesión lo tiene; es el único monetario del catálogo (515 acciones, 769
    fondos, 32 ETF); la plataforma lo traducía a FUND desde el tipo `monetario` y su cotización decía valor liquidativo con un
    cierre de XETRA; y **Rendimiento** (la cartera real importada) lo usa como referencia «EUR overnight / €STR (XEON)» y como
    respaldo del libre de riesgo cuando la media del €STR del BCE no llega (`portfolio_real/service.py`,
    `realPortfolioBackend.ts`). Tres pasos, en este orden, porque las Functions leen la nube:
    1. **Rendimiento pasa al €STR de la base.** La referencia monetaria y el respaldo del libre de riesgo salen de
       `reference_rates/ESTR_{año}` (BCE, tipo anual en tanto por uno, un punto por día hábil), como **índice capitalizado**: parte
       de 100 en el primer día de la ventana y crece cada día hábil con el tipo del día anterior por los días naturales
       transcurridos sobre 360, que es la convención del €STR. No es un instrumento de la base: la cobertura lo dice así y no
       pide «alta en la maestra». El tipo del Sharpe sigue siendo la media del €STR del BCE (decisión 6.3 del 17-10); solo cambia
       el respaldo. Es la misma fuente que el método propio usa como libre de riesgo: un ETF con coste y contraparte de swap no lo
       era.
    2. **Óscar despliega** las Functions y el hosting con ese cambio.
    3. **Décima subida:** el instrumento sale del universo del extractor con la operación de baja (`core/ops.baja`: fuera de
       `config/fondos.csv`, ficheros a `data/_papelera/`), el canónico pierde exactamente su línea, los 56 documentos entran en
       `BORRADOS_APROBADOS` con `instrumento_retirado` y esta decisión, se borran en local y la décima los borra en la nube. Hasta
       el paso 2 no se sube. La traducción `monetario → FUND` se queda: ya no la usa nadie, y cambiarla sin caso que medir sería
       tocar de rebote.

*La **décima subida del catálogo** la aprueba Óscar el 09-11 a las 15:37 («Desplegado, sube»), después de desplegar él Functions y
hosting con los 15 commits de la app posteriores a `7402894` (el sitio publicado es el compilado a las 15:35 y lleva el cambio de
Rendimiento; de las Functions, la señal es el manifiesto de contratos que sincroniza el script de despliegue). La ejecuta Dirección
en esta ventana de 15:38 a 15:50, solo `--parte catalogo` y solo con la puerta delante. Con ella la **B-70 queda construida
entera**: el Xtrackers II EUR Overnight Rate Swap no tiene ningún documento en la nube, Rendimiento compara contra el €STR
capitalizado del BCE, y el catálogo queda en 1.315 instrumentos (515 acciones, 768 fondos, 32 ETF).*

## Añadida el 09-11-2026 a las 16:45: Óscar, al ver Rendimiento bloqueado por Fondibas («sería conveniente reconstruir el catálogo, o construir ese reconocimiento automático por nombre»)

71. **(B-71) Rendimiento identifica los activos históricos del bróker también por el catálogo, cuando el nombre coincide
    exactamente con un solo instrumento.** Hoy los activos vendidos del extracto de Andbank solo se identifican por una tabla
    escrita a mano en la Function (`portfolio_real/mapping.py`, 25 nombres), y un nombre que falta bloquea la pantalla entera;
    Fondibas FI, en la base desde el primer día, la bloqueó el 09-11 porque Andbank lo escribe «FONDIBAS FI» y el catálogo
    «FONDIBAS, FI». De las dos salidas que planteó Óscar, Dirección recomienda y él acepta la segunda: **la tabla manual sigue
    mandando** (es donde viven las abreviaturas del bróker, que ningún catálogo resuelve) y, si el nombre no está en ella, la
    Function lo busca en el índice del buscador de la base (`search_shards`, los 1.315 instrumentos con `name`, `name_folded`,
    `instrument_id` y `instrument_type`) con una normalización común a los dos lados (mayúsculas, sin tildes, sin puntuación,
    espacios colapsados). **Solo con una coincidencia exacta y única** el activo queda confirmado, con fuente
    `catalogo:nombre-exacto` visible en la cobertura; con varias o con ninguna sigue bloqueando como hoy, y las varias se
    enseñan como candidatas. No se adivina por parecido: atribuir un movimiento al fondo equivocado es peor que no calcular.
    «Reconstruir el catálogo» como tabla generada se descarta: quedaría vieja con cada subida y exigiría un despliegue por fondo
    nuevo, y las abreviaturas del bróker seguirían fuera. Si el índice no se puede leer, la Function se comporta como antes.

## Añadida el 09-11-2026 a las 20:17: Óscar confirma el ISIN de su posición histórica de Groupama («GROUPAMA AVENIR EUROPE - NC LU0675297237 es este»)

72. **(B-72) La posición histórica «GROUPAMA AVENIR EUROPE - NC» del extracto de Andbank es el Groupama Avenir Europe NC
    luxemburgués, `LU0675297237`, y no el Groupama Avenir Euro NC francés, `FR0010288308`, al que apuntaba la tabla manual
    de Rendimiento.** La tabla (`portfolio_real/mapping.py`) se escribió el 09-07-2026, cuando el francés era el único Groupama
    del universo; el luxemburgués entró en `fondos.csv` el 13-10 con el texto literal del bróker. Son dos fondos distintos:
    medianas europeas con MSCI Europe Small Cap, domicilio LU, 2014, frente a medianas de la zona euro con MSCI EMU Small Cap,
    domicilio FR, 2006. Con la tabla equivocada, la rentabilidad histórica de esa posición en Rendimiento se calculaba con la
    serie del fondo francés. Se corrige la entrada (nombre canónico «Groupama Avenir Europe NC», nota con la historia) y
    quedan dos pruebas: el nombre del bróker resuelve al luxemburgués y ninguna entrada confirmada apunta ya al francés.
    Dirección propuso el luxemburgués por el nombre exacto; lo que decide es el ISIN que Óscar leyó en Andbank. La tabla
    corregida llega a producción con el siguiente despliegue de Functions, junto con la B-71.

## Añadidas el 09-11-2026 a las 20:25: Óscar resuelve las cuatro decisiones restantes de la página de la tarde («widen the limit for stocks»; «el resto de puntos sigue tus recomendaciones»)

73. **(B-73) Una cifra fuera del rango de su contrato bloquea solo su ventana, y las acciones tienen un tope de rentabilidad
    más ancho.** Hoy `instrument-computed-metrics.v2` acota toda fracción a ±5 (±500 %) y una sola cifra fuera deja el documento
    entero sin escribir: Moderna (`US60770K1079`) rindió +980,95 % a un año y +762 % en el año en curso, cifras reales
    (cierre de 174,38 $ el 19-08-2026 desde 62,96 $, recogido por AP y Reuters), y no tiene métricas propias, con
    `metrics_absence` vacío en la raíz. Lo decidido: la cifra que se sale se deja fuera y el documento dice cuál y por qué; el
    resto se escribe. Para acciones, la rentabilidad anualizada y la del año en curso admiten de −100 % a +2.000 %; fondos y ETF
    siguen en ±500 %, y volatilidad, drawdown, R², alfa, exceso, tracking error y ratios no cambian. Por qué 20 veces y solo en
    acciones: un fondo diversificado no multiplica por 20 en un año y un valor así en un fondo es un error de datos; una acción
    sí puede, y más de 20 veces en un año casi siempre es un split sin ajustar o un error de divisa, que es lo que el filtro
    quiere cazar. El filtro es de verosimilitud, no de método: no cambia la versión del método. Entra en la undécima subida.
74. **(B-74) La rentabilidad del proveedor lleva una fecha por cifra, dentro del mismo bloque.** Morningstar entrega el 1 mes, el
    año en curso y el 1 año a fin de mes (`sal_trailingReturn`, hoy 31-10-2026) y el 3, 5 y 10 años anualizados a fin de
    trimestre (`ETFsnapshot`/`MFsnapshot`, hoy 30-09-2026); el canónico publica una sola `rentabilidad.fecha_dato` y el mapper la
    pone a todo `declared/provider_returns`: en unos 272 de ~604 fondos, tres cifras llevan fecha equivocada. Era lo que hacía
    parecer que Capital Group New Perspective «cuadraba a un año pero no a tres». Lo decidido, de las tres salidas (una fecha por
    cifra, dos bloques por fuente, dejarlo): el extractor añade `rentabilidad.fecha_dato_por_ventana` con la fecha de cada
    ventana y conserva `fecha_dato`; el contrato admite una fecha por ventana y `as_of` pasa a ser la más reciente del bloque;
    el mapper las copia. Ninguna cifra cambia; cambia la fecha que llevan. Entra en la undécima subida.
75. **(B-75) La identidad FIRDS se reconstruye desde el completo semanal de ESMA, y las plazas que solo traían los deltas se
    pierden y quedan registradas.** El completo solo lista centros de la UE; los deltas diarios añadían los británicos y otros.
    Al reconstruir, 3.141 ISIN pierden 10.669 centros (Standard Chartered 60 → 22) y 977 ganan 1.739. Lo decidido: quedarse con
    el completo, que es la fuente oficial y reproducible, y con el registro por reconstrucción
    (`data/history/firds_plazas/plazas_<nuevo>_sobre_<vigente>.csv`). Hoy solo afecta al recuento de mercados que la base
    guarda y la app no lee; nada que vea un cliente cambia. Nada que construir: es aceptar lo que la regla del 09-11 ya hace.
76. **(B-76) Los zips de FIRDS del 31-10 al 06-11 (210,7 MB, ningún índice vigente los usa) se conservan hasta la primera
    reconstrucción con red tras la regla nueva, la del sábado 14-11-2026, y se borran después.** Son lo único que rehace el
    estado anterior a la octava subida y con ellos se hizo el ensayo de la regla del nombre. El borrado lo ejecuta Dirección
    después de esa reconstrucción, con aviso a Óscar antes de borrar; no antes.


## Añadida el 10-11-2026 a las 00:20: Óscar pide cargar las carteras de un cliente («Si algun activo de dichas carteras no esta en la base de datos incorporalo»)

77. **(B-77) Un activo que un cliente tiene en cartera entra en el catálogo, aunque no esté en los índices que definen el
    universo.** La decisión 38 fijó el universo de acciones por pertenencia a once índices; esta añade una segunda puerta: lo
    que un cliente ya tiene. La primera aplicación son **doce instrumentos** leídos de tres extractos (11 acciones y 1 ETF):
    `US4404521001` Hormel Foods, `US50155Q1004` Kyndryl, `US83444M1018` Solventum, `US5007541064` Kraft Heinz,
    `US9113121068` UPS, `ES0105089009` Lleidanetworks, `US98978V1035` Zoetis, `US60871R2094` Molson Coors,
    `US4943681035` Kimberly-Clark, `FR0013447729` Verallia, `GB0031743007` Burberry e `IE00BJ5JPG56` iShares MSCI China UCITS
    ETF. Ocho llevan el ISIN en el extracto; Verallia, Burberry y el ETF vienen solo por nombre y el ISIN sale de FIRDS: los dos
    primeros (Burberry, la ordinaria en libras, no el ADR) sin ambigüedad, y el ETF **confirmado con el precio**: FIRDS trae dos
    clases con ese nombre (`IE00BJ5JPG56` de acumulación, admitida en Xetra, e `IE00BL977C92` de reparto, admitida solo en
    Ámsterdam), el extracto dice euros y da 4,7295 el 09-11, y la de acumulación cerró ese día en Xetra a 4,7265.
    **Kimberly-Clark no viene en ningún extracto: entra por Kenvue** (`US49177J1025`), que sí venía, con fecha 01-11.
    Kimberly-Clark cerró su compra el 02-11-2026 y Kenvue dejó de cotizar ese día (10-Q de Kimberly-Clark del tercer trimestre;
    en EODHD solo queda su línea de Fráncfort, parada el 30-10): cada acción pasó a ser 3,50 USD y 0,14625 acciones de
    Kimberly-Clark. Kenvue se dio de alta y **se retiró el mismo día** con `core.ops.baja`, sin salir del extractor, y Óscar
    decidió que la cartera lleve Kimberly-Clark («Ok a tus recomendaciones», 10-11, 00:40). La regla que deja: **un valor que
    ya no cotiza no entra por esta puerta; entra lo que el cliente tiene hoy.** **Lo que no cambia:** entrar en el catálogo no es poder proponerse; las reglas de qué se puede
    proponer (calidad del dato, liquidez) siguen como están, y lo que un cliente tiene y no se puede proponer pasa con su
    importe (A-113). Ni el nombre del cliente ni sus importes se escriben en ningún repositorio. **Estado:** alta hecha en
    el extractor (`9ef8e18`, `2b72fc9` y `e51a685`: 533 acciones, 32 ETF y 769 fondos; las 1.322 fichas anteriores, idénticas
    byte a byte); base local, con la pasada entera de la undécima subida; **nube, desde la undécima subida** (10-11-2026, de
    03:38 a 03:52, aprobada por Óscar en ventana: «Desplegado, sube»), con la comparación posterior a cero diferencias. Las
    cuatro carteras se crearon después con la propia aplicación, y la aplicación reconoce los doce. Diez fondos y ETF del catálogo siguen nombrando a Kenvue entre sus posiciones hasta que su fuente las
    actualice: es su cartera publicada, no un alta.

## Añadida el 11-11-2026 a las 08:07: Óscar decide qué hacer con una posición cuya serie está parada («Sí, avisa»)

78. **(B-78) Un fondo con la serie parada más de 90 días se avisa donde se enseñan sus cifras.** Sale de investigar los tres
    fondos con Morningstar a 30-11-2025 que dejó dichos la B-74: `LU1882457739`, `LU1883319474` y `LU1883342880` son clases C
    de Amundi Funds que la gestora convirtió en clase A el 28-11-2025 (`LU1882457143`, `LU2070309450` y `LU2070309377`). No
    falla la captura ni se ha quedado atrás Morningstar: la clase terminó. Sus tres series paran ese día, y el aviso de Amundi
    a los inversores del 01-10-2025 lo dice, con un marcador sin rellenar que obliga a tratarlo como posible borrador; no se ha
    visto un documento de baja de la clase. Ya estaban bloqueadas para compras nuevas desde el 18-10-2026
    (`functions_python/asset_selection_controls.json`, con su sucesor). Lo que no estaba resuelto es **lo que enseña una
    cartera que las lleve**: el coste es el de la clase C, entre 0,55 y 1,00 puntos de más, también en los papeles de cliente;
    las rentabilidades y el riesgo son de hace un año y en la tabla de posiciones del informe interno no llevan fecha; y las
    tablas de la ficha enfrentan el fondo a 11-2025 con su categoría a 10-2026. Medido el 11-11-2026: **14 de las 1.308 series
    del extractor** llevan más de 90 días paradas, cuatro de ellas más de un año; de las otras once no se ha investigado la
    causa, y puede ser un cierre o un fallo del proveedor.

    - **Elegida. A: avisar, para cualquier fondo con la serie parada más de 90 días.** En el informe interno, un punto a
      revisar de severidad alta y la fecha de la cifra en su fila; en Análisis, un aviso; en los papeles de cliente, una nota
      con la fecha y el sucesor si lo hay. Solo toca la aplicación.
    - B: la A, y dar de alta las dos clases A2 para poder sustituir las posiciones. Pide pasar el extractor y una subida a la
      nube con aprobación. Solo merece la pena si alguna cartera real lleva las dos Global Equity.
    - C: retirar sus cifras de rentabilidad, riesgo y coste, con fecha y motivo (§10 del método). La regla de retirada está sin
      construir y los informes de quien las lleve se quedarían con huecos.

    **Lo que no cambia:** no se retira ninguna cifra ni se toca dato alguno, y ninguna serie se empalma con la de su sucesor
    (decisión del 18-10-2026). **Sobre los tres ISIN**, Óscar: «dejalos fuera» (11-11-2026). No se dan de alta las dos clases A2, la
    opción B queda descartada y no se les hace nada especial: siguen bloqueados para compras nuevas y el aviso general les
    alcanza como a cualquier serie parada. No se han retirado del catálogo. **Lo que la decisión no decía.** **La fecha sale de la serie, no del valor liquidativo:** del `last_date`
    del último año de `instruments/{id}/price_series` en la base nueva, que el cliente ya leía. `latest_value_date`, que llega
    con `compare_assets`, es la fecha del último valor liquidativo, y en 11 de las 14 series paradas está a finales de octubre
    de 2026: con ella solo avisarían las tres de Amundi. **Se lee por año, del actual hacia atrás**, documento a documento y
    con un tope de 15 años: la base no admite una consulta ordenada al revés, y la primera versión fallaba contra ella en todas
    las posiciones aunque sus pruebas pasaran. Una serie viva cuesta una lectura. **El sucesor no llega al cliente** (vive en
    `asset_selection_controls.json`, en el servidor) y se dejó fuera para no tocar Functions. **Avisa también una acción o un
    ETF parados**, porque la lectura no distingue tipos. **En el informe de cliente y en el de costes va en la fila** de la
    posición, «Sus datos llegan hasta el 28/11/2025.», y no en una nota aparte; en la comparativa y la propuesta de cambio, en
    las notas, y en un caso justo la comparativa puede pasar de seis hojas a siete. En pantalla no se enseña ni se pide en Modo
    cliente.
    **Estado:** construida el 11-11-2026 por un subagente (`model: opus`, `effort: medium`) en `cf763d94` y `d03d16a0`.
    Dirección la comprobó en local con la base nueva levantada y una cartera de 40 fondos con dos de las clases convertidas:
    Análisis enseña los dos avisos y en Modo cliente ninguno; el informe de cliente (9 hojas) y el de costes (6) llevan la
    fecha en las dos filas; el interno, el punto a revisar de severidad alta y la fecha en las dos filas; sin ninguna serie
    parada, ninguno cambia. Puertas repetidas con las dos bases levantadas: 4.697 pruebas. **Sin comprobar en la nube:** la
    lectura por el SDK con la sesión del asesor solo pasa el typecheck.

## Añadida el 11-11-2026 a las 20:31: Óscar decide para quién son las carteras completas de los ETF que da su emisor («Solo del asesor»)

79. **(B-79) La cartera completa de un ETF que publica su emisor se usa solo en lo que ve el asesor.** Medido el
    11-11-2026: unos 193 fondos y ETF publican solo sus diez mayores posiciones (Morningstar), y la matriz de solapamiento
    dice «N/D» en cada par donde a uno le falta más de la mitad. **Diecinueve son ETF** (14 de iShares, 2 de State Street,
    1 de Vanguard, 1 de Xtrackers y 1 de Amundi), y su emisor publica la cartera entera a diario. Pero los datos del emisor son
    de uso interno para el desarrollo (B-53, cerrada así por Óscar el 09-11), y el informe de cliente lleva solapamiento y
    composición.

    - **Elegida: solo en las vistas del asesor.** La cartera completa del emisor entra en Análisis fuera del Modo cliente y en
      el informe interno. En el informe de cliente, en el Modo cliente y en cualquier papel para el cliente, esos ETF siguen con
      lo que publica el proveedor, y fuera de la matriz si no llega a la mitad.
    - Las otras: levantar la B-53 solo para las carteras, leyendo antes las condiciones de cada emisor, o no traerlas.

    **Lo que obliga.** Cada cartera dice de dónde sale, y la del emisor se guarda **aparte** de `declared/holdings`, para que
    ningún camino de cliente pueda leerla por error. Un ETF sintético (por swap) publica la cesta de garantía, no lo que replica:
    esa cartera no sirve para el solapamiento y no se usa. Los fondos, que son los otros 174, quedan fuera de esta decisión.
    **Estado:** decidida; se construye primero en el extractor y la plataforma, en local, y después en la aplicación.

## Añadida el 12-11-2026 a las 19:49: Óscar deja NH Hotel Group dado de alta a su último precio («Es como único caso excepcional que vamos a dejar»)

80. **(B-80) NH Hotel Group (ES0161560018) se queda en la base valorado a 6,50 € constante, y es el único título así.**
    Hay clientes que lo siguen teniendo en cartera, y el broker lo valora a su último precio. Su baja no cambia (decisión 9:
    sin negociación desde el 15-09-2025 tras la OPA de exclusión de Minor a 6,51 €, `availability.state` DELISTED,
    `bajas_decididas.csv` sin tocar). Lo que cambia es que **se puede tener**: se añade a una cartera, se mide en Análisis y en
    los informes, y su precio se prolonga plano desde su última sesión hasta la fecha de cálculo, sin rentabilidad ni riesgo.

    - **Se reconoce por la política, no por el ISIN:** la marca `PRICE_FROZEN_DELISTED` con un `frozen_price` en
      `fund_history_policies.json`. Hay pruebas que fallan si otro título la lleva, y Ercros sigue dado de baja como estaba.
    - **No entra en Optimizar, el generador ni Mejorar cartera.** Una serie plana parece un activo sin riesgo y el optimizador
      le cargaría peso, aunque no se puede comprar. Lo añadió el escritor y lo comparte Dirección; **confirmado por Óscar
      el 12-11-2026** («Sí, así»).
    - **El valor, 6,50 €**, el último cierre real y el precio del broker. La OPA se liquidó a 6,51 €; se queda en 6,50 €,
      confirmado por Óscar el 12-11-2026.

    **Constatado al aplicarla (12-11-2026).** La aplicación, en `d2ccfcdd` (subagente, `model: opus`): `valorado_a_precio_congelado`
    en `functions_python/asset_eligibility.py`, la exclusión del optimizador en `optimization/repository.py`, y en pantalla
    `src/core/precioCongelado.ts` con el módulo `virtual:precios-congelados` que compila la política; la ficha dice «Sin
    negociación desde el 15/09/2025 · valorado a 6,50 € por decisión». **La serie**, que en la base nueva no estaba: el
    extractor la había bajado el 10-11 de EODHD (`NHH.MC`, `adjusted_close`), pero la búsqueda de EODHD no da identidad a ese
    código, la ficha salía sin nombre y la guarda de calidad la paraba. Arreglado con dos correcciones declaradas en
    `1-extractor/config/correcciones.json` (`b3bcbeb7`, subagente, `model: opus`, `effort: high`): nombre y país, como con
    Árima, Desa y Prisa. 8.426 puntos, del 02-12-1991 al 24-09-2025, que coinciden día a día con los de la base de siempre; la
    última sesión real es el 15-09-2025 a 6,50 €, y del 16 al 24-09 EODHD repite ese precio (siete puntos, no se cortan: valen
    lo mismo que el congelado). **`frozen_price.from` pasa de 2025-09-25 a 2025-09-15**, porque `extend_frozen_price` solo
    prolonga si la serie llega a esa fecha, y la de EODHD acaba el 24-09: con la fecha vieja NH se habría quedado fuera. En la
    base nueva local cambian 4 documentos y se crean 37, todos de NH; fuera de NH, ninguno, comprobado con una foto sha256. Una
    cartera con un 10 % de NH lo mide entero a 3 y 5 años, plano a 6,50 desde el 15-09-2025.

    **Lo que deja abierto.** NH no tiene métricas propias: el listado de EODHD no trae divisa y el extractor no la supone, y la
    tarjeta lo explica mal («falta llevar la serie a euros»). La fecha del precio de la tarjeta es el 24-09-2025, que no fue
    una sesión. Ninguna de las dos cambia la valoración.

    **En producción (12-11-2026).** Subido a la nube con los 37 de B-81 y desplegado por Óscar; comprobado en la web: la ficha, «Añadir
    a cartera» y Análisis con el 100 % del peso. Allí se vio que le saltaba el aviso de B-78, «Serie parada desde el 24/09/2025»,
    y en los papeles de cliente habría dicho «Sus datos llegan hasta el 24/09/2025». Óscar: «Sí, cámbialo». Desde entonces, donde
    iría ese aviso NH lleva la frase de su ficha, «Sin negociación desde el 15/09/2025 · valorado a 6,50 € por decisión», con la
    fecha de la política y no la del último punto (`src/core/serieParada.ts`, `textoSiCongelado`); las demás series paradas siguen
    igual. **Estado:** en producción; la frase nueva, a la espera de publicar el sitio.

## Añadida el 12-11-2026 a las 21:32: Óscar decide traer la réplica de Morningstar a la base nueva («Sí, tráelo»)

81. **(B-81) La réplica que da Morningstar entra en la base nueva, en `product.replication`, y viaja hasta los dos papeles.** Lo que
    lo pidió: un informe de cliente decía que el ETF de bancos de Invesco (IE00B3Q19T94) «no publica al menos la mitad de su
    cartera», y Óscar vio en la web del emisor las 28 posiciones. El ETF es **sintético**: replica su índice con una permuta, y lo
    que enseña Invesco es la exposición al índice que da ese contrato. Morningstar publica una sola línea, el swap, con código
    `ST` al 100 %. Además el mapper solo guarda una cartera si Morningstar da un recuento de acciones o bonos, y un ETF por swap
    no tiene ninguno, así que en la base nueva no había cartera. La app lo contaba como «sin cartera», y la frase de resumen lo
    metía entre los que no publican. El arreglo de la frase (`28886b51`) no llegaba a la web, porque la réplica no estaba en la base.

    - **Elegida: el dato del proveedor, como código.** `PHYSICAL_FULL`, `PHYSICAL_SAMPLING` o `SYNTHETIC`. «NOT Applicable» se queda
      ausente (C-17) y un literal nuevo se anota sin parar la ficha. Medido el 12-11-2026: 37 de 1.334 lo traen; 5 son sintéticos
      (IE00B3Q19T94, IE00B3YCGJ38, LU1681037609, LU1900068161 y LU1900068328). Es dato del proveedor, no del emisor (B-53), así que
      puede ir al papel del cliente.
    - La otra: guardar la cartera aunque falte el recuento, para que la línea del swap llegue. Cambiaba lo que significa ese
      documento, y no explicaba nada que la réplica no explique.

    **Lo que obliga.** El contrato `instrument.v2` admite el campo, y el mapper lo escribe. El servidor lo manda con cada activo
    (`map_asset_detail`, solo la réplica: el resto del bloque de producto sigue sin viajar). La pantalla lo escribe en español
    en la ficha, y el informe de cliente y el interno lo pasan al solapamiento: un ETF sin cartera y con réplica sintética sale
    como «replica su índice con una permuta». No mide lo que comparte por la exposición al índice, que es otra decisión.
    **Estado:** en la base nueva local (37 instrumentos escritos y verificados) y en el código. En la nube desde el 12-11-2026, en la
    subida única con NH, aprobada por Óscar («Sí, súbelos»). El despliegue de las Functions y el del sitio esperan a Óscar.

## Añadida el 16-11-2026 a las 21:40: Óscar aprueba borrar los años que EODHD ha dejado de dar de seis acciones («Sí, bórralos»)

82. **(B-82) Se borran de la base los 33 documentos anuales de serie anteriores al primer dato que EODHD da hoy de seis acciones.**
    Salió en el primer refresco de verdad tras la auditoría integral, el que recalcula la base con la versión 3 del método: el paso
    de series escribió y verificó, pero contó 33 documentos sobrantes y 6 series que no cuadraban, y paró la pasada antes de
    guardar. Es su trabajo: el escritor no borra nunca.

    **Lo medido.** El 10-11 la serie de cada una empezaba antes; hoy la respuesta del propio proveedor —leída de su copia del día,
    sin pasar por el extractor— trae menos filas y ninguna con precio vacío:

    | Acción | ISIN | Empezaba | Empieza hoy | Años que sobran |
    |---|---|---|---|---|
    | HSBC | GB0005405286 | 05-07-1988 | 11-06-1992 | 1988 a 1991 (4) |
    | SSE | GB0007908733 | 18-06-1991 | 01-07-1993 | 1991 y 1992 (2) |
    | AMD | US0079031078 | 17-03-1980 | 05-11-1984 | 1980 a 1983 (4) |
    | Exxon Mobil | US30233Q1085 | 17-03-1980 | 05-11-1984 | 1980 a 1983 (4) |
    | Texas Instruments | US8825081040 | 01-06-1972 | 17-03-1980 | 1972 a 1979 (8) |
    | Xcel Energy | US98389B1008 | 21-02-1973 | 05-11-1984 | 1973 a 1983 (11) |

    El código del extractor no cambió ahí: la versión 3 solo añade el sello del método a la ficha de una acción.

    **Por qué se borran.** Una serie con años que el proveedor ya no sirve no se puede reproducir desde su origen, y dejarlos
    hace que el refresco se pare en ese paso cada vez. Es el caso de IUSQ (B-64), seis veces. **No cambia ninguna cifra
    publicada**: las ventanas llegan como mucho a diez años. Se acorta el gráfico histórico de esas seis.

    **Lo que se descartó.** Conservarlos: la base diría algo que la fuente no dice, y habría que enseñar al paso de series a no
    mirar. Y pedir la historia a otro proveedor: es otra decisión, y no la pide nadie para 1972.

    **Lo que obliga.** Las 33 rutas están en `BORRADOS_APROBADOS`, una a una, con esta decisión. El año en que hoy empieza cada
    serie no está en la lista: se reescribe con lo que hay. Si el proveedor vuelve a dar alguno de esos años, el borrador lo ve en
    el origen y no lo borra. **Estado:** construida en la base local y **en la nube desde el 16-11-2026**: los 33 documentos se borraron en la subida del
    catálogo que Óscar aprobó esa noche («Sí, súbelo»), y el plan en seco de antes decía que eran esos y ninguno más.
