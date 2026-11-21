# -*- coding: utf-8 -*-
"""IE00BF0GL212 (Polar Capital Artificial Intelligence R Acc) esta desbloqueado desde el 11-11-2026 (Oscar).

Los dos motivos del bloqueo cayeron: su serie ya no se para el 18-06-2026 (la sigue Morningstar, decision D-9) y las
diferencias de ene-mar de 2021 eran un efecto de la fecha, no de valor (0,0 % en 100 dias comunes).
"""
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from fund_history_quality import policy_for, se_dibuja_tras_revision, usable_documents  # noqa: E402

POLAR = "IE00BF0GL212"


def test_polar_ya_no_tiene_politica_ni_bloqueo():
    assert policy_for(POLAR) == {}
    assert not policy_for(POLAR).get("blocked")
    assert se_dibuja_tras_revision(POLAR) is False


def test_polar_no_esta_en_el_fichero_de_politicas():
    ruta = os.path.join(os.path.dirname(__file__), "..", "fund_history_policies.json")
    with open(ruta, encoding="utf-8") as f:
        assert POLAR not in json.load(f)["assets"]


def test_polar_usa_su_serie_entera_para_medir_y_para_dibujar():
    docs = [{"points": [{"date": "2026-11-09", "value": 36.12}]}]
    for para_dibujar in (False, True):
        assert usable_documents(POLAR, docs, para_dibujar=para_dibujar)[0]["points"] == docs[0]["points"]
