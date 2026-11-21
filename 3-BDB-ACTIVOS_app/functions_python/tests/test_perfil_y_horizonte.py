# -*- coding: utf-8 -*-
"""Decision 59: nivel de perfil (1-10) y horizonte en anos de la cartera modelo.

Ausente es ausente: sin valor por defecto. Lo que no valida se rechaza con mensaje, y un cliente que no
manda la clave no borra lo guardado; quien quiere quitarlo manda null.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest  # noqa: E402

from portfolios import repository as repo  # noqa: E402
from portfolios.almacen_base_nueva import AlmacenCarterasBaseNueva, doc_de_la_app, documentos_de_la_base  # noqa: E402
from test_almacen_carteras_base_nueva import _Db  # noqa: E402

ISIN = "BE0943877671"
AHORA = "2026-11-09T10:00:00+00:00"


class _Almacen:
    def __init__(self):
        self.datos = {}

    def save(self, uid, pid, doc):
        self.datos[(uid, pid)] = doc

    def get(self, uid, pid):
        return self.datos.get((uid, pid))


def _payload(**extra):
    return {"portfolio_id": "c1", "name": "Prudente", "positions": [{"asset_id": ISIN, "weight_percent": 100}], **extra}


def test_sin_los_campos_no_hay_valor_por_defecto():
    doc = repo.sanitize_portfolio(_payload(), "u1", AHORA)
    assert "risk_profile_level" not in doc
    assert "horizon_years" not in doc


def test_guarda_los_dos_campos_validos():
    doc = repo.sanitize_portfolio(_payload(risk_profile_level=5, horizon_years=3), "u1", AHORA)
    assert doc["risk_profile_level"] == 5 and isinstance(doc["risk_profile_level"], int)
    assert doc["horizon_years"] == 3.0
    assert repo.sanitize_portfolio(_payload(risk_profile_level=10.0, horizon_years=2.5), "u1", AHORA)["risk_profile_level"] == 10


@pytest.mark.parametrize("nivel", [0, 11, -1, 5.5, "5", True, float("nan")])
def test_un_nivel_fuera_de_la_escala_se_rechaza(nivel):
    with pytest.raises(repo.InvalidPortfolio, match="nivel de perfil"):
        repo.sanitize_portfolio(_payload(risk_profile_level=nivel), "u1", AHORA)


@pytest.mark.parametrize("anos", [0, -3, "5", True, float("inf"), 101])
def test_un_horizonte_no_positivo_o_absurdo_se_rechaza(anos):
    with pytest.raises(repo.InvalidPortfolio, match="horizonte"):
        repo.sanitize_portfolio(_payload(horizon_years=anos), "u1", AHORA)


def test_null_quita_el_valor_y_la_clave_ausente_lo_conserva():
    almacen = _Almacen()
    repo.save_portfolio(almacen, "u1", _payload(risk_profile_level=7, horizon_years=5), now=AHORA)
    # Una pantalla anterior a la decision 59 no manda las claves: lo guardado sigue.
    repo.save_portfolio(almacen, "u1", _payload(), now=AHORA)
    assert almacen.get("u1", "c1")["risk_profile_level"] == 7
    assert almacen.get("u1", "c1")["horizon_years"] == 5.0
    # Quien quiere quitarlo lo dice con null, campo a campo.
    repo.save_portfolio(almacen, "u1", _payload(horizon_years=None), now=AHORA)
    assert "horizon_years" not in almacen.get("u1", "c1")
    assert almacen.get("u1", "c1")["risk_profile_level"] == 7
    repo.save_portfolio(almacen, "u1", _payload(risk_profile_level=None), now=AHORA)
    assert "risk_profile_level" not in almacen.get("u1", "c1")


def test_un_valor_guardado_que_no_valida_no_se_arrastra():
    almacen = _Almacen()
    almacen.save("u1", "c1", {"risk_profile_level": 42, "horizon_years": -1, "created_at": AHORA})
    repo.save_portfolio(almacen, "u1", _payload(), now=AHORA)
    assert "risk_profile_level" not in almacen.get("u1", "c1")
    assert "horizon_years" not in almacen.get("u1", "c1")


def test_la_base_nueva_los_guarda_en_la_raiz_con_el_mismo_nombre():
    db = _Db()
    almacen = AlmacenCarterasBaseNueva(db)
    repo.save_portfolio(almacen, "u1", _payload(risk_profile_level=4, horizon_years=3), now=AHORA)
    raiz = db.datos["portfolios/c1"]
    assert raiz["risk_profile_level"] == 4
    assert raiz["horizon_years"] == 3.0
    assert "mandate" not in raiz
    assert "risk_profile_level" not in db.datos[f"portfolios/c1/targets/{ISIN}"]
    doc = repo.get_portfolio(almacen, "u1", "c1")
    assert (doc["risk_profile_level"], doc["horizon_years"]) == (4, 3.0)
    # Guardar otra vez sin las claves (pantalla anterior) no las borra del documento de la base.
    repo.save_portfolio(almacen, "u1", _payload(), now=AHORA)
    assert db.datos["portfolios/c1"]["risk_profile_level"] == 4
    repo.save_portfolio(almacen, "u1", _payload(risk_profile_level=None, horizon_years=None), now=AHORA)
    assert "risk_profile_level" not in db.datos["portfolios/c1"]
    assert "horizon_years" not in db.datos["portfolios/c1"]


def test_sin_definir_no_escribe_nada_en_la_base():
    doc = repo.sanitize_portfolio(_payload(), "u1", AHORA)
    cartera, _ = documentos_de_la_base("u1", doc)
    assert "risk_profile_level" not in cartera and "horizon_years" not in cartera
    assert "risk_profile_level" not in doc_de_la_app(cartera, [])
