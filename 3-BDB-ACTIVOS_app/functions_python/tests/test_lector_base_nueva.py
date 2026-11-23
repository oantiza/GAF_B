# -*- coding: utf-8 -*-
"""La base nueva leida por la misma capa que la vieja, sin cambiar lo que recibe la app."""
import json
import os
import sys
from datetime import date
from pathlib import Path

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from readmodel import lector_base_nueva as lector  # noqa: E402
from readmodel import repository as repo  # noqa: E402
from readmodel.mappers import map_asset_detail, map_costs  # noqa: E402

FONDO = {
    "instrument_type": "FUND",
    "identity": {"name": "Fondo", "currency": "EUR"},
    "classification": {"category": "Bonos", "asset_class": "FIXED_INCOME",
                       "official_benchmark": {"name": "JPM EMU"}},
}
TARJETA_FONDO = {
    "instrument_type": "FUND",
    "costs": {"ongoing_charge": 0.0053},
    "quote": {"price": 79.03, "as_of": "2026-10-30"},
    "holdings_summary": {"positions_count": 88, "top10_weight": 0.36, "as_of": "2026-09-30"},
    "metrics": {
        "source": "COMPUTED", "method": "EXTRACTOR_MONTHLY_V1", "frequency": "MONTHLY",
        "as_of": "2026-10-30", "volatility": {"3y": 0.05}, "annualized_return": {"3y": 0.02},
        "sharpe": {"3y": -0.09}, "max_drawdown": {"5y": -0.2},
    },
}


def test_las_cifras_llegan_con_su_metodo_y_en_la_unidad_del_contrato():
    raiz = lector.raiz_vieja("BE0943877671", FONDO, TARJETA_FONDO,
                             {"asset_mix": {"fixed_income": 0.96, "cash": 0.04}})
    detalle = map_asset_detail(raiz, lector.metricas_viejas(TARJETA_FONDO),
                               lector.resumen_de_posiciones(TARJETA_FONDO["holdings_summary"]))
    assert detalle["metrics"]["sharpe_3y"] == -0.09
    assert detalle["metrics"]["metrics_method"] == "EXTRACTOR_MONTHLY_V1"
    assert detalle["metrics"]["metrics_frequency"] == "MONTHLY"
    assert detalle["metrics"]["max_drawdown_5y"] == -0.2
    assert detalle["costs"]["ongoing_charge"] == 0.0053
    assert detalle["pms_exposure"]["fixed_income"] == 0.96
    assert detalle["classification"]["official_benchmark"] == "JPM EMU"
    assert detalle["identity"]["isin"] == "BE0943877671"
    assert detalle["holdings_summary"]["top10_weight"] == 36.0


def test_un_reparto_neto_llega_tal_cual_a_lo_que_lee_la_app():
    # Lazard Small Caps Euro I, FR0000174310, el 05-11-2026: suma 1, y la renta fija es -0,08 % (decision A-63 de Oscar).
    # El servidor no la recorta, no la pone a cero y no reparte nada entre las demas.
    mezcla = {"equity": 1.000401, "fixed_income": -0.000844, "cash": 0.000432, "other": 0.000011}
    raiz = lector.raiz_vieja("FR0000174310", FONDO, TARJETA_FONDO, {"asset_mix": mezcla})
    reparto = map_asset_detail(raiz, lector.metricas_viejas(TARJETA_FONDO))["pms_exposure"]
    assert reparto["equity"] == 1.000401
    assert reparto["fixed_income"] == -0.000844
    assert reparto["cash"] == 0.000432
    assert reparto["other"] == 0.000011
    assert reparto["source"] == "PORTFOLIO_EXPOSURE"
    clases = ("equity", "fixed_income", "cash", "alternative", "real_asset", "other")
    assert sum(reparto[clase] for clase in clases) == pytest.approx(1.0, abs=1e-9)


# Las nueve celdas de IE00B4L5Y983 el 05-11-2026, con una negativa y un cero para ver que llegan.
CAJA = {"large_value": 0.242569, "large_blend": 0.340793, "large_growth": 0.227598,
        "mid_value": 0.055016, "mid_blend": 0.085421, "mid_growth": 0.042717,
        "small_value": 0.006474, "small_blend": 0, "small_growth": -0.000588}


def test_las_nueve_celdas_llegan_tal_cual_a_lo_que_lee_la_app():
    raiz = lector.raiz_vieja("IE00B4L5Y983", FONDO, TARJETA_FONDO,
                             {"asset_mix": {"equity": 0.99, "cash": 0.01},
                              "equity_styles": {"value": 0.3}, "equity_style_box": CAJA})
    detalle = map_asset_detail(raiz, lector.metricas_viejas(TARJETA_FONDO))["exposure_detail"]
    assert detalle["equity_style_box"] == CAJA
    assert sum(detalle["equity_style_box"].values()) == pytest.approx(1.0, abs=5e-6)
    assert detalle["equity_styles"] == {"value": 0.3}


@pytest.mark.parametrize("caja", [None, {}, {"large_value": 1.0},
                                  {**CAJA, "mid_blend": None}, {**CAJA, "mid_blend": "x"}])
def test_sin_las_nueve_no_llega_caja_y_la_app_lee_los_dos_repartos(caja):
    exposicion = {"asset_mix": {"equity": 0.99, "cash": 0.01}, "equity_style_box": caja}
    detalle = map_asset_detail(lector.raiz_vieja("IE00B4L5Y983", FONDO, TARJETA_FONDO, exposicion))["exposure_detail"]
    assert "equity_style_box" not in detalle


def test_la_forma_de_la_base_vieja_no_lleva_caja():
    vieja = {"portfolio_exposure": {"equity_styles": {"value": 0.3, "blend": 0.7}, "market_caps": {"large": 1.0}}}
    from readmodel.mappers import map_exposure_detail
    detalle = map_exposure_detail(vieja)
    assert detalle["equity_styles"] == {"value": 0.3, "blend": 0.7}
    assert "equity_style_box" not in detalle


def test_una_accion_no_recibe_sharpe_pero_conserva_su_riesgo():
    tarjeta = {"instrument_type": "STOCK", "metrics": {
        "method": "EXTRACTOR_DAILY_V1", "frequency": "DAILY",
        "volatility": {"3y": 0.15}, "sharpe": {"3y": 1.2},
    }}
    ventana = lector.metricas_viejas(tarjeta)["windows"]["3y"]
    assert ventana["sharpe_ratio"] is None
    assert ventana["annualized_volatility"] == 0.15


def test_las_estrellas_llegan_a_la_forma_que_lee_la_app():
    conEstrella = {**FONDO, "classification": {**FONDO.get("classification", {}), "morningstar_rating": 4}}
    assert map_asset_detail(lector.raiz_vieja("BE0943877671", conEstrella))["classification"]["morningstar_rating"] == 4
    assert map_asset_detail(lector.raiz_vieja("BE0943877671", FONDO))["classification"]["morningstar_rating"] is None


def test_sin_metricas_no_se_inventa_ninguna():
    assert lector.metricas_viejas({"instrument_type": "FUND"}) is None
    assert lector.metricas_viejas(None) is None
    assert lector.resumen_de_posiciones(None) is None
    raiz = lector.raiz_vieja("BE0943877671", FONDO)
    assert map_asset_detail(raiz)["costs"] is None


ORO = "IE00B4ND3602"
RAIZ_OTHER = {
    "instrument_type": "OTHER",
    "identity": {"name": "iShares Physical Gold ETC", "currency": "USD"},
    "classification": {"category": "Materias Primas - Metales Preciosos", "asset_class": "REAL_ASSETS"},
    "product": {"inception_date": "2011-04-08", "domicile": "IE"},
    "availability": {"state": "TRADING"},
}
TARJETA_OTHER = {"instrument_type": "OTHER", "costs": {"ongoing_charge": 0.0012, "management_fee": 0, "transaction_costs": 0}}


def test_el_oro_se_mide_como_el_producto_cotizado_que_es_y_sin_tocar_los_datos():
    """Decision 76: lo mismo que la base vieja, que trae `product_type` ETC. Sigue siendo OTHER en el documento."""
    from optimization.repository import _root_exclusion_reason, _root_instrument_type
    raiz = lector.raiz_vieja(ORO, RAIZ_OTHER, TARJETA_OTHER)
    assert raiz["asset_type"] == "OTHER"
    assert raiz["product"] == {"inception_date": "2011-04-08", "domicile": "IE", "product_type": "ETC"}
    assert RAIZ_OTHER["product"] == {"inception_date": "2011-04-08", "domicile": "IE"}, "no toca lo que lee"
    assert _root_instrument_type(raiz) == "ETF"
    assert _root_exclusion_reason(raiz, "EUR", ORO) is None
    assert _root_exclusion_reason(raiz, "EUR", ORO, allow_historical=True) is None
    assert _root_exclusion_reason(raiz, "EUR", ORO, allow_historical=True, solo_dibujo=True) is None
    detalle = map_asset_detail(raiz)
    assert detalle["instrument_type"] == "ETF"
    assert detalle["is_investable"] is True
    assert detalle["economic_asset_class"] == "COMMODITIES"


def test_lo_que_no_le_aplica_al_oro_no_se_pinta_como_cero():
    """Su coste es el coste corriente. Un 0 % de gestion se leeria como que no cobra."""
    costes = map_costs(lector.raiz_vieja(ORO, RAIZ_OTHER, TARJETA_OTHER))
    assert costes["ongoing_charge"] == 0.0012
    assert "management_fee" not in costes
    assert costes["transaction_costs"] == 0, "la operacion es la cifra de su ficha MiFID: esa si la declara"


def test_otro_other_no_entra_solo():
    """Si un dia llega otro, se queda fuera del calculo y lo dice, hasta que alguien mire que es."""
    from optimization.repository import _root_exclusion_reason, _root_instrument_type
    otro = lector.raiz_vieja("IE00B0000000", {**RAIZ_OTHER, "identity": {"name": "Otro Physical Silver ETC", "currency": "USD"}}, TARJETA_OTHER)
    assert otro["product"] == {"inception_date": "2011-04-08", "domicile": "IE"}
    assert _root_instrument_type(otro) == "OTHER"
    assert _root_exclusion_reason(otro, "EUR", "IE00B0000000", allow_historical=True) == "NON_INVESTABLE"
    assert map_asset_detail(otro)["instrument_type"] == "UNKNOWN"
    assert map_costs(otro)["management_fee"] == 0, "su dato pasa tal cual: a este no se le ha mirado nada"


def test_el_isin_del_oro_con_otro_tipo_no_se_marca():
    """La regla es para un OTHER: si la base le da un dia su tipo, manda el tipo."""
    como_fondo = lector.raiz_vieja(ORO, {**RAIZ_OTHER, "instrument_type": "FUND"}, TARJETA_OTHER)
    assert "product_type" not in como_fondo["product"]
    assert map_costs(como_fondo)["management_fee"] == 0


class _Fragmento:
    def __init__(self, entradas):
        self._entradas = entradas

    def to_dict(self):
        return {"entries": self._entradas}


class _DbDeIndice:
    def __init__(self, entradas):
        self._entradas = entradas

    def collection(self, nombre):
        assert nombre == "search_shards"
        return self

    def stream(self, **_opciones):
        return [_Fragmento(self._entradas)]


def test_el_selector_del_comparador_encuentra_el_oro_y_no_otro_other():
    entradas = [
        {"instrument_id": ORO, "name": "iShares Physical Gold ETC", "name_folded": "ishares physical gold etc", "instrument_type": "OTHER", "ticker": "IGLN"},
        {"instrument_id": "IE00B0000000", "name": "Otro Physical Silver", "name_folded": "otro physical silver", "instrument_type": "OTHER"},
        {"instrument_id": "LU0000000001", "name": "Physical Fund", "name_folded": "physical fund", "instrument_type": "FUND"},
    ]
    indice = lector.LectorBaseNueva(_DbDeIndice(entradas)).get_search_index()
    assert {entrada["id"]: entrada["type"] for entrada in indice["entries"]} == {ORO: "ETF", "IE00B0000000": "OTHER", "LU0000000001": "FUND"}
    assert repo._index_candidate_ids(indice, "physical", ["FUND", "ETF", "STOCK", "INDEX"]) == [ORO, "LU0000000001"]


def test_un_activo_retirado_no_se_ofrece_como_invertible():
    retirado = {**FONDO, "availability": {"state": "DELISTED"}}
    assert map_asset_detail(lector.raiz_vieja("BE0943877671", retirado))["is_investable"] is False


def test_lo_que_nunca_se_resolvio_no_se_ofrece_y_dice_por_que():
    """Decision 44: por el estado, nunca por el ISIN. Y la posicion que ya exista se conserva: es una restriccion."""
    sin_resolver = {**FONDO, "availability": {"state": "NEVER_RESOLVED", "since": "2026-11-02"}}
    detalle = map_asset_detail(lector.raiz_vieja("BE0943877671", sin_resolver))
    assert detalle["is_investable"] is False
    assert detalle["role"] == "INVESTABLE"
    assert "NON_INVESTABLE_NEVER_RESOLVED" in detalle["quality_flags"]
    assert "NON_INVESTABLE_BENCHMARK" not in detalle["quality_flags"]


def test_una_cartera_que_ya_lo_lleva_lo_deja_fuera_porque_no_hay_serie_y_no_porque_no_sea_invertible():
    """Para elegir no se puede. En lo historico no se bloquea por la raiz: el motivo lo da la serie que falta."""
    from optimization.repository import _root_exclusion_reason
    raiz = lector.raiz_vieja("BE0943877671", {**FONDO, "availability": {"state": "NEVER_RESOLVED"}})
    assert _root_exclusion_reason(raiz, "EUR", "BE0943877671") == "NON_INVESTABLE"
    assert _root_exclusion_reason(raiz, "EUR", "BE0943877671", allow_historical=True) is None
    retirado = lector.raiz_vieja("BE0943877671", {**FONDO, "availability": {"state": "DELISTED"}})
    assert _root_exclusion_reason(retirado, "EUR", "BE0943877671", allow_historical=True) == "NON_INVESTABLE"


@pytest.mark.parametrize("estado", ["TRADING", "UNDETERMINED", None])
def test_los_demas_estados_no_llevan_la_marca(estado):
    otro = {**FONDO, "availability": {"state": estado}} if estado else FONDO
    detalle = map_asset_detail(lector.raiz_vieja("BE0943877671", otro))
    assert detalle["is_investable"] is True
    assert "NON_INVESTABLE_NEVER_RESOLVED" not in detalle["quality_flags"]


def test_una_baja_no_dice_que_nunca_se_resolvio():
    retirado = {**FONDO, "availability": {"state": "DELISTED"}}
    assert "NON_INVESTABLE_NEVER_RESOLVED" not in map_asset_detail(lector.raiz_vieja("BE0943877671", retirado))["quality_flags"]


class _Snap:
    def __init__(self, ident, datos, padre=None):
        self.id, self._datos, self.exists = ident, datos, datos is not None
        self.reference = type("R", (), {"parent": type("P", (), {"parent": padre})})

    def to_dict(self):
        return self._datos


class _Ref:
    def __init__(self, db, ruta):
        self.db, self.ruta = db, ruta
        self.id = ruta.split("/")[-1]

    def collection(self, nombre):
        return _Col(self.db, f"{self.ruta}/{nombre}")

    def get(self, **opciones):
        self.db.plazos.append(opciones.get("timeout"))
        partes = self.ruta.split("/")
        padre = _Ref(self.db, "/".join(partes[:2])) if len(partes) > 2 else None
        return _Snap(self.id, self.db.datos.get(self.ruta), padre)


class _Col:
    def __init__(self, db, ruta):
        self.db, self.ruta = db, ruta

    def document(self, ident):
        return _Ref(self.db, f"{self.ruta}/{ident}")

    def stream(self, **opciones):
        self.db.plazos.append(opciones.get("timeout"))
        prefijo = self.ruta + "/"
        return [_Ref(self.db, r).get(timeout="dentro de stream") for r in self.db.datos
                if r.startswith(prefijo) and "/" not in r[len(prefijo):]]


class _Db:
    def __init__(self, datos):
        self.datos = datos
        # El plazo con el que se pidio cada lectura que llega a la base; las de dentro de `get_all` no cuentan.
        self.plazos = []

    def collection(self, nombre):
        return _Col(self, nombre)

    def get_all(self, referencias, **opciones):
        self.plazos.append(opciones.get("timeout"))
        return [_Ref(self, r.ruta).get(timeout="dentro de get_all") for r in referencias]


def _db():
    i = "instruments/BE0943877671"
    return _Db({
        i: FONDO,
        f"{i}/read/card": TARJETA_FONDO,
        f"{i}/declared/holdings": {"positions_count": 88, "top10_weight": 0.36, "as_of": "2026-09-30",
                                   "top": [{"name": "Solo top", "weight": 0.1}]},
        f"{i}/holdings_chunks/000": {"positions": [{"name": "Bono", "weight": 0.07, "isin": "FR001400X8V5"}]},
        "search_shards/000": {"entries": [{"instrument_id": "BE0943877671", "name": "Fondo",
                                           "name_folded": "fondo", "instrument_type": "FUND"}]},
    })


def test_las_callables_de_lectura_funcionan_sobre_el_lector():
    l = lector.LectorBaseNueva(_db())
    pagina = repo.search_assets_page(l, "fondo", limit=5)
    assert pagina["total_matches"] == 1
    assert pagina["results"][0]["metrics"]["sharpe_3y"] == -0.09
    assert repo.compare_assets(l, ["BE0943877671"])[0]["asset_id"] == "BE0943877671"
    resuelta = repo.resolve_portfolio(l, [{"asset_id": "BE0943877671", "weight": 1}])
    assert resuelta["rows"][0]["metrics"]["metrics_method"] == "EXTRACTOR_MONTHLY_V1"
    assert l.get_asset("LU0000000000") is None


def test_las_posiciones_salen_en_porcentaje_y_prefieren_la_lista_completa():
    datos = lector.LectorBaseNueva(_db()).get_holdings("BE0943877671")["data"]
    assert [fila["holding_name"] for fila in datos["holdings"]] == ["Bono"]
    assert datos["holdings"][0]["holding_weight"] == 7.0
    assert datos["holdings"][0]["holding_weight_unit"] == "percent"


def test_el_codigo_fino_de_la_linea_llega_y_sin_el_no_se_inventa():
    """Decision 9: es lo unico que separa una accion de un derivado, y el servidor no lo interpreta."""
    con = lector.posicion_vieja({"name": "NVIDIA", "weight": 0.05, "isin": "US67066G1040",
                                 "asset_type": "EQUITY", "holding_type_code": "E"})
    assert con["holding_type_code"] == "E"
    assert con["instrument_type"] == "EQUITY"
    assert con["holding_weight"] == 5.0
    assert "holding_type_code" not in lector.posicion_vieja({"name": "Linea de justETF", "weight": 0.05})


def test_el_lector_es_el_de_la_base_nueva_y_con_la_vieja_declarada_para(monkeypatch):
    """21-11-2026: el lector de la base vieja (`FirestoreReader`) se borro. Con su id declarado no se cae a el: para."""
    from master_project import BaseNuevaRequerida
    from portfolios.store import almacen_de_carteras

    monkeypatch.setenv("MASTER_PROJECT_ID", "bdb-gestor-de-activos")
    monkeypatch.setattr(lector, "LectorBaseNueva", lambda: "nueva")
    assert lector.lector_de_activos() == "nueva"
    monkeypatch.setenv("MASTER_PROJECT_ID", "gestor-activos-local")
    for pide in (lector.lector_de_activos, lector.lector_de_optimizacion, lector.resolver_tipo_libre, almacen_de_carteras):
        with pytest.raises(BaseNuevaRequerida) as error:
            pide()
        assert "gestor-activos-local" in str(error.value) and "bdb-gestor-de-activos" in str(error.value)


def _serie(anio, divisa="EUR", clase="NAV"):
    return {"instrument_id": "BE0943877671", "year": anio, "series_id": "EODHD:X", "price_class": clase,
            "currency": divisa, "first_date": f"{anio}-01-02", "last_date": f"{anio}-01-03", "observations": 2,
            "points": [{"date": f"{anio}-01-02", "value": 1.0}, {"date": f"{anio}-01-03", "value": 1.1}]}


def test_la_serie_llega_al_motor_con_la_forma_que_espera():
    db = _db()
    db.datos["instruments/BE0943877671/price_series/2025"] = _serie("2025")
    db.datos["instruments/BE0943877671/price_series/2026"] = _serie("2026")
    l = lector.LectorOptimizacionBaseNueva(db)
    documentos = l.get_price_series("BE0943877671")
    assert [d["document_id"] for d in documentos] == ["2025", "2026"]
    assert documentos[0]["schema_version"] == "asset-price-series.v1.2"
    assert documentos[0]["series_type"] == "NAV"
    assert documentos[0]["points"][1] == {"date": "2025-01-03", "value": 1.1}
    assert l.read_count == 2
    assert l.get_asset("BE0943877671")["asset_type"] == "FUND"


def test_una_serie_en_dolares_no_se_presenta_como_euros():
    documento = lector.documento_de_serie_viejo(_serie("2026", "USD", "MARKET_PRICE"))
    assert documento["currency"] == "USD"
    assert documento["series_type"] == "ADJUSTED_CLOSE"


def test_el_proyecto_declarado_elige_el_lector_de_optimizacion(monkeypatch):
    monkeypatch.setenv("MASTER_PROJECT_ID", "bdb-gestor-de-activos")
    monkeypatch.setattr(lector, "LectorOptimizacionBaseNueva", lambda: "nueva")
    assert lector.lector_de_optimizacion() == "nueva"


def test_el_dolar_se_lleva_a_euros_con_el_ultimo_cambio_en_tolerancia():
    documento = lector.documento_de_serie_viejo({
        **_serie("2026", "USD", "MARKET_PRICE"),
        "points": [
            {"date": "2026-01-02", "value": 110.0},
            {"date": "2026-01-05", "value": 121.0},
            {"date": "2026-03-01", "value": 130.0},
            {"date": "1998-12-31", "value": 9.0},
        ],
    })
    documento["points"] = sorted(documento["points"], key=lambda p: p["date"])
    convertido = lector.a_euros(documento, [("2026-01-02", 1.1), ("2026-01-03", 1.21)])
    assert convertido["currency"] == "EUR"
    assert convertido["source_currency"] == "USD"
    assert [p["date"] for p in convertido["points"]] == ["2026-01-02", "2026-01-05"]
    assert round(convertido["points"][0]["value"], 9) == 100.0
    assert round(convertido["points"][1]["value"], 9) == 100.0
    assert convertido["points"][1]["fx_rate"] == 1.21
    assert convertido["points"][1]["source_value"] == 121.0
    assert convertido["observations_count"] == 2


def test_los_peniques_pasan_a_libras_antes_de_convertir():
    documento = lector.documento_de_serie_viejo({
        **_serie("2026", "GBX", "MARKET_PRICE"),
        "points": [{"date": "2026-01-02", "value": 1000.0}],
    })
    assert lector.a_euros(documento, [("2026-01-02", 0.8)])["points"][0]["value"] == pytest.approx(12.5)


def test_sin_cambio_la_serie_sigue_en_su_divisa_y_el_motor_la_excluye():
    lector._CAMBIOS.clear()
    db = _db()
    db.datos["instruments/BE0943877671/price_series/2026"] = _serie("2026", "USD", "MARKET_PRICE")
    db.collection = lambda nombre: _ColSinConsulta(db, nombre)
    documentos = lector.LectorOptimizacionBaseNueva(db).get_price_series("BE0943877671")
    assert documentos[0]["currency"] == "USD"
    lector._CAMBIOS.clear()


def test_un_anio_anterior_a_los_cambios_no_excluye_la_serie_entera():
    lector._CAMBIOS.clear()
    db = _db()
    db.datos["instruments/BE0943877671/price_series/1995"] = _serie("1995", "USD", "MARKET_PRICE")
    db.datos["instruments/BE0943877671/price_series/2026"] = _serie("2026", "USD", "MARKET_PRICE")
    db.datos["fx_rates/USD_2026"] = {"currency": "USD", "points": [{"date": "2026-01-02", "value": 1.25}]}
    db.collection = lambda nombre: _ColSinConsulta(db, nombre)
    documentos = lector.LectorOptimizacionBaseNueva(db).get_price_series("BE0943877671")
    assert [d["document_id"] for d in documentos] == ["2026"]
    assert all(d["currency"] == "EUR" for d in documentos)
    lector._CAMBIOS.clear()


class _ColSinConsulta(_Col):
    def where(self, *_args):
        return self


class _DbEstr:
    def __init__(self, puntos):
        self.puntos = puntos

    def collection(self, _nombre):
        return self

    def where(self, *_):
        return self

    def stream(self, **_opciones):
        puntos = self.puntos

        class Snap:
            def to_dict(self):
                return {"points": [{"date": f, "value": v} for f, v in puntos]}
        return [Snap()]


ESTR_HASTA_OCTUBRE = [("2026-01-01", 0.02), ("2026-07-01", 0.03), ("2026-10-28", 0.03)]


@pytest.fixture
def proyecto_nuevo(monkeypatch):
    monkeypatch.setenv("MASTER_PROJECT_ID", lector.PROYECTO_BASE_NUEVA)
    lector._ESTR_GUARDADA.clear()
    yield
    lector._ESTR_GUARDADA.clear()


def test_el_tipo_libre_sale_de_la_serie_guardada_sin_preguntar_al_bce(proyecto_nuevo, monkeypatch):
    def no_llames(*_a, **_k):
        raise AssertionError("no debe preguntar al BCE")
    monkeypatch.setattr(lector, "resolve_estr_window_average", no_llames)
    media = lector.resolver_tipo_libre(_DbEstr(ESTR_HASTA_OCTUBRE))("2026-01-01", "2026-10-30")
    # 181 dias al 2 % y 122 al 3 %: media ponderada por dias, conocida a mano.
    assert media["rate"] == round((181 * 0.02 + 122 * 0.03) / 303, 8)
    assert media["coverage_ratio"] == 1.0
    assert "al_dia" not in media


def test_una_serie_atrasada_pregunta_al_bce(proyecto_nuevo, monkeypatch):
    monkeypatch.setattr(lector, "resolve_estr_window_average", lambda a, b: {"rate": 0.01, "coverage_ratio": 1.0})
    media = lector.resolver_tipo_libre(_DbEstr(ESTR_HASTA_OCTUBRE))("2026-01-01", "2026-12-31")
    assert media["rate"] == 0.01


def test_atrasada_y_sin_bce_dice_su_cobertura_real(proyecto_nuevo, monkeypatch):
    def falla(*_a, **_k):
        raise OSError("BCE caido")
    monkeypatch.setattr(lector, "resolve_estr_window_average", falla)
    media = lector.resolver_tipo_libre(_DbEstr(ESTR_HASTA_OCTUBRE))("2026-01-01", "2026-12-31")
    assert media["coverage_ratio"] == round((365 - 64) / 365, 6)


def test_sin_serie_y_sin_bce_falla_para_que_salga_el_aviso(proyecto_nuevo, monkeypatch):
    def falla(*_a, **_k):
        raise OSError("BCE caido")
    monkeypatch.setattr(lector, "resolve_estr_window_average", falla)
    with pytest.raises(OSError):
        lector.resolver_tipo_libre(_DbEstr([]))("2026-01-01", "2026-12-31")


def test_la_tarjeta_pasa_operacion_y_entrada_con_su_fuente_y_la_fecha_del_kid():
    # Decision 43: las cifras de coste salen de la tarjeta, y por eso no hace falta otra lectura por posicion.
    raiz = {"instrument_type": "FUND", "identity": {"name": "Un fondo", "currency": "EUR"}}
    tarjeta = {"costs": {"ongoing_charge": 0.0208, "management_fee": 0.015, "transaction_costs": 0.0037, "entry_charge": 0.045,
                         "document_url": "https://ejemplo.invalid/k.pdf", "document_date": "2026-08-19",
                         "ongoing_charge_source": "KID", "transaction_costs_source": "KID", "entry_charge_source": "PROVIDER"}}
    costes = lector.raiz_vieja("LU1883318740", raiz, tarjeta)["costs"]
    assert costes["ter_pct"] == 2.08 and costes["transaction_costs_pct"] == 0.37 and costes["entry_fee_max_pct"] == 4.5
    detalle = map_costs({"costs": costes})
    assert detalle == {"ongoing_charge": 0.0208, "management_fee": 0.015, "transaction_costs": 0.0037, "entry_charge": 0.045,
                       "document_url": "https://ejemplo.invalid/k.pdf", "document_date": "2026-08-19",
                       "ongoing_charge_source": "KID", "transaction_costs_source": "KID", "entry_charge_source": "PROVIDER"}


def test_una_tarjeta_sin_fuente_no_se_rellena_con_la_regla_de_la_base_vieja():
    # Una tarjeta escrita antes de la decision 43 no trae fuente: sale el coste, y no se afirma de donde.
    raiz = {"instrument_type": "FUND", "identity": {"name": "Un fondo", "currency": "EUR"}}
    costes = lector.raiz_vieja("LU1883318740", raiz, {"costs": {"ongoing_charge": 0.0208}})["costs"]
    detalle = map_costs({"costs": costes})
    assert detalle["ongoing_charge"] == 0.0208
    assert "transaction_costs" not in detalle


# --- Decision 110: donde no hay cifra nuestra, la del proveedor, ventana a ventana y con su metodo.
TARJETA_ALLIANZ = {
    "instrument_type": "FUND",
    "metrics": {
        "source": "COMPUTED", "method": "EXTRACTOR_MONTHLY_V2", "frequency": "MONTHLY", "as_of": "2026-10-31",
        "annualized_return": {"1y": 0.02}, "volatility": {"1y": 0.002}, "sharpe": {"1y": -0.38},
        "provider": {
            "source": "PROVIDER", "method": "TRAILING_PROVIDER", "as_of": "2026-10-31", "returns_as_of": "2026-09-30",
            "annualized_return": {"3y": 0.0298, "5y": 0.0218, "10y": 0.0095},
            "volatility": {"3y": 0.003},
            "sharpe": {"3y": 1.2, "10y": 0.32},
        },
    },
}


def test_una_ventana_sin_cifra_nuestra_lleva_la_del_proveedor_con_su_metodo():
    ventanas = lector.metricas_viejas(TARJETA_ALLIANZ)["windows"]
    assert ventanas["1y"]["method"] == "EXTRACTOR_MONTHLY_V2" and ventanas["1y"]["annualized_return"] == 0.02
    assert ventanas["3y"] == {"annualized_return": 0.0298, "annualized_volatility": 0.003, "sharpe_ratio": 1.2,
                              "method": "TRAILING_PROVIDER", "frequency": "PROVIDER"}
    assert ventanas["10y"]["annualized_return"] == 0.0095


def test_en_una_ventana_con_cifras_nuestras_no_entra_una_suya():
    # Esta forma no tiene donde decir de quien es cada cifra: el Sharpe a 10 anios del proveedor se queda en la ficha, que si lo dice.
    tarjeta = {"instrument_type": "FUND", "metrics": {
        "source": "COMPUTED", "method": "EXTRACTOR_MONTHLY_V2", "frequency": "MONTHLY",
        "annualized_return": {"10y": 0.08}, "volatility": {"10y": 0.1},
        "provider": {"method": "TRAILING_PROVIDER", "sharpe": {"10y": 0.5}},
    }}
    nodo = lector.metricas_viejas(tarjeta)["windows"]["10y"]
    assert nodo["sharpe_ratio"] is None and nodo["method"] == "EXTRACTOR_MONTHLY_V2"


def test_el_activo_dice_que_lleva_de_las_dos_y_cada_cifra_llega():
    metricas = map_asset_detail({"asset_id": "LU1383852487", "asset_type": "FUND", "identity": {"name": "x"}}, lector.metricas_viejas(TARJETA_ALLIANZ))["metrics"]
    assert metricas["metrics_method"] == "PROPIA_Y_PROVEEDOR"
    assert metricas.get("metrics_frequency") is None
    assert metricas["annualized_return_1y"] == 0.02
    assert metricas["annualized_return_3y"] == 0.0298
    assert metricas["annualized_return_10y"] == 0.0095
    # Lo que lee una ventana necesita el rotulo de esa ventana: sin frecuencia comun, un solo fondo apagaba la estimacion de su cartera.
    assert metricas["metrics_by_window"] == {
        "1y": {"method": "EXTRACTOR_MONTHLY_V2", "frequency": "MONTHLY"},
        "3y": {"method": "TRAILING_PROVIDER", "frequency": "PROVIDER"},
        "5y": {"method": "TRAILING_PROVIDER", "frequency": "PROVIDER"},
        "10y": {"method": "TRAILING_PROVIDER", "frequency": "PROVIDER"},
    }


def test_un_activo_sin_mezcla_no_lleva_rotulos_por_ventana():
    tarjeta = {"instrument_type": "FUND", "metrics": {
        "source": "COMPUTED", "method": "EXTRACTOR_MONTHLY_V2", "frequency": "MONTHLY",
        "annualized_return": {"1y": 0.02, "3y": 0.03}, "volatility": {"1y": 0.01, "3y": 0.02},
    }}
    metricas = map_asset_detail({"asset_id": "X", "asset_type": "FUND", "identity": {"name": "x"}}, lector.metricas_viejas(tarjeta))["metrics"]
    assert metricas["metrics_method"] == "EXTRACTOR_MONTHLY_V2"
    assert metricas["metrics_frequency"] == "MONTHLY"
    assert "metrics_by_window" not in metricas


def test_los_rotulos_por_ventana_pasan_el_contrato_de_lectura():
    from jsonschema import Draft202012Validator

    esquema = json.loads((Path(__file__).resolve().parents[1] / "contracts_cache" / "asset-for-bdb.v1.schema.json").read_text(encoding="utf-8"))
    raiz = {"asset_id": "LU1383852487", "asset_type": "FUND", "updated_at": "2026-11-05T10:00:00Z", "identity": {"name": "Allianz AT2", "currency": "EUR"},
            "identifiers": {"isin": "LU1383852487"}, "classification": {"asset_class": "RF"}, "product": {"product_type": "fund"},
            "portfolio_exposure": {"asset_mix": {"equity": 0.0, "bond": 0.7, "cash": 0.3, "other": 0.0}}}
    detalle = map_asset_detail(raiz, lector.metricas_viejas(TARJETA_ALLIANZ))
    Draft202012Validator(esquema).validate(detalle)
    assert detalle["metrics"]["metrics_method"] == "PROPIA_Y_PROVEEDOR"


def test_sin_cifras_nuestras_en_ninguna_ventana_el_metodo_es_el_suyo():
    tarjeta = {"instrument_type": "FUND", "metrics": {
        "source": "COMPUTED", "method": "EXTRACTOR_MONTHLY_V2", "frequency": "MONTHLY", "ytd_return": 0.1,
        "provider": {"method": "TRAILING_PROVIDER", "annualized_return": {"1y": 0.14}},
    }}
    metricas = map_asset_detail({"asset_id": "LU3038481936", "asset_type": "FUND", "identity": {"name": "x"}}, lector.metricas_viejas(tarjeta))["metrics"]
    assert metricas["metrics_method"] == "TRAILING_PROVIDER"
    assert metricas["metrics_frequency"] == "PROVIDER"


def test_una_accion_no_recibe_nada_de_esto():
    tarjeta = {"instrument_type": "STOCK", "metrics": {"source": "COMPUTED", "method": "EXTRACTOR_DAILY_V2", "frequency": "DAILY", "annualized_return": {"1y": 0.1}}}
    assert set(lector.metricas_viejas(tarjeta)["windows"]) == {"1y"}


class _DbEstrPorDocumento:
    def __init__(self, documentos):
        self.documentos = documentos
        self.consultas = []

    def collection(self, nombre):
        self.consultas.append(nombre)
        return self

    def where(self, *args):
        self.consultas.append(args)
        return self

    def stream(self, **_opciones):
        class Snap:
            def __init__(self, datos):
                self.datos = datos

            def to_dict(self):
                return self.datos
        return [Snap(documento) for documento in self.documentos]


def test_el_lector_de_la_base_nueva_da_el_estr_en_tanto_por_uno_y_la_media_sigue_en_por_ciento():
    # Venia de test_estr_index.py, que se fue con portfolio_real/ el 17-11-2026 (decision A-188).
    lector._ESTR_GUARDADA.clear()
    try:
        db = _DbEstrPorDocumento([
            {"rate": "ESTR", "points": [{"date": "2026-01-02", "value": 0.0193}]},
            {"rate": "ESTR", "points": [{"date": "2025-12-31", "value": 0.0192}]},
        ])
        puntos = lector.LectorOptimizacionBaseNueva(db).get_reference_rate_points("ESTR")
        assert puntos == [(date(2025, 12, 31), 0.0192), (date(2026, 1, 2), 0.0193)]
        assert db.consultas[:2] == ["reference_rates", ("rate", "==", "ESTR")]
        assert lector.LectorOptimizacionBaseNueva(db).get_reference_rate_points("EURIBOR") == []
        # La media de la ventana (decision 20) sigue en por ciento, como la calcula el BCE.
        media = lector._media_de_la_serie_guardada(db, "2026-01-02", "2026-01-02")
        assert media["rate"] == pytest.approx(0.0193, abs=1e-12)
    finally:
        lector._ESTR_GUARDADA.clear()
