# -*- coding: utf-8 -*-
"""Hallazgos 19 y 21 de la auditoria del backend (15-11-2026), y las entradas mal formadas.

- (19) Un fallo de lectura no se dice como «el activo no existe»: si no se lee nada, UNAVAILABLE; si se
  lee solo una parte, la respuesta sigue con un aviso READ_FAILED que dice que parte.
- El lector de la base nueva pasa el plazo de 15 s a cada lectura.
- `compare_assets` dice de que id pedido viene una fila sustituida y que ids pedidos no existen.
- (21) Un identificador que no pasa `_valid_asset_id` no se lee, y las funciones lo rechazan con
  INVALID_ARGUMENT. Uno valido que no existe sigue siendo «no encontrado».
- Cada entrada mal formada es INVALID_ARGUMENT con el campo nombrado, no un error interno.
"""
import inspect
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import main  # noqa: E402
from firebase_functions import https_fn  # noqa: E402
from readmodel import lector_base_nueva as lector  # noqa: E402
from readmodel import repository as R  # noqa: E402
from tests.test_lector_base_nueva import _db as _db_base_nueva  # noqa: E402
from tests.test_mappers import ETF, FUND  # noqa: E402
from tests.test_repository import FakeReader  # noqa: E402

CODIGO = https_fn.FunctionsErrorCode


class _Caida(Exception):
    """Lo que lanzaria Firestore: cuota, corte o plazo agotado."""


def _falla(*_args, **_kwargs):
    raise _Caida("la base no contesta")


class LectorCaido(FakeReader):
    """Nada se puede leer."""
    get_asset = get_metrics_latest = get_holdings = list_assets = get_search_index = staticmethod(_falla)
    get_assets_many = get_metrics_latest_many = get_holdings_many = staticmethod(_falla)


class LectorSinMetricas(FakeReader):
    """Las raices y las posiciones se leen; las metricas no."""

    def get_metrics_latest(self, aid):
        raise _Caida("metricas")


class LectorConUnaRaizCaida(FakeReader):
    """El fondo se lee; el ETF no."""

    def get_asset(self, aid):
        if aid == ETF["asset_id"]:
            raise _Caida("raiz del ETF")
        return super().get_asset(aid)


class LectorSinPosiciones(FakeReader):
    def get_holdings(self, aid):
        raise _Caida("posiciones")


class LectorConIndice(FakeReader):
    def __init__(self):
        super().__init__(with_search_index=True)


class LectorConIndiceSinMetricas(LectorConIndice):
    def get_metrics_latest(self, aid):
        raise _Caida("metricas")


class _Req:
    def __init__(self, data=None):
        self.auth = None
        self.app = None
        self.data = data


@pytest.fixture(autouse=True)
def sesion(monkeypatch):
    monkeypatch.setattr(main, "_require_auth", lambda req, **limites: "asesor")


def _llamar(funcion, data):
    return inspect.unwrap(funcion)(_Req(data))


def _con_lector(monkeypatch, reader):
    monkeypatch.setattr(main, "lector_de_activos", lambda: reader)


def _sin_lector(monkeypatch):
    def _no():
        raise AssertionError("una entrada no valida no llega a la base")
    monkeypatch.setattr(main, "lector_de_activos", _no)


def _codigo(funcion, data):
    with pytest.raises(https_fn.HttpsError) as error:
        _llamar(funcion, data)
    return error.value.code, error.value.message


def _con_alias(monkeypatch, viejo, nuevo):
    import asset_aliases
    monkeypatch.setattr(asset_aliases, "aliases", lambda: {viejo: {"successor": nuevo}})


# ---------------------------------------------------------------------------
# 19 · La lectura que falla del todo es UNAVAILABLE, no «no existe»
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("funcion, data", [
    (main.resolve_portfolio, {"positions": [{"asset_id": FUND["asset_id"], "weight": 1}]}),
    (main.compare_assets, {"asset_ids": [FUND["asset_id"], ETF["asset_id"]]}),
    (main.search_assets, {"query": "dpam"}),
    (main.get_asset_detail, {"asset_id": FUND["asset_id"]}),
    (main.get_asset_holdings, {"asset_id": FUND["asset_id"]}),
    (main.get_asset_holdings_batch, {"asset_ids": [FUND["asset_id"]]}),
])
def test_si_la_base_no_contesta_la_respuesta_es_servicio_no_disponible(monkeypatch, funcion, data):
    _con_lector(monkeypatch, LectorCaido())
    codigo, mensaje = _codigo(funcion, data)
    assert codigo == CODIGO.UNAVAILABLE
    assert "no que el dato no exista" in mensaje and "vuelve a intentarlo" in mensaje


def test_la_busqueda_sin_indice_y_sin_catalogo_tambien_es_un_fallo():
    class SinIndice(LectorCaido):
        get_search_index = staticmethod(lambda: None)
    with pytest.raises(R.LecturaFallida):
        R.search_assets_page(SinIndice(), "dpam")


def test_si_las_posiciones_no_se_leen_en_ninguno_el_lote_es_un_fallo():
    with pytest.raises(R.LecturaFallida):
        R.get_asset_holdings_many(LectorSinPosiciones(), [FUND["asset_id"]])


def test_un_lote_vacio_no_lee_y_no_es_un_fallo():
    assert R.compare_assets_page(LectorCaido(), []) == {"assets": [], "missing_asset_ids": [], "invalid_asset_ids": [], "read_warnings": []}
    assert R.resolve_portfolio(LectorCaido(), [])["warnings"] == []


# ---------------------------------------------------------------------------
# 19 · La lectura que falla en parte: la respuesta sigue y dice que no se leyo
# ---------------------------------------------------------------------------

def test_resolver_sin_metricas_da_las_filas_y_un_aviso_de_lectura_no_de_activo_que_falta():
    salida = R.resolve_portfolio(LectorSinMetricas(), [{"asset_id": ETF["asset_id"], "weight": 1}])
    assert len(salida["rows"]) == 1
    [aviso] = salida["warnings"]
    assert aviso["code"] == "READ_FAILED" and aviso["part"] == "metrics"
    assert aviso["asset_id"] == ETF["asset_id"] and aviso["asset_ids"] == [ETF["asset_id"]]
    assert "no que falte el dato" in aviso["message"]


def test_resolver_con_una_raiz_que_no_se_lee_no_la_da_por_inexistente():
    salida = R.resolve_portfolio(LectorConUnaRaizCaida(), [
        {"asset_id": FUND["asset_id"], "weight": 0.5}, {"asset_id": ETF["asset_id"], "weight": 0.3},
        {"asset_id": "NO_EXISTE", "weight": 0.2}])
    assert [fila["asset_id"] for fila in salida["rows"]] == [FUND["asset_id"]]
    codigos = {(aviso["code"], aviso["asset_id"]) for aviso in salida["warnings"]}
    assert codigos == {("READ_FAILED", ETF["asset_id"]), ("MISSING_ASSET", "NO_EXISTE")}
    [leido] = [aviso for aviso in salida["warnings"] if aviso["code"] == "READ_FAILED"]
    assert leido["part"] == "asset" and leido["severity"] == "HIGH"


def test_comparar_sin_metricas_da_las_filas_y_lo_dice():
    salida = R.compare_assets_page(LectorSinMetricas(), [FUND["asset_id"], ETF["asset_id"]])
    assert [fila["asset_id"] for fila in salida["assets"]] == [FUND["asset_id"], ETF["asset_id"]]
    assert salida["missing_asset_ids"] == []
    [aviso] = salida["read_warnings"]
    assert aviso["part"] == "metrics" and aviso["asset_ids"] == sorted([FUND["asset_id"], ETF["asset_id"]])


def test_comparar_con_una_raiz_que_no_se_lee_no_la_lista_como_inexistente():
    salida = R.compare_assets_page(LectorConUnaRaizCaida(), [FUND["asset_id"], ETF["asset_id"], "NO_EXISTE"])
    assert [fila["asset_id"] for fila in salida["assets"]] == [FUND["asset_id"]]
    assert salida["missing_asset_ids"] == ["NO_EXISTE"]
    assert [(a["part"], a["asset_ids"]) for a in salida["read_warnings"]] == [("asset", [ETF["asset_id"]])]


def test_buscar_sin_metricas_da_resultados_y_lo_dice():
    pagina = R.search_assets_page(LectorConIndiceSinMetricas(), "", None, 20)
    assert len(pagina["results"]) == 4
    assert [aviso["part"] for aviso in pagina["read_warnings"]] == ["metrics"]


def test_la_ficha_sin_metricas_sale_y_lo_dice():
    ficha = R.get_asset_detail(LectorSinMetricas(), ETF["asset_id"], with_holdings=False)
    assert ficha["asset_id"] == ETF["asset_id"]
    assert [aviso["part"] for aviso in ficha["read_warnings"]] == ["metrics"]


def test_la_ficha_con_las_posiciones_caidas_sale_y_lo_dice():
    ficha = R.get_asset_detail(LectorSinPosiciones(), FUND["asset_id"], with_holdings=True)
    assert [aviso["part"] for aviso in ficha["read_warnings"]] == ["holdings"]


def test_el_lote_de_posiciones_dice_cual_no_se_pudo_leer(monkeypatch):
    class UnaCaida(FakeReader):
        def get_holdings(self, aid):
            if aid == ETF["asset_id"]:
                raise _Caida("posiciones del ETF")
            return super().get_holdings(aid)
    _con_lector(monkeypatch, UnaCaida())
    salida = _llamar(main.get_asset_holdings_batch, {"asset_ids": [FUND["asset_id"], ETF["asset_id"]]})
    assert salida["holdings"][FUND["asset_id"]] is not None and salida["holdings"][ETF["asset_id"]] is None
    assert [(a["code"], a["part"], a["asset_ids"]) for a in salida["read_warnings"]] == [
        ("READ_FAILED", "holdings", [ETF["asset_id"]])]


def test_los_fallos_tragados_quedan_en_el_registro_silencioso(caplog):
    with caplog.at_level("DEBUG", logger="bdb.quiet"):
        R.compare_assets_page(LectorSinMetricas(), [ETF["asset_id"]])
    assert any("_metrics_latest_map" in registro.getMessage() for registro in caplog.records)


# ---------------------------------------------------------------------------
# 19 · compare_assets dice de donde viene una fila sustituida y que falta
# ---------------------------------------------------------------------------

def test_comparar_un_sustituido_dice_de_que_id_pedido_viene(monkeypatch):
    _con_alias(monkeypatch, "OLD-FUND", FUND["asset_id"])
    salida = R.compare_assets_page(FakeReader(), ["OLD-FUND", ETF["asset_id"]])
    assert [(fila["asset_id"], fila.get("resolved_from")) for fila in salida["assets"]] == [
        (FUND["asset_id"], "OLD-FUND"), (ETF["asset_id"], None)]


def test_comparar_lista_los_ids_pedidos_que_no_existen(monkeypatch):
    _con_lector(monkeypatch, FakeReader())
    salida = _llamar(main.compare_assets, {"asset_ids": ["NO_EXISTE", FUND["asset_id"], "TAMPOCO"]})
    assert [fila["asset_id"] for fila in salida["assets"]] == [FUND["asset_id"]]
    assert salida["missing_asset_ids"] == ["NO_EXISTE", "TAMPOCO"]
    assert salida["read_warnings"] == []


# ---------------------------------------------------------------------------
# Con lecturas y entradas correctas, las respuestas no cambian salvo por lo aditivo
# ---------------------------------------------------------------------------

def test_con_todo_correcto_las_respuestas_son_las_de_antes_mas_los_campos_aditivos(monkeypatch):
    _con_lector(monkeypatch, LectorConIndice())
    pedidos = [FUND["asset_id"], ETF["asset_id"]]
    comparacion = _llamar(main.compare_assets, {"asset_ids": pedidos})
    assert set(comparacion) == {"assets", "missing_asset_ids", "invalid_asset_ids", "read_warnings"}
    assert comparacion["assets"] == R.compare_assets(LectorConIndice(), pedidos)
    assert comparacion["missing_asset_ids"] == [] and comparacion["read_warnings"] == []
    assert comparacion["invalid_asset_ids"] == []
    assert all("resolved_from" not in fila for fila in comparacion["assets"])

    busqueda = _llamar(main.search_assets, {"query": "dpam", "types": ["FUND"]})
    assert set(busqueda) == {"assets", "source", "total_matches", "next_cursor", "read_warnings"}
    assert busqueda["read_warnings"] == []
    assert [a["asset_id"] for a in busqueda["assets"]] == [FUND["asset_id"]]

    ficha = _llamar(main.get_asset_detail, {"asset_id": ETF["asset_id"]})
    assert "read_warnings" not in ficha and "resolved_from" not in ficha

    cartera = _llamar(main.resolve_portfolio, {"positions": [{"asset_id": FUND["asset_id"], "weight": 1}]})
    assert cartera["warnings"] == [] and len(cartera["rows"]) == 1

    lote = _llamar(main.get_asset_holdings_batch, {"asset_ids": [FUND["asset_id"]]})
    assert set(lote) == {"holdings", "read_warnings"} and lote["read_warnings"] == []
    assert lote["holdings"][FUND["asset_id"]] == R.get_asset_holdings(FakeReader(), FUND["asset_id"])


# ---------------------------------------------------------------------------
# El lector de la base nueva: plazo en cada lectura e identificador validado
# ---------------------------------------------------------------------------

def test_el_lector_de_la_base_nueva_pide_cada_lectura_con_el_plazo_declarado():
    db = _db_base_nueva()
    leer = lector.LectorBaseNueva(db)
    assert leer.get_asset("BE0943877671") is not None
    leer.get_metrics_latest_many(["BE0943877671"])
    leer.get_holdings("BE0943877671")
    leer.get_search_index()
    assert db.plazos and all(plazo == 15 for plazo in db.plazos if not str(plazo).startswith("dentro de"))
    assert lector.LectorOptimizacionBaseNueva.read_timeout_seconds == lector.PLAZO_LECTURA_SEGUNDOS == 15


def test_el_plazo_lleva_un_reintento_que_no_lo_rebasa():
    opciones = lector._plazo()
    assert opciones["timeout"] == 15 and opciones["retry"]._timeout == 15


@pytest.mark.parametrize("identificador", ["BE0943877671/read/card", "BE0943877671/read", "A" * 129, 12345, None, ""])
def test_el_lector_de_la_base_nueva_no_lee_un_identificador_no_valido(identificador):
    db = _db_base_nueva()
    leer = lector.LectorBaseNueva(db)
    assert leer.get_asset(identificador) is None
    assert leer.get_holdings(identificador) is None
    assert leer.get_assets_many([identificador]) == {}
    assert leer.get_metrics_latest_many([identificador]) == {}
    assert db.plazos == [] or all(plazo is not None for plazo in db.plazos)
    assert lector.LectorOptimizacionBaseNueva(db).get_price_series(identificador) == []


def test_en_un_lote_el_lector_lee_los_validos_y_salta_los_que_no():
    leer = lector.LectorBaseNueva(_db_base_nueva())
    assert list(leer.get_assets_many(["BE0943877671", "BE0943877671/read/card", 7])) == ["BE0943877671"]


# ---------------------------------------------------------------------------
# 21 · Las funciones rechazan el identificador no valido; el valido que no existe sigue siendo NOT_FOUND
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("identificador", ["X/read/card", "a/b", "A" * 129, 12345, ["LU1"]])
@pytest.mark.parametrize("funcion", [main.get_asset_detail, main.get_asset_holdings])
def test_un_identificador_no_valido_es_argumento_invalido(monkeypatch, funcion, identificador):
    _sin_lector(monkeypatch)
    codigo, mensaje = _codigo(funcion, {"asset_id": identificador})
    assert codigo == CODIGO.INVALID_ARGUMENT
    assert "asset_id" in mensaje


class LectorQueApunta(FakeReader):
    """Anota cada id que llega al lector: uno sin forma de identificador no tiene que llegar nunca."""

    def __init__(self):
        super().__init__()
        self.leidos = []

    def get_asset(self, aid):
        self.leidos.append(aid)
        return super().get_asset(aid)

    def get_holdings(self, aid):
        self.leidos.append(aid)
        return super().get_holdings(aid)


def _sin_forma_valida(leidos):
    return [aid for aid in leidos if not (isinstance(aid, str) and R._valid_asset_id(aid))]


@pytest.mark.parametrize("ids", [[None], [12345], [["LU1"]]])
@pytest.mark.parametrize("funcion", [main.compare_assets, main.get_asset_holdings_batch])
def test_una_lista_con_un_elemento_que_no_es_texto_es_argumento_invalido(monkeypatch, funcion, ids):
    _sin_lector(monkeypatch)
    codigo, mensaje = _codigo(funcion, {"asset_ids": ["LU0000000001", *ids]})
    assert codigo == CODIGO.INVALID_ARGUMENT
    assert "asset_ids[1] tiene que ser un texto" in mensaje


def test_comparar_con_un_id_sin_forma_valida_compara_el_resto_y_lo_lista_como_inexistente(monkeypatch):
    lector_que_apunta = LectorQueApunta()
    _con_lector(monkeypatch, lector_que_apunta)
    salida = _llamar(main.compare_assets, {"asset_ids": [FUND["asset_id"], "BRK/B", "A" * 129, "NO_EXISTE"]})
    assert [fila["asset_id"] for fila in salida["assets"]] == [FUND["asset_id"]]
    assert salida["missing_asset_ids"] == ["BRK/B", "A" * 129, "NO_EXISTE"]
    assert salida["invalid_asset_ids"] == ["BRK/B", "A" * 129]
    assert _sin_forma_valida(lector_que_apunta.leidos) == []


def test_el_lote_de_posiciones_con_un_id_sin_forma_valida_lo_da_como_none(monkeypatch):
    lector_que_apunta = LectorQueApunta()
    _con_lector(monkeypatch, lector_que_apunta)
    salida = _llamar(main.get_asset_holdings_batch, {"asset_ids": [FUND["asset_id"], "BRK/B", "X/read/card"]})
    assert salida["holdings"][FUND["asset_id"]] is not None
    assert salida["holdings"]["BRK/B"] is None and salida["holdings"]["X/read/card"] is None
    assert salida["read_warnings"] == []
    assert _sin_forma_valida(lector_que_apunta.leidos) == []


def test_una_cartera_con_brk_b_se_resuelve_entera_salvo_esa_fila(monkeypatch):
    lector_que_apunta = LectorQueApunta()
    _con_lector(monkeypatch, lector_que_apunta)
    salida = _llamar(main.resolve_portfolio, {"positions": [
        {"asset_id": FUND["asset_id"], "weight": 0.5}, {"asset_id": "BRK/B", "weight": 0.2},
        {"asset_id": ETF["asset_id"], "weight": 0.2}, {"asset_id": 7, "weight": 0.1}]})
    assert [fila["requested_asset_id"] for fila in salida["rows"]] == [FUND["asset_id"], ETF["asset_id"]]
    assert [(a["code"], a["asset_id"], a.get("reason")) for a in salida["warnings"]] == [
        ("MISSING_ASSET", "BRK/B", "INVALID_ID"), ("MISSING_ASSET", 7, "INVALID_ID")]
    assert _sin_forma_valida(lector_que_apunta.leidos) == []


def test_una_posicion_valida_que_no_existe_sigue_sin_motivo_de_forma():
    salida = R.resolve_portfolio(FakeReader(), [{"asset_id": "NO_EXISTE"}, {"weight": 1}])
    assert [(a["code"], a["asset_id"], a.get("reason")) for a in salida["warnings"]] == [
        ("MISSING_ASSET", "NO_EXISTE", None), ("MISSING_ASSET", None, None)]


def test_un_identificador_valido_que_no_existe_sigue_siendo_no_encontrado(monkeypatch):
    _con_lector(monkeypatch, FakeReader())
    assert _codigo(main.get_asset_detail, {"asset_id": "LU0000000001"})[0] == CODIGO.NOT_FOUND
    assert _llamar(main.get_asset_holdings, {"asset_id": "LU0000000001"}) is None


def test_falta_el_identificador(monkeypatch):
    _sin_lector(monkeypatch)
    assert _codigo(main.get_asset_detail, {})[1] == "Falta asset_id."
    assert _codigo(main.get_asset_holdings, {"asset_id": "  "})[1] == "Falta asset_id."


# ---------------------------------------------------------------------------
# Entradas mal formadas: INVALID_ARGUMENT con el campo nombrado
# ---------------------------------------------------------------------------

@pytest.mark.parametrize("data, campo", [
    ({"types": "FUND"}, "types"),
    ({"types": [1]}, "types"),
    ({"types": [None]}, "types"),
    ({"query": "x" * 201}, "200 caracteres"),
    ({"query": 5}, "busqueda"),
    (["FUND"], "objeto"),
])
def test_buscar_con_una_entrada_mal_formada(monkeypatch, data, campo):
    _sin_lector(monkeypatch)
    codigo, mensaje = _codigo(main.search_assets, data)
    assert codigo == CODIGO.INVALID_ARGUMENT and campo in mensaje


def test_una_busqueda_de_200_caracteres_se_acepta(monkeypatch):
    _con_lector(monkeypatch, LectorConIndice())
    assert _llamar(main.search_assets, {"query": "x" * 200})["assets"] == []


@pytest.mark.parametrize("data, campo", [
    ({"positions": "LU1"}, "positions debe ser una lista"),
    ({"positions": [1]}, "positions[0]"),
    ({"positions": [{"asset_id": "LU1"}, None]}, "positions[1]"),
])
def test_resolver_con_posiciones_mal_formadas(monkeypatch, data, campo):
    _sin_lector(monkeypatch)
    codigo, mensaje = _codigo(main.resolve_portfolio, data)
    assert codigo == CODIGO.INVALID_ARGUMENT and campo in mensaje


@pytest.mark.parametrize("funcion", [main.compare_assets, main.get_asset_holdings_batch])
def test_una_lista_de_identificadores_que_no_es_lista(monkeypatch, funcion):
    _sin_lector(monkeypatch)
    codigo, mensaje = _codigo(funcion, {"asset_ids": "LU1"})
    assert codigo == CODIGO.INVALID_ARGUMENT and "asset_ids debe ser una lista" in mensaje


@pytest.mark.parametrize("tipo", ["NO_EXISTE", ["WEEKLY_REPORT"], 7])
def test_el_informe_con_un_tipo_no_valido(tipo):
    codigo, mensaje = _codigo(main.get_weekly_report, {"type": tipo})
    assert codigo == CODIGO.INVALID_ARGUMENT and "type" in mensaje and "WEEKLY_REPORT" in mensaje


@pytest.mark.parametrize("data", [["nivel", 5], "nivel"])
def test_el_borrador_con_datos_que_no_son_un_objeto(data):
    codigo, mensaje = _codigo(main.generate_portfolio_draft, data)
    assert codigo == CODIGO.INVALID_ARGUMENT and "objeto" in mensaje


@pytest.mark.parametrize("data, campo", [
    ({"positions": "LU1"}, "positions debe ser una lista"),
    ({"positions": [1, 2]}, "positions[0]"),
    ([{"asset_id": "LU1"}], "objeto"),
])
def test_la_lectura_con_ia_con_posiciones_mal_formadas(monkeypatch, data, campo):
    def _no(_data):
        raise AssertionError("una entrada no valida no llega al servicio")
    monkeypatch.setattr(main, "analyze_portfolio_service", _no)
    codigo, mensaje = _codigo(main.analyze_portfolio, data)
    assert codigo == CODIGO.INVALID_ARGUMENT and campo in mensaje


def test_los_limites_que_habia_no_cambian(monkeypatch):
    _sin_lector(monkeypatch)
    assert main.CAP_COMPARE_IDS == 25 and main.CAP_POSITIONS == 200 and main.CAP_SEARCH_LIMIT == 200
    codigo, mensaje = _codigo(main.compare_assets, {"asset_ids": ["LU1"] * 26})
    assert codigo == CODIGO.INVALID_ARGUMENT and "Maximo 25 activos" in mensaje
