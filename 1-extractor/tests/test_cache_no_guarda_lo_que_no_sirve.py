# -*- coding: utf-8 -*-
"""EXT-11 (auditoría integral del 16-11-2026): la caché HTTP no guarda una respuesta que no sirve.

Se guardaba cualquier respuesta por debajo de 400. Un cuerpo vacío —lo que devuelve un cortafuegos que pide un
desafío con un 202— o una página de mantenimiento con un 200 se quedaban el plazo entero de su familia, y para las
familias que una pasada no refresca, sin plazo.

Aquí no hay red: se sustituye el `get` de la sesión por uno de mentira que contesta lo que diga cada prueba.
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core import http as modulo  # noqa: E402
from core.http import Http  # noqa: E402

SETTINGS = {"cache_dias": 7, "rate_limit_segundos": 0, "jitter_segundos": 0, "reintentos": 1}
BCE = "https://data-api.ecb.europa.eu/service/data/EST/B.EU000A2X2A25.WT"
CSV_DEL_BCE = "KEY,FREQ,TIME_PERIOD,OBS_VALUE\nEST.B,B,2026-11-13,1.93\n"


class _Respuesta:
    def __init__(self, status_code, text):
        self.status_code, self.text, self.headers = status_code, text, {}


def _cliente(tmp_path, monkeypatch, respuestas):
    """Un `Http` de verdad cuya sesión contesta, por orden, las `respuestas`; apunta cuántas veces salió a la red."""
    http = Http(SETTINGS, tmp_path)
    cola, salidas = list(respuestas), []

    def get(url, params=None, headers=None, timeout=None):
        salidas.append(url)
        return cola.pop(0)

    monkeypatch.setattr(http.session, "get", get)
    return http, salidas


@pytest.mark.parametrize("estado, cuerpo", [
    (202, ""),          # el desafío de un cortafuegos: «aceptado», y nada dentro
    (200, ""),
    (200, "  \n "),     # solo blancos
])
def test_una_respuesta_vacia_no_se_guarda_y_la_siguiente_peticion_vuelve_a_preguntar(tmp_path, monkeypatch, estado, cuerpo):
    http, salidas = _cliente(tmp_path, monkeypatch, [_Respuesta(estado, cuerpo), _Respuesta(200, '{"rows": [1]}')])
    url = "https://ejemplo.test/datos"
    primera = http.get(url)
    assert (primera.status, primera.text, primera.desde_cache) == (estado, cuerpo, False)
    assert list(tmp_path.glob("*.json")) == []                # nada en la caché
    segunda = http.get(url)                                   # antes, esto leía el vacío de la caché
    assert segunda.json() == {"rows": [1]}
    assert len(salidas) == 2
    # Y lo bueno sí se guarda: la tercera ya no sale.
    assert http.get(url).desde_cache is True
    assert len(salidas) == 2


def test_una_pagina_que_no_es_el_csv_del_bce_no_se_guarda(tmp_path, monkeypatch):
    mantenimiento = "<html><body>Service temporarily unavailable</body></html>"
    http, salidas = _cliente(tmp_path, monkeypatch, [_Respuesta(200, mantenimiento), _Respuesta(200, CSV_DEL_BCE)])
    assert http.get(BCE, ttl_dias=1).text == mantenimiento    # quien la pidió la recibe igual, y sabe que no le sirve
    assert list(tmp_path.glob("*.json")) == []
    assert http.get(BCE, ttl_dias=1).text == CSV_DEL_BCE
    assert http.get(BCE, ttl_dias=1).desde_cache is True
    assert len(salidas) == 2


def test_la_misma_pagina_en_un_sitio_sin_forma_declarada_si_se_guarda(tmp_path, monkeypatch):
    """La CNMV y otros se leen de su página: un HTML es ahí la respuesta buena, y nada dice lo contrario."""
    pagina = "<html><body>ficha del fondo</body></html>"
    http, salidas = _cliente(tmp_path, monkeypatch, [_Respuesta(200, pagina)])
    http.get("https://www.cnmv.es/portal/consultas/ficha")
    assert http.get("https://www.cnmv.es/portal/consultas/ficha").desde_cache is True
    assert len(salidas) == 1


def test_el_motivo_dice_por_que_y_solo_el_bce_tiene_forma_declarada():
    assert modulo.motivo_para_no_guardar("https://ejemplo.test/a", "") == "respuesta vacía"
    assert modulo.motivo_para_no_guardar("https://ejemplo.test/a", None) == "respuesta vacía"
    assert modulo.motivo_para_no_guardar("https://ejemplo.test/a", "<html></html>") is None
    assert modulo.motivo_para_no_guardar(BCE, "<html></html>") == "la respuesta no tiene la forma que da ese sitio"
    assert modulo.motivo_para_no_guardar(BCE, CSV_DEL_BCE) is None
    # El de los cambios es el mismo servicio y el mismo CSV.
    cambios = "https://data-api.ecb.europa.eu/service/data/EXR/D.USD.EUR.SP00.A"
    assert modulo.motivo_para_no_guardar(cambios, "TIME_PERIOD,OBS_VALUE\n2026-11-13,1.16\n") is None
    assert list(modulo.VALIDADORES) == ["https://data-api.ecb.europa.eu/service/data/"]
