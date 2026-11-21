"""Cambios de referencia del BCE y conversión a euros de una serie (decisión 10).

Una serie sin cambio disponible no se calcula en otra divisa: quien llama la deja sin métricas.
"""
from __future__ import annotations

import csv
import io
import logging
from datetime import date

from core import metricas

log = logging.getLogger(__name__)

URL = "https://data-api.ecb.europa.eu/service/data/EXR/D.{moneda}.EUR.SP00.A"
INICIO = "1999-01-01"
FUENTE = "ECB_REFERENCE"
#: Moneda de cotización -> (moneda del BCE, unidades de esa moneda por unidad cotizada).
MENORES = {"GBX": ("GBP", 0.01), "GBp": ("GBP", 0.01)}

_memoria: dict[str, list[tuple[date, float]]] = {}


def moneda_mayor(divisa: str) -> str:
    return MENORES.get(divisa, (divisa, 1.0))[0]


def lee_csv(texto: str) -> list[tuple[date, float]]:
    """[(fecha, unidades por 1 EUR), ...] ascendente, desde el CSV del BCE."""
    puntos: dict[date, float] = {}
    for fila in csv.DictReader(io.StringIO(texto)):
        try:
            fecha = date.fromisoformat(fila.get("TIME_PERIOD") or "")
            valor = float(fila.get("OBS_VALUE") or "")
        except ValueError:
            continue
        if valor > 0:
            puntos[fecha] = valor
    return sorted(puntos.items())


def cambios(moneda: str, http) -> list[tuple[date, float]]:
    if moneda in _memoria:
        return _memoria[moneda]
    try:
        respuesta = http.get(URL.format(moneda=moneda),
                             params={"format": "csvdata", "startPeriod": INICIO}, ttl_dias=1)
    except ConnectionError as e:
        log.warning("BCE %s: %s", moneda, e)
        return []
    if not getattr(respuesta, "ok", False):
        log.warning("BCE %s sin datos (status=%s)", moneda, getattr(respuesta, "status", "?"))
        return []
    puntos = lee_csv(respuesta.text)
    if puntos:
        _memoria[moneda] = puntos
    return puntos


def serie_en_euros(serie: metricas.Serie, divisa: str | None, http) -> metricas.Serie:
    """La serie en euros, o vacía si la divisa no se conoce o no hay cambio."""
    if divisa == "EUR":
        return serie
    if not divisa:
        return []
    moneda, escala = MENORES.get(divisa, (divisa, 1.0))
    return metricas.a_eur([(f, p * escala) for f, p in serie], cambios(moneda, http))
