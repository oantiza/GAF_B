# -*- coding: utf-8 -*-
"""El aviso de pocas observaciones de la covarianza (`LOW_TN_OAS`), pendiente del 19-11-2026 (lo que dejo abierto la A-154).

Saltaba con T/N < 4, y el calculo admite 40 activos a 3 anos (156 semanas): T/N = 3,9, asi que salia en el tope mismo. Ahora
avisa por debajo de T/N = 2, donde el sesgo medio de la inversa de la covarianza de la muestra, (T-1)/(T-N-2), pasa del doble.
El estimador no cambia: con T/N < 4 sigue siendo OAS, y las cifras son las mismas.
"""
import os
import sys

import numpy as np
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from optimization.robust_engine import UMBRAL_DE_AVISO_T_SOBRE_N, estimate_covariance  # noqa: E402


def _retornos(semanas, activos, semilla=7):
    return np.random.default_rng(semilla).normal(0.001, 0.02, size=(semanas, activos)).tolist()


def test_el_criterio_es_el_sesgo_de_la_inversa_de_wishart():
    # Cuenta a mano de las cifras del comentario de `estimate_covariance`.
    assert (156 - 1) / (156 - 40 - 2) == pytest.approx(1.36, abs=0.005)
    assert (80 - 1) / (80 - 40 - 2) == pytest.approx(2.08, abs=0.005)
    assert UMBRAL_DE_AVISO_T_SOBRE_N == 2.0


@pytest.mark.parametrize("semanas, activos, aviso", [
    (156, 40, None),          # 3 anos en el tope del calculo: T/N = 3,9, ya no avisa
    (80, 40, None),           # T/N = 2 justo: no avisa
    (78, 40, "LOW_TN_OAS"),   # T/N = 1,95
    (156, 85, "LOW_TN_OAS"),  # la aportacion al riesgo de Simular con 85 posiciones: T/N = 1,8
])
def test_avisa_por_debajo_de_dos_observaciones_por_activo(semanas, activos, aviso):
    _matriz, meta = estimate_covariance(_retornos(semanas, activos), [f"A{i}" for i in range(activos)])
    assert meta["cov_warning"] == aviso
    # Con T/N < 4 el estimador sigue siendo OAS: el aviso cambia, la cifra no.
    assert meta["covariance_estimator"] == "OAS"
