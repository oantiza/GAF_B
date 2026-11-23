"""
Test de carteras app-owned con un store falso (sin Firestore).
Ejecuta: `python functions_python/tests/test_portfolios.py`
"""
import sys
import os
import math

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from portfolios import repository as P


class FakeStore:
    def __init__(self):
        self.data = {}

    def save(self, uid, pid, doc):
        self.data.setdefault(uid, {})[pid] = doc

    def list(self, uid):
        return list(self.data.get(uid, {}).values())

    def get(self, uid, pid):
        return self.data.get(uid, {}).get(pid)

    def delete(self, uid, pid):
        return self.data.get(uid, {}).pop(pid, None) is not None


ok = 0


def check(c, m):
    global ok
    assert c, "FALLO: " + m
    ok += 1
    print("  ok:", m)


def run():
    global ok
    ok = 0
    s = FakeStore()
    res = P.save_portfolio(s, "user1", {
        "name": "Mi cartera", "base_currency": "EUR",
        "total_capital": 250000,
        "positions": [
            {
                "asset_id": "BE0946564383", "weight_percent": 60, "label": "DPAM",
                "keep_euros": True, "target_euros": 150000,
                "metrics": {"x": 1}, "costs": {"y": 2},
            },
            {"asset_id": "EODHD_EEM.US", "weight_percent": 40},
        ]}, now="2026-06-22T00:00:00Z")
    pid = res["portfolio_id"]
    check(bool(pid), "save devuelve portfolio_id")
    doc = s.get("user1", pid)
    check(doc["positions"][0] == {
        "asset_id": "BE0946564383", "weight_percent": 60.0,
        "keep_euros": True, "target_euros": 150000.0,
    }, "posicion saneada con bloqueo en euros; el nombre para mostrar (label) es dato maestro y no se guarda")
    check(doc["total_capital"] == 250000.0, "capital total app-owned persistido")
    check("metrics" not in doc["positions"][0] and "costs" not in doc["positions"][0], "datos maestros DESCARTADOS")
    check(doc["owner_uid"] == "user1" and doc["source_kind"] == "BDB_APP_OWNED", "owner_uid + source app-owned")
    check(res["schema_version"] == "portfolios.v2" and res["portfolio"] == doc, "save confirma documento persistido")
    check(res["warnings"] == [], "pesos 100 -> sin warning")

    r2 = P.save_portfolio(s, "user1", {"positions": [{"asset_id": "A", "weight_percent": 70}]}, now="t")
    check(r2["warnings"] and r2["warnings"][0]["code"] == "WEIGHTS_NOT_100", "pesos !=100 -> warning")

    r3 = P.save_portfolio(s, "user1", {
        "positions": [{"asset_id": "A", "weight": 0.6}, {"asset_id": "B", "weight": 0.4}]
    }, now="t")
    legacy = s.get("user1", r3["portfolio_id"])
    check(legacy["positions"][0]["weight_percent"] == 60.0 and r3["warnings"] == [], "weight decimal legacy -> porcentaje")

    check(len(P.list_portfolios(s, "user1")) == 3, "user1 ve sus 3 carteras")
    check(P.list_portfolios(s, "user2") == [], "user2 no ve nada (aislamiento)")
    check(P.get_portfolio(s, "user2", pid) is None, "user2 no puede leer cartera de user1")

    P.save_portfolio(s, "user1", {"portfolio_id": pid, "name": "Renombrada", "positions": []}, now="t2")
    check(P.get_portfolio(s, "user1", pid)["name"] == "Renombrada", "update por portfolio_id")
    check(len(P.list_portfolios(s, "user1")) == 3, "update no crea duplicado")
    check(P.list_portfolios(s, "user1")[0]["portfolio_id"] == pid, "list ordena por actualizacion descendente")

    check(P.delete_portfolio(s, "user1", pid)["ok"] is True, "delete existente -> ok")
    check(P.delete_portfolio(s, "user1", "NO")["ok"] is False, "delete inexistente -> ok False")

    print(f"\nPORTFOLIOS OK: {ok} comprobaciones pasaron.")


def test_app_owned_portfolio_contract_checks():
    run()


@pytest.mark.parametrize("positions", [
    [{"asset_id": "A/B", "weight_percent": 100}],
    [{"asset_id": "A", "weight_percent": -1}],
    [{"asset_id": "A", "weight_percent": math.nan}],
    [{"asset_id": "A", "weight_percent": 60}, {"asset_id": "A", "weight_percent": 40}],
    [{"asset_id": "A", "weight_percent": 100, "keep_euros": "yes"}],
    [{"asset_id": "A", "weight_percent": 100, "target_euros": -1}],
])
def test_invalid_positions_are_rejected_instead_of_silently_sanitized(positions):
    with pytest.raises(P.InvalidPortfolio):
        P.save_portfolio(FakeStore(), "user1", {"positions": positions})


def test_position_cap_and_document_id_are_rejected_before_firestore():
    too_many = [{"asset_id": f"A{index}", "weight_percent": 0} for index in range(P.MAX_POSITIONS + 1)]
    with pytest.raises(P.InvalidPortfolio, match="Maximo"):
        P.save_portfolio(FakeStore(), "user1", {"positions": too_many})
    with pytest.raises(P.InvalidPortfolio, match="portfolio_id"):
        P.save_portfolio(FakeStore(), "user1", {"portfolio_id": "nested/path", "positions": []})
    with pytest.raises(P.InvalidPortfolio, match="total_capital"):
        P.save_portfolio(FakeStore(), "user1", {"total_capital": math.inf, "positions": []})


@pytest.mark.parametrize("weights, warns", [
    ([33.33, 33.33, 33.33], False),   # 99,99: cuadrada en pantalla, cuadrada aqui
    ([50.0, 49.96], False),           # 99,96
    ([50.0, 50.04], False),           # 100,04
    ([50.0, 49.9], True),             # 99,90: fuera de +-0,05
    ([60.0, 40.1], True),             # 100,10
])
def test_weight_warning_uses_the_single_frontend_tolerance(weights, warns):
    """Ronda 2: misma tolerancia que src/core/weightTolerance.ts (+-0,05 puntos)."""
    positions = [{"asset_id": "A%d" % i, "weight_percent": w} for i, w in enumerate(weights)]
    out = P.save_portfolio(FakeStore(), "user1", {"positions": positions})
    assert bool(out["warnings"]) is warns
    assert P.WEIGHT_TOLERANCE_PERCENT == 0.05


# ---------- DIS-03: guardado condicionado a la fecha de modificacion con que se abrio ----------

ABIERTA_A_LAS = "2026-11-14T09:00:00+00:00"


def _guardada(store, pid="p1"):
    P.save_portfolio(store, "user1", {
        "portfolio_id": pid, "name": "Cliente", "positions": [{"asset_id": "A", "weight_percent": 100}],
    }, now=ABIERTA_A_LAS)
    return store.get("user1", pid)


def test_sin_condicion_sobrescribe_como_hasta_ahora():
    s = FakeStore()
    _guardada(s)
    P.save_portfolio(s, "user1", {"portfolio_id": "p1", "name": "Otra", "positions": []}, now="2026-11-14T10:00:00+00:00")
    P.save_portfolio(s, "user1", {"portfolio_id": "p1", "name": "Otra mas", "positions": [], "expected_updated_at": None},
                     now="2026-11-14T11:00:00+00:00")
    assert s.get("user1", "p1")["name"] == "Otra mas"


def test_con_la_condicion_correcta_guarda_y_el_campo_no_se_guarda():
    s = FakeStore()
    _guardada(s)
    res = P.save_portfolio(s, "user1", {
        "portfolio_id": "p1", "name": "Revisada", "positions": [], "expected_updated_at": ABIERTA_A_LAS,
    }, now="2026-11-14T10:00:00+00:00")
    doc = s.get("user1", "p1")
    assert doc["name"] == "Revisada"
    assert doc["updated_at"] == "2026-11-14T10:00:00+00:00"
    assert res["portfolio"]["updated_at"] == "2026-11-14T10:00:00+00:00"
    assert "expected_updated_at" not in doc


def test_con_otra_fecha_es_un_conflicto_y_la_guardada_no_cambia():
    s = FakeStore()
    antes = dict(_guardada(s))
    with pytest.raises(P.PortfolioConflict) as conflicto:
        P.save_portfolio(s, "user1", {
            "portfolio_id": "p1", "name": "Pisaria", "positions": [], "expected_updated_at": "2026-11-13T08:00:00+00:00",
        }, now="2026-11-14T10:00:00+00:00")
    assert conflicto.value.reason == "changed"
    assert conflicto.value.current_updated_at == ABIERTA_A_LAS
    assert s.get("user1", "p1") == antes


def test_sobre_una_que_no_existe_es_un_conflicto_y_no_la_crea():
    s = FakeStore()
    with pytest.raises(P.PortfolioConflict) as conflicto:
        P.save_portfolio(s, "user1", {
            "portfolio_id": "p1", "name": "Cliente", "positions": [], "expected_updated_at": ABIERTA_A_LAS,
        })
    assert conflicto.value.reason == "deleted"
    assert conflicto.value.current_updated_at is None
    assert s.get("user1", "p1") is None


@pytest.mark.parametrize("valor", [123, True, "", "   ", "x" * 65, ["2026"], {"a": 1}])
def test_una_fecha_esperada_que_no_es_una_cadena_valida_se_rechaza(valor):
    s = FakeStore()
    antes = dict(_guardada(s))
    with pytest.raises(P.InvalidPortfolio):
        P.save_portfolio(s, "user1", {"portfolio_id": "p1", "name": "X", "positions": [], "expected_updated_at": valor})
    assert s.get("user1", "p1") == antes


def test_un_conflicto_no_es_un_dato_no_valido():
    """main.py atrapa InvalidPortfolio antes: si el conflicto lo fuera, saldria como INVALID_ARGUMENT."""
    assert not issubclass(P.PortfolioConflict, P.InvalidPortfolio)


def test_con_condicion_usa_el_metodo_atomico_del_almacen_si_lo_tiene():
    llamadas = []

    class AlmacenAtomico(FakeStore):
        def save_if_unchanged(self, uid, pid, doc, expected_updated_at):
            llamadas.append((uid, pid, expected_updated_at))
            self.save(uid, pid, doc)

        def save(self, uid, pid, doc):
            super().save(uid, pid, doc)

    s = AlmacenAtomico()
    _guardada(s)
    P.save_portfolio(s, "user1", {"portfolio_id": "p1", "name": "R", "positions": [], "expected_updated_at": ABIERTA_A_LAS})
    assert llamadas == [("user1", "p1", ABIERTA_A_LAS)]


# Las pruebas de `FirestorePortfolioStore.save_if_unchanged` (el almacen de la base vieja, con un doble de Firestore) se
# fueron con el el 21-11-2026 (decision 31 del censo CENSO_BASE_VIEJA_2026-11-21.md). La misma precondicion en el de la
# base nueva la fijan test_almacen_carteras_base_nueva.py y test_guardado_condicionado_emulador.py.


@pytest.mark.parametrize("motivo, actual", [("changed", ABIERTA_A_LAS), ("deleted", None)])
def test_el_manejador_responde_al_conflicto_con_aborted_y_su_detalle(monkeypatch, motivo, actual):
    import inspect

    import main
    from firebase_functions import https_fn

    def save_que_choca(_store, _uid, _payload):
        raise P.PortfolioConflict(motivo, actual)

    monkeypatch.setattr(main, "_require_auth", lambda req, **_limites: "user1")
    monkeypatch.setattr(main, "almacen_de_carteras", lambda: FakeStore())
    monkeypatch.setattr(main.portfolios, "save_portfolio", save_que_choca)

    class _Req:
        auth = None
        app = None
        data = {"portfolio_id": "p1", "expected_updated_at": ABIERTA_A_LAS}

    with pytest.raises(https_fn.HttpsError) as error:
        inspect.unwrap(main.save_portfolio)(_Req())
    assert error.value.code == https_fn.FunctionsErrorCode.ABORTED
    assert error.value.details == {"code": "PORTFOLIO_CONFLICT", "reason": motivo, "current_updated_at": actual}
    assert error.value.message.startswith("No se ha guardado")


if __name__ == "__main__":
    run()
