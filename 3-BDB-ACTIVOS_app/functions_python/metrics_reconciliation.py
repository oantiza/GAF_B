# -*- coding: utf-8 -*-
"""Cuando el calculo propio puede sustituir a la cifra del proveedor.

La norma es calcular sobre la serie propia siempre que el calculo SUPERE en
calidad al dato importado. Para los fondos esa condicion no se cumple sola, y
hay una razon concreta: la serie de fondo de la maestra es `series_type: "NAV"`
de EODHD (10.540 de 10.601 documentos), es decir valor liquidativo bruto. En una
clase de acumulacion el NAV bruto ES la rentabilidad total y el calculo es
mejor que el trailing del proveedor -- diario en vez de mensual, Sharpe con
€STR real, drawdown a 5 anios, y la misma metodologia que acciones y ETF. En una
clase de reparto el NAV cae el dia del dividendo y el calculo pierde ese importe:
ahi el dato del proveedor es el bueno.

`yield_12m_pct` no basta para separarlas: esta a cero en 660 de 677 fondos
mientras que 40 llevan marca de reparto en el nombre. Asi que la separacion no
se declara, se MIDE: se recalcula cada ventana al mismo corte que publico el
proveedor y se compara. Si reproduce su cifra, la serie es total-return y esta
completa, y a partir de ahi el calculo propio gana por metodologia. Si no la
reproduce, algo le falta a la serie -- un dividendo, un tramo -- y la ventana se
queda con el proveedor y se dice cual es.

Comprobado sobre el backup del 06-09 contra el corte del proveedor (30-06-2026):
de 596 fondos de acumulacion comparables, la desviacion mediana de la ventana de
3 anios es 0,00 pp y solo 9 superan 1 pp; 8 de esos 9 los descarta ya el guard
de cobertura de ventana.

La primera pasada en seco sobre los 675 fondos dejo ver que hay dos formas de
que la comparacion no proceda, distintas de que la serie sea mala, y que sin
separarlas se leerian como discrepancias:

- la clase no cotiza en EUR y la serie si (NO_BASIS);
- la serie no llega al corte del proveedor (STALE_SERIES): el Carmignac
  Investissement acaba en enero y el Polar Capital Healthcare el 8 de junio.

Y una tercera que si es la serie: BL-Global 75 cae de 3.087,94 a 102,82 en un
dia (16-07-2021), un split 30:1 sin ajustar. Ese caso lo tiene que ver un humano;
el gate solo se encarga de no publicar el -46% que sale de ahi.

A1 (auditoria 29-09): la comparacion es SOLO de rentabilidad anualizada
(geometrica, primer/ultimo valor), que no depende de la frecuencia con la que se
mida la volatilidad. Que la maestra haya pasado a medir la volatilidad en
semanal (weekly_sampling) no mueve ningun veredicto, y la volatilidad del
proveedor --que Morningstar publica sobre rendimientos mensuales y la maestra
ahora sobre semanales-- no se contrasta a proposito: una discrepancia ahi seria
la esperada por frecuencia, no un fallo de la serie. Si algun dia se compara,
hay que etiquetarla como diferencia de frecuencia, no como MISMATCH.
"""
from datetime import date

# Etiqueta de ventana -> clave de la rentabilidad trailing del proveedor en
# `performance.returns.trailing_pct`.
PROVIDER_RETURN_KEYS = {
    "1y": "1a",
    "3y": "3a_anualizada",
    "5y": "5a_anualizada",
    "10y": "10a_anualizada",
}

# Puntos porcentuales de desviacion admitidos entre el calculo propio y el
# trailing del proveedor al mismo corte. 1,0 pp es holgado a proposito: no
# buscamos cuadrar al decimal --el proveedor redondea y puede usar otro dia de
# corte dentro del mes-- sino detectar el fallo cualitativo, que es de varios
# puntos: el dividendo perdido va de 3 a 6 pp anuales en las clases de reparto
# medidas.
DEFAULT_TOLERANCE_PP = 1.0

# Dias que la serie puede quedarse corta respecto al corte del proveedor. Una
# serie que termina el 08-06 no puede contrastarse contra una cifra medida el
# 30-06: la ventana anual quedaria desplazada tres semanas y la desviacion no
# diria nada sobre la serie. 15 dias cubre un puente de festivos o el retraso
# normal del ultimo NAV.
MAX_CUT_GAP_DAYS = 15

# La serie de la maestra esta convertida a EUR (`price-series.v1.2`: currency
# EUR, fx_policy declarada). El trailing del proveedor viene en la divisa de la
# clase. En una clase en EUR las dos bases coinciden y la comparacion mide lo
# que tiene que medir; en una clase en USD la diferencia seria el tipo de cambio
# del periodo, no la calidad de la serie -- y un cuadre seria casualidad. Los 24
# fondos en USD y el que no declara divisa se quedan con el proveedor.
SERIES_CURRENCY = "EUR"

MATCH = "MATCH"
MISMATCH = "MISMATCH"
NO_PROVIDER = "NO_PROVIDER"
NO_WINDOW = "NO_WINDOW"
NO_BASIS = "NO_BASIS"
STALE_SERIES = "STALE_SERIES"


def _get(node, *path):
    for key in path:
        if not isinstance(node, dict):
            return None
        node = node.get(key)
    return node


def _number(value):
    return float(value) if isinstance(value, (int, float)) and not isinstance(value, bool) else None


def provider_cut_date(root) -> str | None:
    """Fecha a la que el proveedor midio sus cifras trailing."""
    cut = _get(root, "performance", "returns", "fecha_dato")
    if not isinstance(cut, str) or len(cut) < 10:
        return None
    try:
        date.fromisoformat(cut[:10])
    except ValueError:
        return None
    return cut[:10]


def provider_return_pct(root, label) -> float | None:
    """Rentabilidad anualizada del proveedor para una ventana, en porcentaje."""
    key = PROVIDER_RETURN_KEYS.get(label)
    if not key:
        return None
    return _number(_get(root, "performance", "returns", "trailing_pct", key, "fondo"))


def comparable_basis(root) -> bool:
    """Si el trailing del proveedor y la serie miden en la misma divisa."""
    currency = _get(root, "identity", "currency")
    return isinstance(currency, str) and currency.upper() == SERIES_CURRENCY


def series_reaches_cut(points, cut, max_gap_days=MAX_CUT_GAP_DAYS) -> bool:
    """Si la serie llega lo bastante cerca del corte del proveedor."""
    if not points or not cut:
        return False
    try:
        gap = (date.fromisoformat(cut) - date.fromisoformat(points[-1]["date"][:10])).days
    except (ValueError, TypeError, KeyError):
        return False
    return 0 <= gap <= max_gap_days


def reconcile_windows(root, points, window_builder, labels=("1y", "3y", "5y", "10y"),
                      tolerance_pp=DEFAULT_TOLERANCE_PP, max_cut_gap_days=MAX_CUT_GAP_DAYS) -> dict:
    """Compara el calculo propio con el proveedor al corte del proveedor.

    `points`: serie completa, ordenada, como [{"date": "YYYY-MM-DD", "value": x}].
    `window_builder(points_hasta_corte, label)`: devuelve la ventana calculada
    (dict con `annualized_return` en fraccion) o None. Se inyecta para que las
    dos rutas de ingesta usen cada una su propio calculador sin duplicar la
    politica de aqui.

    Devuelve {label: {verdict, provider_pct, computed_pct, diff_pp}}.
    """
    cut = provider_cut_date(root)
    verdicts = {}
    truncated = [p for p in points if p["date"] <= cut] if cut else []

    # Dos motivos por los que la comparacion entera no procede, antes de mirar
    # ventana por ventana. No son fallos del calculo: son fallos de la
    # comparacion, y confundirlos con una discrepancia haria pensar que la serie
    # esta mal cuando lo que pasa es que no se puede contrastar.
    blocked = None
    if cut is not None and not comparable_basis(root):
        blocked = NO_BASIS
    elif cut is not None and not series_reaches_cut(truncated, cut, max_cut_gap_days):
        blocked = STALE_SERIES

    for label in labels:
        provider = provider_return_pct(root, label)
        if cut is None or provider is None:
            verdicts[label] = {"verdict": NO_PROVIDER, "provider_pct": provider,
                               "computed_pct": None, "diff_pp": None}
            continue
        if blocked:
            verdicts[label] = {"verdict": blocked, "provider_pct": round(provider, 6),
                               "computed_pct": None, "diff_pp": None}
            continue
        window = window_builder(truncated, label) if truncated else None
        computed = _number((window or {}).get("annualized_return"))
        if computed is None:
            verdicts[label] = {"verdict": NO_WINDOW, "provider_pct": provider,
                               "computed_pct": None, "diff_pp": None}
            continue
        computed_pct = computed * 100.0
        diff = computed_pct - provider
        verdicts[label] = {
            "verdict": MATCH if abs(diff) <= tolerance_pp else MISMATCH,
            "provider_pct": round(provider, 6),
            "computed_pct": round(computed_pct, 6),
            "diff_pp": round(diff, 6),
        }
    return verdicts


def computable_labels(verdicts) -> set:
    """Ventanas cuyo calculo propio puede publicarse.

    Solo las que reprodujeron al proveedor. Ningun otro veredicto pasa, y todos
    por la misma razon: sin una comparacion valida no hay prueba de que el
    calculo propio no empeore el dato, y publicarlo seria suponerlo.
    """
    return {label for label, node in (verdicts or {}).items() if node.get("verdict") == MATCH}


def merge_windows(computed, provider_windows, allowed) -> dict:
    """Ventanas calculadas donde se permite, del proveedor donde no.

    El documento puede quedar mixto, y eso es correcto: metrics.v1.2 lleva
    `method` POR VENTANA justo para esto, y el comparador ya sabe leerlo y
    avisar cuando mezcla (describeMetricsMethodology). Lo que no seria correcto
    es un documento que no diga de donde sale cada cifra.
    """
    out = {}
    for label in sorted(set(computed or {}) | set(provider_windows or {})):
        if label in allowed and label in (computed or {}):
            out[label] = computed[label]
        elif label in (provider_windows or {}):
            out[label] = provider_windows[label]
    return out


VERDICTS = (MATCH, MISMATCH, NO_PROVIDER, NO_WINDOW, NO_BASIS, STALE_SERIES)


def summarize(verdicts) -> dict:
    """Recuento por veredicto, para la pasada en seco."""
    counts = {name: 0 for name in VERDICTS}
    for node in (verdicts or {}).values():
        name = node.get("verdict", NO_PROVIDER)
        counts[name] = counts.get(name, 0) + 1
    return counts
