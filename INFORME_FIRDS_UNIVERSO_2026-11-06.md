# Informe: FIRDS como fuente oficial de identidad y universo

*06-11-2026. Respuesta a `ENCARGO_FIRDS_UNIVERSO_2026-11-06.md`, paso 1 de 8 de «Datos del
programa y sus fuentes». Todo lo construido vive en `1-extractor`; no se ha tocado ningún otro
módulo, no se ha escrito en ninguna base, no se ha dado de alta ni cambiado el tipo de ningún
instrumento y no se ha hecho `git push`.*

## Lo esencial

FIRDS funciona y es mejor fuente de identidad de lo que suponía el encargo: el completo de
acciones y vehículos colectivos son **tres ZIP de 15 MB** en total, y el índice local de todo lo
que cotiza en la UE (212.704 instrumentos, 914.528 pares instrumento-centro) se construye en
unos cinco minutos. Ya da por ISIN el **CFI, el LEI del emisor y los centros de negociación**
de 339 de las 342 acciones y ETF del universo (las tres que faltan, en el §4), y una lista de **5.470 candidatos** (1.381
acciones y 4.089 ETF) en los mercados del alcance, de la que salen los 500 y los 300 del previo.

Por el camino aparecieron **dos errores del propio encargo** que habrían metido basura en el
universo sin que nada avisara, y **un ISIN muerto** en el universo actual. Los tres están abajo.

## 1. Qué se construyó

| Fichero | Qué es |
| --- | --- |
| `fetchers/esma_firds.py` (nuevo) | Lista los ficheros del índice Solr de ESMA, descarga los ZIP con su MD5, los recorre en streaming (`iterparse`, sin cargar el XML), construye `cache/firds/firds.sqlite` y aplica los deltas diarios. El adaptador **solo lee** ese índice: no pide nada por ISIN y sirve sin red. Deduce el tipo por CFI y lista candidatos por centro. |
| `core/adquisicion/registro.py` | Adaptador `esma_firds`, oficial, para todos los tipos, `orden=16` (detrás de EODHD). Declara sus diez rutas, todas en `identificacion.*` salvo `meta.firds_visto`. |
| `main.py` | Dos órdenes: `firds` (construye o actualiza el índice; `--isin` consulta sin red; `--sin-deltas`; `--force`) y `universo` (escribe `reports/universo_firds_<fecha>.csv`; `--mercados`, `--tipos`, `--fecha`, `--incluir-bajas`). Ninguna escribe en `config/` ni en el canónico. |
| `tests/test_esma_firds.py` (nuevo, 41 pruebas) | Sin red, con tres XML sintéticos en `tests/fixtures/firds/` (completo E, completo C, delta). Cubren lectura en streaming, tipo por CFI y CFI malformado, filtro de categoría, construcción con delta (alta, modificación, baja, anulación), delta no repetido, MD5 que no cuadra (no deja índice a medias), completo con una parte que falta, procedencia `esma_firds:fulins` en lo que escribe y en nada más, baja en todos frente a baja en uno, baja futura, ausencia, índice inexistente, centros por defecto de segmento, y el comando `universo` (filtros, discrepancia de tipo, bajas, que no toca `config/fondos.csv` ni crea `data/` ni `export/`). |
| `tests/test_capacidades.py` | `esma_firds` entra en la tabla de rutas declaradas y en los seis planes esperados, con el motivo escrito. |

**Lo que escribe el adaptador en el canónico** cuando corra la próxima pasada: `nombre_oficial_firds`,
`nombre_corto_firds`, `cfi`, `cfi_tipo`, `divisa_nominal_firds`, `lei_emisor`,
`autoridad_competente_firds`, `mercados_ue` (lista de `{mic, admision, primera_negociacion, baja}`),
`baja_en_todos_firds` y `meta.firds_visto`. **No escribe** el nombre, la divisa ni el tipo del
sistema, ni `meta.disponibilidad`: los pone al lado para que una discrepancia se vea.

Una diferencia con el encargo: la procedencia es `esma_firds:fulins` y no `esma:firds`, porque el
proyecto ya etiqueta todo como `adaptador:endpoint` y `esma` es el adaptador del registro de
comercialización transfronteriza, otra cosa.

**Pruebas:** `python -m pytest tests -q` pasa entero, **765** (las 724 de antes y 41 nuevas).
`ruff` limpio en los ficheros tocados.

## 2. La medición real

Completo del **31-10-2026** (FULINS_E en dos partes, FULINS_C en una) más **18 deltas** del 01 al
06-11. En total **304 s** en el PC de Óscar y un índice de **137 MB** en `cache/firds/` (fuera de
Git). Los ZIP del completo pesan 7,9 + 3,7 + 3,7 MB; cada delta diario son 4 ficheros de unos
14 MB con 500.000 registros, de los que **menos del 0,3 % son acciones o fondos**: el resto son
derivados y deuda.

**Qué hay dentro, por tipo derivado del CFI:**

| Tipo | Instrumentos | Nota |
| --- | --- | --- |
| ACCION | 21.240 | `ES` 17.342, `ED` (certificados de depósito, ADR) 3.681, resto preferentes y convertibles |
| ESTRUCTURADO | 172.651 | `EY`: certificados alemanes y ETC. **El 89 % de la categoría E** |
| ETF | 8.161 | `CE` |
| FONDO | 10.555 | `CI` 7.816, `CM` 2.150 y otros |
| OTRO | 97 | `EM` |

**Los diez ISIN de control:**

| ISIN | Qué devuelve FIRDS | Centros (vivos) | En el alcance |
| --- | --- | --- | --- |
| `ES0113900J37` Santander | SANTANDER · `ESVUFR` · EUR · LEI `5493006QMFDDMYWIAM13` | 49 | XMAD |
| `DE0005140008` Deutsche Bank | DEUTSCHE BANK AG · `ESVUFR` · EUR · LEI `7LTWFZYICNSX8D621K86` | 52 | XETA |
| `FR0000120271` TotalEnergies | TOTALENERGIES SE · `ESVUFN` · EUR | 47 | XPAR, XBRU |
| `NL0010273215` ASML | ASML HOLD EUR0.09 · `ESVUFN` · EUR | 48 | XAMS |
| `IE00B4L5Y983` iShares Core MSCI World | `CEOGES` (ETF) · **USD** | 41 | XETA, XAMS, ETFP |
| `LU0274208692` Xtrackers MSCI World Swap | `CECGMS` (ETF) · USD | 39 | XETA, ETFP |
| `IE00B3RBWM25` Vanguard FTSE All-World | `CEOIES` (ETF) · USD | 38 | XETA, XAMS, XMSM, XPAR, ETFP |
| `US0378331005` Apple | APPLE INC · `ESVUFR` · USD · LEI `HWUPKR0MPOU8FGXBT394` | 43 | ninguno (solo segmentos de valores extranjeros) |
| `ES0140074008` | **no está**, como se esperaba de un fondo no cotizado | — | — |
| `FR0011158823` Infoclip (baja reciente) | baja en todos sus centros el 05-11-2026 | 0 | — |

Para `DE0005140008`, lo que FIRDS añade al canónico de hoy es el CFI, el LEI y los 52 centros;
el nombre y la divisa coinciden con lo que ya hay. **La divisa nominal de un ETF no es su divisa
de cotización:** el iShares Core MSCI World es USD en FIRDS y cotiza en EUR en Xetra, que es
exactamente por qué `divisa_nominal_firds` no sustituye a `divisa_base`.

## 3. Los dos errores del encargo, corregidos en el código

**3.1 Los MIC de la lista por defecto no existían en FIRDS.** El encargo proponía `XETR` y `XMIL`,
y FIRDS no tiene **ni una fila** con ninguno de los dos: reporta por **segmento**. Xetra es `XETA`
(regulado) y `XETB` (Xetra para valores extranjeros: ahí están Santander, Enel y TotalEnergies);
Borsa Italiana es `MTAA` (acciones) y `ETFP` (ETF). Con la lista del encargo, Alemania e Italia
habrían salido del universo en silencio y en verde. La lista corregida está en
`MIC_POR_DEFECTO` con el motivo escrito, y hay una prueba que falla si alguien vuelve a poner un
MIC de operador.

**3.2 «Toda E es una acción» era falso en el 89 % de los casos.** De 193.988 instrumentos de la
categoría E, 172.651 son `EY`, instrumentos estructurados de participación (los certificados
alemanes y la mayoría de los ETC). Ahora solo cuentan como acción los grupos `S`, `P`, `C`, `F`,
`D` y `L`; `EY` es `ESTRUCTURADO` y `EM` es `OTRO`. El tipo se deduce **al leer**, no al
construir, así que cambiar la regla no obliga a reconstruir el índice.

## 4. El universo de hoy contra FIRDS

De los **1.111** ISIN de `config/fondos.csv`: 475 fondos no están (lo normal: no cotizan), 294
fondos sí (clases admitidas en Luxemburgo o Dublín), y de las acciones y ETF faltan **3**.

**Tipo del sistema frente al tipo del CFI:** coinciden 308 acciones, 29 ETF y 294 fondos. Hay
**dos discrepancias**, y las dos son reales:

| ISIN | Sistema | CFI | Qué es |
| --- | --- | --- | --- |
| `IE00B4ND3602` | etf | `EYAYFT` · ESTRUCTURADO | iShares Physical Gold **ETC**: no es un fondo UCITS sino un instrumento de deuda garantizado con oro. Riesgo de contraparte y régimen distinto |
| `ES0114400007` | accion | `EMXXXR` · OTRO | **Cuotas participativas de la CAM**. FIRDS la tiene vigente en XMAD sin fecha de baja, aunque no negocia desde 2011 |

**Las tres acciones que FIRDS no tiene:**

| ISIN | Qué pasa |
| --- | --- |
| `ES0105046009` Aena | **El ISIN cambió.** FIRDS solo conoce `ES0105046017` (AENA SME ORD SHS). El universo tiene el viejo |
| `ES0143416115` Siemens Gamesa | Excluida en 2023; el completo ya no la lleva |
| `ES0161560018` NH Hoteles | Excluida el 04-09-2026; el completo ya no la lleva |

**Bajas en todos los centros dentro del universo: ninguna.** El completo semanal no arrastra lo
que ya dejó de negociarse; una baja solo aparece como fecha en los deltas de la semana en que
ocurre. Para FIRDS, **la ausencia de un ISIN que estuvo es la señal de baja**, y la presencia sin
fecha de baja **no prueba que cotice** (la CAM). Las dos cosas confirman que la decisión 14 está
bien: la marca de disponibilidad la pone quien da el precio, y FIRDS es evidencia al lado.

## 5. Parte B: el universo de EE. UU., medido y sin construir

| Vía | Qué da | Medido hoy |
| --- | --- | --- |
| SEC `company_tickers.json` | CIK, ticker y nombre. **Sin ISIN** | **HTTP 403**: la SEC exige un `User-Agent` con nombre y correo de contacto, y no lo puse |
| SEC `companyfacts` (fundamentales) | Todas las partidas XBRL de una empresa | Apple: HTTP 200, 3,7 MB, taxonomías `dei` y `us-gaap` (512 conceptos), acciones en circulación 14.532.182.000 al 23-10-2026 del 10-K |
| EODHD `exchange-symbol-list/US` (ya pagado) | Ticker, nombre, bolsa, divisa, tipo **e ISIN** | 50.593 símbolos: 17.504 acciones ordinarias (**11.300 con ISIN, 65 %**), 5.960 ETF; Apple con `US0378331005` |

**Propuesta para el encargo de EE. UU.:** el universo sale de la lista de EODHD (acciones
ordinarias en NYSE y NASDAQ con ISIN); el ticker se casa con el CIK por `company_tickers.json`;
los fundamentales se leen de `companyfacts` por CIK. El LEI de las que cotizan también en Europa
(Apple lo tiene) llega de FIRDS gratis y sirve de control del casado. Falta una decisión tuya
(abajo) para poder llamar a la SEC.

## 6. Decisiones para Óscar

1. **Qué centros forman el alcance.** Recomiendo los once de `MIC_POR_DEFECTO` (XMAD, XETA, XPAR,
   XAMS, XMSM, MTAA, ETFP, XHEL, XBRU, XLIS, XLUX) y **no** `XETB`, que trae como «alemanas» las
   acciones extranjeras que Xetra negocia. Propongo guardarlos en `config/alcance_mercados.json`
   como `mic_firds`, con el motivo; no lo he hecho porque `config/` está bajo bloqueo y es tu
   fichero de decisiones. Si algún día entran Suecia, Dinamarca, Noruega, Austria o Polonia, son
   `XSTO`, `XCSE`, `XOSL`, `XWBO` y `XWAR`.
2. **Si el CFI manda sobre el tipo del sistema cuando discrepan.** Recomiendo que **no** mande
   solo, porque quien reporta a veces se equivoca (FIRDS clasifica como fondo estándar `CI`
   clases que son ETF). Pero las dos discrepancias de hoy son verdad: propongo que el ETC de oro
   pase a un tipo propio (`ETC`) en vez de `etf`, porque su riesgo no es el de un fondo, y que la
   CAM salga del universo de acciones.
3. **Aena.** Sustituir `ES0105046009` por `ES0105046017` en el universo, después de comprobar que
   EODHD sirve la serie con el ISIN nuevo y de decidir qué pasa con la historia anterior al
   cambio (es la misma empresa: la serie debería empalmarse con el ajuste del desdoblamiento).
4. **Refresco.** Recomiendo el **completo semanal** (`python main.py firds --sin-deltas`, el sábado
   por la tarde o el domingo) y no los deltas diarios: el completo de E y C son 15 MB y el delta
   de un solo día ya son 56 MB de los que el 99,7 % no nos sirve. Para identidad, una semana de
   retraso no cambia nada. Los deltas quedan construidos para cuando haga falta detectar una
   baja el mismo día.
5. **Cómo se elige entre los 5.470.** FIRDS dice qué cotiza, no qué importa. Para llegar a 500
   acciones y 300 ETF hace falta un criterio: propongo liquidez (efectivo negociado mediano, que
   ya calcula `core/negociacion.py` con EODHD) y pertenencia a índice para acciones, y patrimonio
   del emisor para ETF. Es el siguiente encargo, y necesita tu criterio de corte.
6. **Identificación ante la SEC.** EDGAR exige un `User-Agent` con un nombre y un correo de
   contacto. Dime qué nombre y qué correo quieres que figuren (uno de la empresa mejor que uno
   personal) y lo pongo en `settings.json`.

## 7. Lo que queda fuera y lo que no he podido verificar

- **La plataforma no lleva todavía estos campos a la base.** Hace falta ampliar
  `2-plataforma-datos/contracts/base-nueva/instrument.v2` con `identifiers.cfi` y una lista
  `listings[]` (MIC, desde, hasta), y poblar `instrument-issuer.v2` con el rol `EQUITY_ISSUER` a
  partir de `lei_emisor`: eso cierra además el hallazgo A-9 de la auditoría (emisor de acciones
  vacío). Es otro encargo, en otro repositorio.
- **El canónico no los tiene aún:** el adaptador está registrado y escribirá en la próxima
  pasada `update`, que no he lanzado.
- **No he comprobado** que los MIC de segmento sean estables en el tiempo ni el detalle de qué
  segmento usa cada bolsa para cada tipo fuera de los once de la lista.
- En `1-extractor/reports/` quedan tres scripts de medición (`_medicion_firds.py`,
  `_mics_firds.py`, `_ausentes_firds.py`) y su salida; esa carpeta no va a Git y se pueden borrar.
