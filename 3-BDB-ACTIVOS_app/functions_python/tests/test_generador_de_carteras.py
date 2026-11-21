# -*- coding: utf-8 -*-
"""El generador de borradores por nivel de riesgo (decisión 122): reparto, mínimos, medidas y elección, con resultados conocidos."""
import math
import os
import sys
from datetime import date

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest  # noqa: E402

import generador_de_carteras as G  # noqa: E402

TODOS = {bloque: 20 for bloque in G.BLOQUES}


def test_cada_nivel_reparte_el_cien_por_cien_con_su_renta_variable():
    for nivel, rv in G.RENTA_VARIABLE_POR_NIVEL.items():
        pesos = G.pesos_de_bloque(nivel)
        assert math.isclose(sum(pesos.values()), 1.0)
        variable = sum(p for b, p in pesos.items() if G.BLOQUES[b][0] == "RV")
        assert math.isclose(variable, rv / 100)


def test_el_nivel_1_es_todo_renta_fija_a_corto_y_el_10_todo_renta_variable():
    uno = G.pesos_de_bloque(1)
    assert set(uno) == {"Liquidez y renta fija a muy corto", "Renta fija a corto plazo"}
    diez = G.pesos_de_bloque(10)
    assert {G.BLOQUES[b][0] for b in diez} == {"RV"}


def test_minimo_de_fondos_por_nivel_medido_el_06_11():
    minimos = {nivel: G.repartir(nivel, 1, TODOS)[1] for nivel in range(1, 11)}
    assert minimos == {1: 4, 2: 5, 3: 5, 4: 6, 5: 5, 6: 5, 7: 6, 8: 5, 9: 5, 10: 4}


@pytest.mark.parametrize("nivel", range(1, 11))
@pytest.mark.parametrize("num", [4, 5, 6, 8, 12, 20])
def test_ningun_fondo_pasa_del_25_ni_baja_del_5(nivel, num):
    reparto, minimo = G.repartir(nivel, num, TODOS)
    if num < minimo:
        assert reparto is None
        return
    total = 0
    for bloque, (peso, cuantos) in reparto.items():
        assert peso / cuantos <= G.TOPE_POR_FONDO + 1e-9
        assert peso / cuantos >= G.MINIMO_POR_POSICION - 1e-9
        total += peso
    assert math.isclose(total, 1.0)
    assert sum(c for _, c in reparto.values()) <= num


def test_pocos_fondos_no_juntan_la_renta_fija_a_corto_con_la_principal():
    """El fallo que salió al medir: con 5 fondos el nivel 4 perdía la renta fija a corto y su riesgo pasaba al del nivel 5."""
    reparto, minimo = G.repartir(4, 6, TODOS)
    assert minimo == 6
    partes = {G.BLOQUES[b][0] for b in reparto}
    assert partes == {"RF a corto", "RF principal", "RV"}
    assert G.repartir(4, 5, TODOS)[0] is None


def test_un_bloque_sin_fondos_se_suma_al_mayor_de_su_parte():
    sin_eeuu = {**TODOS, "Renta variable EE. UU.": 0}
    reparto, _ = G.repartir(10, 8, sin_eeuu)
    assert "Renta variable EE. UU." not in reparto
    assert math.isclose(sum(p for p, _ in reparto.values()), 1.0)
    assert math.isclose(reparto["Renta variable global"][0], 0.65)


def test_percentil_con_empates_y_sin_dato():
    assert G.percentil([1, 2, 3], 3, True) == 1.0
    assert G.percentil([1, 2, 3], 1, True) == 0.0
    assert G.percentil([1, 2, 3], 1, False) == 1.0
    assert G.percentil([1, 2, 2, 3], 2, True) == pytest.approx((1 + 0.5) / 3)
    assert G.percentil([1, 2, 3], None, True) == 0.5
    assert G.percentil([5], 5, True) == 0.5


def _serie(meses, factor):
    valor, salida = 100.0, {}
    for k, mes in enumerate(meses):
        if k:
            valor *= factor(k)
        salida[mes] = valor
    return salida


def test_medidas_de_una_serie_conocida():
    meses = G.meses_hasta("2026-10", 61)
    assert meses[0] == "2021-10" and meses[-1] == "2026-10" and len(meses) == 61
    serie = _serie(meses, lambda k: 1.01 if k % 2 else 0.995)
    m = G.medidas(serie, meses, lambda mes: 0.0)
    rentas = [1.01 - 1 if k % 2 else 0.995 - 1 for k in range(1, 61)]
    esperado_anual = math.prod(1 + r for r in rentas) ** (12 / 60) - 1
    assert m["anual"] == pytest.approx(esperado_anual)
    media = sum(rentas) / 60
    vol = math.sqrt(sum((r - media) ** 2 for r in rentas) / 59) * math.sqrt(12)
    assert m["volatilidad"] == pytest.approx(vol)
    assert m["sharpe"] == pytest.approx(esperado_anual / vol)
    abajo = math.sqrt(sum(min(0, r) ** 2 for r in rentas) / 60) * math.sqrt(12)
    assert m["sortino"] == pytest.approx(esperado_anual / abajo)


def test_el_tipo_sin_riesgo_resta_cada_mes_el_suyo():
    meses = G.meses_hasta("2026-10", 61)
    serie = _serie(meses, lambda k: 1.01 if k % 2 else 0.995)
    sin = G.medidas(serie, meses, lambda mes: 0.0)
    con = G.medidas(serie, meses, lambda mes: 0.024)
    assert con["sharpe"] == pytest.approx((sin["anual"] - 0.024) / sin["volatilidad"])


def test_el_mes_anterior_a_uno_dado():
    assert G.meses_hasta("2026-11", 2)[0] == "2026-10"
    assert G.meses_hasta("2027-01", 2)[0] == "2026-12"


def test_el_ultimo_mes_completo_es_el_anterior_al_del_ultimo_dato():
    from datetime import date
    # Último dato el 6 de noviembre: noviembre está a medias, y el último completo es octubre.
    assert G.ultimo_mes_completo({date(2026, 10, 30): 1.0, date(2026, 11, 6): 1.1}) == "2026-10"
    # Aunque el último dato sea el último día del mes, no se sabe que lo sea: cuenta hasta el anterior.
    assert G.ultimo_mes_completo({date(2026, 10, 30): 1.0}) == "2026-09"
    # Y enero mira a diciembre del año anterior.
    assert G.ultimo_mes_completo({date(2026, 1, 15): 1.0}) == "2025-12"
    assert G.ultimo_mes_completo({}) is None


def test_un_fondo_atrasado_no_se_mide_con_un_mes_a_medias():
    """OPT-4: la mayoría cierra en octubre; el que se paró el 10 de octubre tiene «octubre» en su serie, pero a medias."""
    from datetime import date
    al_dia = {date(2026, 9, 30): 100.0, date(2026, 10, 30): 101.0, date(2026, 11, 6): 101.5}
    parado = {date(2026, 9, 30): 100.0, date(2026, 10, 10): 100.4}
    # Los dos tienen la clave de octubre en sus cierres de mes: por eso pasaban el filtro de «tiene todos los meses».
    assert "2026-10" in G.fin_de_mes(al_dia) and "2026-10" in G.fin_de_mes(parado)
    assert G.fin_de_mes(parado)["2026-10"] == 100.4  # el «cierre» de octubre es el valor del día 10
    comun = G.ultimo_mes_completo(al_dia)
    assert comun == "2026-10"
    assert G.llega_al_ultimo_mes(G.ultimo_mes_completo(al_dia), comun) is True
    assert G.ultimo_mes_completo(parado) == "2026-09"
    assert G.llega_al_ultimo_mes(G.ultimo_mes_completo(parado), comun) is False
    # Uno que va por delante de la mayoría llega de sobra, y sin dato no llega nadie.
    assert G.llega_al_ultimo_mes("2026-11", comun) is True
    assert G.llega_al_ultimo_mes(None, comun) is False


def test_medidas_sin_meses_completos_no_dan_cifra():
    meses = G.meses_hasta("2026-10", 61)
    serie = _serie(meses, lambda k: 1.001)
    del serie["2024-03"]
    assert G.medidas(serie, meses, lambda mes: 0.0) is None


def test_consistencia_cuenta_los_meses_por_encima_de_la_mediana():
    meses = G.meses_hasta("2026-10", 61)
    series = {
        "bueno": _serie(meses, lambda k: 1.010),
        "medio": _serie(meses, lambda k: 1.005),
        "malo": _serie(meses, lambda k: 1.000),
    }
    c = G.consistencia(series, meses)
    assert c == {"bueno": 1.0, "medio": 0.0, "malo": 0.0}


def test_estr_mensual_media_y_antes_de_empezar():
    diaria = [(date(2019, 10, 1), -0.55), (date(2019, 10, 2), -0.53), (date(2020, 1, 2), -0.54)]
    tipo = G.estr_mensual(diaria)
    assert tipo("2019-10") == pytest.approx(-0.0054)
    assert tipo("2018-10") == pytest.approx(-0.0054)
    assert tipo("2020-01") == pytest.approx(-0.0054)
    assert tipo("2030-01") == pytest.approx(-0.0054)


def test_es_indexado_por_el_nombre():
    assert G.es_indexado("Vanguard Global Stock Index Fund EUR Acc")
    assert G.es_indexado("INDEXA RV MIXTA INTERNACIONAL 75, FI")
    assert G.es_indexado("MYINVESTOR S&P500 EQUIPONDERADO, FI")
    assert not G.es_indexado("Fidelity Funds - US Equity Fund A-Acc-EUR")
    assert not G.es_indexado("DWS Strategic Balance NC")


def _fondo(asset_id, bloque, nombre, gasto, patrimonio, anios, factor, indexado=False):
    meses = G.meses_hasta("2026-10", 61)
    return {"asset_id": asset_id, "nombre": nombre, "bloque": bloque, "indexado": indexado,
            "gasto_corriente_pct": gasto, "patrimonio": patrimonio, "anios": anios, "serie": _serie(meses, factor)}


def _catalogo():
    fondos = []
    for b_i, bloque in enumerate(G.BLOQUES):
        for k in range(4):
            fondos.append(_fondo(f"{b_i}{k}", bloque, f"Gestora{b_i}{k} Fondo", 1.0 + k / 10, 500e6 + k * 1e8, 10 + k,
                                 lambda m, k=k, b=b_i: 1.003 + 0.001 * k + (0.002 if m % 3 == 0 else -0.001) * (b + 1) / 8))
        fondos.append(_fondo(f"{b_i}i", bloque, f"Indice{b_i} Index Fund", 0.1, 5e9, 20, lambda m: 1.006, indexado=True))
    return fondos


def test_el_borrador_suma_cien_respeta_topes_y_deja_fuera_los_indexados():
    fondos = _catalogo()
    for nivel in range(1, 11):
        b = G.componer(nivel, 8, False, fondos, "2026-10", lambda mes: 0.0, {})
        assert b["estado"] == "OK"
        assert sum(p["peso_pct"] for p in b["posiciones"]) == pytest.approx(100.0)
        assert all(p["peso_pct"] <= 25.0 + 1e-9 and p["peso_pct"] >= 5.0 - 1e-9 for p in b["posiciones"])
        assert not any(p["indexado"] for p in b["posiciones"])
        assert len({p["asset_id"] for p in b["posiciones"]}) == len(b["posiciones"])
        rv = sum(p["peso_pct"] for p in b["posiciones"] if G.BLOQUES[p["bloque"]][0] == "RV")
        assert rv == pytest.approx(G.RENTA_VARIABLE_POR_NIVEL[nivel], abs=0.05)


def test_con_indexados_pueden_entrar():
    b = G.componer(10, 8, True, _catalogo(), "2026-10", lambda mes: 0.0, {})
    assert any(p["indexado"] for p in b["posiciones"])


def test_pedir_menos_del_minimo_lo_dice_y_no_compone():
    b = G.componer(4, 3, False, _catalogo(), "2026-10", lambda mes: 0.0, {})
    assert b["estado"] == "FALTAN_FONDOS"
    assert b["posiciones"] == []
    assert b["minimo_de_fondos"] == 6
    assert "al menos 6 fondos" in b["aviso"]


def test_la_nota_pondera_los_cuatro_pilares():
    b = G.componer(10, 4, False, _catalogo(), "2026-10", lambda mes: 0.0, {})
    for p in b["posiciones"]:
        esperado = sum(G.PESOS[k] * v for k, v in p["pilares"].items())
        assert p["nota"] == pytest.approx(esperado, abs=1e-3)


def test_dentro_del_bloque_gana_la_mejor_nota_y_gestoras_distintas():
    fondos = [
        _fondo("A", "Renta variable global", "Alfa Global", 1.5, 2e9, 20, lambda m: 1.008),
        _fondo("B", "Renta variable global", "Alfa Global II", 1.5, 2e9, 20, lambda m: 1.0079),
        _fondo("C", "Renta variable global", "Beta Global", 1.6, 1e9, 15, lambda m: 1.0075),
        _fondo("D", "Renta variable global", "Gamma Global", 2.0, 2e8, 6, lambda m: 1.001),
    ]
    elegidos = G._elegir(sorted(fondos, key=lambda f: -f["serie"]["2026-10"]), 2)
    assert [f["asset_id"] for f in elegidos] == ["A", "C"]


def test_la_peticion_valida_el_nivel_y_el_numero_de_fondos():
    with pytest.raises(G.GeneradorNoDisponible):
        G.generar_borrador(None, None, [], {"nivel": 11})
    with pytest.raises(G.GeneradorNoDisponible):
        G.generar_borrador(None, None, [], {"nivel": 5, "num_fondos": 0})
    with pytest.raises(G.GeneradorNoDisponible):
        G.generar_borrador(None, None, [], {})


def test_la_renta_variable_cuadra_exacta_con_cualquier_numero_de_fondos():
    """Lo que vio el revisor: el redondeo se llevaba a la mayor posición aunque fuera de la otra parte (nivel 9 con 14 fondos, 84,98 %)."""
    fondos = _catalogo()
    for nivel in range(1, 11):
        for num in range(4, 21):
            b = G.componer(nivel, num, False, fondos, "2026-10", lambda mes: 0.0, {})
            if b["estado"] != "OK":
                continue
            rv = round(sum(p["peso_pct"] for p in b["posiciones"] if G.BLOQUES[p["bloque"]][0] == "RV"), 2)
            assert rv == G.RENTA_VARIABLE_POR_NIVEL[nivel], (nivel, num, rv)
            assert round(sum(p["peso_pct"] for p in b["posiciones"]), 2) == 100.0


def test_un_bloque_con_pocos_fondos_no_rompe_el_tope():
    """El caso construido del revisor: nivel 10 con un solo fondo de renta variable global."""
    solo_uno = {**TODOS, "Renta variable global": 1}
    reparto, _ = G.repartir(10, 8, solo_uno)
    assert "Renta variable global" not in reparto or reparto["Renta variable global"][0] <= 0.25
    for peso, cuantos in reparto.values():
        assert peso / cuantos <= G.TOPE_POR_FONDO + 1e-9
    with pytest.raises(G.GeneradorNoDisponible):
        G.repartir(10, 8, {"Renta variable global": 1})
