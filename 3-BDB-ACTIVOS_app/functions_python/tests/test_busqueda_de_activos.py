# -*- coding: utf-8 -*-
"""Decision 81 de Oscar: el selector del Comparador responde igual que el Buscador.

Lo que tiene que responder esta escrito a mano en `fixtures/busqueda_de_activos.json`, que tambien lee
`tests/busquedaDeActivos.test.ts`. Esa prueba comprueba ademas que la lista de nombres habituales sea
la misma en el sitio y en las Functions.

Ejecuta: pytest functions_python/tests/test_busqueda_de_activos.py
"""
import json
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from readmodel import repository as repo  # noqa: E402
from readmodel.busqueda import coincide, es_respuesta_exacta, palabras_de_la_busqueda, plegar  # noqa: E402

_FICHERO = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures", "busqueda_de_activos.json")
with open(_FICHERO, encoding="utf-8") as fichero:
    _DATOS = json.load(fichero)
ACTIVOS = _DATOS["activos"]
CASOS = _DATOS["casos"]


def _raiz(activo):
    return {
        "asset_id": activo["isin"],
        "asset_type": "STOCK" if activo.get("ticker") else "FUND",
        "identity": {"name": activo["nombre"], "currency": "EUR"},
        "identifiers": {"isin": activo["isin"], **({"ticker": activo["ticker"]} if activo.get("ticker") else {})},
    }


class Lector:
    """Con indice, como la base vieja y la nueva; sin el, el camino degradado."""

    def __init__(self, activos=ACTIVOS, con_indice=True):
        self.activos = activos
        self.raices = {a["isin"]: _raiz(a) for a in activos}
        self.con_indice = con_indice

    def get_search_index(self):
        if not self.con_indice:
            return None
        return {"entries": [
            {"id": a["isin"], "name": a["nombre"], "name_folded": plegar(a["nombre"]),
             "type": self.raices[a["isin"]]["asset_type"], "ticker": a.get("ticker")}
            for a in sorted(self.activos, key=lambda a: a["isin"])
        ]}

    def get_assets_many(self, ids):
        return {i: self.raices[i] for i in ids if i in self.raices}

    def list_assets(self, tipos, limite):
        return [r for r in self.raices.values() if r["asset_type"] in tipos][:limite]

    def get_metrics_latest(self, _id):
        return None

    def get_holdings(self, _id):
        return None


def _esperado(caso):
    return sorted(a["isin"] for a in ACTIVOS) if caso.get("todos") else sorted(caso.get("responden", []))


@pytest.mark.parametrize("caso", CASOS, ids=lambda c: repr(c["tecleado"]))
def test_lo_que_responde_la_regla(caso):
    palabras = palabras_de_la_busqueda(caso["tecleado"])
    salen = [a["isin"] for a in ACTIVOS if coincide(palabras, a["nombre"], a["isin"], a.get("ticker"))]
    assert sorted(salen) == _esperado(caso)
    exactos = [a["isin"] for a in ACTIVOS if es_respuesta_exacta(caso["tecleado"], a["isin"], a.get("ticker"))]
    assert sorted(exactos) == sorted(caso.get("exactos", []))


@pytest.mark.parametrize("caso", CASOS, ids=lambda c: repr(c["tecleado"]))
def test_lo_que_responde_el_selector_con_indice(caso):
    pagina = repo.search_assets_page(Lector(), caso["tecleado"], None, 200)
    assert sorted(r["asset_id"] for r in pagina["results"]) == _esperado(caso)
    assert pagina["total_matches"] == len(_esperado(caso))


@pytest.mark.parametrize("caso", CASOS, ids=lambda c: repr(c["tecleado"]))
def test_el_camino_degradado_responde_lo_mismo(caso):
    pagina = repo.search_assets_page(Lector(con_indice=False), caso["tecleado"], None, 200)
    assert sorted(r["asset_id"] for r in pagina["results"]) == _esperado(caso)


def test_quien_responde_dice_por_que_tambien_por_un_nombre_habitual():
    inditex = _raiz(next(a for a in ACTIVOS if a["isin"] == "ES0148396007"))
    assert repo._match_reasons(inditex, "Inditex") == ["matched:nombre_habitual"]
    assert repo._match_reasons(inditex, "ITX") == ["matched:itx"]
    assert repo._match_reasons(inditex, "Pictet") == []
    assert repo._match_reasons(inditex, "") == ["default_result"]


def test_lo_exacto_va_delante_en_la_primera_pagina():
    pagina = repo.search_assets_page(Lector(), "SAN", None, 60)
    # Por id, Grupo San Jose iria segundo y Artisan tercero; Sanofi, delante de los dos.
    assert [r["asset_id"] for r in pagina["results"]] == ["ES0113900J37", "FR0000120578", "ES0180918015", "IE00B4M6YD48"]


def test_lo_exacto_no_se_repite_ni_se_pierde_al_pasar_de_pagina():
    primera = repo.search_assets_page(Lector(), "SAN", None, 3)
    assert [r["asset_id"] for r in primera["results"]] == ["ES0113900J37", "FR0000120578", "ES0180918015"]
    assert primera["total_matches"] == 4
    assert primera["next_cursor"] == "ES0180918015"
    segunda = repo.search_assets_page(Lector(), "SAN", None, 3, cursor=primera["next_cursor"])
    assert [r["asset_id"] for r in segunda["results"]] == ["IE00B4M6YD48"]
    assert segunda["next_cursor"] is None


def test_si_lo_exacto_no_cabe_en_la_pagina_sigue_por_id_y_no_se_pierde_nada():
    vistos = []
    cursor = None
    for _ in range(5):
        pagina = repo.search_assets_page(Lector(), "SAN", None, 1, cursor=cursor)
        vistos += [r["asset_id"] for r in pagina["results"]]
        cursor = pagina["next_cursor"]
        if not cursor:
            break
    assert vistos == ["ES0113900J37", "ES0180918015", "FR0000120578", "IE00B4M6YD48"]


def test_el_filtro_de_tipo_sigue_mandando():
    pagina = repo.search_assets_page(Lector(), "SAN", ["FUND"], 60)
    assert [r["asset_id"] for r in pagina["results"]] == ["IE00B4M6YD48"]
    assert pagina["total_matches"] == 1
