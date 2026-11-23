# -*- coding: utf-8 -*-
"""Servicio improve_portfolio con un lector falso: carga, alineacion y contrato.

Ejecuta: pytest functions_python/tests/test_improvement_service.py
"""
from datetime import date, timedelta
import math
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from optimization.improvement_service import MAX_IMPROVEMENT_ASSETS, improve_portfolio  # noqa: E402
from optimization.repository import InvalidOptimizationRequest, _clear_price_series_cache  # noqa: E402

FIN = date(2026, 10, 9)


@pytest.fixture(autouse=True)
def limpia_cache():
    _clear_price_series_cache()
    yield
    _clear_price_series_cache()


def raiz(asset_id, nombre, ter_pct=1.0, clase="EQUITY", region="global"):
    return {
        "asset_id": asset_id, "asset_type": "FUND",
        "identity": {"name": nombre, "currency": "EUR"},
        "classification": {"asset_class": clase, "region_primary": region},
        "costs": {"ter_pct": ter_pct},
        "quality": {"status": "ACCEPTED"},
    }


def serie(asset_id, anios, drift, seed, inicio_tardio=None):
    desde = inicio_tardio or (FIN - timedelta(days=int(anios * 365.25)))
    dia = desde
    while dia.weekday() != 4:
        dia += timedelta(days=1)
    puntos, valor, i = [], 100.0, 0
    while dia <= FIN:
        valor *= 1 + drift + 0.010 * math.sin(0.9 * i + seed)
        puntos.append({"date": dia.isoformat(), "value": round(valor, 6)})
        dia += timedelta(days=7)
        i += 1
    return [{
        "schema_version": "asset-price-series.v1.2", "asset_id": asset_id, "asset_type": "FUND", "series_type": "NAV",
        "source": "EODHD", "currency": "EUR", "interval": "1w", "points": puntos,
        "first_date": puntos[0]["date"], "last_date": puntos[-1]["date"], "observations_count": len(puntos),
    }]


class LectorFalso:
    def __init__(self, roots, series):
        self.roots, self.series, self.reads = roots, series, 0

    def get_asset(self, asset_id):
        self.reads += 1
        return self.roots.get(asset_id)

    def get_price_series(self, asset_id):
        self.reads += 1
        return self.series.get(asset_id, [])


def lector():
    roots = {
        "A": raiz("A", "Fondo A Acc", 1.5), "B": raiz("B", "Fondo B Acc", 1.2, "FIXED_INCOME"),
        "A2": raiz("A2", "Fondo A2 Acc", 0.8), "JOVEN": raiz("JOVEN", "Fondo joven Acc", 0.5),
    }
    series = {
        "A": serie("A", 4, 0.0010, 1), "B": serie("B", 4, 0.0004, 2), "A2": serie("A2", 4, 0.0022, 1),
        "JOVEN": serie("JOVEN", 4, 0.0030, 1, inicio_tardio=FIN - timedelta(days=400)),
    }
    return LectorFalso(roots, series)


def peticion(**extra):
    base = {"positions": [{"asset_id": "A", "weight": 0.6}, {"asset_id": "B", "weight": 0.4}],
            "candidates": {"A": ["A2", "JOVEN"]}, "window": "3Y"}
    base.update(extra)
    return base


def test_propuesta_con_contrato_completo_y_candidato_joven_excluido():
    out = improve_portfolio(lector(), peticion(), risk_free_resolver=lambda a, b: {"rate": 0.02, "coverage_ratio": 1.0})
    assert out["schema_version"] == "portfolio-improvement.v1"
    assert out["status"] == "PROPOSAL"
    assert out["window"] == "3Y" and out["base_currency"] == "EUR"
    assert out["risk_free"]["risk_free_rate_policy"] == "WINDOW_AVERAGE"
    assert out["coverage"]["measurement_frequency"] == "WEEKLY"
    assert out["coverage"]["common_observations"] >= 145
    assert {"asset_id": "JOVEN", "reason": "INSUFFICIENT_HISTORY"} in out["excluded_assets"]
    assert "JOVEN" not in {s["to_asset_id"] for p in out["proposals"] for s in p["substitutions"]}
    sub = out["proposals"][0]["substitutions"][0]
    assert (sub["from_asset_id"], sub["to_asset_id"], sub["from_name"], sub["to_name"]) == ("A", "A2", "Fondo A Acc", "Fondo A2 Acc")
    assert sub["weight"] == pytest.approx(0.6)
    assert out["original"]["weighted_cost"] == pytest.approx(0.6 * 0.015 + 0.4 * 0.012)
    assert out["proposals"][0]["weighted_cost"] == pytest.approx(0.6 * 0.008 + 0.4 * 0.012)
    # Las etiquetas salen de la ficha: la clase se conserva al sustituir A por A2.
    assert all(c["status"] == "PASS" for c in out["proposals"][0]["validation"] if c["key"].startswith("group_"))


def serie_diaria(asset_id, anios, drift, seed):
    """Dias laborables, con vaivenes dentro de la semana: la caida maxima diaria y la semanal no coinciden."""
    dia = FIN - timedelta(days=int(anios * 365.25))
    puntos, valor, i = [], 100.0, 0
    while dia <= FIN:
        if dia.weekday() < 5:
            valor *= 1 + drift + 0.012 * math.sin(1.7 * i + seed)
            puntos.append({"date": dia.isoformat(), "value": round(valor, 6)})
            i += 1
        dia += timedelta(days=1)
    return [{
        "schema_version": "asset-price-series.v1.2", "asset_id": asset_id, "asset_type": "FUND", "series_type": "NAV",
        "source": "EODHD", "currency": "EUR", "interval": "1d", "points": puntos,
        "first_date": puntos[0]["date"], "last_date": puntos[-1]["date"], "observations_count": len(puntos),
    }]


@pytest.mark.parametrize("window", ["3Y", "5Y"])
def test_a_la_cartera_actual_mide_lo_mismo_que_simular(window):
    """15-11-2026: «Mejorar» mide con el periodo de Simular. Misma cartera y ventana: mismas fechas y las mismas cuatro cifras de la
    ventana completa que `analyze_horizon`, tambien con una posicion que Simular aparta (JOVEN) y con la caida maxima diaria."""
    from portfolio_horizon import analyze_horizon
    roots = {"A": raiz("A", "Fondo A Acc", 1.5), "B": raiz("B", "Fondo B Acc", 1.2, "FIXED_INCOME"),
             "A2": raiz("A2", "Fondo A2 Acc", 0.8), "JOVEN": raiz("JOVEN", "Fondo joven Acc", 0.5)}
    series = {"A": serie_diaria("A", 6, 0.0003, 1), "B": serie_diaria("B", 6, 0.0001, 2), "A2": serie_diaria("A2", 6, 0.0005, 1),
              "JOVEN": serie("JOVEN", 4, 0.0030, 1, inicio_tardio=FIN - timedelta(days=400))}
    positions = [{"asset_id": "A", "weight": 0.5}, {"asset_id": "B", "weight": 0.3}, {"asset_id": "JOVEN", "weight": 0.2}]
    resolver = lambda a, b: {"rate": 0.02, "coverage_ratio": 1.0}  # noqa: E731
    mejora = improve_portfolio(LectorFalso(roots, series), {"positions": positions, "candidates": {"A": ["A2"]}, "window": window},
                               risk_free_resolver=resolver, today=FIN)
    _clear_price_series_cache()
    simular = analyze_horizon(LectorFalso(roots, series), {"window": window, "positions": positions}, risk_free_resolver=resolver, today=FIN)
    bt = simular["backtest"]
    assert (mejora["coverage"]["first_date"], mejora["coverage"]["last_date"]) == (bt["coverage"]["first_date"], bt["coverage"]["last_date"])
    assert (mejora["windows"]["full"]["first_date"], mejora["windows"]["full"]["last_date"]) == (bt["coverage"]["first_date"], bt["coverage"]["last_date"])
    full = mejora["original"]["metrics"]["full"]
    for campo in ("cagr", "volatility", "sharpe", "max_drawdown"):
        assert full[campo] == pytest.approx(bt["metrics"][campo], abs=1e-8), campo
    # Las mismas posiciones apartadas, con los mismos pesos repartidos entre lo que se mide.
    assert [e["asset_id"] for e in mejora["excluded_positions"]] == [e["asset_id"] for e in bt["excluded_assets"]] == ["JOVEN"]
    assert mejora["original"]["weights"] == pytest.approx(bt["weights_normalized"])
    assert mejora["coverage_weight_percent"] == pytest.approx(simular["coverage_weight_percent"])
    # La caida maxima diaria no es la semanal: si el motor la midiera en semanal, esta prueba no podria pasar.
    import numpy as np
    serie_cartera = np.asarray([p["value"] for p in bt["portfolio_series"]])
    semanal = serie_cartera[[i for i, d in enumerate(bt["portfolio_series"]) if date.fromisoformat(d["date"]).weekday() == 4]]
    assert float(np.min(semanal / np.maximum.accumulate(semanal) - 1)) > full["max_drawdown"] + 1e-4


def test_peticiones_invalidas():
    with pytest.raises(InvalidOptimizationRequest):
        improve_portfolio(lector(), peticion(positions=[]))
    with pytest.raises(InvalidOptimizationRequest):
        improve_portfolio(lector(), peticion(window="2Y"))
    with pytest.raises(InvalidOptimizationRequest):
        improve_portfolio(lector(), peticion(candidates=["A2"]))
    demasiados = {"A": ["C%d" % i for i in range(8)], "B": ["D%d" % i for i in range(8)]}
    assert len(demasiados["A"]) + len(demasiados["B"]) + 2 <= MAX_IMPROVEMENT_ASSETS
    out = improve_portfolio(lector(), peticion(candidates=demasiados))
    assert out["status"] == "INFEASIBLE"
    assert {e["reason"] for e in out["excluded_assets"]} == {"PRICE_SERIES_MISSING"}


def test_cartera_sin_series_utilizables_no_es_un_fallo_y_dice_quien():
    """Decision 97. Antes era un error de precondicion: un mensaje generico y «Reintentar», que no lo arregla."""
    vacio = LectorFalso({"A": raiz("A", "A"), "B": raiz("B", "B")}, {})
    out = improve_portfolio(vacio, peticion(candidates={}))
    assert out["status"] == "INSUFFICIENT_DATA"
    assert out["missing_assets"] == ["A", "B"]
    assert out["excluded_assets"] == [{"asset_id": "A", "reason": "PRICE_SERIES_MISSING"}, {"asset_id": "B", "reason": "PRICE_SERIES_MISSING"}]
    assert out["window"] == "3Y"
    assert out["proposals"] == []


# ------------------------------------------------------------------ una posicion que no cubre la ventana: como en Simular (15-11-2026)


def _con_posicion(serie_de_c, candidatos=None, window="3Y", bundle=None):
    roots = {"A": raiz("A", "Fondo A Acc", 1.5), "C": raiz("C", "Fondo C Acc", 1.0), "A2": raiz("A2", "Fondo A2 Acc", 0.8)}
    series = {"A": serie("A", 7, 0.0010, 1), "A2": serie("A2", 7, 0.0022, 1), "C": serie_de_c}
    return improve_portfolio(LectorFalso(roots, series), {
        "positions": [{"asset_id": "A", "weight": 0.6}, {"asset_id": "C", "weight": 0.4}],
        "candidates": candidatos or {"A": ["A2"]}, "window": window,
    }, risk_free_resolver=lambda a, b: {"rate": 0.02, "coverage_ratio": 1.0}, reference_bundle=bundle)


def test_b_una_posicion_que_no_cubre_ya_no_impide_el_calculo_y_sale_listada():
    """Como en Simular: un fondo de 400 dias se aparta a 3 anos, y la cartera se mide con el resto. Antes, «datos insuficientes»."""
    out = _con_posicion(serie("C", 4, 0.0010, 2, inicio_tardio=FIN - timedelta(days=400)), candidatos={"A": ["A2"], "C": ["A2"]})
    assert out["status"] in ("PROPOSAL", "NO_IMPROVEMENT")
    assert out["excluded_positions"] == [{"asset_id": "C", "reason": "INSUFFICIENT_HISTORY", "weight": pytest.approx(0.4)}]
    assert out["original"]["weights"] == {"A": 1.0}
    assert out["coverage_weight_percent"] == pytest.approx(60.0)
    # Una posicion apartada no se puede medir: no se le buscan sustitutos.
    assert "C" not in out["rejected_candidates"]
    assert all(s["from_asset_id"] != "C" for p in out["proposals"] for s in p["substitutions"])


def test_si_le_faltan_los_5_anos_dice_si_le_bastan_los_3():
    # Cuatro anos: no llega a 5 y si a 3.
    out = _con_posicion(serie("C", 4, 0.0010, 2), window="5Y")
    assert out["status"] in ("PROPOSAL", "NO_IMPROVEMENT")
    assert out["excluded_positions"] == [{"asset_id": "C", "reason": "INSUFFICIENT_HISTORY", "weight": pytest.approx(0.4), "covers_window": "3Y"}]
    assert out["excluded_assets"] == [{"asset_id": "C", "reason": "INSUFFICIENT_HISTORY", "covers_window": "3Y"}]
    # Y dos anos no llegan a ninguna: no se puede aconsejar la de 3.
    _clear_price_series_cache()
    out = _con_posicion(serie("C", 2, 0.0010, 2), window="5Y")
    assert out["excluded_positions"] == [{"asset_id": "C", "reason": "INSUFFICIENT_HISTORY", "weight": pytest.approx(0.4)}]


def test_un_fondo_con_un_hueco_de_cuatro_anos_se_aparta_como_en_simular():
    # Como AB American Growth: serie larga, y dentro de la ventana un hueco de mas de 14 dias.
    documentos = serie("C", 8, 0.0010, 2)
    corte_uno, corte_dos = (FIN - timedelta(days=1400)).isoformat(), (FIN - timedelta(days=200)).isoformat()
    documentos[0]["points"] = [p for p in documentos[0]["points"] if not corte_uno <= p["date"] <= corte_dos]
    out = _con_posicion(documentos)
    assert out["status"] in ("PROPOSAL", "NO_IMPROVEMENT")
    assert [e["asset_id"] for e in out["excluded_positions"]] == ["C"]


def test_una_sola_posicion_que_no_cubre_dice_cual_y_no_falla():
    roots = {"C": raiz("C", "C")}
    out = improve_portfolio(LectorFalso(roots, {"C": serie("C", 1, 0.001, 2)}), {
        "positions": [{"asset_id": "C", "weight": 1.0}], "candidates": {}, "window": "3Y",
    })
    assert out["status"] == "INSUFFICIENT_DATA"
    assert out["missing_assets"] == ["C"]
    assert out["excluded_positions"] == [{"asset_id": "C", "reason": "INSUFFICIENT_HISTORY", "weight": 1.0}]


def test_con_huecos_de_mas_de_14_dias_las_dos_se_apartan_y_se_dice_cuales():
    # Dos posiciones con un hueco de 40 dias cada una dentro de los 3 anos: el periodo de Simular no puentea mas de 14.
    uno, dos = serie("A", 4, 0.0010, 1), serie("B", 4, 0.0004, 2)
    fecha = lambda dias: (FIN - timedelta(days=dias)).isoformat()  # noqa: E731
    uno[0]["points"] = [p for p in uno[0]["points"] if not fecha(1000) <= p["date"] <= fecha(960)]
    dos[0]["points"] = [p for p in dos[0]["points"] if not fecha(700) <= p["date"] <= fecha(660)]
    roots = {"A": raiz("A", "A"), "B": raiz("B", "B")}
    out = improve_portfolio(LectorFalso(roots, {"A": uno, "B": dos}), {
        "positions": [{"asset_id": "A", "weight": 0.6}, {"asset_id": "B", "weight": 0.4}], "candidates": {}, "window": "3Y",
    })
    assert out["status"] == "INSUFFICIENT_DATA"
    assert out["missing_assets"] == ["A", "B"]
    assert out["excluded_assets"] == [{"asset_id": "A", "reason": "INSUFFICIENT_HISTORY"}, {"asset_id": "B", "reason": "INSUFFICIENT_HISTORY"}]


def _referencia(asset_id, inicio, semanas_antes=260):
    """Una referencia valida para `extend_history`: la de un indice que sube un 0,1 % por semana, sin ruido."""
    dia = date.fromisoformat(inicio) - timedelta(days=7 * semanas_antes)
    precios, valor = [], 100.0
    while dia.isoformat() <= inicio:
        precios.append({"date": dia.isoformat(), "value": round(valor, 6)})
        valor *= 1.001
        dia += timedelta(days=7)
    return {"version": "prueba", "assets": {asset_id: {
        "inception": inicio, "reference": "Indice de prueba", "url": "", "beta": 1.0, "prices": precios,
        "validation": {"weeks": 60, "holdout_correlation": 0.9, "holdout_rmse": 0.01, "zero_return_rmse": 0.02, "residual_volatility": 0.0},
        "weekly_log_residuals": [0.0] * 60, "reference_has_backtested_history": False,
    }}}


def test_una_posicion_con_referencia_se_completa_como_en_simular_y_un_candidato_no():
    joven = serie("C", 4, 0.0010, 2, inicio_tardio=FIN - timedelta(days=400))
    bundle = _referencia("C", joven[0]["points"][0]["date"])
    out = _con_posicion(joven, bundle=bundle)
    assert out["excluded_positions"] == []
    assert [e["asset_id"] for e in out["extensions"]] == ["C"]
    assert set(out["original"]["weights"]) == {"A", "C"}


def test_a_una_posicion_completada_con_su_referencia_no_se_le_buscan_sustitutos():
    """Pendiente del 19-11-2026 (lo que dejo abierto la A-153): C se mide con su tramo estimado, como en Simular, pero no
    recibe sustitutos; A, con historia propia, si. A2 es candidato de las dos."""
    joven = serie("C", 4, 0.0010, 2, inicio_tardio=FIN - timedelta(days=400))
    bundle = _referencia("C", joven[0]["points"][0]["date"])
    out = _con_posicion(joven, candidatos={"A": ["A2"], "C": ["A2"]}, bundle=bundle)
    assert [e["asset_id"] for e in out["extensions"]] == ["C"]
    de_c = out["rejected_candidates"]["C"]
    assert [(r["asset_id"], r["reason"], r["not_evaluable"]) for r in de_c] == [("A2", "POSITION_HISTORY_EXTENDED", True)]
    assert "completado con su referencia" in de_c[0]["detail"]
    assert all(s["from_asset_id"] != "C" for p in out["proposals"] for s in p["substitutions"])
    # A sigue buscando: su candidato no aparece rechazado por ese motivo.
    assert all(r["reason"] != "POSITION_HISTORY_EXTENDED" for r in out["rejected_candidates"].get("A", []))


def test_c_un_candidato_sin_historia_completa_queda_no_evaluable_con_su_motivo():
    """JOVEN, de 400 dias, como candidato de A: no se completa ni teniendo referencia, no tumba el calculo y queda no evaluable."""
    lect = lector()
    inicio = lect.series["JOVEN"][0]["points"][0]["date"]
    out = improve_portfolio(lect, peticion(), risk_free_resolver=lambda a, b: {"rate": 0.02, "coverage_ratio": 1.0},
                            reference_bundle=_referencia("JOVEN", inicio))
    assert out["status"] == "PROPOSAL"
    assert out["extensions"] == []
    joven = next(r for r in out["rejected_candidates"]["A"] if r["asset_id"] == "JOVEN")
    assert joven["not_evaluable"] is True and joven["reason"] == "INSUFFICIENT_HISTORY"
    assert joven["series_first_date"] == inicio
    assert "Su serie empieza el %s/%s/%s" % (inicio[8:10], inicio[5:7], inicio[:4]) in joven["detail"]
    assert "sin completarla con referencias" in joven["detail"]
    assert "JOVEN" not in {s["to_asset_id"] for p in out["proposals"] for s in p["substitutions"]}


def test_posicion_bloqueada_y_tope_de_sustituciones_llegan_al_motor():
    out = improve_portfolio(lector(), peticion(locked=["A"], max_substitutions=1))
    assert out["status"] == "INFEASIBLE"
    assert "bloquead" in out["reason"] or "candidatos" in out["reason"]


def test_same_fund_class_solo_admite_ids_que_sean_candidatos():
    out = improve_portfolio(lector(), peticion(same_fund_class={"A": ["A2", "OTRO"], "B": ["A2"]}, max_substitutions=1))
    assert out["status"] == "PROPOSAL"
    sub = out["proposals"][0]["substitutions"][0]
    assert (sub["to_asset_id"], sub["same_fund_class"]) == ("A2", True)


def accion(asset_id, nombre):
    """Como llega una accion: sin bloque de costes."""
    return {
        "asset_id": asset_id, "asset_type": "STOCK",
        "identity": {"name": nombre, "currency": "EUR"},
        "classification": {"asset_class": "EQUITY", "region_primary": "global"},
        "quality": {"status": "ACCEPTED"},
    }


def lector_con_accion(ter_del_sustituto):
    roots = {
        "A": raiz("A", "Fondo A Acc", 1.0), "B": raiz("B", "Fondo B Acc", 1.2, "FIXED_INCOME"),
        "A2": raiz("A2", "Fondo A2 Acc", ter_del_sustituto), "ACCION": accion("ACCION", "Iberdrola"),
    }
    series = {"A": serie("A", 4, 0.0010, 1), "B": serie("B", 4, 0.0004, 2), "A2": serie("A2", 4, 0.0022, 1), "ACCION": serie("ACCION", 4, 0.0008, 3)}
    return LectorFalso(roots, series)


PETICION_CON_ACCION = {
    "positions": [{"asset_id": "A", "weight": 0.5}, {"asset_id": "B", "weight": 0.3}, {"asset_id": "ACCION", "weight": 0.2}],
    "candidates": {"A": ["A2"]}, "window": "3Y",
}


def test_decision_77_una_accion_cuenta_como_cero_y_un_cambio_mas_caro_no_pasa():
    out = improve_portfolio(lector_con_accion(1.2), dict(PETICION_CON_ACCION))
    # A mano: 0,5 x 1,0 + 0,3 x 1,2 + 0,2 x 0 = 0,86 %.
    assert out["original"]["weighted_cost"] == pytest.approx(0.0086)
    assert out["status"] == "NO_IMPROVEMENT"
    assert "Coste corriente ponderado" in out["best_rejected"]["failed"]


def test_decision_77_con_una_accion_un_cambio_mas_barato_se_mide_y_pasa():
    out = improve_portfolio(lector_con_accion(0.8), dict(PETICION_CON_ACCION))
    assert out["status"] == "PROPOSAL"
    propuesta = out["proposals"][0]
    # 0,5 x 0,8 + 0,3 x 1,2 = 0,76 %, y el cambio, 0,5 x (0,8 - 1,0) = -0,10 pp.
    assert propuesta["weighted_cost"] == pytest.approx(0.0076)
    assert next(c for c in propuesta["validation"] if c["key"] == "cost")["detail"] == "-0.10 pp"


def test_decision_77_un_fondo_sin_coste_no_es_una_accion():
    lect = lector_con_accion(1.2)
    lect.roots["B"]["costs"] = {}
    out = improve_portfolio(lect, dict(PETICION_CON_ACCION))
    assert out["original"]["weighted_cost"] is None
    assert out["status"] == "NO_IMPROVEMENT"
    assert "Coste corriente ponderado" in out["best_rejected"]["failed"]


def test_decision_77_un_coste_en_una_accion_no_se_cree():
    lect = lector_con_accion(1.2)
    lect.roots["ACCION"]["costs"] = {"ter_pct": 0.9}
    out = improve_portfolio(lect, dict(PETICION_CON_ACCION))
    assert out["original"]["weighted_cost"] == pytest.approx(0.0086)


# ------------------------------------------------------------------ periodo de Simular: tramos, tipo libre y tope (15-11-2026)


def _alterna(asset_id):
    """Cada viernes, un +1 % y un 0 % alternos: una serie con cifras que se calculan a mano."""
    dia = FIN - timedelta(days=7 * 300)
    puntos, valor, i = [], 100.0, 0
    while dia <= FIN:
        puntos.append({"date": dia.isoformat(), "value": round(valor, 10)})
        valor *= 1.01 if i % 2 == 0 else 1.0
        dia += timedelta(days=7)
        i += 1
    return [{"schema_version": "asset-price-series.v1.2", "asset_id": asset_id, "asset_type": "FUND", "series_type": "NAV",
             "source": "EODHD", "currency": "EUR", "interval": "1w", "points": puntos,
             "first_date": puntos[0]["date"], "last_date": puntos[-1]["date"], "observations_count": len(puntos)}]


def test_los_dias_de_cada_tramo_con_la_division_por_defecto():
    """A mano. Fin: viernes 09/10/2026. A 3 anos el inicio es el viernes 06/10/2023: 1.099 dias, 157 semanas; la seleccion
    acaba en la semana round(157 x 2/3) = 105, 735 dias, y la confirmacion son 52 semanas, 364 dias. A 5 anos, del viernes
    08/10/2021: 1.827 dias, 261 semanas; round(261 x 2/3) = 174 semanas, 1.218 dias, y 87 de confirmacion, 609 dias. Los dos
    tramos pasan de 330 en las dos ventanas."""
    esperado = {"3Y": ("2023-10-06", 1099, 735, 364), "5Y": ("2021-10-08", 1827, 1218, 609)}
    for window, (inicio, total, seleccion, confirmacion) in esperado.items():
        _clear_price_series_cache()
        out = improve_portfolio(LectorFalso({"A": raiz("A", "A")}, {"A": _alterna("A")}),
                                {"positions": [{"asset_id": "A", "weight": 1}], "candidates": {}, "window": window}, today=FIN)
        ventanas = out["windows"]
        assert (ventanas["full"]["first_date"], ventanas["full"]["last_date"]) == (inicio, FIN.isoformat())
        assert (ventanas["full"]["days"], ventanas["selection"]["days"], ventanas["confirmation"]["days"]) == (total, seleccion, confirmacion)


def test_d_cada_tramo_usa_el_estr_de_sus_fechas():
    """Hallazgo 9. El €STR de prueba depende de las fechas que se piden: 1 % en la seleccion, 3 % en la confirmacion, 2 % en la ventana.

    A mano, la confirmacion: 52 semanas, 364 dias, 26 de +1 % y 26 de 0 %.
      rentabilidad anual = (1,01^26)^(365,2425/364) - 1 = 1,2952563^1,0033310 - 1 = 0,2964007
      volatilidad = raiz(52) x raiz(52/51) x 0,005 = 0,0364073   (media 0,005, cada semana a 0,005 de ella, muestral)
      Sharpe = (0,2964007 - 0,03) / 0,0364073 = 7,3172   (con el 2 % de la ventana entera seria 7,5919)
    """
    pedidos = []

    def estr(primera, ultima):
        pedidos.append((primera, ultima))
        if ultima < "2026-01-01":
            rate = 0.01  # seleccion: acaba en 2025
        elif primera < "2025-01-01":
            rate = 0.02  # ventana completa
        else:
            rate = 0.03  # confirmacion
        return {"rate": rate, "coverage_ratio": 1.0}

    out = improve_portfolio(LectorFalso({"A": raiz("A", "A")}, {"A": _alterna("A")}),
                            {"positions": [{"asset_id": "A", "weight": 1}], "candidates": {}, "window": "3Y"}, risk_free_resolver=estr, today=FIN)
    ventanas = out["windows"]
    assert sorted(pedidos) == sorted([(ventanas[k]["first_date"], ventanas[k]["last_date"]) for k in ("selection", "confirmation", "full")])
    assert {k: v["risk_free_rate"] for k, v in out["risk_free_by_window"].items()} == {"selection": 0.01, "confirmation": 0.03, "full": 0.02}
    confirmacion = out["original"]["metrics"]["confirmation"]
    assert ventanas["confirmation"]["weeks"] == 52 and ventanas["confirmation"]["days"] == 364
    assert confirmacion["cagr"] == pytest.approx(0.2964007, abs=1e-7)
    assert confirmacion["volatility"] == pytest.approx(0.0364073, abs=1e-7)
    assert confirmacion["sharpe"] == pytest.approx(7.3172, abs=1e-4)
    # Y los otros dos tramos, cada uno con el suyo.
    for tramo, rate in (("selection", 0.01), ("full", 0.02)):
        m = out["original"]["metrics"][tramo]
        assert m["sharpe"] == pytest.approx((m["cagr"] - rate) / m["volatility"], abs=1e-6)


def test_e_un_tramo_de_menos_de_330_dias_no_se_anualiza_y_no_hay_propuesta():
    """A 3 anos son 157 semanas. Con 0,9 para la seleccion, round(157 x 0,9) = 141: la confirmacion son 16 semanas, 112 dias.
    Con 0,3, round(157 x 0,3) = 47: la seleccion son 47 semanas, 329 dias, uno menos de los 330."""
    for fraccion, tramo, dias in ((0.9, "confirmation", 112), (0.3, "selection", 329)):
        _clear_price_series_cache()
        out = improve_portfolio(lector(), peticion(thresholds={"selection_fraction": fraccion}), today=FIN)
        assert out["status"] == "WINDOW_TOO_SHORT"
        assert out["proposals"] == [] and out["min_days"] == 330
        assert [(c["window"], c["days"]) for c in out["short_windows"]] == [(tramo, dias)]
        assert ("%d días" % dias) in out["reason"]
        assert "original" not in out


def test_f_una_cartera_de_20_con_5_candidatos_cada_una_recorta_a_3_y_lo_dice():
    """20 posiciones + 5 x 20 candidatos = 120 activos, y caben 80: con 3 por posicion son 20 + 60 = 80; con 4, 100."""
    roots = {"P%02d" % i: raiz("P%02d" % i, "Fondo %d" % i) for i in range(20)}
    series = {aid: serie(aid, 4, 0.0005 + 0.00001 * i, i) for i, aid in enumerate(roots)}
    candidatos = {aid: ["%s-C%d" % (aid, k) for k in range(5)] for aid in roots}
    out = improve_portfolio(LectorFalso(roots, series), {
        "positions": [{"asset_id": aid, "weight": 0.05} for aid in roots], "candidates": candidatos, "window": "3Y"}, today=FIN)
    assert out["candidates_per_position"] == {"requested": 5, "evaluated": 3, "trimmed": True, "max_assets": MAX_IMPROVEMENT_ASSETS}
    # Se evaluan los tres primeros de cada lista, que es su orden de preferencia (aqui, sin serie: no evaluables).
    assert {p: [r["asset_id"] for r in items] for p, items in out["rejected_candidates"].items()} == {p: ids[:3] for p, ids in candidatos.items()}
    assert out["coverage"]["requested_assets"] == 80
    # Sin recorte, la respuesta lo dice igual.
    _clear_price_series_cache()
    out = improve_portfolio(lector(), peticion(), today=FIN)
    assert out["candidates_per_position"] == {"requested": 2, "evaluated": 2, "trimmed": False, "max_assets": MAX_IMPROVEMENT_ASSETS}


def test_solo_rechaza_si_la_cartera_sola_no_cabe():
    roots = {"P%02d" % i: raiz("P%02d" % i, "Fondo %d" % i) for i in range(MAX_IMPROVEMENT_ASSETS + 1)}
    with pytest.raises(InvalidOptimizationRequest, match="la cartera tiene 81 posiciones"):
        improve_portfolio(LectorFalso(roots, {}), {"positions": [{"asset_id": aid, "weight": 1} for aid in roots], "candidates": {}, "window": "3Y"})


@pytest.mark.parametrize("extra, campo", [
    ({"max_substitutions": float("inf")}, "max_substitutions"),
    ({"max_substitutions": 0}, "max_substitutions"),
    ({"thresholds": {"exhaustive_limit": 10 ** 9}}, "exhaustive_limit"),
    ({"thresholds": {"rolling_weeks": 0}}, "rolling_weeks"),
])
def test_p1_09_umbrales_fuera_de_rango_son_entrada_invalida_y_no_un_error_interno(extra, campo):
    """P1-09 (20-11-2026): antes `int(inf)` era un OverflowError (INTERNAL) y lo demas pasaba sin cota."""
    with pytest.raises(InvalidOptimizationRequest, match=campo):
        improve_portfolio(lector(), peticion(**extra))
