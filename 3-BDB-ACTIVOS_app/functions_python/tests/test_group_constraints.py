# -*- coding: utf-8 -*-
"""Fase 2: constraints de grupo en robust_engine (add_sector_constraints apilables + feasibility)."""
import os
import sys
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from optimization import robust_engine as re  # noqa: E402
from tests.test_robust_engine import _universe  # noqa: E402


def _universe_de_cuatro():
    ids, M = _universe(seed=5, nrf=2, nrv=2)
    return ids, M


def _labeled(seed=3, n_rv=6, n_rf=6):
    ids, M = _universe(seed=seed, nrf=n_rf, nrv=n_rv)
    ac = {i: ("RV" if i.startswith("RV") else "RF") for i in ids}
    return ids, M, ac


def _sum(weights, pred):
    return sum(w for a, w in weights.items() if pred(a))


def test_asset_class_cap_respected():
    ids, M, ac = _labeled()
    gc = [{"dimension": "asset_class", "mapper": ac, "upper": {"RV": 0.40}}]
    r = re.solve(ids, M, risk_slider=8, group_constraints=gc)
    for pt in (r["min_volatility_portfolio"], r["max_sharpe_portfolio"], r["target_portfolio"]):
        assert _sum(pt["weights"], lambda a: a.startswith("RV")) <= 0.40 + 1e-4
    for p in r["frontier"]:
        assert _sum(p["weights"], lambda a: a.startswith("RV")) <= 0.40 + 1e-4
    assert r["methodology_extra"]["optimizer"] == "QP"
    assert r["methodology_extra"].get("group_constraints_applied")


def test_asset_class_floor_respected():
    ids, M, ac = _labeled()
    gc = [{"dimension": "asset_class", "mapper": ac, "lower": {"RF": 0.30}}]
    r = re.solve(ids, M, risk_slider=8, group_constraints=gc)
    assert _sum(r["target_portfolio"]["weights"], lambda a: a.startswith("RF")) >= 0.30 - 1e-4


def test_two_dimensions_stack():
    ids, M, ac = _labeled()
    cur = {i: ("USD" if idx % 2 == 0 else "EUR") for idx, i in enumerate(ids)}
    gc = [{"dimension": "asset_class", "mapper": ac, "upper": {"RV": 0.50}},
          {"dimension": "currency", "mapper": cur, "upper": {"USD": 0.30}}]
    r = re.solve(ids, M, risk_slider=9, group_constraints=gc)
    tp = r["target_portfolio"]["weights"]
    assert _sum(tp, lambda a: a.startswith("RV")) <= 0.50 + 1e-4
    assert _sum(tp, lambda a: cur[a] == "USD") <= 0.30 + 1e-4


def test_infeasible_constraints_are_rejected():
    ids, M, ac = _labeled()
    gc = [{"dimension": "asset_class", "mapper": ac, "lower": {"RV": 0.6}, "upper": {"RV": 0.1}}]
    with pytest.raises(re.WeightConstraintError) as error:
        re.solve(ids, M, risk_slider=5, group_constraints=gc)
    assert str(error.value) == "Sin solución: RV (clase de activo) pide un mínimo del 60,0 % y un máximo del 10,0 %."


def test_los_maximos_por_grupo_no_llegan_al_cien():
    """Doce activos con su tope del 25 %: RV llega al 10 % y RF al 50 %, luego la cartera se queda en el 60 %."""
    ids, M, ac = _labeled()
    gc = [{"dimension": "asset_class", "mapper": ac, "upper": {"RV": 0.10, "RF": 0.50}}]
    with pytest.raises(re.WeightConstraintError) as error:
        re.solve(ids, M, risk_slider=5, group_constraints=gc)
    assert str(error.value) == (
        "Sin solución: con los máximos por clase de activo (RF 50,0 %, RV 10,0 %) y el tope de cada posición, "
        "la cartera solo llega al 60,0 %. Sube alguno de esos máximos."
    )


def test_un_minimo_de_grupo_que_sus_posiciones_no_alcanzan():
    """Un solo activo en el grupo, con un máximo del 25 % por posición: un mínimo del 40 % no cabe."""
    ids, M, _ = _labeled()
    grupo = {a: ("uno" if a == ids[0] else "resto") for a in ids}
    gc = [{"dimension": "currency", "mapper": grupo, "lower": {"uno": 0.40}}]
    with pytest.raises(re.WeightConstraintError) as error:
        re.solve(ids, M, risk_slider=5, max_weight=0.25, group_constraints=gc)
    assert str(error.value) == "Sin solución: uno (divisa) pide un mínimo del 40,0 %, y sus posiciones, con su tope, solo llegan al 25,0 %."


def test_los_minimos_por_grupo_pasan_del_cien():
    ids, M, ac = _labeled()
    gc = [{"dimension": "asset_class", "mapper": ac, "lower": {"RV": 0.70, "RF": 0.50}}]
    with pytest.raises(re.WeightConstraintError) as error:
        re.solve(ids, M, risk_slider=5, group_constraints=gc)
    assert str(error.value) == "Sin solución: los mínimos por clase de activo, con los candados, suman 120,0 %, más del 100 %."


def test_dos_dimensiones_que_solo_chocan_juntas_lo_dicen_sin_culpar_a_una():
    """Cada una cabe sola; juntas, no. Cuatro activos: A (RV, USD), B (RV, EUR), C (RF, USD), D (RF, EUR), con un maximo del 40 % por
    activo. Un maximo del 20 % en RF deja al menos un 80 % en A + B, asi que A y B van los dos al 40 %. Y un maximo del 20 % en USD deja
    A en el 20 % como mucho, con lo que A + B no pasa del 60 %."""
    ids, M = _universe_de_cuatro()
    clase = {ids[0]: "RV", ids[1]: "RV", ids[2]: "RF", ids[3]: "RF"}
    divisa = {ids[0]: "USD", ids[1]: "EUR", ids[2]: "USD", ids[3]: "EUR"}
    gc = [{"dimension": "asset_class", "mapper": clase, "upper": {"RF": 0.20}},
          {"dimension": "currency", "mapper": divisa, "upper": {"USD": 0.20}}]
    with pytest.raises(re.WeightConstraintError) as error:
        re.solve(ids, M, risk_slider=5, max_weight=0.40, group_constraints=gc)
    assert str(error.value) == (
        "Sin solución: ninguna cartera cumple a la vez estos límites por grupo "
        "(clase de activo: RF máximo 20,0 %; divisa: USD máximo 20,0 %), los topes y los candados. Quita o suaviza alguno."
    )


def test_una_etiqueta_sin_clasificar_no_sale_en_crudo():
    ids, M, _ = _labeled()
    grupo = {a: "UNKNOWN" for a in ids}
    gc = [{"dimension": "region", "mapper": grupo, "upper": {"UNKNOWN": 0.30}}]
    with pytest.raises(re.WeightConstraintError) as error:
        re.solve(ids, M, risk_slider=5, group_constraints=gc)
    assert "UNKNOWN" not in str(error.value)
    assert str(error.value).startswith("Sin solución: con los máximos por región (sin clasificar 30,0 %)")


def test_las_clases_de_la_base_nueva_se_dicen_en_palabras():
    ids, M, _ = _labeled()
    clase = {i: ("EQUITY" if i.startswith("RV") else "FIXED_INCOME") for i in ids}
    gc = [{"dimension": "asset_class", "mapper": clase, "upper": {"EQUITY": 0.10, "FIXED_INCOME": 0.20}}]
    with pytest.raises(re.WeightConstraintError) as error:
        re.solve(ids, M, risk_slider=5, group_constraints=gc)
    assert str(error.value) == (
        "Sin solución: con los máximos por clase de activo (Renta variable 10,0 %, Renta fija 20,0 %) y el tope de cada posición, "
        "la cartera solo llega al 30,0 %. Sube alguno de esos máximos."
    )


def test_rentabilidad_objetivo_inalcanzable():
    ids, M, _ = _labeled()
    with pytest.raises(re.WeightConstraintError, match="Sin solución: con un tope del .* la media de la serie llega como mucho a un .*, y has pedido un 500,00 %"):
        re.solve(ids, M, objective="TARGET_RETURN", target_return=5.0)


def test_group_exposures_present_and_sum_one():
    ids, M, ac = _labeled()
    gc = [{"dimension": "asset_class", "mapper": ac, "upper": {"RV": 0.5}}]
    r = re.solve(ids, M, risk_slider=6, group_constraints=gc)
    exp = r["diagnostics"].get("group_exposures", {}).get("asset_class")
    assert exp is not None and abs(sum(exp.values()) - 1.0) < 1e-3


def test_no_group_constraints_no_group_keys():
    ids, M, _ = _labeled()
    r = re.solve(ids, M, risk_slider=5)
    assert "group_constraints_applied" not in r["methodology_extra"]
    assert "group_exposures" not in r["diagnostics"]
