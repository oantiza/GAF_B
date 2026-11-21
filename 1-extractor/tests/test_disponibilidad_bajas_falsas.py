# -*- coding: utf-8 -*-
"""Lo que no dejó de cotizar no sale como que dejó de cotizar.

Medido el 05-11-2026, las 9 bajas de la base eran 4 de verdad y 5 falsas, y las dos causas están
aquí:

- Prisa, DIGI, Desa y Árima las cubría Yahoo porque el buscador de EODHD no las encuentra por ISIN,
  aunque cotizan allí. El re-mapeo sin red del 04-11 no pudo preguntar a Yahoo, y el «no la tengo»
  de EODHD se leyó como una defunción, con precio de ese mismo día en la ficha.
- A iShares Energy Storage el buscador tampoco lo encuentra por ISIN, aunque cotiza como `STOR.AS`.
  Su precio era de justETF, y como la ficha anterior tenía precio, «antes resolvía».

Prisa, Desa, Árima y el ETF ya tienen corrección de símbolo (`config/correcciones.json`, 05-11-2026).
"""
import datetime as dt
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core.adquisicion import disponibilidad, procedencia  # noqa: E402
from core.adquisicion.nucleo import _etf_con_precio_de_otra_fuente  # noqa: E402
from core.http import SinCache  # noqa: E402
from fetchers import eodhd  # noqa: E402

ISIN = "ES01717430J3"
HOY = dt.date(2026, 11, 5)


class _Respuesta:
    ok = True
    status = 200

    def __init__(self, datos):
        self._datos = datos

    def json(self):
        return self._datos


class _Http:
    """EODHD contesta, de la caché, que no lo tiene. Yahoo tampoco lo tiene cuando se le puede preguntar."""

    def __init__(self, sin_red: bool):
        self.sin_red = sin_red

    def get(self, url, **_k):
        if "eodhd.com/api/search" in url or "finance/search" in url:
            return _Respuesta([] if "eodhd" in url else {"quotes": []})
        raise SinCache(url)


def _contesto(sin_red: bool, monkeypatch) -> bool | None:
    monkeypatch.setattr(eodhd, "_token", lambda _base: "token")
    with procedencia.activa("eodhd") as reg:
        assert eodhd.fetch(ISIN, _Http(sin_red), {}, tipo="accion") == {}
        return reg.contesto


def _estado(contesto: bool | None) -> str | None:
    return disponibilidad.desde_la_pasada(en_alcance=True, contesto=contesto, resuelve_ahora=False,
                                          resolvia_antes=True)


def test_sin_red_no_hay_marca_aunque_eodhd_conteste_que_no_lo_tiene(monkeypatch):
    """Ni baja ni nada: la pasada no ha podido preguntar a quien la cubre, y la marca que hubiera sigue valiendo."""
    assert _contesto(True, monkeypatch) is None
    assert _estado(None) is None


def test_con_red_si_nadie_lo_tiene_si_dejo_de_cotizar(monkeypatch):
    """La otra cara: si Yahoo se ha podido preguntar y tampoco lo tiene, la defunción sigue valiendo."""
    assert _estado(_contesto(False, monkeypatch)) == disponibilidad.DEJO_DE_COTIZAR


def _aportado(vl=8.73, fecha="2026-11-02") -> dict:
    return {"justetf": {"valoracion": {"vl": vl, "vl_fecha": fecha, "vl_divisa": "EUR"}}}


def test_un_etf_con_precio_reciente_de_justetf_cotiza():
    assert _etf_con_precio_de_otra_fuente("etf", _aportado(), hoy=HOY) is True
    assert _etf_con_precio_de_otra_fuente("etf", _aportado(fecha="2026-10-22"), hoy=HOY) is True


def test_un_precio_viejo_no_prueba_nada():
    assert _etf_con_precio_de_otra_fuente("etf", _aportado(fecha="2026-10-21"), hoy=HOY) is False
    assert _etf_con_precio_de_otra_fuente("etf", _aportado(fecha="no es una fecha"), hoy=HOY) is False


def test_solo_vale_para_un_etf_y_con_precio():
    assert _etf_con_precio_de_otra_fuente("accion", _aportado(), hoy=HOY) is False
    assert _etf_con_precio_de_otra_fuente("etf", _aportado(vl=None), hoy=HOY) is False
    assert _etf_con_precio_de_otra_fuente("etf", {}, hoy=HOY) is False
