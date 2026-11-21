# -*- coding: utf-8 -*-
"""Min. por activo en Optimizar (decision de Oscar, 14-11-2026): el motor lo respeta en cada cartera que devuelve.

La Function ya aceptaba `min_weight`; la pantalla empieza a mandarlo ahora. Estas pruebas fijan lo que la pantalla da por
hecho, con activos inventados y resultados que se saben sin el motor:

- con un minimo de 0, el optimizador deja activos fuera (como hasta ahora; el motor regularizado diversifica algo, asi que
  no se exige que el dominante se lo lleve todo, solo que alguno quede a 0);
- con un minimo m y un activo que domina a los demas, los demas quedan en m exacto y el dominante con 1 - (n-1)*m;
- con un minimo de 1/n, la unica cartera posible es la de partes iguales;
- con un minimo por encima de 1/n, no hay cartera, y se dice.
"""
import os
import sys

import numpy as np
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from optimization import robust_engine as motor  # noqa: E402

IDS = ["DOMINA", "B", "C", "D"]
TIPO_LIBRE = 0.02
HOLGURA = 1e-6


def _serie():
    """156 semanas: DOMINA rinde mucho mas con menos riesgo; B, C y D son ruido sin rentabilidad, y poco correlados."""
    rng = np.random.default_rng(14112026)
    semanas = 156
    domina = 0.004 + rng.normal(0.0, 0.008, semanas)
    resto = [rng.normal(-0.001, 0.03, semanas) for _ in range(3)]
    return np.column_stack([domina, *resto])


def _carteras(resultado):
    yield resultado["min_volatility_portfolio"]
    yield resultado["max_sharpe_portfolio"]
    for punto in resultado["frontier"]:
        yield punto


def _resolver(minimo):
    return motor.solve(IDS, _serie(), objective="MAX_SHARPE", min_weight=minimo, max_weight=1.0,
                       frontier_points=12, risk_free_rate=TIPO_LIBRE)


def test_sin_minimo_el_optimizador_deja_activos_fuera():
    pesos = _resolver(0.0)["max_sharpe_portfolio"]["weights"]
    assert pesos["DOMINA"] > 0.9
    assert sum(1 for a in IDS[1:] if pesos[a] < 1e-9) >= 1


@pytest.mark.parametrize("minimo", [0.05, 0.10, 0.20])
def test_con_minimo_los_demas_quedan_en_el_minimo_y_el_dominante_con_el_resto(minimo):
    resultado = _resolver(minimo)
    pesos = resultado["max_sharpe_portfolio"]["weights"]
    for a in IDS[1:]:
        assert pesos[a] == pytest.approx(minimo, abs=1e-4)
    assert pesos["DOMINA"] == pytest.approx(1 - 3 * minimo, abs=1e-4)
    for cartera in _carteras(resultado):
        assert min(cartera["weights"].values()) >= minimo - HOLGURA
        assert sum(cartera["weights"].values()) == pytest.approx(1.0, abs=1e-9)


def test_un_minimo_de_un_cuarto_con_cuatro_activos_deja_partes_iguales():
    resultado = _resolver(0.25)
    for cartera in _carteras(resultado):
        for a in IDS:
            assert cartera["weights"][a] == pytest.approx(0.25, abs=1e-6)


def test_un_minimo_que_no_cabe_no_se_recorta_se_dice():
    with pytest.raises(motor.WeightConstraintError, match="Sin solución"):
        _resolver(0.26)
