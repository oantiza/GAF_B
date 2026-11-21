"""Métricas de un fondo calculadas desde su serie de valores liquidativos.

Fase 0 del plan «fondos sin Morningstar» (28-10-2026): rentabilidad,
volatilidad, Sharpe y caída máxima dejan de venir de Morningstar y se calculan
aquí, sin red, desde la serie diaria de VL (EODHD). Las convenciones son las
de la industria para que el contraste con Morningstar sea homogéneo:

- Rentabilidad a plazo (1, 3 y 6 meses, en lo que va de año y 1 año):
  acumulada. A 3, 5 y 10 años: anualizada, (VL final / VL inicial)^(1/N) - 1.
  El VL inicial es el último publicado en o antes de la fecha objetivo, y
  como mucho 10 días antes de ella; si la serie no llega, el plazo no se
  publica.
- Año natural: del último VL de diciembre del año anterior al último VL de
  diciembre del año. Solo años completos, los 10 más recientes.
- Volatilidad y Sharpe: rentabilidades MENSUALES (último VL de cada mes) de
  los 12, 36 o 60 meses que acaban en el último mes completo de la serie.
  Volatilidad = desviación típica muestral x raíz(12). Sharpe = media del
  exceso mensual sobre el €STR x 12 / (desviación típica del exceso x
  raíz(12)). Sin €STR para todos los meses de la ventana, sin Sharpe.
- Caída máxima: peor caída desde un máximo con VL diarios, ventana de 3 años.

## Versión 3 del método (decisiones A-158 y A-166 de Óscar, 16-11-2026)

Tres cosas cambian a la vez, y por eso cambia la versión (`VERSION_METODO`):

- **El tipo sin riesgo de cada mes capitaliza con su base de días** (`rf_entre`). Antes era
  la media del €STR del mes entre 12: ni capitalizaba ni usaba act/360, y un fondo que
  devengaba exactamente el €STR salía con un Sharpe de 0,80 a 1,07. Ahora es lo que rinde
  el €STR entre las dos fechas de los valores liquidativos con que se mide el mes.
- **La volatilidad diaria se anualiza con las observaciones que hay** (`metricas_diarias`),
  no con 252 fijos: un valor que cotiza 180 sesiones al año salía un 18 % más volátil.
- **Un dato suelto que salta y vuelve se descarta con aviso** (`sin_picos`) y no corta la
  serie: la regla de rupturas solo corta en el cambio de nivel que persiste.

## Versión 4 del método (MET-6 y MET-7 de la auditoría integral, 17-11-2026)

Dos cosas cambian a la vez, y por eso cambia otra vez la versión:

- **Un cierre de mes es de verdad del final del mes** (`es_cierre_de_mes`). Hasta la 3, el
  «fin de mes» era el último valor del mes, fuera del día que fuera: con un hueco de datos, el
  día 3 de mayo hacía de cierre de mayo. Ahora, si tras el último valor quedan en el mes más de
  `CIERRE_LABORABLES_MAX` días de lunes a viernes, ese mes no tiene cierre, y la ventana que lo
  necesita no se publica, como la que tiene un hueco. Vale para el riesgo, las relativas y los
  diciembres del año natural.
- **El año natural aplica la regla del hueco** de las ventanas (`HUECO_MAXIMO_DIAS`).
- **En el método mensual, el hueco es de más de 33 días** y no de 31 (`HUECO_MAXIMO_DIAS`; Óscar,
  17-11-2026): dos cierres de mes seguidos pueden separarse 33 días. El diario sigue en 31
  (`HUECO_MAXIMO_DIAS_DIARIO`).
- **Las relativas cierran en el mismo mes que el riesgo, o no se dan** (`relativas` con `fin`):
  si el índice no llega a ese cierre, no se miden un mes antes.

## La misma métrica tiene dos puertas, y hay que saberlo

Volatilidad y Sharpe se calculan aquí de **dos maneras**, según el activo, y
las dos puertas de entrada no son equivalentes:

- **Fondos** (`riesgo`): retornos MENSUALES. Exige 13, 37 o 61 cierres de mes
  **consecutivos**; un hueco de un mes tumba la ventana entera, por larga que
  sea la serie.
- **Acciones y ETF cotizados** (`metricas_diarias`): retornos DIARIOS. Exige
  `max(60, años * 180)` observaciones, es decir 180, 540 y 900, y **no** mira
  si están repartidas: cuenta cuántas hay.

Eso significa que un mismo activo puede tener cifra por un camino y no tenerla
por el otro. Medido el 02-11-2026 con CEVASA (`ES0132955008`), que cotiza en el
46-63 % de los días hábiles: por el camino diario no publica nada —159
observaciones frente a 180 a un año, 391 frente a 540 a tres, 585 frente a 900
a cinco— mientras que `riesgo`, sobre esa misma serie, da 17,71 / 28,24 / 25,36.

**Cuál de las dos puertas es la correcta no lo decide este módulo**, pero el
02-11-2026 se midió, sobre las 306 acciones del alcance —301 con serie—, con
`tools/mide_dos_puertas.py`, que no reimplementa las puertas sino que se las
pregunta al código que corre. Cambian **7 de 301**, y las 7 a favor de la
cobertura:

- **Gana 1:** CEVASA, que tiene cinco años seguidos de cotización y hoy no
  publica nada.
- **Pierden 6, y ninguna de esas seis cifras debería estar publicada.** Cuatro
  llevan la etiqueta de una ventana que su serie no cubre, porque un umbral que
  cuenta observaciones lo satisface una serie corta y densa: Puig cubre 2,49
  años bajo «3 años», GE Vernova 2,59, MFE 4,87 bajo «5 años» y Daimler Truck
  4,88. Las otras dos se calculan **a través de un parón**: Ezentis estuvo doce
  meses sin cotizar en 2023 e Innovative Solutions dos.
- Y las tres que de verdad son jóvenes —TSK, DIGI y SpaceX, de 77 a 123
  cotizaciones— las rechazan las dos puertas. Ahí el umbral de hoy acierta.

Lo que la cobertura **no** trae y habría que añadirle: un suelo de
observaciones. Hoy no hace falta —la cifra más floja que admitiría son las 159
de CEVASA y la siguiente son 251—, pero la regla, tal cual, no lo impide.

Todo en porcentaje (2.5 = 2,5 %), redondeado a 4 decimales. Las métricas se
fechan a cierre de mes (`cierre_mensual`), como las de las fichas comerciales y
las de categoría e índice que siguen viniendo de Morningstar; el VL, en cambio,
es el último publicado. Todo va en la divisa de la clase, como el VL; `a_eur`
pasa una serie a EUR con los cambios del BCE para quien quiera esa vista (las
fichas no la usan: ver `fetchers.vl_fondos`).
"""
from __future__ import annotations

import bisect
import math
import statistics
from datetime import date, timedelta
from typing import Iterable

#: La versión del método con que se calcula todo lo de este módulo. Viaja en la ficha
#: (`riesgo.historial_precios.metodo`, con `sello_del_metodo`) y la plataforma sella con ella
#: `inputs.method`: `EXTRACTOR_MONTHLY_V4` y `EXTRACTOR_DAILY_V4`. Cambiar un parámetro la
#: cambia (§4 de `METODO_PROPIO_METRICAS_2026-11-01.md`); la 3 es de las decisiones A-158 y
#: A-166 del 16-11-2026, y la 4, de MET-6 y MET-7 de la auditoría integral (17-11-2026).
VERSION_METODO = 4


def sello_del_metodo(detalle: str) -> str:
    """`core.metricas v4: <detalle>`. Lo que la ficha dice de con qué versión se calculó."""
    return f"core.metricas v{VERSION_METODO}: {detalle}"


TOLERANCIA_INICIO_DIAS = 10
#: Cuantos dias seguidos sin un solo punto admite una ventana (decision 111 de Oscar, 05-11-2026). Con mas, esa ventana no se
#: publica, sea la cifra que sea: la caida de AB American Growth a 5 anios solo media desde el final de un hueco de 4 anios.
#:
#: No es la tolerancia de inicio, y se midio antes de fijarlo, sobre las ventanas publicadas ese dia. Con 10 dias caian 43
#: instrumentos. De los 26 que solo caen entre 11 y 14 dias, unos 15 son fondos de Asia cuyas fechas coinciden con el Anio Nuevo
#: lunar o la Semana Dorada (coincidencia de fechas, no contrastada con un calendario). Con 14 caen 17, y con 31, 14: los huecos
#: que quedan por encima van de 32 dias a casi 7 anios. Son 31 porque el metodo mide por meses: el mes mas largo es lo que separa
#: dos cierres de mes seguidos, y un fondo que publique una vez al mes no tiene ningun hueco. La tabla entera esta en el metodo, par. 2.
#:
#: Solo quita ventanas: lo que queda sale igual, asi que no cambia la version del metodo (par. 7 y 10 de ese documento).
#:
#: **En el metodo mensual son 33 desde la version 4** (Oscar, 17-11-2026). Lo de arriba no era exacto: dos cierres de mes
#: seguidos, cada uno en su ultimo laborable, pueden separarse 33 dias -del viernes 28-11-2025, con el 29 y el 30 en fin de
#: semana, al miercoles 31-12-2025-, y con 31 un fondo que publica una vez al mes tenia «huecos». Medido el 17-11-2026 sobre la
#: exportacion: solo le costaba algo a Brightgate Focus, los anios naturales 2016 y 2017 (32 dias entre dos cierres).
HUECO_MAXIMO_DIAS = 33
#: El camino diario sigue en 31, la decision 111 tal cual. El argumento de los 33 es de cierres de mes, y en una accion un tramo
#: de 32 dias es un mes sin cotizar: con 33, Cementos Molins (32 dias sin cotizar) recuperaria su volatilidad a 5 anios, y la
#: decision 111 la dejo fuera sabiendolo. Tambien es el de los huecos que se rellenan con Morningstar (`serie_de_respaldo`).
HUECO_MAXIMO_DIAS_DIARIO = 31
PLAZOS_ACUMULADOS = (("1m", 1), ("3m", 3), ("6m", 6), ("1a", 12))
PLAZOS_ANUALIZADOS = (("3a_anualizada", 3), ("5a_anualizada", 5), ("10a_anualizada", 10))
#: Las ventanas del riesgo mensual. La de 10 años entra el 02-11-2026: el contrato de
#: `computed/metrics` declaraba `volatility.10y`, `sharpe.10y` y `sortino.10y` desde el
#: primer día y aquí no existía la ventana, así que figuraban ausentes en los 1.077
#: instrumentos. No cambia ninguna cifra ya publicada: añade una ventana que antes no se
#: calculaba, y la exigencia de 121 cierres de mes consecutivos la deja ausente -por serie
#: corta, que es una ausencia honesta- en la mayoría.
VENTANAS_RIESGO = (("1a", 12), ("3a", 36), ("5a", 60), ("10a", 120))
ANOS_NATURALES = 10
VENTANA_DRAWDOWN_ANOS = 3

Serie = list[tuple[date, float]]


def _r(v: float | None, n: int = 4) -> float | None:
    if v is None or not math.isfinite(v):
        return None
    return round(v, n)


def normaliza(puntos: Iterable[tuple[date, float]]) -> Serie:
    """Ascendente, sin fechas repetidas (gana la última) y solo precios > 0."""
    por_fecha: dict[date, float] = {}
    for f, p in puntos:
        if isinstance(f, date) and isinstance(p, (int, float)) and not isinstance(p, bool) \
                and math.isfinite(p) and p > 0:
            por_fecha[f] = float(p)
    return sorted(por_fecha.items())


def resta_meses(d: date, meses: int) -> date:
    """Misma fecha `meses` antes; el día 31 cae en el último del mes destino."""
    total = d.year * 12 + (d.month - 1) - meses
    ano, mes = divmod(total, 12)
    mes += 1
    return date(ano, mes, min(d.day, ultimo_dia(date(ano, mes, 1)).day))


def ultimo_dia(d: date) -> date:
    return date(d.year + (d.month == 12), d.month % 12 + 1, 1) - timedelta(days=1)


def precio_en(serie: Serie, objetivo: date, tolerancia: int = TOLERANCIA_INICIO_DIAS) -> tuple[date, float] | None:
    """Último VL en o antes de `objetivo`, si no es más viejo que `tolerancia` días."""
    elegido = None
    for f, p in serie:
        if f > objetivo:
            break
        elegido = (f, p)
    if elegido is None or (objetivo - elegido[0]).days > tolerancia:
        return None
    return elegido


def hueco_en_ventana(serie: Serie, inicio: date, fin: date | None = None,
                     maximo: int = HUECO_MAXIMO_DIAS) -> tuple[date, date] | None:
    """El tramo mas largo sin puntos dentro de la ventana, si pasa de `maximo`; `None` si no hay ninguno.

    Cuenta desde el ultimo punto en o antes de `inicio`: un hueco que atraviesa el principio de la ventana tambien deja sin medir
    su arranque. Que la serie empiece despues de `inicio` no es un hueco, es que no llega, y eso lo dice cada cifra por su lado."""
    peor, tramo, anterior = maximo, None, None
    for f, _p in serie:
        if fin is not None and f > fin:
            break
        if anterior is not None and f > inicio and (f - anterior).days > peor:
            peor, tramo = (f - anterior).days, (anterior, f)
        anterior = f
    return tramo


#: Cuántos días de lunes a viernes pueden quedar en el mes después de su último valor para que
#: ese valor sea su cierre (versión 4, MET-7). Hasta la 3 no había límite: el último valor del
#: mes era su cierre aunque fuera del día 3. Con más de estos, el mes no tiene cierre y la ventana
#: que lo necesita no se publica.
#:
#: Son 5, una semana laborable, y es la más corta que se defiende con lo medido el 17-11-2026 sobre
#: los cierres de los últimos diez años de las series exportadas (88.082 cierres de fondos y ETF).
#: El 96,4 % cae en el último día laborable y el 3,3 % deja uno, que es un festivo (Viernes Santo,
#: el 31 de diciembre, el último lunes de agosto en Londres). Dejan dos el Jueves y el Viernes Santo
#: de los fondos españoles o Acción de Gracias con su viernes; de tres a cinco, el Año Nuevo lunar
#: en los fondos de Asia (enero de 2025: las bolsas de China y Hong Kong cerradas del 28 o el 29 al
#: 31) y los fondos que valoran una vez por semana. En esos casos no hay otro valor del mes, ni
#: mercado que lo hubiera movido, y ese valor ES su cierre. La volatilidad a tres años la perdían
#: 25 fondos con 2, casi todos de Asia y emergentes por enero de 2025; 11 con 3; 5 con 4, y 1 con 5.
#:
#: Lo que queda por encima, en 15 fondos, son de 6 a 13 laborables, y a 7 les cuesta alguna cifra:
#: huecos de datos, salvo uno. Un «cierre» del día 5 deja unos 18 y cae de lleno. El que la regla
#: trata mal es el fondo de Taiwán de JPMorgan: su bolsa cerró del 23 al 31 de enero de 2025 y deja 7.
#: **Confirmada por Óscar el 17-11-2026.**
CIERRE_LABORABLES_MAX = 5


def laborables_tras(f: date) -> int:
    """Días de lunes a viernes que quedan en el mes de `f` después de `f`. No mira festivos: no
    tenemos el calendario de cada fondo, y por eso la tolerancia admite una semana laborable."""
    fin = ultimo_dia(f)
    return sum(1 for i in range(1, (fin - f).days + 1) if (f + timedelta(days=i)).weekday() < 5)


def es_cierre_de_mes(f: date) -> bool:
    """Si un valor del día `f` puede ser el cierre de su mes (versión 4, MET-7)."""
    return laborables_tras(f) <= CIERRE_LABORABLES_MAX


def cierre_mensual(serie: Serie) -> date | None:
    """Último fin de mes cerrado de la serie: el del mes del último VL si tras él
    no quedan días laborables en el mes (VL del viernes 30 con el 31 en sábado),
    y si no, el del mes anterior."""
    if not serie:
        return None
    ultimo = serie[-1][0]
    fin = ultimo_dia(ultimo)
    quedan = [ultimo + timedelta(days=i) for i in range(1, (fin - ultimo).days + 1)]
    if all(d.weekday() >= 5 for d in quedan):
        return fin
    return ultimo_dia(ultimo.replace(day=1) - timedelta(days=1))


TOLERANCIA_CAMBIO_DIAS = 7   # el BCE no publica en sus festivos (TARGET)


def a_eur(serie: Serie, cambios: list[tuple[date, float]],
          tolerancia: int = TOLERANCIA_CAMBIO_DIAS) -> Serie:
    """Serie en divisa X -> en EUR, con cambios del BCE en unidades de X por 1 EUR
    (EXR D.X.EUR.SP00.A). Cada VL usa el último cambio en o antes de su fecha y
    no más viejo que `tolerancia` días; sin cambio, el punto se descarta."""
    if not cambios:
        return []
    cambios = sorted(cambios)
    out, i, actual = [], 0, None
    for f, p in serie:
        while i < len(cambios) and cambios[i][0] <= f:
            actual = cambios[i]
            i += 1
        if actual and actual[1] > 0 and (f - actual[0]).days <= tolerancia:
            out.append((f, p / actual[1]))
    return out


RUPTURA_FACTOR = 2.0   # un VL que se multiplica o se divide por más de 2 de un día a otro
#: Cuánto puede separarse el valor que sigue a un pico del que lo precede para decir que la
#: serie «ha vuelto». Es el mismo factor de la ruptura, a propósito: un pico es el punto que,
#: quitado, deja una serie sin ruptura. La decisión A-166 dice «salta y vuelve» sin fijar la
#: tolerancia, y el único caso medido (Carmignac Investissement, 10-01-2013) vuelve a un 0,9 %
#: de donde estaba; tiene nombre propio para poder estrecharla sin tocar la regla del corte.
PICO_VUELTA_FACTOR = RUPTURA_FACTOR


def _salta(anterior: float, valor: float, factor: float) -> bool:
    r = valor / anterior
    return r > factor or r < 1 / factor


def sin_picos(serie: Serie, factor: float = RUPTURA_FACTOR,
              vuelta: float = PICO_VUELTA_FACTOR) -> tuple[Serie, list[dict]]:
    """(serie sin los datos sueltos que saltan y vuelven, esos datos).

    Decisión A-166 de Óscar (16-11-2026), ante MET-2. Un pico es UN punto B entre A y C tal
    que A→B es una ruptura, B→C es otra, y de A a C no hay ruptura: la serie ha vuelto a su
    nivel. Carmignac Portfolio Investissement A EUR Acc pasó de 79,2 a 905,2 y a 78,5 el
    10-01-2013: con la regla de antes, ese dato cortaba la serie y borraba toda la historia
    anterior. Ahora se quita el dato y se dice (`fecha`, `valor`, `anterior`, `siguiente`).

    Lo que NO es un pico, y sigue cortando: el cambio de nivel que persiste (de A a C sigue
    habiendo ruptura), y el salto en el ÚLTIMO dato de la serie, que todavía no ha vuelto y
    no se puede distinguir de un cambio de unidad hasta que llegue el siguiente."""
    limpia: Serie = []
    picos: list[dict] = []
    i, n = 0, len(serie)
    while i < n:
        f, p = serie[i]
        if limpia and i + 1 < n:
            a, c = limpia[-1][1], serie[i + 1][1]
            if _salta(a, p, factor) and _salta(p, c, factor) and not _salta(a, c, vuelta):
                picos.append({"fecha": f.isoformat(), "valor": p, "anterior": a, "siguiente": c})
                i += 1
                continue
        limpia.append((f, p))
        i += 1
    return limpia, picos


def tramo_sin_rupturas(serie: Serie, factor: float = RUPTURA_FACTOR) -> tuple[Serie, date | None]:
    """(tramo desde la última ruptura, fecha de la ruptura o None).

    Una ruptura es un salto de un VL al siguiente mayor que `factor` en
    cualquier sentido: cambio de unidad de la clase (BL-Global 75, de 3.091 a
    102,8 el 16-07-2021), redenominación a euros de 1999 (francos: -84,8 %) o
    un error de la fuente. Ningún fondo UCITS se mueve así de un día a otro; si
    alguna vez es real (una suspensión que se revaloriza), el aviso lo dice.
    Las métricas solo se calculan con el tramo posterior.

    Antes de buscar el corte se quitan los picos (`sin_picos`): un dato suelto que salta y
    vuelve no es un cambio de nivel, y el tramo que se devuelve ya no lo lleva. Quien tenga
    que decirlo en la ficha llama además a `sin_picos`, que da la lista."""
    serie, _picos = sin_picos(serie, factor)
    corte = None
    for i in range(1, len(serie)):
        if _salta(serie[i - 1][1], serie[i][1], factor):
            corte = i
    if corte is None:
        return serie, None
    return serie[corte:], serie[corte][0]


def recorta(serie: Serie, fin: date | None) -> Serie:
    return serie if fin is None else [(f, p) for f, p in serie if f <= fin]


# ------------------------------------------------------------- rentabilidad
def _inicio(ref: date, meses: int) -> date:
    """Fecha de arranque de un plazo. A cierre de mes, el cierre del mes de
    arranque: el 1 mes a 30-09 empieza el 31-08, no el 30-08 (contraste del
    28-10: con el 30, el VL de partida era el del viernes 28-08)."""
    inicio = resta_meses(ref, meses)
    return ultimo_dia(inicio) if ref == ultimo_dia(ref) else inicio


def rentabilidades(serie: Serie, fin: date | None = None) -> dict[str, float]:
    """Rentabilidades a plazo, en porcentaje, a la fecha del último VL (o `fin`)."""
    s = recorta(serie, fin)
    if len(s) < 2:
        return {}
    f1, p1 = s[-1]
    ref = fin or f1
    out: dict[str, float] = {}
    def arranque(objetivo: date) -> tuple[date, float] | None:
        ini = precio_en(s, objetivo)
        return ini if ini and ini[0] < f1 and not hueco_en_ventana(s, ini[0]) else None

    for clave, meses in PLAZOS_ACUMULADOS:
        ini = arranque(_inicio(ref, meses))
        if ini:
            out[clave] = _r((p1 / ini[1] - 1) * 100)
    ini = arranque(date(ref.year - 1, 12, 31))
    if ini:
        out["ytd"] = _r((p1 / ini[1] - 1) * 100)
    for clave, anos in PLAZOS_ANUALIZADOS:
        ini = arranque(_inicio(ref, anos * 12))
        if ini:
            out[clave] = _r(((p1 / ini[1]) ** (1 / anos) - 1) * 100)
    return {k: v for k, v in out.items() if v is not None}


def por_ano_natural(serie: Serie, fin: date | None = None,
                    maximo: int = ANOS_NATURALES) -> dict[str, float]:
    """{'2025': 12.3, ...}: años naturales completos, los `maximo` más recientes.

    Versión 4 (MET-7): los dos diciembres son cierres de mes como los del riesgo
    (`es_cierre_de_mes`, antes 10 días naturales de tolerancia), y el año con un hueco de más de
    `HUECO_MAXIMO_DIAS` no se publica, como una ventana: su rentabilidad no mide el año."""
    s = recorta(serie, fin)
    if len(s) < 2:
        return {}
    cierre: dict[int, tuple[date, float]] = {}
    for f, p in s:
        if f.month == 12:
            cierre[f.year] = (f, p)           # el último de diciembre gana
    out = {}
    for ano in sorted(cierre, reverse=True):
        previo = cierre.get(ano - 1)
        if not previo:
            continue
        # El de diciembre del año en curso tampoco es un cierre: queda mes por delante.
        if not es_cierre_de_mes(previo[0]) or not es_cierre_de_mes(cierre[ano][0]):
            continue
        if hueco_en_ventana(s, previo[0], cierre[ano][0]):
            continue
        v = _r((cierre[ano][1] / previo[1] - 1) * 100)
        if v is not None:
            out[str(ano)] = v
        if len(out) >= maximo:
            break
    return dict(sorted(out.items()))


# ------------------------------------------------------------------ riesgo
def fin_de_mes(serie: Serie, incluir_ultimo: bool = False) -> list[tuple[date, float]]:
    """Último VL de cada mes completo. El mes del último VL se excluye (está a
    medias) salvo `incluir_ultimo`, que lo da por cerrado.

    Versión 4 (MET-7): el mes cuyo último VL no es de su final (`es_cierre_de_mes`) no está en
    la lista. No se sustituye por nada: le falta el cierre, y la ventana que lo necesita deja de
    tener sus meses consecutivos."""
    if not serie:
        return []
    ultimo = serie[-1][0]
    por_mes: dict[tuple[int, int], tuple[date, float]] = {}
    for f, p in serie:
        if not incluir_ultimo and (f.year, f.month) == (ultimo.year, ultimo.month):
            continue
        por_mes[(f.year, f.month)] = (f, p)
    return [por_mes[k] for k in sorted(por_mes) if es_cierre_de_mes(por_mes[k][0])]


def meses_sin_cierre(serie: Serie, fin: date) -> list[dict]:
    """Los meses de las ventanas del riesgo que acaban en `fin` cuyo último valor no es de su
    final, con las ventanas que pierden (versión 4, MET-7). Es lo que la ficha dice para que una
    ventana que falta por esto no se lea como una serie que no llega.

    Solo los meses con algún valor: un mes vacío es un hueco, y eso lo dice `huecos_por_ventana`."""
    s = recorta(serie, fin)
    if not s:
        return []
    ultimos: dict[tuple[int, int], date] = {}
    for f, _p in s:
        ultimos[(f.year, f.month)] = f
    fin_mes = fin.year * 12 + fin.month - 1
    primero = fin_mes - (s[0][0].year * 12 + s[0][0].month - 1)   # cuántos meses atrás llega la serie
    salida = []
    for (ano, mes), f in sorted(ultimos.items()):
        if es_cierre_de_mes(f):
            continue
        atras = fin_mes - (ano * 12 + mes - 1)
        # Una ventana de n meses usa los cierres de los n + 1 meses que acaban en `fin`; la que
        # la serie no alcanza no se pierde por esto, y no se nombra.
        ventanas = [clave for clave, n in VENTANAS_RIESGO if atras <= n <= primero]
        if ventanas:
            salida.append({"mes": f"{ano:04d}-{mes:02d}", "ultimo_dato": f.isoformat(),
                           "laborables_despues": laborables_tras(f), "ventanas": ventanas})
    return salida


def _consecutivos(meses: list[tuple[int, int]]) -> bool:
    return all((b[0] * 12 + b[1]) - (a[0] * 12 + a[1]) == 1 for a, b in zip(meses, meses[1:]))


#: Base de días del €STR: act/360, la del mercado monetario del euro. Con ella lo publica
#: el BCE y con ella capitaliza su índice compuesto.
BASE_DIAS_RF = 360
#: Días naturales que un €STR puede seguir valiendo sin otro posterior. El BCE no lo publica
#: en fin de semana ni en los cierres de TARGET, y el hueco más largo del calendario son cuatro
#: noches tras el dato del Jueves Santo; son 7 por lo mismo que `TOLERANCIA_CAMBIO_DIAS`, que
#: lee del mismo BCE. Con un tipo más viejo que eso, ese tramo no tiene tipo y no hay Sharpe:
#: no se arrastra un €STR de hace un mes como si fuera el de hoy.
RF_ARRASTRE_MAX_DIAS = 7
#: Por debajo de esto, una desviación típica mensual es cero para una máquina: es el ruido de
#: sumar en coma flotante, no un riesgo. La §3 del método dice que el Sharpe solo falta con la
#: volatilidad EXACTAMENTE cero, y esto es lo que «exactamente» puede significar en un cálculo:
#: un fondo que devenga justo el €STR da un exceso de 1e-17, no de 0. Ningún fondo real se
#: acerca: un valor liquidativo con seis decimales ya mueve la rentabilidad mensual en 1e-8.
DESVIACION_NULA = 1e-12


def _tipos(estr: list[tuple[date, float]]) -> tuple[list[date], list[float]]:
    """El €STR ordenado y partido en fechas y valores, para buscar por fecha sin recorrerlo."""
    orden = sorted(estr)
    return [f for f, _v in orden], [v for _f, v in orden]


def _rf_entre(tipos: tuple[list[date], list[float]], desde: date, hasta: date) -> float | None:
    fechas, valores = tipos
    if hasta <= desde:
        return None
    i = bisect.bisect_right(fechas, desde) - 1
    if i < 0:
        return None                      # el €STR empieza después: esa noche no tiene tipo
    factor, d = 1.0, desde
    while d < hasta:
        fin = min(fechas[i + 1], hasta) if i + 1 < len(fechas) else hasta
        if (fin - timedelta(days=1) - fechas[i]).days > RF_ARRASTRE_MAX_DIAS:
            return None                  # un tipo demasiado viejo para la noche que cubriría
        factor *= 1 + valores[i] / 100 * (fin - d).days / BASE_DIAS_RF
        d, i = fin, i + 1
    return factor - 1


def rf_entre(estr: list[tuple[date, float]], desde: date, hasta: date) -> float | None:
    """Lo que rinde el €STR de `desde` a `hasta`, capitalizado y en fracción. `None` sin tipo.

    Decisión A-158 de Óscar (16-11-2026), ante MET-1. El €STR es un tipo a un día en base
    act/360: el de la fecha T se devenga de T al siguiente día con dato, así que el del viernes
    cuenta tres noches, y cada tramo capitaliza sobre el anterior:

        Π (1 + tipo_T / 100 × días_T / 360) − 1

    Es la convención del índice compuesto del BCE. Se mide entre las DOS FECHAS de los valores
    liquidativos del mes y no sobre el mes natural, para restar al fondo lo que el €STR rindió
    en sus mismos días: un fondo que devenga exactamente el €STR da un exceso de cero cada mes.

    Antes (`rf_mensual`, hasta la versión 2) era la media del €STR del mes entre 12: sin
    capitalizar, en base 30/360 de hecho, y sin mirar cuántos días separaban los dos valores.
    A ese fondo le salía un Sharpe de 0,80 a 1,07 con un exceso que no existía.

    Cada noche usa el último €STR publicado en o antes de ella, con `RF_ARRASTRE_MAX_DIAS` de
    margen. Si a alguna le falta, el tramo no tiene tipo: no se rellena hacia atrás."""
    return _rf_entre(_tipos(estr), desde, hasta)


def riesgo(serie: Serie, estr: list[tuple[date, float]] | None = None,
           fin: date | None = None) -> dict:
    """{'fecha': fin de mes, '1a': {'volatilidad', 'sharpe', 'rf'}, ...}.

    Con `fin` (el contraste a la fecha de otra fuente), el mes de `fin` cuenta
    como cerrado si `fin` es su último día natural, que es como fechan los
    datos de fin de mes."""
    s = recorta(serie, fin)
    cerrado = fin is not None and (fin + timedelta(days=1)).month != fin.month
    mensual = fin_de_mes(s, incluir_ultimo=cerrado)
    if len(mensual) < 2:
        return {}
    tipos = _tipos(estr) if estr else None
    out: dict = {"fecha": ultimo_dia(mensual[-1][0]).isoformat()}
    for clave, n in VENTANAS_RIESGO:
        if len(mensual) < n + 1:
            continue
        tramo = mensual[-(n + 1):]
        claves_mes = [(f.year, f.month) for f, _p in tramo]
        if not _consecutivos(claves_mes) or hueco_en_ventana(s, tramo[0][0]):
            continue
        rets = [b[1] / a[1] - 1 for a, b in zip(tramo, tramo[1:])]
        vol = statistics.stdev(rets) * math.sqrt(12) * 100
        datos = {"volatilidad": _r(vol)}
        if tipos:
            # El tipo de cada mes, entre las mismas dos fechas que su rentabilidad (A-158).
            rfs = [_rf_entre(tipos, a[0], b[0]) for a, b in zip(tramo, tramo[1:])]
            if all(x is not None for x in rfs):
                exceso = [r - rf for r, rf in zip(rets, rfs)]
                sd = statistics.stdev(exceso)
                if sd > DESVIACION_NULA:
                    datos["sharpe"] = _r(statistics.fmean(exceso) * 12 / (sd * math.sqrt(12)))
                # Sortino: el mismo numerador que el Sharpe y otro denominador. Entra el
                # 02-11-2026, con el 10a, porque el contrato declaraba sus cuatro ventanas
                # y en el extractor la palabra «sortino» solo aparecía para clasificar un
                # campo DEL PROVEEDOR: nunca lo calculamos.
                #
                # El denominador es la desviación a la BAJA, y las dos decisiones que lleva
                # van dichas porque cambian la cifra:
                #  - el objetivo es el mismo tipo libre de riesgo que usa el Sharpe (el ESTR
                #    del mes), no cero. Así los dos ratios miden el mismo exceso y solo se
                #    diferencian en cómo castigan la dispersión.
                #  - la media de los cuadrados se divide entre TODAS las observaciones, no
                #    entre las que caen por debajo. Es la definición estándar, y la otra
                #    premia a un fondo por tener pocos meses malos aunque sean pésimos.
                bajadas = [min(0.0, e) for e in exceso]
                dd = math.sqrt(statistics.fmean([b * b for b in bajadas]))
                if dd > DESVIACION_NULA:
                    datos["sortino"] = _r(statistics.fmean(exceso) * 12 / (dd * math.sqrt(12)))
                # Lo que el €STR rindió de media al mes, por 12. Ya no es la media del tipo
                # publicado: lleva su base act/360 y su capitalización, así que sale un 1,4 %
                # relativo por encima (un 2,00 % medio se lee 2,03 %).
                datos["rf"] = _r(statistics.fmean(rfs) * 12 * 100)
        out[clave] = {k: v for k, v in datos.items() if v is not None}
    return out


def caidas_maximas(serie: Serie, fin: date | None = None) -> dict[str, float]:
    """La peor caída desde máximo en cada ventana del riesgo: {'1a': -12.3, ...}.

    Existe por lo mismo que el Sortino: el contrato declara `max_drawdown` a 1, 3, 5 y 10
    años y aquí solo se calculaba UNA ventana, la de 3, escrita en `riesgo.max_drawdown.pct`
    con su periodo al lado. Las otras tres figuraban ausentes en los 1.077 instrumentos.

    No cambia la de 3 años: es la misma función con la misma tolerancia, llamada una vez por
    ventana. Y una ventana que la serie no cubre no sale a cero, no sale: `caida_maxima`
    devuelve `None` y la clave no se escribe, igual que una volatilidad sin sus meses.
    """
    salida: dict[str, float] = {}
    for clave, meses in VENTANAS_RIESGO:
        valor = caida_maxima(serie, anos=meses // 12, fin=fin)
        if valor is not None:
            salida[clave] = valor
    return salida


def caida_maxima(serie: Serie, anos: int = VENTANA_DRAWDOWN_ANOS,
                 fin: date | None = None) -> float | None:
    """Peor caída desde máximo, en porcentaje (negativo), en los últimos `anos`."""
    s = recorta(serie, fin)
    if len(s) < 2:
        return None
    desde = resta_meses(s[-1][0], anos * 12)
    if s[0][0] > desde + timedelta(days=TOLERANCIA_INICIO_DIAS):
        return None                            # la serie no cubre la ventana
    if hueco_en_ventana(s, desde):
        return None                            # ni la que un hueco no deja medir
    pico, peor = None, 0.0
    for f, p in s:
        if f < desde:
            continue
        pico = p if pico is None or p > pico else pico
        peor = min(peor, p / pico - 1)
    return _r(peor * 100)


def huecos_por_ventana(serie: Serie, fin: date, diario: bool = False) -> list[dict]:
    """Los huecos que le cuestan una ventana a la serie, con las ventanas que cuestan. La ficha lo dice con esto: sin esto,
    una ventana con hueco se leeria como una serie que no llega.

    `fin` es desde donde se cuentan las ventanas: el cierre de mes, o el ultimo dia en el camino diario."""
    salida: dict[tuple[date, date], dict] = {}
    for clave, meses in VENTANAS_RIESGO:
        if diario and meses > 60:
            continue                           # el camino diario no llega a 10 anios
        inicio = resta_anos(fin, meses // 12) if diario else _inicio(fin, meses)
        if not serie or serie[0][0] > inicio + timedelta(days=TOLERANCIA_INICIO_DIAS):
            continue                           # esa ventana la serie no la cubre, con hueco o sin el
        tramo = hueco_en_ventana(serie, inicio, fin, HUECO_MAXIMO_DIAS_DIARIO if diario else HUECO_MAXIMO_DIAS)
        if tramo:
            salida.setdefault(tramo, {"desde": tramo[0].isoformat(), "hasta": tramo[1].isoformat(),
                                      "dias": (tramo[1] - tramo[0]).days, "ventanas": []})["ventanas"].append(clave)
    return list(salida.values())


# ------------------------------------ la misma métrica, por el camino diario
#: Observaciones DIARIAS que exige la ventana para publicar sus métricas en el
#: camino de las acciones: `max(60, años * 180)`. Es el umbral que estaba dentro
#: del lector de EODHD y que el 02-11-2026 se trajo aquí **sin tocarlo**, porque
#: un umbral del método no puede vivir en el lector de un proveedor: cambiar de
#: proveedor cambiaría la cifra publicada sin que nadie hubiera decidido nada.
MIN_OBSERVACIONES_DIARIAS = 60
OBSERVACIONES_EXIGIDAS_POR_ANO = 180
#: Días del año con que se pasa de días naturales a años, aquí y en la rentabilidad
#: anualizada del camino diario.
DIAS_DEL_ANO = 365.25


def minimo_observaciones(anos: int) -> int:
    """Las observaciones diarias que exige una ventana de `anos`: 180, 540, 900."""
    return max(MIN_OBSERVACIONES_DIARIAS, anos * OBSERVACIONES_EXIGIDAS_POR_ANO)


def resta_anos(d: date, anos: int) -> date:
    try:
        return d.replace(year=d.year - anos)
    except ValueError:
        # 29 de febrero -> 28 de febrero si el año destino no es bisiesto.
        return d.replace(year=d.year - anos, day=28)


def rf_medio_pct(estr: list[tuple[date, float]], inicio: date,
                 fin: date) -> float | None:
    """€STR medio (porcentaje anual) de los días de la ventana, sin anualizar
    nada: la serie del BCE ya viene en tipo anual."""
    vals = [v for f, v in estr if inicio <= f <= fin]
    if not vals:
        return None
    return sum(vals) / len(vals)


#: Días hábiles (lunes a viernes) que el €STR puede acabar antes que la ventana sin que la ficha lo
#: marque. Tres porque es lo que da la operación normal: el BCE publica el €STR de un día a la
#: mañana siguiente (uno), la caché lo puede servir con hasta un día de edad (`estr_bce.TTL_DIAS`,
#: otro), y en un cierre de TARGET2 —Viernes Santo, Lunes de Pascua, 1 de mayo, 26 de diciembre—
#: no hay €STR aunque haya bolsa (el tercero). Más que eso no es retraso: es una serie parada.
#: Cuánto pesa: medido el 09-11-2026, un día de menos movía la media a un año en 0,0015 puntos y el
#: Sharpe como mucho en 0,0009, así que no se suprime nada (§3 del método: el Sharpe solo falta
#: si falta el tipo); se dice, y `rf_hasta` deja la cifra reproducible.
RF_TOLERANCIA_DIAS_HABILES = 3


def dias_habiles_entre(desde: date, hasta: date) -> int:
    """Lunes a viernes en `(desde, hasta]`. Sin calendario de festivos, a propósito: un festivo
    es justo lo que la tolerancia tiene que absorber, no algo que haya que descontar."""
    if hasta <= desde:
        return 0
    return sum(1 for n in range(1, (hasta - desde).days + 1)
               if (desde + timedelta(days=n)).weekday() < 5)


def cobertura_rf(estr: list[tuple[date, float]], fin: date) -> dict | None:
    """Hasta dónde llega el €STR que promedia una ventana que acaba en `fin`.

    `rf_hasta` es la última fecha del €STR que entra en la media (la última `<= fin`): con ella y
    la serie del BCE, un re-mapeo reproduce `rf_pct` sin adivinar qué copia había en la caché.
    `incompleto` es True si faltan más de `RF_TOLERANCIA_DIAS_HABILES` días hábiles hasta `fin`.
    `None` si no hay €STR hasta `fin`, que es el caso en que tampoco hay `rf_pct`."""
    fechas = [f for f, _v in estr if f <= fin]
    if not fechas:
        return None
    hasta = max(fechas)
    faltan = dias_habiles_entre(hasta, fin)
    return {"rf_hasta": hasta.isoformat(), "fin_ventana": fin.isoformat(),
            "dias_habiles_sin_estr": faltan,
            "incompleto": faltan > RF_TOLERANCIA_DIAS_HABILES}


def _caida_maxima_ventana(ventana: Serie) -> float | None:
    """Peor caída desde máximo DENTRO de la ventana que se le da.

    No es `caida_maxima`: esa exige que la serie cubra sus 3 años con la
    tolerancia de `TOLERANCIA_INICIO_DIAS` y devuelve `None` si no, mientras que
    esta mide lo que haya en la ventana que ya pasó la puerta."""
    pico = None
    peor = 0.0
    for _f, precio in ventana:
        if pico is None or precio > pico:
            pico = precio
        if pico:
            peor = min(peor, precio / pico - 1.0)
    return peor * 100 if pico is not None else None


def metricas_diarias(serie: Serie, anos: int,
                     estr: list[tuple[date, float]] | None = None) -> dict | None:
    """Rentabilidad, volatilidad, Sharpe y caída máxima de una ventana de `anos`
    sobre **retornos diarios**. Es el camino de las acciones y los ETF cotizados.

    La volatilidad se anualiza con la raíz de las observaciones que hay al año (versión 3).

    `None` cuando la ventana no llega a `minimo_observaciones(anos)`: un mínimo
    prudente para no publicar ratios de ventanas casi vacías.

    LIMITACION (MEDIA-10b, auditoria 13-10): la serie es la del listado (EODHD
    o Yahoo) en SU divisa, sin convertir a EUR, y se le resta el €STR. En un
    valor que cotiza en USD, GBP o CHF el exceso mezcla una rentabilidad en esa
    divisa con un tipo en EUR, y la volatilidad no recoge el riesgo de cambio
    que soporta un inversor en EUR. Solo es coherente para listados en EUR.
    La app recalcula rentabilidad, volatilidad y Sharpe en EUR sobre su propia
    serie (es la duena de la metrica); este valor es solo de respaldo y queda
    etiquetado con su divisa en riesgo.historial_precios.divisa.
    """
    if len(serie) < 3:
        return None
    fin = serie[-1][0]
    inicio = resta_anos(fin, anos)
    ventana = [p for p in serie if p[0] >= inicio]
    if len(ventana) < minimo_observaciones(anos) or hueco_en_ventana(serie, inicio, maximo=HUECO_MAXIMO_DIAS_DIARIO):
        return None
    retornos = []
    for prev, cur in zip(ventana, ventana[1:]):
        if prev[1] > 0 and cur[1] > 0:
            retornos.append(cur[1] / prev[1] - 1.0)
    if len(retornos) < 2:
        return None
    dias = (ventana[-1][0] - ventana[0][0]).days
    if dias <= 0 or ventana[0][1] <= 0:
        return None
    rent = ((ventana[-1][1] / ventana[0][1]) ** (DIAS_DEL_ANO / dias) - 1.0) * 100
    # Decisión A-158 de Óscar (16-11-2026), ante MET-3: la raíz es la de las observaciones que
    # la serie tiene DE VERDAD al año, no la de 252 fijos. La desviación típica es la de la
    # rentabilidad entre una cotización y la siguiente; si el valor cotiza 180 sesiones al año,
    # hay 180 de esas al año y no 252, y con 252 la volatilidad salía un 18 % por encima
    # (raíz de 252/180). En un valor que cotiza a diario salen unas 252-256 y no cambia nada.
    # Se reproduce con lo que la ficha ya publica: (observaciones − 1) × 365,25 / días entre
    # `fecha_inicio` y `fecha_fin`.
    por_ano = len(retornos) * DIAS_DEL_ANO / dias
    vol = statistics.stdev(retornos) * math.sqrt(por_ano) * 100
    rf_pct = rf_medio_pct(estr or [], ventana[0][0], ventana[-1][0])
    # Sharpe con rf = media diaria €STR del BCE en la ventana. rent, rf y vol
    # estan en porcentaje, por lo que (rent_pct-rf_pct)/vol_pct equivale a
    # usar decimales: (rent-rf)/vol.
    sharpe = (rent - rf_pct) / vol if vol and rf_pct is not None else None
    return {
        "rent_anualizada": _r(rent),
        "volatilidad": _r(vol),
        "rf_pct": _r(rf_pct),
        "sharpe": _r(sharpe),
        "max_drawdown": _r(_caida_maxima_ventana(ventana)),
        "observaciones": len(ventana),
        "fecha_inicio": ventana[0][0].isoformat(),
        "fecha_fin": ventana[-1][0].isoformat(),
    }


BASES_DE_INDICE = ("TOTAL_RETURN", "PRICE_RETURN")


def relativas(serie: Serie, indice: Serie, base_indice: str,
              estr: list[tuple[date, float]] | None = None,
              fin: date | None = None) -> dict:
    """Métricas del fondo CONTRA un índice: beta, R², alpha de Jensen,
    rentabilidad activa y tracking error. Mismas convenciones que `riesgo`:
    rentabilidades mensuales de los últimos 12, 36 o 60 meses cerrados.

    `base_indice` es obligatorio y decide QUÉ se puede calcular, porque no todas
    las magnitudes aguantan un índice de precio:

    - `TOTAL_RETURN`: las cinco. Es el caso de un índice NR/GR licenciado o de un
      fondo índice de ACUMULACIÓN usado como proxy, cuyo valor liquidativo es de
      retorno total por construcción.
    - `PRICE_RETURN`: solo beta, R² y tracking error. Un índice de precio excluye
      los dividendos, así que el alpha y la rentabilidad activa contra él salen
      infladas por el dividendo del índice —del orden de 1,3 puntos al año en el
      S&P 500, 2 en MSCI World y 3 en MSCI Europe—, y eso es diez o treinta veces
      el sesgo de usar un proxy con comisión. La beta y el R² sí aguantan: miden
      co-movimiento, y el dividendo entra como una deriva casi constante que
      apenas toca la pendiente ni el ajuste.

    No se adivina la base: la declara quien elige el índice. Un proxy mal
    elegido desplaza en silencio todos los alphas medidos contra él, y medido el
    01-11-2026 con las dos clases del mismo fondo índice MSCI World —una cubierta
    y otra no— la lectura cambia 4,9 puntos a un año y 1,7 anuales a cinco. Eso
    no se corrige con un ajuste, porque no es constante: es el camino del tipo de
    cambio.

    `None` en una magnitud significa que no se pudo calcular, nunca cero.

    Con `fin` en un último día de mes (el cierre del riesgo del fondo, `cierre_mensual`), si las
    dos series juntas no llegan a ese mes devuelve solo `{'sin_cierre_comun': fecha}`, el último
    cierre que tienen en común: las relativas no se miden con otro cierre que el del riesgo.
    """
    if base_indice not in BASES_DE_INDICE:
        raise ValueError(f"base del indice desconocida: {base_indice!r}")
    retorno_total = base_indice == "TOTAL_RETURN"

    cerrado = fin is not None and (fin + timedelta(days=1)).month != fin.month
    mf = fin_de_mes(recorta(serie, fin), incluir_ultimo=cerrado)
    mi = fin_de_mes(recorta(indice, fin), incluir_ultimo=cerrado)
    if len(mf) < 2 or len(mi) < 2:
        return {}

    # Solo los meses que están en las DOS series, para que cada rentabilidad del
    # fondo se empareje con la del índice del mismo mes y no con la de otro.
    por_mes_i = {(f.year, f.month): p for f, p in mi}
    comun = [(f, p, por_mes_i[(f.year, f.month)]) for f, p in mf
             if (f.year, f.month) in por_mes_i]
    if len(comun) < 2:
        return {}
    # Versión 4 (MET-6): con `fin`, las relativas cierran en el mes de `fin` —el del riesgo del
    # fondo— o no se dan. Hasta la 3, si el índice no llegaba a ese cierre, se medían con los
    # meses que había, un mes antes, y la ficha daba a la beta y al riesgo del mismo fondo dos
    # fechas distintas. Se devuelve hasta dónde llegan las dos series juntas, para decirlo.
    if cerrado and (comun[-1][0].year, comun[-1][0].month) != (fin.year, fin.month):
        return {"sin_cierre_comun": ultimo_dia(comun[-1][0]).isoformat()}

    out: dict = {"fecha": ultimo_dia(comun[-1][0]).isoformat(),
                 "base_indice": base_indice}
    for clave, n in VENTANAS_RIESGO:
        if len(comun) < n + 1:
            continue
        tramo = comun[-(n + 1):]
        if not _consecutivos([(f.year, f.month) for f, _p, _i in tramo]) or hueco_en_ventana(serie, tramo[0][0], fin):
            continue
        rf_ = [b[1] / a[1] - 1 for a, b in zip(tramo, tramo[1:])]
        ri = [b[2] / a[2] - 1 for a, b in zip(tramo, tramo[1:])]
        var_i = statistics.variance(ri)
        datos: dict = {}
        if var_i > 0:
            beta = statistics.covariance(rf_, ri) / var_i
            datos["beta"] = _r(beta)
            r = statistics.correlation(rf_, ri)
            datos["r2"] = _r(r * r * 100)
            if retorno_total and estr:
                tipos = _tipos(estr)
                rfs = [_rf_entre(tipos, a[0], b[0]) for a, b in zip(tramo, tramo[1:])]
                if all(x is not None for x in rfs):
                    ef = statistics.fmean([a - b for a, b in zip(rf_, rfs)])
                    ei = statistics.fmean([a - b for a, b in zip(ri, rfs)])
                    datos["jensen_alpha"] = _r((ef - beta * ei) * 12 * 100)
        if retorno_total:
            datos["rentabilidad_activa"] = _r(
                (statistics.fmean(rf_) - statistics.fmean(ri)) * 12 * 100)
        diferencias = [a - b for a, b in zip(rf_, ri)]
        if len(diferencias) >= 2:
            te = statistics.stdev(diferencias) * math.sqrt(12) * 100
            datos["tracking_error"] = _r(te)
            if retorno_total and te > 0 and "rentabilidad_activa" in datos:
                datos["information_ratio"] = _r(datos["rentabilidad_activa"] / te)
        if datos:
            out[clave] = datos
    return out
