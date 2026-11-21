# -*- coding: utf-8 -*-
"""Motor puro de «Mejorar cartera» (M1, pesos conservados) sobre series sinteticas.

Ejecuta: pytest functions_python/tests/test_improvement_engine.py
"""
import math
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from optimization.improvement_engine import (  # noqa: E402
    STATUS_INFEASIBLE, STATUS_INSUFFICIENT_DATA, STATUS_NO_IMPROVEMENT, STATUS_PROPOSAL,
    ImprovementInput, ImprovementInputError, day_ordinals, improve_portfolio, merge_thresholds, pair_statistics,
    window_metrics,
)

WEEKS = 156


def dates(n=WEEKS + 1):
    from datetime import date, timedelta
    start = date(2023, 10, 2)
    return [(start + timedelta(weeks=i)).isoformat() for i in range(n)]


def noise(i, seed):
    """Ruido determinista, de media ~0, distinto por semilla."""
    return 0.012 * math.sin(0.9 * i + seed) + 0.006 * math.cos(2.3 * i + 2 * seed)


def levels(drift, seed, n=WEEKS + 1, extra=None):
    out = [100.0]
    for i in range(1, n):
        r = drift + noise(i, seed) + (extra(i) if extra else 0.0)
        out.append(out[-1] * (1 + r))
    return out


def build(levels_by_id, weights, candidates, **kwargs):
    thresholds = merge_thresholds(kwargs.pop("thresholds", None))
    thresholds["min_observations"] = 100
    return ImprovementInput(dates=dates(), levels=levels_by_id, original_weights=weights, candidates=candidates,
                            thresholds=thresholds, **kwargs)


ORIGINAL = {"A": 0.5, "B": 0.5}
LABELS = {k: {"asset_class": "EQUITY", "region": "Global", "currency": "EUR"} for k in ("A", "B", "A2", "A3", "B2", "X")}


def test_las_metricas_de_ventana_miden_como_el_backtest():
    # CRIT-04 / ALTA-01 (16-10-2026): anios por fechas (sin fechas, semanas de 7 dias) y
    # volatilidad muestral (n-1), igual que backtest_portfolio y weekly_sampling.
    from weekly_sampling import sample_volatility
    serie = [100.0, 110.0, 99.0, 120.0]
    m = window_metrics(serie, 0, 3, risk_free_rate=0.0)
    assert m.weeks == 3
    assert m.cumulative == pytest.approx(0.2)
    assert m.cagr == pytest.approx(1.2 ** (365.2425 / 21) - 1)
    assert m.max_drawdown == pytest.approx(99 / 110 - 1)
    returns = [0.1, 99 / 110 - 1, 120 / 99 - 1]
    mean = sum(returns) / 3
    assert m.volatility == pytest.approx(math.sqrt(sum((r - mean) ** 2 for r in returns) / 2) * math.sqrt(52))
    assert m.volatility == pytest.approx(sample_volatility(returns, 52))
    with_dates = window_metrics(serie, 0, 3, risk_free_rate=0.0, ordinals=day_ordinals(dates(4)))
    assert with_dates.cagr == pytest.approx(m.cagr) and with_dates.volatility == pytest.approx(m.volatility)
    corr, te = pair_statistics(serie, serie)
    assert corr == pytest.approx(1.0) and te == pytest.approx(0.0)


def _serie_con_hueco(hueco_semanas, semanas=157, desde=60):
    """Serie semanal del 8 % anual en tiempo real con `hueco_semanas` quitadas en medio
    (caso reproducido de CRIT-04, 3 anios)."""
    from datetime import date, timedelta
    import numpy as np
    rng = np.random.default_rng(11)
    g = 1.08 ** (1 / 52.1775)
    niveles = [100.0]
    for _ in range(semanas - 1):
        niveles.append(niveles[-1] * g * (1 + rng.normal(0, 0.012)))
    fechas = [date(2023, 10, 16) + timedelta(weeks=i) for i in range(semanas)]
    keep = [i for i in range(semanas) if not (desde <= i < desde + hueco_semanas)]
    return [niveles[i] for i in keep], [fechas[i].isoformat() for i in keep]


def test_un_hueco_de_doce_semanas_no_cuenta_como_una_semana():
    from weekly_sampling import sample_volatility
    niveles, fechas = _serie_con_hueco(12)
    ordinales = day_ordinals(fechas)
    m = window_metrics(niveles, 0, len(niveles) - 1, 0.02, ordinales)
    dias = ordinales[-1] - ordinales[0]
    por_fechas = (niveles[-1] / niveles[0]) ** (365.2425 / dias) - 1
    assert m.cagr == pytest.approx(por_fechas, abs=1e-9)
    assert round(m.cagr * 100, 2) == 9.07  # el motor antiguo daba 9,83 %
    # El salto de 13 semanas sobre el hueco no entra en la volatilidad.
    validos = [niveles[i + 1] / niveles[i] - 1 for i in range(len(niveles) - 1)
               if ordinales[i + 1] - ordinales[i] <= 14]
    assert len(validos) == len(niveles) - 2
    assert m.volatility == pytest.approx(sample_volatility(validos, 52))
    assert m.sharpe == pytest.approx((m.cagr - 0.02) / m.volatility)
    # Sin hueco, mismo CAGR por fechas: el hueco no lo mueve.
    sin_hueco, fechas0 = _serie_con_hueco(0)
    m0 = window_metrics(sin_hueco, 0, len(sin_hueco) - 1, 0.02, day_ordinals(fechas0))
    assert round(m0.cagr * 100, 2) == 9.07
    # La correlacion y el tracking error tampoco cuentan el salto.
    otra = [v * (1.001 if i % 2 else 0.999) for i, v in enumerate(niveles)]
    _corr, te_fechas = pair_statistics(niveles, otra, ordinales)
    _corr, te_puntos = pair_statistics(niveles, otra)
    assert te_fechas != pytest.approx(te_puntos)


def test_fechas_no_crecientes_son_entrada_invalida():
    datos = build({"A": levels(0.001, 1), "B": levels(0.001, 2)}, ORIGINAL, {})
    datos.dates = list(reversed(datos.dates))
    with pytest.raises(ImprovementInputError):
        improve_portfolio(datos)


def test_candidato_equivalente_y_mejor_produce_propuesta_valida():
    data = build(
        {"A": levels(0.0010, 1), "B": levels(0.0008, 2), "A2": levels(0.0022, 1)},
        ORIGINAL, {"A": ["A2"]}, labels=LABELS, costs={"A": 0.015, "B": 0.012, "A2": 0.009},
    )
    out = improve_portfolio(data)
    assert out["status"] == STATUS_PROPOSAL
    assert out["search"] == "EXHAUSTIVE"
    proposal = out["proposals"][0]
    assert proposal["valid"] is True
    assert [s["from_asset_id"] for s in proposal["substitutions"]] == ["A"]
    assert proposal["substitutions"][0]["to_asset_id"] == "A2"
    assert proposal["substitutions"][0]["weight"] == pytest.approx(0.5)
    assert proposal["substitutions"][0]["correlation"] > 0.95
    assert proposal["weights"] == {"A2": pytest.approx(0.5), "B": pytest.approx(0.5)}
    assert proposal["deltas_confirmation"]["cagr"] > 0
    assert {i["key"] for i in proposal["improvements"]} >= {"cagr", "cost"}
    assert all(c["status"] != "FAIL" for c in proposal["validation"])
    assert proposal["weighted_cost"] == pytest.approx(0.0105)
    assert out["original"]["weighted_cost"] == pytest.approx(0.0135)
    assert out["windows"]["selection"]["weeks"] + out["windows"]["confirmation"]["weeks"] == WEEKS


def test_sin_mejora_cuando_el_candidato_es_peor_y_el_original_se_conserva():
    data = build({"A": levels(0.0010, 1), "B": levels(0.0008, 2), "A2": levels(0.0002, 1)}, ORIGINAL, {"A": ["A2"]}, labels=LABELS)
    out = improve_portfolio(data)
    assert out["status"] == STATUS_NO_IMPROVEMENT
    assert out["proposals"] == []
    assert "reason" in out


def test_candidato_poco_correlacionado_se_descarta_con_motivo_aunque_rinda_mas():
    data = build({"A": levels(0.0010, 1), "B": levels(0.0008, 2), "X": levels(0.0030, 9)}, ORIGINAL, {"A": ["X"]}, labels=LABELS)
    out = improve_portfolio(data)
    assert out["status"] == STATUS_INFEASIBLE
    rejected = out["rejected_candidates"]["A"]
    assert rejected[0]["asset_id"] == "X"
    assert rejected[0]["reason"] in ("LOW_CORRELATION", "HIGH_TRACKING_ERROR")


def test_posicion_bloqueada_y_maximo_de_sustituciones():
    series = {"A": levels(0.0010, 1), "B": levels(0.0008, 2), "A2": levels(0.0022, 1), "B2": levels(0.0020, 2)}
    locked = improve_portfolio(build(series, ORIGINAL, {"A": ["A2"], "B": ["B2"]}, labels=LABELS, locked={"A"}))
    assert locked["status"] == STATUS_PROPOSAL
    assert all(s["from_asset_id"] == "B" for p in locked["proposals"] for s in p["substitutions"])
    one = improve_portfolio(build(series, ORIGINAL, {"A": ["A2"], "B": ["B2"]}, labels=LABELS, thresholds={"max_substitutions": 1}))
    assert all(len(p["substitutions"]) == 1 for p in one["proposals"])
    both = improve_portfolio(build(series, ORIGINAL, {"A": ["A2"], "B": ["B2"]}, labels=LABELS))
    # Con menos cambios primero: la de un solo cambio precede a la de dos.
    assert [len(p["substitutions"]) for p in both["proposals"]] == sorted(len(p["substitutions"]) for p in both["proposals"])
    assert any(len(p["substitutions"]) == 2 for p in both["proposals"])


def test_gana_en_seleccion_pero_pierde_en_confirmacion_no_es_valida():
    sel_end = round(WEEKS * 2 / 3)
    boost = lambda i: 0.0020 if i <= sel_end else -0.0045  # noqa: E731
    data = build({"A": levels(0.0010, 1), "B": levels(0.0008, 2), "A2": levels(0.0010, 1, extra=boost)}, ORIGINAL, {"A": ["A2"]}, labels=LABELS)
    out = improve_portfolio(data)
    assert out["status"] == STATUS_NO_IMPROVEMENT
    assert "confirmación" in out["reason"]
    assert out["best_rejected"]["substitutions"][0]["to_asset_id"] == "A2"


def test_sin_serie_de_una_posicion_original_es_datos_insuficientes():
    data = build({"A": levels(0.0010, 1), "A2": levels(0.0022, 1)}, ORIGINAL, {"A": ["A2"]}, labels=LABELS)
    out = improve_portfolio(data)
    assert out["status"] == STATUS_INSUFFICIENT_DATA
    assert out["missing_assets"] == ["B"]


def test_misma_serie_y_coste_menor_es_mejora_por_coste_y_coste_mayor_falla_la_puerta():
    series = {"A": levels(0.0010, 1), "B": levels(0.0008, 2), "A2": levels(0.0010, 1)}
    cheaper = improve_portfolio(build(series, ORIGINAL, {"A": ["A2"]}, labels=LABELS, costs={"A": 0.018, "B": 0.010, "A2": 0.006}))
    assert cheaper["status"] == STATUS_PROPOSAL
    assert [i["key"] for i in cheaper["proposals"][0]["improvements"]] == ["cost"]
    dearer = improve_portfolio(build(series, ORIGINAL, {"A": ["A2"]}, labels=LABELS, costs={"A": 0.006, "B": 0.010, "A2": 0.018}))
    assert dearer["status"] == STATUS_NO_IMPROVEMENT
    assert "Coste corriente ponderado" in dearer["best_rejected"]["failed"]
    unknown = improve_portfolio(build(series, ORIGINAL, {"A": ["A2"]}, labels=LABELS, costs={"A": 0.018, "B": None, "A2": 0.006}))
    # Sin coste de B no hay coste de la cartera: el cambio se mide y no empeora, pero sin esa cifra el coste no cuenta como mejora.
    assert unknown["status"] == STATUS_NO_IMPROVEMENT


def _criterio_de_coste(salida, propuesta=0):
    return next(c for c in salida["proposals"][propuesta]["validation"] if c["key"] == "cost")


SERIES_QUE_MEJORA = {"A": levels(0.0010, 1), "B": levels(0.0008, 2), "A2": levels(0.0022, 1)}


def test_decision_77_un_cambio_mas_caro_no_pasa_aunque_falte_el_coste_de_lo_que_no_se_toca():
    # Mejora la rentabilidad y sube el coste. A pesa 0,5: 0,5 x (1,20 - 1,00) = +0,10 pp en la cartera, sea cual sea el coste de B.
    salida = improve_portfolio(build(SERIES_QUE_MEJORA, ORIGINAL, {"A": ["A2"]}, labels=LABELS, costs={"A": 0.010, "B": None, "A2": 0.012}))
    assert salida["status"] == STATUS_NO_IMPROVEMENT
    assert "Coste corriente ponderado" in salida["best_rejected"]["failed"]
    assert salida["original"]["weighted_cost"] is None


def test_decision_77_un_cambio_mas_barato_pasa_y_la_frase_dice_lo_que_falta_y_que_no_se_toca():
    # 0,5 x (0,80 - 1,00) = -0,10 pp. El coste de la cartera sigue sin dato en las dos columnas: solo se mide el criterio.
    salida = improve_portfolio(build(SERIES_QUE_MEJORA, ORIGINAL, {"A": ["A2"]}, labels=LABELS, names={"B": "Fondo sin dato"},
                                     costs={"A": 0.010, "B": None, "A2": 0.008}))
    assert salida["status"] == STATUS_PROPOSAL
    criterio = _criterio_de_coste(salida)
    assert criterio["status"] == "PASS"
    assert criterio["detail"] == "-0.10 pp en los fondos que se sustituyen. Falta el coste de Fondo sin dato, que no se toca: el de la cartera queda sin dato"
    assert salida["original"]["weighted_cost"] is None
    assert salida["proposals"][0]["weighted_cost"] is None
    assert "cost" not in {i["key"] for i in salida["proposals"][0]["improvements"]}


def test_decision_77_con_todos_los_datos_mide_lo_mismo_que_la_diferencia_de_la_cartera():
    salida = improve_portfolio(build(SERIES_QUE_MEJORA, ORIGINAL, {"A": ["A2"]}, labels=LABELS, costs={"A": 0.015, "B": 0.012, "A2": 0.009}))
    criterio = _criterio_de_coste(salida)
    assert criterio["status"] == "PASS"
    # 0,5 x (0,90 - 1,50) = -0,30 pp, y 1,05 - 1,35 = -0,30 pp.
    assert criterio["detail"] == "-0.30 pp"
    assert salida["proposals"][0]["weighted_cost"] - salida["original"]["weighted_cost"] == pytest.approx(-0.003)


def test_decision_77_igual_de_caro_no_es_mas_caro():
    salida = improve_portfolio(build(SERIES_QUE_MEJORA, ORIGINAL, {"A": ["A2"]}, labels=LABELS, costs={"A": 0.0123, "B": 0.0077, "A2": 0.0123}))
    assert salida["status"] == STATUS_PROPOSAL
    assert _criterio_de_coste(salida)["status"] == "PASS"


def test_decision_77_sin_el_coste_de_lo_que_entra_o_sale_sigue_sin_evaluar_y_lo_dice():
    entra = improve_portfolio(build(SERIES_QUE_MEJORA, ORIGINAL, {"A": ["A2"]}, labels=LABELS, names={"A2": "Sustituto sin dato"},
                                    costs={"A": 0.010, "B": 0.010, "A2": None}))
    assert entra["status"] == STATUS_PROPOSAL
    assert _criterio_de_coste(entra) == {"key": "cost", "label": "Coste corriente ponderado", "status": "NOT_EVALUABLE",
                                         "detail": "Falta el coste de Sustituto sin dato, que entra en el cambio: no evaluable."}
    sale = improve_portfolio(build(SERIES_QUE_MEJORA, ORIGINAL, {"A": ["A2"]}, labels=LABELS, names={"A": "Fondo sin dato"},
                                   costs={"A": None, "B": 0.010, "A2": 0.010}))
    assert _criterio_de_coste(sale)["status"] == "NOT_EVALUABLE"
    assert "Fondo sin dato" in _criterio_de_coste(sale)["detail"]


def test_desviacion_de_exposicion_por_region_bloquea_la_propuesta():
    labels = dict(LABELS)
    labels["A2"] = {"asset_class": "EQUITY", "region": "Asia", "currency": "EUR"}
    data = build({"A": levels(0.0010, 1), "B": levels(0.0008, 2), "A2": levels(0.0022, 1)}, ORIGINAL, {"A": ["A2"]}, labels=labels)
    out = improve_portfolio(data)
    assert out["status"] == STATUS_NO_IMPROVEMENT
    assert "Exposición por región" in out["best_rejected"]["failed"]


def test_umbrales_desconocidos_se_ignoran_y_los_conocidos_se_aplican():
    t = merge_thresholds({"max_substitutions": 2, "min_correlation": {"EQUITY": 0.99}, "selection_fraction": 5, "foo": 1})
    assert t["max_substitutions"] == 2
    assert t["min_correlation"]["EQUITY"] == 0.99 and t["min_correlation"]["DEFAULT"] == 0.65
    assert t["selection_fraction"] == pytest.approx(2 / 3)
    assert "foo" not in t


def test_series_desalineadas_o_sin_pesos_son_entrada_invalida():
    with pytest.raises(ImprovementInputError):
        improve_portfolio(build({"A": levels(0.001, 1), "B": levels(0.001, 2)[:-5], "A2": levels(0.002, 1)}, ORIGINAL, {"A": ["A2"]}))
    with pytest.raises(ImprovementInputError):
        improve_portfolio(build({"A": levels(0.001, 1)}, {"A": 0}, {}))


def test_otra_clase_del_mismo_fondo_no_consume_sustitucion_y_se_marca():
    series = {"A": levels(0.0010, 1), "B": levels(0.0008, 2), "A_CLASE": levels(0.0011, 1), "B2": levels(0.0020, 2)}
    data = build(series, ORIGINAL, {"A": ["A_CLASE"], "B": ["B2"]}, labels=LABELS,
                 costs={"A": 0.018, "B": 0.012, "A_CLASE": 0.006, "B2": 0.010}, thresholds={"max_substitutions": 1})
    data.free_candidates = {"A": {"A_CLASE"}}
    out = improve_portfolio(data)
    assert out["status"] == STATUS_PROPOSAL
    # La primera propuesta es la de menos sustituciones CONTADAS: solo el cambio de clase.
    first = {s["from_asset_id"]: s for s in out["proposals"][0]["substitutions"]}
    assert set(first) == {"A"} and first["A"]["same_fund_class"] is True
    # Con un solo cambio permitido caben los dos: el de clase es gratis.
    both = next(p for p in out["proposals"] if {s["from_asset_id"] for s in p["substitutions"]} == {"A", "B"})
    subs = {s["from_asset_id"]: s for s in both["substitutions"]}
    assert subs["A"]["same_fund_class"] is True and subs["B"]["same_fund_class"] is False
    sin_gratis = improve_portfolio(build(series, ORIGINAL, {"A": ["A_CLASE"], "B": ["B2"]}, labels=LABELS,
                                         costs={"A": 0.018, "B": 0.012, "A_CLASE": 0.006, "B2": 0.010}, thresholds={"max_substitutions": 1}))
    assert all(len(p["substitutions"]) == 1 for p in sin_gratis["proposals"])



def test_una_ventana_de_menos_de_tres_semanas_falla_con_su_motivo_y_no_da_ceros():
    """OPT-6 (auditoria del 16-11-2026): con ceros, las puertas de `gates` pasaban solas («la volatilidad no sube»)."""
    import pytest as _pytest
    from optimization.improvement_engine import window_metrics as _wm
    for niveles, inicio, fin in (([100.0, 101.0], 0, 1), ([100.0], 0, 0), ([0.0, 1.0, 2.0], 0, 2)):
        with _pytest.raises(ValueError, match="al menos tres observaciones"):
            _wm(niveles, inicio, fin, 0.02)
    # Con tres semanas ya mide: de 100 a 121 en dos semanas son un 21 % acumulado.
    assert _wm([100.0, 110.0, 121.0], 0, 2, 0.0).cumulative == _pytest.approx(0.21)
