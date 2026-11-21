"""EXT-1 (auditoría integral del 16-11-2026): «no encontrado» solo se recuerda tras una respuesta válida.

El buscador de Morningstar guardaba el negativo al acabar el bucle, hubiera respondido alguien o no: con la red caída
o con el servicio dando 5xx, el ISIN quedaba marcado «no encontrado» 7 días, y el bloque de un ETF, 30, aunque el fallo
durase un minuto. Aquí no hay red: un cliente HTTP de mentira contesta lo que cada caso necesita.
"""
from pathlib import Path

import pytest

from core.http import Respuesta
from fetchers import morningstar_lt

ISIN = "IE00B4L5Y983"
VACIA = '{"total": 0, "rows": []}'


class Http:
    """Contesta siempre lo mismo, o lo que diga `responde(url, params)`, y cuenta las llamadas."""

    def __init__(self, tmp_path: Path, responde):
        self.cache_dir = tmp_path / "http"
        self.responde = responde
        self.llamadas = 0

    def get(self, url, params=None, headers=None, force=False, familia=None, ttl_dias=None):
        self.llamadas += 1
        respuesta = self.responde(url, params or {})
        if isinstance(respuesta, Exception):
            raise respuesta
        return respuesta


def _buscar(http):
    return morningstar_lt._screener(ISIN, http, {}, force=False, raw_base=None)


def test_con_la_red_caida_no_se_recuerda_como_no_encontrado(tmp_path):
    http = Http(tmp_path, lambda url, params: ConnectionError("sin red"))
    assert _buscar(http) == (None, None)
    assert not morningstar_lt._negativo_screener_vigente(ISIN, http)
    # Y por eso la siguiente pasada vuelve a preguntar: cuatro universos por dos juegos de campos, otra vez.
    antes = http.llamadas
    assert antes == len(morningstar_lt.UNIVERSOS) * 2
    _buscar(http)
    assert http.llamadas == antes * 2


@pytest.mark.parametrize("estado", [500, 502, 503, 429])
def test_con_el_servicio_fallando_tampoco(tmp_path, estado):
    http = Http(tmp_path, lambda url, params: Respuesta(estado, "Service Unavailable", False))
    assert _buscar(http) == (None, None)
    assert not morningstar_lt._negativo_screener_vigente(ISIN, http)


def test_una_respuesta_valida_y_vacia_en_todos_los_universos_si_es_un_negativo(tmp_path):
    http = Http(tmp_path, lambda url, params: Respuesta(200, VACIA, False, 1.0))
    assert _buscar(http) == (None, None)
    assert morningstar_lt._negativo_screener_vigente(ISIN, http)
    # Con el negativo vigente, la pasada siguiente no pregunta.
    antes = http.llamadas
    _buscar(http)
    assert http.llamadas == antes


def test_si_un_solo_universo_no_responde_no_hay_negativo(tmp_path):
    """El ISIN puede estar justo en el universo que no contestó."""
    caido = morningstar_lt.UNIVERSOS[2]

    def responde(url, params):
        if params.get("universeIds") == caido:
            return Respuesta(503, "", False)
        return Respuesta(200, VACIA, False, 1.0)

    http = Http(tmp_path, responde)
    assert _buscar(http) == (None, None)
    assert not morningstar_lt._negativo_screener_vigente(ISIN, http)


def test_basta_con_que_uno_de_los_dos_juegos_de_campos_responda(tmp_path):
    """El juego completo puede rechazarse y el mínimo contestar: el universo ha respondido."""

    def responde(url, params):
        if params.get("securityDataPoints") == morningstar_lt.DATAPOINTS_FULL:
            return Respuesta(400, "Bad Request", False)
        return Respuesta(200, VACIA, False, 1.0)

    http = Http(tmp_path, responde)
    assert _buscar(http) == (None, None)
    assert morningstar_lt._negativo_screener_vigente(ISIN, http)


def test_encontrarlo_sigue_borrando_el_negativo(tmp_path):
    fila = '{"rows": [{"ISIN": "%s", "SecId": "0P0000XXXX"}]}' % ISIN
    http = Http(tmp_path, lambda url, params: Respuesta(200, fila, False, 1.0))
    morningstar_lt._guarda_negativo_screener(ISIN, http)
    encontrada, _fecha = morningstar_lt._screener(ISIN, http, {}, force=True, raw_base=None)
    assert encontrada["SecId"] == "0P0000XXXX"
    assert not morningstar_lt._negativo_screener_vigente(ISIN, http)


@pytest.mark.parametrize("estado, queda", [(404, True), (400, True), (401, False), (403, False), (500, False)])
def test_el_bloque_de_un_etf_solo_se_marca_con_un_no_existe(tmp_path, estado, queda):
    """Un 401 o un 403 son de la clave o de un bloqueo: no dicen nada del producto."""
    assert morningstar_lt.ESTADOS_DE_NO_EXISTE == (400, 404)
    http = Http(tmp_path, lambda url, params: Respuesta(estado, "no", False))
    morningstar_lt._sal("0P0000XXXX", http, {}, False, None, {}, universo="ETEXG$XMAD")
    for tipo in ("etf", "fund"):
        vigente = morningstar_lt._negativo_vigente(http, "morningstar_sal_negative", f"0P0000XXXX_{tipo}", morningstar_lt.NEGATIVO_SAL_DIAS)
        assert vigente is queda
