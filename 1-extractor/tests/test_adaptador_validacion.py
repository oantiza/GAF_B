# -*- coding: utf-8 -*-
"""El canonico dice la verdad sobre su propia calidad.

Hasta el 04-09, `adaptador_bdb` escribia `"ok": True` y `"errors": []` como
literales en los bloques `quality`, `validation` y `routing`. Nada los
calculaba, y la plataforma los persistia en la maestra como `fondosdb_ok`: TODOS
los activos salian en verde por construccion (auditoria 03-09, hallazgo 05).

Primera prueba de este modulo, que genera el canonico del que dependen los otros
dos proyectos.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core import calidad  # noqa: E402
from core.adaptador_bdb import convierte  # noqa: E402


def _fondo_sano():
    return {
        "meta": {"isin": "IE00B4L5Y983", "actualizado": "2026-09-01"},
        "identificacion": {
            "nombre": "Fondo Prueba",
            "categoria_morningstar": "Global Large-Cap Blend Equity",
            "divisa_base": "EUR",
        },
        "costes": {"ter_pct": 0.2},
        "valoracion": {"vl": 100.0, "patrimonio_fondo_meur": 500.0},
        "rentabilidad": {"trailing_pct": {"1a": {"fondo": 10.0},
                                          "3a_anualizada": {"fondo": 8.0}}},
        "riesgo": {"volatilidad_pct": {"3a": {"fondo": 12.0}}, "sri_kid_1a7": 4},
        "cartera": {"fecha": "2026-07-31"},
    }


def _convierte(d):
    calidad.aplica(d)
    return convierte(d)


def test_un_fondo_completo_sale_ok():
    c = _convierte(_fondo_sano())

    assert c["validation"]["ok"] is True
    assert c["validation"]["errors"] == []
    assert c["quality"]["ok"] is True
    assert c["routing"] == {"status": "ok", "reason": None}


def test_un_fondo_sin_datos_esenciales_sale_bloqueado():
    c = _convierte({"meta": {"isin": "IE00B4L5Y983", "actualizado": "2026-09-01"},
                    "identificacion": {"nombre": "Casi vacio"}})

    assert c["validation"]["ok"] is False
    assert c["quality"]["ok"] is False
    assert any("calidad_bloqueada" in e for e in c["validation"]["errors"])
    assert c["routing"]["status"] == "blocked"
    assert c["routing"]["reason"]


def test_el_diagnostico_lleva_bucket_score_y_esenciales():
    c = _convierte(_fondo_sano())
    diag = c["validation"]["diagnostics"]

    assert diag["calidad_fondosdb"] in ("ALTO", "MEDIO", "BAJO", "BLOQUEADO")
    assert isinstance(diag["calidad_score"], int)
    assert "/" in diag["calidad_esenciales"]


def test_las_flags_informativas_no_bloquean():
    # Las `info_*` describen, no penalizan: un fondo con pesos negativos por
    # derivados es normal y no debe salir bloqueado por eso.
    d = _fondo_sano()
    d["cartera"]["posiciones"] = [{"isin": "US0378331005", "peso_pct": -1.0},
                                  {"isin": "US5949181045", "peso_pct": 5.0}]
    c = _convierte(d)

    assert any(f.startswith("info_") for f in c["validation"]["warnings"])
    assert c["validation"]["ok"] is True


def test_los_avisos_del_adaptador_y_las_flags_no_se_duplican():
    c = _convierte(_fondo_sano())
    avisos = c["validation"]["warnings"]

    assert len(avisos) == len(set(avisos))


def test_una_accion_tambien_declara_su_calidad():
    d = {
        "meta": {"isin": "US0378331005", "actualizado": "2026-09-01",
                 "tipo_activo": "accion"},
        "identificacion": {"nombre": "Apple Inc", "divisa_base": "USD",
                           "ticker": "AAPL", "mercado": "US"},
        "valoracion": {"vl": 200.0},
    }
    c = _convierte(d)

    assert isinstance(c["validation"]["ok"], bool)
    assert isinstance(c["validation"]["errors"], list)
    assert c["routing"]["status"] in ("ok", "blocked")


def test_el_canonico_lleva_el_indice_de_referencia():
    """El indice viajaba en la ficha y no llegaba al canonico.

    Sin el, la maestra guarda el alpha, la volatilidad y el Sharpe DEL indice
    sin guardar que indice era: cifras que pueden acabar en un informe de
    cliente sin poder nombrar su referencia (medido el 30-10-2026).
    """
    d = _fondo_sano()
    d["identificacion"]["indice_benchmark_oficial"] = "MSCI World NR EUR "
    assert convierte(d)["classification_v2"]["official_benchmark"] == "MSCI World NR EUR"

    # Lo que las fuentes escriben cuando no hay indice no es un indice: un
    # "N/A" en la maestra es peor que un hueco, porque parece un dato.
    for vacio in ("N/A", " n.a. ", "-", "", "   ", "no disponible", None, 7):
        d["identificacion"]["indice_benchmark_oficial"] = vacio
        assert convierte(d)["classification_v2"]["official_benchmark"] is None, vacio

    # Y si la ficha no lo trae, el campo existe y vale None: la ausencia se
    # declara, no se omite.
    del d["identificacion"]["indice_benchmark_oficial"]
    c = convierte(d)["classification_v2"]
    assert "official_benchmark" in c and c["official_benchmark"] is None


def test_el_top_del_canonico_lleva_25_y_la_suma_de_sus_pesos():
    """El top de 25 y `holdings_top_weight_sum`, que entran el 02-11-2026.

    Hasta ese dia el canonico solo llevaba 10 posiciones y el contrato de la base nueva
    admitia 25 desde el primero, asi que guardabamos menos de lo que cabia. Medido sobre
    las 760 fichas con diez posiciones o mas: la mediana de cartera explicada pasa del
    40,9 % al 61,4 %, y los fondos explicados al 90 % de 53 a 129.

    Y lo que esta prueba fija de verdad es **la unidad**. El canonico habla en porcentaje,
    igual que `peso_top10_pct` y que el peso de cada linea, y quien lo lee convierte. La
    primera version escribio la cobertura en fraccion, la plataforma volvio a dividir entre
    cien y la cobertura entraba en la base como 0,006 en vez de 0,61. Las dos mitades eran
    defendibles por separado; lo que faltaba era que la unidad fuera la misma a los dos
    lados del canonico.
    """
    from core.adaptador_bdb import POSICIONES_DEL_TOP

    fondo = _fondo_sano()
    fondo["cartera"] = {
        "fecha": "2026-07-31",
        "num_posiciones": 40,
        "peso_top10_pct": 20.0,
        "posiciones": [
            {"nombre": f"Posicion {i}", "peso_pct": 2.0, "sector": "tecnologia"}
            for i in range(40)
        ],
    }
    ms = _convierte(fondo)["ms"]

    assert POSICIONES_DEL_TOP == 25
    assert len(ms["holdings_top"]) == 25
    assert len(ms["holdings_top10"]) == 10          # el de siempre, para quien ya lo lee
    # 25 lineas al 2 % son el 50 % de la cartera, EN PORCENTAJE y no en fraccion.
    assert ms["holdings_top_weight_sum"] == 50.0
    # Y el peso de una linea sigue en porcentaje, que es de donde sale la suma.
    assert ms["holdings_top"][0]["weight"] == 2.0


def test_un_fondo_sin_posiciones_no_declara_suma():
    """Sin lista no hay cobertura que afirmar: `None`, no cero.

    Un cero diria que las posiciones guardadas cubren el 0 % de la cartera, y lo que pasa
    es que no hay posiciones guardadas.
    """
    ms = _convierte(_fondo_sano())["ms"]
    assert ms["holdings_top"] == []
    assert ms["holdings_top_weight_sum"] is None
