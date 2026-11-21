# -*- coding: utf-8 -*-
"""Decisiones 13 y 16: lo que la base nueva nombra de otra forma llega traducido, y lo mismo en las dos bases."""
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from readmodel import lector_base_nueva as lector  # noqa: E402
from readmodel import repository as repo  # noqa: E402
from readmodel.mappers import map_asset_detail, map_economic_asset_class, map_region, map_sector  # noqa: E402


def fondo_nuevo(clase="EQUITY", categoria="EAA Fund Europe Large-Cap Blend Equity"):
    return {"instrument_type": "FUND", "identity": {"name": "Fondo", "currency": "EUR"},
            "classification": {"asset_class": clase, "category": categoria}}


def accion_nueva():
    return {"instrument_type": "STOCK", "identity": {"name": "Iberdrola S.A.", "currency": "EUR"},
            "classification": {"asset_class": "EQUITY"}}


def tarjeta_de_accion(sector="Utilities", bolsa="MC"):
    return {"instrument_type": "STOCK", "classification": {"asset_class": "EQUITY", "sector": sector, "exchange": bolsa}}


def region_de(categoria, regiones):
    return map_region(lector.raiz_vieja("X", fondo_nuevo(categoria=categoria), {}, {"equity_regions": regiones}))


# ------------------------------------------------------------------ clases


@pytest.mark.parametrize("raiz, esperada", [
    ("ALLOCATION", "MIXED"),
    ("CAPITAL_PRESERVATION", "MONEY_MARKET"),
    ("HYBRID", "MIXED"),
    ("REAL_ASSETS", "COMMODITIES"),
    ("EQUITY", "EQUITY"),
    ("FIXED_INCOME", "FIXED_INCOME"),
    ("ALTERNATIVE", "ALTERNATIVE"),
    ("OTHER", "OTHER"),
])
def test_las_clases_de_la_base_nueva_se_traducen(raiz, esperada):
    assert map_economic_asset_class(lector.raiz_vieja("X", fondo_nuevo(raiz), {}, {})) == esperada


def test_los_activos_reales_nunca_son_inmobiliario():
    """Son Ofi Precious Metals, Invesco Commodity Allocation e iShares Physical Gold: oro y materias primas."""
    assert map_economic_asset_class(lector.raiz_vieja("X", fondo_nuevo("REAL_ASSETS"), {}, {})) != "REAL_ASSET"


def test_una_clase_que_no_se_conoce_sigue_sin_conocerse():
    assert map_economic_asset_class(lector.raiz_vieja("X", fondo_nuevo("LO_QUE_SEA"), {}, {})) == "UNKNOWN"


@pytest.mark.parametrize("categoria, clase_vieja, esperada", [
    # Los 6 convertibles: la base vieja los tiene como renta fija, y su categoria lo dice.
    ("EAA Fund Convertible Bond - Global, EUR Hedged", "fixed_income", "MIXED"),
    ("EAA Fund Convertible Bond - Europe", "fixed_income", "MIXED"),
    ("EAA Fund EUR Corporate Bond", "fixed_income", "FIXED_INCOME"),
    # Los 3 de materias primas: la base vieja los tiene como «otros».
    ("EAA Fund Commodities - Precious Metals", "other", "COMMODITIES"),
    ("Materias Primas - Metales Preciosos", "other", "COMMODITIES"),
    ("EAA Fund Other Equity", "other", "OTHER"),
    # Un fondo de acciones de empresas mineras sigue siendo renta variable.
    ("EAA Fund Sector Equity Precious Metals", "equity", "EQUITY"),
])
def test_en_la_base_vieja_la_categoria_dice_lo_que_su_clase_no_distingue(categoria, clase_vieja, esperada):
    raiz = {"asset_type": "FUND", "classification": {"fondosdb_asset_type": clase_vieja, "category": categoria}}
    assert map_economic_asset_class(raiz) == esperada


def test_un_fondo_de_materias_primas_sin_mezcla_declarada_cae_en_otros():
    detalle = map_asset_detail(lector.raiz_vieja("X", fondo_nuevo("REAL_ASSETS"), {}, {}))
    assert detalle["economic_asset_class"] == "COMMODITIES"
    assert detalle["pms_exposure"]["other"] == 1.0
    assert detalle["pms_exposure"]["real_asset"] == 0.0


# ------------------------------------------------------------------ region


def test_ishares_msci_world_es_global_y_no_estados_unidos():
    assert region_de("RV Global Cap. Grande Blend", {"united_states": 0.73, "eurozone": 0.08, "asia": 0.08}) == "Global"


@pytest.mark.parametrize("categoria", [
    "EAA Fund Global Large-Cap Growth Equity",
    "EAA Fund EUR Flexible Allocation - Global",
    "EAA Fund Convertible Bond - Global, EUR Hedged",
    "EAA Fund Property - Indirect Global",
    "RF Diversificada Global - Cubierto \xa0EUR",
])
def test_global_si_su_categoria_lo_dice_aunque_no_declare_reparto(categoria):
    assert region_de(categoria, None) == "Global"


@pytest.mark.parametrize("categoria", [
    "EAA Fund Global Emerging Markets Equity",
    "EAA Fund Global Emerging Markets Bond - EUR Hedged",
    "EAA Fund Global Emerging Markets Allocation",
])
def test_los_emergentes_globales_no_son_global(categoria):
    assert region_de(categoria, {"asia": 0.7, "latin_america": 0.2}) == "Emergentes"


def test_si_la_categoria_no_lo_dice_la_region_dominante():
    assert region_de("EAA Fund Sector Equity Technology", {"united_states": 0.8, "asia": 0.2}) == "EE.UU."
    assert region_de("EAA Fund Asia ex-Japan Equity", {"asia": 0.9, "asia_emerging": 0.6}) == "Asia"
    assert region_de("EAA Fund Europe Large-Cap Blend Equity", {"eurozone": 0.5, "united_kingdom": 0.3}) == "Eurozona"


def test_las_dos_formas_del_dato_dan_la_misma_region():
    """La misma cartera, con el total de Asia de hoy y con las zonas de la proxima pasada (decision 7)."""
    antigua = {"united_states": 0.35, "eurozone": 0.15, "asia": 0.5, "asia_emerging": 0.2, "other": 0.2}
    nueva = {"united_states": 0.35, "eurozone": 0.15, "japan": 0.1, "asia_developed": 0.2, "asia_emerging": 0.2}
    assert region_de("EAA Fund Other Equity", antigua) == region_de("EAA Fund Other Equity", nueva) == "Asia"


def test_forma_nueva_canada_y_africa_con_su_nombre():
    """Un fondo de oro: hoy su Canada esta dentro de «Otras», que no cuenta."""
    assert region_de("EAA Fund Sector Equity Precious Metals", {"canada": 0.65, "united_states": 0.15, "africa": 0.03}) == "Canadá"


def test_otras_no_es_una_region():
    assert region_de("EAA Fund Other Equity", {"other": 0.54, "united_states": 0.36, "asia": 0.25}) == "EE.UU."
    assert region_de("EAA Fund Other Equity", {"other": 1.0}) is None


def test_sin_reparto_ni_categoria_se_queda_sin_region():
    """Un fondo de bonos en euros: la categoria dice la divisa, no el sitio."""
    assert region_de("EAA Fund EUR Corporate Bond", None) is None
    assert region_de(None, None) is None


def test_un_empate_no_depende_del_orden_del_documento():
    assert region_de("X", {"asia_emerging": 0.24, "asia": 0.24}) == region_de("X", {"asia": 0.24, "asia_emerging": 0.24}) == "Asia"


def test_la_region_declarada_de_la_base_vieja_no_cambia():
    """Lo que ve hoy el asesor en local: la categoria no pisa lo declarado."""
    raiz = {"asset_type": "FUND", "classification": {"region_primary": "Europa", "category": "EAA Fund Global Large-Cap Blend Equity"}}
    assert map_region(raiz) == "Europa"


# ------------------------------------------------------------------ sector y region de una accion


@pytest.mark.parametrize("bolsa, esperada", [
    ("MC", "Eurozona"), ("MCE", "Eurozona"), ("PA", "Eurozona"), ("XETRA", "Eurozona"), ("F", "Eurozona"),
    ("AS", "Eurozona"), ("HE", "Eurozona"), ("LSE", "Reino Unido"), ("SW", "Europa ex-euro"),
    ("US", "EE.UU."), ("TO", "Canadá"),
    # Una bolsa que no se conoce deja la accion sin region: no se deduce de otra cosa.
    ("XX", None), (None, None),
])
def test_la_region_de_una_accion_sale_de_la_bolsa_en_la_que_cotiza(bolsa, esperada):
    detalle = map_asset_detail(lector.raiz_vieja("ES0144580Y14", accion_nueva(), tarjeta_de_accion(bolsa=bolsa), {}))
    assert detalle["identity"]["region"] == esperada


def test_iberdrola_llega_con_su_sector_por_el_camino_de_produccion():
    detalle = map_asset_detail(lector.raiz_vieja("ES0144580Y14", accion_nueva(), tarjeta_de_accion(), {}))
    assert detalle["classification"]["sector"] == "Utilities"
    assert detalle["instrument_type"] == "STOCK"


def test_una_accion_sin_tarjeta_no_se_inventa_sector_ni_region():
    detalle = map_asset_detail(lector.raiz_vieja("ES0114400007", accion_nueva(), None, None))
    assert detalle["classification"]["sector"] is None
    assert detalle["identity"]["region"] is None


def test_un_fondo_no_tiene_sector_aunque_la_tarjeta_traiga_uno():
    raiz = lector.raiz_vieja("X", fondo_nuevo(), {"classification": {"sector": "Technology", "exchange": "MC"}}, {})
    assert map_asset_detail(raiz)["classification"]["sector"] is None
    # Ni su region sale de una bolsa: la de un fondo es su categoria o su reparto.
    assert map_asset_detail(raiz)["identity"]["region"] is None


@pytest.mark.parametrize("raiz, esperado", [
    ({"asset_type": "STOCK", "fundamentals": {"profile": {"sector": "Utilities"}}}, "Utilities"),
    ({"asset_type": "STOCK", "fundamentals": {"sector": "Financial Services"}}, "Financial Services"),
    ({"asset_type": "STOCK", "fundamentals": {"sector": "  "}, "portfolio_exposure": {"sectors": {"industrials": 1}}}, "industrials"),
    # Con varios sectores en el reparto no se elige uno.
    ({"asset_type": "STOCK", "portfolio_exposure": {"sectors": {"industrials": 0.5, "energy": 0.5}}}, None),
    ({"asset_type": "STOCK"}, None),
    ({"asset_type": "FUND", "fundamentals": {"sector": "Technology"}}, None),
])
def test_el_sector_en_la_base_vieja(raiz, esperado):
    assert map_sector(raiz) == esperado


class Lector:
    def __init__(self, raices):
        self.raices = raices

    def get_asset(self, asset_id):
        return self.raices.get(asset_id)

    def get_assets_many(self, ids):
        return {i: self.raices[i] for i in ids if i in self.raices}

    def get_metrics_latest(self, _asset_id):
        return None

    def get_holdings(self, _asset_id):
        return None

    def get_search_index(self):
        return {"entries": [{"id": i, "type": "STOCK", "name_folded": i.lower()} for i in sorted(self.raices)]}


def test_el_sector_llega_a_la_busqueda_a_la_ficha_a_comparar_y_a_resolver():
    raiz = lector.raiz_vieja("ES0144580Y14", accion_nueva(), tarjeta_de_accion(), {})
    reader = Lector({"ES0144580Y14": raiz})
    assert repo.search_assets(reader, "", ["STOCK"], 10)[0]["sector"] == "Utilities"
    assert repo.get_asset_detail(reader, "ES0144580Y14")["classification"]["sector"] == "Utilities"
    assert repo.compare_assets(reader, ["ES0144580Y14"])[0]["classification"]["sector"] == "Utilities"
    fila = repo.resolve_portfolio(reader, [{"asset_id": "ES0144580Y14", "weight": 1}])["rows"][0]
    assert fila["sector"] == "Utilities"
    assert fila["region"] == "Eurozona"
