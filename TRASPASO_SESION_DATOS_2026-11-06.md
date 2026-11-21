# Traspaso de la sesión de Datos a la sesión de Code

*06-11-2026, 20:50. Óscar decide seguir con una sola sesión, la de Claude Code del escritorio.
Este fichero recoge todo lo hablado y decidido en la sesión de Chat que trabajó el 05 y el 06 de
noviembre, para que Code lo continúe sin perder nada. Desde ahora la sesión de Code es dueña de
TODOS los territorios de `COORDINACION_SESIONES.md`; las reglas de ese fichero siguen valiendo
(status antes de escribir, commits pequeños, sin push salvo orden, pipeline como cola única).*

## 1. Los documentos que gobiernan, en orden de lectura

| Dónde | Qué es |
| --- | --- |
| `AGENTS.md` | El papel y las reglas. Manda sobre todo lo demás |
| `COORDINACION_SESIONES.md` | Reparto entre sesiones. Ahora todo es de Code, pero las siete reglas siguen |
| Artefacto **«Auditoría Gestor Activos Financieros»** (https://claude.ai/artifact/STvwk98CfswtvamTsJTiAi) | Auditoría del 05-11: qué hay, qué se verificó (7.945 pruebas en verde), 12 riesgos ordenados, opinión y propuesta de modelos |
| Artefacto **«Datos del programa y sus fuentes»** (https://claude.ai/artifact/XnHibqp3EwUhyNMTcBDtDF) | **La hoja de encargo del extractor.** Campo a campo por clase, fuente, grado (oficial / gratuito / licencia / calculado), 15 campos nuevos propuestos y el orden de construcción en 8 pasos. Corregido el 06-11: EODHD no tiene MSCI, FTSE, Russell, ICE BofA, JPM ni iBoxx |
| Project de claude.ai, doc `claude/estado-auditoria-2026-11-05.md` | Resumen de estado que leen las sesiones de Chat. Code no lo necesita |
| `ENCARGO_FIRDS_UNIVERSO_2026-11-06.md` + `INFORME_FIRDS_UNIVERSO_2026-11-06.md` | Paso 1, hecho. El informe lleva 6 decisiones pendientes de Óscar (§6) |

## 2. Lo que Óscar ha decidido (05 y 06-11)

1. **Objetivo:** un **previo** para 4-5 personas que son **desarrolladores con él**, no clientes. Unos
   1.000 fondos, 500 acciones y 300 ETF (hoy 765 / 312 / 30 en `config/fondos.csv`). Después,
   escalable en contenido y usuarios, y lo más barato posible.
2. **Usuario de pago futuro:** asesor o agente con entidad detrás; el programa es independiente y sin
   marca de entidad.
3. **Datos:** habrá licencias, pero el extractor debe exprimir al máximo las fuentes **gratuitas y
   oficiales**. Fundamentales europeos por ESEF y CNMV IPP; ratios calculados por nosotros.
4. **Licencias: no condicionan esta fase.** Es desarrollo, no comercialización; cuando se
   comercialice se cambiará la licencia de EODHD. Esto habilita usar las series de índice de EODHD
   (IBEX 35, STOXX, S&P) para calcular, sin esperar a nadie.
5. **Carteras modelo construidas a partir de clientes reales, pero sin datos personales.** Ningún
   identificador de cliente entra en la base. La importación de extractos de Andbank queda fuera del
   previo o detrás de permiso.
6. **Mercados de acciones:** España, Europa y EE. UU. principalmente; no se descartan otros.
7. **Modelo y esfuerzo por tarea** (Óscar quiere que se le indique en cada tarea): Fable 5.1 para
   decidir, auditar y revisar cifras de cliente; **Opus 5.5 con esfuerzo `medium`** para implementar
   encargos con pruebas; Sonnet 5.5 para lo mecánico; Haiku como subagente de lectura. Subir a
   `high` solo para depurar o tocar fórmulas del método. Empezar cada tarea diciendo «Modelo: X».
8. **Dos sesiones no pueden entrar en conflicto bajo ningún concepto.** De ahí `COORDINACION_SESIONES.md`.

## 3. Pendiente de Óscar (no bloquea el trabajo, pero conviene cerrarlo)

Las seis del §6 de `INFORME_FIRDS_UNIVERSO_2026-11-06.md`: alcance de MIC (recomendado: los 11 de
`esma_firds.MIC_POR_DEFECTO`, sin `XETB`); si el CFI manda sobre el tipo (recomendado: no sin
revisión, pero el ETC de oro `IE00B4ND3602` deja de ser `etf` y la CAM `ES0114400007` sale del
universo); Aena `ES0105046009` → `ES0105046017`; refresco FIRDS semanal con `--sin-deltas`; criterio
para elegir 500 acciones y 300 ETF entre los 5.470 candidatos (recomendado: liquidez e índice para
acciones, patrimonio para ETF); nombre y correo para el `User-Agent` de la SEC.

## 4. El paso 2, a medias: lo medido y lo que toca hacer

**El supuesto del catálogo era falso y se corrigió:** el índice de referencia **ya llega a la base**
(677 fondos y ETF lo declaran, todos vía `morningstar_lt`). Medido el 06-11 sobre `data/funds`:

- 289 de 677 tienen proxy aprobado en `config/indices.csv` (43 %); 231 ya tienen relativas escritas.
- 386 sin proxy, repartidos en **245 índices distintos**. De esos fondos: 282 van contra índices
  replicables, 44 contra tasas, 33 contra compuestos, 15 contra cubiertos, 12 contra una categoría
  Morningstar (no es un índice).
- El KID nombra el índice completo en 310 casos y la marca en 214 más; no coincide en 84.
- EODHD tiene 1.681 índices y **ninguno** de MSCI, FTSE, Russell, ICE BofA, JPM ni iBoxx. Sí IBEX
  (`IBEX`, `IBEXTR`), STOXX (87) y S&P (56).

**Los tres caminos propuestos, y la recomendación: A, luego B, y C ya autorizado por la decisión 4:**

- **A · Proxies nuevos** para los ~15 índices replicables con más fondos. Pasa de 289 a unos 355
  fondos con relativas. Cada proxy lo **aprueba Óscar** fila a fila, como manda `core/indices.py`
  (acumulación, sin cubrir, variante correcta, réplica física, tamaño; nota con quién y cuándo).
- **B · Contrastar el índice de Morningstar con el KID** y dejar evidencia por fondo: confirmado
  completo, confirmado por la marca, no confirmado, o «el KID dice que no tiene índice». No añade
  cifras; hace auditable el índice y quita la dependencia ciega del proveedor. Es ingeniería pura,
  sin decisiones.
- **C · Serie directa de EODHD** para IBEX 35, STOXX y S&P (unos 15 fondos). Requiere una fila en
  `indices.csv` con una clase de serie nueva (`INDICE_EODHD`) y que `vl_fondos._serie_del_proxy`
  sepa pedirla al símbolo de la bolsa `INDX`.

**Estado exacto de A:** candidatos buscados en EODHD y una verificación con la ficha del emisor
(justETF) **lanzada en segundo plano a las 20:46** desde `1-extractor/reports/_verifica_proxies.py`;
su salida cae en `1-extractor/reports/_verifica_proxies.json` y en `%TEMP%\verif.txt`. Si al leer
esto el JSON existe, úsalo; si no, relanza el script (tarda unos minutos, 32 ISIN con pausa). Los
candidatos, con lo que hay que comprobar de cada uno:

| Índice (fondos) | Candidatos | Ojo |
| --- | --- | --- |
| ICE BofA Euro Corporate TR (8) + Markit iBoxx EUR Corp TR (2) | Xtrackers II EUR Corp 1C `LU0478205379` (iBoxx), Vanguard EUR Corp Acc `IE00BGYWT403` (Bloomberg) | Ningún ETF replica ICE BofA: sería un **proxy de índice equivalente de otro proveedor**. Decisión de Óscar |
| JPM EMBI Global Diversified TR USD (7) | Xtrackers II USD EM Bond 2C `LU1920015440`, iShares J.P. Morgan $ EM Bond Acc `IE00BYXYYK40`, Dist `IE00B2NPKV68` | Comprobar que el índice declarado es EMBI Global Diversified |
| JPM GBI-EM Global Diversified TR USD (7) | iShares J.P. Morgan EM Local Govt Bond `IE00B5M4WH52` (Dist), SPDR Bloomberg EM Local `IE00B4613386` | Reparto; índice de otro proveedor en el SPDR |
| MSCI India NR USD (6) | iShares MSCI India Acc `IE00BZCQB185` | Los 3 de «MSCI India 10-40» son otro índice |
| FTSE Gold Mines PR USD (6) | iShares Gold Producers `IE00B6R52036`, VanEck Gold Miners `IE00BQQP9F84` | Ninguno replica FTSE Gold Mines: equivalente de otro proveedor, y variante PR |
| IBEX 35 PR (4) / TR (2) | Amundi IBEX 35 Acc `FR0010655746`; o **camino C** con `IBEX`/`IBEXTR` de EODHD | La variante PR no casa con un ETF de acumulación |
| EURO STOXX 50 NR (3) | iShares Core EURO STOXX 50 Acc `IE00B53L3W79`, UBS Core `LU0950668367`; o camino C | — |
| Euro Agg 1-3Y (3+2) / ICE BofA 1-3Y Govt (3) | Invesco Euro Govt 1-3 `IE00BGJWWY63`, SPDR Bloomberg 1-3Y Euro Govt `IE00B6YX5F63` | «Agg» incluye corporativos; «Govt» no: equivalente, no igual |
| NASDAQ Biotechnology NR (3) | Invesco NASDAQ Biotech `IE00BQ70R696` | — |
| MSCI Brazil 10/40 NR (3) | Amundi MSCI Brazil Acc `LU1900066207`, Xtrackers `LU0292109344` | Replican MSCI Brazil, no la versión 10/40 |
| MSCI EMU Small Cap (2) | iShares MSCI EMU Small Cap Acc `IE00B3VWMM18` | — |
| Russell 1000 Value / Growth (3+3) | Solo ETF de EE. UU. (`US4642875987`, `US92206C6802`), de reparto | Decidir si valen ETF no UCITS como proxy |
| MSCI Europe Value / World Value (3+3) | SPDR `IE00BSPLC306`, `IE00BJXRT813` | Replican «Value Exposure Select», no el Value clásico |
| S&P 500 (TR) (1970) (4) | Ya hay proxy de S&P 500 NR | Es un problema de **normalización** (quitar «(1970)») y de variante TR≠NR |

**Cambios de código que salen de A, independientes de las aprobaciones:** en `core/indices.pliega`
quitar paréntesis con años y los sufijos «Net TR», «Total Return», «Index»; en `indices.csv` admitir
una columna `equivalente_de` para los proxies de índice equivalente, que viaje a la procedencia
para que la ficha diga «medido contra iBoxx EUR Corp, equivalente al ICE BofA declarado».

**Cola larga:** 1-3 fondos por índice en ~200 índices. Sin solución barata; propuesta: quedan sin
relativas y la ficha lo dice (`relative_absence`).

## 5. Los pasos 3 a 8, tal como están en el catálogo

3. **ETF completos**: 9 adaptadores de emisor (Amundi, Xtrackers, Vanguard, SPDR, Invesco, UBS, HSBC,
   WisdomTree, VanEck; iShares existe), NAV histórico del emisor, `series_adjustment` con dividendos.
   Resuelve los 18 ETF sin métricas y abre los 300. El universo sale de `python main.py universo`.
4. **EMT y EET** (plantillas FinDatEx de las gestoras): mercado objetivo MiFID, costes ex ante,
   sostenibilidad. Convierte la idoneidad `PREVIEW_ONLY` en dato oficial.
5. **Fundamentales de EE. UU. y España**: SEC EDGAR `companyfacts` por CIK (necesita `User-Agent`
   con contacto; lista de EODHD `exchange-symbol-list/US` para el ISIN: 11.300 acciones con ISIN) y
   CNMV IPP en XBRL. Doce partidas base por periodo y ratios propios.
6. **Composición de fondos extranjeros**: medir disponibilidad de ficha mensual en las 20 mayores
   gestoras ANTES de escribir el lector; luego `ficha_gestora` e `informe_anual`.
7. **ESEF** (filings.xbrl.org, sin Alemania ni Irlanda, que van por registros nacionales) con Arelle.
8. **Refresco programado e incremental** y retirada de justETF y Yahoo.

Y fuera del extractor, dos encargos que cruzan a `2-plataforma-datos`: ampliar `instrument.v2`
con `identifiers.cfi`, `identifiers.lei` y `listings[]`, y poblar `instrument-issuer.v2` con
`EQUITY_ISSUER` desde `lei_emisor` (cierra el hallazgo A-9).

## 6. Cosas que no hay que redescubrir

- FIRDS reporta por **MIC de segmento** (`XETA`, `MTAA`, `ETFP`): no hay filas en `XETR` ni `XMIL`.
- En el CFI, solo `ES/EP/EC/EF/ED/EL` son acciones; `EY` son estructurados (el 89 % de la categoría).
- El ETC de oro de iShares es `EY`, no un fondo; la CAM figura vigente en FIRDS sin cotizar desde
  2011; Aena cambió de ISIN.
- La búsqueda de EODHD (`get_stocks_from_search`) **no devuelve índices**; la lista de la bolsa
  `INDX` sí (`exchange-symbol-list/INDX`).
- `vl_fondos._escribe_relativas` ya calcula beta, R², alfa, TE e IR cuando hay proxy; no hace falta
  escribir el cálculo, solo alimentarlo.
- Los scripts de medición del 06-11 están en `1-extractor/reports/_*.py` (carpeta fuera de Git):
  `_medicion_firds.py`, `_medicion_indices.py`, `_kid_indice.py`, `_propuesta_proxies.py`,
  `_verifica_proxies.py`. Se pueden relanzar o borrar.
- El entorno Linux del enlace de Chat no ejecuta los `node_modules` de Windows; en Code no pasa.
