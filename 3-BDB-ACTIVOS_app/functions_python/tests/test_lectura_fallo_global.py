# -*- coding: utf-8 -*-
"""Hallazgo del 22-11-2026: un fallo GLOBAL de la base no degrada a lecturas sueltas.

Con el lote caido por plazo agotado, cada lectura suelta costaba otro plazo (41 `get_all`, 615 s simulados con 40
posiciones) y el callable moria a los 60 s con un error generico. Ahora: fallo global en el lote -> `LecturaFallida`
(UNAVAILABLE) sin lecturas sueltas, y las lecturas sueltas tienen un presupuesto de tiempo. El fallo aislado de un id
sigue dando datos parciales con `READ_FAILED`.
"""
import os
import sys

import pytest
from google.api_core import exceptions as gexc

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import main  # noqa: E402
from firebase_functions import https_fn  # noqa: E402
from readmodel import repository as R  # noqa: E402
from tests.test_lectura_y_entradas import _codigo, _con_lector  # noqa: E402

IDS = ["ID%02d" % i for i in range(40)]


def _raiz(aid):
    return {"asset_id": aid, "asset_type": "FUND", "identity": {"name": aid, "currency": "EUR"}}


@pytest.fixture(autouse=True)
def sesion(monkeypatch):
    monkeypatch.setattr(main, "_require_auth", lambda req, **limites: "asesor")


class Lector:
    def __init__(self, error_lote=None, falla_uno=None, error_suelto=None):
        self.error_lote, self.falla_uno, self.error_suelto = error_lote, falla_uno, error_suelto
        self.lote_calls = 0
        self.suelto_calls = 0

    def get_assets_many(self, ids):
        self.lote_calls += 1
        raise self.error_lote or RuntimeError("lote")

    def get_metrics_latest(self, aid):
        return None

    def get_holdings_summary(self, aid):
        return None

    def get_asset(self, aid):
        self.suelto_calls += 1
        if self.error_suelto is not None:
            raise self.error_suelto
        if aid == self.falla_uno:
            raise RuntimeError("500 solo de este documento")
        return _raiz(aid)


@pytest.mark.parametrize("exc", [gexc.DeadlineExceeded("plazo"), gexc.ServiceUnavailable("corte"),
                                 gexc.ResourceExhausted("cuota"), gexc.Unauthenticated("cred"),
                                 gexc.PermissionDenied("permiso"), gexc.RetryError("reintentos", None)])
def test_fallo_global_en_el_lote_no_degrada_a_lecturas_sueltas(exc):
    lector = Lector(error_lote=exc)
    with pytest.raises(R.LecturaFallida):
        R._asset_roots_map(lector, IDS)
    assert lector.lote_calls == 1 and lector.suelto_calls == 0


def test_fallo_global_en_una_lectura_suelta_corta_el_bucle():
    lector = Lector(error_suelto=gexc.DeadlineExceeded("plazo"))
    with pytest.raises(R.LecturaFallida):
        R._asset_roots_map(lector, IDS)
    assert lector.suelto_calls == 1


def test_un_id_con_500_aislado_da_filas_y_un_aviso():
    lector = Lector(falla_uno=IDS[7])
    fallidos = set()
    out = R._asset_roots_map(lector, IDS, fallidos)
    assert len(out) == 39 and fallidos == {IDS[7]}
    pagina = R.compare_assets_page(lector, IDS)
    assert len(pagina["assets"]) == 39
    assert [w["code"] for w in pagina["read_warnings"]] == ["READ_FAILED"]
    assert pagina["read_warnings"][0]["asset_ids"] == [IDS[7]]


def test_el_presupuesto_agotado_corta_las_lecturas_sueltas(monkeypatch):
    reloj = {"t": 0.0}
    monkeypatch.setattr(R.time, "monotonic", lambda: reloj["t"])
    lector = Lector()
    original = lector.get_asset

    def lento(aid):
        reloj["t"] += 5.0  # cada lectura "tarda" 5 s
        return original(aid)
    lector.get_asset = lento
    with pytest.raises(R.LecturaFallida):
        R._asset_roots_map(lector, IDS)
    assert lector.suelto_calls < 10  # se para al agotar el presupuesto, no recorre los 40


def test_el_presupuesto_tambien_corta_metricas_y_posiciones(monkeypatch):
    reloj = {"t": 0.0}
    monkeypatch.setattr(R.time, "monotonic", lambda: reloj["t"])
    roots = [_raiz(a) for a in IDS]
    llamadas = {"m": 0, "h": 0}

    class L:
        def get_metrics_latest(self, aid):
            llamadas["m"] += 1
            reloj["t"] += 10.0
            return {}

        def get_holdings_summary(self, aid):
            llamadas["h"] += 1
            reloj["t"] += 10.0
            return None
    with pytest.raises(R.LecturaFallida):
        R._metrics_latest_map(L(), roots)
    reloj["t"] = 0.0
    with pytest.raises(R.LecturaFallida):
        R._holdings_summary_map(L(), roots)
    assert llamadas["m"] <= 3 and llamadas["h"] <= 3


def test_fallo_global_en_metricas_y_posiciones_por_lote():
    class L:
        def get_metrics_latest_many(self, ids):
            raise gexc.DeadlineExceeded("plazo")

        def get_holdings_summaries_many(self, ids):
            raise gexc.ServiceUnavailable("corte")

        def get_metrics_latest(self, aid):
            raise AssertionError("no debe leer suelto")

        def get_holdings_summary(self, aid):
            raise AssertionError("no debe leer suelto")
    roots = [_raiz(a) for a in IDS]
    with pytest.raises(R.LecturaFallida):
        R._metrics_latest_map(L(), roots)
    with pytest.raises(R.LecturaFallida):
        R._holdings_summary_map(L(), roots)


def test_en_el_callable_un_fallo_global_es_unavailable(monkeypatch):
    lector = Lector(error_lote=gexc.DeadlineExceeded("plazo"))
    _con_lector(monkeypatch, lector)
    codigo, mensaje = _codigo(main.compare_assets, {"asset_ids": IDS[:5]})
    assert codigo == https_fn.FunctionsErrorCode.UNAVAILABLE
    assert "vuelve a intentarlo" in mensaje
    assert lector.suelto_calls == 0
