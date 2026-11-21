# -*- coding: utf-8 -*-
"""La fecha y el peso del top 10 de la cartera son los de las filas.

Cuando las posiciones vienen de sal-service (`portfolio/holding/v2`), la fecha
del snapshot `lt` y la del resumen (`holdingSummary`) pueden ser de una cartera
más reciente que la de las filas publicadas. En la caché del 14-10, 74 fondos
publicaban una fecha que no era la de sus filas; el caso de prueba es
ES0126542036: filas a 28-02-2026, snapshot y resumen a 31-05-2026. La app ya
toma la fecha del detalle (`functions_python/fund_ingest.py::_holdings`).
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core.adquisicion import procedencia  # noqa: E402
from fetchers import morningstar as ms  # noqa: E402
from fetchers import morningstar_lt as ms_lt  # noqa: E402

SNAPSHOT = {"Portfolios": [{"Date": "2026-05-31T00:00:00",
                            "HoldingAggregates": [{"SalePosition": "N", "NumberOfHolding": 12}]}]}


def _fila(nombre, peso):
    return {"securityName": nombre, "isin": None, "weighting": peso}


def _sal(footer="2026-02-28T06:00:00.000", resumen="2026-05-31T05:00:00.000",
         top_resumen=None, pesos=(30.0, 20.0, 10.0, 8.0, 7.0, 6.0, 5.0, 4.0, 3.0, 2.0, 1.5, 0.5)):
    """Forma real (recortada) de cache/raw_morningstar_lt/ES0126542036/sal_position.json."""
    pos = {
        "numberOfHolding": len(pesos),
        "holdingSummary": {"portfolioDate": resumen, "topHoldingWeighting": top_resumen,
                           "numberOfHolding": len(pesos)},
        "equityHoldingPage": {"holdingList": []},
        "boldHoldingPage": {"holdingList": [_fila(f"Bono {i}", p) for i, p in enumerate(pesos[:4])]},
        "otherHoldingPage": {"holdingList": [_fila(f"Otro {i}", p) for i, p in enumerate(pesos[4:])]},
    }
    if footer is not ...:
        pos["portfolioLastestDateFooter"] = footer
    return pos


def _mapea_como_morningstar_lt(sal: dict) -> dict:
    """Orden real de morningstar_lt.fetch: snapshot primero y sal-service al final."""
    out: dict = {}
    ms_lt._mapea_snapshot(out, SNAPSHOT)
    ms._mapea(out, {"position": sal})
    return out


def test_la_fecha_es_la_de_las_filas_y_no_la_del_snapshot():
    out = _mapea_como_morningstar_lt(_sal())
    assert out["cartera"]["fecha"] == "2026-02-28"          # antes: 2026-05-31 (snapshot)
    assert len(out["cartera"]["posiciones"]) == 12


def test_el_top10_del_resumen_solo_vale_si_es_de_la_misma_fecha_que_las_filas():
    # Resumen de otra cartera (31-05): su peso del top 10 no describe las filas
    # (28-02); se suma a partir de ellas: 30+20+10+8+7+6+5+4+3+2.
    out = _mapea_como_morningstar_lt(_sal(top_resumen=56.13925))
    assert out["cartera"]["peso_top10_pct"] == 95.0

    # Misma fecha: vale el del resumen, que cuenta la cartera entera.
    out = _mapea_como_morningstar_lt(_sal(footer="2026-05-31T06:00:00.000", top_resumen=56.13925))
    assert out["cartera"]["fecha"] == "2026-05-31"
    assert out["cartera"]["peso_top10_pct"] == 56.13925

    # Misma fecha sin dato en el resumen: también de las filas.
    out = _mapea_como_morningstar_lt(_sal(footer="2026-05-31T06:00:00.000", top_resumen=None))
    assert out["cartera"]["peso_top10_pct"] == 95.0


def test_sin_pie_vale_la_fecha_del_resumen():
    out = _mapea_como_morningstar_lt(_sal(footer=..., resumen="2026-04-30T05:00:00.000",
                                          top_resumen=40.0))
    assert out["cartera"]["fecha"] == "2026-04-30"
    assert out["cartera"]["peso_top10_pct"] == 40.0


def test_un_pie_no_valido_no_hereda_la_fecha_del_resumen_ni_la_del_snapshot():
    out = _mapea_como_morningstar_lt(_sal(footer="sin fecha", top_resumen=56.13925))
    assert "fecha" not in out["cartera"]
    assert out["cartera"]["peso_top10_pct"] == 95.0
    assert ms.fecha_posiciones_sal(_sal(footer="sin fecha")) == (None, False)


def test_sin_filas_de_sal_se_quedan_la_fecha_y_las_posiciones_del_snapshot():
    vacio = _sal(pesos=())
    out = _mapea_como_morningstar_lt(vacio)
    assert out["cartera"]["fecha"] == "2026-05-31"
    assert "peso_top10_pct" not in out["cartera"]


def test_la_fecha_y_el_top10_se_atribuyen_a_sal_position():
    with procedencia.activa("morningstar_lt") as reg:
        out: dict = {}
        with procedencia.etapa("MFsnapshot"):
            ms_lt._mapea_snapshot(out, SNAPSHOT)
        with procedencia.etapa("sal_position"):
            ms._mapea(out, {"position": _sal()})
    assert reg.resuelve("cartera.fecha") == "morningstar_lt:sal_position"
    assert reg.resuelve("cartera.peso_top10_pct") == "morningstar_lt:sal_position"


def test_sin_pie_ni_fecha_en_el_resumen_se_conserva_la_del_snapshot():
    out = _mapea_como_morningstar_lt(_sal(footer=..., resumen=None))
    assert out["cartera"]["fecha"] == "2026-05-31"
    assert len(out["cartera"]["posiciones"]) == 12


def test_un_top10_del_resumen_fuera_de_rango_se_cambia_por_el_de_las_filas_con_aviso():
    # ES0116848005: el resumen declara 203,2 % (cortos y derivados).
    out = _mapea_como_morningstar_lt(_sal(footer="2026-05-31T06:00:00.000", top_resumen=203.2))
    assert out["cartera"]["peso_top10_pct"] == 95.0
    assert out["cartera"]["peso_top10_fuera_de_rango"] == {"resumen": 203.2, "publicado": 95.0}


def test_un_top10_fuera_de_rango_sin_alternativa_no_se_publica():
    # LU1832969650: -76,4 % con las filas (posiciones cortas).
    out = _mapea_como_morningstar_lt(_sal(top_resumen=None, pesos=(5.0, -10.0, -20.0, -51.4)))
    assert "peso_top10_pct" not in out["cartera"]
    assert out["cartera"]["peso_top10_fuera_de_rango"] == {"filas": -76.4, "publicado": None}


def test_un_top10_en_rango_no_deja_aviso_aunque_las_filas_no_lo_esten():
    out = _mapea_como_morningstar_lt(_sal(footer="2026-05-31T06:00:00.000", top_resumen=60.0,
                                          pesos=(150.0, -10.0)))
    assert out["cartera"]["peso_top10_pct"] == 60.0
    assert "peso_top10_fuera_de_rango" not in out["cartera"]
