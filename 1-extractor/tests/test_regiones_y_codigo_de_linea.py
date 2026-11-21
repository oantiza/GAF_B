# -*- coding: utf-8 -*-
"""Las zonas del canónico suman, y cada línea de cartera lleva su código fino.

Decisiones 7 y 9 de Óscar (04-11-2026). Los números de `RAW_ISHARES` son los que trae de verdad
`RegionalExposure` de IE00B4L5Y983 en la caché del 05-11-2026, así que el resultado esperado no
se ha copiado del código: las trece zonas suman 100 con la cuenta hecha a mano, y los códigos 14
y 15 suman también 100 porque son el mismo reparto contado de otra manera.
"""
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from core import adaptador_bdb as a  # noqa: E402
from core import limpieza  # noqa: E402
from fetchers import morningstar, morningstar_lt  # noqa: E402

RAW_ISHARES = [("1", 72.882853), ("2", 3.454937), ("3", 0.13426), ("4", 3.359596), ("5", 7.714049),
               ("6", 3.961401), ("7", 0.0), ("8", 0.0), ("9", 0.251845), ("10", 5.693378),
               ("11", 1.605747), ("12", 0.821776), ("13", 0.120158), ("14", 0.254418),
               ("15", 99.745592), ("16", 0.002915)]


def _ficha(regiones: dict | None = None, posiciones: list | None = None) -> dict:
    return {"meta": {"isin": "LU0000000001"},
            "identificacion": {"nombre": "Fondo", "tipo": "fondo", "divisa_base": "EUR"},
            "cartera": {"regiones_pct": regiones or {}, "posiciones": posiciones or []}}


def _detalle(regiones: dict) -> dict:
    return a.convierte(_ficha(regiones))["ms"]["regions"]["detail"]


def _regiones_de_morningstar(valores: list[tuple[str, float]]) -> dict:
    """Del crudo a la ficha, por el mismo camino que una pasada: el mapeo y la limpieza."""
    salida: dict = {}
    snapshot = {"Portfolios": [{"RegionalExposure": [
        {"SalePosition": "N", "BreakdownValues": [{"Type": t, "Value": v} for t, v in valores]}]}]}
    morningstar_lt._mapea_snapshot(salida, snapshot)
    limpieza._limpia_regiones(salida["cartera"])
    return salida["cartera"]["regiones_pct"]


def test_los_codigos_14_a_16_no_son_zonas():
    regiones = _regiones_de_morningstar(RAW_ISHARES)
    assert not {"otros", "otros_2", "total_emergentes", "total_desarrollados", "no_clasificado"} & set(regiones)
    assert sum(regiones.values()) == pytest.approx(100.0, abs=1e-6)


def test_cada_zona_con_su_nombre_y_todas_suman():
    detalle = _detalle(_regiones_de_morningstar(RAW_ISHARES))
    assert detalle == {"united_states": 72.8829, "canada": 3.4549, "latin_america": 0.1343,
                       "united_kingdom": 3.3596, "eurozone": 7.714, "europe_ex_euro": 3.9614,
                       "middle_east": 0.2518, "japan": 5.6934, "australasia": 1.6057,
                       "asia_developed": 0.8218, "asia_emerging": 0.1202}
    assert sum(detalle.values()) == pytest.approx(100.0, abs=0.01)
    assert "asia" not in detalle and "other" not in detalle


def test_robeco_indian_deja_de_sumar_300():
    """Toda la cartera en India: antes, 100 en Asia emergente, 100 en el total de Asia y 100 en `other`."""
    assert _detalle(_regiones_de_morningstar([("13", 100.0), ("14", 100.0)])) == {"asia_emerging": 100.0}


def test_una_ficha_vieja_con_otros_tampoco_lo_cuenta():
    """La retención puede conservar una ficha anterior al cambio: el adaptador no se fía de la limpieza."""
    assert _detalle({"asia_emergente": 100.0, "otros": 100.0}) == {"asia_emerging": 100.0}


def test_las_macro_cuentan_cada_zona_una_vez():
    canonico = a.convierte(_ficha({"canada": 10.0, "estados_unidos": 20.0, "africa": 5.0, "eurozona": 15.0,
                                   "japon": 10.0, "australasia": 10.0, "asia_desarrollada": 10.0,
                                   "asia_emergente": 20.0}))
    assert canonico["ms"]["regions"]["macro"] == {"americas": 30.0, "europe_me_africa": 20.0, "asia": 50.0}
    # La misma clave en las tres salidas que la leen.
    assert canonico["portfolio_exposure_v2"]["equity_regions"]["canada"] == 0.1
    assert canonico["derived"]["portfolio_exposure"]["equity_regions_total"]["africa"] == 5.0


@pytest.mark.parametrize("detalle, region", [
    # Asia cuenta entera contra las demás, como cuando `asia` traía el total.
    ({"united_states": 30.0, "asia_developed": 20.0, "asia_emerging": 25.0, "japan": 10.0}, "Asia"),
    ({"united_states": 45.0, "japan": 10.0, "asia_emerging": 20.0}, "USA"),
    ({"africa": 60.0, "middle_east": 10.0}, "Emerging"),
    ({"canada": 60.0, "eurozone": 10.0}, "Global"),
    ({}, "Global"),
])
def test_la_region_principal_no_cambia_por_partir_asia(detalle, region):
    assert a._region_por_mayor_exposicion(detalle) == region


def test_la_linea_lleva_el_codigo_fino_y_sin_codigo_no_lo_inventa():
    posiciones = [
        {"nombre": "NVIDIA Corp", "isin": "US67066G1040", "peso_pct": 5.0, "tipo": "rv", "codigo_tipo": "E"},
        {"nombre": "EUROPEAN MONETARY UNION EURO Purchased", "peso_pct": 30.0, "tipo": "otro", "codigo_tipo": "CU"},
        {"nombre": "Apple", "isin": "US0378331005", "peso_pct": 4.0},
    ]
    ms = a.convierte(_ficha(posiciones=posiciones))["ms"]
    por_nombre = {l["name"]: l for l in ms["holdings_all"]}
    assert por_nombre["NVIDIA Corp"]["holding_type_code"] == "E"
    assert por_nombre["EUROPEAN MONETARY UNION EURO Purchased"]["holding_type_code"] == "CU"
    assert "holding_type_code" not in por_nombre["Apple"]
    # La misma forma en el resumen: es lo que leen la ficha y la cartera.
    assert [l.get("holding_type_code") for l in ms["holdings_top"]] == ["CU", "E", None]


def test_el_codigo_sale_del_campo_del_proveedor_en_las_dos_vistas():
    salida: dict = {}
    morningstar._mapea(salida, {"position": {"otherHoldingPage": {"holdingList": [
        {"securityName": "FX FORW EUR/USD Purchased", "holdingTypeId": "CU", "weighting": 3.0}]}}})
    assert salida["cartera"]["posiciones"][0]["codigo_tipo"] == "CU"
    assert salida["cartera"]["posiciones"][0]["tipo"] == "otro"

    salida = {}
    morningstar_lt._mapea_snapshot(salida, {"Portfolios": [{"PortfolioHoldings": [
        {"SecurityName": "Apple Inc", "ISIN": "US0378331005", "Weighting": 5.6, "DetailHoldingTypeId": "E"}]}]})
    assert salida["cartera"]["top10_posiciones"][0]["codigo_tipo"] == "E"
